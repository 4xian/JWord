/**
 * 职责：提供 @4xian/jword-ui 的单入口装配函数。
 * 边界：只组装 toolbar controller、media panel 与 assistive 子模块，不实现 demo 场景逻辑。
 * 协作模块：index 公开此入口，宿主把 editor/toolbarHost/assistive host 传给这里。
 * 性能/安全约束：入口保持轻量，无顶层 DOM 副作用，重复调用由宿主自行管理生命周期。
 * Specs：docs/superpowers/plans/2026-05-17-jword-ui-sdk-gate4-integration.md#5-4xianjword-ui-的目标公开面。
 */
import {
  buildHeadingOutline,
  buildAddCommentThreadCommand,
  buildDeleteCommentThreadCommand,
  buildDeleteLinkCommand,
  buildEditCommentMessageCommand,
  buildEditLinkCommand,
  buildInsertLinkCommand,
  buildReopenCommentThreadCommand,
  buildReplyCommentThreadCommand,
  buildResolveCommentThreadCommand,
  createSelectionState,
  isSelectionCollapsed,
  twipsToCssPx,
  type Block,
  type Comment,
  type DocumentProjection,
  type Editor,
  type Paragraph,
  type RangeRef,
  type Run,
  type SelectionState,
  type TextRange
} from '@4xian/jword-core'
import { createLiveRegion } from './assistive/live-region'
import { createTextMirror } from './assistive/text-mirror'
import { createCommentsController } from './comments/controller'
import type {
  CommentsControllerHandle,
  JWordCommentAnchorState,
  JWordCommentThread,
  JWordCommentUpdateThreadRequest,
  JWordCommentUser
} from './comments/types'
import { createFindReplaceController } from './find-replace/controller'
import { createHeaderFooterController } from './header-footer/controller'
import { createHeadingOutlineController } from './heading/controller'
import { createLinkController } from './link/controller'
import type { JWordLinkDraft, LinkControllerHandle } from './link/types'
import { createMediaController } from './media/controller'
import { createImageSelectionController } from './media/image-selection-controller'
import { createPasteController } from './paste/controller'
import { createJWordInteractionGuard } from './readonly/interaction-guard'
import type { JWordInteractionGuard } from './readonly/interaction-guard'
import { createRevisionController } from './revisions/controller'
import { createSelectionActionsController } from './selection-actions/controller'
import { createTableController } from './table/controller'
import { createToolbarController } from './toolbar/controller'
import type {
  CreateJWordUiOptions,
  JWordCommentsOptions,
  JWordReadonlyOptions,
  JWordToolbarControlElement,
  JWordToolbarToolId,
  JWordUiInstance
} from './types'

interface ResolvedCommentsMount {
  readonly host: HTMLElement
  readonly options: JWordCommentsOptions
  readonly defaultRail: boolean
  cleanup(): void
}

interface CommentsAnchorOverlay {
  sync(): void
  destroy(): void
}

interface ResolvedHeadingOutlineMount {
  readonly host: HTMLElement
  cleanup(): void
}

interface LinkAnchorOverlay {
  sync(): void
  destroy(): void
}

interface LinkRunTarget {
  readonly selection: SelectionState
  readonly draft: JWordLinkDraft
}

/** 创建并挂载最小 JWord 官方 UI。 */
export function createJWordUi(options: CreateJWordUiOptions): JWordUiInstance {
  const liveRegion = createLiveRegion({
    host: options.liveRegionHost ?? null
  })
  const textMirror = options.assistiveMirrorHost === undefined || options.assistiveMirrorHost === null
    ? null
    : createTextMirror({
      host: options.assistiveMirrorHost,
      readText: () => readProjectionPlainText(options.editor.getProjection()),
      shouldDeferSync: () => options.editor.getLayout().pages.length > 4
    })
  const currentUser = resolveCurrentUiUser(options)
  const commentsMount = resolveCommentsMount(options.comments, options.editorHost)
  const commentsOverlay = commentsMount === null || options.editorHost === undefined
    ? null
    : createCommentsAnchorOverlay(options.editor, options.editorHost)
  const pendingCommentSelections = new Map<string, SelectionState>()
  let commentsHandle: CommentsControllerHandle | null = null
  let linkHandle: LinkControllerHandle | null = null
  let headerFooterHandle: {
    toggleHeaderFooterMenu(anchor?: HTMLElement): void
    toggleFooterMenu(anchor?: HTMLElement): void
    togglePageNumberMenu(anchor?: HTMLElement): void
  } | null = null
  let headingOutlineHandle: { isVisible(): boolean, toggleVisible(): void } | null = null
  let findReplaceHandle: { toggleVisible(): void } | null = null
  let revisionsHandle: { toggleVisible(): void } | null = null
  let headingOutlineVisible = false
  let pendingLinkSelection: SelectionState | null = null
  let unsubscribeCommentsGeometry = (): void => {}
  const readonlyOptions = normalizeReadonlyOptions(options.readonly)
  const toolbarEntryAvailable = options.toolbar !== false
  const readonlyEditingBlocked = readonlyOptions.enabled === true
  const readonlyNavigationAllowed = readonlyOptions.allowNavigation !== false

  /** 从当前选区打开批注草稿。 */
  function openCommentFromSelection(selection: SelectionState | null = options.editor.getSelection()): void {
    if (readonlyOptions.enabled === true) {
      liveRegion.announce('BLOCKED: 当前为只读模式。', { force: true })
      return
    }

    if (commentsHandle === null) {
      liveRegion.announce('BLOCKED: 当前宿主未启用批注侧栏。', { force: true })
      return
    }

    if (selection === null || isSelectionCollapsed(selection)) {
      liveRegion.announce('BLOCKED: 批注需要先选中一段正文。', { force: true })
      return
    }

    const threadId = createDraftId('comment-draft')
    const anchor = createCommentAnchorState(
      threadId,
      readSelectionText(options.editor, selection) || '选中文本',
      true,
      false
    )

    pendingCommentSelections.set(threadId, selection)
    commentsHandle.openCreateDraft(anchor)
    commentsHandle.elements.composer.setAttribute('data-jword-comment-thread-id', threadId)
    syncDefaultCommentsRailGeometry(commentsMount, commentsHandle, options.editor, options.editorHost, pendingCommentSelections)
  }

  /** 从当前选区打开链接弹窗。 */
  function openLinkFromSelection(selection: SelectionState | null = options.editor.getSelection()): void {
    if (readonlyOptions.enabled === true) {
      liveRegion.announce('BLOCKED: 当前为只读模式。', { force: true })
      return
    }

    if (linkHandle === null) {
      liveRegion.announce('BLOCKED: 当前宿主未启用链接弹窗。', { force: true })
      return
    }

    if (readActiveLinkDraftFromSelection(options.editor, selection) !== null) {
      liveRegion.announce('BLOCKED: 当前内容已有链接，请使用打开、编辑或删除链接。', { force: true })
      return
    }

    pendingLinkSelection = selection
    linkHandle.openInsertDialog(selection === null || isSelectionCollapsed(selection)
      ? ''
      : readSelectionText(options.editor, selection))
  }

  /** 打开当前链接选区命中的 URL。 */
  function openActiveLinkFromSelection(selection: SelectionState | null): void {
    const draft = readActiveLinkDraftFromSelection(options.editor, selection)

    if (draft === null) {
      liveRegion.announce('BLOCKED: 当前选区未命中可打开的链接。', { force: true })
      return
    }

    options.link?.openLink?.(draft.url)
  }

  /** 用当前链接选区打开编辑弹窗。 */
  function editLinkFromSelection(selection: SelectionState | null): void {
    if (readonlyOptions.enabled === true) {
      liveRegion.announce('BLOCKED: 当前为只读模式。', { force: true })
      return
    }

    if (linkHandle === null) {
      liveRegion.announce('BLOCKED: 当前宿主未启用链接弹窗。', { force: true })
      return
    }

    const draft = readActiveLinkDraftFromSelection(options.editor, selection)

    if (draft === null) {
      liveRegion.announce('BLOCKED: 当前选区未命中可编辑的链接。', { force: true })
      return
    }

    pendingLinkSelection = selection
    linkHandle.setActiveLink(draft)
    linkHandle.openEditDialog()
  }

  /** 删除当前链接选区命中的链接。 */
  function removeLinkFromSelection(selection: SelectionState | null): void {
    if (readonlyOptions.enabled === true) {
      liveRegion.announce('BLOCKED: 当前为只读模式。', { force: true })
      return
    }

    const command = buildDeleteLinkCommand(options.editor.getProjection(), selection)

    if (command === null) {
      liveRegion.announce('BLOCKED: 当前选区未命中可移除的链接。', { force: true })
      return
    }

    options.editor.executeCommand(command, {
      selectionAfter: selection
    })
    pendingLinkSelection = null
    syncActiveLink(linkHandle, options.editor)
  }

  const toolbar = createToolbarController({
    ...options,
    assistive: {
      liveRegion,
      textMirror
    },
    insertActions: {
      openComment: openCommentFromSelection,
      openLink: openLinkFromSelection
    },
    panelActions: {
      toggleFindReplace(): void {
        findReplaceHandle?.toggleVisible()
      },
      toggleHeadingOutline(): void {
        headingOutlineHandle?.toggleVisible()
        headingOutlineVisible = headingOutlineHandle === null ? false : !headingOutlineVisible
      },
      toggleHeaderFooter(anchor): void {
        headerFooterHandle?.toggleHeaderFooterMenu(anchor)
      },
      toggleFooter(anchor): void {
        headerFooterHandle?.toggleFooterMenu(anchor)
      },
      togglePageNumber(anchor): void {
        headerFooterHandle?.togglePageNumberMenu(anchor)
      },
      toggleRevisions(): void {
        revisionsHandle?.toggleVisible()
      }
    },
    panelState: {
      headingOutline(): boolean {
        return headingOutlineHandle?.isVisible() ?? headingOutlineVisible
      },
      headingOutlineAvailable(): boolean {
        return options.headingOutline !== undefined && buildHeadingOutline(options.editor).length > 0
      }
    }
  })
  const mountedEditorHost = options.editorHost
  const interactionGuard = createJWordInteractionGuard({
    editorHost: mountedEditorHost ?? options.toolbarHost,
    toolbarHost: options.toolbarHost,
    controls: toolbar.elements.controls,
    readonly: readonlyOptions,
    assistive: {
      liveRegion
    }
  })
  const media = options.media === undefined || toolbar.mediaHost === null
    ? null
    : createMediaController({
      editor: options.editor,
      host: toolbar.mediaHost,
      media: options.media,
      readonly: options.readonly,
      assistive: {
        liveRegion
      }
    })
  const table = options.table === undefined || toolbar.tableHost === null
    ? null
    : createTableController({
      editor: options.editor,
      toolbarHost: toolbar.tableHost,
      editorHost: options.editorHost ?? options.toolbarHost,
      table: options.table,
      readonly: options.readonly,
      assistive: {
        liveRegion
      }
    })
  const link = options.link === undefined
    ? null
    : createLinkController({
      host: options.link.host ?? options.editorHost ?? toolbar.linkHost ?? options.toolbarHost,
      viewportHost: options.editorHost,
      readonly: options.readonly,
      policy: options.link.policy,
      adapter: {
        openLink(linkDraft): Promise<void> | void {
          return options.link?.openLink?.(linkDraft.url)
        },
        submitLink(request): void {
          const selection = pendingLinkSelection ?? options.editor.getSelection()
          const command = request.mode === 'edit'
            ? buildEditLinkCommand(options.editor.getProjection(), selection, {
              target: request.draft.url,
              tooltip: request.draft.tooltip
            })
            : buildInsertLinkCommand(options.editor.getProjection(), selection, {
              target: request.draft.url,
              tooltip: request.draft.tooltip,
              displayText: request.draft.visibleText
            })

          if (command === null) {
            throw new Error('当前选区无法应用链接。')
          }

          options.editor.executeCommand(command, {
            selectionAfter: selection
          })
          pendingLinkSelection = null
          syncActiveLink(linkHandle, options.editor)
        },
        removeLink(): void {
          const selection = options.editor.getSelection()
          const command = buildDeleteLinkCommand(options.editor.getProjection(), selection)

          if (command === null) {
            throw new Error('当前选区未命中可移除的链接。')
          }

          options.editor.executeCommand(command, {
            selectionAfter: selection
          })
          syncActiveLink(linkHandle, options.editor)
        }
      }
  })
  linkHandle = link
  const editorHost = options.editorHost
  const shouldCreateHeadingOutline = options.headingOutline !== undefined
    && toolbarEntryAvailable
    && (!readonlyEditingBlocked || readonlyNavigationAllowed)
  const shouldCreateFindReplace = options.findReplace !== undefined
    && toolbarEntryAvailable
    && (!readonlyEditingBlocked || readonlyNavigationAllowed)
  const shouldCreateHeaderFooter = options.headerFooter !== undefined
    && toolbarEntryAvailable
    && !readonlyEditingBlocked
  const shouldCreateRevisions = options.revisions !== undefined
    && toolbarEntryAvailable
    && !readonlyEditingBlocked
  const headingOutlineMount = shouldCreateHeadingOutline
    ? resolveHeadingOutlineMount(options.headingOutline, editorHost, options.toolbarHost)
    : null
  const linkOverlay = link === null || editorHost === undefined
    ? null
    : createLinkAnchorOverlay(options.editor, editorHost, (target) => {
      pendingLinkSelection = target.selection
      options.editor.focus()
      options.editor.setSelection(target.selection)
      link.toggleQuickTools(target.draft)
    })
  const headerFooter = !shouldCreateHeaderFooter || options.headerFooter === undefined
    ? null
    : createHeaderFooterController({
      editor: options.editor,
      host: toolbar.panelHost ?? options.headerFooter.host,
      readonly: options.readonly,
      announce(message): void {
        liveRegion.announce(message)
      }
    })
  headerFooterHandle = headerFooter === null
    ? null
    : {
        toggleHeaderFooterMenu(anchor?: HTMLElement): void {
          headerFooter.toggleHeaderFooterMenu(anchor)
        },
        toggleFooterMenu(anchor?: HTMLElement): void {
          headerFooter.toggleFooterMenu(anchor)
        },
        togglePageNumberMenu(anchor?: HTMLElement): void {
          headerFooter.togglePageNumberMenu(anchor)
        }
      }
  const headingOutline = headingOutlineMount === null
    ? null
    : createHeadingOutlineController({
      editor: options.editor,
      host: headingOutlineMount.host,
      scrollToRange(range): void {
        scrollTextRangeIntoView(options.editor, options.editorHost, range)
      }
    })
  headingOutlineHandle = headingOutline === null
    ? null
    : {
        isVisible(): boolean {
          return headingOutline.isVisible()
        },
        toggleVisible(): void {
          headingOutline.toggleVisible()
          headingOutlineVisible = headingOutline.isVisible()
        }
      }
  const findReplace = !shouldCreateFindReplace || options.findReplace === undefined
    ? null
    : createFindReplaceController({
      editor: options.editor,
      host: toolbar.panelHost ?? options.findReplace.host,
      readonly: options.readonly,
      ...(options.editorHost === undefined ? {} : { editorHost: options.editorHost }),
      scrollToRange(range): void {
        scrollTextRangeIntoView(options.editor, options.editorHost, range)
      },
      announce(message): void {
        liveRegion.announce(message)
      }
    })
  findReplaceHandle = findReplace === null
    ? null
    : {
        toggleVisible(): void {
          findReplace.toggleVisible()
        }
      }
  const revisions = !shouldCreateRevisions || options.revisions === undefined
    ? null
    : createRevisionController({
      editor: options.editor,
      host: toolbar.panelHost ?? options.revisions.host,
      announce(message): void {
        liveRegion.announce(message)
      }
    })
  revisionsHandle = revisions === null
    ? null
    : {
        toggleVisible(): void {
          revisions.elements.root.hidden = !revisions.elements.root.hidden
        }
      }
  const comments = commentsMount === null
    ? null
    : createCommentsController({
      host: commentsMount.host,
      currentUser,
      resolveUser: options.user?.resolveUser,
      permissions: commentsMount.options.permissions,
      formatCreatedAt: commentsMount.options.formatCreatedAt,
      readonly: options.readonly,
      threads: commentsMount.options.threads ?? readCommentThreads(options.editor),
      adapter: {
        createThread(request): void {
          const selection = createPersistentSelection(
            options.editor,
            pendingCommentSelections.get(request.anchor.threadId) ?? options.editor.getSelection()
          )
          const command = buildAddCommentThreadCommand(options.editor.getProjection(), selection, {
            authorId: request.authorId,
            createdAt: request.createdAt,
            text: request.body
          })

          pendingCommentSelections.delete(request.anchor.threadId)

          if (command === null) {
            throw new Error('当前选区无法创建批注。')
          }

          options.editor.executeCommand(command, {
            selectionAfter: selection
          })
          syncComments(commentsHandle, options.editor)
          syncDefaultCommentsRailGeometry(commentsMount, commentsHandle, options.editor, options.editorHost, pendingCommentSelections)
          scheduleDefaultCommentsRailGeometrySync(commentsMount, commentsHandle, options.editor, options.editorHost, pendingCommentSelections)
        },
        updateThread(request): void {
          executeCommentUpdate(options.editor, request)
          syncComments(commentsHandle, options.editor)
          syncDefaultCommentsRailGeometry(commentsMount, commentsHandle, options.editor, options.editorHost, pendingCommentSelections)
          scheduleDefaultCommentsRailGeometrySync(commentsMount, commentsHandle, options.editor, options.editorHost, pendingCommentSelections)
        },
        deleteThread(threadId): void {
          const command = buildDeleteCommentThreadCommand(options.editor.getProjection(), threadId)

          if (command === null) {
            throw new Error('当前批注不存在，无法删除。')
          }

          options.editor.executeCommand(command)
          syncComments(commentsHandle, options.editor)
          syncDefaultCommentsRailGeometry(commentsMount, commentsHandle, options.editor, options.editorHost, pendingCommentSelections)
          scheduleDefaultCommentsRailGeometrySync(commentsMount, commentsHandle, options.editor, options.editorHost, pendingCommentSelections)
        },
        selectThread(): void {},
        focusAnchor(anchor): void {
          scrollCommentThreadIntoView(options.editor, options.editorHost, anchor.threadId)
        }
      }
    })
  commentsHandle = comments
  if (commentsMount?.defaultRail === true && comments !== null) {
    comments.elements.root.setAttribute('data-jword-comments-default-root', 'true')
  }
  unsubscribeCommentsGeometry = bindDefaultCommentsGeometrySync(
    commentsMount,
    commentsHandle,
    options.editor,
    options.editorHost,
    pendingCommentSelections
  )
  const selectionActions = options.editorHost === undefined
    ? null
    : createSelectionActionsController({
      editor: options.editor,
      editorHost: options.editorHost,
      readonly: options.readonly,
      colorFormat: toolbar.colorFormat,
      insertActions: {
        openComment: openCommentFromSelection,
        openLink: openLinkFromSelection,
        openActiveLink: openActiveLinkFromSelection,
        editLink: editLinkFromSelection,
        removeLink: removeLinkFromSelection,
        hasLink(selection): boolean {
          return readActiveLinkDraftFromSelection(options.editor, selection) !== null
        },
        readLinkUrl(selection): string | null {
          return readActiveLinkDraftFromSelection(options.editor, selection)?.url ?? null
        },
        readLinkSelectionFromTarget(target): SelectionState | null {
          const targetElement = target?.closest<HTMLElement>('[data-jword-link-target-index]') ?? null

          if (
            targetElement === null
            || targetElement.closest('[data-jword-link-anchor-overlay]') === null
          ) {
            return null
          }

          return readLinkOverlayTarget(options.editor, targetElement)?.selection ?? null
        }
      },
      assistive: {
        liveRegion
      }
    })
  const imageSelection = options.editorHost === undefined
    ? null
    : createImageSelectionController({
      editor: options.editor,
      editorHost: options.editorHost,
      readonly: options.readonly,
      commands: options.media?.commands
    })
  const paste = mountedEditorHost === undefined
    ? null
    : createPasteController({
      editor: options.editor,
      editorHost: mountedEditorHost,
      assistive: {
        liveRegion
      }
    })
  const unsubscribeEditor = options.editor.subscribe((event) => {
    if (event.kind === 'transaction') {
      syncComments(commentsHandle, options.editor)
      revisions?.refresh()
      commentsOverlay?.sync()
      linkOverlay?.sync()
      syncDefaultCommentsRailGeometry(commentsMount, commentsHandle, options.editor, options.editorHost, pendingCommentSelections)
      syncActiveLink(linkHandle, options.editor)
      syncToolbarLinkInsertAvailability(toolbar, options.editor, readonlyOptions.enabled === true)
      headingOutline?.refresh()
      findReplace?.refresh()
      return
    }

    if (event.kind === 'selectionChange') {
      syncActiveLink(linkHandle, options.editor)
      syncToolbarLinkInsertAvailability(toolbar, options.editor, readonlyOptions.enabled === true)
      revisions?.refresh()
    }
  })
  commentsOverlay?.sync()
  linkOverlay?.sync()
  syncToolbarLinkInsertAvailability(toolbar, options.editor, readonlyOptions.enabled === true)

  return {
    elements: {
      ...toolbar.elements,
      mediaPanel: media?.elements ?? null,
      tablePanel: table?.elements ?? null,
      selectionActions: selectionActions?.elements ?? null,
      commentsPanel: comments?.elements ?? null,
      linkPanel: link?.elements ?? null,
      headerFooterPanel: headerFooter?.elements ?? null,
      headingOutlinePanel: headingOutline?.elements ?? null,
      findReplacePanel: findReplace?.elements ?? null,
      revisionsPanel: revisions?.elements ?? null
    },
    refresh(): void {
      toolbar.refresh()
      media?.refresh()
      table?.refresh()
      selectionActions?.refresh()
      imageSelection?.refresh()
      headerFooter?.refresh()
      headingOutline?.refresh()
      findReplace?.refresh()
      revisions?.refresh()
      syncComments(commentsHandle, options.editor)
      commentsOverlay?.sync()
      syncDefaultCommentsRailGeometry(commentsMount, commentsHandle, options.editor, options.editorHost, pendingCommentSelections)
      syncActiveLink(linkHandle, options.editor)
      syncToolbarLinkInsertAvailability(toolbar, options.editor, readonlyOptions.enabled === true)
    },
    destroy(): void {
      unsubscribeEditor()
      unsubscribeCommentsGeometry()
      commentsOverlay?.destroy()
      linkOverlay?.destroy()
      paste?.destroy()
      imageSelection?.destroy()
      selectionActions?.destroy()
      comments?.destroy()
      commentsMount?.cleanup()
      headerFooter?.destroy()
      headingOutline?.destroy()
      headingOutlineMount?.cleanup()
      findReplace?.destroy()
      revisions?.destroy()
      link?.destroy()
      table?.destroy()
      media?.destroy()
      interactionGuard.destroy()
      toolbar.destroy()
    }
  }
}

/** 解析目录挂载点，默认放到已挂载的 jw-editor 内。 */
function resolveHeadingOutlineMount(
  options: CreateJWordUiOptions['headingOutline'],
  editorHost: HTMLElement | undefined,
  toolbarHost: HTMLElement
): ResolvedHeadingOutlineMount | null {
  if (options === undefined) {
    return null
  }

  const editorShell = editorHost === undefined
    ? null
    : resolveEditorShell(editorHost)

  if (editorShell === null) {
    return {
      host: options.host,
      cleanup(): void {}
    }
  }

  if (options.host === toolbarHost) {
    const host = editorShell.ownerDocument.createElement('div')

    host.className = 'jw-heading-outline-host'
    host.setAttribute('data-jword-heading-outline-host', 'true')
    editorShell.append(host)

    return {
      host,
      cleanup(): void {
        host.remove()
      }
    }
  }

  const host = options.host
  const previousParent = host.parentNode
  const previousNextSibling = host.nextSibling

  host.classList.add('jw-heading-outline-host')
  host.setAttribute('data-jword-heading-outline-host', 'true')
  if (!editorShell.contains(host)) {
    editorShell.append(host)
  }

  return {
    host,
    cleanup(): void {
      host.classList.remove('jw-heading-outline-host')
      host.removeAttribute('data-jword-heading-outline-host')
      if (previousParent !== null) {
        previousParent.insertBefore(host, previousNextSibling?.parentNode === previousParent ? previousNextSibling : null)
      }
    }
  }
}

/** 读取 editor.mount 创建的 jw-editor 根节点。 */
function resolveEditorShell(editorHost: HTMLElement): HTMLElement | null {
  if (editorHost.matches('[data-jword-editor]')) {
    return editorHost
  }

  return editorHost.querySelector<HTMLElement>('[data-jword-editor]')
}

/** 规范化宿主级只读配置。 */
function normalizeReadonlyOptions(input: CreateJWordUiOptions['readonly']): JWordReadonlyOptions {
  if (input === true) {
    return {
      enabled: true
    }
  }

  if (input === false || input === undefined) {
    return {
      enabled: false
    }
  }

  return input
}

/** 执行批注 thread 更新命令。 */
function executeCommentUpdate(editor: Editor, request: JWordCommentUpdateThreadRequest): void {
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
function syncComments(handle: CommentsControllerHandle | null, editor: Editor): void {
  handle?.setThreads(readCommentThreads(editor))
}

/** 绑定默认批注 rail 的几何刷新。 */
function bindDefaultCommentsGeometrySync(
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
function scheduleDefaultCommentsRailGeometrySync(
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
function syncDefaultCommentsRailGeometry(
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
function scrollCommentThreadIntoView(
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

/** 滚动到指定文本范围所在页。 */
function scrollTextRangeIntoView(
  editor: Editor,
  editorHost: HTMLElement | undefined,
  range: TextRange
): void {
  if (editorHost === undefined) {
    return
  }

  const canvasContainer = editorHost.querySelector<HTMLElement>('[data-jword-canvas-container]')

  if (canvasContainer === null) {
    return
  }

  const selection = createSelectionState(
    editor.createTextAnchor(range.anchor),
    editor.createTextAnchor(range.focus)
  )
  const geometry = resolveTextRangeGeometry(editor, canvasContainer, selection.range)

  if (geometry === null) {
    return
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

/** 解析文本范围对应的页内和滚动内容几何。 */
function resolveTextRangeGeometry(
  editor: Editor,
  canvasContainer: HTMLElement,
  range: RangeRef
): Readonly<{ pageIndex: number, pageTop: number, scrollTop: number }> | null {
  const rect = editor.getSelectionRects(range)[0] ?? editor.getCaretRect(range.anchor)

  if (rect === undefined) {
    return null
  }

  const layout = editor.getLayout()
  const page = layout.pages[rect.pageIndex]
  if (page === undefined) {
    return null
  }

  const pageElement = canvasContainer.querySelector<HTMLElement>(`[data-jword-page="${page.pageIndex}"]`)
  const pageTop = twipsToCssPx(rect.y - page.y, editor.getPageConfig().scale)
  const scrollTop = pageElement === null
    ? twipsToCssPx(rect.y, editor.getPageConfig().scale)
    : pageElement.offsetTop + pageTop

  return {
    pageIndex: page.pageIndex,
    pageTop,
    scrollTop
  }
}

/** 把 UI 临时选区重建为可持久化 text anchor 选区。 */
function createPersistentSelection(editor: Editor, selection: SelectionState | null): SelectionState | null {
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
function readCommentThreads(editor: Editor): readonly JWordCommentThread[] {
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
function createCommentAnchorState(
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

/** 创建正文链接锚点 overlay。 */
function createLinkAnchorOverlay(
  editor: Editor,
  editorHost: HTMLElement,
  onActivate: (target: LinkRunTarget, event: MouseEvent) => void
): LinkAnchorOverlay | null {
  const canvasContainer = editorHost.querySelector<HTMLElement>('[data-jword-canvas-container]')

  if (canvasContainer === null) {
    return null
  }

  const overlay = document.createElement('div')
  const signalController = new AbortController()

  overlay.className = 'jw-link-anchor-overlay'
  overlay.setAttribute('data-jword-link-anchor-overlay', 'true')
  canvasContainer.style.position = canvasContainer.style.position || 'relative'
  canvasContainer.append(overlay)
  overlay.addEventListener('click', (event) => {
    activateLinkOverlayTarget(editor, overlay, event, onActivate)
  }, { signal: signalController.signal })
  overlay.addEventListener('contextmenu', (event) => {
    event.preventDefault()
    activateLinkOverlayTarget(editor, overlay, event, onActivate)
  }, { signal: signalController.signal })

  return {
    sync(): void {
      renderLinkAnchorOverlay(editor, canvasContainer, overlay)
    },
    destroy(): void {
      signalController.abort()
      overlay.remove()
    }
  }
}

/** 激活点击命中的链接 overlay 目标。 */
function activateLinkOverlayTarget(
  editor: Editor,
  overlay: HTMLElement,
  event: MouseEvent,
  onActivate: (target: LinkRunTarget, event: MouseEvent) => void
): void {
  const targetElement = event.target instanceof HTMLElement
    ? event.target.closest<HTMLElement>('[data-jword-link-target-index]')
    : null

  if (targetElement === null || !overlay.contains(targetElement)) {
    return
  }

  const target = readLinkOverlayTarget(editor, targetElement)

  if (target !== null) {
    onActivate(target, event)
  }
}

/** 渲染正文链接锚点 overlay。 */
function renderLinkAnchorOverlay(
  editor: Editor,
  canvasContainer: HTMLElement,
  overlay: HTMLElement
): void {
  const targets = collectLinkOverlayTargets(editor)
  const layout = editor.getLayout()
  const scale = editor.getPageConfig().scale
  const children: HTMLElement[] = []

  for (const [targetIndex, target] of targets.entries()) {
    const rects = editor.getSelectionRects(target.selection.range)
    const markerIndex = Math.max(0, rects.length - 1)

    for (const [rectIndex, rect] of rects.entries()) {
      const page = layout.pages[rect.pageIndex]
      const pageElement = page === undefined
        ? null
        : canvasContainer.querySelector<HTMLElement>(`[data-jword-page="${page.pageIndex}"]`)

      if (page === undefined || pageElement === null) {
        continue
      }

      children.push(createLinkAnchorOverlayRect(
        targetIndex,
        pageElement,
        page,
        rect,
        scale,
        rectIndex === markerIndex
      ))
    }
  }

  overlay.style.width = `${canvasContainer.scrollWidth}px`
  overlay.style.height = `${canvasContainer.scrollHeight}px`
  overlay.replaceChildren(...children)
}

/** 创建单个链接锚点矩形。 */
function createLinkAnchorOverlayRect(
  targetIndex: number,
  pageElement: HTMLElement,
  page: NonNullable<ReturnType<Editor['getLayout']>['pages'][number]>,
  rect: ReturnType<Editor['getSelectionRects']>[number],
  scale: number,
  withMarker: boolean
): HTMLElement {
  const target = document.createElement('button')

  target.type = 'button'
  target.className = 'jw-link-anchor-overlay__rect'
  target.style.left = `${pageElement.offsetLeft + twipsToCssPx(rect.x - page.x, scale)}px`
  target.style.top = `${pageElement.offsetTop + twipsToCssPx(rect.y - page.y, scale)}px`
  target.style.width = `${twipsToCssPx(rect.width, scale)}px`
  target.style.height = `${twipsToCssPx(rect.height, scale)}px`
  target.setAttribute('aria-label', '链接')
  target.setAttribute('data-jword-link-target-index', String(targetIndex))

  if (withMarker) {
    const marker = document.createElement('span')

    marker.className = 'jw-link-anchor-overlay__marker'
    marker.textContent = '链'
    target.append(marker)
  }

  return target
}

/** 从 overlay 索引还原链接目标。 */
function readLinkOverlayTarget(editor: Editor, targetElement: HTMLElement): LinkRunTarget | null {
  const targetIndex = Number(targetElement.getAttribute('data-jword-link-target-index'))

  if (!Number.isInteger(targetIndex)) {
    return null
  }

  return collectLinkOverlayTargets(editor)[targetIndex] ?? null
}

/** 收集 projection 中连续链接 run 的 overlay 目标。 */
function collectLinkOverlayTargets(editor: Editor): readonly LinkRunTarget[] {
  const projection = editor.getProjection()
  const targets: LinkRunTarget[] = []

  for (const section of projection.document.sections) {
    collectLinkOverlayTargetsFromBlocks(editor, section.id, section.blocks, targets)
  }

  return Object.freeze(targets)
}

/** 递归收集块树内的链接 overlay 目标。 */
function collectLinkOverlayTargetsFromBlocks(
  editor: Editor,
  sectionId: string,
  blocks: readonly Block[],
  targets: LinkRunTarget[]
): void {
  for (const block of blocks) {
    if (block.kind === 'paragraph') {
      collectParagraphLinkOverlayTargets(editor, sectionId, block, targets)
      continue
    }

    for (const row of block.rows) {
      for (const cell of row.cells) {
        collectLinkOverlayTargetsFromBlocks(editor, sectionId, cell.blocks, targets)
      }
    }
  }
}

/** 把段落内连续的同链接 run 合并成一个可点击目标。 */
function collectParagraphLinkOverlayTargets(
  editor: Editor,
  sectionId: string,
  paragraph: Paragraph,
  targets: LinkRunTarget[]
): void {
  let group: Run[] = []

  for (const run of paragraph.runs) {
    if (run.link === undefined) {
      flushLinkGroup(editor, sectionId, paragraph.id, group, targets)
      group = []
      continue
    }

    const previous = group[group.length - 1]

    if (previous !== undefined && !areRunLinksEqual(previous, run)) {
      flushLinkGroup(editor, sectionId, paragraph.id, group, targets)
      group = []
    }

    group.push(run)
  }

  flushLinkGroup(editor, sectionId, paragraph.id, group, targets)
}

/** 把连续链接 run 组转成 overlay 目标。 */
function flushLinkGroup(
  editor: Editor,
  sectionId: string,
  blockId: string,
  group: readonly Run[],
  targets: LinkRunTarget[]
): void {
  const firstRun = group[0]
  const lastRun = group[group.length - 1]

  if (firstRun?.link === undefined || lastRun === undefined) {
    return
  }

  const visibleText = group.map(readRunPlainText).join('')

  if (visibleText.length === 0) {
    return
  }

  const selection = createSelectionState(
    editor.createTextAnchor({
      sectionId,
      blockId,
      runId: firstRun.id,
      graphemeIndex: 0
    }),
    editor.createTextAnchor({
      sectionId,
      blockId,
      runId: lastRun.id,
      graphemeIndex: countRunGraphemes(lastRun)
    })
  )

  targets.push({
    selection,
    draft: {
      visibleText,
      url: firstRun.link.target,
      tooltip: firstRun.link.tooltip ?? ''
    }
  })
}

/** 判断两个 run 的链接元数据是否相同。 */
function areRunLinksEqual(left: Run, right: Run): boolean {
  return left.link?.target === right.link?.target
    && (left.link?.tooltip ?? '') === (right.link?.tooltip ?? '')
}

/** 读取 run 的 grapheme 数。 */
function countRunGraphemes(run: Run): number {
  return Array.from(readRunPlainText(run)).length
}

/** 同步当前 selection 命中的链接给 link quick tools。 */
function syncActiveLink(handle: LinkControllerHandle | null, editor: Editor): void {
  handle?.setActiveLink(readActiveLinkDraftFromSelection(editor, editor.getSelection()))
}

/** 根据当前链接命中态禁用顶部插入链接入口。 */
function syncToolbarLinkInsertAvailability(
  toolbar: { readonly elements: { readonly controls: Partial<Record<JWordToolbarToolId, JWordToolbarControlElement>> } },
  editor: Editor,
  readonly: boolean
): void {
  const control = toolbar.elements.controls['insert.link']

  if (!(control instanceof HTMLButtonElement)) {
    return
  }

  const disabled = readonly || readActiveLinkDraftFromSelection(editor, editor.getSelection()) !== null

  control.disabled = disabled
  control.setAttribute('aria-disabled', String(disabled))
}

/** 从当前 selection 读取活动链接草稿。 */
function readActiveLinkDraftFromSelection(editor: Editor, selection: SelectionState | null): JWordLinkDraft | null {
  if (selection === null) {
    return null
  }

  const position = editor.resolveTextPosition(selection.focus)
  const run = findRunById(editor.getProjection(), position.runId)

  if (run?.link === undefined) {
    return null
  }

  return {
    visibleText: readRunPlainText(run),
    url: run.link.target,
    tooltip: run.link.tooltip ?? ''
  }
}

/** 解析 UI 当前用户；未显式传入时回退到 core editor 用户。 */
function resolveCurrentUiUser(options: CreateJWordUiOptions): JWordCommentUser {
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
function resolveCommentsMount(
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
function createCommentsAnchorOverlay(editor: Editor, editorHost: HTMLElement): CommentsAnchorOverlay | null {
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
  const layout = editor.getLayout()
  const scale = editor.getPageConfig().scale
  const children: HTMLElement[] = []

  for (const thread of projection.document.comments ?? []) {
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

/** 创建本轮 UI 草稿 ID。 */
function createDraftId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`
  }

  return `${prefix}-${Date.now()}-${Math.round(Math.random() * 100000)}`
}

/** 读取 selection 覆盖的纯文本。 */
function readSelectionText(editor: Editor, selection: SelectionState): string {
  return readTextRangePlainText(editor.getProjection(), {
    anchor: editor.resolveTextPosition(selection.anchor),
    focus: editor.resolveTextPosition(selection.focus)
  })
}

/** 读取文本范围覆盖的纯文本；跨 run 时返回范围首尾的可读摘要。 */
function readTextRangePlainText(projection: DocumentProjection, range: TextRange): string {
  const anchorRun = findRunById(projection, range.anchor.runId)
  const focusRun = findRunById(projection, range.focus.runId)

  if (anchorRun === null || focusRun === null) {
    return ''
  }

  if (range.anchor.runId === range.focus.runId) {
    return sliceRunText(anchorRun, range.anchor.graphemeIndex, range.focus.graphemeIndex)
  }

  const anchorText = sliceRunText(anchorRun, range.anchor.graphemeIndex, Number.POSITIVE_INFINITY)
  const focusText = sliceRunText(focusRun, 0, range.focus.graphemeIndex)
  const text = `${anchorText}${focusText}`.trim()

  return text.length > 0 ? text : '跨段选区'
}

/** 按 run ID 查找 run。 */
function findRunById(projection: DocumentProjection, runId: string): Run | null {
  for (const section of projection.document.sections) {
    const matched = findRunInBlocks(section.blocks, runId)

    if (matched !== null) {
      return matched
    }
  }

  return null
}

/** 在块树内递归查找 run。 */
function findRunInBlocks(blocks: readonly Block[], runId: string): Run | null {
  for (const block of blocks) {
    if (block.kind === 'paragraph') {
      const run = block.runs.find((candidate) => candidate.id === runId)

      if (run !== undefined) {
        return run
      }

      continue
    }

    for (const row of block.rows) {
      for (const cell of row.cells) {
        const nested = findRunInBlocks(cell.blocks, runId)

        if (nested !== null) {
          return nested
        }
      }
    }
  }

  return null
}

/** 按 grapheme 边界裁剪 run 文本。 */
function sliceRunText(run: Run, start: number, end: number): string {
  const graphemes = Array.from(readRunPlainText(run))
  const from = Math.max(0, Math.min(start, end))
  const to = Math.min(Math.max(start, end), graphemes.length)

  return graphemes.slice(from, to).join('')
}

/** 从 projection 读取纯文本镜像内容。 */
function readProjectionPlainText(projection: DocumentProjection): string {
  return projection.document.sections
    .map((section) => section.blocks.map(readBlockPlainText).join('\n'))
    .join('\n\n')
}

/** 从 block 读取纯文本内容。 */
function readBlockPlainText(block: Block): string {
  if (block.kind === 'paragraph') {
    return readParagraphPlainText(block)
  }

  return block.rows
    .map((row) => row.cells.map((cell) => cell.blocks.map(readBlockPlainText).join('\n')).join('\t'))
    .join('\n')
}

/** 从段落读取 run 级纯文本内容。 */
function readParagraphPlainText(paragraph: Paragraph): string {
  return paragraph.runs.map(readRunPlainText).join('')
}

/** 从 run 读取 inline 级纯文本内容。 */
function readRunPlainText(run: Run): string {
  return run.inlines
    .map((inline) => {
      if (inline.kind === 'text') {
        return inline.text
      }

      if (inline.kind === 'break') {
        return '\n'
      }

      if (inline.kind === 'image') {
        return '[image]'
      }

      return ''
    })
    .join('')
}
