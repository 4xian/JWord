/**
 * 职责：应用 Gate 4 简单表格 operation 到 Y.Doc 表格记录。
 * 边界：只处理表格行列、合并、边框和单元格文本，不处理通用文本、图片或资源 operation。
 * 协作模块：operation-adapter 负责分发，block-record-factory 负责创建 row/cell 记录。
 * 性能/安全约束：不访问 DOM，不直接改 projection；所有写入发生在 transaction pipeline 的 Y.Doc transact 内。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md Step 4.4-4.7。
 */
import * as Y from 'yjs'

import {
  DOCUMENT_STORE_FIELDS,
  getParagraphRuns,
  getRunText,
  getSectionBlocks,
  getTableCellBlocks,
  getTableRowCells,
  getTableRows,
  setRunStructure
} from '../model/document-store'
import { createJWordError } from '../shared/errors'
import type { BlockRecord, DocumentStore, DocumentStoreJson, TableCellRecord } from '../model/document-store'
import type { BlockId } from '../model/position'
import type { TableCell, TableRow } from '../model/types'
import type { Operation } from './transaction'
import {
  createTableCellRecordFromModel,
  createTableRowRecordFromModel
} from './block-record-factory'

type TableOperation = Extract<Operation, {
  kind:
    | 'insertTableRow'
    | 'deleteTableRow'
    | 'insertTableColumn'
    | 'deleteTableColumn'
    | 'setTableColumnWidth'
    | 'setTableRowHeight'
    | 'mergeTableCells'
    | 'setTableBorder'
    | 'setTableCellText'
}>

interface SharedMapReader {
  get(fieldName: string): unknown
}

interface BlockLocation {
  readonly block: BlockRecord
}

interface VisualTableCell {
  readonly cell: TableCellRecord
  readonly index: number
  readonly startColumn: number
  readonly endColumn: number
  readonly gridSpan: number
}

const DEFAULT_TABLE_COLUMN_WIDTH_TWIPS = 1500
const DEFAULT_TABLE_ROW_HEIGHT_TWIPS = 600

/** 应用单个表格 operation。 */
export function applyTableOperation(store: DocumentStore, operation: TableOperation): void {
  switch (operation.kind) {
    case 'insertTableRow':
      insertTableRow(store, operation)
      break
    case 'deleteTableRow':
      deleteTableRow(store, operation)
      break
    case 'insertTableColumn':
      insertTableColumn(store, operation)
      break
    case 'deleteTableColumn':
      deleteTableColumn(store, operation)
      break
    case 'setTableColumnWidth':
      setTableColumnWidth(store, operation)
      break
    case 'setTableRowHeight':
      setTableRowHeight(store, operation)
      break
    case 'mergeTableCells':
      mergeTableCells(store, operation)
      break
    case 'setTableBorder':
      setTableBorder(store, operation)
      break
    case 'setTableCellText':
      setTableCellText(store, operation)
      break
  }
}

/** 在表格中插入一行。 */
function insertTableRow(store: DocumentStore, operation: Extract<Operation, { kind: 'insertTableRow' }>): void {
  const table = findTableRecord(store, operation.tableId)
  const rows = getTableRows(table)
  const columnCount = resolveTableColumnCount(table)
  const index = Math.max(0, Math.min(operation.rowIndex, rows.length))
  const inheritedHeightTwips = readInsertionRowHeight(table, index)
  const row = createTableRowRecordFromModel(createTableTextRowModel(
    operation.rowId,
    columnCount,
    operation.cellIds,
    operation.paragraphIds,
    operation.runIds,
    normalizeTableRowHeight(operation.rowHeightTwips ?? inheritedHeightTwips)
  ))

  rows.insert(index, [row])
}

/** 删除表格中的一行，保留至少一行。 */
function deleteTableRow(store: DocumentStore, operation: Extract<Operation, { kind: 'deleteTableRow' }>): void {
  const table = findTableRecord(store, operation.tableId)
  const rows = getTableRows(table)

  if (rows.length <= 1) {
    return
  }

  const index = Math.max(0, Math.min(operation.rowIndex, rows.length - 1))

  rows.delete(index, 1)
}

/** 在表格中插入一列。 */
function insertTableColumn(store: DocumentStore, operation: Extract<Operation, { kind: 'insertTableColumn' }>): void {
  const table = findTableRecord(store, operation.tableId)
  const columnCount = resolveTableColumnCount(table)
  const columnIndex = Math.max(0, Math.min(operation.columnIndex, columnCount))
  const nextGrid = readTableGridValues(table, columnCount)

  nextGrid.splice(columnIndex, 0, normalizeTableColumnWidth(operation.columnWidthTwips))
  setProperties(table, DOCUMENT_STORE_FIELDS.block.properties, {
    grid: nextGrid
  })

  const rows = getTableRows(table).toArray()

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex]

    if (row === undefined) {
      continue
    }

    const cells = getTableRowCells(row)
    const target = resolveTableColumnInsertion(readVisualTableCells(cells.toArray()), columnIndex)

    if (target.kind === 'expand') {
      target.cell.set(DOCUMENT_STORE_FIELDS.tableCell.gridSpan, target.gridSpan + 1)
      continue
    }

    cells.insert(target.index, [createTableCellRecordFromModel(createTableTextCellModel(
      operation.cellIds[rowIndex] ?? `${operation.tableId}-cell-${rowIndex}-${operation.columnIndex}`,
      operation.paragraphIds[rowIndex] ?? `${operation.tableId}-paragraph-${rowIndex}-${operation.columnIndex}`,
      operation.runIds[rowIndex] ?? `${operation.tableId}-run-${rowIndex}-${operation.columnIndex}`
    ))])
  }
}

/** 删除表格中的一列，保留至少一列。 */
function deleteTableColumn(store: DocumentStore, operation: Extract<Operation, { kind: 'deleteTableColumn' }>): void {
  const table = findTableRecord(store, operation.tableId)
  const columnCount = resolveTableColumnCount(table)

  if (columnCount <= 1) {
    return
  }

  const columnIndex = Math.max(0, Math.min(operation.columnIndex, columnCount - 1))
  const nextGrid = readTableGridValues(table, columnCount)

  nextGrid.splice(columnIndex, 1)
  setProperties(table, DOCUMENT_STORE_FIELDS.block.properties, {
    grid: nextGrid
  })

  for (const row of getTableRows(table).toArray()) {
    const cells = getTableRowCells(row)
    const target = resolveTableColumnCoverage(readVisualTableCells(cells.toArray()), columnIndex)

    if (target === undefined) {
      continue
    }

    if (target.gridSpan > 1) {
      target.cell.set(DOCUMENT_STORE_FIELDS.tableCell.gridSpan, target.gridSpan - 1)
      continue
    }

    if (cells.length > 1) {
      cells.delete(target.index, 1)
    }
  }
}

/** 设置指定列宽。 */
function setTableColumnWidth(store: DocumentStore, operation: Extract<Operation, { kind: 'setTableColumnWidth' }>): void {
  const table = findTableRecord(store, operation.tableId)
  const columnCount = resolveTableColumnCount(table)
  const columnIndex = Math.max(0, Math.min(operation.columnIndex, columnCount - 1))
  const nextGrid = readTableGridValues(table, columnCount)

  nextGrid[columnIndex] = normalizeTableColumnWidth(operation.widthTwips)
  setProperties(table, DOCUMENT_STORE_FIELDS.block.properties, {
    grid: nextGrid
  })
}

/** 设置指定行高。 */
function setTableRowHeight(store: DocumentStore, operation: Extract<Operation, { kind: 'setTableRowHeight' }>): void {
  const table = findTableRecord(store, operation.tableId)
  const row = getTableRows(table).get(operation.rowIndex)

  if (row === undefined) {
    return
  }

  setProperties(row, DOCUMENT_STORE_FIELDS.tableRow.properties, {
    heightTwips: normalizeTableRowHeight(operation.heightTwips)
  })
}

/** 合并同一行内的连续单元格。 */
function mergeTableCells(store: DocumentStore, operation: Extract<Operation, { kind: 'mergeTableCells' }>): void {
  const table = findTableRecord(store, operation.tableId)
  const row = getTableRows(table).get(operation.rowIndex)

  if (row === undefined) {
    return
  }

  const cells = getTableRowCells(row)
  const range = resolveTableMergeRange(
    readVisualTableCells(cells.toArray()),
    operation.startColumnIndex,
    operation.endColumnIndex
  )

  if (range === undefined) {
    return
  }

  range.cell.set(DOCUMENT_STORE_FIELDS.tableCell.gridSpan, range.gridSpan)
  cells.delete(range.index + 1, range.deleteCount)
}

/** 设置表格或指定单元格边框。 */
function setTableBorder(store: DocumentStore, operation: Extract<Operation, { kind: 'setTableBorder' }>): void {
  const table = findTableRecord(store, operation.tableId)
  const target = operation.cellId === undefined
    ? {
        record: table,
        propertiesField: DOCUMENT_STORE_FIELDS.block.properties
      }
    : {
        record: findTableCellRecord(table, operation.cellId),
        propertiesField: DOCUMENT_STORE_FIELDS.tableCell.properties
      }

  setProperties(target.record, target.propertiesField, {
    border: operation.border
  })
}

/** 替换单元格第一段第一 run 的文本。 */
function setTableCellText(store: DocumentStore, operation: Extract<Operation, { kind: 'setTableCellText' }>): void {
  const table = findTableRecord(store, operation.tableId)
  const cell = findTableCellRecord(table, operation.cellId)
  const block = getTableCellBlocks(cell).get(0)

  if (block === undefined) {
    return
  }

  assertBlockKind(block, 'paragraph')

  const run = getParagraphRuns(block).get(0)

  if (run === undefined) {
    return
  }

  const text = getRunText(run)

  if (text.length > 0) {
    text.delete(0, text.length)
  }
  if (operation.text.length > 0) {
    text.insert(0, operation.text)
  }
  run.delete(DOCUMENT_STORE_FIELDS.run.inlines)
}

/** 创建一行带空文本段落的单元格模型。 */
function createTableTextRowModel(
  rowId: string,
  columnCount: number,
  cellIds: readonly string[],
  paragraphIds: readonly string[],
  runIds: readonly string[],
  rowHeightTwips?: number
): TableRow {
  return {
    id: rowId,
    ...(rowHeightTwips === undefined ? {} : {
      properties: {
        heightTwips: rowHeightTwips
      }
    }),
    cells: Array.from({ length: columnCount }, (_, columnIndex) =>
      createTableTextCellModel(
        cellIds[columnIndex] ?? `${rowId}-cell-${columnIndex}`,
        paragraphIds[columnIndex] ?? `${rowId}-paragraph-${columnIndex}`,
        runIds[columnIndex] ?? `${rowId}-run-${columnIndex}`
      )
    )
  }
}

/** 创建一个包含空文本落点的单元格模型。 */
function createTableTextCellModel(cellId: string, paragraphId: string, runId: string): TableCell {
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
}

/** 根据第一行读取表格列数。 */
function resolveTableColumnCount(table: BlockRecord): number {
  const grid = readTableGridValues(table)

  if (grid.length > 0) {
    return grid.length
  }

  const firstRow = getTableRows(table).get(0)

  if (firstRow === undefined) {
    return 1
  }

  return Math.max(1, getTableRowCells(firstRow).toArray().reduce((count, cell) => count + readTableCellGridSpan(cell), 0))
}

/** 读取表格当前列网格，缺失时回退到默认列宽。 */
function readTableGridValues(table: BlockRecord, fallbackCount = 0): number[] {
  const properties = readPropertyMap(table, DOCUMENT_STORE_FIELDS.block.properties)
  const value = properties.get('grid')
  const grid = Array.isArray(value)
    ? value.filter((item): item is number => typeof item === 'number' && Number.isFinite(item) && item > 0)
    : []

  if (grid.length > 0) {
    return [...grid]
  }

  return Array.from({ length: Math.max(0, fallbackCount) }, () => DEFAULT_TABLE_COLUMN_WIDTH_TWIPS)
}

/** 规范化列宽，避免把非法值写进 grid。 */
function normalizeTableColumnWidth(widthTwips: number | undefined): number {
  return typeof widthTwips === 'number' && Number.isFinite(widthTwips) && widthTwips > 0
    ? Math.round(widthTwips)
    : DEFAULT_TABLE_COLUMN_WIDTH_TWIPS
}

/** 规范化行高，避免把非法值写入 row properties。 */
function normalizeTableRowHeight(heightTwips: number | undefined): number {
  return typeof heightTwips === 'number' && Number.isFinite(heightTwips) && heightTwips > 0
    ? Math.round(heightTwips)
    : DEFAULT_TABLE_ROW_HEIGHT_TWIPS
}

/** 插入新行时优先继承相邻行高，没有相邻行时回退默认值。 */
function readInsertionRowHeight(table: BlockRecord, rowIndex: number): number {
  const rows = getTableRows(table)
  const row = rows.get(Math.min(rowIndex, rows.length - 1))
    ?? rows.get(Math.max(0, rowIndex - 1))

  return readTableRowHeight(row)
}

/** 读取表格行高，缺失时回退默认值。 */
function readTableRowHeight(row: SharedMapReader | undefined): number {
  const properties = row === undefined ? undefined : readPropertyMap(row, DOCUMENT_STORE_FIELDS.tableRow.properties)
  const value = properties?.get('heightTwips')

  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : DEFAULT_TABLE_ROW_HEIGHT_TWIPS
}

/** 读取单元格 gridSpan，缺失时回退到 1。 */
function readTableCellGridSpan(cell: TableCellRecord): number {
  const value = cell.get(DOCUMENT_STORE_FIELDS.tableCell.gridSpan)

  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.max(1, Math.round(value)) : 1
}

/** 把一行单元格展开成逻辑列坐标索引。 */
function readVisualTableCells(cells: readonly TableCellRecord[]): readonly VisualTableCell[] {
  const visualCells: VisualTableCell[] = []
  let startColumn = 0

  for (let index = 0; index < cells.length; index += 1) {
    const cell = cells[index]

    if (cell === undefined) {
      continue
    }

    const gridSpan = readTableCellGridSpan(cell)

    visualCells.push({
      cell,
      index,
      startColumn,
      endColumn: startColumn + gridSpan,
      gridSpan
    })
    startColumn += gridSpan
  }

  return visualCells
}

/** 解析插入列时是扩展现有合并单元格还是插入新单元格。 */
function resolveTableColumnInsertion(
  visualCells: readonly VisualTableCell[],
  columnIndex: number
): Readonly<{
  kind: 'expand'
  cell: TableCellRecord
  gridSpan: number
}> | Readonly<{
  kind: 'insert'
  index: number
}> {
  for (const cell of visualCells) {
    if (columnIndex === cell.startColumn) {
      return {
        kind: 'insert',
        index: cell.index
      }
    }

    if (columnIndex > cell.startColumn && columnIndex < cell.endColumn) {
      return {
        kind: 'expand',
        cell: cell.cell,
        gridSpan: cell.gridSpan
      }
    }
  }

  return {
    kind: 'insert',
    index: visualCells.length
  }
}

/** 读取某一逻辑列当前命中的单元格。 */
function resolveTableColumnCoverage(
  visualCells: readonly VisualTableCell[],
  columnIndex: number
): VisualTableCell | undefined {
  return visualCells.find((cell) => columnIndex >= cell.startColumn && columnIndex < cell.endColumn)
}

/** 解析横向合并的真实单元格范围。 */
function resolveTableMergeRange(
  visualCells: readonly VisualTableCell[],
  startColumnIndex: number,
  endColumnIndex: number
): Readonly<{
  cell: TableCellRecord
  index: number
  gridSpan: number
  deleteCount: number
}> | undefined {
  const startCell = visualCells.find((cell) => cell.startColumn === startColumnIndex)
  const endCell = visualCells.find((cell) => cell.endColumn === endColumnIndex + 1)

  if (startCell === undefined || endCell === undefined || endCell.index <= startCell.index) {
    return undefined
  }

  return {
    cell: startCell.cell,
    index: startCell.index,
    gridSpan: endCell.endColumn - startCell.startColumn,
    deleteCount: endCell.index - startCell.index
  }
}

/** 查找表格记录。 */
function findTableRecord(store: DocumentStore, tableId: string): BlockRecord {
  const location = findBlockLocation(store, tableId as BlockId)

  assertBlockKind(location.block, 'table')

  return location.block
}

/** 查找表格中的单元格记录。 */
function findTableCellRecord(table: BlockRecord, cellId: string): TableCellRecord {
  for (const row of getTableRows(table).toArray()) {
    for (const cell of getTableRowCells(row).toArray()) {
      if (cell.get(DOCUMENT_STORE_FIELDS.tableCell.id) === cellId) {
        return cell
      }
    }
  }

  throw createJWordError('OPERATION_TABLE_CELL_NOT_FOUND', '找不到表格单元格', {
    tableId: readRequiredString(table, DOCUMENT_STORE_FIELDS.block.id),
    cellId
  })
}

/** 查找 block 记录。 */
function findBlockLocation(store: DocumentStore, blockId: BlockId): BlockLocation {
  for (const section of store.sections.toArray()) {
    const blocks = getSectionBlocks(section).toArray()

    for (const block of blocks) {
      if (block.get(DOCUMENT_STORE_FIELDS.block.id) === blockId) {
        return { block }
      }
    }
  }

  throw createJWordError('OPERATION_BLOCK_NOT_FOUND', '找不到块', {
    blockId: String(blockId)
  })
}

/** 合并属性到指定记录。 */
function setProperties(record: SharedMapReader, fieldName: string, properties: Readonly<Record<string, unknown>>): void {
  const target = readPropertyMap(record, fieldName)

  for (const [key, value] of Object.entries(properties)) {
    target.set(key, toDocumentStoreJson(value))
  }
}

/** 读取属性 map。 */
function readPropertyMap(record: SharedMapReader, fieldName: string): Y.Map<DocumentStoreJson> {
  const value = record.get(fieldName)

  if (value instanceof Y.Map) {
    return value as Y.Map<DocumentStoreJson>
  }

  throw createJWordError('OPERATION_PROPERTY_CONTAINER_MISSING', '属性容器缺失')
}

/** 读取必需字符串字段。 */
function readRequiredString(record: SharedMapReader, fieldName: string): string {
  const value = record.get(fieldName)

  if (typeof value === 'string') {
    return value
  }

  throw createJWordError('OPERATION_STRING_FIELD_MISSING', '字符串字段缺失', {
    fieldName
  })
}

/** 断言 block 类型。 */
function assertBlockKind(block: BlockRecord, kind: 'paragraph' | 'table'): void {
  if (block.get(DOCUMENT_STORE_FIELDS.block.kind) !== kind) {
    throw createJWordError('OPERATION_BLOCK_KIND_MISMATCH', `块类型不是 ${kind}`, {
      expectedKind: kind
    })
  }
}

/** 把属性值转换为 document store JSON。 */
function toDocumentStoreJson(value: unknown): DocumentStoreJson {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value
  }

  if (Array.isArray(value)) {
    return value.map(toDocumentStoreJson)
  }

  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nestedValue]) => [
        key,
        toDocumentStoreJson(nestedValue)
      ])
    )
  }

  throw createJWordError('OPERATION_PROPERTY_VALUE_INVALID', '属性值必须是 JSON 兼容数据')
}
