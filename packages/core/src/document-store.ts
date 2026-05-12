/**
 * 职责：提供 Gate 1 的 Y.Doc 权威状态结构最小壳。
 * 边界：只初始化共享容器，不实现具体 Operation adapter、Projection、协同 provider 或持久化。
 * 协作模块：transaction pipeline、model、history、collab 和 persistence 后续都会围绕同一个 Y.Doc 工作。
 * 性能/安全约束：不访问 DOM，不启动网络连接，所有写入必须由调用方显式包进 transact。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/03-architecture.md#32-状态真源。
 */

import * as Y from 'yjs'

import { createJWordError } from './errors'
import type { BlockId, CommentId, DocumentId, RevisionId, RunId, SectionId } from './position'

declare const documentStoreIdBrand: unique symbol

type DocumentStoreId<Name extends string> = string & {
  readonly [documentStoreIdBrand]: Name
}

/** 资源 ID，运行时仍是字符串。 */
export type ResourceId = DocumentStoreId<'ResourceId'>

/** 样式 ID，运行时仍是字符串。 */
export type StyleId = DocumentStoreId<'StyleId'>

/** Y.Doc 结构版本；具体写入仍交给后续 transaction adapter。 */
export const DOCUMENT_STORE_SCHEMA_VERSION = 1

/**
 * Gate 1.3 的根容器命名。
 *
 * document 保存文档入口关系；sections 保存正文节顺序；其他表按 ID 查找。
 */
export const DOCUMENT_STORE_CONTAINERS = {
  document: 'document',
  sections: 'sections',
  resources: 'resources',
  styles: 'styles',
  comments: 'comments',
  revisions: 'revisions'
} as const

/**
 * Gate 1.3 的最小字段命名。
 *
 * 这里只定义组织关系，不声明任何编辑操作、投影或布局行为。
 */
export const DOCUMENT_STORE_FIELDS = {
  document: {
    schemaVersion: 'schemaVersion',
    id: 'id',
    metadata: 'metadata',
    sectionIds: 'sectionIds',
    resourceIds: 'resourceIds',
    styleIds: 'styleIds',
    commentIds: 'commentIds',
    revisionIds: 'revisionIds'
  },
  section: {
    kind: 'kind',
    id: 'id',
    properties: 'properties',
    blocks: 'blocks',
    blockIds: 'blockIds',
    resourceIds: 'resourceIds',
    styleIds: 'styleIds',
    commentIds: 'commentIds',
    revisionIds: 'revisionIds',
    headerIds: 'headerIds',
    footerIds: 'footerIds'
  },
  block: {
    kind: 'kind',
    id: 'id',
    properties: 'properties',
    runs: 'runs',
    rows: 'rows',
    resourceIds: 'resourceIds',
    styleIds: 'styleIds',
    commentIds: 'commentIds',
    revisionIds: 'revisionIds'
  },
  run: {
    kind: 'kind',
    id: 'id',
    properties: 'properties',
    text: 'text',
    resourceIds: 'resourceIds',
    styleIds: 'styleIds',
    commentIds: 'commentIds',
    revisionIds: 'revisionIds'
  },
  tableRow: {
    id: 'id',
    properties: 'properties',
    cells: 'cells'
  },
  tableCell: {
    id: 'id',
    properties: 'properties',
    gridSpan: 'gridSpan',
    blocks: 'blocks'
  },
  resource: {
    kind: 'kind',
    id: 'id',
    mediaType: 'mediaType',
    dataRef: 'dataRef',
    metadata: 'metadata'
  },
  style: {
    kind: 'kind',
    id: 'id',
    basedOn: 'basedOn',
    properties: 'properties'
  },
  comment: {
    kind: 'kind',
    id: 'id',
    authorId: 'authorId',
    createdAt: 'createdAt',
    anchorRangeId: 'anchorRangeId',
    threadId: 'threadId',
    resolved: 'resolved',
    blockIds: 'blockIds',
    revisionIds: 'revisionIds'
  },
  revision: {
    kind: 'kind',
    id: 'id',
    authorId: 'authorId',
    createdAt: 'createdAt',
    type: 'type',
    rangeId: 'rangeId',
    targetId: 'targetId'
  }
} as const

export type DocumentStoreContainerName =
  (typeof DOCUMENT_STORE_CONTAINERS)[keyof typeof DOCUMENT_STORE_CONTAINERS]

export type DocumentStoreJson =
  | string
  | number
  | boolean
  | null
  | readonly DocumentStoreJson[]
  | { readonly [key: string]: DocumentStoreJson }

export type DocumentMetadataMap = Y.Map<DocumentStoreJson>
export type DocumentSectionIdList = Y.Array<SectionId>
export type DocumentResourceIdList = Y.Array<ResourceId>
export type DocumentStyleIdList = Y.Array<StyleId>
export type DocumentCommentIdList = Y.Array<CommentId>
export type DocumentRevisionIdList = Y.Array<RevisionId>
export type BlockKind = 'paragraph' | 'table'
export type RunKind = 'run'

/**
 * document 是根记录，只放文档标识、元数据和各类容器入口引用。
 */
export type DocumentRootValue =
  | typeof DOCUMENT_STORE_SCHEMA_VERSION
  | DocumentId
  | DocumentMetadataMap
  | DocumentSectionIdList
  | DocumentResourceIdList
  | DocumentStyleIdList
  | DocumentCommentIdList
  | DocumentRevisionIdList

/**
 * sections 是有序正文节数组；每个节记录持有有序块容器，再引用资源、样式、批注和修订。
 */
export type SectionRecordValue =
  | 'section'
  | SectionId
  | BlockContainer
  | Y.Array<BlockId>
  | Y.Array<ResourceId>
  | Y.Array<StyleId>
  | Y.Array<CommentId>
  | Y.Array<RevisionId>
  | Y.Array<string>
  | Y.Map<DocumentStoreJson>

/**
 * block 记录承载段落或表格；段落按 runs 排序，表格按 rows 排序。
 */
export type BlockRecordValue =
  | BlockKind
  | BlockId
  | RunContainer
  | TableRowContainer
  | Y.Array<ResourceId>
  | Y.Array<StyleId>
  | Y.Array<CommentId>
  | Y.Array<RevisionId>
  | Y.Map<DocumentStoreJson>

/**
 * run 记录承载一段共享文本和 run 级属性。
 */
export type RunRecordValue =
  | RunKind
  | RunId
  | Y.Text
  | Y.Array<ResourceId>
  | Y.Array<StyleId>
  | Y.Array<CommentId>
  | Y.Array<RevisionId>
  | Y.Map<DocumentStoreJson>

export type TableRowRecordValue =
  | string
  | TableCellContainer
  | Y.Map<DocumentStoreJson>

export type TableCellRecordValue =
  | string
  | number
  | BlockContainer
  | Y.Map<DocumentStoreJson>

/**
 * resources、styles、comments、revisions 是按 ID 索引的查找表。
 */
export type ResourceRecordValue =
  | 'resource'
  | ResourceId
  | string
  | DocumentStoreJson
  | Y.Map<DocumentStoreJson>

export type StyleRecordValue =
  | 'style'
  | StyleId
  | Y.Map<DocumentStoreJson>

export type CommentRecordValue =
  | 'comment'
  | CommentId
  | string
  | boolean
  | Y.Array<BlockId>
  | Y.Array<RevisionId>
  | Y.Map<DocumentStoreJson>

export type RevisionType = 'insert' | 'delete' | 'format'

export type RevisionRecordValue =
  | 'revision'
  | RevisionId
  | RevisionType
  | string
  | Y.Map<DocumentStoreJson>

export type DocumentRootMap = Y.Map<DocumentRootValue>
export type SectionRecord = Y.Map<SectionRecordValue>
export type BlockRecord = Y.Map<BlockRecordValue>
export type RunRecord = Y.Map<RunRecordValue>
export type TableRowRecord = Y.Map<TableRowRecordValue>
export type TableCellRecord = Y.Map<TableCellRecordValue>
export type BlockContainer = Y.Array<BlockRecord>
export type RunContainer = Y.Array<RunRecord>
export type TableRowContainer = Y.Array<TableRowRecord>
export type TableCellContainer = Y.Array<TableCellRecord>
export type ResourceRecord = Y.Map<ResourceRecordValue>
export type StyleRecord = Y.Map<StyleRecordValue>
export type CommentRecord = Y.Map<CommentRecordValue>
export type RevisionRecord = Y.Map<RevisionRecordValue>
export type SectionsContainer = Y.Array<SectionRecord>
export type ResourceTable = Y.Map<ResourceRecord>
export type StyleTable = Y.Map<StyleRecord>
export type CommentTable = Y.Map<CommentRecord>
export type RevisionTable = Y.Map<RevisionRecord>

/**
 * JWord 在 Y.Doc 内部使用的最小共享容器集合。
 */
export interface DocumentStore {
  readonly doc: Y.Doc
  readonly document: DocumentRootMap
  readonly sections: SectionsContainer
  readonly resources: ResourceTable
  readonly styles: StyleTable
  readonly comments: CommentTable
  readonly revisions: RevisionTable
}

/**
 * 创建或复用一个 JWord 文档状态壳。
 *
 * @param doc 可选的外部 Y.Doc。未提供时创建新的本地 Y.Doc。
 * @returns 绑定到同一个 Y.Doc 的共享容器集合。
 */
export function createDocumentStore(doc = new Y.Doc()): DocumentStore {
  return {
    doc,
    document: doc.getMap(DOCUMENT_STORE_CONTAINERS.document),
    sections: doc.getArray(DOCUMENT_STORE_CONTAINERS.sections),
    resources: doc.getMap(DOCUMENT_STORE_CONTAINERS.resources),
    styles: doc.getMap(DOCUMENT_STORE_CONTAINERS.styles),
    comments: doc.getMap(DOCUMENT_STORE_CONTAINERS.comments),
    revisions: doc.getMap(DOCUMENT_STORE_CONTAINERS.revisions)
  }
}

/**
 * 创建一个可放入 sections 容器的节记录。
 *
 * @param id 节 ID。
 * @returns 带有有序 blocks 容器和引用表入口的节记录。
 */
export function createSectionRecord(id: SectionId): SectionRecord {
  const section = new Y.Map<SectionRecordValue>() as SectionRecord

  section.set(DOCUMENT_STORE_FIELDS.section.kind, 'section')
  section.set(DOCUMENT_STORE_FIELDS.section.id, id)
  section.set(DOCUMENT_STORE_FIELDS.section.properties, new Y.Map<DocumentStoreJson>())
  section.set(DOCUMENT_STORE_FIELDS.section.blocks, new Y.Array<BlockRecord>())
  section.set(DOCUMENT_STORE_FIELDS.section.blockIds, new Y.Array<BlockId>())
  section.set(DOCUMENT_STORE_FIELDS.section.resourceIds, new Y.Array<ResourceId>())
  section.set(DOCUMENT_STORE_FIELDS.section.styleIds, new Y.Array<StyleId>())
  section.set(DOCUMENT_STORE_FIELDS.section.commentIds, new Y.Array<CommentId>())
  section.set(DOCUMENT_STORE_FIELDS.section.revisionIds, new Y.Array<RevisionId>())
  section.set(DOCUMENT_STORE_FIELDS.section.headerIds, new Y.Array<string>())
  section.set(DOCUMENT_STORE_FIELDS.section.footerIds, new Y.Array<string>())

  return section
}

/**
 * 创建一个段落块记录。
 *
 * @param id 块 ID。
 * @returns 带有有序 runs 容器的段落记录。
 */
export function createParagraphRecord(id: BlockId): BlockRecord {
  const block = new Y.Map<BlockRecordValue>() as BlockRecord

  block.set(DOCUMENT_STORE_FIELDS.block.kind, 'paragraph')
  block.set(DOCUMENT_STORE_FIELDS.block.id, id)
  block.set(DOCUMENT_STORE_FIELDS.block.properties, new Y.Map<DocumentStoreJson>())
  block.set(DOCUMENT_STORE_FIELDS.block.runs, new Y.Array<RunRecord>())
  block.set(DOCUMENT_STORE_FIELDS.block.resourceIds, new Y.Array<ResourceId>())
  block.set(DOCUMENT_STORE_FIELDS.block.styleIds, new Y.Array<StyleId>())
  block.set(DOCUMENT_STORE_FIELDS.block.commentIds, new Y.Array<CommentId>())
  block.set(DOCUMENT_STORE_FIELDS.block.revisionIds, new Y.Array<RevisionId>())

  return block
}

/**
 * 创建一个表格块记录。
 *
 * @param id 块 ID。
 * @returns 带有有序 rows 容器的表格记录。
 */
export function createTableRecord(id: BlockId): BlockRecord {
  const block = new Y.Map<BlockRecordValue>() as BlockRecord

  block.set(DOCUMENT_STORE_FIELDS.block.kind, 'table')
  block.set(DOCUMENT_STORE_FIELDS.block.id, id)
  block.set(DOCUMENT_STORE_FIELDS.block.properties, new Y.Map<DocumentStoreJson>())
  block.set(DOCUMENT_STORE_FIELDS.block.rows, new Y.Array<TableRowRecord>())
  block.set(DOCUMENT_STORE_FIELDS.block.resourceIds, new Y.Array<ResourceId>())
  block.set(DOCUMENT_STORE_FIELDS.block.styleIds, new Y.Array<StyleId>())
  block.set(DOCUMENT_STORE_FIELDS.block.commentIds, new Y.Array<CommentId>())
  block.set(DOCUMENT_STORE_FIELDS.block.revisionIds, new Y.Array<RevisionId>())

  return block
}

/**
 * 创建一个 run 记录。
 *
 * @param id run ID。
 * @param text 初始文本。
 * @returns 带有共享 Y.Text 的 run 记录。
 */
export function createRunRecord(id: RunId, text = ''): RunRecord {
  const run = new Y.Map<RunRecordValue>() as RunRecord
  const sharedText = new Y.Text()

  if (text.length > 0) {
    sharedText.insert(0, text)
  }

  run.set(DOCUMENT_STORE_FIELDS.run.kind, 'run')
  run.set(DOCUMENT_STORE_FIELDS.run.id, id)
  run.set(DOCUMENT_STORE_FIELDS.run.properties, new Y.Map<DocumentStoreJson>())
  run.set(DOCUMENT_STORE_FIELDS.run.text, sharedText)
  run.set(DOCUMENT_STORE_FIELDS.run.resourceIds, new Y.Array<ResourceId>())
  run.set(DOCUMENT_STORE_FIELDS.run.styleIds, new Y.Array<StyleId>())
  run.set(DOCUMENT_STORE_FIELDS.run.commentIds, new Y.Array<CommentId>())
  run.set(DOCUMENT_STORE_FIELDS.run.revisionIds, new Y.Array<RevisionId>())

  return run
}

/**
 * 创建表格行记录。
 *
 * @param id 行 ID。
 * @returns 带有有序 cells 容器的行记录。
 */
export function createTableRowRecord(id: string): TableRowRecord {
  const row = new Y.Map<TableRowRecordValue>() as TableRowRecord

  row.set(DOCUMENT_STORE_FIELDS.tableRow.id, id)
  row.set(DOCUMENT_STORE_FIELDS.tableRow.properties, new Y.Map<DocumentStoreJson>())
  row.set(DOCUMENT_STORE_FIELDS.tableRow.cells, new Y.Array<TableCellRecord>())

  return row
}

/**
 * 创建表格单元格记录。
 *
 * @param id 单元格 ID。
 * @returns 带有有序 blocks 容器的单元格记录。
 */
export function createTableCellRecord(id: string): TableCellRecord {
  const cell = new Y.Map<TableCellRecordValue>() as TableCellRecord

  cell.set(DOCUMENT_STORE_FIELDS.tableCell.id, id)
  cell.set(DOCUMENT_STORE_FIELDS.tableCell.properties, new Y.Map<DocumentStoreJson>())
  cell.set(DOCUMENT_STORE_FIELDS.tableCell.gridSpan, 1)
  cell.set(DOCUMENT_STORE_FIELDS.tableCell.blocks, new Y.Array<BlockRecord>())

  return cell
}

/**
 * 读取节内有序块容器。
 *
 * @param section 节记录。
 * @returns 有序块容器。
 */
export function getSectionBlocks(section: SectionRecord): BlockContainer {
  return readSharedArray(section, DOCUMENT_STORE_FIELDS.section.blocks, '节块容器')
}

/**
 * 读取段落内有序 run 容器。
 *
 * @param block 段落块记录。
 * @returns 有序 run 容器。
 */
export function getParagraphRuns(block: BlockRecord): RunContainer {
  return readSharedArray(block, DOCUMENT_STORE_FIELDS.block.runs, '段落 run 容器')
}

/**
 * 读取 run 的共享文本。
 *
 * @param run run 记录。
 * @returns 共享文本。
 */
export function getRunText(run: RunRecord): Y.Text {
  const value = run.get(DOCUMENT_STORE_FIELDS.run.text)

  if (value instanceof Y.Text) {
    return value
  }

  throw createJWordError('DOCUMENT_STORE_TEXT_CONTAINER_MISSING', 'run 缺少共享文本容器')
}

/**
 * 读取表格内有序行容器。
 *
 * @param block 表格块记录。
 * @returns 有序行容器。
 */
export function getTableRows(block: BlockRecord): TableRowContainer {
  return readSharedArray(block, DOCUMENT_STORE_FIELDS.block.rows, '表格行容器')
}

/**
 * 读取表格行内有序单元格容器。
 *
 * @param row 表格行记录。
 * @returns 有序单元格容器。
 */
export function getTableRowCells(row: TableRowRecord): TableCellContainer {
  return readSharedArray(row, DOCUMENT_STORE_FIELDS.tableRow.cells, '表格单元格容器')
}

/**
 * 读取表格单元格内有序块容器。
 *
 * @param cell 表格单元格记录。
 * @returns 有序块容器。
 */
export function getTableCellBlocks(cell: TableCellRecord): BlockContainer {
  return readSharedArray(cell, DOCUMENT_STORE_FIELDS.tableCell.blocks, '单元格块容器')
}

interface SharedMapReader {
  get(fieldName: string): unknown
}

function readSharedArray<Item>(record: SharedMapReader, fieldName: string, label: string): Y.Array<Item> {
  const value = record.get(fieldName)

  if (value instanceof Y.Array) {
    return value as Y.Array<Item>
  }

  throw createJWordError('DOCUMENT_STORE_ARRAY_CONTAINER_MISSING', `${label} 缺失`, {
    label
  })
}
