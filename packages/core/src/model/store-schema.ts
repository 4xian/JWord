/**
 * 职责：声明 document-store 在 Y.Doc 中使用的 schema 版本、容器名与字段名。
 * 边界：只保存结构常量，不创建 Y.Doc 容器，不投影模型。
 * 协作模块：状态类型、记录工厂、批注记录和修订记录模块共享同一字段表。
 * 性能/安全约束：无副作用，不访问 DOM、网络或持久化资源。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/03-architecture.md#32-状态真源。
 */

/** Y.Doc 结构版本；具体写入仍交给 transaction adapter。 */
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
  commentRanges: 'commentRanges',
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
    field: 'field',
    link: 'link',
    revisionId: 'revisionId',
    inlines: 'inlines',
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
    mime: 'mime',
    source: 'source',
    status: 'status',
    error: 'error',
    retryToken: 'retryToken',
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
    resolved: 'resolved',
    messages: 'messages',
    blockIds: 'blockIds',
    revisionIds: 'revisionIds'
  },
  commentRange: {
    id: 'id',
    anchor: 'anchor',
    focus: 'focus'
  },
  revision: {
    kind: 'kind',
    id: 'id',
    authorId: 'authorId',
    createdAt: 'createdAt',
    type: 'type',
    rangeId: 'rangeId',
    rangeSnapshot: 'rangeSnapshot',
    summary: 'summary',
    formatSnapshots: 'formatSnapshots',
    targetId: 'targetId'
  }
} as const

export type DocumentStoreContainerName =
  (typeof DOCUMENT_STORE_CONTAINERS)[keyof typeof DOCUMENT_STORE_CONTAINERS]
