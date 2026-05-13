/**
 * 职责：锁定 vanilla demo 在开发态与构建态对 @4xian/jword-core 的解析策略。
 * 边界：只验证 Vite 配置返回的 alias，不覆盖浏览器渲染与 bundle 内容。
 * 协作：examples/vanilla/vite.config.ts、packages/core/src/index.ts 和 packages/core/package.json。
 * 约束：开发态必须直连 src，构建态必须保留包导出默认行为。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md。
 */
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { describe, expect, it } from 'vitest'

describe('vanilla demo vite config', () => {
  it('serve 模式将 @4xian/jword-core 解析到 packages/core/src', async () => {
    const configModule = await loadViteConfigModule()
    const config = configModule.createVanillaDemoViteConfig('serve')
    const aliasList = normalizeAliasList(config.resolve?.alias)

    expect(aliasList).toContainEqual({
      find: '@4xian/jword-core',
      replacement: resolve(process.cwd(), 'packages/core/src/index.ts')
    })
  })

  it('build 模式不覆盖 @4xian/jword-core 的包导出入口', async () => {
    const configModule = await loadViteConfigModule()
    const config = configModule.createVanillaDemoViteConfig('build')
    const aliasList = normalizeAliasList(config.resolve?.alias)

    expect(aliasList.some((entry) => entry.find === '@4xian/jword-core')).toBe(false)
  })
})

async function loadViteConfigModule(): Promise<{
  createVanillaDemoViteConfig: (command: 'serve' | 'build') => {
    readonly resolve?: {
      readonly alias?: AliasEntry | readonly AliasEntry[]
    }
  }
}> {
  const configPath = resolve(process.cwd(), 'examples/vanilla/vite.config.ts')

  expect(existsSync(configPath)).toBe(true)

  return import(pathToFileURL(configPath).href) as Promise<{
    createVanillaDemoViteConfig: (command: 'serve' | 'build') => {
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
