/**
 * 职责：实现 Gate 2 纯数据分页 layout、hit-test、caret rect 和 selection rect 映射。
 * 边界：只读取 DocumentProjection、页面配置 和 字体管理器，不读取 Y.Doc，不访问 DOM，不绘制 Canvas。
 * 协作模块：renderer、PDF、编辑器工厂 和 devtools 后续只消费这里产出的 布局盒 和映射结果。
 * 性能/安全约束：当前为同步最小实现，保留 viewport/脏范围 输入边界，不创建单长 canvas 或浏览器资源。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/03-architecture.md#36-layout-engine。
 */

import { segmentGraphemes } from './grapheme'
import { cssPxToTwips, twipsToCssPx } from './page-config'
import type { FontManager, RunTextStyle } from './font-manager'
import type { Block, Inline, ModelProperties, Paragraph, Run } from './model'
import type { PageConfig } from './page-config'
import type { DocumentProjection } from './projection'
import type { TextPosition, TextRange } from './transaction'

export interface LayoutViewport {
  readonly yTwips?: number
  readonly heightTwips?: number
  readonly pageBuffer?: number
}

export interface LayoutDirtyRange {
  readonly anchor: TextPosition
  readonly focus: TextPosition
}

export interface LayoutInput {
  readonly projection: DocumentProjection
  readonly pageConfig: PageConfig
  readonly fontManager: FontManager
  readonly viewport?: LayoutViewport
  readonly dirtyRange?: LayoutDirtyRange
}

export interface LayoutRect {
  readonly pageIndex: number
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface DocumentLayout {
  readonly kind: 'documentLayout'
  readonly input: LayoutInput
  readonly pages: readonly PageBox[]
  readonly debugOverlay: LayoutDebugOverlay
}

export interface PageBox extends LayoutRect {
  readonly kind: 'page'
  readonly lines: readonly LineBox[]
  readonly paragraphs: readonly ParagraphBox[]
  readonly contentRect: LayoutRect
}

export type LayoutBox = PageBox

export interface ParagraphBox extends LayoutRect {
  readonly kind: 'paragraph'
  readonly sectionId: string
  readonly paragraphId: string
  readonly lines: readonly LineBox[]
}

export interface LineBox extends LayoutRect {
  readonly kind: 'line'
  readonly sectionId: string
  readonly paragraphId: string
  readonly baseline: number
  readonly fragments: readonly TextFragment[]
  readonly inlines: readonly InlineBox[]
}

export interface TextFragment extends LayoutRect {
  readonly kind: 'textFragment'
  readonly sectionId: string
  readonly blockId: string
  readonly runId: string
  readonly text: string
  readonly start: TextPosition
  readonly end: TextPosition
  readonly style: RunTextStyle
  readonly baseline: number
  readonly advanceTwips: readonly number[]
}

export type InlineBox = PageBreakBox

export interface PageBreakBox extends LayoutRect {
  readonly kind: 'pageBreak'
  readonly sectionId: string
  readonly blockId: string
  readonly runId: string
  readonly at: TextPosition
}

export interface LayoutDebugOverlay {
  readonly boxes: readonly LayoutDebugBox[]
}

export interface LayoutDebugBox extends LayoutRect {
  readonly kind: 'page' | 'line' | 'fragment'
  readonly id: string
}

interface MutablePageBox {
  kind: 'page'
  pageIndex: number
  x: number
  y: number
  width: number
  height: number
  lines: LineBox[]
  paragraphs: MutableParagraphBox[]
  contentRect: LayoutRect
}

interface MutableParagraphBox {
  kind: 'paragraph'
  pageIndex: number
  sectionId: string
  paragraphId: string
  x: number
  y: number
  width: number
  height: number
  lines: LineBox[]
}

interface MutableLineBox {
  kind: 'line'
  pageIndex: number
  sectionId: string
  paragraphId: string
  x: number
  y: number
  width: number
  height: number
  baseline: number
  fragments: TextFragment[]
  inlines: InlineBox[]
}

interface LayoutCursor {
  page: MutablePageBox
  paragraph: MutableParagraphBox | undefined
  line: MutableLineBox | undefined
  y: number
  x: number
}

const PAGE_GAP_TWIPS = 720

/**
 * 从只读投影生成分页布局。
 *
 * @param input DocumentProjection、页面配置、字体度量和可选 视口和脏范围。
 * @returns DocumentLayout 和 debug overlay 数据。
 */
export function layoutDocument(input: LayoutInput): DocumentLayout {
  const pages: MutablePageBox[] = []
  const cursor: LayoutCursor = {
    page: createPage(0, input.pageConfig),
    paragraph: undefined,
    line: undefined,
    y: input.pageConfig.marginTwips.top,
    x: input.pageConfig.marginTwips.left
  }

  pages.push(cursor.page)

  for (const section of input.projection.document.sections) {
    for (const block of section.blocks) {
      layoutBlock(block, section.id, input, cursor, pages)
    }
  }

  flushLine(cursor)

  const frozenPages = pages.map(freezePage)

  return Object.freeze({
    kind: 'documentLayout',
    input,
    pages: Object.freeze(frozenPages),
    debugOverlay: createDebugOverlay(frozenPages)
  })
}

/**
 * 把页面坐标映射到 TextPosition。
 *
 * @param layout 文档布局。
 * @param point 页面内 twip 坐标和页号。
 * @returns 命中的文本位置；未命中文本时返回 undefined。
 */
export function hitTestDocumentLayout(
  layout: DocumentLayout,
  point: Readonly<{
    pageIndex: number
    x: number
    y: number
  }>
): TextPosition | undefined {
  const page = layout.pages[point.pageIndex]

  if (page === undefined) {
    return undefined
  }

  const line = page.lines.find((candidate) =>
    point.y >= candidate.y && point.y <= candidate.y + candidate.height
  )

  if (line === undefined || line.fragments.length === 0) {
    return undefined
  }

  const firstFragment = line.fragments[0]
  const lastFragment = line.fragments[line.fragments.length - 1]

  if (firstFragment === undefined || lastFragment === undefined) {
    return undefined
  }

  if (point.x <= firstFragment.x) {
    return firstFragment.start
  }

  for (const fragment of line.fragments) {
    if (point.x <= fragment.x + fragment.width) {
      return positionInFragment(fragment, point.x)
    }
  }

  return lastFragment.end
}

/**
 * 读取文本位置对应的 caret rect。
 *
 * @param layout 文档布局。
 * @param position 可序列化文本位置。
 * @returns caret rect；未找到时返回 undefined。
 */
export function getCaretRect(layout: DocumentLayout, position: TextPosition): LayoutRect | undefined {
  const located = locatePosition(layout, position)

  if (located === undefined) {
    return undefined
  }

  const x = offsetInFragment(located.fragment, position)

  return {
    pageIndex: located.fragment.pageIndex,
    x,
    y: located.line.y,
    width: 0,
    height: located.line.height
  }
}

/**
 * 读取范围对应的 selection rect。
 *
 * @param layout 文档布局。
 * @param range TextRange 或同形 range-like 对象。
 * @returns 每行一个 selection rect。
 */
export function getSelectionRects(layout: DocumentLayout, range: TextRange): readonly LayoutRect[] {
  const ordered = orderRange(layout, range)

  if (ordered === undefined || isSamePosition(ordered.anchor, ordered.focus)) {
    return Object.freeze([])
  }

  const rects: LayoutRect[] = []

  for (const page of layout.pages) {
    for (const line of page.lines) {
      const lineRect = getLineSelectionRect(layout, line, ordered.anchor, ordered.focus)

      if (lineRect !== undefined) {
        rects.push(lineRect)
      }
    }
  }

  return Object.freeze(rects)
}

function layoutBlock(
  block: Block,
  sectionId: string,
  input: LayoutInput,
  cursor: LayoutCursor,
  pages: MutablePageBox[]
): void {
  if (block.kind !== 'paragraph') {
    return
  }

  startParagraph(cursor, sectionId, block.id, input.pageConfig)

  for (const run of block.runs) {
    layoutRun(run, sectionId, block, input, cursor, pages)
  }

  flushLine(cursor)
}

function layoutRun(
  run: Run,
  sectionId: string,
  paragraph: Paragraph,
  input: LayoutInput,
  cursor: LayoutCursor,
  pages: MutablePageBox[]
): void {
  const style = readRunStyle(run.properties)
  let runGraphemeIndex = 0

  for (const inline of run.inlines) {
    if (inline.kind === 'text') {
      for (const segment of segmentGraphemes(inline.text)) {
        const fragmentStyle = style
        const measurement = input.fontManager.measureText(segment.segment, fragmentStyle)
        const width = cssPxToTwips(measurement.widthCssPx)
        const height = cssPxToTwips(measurement.heightCssPx)
        const baseline = cssPxToTwips(measurement.baselineCssPx)

        ensureLineFits(width, height, cursor, pages, input.pageConfig, sectionId, paragraph.id)
        appendTextFragment({
          cursor,
          sectionId,
          paragraphId: paragraph.id,
          runId: run.id,
          text: segment.segment,
          startGraphemeIndex: runGraphemeIndex,
          endGraphemeIndex: runGraphemeIndex + 1,
          width,
          height,
          baseline,
          style: fragmentStyle
        })
        runGraphemeIndex += 1
      }
    } else {
      layoutInlineBreak(inline, sectionId, paragraph.id, run.id, runGraphemeIndex, cursor, pages, input.pageConfig)
    }
  }
}

function layoutInlineBreak(
  inline: Inline,
  sectionId: string,
  paragraphId: string,
  runId: string,
  graphemeIndex: number,
  cursor: LayoutCursor,
  pages: MutablePageBox[],
  pageConfig: PageConfig
): void {
  if (inline.kind !== 'break') {
    return
  }

  if (inline.breakType === 'line') {
    flushLine(cursor)
    return
  }

  if (inline.breakType !== 'page') {
    return
  }

  const line = ensureLine(cursor, sectionId, paragraphId, pageConfig)
  const pageBreak: PageBreakBox = {
    kind: 'pageBreak',
    pageIndex: cursor.page.pageIndex,
    sectionId,
    blockId: paragraphId,
    runId,
    at: {
      sectionId,
      blockId: paragraphId,
      runId,
      graphemeIndex
    },
    x: cursor.x,
    y: line.y,
    width: 0,
    height: line.height
  }

  line.inlines.push(Object.freeze(pageBreak))
  flushLine(cursor)
  startNewPage(cursor, pages, pageConfig)
  startParagraph(cursor, sectionId, paragraphId, pageConfig)
}

function startParagraph(
  cursor: LayoutCursor,
  sectionId: string,
  paragraphId: string,
  pageConfig: PageConfig
): void {
  if (cursor.paragraph?.paragraphId === paragraphId && cursor.paragraph.pageIndex === cursor.page.pageIndex) {
    return
  }

  const x = pageConfig.marginTwips.left
  const y = cursor.y
  const paragraph: MutableParagraphBox = {
    kind: 'paragraph',
    pageIndex: cursor.page.pageIndex,
    sectionId,
    paragraphId,
    x,
    y,
    width: 0,
    height: 0,
    lines: []
  }

  cursor.page.paragraphs.push(paragraph)
  cursor.paragraph = paragraph
}

function ensureLineFits(
  nextWidth: number,
  nextHeight: number,
  cursor: LayoutCursor,
  pages: MutablePageBox[],
  pageConfig: PageConfig,
  sectionId: string,
  paragraphId: string
): void {
  const contentRight = pageConfig.marginTwips.left + pageConfig.contentWidthTwips

  if (cursor.line !== undefined && cursor.line.fragments.length > 0 && cursor.x + nextWidth > contentRight) {
    flushLine(cursor)
  }

  if (cursor.y + nextHeight > cursor.page.contentRect.y + cursor.page.contentRect.height) {
    startNewPage(cursor, pages, pageConfig)
    startParagraph(cursor, sectionId, paragraphId, pageConfig)
  }

  ensureLine(cursor, sectionId, paragraphId, pageConfig)
}

function ensureLine(
  cursor: LayoutCursor,
  sectionId: string,
  paragraphId: string,
  pageConfig: PageConfig
): MutableLineBox {
  if (cursor.line !== undefined) {
    return cursor.line
  }

  startParagraph(cursor, sectionId, paragraphId, pageConfig)

  const line: MutableLineBox = {
    kind: 'line',
    pageIndex: cursor.page.pageIndex,
    sectionId,
    paragraphId,
    x: pageConfig.marginTwips.left,
    y: cursor.y,
    width: 0,
    height: 0,
    baseline: 0,
    fragments: [],
    inlines: []
  }

  cursor.line = line
  cursor.x = line.x

  return line
}

function appendTextFragment(input: Readonly<{
  cursor: LayoutCursor
  sectionId: string
  paragraphId: string
  runId: string
  text: string
  startGraphemeIndex: number
  endGraphemeIndex: number
  width: number
  height: number
  baseline: number
  style: RunTextStyle
}>): void {
  const line = input.cursor.line

  if (line === undefined) {
    return
  }

  const fragment: TextFragment = Object.freeze({
    kind: 'textFragment',
    pageIndex: input.cursor.page.pageIndex,
    sectionId: input.sectionId,
    blockId: input.paragraphId,
    runId: input.runId,
    text: input.text,
    start: {
      sectionId: input.sectionId,
      blockId: input.paragraphId,
      runId: input.runId,
      graphemeIndex: input.startGraphemeIndex
    },
    end: {
      sectionId: input.sectionId,
      blockId: input.paragraphId,
      runId: input.runId,
      graphemeIndex: input.endGraphemeIndex
    },
    style: input.style,
    x: input.cursor.x,
    y: line.y,
    width: input.width,
    height: input.height,
    baseline: line.y + input.baseline,
    advanceTwips: Object.freeze([0, input.width])
  })

  line.fragments.push(fragment)
  line.width = fragment.x + fragment.width - line.x
  line.height = Math.max(line.height, fragment.height)
  line.baseline = Math.max(line.baseline, fragment.baseline)
  input.cursor.x += input.width
}

function flushLine(cursor: LayoutCursor): void {
  if (cursor.line === undefined) {
    return
  }

  const line = cursor.line

  if (line.fragments.length > 0 || line.inlines.length > 0) {
    const frozenLine = freezeLine(line)

    cursor.page.lines.push(frozenLine)
    cursor.paragraph?.lines.push(frozenLine)
    cursor.y += Math.max(line.height, 1)

    if (cursor.paragraph !== undefined) {
      cursor.paragraph.width = Math.max(cursor.paragraph.width, frozenLine.width)
      cursor.paragraph.height = cursor.y - cursor.paragraph.y
    }
  }

  cursor.line = undefined
  cursor.x = cursor.page.contentRect.x
}

function startNewPage(
  cursor: LayoutCursor,
  pages: MutablePageBox[],
  pageConfig: PageConfig
): void {
  flushLine(cursor)

  const page = createPage(pages.length, pageConfig)

  pages.push(page)
  cursor.page = page
  cursor.paragraph = undefined
  cursor.line = undefined
  cursor.y = page.contentRect.y
  cursor.x = page.contentRect.x
}

function createPage(pageIndex: number, pageConfig: PageConfig): MutablePageBox {
  const pageY = pageIndex * (pageConfig.heightTwips + PAGE_GAP_TWIPS)

  return {
    kind: 'page',
    pageIndex,
    x: 0,
    y: pageY,
    width: pageConfig.widthTwips,
    height: pageConfig.heightTwips,
    lines: [],
    paragraphs: [],
    contentRect: {
      pageIndex,
      x: pageConfig.marginTwips.left,
      y: pageY + pageConfig.marginTwips.top,
      width: pageConfig.contentWidthTwips,
      height: pageConfig.contentHeightTwips
    }
  }
}

function freezePage(page: MutablePageBox): PageBox {
  return Object.freeze({
    ...page,
    lines: Object.freeze(page.lines),
    paragraphs: Object.freeze(page.paragraphs.map((paragraph) => Object.freeze({
      ...paragraph,
      lines: Object.freeze(paragraph.lines)
    }))),
    contentRect: Object.freeze(page.contentRect)
  })
}

function freezeLine(line: MutableLineBox): LineBox {
  return Object.freeze({
    ...line,
    fragments: Object.freeze(line.fragments),
    inlines: Object.freeze(line.inlines)
  })
}

function createDebugOverlay(pages: readonly PageBox[]): LayoutDebugOverlay {
  const boxes: LayoutDebugBox[] = []

  for (const page of pages) {
    boxes.push(createDebugBox('page', `page:${page.pageIndex}`, page))

    for (const line of page.lines) {
      boxes.push(createDebugBox('line', `line:${line.pageIndex}:${line.y}`, line))

      for (const fragment of line.fragments) {
        boxes.push(createDebugBox('fragment', `fragment:${fragment.blockId}:${fragment.runId}:${fragment.start.graphemeIndex}`, fragment))
      }
    }
  }

  return Object.freeze({
    boxes: Object.freeze(boxes)
  })
}

function createDebugBox(
  kind: LayoutDebugBox['kind'],
  id: string,
  rect: LayoutRect
): LayoutDebugBox {
  return Object.freeze({
    kind,
    id,
    pageIndex: rect.pageIndex,
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height
  })
}

function positionInFragment(fragment: TextFragment, x: number): TextPosition {
  const relativeX = Math.max(0, Math.min(fragment.width, x - fragment.x))
  const midpoint = fragment.width / 2
  const graphemeIndex = relativeX < midpoint
    ? fragment.start.graphemeIndex
    : fragment.end.graphemeIndex

  return {
    sectionId: fragment.sectionId,
    blockId: fragment.blockId,
    runId: fragment.runId,
    graphemeIndex
  }
}

function locatePosition(
  layout: DocumentLayout,
  position: TextPosition
): Readonly<{
  line: LineBox
  fragment: TextFragment
}> | undefined {
  for (const page of layout.pages) {
    for (const line of page.lines) {
      for (const fragment of line.fragments) {
        if (containsPosition(fragment, position)) {
          return {
            line,
            fragment
          }
        }
      }
    }
  }

  return undefined
}

function containsPosition(fragment: TextFragment, position: TextPosition): boolean {
  return fragment.sectionId === position.sectionId
    && fragment.blockId === position.blockId
    && fragment.runId === position.runId
    && position.graphemeIndex >= fragment.start.graphemeIndex
    && position.graphemeIndex <= fragment.end.graphemeIndex
}

function offsetInFragment(fragment: TextFragment, position: TextPosition): number {
  if (position.graphemeIndex <= fragment.start.graphemeIndex) {
    return fragment.x
  }

  if (position.graphemeIndex >= fragment.end.graphemeIndex) {
    return fragment.x + fragment.width
  }

  const index = position.graphemeIndex - fragment.start.graphemeIndex
  const advance = fragment.advanceTwips[index] ?? fragment.width

  return fragment.x + advance
}

function getLineSelectionRect(
  layout: DocumentLayout,
  line: LineBox,
  anchor: TextPosition,
  focus: TextPosition
): LayoutRect | undefined {
  let startX: number | undefined
  let endX: number | undefined

  for (const fragment of line.fragments) {
    const overlap = getFragmentOverlap(layout, fragment, anchor, focus)

    if (overlap === undefined) {
      continue
    }

    const fragmentStartX = offsetInFragment(fragment, overlap.start)
    const fragmentEndX = offsetInFragment(fragment, overlap.end)

    startX = Math.min(startX ?? fragmentStartX, fragmentStartX)
    endX = Math.max(endX ?? fragmentEndX, fragmentEndX)
  }

  if (startX === undefined || endX === undefined || endX <= startX) {
    return undefined
  }

  return {
    pageIndex: line.pageIndex,
    x: startX,
    y: line.y,
    width: endX - startX,
    height: line.height
  }
}

function getFragmentOverlap(
  layout: DocumentLayout,
  fragment: TextFragment,
  anchor: TextPosition,
  focus: TextPosition
): Readonly<{
  start: TextPosition
  end: TextPosition
}> | undefined {
  const fragmentEndOrder = comparePositions(layout, fragment.end, anchor)
  const fragmentStartOrder = comparePositions(layout, fragment.start, focus)

  if (
    fragmentEndOrder === undefined ||
    fragmentStartOrder === undefined ||
    fragmentEndOrder <= 0 ||
    fragmentStartOrder >= 0
  ) {
    return undefined
  }

  const startsInsideAnchorContainer = isSameTextContainer(fragment.start, anchor)
  const endsInsideFocusContainer = isSameTextContainer(fragment.end, focus)
  const startIndex = startsInsideAnchorContainer
    ? Math.max(fragment.start.graphemeIndex, anchor.graphemeIndex)
    : fragment.start.graphemeIndex
  const endIndex = endsInsideFocusContainer
    ? Math.min(fragment.end.graphemeIndex, focus.graphemeIndex)
    : fragment.end.graphemeIndex

  if (endIndex <= startIndex) {
    return undefined
  }

  return {
    start: {
      sectionId: fragment.sectionId,
      blockId: fragment.blockId,
      runId: fragment.runId,
      graphemeIndex: startIndex
    },
    end: {
      sectionId: fragment.sectionId,
      blockId: fragment.blockId,
      runId: fragment.runId,
      graphemeIndex: endIndex
    }
  }
}

function orderRange(layout: DocumentLayout, range: TextRange): TextRange | undefined {
  const order = comparePositions(layout, range.anchor, range.focus)

  if (order === undefined) {
    return undefined
  }

  if (order <= 0) {
    return range
  }

  return {
    anchor: range.focus,
    focus: range.anchor
  }
}

function comparePositions(
  layout: DocumentLayout,
  left: TextPosition,
  right: TextPosition
): number | undefined {
  if (isSameTextContainer(left, right)) {
    return left.graphemeIndex - right.graphemeIndex
  }

  const leftOrder = findContainerOrder(layout, left)
  const rightOrder = findContainerOrder(layout, right)

  if (leftOrder === undefined || rightOrder === undefined) {
    return undefined
  }

  return leftOrder - rightOrder
}

function findContainerOrder(layout: DocumentLayout, position: TextPosition): number | undefined {
  let order = 0

  for (const page of layout.pages) {
    for (const line of page.lines) {
      for (const fragment of line.fragments) {
        if (isSameTextContainer(fragment.start, position)) {
          return order
        }

        order += 1
      }
    }
  }

  return undefined
}

function isSameTextContainer(left: TextPosition, right: TextPosition): boolean {
  return left.sectionId === right.sectionId
    && left.blockId === right.blockId
    && left.runId === right.runId
}

function isSamePosition(left: TextPosition, right: TextPosition): boolean {
  return isSameTextContainer(left, right) && left.graphemeIndex === right.graphemeIndex
}

function readRunStyle(properties: ModelProperties | undefined): RunTextStyle {
  const fontFamily = readStringProperty(properties, 'fontFamily')
  const fontSizePx = readNumberProperty(properties, 'fontSizePx')
  const fontSizeTwips = readNumberProperty(properties, 'fontSizeTwips')
  const bold = readBooleanProperty(properties, 'bold')
  const italic = readBooleanProperty(properties, 'italic')
  const color = readStringProperty(properties, 'color')
  const lineHeight = readNumberProperty(properties, 'lineHeight')
  const style: RunTextStyle = {
    fontSizePx: fontSizePx ?? (fontSizeTwips === undefined ? 16 : twipsToCssPx(fontSizeTwips))
  }

  return {
    ...style,
    ...(fontFamily === undefined ? {} : { fontFamily }),
    ...(fontSizeTwips === undefined ? {} : { fontSizeTwips }),
    ...(bold === undefined ? {} : { bold }),
    ...(italic === undefined ? {} : { italic }),
    ...(color === undefined ? {} : { color }),
    ...(lineHeight === undefined ? {} : { lineHeight })
  }
}

function readStringProperty(properties: ModelProperties | undefined, key: string): string | undefined {
  const value = properties?.[key]

  return typeof value === 'string' ? value : undefined
}

function readNumberProperty(properties: ModelProperties | undefined, key: string): number | undefined {
  const value = properties?.[key]

  return typeof value === 'number' ? value : undefined
}

function readBooleanProperty(properties: ModelProperties | undefined, key: string): boolean | undefined {
  const value = properties?.[key]

  return typeof value === 'boolean' ? value : undefined
}
