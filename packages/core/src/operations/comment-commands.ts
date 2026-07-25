/**
 * 职责：维持 command-builders 入口中的批注命令兼容包装。
 * 边界：只转发到 comment-command-builders，不改变批注事务语义。
 * 协作模块：comment-command-builders、editor facade 与事务流水线共同提供批注能力。
 * 性能/安全约束：包装层不新增遍历和副作用，保持既有公开函数签名。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import type { DocumentProjection } from '../model/projection'
import type { SelectionState } from '../model/selection'
import {
  buildAddCommentThreadCommand as buildAddCommentThreadCommandInternal,
  buildDeleteCommentThreadCommand as buildDeleteCommentThreadCommandInternal,
  buildEditCommentMessageCommand as buildEditCommentMessageCommandInternal,
  buildReopenCommentThreadCommand as buildReopenCommentThreadCommandInternal,
  buildReplyCommentThreadCommand as buildReplyCommentThreadCommandInternal,
  buildResolveCommentThreadCommand as buildResolveCommentThreadCommandInternal
} from './comment-command-builders'
import type {
  AddCommentThreadInput,
  EditCommentMessageInput,
  ReplyCommentThreadInput
} from './comment-command-builders'
import type { Command } from './transaction'

/**
 * 构造批注 thread 创建命令。
 */
export function buildAddCommentThreadCommand(
  projection: DocumentProjection,
  selection: SelectionState | null,
  input: AddCommentThreadInput
): Command | null {
  return buildAddCommentThreadCommandInternal(projection, selection, input)
}

/**
 * 构造批注回复命令。
 */
export function buildReplyCommentThreadCommand(
  projection: DocumentProjection,
  threadId: string,
  input: ReplyCommentThreadInput
): Command | null {
  return buildReplyCommentThreadCommandInternal(projection, threadId, input)
}

/**
 * 构造批注消息编辑命令。
 */
export function buildEditCommentMessageCommand(
  projection: DocumentProjection,
  threadId: string,
  entryId: string,
  input: EditCommentMessageInput
): Command | null {
  return buildEditCommentMessageCommandInternal(projection, threadId, entryId, input)
}

/**
 * 构造批注回复编辑命令。
 */
export function buildEditCommentEntryCommand(
  projection: DocumentProjection,
  threadId: string,
  entryId: string,
  input: EditCommentMessageInput
): Command | null {
  return buildEditCommentMessageCommandInternal(projection, threadId, entryId, input)
}

/**
 * 构造批注解决命令。
 */
export function buildResolveCommentThreadCommand(
  projection: DocumentProjection,
  threadId: string
): Command | null {
  return buildResolveCommentThreadCommandInternal(projection, threadId)
}

/**
 * 构造批注重开命令。
 */
export function buildReopenCommentThreadCommand(
  projection: DocumentProjection,
  threadId: string
): Command | null {
  return buildReopenCommentThreadCommandInternal(projection, threadId)
}

/**
 * 构造批注删除命令。
 */
export function buildDeleteCommentThreadCommand(
  projection: DocumentProjection,
  threadId: string
): Command | null {
  return buildDeleteCommentThreadCommandInternal(projection, threadId)
}
