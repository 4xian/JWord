/**
 * @fileoverview 职责: 用真实浏览器验证 Gate 3 工具栏的文字格式、颜色和历史状态闭环。
 * 边界: 不覆盖段落格式、插入工具或面板外观基线。
 * 协作: vanilla demo、工具栏 DOM、编辑器公开门面和共享工具栏测试辅助函数。
 * 约束: 断言必须来自真实 DOM、Canvas 输出和公开门面，不伪造输入事件能力。
 * Specs: docs/superpowers/reports/2026-07-03-remediation-execution-supplement.md §3.10 T4。
 */

import { expect, test } from '@playwright/test'

import {
  applyColorValue,
  collapseSelectionAtSecondParagraphStart,
  finalizeColorValue,
  previewColorValue,
  readFirstParagraphRunStyles,
  readFirstRenderedFragment,
  readFirstRunStyle,
  readOfficialToolbar,
  readSecondParagraphFirstRunStyle,
  readToolbarHistoryProbe,
  selectFirstFragmentRange,
  selectFirstParagraphAcrossRuns,
  waitForDemoReady
} from './gate3-toolbar-helpers'

test.describe.configure({ mode: 'serial' })

test('Gate 3 toolbar toggles current run bold and supports undo redo', async ({ page }) => {
  await page.goto('/')
  await waitForDemoReady(page)
  await page.getByRole('button', { name: '加载 Alpha 样例' }).click()
  await page.getByRole('button', { name: '选择首页片段' }).click()

  const boldButton = readOfficialToolbar(page).getByRole('button', { name: '加粗' })
  const undoButton = page.getByRole('button', { name: '撤销' })
  const redoButton = page.getByRole('button', { name: '重做' })

  await boldButton.click()

  await expect.poll(() => readToolbarHistoryProbe(page)).toEqual({
    canUndo: true,
    canRedo: false,
    boldPressed: 'true',
    undoDisabled: false,
    redoDisabled: true
  })
  await expect(page.locator('[data-jword-live-region]')).toContainText('加粗')
  expect(await readFirstRunStyle(page)).toEqual({ bold: true })

  await undoButton.click()

  await expect.poll(() => readToolbarHistoryProbe(page)).toEqual({
    canUndo: false,
    canRedo: true,
    boldPressed: 'false',
    undoDisabled: true,
    redoDisabled: false
  })
  expect(await readFirstRunStyle(page)).toEqual({})

  await redoButton.click()

  await expect.poll(() => readToolbarHistoryProbe(page)).toEqual({
    canUndo: true,
    canRedo: false,
    boldPressed: 'true',
    undoDisabled: false,
    redoDisabled: true
  })
  expect(await readFirstRunStyle(page)).toEqual({ bold: true })
})


test('Gate 3 toolbar reflects facade-driven selection updates without relying on toolbar handlers', async ({ page }) => {
  await page.goto('/')
  await waitForDemoReady(page)
  await page.getByRole('button', { name: '加载 Alpha 样例' }).click()

  await selectFirstFragmentRange(page)
  await expect(readOfficialToolbar(page).getByRole('button', { name: '加粗' })).toBeEnabled()

  await page.evaluate(() => {
    window.__jwordDemo?.editor.setSelection(null)
  })

  await expect(readOfficialToolbar(page).getByRole('button', { name: '加粗' })).toBeDisabled()
})


test('Gate 3 toolbar supports cross-run formatting through facade command builders', async ({ page }) => {
  await page.goto('/')
  await waitForDemoReady(page)
  await page.getByRole('button', { name: '加载 Alpha 样例' }).click()
  await page.getByRole('button', { name: '选择首页片段' }).click()
  await readOfficialToolbar(page).getByRole('button', { name: '加粗' }).click()

  await selectFirstParagraphAcrossRuns(page)

  const boldButton = readOfficialToolbar(page).getByRole('button', { name: '加粗' })
  const italicButton = readOfficialToolbar(page).getByRole('button', { name: '斜体' })

  await expect(boldButton).toHaveAttribute('aria-pressed', 'mixed')
  await expect(italicButton).toBeEnabled()

  await italicButton.click()
  await expect(italicButton).toHaveAttribute('aria-pressed', 'true')
  expect(await readFirstParagraphRunStyles(page)).toEqual([
    { bold: true, italic: true },
    { italic: true }
  ])
})


test('Gate 3 toolbar applies the remaining run formatting matrix through real browser controls', async ({ page }) => {
  await page.goto('/')
  await waitForDemoReady(page)
  await page.getByRole('button', { name: '加载 Alpha 样例' }).click()
  await page.getByRole('button', { name: '选择首页片段' }).click()

  const underlineButton = readOfficialToolbar(page).getByRole('button', { name: '下划线' })
  const strikeButton = readOfficialToolbar(page).getByRole('button', { name: '删除线' })
  const fontSizeDecreaseButton = readOfficialToolbar(page).getByRole('button', { name: '减小字号' })
  const fontSizeIncreaseButton = readOfficialToolbar(page).getByRole('button', { name: '增大字号' })
  const fontFamilySelect = page.locator('[data-jword-format-font-family]')
  const fontSizeSelect = page.locator('[data-jword-format-font-size]')
  const textColorInput = page.locator('[data-jword-format-text-color]')
  const backgroundColorInput = page.locator('[data-jword-format-background-color]')

  await underlineButton.click()
  await expect(underlineButton).toHaveAttribute('aria-pressed', 'true')
  expect(await readFirstRunStyle(page)).toEqual({ underline: true })

  await strikeButton.click()
  await expect(strikeButton).toHaveAttribute('aria-pressed', 'true')
  expect(await readFirstRunStyle(page)).toEqual({
    underline: true,
    strike: true
  })

  await fontFamilySelect.selectOption('KaiTi')
  await expect(fontFamilySelect).toHaveValue('KaiTi')
  await expect(fontFamilySelect).toHaveAttribute('data-jword-state', 'value')
  expect(await readFirstRunStyle(page)).toEqual({
    underline: true,
    strike: true,
    fontFamily: 'KaiTi'
  })

  await fontSizeSelect.selectOption('360')
  await expect(fontSizeSelect).toHaveValue('360')
  await expect(fontSizeSelect).toHaveAttribute('data-jword-state', 'value')
  expect(await readFirstRunStyle(page)).toEqual({
    underline: true,
    strike: true,
    fontFamily: 'KaiTi',
    fontSizeTwips: 360
  })

  await fontSizeDecreaseButton.click()
  expect(await readFirstRunStyle(page)).toEqual({
    underline: true,
    strike: true,
    fontFamily: 'KaiTi',
    fontSizeTwips: 320
  })

  await fontSizeIncreaseButton.click()
  expect(await readFirstRunStyle(page)).toEqual({
    underline: true,
    strike: true,
    fontFamily: 'KaiTi',
    fontSizeTwips: 360
  })

  await applyColorValue(page, '[data-jword-format-text-color]', '#ff0000')
  await expect(textColorInput).toHaveValue('#ff0000')
  await expect(textColorInput).toHaveAttribute('data-jword-state', 'value')
  expect(await readFirstRunStyle(page)).toEqual({
    underline: true,
    strike: true,
    fontFamily: 'KaiTi',
    fontSizeTwips: 360,
    color: '#ff0000'
  })

  await applyColorValue(page, '[data-jword-format-background-color]', '#00ff88')
  await expect(backgroundColorInput).toHaveValue('#00ff88')
  await expect(backgroundColorInput).toHaveAttribute('data-jword-state', 'value')
  expect(await readFirstRunStyle(page)).toEqual({
    underline: true,
    strike: true,
    fontFamily: 'KaiTi',
    fontSizeTwips: 360,
    color: '#ff0000',
    backgroundColor: '#00ff88'
  })
  expect(await readFirstRenderedFragment(page)).toMatchObject({
    text: 'Alph',
    style: {
      underline: true,
      strike: true,
      color: '#ff0000',
      backgroundColor: '#00ff88',
      fontSizeTwips: 360
    }
  })
})


test('Gate 3 toolbar color picker keeps applying to the selection captured when the control was opened', async ({ page }) => {
  await page.goto('/')
  await waitForDemoReady(page)
  await page.getByRole('button', { name: '加载 Alpha 样例' }).click()
  await page.getByRole('button', { name: '选择首页片段' }).click()

  const textColorInput = page.locator('[data-jword-format-text-color]')
  const backgroundColorInput = page.locator('[data-jword-format-background-color]')

  await textColorInput.dispatchEvent('pointerdown')
  await textColorInput.dispatchEvent('mousedown')
  await collapseSelectionAtSecondParagraphStart(page)

  await applyColorValue(page, '[data-jword-format-text-color]', '#3366ff')

  expect(await readFirstRunStyle(page)).toMatchObject({
    color: '#3366ff'
  })
  expect(await readSecondParagraphFirstRunStyle(page)).not.toHaveProperty('color')
  await expect(textColorInput).toHaveValue('#3366ff')

  await selectFirstFragmentRange(page)
  await backgroundColorInput.dispatchEvent('pointerdown')
  await backgroundColorInput.dispatchEvent('mousedown')
  await collapseSelectionAtSecondParagraphStart(page)

  await applyColorValue(page, '[data-jword-format-background-color]', '#ff66cc')

  expect(await readFirstRunStyle(page)).toMatchObject({
    color: '#3366ff',
    backgroundColor: '#ff66cc'
  })
  expect(await readSecondParagraphFirstRunStyle(page)).not.toHaveProperty('backgroundColor')
  await expect(backgroundColorInput).toHaveValue('#ff66cc')
})


test('Gate 3 toolbar color picker accepts repeated palette and hue-strip changes without reverting to defaults', async ({ page }) => {
  await page.goto('/')
  await waitForDemoReady(page)
  await page.getByRole('button', { name: '加载 Alpha 样例' }).click()
  await page.getByRole('button', { name: '选择首页片段' }).click()

  await applyColorValue(page, '[data-jword-format-text-color]', '#3366ff')
  await applyColorValue(page, '[data-jword-format-text-color]', '#ff5500')
  await applyColorValue(page, '[data-jword-format-background-color]', '#99cc00')
  await applyColorValue(page, '[data-jword-format-background-color]', '#6633ff')

  expect(await readFirstRunStyle(page)).toMatchObject({
    color: '#ff5500',
    backgroundColor: '#6633ff'
  })
  await expect(page.locator('[data-jword-format-text-color]')).toHaveValue('#ff5500')
  await expect(page.locator('[data-jword-format-background-color]')).toHaveValue('#6633ff')
})


test('Gate 3 toolbar color picker keeps the same frozen selection across repeated native picker changes', async ({ page }) => {
  await page.goto('/')
  await waitForDemoReady(page)
  await page.getByRole('button', { name: '加载 Alpha 样例' }).click()
  await page.getByRole('button', { name: '选择首页片段' }).click()

  const textColorInput = page.locator('[data-jword-format-text-color]')
  const backgroundColorInput = page.locator('[data-jword-format-background-color]')

  await textColorInput.dispatchEvent('pointerdown')
  await textColorInput.dispatchEvent('mousedown')
  await collapseSelectionAtSecondParagraphStart(page)
  await finalizeColorValue(page, '[data-jword-format-text-color]', '#3366ff')
  await previewColorValue(page, '[data-jword-format-text-color]', '#ff5500')
  await page.locator('#jword-editor').click()

  expect(await readFirstRunStyle(page)).toMatchObject({
    color: '#ff5500'
  })
  expect(await readSecondParagraphFirstRunStyle(page)).not.toHaveProperty('color')
  await page.getByRole('button', { name: '选择首页片段' }).click()
  await expect(textColorInput).toHaveValue('#ff5500')

  await backgroundColorInput.dispatchEvent('pointerdown')
  await backgroundColorInput.dispatchEvent('mousedown')
  await collapseSelectionAtSecondParagraphStart(page)
  await finalizeColorValue(page, '[data-jword-format-background-color]', '#99cc00')
  await previewColorValue(page, '[data-jword-format-background-color]', '#6633ff')
  await page.locator('#jword-editor').click()

  expect(await readFirstRunStyle(page)).toMatchObject({
    color: '#ff5500',
    backgroundColor: '#6633ff'
  })
  expect(await readSecondParagraphFirstRunStyle(page)).not.toHaveProperty('backgroundColor')
  await page.getByRole('button', { name: '选择首页片段' }).click()
  await expect(backgroundColorInput).toHaveValue('#6633ff')
})

