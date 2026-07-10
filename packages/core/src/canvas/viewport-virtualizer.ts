/**
 * 职责：根据滚动视口计算 Gate 2 分页 canvas 的可视页和保留页。
 * 边界：只返回页索引，不创建 DOM、canvas，不参与绘制、hit-test 或 矩形映射。
 * 协作模块：画布渲染器 按 retainedPageIndexes 同步真实 canvas，画布池 回收离屏页。
 * 性能/安全约束：只保留可视页和固定页数 buffer，避免单长 canvas 或全量页面 canvas 常驻。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
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

/** 页面在虚拟器输入数组中的连续位置范围。 */
interface PagePositionRange {
  readonly start: number
  readonly end: number
}

export function computeViewportPages(input: ViewportPagesInput): ViewportPages {
  const bufferPages = input.bufferPages ?? 1
  const viewportBottom = input.scrollTop + input.viewportHeight
  const visibleRange = findVisiblePageRange(input.pages, input.scrollTop, viewportBottom)
  const anchoredRange = visibleRange ?? findNearestPageRange(input.pages, input.scrollTop, viewportBottom)
  const anchoredVisibleIndexes = anchoredRange === undefined
    ? []
    : readPageIndexesInRange(input.pages, anchoredRange.start, anchoredRange.end)
  const retainedIndexes = anchoredRange === undefined
    ? []
    : expandRangeWithBuffer(input.pages, anchoredRange, bufferPages)

  return {
    visiblePageIndexes: anchoredVisibleIndexes,
    retainedPageIndexes: retainedIndexes
  }
}

/** 用二分查找定位与视口相交的连续页面范围。 */
function findVisiblePageRange(
  pages: readonly VirtualizerPageBox[],
  scrollTop: number,
  viewportBottom: number
): PagePositionRange | undefined {
  const start = findFirstPageEndingAfter(pages, scrollTop)

  if (start === undefined) {
    return undefined
  }

  const startPage = pages[start]

  if (startPage === undefined || startPage.top >= viewportBottom) {
    return undefined
  }

  const endExclusive = findFirstPageStartingAtOrAfter(pages, viewportBottom) ?? pages.length
  const end = endExclusive - 1

  if (end < start) {
    return undefined
  }

  return { start, end }
}

/** 查找第一个底边越过视口顶部的页面位置。 */
function findFirstPageEndingAfter(
  pages: readonly VirtualizerPageBox[],
  scrollTop: number
): number | undefined {
  let low = 0
  let high = pages.length

  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    const page = pages[middle]

    if (page !== undefined && page.top + page.height > scrollTop) {
      high = middle
    } else {
      low = middle + 1
    }
  }

  return low < pages.length ? low : undefined
}

/** 查找第一个顶边不小于视口底部的页面位置。 */
function findFirstPageStartingAtOrAfter(
  pages: readonly VirtualizerPageBox[],
  viewportBottom: number
): number | undefined {
  let low = 0
  let high = pages.length

  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    const page = pages[middle]

    if (page !== undefined && page.top >= viewportBottom) {
      high = middle
    } else {
      low = middle + 1
    }
  }

  return low < pages.length ? low : undefined
}

/** 无可见交集时用页面中心点二分找到最近锚点。 */
function findNearestPageRange(
  pages: readonly VirtualizerPageBox[],
  scrollTop: number,
  viewportBottom: number
): PagePositionRange | undefined {
  if (pages.length === 0) {
    return undefined
  }

  const viewportCenter = (scrollTop + viewportBottom) / 2
  const next = findFirstPageCenterAtOrAfter(pages, viewportCenter)
  const previous = next === undefined ? pages.length - 1 : next - 1
  const nearest = chooseNearestPagePosition(pages, previous, next, viewportCenter)

  if (nearest === undefined) {
    return undefined
  }

  return {
    start: nearest,
    end: nearest
  }
}

/** 查找第一个中心点不小于视口中心的页面位置。 */
function findFirstPageCenterAtOrAfter(
  pages: readonly VirtualizerPageBox[],
  viewportCenter: number
): number | undefined {
  let low = 0
  let high = pages.length

  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    const page = pages[middle]

    if (page !== undefined && pageCenter(page) >= viewportCenter) {
      high = middle
    } else {
      low = middle + 1
    }
  }

  return low < pages.length ? low : undefined
}

/** 在视口中心前后的候选页中选择最近页面位置。 */
function chooseNearestPagePosition(
  pages: readonly VirtualizerPageBox[],
  previous: number,
  next: number | undefined,
  viewportCenter: number
): number | undefined {
  const previousPage = previous >= 0 ? pages[previous] : undefined
  const nextPage = next === undefined ? undefined : pages[next]

  if (previousPage === undefined) {
    return nextPage === undefined ? undefined : next
  }

  if (nextPage === undefined || next === undefined) {
    return previous
  }

  const previousDistance = Math.abs(pageCenter(previousPage) - viewportCenter)
  const nextDistance = Math.abs(pageCenter(nextPage) - viewportCenter)

  return nextDistance < previousDistance ? next : previous
}

/** 读取页面中心 y 坐标。 */
function pageCenter(page: VirtualizerPageBox): number {
  return page.top + page.height / 2
}

/** 按连续位置扩展 buffer 页，避免对可见页做线性反查。 */
function expandRangeWithBuffer(
  pages: readonly VirtualizerPageBox[],
  range: PagePositionRange,
  bufferPages: number
): readonly number[] {
  const start = Math.max(0, range.start - bufferPages)
  const end = Math.min(pages.length - 1, range.end + bufferPages)

  return readPageIndexesInRange(pages, start, end).sort((left, right) => left - right)
}

/** 读取连续位置范围内的页面索引。 */
function readPageIndexesInRange(
  pages: readonly VirtualizerPageBox[],
  start: number,
  end: number
): number[] {
  const pageIndexes: number[] = []

  for (let position = start; position <= end; position += 1) {
    const page = pages[position]

    if (page !== undefined) {
      pageIndexes.push(page.pageIndex)
    }
  }

  return pageIndexes
}
