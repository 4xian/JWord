/**
 * 职责：定义 vanilla demo 的模块解析策略，让宿主层在 dev/build 都直接消费 workspace 内的 core 与 ui 源码。
 * 边界：只处理 demo 入口依赖的 alias，不改变包本身的导出配置。
 * 协作：examples/vanilla package scripts、packages/core/src/index.ts、packages/ui/src/index.ts。
 * 约束：统一走源码 alias，避免 linked package 在 Vite build 中回落到不完整的声明图。
 * Specs：docs/superpowers/plans/2026-05-17-jword-ui-sdk-gate4-integration.md。
 */
import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vite'

export function createVanillaDemoViteConfig() {
  return {
    build: {
      target: 'es2022'
    },
    resolve: {
      alias: [
        {
          find: '@4xian/jword-core',
          replacement: fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url))
        },
        {
          find: '@4xian/jword-ui/styles.css',
          replacement: fileURLToPath(new URL('../../packages/ui/src/styles/toolbar.css', import.meta.url))
        },
        {
          find: '@4xian/jword-native/worker',
          replacement: fileURLToPath(new URL('../../packages/native/src/worker.ts', import.meta.url))
        },
        {
          find: '@4xian/jword-native',
          replacement: fileURLToPath(new URL('../../packages/native/src/index.ts', import.meta.url))
        },
        {
          find: '@4xian/jword-ui',
          replacement: fileURLToPath(new URL('../../packages/ui/src/index.ts', import.meta.url))
        }
      ]
    }
  }
}

export default defineConfig(() => createVanillaDemoViteConfig())
