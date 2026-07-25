/**
 * @vitest-environment node
 *
 * 职责：约束 Phase 4 内存回归门禁必须覆盖创建销毁循环与 50 页长滚动采样。
 * 边界：只验证 Playwright 采样入口、CDP heap 字段和 perf 项目接线，不执行浏览器用例。
 * 协作模块：examples/vanilla/tests/phase4-memory.perf.e2e.ts 与 playwright.config.ts。
 * 约束：内存门禁必须纳入 perf-chromium，且不得退化为仅检查静态 DOM 或单次加载。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import { existsSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

describe('Phase 4 memory regression gate', () => {
  it('provides a browser memory perf test for mount/destroy and long scrolling', () => {
    const testPath = 'examples/vanilla/tests/phase4-memory.perf.e2e.ts'

    expect(existsSync(testPath)).toBe(true)

    const source = readFileSync(testPath, 'utf8')

    for (const token of [
      'phase4-memory',
      'mountDestroyCycleCount',
      'longScrollSampleCount',
      'HeapProfiler.collectGarbage',
      'JSHeapUsedSize',
      'window.__jwordTestFixture?.destroy',
      '[data-jword-canvas-container]',
      'data-jword-page-count',
      'heapDeltaBytes',
      'mountedCanvasCount'
    ]) {
      expect(source).toContain(token)
    }
  })

  it('is included in the perf Chromium Playwright project', () => {
    const configSource = readFileSync('playwright.config.ts', 'utf8')

    expect(configSource).toContain("name: 'perf-chromium'")
    expect(configSource).toContain("testMatch: '**/*.perf.e2e.ts'")
  })
})
