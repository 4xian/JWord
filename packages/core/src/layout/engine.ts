/**
 * 职责：执行纯数据分页 layout 主流程并生成 DocumentLayout。
 * 边界：只读取投影、页面配置和字体度量，不访问 DOM、不绘制 Canvas。
 * 协作模块：incremental 决定重排范围，internal 负责页面盒构造，query 负责后续几何查询。
 * 性能/安全约束：同步最小实现，保留 viewport 和脏范围输入边界，不创建浏览器资源。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/03-architecture.md#36-layout-engine。
 */

import { cssPxToTwips } from './page-config'
import { measureLayoutTextSegment, measureTextSegmentForLayout, segmentTextForLayout } from './text-segments'
import type { Block, Inline, Paragraph, Run, Section, Table } from '../model/types'
import type { PageConfig } from './page-config'
import type { TextPosition } from '../operations/transaction'
import {
  createDerivedLayoutInput,
  createIncrementalLayoutContext,
  finalizeLayoutPages,
  resolveReusedSuffixPages,
  shouldStopLayoutPass
} from './incremental'
import {
  assignPageSectionBoundary,
  createDebugOverlay,
  createPage,
  readRunStyle
} from './internal'
import {
  appendEmptyTextAnchor,
  appendNonTextInlineBox,
  appendTextFragment,
  ensureLine,
  ensureLineFits,
  flushLine,
  startNewPage,
  startParagraph
} from './paragraph-flow'
import type {
  DocumentLayout,
  IncrementalLayoutContext,
  IncrementalLayoutPassInput,
  LayoutCursor,
  LayoutInput,
  MutablePageBox,
  PageBreakBox,
  TableBox
} from './types'

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

  ensureEmptyParagraphVisible(block, section, input, cursor, pages)
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
      for (const segment of segmentTextForLayout(inline.text, runGraphemeIndex)) {
        if (
          shouldStopLayoutPass(incremental, cursor, {
            sectionId,
            blockId: paragraph.id,
            runId: run.id,
            graphemeIndex: segment.startGraphemeIndex
          })
        ) {
          return true
        }

        if (input.layoutOptions?.keepLatinWordWholeOnWrap === true && isLatinWordSegment(segment.text)) {
          flushLineBeforeWrappedWordSegment({
            segment,
            style,
            layoutInput: input,
            cursor
          })
        }

        const measuredSegments = measureTextSegmentForLayout({
          fontManager: input.fontManager,
          segment,
          style,
          maxWidth: readSegmentMeasureMaxWidth({
            segment,
            layoutInput: input,
            cursor
          })
        })

        for (const measured of measuredSegments) {
          ensureLineFits(measured.width, measured.height, cursor, pages, input.pageConfig, section, paragraph)

          if (
            shouldStopLayoutPass(incremental, cursor, {
              sectionId,
              blockId: paragraph.id,
              runId: run.id,
              graphemeIndex: measured.startGraphemeIndex
            })
          ) {
            return true
          }

          appendTextFragment({
            cursor,
            sectionId,
            paragraphId: paragraph.id,
            runId: run.id,
            text: measured.text,
            startGraphemeIndex: measured.startGraphemeIndex,
            endGraphemeIndex: measured.endGraphemeIndex,
            width: measured.width,
            height: measured.height,
            baseline: measured.baseline,
            style: measured.style,
            advanceTwips: measured.advanceTwips
          })
        }

        runGraphemeIndex = segment.endGraphemeIndex
      }
    } else {
      layoutInlineBoundary(inline, section, paragraph, run.id, runGraphemeIndex, cursor, pages, input.pageConfig)
    }
  }

  return false
}

/**
 * 纯空段落也要保留一条零宽文本锚点行，否则 Enter 后不会出现可见空行，caret 也无法定位。
 */
function ensureEmptyParagraphVisible(
  paragraph: Paragraph,
  section: Section,
  input: LayoutInput,
  cursor: LayoutCursor,
  pages: MutablePageBox[]
): void {
  if (cursor.paragraph?.paragraphId !== paragraph.id || cursor.paragraph.lines.length > 0) {
    return
  }

  if (!isVisuallyEmptyParagraph(paragraph)) {
    return
  }

  const firstRun = paragraph.runs[0]

  if (firstRun === undefined) {
    return
  }

  const measurement = input.fontManager.measureText('', readRunStyle(firstRun.properties))
  const height = cssPxToTwips(measurement.heightCssPx)
  const baseline = cssPxToTwips(measurement.baselineCssPx)

  ensureLineFits(0, height, cursor, pages, input.pageConfig, section, paragraph)
  appendEmptyTextAnchor({
    cursor,
    sectionId: section.id,
    paragraphId: paragraph.id,
    runId: firstRun.id,
    height,
    baseline,
    pageConfig: input.pageConfig
  })
}

/**
 * 只有所有 inline 都是空文本时，才把段落视为需要补可见空行的“纯空段落”。
 */
function isVisuallyEmptyParagraph(paragraph: Paragraph): boolean {
  for (const run of paragraph.runs) {
    for (const inline of run.inlines) {
      if (inline.kind !== 'text' || inline.text.length > 0) {
        return false
      }
    }
  }

  return true
}

/**
 * 在开启整词换行时，若当前行剩余空间放不下拉丁单词，则先整体换到下一行。
 */
function flushLineBeforeWrappedWordSegment(input: Readonly<{
  segment: ReturnType<typeof segmentTextForLayout>[number]
  style: ReturnType<typeof readRunStyle>
  layoutInput: LayoutInput
  cursor: LayoutCursor
}>): void {
  const line = input.cursor.line

  if (line === undefined || line.fragments.length === 0) {
    return
  }

  const measured = measureLayoutTextSegment({
    fontManager: input.layoutInput.fontManager,
    segment: input.segment,
    style: input.style
  })
  const contentRight = input.cursor.page.contentRect.x + input.cursor.page.contentRect.width

  if (input.cursor.x + measured.width > contentRight) {
    flushLine(input.cursor)
  }
}

/**
 * 在默认模式下，优先使用当前行剩余宽度来拆分拉丁单词，避免整词过早挪到下一行。
 */
function readSegmentMeasureMaxWidth(input: Readonly<{
  segment: ReturnType<typeof segmentTextForLayout>[number]
  layoutInput: LayoutInput
  cursor: LayoutCursor
}>): number {
  if (
    input.layoutInput.layoutOptions?.keepLatinWordWholeOnWrap === true
    || !isLatinWordSegment(input.segment.text)
  ) {
    return input.layoutInput.pageConfig.contentWidthTwips
  }

  const line = input.cursor.line

  if (line === undefined || (line.fragments.length === 0 && line.inlines.length === 0)) {
    return input.layoutInput.pageConfig.contentWidthTwips
  }

  const contentRight = input.cursor.page.contentRect.x + input.cursor.page.contentRect.width

  return Math.max(0, contentRight - input.cursor.x)
}

/**
 * 判断当前布局片段是否是可按整词处理的拉丁单词。
 */
function isLatinWordSegment(text: string): boolean {
  return /^[\p{Letter}\p{Number}]+$/u.test(text)
    && !/\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u.test(text)
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
