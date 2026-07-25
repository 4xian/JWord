/**
 * @vitest-environment node
 *
 * 职责：验证 Gate 7 Step 7.3 的稳定公开接口文档注释、最小示例和诊断载荷文档。
 * 边界：只读取类型测试 fixture、公开文档和 TypeScript 声明，不执行 SDK 运行时。
 * 协作模块：公开 API 清单、类型测试入口、诊断码生成文档和稳定公开接口示例共同提供外部接入证据。
 * 约束：示例只能从 package 入口导入，不能使用 monorepo 内部路径、Yjs/provider 内部类型或 demo runtime。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import { existsSync, readFileSync } from 'node:fs'

import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const publicApiCatalogPath = 'docs/sdk/public-api.md'
const publicApiExamplesPath = 'docs/sdk/public-api-examples.md'
const typeEntrypointPath = 'tests/types/gate7-public-api-entrypoints.ts'
const typeExamplesPath = 'tests/types/gate7-public-api-examples.ts'
const typeTestTsconfigPath = 'tests/types/tsconfig.gate7-public-api.json'
const diagnosticCodesPath = 'docs/sdk/diagnostic-codes.md'

const requiredPackages = [
  '@4xian/jword-core',
  '@4xian/jword-ui',
  '@4xian/jword-native',
  '@4xian/jword-docx',
  '@4xian/jword-pdf',
  '@4xian/jword-persistence',
  '@4xian/jword-collab',
  '@4xian/jword-license'
]

const forbiddenExampleImports = [
  'packages/',
  '/src/',
  "from 'yjs'",
  "from '@hocuspocus/server'"
]

/** 读取当前类型测试专用编译配置。 */
function readTypeTestConfig(): ts.ParsedCommandLine {
  const config = ts.readConfigFile(typeTestTsconfigPath, ts.sys.readFile)
  if (config.error !== undefined) {
    throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'))
  }

  return ts.parseJsonConfigFileContent(config.config, ts.sys, 'tests/types')
}

/** 创建只包含外部式类型 fixture 的编译程序。 */
function createTypeTestProgram(): ts.Program {
  const parsed = readTypeTestConfig()
  return ts.createProgram(parsed.fileNames, parsed.options)
}

/** 判断节点自身或声明语句是否有接口文档注释。 */
function hasOwnDocComment(node: ts.Node): boolean {
  if (ts.isSourceFile(node)) {
    return false
  }

  const sourceText = node.getSourceFile().text
  const ranges = ts.getLeadingCommentRanges(sourceText, node.getFullStart()) ?? []

  return ranges.some((range) => sourceText.slice(range.pos, range.end).startsWith('/**'))
}

/** 判断导出声明是否有贴近符号自身的文档注释。 */
function declarationHasOwnDocComment(declaration: ts.Declaration): boolean {
  let current: ts.Node | undefined = declaration

  for (let depth = 0; current !== undefined && !ts.isSourceFile(current) && depth < 4; depth += 1) {
    if (hasOwnDocComment(current)) {
      return true
    }
    current = current.parent
  }

  return false
}

/** 读取 fixture 中所有 package 入口命名导入。 */
function readNamedPackageImports(sourceFile: ts.SourceFile): readonly ts.ImportSpecifier[] {
  const imports: ts.ImportSpecifier[] = []

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) {
      continue
    }
    const bindings = statement.importClause?.namedBindings
    if (bindings === undefined || !ts.isNamedImports(bindings)) {
      continue
    }
    imports.push(...bindings.elements)
  }

  return imports
}

/** 读取导入符号的真实声明。 */
function readAliasedDeclarations(checker: ts.TypeChecker, specifier: ts.ImportSpecifier): readonly ts.Declaration[] {
  const importedName = specifier.propertyName ?? specifier.name
  const symbol = checker.getSymbolAtLocation(importedName)
  const resolved = symbol !== undefined && (symbol.flags & ts.SymbolFlags.Alias) !== 0
    ? checker.getAliasedSymbol(symbol)
    : symbol

  return resolved?.getDeclarations() ?? []
}

/** 格式化缺少文档注释的导入符号。 */
function formatMissingDocImport(specifier: ts.ImportSpecifier, declarations: readonly ts.Declaration[]): string {
  const importedName = specifier.propertyName ?? specifier.name
  const location = declarations[0]
  if (location === undefined) {
    return `${importedName.text}: unresolved`
  }

  const sourceFile = location.getSourceFile()
  const lineAndChar = sourceFile.getLineAndCharacterOfPosition(location.getStart(sourceFile))
  return `${importedName.text}: ${sourceFile.fileName}:${lineAndChar.line + 1}`
}

describe('Gate 7 public API docs and examples', () => {
  it('keeps stable type-test imports backed by symbol-level doc comments', () => {
    const program = createTypeTestProgram()
    const checker = program.getTypeChecker()
    const missing: string[] = []

    for (const fixturePath of [typeEntrypointPath, typeExamplesPath]) {
      const sourceFile = program.getSourceFile(fixturePath)
      expect(sourceFile, fixturePath).toBeDefined()

      for (const specifier of readNamedPackageImports(sourceFile as ts.SourceFile)) {
        const declarations = readAliasedDeclarations(checker, specifier)
        if (!declarations.some(declarationHasOwnDocComment)) {
          missing.push(formatMissingDocImport(specifier, declarations))
        }
      }
    }

    expect(missing).toEqual([])
  })

  it('ships minimum examples that only consume public package entrypoints', () => {
    expect(existsSync(publicApiExamplesPath)).toBe(true)
    expect(existsSync(typeExamplesPath)).toBe(true)

    const catalog = readFileSync(publicApiCatalogPath, 'utf8')
    const examples = readFileSync(publicApiExamplesPath, 'utf8')
    const typeFixture = readFileSync(typeExamplesPath, 'utf8')
    const typeConfig = readFileSync(typeTestTsconfigPath, 'utf8')

    expect(catalog).toContain(publicApiExamplesPath)
    expect(typeConfig).toContain('./gate7-public-api-examples.ts')

    for (const packageName of requiredPackages) {
      expect(examples, packageName).toContain(`from '${packageName}'`)
      expect(typeFixture, packageName).toContain(`from '${packageName}'`)
    }

    expect(examples).not.toContain("from '@4xian/jword-collab-server'")
    expect(typeFixture).not.toContain("from '@4xian/jword-collab-server'")

    for (const forbidden of forbiddenExampleImports) {
      expect(examples, forbidden).not.toContain(forbidden)
      expect(typeFixture, forbidden).not.toContain(forbidden)
    }
  })

  it('documents diagnostics payload fields and feature key handoff', () => {
    const catalog = readFileSync(publicApiCatalogPath, 'utf8')
    const examples = existsSync(publicApiExamplesPath) ? readFileSync(publicApiExamplesPath, 'utf8') : ''
    const diagnostics = readFileSync(diagnosticCodesPath, 'utf8')

    for (const requiredText of [
      'Diagnostics payload contract',
      'code',
      'severity',
      'recoverable',
      'recommendedAction',
      'metadataTags',
      'JWordDiagnosticsSnapshot',
      'privacy',
      'plugins',
      'GATE5_FORMAT_FEATURES',
      'GATE6_COLLAB_FEATURES'
    ]) {
      expect(catalog, requiredText).toContain(requiredText)
    }

    expect(examples).toContain('diagnostic-codes.md')
    expect(diagnostics).toContain('| Code | Owner | Severity | Recoverable | Fallback | Domains | Description |')
  })
})
