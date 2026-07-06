/**
 * 职责：执行纯数据分页 layout 主流程并生成 DocumentLayout。
 * 边界：只读取投影、页面配置和字体度量，不访问 DOM、不绘制 Canvas。
 * 协作模块：incremental 决定重排范围，pagination-flow 负责块级调度，internal 负责页面盒构造。
 * 性能/安全约束：同步最小实现，保留 viewport 和脏范围输入边界，不创建浏览器资源。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/03-architecture.md#36-layout-engine。
 */

import type { TextPosition } from '../operations/transaction'
import {
  createDerivedLayoutInput,
  createIncrementalLayoutContext,
  finalizeLayoutPages,
  resolveReusedSuffixPages
} from './incremental'
import { createDebugOverlay, createPage } from './internal'
import { startSectionLayout } from './layout-anchors'
import { layoutBlock } from './pagination-flow'
import { flushLine } from './paragraph-flow'
import type {
  DocumentLayout,
  IncrementalLayoutPassInput,
  LayoutCursor,
  LayoutInput,
  LayoutSectionContext,
  MutablePageBox
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
  let previousSectionContext: LayoutSectionContext | undefined

  for (const section of sourceProjection.document.sections) {
    startSectionLayout(cursor, pages, section, previousSectionContext, input.pageConfig)
    previousSectionContext = cursor.sectionContext

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
