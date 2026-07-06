/**
 * 职责：构造表格插入、行列编辑、尺寸、合并、边框与单元格文本命令。
 * 边界：只生成 table operation，不执行事务、不修改 DocumentProjection。
 * 协作模块：共享插入定位辅助函数、事务流水线和 layout 表格模型共同提供表格能力。
 * 性能/安全约束：只遍历投影树收集模型 ID 和查找目标表格，避免生成重复 ID。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/05-implementation-gates.md#step-410图片插入与资源管理。
 */

import type { DocumentProjection } from '../model/projection'
import type { SelectionState } from '../model/selection'
import type { Table, TableBorder } from '../model/types'
import {
  collectRunIds,
  resolveSelectionInsertionContext
} from './command-builder-utils'
import type { Command } from './transaction'

const DEFAULT_TABLE_COLUMN_WIDTH_TWIPS = 1500
const DEFAULT_TABLE_ROW_HEIGHT_TWIPS = 600

/** 构造插入简单表格命令。 */
export function buildInsertTableCommand(
  projection: DocumentProjection,
  selection: SelectionState | null,
  input: Readonly<{
    rows: number
    columns: number
  }>
): Command | null {
  const section = projection.document.sections[0]

  if (section === undefined) {
    return null
  }

  const insertion = resolveSelectionInsertionContext(projection, selection)
  const sectionId = insertion?.at.sectionId ?? section.id
  const usedIds = collectModelIds(projection)
  const tableId = allocateGeneratedModelId(usedIds, 'table')

  return {
    name: 'insertTable',
    operations: [{
      kind: 'insertTable',
      sectionId,
      placement: insertion === null
        ? { kind: 'append' }
        : { kind: 'after', blockId: insertion.blockId },
      table: createSimpleTableModel(tableId, Math.max(1, input.rows), Math.max(1, input.columns), usedIds)
    }]
  }
}

/** 构造插入表格行命令。 */
export function buildInsertTableRowCommand(
  projection: DocumentProjection,
  tableId: string,
  rowIndex: number
): Command | null {
  const table = findTableById(projection, tableId)

  if (table === null) {
    return null
  }

  const usedIds = collectModelIds(projection)
  const columnCount = resolveTableColumnCount(table)

  return {
    name: 'insertTableRow',
    operations: [{
      kind: 'insertTableRow',
      tableId,
      rowIndex,
      rowHeightTwips: readTableRowHeight(table.rows[Math.max(0, Math.min(rowIndex, table.rows.length - 1))] ?? table.rows[rowIndex - 1]),
      rowId: allocateGeneratedModelId(usedIds, `${tableId}-row`),
      cellIds: createGeneratedIdList(usedIds, `${tableId}-cell`, columnCount),
      paragraphIds: createGeneratedIdList(usedIds, `${tableId}-paragraph`, columnCount),
      runIds: createGeneratedIdList(usedIds, `${tableId}-run`, columnCount)
    }]
  }
}

/** 构造删除表格行命令。 */
export function buildDeleteTableRowCommand(
  projection: DocumentProjection,
  tableId: string,
  rowIndex: number
): Command | null {
  const table = findTableById(projection, tableId)

  if (table === null || table.rows.length <= 1) {
    return null
  }

  return {
    name: 'deleteTableRow',
    operations: [{
      kind: 'deleteTableRow',
      tableId,
      rowIndex
    }]
  }
}

/** 构造插入表格列命令。 */
export function buildInsertTableColumnCommand(
  projection: DocumentProjection,
  tableId: string,
  columnIndex: number
): Command | null {
  const table = findTableById(projection, tableId)

  if (table === null) {
    return null
  }

  const usedIds = collectModelIds(projection)

  return {
    name: 'insertTableColumn',
    operations: [{
      kind: 'insertTableColumn',
      tableId,
      columnIndex,
      columnWidthTwips: table.grid?.[Math.max(0, Math.min(columnIndex, (table.grid?.length ?? 1) - 1))] ?? DEFAULT_TABLE_COLUMN_WIDTH_TWIPS,
      cellIds: createGeneratedIdList(usedIds, `${tableId}-cell`, table.rows.length),
      paragraphIds: createGeneratedIdList(usedIds, `${tableId}-paragraph`, table.rows.length),
      runIds: createGeneratedIdList(usedIds, `${tableId}-run`, table.rows.length)
    }]
  }
}

/** 构造删除表格列命令。 */
export function buildDeleteTableColumnCommand(
  projection: DocumentProjection,
  tableId: string,
  columnIndex: number
): Command | null {
  const table = findTableById(projection, tableId)

  if (table === null || resolveTableColumnCount(table) <= 1) {
    return null
  }

  return {
    name: 'deleteTableColumn',
    operations: [{
      kind: 'deleteTableColumn',
      tableId,
      columnIndex
    }]
  }
}

/** 构造设置表格列宽命令。 */
export function buildSetTableColumnWidthCommand(
  projection: DocumentProjection,
  tableId: string,
  columnIndex: number,
  widthTwips: number
): Command | null {
  const table = findTableById(projection, tableId)
  const columnCount = table === null ? 0 : resolveTableColumnCount(table)

  if (table === null || columnIndex < 0 || columnIndex >= columnCount) {
    return null
  }

  const nextWidthTwips = normalizeTableColumnWidth(widthTwips)
  const currentWidthTwips = table.grid?.[columnIndex] ?? DEFAULT_TABLE_COLUMN_WIDTH_TWIPS

  if (currentWidthTwips === nextWidthTwips) {
    return null
  }

  return {
    name: 'setTableColumnWidth',
    operations: [{
      kind: 'setTableColumnWidth',
      tableId,
      columnIndex,
      widthTwips: nextWidthTwips
    }]
  }
}

/** 构造设置表格行高命令。 */
export function buildSetTableRowHeightCommand(
  projection: DocumentProjection,
  tableId: string,
  rowIndex: number,
  heightTwips: number
): Command | null {
  const table = findTableById(projection, tableId)
  const row = table?.rows[rowIndex]

  if (table === null || row === undefined) {
    return null
  }

  const nextHeightTwips = normalizeTableRowHeight(heightTwips)
  const currentHeightTwips = readTableRowHeight(row)

  if (currentHeightTwips === nextHeightTwips) {
    return null
  }

  return {
    name: 'setTableRowHeight',
    operations: [{
      kind: 'setTableRowHeight',
      tableId,
      rowIndex,
      heightTwips: nextHeightTwips
    }]
  }
}

/** 构造合并同一行连续单元格命令。 */
export function buildMergeTableCellsCommand(
  projection: DocumentProjection,
  tableId: string,
  rowIndex: number,
  startColumnIndex: number,
  endColumnIndex: number
): Command | null {
  const table = findTableById(projection, tableId)
  const row = table?.rows[rowIndex]

  if (table === null || row === undefined || endColumnIndex <= startColumnIndex) {
    return null
  }

  return {
    name: 'mergeTableCells',
    operations: [{
      kind: 'mergeTableCells',
      tableId,
      rowIndex,
      startColumnIndex,
      endColumnIndex
    }]
  }
}

/** 构造表格边框命令。 */
export function buildSetTableBorderCommand(
  projection: DocumentProjection,
  tableId: string,
  border: TableBorder,
  cellId?: string
): Command | null {
  if (findTableById(projection, tableId) === null) {
    return null
  }

  return {
    name: 'setTableBorder',
    operations: [{
      kind: 'setTableBorder',
      tableId,
      ...(cellId === undefined ? {} : { cellId }),
      border
    }]
  }
}

/** 构造单元格文本替换命令。 */
export function buildSetTableCellTextCommand(
  projection: DocumentProjection,
  tableId: string,
  cellId: string,
  text: string
): Command | null {
  if (findTableCellById(projection, tableId, cellId) === null) {
    return null
  }

  return {
    name: 'setTableCellText',
    operations: [{
      kind: 'setTableCellText',
      tableId,
      cellId,
      text
    }]
  }
}

/** 构造单元格边框命令。 */
export function buildSetTableCellBorderCommand(
  projection: DocumentProjection,
  tableId: string,
  cellId: string,
  border: TableBorder
): Command | null {
  const command = buildSetTableBorderCommand(projection, tableId, border, cellId)

  return command === null
    ? null
    : {
        name: 'setTableCellBorder',
        operations: command.operations
      }
}

/** 创建最小简单表格模型。 */
function createSimpleTableModel(
  tableId: string,
  rows: number,
  columns: number,
  usedIds: Set<string>
): Table {
  return {
    kind: 'table',
    id: tableId,
    grid: Array.from({ length: columns }, () => DEFAULT_TABLE_COLUMN_WIDTH_TWIPS),
    border: {
      color: '#6b7280',
      widthTwips: 15
    },
    rows: Array.from({ length: rows }, () => {
      const rowId = allocateGeneratedModelId(usedIds, `${tableId}-row`)

      return {
        id: rowId,
        properties: {
          heightTwips: DEFAULT_TABLE_ROW_HEIGHT_TWIPS
        },
        cells: Array.from({ length: columns }, () => {
          const cellId = allocateGeneratedModelId(usedIds, `${tableId}-cell`)
          const paragraphId = allocateGeneratedModelId(usedIds, `${tableId}-paragraph`)
          const runId = allocateGeneratedModelId(usedIds, `${tableId}-run`)

          return {
            id: cellId,
            blocks: [{
              kind: 'paragraph',
              id: paragraphId,
              runs: [{
                kind: 'run',
                id: runId,
                inlines: [{
                  kind: 'text',
                  text: ''
                }]
              }]
            }]
          }
        })
      }
    })
  }
}

/** 收集模型内所有常用 ID，避免 command builder 生成重复 ID。 */
function collectModelIds(projection: DocumentProjection): Set<string> {
  const ids = collectRunIds(projection)

  for (const section of projection.document.sections) {
    ids.add(section.id)
    visitBlocks(section.blocks)
  }

  return ids

  /** 递归收集块、表格行、单元格 ID。 */
  function visitBlocks(blocks: readonly import('../model/types').Block[]): void {
    for (const block of blocks) {
      ids.add(block.id)

      if (block.kind === 'paragraph') {
        continue
      }

      for (const row of block.rows) {
        ids.add(row.id)
        for (const cell of row.cells) {
          ids.add(cell.id)
          visitBlocks(cell.blocks)
        }
      }
    }
  }
}

/** 分配模型节点 ID。 */
function allocateGeneratedModelId(usedIds: Set<string>, prefix: string): string {
  let sequence = 1
  let candidate = `${prefix}-${sequence}`

  while (usedIds.has(candidate)) {
    sequence += 1
    candidate = `${prefix}-${sequence}`
  }

  usedIds.add(candidate)

  return candidate
}

/** 批量生成模型 ID。 */
function createGeneratedIdList(usedIds: Set<string>, prefix: string, count: number): readonly string[] {
  return Array.from({ length: count }, () => allocateGeneratedModelId(usedIds, prefix))
}

/** 根据 ID 查找表格。 */
function findTableById(projection: DocumentProjection, tableId: string): Table | null {
  for (const section of projection.document.sections) {
    const table = visitBlocks(section.blocks)

    if (table !== null) {
      return table
    }
  }

  return null

  /** 递归查找表格。 */
  function visitBlocks(blocks: readonly import('../model/types').Block[]): Table | null {
    for (const block of blocks) {
      if (block.kind === 'table' && block.id === tableId) {
        return block
      }

      if (block.kind !== 'table') {
        continue
      }

      for (const row of block.rows) {
        for (const cell of row.cells) {
          const nested = visitBlocks(cell.blocks)

          if (nested !== null) {
            return nested
          }
        }
      }
    }

    return null
  }
}

/** 根据 ID 查找表格单元格。 */
function findTableCellById(
  projection: DocumentProjection,
  tableId: string,
  cellId: string
): Table['rows'][number]['cells'][number] | null {
  const table = findTableById(projection, tableId)

  if (table === null) {
    return null
  }

  for (const row of table.rows) {
    for (const cell of row.cells) {
      if (cell.id === cellId) {
        return cell
      }
    }
  }

  return null
}

/** 读取表格当前列数。 */
function resolveTableColumnCount(table: Table): number {
  const firstRow = table.rows[0]

  return Math.max(1, firstRow?.cells.reduce((count, cell) => count + (cell.gridSpan ?? 1), 0) ?? table.grid?.length ?? 1)
}

function readTableRowHeight(row: Table['rows'][number] | undefined): number {
  const value = row?.properties?.heightTwips

  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : DEFAULT_TABLE_ROW_HEIGHT_TWIPS
}

function normalizeTableColumnWidth(widthTwips: number): number {
  return Number.isFinite(widthTwips) && widthTwips > 0
    ? Math.round(widthTwips)
    : DEFAULT_TABLE_COLUMN_WIDTH_TWIPS
}

function normalizeTableRowHeight(heightTwips: number): number {
  return Number.isFinite(heightTwips) && heightTwips > 0
    ? Math.round(heightTwips)
    : DEFAULT_TABLE_ROW_HEIGHT_TWIPS
}
