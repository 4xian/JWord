/**
 * 职责：声明 document-store 的 branded ID、Yjs 容器和记录类型。
 * 边界：只包含类型，不创建记录、不读取投影、不执行事务。
 * 协作模块：store-schema 提供字段常量，store-json 提供 JSON 字段类型，记录工厂与投影模块消费这些类型。
 * 性能/安全约束：无运行时副作用，不访问 DOM、网络或持久化资源。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import * as Y from 'yjs'

import { DOCUMENT_STORE_SCHEMA_VERSION } from './store-schema'
import type { BlockId, CommentId, DocumentId, Opaque, RevisionId, RunId, SectionId } from './position'
import type { DocumentStoreJson } from './store-json'
import type { Inline, RunField, RunLink } from './types'

/** 资源 ID，运行时仍是字符串。 */
export type ResourceId = Opaque<string, 'ResourceId'>

/** 样式 ID，运行时仍是字符串。 */
export type StyleId = Opaque<string, 'StyleId'>

/** 批注范围 ID，运行时仍是字符串。 */
export type CommentRangeId = Opaque<string, 'CommentRangeId'>

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
  | string
  | Y.Text
  | Y.Array<DocumentStoreJson>
  | Y.Array<ResourceId>
  | Y.Array<StyleId>
  | Y.Array<CommentId>
  | Y.Array<RevisionId>
  | Y.Map<DocumentStoreJson>
  | DocumentStoreJson

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
  | Y.Array<DocumentStoreJson>
  | Y.Array<BlockId>
  | Y.Array<RevisionId>
  | Y.Map<DocumentStoreJson>

export type CommentRangeRecordValue =
  | CommentRangeId
  | DocumentStoreJson

export type RevisionType = 'insert' | 'delete' | 'format'

export type RevisionRecordValue =
  | 'revision'
  | RevisionId
  | RevisionType
  | string
  | DocumentStoreJson
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
export type CommentRangeRecord = Y.Map<CommentRangeRecordValue>
export type RevisionRecord = Y.Map<RevisionRecordValue>
export type SectionsContainer = Y.Array<SectionRecord>
export type ResourceTable = Y.Map<ResourceRecord>
export type StyleTable = Y.Map<StyleRecord>
export type CommentTable = Y.Map<CommentRecord>
export type CommentRangeTable = Y.Map<CommentRangeRecord>
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
  readonly commentRanges: CommentRangeTable
  readonly revisions: RevisionTable
}

export interface RunRecordStructureInput {
  readonly properties?: Readonly<Record<string, unknown>>
  readonly field?: RunField
  readonly link?: RunLink
  readonly revisionId?: string
  readonly inlines?: readonly Inline[]
}
