/**
 * 职责：保留 document-store 的公开导出入口。
 * 边界：不承载具体记录创建、投影或 JSON 读取逻辑，只聚合拆分后的 store 模块。
 * 协作模块：状态结构常量、状态类型、记录工厂、状态 JSON、批注记录和修订记录模块。
 * 性能/安全约束：无顶层 DOM、网络或持久化副作用，所有写入仍由调用方事务包裹。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/03-architecture.md#32-状态真源。
 */

export {
  DOCUMENT_STORE_CONTAINERS,
  DOCUMENT_STORE_FIELDS,
  DOCUMENT_STORE_SCHEMA_VERSION
} from './store-schema'
export type { DocumentStoreContainerName } from './store-schema'
export type {
  BlockContainer,
  BlockKind,
  BlockRecord,
  BlockRecordValue,
  CommentRangeId,
  CommentRangeRecord,
  CommentRangeRecordValue,
  CommentRangeTable,
  CommentRecord,
  CommentRecordValue,
  CommentTable,
  DocumentCommentIdList,
  DocumentMetadataMap,
  DocumentResourceIdList,
  DocumentRevisionIdList,
  DocumentRootMap,
  DocumentRootValue,
  DocumentSectionIdList,
  DocumentStore,
  DocumentStyleIdList,
  ResourceId,
  ResourceRecord,
  ResourceRecordValue,
  ResourceTable,
  RevisionRecord,
  RevisionRecordValue,
  RevisionTable,
  RevisionType,
  RunContainer,
  RunKind,
  RunRecord,
  RunRecordStructureInput,
  RunRecordValue,
  SectionRecord,
  SectionRecordValue,
  SectionsContainer,
  StyleId,
  StyleRecord,
  StyleRecordValue,
  StyleTable,
  TableCellContainer,
  TableCellRecord,
  TableCellRecordValue,
  TableRowContainer,
  TableRowRecord,
  TableRowRecordValue
} from './store-types'
export type { DocumentStoreJson } from './store-json'
export {
  createDocumentStore,
  createParagraphRecord,
  createResourceRecord,
  createRunRecord,
  createSectionRecord,
  createTableCellRecord,
  createTableRecord,
  createTableRowRecord,
  getParagraphRuns,
  getRunField,
  getRunInlines,
  getRunLink,
  getRunRevisionId,
  getRunText,
  getSectionBlocks,
  getTableCellBlocks,
  getTableRowCells,
  getTableRows,
  projectResourceRecord,
  setRunLinkValue,
  setRunStructure
} from './store-record-factories'
export {
  createCommentRangeRecord,
  createCommentRecord,
  projectCommentRecord,
  readCommentRangeRecord
} from './store-comments'
export {
  createRevisionRecord,
  projectRevisionRecord
} from './store-revisions'
