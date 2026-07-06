/**
 * 职责：应用批注线程类 operation 到 Y.Doc 批注记录与范围记录。
 * 边界：只维护 comments、commentRanges 和 document.commentIds，不处理 UI 展示或文本锚点迁移。
 * 协作模块：operation-adapter 负责分发，adapter-location 负责文本拆分时的范围迁移。
 * 性能/安全约束：不访问 DOM，不触发布局渲染；只替换目标批注记录。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/03-architecture.md#34-operation。
 */

import {
  DOCUMENT_STORE_FIELDS,
  createCommentRangeRecord,
  createCommentRecord,
  projectCommentRecord,
  readCommentRangeRecord
} from '../model/document-store'
import { createJWordError } from '../shared/errors'
import type { CommentRangeId, DocumentStore } from '../model/document-store'
import type { CommentId } from '../model/position'
import type { Operation } from './transaction'
import {
  appendIdIfMissing,
  readRequiredArray,
  readRequiredString,
  removeId
} from './operation-record-utils'

/** 创建批注线程与锚点范围记录。 */
export function addCommentThread(
  store: DocumentStore,
  operation: Extract<Operation, { kind: 'addCommentThread' }>
): void {
  store.comments.set(operation.thread.id as CommentId, createCommentRecord(operation.thread))
  store.commentRanges.set(operation.range.id as CommentRangeId, createCommentRangeRecord(operation.range))
  appendIdIfMissing(
    readRequiredArray<CommentId>(store.document, DOCUMENT_STORE_FIELDS.document.commentIds, 'document commentIds'),
    operation.thread.id as CommentId
  )
}

/** 向批注线程追加回复。 */
export function replyCommentThread(
  store: DocumentStore,
  operation: Extract<Operation, { kind: 'replyCommentThread' }>
): void {
  replaceCommentThread(store, operation.threadId, (thread) => ({
    ...thread,
    messages: [...thread.messages, operation.message]
  }))
}

/** 编辑批注线程中的单条消息。 */
export function editCommentEntry(
  store: DocumentStore,
  operation: Extract<Operation, { kind: 'editCommentEntry' }>
): void {
  replaceCommentThread(store, operation.threadId, (thread) => ({
    ...thread,
    messages: thread.messages.map((message) =>
      message.id !== operation.messageId
        ? message
        : {
            ...message,
            text: operation.text,
            editedAt: operation.editedAt
          }
    )
  }))
}

/** 标记批注线程为已解决。 */
export function resolveCommentThread(
  store: DocumentStore,
  operation: Extract<Operation, { kind: 'resolveCommentThread' }>
): void {
  replaceCommentThread(store, operation.threadId, (thread) => ({
    ...thread,
    resolved: true
  }))
}

/** 重新打开已解决批注线程。 */
export function reopenCommentThread(
  store: DocumentStore,
  operation: Extract<Operation, { kind: 'reopenCommentThread' }>
): void {
  replaceCommentThread(store, operation.threadId, (thread) => ({
    ...thread,
    resolved: false
  }))
}

/** 删除批注线程及其锚点范围记录。 */
export function deleteCommentThread(store: DocumentStore, threadId: string): void {
  const commentRecord = findCommentRecord(store, threadId)
  const rangeId = commentRecord.get(DOCUMENT_STORE_FIELDS.comment.anchorRangeId)

  store.comments.delete(threadId as CommentId)
  removeId(
    readRequiredArray<CommentId>(store.document, DOCUMENT_STORE_FIELDS.document.commentIds, 'document commentIds'),
    threadId as CommentId
  )

  if (typeof rangeId === 'string') {
    store.commentRanges.delete(rangeId as CommentRangeId)
  }
}

/** 查找批注线程记录，不存在时抛出稳定 operation 错误。 */
function findCommentRecord(store: DocumentStore, threadId: string) {
  const record = store.comments.get(threadId as CommentId)

  if (record === undefined) {
    throw createJWordError('OPERATION_COMMENT_NOT_FOUND', '找不到目标批注线程', {
      threadId
    })
  }

  return record
}

/** 查找批注范围记录，不存在时抛出稳定 operation 错误。 */
function findCommentRangeRecord(store: DocumentStore, rangeId: string) {
  const record = store.commentRanges.get(rangeId as CommentRangeId)

  if (record === undefined) {
    throw createJWordError('OPERATION_COMMENT_NOT_FOUND', '找不到目标批注范围', {
      rangeId
    })
  }

  return record
}

/** 以投影快照更新批注线程记录。 */
function replaceCommentThread(
  store: DocumentStore,
  threadId: string,
  updater: (thread: ReturnType<typeof projectCommentRecord>) => ReturnType<typeof projectCommentRecord>
): void {
  const record = findCommentRecord(store, threadId)
  const rangeId = readRequiredString(record, DOCUMENT_STORE_FIELDS.comment.anchorRangeId)
  const rangeRecord = findCommentRangeRecord(store, rangeId)
  const nextThread = updater(projectCommentRecord(record, readCommentRangeRecord(rangeRecord)))

  store.comments.set(threadId as CommentId, createCommentRecord(nextThread))
}
