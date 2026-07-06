/**
 * 职责：创建和投影 document-store 中的批注 thread 与批注范围记录。
 * 边界：只处理批注 Yjs 记录，不创建正文 block/run，不处理修订 metadata。
 * 协作模块：document-store 公开入口 re-export，本模块复用 store-schema、store-types 与 store-json。
 * 性能/安全约束：只读投影不改写 Y.Doc，写入由调用方事务包裹，不访问 DOM 或网络。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/03-architecture.md#32-状态真源。
 */

import * as Y from 'yjs'

import { createJWordError } from '../shared/errors'
import { DOCUMENT_STORE_FIELDS } from './store-schema'
import { isRecord, readOptionalBoolean, readString, readTextRangeRecord, toDocumentStoreJson } from './store-json'
import type { Comment, CommentMessage } from './types'
import type { TextRangeRecord } from './position'
import type {
  CommentRangeId,
  CommentRangeRecord,
  CommentRangeRecordValue,
  CommentRecord,
  CommentRecordValue
} from './store-types'
import type { DocumentStoreJson } from './store-json'
import type { CommentId } from './position'

/** 创建批注 thread 记录。 */
export function createCommentRecord(comment: Comment): CommentRecord {
  const record = new Y.Map<CommentRecordValue>() as CommentRecord

  record.set(DOCUMENT_STORE_FIELDS.comment.kind, 'commentThread')
  record.set(DOCUMENT_STORE_FIELDS.comment.id, comment.id as CommentId)
  record.set(DOCUMENT_STORE_FIELDS.comment.authorId, comment.authorId)
  record.set(DOCUMENT_STORE_FIELDS.comment.createdAt, comment.createdAt)
  record.set(DOCUMENT_STORE_FIELDS.comment.anchorRangeId, comment.anchorRangeId)
  record.set(DOCUMENT_STORE_FIELDS.comment.resolved, comment.resolved)
  record.set(DOCUMENT_STORE_FIELDS.comment.messages, createCommentMessagesArray(comment.messages))

  return record
}

/** 创建批注范围记录。 */
export function createCommentRangeRecord(range: TextRangeRecord): CommentRangeRecord {
  const record = new Y.Map<CommentRangeRecordValue>() as CommentRangeRecord

  record.set(DOCUMENT_STORE_FIELDS.commentRange.id, range.id as CommentRangeId)
  record.set(DOCUMENT_STORE_FIELDS.commentRange.anchor, toDocumentStoreJson(range.anchor))
  record.set(DOCUMENT_STORE_FIELDS.commentRange.focus, toDocumentStoreJson(range.focus))

  return record
}

/** 把批注记录投影为只读 thread 快照。 */
export function projectCommentRecord(comment: CommentRecord, rangeSnapshot: TextRangeRecord): Comment {
  const authorId = readString(comment.get(DOCUMENT_STORE_FIELDS.comment.authorId), 'comment authorId')
  const createdAt = readString(comment.get(DOCUMENT_STORE_FIELDS.comment.createdAt), 'comment createdAt')
  const anchorRangeId = readString(comment.get(DOCUMENT_STORE_FIELDS.comment.anchorRangeId), 'comment anchorRangeId')
  const resolved = readOptionalBoolean(comment.get(DOCUMENT_STORE_FIELDS.comment.resolved)) ?? false
  const messages = projectCommentMessages(comment.get(DOCUMENT_STORE_FIELDS.comment.messages))

  return {
    kind: 'commentThread',
    id: readString(comment.get(DOCUMENT_STORE_FIELDS.comment.id), 'comment'),
    authorId,
    createdAt,
    anchorRangeId,
    resolved,
    rangeSnapshot,
    messages
  }
}

/** 读取批注范围记录。 */
export function readCommentRangeRecord(record: CommentRangeRecord): TextRangeRecord {
  return readTextRangeRecord({
    id: record.get(DOCUMENT_STORE_FIELDS.commentRange.id),
    anchor: record.get(DOCUMENT_STORE_FIELDS.commentRange.anchor),
    focus: record.get(DOCUMENT_STORE_FIELDS.commentRange.focus)
  }, 'comment range')
}

/** 创建批注消息共享数组。 */
function createCommentMessagesArray(messages: readonly CommentMessage[]): Y.Array<DocumentStoreJson> {
  const array = new Y.Array<DocumentStoreJson>()

  if (messages.length > 0) {
    array.push(messages.map((message) => toDocumentStoreJson(message)))
  }

  return array
}

/** 投影批注消息共享数组。 */
function projectCommentMessages(value: unknown): readonly CommentMessage[] {
  if (!(value instanceof Y.Array)) {
    return Object.freeze([])
  }

  return Object.freeze(value.toArray().map((message, index) => projectCommentMessage(message, index)))
}

/** 投影单条批注消息。 */
function projectCommentMessage(value: unknown, index: number): CommentMessage {
  if (!isRecord(value)) {
    throw createJWordError('PROJECTION_INVALID_DOCUMENT', 'comment message 结构非法', {
      index
    })
  }

  if (
    typeof value.id !== 'string'
    || typeof value.authorId !== 'string'
    || typeof value.createdAt !== 'string'
    || typeof value.anchorRangeId !== 'string'
    || typeof value.text !== 'string'
  ) {
    throw createJWordError('PROJECTION_INVALID_DOCUMENT', 'comment message 字段非法', {
      index
    })
  }

  return {
    id: value.id,
    authorId: value.authorId,
    createdAt: value.createdAt,
    anchorRangeId: value.anchorRangeId,
    text: value.text,
    ...(typeof value.editedAt === 'string' ? { editedAt: value.editedAt } : {})
  }
}
