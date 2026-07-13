/**
 * 职责：提供布局结果的命中测试、光标矩形、选区矩形和位置查找缓存。
 * 边界：只读取 DocumentLayout，不触发布局、不修改页面盒。
 * 协作模块：editor facade、测试和增量布局通过这里查询文本位置与几何映射。
 * 性能/安全约束：缓存挂在布局对象 WeakMap 上，避免全局持久状态泄漏。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import type { TextPosition, TextRange } from '../operations/transaction'
import { cssPxToTwips } from './page-config'
import {
  comparePositions,
  isSamePosition,
  isSameTextContainer,
  locatePosition
} from './query-position'
import type { DocumentLayout, InlineBox, LayoutRect, LineBox, TableBox, TextFragment } from './types'

const DEFAULT_CARET_HEIGHT_TWIPS = cssPxToTwips(16 * 1.2)
const DOUBLE_CLICK_GRAPHEME_LEFT_RATIO = 0.35
const DOUBLE_CLICK_GRAPHEME_RIGHT_RATIO = 0.65

export { isSamePosition, locatePosition } from './query-position'

export interface DocumentLayoutTextHit {
  readonly position: TextPosition
  readonly bias: 'left' | 'center' | 'right' | 'none'
}

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
  const tableHit = hitTestTableBoxes(page.blocks.filter((block): block is TableBox => block.kind === 'table'), absolutePoint.x, absolutePoint.y)

  if (tableHit !== undefined) {
    return tableHit
  }

  const line = page.lines.find((candidate) =>
    absolutePoint.y >= candidate.y && absolutePoint.y <= candidate.y + candidate.height
  ) ?? findNearestLine(page.lines, absolutePoint.y)

  if (line === undefined) {
    return undefined
  }

  const inlineHit = hitTestInlineBoxes(line.inlines, absolutePoint.x, absolutePoint.y)

  if (inlineHit !== undefined) {
    return resolveInlineHitPosition(line, inlineHit, absolutePoint.x)
      ?? inlineHit.at
  }

  if (line.fragments.length === 0) {
    return resolveOuterInlineBoundaryPosition(line.inlines, absolutePoint.x)
  }

  const firstFragment = line.fragments[0]
  const lastFragment = line.fragments[line.fragments.length - 1]

  if (firstFragment === undefined || lastFragment === undefined) {
    return undefined
  }

  if (absolutePoint.x <= firstFragment.x) {
    return resolveOuterInlineBoundaryPosition(line.inlines, absolutePoint.x) ?? firstFragment.start
  }

  for (const fragment of line.fragments) {
    if (absolutePoint.x <= fragment.x + fragment.width) {
      return positionInFragment(fragment, absolutePoint.x)
    }
  }

  return resolveOuterInlineBoundaryPosition(line.inlines, absolutePoint.x) ?? {
    ...lastFragment.end,
    assoc: -1
  }
}

/**
 * 命中测试当前文本单元，并补充双击扩选需要的左右偏向信息。
 */
export function hitTestDocumentLayoutTextHit(
  layout: DocumentLayout,
  point: Readonly<{
    pageIndex: number
    x: number
    y: number
  }>
): DocumentLayoutTextHit | undefined {
  const page = layout.pages[point.pageIndex]

  if (page === undefined) {
    return undefined
  }

  const absolutePoint = {
    x: page.x + point.x,
    y: page.y + point.y
  }
  const tableHit = hitTestTableBoxes(page.blocks.filter((block): block is TableBox => block.kind === 'table'), absolutePoint.x, absolutePoint.y)

  if (tableHit !== undefined) {
    return {
      position: tableHit,
      bias: 'none'
    }
  }

  const line = page.lines.find((candidate) =>
    absolutePoint.y >= candidate.y && absolutePoint.y <= candidate.y + candidate.height
  ) ?? findNearestLine(page.lines, absolutePoint.y)

  if (line === undefined) {
    return undefined
  }

  const inlineHit = hitTestInlineBoxes(line.inlines, absolutePoint.x, absolutePoint.y)

  if (inlineHit !== undefined) {
    const position = resolveInlineHitPosition(line, inlineHit, absolutePoint.x) ?? inlineHit.at

    return {
      position,
      bias: 'none'
    }
  }

  if (line.fragments.length === 0) {
    const position = resolveOuterInlineBoundaryPosition(line.inlines, absolutePoint.x)

    return position === undefined
      ? undefined
      : {
        position,
        bias: 'none'
      }
  }

  const firstFragment = line.fragments[0]
  const lastFragment = line.fragments[line.fragments.length - 1]

  if (firstFragment === undefined || lastFragment === undefined) {
    return undefined
  }

  if (absolutePoint.x <= firstFragment.x) {
    const position = resolveOuterInlineBoundaryPosition(line.inlines, absolutePoint.x) ?? firstFragment.start

    return {
      position,
      bias: 'none'
    }
  }

  for (const fragment of line.fragments) {
    if (absolutePoint.x <= fragment.x + fragment.width) {
      return resolveFragmentTextHit(fragment, absolutePoint.x)
    }
  }

  return {
    position: resolveOuterInlineBoundaryPosition(line.inlines, absolutePoint.x) ?? lastFragment.end,
    bias: 'none'
  }
}

/** 命中表格单元格并返回其首个文本位置。 */
function hitTestTableBoxes(
  tables: readonly TableBox[],
  absoluteX: number,
  absoluteY: number
): TextPosition | undefined {
  for (const table of tables) {
    if (!isPointInsideRect(table, absoluteX, absoluteY)) {
      continue
    }

    for (const row of table.rows) {
      for (const cell of row.cells) {
        if (!isPointInsideRect(cell, absoluteX, absoluteY)) {
          continue
        }

        const fragmentHit = hitTestTableCellFragments(cell.fragments, absoluteX, absoluteY)

        if (fragmentHit !== undefined) {
          return fragmentHit
        }

        const inlineHit = hitTestInlineBoxes(cell.inlines, absoluteX, absoluteY)

        if (inlineHit !== undefined) {
          return resolveInlineHitPosition(createTableInlineLine(cell.inlines, inlineHit), inlineHit, absoluteX)
        }

        if (cell.textPosition !== undefined) {
          return cell.textPosition
        }
      }
    }
  }

  return undefined
}

/** 为表格单元格行内对象创建最小查询行。 */
function createTableInlineLine(inlines: readonly InlineBox[], inline: InlineBox): LineBox {
  const lineInlines = inlines.filter((candidate) =>
    candidate.pageIndex === inline.pageIndex && candidate.blockId === inline.blockId && candidate.y === inline.y
  )
  const first = lineInlines[0] ?? inline
  const last = lineInlines[lineInlines.length - 1] ?? inline

  return Object.freeze({
    kind: 'line' as const,
    pageIndex: inline.pageIndex,
    sectionId: inline.sectionId,
    paragraphId: inline.blockId,
    x: first.x,
    y: Math.min(...lineInlines.map((candidate) => candidate.y), inline.y),
    width: (last.x + last.width) - first.x,
    height: Math.max(...lineInlines.map((candidate) => candidate.y + candidate.height), inline.y + inline.height) - first.y,
    baseline: Math.max(...lineInlines.map((candidate) => candidate.y + candidate.height), inline.y + inline.height),
    fragments: Object.freeze([]),
    inlines: Object.freeze(lineInlines.length === 0 ? [inline] : lineInlines)
  })
}

/** 命中单元格内文本片段，返回最接近的文本位置。 */
function hitTestTableCellFragments(
  fragments: readonly TextFragment[],
  absoluteX: number,
  absoluteY: number
): TextPosition | undefined {
  const lineFragments = fragments.filter((fragment) =>
    absoluteY >= fragment.y && absoluteY <= fragment.y + fragment.height
  )
  const candidates = lineFragments.length > 0 ? lineFragments : fragments
  const firstFragment = candidates[0]
  const lastFragment = candidates[candidates.length - 1]

  if (firstFragment === undefined || lastFragment === undefined) {
    return undefined
  }

  if (absoluteX <= firstFragment.x) {
    return firstFragment.start
  }

  for (const fragment of candidates) {
    if (absoluteX <= fragment.x + fragment.width) {
      return positionInFragment(fragment, absoluteX)
    }
  }

  return {
    ...lastFragment.end,
    assoc: -1
  }
}

/** 判断点是否在布局矩形内。 */
function isPointInsideRect(rect: LayoutRect, absoluteX: number, absoluteY: number): boolean {
  return absoluteX >= rect.x
    && absoluteX < rect.x + rect.width
    && absoluteY >= rect.y
    && absoluteY < rect.y + rect.height
}

/**
 * 当点击命中页内空白区域时，回退到最近的一行，避免 pointer runtime 丢失 caret/focus。
 */
function findNearestLine(lines: readonly LineBox[], absoluteY: number): LineBox | undefined {
  let nearestLine: LineBox | undefined
  let nearestDistance = Number.POSITIVE_INFINITY

  for (const line of lines) {
    const distance = absoluteY < line.y
      ? line.y - absoluteY
      : absoluteY > line.y + line.height
        ? absoluteY - (line.y + line.height)
        : 0

    if (distance < nearestDistance) {
      nearestLine = line
      nearestDistance = distance
    }
  }

  return nearestLine
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
    const tableCellRect = locateTableCellRect(layout, position)

    return tableCellRect
  }

  const target = located.fragment ?? located.inline

  if (target === undefined) {
    return locateTableCellRect(layout, position)
  }

  const height = resolveCaretHeight(located.line, target)

  return {
    pageIndex: target.pageIndex,
    x: located.fragment === undefined
      ? offsetInInline(located.inline, position)
      : offsetInFragment(located.fragment, position),
    y: resolveCaretY({
      line: located.line,
      target,
      height
    }),
    width: 0,
    height
  }
}

/** 读取 caret 可视高度，文本行沿用当前片段字体高度，避免被整行高图撑满。 */
function resolveCaretHeight(line: LineBox, target: TextFragment | InlineBox): number {
  if (shouldCenterCaretInTextLine(line)) {
    return Math.min(target.height, line.height)
  }

  return target.height
}

/** 读取 caret 顶部坐标；纯文本行以行盒中心归一，避免标点/英文 baseline 抖动。 */
function resolveCaretY(input: Readonly<{
  line: LineBox
  target: TextFragment | InlineBox
  height: number
}>): number {
  if (shouldCenterCaretInTextLine(input.line)) {
    return input.line.y + ((input.line.height - input.height) / 2)
  }

  return input.target.y
}

/** 判断当前行是否可以按文本行中心放置 caret。 */
function shouldCenterCaretInTextLine(line: LineBox): boolean {
  return line.inlines.every((inline) => inline.kind === 'emptyTextAnchor')
}

/** 读取表格单元格命中的 caret 矩形。 */
function locateTableCellRect(layout: DocumentLayout, position: TextPosition): LayoutRect | undefined {
  for (const page of layout.pages) {
    for (const block of page.blocks) {
      if (block.kind !== 'table') {
        continue
      }

      for (const row of block.rows) {
        for (const cell of row.cells) {
          if (cell.textPosition === undefined || !isSamePosition(cell.textPosition, position)) {
            continue
          }

          return {
            pageIndex: page.pageIndex,
            x: cell.x + cssPxToTwips(8),
            y: cell.y + cssPxToTwips(6),
            width: 0,
            height: Math.min(cell.height, DEFAULT_CARET_HEIGHT_TWIPS)
          }
        }
      }
    }
  }

  return undefined
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

  if (ordered === undefined) {
    return Object.freeze([])
  }

  if (isSamePosition(ordered.anchor, ordered.focus)) {
    const located = locatePosition(layout, ordered.anchor)

    if (located?.inline?.kind === 'inlineObject' && !isTrailingInlineBoundary(ordered.anchor)) {
      return Object.freeze([{
        pageIndex: located.inline.pageIndex,
        x: located.inline.x,
        y: located.inline.y,
        width: located.inline.width,
        height: located.inline.height
      }])
    }

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

    for (const line of createTableFragmentLines(page.blocks.filter((block): block is TableBox => block.kind === 'table'))) {
      const lineRect = getLineSelectionRect(layout, line, ordered.anchor, ordered.focus)

      if (lineRect !== undefined) {
        rects.push(lineRect)
      }
    }
  }

  return Object.freeze(rects)
}

/** 把表格单元格片段按同一行聚合，供选区矩形查询复用。 */
function createTableFragmentLines(tables: readonly TableBox[]): readonly LineBox[] {
  const lines = new Map<string, TextFragment[]>()

  for (const table of tables) {
    for (const row of table.rows) {
      for (const cell of row.cells) {
        for (const fragment of cell.fragments) {
          const key = `${fragment.pageIndex}\u0000${fragment.blockId}\u0000${fragment.y}`
          const fragments = lines.get(key) ?? []

          fragments.push(fragment)
          lines.set(key, fragments)
        }
      }
    }
  }

  return Object.freeze([...lines.values()].map((fragments) => {
    const sortedFragments = [...fragments].sort((left, right) => left.x - right.x)
    const first = sortedFragments[0]
    const last = sortedFragments[sortedFragments.length - 1]

    if (first === undefined || last === undefined) {
      throw new Error('表格文本行缺少片段。')
    }

    return Object.freeze({
      kind: 'line' as const,
      pageIndex: first.pageIndex,
      sectionId: first.sectionId,
      paragraphId: first.blockId,
      x: first.x,
      y: Math.min(...sortedFragments.map((fragment) => fragment.y)),
      width: (last.x + last.width) - first.x,
      height: Math.max(...sortedFragments.map((fragment) => fragment.y + fragment.height)) - first.y,
      baseline: Math.max(...sortedFragments.map((fragment) => fragment.baseline)),
      fragments: Object.freeze(sortedFragments),
      inlines: Object.freeze([])
    })
  }))
}

function positionInFragment(fragment: TextFragment, x: number): TextPosition {
  const relativeX = Math.max(0, Math.min(fragment.width, x - fragment.x))
  const graphemeIndex = resolveGraphemeIndexAtOffset(fragment, relativeX)

  return {
    sectionId: fragment.sectionId,
    blockId: fragment.blockId,
    runId: fragment.runId,
    graphemeIndex,
    ...(graphemeIndex === fragment.end.graphemeIndex ? { assoc: -1 } : {})
  }
}

/**
 * 读取片段内当前点击 grapheme 的左右偏向，用于中文双击扩选。
 */
function resolveFragmentTextHit(
  fragment: TextFragment,
  x: number
): DocumentLayoutTextHit {
  const relativeX = Math.max(0, Math.min(fragment.width, x - fragment.x))

  for (let index = 1; index < fragment.advanceTwips.length; index += 1) {
    const previousAdvance = fragment.advanceTwips[index - 1] ?? 0
    const nextAdvance = fragment.advanceTwips[index] ?? fragment.width

    if (relativeX > nextAdvance && index < fragment.advanceTwips.length - 1) {
      continue
    }

    const graphemeWidth = Math.max(nextAdvance - previousAdvance, 0)
    const leftThreshold = previousAdvance + (graphemeWidth * DOUBLE_CLICK_GRAPHEME_LEFT_RATIO)
    const rightThreshold = previousAdvance + (graphemeWidth * DOUBLE_CLICK_GRAPHEME_RIGHT_RATIO)

    return {
      position: {
        sectionId: fragment.sectionId,
        blockId: fragment.blockId,
        runId: fragment.runId,
        graphemeIndex: fragment.start.graphemeIndex + index - 1
      },
      bias: relativeX < leftThreshold
        ? 'left'
        : relativeX > rightThreshold
          ? 'right'
          : 'center'
    }
  }

  return {
    position: {
      sectionId: fragment.sectionId,
      blockId: fragment.blockId,
      runId: fragment.runId,
      graphemeIndex: Math.max(fragment.start.graphemeIndex, fragment.end.graphemeIndex - 1)
    },
    bias: 'right'
  }
}

/**
 * 按片段内部 advance 把横向偏移映射为最近的 grapheme 边界。
 */
function resolveGraphemeIndexAtOffset(fragment: TextFragment, offset: number): number {
  for (let index = 1; index < fragment.advanceTwips.length; index += 1) {
    const previousAdvance = fragment.advanceTwips[index - 1] ?? 0
    const nextAdvance = fragment.advanceTwips[index] ?? fragment.width
    const midpoint = previousAdvance + ((nextAdvance - previousAdvance) / 2)

    if (offset < midpoint) {
      return fragment.start.graphemeIndex + index - 1
    }
  }

  return fragment.end.graphemeIndex
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

function hitTestInlineBoxes(
  inlines: readonly InlineBox[],
  absoluteX: number,
  absoluteY: number
): InlineBox | undefined {
  return inlines.find((inline) =>
    inline.width > 0
    && absoluteX >= inline.x
    && absoluteX <= inline.x + inline.width
    && absoluteY >= inline.y
    && absoluteY <= inline.y + inline.height
  )
}

/**
 * 根据图片点击的左右位置，返回更贴近文本编辑语义的边界位置。
 */
function resolveInlineHitPosition(
  line: LineBox,
  inline: InlineBox,
  absoluteX: number
): TextPosition | undefined {
  if (inline.kind === 'inlineObject' && inline.inlineKind === 'image') {
    return inline.at
  }

  let beforeFragment: TextFragment | undefined
  let afterFragment: TextFragment | undefined

  for (const fragment of line.fragments) {
    if (fragment.x + fragment.width <= inline.x) {
      beforeFragment = fragment
      continue
    }

    if (afterFragment === undefined && fragment.x >= inline.x + inline.width) {
      afterFragment = fragment
    }
  }

  const midpoint = inline.x + (inline.width / 2)

  if (absoluteX < midpoint) {
    if (beforeFragment !== undefined) {
      return {
        ...beforeFragment.end,
        assoc: -1
      }
    }

    if (afterFragment !== undefined) {
      return afterFragment.start
    }

    return inline.at
  }

  if (afterFragment !== undefined) {
    return afterFragment.start
  }

  if (beforeFragment !== undefined) {
    return {
      ...beforeFragment.end,
      assoc: -1
    }
  }

  return inline.at
}

function offsetInInline(inline: InlineBox | undefined, position: TextPosition): number {
  if (inline === undefined) {
    return 0
  }

  return position.assoc !== undefined && position.assoc < 0
    ? inline.x + inline.width
    : inline.x
}

function resolveOuterInlineBoundaryPosition(
  inlines: readonly InlineBox[],
  absoluteX: number
): TextPosition | undefined {
  const firstInline = inlines[0]
  const lastInline = inlines[inlines.length - 1]

  if (firstInline === undefined || lastInline === undefined) {
    return undefined
  }

  if (absoluteX <= firstInline.x) {
    return resolveAdjacentEmptyTextAnchor(firstInline) ?? firstInline.at
  }

  if (absoluteX >= lastInline.x + lastInline.width) {
    return resolveAdjacentEmptyTextAnchor(lastInline) ?? {
      ...lastInline.at,
      assoc: -1
    }
  }

  return lastInline.at
}

/**
 * 零宽空文本锚点代表真实可输入的文本 run，命中后应直接回到该文本位置。
 */
function resolveAdjacentEmptyTextAnchor(inline: InlineBox | undefined): TextPosition | undefined {
  if (inline?.kind !== 'emptyTextAnchor') {
    return undefined
  }

  return inline.at
}

function getLineSelectionRect(
  layout: DocumentLayout,
  line: LineBox,
  anchor: TextPosition,
  focus: TextPosition
): LayoutRect | undefined {
  let startX: number | undefined
  let endX: number | undefined
  let topY: number | undefined
  let bottomY: number | undefined

  for (const fragment of line.fragments) {
    const overlap = getFragmentOverlap(layout, fragment, anchor, focus)

    if (overlap === undefined) {
      continue
    }

    const fragmentStartX = offsetInFragment(fragment, overlap.start)
    const fragmentEndX = offsetInFragment(fragment, overlap.end)

    startX = Math.min(startX ?? fragmentStartX, fragmentStartX)
    endX = Math.max(endX ?? fragmentEndX, fragmentEndX)
    topY = Math.min(topY ?? fragment.y, fragment.y)
    bottomY = Math.max(bottomY ?? (fragment.y + fragment.height), fragment.y + fragment.height)
  }

  if (
    startX === undefined ||
    endX === undefined ||
    endX <= startX ||
    topY === undefined ||
    bottomY === undefined ||
    bottomY <= topY
  ) {
    return undefined
  }

  return {
    pageIndex: line.pageIndex,
    x: startX,
    y: topY,
    width: endX - startX,
    height: bottomY - topY
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

function isTrailingInlineBoundary(position: TextPosition): boolean {
  return position.assoc !== undefined && position.assoc < 0
}
