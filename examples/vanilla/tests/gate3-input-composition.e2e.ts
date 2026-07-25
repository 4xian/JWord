/**
 * @fileoverview 职责: 覆盖 Gate 3 输入阶段的合成输入开始、更新和结束提交回归。
 * 边界: 不声称验证平台原生 IME，只验证当前浏览器事件链已接入运行时。
 * 协作: 输入辅助模块、隐藏输入框测试钩子与样例文档。
 * 约束: 断言必须来自真实输入事件、合成输入事件和公开文本镜像。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import { expect, test } from '@playwright/test'
import {
  collapseSelectionAtRunStart,
  readPlainText,
  runCompositionSequence,
  waitForGate3AlphaReady
} from './gate3-input-helpers'

test('Gate 3 runtime composition chain defers insertion until compositionend and keeps plain text result', async ({ page }) => {
  await page.goto('/test-fixture.html')
  await waitForGate3AlphaReady(page)
  await collapseSelectionAtRunStart(page, {
    sectionId: 'section-1',
    blockId: 'paragraph-1',
    runId: 'run-1',
    graphemeIndex: 0
  })

  const beforeText = await readPlainText(page)
  expect(beforeText.startsWith('Alpha toolbar sample')).toBe(true)

  const compositionProbe = await runCompositionSequence(page, '你', '你好')

  expect(compositionProbe.textBeforeEnd).toBe(beforeText)
  expect(compositionProbe.textAfterEnd.startsWith('你好Alpha toolbar sample')).toBe(true)
  expect(compositionProbe.selectionDescription).toContain('2→2')
})
