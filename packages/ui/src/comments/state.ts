/**
 * 职责：管理批注界面的纯状态、权限和视图投影。
 * 边界：只处理线程列表、选中线程、新建草稿、回复草稿、编辑草稿和权限计算，不访问 DOM。
 * 协作模块：批注 DOM 消费视图状态，批注控制器调度纯状态函数并调用宿主适配器。
 * 性能/安全约束：状态更新保持不可变，作者解析和时间格式化都走显式上下文。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md Gate 4.8-4.10。
 */

import type {
  JWordCommentAnchorState,
  JWordCommentCreateSubmission,
  JWordCommentDraftState,
  JWordCommentEditDraftState,
  JWordCommentEditSubmission,
  JWordCommentPermissionOptions,
  JWordCommentReply,
  JWordCommentReplyDraftState,
  JWordCommentReplySubmission,
  JWordCommentReplyView,
  JWordCommentReplyPermissions,
  JWordCommentThread,
  JWordCommentThreadPermissions,
  JWordCommentThreadView,
  JWordCommentTimeFormatter,
  JWordCommentUser,
  JWordCommentUserResolver,
  JWordResolvedCommentUser,
  JWordCommentsState,
  JWordCommentsViewContext,
  JWordCommentsViewState
} from './types'

const COMMENT_USER_COLORS = ['#2563eb', '#7c3aed', '#059669', '#d97706', '#db2777', '#0f766e']

/** 创建 comments 的初始状态。 */
export function createCommentsState(threads: readonly JWordCommentThread[] = []): JWordCommentsState {
  const selectedThreadId = threads[0]?.id ?? null

  return {
    threads: syncCommentAnchorSelection(threads, selectedThreadId),
    selectedThreadId,
    draft: null,
    replyDraft: null,
    editDraft: null
  }
}

/** 替换 thread 列表。 */
export function setCommentThreads(
  state: JWordCommentsState,
  threads: readonly JWordCommentThread[]
): JWordCommentsState {
  const selectedThreadId = state.selectedThreadId !== null && threads.some((thread) => thread.id === state.selectedThreadId)
    ? state.selectedThreadId
    : threads[0]?.id ?? null

  return {
    ...state,
    threads: syncCommentAnchorSelection(threads, selectedThreadId),
    selectedThreadId
  }
}

/** 选择某个 thread。 */
export function selectCommentThread(
  state: JWordCommentsState,
  threadId: string | null
): JWordCommentsState {
  return {
    ...state,
    threads: syncCommentAnchorSelection(state.threads, threadId),
    selectedThreadId: threadId
  }
}

/** 打开新建批注草稿。 */
export function openCommentDraft(
  state: JWordCommentsState,
  anchor: JWordCommentAnchorState
): JWordCommentsState {
  const selectedThreadId = state.threads.some((thread) => thread.id === anchor.threadId)
    ? anchor.threadId
    : state.selectedThreadId

  return {
    ...state,
    threads: syncCommentAnchorSelection(state.threads, selectedThreadId),
    draft: {
      anchor,
      body: '',
      error: ''
    },
    replyDraft: null,
    editDraft: null,
    selectedThreadId
  }
}

/** 更新新建批注草稿正文。 */
export function updateCommentDraft(
  state: JWordCommentsState,
  body: string
): JWordCommentsState {
  if (state.draft === null) {
    return state
  }

  return {
    ...state,
    draft: {
      ...state.draft,
      body,
      error: ''
    }
  }
}

/** 取消新建批注草稿。 */
export function cancelCommentDraft(state: JWordCommentsState): JWordCommentsState {
  if (state.draft === null) {
    return state
  }

  return {
    ...state,
    draft: null
  }
}

/** 确认新建批注草稿。 */
export function confirmCommentDraft(
  state: JWordCommentsState
): Readonly<{
  readonly state: JWordCommentsState
  readonly submission: JWordCommentCreateSubmission | null
}> {
  if (state.draft === null) {
    return {
      state,
      submission: null
    }
  }

  const body = state.draft.body.trim()

  if (body.length === 0) {
    return {
      state: {
        ...state,
        draft: {
          ...state.draft,
          error: '请输入批注内容。'
        }
      },
      submission: null
    }
  }

  return {
    state: {
      ...state,
      draft: null
    },
    submission: {
      anchor: state.draft.anchor,
      body
    }
  }
}

/** 打开回复草稿。 */
export function openCommentReplyDraft(
  state: JWordCommentsState,
  threadId: string
): JWordCommentsState {
  if (!state.threads.some((thread) => thread.id === threadId)) {
    return state
  }

  return {
    ...state,
    draft: null,
    replyDraft: {
      threadId,
      body: '',
      error: ''
    },
    editDraft: null,
    threads: syncCommentAnchorSelection(state.threads, threadId),
    selectedThreadId: threadId
  }
}

/** 更新回复草稿正文。 */
export function updateCommentReplyDraft(
  state: JWordCommentsState,
  body: string
): JWordCommentsState {
  if (state.replyDraft === null) {
    return state
  }

  return {
    ...state,
    replyDraft: {
      ...state.replyDraft,
      body,
      error: ''
    }
  }
}

/** 取消回复草稿。 */
export function cancelCommentReplyDraft(state: JWordCommentsState): JWordCommentsState {
  if (state.replyDraft === null) {
    return state
  }

  return {
    ...state,
    replyDraft: null
  }
}

/** 确认回复草稿。 */
export function confirmCommentReplyDraft(
  state: JWordCommentsState
): Readonly<{
  readonly state: JWordCommentsState
  readonly submission: JWordCommentReplySubmission | null
}> {
  if (state.replyDraft === null) {
    return {
      state,
      submission: null
    }
  }

  const body = state.replyDraft.body.trim()

  if (body.length === 0) {
    return {
      state: {
        ...state,
        replyDraft: {
          ...state.replyDraft,
          error: '请输入回复内容。'
        }
      },
      submission: null
    }
  }

  return {
    state: {
      ...state,
      replyDraft: null
    },
    submission: {
      threadId: state.replyDraft.threadId,
      body
    }
  }
}

/** 打开编辑草稿。 */
export function openCommentEditDraft(
  state: JWordCommentsState,
  threadId: string,
  messageId: string
): JWordCommentsState {
  const thread = findCommentThread(state.threads, threadId)
  const message = thread === null ? null : findCommentMessage(thread.messages, messageId)

  if (thread === null || message === null) {
    return state
  }

  return {
    ...state,
    draft: null,
    replyDraft: null,
    editDraft: {
      threadId,
      messageId,
      body: message.body,
      error: ''
    },
    threads: syncCommentAnchorSelection(state.threads, threadId),
    selectedThreadId: threadId
  }
}

/** 更新编辑草稿正文。 */
export function updateCommentEditDraft(
  state: JWordCommentsState,
  body: string
): JWordCommentsState {
  if (state.editDraft === null) {
    return state
  }

  return {
    ...state,
    editDraft: {
      ...state.editDraft,
      body,
      error: ''
    }
  }
}

/** 取消编辑草稿。 */
export function cancelCommentEditDraft(state: JWordCommentsState): JWordCommentsState {
  if (state.editDraft === null) {
    return state
  }

  return {
    ...state,
    editDraft: null
  }
}

/** 确认编辑草稿。 */
export function confirmCommentEditDraft(
  state: JWordCommentsState
): Readonly<{
  readonly state: JWordCommentsState
  readonly submission: JWordCommentEditSubmission | null
}> {
  if (state.editDraft === null) {
    return {
      state,
      submission: null
    }
  }

  const body = state.editDraft.body.trim()

  if (body.length === 0) {
    return {
      state: {
        ...state,
        editDraft: {
          ...state.editDraft,
          error: '请输入修改后的内容。'
        }
      },
      submission: null
    }
  }

  return {
    state: {
      ...state,
      editDraft: null
    },
    submission: {
      threadId: state.editDraft.threadId,
      messageId: state.editDraft.messageId,
      body
    }
  }
}

/** 追加一条新 thread。 */
export function insertCommentThread(
  state: JWordCommentsState,
  thread: JWordCommentThread
): JWordCommentsState {
  return {
    ...state,
    threads: syncCommentAnchorSelection([...state.threads, thread], thread.id),
    selectedThreadId: thread.id,
    draft: null
  }
}

/** 追加一条 reply。 */
export function appendCommentReply(
  state: JWordCommentsState,
  threadId: string,
  reply: JWordCommentReply
): JWordCommentsState {
  return updateCommentThread(state, threadId, (thread) => ({
    ...thread,
    messages: [...thread.messages, reply]
  }))
}

/** 编辑某条消息。 */
export function editCommentMessage(
  state: JWordCommentsState,
  threadId: string,
  messageId: string,
  body: string,
  editedAt: string
): JWordCommentsState {
  return updateCommentThread(state, threadId, (thread) => ({
    ...thread,
    messages: thread.messages.map((message) => message.id === messageId
      ? {
          ...message,
          body,
          editedAt
        }
      : message)
  }))
}

/** 删除某条消息。 */
export function deleteCommentMessage(
  state: JWordCommentsState,
  threadId: string,
  messageId: string
): JWordCommentsState {
  const thread = findCommentThread(state.threads, threadId)
  const messageIndex = thread?.messages.findIndex((message) => message.id === messageId) ?? -1

  if (thread === null || messageIndex < 0) {
    return state
  }

  if (messageIndex === 0) {
    return deleteCommentThread(state, threadId)
  }

  return updateCommentThread(state, threadId, (currentThread) => ({
    ...currentThread,
    messages: currentThread.messages.filter((message) => message.id !== messageId)
  }))
}

/** 解决 thread。 */
export function resolveCommentThread(
  state: JWordCommentsState,
  threadId: string
): JWordCommentsState {
  return updateCommentThread(state, threadId, (thread) => ({
    ...thread,
    resolved: true,
    anchor: {
      ...thread.anchor,
      resolved: true
    }
  }))
}

/** 重新打开 thread。 */
export function reopenCommentThread(
  state: JWordCommentsState,
  threadId: string
): JWordCommentsState {
  return updateCommentThread(state, threadId, (thread) => ({
    ...thread,
    resolved: false,
    anchor: {
      ...thread.anchor,
      resolved: false
    }
  }))
}

/** 删除 thread。 */
export function deleteCommentThread(
  state: JWordCommentsState,
  threadId: string
): JWordCommentsState {
  const threads = state.threads.filter((thread) => thread.id !== threadId)

  return {
    ...state,
    threads: syncCommentAnchorSelection(threads, state.selectedThreadId === threadId ? threads[0]?.id ?? null : state.selectedThreadId),
    selectedThreadId: state.selectedThreadId === threadId ? threads[0]?.id ?? null : state.selectedThreadId,
    draft: state.draft !== null && state.draft.anchor.threadId === threadId ? null : state.draft,
    replyDraft: state.replyDraft !== null && state.replyDraft.threadId === threadId ? null : state.replyDraft,
    editDraft: state.editDraft !== null && state.editDraft.threadId === threadId ? null : state.editDraft
  }
}

/** 计算 thread 的权限。 */
export function readCommentThreadPermissions(
  thread: JWordCommentThread,
  currentUser: JWordCommentUser,
  options: JWordCommentPermissionOptions = {},
  readonly = false
): JWordCommentThreadPermissions {
  if (readonly) {
    return {
      canReply: false,
      canEdit: false,
      canDelete: false,
      canResolve: false,
      canReopen: false
    }
  }

  const isAuthor = thread.authorId === currentUser.id
  const allowResolveByNonAuthor = options.allowResolveByNonAuthor === true
  const canResolve = !thread.resolved && (isAuthor || allowResolveByNonAuthor)
  const canReopen = thread.resolved && (isAuthor || allowResolveByNonAuthor)

  return {
    canReply: true,
    canEdit: isAuthor,
    canDelete: isAuthor,
    canResolve,
    canReopen
  }
}

/** 计算消息的权限。 */
export function readCommentReplyPermissions(
  reply: JWordCommentReply,
  currentUser: JWordCommentUser,
  readonly = false
): JWordCommentReplyPermissions {
  if (readonly) {
    return {
      canEdit: false,
      canDelete: false
    }
  }

  const isAuthor = reply.authorId === currentUser.id

  return {
    canEdit: isAuthor,
    canDelete: isAuthor
  }
}

/** 把 raw state 投影成可渲染的视图状态。 */
export function readCommentsViewState(
  state: JWordCommentsState,
  context: JWordCommentsViewContext
): JWordCommentsViewState {
  const currentUser = resolveCommentUser(context.currentUser.id, context.currentUser, context.resolveUser)
  const threads = state.threads.map((thread) => readCommentThreadView(thread, context))

  return {
    currentUser,
    threads,
    selectedThread: threads.find((thread) => thread.id === state.selectedThreadId) ?? null,
    draft: state.draft,
    replyDraft: state.replyDraft,
    editDraft: state.editDraft
  }
}

/** 计算单个 thread 的视图。 */
function readCommentThreadView(
  thread: JWordCommentThread,
  context: JWordCommentsViewContext
): JWordCommentThreadView {
  const author = resolveCommentUser(thread.authorId, context.currentUser, context.resolveUser)
  const permissions = readCommentThreadPermissions(thread, context.currentUser, context.permissions, context.readonly === true)
  const createdAtLabel = readCommentTimeLabel(thread.createdAt, context.formatCreatedAt)

  return {
    ...thread,
    author,
    createdAtLabel,
    permissions,
    messages: thread.messages.map((message, index) => readCommentReplyView(message, index === 0, context))
  }
}

/** 计算单条消息的视图。 */
function readCommentReplyView(
  reply: JWordCommentReply,
  root: boolean,
  context: JWordCommentsViewContext
): JWordCommentReplyView {
  return {
    ...reply,
    author: resolveCommentUser(reply.authorId, context.currentUser, context.resolveUser),
    createdAtLabel: readCommentTimeLabel(reply.createdAt, context.formatCreatedAt),
    root,
    permissions: readCommentReplyPermissions(reply, context.currentUser, context.readonly === true)
  }
}

/** 计算时间展示字符串。 */
function readCommentTimeLabel(value: string, formatter?: JWordCommentTimeFormatter): string {
  return formatter === undefined ? value : formatter(value)
}

/** 解析作者展示信息。 */
function resolveCommentUser(
  authorId: string,
  currentUser: JWordCommentUser,
  resolveUser: JWordCommentUserResolver | undefined
): JWordResolvedCommentUser {
  const resolvedUser = authorId === currentUser.id
    ? currentUser
    : resolveUser?.(authorId) ?? null
  const name = resolvedUser?.name?.trim() ?? ''
  const color = resolvedUser?.color?.trim() ?? ''
  const fallback = resolvedUser === null

  return {
    id: authorId,
    name: name.length > 0 ? name : authorId,
    color: color.length > 0 ? color : readFallbackCommentColor(authorId),
    fallback
  }
}

/** 读取回退作者颜色。 */
function readFallbackCommentColor(authorId: string): string {
  const normalized = authorId.trim()
  let sum = 0

  for (let index = 0; index < normalized.length; index += 1) {
    sum += normalized.charCodeAt(index)
  }

  return COMMENT_USER_COLORS[sum % COMMENT_USER_COLORS.length] ?? '#2563eb'
}

/** 查找指定 thread。 */
function findCommentThread(
  threads: readonly JWordCommentThread[],
  threadId: string
): JWordCommentThread | null {
  return threads.find((thread) => thread.id === threadId) ?? null
}

/** 查找指定消息。 */
function findCommentMessage(
  messages: readonly JWordCommentReply[],
  messageId: string
): JWordCommentReply | null {
  return messages.find((message) => message.id === messageId) ?? null
}

/** 更新指定 thread。 */
function updateCommentThread(
  state: JWordCommentsState,
  threadId: string,
  updater: (thread: JWordCommentThread) => JWordCommentThread
): JWordCommentsState {
  let replaced = false

  const threads = state.threads.map((thread) => {
    if (thread.id !== threadId) {
      return thread
    }

    replaced = true

    return updater(thread)
  })

  if (!replaced) {
    return state
  }

  return {
    ...state,
    threads: syncCommentAnchorSelection(threads, state.selectedThreadId)
  }
}

/** 按 selectedThreadId 同步 anchor 的选中、高亮和 resolved 状态。 */
function syncCommentAnchorSelection(
  threads: readonly JWordCommentThread[],
  selectedThreadId: string | null
): readonly JWordCommentThread[] {
  return threads.map((thread) => {
    const selected = selectedThreadId !== null && selectedThreadId === thread.id

    if (
      thread.anchor.threadId === thread.id
      && thread.anchor.selected === selected
      && thread.anchor.highlighted === selected
      && thread.anchor.resolved === thread.resolved
    ) {
      return thread
    }

    return {
      ...thread,
      anchor: {
        ...thread.anchor,
        threadId: thread.id,
        selected,
        highlighted: selected,
        resolved: thread.resolved
      }
    }
  })
}
