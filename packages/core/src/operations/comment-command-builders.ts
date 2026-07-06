/**
 * 职责：构造 Gate 4 批注线程的最小核心命令。
 * 边界：只生成命令和操作，不执行事务、不写入投影，也不处理界面交互。
 * 协作模块：编辑器门面、文本范围快照、事务流水线和投影共同提供批注闭环。
 * 性能/安全约束：builder 只依赖当前 projection 与 selection，保持 JSON 兼容输出。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#iteration-3---批注与超链接step-48-410。
 */

import { createTextRangeRecord } from '../model/position'
import type { DocumentProjection } from '../model/projection'
import { isSelectionCollapsed } from '../model/selection'
import type { SelectionState } from '../model/selection'
import type { Comment, CommentMessage } from '../model/types'
import type { Command } from './transaction'

export interface AddCommentThreadInput {
  readonly authorId: string
  readonly createdAt: string
  readonly text: string
}

export interface ReplyCommentThreadInput {
  readonly authorId: string
  readonly createdAt: string
  readonly text: string
}

export interface EditCommentMessageInput {
  readonly editedAt: string
  readonly text: string
}

/**
 * 构造新增批注 thread 命令。
 */
export function buildAddCommentThreadCommand(
  projection: DocumentProjection,
  selection: SelectionState | null,
  input: AddCommentThreadInput
): Command | null {
  if (selection === null || isSelectionCollapsed(selection)) {
    return null
  }

  const usedThreadIds = collectCommentThreadIds(projection)
  const usedMessageIds = collectCommentMessageIds(projection)
  const usedRangeIds = collectCommentRangeIds(projection)
  const threadId = allocateCommentId(usedThreadIds, 'comment-thread')
  const messageId = allocateCommentId(usedMessageIds, 'comment-message')
  const anchorRangeId = allocateCommentId(usedRangeIds, 'comment-range')
  const rangeSnapshot = createTextRangeRecord(anchorRangeId, selection.range)
  const message = createCommentMessage(messageId, anchorRangeId, input)
  const thread: Comment = {
    kind: 'commentThread',
    id: threadId,
    authorId: input.authorId,
    createdAt: input.createdAt,
    anchorRangeId,
    resolved: false,
    rangeSnapshot,
    messages: [message]
  }

  return {
    name: 'addCommentThread',
    operations: [{
      kind: 'addCommentThread',
      thread,
      range: rangeSnapshot
    }]
  }
}

/**
 * 构造批注回复命令。
 */
export function buildReplyCommentThreadCommand(
  projection: DocumentProjection,
  threadId: string,
  input: ReplyCommentThreadInput
): Command | null {
  const thread = findCommentThread(projection, threadId)

  if (thread === undefined) {
    return null
  }

  const usedMessageIds = collectCommentMessageIds(projection)
  const messageId = allocateCommentId(usedMessageIds, 'comment-message')

  return {
    name: 'replyCommentThread',
    operations: [{
      kind: 'replyCommentThread',
      threadId,
      message: createCommentMessage(messageId, thread.anchorRangeId, input)
    }]
  }
}

/**
 * 构造批注消息编辑命令。
 */
export function buildEditCommentMessageCommand(
  projection: DocumentProjection,
  threadId: string,
  messageId: string,
  input: EditCommentMessageInput
): Command | null {
  const thread = findCommentThread(projection, threadId)

  if (thread === undefined || !thread.messages.some((message) => message.id === messageId)) {
    return null
  }

  return {
    name: 'editCommentMessage',
    operations: [{
      kind: 'editCommentEntry',
      threadId,
      messageId,
      text: input.text,
      editedAt: input.editedAt
    }]
  }
}

/**
 * 构造批注 resolve 命令。
 */
export function buildResolveCommentThreadCommand(
  projection: DocumentProjection,
  threadId: string
): Command | null {
  const thread = findCommentThread(projection, threadId)

  if (thread === undefined || thread.resolved) {
    return null
  }

  return {
    name: 'resolveCommentThread',
    operations: [{
      kind: 'resolveCommentThread',
      threadId
    }]
  }
}

/**
 * 构造批注 reopen 命令。
 */
export function buildReopenCommentThreadCommand(
  projection: DocumentProjection,
  threadId: string
): Command | null {
  const thread = findCommentThread(projection, threadId)

  if (thread === undefined || !thread.resolved) {
    return null
  }

  return {
    name: 'reopenCommentThread',
    operations: [{
      kind: 'reopenCommentThread',
      threadId
    }]
  }
}

/**
 * 构造批注删除命令。
 */
export function buildDeleteCommentThreadCommand(
  projection: DocumentProjection,
  threadId: string
): Command | null {
  if (findCommentThread(projection, threadId) === undefined) {
    return null
  }

  return {
    name: 'deleteCommentThread',
    operations: [{
      kind: 'deleteCommentThread',
      threadId
    }]
  }
}

/**
 * 创建批注消息快照。
 */
function createCommentMessage(
  id: string,
  anchorRangeId: string,
  input: ReplyCommentThreadInput
): CommentMessage {
  return {
    id,
    authorId: input.authorId,
    createdAt: input.createdAt,
    anchorRangeId,
    text: input.text
  }
}

/**
 * 从 projection 中查找批注 thread。
 */
function findCommentThread(
  projection: DocumentProjection,
  threadId: string
): Comment | undefined {
  return projection.document.comments?.find((thread) => thread.id === threadId)
}

/**
 * 收集当前 projection 中已使用的批注 thread ID。
 */
function collectCommentThreadIds(projection: DocumentProjection): Set<string> {
  return new Set((projection.document.comments ?? []).map((thread) => thread.id))
}

/**
 * 收集当前 projection 中已使用的批注消息 ID。
 */
function collectCommentMessageIds(projection: DocumentProjection): Set<string> {
  return new Set(
    (projection.document.comments ?? []).flatMap((thread) => thread.messages.map((message) => message.id))
  )
}

/**
 * 收集当前 projection 中已使用的批注范围 ID。
 */
function collectCommentRangeIds(projection: DocumentProjection): Set<string> {
  return new Set((projection.document.comments ?? []).map((thread) => thread.anchorRangeId))
}

/**
 * 分配当前 projection 内唯一的批注相关 ID。
 */
function allocateCommentId(usedIds: Set<string>, prefix: string): string {
  let sequence = 1
  let candidate = `${prefix}-${sequence}`

  while (usedIds.has(candidate)) {
    sequence += 1
    candidate = `${prefix}-${sequence}`
  }

  usedIds.add(candidate)

  return candidate
}
