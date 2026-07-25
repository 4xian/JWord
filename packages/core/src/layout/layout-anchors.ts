/**
 * 职责：处理 layout section 起点、页边界继承和 inline 边界锚点写入。
 * 边界：不测量文本、不排布表格、不生成最终 DocumentLayout。
 * 协作模块：engine 调用 section 起点逻辑，inline-layout 调用 inline 边界锚点逻辑。
 * 性能/安全约束：只修改当前 layout cursor 和可变页盒，不访问 DOM、不绘制 Canvas。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import type { Inline, Paragraph, Section } from '../model/types'
import type { PageConfig } from './page-config'
import type { Resource } from '../resources/types'
import { assignPageSectionBoundary } from './internal'
import {
  appendNonTextInlineBox,
  ensureLine,
  flushLine,
  startNewPage,
  startParagraph
} from './paragraph-flow'
import type {
  LayoutCursor,
  LayoutSectionContext,
  MutablePageBox,
  PageBreakBox
} from './types'

/** 开始排布 section，并继承或重置页眉页脚和页码上下文。 */
export function startSectionLayout(
  cursor: LayoutCursor,
  pages: MutablePageBox[],
  section: Section,
  previousContext: LayoutSectionContext | undefined,
  pageConfig: PageConfig
): void {
  if (section.breakType === 'next-page' && cursor.page.sectionIds.length > 0) {
    startNewPage(cursor, pages, pageConfig)
  }

  const headerIds = section.headerFooterSameAsPrevious === true
    ? previousContext?.headerIds ?? section.headerIds ?? Object.freeze([])
    : section.headerIds ?? Object.freeze([])
  const footerIds = section.headerFooterSameAsPrevious === true
    ? previousContext?.footerIds ?? section.footerIds ?? Object.freeze([])
    : section.footerIds ?? Object.freeze([])
  const startPageNumber = section.pageNumbering?.mode === 'restart'
    ? section.pageNumbering.start ?? 1
    : cursor.page.pageIndex + 1

  cursor.sectionContext = Object.freeze({
    sectionId: section.id,
    headerIds,
    footerIds,
    startPageIndex: cursor.page.pageIndex,
    startPageNumber
  })
  assignPageSectionBoundary(cursor.page, section, cursor.sectionContext)
}

/** 写入 inline 对象、软换行和分页符对应的布局锚点。 */
export function layoutInlineBoundary(
  inline: Inline,
  section: Section,
  paragraph: Paragraph,
  runId: string,
  graphemeIndex: number,
  cursor: LayoutCursor,
  pages: MutablePageBox[],
  pageConfig: PageConfig,
  resourceById?: ReadonlyMap<string, Resource>
): void {
  const sectionId = section.id

  if (inline.kind !== 'break') {
    if (inline.kind !== 'text') {
      appendNonTextInlineBox(inline, sectionId, paragraph.id, runId, graphemeIndex, cursor, pageConfig, resourceById)
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
  assignPageSectionBoundary(cursor.page, section, cursor.sectionContext)
  startParagraph(cursor, sectionId, paragraph, pageConfig)
}
