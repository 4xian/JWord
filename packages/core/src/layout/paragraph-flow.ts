/**
 * 职责：维护 layout engine 的段落、行盒和文本片段流式追加。
 * 边界：只服务纯数据 layout，不读取 projection、不绘制 Canvas、不访问 DOM。
 * 协作模块：engine 负责遍历文档结构，本模块负责段落缩进、对齐、换页和行内盒追加。
 * 性能/安全约束：所有 helper 只修改当前 layout cursor，不保留跨次布局状态。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/03-architecture.md#36-layout-engine。
 */

import { cssPxToTwips } from './page-config'
import {
  assignPageSectionBoundary,
  createInlineObjectPayload,
  createPage,
  freezeLine,
  resolveParagraphPageBreakPolicy
} from './internal'
import type { ResolvedFontStyle } from './font-manager'
import {
  resolveParagraphLayoutProperties,
  resolveParagraphList,
  resolveParagraphListBulletLabel,
  resolveParagraphListKind,
  resolveParagraphListLevel
} from './paragraph-semantics'
import type { Inline, Paragraph, Section } from '../model/types'
import type { PageConfig } from './page-config'
import type { TextPosition } from '../operations/transaction'
import type { Resource } from '../resources/types'
import type {
  EmptyTextAnchorBox,
  InlineBox,
  LineBox,
  LayoutCursor,
  MutableLineBox,
  MutablePageBox,
  MutableParagraphBox,
  NonTextInlineBox,
  TextFragment
} from './types'

export function appendNonTextInlineBox(
  inline: Exclude<Inline, { readonly kind: 'text' | 'break' }>,
  sectionId: string,
  blockId: string,
  runId: string,
  graphemeIndex: number,
  cursor: LayoutCursor,
  pageConfig: PageConfig,
  resourceById?: ReadonlyMap<string, Resource>
): void {
  const line = ensureLine(cursor, sectionId, {
    kind: 'paragraph',
    id: blockId,
    runs: []
  }, pageConfig)
  const geometry = resolveInlineObjectGeometry(inline, pageConfig, line.height)
  const at = {
    sectionId,
    blockId,
    runId,
    graphemeIndex
  } satisfies TextPosition
  const inlineBox: NonTextInlineBox = Object.freeze({
    kind: 'inlineObject',
    inlineKind: inline.kind,
    payload: createInlineObjectPayload(inline, resourceById),
    pageIndex: cursor.page.pageIndex,
    sectionId,
    blockId,
    runId,
    at,
    x: cursor.x,
    y: line.y,
    width: geometry.width,
    height: geometry.height
  })

  line.inlines.push(inlineBox)
  line.height = Math.max(line.height, inlineBox.height)
  cursor.x += inlineBox.width
}

export function resolveInlineObjectGeometry(
  inline: Exclude<Inline, { readonly kind: 'text' | 'break' }>,
  pageConfig: PageConfig,
  lineHeight: number
): Readonly<{
  width: number
  height: number
}> {
  if (inline.kind !== 'image') {
    return Object.freeze({
      width: 0,
      height: Math.max(lineHeight, cssPxToTwips(16))
    })
  }

  const fallbackWidth = Math.min(pageConfig.contentWidthTwips, cssPxToTwips(160))
  const width = inline.widthTwips ?? fallbackWidth
  const height = inline.heightTwips ?? Math.max(cssPxToTwips(64), Math.round(width * 0.56))

  return Object.freeze({
    width,
    height
  })
}

/**
 * 为纯空文本段落追加一个零宽锚点，保证空行可见且 caret 可以命中。
 */
export function appendEmptyTextAnchor(input: Readonly<{
  cursor: LayoutCursor
  sectionId: string
  paragraphId: string
  runId: string
  height: number
  baseline: number
  pageConfig: PageConfig
}>): void {
  const line = ensureLine(input.cursor, input.sectionId, {
    kind: 'paragraph',
    id: input.paragraphId,
    runs: []
  }, input.pageConfig)
  const inlineBox: EmptyTextAnchorBox = Object.freeze({
    kind: 'emptyTextAnchor',
    pageIndex: input.cursor.page.pageIndex,
    sectionId: input.sectionId,
    blockId: input.paragraphId,
    runId: input.runId,
    at: {
      sectionId: input.sectionId,
      blockId: input.paragraphId,
      runId: input.runId,
      graphemeIndex: 0
    },
    x: input.cursor.x,
    y: line.y,
    width: 0,
    height: input.height,
    baseline: line.y + input.baseline
  })

  line.inlines.push(inlineBox)
  line.height = Math.max(line.height, input.height)
  line.baseline = Math.max(line.baseline, line.y + input.baseline)
}

export function startParagraph(
  cursor: LayoutCursor,
  sectionId: string,
  paragraph: Paragraph,
  pageConfig: PageConfig
): void {
  if (cursor.paragraph?.paragraphId === paragraph.id && cursor.paragraph.pageIndex === cursor.page.pageIndex) {
    return
  }

  const layoutProperties = resolveParagraphLayoutProperties(paragraph)
  const indentLeftTwips = layoutProperties.indentLeftTwips
  const firstLineIndentTwips = layoutProperties.firstLineIndentTwips
  const hangingIndentTwips = layoutProperties.hangingIndentTwips
  const spacingBeforeTwips = layoutProperties.spacingBeforeTwips
  const spacingAfterTwips = layoutProperties.spacingAfterTwips
  const x = pageConfig.marginTwips.left + Math.max(0, indentLeftTwips)
  const paragraphBox: MutableParagraphBox = {
    kind: 'paragraph',
    pageIndex: cursor.page.pageIndex,
    sectionId,
    paragraphId: paragraph.id,
    alignment: layoutProperties.alignment,
    indentLeftTwips,
    firstLineIndentTwips,
    hangingIndentTwips,
    spacingBeforeTwips,
    spacingAfterTwips,
    x,
    y: cursor.y,
    width: 0,
    height: 0,
    lines: [],
    pageBreakPolicy: resolveParagraphPageBreakPolicy(paragraph)
  }

  if (resolveParagraphList(paragraph) !== undefined && readParagraphLineCount(cursor, paragraph.id) === 0) {
    const listMarker = resolveParagraphListMarker(cursor, paragraph, layoutProperties.markerGapTwips)

    if (listMarker !== undefined) {
      paragraphBox.listMarker = listMarker
    }
  }

  cursor.page.paragraphs.push(paragraphBox)
  cursor.page.blocks.push(paragraphBox)
  cursor.paragraph = paragraphBox
}

/**
 * 应用段前距。
 */
export function applyParagraphSpacingBefore(cursor: LayoutCursor): void {
  if (cursor.paragraph === undefined || cursor.paragraph.spacingBeforeTwips <= 0) {
    return
  }

  cursor.y += cursor.paragraph.spacingBeforeTwips
  cursor.paragraph.y = cursor.y
}

/**
 * 应用段后距。
 */
export function applyParagraphSpacingAfter(cursor: LayoutCursor): void {
  if (cursor.paragraph === undefined || cursor.paragraph.spacingAfterTwips <= 0) {
    return
  }

  cursor.y += cursor.paragraph.spacingAfterTwips
  cursor.paragraph.height += cursor.paragraph.spacingAfterTwips
}

export function ensureLineFits(
  nextWidth: number,
  nextHeight: number,
  cursor: LayoutCursor,
  pages: MutablePageBox[],
  pageConfig: PageConfig,
  section: Section,
  paragraph: Paragraph
): void {
  const contentRight = cursor.page.contentRect.x + cursor.page.contentRect.width

  if (
    cursor.line !== undefined
    && (cursor.line.fragments.length > 0 || cursor.line.inlines.length > 0)
    && cursor.x + nextWidth > contentRight
  ) {
    flushLine(cursor, { justify: true })
  }

  if (cursor.y + nextHeight > cursor.page.contentRect.y + cursor.page.contentRect.height) {
    if (moveOrphanLinesToNextPage(cursor, pages, pageConfig, section)) {
      ensureLine(cursor, section.id, paragraph, pageConfig)
      return
    }

    discardEmptyCurrentParagraph(cursor)
    startNewPage(cursor, pages, pageConfig)
    assignPageSectionBoundary(cursor.page, section, cursor.sectionContext)
    startParagraph(cursor, section.id, paragraph, pageConfig)
  }

  ensureLine(cursor, section.id, paragraph, pageConfig)
}

/**
 * 在段落完成后执行 widow 控制，避免续排页只留下过少段尾行。
 */
export function applyParagraphWidowControl(cursor: LayoutCursor, pages: MutablePageBox[]): void {
  const currentParagraph = cursor.paragraph

  if (
    currentParagraph === undefined
    || currentParagraph.pageBreakPolicy.widowControl !== true
    || currentParagraph.lines.length >= currentParagraph.pageBreakPolicy.widowLines
  ) {
    return
  }

  const previousPage = findPreviousParagraphPage(pages, cursor.page, currentParagraph.paragraphId)
  const previousParagraph = previousPage?.paragraphs.find((paragraph) =>
    paragraph.paragraphId === currentParagraph.paragraphId
  )

  if (previousPage === undefined || previousParagraph === undefined) {
    return
  }

  const movableCount = previousParagraph.lines.length - currentParagraph.pageBreakPolicy.orphanLines
  const requestedCount = currentParagraph.pageBreakPolicy.widowLines - currentParagraph.lines.length
  const moveCount = Math.min(movableCount, requestedCount)

  if (moveCount <= 0) {
    return
  }

  const movedSourceLines = previousParagraph.lines.slice(previousParagraph.lines.length - moveCount)
  const remainingPreviousLines = previousParagraph.lines.slice(0, previousParagraph.lines.length - moveCount)
  const insertY = currentParagraph.y
  let nextY = insertY
  const movedLines = movedSourceLines.map((line) => {
    const movedLine = cloneLineForPage(line, cursor.page.pageIndex, insertY - line.y + (nextY - insertY))

    nextY += movedLine.height
    return movedLine
  })
  const shiftY = nextY - insertY
  const shiftedCurrentLines = currentParagraph.lines.map((line) => cloneLineForPage(line, cursor.page.pageIndex, shiftY))

  previousParagraph.lines = remainingPreviousLines
  previousParagraph.height = resolveParagraphHeight(previousParagraph)
  previousPage.lines = previousPage.lines.filter((line) => !movedSourceLines.includes(line))

  currentParagraph.lines = [...movedLines, ...shiftedCurrentLines]
  currentParagraph.height = resolveParagraphHeight(currentParagraph)
  cursor.page.lines = [
    ...cursor.page.lines.filter((line) => line.paragraphId !== currentParagraph.paragraphId),
    ...currentParagraph.lines
  ]
  cursor.y += shiftY
}

export function ensureLine(
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
    x: cursor.paragraph === undefined
      ? pageConfig.marginTwips.left
      : resolveParagraphLineX(cursor, cursor.paragraph),
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

export function appendTextFragment(input: Readonly<{
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
  advanceTwips: readonly number[]
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
    advanceTwips: input.advanceTwips
  })

  line.fragments.push(fragment)
  line.width = fragment.x + fragment.width - line.x
  line.height = Math.max(line.height, fragment.height)
  line.baseline = Math.max(line.baseline, fragment.baseline)
  input.cursor.x += input.width
}

interface FlushLineOptions {
  readonly justify?: boolean
}

export function flushLine(cursor: LayoutCursor, options: FlushLineOptions = {}): void {
  if (cursor.line === undefined) {
    return
  }

  const line = cursor.line

  if (line.fragments.length > 0 || line.inlines.length > 0) {
    alignLineContentToBaseline(line)
    alignLineToParagraph(line, cursor, options.justify === true)
    const frozenLine = freezeLine(line)

    cursor.page.lines.push(frozenLine)
    cursor.paragraph?.lines.push(frozenLine)
    recordParagraphLine(cursor, frozenLine.paragraphId)
    cursor.y += Math.max(line.height, 1)

    if (cursor.paragraph !== undefined) {
      cursor.paragraph.width = Math.max(
        cursor.paragraph.width,
        frozenLine.x + frozenLine.width - cursor.paragraph.x
      )
      cursor.paragraph.height = cursor.y - cursor.paragraph.y
    }
  }

  cursor.line = undefined
  cursor.x = cursor.paragraph?.x ?? cursor.page.contentRect.x
}

/**
 * 行内图片默认按底部参与基线，这里在冻结前统一重排文本/图片纵向位置。
 */
function alignLineContentToBaseline(line: MutableLineBox): void {
  const targetBaseline = resolveTargetBaseline(line)
  let maxBottom = line.y

  line.baseline = targetBaseline

  for (let index = 0; index < line.fragments.length; index += 1) {
    const fragment = line.fragments[index]

    if (fragment === undefined) {
      continue
    }

    const offsetY = targetBaseline - fragment.baseline
    const nextFragment = offsetY === 0
      ? fragment
      : Object.freeze({
          ...fragment,
          y: fragment.y + offsetY,
          baseline: fragment.baseline + offsetY
        })

    line.fragments[index] = nextFragment
    maxBottom = Math.max(maxBottom, nextFragment.y + nextFragment.height)
  }

  for (let index = 0; index < line.inlines.length; index += 1) {
    const inline = line.inlines[index]

    if (inline === undefined) {
      continue
    }

    const nextInline = alignInlineBoxToBaseline(inline, targetBaseline)

    line.inlines[index] = nextInline
    maxBottom = Math.max(maxBottom, nextInline.y + nextInline.height)
  }

  line.height = Math.max(1, maxBottom - line.y)
}

/** 移除被整体挪到下一页的空段落盒，避免段前距在上一页留下不可见块。 */
function discardEmptyCurrentParagraph(cursor: LayoutCursor): void {
  const paragraph = cursor.paragraph

  if (paragraph === undefined || paragraph.lines.length > 0) {
    return
  }

  const paragraphIndex = cursor.page.paragraphs.indexOf(paragraph)

  if (paragraphIndex >= 0) {
    cursor.page.paragraphs.splice(paragraphIndex, 1)
  }

  const blockIndex = cursor.page.blocks.indexOf(paragraph)

  if (blockIndex >= 0) {
    cursor.page.blocks.splice(blockIndex, 1)
  }

  cursor.paragraph = undefined
  cursor.line = undefined
}

function resolveTargetBaseline(line: MutableLineBox): number {
  let baseline = line.baseline

  for (const inline of line.inlines) {
    baseline = Math.max(baseline, readInlineBoxBaseline(inline))
  }

  return baseline
}

function readInlineBoxBaseline(inline: InlineBox): number {
  if (inline.kind === 'emptyTextAnchor') {
    return inline.baseline
  }

  if (inline.kind === 'inlineObject' && inline.inlineKind === 'image') {
    return inline.y + inline.height
  }

  return inline.y + inline.height
}

function alignInlineBoxToBaseline(inline: InlineBox, targetBaseline: number): InlineBox {
  if (inline.kind === 'emptyTextAnchor') {
    const offsetY = targetBaseline - inline.baseline

    if (offsetY === 0) {
      return inline
    }

    return Object.freeze({
      ...inline,
      y: inline.y + offsetY,
      baseline: inline.baseline + offsetY
    })
  }

  if (inline.kind === 'inlineObject' && inline.inlineKind === 'image') {
    const offsetY = targetBaseline - (inline.y + inline.height)

    if (offsetY === 0) {
      return inline
    }

    return Object.freeze({
      ...inline,
      y: inline.y + offsetY
    })
  }

  return inline
}

export function startNewPage(
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

function alignLineToParagraph(line: MutableLineBox, cursor: LayoutCursor, shouldJustifyLine: boolean): void {
  const paragraph = cursor.paragraph

  if (paragraph === undefined || line.width <= 0) {
    return
  }

  const availableWidth = Math.max(0, cursor.page.contentRect.x + cursor.page.contentRect.width - line.x)
  const remainingWidth = Math.max(0, availableWidth - line.width)

  if (paragraph.alignment === 'justify' && shouldJustifyLine) {
    justifyLineToParagraph(line, remainingWidth)
    return
  }

  const offset = paragraph.alignment === 'right'
    ? remainingWidth
    : paragraph.alignment === 'center' ? remainingWidth / 2 : 0

  if (offset === 0) {
    return
  }

  line.x += offset
  for (let index = 0; index < line.fragments.length; index += 1) {
    const fragment = line.fragments[index]

    if (fragment !== undefined) {
      line.fragments[index] = Object.freeze({
        ...fragment,
        x: fragment.x + offset
      })
    }
  }

  for (let index = 0; index < line.inlines.length; index += 1) {
    const inline = line.inlines[index]

    if (inline !== undefined) {
      line.inlines[index] = Object.freeze({
        ...inline,
        x: inline.x + offset
      })
    }
  }
}

interface JustifyGap {
  readonly x: number
  readonly count: number
}

/** 将软换行产生的非末行拉伸到段落右边界。 */
function justifyLineToParagraph(line: MutableLineBox, remainingWidth: number): void {
  if (remainingWidth <= 0 || line.fragments.length < 2) {
    return
  }

  const expandableFragmentGaps = new Map<number, number>()
  const interFragmentGaps = new Map<number, number>()
  const gaps: JustifyGap[] = []

  for (let index = 0; index < line.fragments.length; index += 1) {
    const fragment = line.fragments[index]
    const nextFragment = line.fragments[index + 1]

    if (fragment === undefined) {
      continue
    }

    if (isWhitespaceJustifyText(fragment.text)) {
      const count = countJustifyGraphemes(fragment.text)

      expandableFragmentGaps.set(index, count)
      gaps.push({
        x: fragment.x + fragment.width,
        count
      })
      continue
    }

    if (
      nextFragment !== undefined
      && isCjkJustifyText(fragment.text)
      && isCjkJustifyText(nextFragment.text)
    ) {
      interFragmentGaps.set(index, 1)
      gaps.push({
        x: fragment.x + fragment.width,
        count: 1
      })
    }
  }

  const totalGapCount = gaps.reduce((sum, gap) => sum + gap.count, 0)

  if (totalGapCount <= 0) {
    return
  }

  const extraPerGap = remainingWidth / totalGapCount
  let offset = 0

  for (let index = 0; index < line.fragments.length; index += 1) {
    const fragment = line.fragments[index]

    if (fragment === undefined) {
      continue
    }

    const widthDelta = extraPerGap * (expandableFragmentGaps.get(index) ?? 0)

    line.fragments[index] = Object.freeze({
      ...fragment,
      x: fragment.x + offset,
      width: fragment.width + widthDelta,
      advanceTwips: expandFragmentAdvanceTwips(fragment.advanceTwips, widthDelta)
    })
    offset += widthDelta + (extraPerGap * (interFragmentGaps.get(index) ?? 0))
  }

  for (let index = 0; index < line.inlines.length; index += 1) {
    const inline = line.inlines[index]

    if (inline !== undefined) {
      line.inlines[index] = shiftInlineBoxX(inline, resolveJustifyOffsetBeforeX(gaps, extraPerGap, inline.x))
    }
  }

  line.width += remainingWidth
}

/** 判断文本片段是否可通过空白宽度扩展。 */
function isWhitespaceJustifyText(text: string): boolean {
  return /^\s+$/u.test(text)
}

/** 判断文本片段是否可在 CJK 字符间扩展。 */
function isCjkJustifyText(text: string): boolean {
  return /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]$/u.test(text)
}

/** 统计可扩展空白字素数量。 */
function countJustifyGraphemes(text: string): number {
  return Math.max(1, Array.from(text).length)
}

/** 扩展片段内部 advance，保持命中测试边界随宽度增长。 */
function expandFragmentAdvanceTwips(advanceTwips: readonly number[], widthDelta: number): readonly number[] {
  if (widthDelta === 0 || advanceTwips.length <= 1) {
    return advanceTwips
  }

  const step = widthDelta / (advanceTwips.length - 1)

  return Object.freeze(advanceTwips.map((advance, index) => advance + (step * index)))
}

/** 计算指定 x 坐标前已插入的 justify 偏移。 */
function resolveJustifyOffsetBeforeX(gaps: readonly JustifyGap[], extraPerGap: number, x: number): number {
  return gaps.reduce((offset, gap) => x >= gap.x ? offset + (gap.count * extraPerGap) : offset, 0)
}

/** 平移行内盒的 x 坐标。 */
function shiftInlineBoxX(box: InlineBox, offset: number): InlineBox {
  if (offset === 0) {
    return box
  }

  return Object.freeze({
    ...box,
    x: box.x + offset
  }) as unknown as InlineBox
}

/**
 * 解析当前逻辑行的起始缩进。
 */
function resolveParagraphLineX(cursor: LayoutCursor, paragraph: MutableParagraphBox): number {
  const lineCount = readParagraphLineCount(cursor, paragraph.paragraphId)
  const offsetTwips = lineCount === 0
    ? paragraph.firstLineIndentTwips
    : paragraph.hangingIndentTwips

  return paragraph.x + Math.max(0, offsetTwips)
}

/**
 * 记录段落已经排出的逻辑行数。
 */
function recordParagraphLine(cursor: LayoutCursor, paragraphId: string): void {
  const lineCounts = getParagraphLineCounts(cursor)
  const currentCount = lineCounts.get(paragraphId) ?? 0

  lineCounts.set(paragraphId, currentCount + 1)
}

/**
 * 读取段落已排出的逻辑行数。
 */
function readParagraphLineCount(cursor: LayoutCursor, paragraphId: string): number {
  return getParagraphLineCounts(cursor).get(paragraphId) ?? 0
}

/**
 * 获取段落逻辑行计数表。
 */
function getParagraphLineCounts(cursor: LayoutCursor): Map<string, number> {
  if (cursor.paragraphLineCounts === undefined) {
    cursor.paragraphLineCounts = new Map()
  }

  return cursor.paragraphLineCounts
}

/** 当前页只留下不足 orphan 阈值的段首行时，把这些行整体移到下一页。 */
function moveOrphanLinesToNextPage(
  cursor: LayoutCursor,
  pages: MutablePageBox[],
  pageConfig: PageConfig,
  section: Section
): boolean {
  const currentParagraph = cursor.paragraph

  if (
    currentParagraph === undefined
    || currentParagraph.pageBreakPolicy.widowControl !== true
    || currentParagraph.lines.length === 0
    || currentParagraph.lines.length >= currentParagraph.pageBreakPolicy.orphanLines
  ) {
    return false
  }

  const sourcePage = cursor.page
  const movedLines = currentParagraph.lines

  sourcePage.lines = sourcePage.lines.filter((line) => !movedLines.includes(line))
  removeParagraphFromPage(sourcePage, currentParagraph)
  startNewPage(cursor, pages, pageConfig)
  assignPageSectionBoundary(cursor.page, section, cursor.sectionContext)

  let nextY = cursor.page.contentRect.y
  const nextParagraph = cloneParagraphForPage(currentParagraph, cursor.page.pageIndex, nextY - currentParagraph.y)
  const nextLines = movedLines.map((line) => {
    const movedLine = cloneLineForPage(line, cursor.page.pageIndex, nextY - line.y)

    nextY += movedLine.height
    return movedLine
  })

  nextParagraph.y = cursor.page.contentRect.y
  nextParagraph.lines = nextLines
  nextParagraph.height = resolveParagraphHeight(nextParagraph)
  cursor.page.paragraphs.push(nextParagraph)
  cursor.page.blocks.push(nextParagraph)
  cursor.page.lines.push(...nextLines)
  cursor.paragraph = nextParagraph
  cursor.line = undefined
  cursor.y = nextY
  cursor.x = nextParagraph.x

  return true
}

/** 查找当前页之前最近的同段落页面。 */
function findPreviousParagraphPage(
  pages: readonly MutablePageBox[],
  page: MutablePageBox,
  paragraphId: string
): MutablePageBox | undefined {
  for (let index = page.pageIndex - 1; index >= 0; index -= 1) {
    const previousPage = pages[index]

    if (previousPage?.paragraphs.some((paragraph) => paragraph.paragraphId === paragraphId) === true) {
      return previousPage
    }
  }

  return undefined
}

/** 从页面索引中移除空段落盒。 */
function removeParagraphFromPage(page: MutablePageBox, paragraph: MutableParagraphBox): void {
  const paragraphIndex = page.paragraphs.indexOf(paragraph)

  if (paragraphIndex >= 0) {
    page.paragraphs.splice(paragraphIndex, 1)
  }

  const blockIndex = page.blocks.indexOf(paragraph)

  if (blockIndex >= 0) {
    page.blocks.splice(blockIndex, 1)
  }
}

/** 复制段落盒到目标页面。 */
function cloneParagraphForPage(
  paragraph: MutableParagraphBox,
  pageIndex: number,
  offsetY: number
): MutableParagraphBox {
  return {
    ...paragraph,
    pageIndex,
    y: paragraph.y + offsetY,
    lines: []
  }
}

/** 复制行盒和内部片段到目标页面与纵向偏移。 */
function cloneLineForPage(line: LineBox, pageIndex: number, offsetY: number): MutableLineBox {
  return {
    ...line,
    pageIndex,
    y: line.y + offsetY,
    baseline: line.baseline + offsetY,
    fragments: line.fragments.map((fragment) => Object.freeze({
      ...fragment,
      pageIndex,
      y: fragment.y + offsetY,
      baseline: fragment.baseline + offsetY
    })),
    inlines: line.inlines.map((inline) => Object.freeze({
      ...inline,
      pageIndex,
      y: inline.y + offsetY,
      ...(inline.kind === 'emptyTextAnchor'
        ? { baseline: inline.baseline + offsetY }
        : {})
    })) as InlineBox[]
  }
}

/** 根据段落现有行重算高度。 */
function resolveParagraphHeight(paragraph: MutableParagraphBox): number {
  if (paragraph.lines.length === 0) {
    return 0
  }

  return paragraph.lines.reduce((bottom, line) =>
    Math.max(bottom, line.y + line.height),
  paragraph.y) - paragraph.y
}

function resolveParagraphListMarker(
  cursor: LayoutCursor,
  paragraph: Paragraph,
  markerGapTwips: number
): MutableParagraphBox['listMarker'] {
  const list = resolveParagraphList(paragraph)

  if (list === undefined) {
    return undefined
  }

  const kind = resolveParagraphListKind(list)
  const level = resolveParagraphListLevel(list)

  if (kind === 'bullet') {
    return Object.freeze({
      kind,
      label: resolveParagraphListBulletLabel(level),
      text: resolveParagraphListBulletLabel(level),
      level,
      gapTwips: markerGapTwips,
      list
    })
  }

  const counters = cursor.listCounters?.get(list.numberingId) ?? []

  counters.length = level
  counters[level - 1] = (counters[level - 1] ?? 0) + 1

  if (cursor.listCounters === undefined) {
    cursor.listCounters = new Map()
  }

  cursor.listCounters.set(list.numberingId, counters)

  return Object.freeze({
    kind,
    label: `${counters.slice(0, level).join('.')}.`,
    text: `${counters.slice(0, level).join('.')}.`,
    level,
    gapTwips: markerGapTwips,
    list
  })
}
