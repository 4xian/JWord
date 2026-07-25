/**
 * 职责：驱动 comments sidebar，把 DOM 事件翻译为纯状态转换与宿主 adapter 调用。
 * 边界：不直接访问 core，不依赖 selection-actions 或 toolbar 的内部实现，只暴露可供主进程 wiring 的公开方法。
 * 协作模块：comments/state 负责纯状态和权限，comments/dom 负责节点结构与渲染，宿主 adapter 负责真正持久化。
 * 性能/安全约束：只维护一份最小本地 UI state，事件监听统一可销毁，失败时不抛出未处理异常。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import {
  createCommentsSidebarDom,
  destroyCommentsSidebar,
  localizeCommentsSidebarDom,
  renderCommentsSidebar
} from './dom'
import {
  appendCommentReply,
  cancelCommentDraft,
  cancelCommentEditDraft,
  cancelCommentReplyDraft,
  confirmCommentDraft,
  confirmCommentEditDraft,
  confirmCommentReplyDraft,
  createCommentsState,
  deleteCommentMessage,
  deleteCommentThread,
  editCommentMessage,
  insertCommentThread,
  openCommentDraft,
  openCommentEditDraft,
  openCommentReplyDraft,
  readCommentsViewState,
  reopenCommentThread,
  resolveCommentThread,
  selectCommentThread as writeSelectedThread,
  setCommentThreads,
  updateCommentDraft,
  updateCommentEditDraft,
  updateCommentReplyDraft
} from './state'
import type {
  CommentsControllerHandle,
  CreateCommentsControllerOptions,
  JWordCommentAnchorState,
  JWordCommentCreateSubmission,
  JWordCommentReply,
  JWordCommentReplySubmission,
  JWordCommentThread,
  JWordCommentUpdateThreadRequest
} from './types'
import { readJWordUiText, resolveJWordUiI18n, type ResolvedJWordUiI18n } from '../i18n'

/** 创建 comments controller。 */
export function createCommentsController(options: CreateCommentsControllerOptions): CommentsControllerHandle {
  const dom = createCommentsSidebarDom(options.host)
  const signalController = new AbortController()
  const viewContext = {
    currentUser: options.currentUser,
    resolveUser: options.resolveUser,
    permissions: options.permissions ?? {},
    formatCreatedAt: options.formatCreatedAt,
    readonly: isReadonlyMode(options.readonly)
  }
  const readonlyMode = viewContext.readonly
  let state = createCommentsState(options.threads ?? [])
  let lastCreateAnchor: JWordCommentAnchorState | null = null
  let i18n = options.i18n ?? resolveJWordUiI18n()

  bindEvents()
  render()

  return {
    elements: dom,
    /** 替换 thread 列表。 */
    setThreads(threads: readonly JWordCommentThread[]): void {
      state = setCommentThreads(state, threads)
      render()
    },
    /** 切换当前选中的 thread。 */
    selectThread(threadId: string | null): void {
      void handleSelectThread(threadId)
    },
    /** 从正文锚点打开新建批注草稿。 */
    openCreateDraft(anchor: JWordCommentAnchorState): void {
      if (readonlyMode) {
        return
      }

      lastCreateAnchor = anchor
      state = openCommentDraft(state, anchor)
      render()
      focusDraftSoon()
    },
    /** 打开回复草稿。 */
    openReplyDraft(threadId: string): void {
      if (readonlyMode) {
        return
      }

      state = openCommentReplyDraft(state, threadId)
      render()
      focusDraftSoon()
    },
    /** 打开编辑草稿。 */
    openEditDraft(threadId: string, messageId: string): void {
      if (readonlyMode) {
        return
      }

      state = openCommentEditDraft(state, threadId, messageId)
      render()
      focusDraftSoon()
    },
    /** 聚焦当前可见草稿。 */
    focusDraft(): void {
      focusActiveDraftInput()
    },
    /** 动态刷新批注文案。 */
    setI18n(nextI18n: ResolvedJWordUiI18n): void {
      i18n = nextI18n
      localizeCommentsSidebarDom(dom, i18n)
      render()
    },
    /** 销毁 controller。 */
    destroy(): void {
      signalController.abort()
      destroyCommentsSidebar(dom)
    }
  }

  /** 刷新 sidebar。 */
  function render(): void {
    dom.createButton.hidden = readonlyMode || (lastCreateAnchor === null && state.draft === null)
    dom.createButton.disabled = readonlyMode || (lastCreateAnchor === null && state.draft === null)
    dom.composerInput.readOnly = readonlyMode
    dom.replyInput.readOnly = readonlyMode
    dom.editInput.readOnly = readonlyMode
    renderCommentsSidebar(dom, readCommentsViewState(state, viewContext), i18n)
  }

  /** 为当前 controller 绑定事件。 */
  function bindEvents(): void {
    dom.createButton.addEventListener('click', handleOpenCreateButton, {
      signal: signalController.signal
    })
    dom.composerInput.addEventListener('input', handleDraftInput, {
      signal: signalController.signal
    })
    dom.composerConfirmButton.addEventListener('click', () => {
      void handleConfirmDraft()
    }, { signal: signalController.signal })
    dom.composerCancelButton.addEventListener('click', handleCancelDraft, {
      signal: signalController.signal
    })
    dom.threadList.addEventListener('click', (event) => {
      void handleThreadListClick(event)
    }, { signal: signalController.signal })
    dom.host.addEventListener('click', (event) => {
      void handlePageRailClick(event)
    }, { signal: signalController.signal })
    dom.detailQuote.addEventListener('click', () => {
      void handleFocusSelectedAnchor()
    }, { signal: signalController.signal })
    dom.detailReplyButton.addEventListener('click', handleOpenReply, {
      signal: signalController.signal
    })
    dom.detailResolveButton.addEventListener('click', () => {
      void handleToggleResolved()
    }, { signal: signalController.signal })
    dom.detailDeleteButton.addEventListener('click', () => {
      void handleDeleteSelectedThread()
    }, { signal: signalController.signal })
    dom.replyInput.addEventListener('input', handleReplyInput, {
      signal: signalController.signal
    })
    dom.replyConfirmButton.addEventListener('click', () => {
      void handleConfirmReply()
    }, { signal: signalController.signal })
    dom.replyCancelButton.addEventListener('click', handleCancelReply, {
      signal: signalController.signal
    })
    dom.editInput.addEventListener('input', handleEditInput, {
      signal: signalController.signal
    })
    dom.editConfirmButton.addEventListener('click', () => {
      void handleConfirmEdit()
    }, { signal: signalController.signal })
    dom.editCancelButton.addEventListener('click', handleCancelEdit, {
      signal: signalController.signal
    })
    dom.detailMessages.addEventListener('click', (event) => {
      void handleMessageClick(event)
    }, { signal: signalController.signal })
  }

  /** 处理移动到页内 rail 的批注卡片点击。 */
  async function handlePageRailClick(event: Event): Promise<void> {
    const target = event.target

    if (!(target instanceof HTMLElement) || target.closest('.jw-comments-page-rail') === null) {
      return
    }

    await handleThreadListClick(event)
  }

  /** 处理标题栏里的新建批注按钮。 */
  function handleOpenCreateButton(): void {
    if (readonlyMode) {
      return
    }

    if (state.draft !== null) {
      focusDraftSoon()
      return
    }

    if (lastCreateAnchor === null) {
      return
    }

    state = openCommentDraft(state, lastCreateAnchor)
    render()
    focusDraftSoon()
  }

  /** 处理新建批注输入。 */
  function handleDraftInput(): void {
    if (readonlyMode) {
      return
    }

    state = updateCommentDraft(state, dom.composerInput.value)
    render()
  }

  /** 处理取消新建批注。 */
  function handleCancelDraft(): void {
    state = cancelCommentDraft(state)
    render()
  }

  /** 提交新建批注。 */
  async function handleConfirmDraft(): Promise<void> {
    if (readonlyMode) {
      return
    }

    const result = confirmCommentDraft(state)

    state = result.state
    render()

    if (result.submission === null) {
      return
    }

    const createdAt = new Date().toISOString()

    try {
      await options.adapter.createThread({
        ...result.submission,
        authorId: options.currentUser.id,
        createdAt
      })
      if (!hasCommentMessage(state.threads, {
        authorId: options.currentUser.id,
        createdAt,
        body: result.submission.body
      })) {
        state = insertCommentThread(
          state,
          createLocalThread(result.submission, options.currentUser.id, createdAt)
        )
      }
      render()
    } catch (error) {
      state = {
        ...state,
        draft: {
          anchor: result.submission.anchor,
          body: result.submission.body,
          error: normalizeCommentError(error, readJWordUiText(i18n, 'a11y.comments.createFailed'))
        }
      }
      render()
      focusDraftSoon()
    }
  }

  /** 处理 thread 列表点击。 */
  async function handleThreadListClick(event: Event): Promise<void> {
    const target = event.target

    if (!(target instanceof HTMLElement)) {
      return
    }

    const action = target.closest<HTMLElement>('[data-jword-comment-action]')?.getAttribute('data-jword-comment-action')
    const messageId = target.closest<HTMLElement>('[data-jword-comment-message-id]')?.getAttribute('data-jword-comment-message-id')
    const threadId = readThreadId(target)

    if (threadId === null) {
      return
    }

    if (action === 'focus-anchor') {
      await handleSelectThread(threadId)
      await handleFocusAnchor(threadId)
      return
    }

    if (action === 'open-reply') {
      await handleSelectThread(threadId)
      handleOpenReply()
      return
    }

    if (action === 'toggle-resolved') {
      await handleSelectThread(threadId)
      await handleToggleResolved()
      return
    }

    if (action === 'delete-thread') {
      await handleSelectThread(threadId)
      await handleDeleteSelectedThread()
      return
    }

    if (action === 'edit-message' && typeof messageId === 'string') {
      if (readonlyMode) {
        return
      }

      await handleSelectThread(threadId)
      state = openCommentEditDraft(state, threadId, messageId)
      render()
      focusDraftSoon()
      return
    }

    if (action === 'delete-message' && typeof messageId === 'string') {
      await handleDeleteMessage(threadId, messageId)
      return
    }

    if (target.closest<HTMLElement>('[data-jword-comment-thread-id]') !== null) {
      await handleSelectThread(threadId)
    }
  }

  /** 处理 thread 选择。 */
  async function handleSelectThread(threadId: string | null): Promise<void> {
    state = writeSelectedThread(state, threadId)
    render()

    try {
      await options.adapter.selectThread(threadId)
    } catch (error) {
      ignoreAdapterError(error)
    }
  }

  /** 处理当前 thread 的锚点聚焦。 */
  async function handleFocusSelectedAnchor(): Promise<void> {
    const selectedThread = readSelectedThread()

    if (selectedThread === null) {
      return
    }

    await handleFocusAnchor(selectedThread.id)
  }

  /** 处理指定 thread 的锚点聚焦。 */
  async function handleFocusAnchor(threadId: string): Promise<void> {
    const thread = findThread(threadId)

    if (thread === null) {
      return
    }

    try {
      await options.adapter.focusAnchor(thread.anchor)
    } catch (error) {
      ignoreAdapterError(error)
    }
  }

  /** 打开回复草稿。 */
  function handleOpenReply(): void {
    if (readonlyMode) {
      return
    }

    const selectedThread = readSelectedThread()

    if (selectedThread === null) {
      return
    }

    state = openCommentReplyDraft(state, selectedThread.id)
    render()
    focusDraftSoon()
  }

  /** 处理回复输入。 */
  function handleReplyInput(): void {
    if (readonlyMode) {
      return
    }

    state = updateCommentReplyDraft(state, dom.replyInput.value)
    render()
  }

  /** 取消回复。 */
  function handleCancelReply(): void {
    state = cancelCommentReplyDraft(state)
    render()
  }

  /** 提交回复。 */
  async function handleConfirmReply(): Promise<void> {
    if (readonlyMode) {
      return
    }

    const result = confirmCommentReplyDraft(state)

    state = result.state
    render()

    if (result.submission === null) {
      return
    }

    const createdAt = new Date().toISOString()

    try {
      await options.adapter.updateThread({
        kind: 'reply',
        request: {
          ...result.submission,
          authorId: options.currentUser.id,
          createdAt
        }
      })
      if (!hasCommentMessage(state.threads, {
        threadId: result.submission.threadId,
        authorId: options.currentUser.id,
        createdAt,
        body: result.submission.body
      })) {
        state = appendCommentReply(
          state,
          result.submission.threadId,
          createLocalReply(result.submission, options.currentUser.id, createdAt)
        )
      }
      render()
    } catch (error) {
      state = {
        ...state,
        replyDraft: {
          threadId: result.submission.threadId,
          body: result.submission.body,
          error: normalizeCommentError(error, readJWordUiText(i18n, 'a11y.comments.replyFailed'))
        }
      }
      render()
      focusDraftSoon()
    }
  }

  /** 处理编辑输入。 */
  function handleEditInput(): void {
    if (readonlyMode) {
      return
    }

    state = updateCommentEditDraft(state, dom.editInput.value)
    render()
  }

  /** 取消编辑。 */
  function handleCancelEdit(): void {
    state = cancelCommentEditDraft(state)
    render()
  }

  /** 提交编辑。 */
  async function handleConfirmEdit(): Promise<void> {
    if (readonlyMode) {
      return
    }

    const result = confirmCommentEditDraft(state)

    state = result.state
    render()

    if (result.submission === null) {
      return
    }

    const editedAt = new Date().toISOString()

    try {
      await options.adapter.updateThread({
        kind: 'edit',
        request: {
          ...result.submission,
          authorId: options.currentUser.id,
          editedAt
        }
      })
      if (!hasEditedCommentMessage(state.threads, result.submission.threadId, result.submission.messageId, result.submission.body)) {
        state = editCommentMessage(
          state,
          result.submission.threadId,
          result.submission.messageId,
          result.submission.body,
          editedAt
        )
      }
      render()
    } catch (error) {
      state = {
        ...state,
        editDraft: {
          threadId: result.submission.threadId,
          messageId: result.submission.messageId,
          body: result.submission.body,
          error: normalizeCommentError(error, readJWordUiText(i18n, 'a11y.comments.editFailed'))
        }
      }
      render()
      focusDraftSoon()
    }
  }

  /** 切换解决状态。 */
  async function handleToggleResolved(): Promise<void> {
    if (readonlyMode) {
      return
    }

    const selectedThread = readSelectedThread()

    if (selectedThread === null) {
      return
    }

    const request: JWordCommentUpdateThreadRequest = selectedThread.resolved
      ? {
          kind: 'reopen',
          threadId: selectedThread.id
        }
      : {
          kind: 'resolve',
          threadId: selectedThread.id
        }

    try {
      await options.adapter.updateThread(request)
      state = selectedThread.resolved
        ? reopenCommentThread(state, selectedThread.id)
        : resolveCommentThread(state, selectedThread.id)
      render()
    } catch (error) {
      ignoreAdapterError(error)
    }
  }

  /** 删除当前选中 thread。 */
  async function handleDeleteSelectedThread(): Promise<void> {
    if (readonlyMode) {
      return
    }

    const selectedThread = readSelectedThread()

    if (selectedThread === null) {
      return
    }

    try {
      await options.adapter.deleteThread(selectedThread.id)
      state = deleteCommentThread(state, selectedThread.id)
      render()
    } catch (error) {
      ignoreAdapterError(error)
    }
  }

  /** 处理消息级动作。 */
  async function handleMessageClick(event: Event): Promise<void> {
    const target = event.target

    if (!(target instanceof HTMLElement)) {
      return
    }

    const action = target.closest<HTMLElement>('[data-jword-comment-action]')?.getAttribute('data-jword-comment-action')
    const messageId = target.closest<HTMLElement>('[data-jword-comment-message-id]')?.getAttribute('data-jword-comment-message-id')
    const selectedThread = readSelectedThread()

    if (action == null || messageId == null || selectedThread === null) {
      return
    }

    if (action === 'edit-message') {
      if (readonlyMode) {
        return
      }

      state = openCommentEditDraft(state, selectedThread.id, messageId)
      render()
      focusDraftSoon()
      return
    }

    if (action === 'delete-message') {
      await handleDeleteMessage(selectedThread.id, messageId)
    }
  }

  /** 删除指定 reply。 */
  async function handleDeleteMessage(threadId: string, messageId: string): Promise<void> {
    if (readonlyMode) {
      return
    }

    try {
      await options.adapter.updateThread({
        kind: 'deleteMessage',
        request: {
          threadId,
          messageId
        }
      })
      state = deleteCommentMessage(state, threadId, messageId)
      render()
    } catch (error) {
      ignoreAdapterError(error)
    }
  }

  /** 把焦点放回当前可见草稿。 */
  function focusDraftSoon(): void {
    queueMicrotask(() => {
      focusActiveDraftInput()
    })
  }

  /** 聚焦当前可见的草稿输入。 */
  function focusActiveDraftInput(): void {
    const target = readActiveDraftInput()

    if (target !== null) {
      target.focus()
    }
  }

  /** 读取当前可见草稿输入。 */
  function readActiveDraftInput(): HTMLTextAreaElement | null {
    if (!dom.composer.hidden) {
      return dom.composerInput
    }

    if (!dom.replyComposer.hidden) {
      return dom.replyInput
    }

    if (!dom.editComposer.hidden) {
      return dom.editInput
    }

    return null
  }

  /** 读取当前选中的 thread。 */
  function readSelectedThread(): JWordCommentThread | null {
    return state.selectedThreadId === null ? null : findThread(state.selectedThreadId)
  }

  /** 在当前 state 中查找 thread。 */
  function findThread(threadId: string): JWordCommentThread | null {
    return state.threads.find((thread) => thread.id === threadId) ?? null
  }
}

/** 从事件目标读取 threadId。 */
function readThreadId(target: HTMLElement): string | null {
  return target.closest<HTMLElement>('[data-jword-comment-thread-id]')?.getAttribute('data-jword-comment-thread-id') ?? null
}

/** 把未知异常归一化成用户可见文案。 */
function normalizeCommentError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message
  }

  if (typeof error === 'string' && error.trim().length > 0) {
    return error
  }

  return fallback
}

/** 显式吞掉不需要向 UI 暴露的 adapter 异常。 */
function ignoreAdapterError(error: unknown): void {
  void error
}

/** 读取全局只读模式是否开启。 */
function isReadonlyMode(readonly: CreateCommentsControllerOptions['readonly']): boolean {
  return readonly === true || (typeof readonly === 'object' && readonly.enabled === true)
}

/** 创建本地 optimistic thread。 */
function createLocalThread(
  submission: JWordCommentCreateSubmission,
  authorId: string,
  createdAt: string
): JWordCommentThread {
  const threadId = createLocalCommentId('comment-thread')

  return {
    id: threadId,
    authorId,
    createdAt,
    resolved: false,
    anchor: {
      ...submission.anchor,
      threadId,
      selected: true,
      highlighted: true,
      resolved: false
    },
    messages: [{
      id: createLocalCommentId('comment-message'),
      authorId,
      body: submission.body,
      createdAt
    }]
  }
}

/** 创建本地 optimistic reply。 */
function createLocalReply(
  submission: JWordCommentReplySubmission,
  authorId: string,
  createdAt: string
): JWordCommentReply {
  return {
    id: createLocalCommentId('comment-message'),
    authorId,
    body: submission.body,
    createdAt
  }
}

/** 判断 adapter 是否已经通过 setThreads 同步了同一条消息。 */
function hasCommentMessage(
  threads: readonly JWordCommentThread[],
  input: Readonly<{
    threadId?: string
    authorId: string
    createdAt: string
    body: string
  }>
): boolean {
  return threads.some((thread) =>
    (input.threadId === undefined || thread.id === input.threadId)
    && thread.messages.some((message) =>
      message.authorId === input.authorId
      && message.createdAt === input.createdAt
      && message.body === input.body
    )
  )
}

/** 判断 adapter 是否已经通过 setThreads 同步了编辑结果。 */
function hasEditedCommentMessage(
  threads: readonly JWordCommentThread[],
  threadId: string,
  messageId: string,
  body: string
): boolean {
  return threads.some((thread) =>
    thread.id === threadId
    && thread.messages.some((message) => message.id === messageId && message.body === body)
  )
}

/** 分配本地临时 ID。 */
function createLocalCommentId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`
  }

  return `${prefix}-${Date.now()}-${Math.round(Math.random() * 100000)}`
}
