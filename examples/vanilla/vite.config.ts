/**
 * 职责：定义 vanilla demo 的开发态与构建态模块解析策略。
 * 边界：只处理 @4xian/jword-core 的 Vite 运行时入口，不改变包本身的导出配置。
 * 协作：examples/vanilla package scripts、packages/core/src/index.ts 和 packages/core/package.json。
 * 约束：开发态直连 src 便于实时调试，构建态继续走 dist 包导出。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md。
 */
import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vite'

export function createVanillaDemoViteConfig(command: 'serve' | 'build') {
  if (command === 'serve') {
    return {
      resolve: {
        alias: [
          {
            find: '@4xian/jword-core',
            replacement: fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url))
          }
        ]
      }
    }
  }

  return {}
}

export default defineConfig(({ command }) => createVanillaDemoViteConfig(command))
