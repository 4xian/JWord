/**
 * 职责：封装 createJWordUi 的批注侧栏、默认页内 rail 和正文锚点 overlay 接线。
 * 边界：只管理 comments UI 与 core comment command 的桥接，不实现 comments controller DOM 细节。
 * 协作模块：ui-lifecycle 调用这里创建默认 rail、同步线程和滚动到批注锚点。
 * 性能/安全约束：几何同步仅在显式刷新、滚动或批注交互后触发，写入仍走 editor command pipeline。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import {
  buildDeleteCommentThreadCommand,
  buildEditCommentMessageCommand,
  buildReopenCommentThreadCommand,
  buildReplyCommentThreadCommand,
  buildResolveCommentThreadCommand,
  createSelectionState,
  twipsToCssPx,
  type Comment,
  type DocumentProjection,
  type Editor,
  type SelectionState
} from '@4xian/jword-core'

import type {
  CommentsControllerHandle,
  JWordCommentAnchorState,
  JWordCommentThread,
  JWordCommentUpdateThreadRequest,
  JWordCommentUser
} from './comments/types'
import { readTextRangePlainText } from './text-projection'
import { resolveTextRangeGeometry } from './ui-geometry'
import type { CreateJWordUiOptions, JWordCommentsOptions } from './types'

export interface ResolvedCommentsMount {
  readonly host: HTMLElement
  readonly options: JWordCommentsOptions
  readonly defaultRail: boolean
  cleanup(): void
}

export interface CommentsAnchorOverlay {
  sync(): void
  destroy(): void
}

/** 执行批注 thread 更新命令。 */
export function executeCommentUpdate(editor: Editor, request: JWordCommentUpdateThreadRequest): void {
  const projection = editor.getProjection()
  const command = (() => {
    switch (request.kind) {
      case 'reply':
        return buildReplyCommentThreadCommand(projection, request.request.threadId, {
          authorId: request.request.authorId,
          createdAt: request.request.createdAt,
          text: request.request.body
        })
      case 'edit':
        return buildEditCommentMessageCommand(projection, request.request.threadId, request.request.messageId, {
          editedAt: request.request.editedAt,
          text: request.request.body
        })
      case 'resolve':
        return buildResolveCommentThreadCommand(projection, request.threadId)
      case 'reopen':
        return buildReopenCommentThreadCommand(projection, request.threadId)
      case 'deleteMessage':
        throw new Error('core 当前只支持删除整条批注线程，暂不支持单独删除回复。')
    }
  })()

  if (command === null) {
    throw new Error('当前批注状态无法应用该操作。')
  }

  editor.executeCommand(command)
}

/** 同步 core projection 中的批注线程到 comments sidebar。 */
export function syncComments(handle: CommentsControllerHandle | null, editor: Editor): void {
  handle?.setThreads(readCommentThreads(editor))
}

/** 绑定默认批注 rail 的几何刷新。 */
export function bindDefaultCommentsGeometrySync(
  mount: ResolvedCommentsMount | null,
  handle: CommentsControllerHandle | null,
  editor: Editor,
  editorHost: HTMLElement | undefined,
  draftSelections: ReadonlyMap<string, SelectionState>
): () => void {
  if (mount === null || !mount.defaultRail || editorHost === undefined) {
    return () => {}
  }

  const canvasContainer = editorHost.querySelector<HTMLElement>('[data-jword-canvas-container]')

  if (canvasContainer === null) {
    return () => {}
  }

  const signalController = new AbortController()
  const sync = (): void => {
    syncDefaultCommentsRailGeometry(mount, handle, editor, editorHost, draftSelections)
  }

  canvasContainer.addEventListener('scroll', () => {
    requestAnimationFrame(sync)
  }, {
    signal: signalController.signal,
    passive: true
  })
  canvasContainer.addEventListener('click', (event) => {
    if (isDefaultCommentsRailEvent(event)) {
      scheduleDefaultRailEventSync(sync, handle)
    }
  }, {
    signal: signalController.signal
  })
  canvasContainer.addEventListener('input', (event) => {
    if (isDefaultCommentsRailEvent(event)) {
      scheduleDefaultRailEventSync(sync, handle)
    }
  }, {
    signal: signalController.signal
  })
  requestAnimationFrame(sync)

  return () => {
    signalController.abort()
  }
}

/** 在 comments controller 处理完点击后的 render 后同步默认 rail。 */
function scheduleDefaultRailEventSync(sync: () => void, handle: CommentsControllerHandle | null): void {
  queueMicrotask(() => {
    queueMicrotask(() => {
      requestAnimationFrame(() => {
        sync()
        handle?.focusDraft()
      })
    })
  })
}

/** 判断事件是否来自默认页内批注 rail。 */
function isDefaultCommentsRailEvent(event: Event): boolean {
  const target = event.target

  return target instanceof HTMLElement && target.closest('.jw-comments-page-rail') !== null
}

/** 下一帧刷新默认页内批注 rail，避开 controller 提交后的二次 render。 */
export function scheduleDefaultCommentsRailGeometrySync(
  mount: ResolvedCommentsMount | null,
  handle: CommentsControllerHandle | null,
  editor: Editor,
  editorHost: HTMLElement | undefined,
  draftSelections: ReadonlyMap<string, SelectionState>
): void {
  requestAnimationFrame(() => {
    syncDefaultCommentsRailGeometry(mount, handle, editor, editorHost, draftSelections)
    handle?.focusDraft()
  })
}

/** 把默认 rail 中的批注卡片按正文锚点纵向对齐。 */
export function syncDefaultCommentsRailGeometry(
  mount: ResolvedCommentsMount | null,
  handle: CommentsControllerHandle | null,
  editor: Editor,
  editorHost: HTMLElement | undefined,
  draftSelections: ReadonlyMap<string, SelectionState>
): void {
  if (mount === null || !mount.defaultRail || handle === null || editorHost === undefined) {
    return
  }

  const canvasContainer = editorHost.querySelector<HTMLElement>('[data-jword-canvas-container]')

  if (canvasContainer === null) {
    return
  }

  const list = handle.elements.threadList
  const pageRails = ensurePageCommentRails(canvasContainer)
  const threadItems = readDefaultCommentThreadItems(list, pageRails, readActiveCommentDraftThreadId(handle))
  const pageBottoms = new Map<number, number>()
  const keepInRoot = [
    handle.elements.header,
    handle.elements.detail
  ]

  handle.elements.root.append(...keepInRoot)
  mount.host.append(handle.elements.root)
  resetDefaultCommentsList(list)
  clearPageCommentRailThreads(pageRails)
  placeDraftComposer(handle, editor, canvasContainer, pageRails, pageBottoms, draftSelections)

  for (const item of threadItems) {
    const threadId = item.getAttribute('data-jword-comment-thread-id')

    if (threadId === null) {
      list.append(item)
      resetCommentRailItem(item)
      continue
    }

    const geometry = resolveCommentThreadGeometry(editor, canvasContainer, threadId)

    if (geometry === null) {
      list.append(item)
      resetCommentRailItem(item)
      continue
    }

    const rail = pageRails.get(geometry.pageIndex)

    if (rail === undefined) {
      list.append(item)
      resetCommentRailItem(item)
      continue
    }

    const top = Math.max(geometry.pageTop, pageBottoms.get(geometry.pageIndex) ?? 0)

    rail.append(item)
    placeThreadDraftComposers(handle, item, threadId)
    placeCommentRailItem(item, top)
    pageBottoms.set(geometry.pageIndex, top + item.offsetHeight + 12)
  }
}

/** 读取默认 rail/list 中当前可复用的批注卡片。 */
function readDefaultCommentThreadItems(
  list: HTMLElement,
  pageRails: ReadonlyMap<number, HTMLElement>,
  activeDraftThreadId: string | null
): readonly HTMLElement[] {
  const itemsByThreadId = new Map<string, HTMLElement>()

  for (const item of Array.from(list.querySelectorAll<HTMLElement>('.jw-comments-thread'))) {
    const threadId = item.getAttribute('data-jword-comment-thread-id')

    if (threadId !== null) {
      itemsByThreadId.set(threadId, item)
    }
  }

  for (const rail of pageRails.values()) {
    for (const item of Array.from(rail.querySelectorAll<HTMLElement>('.jw-comments-thread'))) {
      const threadId = item.getAttribute('data-jword-comment-thread-id')

      if (
        threadId !== null
        && (!itemsByThreadId.has(threadId) || threadId === activeDraftThreadId)
      ) {
        itemsByThreadId.set(threadId, item)
      }
    }
  }

  return Array.from(itemsByThreadId.values())
}

/** 读取当前正在页内卡片中承载草稿的 thread。 */
function readActiveCommentDraftThreadId(handle: CommentsControllerHandle): string | null {
  if (!handle.elements.replyComposer.hidden) {
    return handle.elements.replyConfirmButton.getAttribute('data-jword-comment-thread-id')
  }

  if (!handle.elements.editComposer.hidden) {
    return handle.elements.editConfirmButton.getAttribute('data-jword-comment-thread-id')
  }

  return null
}

/** 把当前 thread 的回复/编辑草稿移动到页内批注卡片中。 */
function placeThreadDraftComposers(
  handle: CommentsControllerHandle,
  item: HTMLElement,
  threadId: string
): void {
  const replyThreadId = handle.elements.replyConfirmButton.getAttribute('data-jword-comment-thread-id')
  const editThreadId = handle.elements.editConfirmButton.getAttribute('data-jword-comment-thread-id')

  if (!handle.elements.replyComposer.hidden && replyThreadId === threadId) {
    item.append(handle.elements.replyComposer)
  }

  if (!handle.elements.editComposer.hidden && editThreadId === threadId) {
    item.append(handle.elements.editComposer)
  }
}

/** 确保每一页都有批注页内容器。 */
function ensurePageCommentRails(canvasContainer: HTMLElement): Map<number, HTMLElement> {
  const pageRails = new Map<number, HTMLElement>()
  const livePageIndexes = new Set<number>()

  for (const pageElement of Array.from(canvasContainer.querySelectorAll<HTMLElement>('[data-jword-page]'))) {
    const pageIndex = Number(pageElement.getAttribute('data-jword-page'))

    if (!Number.isInteger(pageIndex)) {
      continue
    }

    const rail = pageElement.querySelector<HTMLElement>(':scope > .jw-comments-page-rail')
      ?? pageElement.ownerDocument.createElement('div')
    const pageWidth = pageElement.getBoundingClientRect().width

    rail.className = 'jw-comments-page-rail'
    rail.setAttribute('data-jword-comments-page-rail', String(pageIndex))
    rail.style.height = pageElement.style.height
    rail.style.left = `${Math.max(0, pageWidth + 16)}px`
    bindPageCommentRailEvents(rail)
    if (rail.parentElement !== pageElement) {
      pageElement.append(rail)
    }
    pageRails.set(pageIndex, rail)
    livePageIndexes.add(pageIndex)
  }

  for (const rail of Array.from(canvasContainer.querySelectorAll<HTMLElement>('.jw-comments-page-rail'))) {
    const pageIndex = Number(rail.getAttribute('data-jword-comments-page-rail'))

    if (!livePageIndexes.has(pageIndex)) {
      rail.remove()
    }
  }

  return pageRails
}

/** 清理页内 rail 上一次同步留下的 thread 卡片。 */
function clearPageCommentRailThreads(pageRails: ReadonlyMap<number, HTMLElement>): void {
  for (const rail of pageRails.values()) {
    rail
      .querySelectorAll<HTMLElement>('.jw-comments-thread')
      .forEach((item) => item.remove())
  }
}

/** 阻止页内批注控件的指针事件落到编辑器正文。 */
function bindPageCommentRailEvents(rail: HTMLElement): void {
  if (rail.getAttribute('data-jword-comments-page-rail-bound') === 'true') {
    return
  }

  rail.setAttribute('data-jword-comments-page-rail-bound', 'true')
  rail.addEventListener('pointerdown', (event) => {
    event.stopPropagation()
  })
  rail.addEventListener('mousedown', (event) => {
    event.stopPropagation()
  })
  rail.addEventListener('mouseup', (event) => {
    event.stopPropagation()
  })
  rail.addEventListener('mousemove', (event) => {
    event.stopPropagation()
  })
  rail.addEventListener('dblclick', (event) => {
    event.stopPropagation()
  })
}

/** 把草稿编辑器放到当前草稿选区所在页。 */
function placeDraftComposer(
  handle: CommentsControllerHandle,
  editor: Editor,
  canvasContainer: HTMLElement,
  pageRails: ReadonlyMap<number, HTMLElement>,
  pageBottoms: Map<number, number>,
  draftSelections: ReadonlyMap<string, SelectionState>
): void {
  const threadId = handle.elements.composer.getAttribute('data-jword-comment-thread-id')
  const selection = threadId === null ? null : draftSelections.get(threadId) ?? null
  const geometry = selection === null
    ? null
    : resolveSelectionGeometry(editor, canvasContainer, selection)

  if (handle.elements.composer.hidden || geometry === null) {
    handle.elements.root.insertBefore(handle.elements.composer, handle.elements.threadList)
    resetCommentRailItem(handle.elements.composer)
    return
  }

  const rail = pageRails.get(geometry.pageIndex)

  if (rail === undefined) {
    handle.elements.root.insertBefore(handle.elements.composer, handle.elements.threadList)
    resetCommentRailItem(handle.elements.composer)
    return
  }

  const top = Math.max(geometry.pageTop, pageBottoms.get(geometry.pageIndex) ?? 0)

  rail.append(handle.elements.composer)
  placeCommentRailItem(handle.elements.composer, top)
  pageBottoms.set(geometry.pageIndex, top + handle.elements.composer.offsetHeight + 12)
}

/** 清理默认列表自身的几何样式。 */
function resetDefaultCommentsList(list: HTMLElement): void {
  list.style.position = ''
  list.style.top = ''
  list.style.left = ''
  list.style.right = ''
  list.style.minHeight = ''
}

/** 把批注卡片定位到页内 rail。 */
function placeCommentRailItem(item: HTMLElement, top: number): void {
  item.style.position = 'absolute'
  item.style.top = `${top}px`
  item.style.left = '12px'
  item.style.right = '12px'
  item.style.marginTop = '0'
}

/** 清理批注卡片页内定位样式。 */
function resetCommentRailItem(item: HTMLElement): void {
  item.style.position = ''
  item.style.top = ''
  item.style.left = ''
  item.style.right = ''
  item.style.marginTop = '8px'
}

/** 滚动到批注锚点，不改写正文选区。 */
export function scrollCommentThreadIntoView(
  editor: Editor,
  editorHost: HTMLElement | undefined,
  threadId: string
): void {
  if (editorHost === undefined) {
    return
  }

  const canvasContainer = editorHost.querySelector<HTMLElement>('[data-jword-canvas-container]')

  if (canvasContainer === null) {
    return
  }

  const geometry = resolveCommentThreadGeometry(editor, canvasContainer, threadId)

  if (geometry === null) {
    throw new Error('当前批注锚点已失效。')
  }

  const top = Math.max(0, geometry.scrollTop - Math.round(canvasContainer.clientHeight * 0.32))

  if (typeof canvasContainer.scrollTo === 'function') {
    canvasContainer.scrollTo({
      top,
      behavior: 'smooth'
    })
    return
  }

  canvasContainer.scrollTop = top
}

/** 解析批注锚点对应的滚动内容几何。 */
function resolveCommentThreadGeometry(
  editor: Editor,
  canvasContainer: HTMLElement,
  threadId: string
): Readonly<{ pageIndex: number, pageTop: number, scrollTop: number }> | null {
  const range = editor.locateCommentThread(threadId)

  if (range === null) {
    return null
  }

  return resolveTextRangeGeometry(editor, canvasContainer, range)
}

/** 解析选区对应的滚动内容几何。 */
function resolveSelectionGeometry(
  editor: Editor,
  canvasContainer: HTMLElement,
  selection: SelectionState
): Readonly<{ pageIndex: number, pageTop: number, scrollTop: number }> | null {
  return resolveTextRangeGeometry(editor, canvasContainer, selection.range)
}

/** 把 UI 临时选区重建为可持久化 text anchor 选区。 */
export function createPersistentSelection(editor: Editor, selection: SelectionState | null): SelectionState | null {
  if (selection === null) {
    return null
  }

  const anchor = editor.resolveTextPosition(selection.anchor)
  const focus = editor.resolveTextPosition(selection.focus)

  return createSelectionState(
    editor.createTextAnchor(anchor),
    editor.createTextAnchor(focus),
    {
      affinity: selection.affinity,
      direction: selection.direction
    }
  )
}

/** 从 core projection 读取 comments UI 线程。 */
export function readCommentThreads(editor: Editor): readonly JWordCommentThread[] {
  const projection = editor.getProjection()

  return (projection.document.comments ?? []).map((thread) => mapCoreCommentThread(editor, projection, thread))
}

/** 把 core comment thread 映射为 comments UI thread。 */
function mapCoreCommentThread(
  editor: Editor,
  projection: DocumentProjection,
  thread: Comment
): JWordCommentThread {
  const locatedRange = editor.locateRangeSnapshot(thread.rangeSnapshot)
  const quote = locatedRange === null
    ? '锚点已失效'
    : readTextRangePlainText(projection, locatedRange) || '选中文本'

  return {
    id: thread.id,
    authorId: thread.authorId,
    createdAt: thread.createdAt,
    resolved: thread.resolved,
    anchor: createCommentAnchorState(thread.id, quote, false, thread.resolved),
    messages: thread.messages.map((message) => ({
      id: message.id,
      authorId: message.authorId,
      body: message.text,
      createdAt: message.createdAt,
      ...(message.editedAt === undefined ? {} : { editedAt: message.editedAt })
    }))
  }
}

/** 创建 comments UI 的锚点状态。 */
export function createCommentAnchorState(
  threadId: string,
  quote: string,
  selected: boolean,
  resolved: boolean
): JWordCommentAnchorState {
  return {
    threadId,
    quote,
    selected,
    highlighted: !resolved,
    resolved
  }
}

/** 解析 UI 当前用户；未显式传入时回退到 core editor 用户。 */
export function resolveCurrentUiUser(options: CreateJWordUiOptions): JWordCommentUser {
  const editorUser = options.editor.getCurrentUser()
  const optionUser = options.user?.currentUser
  const optionId = optionUser?.id.trim() ?? ''
  const id = optionId.length > 0 ? optionId : editorUser.authorId
  const name = optionUser?.name?.trim() ?? editorUser.name
  const color = optionUser?.color?.trim() ?? editorUser.color

  return {
    id,
    ...(name === undefined || name.length === 0 ? {} : { name }),
    ...(color === undefined || color.length === 0 ? {} : { color })
  }
}

/** 解析 comments 装配输入，必要时创建 SDK 默认右侧 rail。 */
export function resolveCommentsMount(
  options: CreateJWordUiOptions['comments'],
  editorHost: HTMLElement | undefined
): ResolvedCommentsMount | null {
  if (options === undefined) {
    return null
  }

  if (options === true) {
    return createDefaultCommentsMount({}, editorHost)
  }

  if (options.host !== undefined) {
    return {
      host: options.host,
      options,
      defaultRail: false,
      cleanup(): void {}
    }
  }

  return createDefaultCommentsMount(options, editorHost)
}

/** 创建 comments 默认控制宿主，实际卡片会移动到每页的批注容器内。 */
function createDefaultCommentsMount(
  options: JWordCommentsOptions,
  editorHost: HTMLElement | undefined
): ResolvedCommentsMount {
  if (editorHost === undefined) {
    throw new Error('comments 默认 rail 需要传入 editorHost。')
  }

  const canvasContainer = editorHost.querySelector<HTMLElement>('[data-jword-canvas-container]')

  if (canvasContainer === null) {
    throw new Error('comments 默认 rail 需要已挂载的 canvas container。')
  }

  canvasContainer.setAttribute('data-jword-comments-default-host', 'true')

  return {
    host: canvasContainer,
    options,
    defaultRail: true,
    cleanup(): void {
      canvasContainer.removeAttribute('data-jword-comments-default-host')
      editorHost
        .querySelectorAll<HTMLElement>('.jw-comments-page-rail')
        .forEach((rail) => rail.remove())
    }
  }
}

/** 创建正文批注锚点 overlay。 */
export function createCommentsAnchorOverlay(editor: Editor, editorHost: HTMLElement): CommentsAnchorOverlay | null {
  const canvasContainer = editorHost.querySelector<HTMLElement>('[data-jword-canvas-container]')

  if (canvasContainer === null) {
    return null
  }

  const overlay = document.createElement('div')

  overlay.className = 'jw-comments-anchor-overlay'
  overlay.setAttribute('data-jword-comments-anchor-overlay', 'true')
  canvasContainer.style.position = canvasContainer.style.position || 'relative'
  canvasContainer.append(overlay)

  return {
    sync(): void {
      renderCommentsAnchorOverlay(editor, canvasContainer, overlay)
    },
    destroy(): void {
      overlay.remove()
    }
  }
}

/** 渲染正文批注锚点 overlay。 */
function renderCommentsAnchorOverlay(
  editor: Editor,
  canvasContainer: HTMLElement,
  overlay: HTMLElement
): void {
  const projection = editor.getProjection()
  const comments = projection.document.comments ?? []

  if (comments.length === 0) {
    overlay.replaceChildren()
    return
  }

  const layout = editor.getLayout()
  const scale = editor.getPageConfig().scale
  const children: HTMLElement[] = []

  for (const thread of comments) {
    const range = editor.locateCommentThread(thread.id)

    if (range === null) {
      continue
    }

    const rects = editor.getSelectionRects(range)
    const markerIndex = Math.max(0, rects.length - 1)

    for (const [index, rect] of rects.entries()) {
      const page = layout.pages[rect.pageIndex]
      const pageElement = page === undefined
        ? null
        : canvasContainer.querySelector<HTMLElement>(`[data-jword-page="${page.pageIndex}"]`)

      if (page === undefined || pageElement === null) {
        continue
      }

      children.push(createCommentAnchorOverlayRect(thread, pageElement, page, rect, scale, index === markerIndex))
    }
  }

  overlay.style.width = `${canvasContainer.scrollWidth}px`
  overlay.style.height = `${canvasContainer.scrollHeight}px`
  overlay.replaceChildren(...children)
}

/** 创建单个批注锚点矩形。 */
function createCommentAnchorOverlayRect(
  thread: Comment,
  pageElement: HTMLElement,
  page: NonNullable<ReturnType<Editor['getLayout']>['pages'][number]>,
  rect: ReturnType<Editor['getSelectionRects']>[number],
  scale: number,
  withMarker: boolean
): HTMLElement {
  const target = document.createElement('div')

  target.className = 'jw-comments-anchor-overlay__rect'
  target.style.left = `${pageElement.offsetLeft + twipsToCssPx(rect.x - page.x, scale)}px`
  target.style.top = `${pageElement.offsetTop + twipsToCssPx(rect.y - page.y, scale)}px`
  target.style.width = `${twipsToCssPx(rect.width, scale)}px`
  target.style.height = `${twipsToCssPx(rect.height, scale)}px`
  target.setAttribute('data-jword-comment-thread-id', thread.id)

  if (withMarker) {
    const marker = document.createElement('span')

    marker.className = 'jw-comments-anchor-overlay__marker'
    marker.textContent = '注'
    target.append(marker)
  }

  return target
}
