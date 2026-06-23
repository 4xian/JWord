/**
 * @fileoverview 职责: 配置 JWord 单元测试和浏览器近似测试入口。
 * 边界: 不实现业务测试，不假设 packages 或 examples 已存在。
 * 协作: packages/*、examples/*、benchmarks 在后续 Gate 接入此配置。
 * 约束: 默认允许无测试通过，新增测试后由 Vitest 执行。
 * Specs: docs/superpowers/specs/2026-05-11-jword-canonical/06-acceptance-and-testing.md。
 */
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@4xian/jword-core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
      '@4xian/jword-docx': fileURLToPath(new URL('./packages/docx/src/index.ts', import.meta.url)),
      '@4xian/jword-docx/worker': fileURLToPath(new URL('./packages/docx/src/worker.ts', import.meta.url)),
      '@4xian/jword-license': fileURLToPath(new URL('./packages/license/src/index.ts', import.meta.url)),
      '@4xian/jword-native': fileURLToPath(new URL('./packages/native/src/index.ts', import.meta.url)),
      '@4xian/jword-pdf': fileURLToPath(new URL('./packages/pdf/src/index.ts', import.meta.url)),
      '@4xian/jword-pdf/worker': fileURLToPath(new URL('./packages/pdf/src/worker.ts', import.meta.url)),
      '@4xian/jword-collab/experimental': fileURLToPath(new URL('./packages/collab/src/experimental.ts', import.meta.url)),
      '@4xian/jword-collab': fileURLToPath(new URL('./packages/collab/src/index.ts', import.meta.url)),
      '@4xian/jword-collab-server': fileURLToPath(new URL('./packages/collab-server/src/index.ts', import.meta.url)),
      '@4xian/jword-persistence': fileURLToPath(new URL('./packages/persistence/src/index.ts', import.meta.url))
    }
  },
  test: {
    include: [
      'packages/**/*.test.ts',
      'packages/**/*.spec.ts',
      'tests/**/*.test.ts',
      'tests/**/*.spec.ts',
      'examples/**/*.test.ts',
      'tools/**/*.test.ts',
      'benchmarks/**/*.test.ts'
    ],
    exclude: ['**/node_modules/**', '**/dist/**', '**/coverage/**'],
    passWithNoTests: true,
    globals: true,
    environment: 'node',
    restoreMocks: true,
    clearMocks: true
  }
})
