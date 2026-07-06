/**
 * 职责：按块类型调度 paragraph、table 等分页 layout 子流程。
 * 边界：不实现 run 级测量，不实现表格单元格内容布局，不生成最终 DocumentLayout。
 * 协作模块：engine 遍历文档结构后调用这里，inline-layout 和 table-layout 执行具体块布局。
 * 性能/安全约束：只读 DocumentProjection 派生输入，不访问 DOM、不绘制 Canvas。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/03-architecture.md#36-layout-engine。
 */

import type { Block, Section } from '../model/types'
import { assignPageSectionBoundary } from './internal'
import { ensureEmptyParagraphVisible, layoutRun } from './inline-layout'
import {
  applyParagraphSpacingAfter,
  applyParagraphSpacingBefore,
  applyParagraphWidowControl,
  flushLine,
  startParagraph
} from './paragraph-flow'
import { layoutTable } from './table-layout'
import type {
  IncrementalLayoutContext,
  LayoutCursor,
  LayoutInput,
  MutablePageBox
} from './types'

/** 排布单个块，并返回本次增量 layout 是否需要提前停止。 */
export function layoutBlock(
  block: Block,
  section: Section,
  input: LayoutInput,
  cursor: LayoutCursor,
  pages: MutablePageBox[],
  incremental?: IncrementalLayoutContext
): boolean {
  assignPageSectionBoundary(cursor.page, section, cursor.sectionContext)

  if (block.kind === 'table') {
    layoutTable(block, section, cursor, pages, input.pageConfig, input)
    return false
  }

  if (block.kind !== 'paragraph') {
    return false
  }

  const resourceById = new Map((input.projection.document.resources ?? []).map((resource) => [resource.id, resource] as const))

  startParagraph(cursor, section.id, block, input.pageConfig)
  applyParagraphSpacingBefore(cursor)

  for (const run of block.runs) {
    if (layoutRun(run, section, block, input, cursor, pages, incremental, resourceById)) {
      return true
    }
  }

  ensureEmptyParagraphVisible(block, section, input, cursor, pages)
  flushLine(cursor)
  applyParagraphWidowControl(cursor, pages)
  applyParagraphSpacingAfter(cursor)

  return false
}
