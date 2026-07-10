/**
 * @vitest-environment node
 *
 * 职责：验证 Gate 0 依赖下沉与 Vitest alias / tsconfig paths 保持一致。
 * 边界：只读取根 package、tsconfig、vitest 配置并调用 Vite resolver，不执行包源码。
 * 协作模块：package.json、tsconfig.base.json、vitest.config.ts 与各 workspace package 清单。
 * 性能/安全约束：测试只做静态解析，防止根运行时依赖或测试 alias 漂移削弱包边界。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { describe, expect, it } from 'vitest'
import { resolveConfig, type UserConfig } from 'vite'

interface PackageJsonShape {
  readonly dependencies?: Record<string, string>
}

interface TsConfigShape {
  readonly compilerOptions?: {
    readonly paths?: Record<string, readonly string[]>
  }
}

interface VitestConfigModule {
  readonly default: UserConfig
}

const ALIAS_IDS_THAT_MUST_MATCH_TSCONFIG = [
  '@4xian/jword-docx/worker',
  '@4xian/jword-pdf/worker',
  '@4xian/jword-native/worker',
  '@4xian/jword-ui',
  '@4xian/jword-ui/styles.css'
] as const

describe('Gate 0 dependency governance', () => {
  it('keeps production dependencies out of the root package', () => {
    const packageJson = readJsonFile<PackageJsonShape>('package.json')

    expect(packageJson.dependencies ?? {}).toEqual({})
  })

  it('resolves Vitest aliases to the same files as tsconfig paths', async () => {
    const tsconfig = readJsonFile<TsConfigShape>('tsconfig.base.json')
    const paths = tsconfig.compilerOptions?.paths ?? {}
    const resolvedConfig = await resolveConfig(await readVitestConfig(), 'serve')
    const resolveId = resolvedConfig.createResolver({ asSrc: true })

    for (const aliasId of ALIAS_IDS_THAT_MUST_MATCH_TSCONFIG) {
      const tsconfigTarget = paths[aliasId]?.[0]

      expect(tsconfigTarget, `${aliasId} 缺少 tsconfig paths 配置`).toBeDefined()
      expect(await resolveId(aliasId)).toBe(resolve(tsconfigTarget!))
    }
  })
})

/** 读取 JSON 文件并转换为指定结构。 */
function readJsonFile<TValue>(path: string): TValue {
  return JSON.parse(readFileSync(path, 'utf8')) as TValue
}

/** 读取 Vitest 配置对象供 Vite resolver 复用。 */
async function readVitestConfig(): Promise<UserConfig> {
  const configUrl = pathToFileURL(join(process.cwd(), 'vitest.config.ts')).href
  const module = await import(configUrl) as VitestConfigModule

  return module.default
}
