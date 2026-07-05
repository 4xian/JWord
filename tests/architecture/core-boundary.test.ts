/**
 * 职责：验证 @4xian/jword-core 的包依赖、源码 import 与顶层浏览器全局边界。
 * 边界：只检查 core package.json 与 packages/core/src，不检查其他 worker 负责的包或 examples。
 * 协作模块：根 ESLint 规则、tools/lint/check-boundaries.mjs 与共享边界策略共同组成 Gate 0 门禁。
 * 性能/安全约束：测试只做静态文件扫描，避免执行 core 代码或加载浏览器环境。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/05-implementation-gates.md#gate-0---工程基座。
 */

import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const REPO_ROOT = new URL('../..', import.meta.url)
const CORE_PACKAGE_JSON = new URL('../../packages/core/package.json', import.meta.url)
const CORE_SRC = new URL('../../packages/core/src/', import.meta.url)
const CORE_BOUNDARY_POLICY = new URL('../../tools/lint/core-boundary-policy.json', import.meta.url)
const SOURCE_FILE_PATTERN = /\.[cm]?[jt]sx?$/u

interface CoreBoundaryPolicy {
  readonly coreForbiddenImports: readonly string[]
  readonly coreTopLevelDomGlobals: readonly string[]
}

interface PackageJson {
  readonly dependencies?: Record<string, string>
  readonly peerDependencies?: Record<string, string>
  readonly optionalDependencies?: Record<string, string>
  readonly devDependencies?: Record<string, string>
}

interface DomReference {
  readonly file: string
  readonly line: number
  readonly name: string
}

function parsePackageJson(): PackageJson {
  return JSON.parse(readFileSync(CORE_PACKAGE_JSON, 'utf8')) as PackageJson
}

function readCoreBoundaryPolicy(): CoreBoundaryPolicy {
  return JSON.parse(readFileSync(CORE_BOUNDARY_POLICY, 'utf8')) as CoreBoundaryPolicy
}

function dependencyNames(packageJson: PackageJson): string[] {
  return [
    ...Object.keys(packageJson.dependencies ?? {}),
    ...Object.keys(packageJson.peerDependencies ?? {}),
    ...Object.keys(packageJson.optionalDependencies ?? {}),
    ...Object.keys(packageJson.devDependencies ?? {})
  ]
}

function listSourceFiles(directory: URL): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const child = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, directory)

    if (entry.isDirectory()) {
      return listSourceFiles(child)
    }

    return entry.isFile() && SOURCE_FILE_PATTERN.test(entry.name) ? [fileURLToPath(child)] : []
  })
}

function extractModuleSpecifiers(source: string): string[] {
  const importLikePattern =
    /(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  const specifiers: string[] = []

  for (const match of source.matchAll(importLikePattern)) {
    const specifier = match[1] ?? match[2]

    if (specifier !== undefined) {
      specifiers.push(specifier)
    }
  }

  return specifiers
}

function isForbiddenImport(specifier: string, policy: CoreBoundaryPolicy): boolean {
  return policy.coreForbiddenImports.some((blocked) => specifier === blocked || specifier.startsWith(`${blocked}/`))
}

function isForbiddenDependency(name: string, policy: CoreBoundaryPolicy): boolean {
  return policy.coreForbiddenImports.some((blocked) => name === blocked || name.startsWith(`${blocked}/`))
}

function readScriptKind(file: string): ts.ScriptKind {
  if (file.endsWith('.tsx')) {
    return ts.ScriptKind.TSX
  }
  if (file.endsWith('.jsx')) {
    return ts.ScriptKind.JSX
  }
  if (file.endsWith('.js') || file.endsWith('.mjs')) {
    return ts.ScriptKind.JS
  }

  return ts.ScriptKind.TS
}

function collectTopLevelDomReferences(file: string, source: string, policy: CoreBoundaryPolicy): DomReference[] {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, readScriptKind(file))
  const domGlobals = new Set(policy.coreTopLevelDomGlobals)
  const references: DomReference[] = []

  for (const statement of sourceFile.statements) {
    inspectTopLevelNode(sourceFile, statement, domGlobals, references)
  }

  return references
}

function inspectTopLevelNode(
  sourceFile: ts.SourceFile,
  node: ts.Node,
  domGlobals: ReadonlySet<string>,
  references: DomReference[]
): void {
  if (isDeclarationOnlyNode(node)) {
    return
  }

  if (ts.isVariableStatement(node)) {
    for (const declaration of node.declarationList.declarations) {
      if (declaration.initializer !== undefined) {
        inspectValueNode(sourceFile, declaration.initializer, domGlobals, references)
      }
    }
    return
  }

  if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
    inspectClassStaticMembers(sourceFile, node, domGlobals, references)
    return
  }

  if (ts.isFunctionDeclaration(node)) {
    return
  }

  if (ts.isExportAssignment(node)) {
    inspectValueNode(sourceFile, node.expression, domGlobals, references)
    return
  }

  if (ts.isExpressionStatement(node)) {
    inspectValueNode(sourceFile, node.expression, domGlobals, references)
  }
}

function isDeclarationOnlyNode(node: ts.Node): boolean {
  return ts.isImportDeclaration(node) ||
    ts.isExportDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isModuleDeclaration(node)
}

function inspectValueNode(
  sourceFile: ts.SourceFile,
  node: ts.Node,
  domGlobals: ReadonlySet<string>,
  references: DomReference[]
): void {
  if (ts.isTypeNode(node)) {
    return
  }

  if (
    ts.isFunctionLike(node) ||
    ts.isImportDeclaration(node) ||
    ts.isExportDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node)
  ) {
    return
  }

  if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
    inspectClassStaticMembers(sourceFile, node, domGlobals, references)
    return
  }

  if (ts.isIdentifier(node) && domGlobals.has(node.text)) {
    const location = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
    references.push({
      file: relative(fileURLToPath(REPO_ROOT), sourceFile.fileName),
      line: location.line + 1,
      name: node.text
    })
    return
  }

  if (ts.isPropertyAccessExpression(node)) {
    inspectValueNode(sourceFile, node.expression, domGlobals, references)
    return
  }

  if (ts.isPropertyAssignment(node)) {
    if (ts.isComputedPropertyName(node.name)) {
      inspectValueNode(sourceFile, node.name.expression, domGlobals, references)
    }
    inspectValueNode(sourceFile, node.initializer, domGlobals, references)
    return
  }

  if (ts.isVariableDeclaration(node)) {
    if (node.initializer !== undefined) {
      inspectValueNode(sourceFile, node.initializer, domGlobals, references)
    }
    return
  }

  ts.forEachChild(node, (child) => {
    inspectValueNode(sourceFile, child, domGlobals, references)
  })
}

function inspectClassStaticMembers(
  sourceFile: ts.SourceFile,
  node: ts.ClassDeclaration | ts.ClassExpression,
  domGlobals: ReadonlySet<string>,
  references: DomReference[]
): void {
  for (const member of node.members) {
    if (ts.isClassStaticBlockDeclaration(member)) {
      for (const statement of member.body.statements) {
        inspectTopLevelNode(sourceFile, statement, domGlobals, references)
      }
      continue
    }

    const isStatic = ts.canHaveModifiers(member) && (ts.getModifiers(member) ?? []).some((modifier) =>
      modifier.kind === ts.SyntaxKind.StaticKeyword
    )

    if (!isStatic || !ts.isPropertyDeclaration(member) || member.initializer === undefined) {
      continue
    }

    inspectValueNode(sourceFile, member.initializer, domGlobals, references)
  }
}

describe('core architecture boundary', () => {
  it('keeps tests outside source directories', () => {
    const misplacedTests = listSourceFiles(CORE_SRC).filter((file) =>
      /\.(?:test|spec)\.[cm]?tsx?$/u.test(file)
    )

    expect(misplacedTests).toEqual([])
  })

  it('does not declare UI, interop, collab provider, or demo dependencies', () => {
    const packageJson = parsePackageJson()
    const policy = readCoreBoundaryPolicy()
    const bannedDependencies = dependencyNames(packageJson).filter((name) => isForbiddenDependency(name, policy))

    expect(bannedDependencies).toEqual([])
  })

  it('does not import UI, interop, collab provider, or demo modules from core src', () => {
    const policy = readCoreBoundaryPolicy()
    const bannedImports = listSourceFiles(CORE_SRC).flatMap((file) => {
      const source = readFileSync(file, 'utf8')
      const relativePath = relative(fileURLToPath(REPO_ROOT), file)

      return extractModuleSpecifiers(source)
        .filter((specifier) => isForbiddenImport(specifier, policy))
        .map((specifier) => `${relativePath}: ${specifier}`)
    })

    expect(bannedImports).toEqual([])
  })

  it('does not access browser globals from core top level', () => {
    const policy = readCoreBoundaryPolicy()
    const domReferences = listSourceFiles(CORE_SRC).flatMap((file) => {
      const source = readFileSync(file, 'utf8')

      return collectTopLevelDomReferences(file, source, policy)
        .map((reference) => `${reference.file}:${reference.line}: ${reference.name}`)
    })

    expect(domReferences).toEqual([])
  })

  it('keeps core package dependency versions exact when dependencies exist', () => {
    const packageJson = parsePackageJson()
    const entries = dependencyNames(packageJson)
    const looseVersions = entries.filter((name) => {
      const version =
        packageJson.dependencies?.[name] ??
        packageJson.peerDependencies?.[name] ??
        packageJson.optionalDependencies?.[name] ??
        packageJson.devDependencies?.[name] ??
        ''

      return version.startsWith('^') || version.startsWith('~')
    })

    expect(looseVersions).toEqual([])
  })
})
