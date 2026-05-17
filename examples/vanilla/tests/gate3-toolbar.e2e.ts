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

  await textColorInput.click()
  await collapseSelectionAtSecondParagraphStart(page)
  await expect(page.locator('[data-jword-selection-summary]')).toContainText('paragraph-2')

  await applyColorValue(page, '[data-jword-format-text-color]', '#3366ff')

  expect(await readFirstRunStyle(page)).toMatchObject({
    color: '#3366ff'
  })
  expect(await readSecondParagraphFirstRunStyle(page)).not.toHaveProperty('color')
  await expect(textColorInput).toHaveValue('#3366ff')
})

test('Gate 3 toolbar applies paragraph alignment and indent across a multi-paragraph selection', async ({ page }) => {
  await page.goto('/')
  await waitForDemoReady(page)
  await page.getByRole('button', { name: '加载 Alpha 样例' }).click()

  await selectFirstTwoParagraphs(page)

  const alignRightButton = page.locator('[data-jword-format-align-right]')
  const indentIncreaseButton = page.locator('[data-jword-format-indent-increase]')
  const runSummary = page.locator('[data-jword-run-summary]')

  await alignRightButton.click()
  await expect(alignRightButton).toHaveAttribute('aria-pressed', 'true')
  await expect(alignRightButton).toHaveAttribute('data-jword-state', 'value')
  await expect(runSummary).toContainText('对齐 right')
  expect(await readFirstTwoParagraphProperties(page)).toEqual([
    { alignment: 'right' },
    { alignment: 'right' }
  ])

  await indentIncreaseButton.click()
  await expect(runSummary).toContainText('缩进 36 pt')
  expect(await readFirstTwoParagraphProperties(page)).toEqual([
    { alignment: 'right', indentLeftTwips: 720 },
    { alignment: 'right', indentLeftTwips: 720 }
  ])
  expect(await readFirstLineGeometry(page)).toMatchObject({
    paragraphXGreaterThanContentLeft: true,
    lineRightMatchesContentRight: true
  })
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

async function readFirstLineGeometry(page: Page): Promise<{
  readonly paragraphXGreaterThanContentLeft: boolean
  readonly lineRightMatchesContentRight: boolean
}> {
  return page.evaluate(() => {
    const pageBox = window.__jwordDemo?.editor.getLayout().pages[0]
    const paragraph = pageBox?.paragraphs[0]
    const line = pageBox?.lines[0]

    if (pageBox === undefined || paragraph === undefined || line === undefined) {
      throw new Error('缺少首行布局几何')
    }

    return {
      paragraphXGreaterThanContentLeft: paragraph.x > pageBox.contentRect.x,
      lineRightMatchesContentRight: Math.abs((line.x + line.width) - (pageBox.contentRect.x + pageBox.contentRect.width)) < 1
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
    node.dispatchEvent(new Event('change', { bubbles: true }))
  }, value)
}

async function waitForDemoReady(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__jwordDemo !== undefined)
  await expect(page.locator('[data-jword-hidden-textarea]')).toHaveCount(1)
}
