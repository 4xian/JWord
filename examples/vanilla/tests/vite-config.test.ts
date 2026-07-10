/**
 * 职责：锁定 vanilla demo 在开发态与构建态对 @4xian/jword-core 的解析策略。
 * 边界：只验证 Vite 配置返回的 alias，不覆盖浏览器渲染与 bundle 内容。
 * 协作：examples/vanilla/vite.config.ts、packages/core/src/index.ts 和 packages/core/package.json。
 * 约束：开发态与构建态都必须直连 workspace 源码 alias，避免 linked package 回落到不完整的声明图。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { describe, expect, it } from 'vitest'

describe('vanilla demo vite config', () => {
  it('serve 模式将 @4xian/jword-core 与 @4xian/jword-ui 解析到 workspace 源码', async () => {
    const configModule = await loadViteConfigModule()
    const config = configModule.createVanillaDemoViteConfig()
    const aliasList = normalizeAliasList(config.resolve?.alias)

    expect(aliasList).toContainEqual({
      find: '@4xian/jword-core',
      replacement: resolve(process.cwd(), 'packages/core/src/index.ts')
    })
    expect(aliasList).toContainEqual({
      find: '@4xian/jword-ui',
      replacement: resolve(process.cwd(), 'packages/ui/src/index.ts')
    })
  })

  it('build 模式继续使用 @4xian/jword-core 与 @4xian/jword-ui 的 workspace 源码 alias', async () => {
    const configModule = await loadViteConfigModule()
    const config = configModule.createVanillaDemoViteConfig()
    const aliasList = normalizeAliasList(config.resolve?.alias)

    expect(aliasList).toContainEqual({
      find: '@4xian/jword-core',
      replacement: resolve(process.cwd(), 'packages/core/src/index.ts')
    })
    expect(aliasList).toContainEqual({
      find: '@4xian/jword-ui',
      replacement: resolve(process.cwd(), 'packages/ui/src/index.ts')
    })
  })
})

async function loadViteConfigModule(): Promise<{
  createVanillaDemoViteConfig: () => {
    readonly resolve?: {
      readonly alias?: AliasEntry | readonly AliasEntry[]
    }
  }
}> {
  const configPath = resolve(process.cwd(), 'examples/vanilla/vite.config.ts')

  expect(existsSync(configPath)).toBe(true)

  return import(pathToFileURL(configPath).href) as Promise<{
    createVanillaDemoViteConfig: () => {
      readonly resolve?: {
        readonly alias?: AliasEntry | readonly AliasEntry[]
      }
    }
  }>
}

function normalizeAliasList(alias: AliasEntry | readonly AliasEntry[] | undefined): readonly AliasEntry[] {
  if (alias === undefined) {
    return []
  }

  if (Array.isArray(alias)) {
    return alias
  }

  return [alias as AliasEntry]
}

interface AliasEntry {
  readonly find: string | RegExp
  readonly replacement: string
}
