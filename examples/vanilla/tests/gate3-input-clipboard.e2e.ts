/**
 * @fileoverview 职责: 覆盖 Gate 3 输入阶段的 copy/cut/paste 纯文本剪贴板语义回归。
 * 边界: 只模拟浏览器剪贴板事件数据面，不覆盖富文本粘贴或系统剪贴板集成。
 * 协作: 输入辅助模块、隐藏输入框测试钩子与样例文档。
 * 约束: 剪贴板断言必须通过 hidden textarea 事件链和公开文本镜像验证。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import { expect, test } from '@playwright/test'
import {
  dispatchClipboardEvent,
  readPlainText,
  readSelectionSummary,
  selectRange,
  waitForGate3AlphaReady
} from './gate3-input-helpers'

test('Gate 3 runtime copy cut paste keeps plain text clipboard semantics on current selection', async ({ page }) => {
  await page.goto('/test-fixture.html?fixture=gate2')
  await waitForGate3AlphaReady(page)
  await selectRange(page, {
    sectionId: 'section-1',
    blockId: 'paragraph-1',
    runId: 'run-1',
    anchorGraphemeIndex: 0,
    focusGraphemeIndex: 5
  })

  const input = page.locator('[data-jword-hidden-textarea]')
  await input.focus()

  const copiedText = await dispatchClipboardEvent(page, 'copy')
  expect(copiedText).toBe('Alpha')
  await expect.poll(() => readPlainText(page)).toContain('Alpha toolbar sample')

  const cutText = await dispatchClipboardEvent(page, 'cut')
  expect(cutText).toBe('Alpha')
  await expect.poll(() => readPlainText(page)).toContain(' toolbar sample')
  await expect.poll(() => readSelectionSummary(page)).toContain('0→0')

  await dispatchClipboardEvent(page, 'paste', 'ALPHA')
  await expect.poll(() => readPlainText(page)).toContain('ALPHA toolbar sample')
  await expect.poll(() => readSelectionSummary(page)).toContain('5→5')
})
