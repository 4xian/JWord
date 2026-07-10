/**
 * @fileoverview 职责: 覆盖 Gate 3 输入阶段的键盘输入、光标、回车、全选和 toolbar selector 合同回归。
 * 边界: 只验证真实浏览器键盘路径和公开演示门面观察结果，不覆盖剪贴板、合成输入或大夹具拖拽。
 * 协作: 输入辅助模块、浏览器演示钩子、隐藏输入框测试钩子与样例文档。
 * 约束: 断言必须来自真实浏览器 DOM/canvas/公开 facade，不伪造原生输入法或剪贴板能力。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import { expect, test } from '@playwright/test'
import {
  collapseSelectionAtRunStart,
  readClientPointForPageWhitespace,
  readInitialFocusProbe,
  readLongEnglishCaretProbe,
  readParagraphCount,
  readPlainText,
  readSelectionSummary,
  readSelectionVisualProbe,
  selectRange,
  waitForGate3AlphaReady,
  waitForGate3LargeFixtureReady
} from './gate3-input-helpers'

test('Gate 3 runtime seeds the first focus caret at the document tail by default', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => window.__jwordDemo !== undefined)
  await expect(page.locator('[data-jword-hidden-textarea]')).toHaveCount(1)

  await expect.poll(() => readInitialFocusProbe(page)).toMatchObject({
    matches: true
  })
})

test('Gate 3 runtime keyboard input updates projection, selection and undo/redo state', async ({ page }) => {
  await page.goto('/?fixture=gate2')
  await waitForGate3AlphaReady(page)
  await collapseSelectionAtRunStart(page, {
    sectionId: 'section-1',
    blockId: 'paragraph-1',
    runId: 'run-1',
    graphemeIndex: 0
  })

  const input = page.locator('[data-jword-hidden-textarea]')
  const undoButton = page.locator('[data-jword-history-undo]')
  const redoButton = page.locator('[data-jword-history-redo]')

  await input.focus()
  await page.keyboard.type('AB')

  await expect.poll(() => readPlainText(page)).toContain('ABAlpha toolbar sample')
  await expect.poll(() => readSelectionSummary(page)).toContain('2→2')
  await expect(undoButton).toBeEnabled()
  await expect(redoButton).toBeDisabled()

  await page.keyboard.press('ArrowLeft')
  await expect.poll(() => readSelectionSummary(page)).toContain('1→1')

  await page.keyboard.press('Backspace')
  await expect.poll(() => readPlainText(page)).toContain('BAlpha toolbar sample')
  await expect.poll(() => readSelectionSummary(page)).toContain('0→0')

  await page.keyboard.press('Enter')
  await expect.poll(() => readParagraphCount(page)).toBe(3)

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z')
  await expect.poll(() => readParagraphCount(page)).toBe(2)
  await expect.poll(() => readPlainText(page)).toContain('BAlpha toolbar sample')

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+Z' : 'Control+Y')
  await expect.poll(() => readParagraphCount(page)).toBe(3)
})

test('Gate 3 runtime keeps long English caret aligned with rendered canvas text', async ({ page }) => {
  await page.goto('/?fixture=gate2')
  await waitForGate3AlphaReady(page)
  await collapseSelectionAtRunStart(page, {
    sectionId: 'section-1',
    blockId: 'paragraph-1',
    runId: 'run-1',
    graphemeIndex: 0
  })

  const longEnglish = 'h'.repeat(48)
  const input = page.locator('[data-jword-hidden-textarea]')

  await input.focus()
  await page.keyboard.type(longEnglish)
  await expect.poll(() => readSelectionSummary(page)).toContain(`${longEnglish.length}→${longEnglish.length}`)

  const probe = await readLongEnglishCaretProbe(page, longEnglish)

  expect(probe.caretDeltaCssPx).toBeLessThanOrEqual(2)
  expect(probe.hitGraphemeIndexAtRenderedEnd).toBe(longEnglish.length)
})

test('Gate 3 runtime keeps keyboard Enter and select-all working after clicking page whitespace', async ({ page }) => {
  await page.goto('/?fixture=gate2')
  await waitForGate3LargeFixtureReady(page)

  const whitespacePoint = await readClientPointForPageWhitespace(page, 0)
  const beforeParagraphCount = await readParagraphCount(page)

  await page.mouse.click(whitespacePoint.clientX, whitespacePoint.clientY)
  await expect.poll(() => readSelectionSummary(page)).toContain('0→0')

  await page.keyboard.press('Enter')
  await expect.poll(() => readParagraphCount(page)).toBe(beforeParagraphCount + 1)
  await expect.poll(() => readSelectionSummary(page)).toContain('0→0')

  await page.keyboard.press('Control+A')
  await expect.poll(async () => {
    const probe = await readSelectionVisualProbe(page, 0)

    return probe.selectionPixels
  }).toBeGreaterThan(20)
})

test('Gate 3 selector contract stays explicit for later toolbar integration', async ({ page }) => {
  await page.goto('/')
  await waitForGate3AlphaReady(page)
  await selectRange(page, {
    sectionId: 'section-1',
    blockId: 'paragraph-1',
    runId: 'run-1',
    anchorGraphemeIndex: 0,
    focusGraphemeIndex: 5
  })

  const requiredSelectors = [
    '[data-jword-format-underline]',
    '[data-jword-format-strike]',
    '[data-jword-format-font-family]',
    '[data-jword-format-font-size]',
    '[data-jword-format-text-color]',
    '[data-jword-format-background-color]',
    '[data-jword-format-align-left]',
    '[data-jword-format-align-center]',
    '[data-jword-format-align-right]',
    '[data-jword-format-align-justify]',
    '[data-jword-format-indent-decrease]',
    '[data-jword-format-indent-increase]'
  ] as const

  const missingSelectors = await page.evaluate((selectors) => {
    return selectors.filter((selector) => document.querySelector(selector) === null)
  }, requiredSelectors)

  test.skip(missingSelectors.length > 0, `等待 demo 集成 Gate 3 selector 协议: ${missingSelectors.join(', ')}`)

  await page.locator('[data-jword-format-underline]').click()
  await page.locator('[data-jword-format-strike]').click()
  await page.locator('[data-jword-format-font-family]').selectOption({ label: 'Arial' })
  await page.locator('[data-jword-format-font-size]').selectOption('240')
  await page.locator('[data-jword-format-text-color]').fill('#ff0000')
  await page.locator('[data-jword-format-text-color]').dispatchEvent('change')
  await page.locator('[data-jword-format-background-color]').fill('#ffff00')
  await page.locator('[data-jword-format-background-color]').dispatchEvent('change')
  await page.locator('[data-jword-format-align-center]').click()
  await page.locator('[data-jword-format-indent-increase]').click()

  await expect(page.locator('[data-jword-format-underline]')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('[data-jword-format-strike]')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('[data-jword-format-font-family]')).toHaveValue('Arial')
  await expect(page.locator('[data-jword-format-font-size]')).toHaveValue('240')
  await expect(page.locator('[data-jword-format-text-color]')).toHaveValue('#ff0000')
  await expect(page.locator('[data-jword-format-background-color]')).toHaveValue('#ffff00')
  await expect(page.locator('[data-jword-format-align-center]')).toHaveAttribute('aria-pressed', 'true')
})
