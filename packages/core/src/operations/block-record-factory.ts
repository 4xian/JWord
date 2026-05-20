/**
 * 职责：把只读 model block/run/table 快照转换为 Y.Doc 记录。
 * 边界：只创建记录和复制结构化 inline，不应用 operation、不查找现有 store。
 * 协作模块：operation-adapter 插入 block、图片 run 分裂和 table adapter 复用这里的记录工厂。
 * 性能/安全约束：不访问 DOM，不持有外部可写状态；纯文本 run 默认只写 Y.Text，避免结构化 inline 覆盖后续输入。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/03-architecture.md#34-operation。
 */
import * as Y from 'yjs'

import {
  DOCUMENT_STORE_FIELDS,
  createRunRecord,
  getRunInlines,
  getRunText,
  getRunField,
  getRunLink,
  getRunRevisionId
} from '../model/document-store'
import { createJWordError } from '../shared/errors'
import type {
  BlockRecord,
  BlockRecordValue,
  DocumentStoreJson,
  ResourceId,
  RunRecord,
  RunRecordStructureInput,
  StyleId,
  TableCellRecord,
  TableCellRecordValue,
  TableRowRecord,
  TableRowRecordValue
} from '../model/document-store'
import type { Block, Paragraph, Run, Table, TableCell, TableRow, TextInline } from '../model/types'
import type { BlockId, CommentId, RevisionId, RunId } from '../model/position'

/** 从 model block 创建 Y.Doc block 记录。 */
export function createBlockRecordFromModel(block: Block): BlockRecord {
  if (block.kind === 'paragraph') {
    return createParagraphRecordFromModel(block)
  }

  return createTableRecordFromModel(block)
}

/** 从 model table row 创建 Y.Doc table row 记录。 */
export function createTableRowRecordFromModel(row: TableRow): TableRowRecord {
  const record = new Y.Map<TableRowRecordValue>() as TableRowRecord
  const cells = new Y.Array<TableCellRecord>()

  record.set(DOCUMENT_STORE_FIELDS.tableRow.id, row.id)
  record.set(DOCUMENT_STORE_FIELDS.tableRow.properties, createPropertyMap(row.properties ?? {}))
  record.set(DOCUMENT_STORE_FIELDS.tableRow.cells, cells)
  cells.push(row.cells.map(createTableCellRecordFromModel))

  return record
}

/** 从 model table cell 创建 Y.Doc table cell 记录。 */
export function createTableCellRecordFromModel(cell: TableCell): TableCellRecord {
  const record = new Y.Map<TableCellRecordValue>() as TableCellRecord
  const blocks = new Y.Array<BlockRecord>()
  const properties = {
    ...(cell.properties ?? {}),
    ...(cell.border === undefined ? {} : { border: cell.border })
  }

  record.set(DOCUMENT_STORE_FIELDS.tableCell.id, cell.id)
  record.set(DOCUMENT_STORE_FIELDS.tableCell.properties, createPropertyMap(properties))
  record.set(DOCUMENT_STORE_FIELDS.tableCell.gridSpan, cell.gridSpan ?? 1)
  record.set(DOCUMENT_STORE_FIELDS.tableCell.blocks, blocks)
  blocks.push(cell.blocks.map(createBlockRecordFromModel))

  return record
}

/** 创建只包含图片 inline 的 run 记录。 */
export function createImageRunRecord(runId: RunId, image: Extract<Run['inlines'][number], { kind: 'image' }>): RunRecord {
  const record = createRunRecord(runId, '', {
    inlines: [image]
  })

  syncRunResourceIds(record, [image])

  return record
}

/** 图片尾侧缺少文本容器时，补一个最小空 run 作为后续输入落点。 */
export function createTrailingTextRunRecord(runId: RunId, source: RunRecord): RunRecord {
  return runSupportsTextContainer(source)
    ? createSplitRunRecord(runId, '', source)
    : createRunRecord(runId, '')
}

/** 判断指定插入点是否需要补充尾侧文本 run。 */
export function shouldInsertTrailingTextRun(container: Y.Array<RunRecord>, insertIndex: number): boolean {
  return !runSupportsTextContainer(container.get(insertIndex))
}

/** 克隆 source run 的结构并替换文本和 ID。 */
export function createSplitRunRecord(runId: RunId, textValue: string, source: RunRecord): RunRecord {
  const field = getRunField(source)
  const link = getRunLink(source)
  const revisionId = getRunRevisionId(source)
  const inlines = getRunInlines(source)
  const structureInput: RunRecordStructureInput = {
    ...(field === undefined ? {} : { field }),
    ...(link === undefined ? {} : { link }),
    ...(revisionId === undefined ? {} : { revisionId }),
    ...(inlines === undefined ? {} : { inlines })
  }

  const clone = createRunRecord(runId, textValue, structureInput)
  const properties = clonePropertyMap(readPropertyMap(source, DOCUMENT_STORE_FIELDS.run.properties))

  clone.set(DOCUMENT_STORE_FIELDS.run.properties, properties)
  syncRunResourceIds(clone, inlines ?? [])

  return clone
}

/** 同步 run 的资源 ID 列表。 */
export function syncRunResourceIds(run: RunRecord, inlines: readonly Run['inlines'][number][]): void {
  const nextIds = inlines
    .filter((inline): inline is Extract<Run['inlines'][number], { kind: 'image' }> => inline.kind === 'image')
    .map((inline) => inline.resourceId as ResourceId)
  const resourceIds = new Y.Array<ResourceId>()

  if (nextIds.length > 0) {
    resourceIds.push(nextIds)
  }

  run.set(DOCUMENT_STORE_FIELDS.run.resourceIds, resourceIds)
}

/** 从 model paragraph 创建 Y.Doc paragraph 记录。 */
function createParagraphRecordFromModel(paragraph: Paragraph): BlockRecord {
  const record = new Y.Map<BlockRecordValue>() as BlockRecord
  const properties = createPropertyMap(paragraph.properties ?? {})
  const runs = new Y.Array<RunRecord>()

  record.set(DOCUMENT_STORE_FIELDS.block.kind, 'paragraph')
  record.set(DOCUMENT_STORE_FIELDS.block.id, paragraph.id as BlockId)
  record.set(DOCUMENT_STORE_FIELDS.block.properties, properties)
  record.set(DOCUMENT_STORE_FIELDS.block.runs, runs)
  record.set(DOCUMENT_STORE_FIELDS.block.resourceIds, new Y.Array<ResourceId>())
  record.set(DOCUMENT_STORE_FIELDS.block.styleIds, new Y.Array<StyleId>())
  record.set(DOCUMENT_STORE_FIELDS.block.commentIds, new Y.Array<CommentId>())
  record.set(DOCUMENT_STORE_FIELDS.block.revisionIds, new Y.Array<RevisionId>())
  runs.push(paragraph.runs.map(createRunRecordFromModel))

  return record
}

/** 从 model run 创建 Y.Doc run 记录。 */
function createRunRecordFromModel(run: Run): RunRecord {
  const structureInput: RunRecordStructureInput = {
    ...(run.properties === undefined ? {} : { properties: run.properties }),
    ...(run.field === undefined ? {} : { field: run.field }),
    ...(run.link === undefined ? {} : { link: run.link }),
    ...(run.revisionId === undefined ? {} : { revisionId: run.revisionId }),
    ...(shouldPersistStructuredInlines(run) ? { inlines: run.inlines } : {})
  }

  return createRunRecord(run.id as RunId, collectText(run), structureInput)
}

/** 判断 run 是否必须保留结构化 inline，而不是只用 Y.Text 承载纯文本。 */
function shouldPersistStructuredInlines(run: Run): boolean {
  return run.inlines.some((inline) => inline.kind !== 'text')
}

/** 从 model table 创建 Y.Doc table 记录。 */
function createTableRecordFromModel(table: Table): BlockRecord {
  const record = new Y.Map<BlockRecordValue>() as BlockRecord
  const rows = new Y.Array<TableRowRecord>()
  const properties = {
    ...(table.properties ?? {}),
    ...(table.grid === undefined ? {} : { grid: table.grid }),
    ...(table.border === undefined ? {} : { border: table.border })
  }

  record.set(DOCUMENT_STORE_FIELDS.block.kind, 'table')
  record.set(DOCUMENT_STORE_FIELDS.block.id, table.id as BlockId)
  record.set(DOCUMENT_STORE_FIELDS.block.properties, createPropertyMap(properties))
  record.set(DOCUMENT_STORE_FIELDS.block.rows, rows)
  record.set(DOCUMENT_STORE_FIELDS.block.resourceIds, new Y.Array<ResourceId>())
  record.set(DOCUMENT_STORE_FIELDS.block.styleIds, new Y.Array<StyleId>())
  record.set(DOCUMENT_STORE_FIELDS.block.commentIds, new Y.Array<CommentId>())
  record.set(DOCUMENT_STORE_FIELDS.block.revisionIds, new Y.Array<RevisionId>())
  rows.push(table.rows.map(createTableRowRecordFromModel))

  return record
}

/** 判断 run 是否可继续承载文本输入。 */
function runSupportsTextContainer(run: RunRecord | undefined): boolean {
  if (run === undefined) {
    return false
  }

  const inlines = getRunInlines(run)

  return inlines === undefined || inlines.some((inline) => inline.kind === 'text')
}

/** 收集 run 中所有文本 inline。 */
function collectText(run: Run): string {
  return run.inlines
    .filter((inline): inline is TextInline => inline.kind === 'text')
    .map((inline) => inline.text)
    .join('')
}

/** 创建属性 map。 */
function createPropertyMap(properties: Readonly<Record<string, unknown>>): Y.Map<DocumentStoreJson> {
  const map = new Y.Map<DocumentStoreJson>()

  for (const [key, value] of Object.entries(properties)) {
    map.set(key, toDocumentStoreJson(value))
  }

  return map
}

/** 克隆属性 map。 */
function clonePropertyMap(properties: Y.Map<DocumentStoreJson>): Y.Map<DocumentStoreJson> {
  const map = new Y.Map<DocumentStoreJson>()

  for (const [key, value] of properties.entries()) {
    map.set(key, value)
  }

  return map
}

/** 读取属性 map。 */
function readPropertyMap(record: { get(fieldName: string): unknown }, fieldName: string): Y.Map<DocumentStoreJson> {
  const value = record.get(fieldName)

  if (value instanceof Y.Map) {
    return value as Y.Map<DocumentStoreJson>
  }

  throw createJWordError('OPERATION_PROPERTY_CONTAINER_MISSING', '属性容器缺失')
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
