/**
 * 职责：验证 @4xian/jword-core 的包依赖和源码 import 边界。
 * 边界：只检查 core package.json 与 packages/core/src，不检查其他 worker 负责的包或 examples。
 * 协作模块：根 ESLint 规则和 CI 可复用此测试作为 Gate 0 架构边界门禁。
 * 性能/安全约束：测试只做静态文件扫描，避免执行 core 代码或加载浏览器环境。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/05-implementation-gates.md#gate-0---工程基座。
 */

import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { relative } from 'node:path'

const REPO_ROOT = new URL('../..', import.meta.url)
const CORE_PACKAGE_JSON = new URL('../../packages/core/package.json', import.meta.url)
const CORE_SRC = new URL('../../packages/core/src/', import.meta.url)

const BANNED_DEPENDENCY_PATTERNS = [
  /^react$/,
  /^react-dom$/,
  /^vue$/,
  /^@vue\//,
  /docx/i,
  /pdf/i,
  /hocuspocus/i,
  /demo/i
] as const

const BANNED_IMPORT_PATTERNS = [
  /^react$/,
  /^react-dom$/,
  /^vue$/,
  /^@vue\//,
  /docx/i,
  /pdf/i,
  /hocuspocus/i,
  /(?:^|\/)examples?\//,
  /(?:^|\/)demo(?:\/|$)/i
] as const

interface PackageJson {
  readonly dependencies?: Record<string, string>
  readonly peerDependencies?: Record<string, string>
  readonly optionalDependencies?: Record<string, string>
  readonly devDependencies?: Record<string, string>
}

function parsePackageJson(): PackageJson {
  return JSON.parse(readFileSync(CORE_PACKAGE_JSON, 'utf8')) as PackageJson
}

function dependencyNames(packageJson: PackageJson): string[] {
  return [
    ...Object.keys(packageJson.dependencies ?? {}),
    ...Object.keys(packageJson.peerDependencies ?? {}),
    ...Object.keys(packageJson.optionalDependencies ?? {}),
    ...Object.keys(packageJson.devDependencies ?? {})
  ]
}

function listTypeScriptFiles(directory: URL): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const child = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, directory)

    if (entry.isDirectory()) {
      return listTypeScriptFiles(child)
    }

    return entry.isFile() && entry.name.endsWith('.ts') ? [child.pathname] : []
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

describe('core architecture boundary', () => {
  it('keeps tests outside source directories', () => {
    const misplacedTests = listTypeScriptFiles(CORE_SRC).filter((file) =>
      /\.(?:test|spec)\.ts$/u.test(file)
    )

    expect(misplacedTests).toEqual([])
  })

  it('does not declare UI, interop, collab provider, or demo dependencies', () => {
    const packageJson = parsePackageJson()
    const bannedDependencies = dependencyNames(packageJson).filter((name) =>
      BANNED_DEPENDENCY_PATTERNS.some((pattern) => pattern.test(name))
    )

    expect(bannedDependencies).toEqual([])
  })

  it('does not import UI, interop, collab provider, or demo modules from core src', () => {
    const bannedImports = listTypeScriptFiles(CORE_SRC).flatMap((file) => {
      const source = readFileSync(file, 'utf8')
      const relativePath = relative(REPO_ROOT.pathname, file)

      return extractModuleSpecifiers(source)
        .filter((specifier) => BANNED_IMPORT_PATTERNS.some((pattern) => pattern.test(specifier)))
        .map((specifier) => `${relativePath}: ${specifier}`)
    })

    expect(bannedImports).toEqual([])
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
