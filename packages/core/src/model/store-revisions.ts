/**
 * 职责：创建和投影 document-store 中的修订 metadata 记录。
 * 边界：只处理修订记录与格式快照，不创建正文记录或批注记录。
 * 协作模块：document-store 公开入口 re-export，本模块复用 store-schema、store-types 与 store-json。
 * 性能/安全约束：只读投影不改写 Y.Doc，写入由调用方事务包裹，不访问 DOM 或网络。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import * as Y from 'yjs'

import { createJWordError } from '../shared/errors'
import { DOCUMENT_STORE_FIELDS } from './store-schema'
import { isRecord, readString, readTextRangeRecord, toDocumentStoreJson } from './store-json'
import type { RevisionMetadata } from './types'
import type {
  RevisionRecord,
  RevisionRecordValue,
  RevisionType
} from './store-types'
import type { RevisionId } from './position'

/** 创建修订 metadata 记录。 */
export function createRevisionRecord(revision: RevisionMetadata): RevisionRecord {
  const record = new Y.Map<RevisionRecordValue>() as RevisionRecord

  record.set(DOCUMENT_STORE_FIELDS.revision.kind, 'revision')
  record.set(DOCUMENT_STORE_FIELDS.revision.id, revision.id as RevisionId)
  record.set(DOCUMENT_STORE_FIELDS.revision.authorId, revision.authorId)
  record.set(DOCUMENT_STORE_FIELDS.revision.createdAt, revision.createdAt)
  record.set(DOCUMENT_STORE_FIELDS.revision.type, revision.type)
  record.set(DOCUMENT_STORE_FIELDS.revision.rangeId, revision.rangeId ?? revision.rangeSnapshot.id)
  record.set(DOCUMENT_STORE_FIELDS.revision.rangeSnapshot, toDocumentStoreJson(revision.rangeSnapshot))
  record.set(DOCUMENT_STORE_FIELDS.revision.summary, revision.summary)
  if (revision.formatSnapshots !== undefined) {
    record.set(DOCUMENT_STORE_FIELDS.revision.formatSnapshots, toDocumentStoreJson(revision.formatSnapshots))
  }

  return record
}

/** 把修订记录投影为只读 metadata 快照。 */
export function projectRevisionRecord(revision: RevisionRecord): RevisionMetadata {
  const type = readRevisionType(revision.get(DOCUMENT_STORE_FIELDS.revision.type))
  const rangeSnapshot = readTextRangeRecord(
    revision.get(DOCUMENT_STORE_FIELDS.revision.rangeSnapshot),
    'revision range'
  )

  return {
    kind: 'revision',
    id: readString(revision.get(DOCUMENT_STORE_FIELDS.revision.id), 'revision'),
    authorId: readString(revision.get(DOCUMENT_STORE_FIELDS.revision.authorId), 'revision authorId'),
    createdAt: readString(revision.get(DOCUMENT_STORE_FIELDS.revision.createdAt), 'revision createdAt'),
    type,
    rangeId: readString(revision.get(DOCUMENT_STORE_FIELDS.revision.rangeId), 'revision rangeId'),
    rangeSnapshot,
    summary: readString(revision.get(DOCUMENT_STORE_FIELDS.revision.summary), 'revision summary'),
    ...projectRevisionFormatSnapshots(revision.get(DOCUMENT_STORE_FIELDS.revision.formatSnapshots))
  }
}

/** 读取修订类型。 */
function readRevisionType(value: unknown): RevisionType {
  if (value === 'insert' || value === 'delete' || value === 'format') {
    return value
  }

  throw createJWordError('PROJECTION_INVALID_DOCUMENT', 'revision type 字段非法')
}

/** 投影修订格式快照。 */
function projectRevisionFormatSnapshots(value: unknown): Pick<RevisionMetadata, 'formatSnapshots'> {
  if (!Array.isArray(value)) {
    return {}
  }

  const formatSnapshots = value.flatMap((snapshot) => {
    if (!isRecord(snapshot) || typeof snapshot.runId !== 'string' || !isRecord(snapshot.previousProperties)) {
      return []
    }

    return [{
      runId: snapshot.runId,
      previousProperties: snapshot.previousProperties
    }]
  })

  return formatSnapshots.length === 0 ? {} : { formatSnapshots }
}
