/**
 * @vitest-environment node
 *
 * 职责：约束 Gate 6 collab 示例和验收测试只能通过公开包入口与浏览器行为接入高级协作。
 * 边界：只扫描 import graph 和 Vite alias，不启动 Vite、Hocuspocus 或真实浏览器。
 * 协作：examples/collab、packages/collab、packages/collab-server 和 Gate 6 Step 6.47-6.49。
 * 约束：禁止示例/验收测试依赖 workspace 源码路径、demo runtime 内部路径或 demo server 内部服务。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

import { describe, expect, it } from 'vitest'

const sourceRoots = [
  'examples/collab/src'
] as const
const publicApiAcceptanceTestFiles = [
  'tests/architecture/gate6-docx-fixture-integration.test.ts'
] as const
const acceptanceTestPattern = /\.e2e\.ts$/u

const forbiddenSpecifierPatterns: readonly RegExp[] = [
  /packages\/(?:collab|collab-server)\/src/u,
  /packages\/core\/src\/(?:model|operations|editor)\/(?!index(?:\.ts)?$)/u,
  /examples\/collab\/src\/runtime\//u,
  /^\.\.\/src\/runtime(?:\/|$)/u,
  /^\.\.\/server\/hocuspocus-(?:service|history-service|history-api)(?:$|\.ts$)/u,
  /^\.\.\/\.\.\/\.\.\/packages\/(?:collab|collab-server|core)\/src\//u,
  /^\.\.\/\.\.\/\.\.\/\.\.\/packages\/(?:collab|collab-server|core)\/src\//u
]
const forbiddenSourcePatterns: readonly RegExp[] = [
  /packages\/(?:collab|collab-server)\/src/u,
  /packages\/core\/src\/(?:model|operations|editor)\//u,
  /examples\/collab\/src\/runtime\//u,
  /\.\.\/src\/runtime(?:\/|$)/u,
  /\.\.\/server\/hocuspocus-(?:service|history-service|history-api)(?:$|\.ts$)/u
]

describe('Gate 6 collab example import graph', () => {
  it('keeps the collab Vite host wired to public package names instead of workspace source aliases', () => {
    const source = readFileSync('examples/collab/vite.config.ts', 'utf8')

    for (const packageName of [
      '@4xian/jword-collab',
      '@4xian/jword-collab/experimental',
      '@4xian/jword-collab-server',
      '@4xian/jword-license',
      '@4xian/jword-persistence'
    ]) {
      expect(source, packageName).not.toContain(`find: '${packageName}'`)
    }
    expect(source).not.toMatch(/packages\/(?:collab|collab-server|license|persistence)\/src/u)
  })

  it('keeps example source and browser acceptance tests off private runtime, server and package source imports', () => {
    const violations = collectImportViolations()

    expect(violations).toEqual([])
  })
})

interface ImportViolation {
  readonly filePath: string
  readonly specifier: string
}

/** 收集示例源码和验收测试中的 import graph 违规项。 */
function collectImportViolations(): readonly ImportViolation[] {
  const violations: ImportViolation[] = []

  for (const root of sourceRoots) {
    for (const filePath of listTypeScriptFiles(root)) {
      const source = stripComments(readFileSync(filePath, 'utf8'))

      for (const specifier of extractImportSpecifiers(source)) {
        if (isAllowedSpecifier(filePath, specifier)) {
          continue
        }
        if (forbiddenSpecifierPatterns.some((pattern) => pattern.test(specifier))) {
          violations.push({
            filePath,
            specifier
          })
        }
      }
    }
  }
  for (const filePath of listTypeScriptFiles('examples/collab/tests')) {
    if (!acceptanceTestPattern.test(filePath)) {
      continue
    }
    const source = readFileSync(filePath, 'utf8')
    const sourceWithoutComments = stripComments(source)

    for (const specifier of extractImportSpecifiers(sourceWithoutComments)) {
      if (forbiddenSpecifierPatterns.some((pattern) => pattern.test(specifier))) {
        violations.push({
          filePath,
          specifier
        })
      }
    }
    for (const pattern of forbiddenSourcePatterns) {
      if (pattern.test(sourceWithoutComments)) {
        violations.push({
          filePath,
          specifier: pattern.source
        })
      }
    }
  }
  for (const filePath of publicApiAcceptanceTestFiles) {
    const source = readFileSync(filePath, 'utf8')
    const sourceWithoutComments = stripComments(source)

    for (const specifier of extractImportSpecifiers(sourceWithoutComments)) {
      if (forbiddenSpecifierPatterns.some((pattern) => pattern.test(specifier))) {
        violations.push({
          filePath,
          specifier
        })
      }
    }
  }

  return violations
}

/** 递归列出目录下所有 TypeScript 源文件。 */
function listTypeScriptFiles(root: string): readonly string[] {
  return readdirSync(root).flatMap((entry) => {
    const fullPath = join(root, entry)
    const stats = statSync(fullPath)

    if (stats.isDirectory()) {
      return listTypeScriptFiles(fullPath)
    }
    if (!entry.endsWith('.ts') && !entry.endsWith('.tsx')) {
      return []
    }

    return relative(process.cwd(), fullPath)
  })
}

/** 从源码中抽取静态和动态 import specifier。 */
function extractImportSpecifiers(source: string): readonly string[] {
  const specifiers: string[] = []
  const importPattern = /\bimport(?:\s+type)?(?:\s+[^'"]*?\s+from)?\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/gu
  let match = importPattern.exec(source)

  while (match !== null) {
    specifiers.push(match[1] ?? match[2] ?? '')
    match = importPattern.exec(source)
  }

  return specifiers
}

/** 移除源码注释，避免文件头职责说明被 import graph 字符串扫描误判。 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/(^|[^:])\/\/.*$/gmu, '$1')
}

/** 允许 demo host 自身通过懒加载边界导入内部 runtime。 */
function isAllowedSpecifier(filePath: string, specifier: string): boolean {
  if (filePath === 'examples/collab/src/lazy-runtime.ts') {
    return specifier.startsWith('./runtime')
  }
  if (filePath === 'examples/collab/src/main.ts') {
    return specifier === './runtime' || specifier === './lazy-runtime'
  }

  return false
}
