/**
 * @fileoverview 职责: 用真实浏览器事件链覆盖 Gate 3 输入阶段的隐藏输入框、键盘命令、纯文本剪贴板和输入法合成回归。
 * 边界: 不声称验证原生平台输入法；这里只验证当前宿主浏览器里 editor runtime 已接通的 DOM 事件与公开 facade 闭环。
 * 协作: `window.__jwordDemo`、隐藏输入框测试钩子、Alpha 样例和 `@4xian/jword-core` 的 Editor facade。
 * 约束: 断言必须来自真实浏览器 DOM/canvas/公开 facade，不伪造 Windows 中文输入已完成。
 * Specs: docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md Gate 3 Step 3.12。
 */
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import type { RangeRef } from '@4xian/jword-core'

interface ResolvedSelectionSnapshot {
  readonly summary: string
  readonly range: Readonly<{
    readonly startGraphemeIndex: number
    readonly endGraphemeIndex: number
  }> | null
}

interface LargeFixtureLongDragPlan {
  readonly pageIndex: number
  readonly startGraphemeIndex: number
  readonly endGraphemeIndex: number
  readonly stepCount: number
}

interface LargeFixtureDoubleClickPlan {
  readonly pageIndex: number
  readonly targetGraphemeIndex: number
}

interface AlphaChineseDoubleClickTarget {
  readonly clientX: number
  readonly clientY: number
  readonly expectedStartGraphemeIndex: number
  readonly expectedEndGraphemeIndex: number
}

interface SelectionVisualProbe {
  readonly selectionPixels: number
}

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

test('Gate 3 runtime copy cut paste keeps plain text clipboard semantics on current selection', async ({ page }) => {
  await page.goto('/?fixture=gate2')
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

test('Gate 3 runtime pointer selection supports click drag and double click on the real canvas', async ({ page }) => {
  await page.goto('/?fixture=gate2')
  await waitForGate3AlphaReady(page)

  const clickPoint = await readClientPointForGrapheme(page, 1)

  await page.mouse.click(clickPoint.clientX, clickPoint.clientY)
  await expect.poll(() => readSelectionSummary(page)).toContain('1→1')

  const dragStart = await readClientPointForGrapheme(page, 1)
  const dragEnd = await readClientPointForGrapheme(page, 5)

  await page.mouse.move(dragStart.clientX, dragStart.clientY)
  await page.mouse.down()
  await page.mouse.move(dragEnd.clientX, dragEnd.clientY, { steps: 8 })
  await expect.poll(async () => {
    const probe = await readSelectionVisualProbe(page, 0)

    return probe.selectionPixels
  }).toBeGreaterThan(20)
  await page.mouse.up()
  await expect.poll(async () => {
    const snapshot = await readResolvedSelectionSnapshot(page)

    return snapshot.range
  }).toMatchObject({
    startGraphemeIndex: 1,
    endGraphemeIndex: 5
  })
  await expect.poll(() => readCanvasCursor(page, 0)).toBe('text')

  const wordPoint = await readClientPointForGrapheme(page, 2)

  await page.mouse.dblclick(wordPoint.clientX, wordPoint.clientY)
  await expect.poll(() => readSelectionSummary(page)).toContain('0→5')

  const secondWordPoint = await readClientPointForGrapheme(page, 7)

  await page.mouse.dblclick(secondWordPoint.clientX, secondWordPoint.clientY)
  await expect.poll(() => readSelectionSummary(page)).toContain('6→13')
})

test('Gate 3 runtime double click keeps Chinese selection local to the hit grapheme on the real canvas', async ({ page }) => {
  await page.goto('/')
  await waitForGate3AlphaReady(page)

  const chineseTarget = await readAlphaChineseDoubleClickTarget(page)

  await page.mouse.dblclick(chineseTarget.clientX, chineseTarget.clientY)

  await expect.poll(async () => {
    const snapshot = await readResolvedSelectionSnapshot(page)

    return snapshot.range
  }).toEqual({
    startGraphemeIndex: chineseTarget.expectedStartGraphemeIndex,
    endGraphemeIndex: chineseTarget.expectedEndGraphemeIndex
  })
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

test('Gate 3 large-fixture pointer double click keeps responding after a collapsed canvas selection', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', '当前大夹具双击回归只固定 Chromium。')

  await page.goto('/?fixture=gate2')
  await waitForGate3LargeFixtureReady(page)

  const doubleClickPlan = await readLargeFixtureDoubleClickPlan(page)
  const wordPoint = await readClientPointForGrapheme(
    page,
    doubleClickPlan.targetGraphemeIndex,
    doubleClickPlan.pageIndex
  )

  await runPromiseWithTimeout({
    label: '单击大夹具命中点建立折叠选区',
    promise: page.mouse.click(wordPoint.clientX, wordPoint.clientY),
    timeoutMs: 700
  })

  const collapsedSnapshot = await readResolvedSelectionSnapshot(page)

  if (collapsedSnapshot.range === null) {
    throw new Error(`大夹具单击后没有折叠选区。摘要=${collapsedSnapshot.summary}`)
  }

  expect(collapsedSnapshot.range.startGraphemeIndex).toBe(doubleClickPlan.targetGraphemeIndex)
  expect(collapsedSnapshot.range.endGraphemeIndex).toBe(doubleClickPlan.targetGraphemeIndex)

  await runPromiseWithTimeout({
    label: '在已有折叠选区后双击大夹具命中点',
    promise: page.mouse.dblclick(wordPoint.clientX, wordPoint.clientY),
    timeoutMs: 700,
    diagnostics: `单击后选区摘要=${collapsedSnapshot.summary}`,
    onTimeout: () => page.close()
  })

  const expandedSnapshot = await runPromiseWithTimeout({
    label: '读取大夹具双击后的选区快照',
    promise: readResolvedSelectionSnapshot(page),
    timeoutMs: 700
  })

  if (expandedSnapshot.range === null) {
    throw new Error(`大夹具双击后没有选区。摘要=${expandedSnapshot.summary}`)
  }

  expect(expandedSnapshot.range.startGraphemeIndex).toBeLessThanOrEqual(doubleClickPlan.targetGraphemeIndex)
  expect(expandedSnapshot.range.endGraphemeIndex).toBeGreaterThan(doubleClickPlan.targetGraphemeIndex)
})

test('Gate 3 large-fixture pointer drag keeps responding while mouse is held and paints the final selection', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', '当前长拖拽回归只固定 Chromium。')

  await page.goto('/?fixture=gate2')
  await waitForGate3LargeFixtureReady(page)

  const dragPlan = await readLargeFixtureLongDragPlan(page)
  const dragStart = await readClientPointForGrapheme(page, dragPlan.startGraphemeIndex, dragPlan.pageIndex)
  const dragEnd = await readClientPointForGrapheme(page, dragPlan.endGraphemeIndex, dragPlan.pageIndex)

  await runPromiseWithTimeout({
    label: '定位到大夹具长拖起点',
    promise: page.mouse.move(dragStart.clientX, dragStart.clientY),
    timeoutMs: 700
  })
  await runPromiseWithTimeout({
    label: '按下鼠标左键开始大夹具长拖',
    promise: page.mouse.down(),
    timeoutMs: 700
  })

  let lastSummary = await readSelectionSummary(page)
  let maxResolvedEnd = dragPlan.startGraphemeIndex
  let progressStepCount = 0

  for (let step = 1; step <= dragPlan.stepCount; step += 1) {
    const nextClientX = dragStart.clientX + ((dragEnd.clientX - dragStart.clientX) * step) / dragPlan.stepCount
    const nextClientY = dragStart.clientY + ((dragEnd.clientY - dragStart.clientY) * step) / dragPlan.stepCount

    await runPromiseWithTimeout({
      label: `大夹具长拖第 ${step}/${dragPlan.stepCount} 步的 pointer move`,
      promise: page.mouse.move(nextClientX, nextClientY),
      timeoutMs: 700,
      diagnostics: `上一步选区摘要=${lastSummary}`
    })

    const snapshot = await runPromiseWithTimeout({
      label: `大夹具长拖第 ${step}/${dragPlan.stepCount} 步后的选区快照`,
      promise: readResolvedSelectionSnapshot(page),
      timeoutMs: 700,
      diagnostics: `目标终点 grapheme=${dragPlan.endGraphemeIndex}`
    })

    lastSummary = snapshot.summary

    if (snapshot.range === null) {
      throw new Error(`大夹具长拖第 ${step}/${dragPlan.stepCount} 步后仍然没有选区。摘要=${snapshot.summary}`)
    }

    if (snapshot.range.startGraphemeIndex !== dragPlan.startGraphemeIndex) {
      throw new Error(
        `大夹具长拖第 ${step}/${dragPlan.stepCount} 步后选区起点漂移到了 ${snapshot.range.startGraphemeIndex}。摘要=${snapshot.summary}`
      )
    }

    if (snapshot.range.endGraphemeIndex < maxResolvedEnd) {
      throw new Error(
        `大夹具长拖第 ${step}/${dragPlan.stepCount} 步后选区终点回退到了 ${snapshot.range.endGraphemeIndex}。摘要=${snapshot.summary}`
      )
    }

    if (snapshot.range.endGraphemeIndex > maxResolvedEnd) {
      maxResolvedEnd = snapshot.range.endGraphemeIndex
      progressStepCount += 1
    }
  }

  await runPromiseWithTimeout({
    label: '释放大夹具长拖的鼠标左键',
    promise: page.mouse.up(),
    timeoutMs: 700,
    diagnostics: `释放前选区摘要=${lastSummary}`
  })

  const finalSnapshot = await readResolvedSelectionSnapshot(page)

  if (finalSnapshot.range === null) {
    throw new Error(`大夹具长拖释放鼠标后没有最终选区。摘要=${finalSnapshot.summary}`)
  }

  expect(finalSnapshot.range.startGraphemeIndex).toBe(dragPlan.startGraphemeIndex)
  expect(finalSnapshot.range.endGraphemeIndex).toBeGreaterThanOrEqual(dragPlan.endGraphemeIndex - 2)
  expect(progressStepCount).toBeGreaterThanOrEqual(4)

  const visualProbe = await readSelectionVisualProbe(page, dragPlan.pageIndex)
  expect(visualProbe.selectionPixels).toBeGreaterThan(20)
})

test('Gate 3 runtime composition chain defers insertion until compositionend and keeps plain text result', async ({ page }) => {
  await page.goto('/')
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
  expect(compositionProbe.selectionSummary).toContain('2→2')
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

async function waitForGate3AlphaReady(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__jwordDemo !== undefined)
  await expect(page.locator('[data-jword-hidden-textarea]')).toHaveCount(1)
  await page.getByRole('button', { name: '加载 Alpha 样例' }).click()
  await expect(page.locator('[data-jword-canvas-container]')).toHaveAttribute('data-jword-page-count', '1')
  await expect(page.getByRole('button', { name: '选择首页片段' })).toBeEnabled()
}

async function waitForGate3LargeFixtureReady(page: Page): Promise<void> {
  await expect(page.locator('[data-jword-canvas-container]')).toHaveAttribute('data-jword-page-count', '50')
  await page.waitForFunction(() => window.__jwordDemo !== undefined)
  await expect(page.locator('[data-jword-hidden-textarea]')).toHaveCount(1)
  await expect.poll(async () => {
    return page.evaluate(() => document.querySelectorAll('.jw-editor__page-canvas').length)
  }).toBeGreaterThan(0)
}

async function readPlainText(page: Page): Promise<string> {
  return page.evaluate(() => {
    return document.querySelector<HTMLElement>('[data-jword-ui-text-mirror]')?.textContent ?? ''
  })
}

async function readSelectionSummary(page: Page): Promise<string> {
  return page.evaluate(() => {
    return document.querySelector<HTMLElement>('[data-jword-selection-summary]')?.textContent ?? ''
  })
}

async function readParagraphCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    return window.__jwordDemo?.editor.getProjection().document.sections[0]?.blocks.length ?? 0
  })
}

async function readLongEnglishCaretProbe(
  page: Page,
  longEnglish: string
): Promise<Readonly<{
  readonly caretDeltaCssPx: number
  readonly hitGraphemeIndexAtRenderedEnd: number | undefined
}>> {
  return page.evaluate((text) => {
    const demo = window.__jwordDemo
    const selection = demo?.editor.getSelection()
    const layout = demo?.editor.getLayout()
    const pageBox = layout?.pages[0]
    const firstLine = pageBox?.lines[0]
    const firstFragment = firstLine?.fragments[0]
    const canvas = document.querySelector<HTMLCanvasElement>('[data-jword-page="0"] .jw-editor__page-canvas')
    const pageElement = document.querySelector<HTMLElement>('[data-jword-page="0"]')

    if (
      demo === undefined
      || selection === undefined
      || pageBox === undefined
      || firstFragment === undefined
      || firstLine === undefined
      || canvas === null
      || pageElement === null
      || selection === null
    ) {
      throw new Error('缺少长英文 caret 回归所需的布局或 DOM')
    }

    const caretRect = demo.editor.getCaretRect(selection.focus)
    const context = canvas.getContext('2d')

    if (caretRect === undefined || context === null) {
      throw new Error('无法读取长英文 caret 或 canvas context')
    }

    context.font = `${firstFragment.style.fontSizePx}px ${firstFragment.style.fontFamily}`

    const renderedTextWidthCssPx = context.measureText(text).width
    const pageRect = pageElement.getBoundingClientRect()
    const twipsPerCssPx = pageBox.width / pageRect.width
    const renderedEndX = firstFragment.x + renderedTextWidthCssPx * twipsPerCssPx
    const hit = demo.editor.hitTest({
      pageIndex: pageBox.pageIndex,
      x: renderedEndX - pageBox.x,
      y: firstLine.y - pageBox.y + firstLine.height * 0.5
    })

    return {
      caretDeltaCssPx: Math.abs(caretRect.x - renderedEndX) / twipsPerCssPx,
      hitGraphemeIndexAtRenderedEnd: hit === undefined
        ? undefined
        : demo.editor.resolveTextPosition(hit).graphemeIndex
    }
  }, longEnglish)
}

async function readClientPointForGrapheme(
  page: Page,
  graphemeIndex: number,
  pageIndex = 0
): Promise<Readonly<{
  clientX: number
  clientY: number
}>> {
  return page.evaluate(({ targetGraphemeIndex, targetPageIndex }) => {
    const demo = window.__jwordDemo
    const layout = demo?.editor.getLayout()
    const pageBox = layout?.pages[targetPageIndex]
    const wrapper = document.querySelector<HTMLElement>(`[data-jword-page="${targetPageIndex}"]`)

    if (demo === undefined || pageBox === undefined || wrapper === null) {
      throw new Error('缺少 Gate 3 pointer probe 所需的布局或 DOM')
    }

    const rect = wrapper.getBoundingClientRect()
    const scaleX = rect.width / pageBox.width
    const scaleY = rect.height / pageBox.height
    const resolveRoundedClientPoint = (
      pageIndex: number,
      localX: number,
      localY: number
    ): Readonly<{
      clientX: number
      clientY: number
    }> | null => {
      const roundedClientY = Math.round(rect.top + localY * scaleY)

      for (let deltaX = -3; deltaX <= 3; deltaX += 1) {
        const roundedClientX = Math.round(rect.left + (localX + deltaX) * scaleX)
        const anchor = demo.editor.hitTest({
          pageIndex,
          x: (roundedClientX - rect.left) / scaleX,
          y: (roundedClientY - rect.top) / scaleY
        })

        if (anchor === undefined) {
          continue
        }

        if (demo.editor.resolveTextPosition(anchor).graphemeIndex === targetGraphemeIndex) {
          return {
            clientX: roundedClientX,
            clientY: roundedClientY
          }
        }
      }

      return null
    }
    const fragmentMatches = pageBox.lines.flatMap((line) =>
      line.fragments.map((fragment) => ({
        line,
        fragment
      }))
    )
    const containingFragmentMatch = fragmentMatches.find(({ fragment }) => {
      return targetGraphemeIndex >= fragment.start.graphemeIndex
        && targetGraphemeIndex <= fragment.end.graphemeIndex
    })

    if (containingFragmentMatch !== undefined) {
      const { line, fragment } = containingFragmentMatch
      const graphemeOffset = targetGraphemeIndex - fragment.start.graphemeIndex
      const targetAdvance = fragment.advanceTwips[graphemeOffset] ?? fragment.width
      const previousAdvance = fragment.advanceTwips[Math.max(0, graphemeOffset - 1)] ?? 0
      const nextAdvance = fragment.advanceTwips[Math.min(fragment.advanceTwips.length - 1, graphemeOffset + 1)]
        ?? fragment.width
      const lowerBound = graphemeOffset <= 0
        ? 0
        : previousAdvance + ((targetAdvance - previousAdvance) / 2)
      const upperBound = graphemeOffset >= fragment.advanceTwips.length - 1
        ? fragment.width
        : targetAdvance + ((nextAdvance - targetAdvance) / 2)
      const targetOffset = lowerBound + ((upperBound - lowerBound) / 2)
      const safePoint = resolveRoundedClientPoint(
        pageBox.pageIndex,
        fragment.x - pageBox.x + targetOffset,
        line.y - pageBox.y + line.height * 0.5
      )

      if (safePoint !== null) {
        return safePoint
      }
    }

    const leadingFragmentMatch = fragmentMatches.find(({ fragment }) => {
      return fragment.start.graphemeIndex === targetGraphemeIndex
    })

    if (leadingFragmentMatch !== undefined) {
      const safePoint = resolveRoundedClientPoint(
        pageBox.pageIndex,
        leadingFragmentMatch.fragment.x - pageBox.x + leadingFragmentMatch.fragment.width * 0.25,
        leadingFragmentMatch.line.y - pageBox.y + leadingFragmentMatch.line.height * 0.5
      )

      if (safePoint !== null) {
        return safePoint
      }
    }

    throw new Error(`找不到 grapheme ${targetGraphemeIndex} 的浏览器命中点`)
  }, {
    targetGraphemeIndex: graphemeIndex,
    targetPageIndex: pageIndex
  })
}

async function readClientPointForPageWhitespace(
  page: Page,
  pageIndex: number
): Promise<Readonly<{
  clientX: number
  clientY: number
}>> {
  return page.evaluate((targetPageIndex) => {
    const demo = window.__jwordDemo
    const pageBox = demo?.editor.getLayout().pages[targetPageIndex]
    const firstLine = pageBox?.lines[0]
    const pageElement = document.querySelector<HTMLElement>(`[data-jword-page="${targetPageIndex}"]`)

    if (demo === undefined || pageBox === undefined || firstLine === undefined || pageElement === null) {
      throw new Error('缺少 Gate 3 page whitespace probe 所需的布局或 DOM')
    }

    const rect = pageElement.getBoundingClientRect()
    const scaleX = rect.width / pageBox.width
    const scaleY = rect.height / pageBox.height
    const localX = Math.max(8, firstLine.x - pageBox.x + 16)
    const localY = Math.max(8, firstLine.y - pageBox.y - 24)

    return {
      clientX: Math.round(rect.left + localX * scaleX),
      clientY: Math.round(rect.top + localY * scaleY)
    }
  }, pageIndex)
}

async function readLargeFixtureLongDragPlan(page: Page): Promise<LargeFixtureLongDragPlan> {
  return page.evaluate(() => {
    const demo = window.__jwordDemo
    const firstPage = demo?.editor.getLayout().pages[0]
    const firstLine = firstPage?.lines.find((line) => line.fragments.length > 1)
    const firstFragment = firstLine?.fragments[0]
    const lastFragment = firstLine?.fragments.at(-1)

    if (firstPage === undefined || firstLine === undefined || firstFragment === undefined || lastFragment === undefined) {
      throw new Error('缺少大夹具长拖回归所需的首行布局片段')
    }

    const startGraphemeIndex = firstFragment.start.graphemeIndex + 1
    const endGraphemeIndex = Math.max(startGraphemeIndex + 6, lastFragment.end.graphemeIndex - 3)

    if (endGraphemeIndex <= startGraphemeIndex) {
      throw new Error(`大夹具长拖终点异常：${startGraphemeIndex}→${endGraphemeIndex}`)
    }

    return {
      pageIndex: firstPage.pageIndex,
      startGraphemeIndex,
      endGraphemeIndex,
      stepCount: 12
    }
  })
}

async function readLargeFixtureDoubleClickPlan(page: Page): Promise<LargeFixtureDoubleClickPlan> {
  return page.evaluate(() => {
    const demo = window.__jwordDemo
    const firstPage = demo?.editor.getLayout().pages[0]
    const firstLine = firstPage?.lines.find((line) => line.fragments.length > 1)
    const targetFragment = firstLine?.fragments.find((fragment) => {
      return fragment.end.graphemeIndex - fragment.start.graphemeIndex >= 2
    }) ?? firstLine?.fragments[0]

    if (firstPage === undefined || targetFragment === undefined) {
      throw new Error('缺少大夹具双击回归所需的首行文本片段')
    }

    const targetGraphemeIndex = targetFragment.end.graphemeIndex - targetFragment.start.graphemeIndex >= 2
      ? targetFragment.start.graphemeIndex + 1
      : targetFragment.end.graphemeIndex

    if (targetGraphemeIndex <= targetFragment.start.graphemeIndex) {
      throw new Error(`大夹具双击命中点异常：${targetFragment.start.graphemeIndex}→${targetFragment.end.graphemeIndex}`)
    }

    return {
      pageIndex: firstPage.pageIndex,
      targetGraphemeIndex
    }
  })
}

async function readAlphaChineseDoubleClickTarget(page: Page): Promise<AlphaChineseDoubleClickTarget> {
  const targetGraphemeIndex = 22
  const point = await readClientPointForGrapheme(page, targetGraphemeIndex)

  return {
    ...point,
    expectedStartGraphemeIndex: targetGraphemeIndex,
    expectedEndGraphemeIndex: targetGraphemeIndex + 1
  }
}

async function readResolvedSelectionSnapshot(page: Page): Promise<ResolvedSelectionSnapshot> {
  return page.evaluate(() => {
    const demo = window.__jwordDemo
    const summary = document.querySelector<HTMLElement>('[data-jword-selection-summary]')?.textContent ?? ''
    const selection = demo?.editor.getSelection() ?? null

    if (demo === undefined || selection === null) {
      return {
        summary,
        range: null
      }
    }

    const anchor = demo.editor.resolveTextPosition(selection.anchor)
    const focus = demo.editor.resolveTextPosition(selection.focus)

    return {
      summary,
      range: {
        startGraphemeIndex: Math.min(anchor.graphemeIndex, focus.graphemeIndex),
        endGraphemeIndex: Math.max(anchor.graphemeIndex, focus.graphemeIndex)
      }
    }
  })
}

async function readSelectionVisualProbe(page: Page, pageIndex: number): Promise<SelectionVisualProbe> {
  return page.evaluate((targetPageIndex) => {
    const canvas = document.querySelector<HTMLCanvasElement>(`[data-jword-page="${targetPageIndex}"] .jw-editor__page-canvas`)
    const context = canvas?.getContext('2d')

    if (canvas === null || context === null || context === undefined) {
      throw new Error(`缺少第 ${targetPageIndex + 1} 页长拖选区 visual canvas`)
    }

    const image = context.getImageData(0, 0, canvas.width, canvas.height).data
    let selectionPixels = 0

    for (let index = 0; index < image.length; index += 4) {
      const red = image[index] ?? 0
      const green = image[index + 1] ?? 0
      const blue = image[index + 2] ?? 0
      const alpha = image[index + 3] ?? 0

      if (alpha === 0) {
        continue
      }

      if (red >= 200 && red <= 215 && green >= 224 && green <= 235 && blue >= 250) {
        selectionPixels += 1
      }
    }

    return {
      selectionPixels
    }
  }, pageIndex)
}

async function readCanvasCursor(page: Page, pageIndex: number): Promise<string> {
  return page.evaluate((targetPageIndex) => {
    const canvas = document.querySelector<HTMLElement>(`[data-jword-page="${targetPageIndex}"] .jw-editor__page-canvas`)

    if (canvas === null) {
      throw new Error(`缺少第 ${targetPageIndex + 1} 页 canvas 光标探针`)
    }

    return window.getComputedStyle(canvas).cursor
  }, pageIndex)
}

async function runPromiseWithTimeout<T>(input: {
  readonly label: string
  readonly promise: Promise<T>
  readonly timeoutMs: number
  readonly diagnostics?: string
  readonly onTimeout?: () => Promise<void> | void
}): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined

  const guardedPromise = new Promise<T>((_, reject) => {
    timer = setTimeout(() => {
      void input.onTimeout?.()
      reject(new Error(
        `${input.label} 超过 ${input.timeoutMs}ms${input.diagnostics === undefined ? '' : `。${input.diagnostics}`}`
      ))
    }, input.timeoutMs)
  })

  try {
    return await Promise.race([input.promise, guardedPromise])
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer)
    }

    void input.promise.catch(() => undefined)
  }
}

async function collapseSelectionAtRunStart(
  page: Page,
  input: {
    readonly sectionId: string
    readonly blockId: string
    readonly runId: string
    readonly graphemeIndex: number
  }
): Promise<void> {
  await page.evaluate((selectionInput) => {
    const demo = window.__jwordDemo

    if (demo === undefined) {
      throw new Error('缺少 Gate 3 demo 测试钩子')
    }

    const anchor = demo.editor.createTextAnchor(selectionInput)

    demo.editor.setSelection({
      anchor,
      focus: anchor,
      range: Object.freeze({ anchor, focus: anchor }) as RangeRef,
      direction: 'none',
      affinity: 'none'
    })
  }, input)
}

async function selectRange(
  page: Page,
  input: {
    readonly sectionId: string
    readonly blockId: string
    readonly runId: string
    readonly anchorGraphemeIndex: number
    readonly focusGraphemeIndex: number
  }
): Promise<void> {
  await page.evaluate((selectionInput) => {
    window.__jwordDemo?.selectTextRange(selectionInput)
  }, input)
}

async function dispatchClipboardEvent(
  page: Page,
  type: 'copy' | 'cut' | 'paste',
  text = ''
): Promise<string> {
  return page.evaluate(({ eventType, clipboardText }) => {
    const input = document.querySelector<HTMLTextAreaElement>('[data-jword-hidden-textarea]')

    if (input === null) {
      throw new Error('缺少 Gate 3 hidden textarea')
    }

    input.focus()

    let plainText = clipboardText
    const event = new Event(eventType, {
      bubbles: true,
      cancelable: true
    })

    Object.defineProperty(event, 'clipboardData', {
      value: {
        getData(targetType: string) {
          return targetType === 'text/plain' ? plainText : ''
        },
        setData(targetType: string, value: string) {
          if (targetType === 'text/plain') {
            plainText = value
          }
        }
      }
    })

    input.dispatchEvent(event)

    return plainText
  }, {
    eventType: type,
    clipboardText: text
  })
}

async function runCompositionSequence(
  page: Page,
  composingText: string,
  committedText: string
): Promise<Readonly<{
  textBeforeEnd: string
  textAfterEnd: string
  selectionSummary: string
}>> {
  return page.evaluate(({ firstData, finalData }) => {
    const input = document.querySelector<HTMLTextAreaElement>('[data-jword-hidden-textarea]')
    const readText = (): string => document.querySelector<HTMLElement>('[data-jword-ui-text-mirror]')?.textContent ?? ''
    const readSummary = (): string => document.querySelector<HTMLElement>('[data-jword-selection-summary]')?.textContent ?? ''
    const createCompositionEvent = (type: string, data: string): Event => {
      const event = new Event(type, {
        bubbles: true,
        cancelable: true
      })

      Object.defineProperty(event, 'data', {
        value: data
      })

      return event
    }

    if (input === null) {
      throw new Error('缺少 Gate 3 hidden textarea')
    }

    input.focus()
    input.dispatchEvent(createCompositionEvent('compositionstart', ''))
    input.dispatchEvent(createCompositionEvent('compositionupdate', firstData))
    input.value = firstData
    input.dispatchEvent(new Event('input', {
      bubbles: true,
      cancelable: true
    }))

    const textBeforeEnd = readText()

    input.value = finalData
    input.dispatchEvent(createCompositionEvent('compositionupdate', finalData))
    input.dispatchEvent(createCompositionEvent('compositionend', finalData))

    return {
      textBeforeEnd,
      textAfterEnd: readText(),
      selectionSummary: readSummary()
    }
  }, {
    firstData: composingText,
    finalData: committedText
  })
}
