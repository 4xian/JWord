/**
 * @vitest-environment node
 *
 * 职责：验证 Gate 7 Step 7.2 的包导出映射审计与外部式类型测试入口。
 * 边界：只读取 package manifest、类型测试 fixture 和公开 API 文档，不执行 SDK 运行时。
 * 协作模块：公开包导出映射、公开接口目录与 Gate 7 类型测试共同冻结对外消费边界。
 * 约束：第三方只能从 package 入口或明确公开子路径导入，不能依赖 src、provider 内部、Yjs、worker 内部 helper 或 demo runtime。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#step-72建立-api-导出审计和类型测试。
 */

import { existsSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const rootPackagePath = 'package.json'
const publicApiCatalogPath = 'docs/sdk/public-api.md'
const typeTestPath = 'tests/types/gate7-public-api-entrypoints.ts'
const typeTestTsconfigPath = 'tests/types/tsconfig.gate7-public-api.json'
const publicPackageManifestPaths = [
  'packages/core/package.json',
  'packages/ui/package.json',
  'packages/native/package.json',
  'packages/docx/package.json',
  'packages/pdf/package.json',
  'packages/persistence/package.json',
  'packages/collab/package.json',
  'packages/collab-server/package.json',
  'packages/license/package.json'
]

interface PackageManifest {
  readonly name?: unknown
  readonly types?: unknown
  readonly files?: unknown
  readonly exports?: unknown
  readonly scripts?: unknown
}

/** 读取 package manifest 并保留 unknown 边界。 */
function readPackageManifest(path: string): PackageManifest {
  return JSON.parse(readFileSync(path, 'utf8')) as PackageManifest
}

/** 收集 export map 中所有公开目标文件。 */
function collectExportTargets(value: unknown): string[] {
  if (typeof value === 'string') {
    return [value]
  }

  if (value === null || typeof value !== 'object') {
    return []
  }

  return Object.values(value).flatMap(collectExportTargets)
}

/** 收集 export map 顶层公开 key。 */
function collectExportKeys(value: unknown): string[] {
  if (value === null || typeof value !== 'object') {
    return []
  }

  return Object.keys(value)
}

describe('Gate 7 API export audit and type tests', () => {
  it('keeps public package manifests on dist outputs and public assets', () => {
    for (const path of publicPackageManifestPaths) {
      const manifest = readPackageManifest(path)
      const files = Array.isArray(manifest.files) ? manifest.files : []
      const exportTargets = collectExportTargets(manifest.exports)

      expect(files, `${path}:files`).not.toContain('src')
      expect(files, `${path}:files`).not.toContain('examples')
      expect(files, `${path}:files`).not.toContain('demo')
      expect(manifest.types, `${path}:types`).toBe('./dist/index.d.ts')

      for (const target of exportTargets) {
        expect(target, `${path}:export target`).not.toContain('/src/')
        expect(target, `${path}:export target`).not.toContain('examples/')
        expect(target, `${path}:export target`).toMatch(/^\.\/dist\//u)
      }
    }
  })

  it('does not publish source, provider, internal or demo subpaths', () => {
    for (const path of publicPackageManifestPaths) {
      const manifest = readPackageManifest(path)
      const exportKeys = collectExportKeys(manifest.exports)

      for (const key of exportKeys) {
        expect(key, `${path}:export key`).not.toMatch(/src|internal|demo|provider|hocuspocus|yjs/u)
      }
    }
  })

  it('ships an external-style public API type test fixture', () => {
    const rootPackage = readPackageManifest(rootPackagePath)
    const scripts = rootPackage.scripts as Record<string, unknown> | undefined

    expect(scripts?.['test:types']).toBe(`tsc -p ${typeTestTsconfigPath} --noEmit`)
    expect(existsSync(typeTestPath)).toBe(true)
    expect(existsSync(typeTestTsconfigPath)).toBe(true)

    const fixture = readFileSync(typeTestPath, 'utf8')
    const requiredImports = [
      '@4xian/jword-core',
      '@4xian/jword-ui',
      '@4xian/jword-native',
      '@4xian/jword-docx',
      '@4xian/jword-pdf',
      '@4xian/jword-persistence',
      '@4xian/jword-collab',
      '@4xian/jword-collab-server',
      '@4xian/jword-license'
    ]

    for (const packageName of requiredImports) {
      expect(fixture, packageName).toContain(`from '${packageName}'`)
    }

    for (const forbidden of [
      'packages/',
      '/src/',
      "from 'yjs'",
      "from '@hocuspocus/server'"
    ]) {
      expect(fixture, forbidden).not.toContain(forbidden)
    }
  })

  it('documents the type test and export audit commands', () => {
    const catalog = readFileSync(publicApiCatalogPath, 'utf8')

    expect(catalog).toContain('pnpm test:types')
    expect(catalog).toContain('tests/architecture/gate7-api-export-audit.test.ts')
    expect(catalog).toContain('tests/types/gate7-public-api-entrypoints.ts')
  })
})
