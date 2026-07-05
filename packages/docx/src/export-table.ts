/**
 * 职责：生成 DOCX export 使用的基础表格 XML。
 * 边界：只处理 table、row、cell 与 cell 内 block 的 XML 拼接，不写 package graph。
 * 协作模块：export.ts 提供 block writer，export-utils 提供边框与属性 XML helper。
 * 性能/安全约束：不访问 DOM，不读取磁盘，只消费 projection 中的表格快照。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#iteration-18---实现-t1-docx-export列表表格图片。
 */

import type { Block, Table, TableCell, TableRow } from '@4xian/jword-core'

import { readTableBorderSnapshot, writeTableBordersXml } from './export-utils.js'

export interface ExportTableContext {
  writeBlock(block: Block): string
}

/** 写基础表格 XML。 */
export function writeTableXml(table: Table, context: ExportTableContext): string {
  const rows = table.rows.map((row) => writeTableRowXml(row, context)).join('')

  return `<w:tbl>${writeTablePropertiesXml(table)}${writeTableGridXml(table.grid)}${rows}</w:tbl>`
}

/** 写表格属性 XML。 */
function writeTablePropertiesXml(table: Table): string {
  const border = readTableBorderSnapshot(table.border, table.properties)
  const children = [
    writeTableBordersXml(border, 'tblBorders')
  ].filter((child) => child.length > 0).join('')

  return children.length === 0 ? '' : `<w:tblPr>${children}</w:tblPr>`
}

/** 写表格列宽网格 XML。 */
function writeTableGridXml(grid: readonly number[] | undefined): string {
  const columns = grid
    ?.filter((width) => Number.isFinite(width) && width > 0)
    .map((width) => `<w:gridCol w:w="${Math.round(width)}"/>`)

  if (columns === undefined || columns.length === 0) {
    return ''
  }

  return `<w:tblGrid>${columns.join('')}</w:tblGrid>`
}

/** 写表格行 XML。 */
function writeTableRowXml(row: TableRow, context: ExportTableContext): string {
  return `<w:tr>${row.cells.map((cell) => writeTableCellXml(cell, context)).join('')}</w:tr>`
}

/** 写表格单元格 XML。 */
function writeTableCellXml(cell: TableCell, context: ExportTableContext): string {
  const blocks = cell.blocks.length === 0
    ? '<w:p/>'
    : cell.blocks.map((block) => context.writeBlock(block)).join('')

  return `<w:tc>${writeTableCellPropertiesXml(cell)}${blocks}</w:tc>`
}

/** 写表格单元格属性 XML。 */
function writeTableCellPropertiesXml(cell: TableCell): string {
  const children = [
    writeTableCellGridSpanXml(cell.gridSpan),
    writeTableBordersXml(readTableBorderSnapshot(cell.border, cell.properties), 'tcBorders')
  ].filter((child) => child.length > 0).join('')

  return children.length === 0 ? '' : `<w:tcPr>${children}</w:tcPr>`
}

/** 写表格单元格横向 span XML。 */
function writeTableCellGridSpanXml(gridSpan: number | undefined): string {
  if (gridSpan === undefined || !Number.isFinite(gridSpan) || gridSpan <= 1) {
    return ''
  }

  return `<w:gridSpan w:val="${Math.round(gridSpan)}"/>`
}
