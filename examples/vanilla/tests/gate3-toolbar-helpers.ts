/**
 * @fileoverview 职责: 为 Gate 3 工具栏拆分 e2e 提供共享 DOM、投影、布局和颜色辅助函数。
 * 边界: 只服务 examples/vanilla/tests 下的工具栏 e2e，不进入生产代码导出面。
 * 协作: Playwright 页面、vanilla demo 测试钩子和编辑器公开门面。
 * 约束: 辅助函数只读公开门面或驱动真实 DOM 控件，不伪造核心状态。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import type { RangeRef } from '@4xian/jword-core'

export interface ParagraphRenderProbe {
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

export interface SelectOptionMatcher {
  readonly exactValue?: string
  readonly valueAllOf?: readonly string[]
  readonly labelAllOf?: readonly string[]
}

/** 读取首段第一个 run 的格式。 */
export async function readFirstRunStyle(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => {
    const projection = window.__jwordTestFixture?.editor.getProjection()
    const firstBlock = projection?.document.sections[0]?.blocks[0]

    if (firstBlock === undefined || firstBlock.kind !== 'paragraph') {
      throw new Error('缺少首段')
    }

    return { ...(firstBlock.runs[0]?.properties ?? {}) }
  })
}

/** 读取首段全部 run 的格式。 */
export async function readFirstParagraphRunStyles(page: Page): Promise<readonly Record<string, unknown>[]> {
  return page.evaluate(() => {
    const projection = window.__jwordTestFixture?.editor.getProjection()
    const firstBlock = projection?.document.sections[0]?.blocks[0]

    if (firstBlock === undefined || firstBlock.kind !== 'paragraph') {
      throw new Error('缺少首段')
    }

    return firstBlock.runs.map((run) => ({ ...(run.properties ?? {}) }))
  })
}

/** 读取第二段第一个 run 的格式。 */
export async function readSecondParagraphFirstRunStyle(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => {
    const projection = window.__jwordTestFixture?.editor.getProjection()
    const secondBlock = projection?.document.sections[0]?.blocks[1]

    if (secondBlock === undefined || secondBlock.kind !== 'paragraph') {
      throw new Error('缺少第二段')
    }

    return { ...(secondBlock.runs[0]?.properties ?? {}) }
  })
}

/** 读取前两段的段落属性。 */
export async function readFirstTwoParagraphProperties(page: Page): Promise<readonly Record<string, unknown>[]> {
  return page.evaluate(() => {
    const projection = window.__jwordTestFixture?.editor.getProjection()
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

/** 读取前两段各 run 的行距。 */
export async function readFirstTwoParagraphRunLineHeights(page: Page): Promise<readonly (readonly (number | null)[])[]> {
  return page.evaluate(() => {
    const projection = window.__jwordTestFixture?.editor.getProjection()
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

/** 读取首个渲染文本片段。 */
export async function readFirstRenderedFragment(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => {
    const fragment = window.__jwordTestFixture?.editor.getLayout().pages[0]?.lines[0]?.fragments[0]

    if (fragment === undefined) {
      throw new Error('缺少首个渲染片段')
    }

    return {
      text: fragment.text,
      style: { ...fragment.style }
    }
  })
}

/** 读取首段布局和画布探针。 */
export async function readFirstParagraphRenderProbe(page: Page): Promise<ParagraphRenderProbe> {
  return page.evaluate(() => {
    const demo = window.__jwordTestFixture
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

/** 读取纸张尺寸和页面外框探针。 */
export async function readPagePresetProbe(page: Page): Promise<{
  readonly preset: string
  readonly pageWrapperWidthPx: number
  readonly pageWrapperHeightPx: number
  readonly firstPageLineCount: number
}> {
  return page.evaluate(() => {
    const demo = window.__jwordTestFixture
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

/** 读取工具栏历史按钮状态。 */
export async function readToolbarHistoryProbe(page: Page): Promise<{
  readonly canUndo: boolean
  readonly canRedo: boolean
  readonly boldPressed: string | null
  readonly undoDisabled: boolean
  readonly redoDisabled: boolean
}> {
  return page.evaluate(() => {
    const demo = window.__jwordTestFixture
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

/** 按值或标签匹配并选择下拉选项。 */
export async function selectDropdownOptionByMatcher(
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

/** 读取下拉触发器图标数量。 */
export async function readToolbarSelectTriggerIconCount(page: Page, selector: string): Promise<number> {
  return page.locator(selector).evaluate((element, inputSelector) => {
    if (!(element instanceof HTMLSelectElement)) {
      throw new Error(`${inputSelector} 不是原生 select，当前无法读取 trigger 图标`)
    }

    return element.parentElement?.querySelectorAll('.jw-toolbar__select-trigger svg').length ?? 0
  }, selector)
}

/** 读取下拉外框样式探针。 */
export async function readToolbarSelectFrameProbe(
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

/** 打开工具栏下拉菜单。 */
export async function openToolbarSelectMenu(page: Page, selector: string): Promise<void> {
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

/** 读取下拉菜单当前选中项文本。 */
export async function readSelectedToolbarOption(page: Page, selector: string): Promise<string> {
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

/** 选择首页首个文本片段范围。 */
export async function selectFirstFragmentRange(page: Page): Promise<void> {
  await page.evaluate(() => {
    const demo = window.__jwordTestFixture

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

/** 选择首段跨 run 范围。 */
export async function selectFirstParagraphAcrossRuns(page: Page): Promise<void> {
  await page.evaluate(() => {
    const demo = window.__jwordTestFixture

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

/** 选择前两段范围。 */
export async function selectFirstTwoParagraphs(page: Page): Promise<void> {
  await page.evaluate(() => {
    const demo = window.__jwordTestFixture

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

/** 将选区折叠到第二段开头。 */
export async function collapseSelectionAtSecondParagraphStart(page: Page): Promise<void> {
  await page.evaluate(() => {
    const demo = window.__jwordTestFixture

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

/** 对颜色控件连续触发预览和确认事件。 */
export async function applyColorValue(page: Page, selector: string, value: string): Promise<void> {
  await page.locator(selector).evaluate((input, nextValue) => {
    const node = input as HTMLInputElement

    node.value = nextValue as string
    node.dispatchEvent(new Event('input', { bubbles: true }))
    node.dispatchEvent(new Event('change', { bubbles: true }))
  }, value)
}

/** 对颜色控件触发预览事件。 */
export async function previewColorValue(page: Page, selector: string, value: string): Promise<void> {
  await page.locator(selector).evaluate((input, nextValue) => {
    const node = input as HTMLInputElement

    node.value = nextValue as string
    node.dispatchEvent(new Event('input', { bubbles: true }))
  }, value)
}

/** 对颜色控件触发确认事件。 */
export async function finalizeColorValue(page: Page, selector: string, value: string): Promise<void> {
  await page.locator(selector).evaluate((input, nextValue) => {
    const node = input as HTMLInputElement

    node.value = nextValue as string
    node.dispatchEvent(new Event('change', { bubbles: true }))
  }, value)
}

/** 定位官方工具栏，避免误命中浮动选区工具栏的同名按钮。 */
export function readOfficialToolbar(page: Page): Locator {
  return page.locator('[data-jword-toolbar]')
}

/** 等待 vanilla demo 测试钩子和隐藏输入框就绪。 */
export async function waitForDemoReady(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__jwordTestFixture !== undefined)
  await expect(page.locator('[data-jword-hidden-textarea]')).toHaveCount(1)
}
