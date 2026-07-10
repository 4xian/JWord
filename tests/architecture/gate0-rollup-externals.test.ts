/**
 * @vitest-environment node
 *
 * 职责：约束 Rollup 构建必须把各包生产依赖外置。
 * 边界：只读取包清单并调用 rollup external 判定，不执行构建。
 * 协作模块：rollup.config.mjs、packages 下 package.json 和 size 门禁脚本。
 * 约束：新增生产依赖后必须自动进入 external，避免第三方源码被打进 dist。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { describe, expect, it } from 'vitest'

type ExternalPredicate = (id: string, parentId?: string, isResolved?: boolean) => boolean

interface RollupConfigShape {
  readonly external?: ExternalPredicate | readonly string[] | string
}

interface PackageManifestShape {
  readonly name: string | undefined
  readonly dependencies: Record<string, string> | undefined
  readonly peerDependencies: Record<string, string> | undefined
}

describe('Gate 0 rollup externals', () => {
  it('externalizes every package production dependency and package subpath', async () => {
    const external = await readRollupExternalPredicate()
    const dependencies = readWorkspaceProductionDependencies()

    expect(dependencies).toEqual(expect.arrayContaining([
      '@4xian/jword-core',
      '@4xian/jword-license',
      '@hocuspocus/provider',
      '@hocuspocus/server',
      'dompurify',
      'fontkit',
      'jszip',
      'pdf-lib',
      'pdfjs-dist',
      'y-indexeddb',
      'y-protocols',
      'yjs'
    ]))

    for (const dependency of dependencies) {
      expect(external(dependency)).toBe(true)
      expect(external(`${dependency}/subpath`)).toBe(true)
    }
  })
})

/** 读取 rollup 配置中的 external 判定函数。 */
async function readRollupExternalPredicate(): Promise<ExternalPredicate> {
  const configUrl = pathToFileURL(join(process.cwd(), 'rollup.config.mjs')).href
  const module = await import(configUrl) as { readonly default: readonly RollupConfigShape[] }
  const external = module.default[0]?.external

  if (typeof external === 'function') {
    return external
  }

  if (Array.isArray(external)) {
    return (id) => external.includes(id)
  }

  if (typeof external === 'string') {
    return (id) => id === external
  }

  throw new Error('Rollup config does not expose an external predicate.')
}

/** 汇总 workspace 可发布包自身名称和生产依赖。 */
function readWorkspaceProductionDependencies(): readonly string[] {
  const dependencies = new Set<string>()

  for (const entry of readdirSync('packages', { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue
    }

    const manifest = readPackageManifest(join('packages', entry.name, 'package.json'))

    if (manifest.name !== undefined) {
      dependencies.add(manifest.name)
    }
    for (const dependency of Object.keys(manifest.dependencies ?? {})) {
      dependencies.add(dependency)
    }
    for (const dependency of Object.keys(manifest.peerDependencies ?? {})) {
      dependencies.add(dependency)
    }
  }

  return [...dependencies].toSorted()
}

/** 读取并校验 package.json 的最小字段。 */
function readPackageManifest(path: string): PackageManifestShape {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown

  if (!isRecord(parsed)) {
    throw new Error(`${path} is not an object.`)
  }

  return {
    name: typeof parsed.name === 'string' ? parsed.name : undefined,
    dependencies: readStringRecord(parsed.dependencies),
    peerDependencies: readStringRecord(parsed.peerDependencies)
  }
}

/** 判断未知值是否为普通对象。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** 读取字符串键值对象字段。 */
function readStringRecord(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  const result: Record<string, string> = {}
  for (const [key, child] of Object.entries(value)) {
    if (typeof child === 'string') {
      result[key] = child
    }
  }

  return result
}
