/**
 * @fileoverview 职责: 用真实浏览器验证 Gate 3 工具栏的段落格式和纸张尺寸控制。
 * 边界: 不覆盖文字格式矩阵、插入工具或面板外观基线。
 * 协作: vanilla demo、工具栏 DOM、编辑器公开门面和共享工具栏测试辅助函数。
 * 约束: 断言必须来自真实 DOM、Canvas 输出和公开门面，不伪造布局结果。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

import {
  openToolbarSelectMenu,
  readFirstParagraphRenderProbe,
  readFirstTwoParagraphProperties,
  readFirstTwoParagraphRunLineHeights,
  readOfficialToolbar,
  readPagePresetProbe,
  readSelectedToolbarOption,
  selectDropdownOptionByMatcher,
  selectFirstTwoParagraphs,
  waitForDemoReady
} from './gate3-toolbar-helpers'

test.describe.configure({ mode: 'serial' })

test('Gate 3 toolbar paragraph alignment dropdown changes real line geometry', async ({ page }) => {
  await page.goto('/')
  await waitForDemoReady(page)
  await page.getByRole('button', { name: '加载 Alpha 样例' }).click()

  await selectFirstTwoParagraphs(page)

  const alignmentSelect = page.locator('[data-jword-paragraph-alignment]')
  const beforeProbe = await readFirstParagraphRenderProbe(page)

  await expect(alignmentSelect).toBeVisible()

  const selectedAlignment = await selectDropdownOptionByMatcher(page, '[data-jword-paragraph-alignment]', {
    exactValue: 'right',
    labelAllOf: ['右']
  })

  await expect(alignmentSelect).toHaveValue(selectedAlignment.value)
  await openToolbarSelectMenu(page, '[data-jword-paragraph-alignment]')
  await expect(readSelectedToolbarOption(page, '[data-jword-paragraph-alignment]')).resolves.toContain('右对齐')
  await expect.poll(() => readFirstTwoParagraphProperties(page)).toEqual([
    { alignment: 'right' },
    { alignment: 'right' }
  ])

  const afterProbe = await readFirstParagraphRenderProbe(page)

  expect(afterProbe.firstLineX).toBeGreaterThan(beforeProbe.firstLineX)
  expect(Math.abs(afterProbe.firstLineRight - afterProbe.contentRight)).toBeLessThan(1)
})


test('Gate 3 toolbar paragraph metric dropdowns update projection and layout geometry', async ({ page }) => {
  await page.goto('/')
  await waitForDemoReady(page)

  await selectPluginPagePreset(page, 'a5')
  await page.getByRole('button', { name: '加载 Alpha 样例' }).click()
  await selectFirstTwoParagraphs(page)

  const beforeProbe = await readFirstParagraphRenderProbe(page)
  const indentDecreaseButton = readOfficialToolbar(page).getByRole('button', { name: '减少缩进' })
  const indentIncreaseButton = readOfficialToolbar(page).getByRole('button', { name: '增加缩进' })

  expect(beforeProbe.lineCount).toBeGreaterThan(1)

  await expect(page.locator('[data-jword-paragraph-indent-left]')).toHaveCount(0)
  await expect(page.locator('[data-jword-paragraph-line-height]')).toBeVisible()
  await expect(page.locator('[data-jword-paragraph-spacing-before]')).toBeVisible()
  await expect(page.locator('[data-jword-paragraph-spacing-after]')).toBeVisible()
  await expect(page.locator('[data-jword-paragraph-first-line-indent]')).toBeVisible()
  await expect(page.locator('[data-jword-paragraph-hanging-indent]')).toBeVisible()

  await indentIncreaseButton.click()
  await indentIncreaseButton.click()
  await indentDecreaseButton.click()
  await selectDropdownOptionByMatcher(page, '[data-jword-paragraph-line-height]', {
    exactValue: '1.8',
    labelAllOf: ['1.8']
  })
  await selectDropdownOptionByMatcher(page, '[data-jword-paragraph-spacing-before]', {
    exactValue: '120',
    labelAllOf: ['6 pt']
  })
  await selectDropdownOptionByMatcher(page, '[data-jword-paragraph-spacing-after]', {
    exactValue: '240',
    labelAllOf: ['12 pt']
  })
  await selectDropdownOptionByMatcher(page, '[data-jword-paragraph-first-line-indent]', {
    exactValue: '360',
    labelAllOf: ['18 pt']
  })
  await selectDropdownOptionByMatcher(page, '[data-jword-paragraph-hanging-indent]', {
    exactValue: '480',
    labelAllOf: ['24 pt']
  })

  await openToolbarSelectMenu(page, '[data-jword-paragraph-line-height]')
  await expect(readSelectedToolbarOption(page, '[data-jword-paragraph-line-height]')).resolves.toContain('1.8')

  await expect.poll(() => readFirstTwoParagraphProperties(page)).toEqual([
    {
      indentLeftTwips: 360,
      spacingBeforeTwips: 120,
      spacingAfterTwips: 240,
      firstLineIndentTwips: 360,
      hangingIndentTwips: 480
    },
    {
      indentLeftTwips: 360,
      spacingBeforeTwips: 120,
      spacingAfterTwips: 240,
      firstLineIndentTwips: 360,
      hangingIndentTwips: 480
    }
  ])
  await expect.poll(() => readFirstTwoParagraphRunLineHeights(page)).toEqual([
    [1.8],
    [1.8]
  ])

  const afterProbe = await readFirstParagraphRenderProbe(page)

  expect(afterProbe.paragraphX - beforeProbe.paragraphX).toBe(360)
  expect(afterProbe.firstLineX - afterProbe.paragraphX).toBe(360)
  expect(afterProbe.secondLineX).not.toBeNull()
  expect((afterProbe.secondLineX ?? 0) - afterProbe.paragraphX).toBe(480)
  expect(afterProbe.firstLineHeight).toBeGreaterThan(beforeProbe.firstLineHeight)
  expect(afterProbe.paragraphY).toBeGreaterThan(beforeProbe.paragraphY)
  expect(afterProbe.firstParagraphTailGap).not.toBeNull()
  expect(beforeProbe.firstParagraphTailGap).not.toBeNull()
  expect((afterProbe.firstParagraphTailGap ?? 0) - (beforeProbe.firstParagraphTailGap ?? 0)).toBeGreaterThan(200)
})


test('Gate 3 toolbar paragraph style dropdown makes heading rendering visibly different', async ({ page }) => {
  await page.goto('/')
  await waitForDemoReady(page)
  await page.getByRole('button', { name: '加载 Alpha 样例' }).click()
  await page.getByRole('button', { name: '选择首页片段' }).click()

  const styleSelect = page.locator('[data-jword-paragraph-style]')
  const beforeProbe = await readFirstParagraphRenderProbe(page)

  await expect(styleSelect).toBeVisible()

  const selectedStyle = await selectDropdownOptionByMatcher(page, '[data-jword-paragraph-style]', {
    exactValue: 'Heading2',
    valueAllOf: ['heading', '2'],
    labelAllOf: ['标题', '2']
  })

  await expect(styleSelect).toHaveValue(selectedStyle.value)
  await openToolbarSelectMenu(page, '[data-jword-paragraph-style]')
  await expect(readSelectedToolbarOption(page, '[data-jword-paragraph-style]')).resolves.toContain('标题 2')

  await expect.poll(() => readFirstParagraphRenderProbe(page)).toMatchObject({
    paragraphStyleId: 'Heading2'
  })

  const afterProbe = await readFirstParagraphRenderProbe(page)
  const visibleHeadingDiffs = [
    afterProbe.firstFragmentStyle.fontSizePx !== beforeProbe.firstFragmentStyle.fontSizePx,
    afterProbe.firstFragmentStyle.fontFamily !== beforeProbe.firstFragmentStyle.fontFamily,
    afterProbe.firstFragmentStyle.bold !== beforeProbe.firstFragmentStyle.bold,
    afterProbe.firstLineHeight !== beforeProbe.firstLineHeight,
    afterProbe.firstLineCanvasChecksum !== beforeProbe.firstLineCanvasChecksum
  ].filter(Boolean)

  expect(visibleHeadingDiffs.length).toBeGreaterThan(0)
  expect(afterProbe.firstLineNonWhitePixels).toBeGreaterThan(0)
})


test('Gate 3 toolbar paragraph list dropdown renders ordered and bullet variants and can clear', async ({ page }) => {
  await page.goto('/')
  await waitForDemoReady(page)
  await page.getByRole('button', { name: '加载 Alpha 样例' }).click()
  await page.getByRole('button', { name: '选择首页片段' }).click()

  const listSelect = page.locator('[data-jword-paragraph-list]')
  const baselineProbe = await readFirstParagraphRenderProbe(page)

  await expect(listSelect).toBeVisible()

  const orderedOption = await selectDropdownOptionByMatcher(page, '[data-jword-paragraph-list]', {
    exactValue: 'ordered-l1',
    labelAllOf: ['编号', '1']
  })

  await expect(listSelect).toHaveValue(orderedOption.value)
  await openToolbarSelectMenu(page, '[data-jword-paragraph-list]')
  await expect(readSelectedToolbarOption(page, '[data-jword-paragraph-list]')).resolves.toContain('编号列表 1 级')

  await expect.poll(() => readFirstParagraphRenderProbe(page)).toMatchObject({
    paragraphList: {
      numberingId: 'jword-list-ordered',
      level: 1
    }
  })

  const orderedProbe = await readFirstParagraphRenderProbe(page)

  expect(orderedProbe.firstLineCanvasChecksum).not.toBe(baselineProbe.firstLineCanvasChecksum)
  expect(orderedProbe.firstLineNonWhitePixels).toBeGreaterThan(0)

  const bulletOption = await selectDropdownOptionByMatcher(page, '[data-jword-paragraph-list]', {
    exactValue: 'bullet-l2',
    labelAllOf: ['项目符号', '2']
  })

  await expect(listSelect).toHaveValue(bulletOption.value)
  await openToolbarSelectMenu(page, '[data-jword-paragraph-list]')
  await expect(readSelectedToolbarOption(page, '[data-jword-paragraph-list]')).resolves.toContain('项目符号列表 2 级')

  await expect.poll(() => readFirstParagraphRenderProbe(page)).toMatchObject({
    paragraphList: {
      numberingId: 'jword-list-bullet',
      level: 2
    }
  })

  const bulletProbe = await readFirstParagraphRenderProbe(page)

  expect(bulletProbe.firstLineCanvasChecksum).not.toBe(orderedProbe.firstLineCanvasChecksum)

  const clearedOption = await selectDropdownOptionByMatcher(page, '[data-jword-paragraph-list]', {
    exactValue: 'none',
    labelAllOf: ['无列表']
  })

  await expect(listSelect).toHaveValue(clearedOption.value)
  await openToolbarSelectMenu(page, '[data-jword-paragraph-list]')
  await expect(readSelectedToolbarOption(page, '[data-jword-paragraph-list]')).resolves.toContain('无列表')

  await expect.poll(() => readFirstParagraphRenderProbe(page)).toMatchObject({
    paragraphList: null
  })

  const clearedProbe = await readFirstParagraphRenderProbe(page)

  expect(clearedProbe.firstLineCanvasChecksum).toBe(baselineProbe.firstLineCanvasChecksum)
  expect(clearedProbe.firstLineX).toBe(baselineProbe.firstLineX)
})


test('Gate 3 toolbar switches paper size and updates real page geometry', async ({ page }) => {
  await page.goto('/')
  await waitForDemoReady(page)

  await selectPluginPagePreset(page, 'a5')

  const a5Probe = await readPagePresetProbe(page)

  await selectPluginPagePreset(page, 'a3')

  const a3Probe = await readPagePresetProbe(page)

  expect(a3Probe.pageWrapperWidthPx).toBeGreaterThan(a5Probe.pageWrapperWidthPx)
  expect(a3Probe.pageWrapperHeightPx).toBeGreaterThan(a5Probe.pageWrapperHeightPx)
  expect(a3Probe.firstPageLineCount).toBeLessThan(a5Probe.firstPageLineCount)
})

test('Gate 7 internal plugin page preset menu updates real page geometry', async ({ page }) => {
  await page.goto('/')
  await waitForDemoReady(page)

  const toolbar = readOfficialToolbar(page)
  const pluginMenu = toolbar.locator('[data-jword-plugin-menu-key="plugin:jword.ui:pagePreset"]')
  const trigger = pluginMenu.locator('.jw-toolbar__select-trigger')
  const a5 = pluginMenu.locator('[data-jword-plugin-menu-item-key="plugin:jword.ui:pagePreset:a5"]')
  const a3 = pluginMenu.locator('[data-jword-plugin-menu-item-key="plugin:jword.ui:pagePreset:a3"]')

  await expect(toolbar.locator('[data-jword-tool-id="document.pagePreset"]')).toHaveCount(0)
  await expect(pluginMenu).toBeVisible()
  await expect(trigger).toHaveAttribute('aria-expanded', 'false')

  await trigger.click()
  await expect(trigger).toHaveAttribute('aria-expanded', 'true')
  await expect(a5).toBeVisible()
  await a5.click()
  await expect.poll(() => readPagePresetProbe(page)).toMatchObject({
    preset: 'a5'
  })

  const a5Probe = await readPagePresetProbe(page)

  await trigger.click()
  await expect(a3).toBeVisible()
  await a3.click()
  await expect.poll(() => readPagePresetProbe(page)).toMatchObject({
    preset: 'a3'
  })

  const a3Probe = await readPagePresetProbe(page)
  const diagnostics = await page.evaluate(() => window.__jwordDemo?.editor.getPluginDiagnostics() ?? [])

  expect(a3Probe.pageWrapperWidthPx).toBeGreaterThan(a5Probe.pageWrapperWidthPx)
  expect(a3Probe.pageWrapperHeightPx).toBeGreaterThan(a5Probe.pageWrapperHeightPx)
  expect(a3Probe.firstPageLineCount).toBeLessThan(a5Probe.firstPageLineCount)
  expect(diagnostics).toEqual([])
})

test('Gate 7 plugin command error is isolated in real browser runtime', async ({ page }) => {
  await page.goto('/?pluginError=throwing-command')
  await waitForDemoReady(page)

  await page.evaluate(() => {
    window.__jwordDemo?.editor.executePluginCommand('demo.throwingPlugin.throw')
  })

  const diagnostics = await page.evaluate(() =>
    window.__jwordDemo?.editor.getPluginDiagnostics().map((diagnostic) => ({
      code: diagnostic.code,
      commandName: diagnostic.commandName,
      recoverable: diagnostic.recoverable
    })) ?? []
  )
  const toolbar = readOfficialToolbar(page)
  const pluginMenu = toolbar.locator('[data-jword-plugin-menu-key="plugin:jword.ui:pagePreset"]')
  const trigger = pluginMenu.locator('.jw-toolbar__select-trigger')
  const a5 = pluginMenu.locator('[data-jword-plugin-menu-item-key="plugin:jword.ui:pagePreset:a5"]')

  expect(diagnostics).toContainEqual({
    code: 'PLUGIN_CALLBACK_FAILED',
    commandName: 'demo.throwingPlugin.throw',
    recoverable: true
  })

  await trigger.click()
  await a5.click()
  await expect.poll(() => readPagePresetProbe(page)).toMatchObject({
    preset: 'a5'
  })
})

/** 通过当前 Gate 7 plugin 菜单选择纸张预设。 */
async function selectPluginPagePreset(page: Page, preset: 'a3' | 'a5'): Promise<void> {
  const toolbar = readOfficialToolbar(page)
  const pluginMenu = toolbar.locator('[data-jword-plugin-menu-key="plugin:jword.ui:pagePreset"]')
  const trigger = pluginMenu.locator('.jw-toolbar__select-trigger')
  const option = pluginMenu.locator(`[data-jword-plugin-menu-item-key="plugin:jword.ui:pagePreset:${preset}"]`)

  await expect(pluginMenu).toBeVisible()
  await trigger.click()
  await expect(option).toBeVisible()
  await option.click()
  await expect.poll(() => readPagePresetProbe(page)).toMatchObject({
    preset
  })
}
