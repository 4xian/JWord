/**
 * 职责：创建 document-store 中 section、block、run、table 和 resource 记录。
 * 边界：只创建和读取基础 Yjs 记录，不投影批注或修订 metadata。
 * 协作模块：document-store 公开入口 re-export，本模块复用 store-schema、store-types 与 store-json。
 * 性能/安全约束：所有写入仅作用于调用方传入或新建的 Yjs 记录，不访问 DOM、网络或持久化资源。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import * as Y from 'yjs'

import { createJWordError } from '../shared/errors'
import { DOCUMENT_STORE_CONTAINERS, DOCUMENT_STORE_FIELDS } from './store-schema'
import { createJsonMap, isRecord, projectProperties, readOptionalString, readString, toDocumentStoreJson } from './store-json'
import type { BlockId, CommentId, RevisionId, RunId, SectionId } from './position'
import type { Resource, ResourceErrorState, ResourceSource, ResourceStatus } from '../resources/types'
import type { Inline, RunField, RunLink } from './types'
import type {
  BlockContainer,
  BlockRecord,
  BlockRecordValue,
  DocumentStore,
  ResourceId,
  ResourceRecord,
  ResourceRecordValue,
  RunContainer,
  RunRecord,
  RunRecordStructureInput,
  RunRecordValue,
  SectionRecord,
  SectionRecordValue,
  StyleId,
  TableCellContainer,
  TableCellRecord,
  TableCellRecordValue,
  TableRowContainer,
  TableRowRecord,
  TableRowRecordValue
} from './store-types'
import type { DocumentStoreJson } from './store-json'

/** 创建或复用一个 JWord 文档状态壳。 */
export function createDocumentStore(doc = new Y.Doc()): DocumentStore {
  return {
    doc,
    document: doc.getMap(DOCUMENT_STORE_CONTAINERS.document),
    sections: doc.getArray(DOCUMENT_STORE_CONTAINERS.sections),
    resources: doc.getMap(DOCUMENT_STORE_CONTAINERS.resources),
    styles: doc.getMap(DOCUMENT_STORE_CONTAINERS.styles),
    comments: doc.getMap(DOCUMENT_STORE_CONTAINERS.comments),
    commentRanges: doc.getMap(DOCUMENT_STORE_CONTAINERS.commentRanges),
    revisions: doc.getMap(DOCUMENT_STORE_CONTAINERS.revisions)
  }
}

/** 创建一个可放入 sections 容器的节记录。 */
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

/** 创建一个段落块记录。 */
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

/** 创建一个表格块记录。 */
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

/** 创建一个 run 记录。 */
export function createRunRecord(id: RunId, text = '', structure?: RunRecordStructureInput): RunRecord {
  const run = new Y.Map<RunRecordValue>() as RunRecord
  const sharedText = new Y.Text()

  if (text.length > 0) {
    sharedText.insert(0, text)
  }

  run.set(DOCUMENT_STORE_FIELDS.run.kind, 'run')
  run.set(DOCUMENT_STORE_FIELDS.run.id, id)
  run.set(DOCUMENT_STORE_FIELDS.run.properties, createJsonMap(structure?.properties))
  run.set(DOCUMENT_STORE_FIELDS.run.text, sharedText)
  run.set(DOCUMENT_STORE_FIELDS.run.resourceIds, new Y.Array<ResourceId>())
  run.set(DOCUMENT_STORE_FIELDS.run.styleIds, new Y.Array<StyleId>())
  run.set(DOCUMENT_STORE_FIELDS.run.commentIds, new Y.Array<CommentId>())
  run.set(DOCUMENT_STORE_FIELDS.run.revisionIds, new Y.Array<RevisionId>())
  setRunStructure(run, structure)

  return run
}

/** 创建表格行记录。 */
export function createTableRowRecord(id: string): TableRowRecord {
  const row = new Y.Map<TableRowRecordValue>() as TableRowRecord

  row.set(DOCUMENT_STORE_FIELDS.tableRow.id, id)
  row.set(DOCUMENT_STORE_FIELDS.tableRow.properties, new Y.Map<DocumentStoreJson>())
  row.set(DOCUMENT_STORE_FIELDS.tableRow.cells, new Y.Array<TableCellRecord>())

  return row
}

/** 创建表格单元格记录。 */
export function createTableCellRecord(id: string): TableCellRecord {
  const cell = new Y.Map<TableCellRecordValue>() as TableCellRecord

  cell.set(DOCUMENT_STORE_FIELDS.tableCell.id, id)
  cell.set(DOCUMENT_STORE_FIELDS.tableCell.properties, new Y.Map<DocumentStoreJson>())
  cell.set(DOCUMENT_STORE_FIELDS.tableCell.gridSpan, 1)
  cell.set(DOCUMENT_STORE_FIELDS.tableCell.blocks, new Y.Array<BlockRecord>())

  return cell
}

/** 创建资源记录。 */
export function createResourceRecord(resource: Resource): ResourceRecord {
  const record = new Y.Map<ResourceRecordValue>() as ResourceRecord

  record.set(DOCUMENT_STORE_FIELDS.resource.kind, 'resource')
  record.set(DOCUMENT_STORE_FIELDS.resource.id, resource.id as ResourceId)
  record.set(DOCUMENT_STORE_FIELDS.resource.mime, resource.mime)
  record.set(DOCUMENT_STORE_FIELDS.resource.source, toDocumentStoreJson(resource.source))
  record.set(DOCUMENT_STORE_FIELDS.resource.status, resource.status)
  if (resource.error !== undefined) {
    record.set(DOCUMENT_STORE_FIELDS.resource.error, toDocumentStoreJson(resource.error))
  }
  if (resource.retryToken !== undefined) {
    record.set(DOCUMENT_STORE_FIELDS.resource.retryToken, resource.retryToken)
  }
  record.set(DOCUMENT_STORE_FIELDS.resource.metadata, createJsonMap(resource.metadata))

  return record
}

/** 读取节内有序块容器。 */
export function getSectionBlocks(section: SectionRecord): BlockContainer {
  return readSharedArray(section, DOCUMENT_STORE_FIELDS.section.blocks, '节块容器')
}

/** 读取段落内有序 run 容器。 */
export function getParagraphRuns(block: BlockRecord): RunContainer {
  return readSharedArray(block, DOCUMENT_STORE_FIELDS.block.runs, '段落 run 容器')
}

/** 读取 run 的共享文本。 */
export function getRunText(run: RunRecord): Y.Text {
  const value = run.get(DOCUMENT_STORE_FIELDS.run.text)

  if (value instanceof Y.Text) {
    return value
  }

  throw createJWordError('DOCUMENT_STORE_TEXT_CONTAINER_MISSING', 'run 缺少共享文本容器')
}

/** 读取 run 的 field 元数据。 */
export function getRunField(run: RunRecord): RunField | undefined {
  const value = run.get(DOCUMENT_STORE_FIELDS.run.field)

  if (value === undefined) {
    return undefined
  }

  if (!isRecord(value) || typeof value.code !== 'string') {
    throw createJWordError('PROJECTION_INVALID_DOCUMENT', 'run field 结构非法')
  }

  const result = typeof value.result === 'string' ? value.result : undefined

  return result === undefined
    ? { code: value.code }
    : { code: value.code, result }
}

/** 读取 run 的链接元数据。 */
export function getRunLink(run: RunRecord): RunLink | undefined {
  const value = run.get(DOCUMENT_STORE_FIELDS.run.link)

  if (value === undefined) {
    return undefined
  }

  if (!isRecord(value) || typeof value.target !== 'string') {
    throw createJWordError('PROJECTION_INVALID_DOCUMENT', 'run link 结构非法')
  }

  const tooltip = typeof value.tooltip === 'string' ? value.tooltip : undefined

  return tooltip === undefined
    ? { target: value.target }
    : { target: value.target, tooltip }
}

/** 覆盖 run 的链接元数据；传入 null 时移除链接。 */
export function setRunLinkValue(run: RunRecord, link: RunLink | null): void {
  if (link === null) {
    run.delete(DOCUMENT_STORE_FIELDS.run.link)
    return
  }

  run.set(DOCUMENT_STORE_FIELDS.run.link, toDocumentStoreJson(link))
}

/** 读取 run 的修订 ID。 */
export function getRunRevisionId(run: RunRecord): string | undefined {
  const value = run.get(DOCUMENT_STORE_FIELDS.run.revisionId)

  if (value === undefined) {
    return undefined
  }

  if (typeof value !== 'string') {
    throw createJWordError('PROJECTION_INVALID_DOCUMENT', 'run revisionId 结构非法')
  }

  return value
}

/** 读取 run 的结构化 inline 列表。 */
export function getRunInlines(run: RunRecord): readonly Inline[] | undefined {
  const value = run.get(DOCUMENT_STORE_FIELDS.run.inlines)

  if (value === undefined) {
    return undefined
  }

  if (!(value instanceof Y.Array)) {
    throw createJWordError('PROJECTION_INVALID_DOCUMENT', 'run inlines 容器非法')
  }

  return value.toArray().map(projectInlineFromJson)
}

/** 读取资源记录并投影为只读资源快照。 */
export function projectResourceRecord(resource: ResourceRecord): Resource {
  const source = readResourceSource(resource)
  const status = readResourceStatus(resource)
  const error = readResourceError(resource)
  const retryToken = readOptionalString(resource.get(DOCUMENT_STORE_FIELDS.resource.retryToken))
  const metadata = projectProperties(resource.get(DOCUMENT_STORE_FIELDS.resource.metadata))

  return {
    kind: 'resource',
    id: readString(resource.get(DOCUMENT_STORE_FIELDS.resource.id), 'resource'),
    mime: readString(resource.get(DOCUMENT_STORE_FIELDS.resource.mime), 'resource mime'),
    source,
    status,
    ...(error === undefined ? {} : { error }),
    ...(retryToken === undefined ? {} : { retryToken }),
    ...(metadata === undefined ? {} : { metadata })
  }
}

/** 写入或覆盖 run 的结构化元数据。 */
export function setRunStructure(run: RunRecord, structure?: RunRecordStructureInput): void {
  if (structure === undefined) {
    return
  }

  if (structure.field !== undefined) {
    run.set(DOCUMENT_STORE_FIELDS.run.field, toDocumentStoreJson(structure.field))
  }

  if (structure.link !== undefined) {
    run.set(DOCUMENT_STORE_FIELDS.run.link, toDocumentStoreJson(structure.link))
  }

  if (structure.revisionId !== undefined) {
    run.set(DOCUMENT_STORE_FIELDS.run.revisionId, structure.revisionId)
  }

  if (structure.inlines !== undefined) {
    const inlines = new Y.Array<DocumentStoreJson>()

    if (structure.inlines.length > 0) {
      inlines.push(structure.inlines.map((inline) => toDocumentStoreJson(inline)))
    }

    run.set(DOCUMENT_STORE_FIELDS.run.inlines, inlines)
  }
}

/** 读取表格内有序行容器。 */
export function getTableRows(block: BlockRecord): TableRowContainer {
  return readSharedArray(block, DOCUMENT_STORE_FIELDS.block.rows, '表格行容器')
}

/** 读取表格行内有序单元格容器。 */
export function getTableRowCells(row: TableRowRecord): TableCellContainer {
  return readSharedArray(row, DOCUMENT_STORE_FIELDS.tableRow.cells, '表格单元格容器')
}

/** 读取表格单元格内有序块容器。 */
export function getTableCellBlocks(cell: TableCellRecord): BlockContainer {
  return readSharedArray(cell, DOCUMENT_STORE_FIELDS.tableCell.blocks, '单元格块容器')
}

interface SharedMapReader {
  get(fieldName: string): unknown
}

/** 从 Y.Map 记录中读取必需的共享数组容器。 */
function readSharedArray<Item>(record: SharedMapReader, fieldName: string, label: string): Y.Array<Item> {
  const value = record.get(fieldName)

  if (value instanceof Y.Array) {
    return value as Y.Array<Item>
  }

  throw createJWordError('DOCUMENT_STORE_ARRAY_CONTAINER_MISSING', `${label} 缺失`, {
    label
  })
}

/** 从 JSON 值投影 run inline。 */
function projectInlineFromJson(value: unknown): Inline {
  if (!isRecord(value) || typeof value.kind !== 'string') {
    throw createJWordError('PROJECTION_INVALID_DOCUMENT', 'run inline 结构非法')
  }

  switch (value.kind) {
    case 'text':
      if (typeof value.text !== 'string') {
        break
      }
      return { kind: 'text', text: value.text }
    case 'image':
      if (typeof value.resourceId !== 'string') {
        break
      }
      return {
        kind: 'image',
        resourceId: value.resourceId,
        ...(typeof value.alt === 'string' ? { alt: value.alt } : {}),
        ...(value.display === 'inline' ? { display: value.display } : {}),
        ...(typeof value.widthTwips === 'number' ? { widthTwips: value.widthTwips } : {}),
        ...(typeof value.heightTwips === 'number' ? { heightTwips: value.heightTwips } : {}),
        ...(typeof value.rotationDegrees === 'number' ? { rotationDegrees: value.rotationDegrees } : {})
      }
    case 'break':
      if (value.breakType === 'line' || value.breakType === 'page' || value.breakType === 'column') {
        return { kind: 'break', breakType: value.breakType }
      }
      break
    case 'bookmark':
      if (
        typeof value.id === 'string'
        && typeof value.name === 'string'
        && (value.edge === 'start' || value.edge === 'end')
      ) {
        return {
          kind: 'bookmark',
          id: value.id,
          name: value.name,
          edge: value.edge
        }
      }
      break
    case 'commentRangeMarker':
      if (typeof value.commentId === 'string' && (value.edge === 'start' || value.edge === 'end')) {
        return {
          kind: 'commentRangeMarker',
          commentId: value.commentId,
          edge: value.edge
        }
      }
      break
  }

  throw createJWordError('PROJECTION_INVALID_DOCUMENT', 'run inline 内容非法', {
    kind: String(value.kind)
  })
}

/** 读取资源来源。 */
function readResourceSource(resource: ResourceRecord): ResourceSource {
  const value = resource.get(DOCUMENT_STORE_FIELDS.resource.source)

  if (!isRecord(value) || typeof value.kind !== 'string' || typeof value.url !== 'string') {
    throw createJWordError('PROJECTION_INVALID_DOCUMENT', 'resource source 结构非法')
  }

  if (value.kind === 'dataUrl' || value.kind === 'blobUrl' || value.kind === 'externalUrl') {
    return {
      kind: value.kind,
      url: value.url
    }
  }

  throw createJWordError('PROJECTION_INVALID_DOCUMENT', 'resource source 类型非法', {
    kind: String(value.kind)
  })
}

/** 读取资源状态。 */
function readResourceStatus(resource: ResourceRecord): ResourceStatus {
  const value = resource.get(DOCUMENT_STORE_FIELDS.resource.status)

  if (value === 'pending' || value === 'success' || value === 'failed') {
    return value as ResourceStatus
  }

  throw createJWordError('PROJECTION_INVALID_DOCUMENT', 'resource status 结构非法', {
    status: String(value)
  })
}

/** 读取资源错误状态。 */
function readResourceError(resource: ResourceRecord): ResourceErrorState | undefined {
  const value = resource.get(DOCUMENT_STORE_FIELDS.resource.error)

  if (value === undefined) {
    return undefined
  }

  if (!isRecord(value) || typeof value.code !== 'string' || typeof value.message !== 'string') {
    throw createJWordError('PROJECTION_INVALID_DOCUMENT', 'resource error 结构非法')
  }

  return {
    code: value.code,
    message: value.message
  }
}
