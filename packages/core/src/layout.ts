/**
 * 职责：实现 Gate 2 纯数据分页 layout、hit-test、caret rect 和 selection rect 映射。
 * 边界：只读取 DocumentProjection、页面配置 和 字体管理器，不读取 Y.Doc，不访问 DOM，不绘制 Canvas。
 * 协作模块：renderer、PDF、编辑器工厂 和 devtools 后续只消费这里产出的 布局盒 和映射结果。
 * 性能/安全约束：当前为同步最小实现，保留 viewport/脏范围 输入边界，不创建单长 canvas 或浏览器资源。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/03-architecture.md#36-layout-engine。
 */

import { segmentGraphemes } from './grapheme'
import { cssPxToTwips, twipsToCssPx } from './page-config'
import type { FontManager, ResolvedFontStyle, RunTextStyle } from './font-manager'
import type { Block, Inline, ModelProperties, Paragraph, Run, Section, Table } from './model'
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
  readonly previousLayout?: DocumentLayout
  readonly dirtyPageIndex?: number
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
  readonly sectionBoundary: 'single' | 'mixed'
  readonly sectionIds: readonly string[]
  readonly sectionId?: string
  readonly pageLayout?: Section['page']
  readonly headerIds: readonly string[]
  readonly footerIds: readonly string[]
  readonly lines: readonly LineBox[]
  readonly paragraphs: readonly ParagraphBox[]
  readonly blocks: readonly BlockBox[]
  readonly contentRect: LayoutRect
}

export type LayoutBox = PageBox

export interface ParagraphBox extends LayoutRect {
  readonly kind: 'paragraph'
  readonly sectionId: string
  readonly paragraphId: string
  readonly pageBreakPolicy: ParagraphPageBreakPolicy
  readonly lines: readonly LineBox[]
}

export interface TableBox extends LayoutRect {
  readonly kind: 'table'
  readonly sectionId: string
  readonly tableId: string
  readonly grid: readonly number[]
  readonly rowCount: number
  readonly cellCount: number
  readonly rows: readonly TableRowBox[]
}

export type BlockBox = ParagraphBox | TableBox

export interface TableRowBox {
  readonly rowId: string
  readonly cells: readonly TableCellBox[]
}

export interface TableCellBox {
  readonly cellId: string
  readonly gridSpan: number
  readonly blockIds: readonly string[]
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
  readonly style: ResolvedFontStyle
  readonly baseline: number
  readonly advanceTwips: readonly number[]
}

export type InlineBox =
  | PageBreakBox
  | NonTextInlineBox

export interface PageBreakBox extends LayoutRect {
  readonly kind: 'pageBreak'
  readonly sectionId: string
  readonly blockId: string
  readonly runId: string
  readonly at: TextPosition
}

export interface NonTextInlineBox extends LayoutRect {
  readonly kind: 'inlineObject'
  readonly inlineKind: Exclude<Inline['kind'], 'text' | 'break'>
  readonly payload: InlineObjectPayload
  readonly sectionId: string
  readonly blockId: string
  readonly runId: string
  readonly at: TextPosition
}

type InlineObjectPayload = Inline extends infer Candidate
  ? Candidate extends { readonly kind: 'text' | 'break' }
    ? never
    : Candidate extends { readonly kind: string }
      ? Omit<Candidate, 'kind'>
      : never
  : never

export interface LayoutDebugOverlay {
  readonly boxes: readonly LayoutDebugBox[]
}

export interface ParagraphPageBreakPolicy {
  readonly widowControl: boolean
  readonly orphanLines: number
  readonly widowLines: number
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
  sectionBoundary: 'single' | 'mixed'
  sectionIds: string[]
  sectionId?: string
  pageLayout?: Section['page']
  headerIds: readonly string[]
  footerIds: readonly string[]
  lines: LineBox[]
  paragraphs: MutableParagraphBox[]
  blocks: BlockBox[]
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
  pageBreakPolicy: ParagraphPageBreakPolicy
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

interface IncrementalLayoutContext {
  readonly previousLayout: DocumentLayout
  readonly dirtyPageIndex: number
  readonly dirtyPageEndIndex: number
  readonly prefixPages: readonly PageBox[]
  readonly sourceProjection: DocumentProjection
  readonly sourceStartPosition?: TextPosition
  readonly pageLimit?: number
  continuation?: Readonly<{
    dirtyPageIndex: number
    dirtyPageEndIndex: number
    startPosition: TextPosition
  }>
  stoppedAtPageIndex?: number
}

interface IncrementalLayoutPassInput extends LayoutInput {
  readonly dirtyPageEndIndex?: number
  readonly startPosition?: TextPosition
  readonly maxPages?: number
}

const PAGE_GAP_TWIPS = 720
const FONT_MANAGER_COMPATIBILITY_PROBE_TEXTS = Object.freeze(['M', '中', '😀', ' ', '.'])

/**
 * 从只读投影生成分页布局。
 *
 * @param input DocumentProjection、页面配置、字体度量和可选 视口和脏范围。
 * @returns DocumentLayout 和 debug overlay 数据。
 */
export function layoutDocument(input: LayoutInput): DocumentLayout {
  return layoutDocumentIncrementally(input).layout
}

/**
 * 执行一次可恢复的分片 layout pass。
 *
 * @param input 布局输入，以及可选的 续排起点 和 本次最多排出的页数。
 * @returns 本次产出的布局、已完成的新页，以及是否还需要继续续排。
 */
export function layoutDocumentIncrementally(input: IncrementalLayoutPassInput): Readonly<{
  layout: DocumentLayout
  laidOutPageIndexes: readonly number[]
  continuation?: Readonly<{
    dirtyPageIndex: number
    dirtyPageEndIndex: number
    startPosition: TextPosition
  }>
  stoppedAtPageIndex?: number
}> {
  const incremental = createIncrementalLayoutContext(input)
  const layoutInput = createDerivedLayoutInput(input)
  const sourceProjection = incremental?.sourceProjection ?? input.projection
  const frozenPrefixPages = incremental?.prefixPages ?? Object.freeze([])
  const initialPage = createPage(incremental?.dirtyPageIndex ?? 0, input.pageConfig)
  const pages: MutablePageBox[] = []
  const cursor: LayoutCursor = {
    page: initialPage,
    paragraph: undefined,
    line: undefined,
    y: initialPage.contentRect.y,
    x: initialPage.contentRect.x
  }

  pages.push(cursor.page)

  let stoppedEarly = false

  for (const section of sourceProjection.document.sections) {
    assignPageSectionBoundary(cursor.page, section)

    for (const block of section.blocks) {
      if (layoutBlock(block, section, layoutInput, cursor, pages, incremental)) {
        stoppedEarly = true
        break
      }
    }

    if (stoppedEarly) {
      break
    }
  }

  flushLine(cursor)

  const frozenPages = finalizeLayoutPages(pages, incremental)
  const resultPages = Object.freeze([
    ...frozenPrefixPages,
    ...frozenPages,
    ...resolveReusedSuffixPages(incremental)
  ])
  const layout = Object.freeze({
    kind: 'documentLayout' as const,
    input: layoutInput,
    pages: resultPages,
    debugOverlay: createDebugOverlay(resultPages)
  })
  const laidOutPageIndexes = Object.freeze(frozenPages.map((page) => page.pageIndex))

  return Object.freeze({
    layout,
    laidOutPageIndexes,
    ...(incremental?.continuation === undefined ? {} : { continuation: incremental.continuation }),
    ...(incremental?.stoppedAtPageIndex === undefined ? {} : { stoppedAtPageIndex: incremental.stoppedAtPageIndex })
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

  const absolutePoint = {
    x: page.x + point.x,
    y: page.y + point.y
  }
  const line = page.lines.find((candidate) =>
    absolutePoint.y >= candidate.y && absolutePoint.y <= candidate.y + candidate.height
  )

  if (line === undefined) {
    return undefined
  }

  if (line.fragments.length === 0) {
    return line.inlines[0]?.at
  }

  const firstFragment = line.fragments[0]
  const lastFragment = line.fragments[line.fragments.length - 1]

  if (firstFragment === undefined || lastFragment === undefined) {
    return undefined
  }

  if (absolutePoint.x <= firstFragment.x) {
    return firstFragment.start
  }

  for (const fragment of line.fragments) {
    if (absolutePoint.x <= fragment.x + fragment.width) {
      return positionInFragment(fragment, absolutePoint.x)
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

  const target = located.fragment ?? located.inline

  if (target === undefined) {
    return undefined
  }

  return {
    pageIndex: target.pageIndex,
    x: located.fragment === undefined ? target.x : offsetInFragment(located.fragment, position),
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

function createIncrementalLayoutContext(input: IncrementalLayoutPassInput): IncrementalLayoutContext | undefined {
  const previousLayout = input.previousLayout

  if (
    previousLayout === undefined
    || !isEquivalentLayoutPageConfig(previousLayout.input.pageConfig, input.pageConfig)
    || !isCompatibleLayoutFontManager(previousLayout.input.fontManager, input.fontManager, input.projection)
  ) {
    return undefined
  }

  const dirtyPageIndex = resolveDirtyPageIndex(input, previousLayout)

  if (dirtyPageIndex === undefined) {
    return undefined
  }

  const dirtyPageEndIndex = resolveDirtyPageEndIndex(input, previousLayout, dirtyPageIndex)

  const startPosition = input.startPosition ?? (
    dirtyPageIndex === 0
      ? undefined
      : getPageStartPosition(previousLayout.pages[dirtyPageIndex])
  )

  if (dirtyPageIndex > 0 && startPosition === undefined) {
    return undefined
  }

  const sourceProjection = startPosition === undefined
    ? input.projection
    : sliceProjectionFromPosition(input.projection, startPosition)

  if (sourceProjection === undefined) {
    return undefined
  }

  return {
    previousLayout,
    dirtyPageIndex,
    dirtyPageEndIndex,
    prefixPages: Object.freeze(previousLayout.pages.slice(0, dirtyPageIndex)),
    sourceProjection,
    ...(startPosition === undefined ? {} : { sourceStartPosition: startPosition }),
    ...(input.maxPages === undefined ? {} : { pageLimit: Math.max(1, input.maxPages) })
  }
}

function createDerivedLayoutInput(
  input: LayoutInput
): LayoutInput {
  return Object.freeze({
    projection: input.projection,
    pageConfig: input.pageConfig,
    fontManager: input.fontManager,
    ...(input.viewport === undefined ? {} : { viewport: input.viewport }),
    ...(input.dirtyRange === undefined ? {} : { dirtyRange: input.dirtyRange })
  })
}

function isEquivalentLayoutPageConfig(left: PageConfig, right: PageConfig): boolean {
  return left.widthTwips === right.widthTwips
    && left.heightTwips === right.heightTwips
    && left.contentWidthTwips === right.contentWidthTwips
    && left.contentHeightTwips === right.contentHeightTwips
    && left.marginTwips.top === right.marginTwips.top
    && left.marginTwips.right === right.marginTwips.right
    && left.marginTwips.bottom === right.marginTwips.bottom
    && left.marginTwips.left === right.marginTwips.left
}

function isCompatibleLayoutFontManager(
  previousFontManager: FontManager,
  nextFontManager: FontManager,
  projection: DocumentProjection
): boolean {
  if (previousFontManager === nextFontManager) {
    return true
  }

  const styles = collectFontManagerProbeStyles(projection)

  for (const style of styles) {
    for (const text of FONT_MANAGER_COMPATIBILITY_PROBE_TEXTS) {
      const previousMeasurement = previousFontManager.measureText(text, style)
      const nextMeasurement = nextFontManager.measureText(text, style)

      if (!isEquivalentTextMeasurement(previousMeasurement, nextMeasurement)) {
        return false
      }
    }
  }

  return true
}

function collectFontManagerProbeStyles(projection: DocumentProjection): readonly RunTextStyle[] {
  const styles = new Map<string, RunTextStyle>()
  const defaultStyle: RunTextStyle = Object.freeze({})

  styles.set(createRunStyleSignature(defaultStyle), defaultStyle)

  for (const section of projection.document.sections) {
    for (const block of section.blocks) {
      if (block.kind !== 'paragraph') {
        continue
      }

      for (const run of block.runs) {
        const style = Object.freeze(readRunStyle(run.properties))
        const key = createRunStyleSignature(style)

        if (!styles.has(key)) {
          styles.set(key, style)
        }
      }
    }
  }

  return Object.freeze([...styles.values()])
}

function createRunStyleSignature(style: RunTextStyle): string {
  return [
    style.fontFamily ?? '',
    style.fontSizePx ?? '',
    style.fontSizeTwips ?? '',
    style.bold === true ? 'bold' : 'normal',
    style.italic === true ? 'italic' : 'upright',
    style.color ?? '',
    style.lineHeight ?? ''
  ].join('\u0000')
}

function isEquivalentTextMeasurement(
  left: ReturnType<FontManager['measureText']>,
  right: ReturnType<FontManager['measureText']>
): boolean {
  return left.widthCssPx === right.widthCssPx
    && left.heightCssPx === right.heightCssPx
    && left.baselineCssPx === right.baselineCssPx
    && left.graphemeCount === right.graphemeCount
    && createResolvedFontSignature(left.resolvedFont) === createResolvedFontSignature(right.resolvedFont)
}

function createResolvedFontSignature(style: ResolvedFontStyle): string {
  return [
    style.fontFamily,
    style.requestedFontFamily ?? '',
    style.fontSizePx,
    style.status,
    style.bold === true ? 'bold' : 'normal',
    style.italic === true ? 'italic' : 'upright',
    style.color ?? '',
    style.lineHeight ?? ''
  ].join('\u0000')
}

function resolveDirtyPageIndex(
  input: IncrementalLayoutPassInput,
  previousLayout: DocumentLayout
): number | undefined {
  if (input.dirtyPageIndex !== undefined && Number.isInteger(input.dirtyPageIndex)) {
    if (input.startPosition !== undefined) {
      return Math.max(0, input.dirtyPageIndex)
    }

    return clampPageIndex(input.dirtyPageIndex, previousLayout.pages.length)
  }

  if (input.dirtyRange === undefined) {
    return undefined
  }

  const anchorPageIndex = locatePageIndex(previousLayout, input.dirtyRange.anchor)
  const focusPageIndex = locatePageIndex(previousLayout, input.dirtyRange.focus)

  if (anchorPageIndex === undefined) {
    return focusPageIndex
  }

  if (focusPageIndex === undefined) {
    return anchorPageIndex
  }

  return Math.min(anchorPageIndex, focusPageIndex)
}

function resolveDirtyPageEndIndex(
  input: IncrementalLayoutPassInput,
  previousLayout: DocumentLayout,
  dirtyPageIndex: number
): number {
  if (input.dirtyPageEndIndex !== undefined && Number.isInteger(input.dirtyPageEndIndex)) {
    return clampPageIndex(input.dirtyPageEndIndex, previousLayout.pages.length) ?? dirtyPageIndex
  }

  if (input.dirtyRange === undefined) {
    return dirtyPageIndex
  }

  const anchorPageIndex = locatePageIndex(previousLayout, input.dirtyRange.anchor)
  const focusPageIndex = locatePageIndex(previousLayout, input.dirtyRange.focus)

  if (anchorPageIndex === undefined) {
    return focusPageIndex ?? dirtyPageIndex
  }

  if (focusPageIndex === undefined) {
    return anchorPageIndex
  }

  return Math.max(anchorPageIndex, focusPageIndex)
}

function clampPageIndex(pageIndex: number, pageCount: number): number | undefined {
  if (pageCount === 0) {
    return undefined
  }

  return Math.min(Math.max(pageIndex, 0), pageCount - 1)
}

function finalizeLayoutPages(
  pages: readonly MutablePageBox[],
  incremental?: IncrementalLayoutContext
): readonly PageBox[] {
  const trailingEmptyPage = incremental?.stoppedAtPageIndex === undefined
    ? false
    : isTrailingStoppedPage(pages[pages.length - 1], incremental.stoppedAtPageIndex)
  const activePages = trailingEmptyPage ? pages.slice(0, -1) : pages

  return Object.freeze(activePages.map(freezePage))
}

function resolveReusedSuffixPages(
  incremental?: IncrementalLayoutContext
): readonly PageBox[] {
  if (incremental?.stoppedAtPageIndex === undefined) {
    return Object.freeze([])
  }

  return Object.freeze(incremental.previousLayout.pages.slice(incremental.stoppedAtPageIndex))
}

function isTrailingStoppedPage(
  page: MutablePageBox | undefined,
  stoppedAtPageIndex: number
): boolean {
  return page !== undefined
    && page.pageIndex === stoppedAtPageIndex
    && page.lines.length === 0
    && page.paragraphs.every((paragraph) => paragraph.lines.length === 0)
}

function shouldStopLayoutPass(
  incremental: IncrementalLayoutContext | undefined,
  cursor: LayoutCursor,
  position: TextPosition
): boolean {
  if (shouldStopAtStablePage(incremental, cursor, position)) {
    return true
  }

  return shouldStopAtPageLimit(incremental, cursor, position)
}

function shouldStopAtPageLimit(
  incremental: IncrementalLayoutContext | undefined,
  cursor: LayoutCursor,
  position: TextPosition
): boolean {
  const pageLimit = incremental?.pageLimit

  if (
    incremental === undefined
    || pageLimit === undefined
    || cursor.page.pageIndex < incremental.dirtyPageIndex + pageLimit
    || cursor.page.lines.length > 0
  ) {
    return false
  }

  incremental.stoppedAtPageIndex = cursor.page.pageIndex
  incremental.continuation = Object.freeze({
    dirtyPageIndex: cursor.page.pageIndex,
    dirtyPageEndIndex: incremental.dirtyPageEndIndex,
    startPosition: position
  })

  return true
}

function shouldStopAtStablePage(
  incremental: IncrementalLayoutContext | undefined,
  cursor: LayoutCursor,
  position: TextPosition
): boolean {
  if (
    incremental === undefined
    || cursor.page.pageIndex <= incremental.dirtyPageEndIndex
    || cursor.page.lines.length > 0
  ) {
    return false
  }

  const previousPageStart = getPageStartPosition(incremental.previousLayout.pages[cursor.page.pageIndex])

  if (previousPageStart === undefined || !isSamePosition(previousPageStart, position)) {
    return false
  }

  incremental.stoppedAtPageIndex = cursor.page.pageIndex

  return true
}

function locatePageIndex(
  layout: DocumentLayout,
  position: TextPosition
): number | undefined {
  return locatePosition(layout, position)?.line.pageIndex
}

function getPageStartPosition(page: PageBox | undefined): TextPosition | undefined {
  if (page === undefined) {
    return undefined
  }

  for (const line of page.lines) {
    const fragment = line.fragments[0]

    if (fragment !== undefined) {
      return fragment.start
    }
  }

  return undefined
}

function sliceProjectionFromPosition(
  projection: DocumentProjection,
  start: TextPosition
): DocumentProjection | undefined {
  const sections = projection.document.sections
  const startSectionIndex = findSectionIndex(sections, start.sectionId)

  if (startSectionIndex < 0) {
    return undefined
  }

  const slicedSections = sections.slice(startSectionIndex).flatMap((section, sectionOffset) => {
    if (sectionOffset > 0) {
      return [section]
    }

    const startBlockIndex = findBlockIndex(section.blocks, start.blockId)

    if (startBlockIndex < 0) {
      return []
    }

    const slicedBlocks = section.blocks.slice(startBlockIndex).flatMap((block, blockOffset) => {
      if (blockOffset > 0) {
        return [block]
      }

      if (block.kind !== 'paragraph') {
        return []
      }

      const slicedParagraph = sliceParagraphFromPosition(block, start)

      return slicedParagraph === undefined ? [] : [slicedParagraph]
    })

    if (slicedBlocks.length === 0) {
      return []
    }

    return [{
      ...section,
      blocks: Object.freeze(slicedBlocks)
    }]
  })

  if (slicedSections.length === 0) {
    return undefined
  }

  return {
    document: {
      ...projection.document,
      sections: Object.freeze(slicedSections)
    }
  }
}

function findSectionIndex(
  sections: readonly { readonly id: string }[],
  sectionId: string
): number {
  return sections.findIndex((section) => section.id === sectionId)
}

function findBlockIndex(
  blocks: readonly Block[],
  blockId: string
): number {
  return blocks.findIndex((block) => block.id === blockId)
}

function sliceParagraphFromPosition(
  paragraph: Paragraph,
  start: TextPosition
): Paragraph | undefined {
  const startRunIndex = paragraph.runs.findIndex((run) => run.id === start.runId)

  if (startRunIndex < 0) {
    return undefined
  }

  const slicedRuns = paragraph.runs.slice(startRunIndex).flatMap((run, runOffset) => {
    if (runOffset > 0) {
      return [run]
    }

    const slicedRun = sliceRunFromPosition(run, start.graphemeIndex)

    return slicedRun === undefined ? [] : [slicedRun]
  })

  if (slicedRuns.length === 0) {
    return undefined
  }

  return {
    ...paragraph,
    runs: Object.freeze(slicedRuns)
  }
}

function sliceRunFromPosition(
  run: Run,
  startGraphemeIndex: number
): Run | undefined {
  const slicedInlines: Inline[] = []
  let remainingGraphemeIndex = startGraphemeIndex
  let started = false

  for (const inline of run.inlines) {
    if (started) {
      slicedInlines.push(inline)
      continue
    }

    if (inline.kind !== 'text') {
      continue
    }

    const segments = segmentGraphemes(inline.text)

    if (remainingGraphemeIndex >= segments.length) {
      remainingGraphemeIndex -= segments.length
      continue
    }

    started = true
    slicedInlines.push({
      ...inline,
      text: segments.slice(remainingGraphemeIndex).map((segment) => segment.segment).join('')
    })
  }

  if (!started) {
    return undefined
  }

  return {
    ...run,
    inlines: Object.freeze(slicedInlines)
  }
}

function layoutBlock(
  block: Block,
  section: Section,
  input: LayoutInput,
  cursor: LayoutCursor,
  pages: MutablePageBox[],
  incremental?: IncrementalLayoutContext
): boolean {
  assignPageSectionBoundary(cursor.page, section)

  if (block.kind === 'table') {
    layoutTable(block, section, cursor, pages, input.pageConfig)
    return false
  }

  if (block.kind !== 'paragraph') {
    return false
  }

  startParagraph(cursor, section.id, block, input.pageConfig)

  for (const run of block.runs) {
    if (layoutRun(run, section, block, input, cursor, pages, incremental)) {
      return true
    }
  }

  flushLine(cursor)

  return false
}

function layoutRun(
  run: Run,
  section: Section,
  paragraph: Paragraph,
  input: LayoutInput,
  cursor: LayoutCursor,
  pages: MutablePageBox[],
  incremental?: IncrementalLayoutContext
): boolean {
  const sectionId = section.id
  const style = readRunStyle(run.properties)
  let runGraphemeIndex = resolveRunStartGraphemeIndex(incremental, sectionId, paragraph.id, run.id)

  for (const inline of run.inlines) {
    if (inline.kind === 'text') {
      for (const segment of segmentGraphemes(inline.text)) {
        if (
          shouldStopLayoutPass(incremental, cursor, {
            sectionId,
            blockId: paragraph.id,
            runId: run.id,
            graphemeIndex: runGraphemeIndex
          })
        ) {
          return true
        }

        const measurement = input.fontManager.measureText(segment.segment, style)
        const width = cssPxToTwips(measurement.widthCssPx)
        const height = cssPxToTwips(measurement.heightCssPx)
        const baseline = cssPxToTwips(measurement.baselineCssPx)

        ensureLineFits(width, height, cursor, pages, input.pageConfig, section, paragraph)

        if (
          shouldStopLayoutPass(incremental, cursor, {
            sectionId,
            blockId: paragraph.id,
            runId: run.id,
            graphemeIndex: runGraphemeIndex
          })
        ) {
          return true
        }

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
          style: measurement.resolvedFont
        })
        runGraphemeIndex += 1
      }
    } else {
      layoutInlineBoundary(inline, section, paragraph, run.id, runGraphemeIndex, cursor, pages, input.pageConfig)
    }
  }

  return false
}

function resolveRunStartGraphemeIndex(
  incremental: IncrementalLayoutContext | undefined,
  sectionId: string,
  paragraphId: string,
  runId: string
): number {
  const sourceStartPosition = incremental?.sourceStartPosition

  if (
    sourceStartPosition === undefined
    || sourceStartPosition.sectionId !== sectionId
    || sourceStartPosition.blockId !== paragraphId
    || sourceStartPosition.runId !== runId
  ) {
    return 0
  }

  return sourceStartPosition.graphemeIndex
}

function layoutInlineBoundary(
  inline: Inline,
  section: Section,
  paragraph: Paragraph,
  runId: string,
  graphemeIndex: number,
  cursor: LayoutCursor,
  pages: MutablePageBox[],
  pageConfig: PageConfig
): void {
  const sectionId = section.id

  if (inline.kind !== 'break') {
    if (inline.kind !== 'text') {
      appendNonTextInlineBox(inline, sectionId, paragraph.id, runId, graphemeIndex, cursor, pageConfig)
    }
    return
  }

  if (inline.breakType === 'line') {
    flushLine(cursor)
    return
  }

  if (inline.breakType !== 'page') {
    return
  }

  const line = ensureLine(cursor, sectionId, paragraph, pageConfig)
  const pageBreak: PageBreakBox = {
    kind: 'pageBreak',
    pageIndex: cursor.page.pageIndex,
    sectionId,
    blockId: paragraph.id,
    runId,
    at: {
      sectionId,
      blockId: paragraph.id,
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
  assignPageSectionBoundary(cursor.page, section)
  startParagraph(cursor, sectionId, paragraph, pageConfig)
}

function layoutTable(
  table: Table,
  section: Section,
  cursor: LayoutCursor,
  pages: MutablePageBox[],
  pageConfig: PageConfig
): void {
  flushLine(cursor)

  const tableHeight = Math.max(cssPxToTwips(24), table.rows.length * cssPxToTwips(24))

  if (cursor.y + tableHeight > cursor.page.contentRect.y + cursor.page.contentRect.height) {
    startNewPage(cursor, pages, pageConfig)
    assignPageSectionBoundary(cursor.page, section)
  }

  const tableBox: TableBox = Object.freeze({
    kind: 'table',
    pageIndex: cursor.page.pageIndex,
    sectionId: section.id,
    tableId: table.id,
    grid: Object.freeze([...(table.grid ?? [])]),
    rowCount: table.rows.length,
    cellCount: table.rows.reduce((count, row) => count + row.cells.length, 0),
    rows: Object.freeze(table.rows.map((row) => Object.freeze({
      rowId: row.id,
      cells: Object.freeze(row.cells.map((cell) => Object.freeze({
        cellId: cell.id,
        gridSpan: cell.gridSpan ?? 1,
        blockIds: Object.freeze(cell.blocks.map((block) => block.id))
      })))
    }))),
    x: cursor.page.contentRect.x,
    y: cursor.y,
    width: cursor.page.contentRect.width,
    height: tableHeight
  })

  cursor.page.blocks.push(tableBox)
  cursor.y += tableHeight
  cursor.x = cursor.page.contentRect.x
}

function appendNonTextInlineBox(
  inline: Exclude<Inline, { readonly kind: 'text' | 'break' }>,
  sectionId: string,
  blockId: string,
  runId: string,
  graphemeIndex: number,
  cursor: LayoutCursor,
  pageConfig: PageConfig
): void {
  const line = ensureLine(cursor, sectionId, {
    kind: 'paragraph',
    id: blockId,
    runs: []
  }, pageConfig)
  const at = {
    sectionId,
    blockId,
    runId,
    graphemeIndex
  } satisfies TextPosition
  const inlineBox: NonTextInlineBox = Object.freeze({
    kind: 'inlineObject',
    inlineKind: inline.kind,
    payload: createInlineObjectPayload(inline),
    pageIndex: cursor.page.pageIndex,
    sectionId,
    blockId,
    runId,
    at,
    x: cursor.x,
    y: line.y,
    width: 0,
    height: Math.max(line.height, cssPxToTwips(16))
  })

  line.inlines.push(inlineBox)
  line.height = Math.max(line.height, inlineBox.height)
  cursor.x += inlineBox.width
}

function startParagraph(
  cursor: LayoutCursor,
  sectionId: string,
  paragraph: Paragraph,
  pageConfig: PageConfig
): void {
  if (cursor.paragraph?.paragraphId === paragraph.id && cursor.paragraph.pageIndex === cursor.page.pageIndex) {
    return
  }

  const x = pageConfig.marginTwips.left
  const y = cursor.y
  const paragraphBox: MutableParagraphBox = {
    kind: 'paragraph',
    pageIndex: cursor.page.pageIndex,
    sectionId,
    paragraphId: paragraph.id,
    x,
    y,
    width: 0,
    height: 0,
    lines: [],
    pageBreakPolicy: resolveParagraphPageBreakPolicy(paragraph)
  }

  cursor.page.paragraphs.push(paragraphBox)
  cursor.page.blocks.push(paragraphBox)
  cursor.paragraph = paragraphBox
}

function ensureLineFits(
  nextWidth: number,
  nextHeight: number,
  cursor: LayoutCursor,
  pages: MutablePageBox[],
  pageConfig: PageConfig,
  section: Section,
  paragraph: Paragraph
): void {
  const contentRight = pageConfig.marginTwips.left + pageConfig.contentWidthTwips

  if (cursor.line !== undefined && cursor.line.fragments.length > 0 && cursor.x + nextWidth > contentRight) {
    flushLine(cursor)
  }

  if (cursor.y + nextHeight > cursor.page.contentRect.y + cursor.page.contentRect.height) {
    startNewPage(cursor, pages, pageConfig)
    assignPageSectionBoundary(cursor.page, section)
    startParagraph(cursor, section.id, paragraph, pageConfig)
  }

  ensureLine(cursor, section.id, paragraph, pageConfig)
}

function ensureLine(
  cursor: LayoutCursor,
  sectionId: string,
  paragraph: Paragraph,
  pageConfig: PageConfig
): MutableLineBox {
  if (cursor.line !== undefined) {
    return cursor.line
  }

  startParagraph(cursor, sectionId, paragraph, pageConfig)

  const line: MutableLineBox = {
    kind: 'line',
    pageIndex: cursor.page.pageIndex,
    sectionId,
    paragraphId: paragraph.id,
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
  style: ResolvedFontStyle
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

  const page = createPage(cursor.page.pageIndex + 1, pageConfig)

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
    sectionBoundary: 'single',
    sectionIds: [],
    headerIds: Object.freeze([]),
    footerIds: Object.freeze([]),
    lines: [],
    paragraphs: [],
    blocks: [],
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
  const frozenParagraphs = page.paragraphs.map((paragraph) => Object.freeze({
    ...paragraph,
    lines: Object.freeze(paragraph.lines),
    pageBreakPolicy: Object.freeze(paragraph.pageBreakPolicy)
  }))
  const frozenParagraphById = new Map(frozenParagraphs.map((paragraph) => [paragraph.paragraphId, paragraph]))

  return Object.freeze({
    ...page,
    sectionIds: Object.freeze([...page.sectionIds]),
    headerIds: Object.freeze([...page.headerIds]),
    footerIds: Object.freeze([...page.footerIds]),
    lines: Object.freeze(page.lines),
    paragraphs: Object.freeze(frozenParagraphs),
    blocks: Object.freeze(page.blocks.map((block) =>
      block.kind === 'paragraph'
        ? frozenParagraphById.get(block.paragraphId) ?? block
        : block
    )),
    contentRect: Object.freeze(page.contentRect),
    ...(page.pageLayout === undefined ? {} : { pageLayout: freezeSectionPageLayout(page.pageLayout) })
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
    graphemeIndex,
    ...(graphemeIndex === fragment.end.graphemeIndex ? { assoc: -1 } : {})
  }
}

function locatePosition(
  layout: DocumentLayout,
  position: TextPosition
): Readonly<{
  line: LineBox
  fragment?: TextFragment
  inline?: InlineBox
}> | undefined {
  const candidates: Array<Readonly<{
    line: LineBox
    fragment?: TextFragment
    inline?: InlineBox
  }>> = []

  for (const page of layout.pages) {
    for (const line of page.lines) {
      for (const fragment of line.fragments) {
        if (containsPosition(fragment, position)) {
          candidates.push({
            line,
            fragment
          })
        }
      }

      for (const inline of line.inlines) {
        if (
          inline.at.sectionId === position.sectionId &&
          inline.at.blockId === position.blockId &&
          inline.at.runId === position.runId &&
          inline.at.graphemeIndex === position.graphemeIndex
        ) {
          candidates.push({
            line,
            inline
          })
        }
      }
    }
  }

  if (candidates.length === 0) {
    return undefined
  }

  return position.assoc !== undefined && position.assoc < 0
    ? candidates[0]
    : candidates[candidates.length - 1]
}

function assignPageSectionBoundary(page: MutablePageBox, section: Section): void {
  if (page.sectionIds[page.sectionIds.length - 1] === section.id) {
    return
  }

  page.sectionIds.push(section.id)

  if (page.sectionIds.length === 1) {
    page.sectionBoundary = 'single'
    page.sectionId = section.id
    page.pageLayout = section.page
    page.headerIds = section.headerIds ?? Object.freeze([])
    page.footerIds = section.footerIds ?? Object.freeze([])
    return
  }

  page.sectionBoundary = 'mixed'
  delete page.sectionId
  delete page.pageLayout
  page.headerIds = Object.freeze([])
  page.footerIds = Object.freeze([])
}

function createInlineObjectPayload(
  inline: Exclude<Inline, { readonly kind: 'text' | 'break' }>
): InlineObjectPayload {
  switch (inline.kind) {
    case 'bookmark':
      return Object.freeze({
        id: inline.id,
        name: inline.name,
        edge: inline.edge
      })
    case 'image':
      return Object.freeze({
        resourceId: inline.resourceId,
        ...(inline.alt === undefined ? {} : { alt: inline.alt })
      })
    case 'commentRangeMarker':
      return Object.freeze({
        commentId: inline.commentId,
        edge: inline.edge
      })
  }
}

function freezeSectionPageLayout(pageLayout: Section['page']): Section['page'] {
  return Object.freeze({
    ...pageLayout,
    ...(pageLayout?.marginTwips === undefined
      ? {}
      : {
          marginTwips: Object.freeze({
            ...pageLayout.marginTwips
          })
        })
  })
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

function resolveParagraphPageBreakPolicy(paragraph: Paragraph): ParagraphPageBreakPolicy {
  const widowControl = readBooleanProperty(paragraph.properties, 'widowControl') ?? true
  const orphanLines = readNumberProperty(paragraph.properties, 'orphanLines') ?? 2
  const widowLines = readNumberProperty(paragraph.properties, 'widowLines') ?? 2

  return Object.freeze({
    widowControl,
    orphanLines,
    widowLines
  })
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
