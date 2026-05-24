/**
 * @vitest-environment node
 *
 * 职责：锁定 comments state 的最小纯函数契约。
 * 边界：只验证 thread 状态、权限和草稿提交流程，不触碰 DOM 或宿主 adapter。
 * 协作模块：packages/ui/src/comments/state.ts 与 packages/ui/src/comments/types.ts。
 * 约束：作者只能编辑/删除自己的消息，非作者只有在显式允许时才能 resolve/reopen。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md Gate 4.8-4.10。
 */

import { describe, expect, test } from 'vitest'
import {
  appendCommentReply,
  confirmCommentDraft,
  confirmCommentReplyDraft,
  createCommentsState,
  deleteCommentMessage,
  deleteCommentThread,
  openCommentDraft,
  openCommentReplyDraft,
  readCommentReplyPermissions,
  readCommentThreadPermissions,
  reopenCommentThread,
  resolveCommentThread,
  updateCommentDraft
} from '../src/comments/state'
import type { JWordCommentAnchorState, JWordCommentReply, JWordCommentThread } from '../src/comments/types'

describe('comments state', () => {
  test('会处理草稿提交、回复校验与 resolve 删除流程', () => {
    const initialState = createCommentsState([buildThread()])
    const withDraft = openCommentDraft(initialState, buildAnchor('draft-anchor', '新的正文锚点'))
    const updatedDraft = updateCommentDraft(withDraft, '  新批注内容  ')
    const draftResult = confirmCommentDraft(updatedDraft)
    const blankReplyResult = confirmCommentReplyDraft(openCommentReplyDraft(initialState, 'thread-1'))
    const withReply = appendCommentReply(initialState, 'thread-1', buildReply('reply-2', 'bob', '补充回复'))
    const resolvedState = resolveCommentThread(withReply, 'thread-1')
    const reopenedState = reopenCommentThread(resolvedState, 'thread-1')
    const deletedReplyState = deleteCommentMessage(withReply, 'thread-1', 'reply-1')
    const deletedThreadState = deleteCommentThread(reopenedState, 'thread-1')

    expect(draftResult.submission).toEqual({
      anchor: buildAnchor('draft-anchor', '新的正文锚点'),
      body: '新批注内容'
    })
    expect(draftResult.state.draft).toBeNull()
    expect(blankReplyResult.submission).toBeNull()
    expect(blankReplyResult.state.replyDraft?.error).toBe('请输入回复内容。')
    expect(resolvedState.threads[0]?.resolved).toBe(true)
    expect(resolvedState.threads[0]?.anchor.resolved).toBe(true)
    expect(reopenedState.threads[0]?.resolved).toBe(false)
    expect(deletedReplyState.threads[0]?.messages.map((message) => message.id)).toEqual(['comment-1', 'reply-2'])
    expect(deletedThreadState.threads).toHaveLength(0)
  })

  test('会按当前用户计算 thread 与 reply 权限', () => {
    const thread = buildThread()
    const rootMessage = thread.messages[0]
    const replyMessage = thread.messages[1]

    if (rootMessage === undefined || replyMessage === undefined) {
      throw new Error('测试 thread 必须包含根消息和回复消息。')
    }

    expect(readCommentThreadPermissions(thread, { id: 'alice', name: 'Alice' })).toEqual({
      canReply: true,
      canEdit: true,
      canDelete: true,
      canResolve: true,
      canReopen: false
    })
    expect(readCommentThreadPermissions(thread, { id: 'bob', name: 'Bob' })).toEqual({
      canReply: true,
      canEdit: false,
      canDelete: false,
      canResolve: false,
      canReopen: false
    })
    expect(readCommentThreadPermissions(thread, { id: 'bob', name: 'Bob' }, {
      allowResolveByNonAuthor: true
    }).canResolve).toBe(true)
    expect(readCommentReplyPermissions(rootMessage, { id: 'alice', name: 'Alice' })).toEqual({
      canEdit: true,
      canDelete: true
    })
    expect(readCommentReplyPermissions(replyMessage, { id: 'alice', name: 'Alice' })).toEqual({
      canEdit: false,
      canDelete: false
    })
  })
})

/** 创建测试用锚点。 */
function buildAnchor(threadId: string, quote = '原文摘录'): JWordCommentAnchorState {
  return {
    threadId,
    quote,
    selected: false,
    highlighted: false,
    resolved: false
  }
}

/** 创建测试用回复。 */
function buildReply(
  id: string,
  authorId: string,
  body: string
): JWordCommentReply {
  return {
    id,
    authorId,
    body,
    createdAt: '2026-05-23T10:00:00.000Z'
  }
}

/** 创建测试用 thread。 */
function buildThread(): JWordCommentThread {
  return {
    id: 'thread-1',
    authorId: 'alice',
    createdAt: '2026-05-23T09:30:00.000Z',
    resolved: false,
    anchor: buildAnchor('thread-1', '第一段的选中文本'),
    messages: [
      buildReply('comment-1', 'alice', '主批注内容'),
      buildReply('reply-1', 'bob', '跟进回复')
    ]
  }
}
