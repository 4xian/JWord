/**
 * 职责：承载 createJWordUi 的运行期装配编排和生命周期销毁顺序。
 * 边界：只组装各 UI controller 与内部 setup 模块，不实现具体 controller DOM 细节。
 * 协作模块：create-ui 公开入口、toolbar/media/table/comments/link/heading setup 模块共同完成官方 UI 装配。
 * 性能/安全约束：事务订阅中避免无条件读取完整 layout，所有写入仍走 editor command pipeline。
 * Specs：docs/superpowers/reports/2026-07-03-remediation-execution-supplement.md#310-phase-5-超大文件拆分目标结构。
 */
import {
  buildAddCommentThreadCommand,
  buildDeleteCommentThreadCommand,
  buildDeleteLinkCommand,
  buildEditLinkCommand,
  buildHeadingOutline,
  buildInsertLinkCommand,
  isSelectionCollapsed,
  type SelectionState
} from '@4xian/jword-core'

import { createLiveRegion } from './assistive/live-region'
import { createTextMirror } from './assistive/text-mirror'
import { createCommentsController } from './comments/controller'
import type { CommentsControllerHandle } from './comments/types'
import {
  bindDefaultCommentsGeometrySync,
  createCommentAnchorState,
  createCommentsAnchorOverlay,
  createPersistentSelection,
  executeCommentUpdate,
  readCommentThreads,
  resolveCommentsMount,
  resolveCurrentUiUser,
  scheduleDefaultCommentsRailGeometrySync,
  scrollCommentThreadIntoView,
  syncComments,
  syncDefaultCommentsRailGeometry
} from './comments-rail'
import type { ResolvedCommentsMount } from './comments-rail'
import { createFindReplaceController } from './find-replace/controller'
import { createHeaderFooterController } from './header-footer/controller'
import { createHeadingOutlineController } from './heading/controller'
import { resolveHeadingOutlineMount } from './heading-outline-setup'
import { createLinkController } from './link/controller'
import type { LinkControllerHandle } from './link/types'
import {
  createLinkAnchorOverlay,
  readActiveLinkDraftFromSelection,
  readLinkOverlayTarget,
  syncActiveLink,
  syncToolbarLinkInsertAvailability
} from './link-overlay'
import { createMediaController } from './media/controller'
import { resolveMediaOptions } from './media-setup'
import { createImageSelectionController } from './media/image-selection-controller'
import { createPasteController } from './paste/controller'
import { createJWordInteractionGuard } from './readonly/interaction-guard'
import { createRevisionController } from './revisions/controller'
import { createSelectionActionsController } from './selection-actions/controller'
import { createTableController } from './table/controller'
import { resolveTableOptions } from './table-setup'
import {
  bindFindReplaceKeyboardShortcuts,
  resolveToolbarMount
} from './toolbar-setup'
import { createToolbarController } from './toolbar/controller'
import {
  readProjectionPlainText,
  readSelectionText
} from './text-projection'
import type {
  CreateJWordUiOptions,
  JWordReadonlyOptions,
  JWordUiInstance
} from './types'
import { scrollTextRangeIntoView } from './ui-geometry'

/** 创建并挂载最小 JWord 官方 UI。 */
export function createJWordUi(options: CreateJWordUiOptions): JWordUiInstance {
  const toolbarMount = resolveToolbarMount(options)
  const toolbarHost = toolbarMount.host
  const liveRegion = createLiveRegion({
    host: options.liveRegionHost ?? null
  })
  const textMirror = options.assistiveMirrorHost === undefined || options.assistiveMirrorHost === null
    ? null
    : createTextMirror({
      host: options.assistiveMirrorHost,
      readText: () => readProjectionPlainText(options.editor.getProjection()),
      shouldDeferSync: () => readMountedPageCount(options.editorHost) > 4
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
  const resolvedMedia = resolveMediaOptions(options.media)
  const mediaDisabled = options.media === undefined
  const resolvedTable = resolveTableOptions(options.table)

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
    toolbarHost,
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
    editorHost: mountedEditorHost ?? toolbarHost,
    toolbarHost,
    controls: toolbar.elements.controls,
    readonly: readonlyOptions,
    assistive: {
      liveRegion
    }
  })
  const media = toolbar.mediaHost === null
    ? null
    : createMediaController({
      editor: options.editor,
      host: toolbar.mediaHost,
      media: resolvedMedia,
      disabled: mediaDisabled,
      readonly: options.readonly,
      assistive: {
        liveRegion
      }
    })
  const table = toolbar.tableHost === null
    ? null
    : createTableController({
      editor: options.editor,
      toolbarHost: toolbar.tableHost,
      editorHost: options.editorHost ?? toolbarHost,
      table: resolvedTable,
      readonly: options.readonly,
      assistive: {
        liveRegion
      }
    })
  const link = options.link === undefined
    ? null
    : createLinkController({
      host: options.link.host ?? options.editorHost ?? toolbar.linkHost ?? toolbarHost,
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
    ? resolveHeadingOutlineMount(options.headingOutline, editorHost, toolbarHost)
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
      host: toolbar.panelHost ?? options.headerFooter.host ?? toolbarHost,
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
      host: toolbar.panelHost ?? options.findReplace.host ?? toolbarHost,
      readonly: options.readonly,
      findOptions: {
        caseSensitive: options.findReplace.caseSensitive !== false
      },
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
  const unsubscribeFindReplaceKeyboardShortcuts = findReplace === null
    || options.findReplace?.keyboardShortcuts === false
    || options.editorHost === undefined
    ? (): void => {}
    : bindFindReplaceKeyboardShortcuts([options.editorHost, toolbarHost, findReplace.elements.root], findReplace)
  const revisions = !shouldCreateRevisions || options.revisions === undefined
    ? null
    : createRevisionController({
      editor: options.editor,
      host: toolbar.panelHost ?? options.revisions.host ?? toolbarHost,
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
      commands: resolvedMedia.commands
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
      unsubscribeFindReplaceKeyboardShortcuts()
      findReplace?.destroy()
      revisions?.destroy()
      link?.destroy()
      table?.destroy()
      media?.destroy()
      interactionGuard.destroy()
      toolbar.destroy()
      toolbarMount.cleanup()
    }
  }
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

/** 从已挂载 canvas 容器读取最近一次渲染页数，避免 UI 热路径强制刷新 layout。 */
function readMountedPageCount(editorHost: HTMLElement | undefined): number {
  const raw = editorHost
    ?.querySelector<HTMLElement>('[data-jword-canvas-container]')
    ?.getAttribute('data-jword-page-count')

  return raw === undefined || raw === null ? 0 : Number.parseInt(raw, 10) || 0
}

/** 创建本轮 UI 草稿 ID。 */
function createDraftId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`
  }

  return `${prefix}-${Date.now()}-${Math.round(Math.random() * 100000)}`
}
