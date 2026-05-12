/**
 * 职责：根据滚动视口计算 Gate 2 分页 canvas 的可视页和保留页。
 * 边界：只返回页索引，不创建 DOM、canvas，不参与绘制、hit-test 或 矩形映射。
 * 协作模块：画布渲染器 按 retainedPageIndexes 同步真实 canvas，画布池 回收离屏页。
 * 性能/安全约束：只保留可视页和固定页数 buffer，避免单长 canvas 或全量页面 canvas 常驻。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/03-architecture.md#35-分页-canvas-渲染。
 */

export interface VirtualizerPageBox {
  readonly pageIndex: number
  readonly top: number
  readonly height: number
}

export interface ViewportPagesInput {
  readonly pages: readonly VirtualizerPageBox[]
  readonly scrollTop: number
  readonly viewportHeight: number
  readonly bufferPages?: number
}

export interface ViewportPages {
  readonly visiblePageIndexes: readonly number[]
  readonly retainedPageIndexes: readonly number[]
}

export function computeViewportPages(input: ViewportPagesInput): ViewportPages {
  const bufferPages = input.bufferPages ?? 1
  const viewportBottom = input.scrollTop + input.viewportHeight
  const visibleIndexes = input.pages
    .filter((page) => page.top < viewportBottom && page.top + page.height > input.scrollTop)
    .map((page) => page.pageIndex)
  const anchoredVisibleIndexes = visibleIndexes.length > 0
    ? visibleIndexes
    : findNearestPageIndexes(input.pages, input.scrollTop, viewportBottom)
  const retainedIndexes = expandWithBuffer(input.pages, anchoredVisibleIndexes, bufferPages)

  return {
    visiblePageIndexes: anchoredVisibleIndexes,
    retainedPageIndexes: retainedIndexes
  }
}

function findNearestPageIndexes(
  pages: readonly VirtualizerPageBox[],
  scrollTop: number,
  viewportBottom: number
): readonly number[] {
  if (pages.length === 0) {
    return []
  }

  const firstPage = pages[0]

  if (firstPage === undefined) {
    return []
  }

  const viewportCenter = (scrollTop + viewportBottom) / 2
  let nearest = firstPage
  let nearestDistance = Math.abs(pageCenter(nearest) - viewportCenter)

  for (const page of pages.slice(1)) {
    const distance = Math.abs(pageCenter(page) - viewportCenter)

    if (distance < nearestDistance) {
      nearest = page
      nearestDistance = distance
    }
  }

  return [nearest.pageIndex]
}

function pageCenter(page: VirtualizerPageBox): number {
  return page.top + page.height / 2
}

function expandWithBuffer(
  pages: readonly VirtualizerPageBox[],
  visiblePageIndexes: readonly number[],
  bufferPages: number
): readonly number[] {
  const pageIndexes = pages.map((page) => page.pageIndex)
  const retained = new Set<number>()

  for (const visiblePageIndex of visiblePageIndexes) {
    const position = pageIndexes.indexOf(visiblePageIndex)

    if (position === -1) {
      continue
    }

    const start = Math.max(0, position - bufferPages)
    const end = Math.min(pageIndexes.length - 1, position + bufferPages)

    for (let positionIndex = start; positionIndex <= end; positionIndex += 1) {
      const pageIndex = pageIndexes[positionIndex]

      if (pageIndex !== undefined) {
        retained.add(pageIndex)
      }
    }
  }

  return [...retained].sort((left, right) => left - right)
}
