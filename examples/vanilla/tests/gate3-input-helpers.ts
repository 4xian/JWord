/**
 * @fileoverview 职责: 提供 Gate 3 输入 E2E 共享的浏览器探针、选区操作和事件模拟辅助函数。
 * 边界: 只封装测试辅助读取和 DOM 事件模拟，不新增产品行为断言。
 * 协作: 浏览器演示钩子、隐藏输入框测试钩子、页面对象与核心锚点类型。
 * 约束: 辅助函数必须通过真实浏览器 DOM/canvas/公开 facade 读取状态，禁止绕过运行时写内部状态。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import type { RangeRef } from '@4xian/jword-core'

const expectedGate2PageCount = 67

export interface ResolvedSelectionSnapshot {
  readonly summary: string
  readonly range: Readonly<{
    readonly startGraphemeIndex: number
    readonly endGraphemeIndex: number
  }> | null
}

export interface LargeFixtureLongDragPlan {
  readonly pageIndex: number
  readonly startGraphemeIndex: number
  readonly endGraphemeIndex: number
  readonly stepCount: number
}

export interface LargeFixtureDoubleClickPlan {
  readonly pageIndex: number
  readonly targetGraphemeIndex: number
}

export interface AlphaChineseDoubleClickProbe {
  readonly clientX: number
  readonly clientY: number
  readonly expectedStartGraphemeIndex: number
  readonly expectedEndGraphemeIndex: number
}

export interface SelectionVisualProbe {
  readonly selectionPixels: number
}

export interface InitialFocusProbe {
  readonly matches: boolean
  readonly position: {
    readonly sectionId: string
    readonly blockId: string
    readonly runId: string
    readonly graphemeIndex: number
  }
  readonly expected: {
    readonly sectionId: string
    readonly blockId: string
    readonly runId: string
    readonly graphemeIndex: number
  }
}

export async function waitForGate3AlphaReady(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__jwordTestFixture !== undefined)
  await expect(page.locator('[data-jword-hidden-textarea]')).toHaveCount(1)
  await page.getByRole('button', { name: '加载 Alpha 样例' }).click()
  await expect(page.locator('[data-jword-canvas-container]')).toHaveAttribute('data-jword-page-count', '1')
  await expect(page.getByRole('button', { name: '选择首页片段' })).toBeEnabled()
}

export async function waitForGate3LargeFixtureReady(page: Page): Promise<void> {
  await expect(page.locator('[data-jword-canvas-container]')).toHaveAttribute('data-jword-page-count', String(expectedGate2PageCount))
  await page.waitForFunction(() => window.__jwordTestFixture !== undefined)
  await expect(page.locator('[data-jword-hidden-textarea]')).toHaveCount(1)
  await expect.poll(async () => {
    return page.evaluate(() => document.querySelectorAll('.jw-editor__page-canvas').length)
  }).toBeGreaterThan(0)
}

export async function readInitialFocusProbe(page: Page): Promise<InitialFocusProbe | null> {
  return page.evaluate(() => {
    const demo = window.__jwordTestFixture
    const selection = demo?.editor.getSelection() ?? null

    if (demo === undefined || selection === null) {
      return null
    }

    const projection = demo.editor.getProjection()
    const position = demo.editor.resolveTextPosition(selection.focus)
    const readRunTextLength = (run: { readonly inlines: readonly { readonly kind: string, readonly text?: string }[] }): number =>
      [...run.inlines
        .flatMap((inline) => inline.kind === 'text' && inline.text !== undefined ? [inline.text] : [])
        .join('')].length

    for (const section of [...projection.document.sections].reverse()) {
      for (const block of [...section.blocks].reverse()) {
        if (block.kind !== 'paragraph') {
          continue
        }

        const run = [...block.runs].reverse().find((candidate) =>
          candidate.inlines.some((inline) => inline.kind === 'text')
        ) ?? block.runs.at(-1)

        if (run === undefined) {
          continue
        }

        const expected = {
          sectionId: section.id,
          blockId: block.id,
          runId: run.id,
          graphemeIndex: readRunTextLength(run)
        }

        return {
          matches: position.sectionId === expected.sectionId
            && position.blockId === expected.blockId
            && position.runId === expected.runId
            && position.graphemeIndex === expected.graphemeIndex,
          position,
          expected
        }
      }
    }

    return null
  })
}

export async function readPlainText(page: Page): Promise<string> {
  return page.evaluate(() => {
    return document.querySelector<HTMLElement>('[data-jword-ui-text-mirror]')?.textContent ?? ''
  })
}

export async function readSelectionSummary(page: Page): Promise<string> {
  return page.evaluate(() => {
    const demo = window.__jwordTestFixture
    const selection = demo?.editor.getSelection() ?? null

    if (demo === undefined || selection === null) {
      return '无选区'
    }

    const anchor = demo.editor.resolveTextPosition(selection.anchor)
    const focus = demo.editor.resolveTextPosition(selection.focus)
    const startGraphemeIndex = Math.min(anchor.graphemeIndex, focus.graphemeIndex)
    const endGraphemeIndex = Math.max(anchor.graphemeIndex, focus.graphemeIndex)

    if (
      anchor.sectionId === focus.sectionId
      && anchor.blockId === focus.blockId
      && anchor.runId === focus.runId
    ) {
      return `选区：${anchor.blockId} / ${anchor.runId} / ${startGraphemeIndex}→${endGraphemeIndex}`
    }

    return `选区：${anchor.blockId} / ${anchor.runId} / ${anchor.graphemeIndex}→${focus.blockId} / ${focus.runId} / ${focus.graphemeIndex}`
  })
}

export async function readParagraphCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    return window.__jwordTestFixture?.editor.getProjection().document.sections[0]?.blocks.length ?? 0
  })
}

export async function readLongEnglishCaretProbe(
  page: Page,
  longEnglish: string
): Promise<Readonly<{
  readonly caretDeltaCssPx: number
  readonly hitGraphemeIndexAtRenderedEnd: number | undefined
}>> {
  return page.evaluate((text) => {
    const demo = window.__jwordTestFixture
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

export async function readClientPointForGrapheme(
  page: Page,
  graphemeIndex: number,
  pageIndex = 0
): Promise<Readonly<{
  clientX: number
  clientY: number
}>> {
  return page.evaluate(({ targetGraphemeIndex, targetPageIndex }) => {
    const demo = window.__jwordTestFixture
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

export async function readClientPointForPageWhitespace(
  page: Page,
  pageIndex: number
): Promise<Readonly<{
  clientX: number
  clientY: number
}>> {
  return page.evaluate((targetPageIndex) => {
    const demo = window.__jwordTestFixture
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

export async function readLargeFixtureLongDragPlan(page: Page): Promise<LargeFixtureLongDragPlan> {
  return page.evaluate(() => {
    const demo = window.__jwordTestFixture
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

export async function readLargeFixtureDoubleClickPlan(page: Page): Promise<LargeFixtureDoubleClickPlan> {
  return page.evaluate(() => {
    const demo = window.__jwordTestFixture
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

export async function readAlphaChineseDoubleClickProbes(page: Page): Promise<readonly AlphaChineseDoubleClickProbe[]> {
  return page.evaluate(() => {
    const targetGraphemeIndex = 22
    const demo = window.__jwordTestFixture
    const pageBox = demo?.editor.getLayout().pages[0]
    const pageElement = document.querySelector<HTMLElement>('[data-jword-page="0"]')
    const fragmentMatch = pageBox?.lines
      .flatMap((line) => line.fragments.map((fragment) => ({
        line,
        fragment
      })))
      .find(({ fragment }) => {
        return targetGraphemeIndex >= fragment.start.graphemeIndex
          && targetGraphemeIndex < fragment.end.graphemeIndex
      })

    if (demo === undefined || pageBox === undefined || pageElement === null || fragmentMatch === undefined) {
      throw new Error('缺少中文双击偏移探针所需的布局或 DOM')
    }

    const rect = pageElement.getBoundingClientRect()
    const scaleX = rect.width / pageBox.width
    const scaleY = rect.height / pageBox.height
    const relativeIndex = targetGraphemeIndex - fragmentMatch.fragment.start.graphemeIndex
    const graphemeStart = fragmentMatch.fragment.advanceTwips[relativeIndex] ?? 0
    const graphemeEnd = fragmentMatch.fragment.advanceTwips[relativeIndex + 1] ?? fragmentMatch.fragment.width
    const toProbe = (
      ratio: number,
      expectedStartGraphemeIndex: number,
      expectedEndGraphemeIndex: number
    ): AlphaChineseDoubleClickProbe => {
      const localX = fragmentMatch.fragment.x - pageBox.x + graphemeStart + ((graphemeEnd - graphemeStart) * ratio)
      const localY = fragmentMatch.line.y - pageBox.y + fragmentMatch.line.height * 0.5

      return {
        clientX: Math.round(rect.left + localX * scaleX),
        clientY: Math.round(rect.top + localY * scaleY),
        expectedStartGraphemeIndex,
        expectedEndGraphemeIndex
      }
    }

    return [
      toProbe(0.5, targetGraphemeIndex, targetGraphemeIndex + 1),
      toProbe(0.1, targetGraphemeIndex - 1, targetGraphemeIndex + 1),
      toProbe(0.9, targetGraphemeIndex, targetGraphemeIndex + 2)
    ]
  })
}

export async function readResolvedSelectionSnapshot(page: Page): Promise<ResolvedSelectionSnapshot> {
  return page.evaluate(() => {
    const demo = window.__jwordTestFixture
    const selection = demo?.editor.getSelection() ?? null

    if (demo === undefined || selection === null) {
      return {
        summary: '无选区',
        range: null
      }
    }

    const anchor = demo.editor.resolveTextPosition(selection.anchor)
    const focus = demo.editor.resolveTextPosition(selection.focus)
    const startGraphemeIndex = Math.min(anchor.graphemeIndex, focus.graphemeIndex)
    const endGraphemeIndex = Math.max(anchor.graphemeIndex, focus.graphemeIndex)

    return {
      summary: `选区：${anchor.blockId} / ${anchor.runId} / ${startGraphemeIndex}→${endGraphemeIndex}`,
      range: {
        startGraphemeIndex,
        endGraphemeIndex
      }
    }
  })
}

export async function readSelectionVisualProbe(page: Page, pageIndex: number): Promise<SelectionVisualProbe> {
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

export async function readCanvasCursor(page: Page, pageIndex: number): Promise<string> {
  return page.evaluate((targetPageIndex) => {
    const canvas = document.querySelector<HTMLElement>(`[data-jword-page="${targetPageIndex}"] .jw-editor__page-canvas`)

    if (canvas === null) {
      throw new Error(`缺少第 ${targetPageIndex + 1} 页 canvas 光标探针`)
    }

    return window.getComputedStyle(canvas).cursor
  }, pageIndex)
}

export async function runPromiseWithTimeout<T>(input: {
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

export async function collapseSelectionAtRunStart(
  page: Page,
  input: {
    readonly sectionId: string
    readonly blockId: string
    readonly runId: string
    readonly graphemeIndex: number
  }
): Promise<void> {
  await page.evaluate((selectionInput) => {
    const demo = window.__jwordTestFixture

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

export async function selectRange(
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
    window.__jwordTestFixture?.selectTextRange(selectionInput)
  }, input)
}

export async function dispatchClipboardEvent(
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

export async function runCompositionSequence(
  page: Page,
  composingText: string,
  committedText: string
): Promise<Readonly<{
  textBeforeEnd: string
  textAfterEnd: string
  selectionDescription: string
}>> {
  return page.evaluate(({ firstData, finalData }) => {
    const input = document.querySelector<HTMLTextAreaElement>('[data-jword-hidden-textarea]')
    const readText = (): string => document.querySelector<HTMLElement>('[data-jword-ui-text-mirror]')?.textContent ?? ''
    const readSelectionDescription = (): string => {
      const demo = window.__jwordTestFixture
      const selection = demo?.editor.getSelection() ?? null

      if (demo === undefined || selection === null) {
        return '无选区'
      }

      const anchor = demo.editor.resolveTextPosition(selection.anchor)
      const focus = demo.editor.resolveTextPosition(selection.focus)
      const startGraphemeIndex = Math.min(anchor.graphemeIndex, focus.graphemeIndex)
      const endGraphemeIndex = Math.max(anchor.graphemeIndex, focus.graphemeIndex)

      return `选区：${anchor.blockId} / ${anchor.runId} / ${startGraphemeIndex}→${endGraphemeIndex}`
    }
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
      selectionDescription: readSelectionDescription()
    }
  }, {
    firstData: composingText,
    finalData: committedText
  })
}
