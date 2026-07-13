/**
 * 职责：提供布局文本位置查找、位置顺序比较和查询缓存。
 * 边界：只读取 DocumentLayout，不计算命中点或选区几何。
 * 协作模块：layout query 通过这里复用文本位置与布局盒的映射。
 * 性能/安全约束：缓存挂在布局对象 WeakMap 上，避免全局持久状态泄漏。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import type { TextPosition } from '../operations/transaction'
import type {
  DocumentLayout,
  InlineBox,
  LayoutLookupCache,
  LineBox,
  TextFragment
} from './types'

const layoutLookupCache = new WeakMap<DocumentLayout, LayoutLookupCache>()

/** 查找文本位置对应的布局行、文本片段或内联盒。 */
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
        }) ?? createTableFragmentLine(fragment)

        fragmentCandidates.push({
          line,
          fragment
        })
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

/** 比较两个文本位置在当前布局中的先后顺序。 */
export function comparePositions(
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

/** 判断两个文本位置是否指向同一文本容器。 */
export function isSameTextContainer(left: TextPosition, right: TextPosition): boolean {
  return left.sectionId === right.sectionId
    && left.blockId === right.blockId
    && left.runId === right.runId
}

/** 判断两个文本位置是否完全相同。 */
export function isSamePosition(left: TextPosition, right: TextPosition): boolean {
  return isSameTextContainer(left, right) && left.graphemeIndex === right.graphemeIndex
}

/** 为表格单元格文本片段创建可复用的查询行。 */
export function createTableFragmentLine(fragment: TextFragment): LineBox {
  return {
    kind: 'line',
    pageIndex: fragment.pageIndex,
    sectionId: fragment.sectionId,
    paragraphId: fragment.blockId,
    x: fragment.x,
    y: fragment.y,
    width: fragment.width,
    height: fragment.height,
    baseline: fragment.baseline,
    fragments: Object.freeze([fragment]),
    inlines: Object.freeze([])
  }
}

/** 判断文本片段是否包含指定位置。 */
function containsPosition(fragment: TextFragment, position: TextPosition): boolean {
  return fragment.sectionId === position.sectionId
    && fragment.blockId === position.blockId
    && fragment.runId === position.runId
    && position.graphemeIndex >= fragment.start.graphemeIndex
    && position.graphemeIndex <= fragment.end.graphemeIndex
}

/** 读取文本容器在布局中的稳定顺序。 */
function findContainerOrder(layout: DocumentLayout, position: TextPosition): number | undefined {
  return readLayoutLookupCache(layout).containerOrderByKey.get(createTextContainerKey(position))
}

/** 读取或创建当前布局的位置查询缓存。 */
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

    for (const block of page.blocks) {
      if (block.kind !== 'table') {
        continue
      }

      for (const row of block.rows) {
        for (const cell of row.cells) {
          for (const fragment of cell.fragments) {
            const containerKey = createTextContainerKey(fragment.start)
            const fragments = fragmentsByContainerKey.get(containerKey) ?? []

            fragments.push(fragment)
            fragmentsByContainerKey.set(containerKey, fragments)

            if (!containerOrderByKey.has(containerKey)) {
              containerOrderByKey.set(containerKey, order)
            }

            order += 1
          }
        }
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

/** 创建忽略 grapheme 下标的文本容器缓存键。 */
function createTextContainerKey(position: TextPosition): string {
  return `${position.sectionId}\u0000${position.blockId}\u0000${position.runId}`
}

/** 创建包含 grapheme 下标的文本位置缓存键。 */
function createTextPositionKey(position: TextPosition): string {
  return `${createTextContainerKey(position)}\u0000${position.graphemeIndex}`
}
