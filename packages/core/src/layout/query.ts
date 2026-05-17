/**
 * 职责：提供布局结果的命中测试、光标矩形、选区矩形和位置查找缓存。
 * 边界：只读取 DocumentLayout，不触发布局、不修改页面盒。
 * 协作模块：editor facade、测试和增量布局通过这里查询文本位置与几何映射。
 * 性能/安全约束：缓存挂在布局对象 WeakMap 上，避免全局持久状态泄漏。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/03-architecture.md#36-layout-engine。
 */

import type { TextPosition, TextRange } from '../operations/transaction'
import { cssPxToTwips } from './page-config'
import type {
  DocumentLayout,
  InlineBox,
  LayoutLookupCache,
  LayoutRect,
  LineBox,
  TextFragment
} from './types'

const layoutLookupCache = new WeakMap<DocumentLayout, LayoutLookupCache>()
const DEFAULT_CARET_HEIGHT_TWIPS = cssPxToTwips(16 * 1.2)

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

  return resolveOuterInlineBoundaryPosition(line.inlines, absolutePoint.x) ?? lastFragment.end
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
    return undefined
  }

  const target = located.fragment ?? located.inline

  if (target === undefined) {
    return undefined
  }

  return {
    pageIndex: target.pageIndex,
    x: located.fragment === undefined
      ? offsetInInline(located.inline, position)
      : offsetInFragment(located.fragment, position),
    y: located.fragment?.y ?? located.inline?.y ?? located.line.y,
    width: 0,
    height: located.fragment?.height ?? DEFAULT_CARET_HEIGHT_TWIPS
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
  }

  return Object.freeze(rects)
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

export function locatePosition(
  layout: DocumentLayout,
  position: TextPosition
): Readonly<{
  line: LineBox
  fragment?: TextFragment
  inline?: InlineBox
}> | undefined {
  const cache = readLayoutLookupCache(layout)
  const fragmentCandidates: Array<Readonly<{
    line: LineBox
    fragment: TextFragment
  }>> = []
  const inlineCandidates: Array<Readonly<{
    line: LineBox
    inline: InlineBox
  }>> = []
  const fragments = cache.fragmentsByContainerKey.get(createTextContainerKey(position))

  if (fragments !== undefined) {
    for (const fragment of fragments) {
      if (containsPosition(fragment, position)) {
        const line = layout.pages[fragment.pageIndex]?.lines.find((candidate) => {
          return candidate.paragraphId === fragment.blockId
            && candidate.fragments.some((item) => item === fragment)
        })

        if (line !== undefined) {
          fragmentCandidates.push({
            line,
            fragment
          })
        }
      }
    }
  }

  const inlines = cache.inlinesByPositionKey.get(createTextPositionKey(position))

  if (inlines !== undefined) {
    for (const inline of inlines) {
      const line = layout.pages[inline.pageIndex]?.lines.find((candidate) => {
        return candidate.inlines.some((item) => item === inline)
      })

      if (line !== undefined) {
        inlineCandidates.push({
          line,
          inline
        })
      }
    }
  }

  const candidates = fragmentCandidates.length > 0 ? fragmentCandidates : inlineCandidates

  if (candidates.length === 0) {
    return undefined
  }

  return position.assoc !== undefined && position.assoc < 0
    ? candidates[0]
    : candidates[candidates.length - 1]
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
  return readLayoutLookupCache(layout).containerOrderByKey.get(createTextContainerKey(position))
}

function readLayoutLookupCache(layout: DocumentLayout): LayoutLookupCache {
  const cached = layoutLookupCache.get(layout)

  if (cached !== undefined) {
    return cached
  }

  const containerOrderByKey = new Map<string, number>()
  const fragmentsByContainerKey = new Map<string, TextFragment[]>()
  const inlinesByPositionKey = new Map<string, InlineBox[]>()
  let order = 0

  for (const page of layout.pages) {
    for (const line of page.lines) {
      for (const fragment of line.fragments) {
        const containerKey = createTextContainerKey(fragment.start)
        const fragments = fragmentsByContainerKey.get(containerKey) ?? []

        fragments.push(fragment)
        fragmentsByContainerKey.set(containerKey, fragments)

        if (!containerOrderByKey.has(containerKey)) {
          containerOrderByKey.set(containerKey, order)
        }

        order += 1
      }

      for (const inline of line.inlines) {
        const containerKey = createTextContainerKey(inline.at)
        const positionKey = createTextPositionKey(inline.at)
        const inlines = inlinesByPositionKey.get(positionKey) ?? []

        inlines.push(inline)
        inlinesByPositionKey.set(positionKey, inlines)

        if (!containerOrderByKey.has(containerKey)) {
          containerOrderByKey.set(containerKey, order)
        }

        order += 1
      }
    }
  }

  const nextCache: LayoutLookupCache = {
    containerOrderByKey,
    fragmentsByContainerKey,
    inlinesByPositionKey
  }

  layoutLookupCache.set(layout, nextCache)

  return nextCache
}

function createTextContainerKey(position: TextPosition): string {
  return `${position.sectionId}\u0000${position.blockId}\u0000${position.runId}`
}

function createTextPositionKey(position: TextPosition): string {
  return `${createTextContainerKey(position)}\u0000${position.graphemeIndex}`
}

function isSameTextContainer(left: TextPosition, right: TextPosition): boolean {
  return left.sectionId === right.sectionId
    && left.blockId === right.blockId
    && left.runId === right.runId
}

export function isSamePosition(left: TextPosition, right: TextPosition): boolean {
  return isSameTextContainer(left, right) && left.graphemeIndex === right.graphemeIndex
}

function isTrailingInlineBoundary(position: TextPosition): boolean {
  return position.assoc !== undefined && position.assoc < 0
}
