/**
 * 职责：定义协同 demo 的 Vite 解析策略。
 * 边界：只给基础 editor/UI/docx 包保留开发态源码 alias，高级协作包走公开 package entry。
 * 协作：packages/core、packages/ui、packages/docx 和 Gate 6 第三方集成验收。
 * 约束：collab、collab-server、license 和 persistence 不在 demo Vite 层指向源码路径。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md Gate 6 collaboration/auto-insert。
 */
import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vite'

/** 创建协同 demo 的 Vite 配置。 */
export function createCollabDemoViteConfig() {
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
          find: '@4xian/jword-docx',
          replacement: fileURLToPath(new URL('../../packages/docx/src/index.ts', import.meta.url))
        },
        {
          find: '@4xian/jword-ui/styles.css',
          replacement: fileURLToPath(new URL('../../packages/ui/src/styles/toolbar.css', import.meta.url))
        },
        {
          find: '@4xian/jword-ui',
          replacement: fileURLToPath(new URL('../../packages/ui/src/index.ts', import.meta.url))
        }
      ]
    }
  }
}

export default defineConfig(() => createCollabDemoViteConfig())
