/**
 * @fileoverview 职责: 用真实浏览器验证 Gate 3 vanilla demo 的 toolbar、选区状态同步、撤销重做和最小 a11y 支架。
 * 边界: 不覆盖 IME、键盘输入、剪贴板或 core 输入系统，只验证 examples/vanilla 能真实接通的 UI 闭环。
 * 协作: examples/vanilla/src/main.ts 的 demo 工具栏、window.__jwordDemo 测试钩子和 @4xian/jword-core Editor facade。
 * 约束: 断言必须来自真实 DOM 和公开 facade，不伪造尚未实现的 Gate 3 输入能力。
 * Specs: docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md Gate 3 Step 3.8、3.9、3.10、3.12。
 */
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import type { RangeRef } from '@4xian/jword-core'

interface ParagraphRenderProbe {
  readonly paragraphStyleId: string | null
  readonly paragraphList: {
    readonly numberingId: string
    readonly level: number
  } | null
  readonly contentLeft: number
  readonly contentRight: number
  readonly paragraphX: number
  readonly paragraphY: number
  readonly paragraphHeight: number
  readonly lineCount: number
  readonly firstLineX: number
  readonly firstLineRight: number
  readonly firstLineHeight: number
  readonly secondLineX: number | null
  readonly secondParagraphY: number | null
  readonly firstParagraphTailGap: number | null
  readonly firstLineCanvasChecksum: number
  readonly firstLineNonWhitePixels: number
  readonly firstFragmentStyle: {
    readonly fontFamily: string
    readonly fontSizePx: number
    readonly bold: boolean
    readonly lineHeight?: number
  }
}

interface SelectOptionMatcher {
  readonly exactValue?: string
  readonly valueAllOf?: readonly string[]
  readonly labelAllOf?: readonly string[]
}

test.describe.configure({ mode: 'serial' })

test('Gate 3 toolbar renders real controls and mirrors current selection state', async ({ page }) => {
  await page.goto('/')
  await waitForDemoReady(page)

  await expect(page.locator('[data-jword-toolbar]')).toBeVisible()
  await expect(page.getByRole('button', { name: '撤销' })).toBeDisabled()
  await expect(page.getByRole('button', { name: '重做' })).toBeDisabled()
  await expect(page.locator('[data-jword-selection-summary]')).toContainText('无选区')

  const mirrorLength = await page.evaluate(() =>
    document.querySelector<HTMLElement>('[data-jword-ui-text-mirror]')?.textContent?.length ?? 0
  )

  expect(mirrorLength).toBeGreaterThan(100)
  const textMirror = page.locator('[data-jword-ui-text-mirror="true"]')

  await expect(textMirror).toContainText('默认混排样例 2026')
  await expect(textMirror).toContainText('English text')
  await expect(textMirror).toContainText('13579')
  await expect(page.getByRole('button', { name: '选择首页片段' })).toBeEnabled()
  await expect(page.getByRole('button', { name: '减小字号' })).toBeVisible()
  await expect(page.getByRole('button', { name: '增大字号' })).toBeVisible()
  await expect(page.getByRole('button', { name: '减少缩进' })).toBeVisible()
  await expect(page.getByRole('button', { name: '增加缩进' })).toBeVisible()
  await expect(page.locator('[data-jword-paragraph-indent-left]')).toHaveCount(0)
  await expect.poll(() => readToolbarSelectTriggerIconCount(page, '[data-jword-paragraph-alignment]')).toBeGreaterThan(0)
  await expect.poll(() => readToolbarSelectTriggerIconCount(page, '[data-jword-paragraph-line-height]')).toBeGreaterThan(0)
  await expect.poll(() => readToolbarSelectTriggerIconCount(page, '[data-jword-paragraph-list]')).toBeGreaterThan(0)
  await expect.poll(() => readToolbarSelectFrameProbe(page, '[data-jword-format-font-family]')).toMatchObject({
    borderTopWidth: '1px',
    borderRightWidth: '1px'
  })
  await expect.poll(() => readToolbarSelectFrameProbe(page, '[data-jword-format-font-size]')).toMatchObject({
    borderTopWidth: '1px',
    borderRightWidth: '1px'
  })

  await page.getByRole('button', { name: '加载 Alpha 样例' }).click()
  await expect(page.getByRole('button', { name: '选择首页片段' })).toBeEnabled()

  await page.getByRole('button', { name: '选择首页片段' }).click()

  await expect(page.locator('[data-jword-selection-summary]')).toContainText('run-1')
  await expect(page.getByRole('button', { name: '加粗' })).toBeEnabled()
  await expect(page.getByRole('button', { name: '斜体' })).toBeEnabled()
  await expect(page.locator('[data-jword-live-region]')).toContainText('选区')
})

test('Gate 3 toolbar toggles current run bold and supports undo redo', async ({ page }) => {
  await page.goto('/')
  await waitForDemoReady(page)
  await page.getByRole('button', { name: '加载 Alpha 样例' }).click()
  await page.getByRole('button', { name: '选择首页片段' }).click()

  const boldButton = page.getByRole('button', { name: '加粗' })
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
  await expect(page.locator('[data-jword-selection-summary]')).toContainText('run-1')
  await expect(page.getByRole('button', { name: '加粗' })).toBeEnabled()

  await page.evaluate(() => {
    window.__jwordDemo?.editor.setSelection(null)
  })

  await expect(page.locator('[data-jword-selection-summary]')).toContainText('无选区')
  await expect(page.getByRole('button', { name: '加粗' })).toBeDisabled()
})

test('Gate 3 toolbar supports cross-run formatting through facade command builders', async ({ page }) => {
  await page.goto('/')
  await waitForDemoReady(page)
  await page.getByRole('button', { name: '加载 Alpha 样例' }).click()
  await page.getByRole('button', { name: '选择首页片段' }).click()
  await page.getByRole('button', { name: '加粗' }).click()

  await selectFirstParagraphAcrossRuns(page)

  const boldButton = page.getByRole('button', { name: '加粗' })
  const italicButton = page.getByRole('button', { name: '斜体' })

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

  const underlineButton = page.getByRole('button', { name: '下划线' })
  const strikeButton = page.getByRole('button', { name: '删除线' })
  const fontSizeDecreaseButton = page.getByRole('button', { name: '减小字号' })
  const fontSizeIncreaseButton = page.getByRole('button', { name: '增大字号' })
  const fontFamilySelect = page.locator('[data-jword-format-font-family]')
  const fontSizeSelect = page.locator('[data-jword-format-font-size]')
  const textColorInput = page.locator('[data-jword-format-text-color]')
  const backgroundColorInput = page.locator('[data-jword-format-background-color]')
  const runSummary = page.locator('[data-jword-run-summary]')

  await underlineButton.click()
  await expect(underlineButton).toHaveAttribute('aria-pressed', 'true')
  await expect(runSummary).toContainText('U 开')
  expect(await readFirstRunStyle(page)).toEqual({ underline: true })

  await strikeButton.click()
  await expect(strikeButton).toHaveAttribute('aria-pressed', 'true')
  await expect(runSummary).toContainText('S 开')
  expect(await readFirstRunStyle(page)).toEqual({
    underline: true,
    strike: true
  })

  await fontFamilySelect.selectOption('KaiTi')
  await expect(fontFamilySelect).toHaveValue('KaiTi')
  await expect(fontFamilySelect).toHaveAttribute('data-jword-state', 'value')
  await expect(runSummary).toContainText('字体 KaiTi')
  expect(await readFirstRunStyle(page)).toEqual({
    underline: true,
    strike: true,
    fontFamily: 'KaiTi'
  })

  await fontSizeSelect.selectOption('360')
  await expect(fontSizeSelect).toHaveValue('360')
  await expect(fontSizeSelect).toHaveAttribute('data-jword-state', 'value')
  await expect(runSummary).toContainText('字号 18 pt')
  expect(await readFirstRunStyle(page)).toEqual({
    underline: true,
    strike: true,
    fontFamily: 'KaiTi',
    fontSizeTwips: 360
  })

  await fontSizeDecreaseButton.click()
  await expect(runSummary).toContainText('字号 16 pt')
  expect(await readFirstRunStyle(page)).toEqual({
    underline: true,
    strike: true,
    fontFamily: 'KaiTi',
    fontSizeTwips: 320
  })

  await fontSizeIncreaseButton.click()
  await expect(runSummary).toContainText('字号 18 pt')
  expect(await readFirstRunStyle(page)).toEqual({
    underline: true,
    strike: true,
    fontFamily: 'KaiTi',
    fontSizeTwips: 360
  })

  await applyColorValue(page, '[data-jword-format-text-color]', '#ff0000')
  await expect(textColorInput).toHaveValue('#ff0000')
  await expect(textColorInput).toHaveAttribute('data-jword-state', 'value')
  await expect(runSummary).toContainText('字色 #ff0000')
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
  await expect(runSummary).toContainText('底色 #00ff88')
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

test('Gate 3 toolbar paragraph alignment dropdown changes real line geometry', async ({ page }) => {
  await page.goto('/')
  await waitForDemoReady(page)
  await page.getByRole('button', { name: '加载 Alpha 样例' }).click()

  await selectFirstTwoParagraphs(page)

  const alignmentSelect = page.locator('[data-jword-paragraph-alignment]')
  const runSummary = page.locator('[data-jword-run-summary]')
  const beforeProbe = await readFirstParagraphRenderProbe(page)

  await expect(alignmentSelect).toBeVisible()

  const selectedAlignment = await selectDropdownOptionByMatcher(page, '[data-jword-paragraph-alignment]', {
    exactValue: 'right',
    labelAllOf: ['右']
  })

  await expect(alignmentSelect).toHaveValue(selectedAlignment.value)
  await expect(runSummary).toContainText('对齐 右对齐')
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

  const paperPresetSelect = page.locator('[data-jword-page-preset]')

  await paperPresetSelect.selectOption('a5')
  await page.getByRole('button', { name: '加载 Alpha 样例' }).click()
  await selectFirstTwoParagraphs(page)

  const runSummary = page.locator('[data-jword-run-summary]')
  const beforeProbe = await readFirstParagraphRenderProbe(page)
  const indentDecreaseButton = page.getByRole('button', { name: '减少缩进' })
  const indentIncreaseButton = page.getByRole('button', { name: '增加缩进' })

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

  await expect(runSummary).toContainText('行距 1.8')
  await expect(runSummary).toContainText('左缩进 18 pt')
  await expect(runSummary).toContainText('段前 6 pt')
  await expect(runSummary).toContainText('段后 12 pt')
  await expect(runSummary).toContainText('首行 18 pt')
  await expect(runSummary).toContainText('悬挂 24 pt')
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
  const runSummary = page.locator('[data-jword-run-summary]')
  const beforeProbe = await readFirstParagraphRenderProbe(page)

  await expect(styleSelect).toBeVisible()

  const selectedStyle = await selectDropdownOptionByMatcher(page, '[data-jword-paragraph-style]', {
    exactValue: 'Heading2',
    valueAllOf: ['heading', '2'],
    labelAllOf: ['标题', '2']
  })

  await expect(styleSelect).toHaveValue(selectedStyle.value)
  await expect(runSummary).toContainText('样式 标题 2')
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
  const runSummary = page.locator('[data-jword-run-summary]')
  const baselineProbe = await readFirstParagraphRenderProbe(page)

  await expect(listSelect).toBeVisible()

  const orderedOption = await selectDropdownOptionByMatcher(page, '[data-jword-paragraph-list]', {
    exactValue: 'ordered-l1',
    labelAllOf: ['编号', '1']
  })

  await expect(listSelect).toHaveValue(orderedOption.value)
  await expect(runSummary).toContainText('列表 编号列表 / 1级')
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
  await expect(runSummary).toContainText('列表 项目符号列表 / 2级')
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

  const paperPresetSelect = page.locator('[data-jword-page-preset]')

  await expect(paperPresetSelect).toBeVisible()

  await paperPresetSelect.selectOption('a5')
  await expect.poll(() => readPagePresetProbe(page)).toMatchObject({
    preset: 'a5'
  })

  const a5Probe = await readPagePresetProbe(page)

  await paperPresetSelect.selectOption('a3')
  await expect.poll(() => readPagePresetProbe(page)).toMatchObject({
    preset: 'a3'
  })

  const a3Probe = await readPagePresetProbe(page)

  expect(a3Probe.pageWrapperWidthPx).toBeGreaterThan(a5Probe.pageWrapperWidthPx)
  expect(a3Probe.pageWrapperHeightPx).toBeGreaterThan(a5Probe.pageWrapperHeightPx)
  expect(a3Probe.firstPageLineCount).toBeLessThan(a5Probe.firstPageLineCount)
})

async function readFirstRunStyle(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => {
    const projection = window.__jwordDemo?.editor.getProjection()
    const firstBlock = projection?.document.sections[0]?.blocks[0]

    if (firstBlock === undefined || firstBlock.kind !== 'paragraph') {
      throw new Error('缺少首段')
    }

    return { ...(firstBlock.runs[0]?.properties ?? {}) }
  })
}

async function readFirstParagraphRunStyles(page: Page): Promise<readonly Record<string, unknown>[]> {
  return page.evaluate(() => {
    const projection = window.__jwordDemo?.editor.getProjection()
    const firstBlock = projection?.document.sections[0]?.blocks[0]

    if (firstBlock === undefined || firstBlock.kind !== 'paragraph') {
      throw new Error('缺少首段')
    }

    return firstBlock.runs.map((run) => ({ ...(run.properties ?? {}) }))
  })
}

async function readSecondParagraphFirstRunStyle(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => {
    const projection = window.__jwordDemo?.editor.getProjection()
    const secondBlock = projection?.document.sections[0]?.blocks[1]

    if (secondBlock === undefined || secondBlock.kind !== 'paragraph') {
      throw new Error('缺少第二段')
    }

    return { ...(secondBlock.runs[0]?.properties ?? {}) }
  })
}

async function readFirstTwoParagraphProperties(page: Page): Promise<readonly Record<string, unknown>[]> {
  return page.evaluate(() => {
    const projection = window.__jwordDemo?.editor.getProjection()
    const firstBlock = projection?.document.sections[0]?.blocks[0]
    const secondBlock = projection?.document.sections[0]?.blocks[1]

    if (
      firstBlock === undefined
      || firstBlock.kind !== 'paragraph'
      || secondBlock === undefined
      || secondBlock.kind !== 'paragraph'
    ) {
      throw new Error('缺少前两段')
    }

    return [
      { ...(firstBlock.properties ?? {}) },
      { ...(secondBlock.properties ?? {}) }
    ]
  })
}

async function readFirstTwoParagraphRunLineHeights(page: Page): Promise<readonly (readonly (number | null)[])[]> {
  return page.evaluate(() => {
    const projection = window.__jwordDemo?.editor.getProjection()
    const firstBlock = projection?.document.sections[0]?.blocks[0]
    const secondBlock = projection?.document.sections[0]?.blocks[1]

    if (
      firstBlock === undefined
      || firstBlock.kind !== 'paragraph'
      || secondBlock === undefined
      || secondBlock.kind !== 'paragraph'
    ) {
      throw new Error('缺少前两段行距 probe')
    }

    return [firstBlock, secondBlock].map((block) =>
      block.runs.map((run) => typeof run.properties?.lineHeight === 'number' ? run.properties.lineHeight : null)
    )
  })
}

async function readFirstRenderedFragment(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => {
    const fragment = window.__jwordDemo?.editor.getLayout().pages[0]?.lines[0]?.fragments[0]

    if (fragment === undefined) {
      throw new Error('缺少首个渲染片段')
    }

    return {
      text: fragment.text,
      style: { ...fragment.style }
    }
  })
}

async function readFirstParagraphRenderProbe(page: Page): Promise<ParagraphRenderProbe> {
  return page.evaluate(() => {
    const demo = window.__jwordDemo
    const projection = demo?.editor.getProjection()
    const pageBox = demo?.editor.getLayout().pages[0]
    const firstBlock = projection?.document.sections[0]?.blocks[0]
    const secondBlock = projection?.document.sections[0]?.blocks[1]
    const paragraph = firstBlock === undefined || pageBox === undefined
      ? undefined
      : pageBox.paragraphs.find((item) => item.paragraphId === firstBlock.id)
    const lines = firstBlock === undefined || pageBox === undefined
      ? []
      : pageBox.lines.filter((item) => item.paragraphId === firstBlock.id)
    const firstLine = lines[0]
    const secondLine = lines[1]
    const lastLine = lines[lines.length - 1]
    const firstFragment = firstLine?.fragments[0]
    const secondParagraph = secondBlock === undefined || pageBox === undefined
      ? undefined
      : pageBox.paragraphs.find((item) => item.paragraphId === secondBlock.id)
    const canvas = document.querySelector<HTMLCanvasElement>(`[data-jword-page="${pageBox?.pageIndex ?? 0}"] .jw-editor__page-canvas`)
    const context = canvas?.getContext('2d')

    if (
      demo === undefined
      || projection === undefined
      || firstBlock === undefined
      || firstBlock.kind !== 'paragraph'
      || pageBox === undefined
      || paragraph === undefined
      || firstLine === undefined
      || firstFragment === undefined
      || canvas === null
      || context === null
      || context === undefined
    ) {
      throw new Error('缺少首段渲染 probe')
    }

    const cropLeft = Math.max(0, Math.floor(((pageBox.contentRect.x - pageBox.x) * canvas.width) / pageBox.width))
    const cropRight = Math.min(
      canvas.width,
      Math.ceil((((pageBox.contentRect.x + pageBox.contentRect.width) - pageBox.x) * canvas.width) / pageBox.width)
    )
    const cropTop = Math.max(0, Math.floor(((firstLine.y - pageBox.y) * canvas.height) / pageBox.height))
    const cropBottom = Math.min(
      canvas.height,
      Math.ceil((((firstLine.y + firstLine.height) - pageBox.y) * canvas.height) / pageBox.height)
    )
    const image = context.getImageData(
      cropLeft,
      cropTop,
      Math.max(1, cropRight - cropLeft),
      Math.max(1, cropBottom - cropTop)
    ).data
    let firstLineCanvasChecksum = 0
    let firstLineNonWhitePixels = 0

    for (let index = 0; index < image.length; index += 4) {
      const red = image[index] ?? 0
      const green = image[index + 1] ?? 0
      const blue = image[index + 2] ?? 0
      const alpha = image[index + 3] ?? 0

      if (alpha === 0) {
        continue
      }

      if (red < 245 || green < 245 || blue < 245) {
        firstLineNonWhitePixels += 1
      }

      firstLineCanvasChecksum = (
        (firstLineCanvasChecksum * 131)
        + (red * 3)
        + (green * 5)
        + (blue * 7)
        + (alpha * 11)
      ) % 2147483647
    }

    return {
      paragraphStyleId: firstBlock.styleId ?? null,
      paragraphList: firstBlock.list ?? null,
      contentLeft: pageBox.contentRect.x,
      contentRight: pageBox.contentRect.x + pageBox.contentRect.width,
      paragraphX: paragraph.x,
      paragraphY: paragraph.y,
      paragraphHeight: paragraph.height,
      lineCount: lines.length,
      firstLineX: firstLine.x,
      firstLineRight: firstLine.x + firstLine.width,
      firstLineHeight: firstLine.height,
      secondLineX: secondLine?.x ?? null,
      secondParagraphY: secondParagraph?.y ?? null,
      firstParagraphTailGap: secondParagraph === undefined || lastLine === undefined
        ? null
        : secondParagraph.y - (lastLine.y + lastLine.height),
      firstLineCanvasChecksum,
      firstLineNonWhitePixels,
      firstFragmentStyle: {
        fontFamily: firstFragment.style.fontFamily,
        fontSizePx: firstFragment.style.fontSizePx,
        bold: firstFragment.style.bold === true,
        ...(firstFragment.style.lineHeight === undefined ? {} : { lineHeight: firstFragment.style.lineHeight })
      }
    }
  })
}

async function readPagePresetProbe(page: Page): Promise<{
  readonly preset: string
  readonly pageWrapperWidthPx: number
  readonly pageWrapperHeightPx: number
  readonly firstPageLineCount: number
}> {
  return page.evaluate(() => {
    const demo = window.__jwordDemo
    const pageConfig = demo?.editor.getPageConfig()
    const firstPage = demo?.editor.getLayout().pages[0]
    const pageWrapper = document.querySelector<HTMLElement>('[data-jword-page="0"]')

    if (demo === undefined || pageConfig === undefined || firstPage === undefined || pageWrapper === null) {
      throw new Error('缺少纸张尺寸 probe')
    }

    const rect = pageWrapper.getBoundingClientRect()

    return {
      preset: pageConfig.preset,
      pageWrapperWidthPx: rect.width,
      pageWrapperHeightPx: rect.height,
      firstPageLineCount: firstPage.lines.length
    }
  })
}

async function readToolbarHistoryProbe(page: Page): Promise<{
  readonly canUndo: boolean
  readonly canRedo: boolean
  readonly boldPressed: string | null
  readonly undoDisabled: boolean
  readonly redoDisabled: boolean
}> {
  return page.evaluate(() => {
    const demo = window.__jwordDemo
    const undoButton = document.querySelector<HTMLButtonElement>('[data-jword-history-undo]')
    const redoButton = document.querySelector<HTMLButtonElement>('[data-jword-history-redo]')
    const boldButton = document.querySelector<HTMLButtonElement>('[data-jword-format-bold]')

    if (demo === undefined || undoButton === null || redoButton === null || boldButton === null) {
      throw new Error('缺少 Gate 3 toolbar probe')
    }

    return {
      canUndo: demo.editor.canUndo(),
      canRedo: demo.editor.canRedo(),
      boldPressed: boldButton.getAttribute('aria-pressed'),
      undoDisabled: undoButton.disabled,
      redoDisabled: redoButton.disabled
    }
  })
}

async function selectDropdownOptionByMatcher(
  page: Page,
  selector: string,
  matcher: SelectOptionMatcher
): Promise<{
  readonly value: string
  readonly label: string
}> {
  return page.locator(selector).evaluate((element, input) => {
    if (!(element instanceof HTMLSelectElement)) {
      throw new Error(`${input.selector} 不是原生 select，当前无法用回归 helper 选择`)
    }

    const selectorLabel = input.selector
    const normalizedExactValue = input.exactValue
    const normalizedValueAllOf = input.valueAllOf?.map((value) => value.toLowerCase()) ?? []
    const normalizedLabelAllOf = input.labelAllOf?.map((value) => value.toLowerCase()) ?? []
    const options = Array.from(element.options).map((option) => ({
      value: option.value,
      label: option.label.trim(),
      normalizedValue: option.value.toLowerCase(),
      normalizedLabel: option.label.trim().toLowerCase()
    }))
    const matchesAll = (source: string, patterns: readonly string[]): boolean =>
      patterns.length > 0 && patterns.every((pattern) => source.includes(pattern))
    const matched = options.find((option) => {
      if (normalizedExactValue !== undefined && option.value === normalizedExactValue) {
        return true
      }

      return matchesAll(option.normalizedValue, normalizedValueAllOf)
        || matchesAll(option.normalizedLabel, normalizedLabelAllOf)
    })

    if (matched === undefined) {
      throw new Error(`${selectorLabel} 缺少匹配 option，现有值: ${options.map((option) => `${option.value}::${option.label}`).join(' | ')}`)
    }

    element.value = matched.value
    element.dispatchEvent(new Event('change', { bubbles: true }))

    return {
      value: matched.value,
      label: matched.label
    }
  }, {
    selector,
    ...matcher
  })
}

async function readToolbarSelectTriggerIconCount(page: Page, selector: string): Promise<number> {
  return page.locator(selector).evaluate((element, inputSelector) => {
    if (!(element instanceof HTMLSelectElement)) {
      throw new Error(`${inputSelector} 不是原生 select，当前无法读取 trigger 图标`)
    }

    return element.parentElement?.querySelectorAll('.jw-toolbar__select-trigger svg').length ?? 0
  }, selector)
}

async function readToolbarSelectFrameProbe(
  page: Page,
  selector: string
): Promise<{
  readonly borderTopWidth: string
  readonly borderRightWidth: string
  readonly borderRadius: string
}> {
  return page.locator(selector).evaluate((element, inputSelector) => {
    if (!(element instanceof HTMLSelectElement)) {
      throw new Error(`${inputSelector} 不是原生 select，当前无法读取框式样式`)
    }

    const wrapper = element.parentElement

    if (wrapper === null) {
      throw new Error(`${inputSelector} 缺少 wrapper`)
    }

    const style = window.getComputedStyle(wrapper)

    return {
      borderTopWidth: style.borderTopWidth,
      borderRightWidth: style.borderRightWidth,
      borderRadius: style.borderRadius
    }
  }, selector)
}

async function openToolbarSelectMenu(page: Page, selector: string): Promise<void> {
  await page.locator(selector).evaluate((element, inputSelector) => {
    if (!(element instanceof HTMLSelectElement)) {
      throw new Error(`${inputSelector} 不是原生 select，当前无法打开 trigger`)
    }

    const trigger = element.parentElement?.querySelector<HTMLButtonElement>('.jw-toolbar__select-trigger')

    if (trigger === null || trigger === undefined) {
      throw new Error(`${inputSelector} 缺少 trigger 节点`)
    }

    trigger.click()
  }, selector)
}

async function readSelectedToolbarOption(page: Page, selector: string): Promise<string> {
  return page.locator(selector).evaluate((element, inputSelector) => {
    if (!(element instanceof HTMLSelectElement)) {
      throw new Error(`${inputSelector} 不是原生 select，当前无法读取菜单选中项`)
    }

    const selectedOption = element.parentElement?.querySelector<HTMLElement>(
      '.jw-toolbar__select-option[data-jword-selected="true"]'
    )
    const check = selectedOption?.querySelector<HTMLElement>('[data-jword-option-check="true"]')

    if (selectedOption === null || selectedOption === undefined) {
      throw new Error(`${inputSelector} 缺少选中项`)
    }

    if (check === null || check === undefined) {
      throw new Error(`${inputSelector} 缺少选中对号节点`)
    }

    return selectedOption.textContent?.trim() ?? ''
  }, selector)
}

async function selectFirstFragmentRange(page: Page): Promise<void> {
  await page.evaluate(() => {
    const demo = window.__jwordDemo

    if (demo === undefined) {
      throw new Error('缺少 Gate 3 demo 测试钩子')
    }

    const firstPage = demo.editor.getLayout().pages[0]
    const firstLine = firstPage?.lines.find((line) => line.fragments.length > 0)
    const firstFragment = firstLine?.fragments[0]

    if (firstFragment === undefined) {
      throw new Error('缺少首个文本片段')
    }

    demo.selectTextRange({
      sectionId: firstFragment.sectionId,
      blockId: firstFragment.blockId,
      runId: firstFragment.runId,
      anchorGraphemeIndex: firstFragment.start.graphemeIndex,
      focusGraphemeIndex: Math.min(firstFragment.end.graphemeIndex, firstFragment.start.graphemeIndex + 4)
    })
  })
}

async function selectFirstParagraphAcrossRuns(page: Page): Promise<void> {
  await page.evaluate(() => {
    const demo = window.__jwordDemo

    if (demo === undefined) {
      throw new Error('缺少 Gate 3 demo 测试钩子')
    }

    const projection = demo.editor.getProjection()
    const firstBlock = projection.document.sections[0]?.blocks[0]

    if (firstBlock === undefined || firstBlock.kind !== 'paragraph' || firstBlock.runs.length < 2) {
      throw new Error('首段还没有被切成多 run')
    }

    const firstRun = firstBlock.runs[0]
    const lastRun = firstBlock.runs[1]

    if (firstRun === undefined || lastRun === undefined) {
      throw new Error('缺少跨 run 选区目标')
    }

    const readRunLength = (run: typeof firstRun): number =>
      run.inlines.flatMap((inline) => inline.kind === 'text' ? Array.from(inline.text) : []).length

    const anchor = demo.editor.createTextAnchor({
      sectionId: 'section-1',
      blockId: 'paragraph-1',
      runId: firstRun.id,
      graphemeIndex: 0
    })
    const focus = demo.editor.createTextAnchor({
      sectionId: 'section-1',
      blockId: 'paragraph-1',
      runId: lastRun.id,
      graphemeIndex: readRunLength(lastRun)
    })

    demo.editor.setSelection({
      anchor,
      focus,
      range: Object.freeze({ anchor, focus }) as RangeRef,
      direction: 'forward',
      affinity: 'none'
    })
  })
}

async function selectFirstTwoParagraphs(page: Page): Promise<void> {
  await page.evaluate(() => {
    const demo = window.__jwordDemo

    if (demo === undefined) {
      throw new Error('缺少 Gate 3 demo 测试钩子')
    }

    const projection = demo.editor.getProjection()
    const firstBlock = projection.document.sections[0]?.blocks[0]
    const secondBlock = projection.document.sections[0]?.blocks[1]

    if (
      firstBlock === undefined
      || firstBlock.kind !== 'paragraph'
      || secondBlock === undefined
      || secondBlock.kind !== 'paragraph'
      || firstBlock.runs.length === 0
      || secondBlock.runs.length === 0
    ) {
      throw new Error('缺少跨段格式测试目标')
    }

    const firstRun = firstBlock.runs[0]
    const lastRun = secondBlock.runs[secondBlock.runs.length - 1]

    if (firstRun === undefined || lastRun === undefined) {
      throw new Error('缺少跨段选区目标')
    }

    const readRunLength = (run: typeof firstRun): number =>
      run.inlines.flatMap((inline) => inline.kind === 'text' ? Array.from(inline.text) : []).length

    const anchor = demo.editor.createTextAnchor({
      sectionId: projection.document.sections[0]?.id ?? 'section-1',
      blockId: firstBlock.id,
      runId: firstRun.id,
      graphemeIndex: 0
    })
    const focus = demo.editor.createTextAnchor({
      sectionId: projection.document.sections[0]?.id ?? 'section-1',
      blockId: secondBlock.id,
      runId: lastRun.id,
      graphemeIndex: readRunLength(lastRun)
    })

    demo.editor.setSelection({
      anchor,
      focus,
      range: Object.freeze({ anchor, focus }) as RangeRef,
      direction: 'forward',
      affinity: 'none'
    })
  })
}

async function collapseSelectionAtSecondParagraphStart(page: Page): Promise<void> {
  await page.evaluate(() => {
    const demo = window.__jwordDemo

    if (demo === undefined) {
      throw new Error('缺少 Gate 3 demo 测试钩子')
    }

    const projection = demo.editor.getProjection()
    const secondBlock = projection.document.sections[0]?.blocks[1]
    const firstRun = secondBlock?.kind === 'paragraph' ? secondBlock.runs[0] : undefined

    if (secondBlock === undefined || secondBlock.kind !== 'paragraph' || firstRun === undefined) {
      throw new Error('缺少第二段折叠选区目标')
    }

    const anchor = demo.editor.createTextAnchor({
      sectionId: projection.document.sections[0]?.id ?? 'section-1',
      blockId: secondBlock.id,
      runId: firstRun.id,
      graphemeIndex: 0
    })

    demo.editor.setSelection({
      anchor,
      focus: anchor,
      range: Object.freeze({ anchor, focus: anchor }) as RangeRef,
      direction: 'none',
      affinity: 'none'
    })
  })
}

async function applyColorValue(page: Page, selector: string, value: string): Promise<void> {
  await page.locator(selector).evaluate((input, nextValue) => {
    const node = input as HTMLInputElement

    node.value = nextValue as string
    node.dispatchEvent(new Event('input', { bubbles: true }))
    node.dispatchEvent(new Event('change', { bubbles: true }))
  }, value)
}

async function waitForDemoReady(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__jwordDemo !== undefined)
  await expect(page.locator('[data-jword-hidden-textarea]')).toHaveCount(1)
}
