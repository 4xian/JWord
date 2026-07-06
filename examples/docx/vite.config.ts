/**
 * 职责：定义 DOCX/PDF 手动验收 demo 的 workspace 源码解析策略。
 * 边界：只处理 examples/docx 入口依赖的 alias，不改变包本身导出配置。
 * 协作：packages/core、packages/ui、packages/docx、packages/pdf 和 Gate 5 手动验收入口。
 * 约束：demo 直连源码 alias，避免 linked package 在 Vite build 中回落到不完整声明图。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#iteration-25---建立-examplesdocx-手动验收入口。
 */
import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vite'

export function createDocxDemoViteConfig() {
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
          find: '@4xian/jword-ui',
          replacement: fileURLToPath(new URL('../../packages/ui/src/index.ts', import.meta.url))
        },
        {
          find: '@4xian/jword-license',
          replacement: fileURLToPath(new URL('../../packages/license/src/index.ts', import.meta.url))
        },
        {
          find: '@4xian/jword-docx/worker',
          replacement: fileURLToPath(new URL('../../packages/docx/src/worker.ts', import.meta.url))
        },
        {
          find: '@4xian/jword-docx',
          replacement: fileURLToPath(new URL('../../packages/docx/src/index.ts', import.meta.url))
        },
        {
          find: '@4xian/jword-pdf',
          replacement: fileURLToPath(new URL('../../packages/pdf/src/index.ts', import.meta.url))
        }
      ]
    }
  }
}

export default defineConfig(() => createDocxDemoViteConfig())
