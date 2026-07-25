/**
 * 职责：创建并渲染 comments sidebar DOM，以及正文锚点高亮所需的 class 和 data hook。
 * 边界：只负责节点结构、最小 inline 布局和展示状态，不访问 core 或宿主业务逻辑。
 * 协作模块：comments/state 负责视图投影，comments/controller 负责事件绑定与 adapter 调度。
 * 性能/安全约束：节点结构保持稳定，列表和消息按需重绘，不写入全局 CSS。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import {
  readJWordUiText,
  resolveJWordUiI18n,
  type ResolvedJWordUiI18n
} from '../i18n'
import type {
  JWordCommentAnchorState,
  JWordCommentReplyView,
  JWordCommentThreadView,
  JWordCommentsSidebarDom,
  JWordCommentsViewState,
  JWordResolvedCommentUser
} from './types'

/** 创建 comments sidebar DOM。 */
export function createCommentsSidebarDom(host: HTMLElement): JWordCommentsSidebarDom {
  const i18n = resolveJWordUiI18n()
  const root = document.createElement('aside')
  const header = document.createElement('div')
  const title = document.createElement('h2')
  const createButton = document.createElement('button')
  const composer = document.createElement('section')
  const composerAnchor = document.createElement('div')
  const composerInput = document.createElement('textarea')
  const composerError = document.createElement('p')
  const composerActions = document.createElement('div')
  const composerConfirmButton = document.createElement('button')
  const composerCancelButton = document.createElement('button')
  const threadList = document.createElement('div')
  const threadEmpty = document.createElement('p')
  const detail = document.createElement('section')
  const detailEmpty = document.createElement('p')
  const detailHeader = document.createElement('div')
  const detailAuthorRow = document.createElement('div')
  const detailStatus = document.createElement('span')
  const detailAuthor = document.createElement('span')
  const detailTime = document.createElement('span')
  const detailQuote = document.createElement('button')
  const detailActions = document.createElement('div')
  const detailReplyButton = document.createElement('button')
  const detailResolveButton = document.createElement('button')
  const detailDeleteButton = document.createElement('button')
  const detailMessages = document.createElement('div')
  const replyComposer = document.createElement('section')
  const replyInput = document.createElement('textarea')
  const replyError = document.createElement('p')
  const replyActions = document.createElement('div')
  const replyConfirmButton = document.createElement('button')
  const replyCancelButton = document.createElement('button')
  const editComposer = document.createElement('section')
  const editInput = document.createElement('textarea')
  const editError = document.createElement('p')
  const editActions = document.createElement('div')
  const editConfirmButton = document.createElement('button')
  const editCancelButton = document.createElement('button')

  applySidebarLayout(root)
  root.className = 'jw-comments-sidebar'
  root.setAttribute('data-jword-comments-sidebar', 'true')

  applyRowLayout(header)
  header.className = 'jw-comments-sidebar__header'
  header.style.marginBottom = '10px'
  header.style.alignItems = 'center'
  header.style.justifyContent = 'space-between'

  title.className = 'jw-comments-sidebar__title'
  title.textContent = readCommentsText(i18n, 'title')
  title.style.margin = '0'
  title.style.fontSize = '14px'
  title.style.fontWeight = '600'
  title.style.lineHeight = '1.25'

  createButton.type = 'button'
  createButton.className = 'jw-comments-sidebar__create'
  createButton.textContent = readCommentsText(i18n, 'create')
  createButton.hidden = true
  createButton.style.minHeight = '28px'
  createButton.style.padding = '0 10px'
  createButton.style.border = '1px solid #d6dde7'
  createButton.style.borderRadius = '6px'
  createButton.style.background = '#ffffff'
  createButton.style.color = '#334155'
  createButton.style.font = 'inherit'
  createButton.style.fontSize = '12px'
  createButton.style.lineHeight = '1'
  createButton.setAttribute('data-jword-comment-action', 'open-create')

  header.append(title, createButton)

  applyComposerLayout(composer)
  composer.className = 'jw-comments-sidebar__composer'
  composer.hidden = true

  composerAnchor.className = 'jw-comments-sidebar__composer-anchor'
  composerAnchor.style.marginBottom = '6px'
  composerAnchor.style.fontSize = '12px'
  composerAnchor.style.lineHeight = '1.45'

  applyTextarea(composerInput, readCommentsText(i18n, 'composerPlaceholder'))
  composerInput.setAttribute('data-jword-comment-input', 'draft')

  applyErrorText(composerError)

  applyRowLayout(composerActions)
  composerActions.style.justifyContent = 'flex-end'

  applySecondaryButton(composerCancelButton, readCommentsText(i18n, 'cancel'), 'cancel-draft')
  applyPrimaryButton(composerConfirmButton, readCommentsText(i18n, 'confirm'), 'confirm-draft')

  composerActions.append(composerCancelButton, composerConfirmButton)
  composer.append(composerAnchor, composerInput, composerError, composerActions)

  applySectionLayout(threadList)
  threadList.className = 'jw-comments-sidebar__list'
  threadList.setAttribute('data-jword-comment-thread-list', 'true')
  threadList.style.flex = '0 0 auto'

  threadEmpty.className = 'jw-comments-sidebar__empty'
  threadEmpty.textContent = readCommentsText(i18n, 'empty')
  threadEmpty.style.margin = '0'
  threadEmpty.style.fontSize = '12px'
  threadEmpty.style.lineHeight = '1.5'
  threadEmpty.style.color = '#677489'

  threadList.append(threadEmpty)

  applySectionLayout(detail)
  detail.className = 'jw-comments-sidebar__detail'
  detail.style.marginTop = '10px'

  detailEmpty.className = 'jw-comments-sidebar__detail-empty'
  detailEmpty.textContent = readCommentsText(i18n, 'detailEmpty')
  detailEmpty.style.margin = '0'
  detailEmpty.style.fontSize = '12px'
  detailEmpty.style.lineHeight = '1.5'
  detailEmpty.style.color = '#677489'

  applyColumnLayout(detailHeader)
  detailHeader.className = 'jw-comments-sidebar__detail-header'
  detailHeader.style.marginBottom = '0'

  applyRowLayout(detailAuthorRow)
  detailAuthorRow.style.alignItems = 'center'
  detailAuthorRow.style.flexWrap = 'wrap'

  detailStatus.className = 'jw-comments-sidebar__detail-status'
  detailStatus.style.marginRight = '6px'
  detailStatus.style.fontSize = '12px'
  detailStatus.style.lineHeight = '1.4'

  detailAuthor.className = 'jw-comments-sidebar__detail-author'
  detailAuthor.style.marginRight = '6px'
  detailAuthor.style.fontSize = '13px'
  detailAuthor.style.fontWeight = '600'

  detailTime.className = 'jw-comments-sidebar__detail-time'
  detailTime.style.fontSize = '12px'
  detailTime.style.color = '#677489'

  detailAuthorRow.append(detailStatus, detailAuthor, detailTime)

  detailQuote.type = 'button'
  detailQuote.className = 'jw-comments-sidebar__detail-quote'
  detailQuote.style.margin = '6px 0 0'
  detailQuote.style.padding = '8px 10px'
  detailQuote.style.width = '100%'
  detailQuote.style.border = '1px solid #e2e8f0'
  detailQuote.style.borderRadius = '6px'
  detailQuote.style.background = '#f8fafc'
  detailQuote.style.textAlign = 'left'
  detailQuote.style.font = 'inherit'
  detailQuote.style.fontSize = '12px'
  detailQuote.style.lineHeight = '1.5'
  detailQuote.setAttribute('data-jword-comment-action', 'focus-anchor')

  detailHeader.append(detailAuthorRow, detailQuote)

  applyRowLayout(detailActions)
  detailActions.className = 'jw-comments-sidebar__detail-actions'
  detailActions.style.flexWrap = 'wrap'
  detailActions.style.marginTop = '8px'

  applySecondaryButton(detailReplyButton, readCommentsText(i18n, 'reply'), 'open-reply')
  applySecondaryButton(detailResolveButton, readCommentsText(i18n, 'resolve'), 'toggle-resolved')
  applySecondaryButton(detailDeleteButton, readCommentsText(i18n, 'deleteThread'), 'delete-thread')

  detailActions.append(detailReplyButton, detailResolveButton, detailDeleteButton)

  applySectionLayout(detailMessages)
  detailMessages.className = 'jw-comments-sidebar__messages'
  detailMessages.setAttribute('data-jword-comment-messages', 'true')

  applyComposerLayout(replyComposer)
  replyComposer.className = 'jw-comments-sidebar__reply'
  replyComposer.hidden = true

  applyTextarea(replyInput, readCommentsText(i18n, 'replyPlaceholder'))
  replyInput.setAttribute('data-jword-comment-input', 'reply')
  applyErrorText(replyError)
  applyRowLayout(replyActions)
  replyActions.style.justifyContent = 'flex-end'
  applySecondaryButton(replyCancelButton, readCommentsText(i18n, 'cancel'), 'cancel-reply')
  applyPrimaryButton(replyConfirmButton, readCommentsText(i18n, 'confirmReply'), 'confirm-reply')
  replyActions.append(replyCancelButton, replyConfirmButton)
  replyComposer.append(replyInput, replyError, replyActions)

  applyComposerLayout(editComposer)
  editComposer.className = 'jw-comments-sidebar__edit'
  editComposer.hidden = true

  applyTextarea(editInput, readCommentsText(i18n, 'editPlaceholder'))
  editInput.setAttribute('data-jword-comment-input', 'edit')
  applyErrorText(editError)
  applyRowLayout(editActions)
  editActions.style.justifyContent = 'flex-end'
  applySecondaryButton(editCancelButton, readCommentsText(i18n, 'cancel'), 'cancel-edit')
  applyPrimaryButton(editConfirmButton, readCommentsText(i18n, 'confirmEdit'), 'confirm-edit')
  editActions.append(editCancelButton, editConfirmButton)
  editComposer.append(editInput, editError, editActions)

  detail.append(
    detailEmpty,
    detailHeader,
    detailActions,
    detailMessages,
    replyComposer,
    editComposer
  )

  root.append(header, composer, threadList, detail)
  host.append(root)

  return {
    host,
    root,
    header,
    title,
    createButton,
    composer,
    composerAnchor,
    composerInput,
    composerError,
    composerConfirmButton,
    composerCancelButton,
    threadList,
    threadEmpty,
    detail,
    detailEmpty,
    detailHeader,
    detailStatus,
    detailAuthor,
    detailTime,
    detailQuote,
    detailActions,
    detailMessages,
    detailReplyButton,
    detailResolveButton,
    detailDeleteButton,
    replyComposer,
    replyInput,
    replyError,
    replyConfirmButton,
    replyCancelButton,
    editComposer,
    editInput,
    editError,
    editConfirmButton,
    editCancelButton
  }
}

/** 渲染 comments sidebar。 */
export function renderCommentsSidebar(
  dom: JWordCommentsSidebarDom,
  view: JWordCommentsViewState,
  i18n: ResolvedJWordUiI18n = resolveJWordUiI18n()
): void {
  dom.threadEmpty.hidden = view.threads.length > 0
  dom.composer.hidden = view.draft === null

  if (view.draft === null) {
    dom.composerAnchor.textContent = ''
    dom.composerInput.value = ''
    dom.composerError.hidden = true
    dom.composerError.textContent = ''
    dom.composerConfirmButton.disabled = true
  } else {
    dom.composerAnchor.textContent = readCommentsText(i18n, 'anchorPrefix')
      .replace('{quote}', view.draft.anchor.quote)
    dom.composerInput.value = view.draft.body
    dom.composerError.textContent = view.draft.error
    dom.composerError.hidden = view.draft.error.length === 0
    dom.composerConfirmButton.disabled = view.draft.body.trim().length === 0
  }

  renderCommentThreadList(dom.threadList, view.threads, view.selectedThread?.id ?? null, i18n)
  renderSelectedThread(dom, view, i18n)
}

/** 动态刷新 comments sidebar 静态文案。 */
export function localizeCommentsSidebarDom(dom: JWordCommentsSidebarDom, i18n: ResolvedJWordUiI18n): void {
  dom.title.textContent = readCommentsText(i18n, 'title')
  setButtonText(dom.createButton, readCommentsText(i18n, 'create'))
  dom.threadEmpty.textContent = readCommentsText(i18n, 'empty')
  dom.detailEmpty.textContent = readCommentsText(i18n, 'detailEmpty')
  dom.composerInput.placeholder = readCommentsText(i18n, 'composerPlaceholder')
  dom.replyInput.placeholder = readCommentsText(i18n, 'replyPlaceholder')
  dom.editInput.placeholder = readCommentsText(i18n, 'editPlaceholder')
  setButtonText(dom.composerCancelButton, readCommentsText(i18n, 'cancel'))
  setButtonText(dom.composerConfirmButton, readCommentsText(i18n, 'confirm'))
  setButtonText(dom.detailReplyButton, readCommentsText(i18n, 'reply'))
  setButtonText(dom.detailResolveButton, readCommentsText(i18n, 'resolve'))
  setButtonText(dom.detailDeleteButton, readCommentsText(i18n, 'deleteThread'))
  setButtonText(dom.replyCancelButton, readCommentsText(i18n, 'cancel'))
  setButtonText(dom.replyConfirmButton, readCommentsText(i18n, 'confirmReply'))
  setButtonText(dom.editCancelButton, readCommentsText(i18n, 'cancel'))
  setButtonText(dom.editConfirmButton, readCommentsText(i18n, 'confirmEdit'))
}

/** 销毁 comments sidebar。 */
export function destroyCommentsSidebar(dom: JWordCommentsSidebarDom): void {
  dom.root.remove()
}

/** 读取正文锚点应使用的 class 列表。 */
export function readCommentAnchorClassNames(state: JWordCommentAnchorState): readonly string[] {
  const classNames = ['jw-comment-anchor']

  if (state.selected) {
    classNames.push('jw-comment-anchor--selected')
  }

  if (state.highlighted) {
    classNames.push('jw-comment-anchor--highlighted')
  }

  if (state.resolved) {
    classNames.push('jw-comment-anchor--resolved')
  }

  return classNames
}

/** 把锚点高亮状态写入目标元素。 */
export function applyCommentAnchorState(
  target: HTMLElement,
  state: JWordCommentAnchorState
): void {
  target.classList.add('jw-comment-anchor')
  target.classList.toggle('jw-comment-anchor--selected', state.selected)
  target.classList.toggle('jw-comment-anchor--highlighted', state.highlighted)
  target.classList.toggle('jw-comment-anchor--resolved', state.resolved)
  target.setAttribute('data-jword-comment-thread-id', state.threadId)
  target.setAttribute('data-jword-comment-selected', String(state.selected))
  target.setAttribute('data-jword-comment-highlighted', String(state.highlighted))
  target.setAttribute('data-jword-comment-resolved', String(state.resolved))
}

/** 应用 sidebar 的根布局。 */
function applySidebarLayout(target: HTMLElement): void {
  target.style.display = 'flex'
  target.style.flexDirection = 'column'
  target.style.minHeight = '0'
  target.style.height = '100%'
  target.style.padding = '12px'
  target.style.background = 'transparent'
  target.style.overflow = 'auto'
}

/** 应用垂直 section 布局。 */
function applySectionLayout(target: HTMLElement): void {
  target.style.display = 'flex'
  target.style.flexDirection = 'column'
  target.style.minHeight = '0'
}

/** 应用行布局。 */
function applyRowLayout(target: HTMLElement): void {
  target.style.display = 'flex'
  target.style.flexDirection = 'row'
}

/** 应用列布局。 */
function applyColumnLayout(target: HTMLElement): void {
  target.style.display = 'flex'
  target.style.flexDirection = 'column'
}

/** 应用草稿面板布局。 */
function applyComposerLayout(target: HTMLElement): void {
  applyColumnLayout(target)
  target.style.padding = '10px'
  target.style.marginTop = '10px'
  target.style.border = '1px solid #e2e8f0'
  target.style.borderRadius = '6px'
  target.style.background = '#ffffff'
}

/** 应用文本域样式。 */
function applyTextarea(target: HTMLTextAreaElement, placeholder: string): void {
  target.placeholder = placeholder
  target.rows = 3
  target.style.width = '100%'
  target.style.minHeight = '68px'
  target.style.margin = '0'
  target.style.padding = '8px 10px'
  target.style.border = '1px solid #d8e1ea'
  target.style.borderRadius = '6px'
  target.style.resize = 'vertical'
  target.style.font = 'inherit'
  target.style.fontSize = '12px'
  target.style.lineHeight = '1.5'
  target.style.boxSizing = 'border-box'
}

/** 应用错误文案样式。 */
function applyErrorText(target: HTMLElement): void {
  target.style.margin = '8px 0 0'
  target.style.minHeight = '18px'
  target.style.fontSize = '12px'
  target.style.lineHeight = '1.4'
  target.style.color = '#b42318'
  target.hidden = true
}

/** 应用主按钮样式。 */
function applyPrimaryButton(
  target: HTMLButtonElement,
  text: string,
  action: string
): void {
  target.type = 'button'
  target.textContent = text
  target.className = 'jw-comments-sidebar__button jw-comments-sidebar__button--primary'
  target.style.marginLeft = '6px'
  target.style.minHeight = '28px'
  target.style.padding = '0 10px'
  target.style.border = '1px solid #2563eb'
  target.style.borderRadius = '6px'
  target.style.background = '#2563eb'
  target.style.color = '#ffffff'
  target.style.font = 'inherit'
  target.style.fontSize = '12px'
  target.style.lineHeight = '1'
  target.setAttribute('data-jword-comment-action', action)
}

/** 应用次按钮样式。 */
function applySecondaryButton(
  target: HTMLButtonElement,
  text: string,
  action: string
): void {
  target.type = 'button'
  target.textContent = text
  target.className = 'jw-comments-sidebar__button'
  target.style.marginRight = '6px'
  target.style.minHeight = '28px'
  target.style.padding = '0 10px'
  target.style.border = '1px solid #d8e1ea'
  target.style.borderRadius = '6px'
  target.style.background = '#ffffff'
  target.style.color = '#334155'
  target.style.font = 'inherit'
  target.style.fontSize = '12px'
  target.style.lineHeight = '1'
  target.setAttribute('data-jword-comment-action', action)
}

/** 渲染 thread 列表。 */
function renderCommentThreadList(
  host: HTMLElement,
  threads: readonly JWordCommentThreadView[],
  selectedThreadId: string | null,
  i18n: ResolvedJWordUiI18n
): void {
  const empty = host.querySelector<HTMLElement>('.jw-comments-sidebar__empty') ?? document.createElement('div')
  const children: HTMLElement[] = threads.length === 0 ? [empty] : []

  for (const thread of threads) {
    children.push(createThreadListItem(thread, selectedThreadId === thread.id, i18n))
  }

  host.replaceChildren(...children)
}

/** 创建单个 thread 列表项。 */
function createThreadListItem(
  thread: JWordCommentThreadView,
  selected: boolean,
  i18n: ResolvedJWordUiI18n
): HTMLElement {
  const item = document.createElement('article')
  const header = document.createElement('div')
  const user = createUserBadge(thread.author)
  const meta = document.createElement('div')
  const author = document.createElement('strong')
  const time = document.createElement('span')
  const status = document.createElement('span')
  const messages = document.createElement('div')
  const actions = document.createElement('div')
  const focusButton = createThreadActionButton(readCommentsText(i18n, 'focusAnchor'), 'focus-anchor', thread.id)
  const replyButton = createThreadActionButton(readCommentsText(i18n, 'reply'), 'open-reply', thread.id)
  const resolveButton = createThreadActionButton(
    thread.resolved
      ? readCommentsText(i18n, 'reopen')
      : readCommentsText(i18n, 'resolveShort'),
    'toggle-resolved',
    thread.id
  )
  const deleteButton = createThreadActionButton(readCommentsText(i18n, 'delete'), 'delete-thread', thread.id)

  item.className = 'jw-comments-thread'
  item.style.display = 'flex'
  item.style.flexDirection = 'column'
  item.style.padding = '10px'
  item.style.marginTop = '8px'
  item.style.border = selected ? '1px solid #bfdbfe' : '1px solid #e5e7eb'
  item.style.borderRadius = '6px'
  item.style.background = '#ffffff'
  item.style.boxShadow = selected ? '0 6px 16px rgb(15 23 42 / 8%)' : '0 1px 2px rgb(15 23 42 / 5%)'
  item.setAttribute('data-jword-comment-thread-id', thread.id)
  item.setAttribute('data-jword-comment-selected', String(selected))

  applyRowLayout(header)
  header.style.alignItems = 'center'

  meta.style.display = 'flex'
  meta.style.flexDirection = 'column'
  meta.style.marginLeft = '7px'

  author.textContent = thread.author.name
  author.style.fontSize = '13px'
  author.style.lineHeight = '1.35'
  time.textContent = thread.createdAtLabel
  time.style.fontSize = '12px'
  time.style.lineHeight = '1.35'
  time.style.color = '#677489'

  status.textContent = thread.resolved
    ? readCommentsText(i18n, 'statusResolved')
    : readCommentsText(i18n, 'statusOpen')
  status.style.marginLeft = 'auto'
  status.style.fontSize = '12px'
  status.style.color = thread.resolved ? '#0f766e' : '#2563eb'

  meta.append(author, time)
  header.append(user, meta, status)

  messages.className = 'jw-comments-thread__messages'
  messages.style.display = 'flex'
  messages.style.flexDirection = 'column'
  messages.style.marginTop = '8px'
  messages.append(...thread.messages.map((message, index) => createThreadMessageItem(message, index > 0, i18n)))

  applyRowLayout(actions)
  actions.className = 'jw-comments-thread__actions'
  actions.style.alignItems = 'center'
  actions.style.flexWrap = 'wrap'
  actions.style.marginTop = '8px'

  resolveButton.disabled = thread.resolved
    ? !thread.permissions.canReopen
    : !thread.permissions.canResolve
  deleteButton.hidden = !thread.permissions.canDelete
  replyButton.disabled = !thread.permissions.canReply

  actions.append(focusButton, replyButton, resolveButton, deleteButton)

  item.append(header, messages, actions)

  return item
}

/** 渲染当前选中 thread 的详情。 */
function renderSelectedThread(
  dom: JWordCommentsSidebarDom,
  view: JWordCommentsViewState,
  i18n: ResolvedJWordUiI18n
): void {
  const selectedThread = view.selectedThread

  dom.detailEmpty.hidden = selectedThread !== null
  dom.detailHeader.hidden = true
  dom.detailActions.hidden = true
  dom.detailMessages.hidden = true

  if (selectedThread === null) {
    dom.detailStatus.textContent = ''
    dom.detailAuthor.textContent = ''
    dom.detailTime.textContent = ''
    dom.detailQuote.textContent = ''
    dom.detailMessages.replaceChildren()
    dom.replyComposer.hidden = true
    dom.editComposer.hidden = true
    return
  }

  dom.detailReplyButton.disabled = !selectedThread.permissions.canReply
  setButtonText(dom.detailResolveButton, selectedThread.resolved
    ? readCommentsText(i18n, 'reopen')
    : readCommentsText(i18n, 'resolve'))
  dom.detailResolveButton.disabled = selectedThread.resolved
    ? !selectedThread.permissions.canReopen
    : !selectedThread.permissions.canResolve
  dom.detailDeleteButton.disabled = !selectedThread.permissions.canDelete
  dom.detailDeleteButton.hidden = !selectedThread.permissions.canDelete
  dom.detailStatus.textContent = selectedThread.resolved
    ? readCommentsText(i18n, 'statusResolved')
    : readCommentsText(i18n, 'statusOpen')
  dom.detailStatus.style.color = selectedThread.resolved ? '#0f766e' : '#2563eb'
  dom.detailAuthor.textContent = selectedThread.author.name
  dom.detailTime.textContent = selectedThread.createdAtLabel
  dom.detailQuote.textContent = selectedThread.anchor.quote
  dom.detailReplyButton.setAttribute('data-jword-comment-thread-id', selectedThread.id)
  dom.detailResolveButton.setAttribute('data-jword-comment-thread-id', selectedThread.id)
  dom.detailDeleteButton.setAttribute('data-jword-comment-thread-id', selectedThread.id)
  dom.detailMessages.replaceChildren()

  renderReplyComposer(dom, view, selectedThread)
  renderEditComposer(dom, view, selectedThread)
}

/** 渲染回复草稿。 */
function renderReplyComposer(
  dom: JWordCommentsSidebarDom,
  view: JWordCommentsViewState,
  thread: JWordCommentThreadView
): void {
  const replyDraft = view.replyDraft !== null && view.replyDraft.threadId === thread.id
    ? view.replyDraft
    : null

  dom.replyComposer.hidden = replyDraft === null

  if (replyDraft === null) {
    dom.replyInput.value = ''
    dom.replyError.textContent = ''
    dom.replyError.hidden = true
    dom.replyConfirmButton.disabled = true
    return
  }

  dom.replyInput.value = replyDraft.body
  dom.replyError.textContent = replyDraft.error
  dom.replyError.hidden = replyDraft.error.length === 0
  dom.replyConfirmButton.disabled = replyDraft.body.trim().length === 0
  dom.replyConfirmButton.setAttribute('data-jword-comment-thread-id', thread.id)
}

/** 渲染编辑草稿。 */
function renderEditComposer(
  dom: JWordCommentsSidebarDom,
  view: JWordCommentsViewState,
  thread: JWordCommentThreadView
): void {
  const editDraft = view.editDraft !== null && view.editDraft.threadId === thread.id
    ? view.editDraft
    : null

  dom.editComposer.hidden = editDraft === null

  if (editDraft === null) {
    dom.editInput.value = ''
    dom.editError.textContent = ''
    dom.editError.hidden = true
    dom.editConfirmButton.disabled = true
    dom.editConfirmButton.removeAttribute('data-jword-comment-message-id')
    return
  }

  dom.editInput.value = editDraft.body
  dom.editError.textContent = editDraft.error
  dom.editError.hidden = editDraft.error.length === 0
  dom.editConfirmButton.disabled = editDraft.body.trim().length === 0
  dom.editConfirmButton.setAttribute('data-jword-comment-thread-id', thread.id)
  dom.editConfirmButton.setAttribute('data-jword-comment-message-id', editDraft.messageId)
}

/** 创建单条消息节点。 */
function createMessageItem(message: JWordCommentReplyView, i18n: ResolvedJWordUiI18n): HTMLElement {
  const item = document.createElement('article')
  const header = document.createElement('div')
  const user = createUserBadge(message.author)
  const meta = document.createElement('div')
  const author = document.createElement('strong')
  const role = document.createElement('span')
  const time = document.createElement('span')
  const body = document.createElement('p')
  const actions = document.createElement('div')

  item.className = 'jw-comments-message'
  item.style.display = 'flex'
  item.style.flexDirection = 'column'
  item.style.padding = '9px 10px'
  item.style.marginTop = '6px'
  item.style.border = '0'
  item.style.borderRadius = '6px'
  item.style.background = '#f8fafc'
  item.setAttribute('data-jword-comment-message-id', message.id)

  applyRowLayout(header)
  header.style.alignItems = 'center'

  meta.style.display = 'flex'
  meta.style.flexDirection = 'column'
  meta.style.marginLeft = '7px'

  author.textContent = message.author.name
  author.style.fontSize = '13px'
  author.style.lineHeight = '1.35'
  role.textContent = message.root
    ? readCommentsText(i18n, 'roleComment')
    : readCommentsText(i18n, 'roleReply')
  role.style.fontSize = '12px'
  role.style.lineHeight = '1.35'
  role.style.color = '#677489'
  time.textContent = message.editedAt === undefined
    ? message.createdAtLabel
    : `${message.createdAtLabel} · ${readCommentsText(i18n, 'edited')}`
  time.style.fontSize = '12px'
  time.style.color = '#677489'
  meta.append(author, role)

  body.textContent = message.body
  body.style.margin = '7px 0 0'
  body.style.fontSize = '12px'
  body.style.lineHeight = '1.55'
  body.style.whiteSpace = 'pre-wrap'

  applyRowLayout(actions)
  actions.style.justifyContent = 'space-between'
  actions.style.alignItems = 'center'
  actions.style.marginTop = '7px'

  const left = document.createElement('div')
  const right = document.createElement('div')

  left.textContent = time.textContent
  left.style.fontSize = '12px'
  left.style.color = '#677489'
  right.style.display = 'flex'
  right.style.flexDirection = 'row'

  if (message.permissions.canEdit) {
    right.append(createMessageActionButton(readCommentsText(i18n, 'edit'), 'edit-message', message.id))
  }

  if (message.permissions.canDelete && !message.root) {
    right.append(createMessageActionButton(readCommentsText(i18n, 'delete'), 'delete-message', message.id))
  }

  header.append(user, meta)
  actions.append(left, right)
  item.append(header, body, actions)

  return item
}

/** 创建 thread 卡片中的紧凑消息。 */
function createThreadMessageItem(
  message: JWordCommentReplyView,
  nested: boolean,
  i18n: ResolvedJWordUiI18n
): HTMLElement {
  const item = document.createElement('div')
  const body = document.createElement('p')
  const footer = document.createElement('div')
  const time = document.createElement('span')
  const actions = document.createElement('div')

  item.className = nested ? 'jw-comments-thread__reply' : 'jw-comments-thread__root'
  item.style.display = 'flex'
  item.style.flexDirection = 'column'
  item.style.marginTop = nested ? '8px' : '0'
  item.style.paddingTop = nested ? '8px' : '0'
  item.style.borderTop = nested ? '1px solid #eef2f7' : '0'
  item.setAttribute('data-jword-comment-message-id', message.id)

  body.textContent = message.body
  body.style.margin = '0'
  body.style.fontSize = '13px'
  body.style.lineHeight = '1.55'
  body.style.color = '#1f2937'
  body.style.whiteSpace = 'pre-wrap'

  applyRowLayout(footer)
  footer.style.alignItems = 'center'
  footer.style.flexWrap = 'wrap'
  footer.style.marginTop = '6px'

  time.textContent = message.editedAt === undefined
    ? message.createdAtLabel
    : `${message.createdAtLabel} · ${readCommentsText(i18n, 'edited')}`
  time.style.marginRight = '8px'
  time.style.fontSize = '12px'
  time.style.color = '#6b7280'

  actions.style.display = 'flex'
  actions.style.flexDirection = 'row'
  actions.style.marginLeft = 'auto'

  if (message.permissions.canEdit) {
    actions.append(createMessageActionButton(readCommentsText(i18n, 'edit'), 'edit-message', message.id))
  }

  if (message.permissions.canDelete && !message.root) {
    actions.append(createMessageActionButton(readCommentsText(i18n, 'delete'), 'delete-message', message.id))
  }

  footer.append(time, actions)
  item.append(body, footer)

  return item
}

/** 创建 thread 卡片级动作按钮。 */
function createThreadActionButton(
  text: string,
  action: string,
  threadId: string
): HTMLButtonElement {
  const button = document.createElement('button')

  button.type = 'button'
  button.textContent = text
  button.style.marginRight = '8px'
  button.style.padding = '0'
  button.style.border = '0'
  button.style.background = 'transparent'
  button.style.color = '#2563eb'
  button.style.font = 'inherit'
  button.style.fontSize = '12px'
  button.setAttribute('data-jword-comment-action', action)
  button.setAttribute('data-jword-comment-thread-id', threadId)

  return button
}

/** 创建消息级动作按钮。 */
function createMessageActionButton(
  text: string,
  action: string,
  messageId: string
): HTMLButtonElement {
  const button = document.createElement('button')

  button.type = 'button'
  button.textContent = text
  button.style.marginLeft = '8px'
  button.style.padding = '0'
  button.style.border = '0'
  button.style.background = 'transparent'
  button.style.color = '#2563eb'
  button.style.font = 'inherit'
  button.style.fontSize = '12px'
  button.setAttribute('data-jword-comment-action', action)
  button.setAttribute('data-jword-comment-message-id', messageId)

  return button
}

/** 创建作者徽标。 */
function createUserBadge(user: JWordResolvedCommentUser): HTMLElement {
  const badge = document.createElement('span')

  badge.textContent = user.name.slice(0, 1).toUpperCase()
  badge.className = 'jw-comments-user-badge'
  badge.style.display = 'inline-flex'
  badge.style.alignItems = 'center'
  badge.style.justifyContent = 'center'
  badge.style.width = '22px'
  badge.style.height = '22px'
  badge.style.borderRadius = '999px'
  badge.style.background = user.color
  badge.style.color = '#ffffff'
  badge.style.fontSize = '12px'
  badge.style.fontWeight = '600'
  badge.title = user.name

  return badge
}

/** 更新按钮文案、title 与 aria-label。 */
function setButtonText(button: HTMLButtonElement, text: string): void {
  button.textContent = text
  button.title = text
  button.setAttribute('aria-label', text)
}

/** 读取批注模块内建文案。 */
function readCommentsText(i18n: ResolvedJWordUiI18n, key: string): string {
  return readJWordUiText(i18n, `menu.comments.${key}`)
}
