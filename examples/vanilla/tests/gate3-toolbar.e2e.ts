/**
 * @fileoverview 职责: 用真实浏览器验证 Gate 3 vanilla demo 的 toolbar、选区状态同步、撤销重做和最小 a11y 支架。
 * 边界: 不覆盖 IME、键盘输入、剪贴板或 core 输入系统，只验证 examples/vanilla 能真实接通的 UI 闭环。
 * 协作: examples/vanilla/src/main.ts 的 demo 工具栏、window.__jwordDemo 测试钩子和 @4xian/jword-core Editor facade。
 * 约束: 断言必须来自真实 DOM 和公开 facade，不伪造尚未实现的 Gate 3 输入能力。
 * Specs: docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md Gate 3 Step 3.8、3.9、3.10、3.12。
 */
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

test.describe.configure({ mode: 'serial' })

test('Gate 3 toolbar renders real controls and mirrors current selection state', async ({ page }) => {
  await page.goto('/')
  await waitForDemoReady(page)

  await expect(page.locator('[data-jword-toolbar]')).toBeVisible()
  await expect(page.getByRole('button', { name: '撤销' })).toBeDisabled()
  await expect(page.getByRole('button', { name: '重做' })).toBeDisabled()
  await expect(page.locator('[data-jword-selection-summary]')).toContainText('无选区')

  const mirrorLength = await page.evaluate(() =>
    document.querySelector<HTMLElement>('[data-jword-text-mirror]')?.textContent?.length ?? 0
  )

  expect(mirrorLength).toBeGreaterThan(100)
  await expect(page.getByRole('button', { name: '选择首页片段' })).toBeDisabled()

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
    const readRunLength = (run: typeof firstRun): number =>
      run.inlines.flatMap((inline) => inline.kind === 'text' ? Array.from(inline.text) : []).length

    if (firstRun === undefined || lastRun === undefined) {
      throw new Error('缺少跨 run 选区目标')
    }

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
      range: { anchor, focus },
      direction: 'forward',
      affinity: 'none'
    })
  })
}

async function waitForDemoReady(page: Page): Promise<void> {
  await expect(page.locator('[data-jword-canvas-container]')).toHaveAttribute('data-jword-page-count', '50')
  await page.waitForFunction(() => window.__jwordDemo !== undefined)
}
