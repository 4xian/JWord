/**
 * 职责：承载 createJWordUi 的运行期装配编排和生命周期销毁顺序。
 * 边界：只组装各 UI controller 与内部 setup 模块，不实现具体 controller DOM 细节。
 * 协作模块：create-ui 公开入口、toolbar/media/table/comments/link/heading setup 模块共同完成官方 UI 装配。
 * 性能/安全约束：事务订阅中避免无条件读取完整 layout，所有写入仍走 editor command pipeline。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
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
import { readJWordUiText, resolveJWordUiI18n } from './i18n'
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
import {
  createStatusBarController,
  type StatusBarControllerHandle
} from './status-bar/controller'
import { resolveStatusBarMount } from './status-bar/mount'
import { createTableController } from './table/controller'
import { createJWordUiThemeController } from './theme'
import { resolveTableOptions } from './table-setup'
import {
  bindFindReplaceKeyboardShortcuts,
  resolveToolbarMount
} from './toolbar-setup'
import { createToolbarController } from './toolbar/controller'
import { createWatermarkController } from './watermark/controller'
import {
  readProjectionPlainText,
  readSelectionText
} from './text-projection'
import type {
  CreateJWordUiOptions,
  JWordReadonlyOptions,
  JWordStatusBarLocale,
  JWordUiI18nDictionary,
  JWordUiThemeName,
  JWordUiThemeOptions,
  JWordUiInstance
} from './types'
import { scrollTextRangeIntoView } from './ui-geometry'

/** 创建并挂载最小 JWord 官方 UI。 */
export function createJWordUi(options: CreateJWordUiOptions): JWordUiInstance {
  const cleanup = createJWordUiCleanup()

  try {
    return createJWordUiRuntime(options, cleanup)
  } catch (error) {
    cleanup.destroy()
    throw error
  }
}

/** 按构造顺序装配 UI，并把每项资源立即登记到统一清理栈。 */
function createJWordUiRuntime(options: CreateJWordUiOptions, cleanup: JWordUiCleanup): JWordUiInstance {
  const toolbarMount = resolveToolbarMount(options)
  cleanup.add(toolbarMount.cleanup)
  const toolbarHost = toolbarMount.host
  const statusBarMount = resolveStatusBarMount(options)
  cleanup.add(() => statusBarMount?.cleanup())
  const statusBarHost = statusBarMount?.host ?? null
  const liveRegion = createLiveRegion({
    host: options.liveRegionHost ?? null
  })
  cleanup.add(liveRegion.destroy)
  const textMirror = options.assistiveMirrorHost === undefined || options.assistiveMirrorHost === null
    ? null
    : createTextMirror({
      host: options.assistiveMirrorHost,
      readText: () => readProjectionPlainText(options.editor.getProjection()),
      shouldDeferSync: () => readMountedPageCount(options.editorHost) > 4
    })
  cleanup.add(() => textMirror?.destroy())
  const currentUser = resolveCurrentUiUser(options)
  const commentsMount = resolveCommentsMount(options.comments, options.editorHost)
  cleanup.add(() => commentsMount?.cleanup())
  const commentsOverlay = commentsMount === null || options.editorHost === undefined
    ? null
    : createCommentsAnchorOverlay(options.editor, options.editorHost)
  cleanup.add(() => commentsOverlay?.destroy())
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
  cleanup.add(() => unsubscribeCommentsGeometry())
  const readonlyOptions = normalizeReadonlyOptions(options.readonly)
  const toolbarEntryAvailable = options.toolbar !== false
  const readonlyEditingBlocked = readonlyOptions.enabled === true
  const readonlyNavigationAllowed = readonlyOptions.allowNavigation !== false
  const resolvedMedia = resolveMediaOptions(options.media)
  const resolvedTable = resolveTableOptions(options.table)
  let i18n = resolveJWordUiI18n(options.i18n)
  let currentThemeName: JWordUiThemeName = options.theme?.name ?? 'light'
  let currentLocale: JWordStatusBarLocale = normalizeStatusBarLocale(options.i18n?.locale)
  const themeController = createJWordUiThemeController({
    ...(options.theme === undefined ? {} : { theme: options.theme }),
    hosts: [
      toolbarHost,
      options.editorHost,
      statusBarHost,
      options.comments === true ? null : options.comments?.host,
      options.headingOutline?.host,
      options.link?.host,
      options.headerFooter?.host,
      options.findReplace?.host,
      options.revisions?.host,
      typeof options.statusBar === 'object' ? options.statusBar.fullscreenHost : null
    ]
  })
  cleanup.add(themeController.destroy)
  const watermark = createWatermarkController(options.editorHost)
  cleanup.add(watermark.destroy)
  let statusBarHandle: StatusBarControllerHandle | null = null

  /** 按 i18n key 播报 UI 阻断文案。 */
  function announceUiMessage(key: Parameters<typeof readJWordUiText>[1], fallback: string): void {
    liveRegion.announce(readJWordUiText(i18n, key, fallback), { force: true })
  }

  /** 从当前选区打开批注草稿。 */
  function openCommentFromSelection(selection: SelectionState | null = options.editor.getSelection()): void {
    if (readonlyOptions.enabled === true) {
      announceUiMessage('a11y.blockedReadonly', 'BLOCKED: 当前为只读模式。')
      return
    }

    if (commentsHandle === null) {
      announceUiMessage('a11y.commentSidebarMissing', 'BLOCKED: 当前宿主未启用批注侧栏。')
      return
    }

    if (selection === null || isSelectionCollapsed(selection)) {
      announceUiMessage('a11y.commentSelectionRequired', 'BLOCKED: 批注需要先选中一段正文。')
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
      announceUiMessage('a11y.blockedReadonly', 'BLOCKED: 当前为只读模式。')
      return
    }

    if (linkHandle === null) {
      announceUiMessage('a11y.linkDialogMissing', 'BLOCKED: 当前宿主未启用链接弹窗。')
      return
    }

    if (readActiveLinkDraftFromSelection(options.editor, selection) !== null) {
      announceUiMessage('a11y.linkAlreadyExists', 'BLOCKED: 当前内容已有链接，请使用打开、编辑或删除链接。')
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
      announceUiMessage('a11y.linkOpenMissing', 'BLOCKED: 当前选区未命中可打开的链接。')
      return
    }

    options.link?.openLink?.(draft.url)
  }

  /** 用当前链接选区打开编辑弹窗。 */
  function editLinkFromSelection(selection: SelectionState | null): void {
    if (readonlyOptions.enabled === true) {
      announceUiMessage('a11y.blockedReadonly', 'BLOCKED: 当前为只读模式。')
      return
    }

    if (linkHandle === null) {
      announceUiMessage('a11y.linkDialogMissing', 'BLOCKED: 当前宿主未启用链接弹窗。')
      return
    }

    const draft = readActiveLinkDraftFromSelection(options.editor, selection)

    if (draft === null) {
      announceUiMessage('a11y.linkEditMissing', 'BLOCKED: 当前选区未命中可编辑的链接。')
      return
    }

    pendingLinkSelection = selection
    linkHandle.setActiveLink(draft)
    linkHandle.openEditDialog()
  }

  /** 删除当前链接选区命中的链接。 */
  function removeLinkFromSelection(selection: SelectionState | null): void {
    if (readonlyOptions.enabled === true) {
      announceUiMessage('a11y.blockedReadonly', 'BLOCKED: 当前为只读模式。')
      return
    }

    const command = buildDeleteLinkCommand(options.editor.getProjection(), selection)

    if (command === null) {
      announceUiMessage('a11y.linkRemoveMissing', 'BLOCKED: 当前选区未命中可移除的链接。')
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
    },
    uiActions: {
      setTheme(theme): void {
        applyUiTheme(theme)
      },
      setLocale(locale): void {
        applyUiLocale(locale)
      }
    },
    watermarkActions: {
      getWatermark(): ReturnType<typeof watermark.getWatermark> {
        return watermark.getWatermark()
      },
      setWatermark(nextWatermark): void {
        watermark.setWatermark(nextWatermark)
      },
      clearWatermark(): void {
        watermark.clearWatermark()
      }
    }
  })
  cleanup.add(toolbar.destroy)
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
  cleanup.add(interactionGuard.destroy)
  const media = toolbar.mediaHost === null
    ? null
    : createMediaController({
      editor: options.editor,
      host: toolbar.mediaHost,
      media: resolvedMedia,
      disabled: false,
      readonly: options.readonly,
      i18n,
      assistive: {
        liveRegion
      }
    })
  cleanup.add(() => media?.destroy())
  const table = toolbar.tableHost === null
    ? null
    : createTableController({
      editor: options.editor,
      toolbarHost: toolbar.tableHost,
      editorHost: options.editorHost ?? toolbarHost,
      table: resolvedTable,
      readonly: options.readonly,
      i18n,
      assistive: {
        liveRegion
      }
    })
  cleanup.add(() => table?.destroy())
  const link = options.link === undefined
    ? null
    : createLinkController({
      host: options.link.host ?? options.editorHost ?? toolbar.linkHost ?? toolbarHost,
      viewportHost: options.editorHost,
      readonly: options.readonly,
      policy: options.link.policy,
      i18n,
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
  cleanup.add(() => link?.destroy())
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
  cleanup.add(() => headingOutlineMount?.cleanup())
  const linkOverlay = link === null || editorHost === undefined
    ? null
    : createLinkAnchorOverlay(options.editor, editorHost, (target) => {
      pendingLinkSelection = target.selection
      options.editor.focus()
      options.editor.setSelection(target.selection)
      link.toggleQuickTools(target.draft)
    })
  cleanup.add(() => linkOverlay?.destroy())
  const headerFooter = !shouldCreateHeaderFooter || options.headerFooter === undefined
    ? null
    : createHeaderFooterController({
      editor: options.editor,
      host: options.headerFooter.host ?? toolbar.panelHost ?? toolbarHost,
      readonly: options.readonly,
      i18n,
      announce(message): void {
        liveRegion.announce(message)
      }
    })
  cleanup.add(() => headerFooter?.destroy())
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
      ...(options.editorHost === undefined ? {} : { editorHost: options.editorHost }),
      i18n,
      scrollToRange(range): void {
        scrollTextRangeIntoView(options.editor, options.editorHost, range)
      }
    })
  cleanup.add(() => headingOutline?.destroy())
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
      host: options.findReplace.host ?? toolbar.panelHost ?? toolbarHost,
      readonly: options.readonly,
      i18n,
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
  cleanup.add(() => findReplace?.destroy())
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
  cleanup.add(unsubscribeFindReplaceKeyboardShortcuts)
  const revisions = !shouldCreateRevisions || options.revisions === undefined
    ? null
    : createRevisionController({
      editor: options.editor,
      host: options.revisions.host ?? toolbar.panelHost ?? toolbarHost,
      i18n,
      announce(message): void {
        liveRegion.announce(message)
      }
    })
  cleanup.add(() => revisions?.destroy())
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
      i18n,
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
  cleanup.add(() => comments?.destroy())
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
      i18n,
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
  cleanup.add(() => selectionActions?.destroy())
  const imageSelection = options.editorHost === undefined
    ? null
    : createImageSelectionController({
      editor: options.editor,
      editorHost: options.editorHost,
      readonly: options.readonly,
      i18n,
      commands: resolvedMedia.commands
    })
  cleanup.add(() => imageSelection?.destroy())
  const paste = mountedEditorHost === undefined
    ? null
    : createPasteController({
      editor: options.editor,
      editorHost: mountedEditorHost,
      assistive: {
        liveRegion
      }
    })
  cleanup.add(() => paste?.destroy())
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
  cleanup.add(unsubscribeEditor)
  statusBarHandle = statusBarMount === null
    ? null
    : createStatusBarController({
      editor: options.editor,
      ...(options.editorHost === undefined ? {} : { editorHost: options.editorHost }),
      host: statusBarMount.host,
      fullscreenHost: options.editorHost ?? statusBarMount.host,
      statusBar: statusBarMount.options,
      i18n,
      themeName: currentThemeName,
      locale: currentLocale,
      assistive: {
        liveRegion
      },
      setTheme(theme): void {
        applyUiTheme(theme)
      },
      setLocale(locale): void {
        applyUiLocale(locale)
      },
      brandWatermark: {
        set(text): void {
          watermark.setBrandWatermark(text)
        },
        clear(): void {
          watermark.clearBrandWatermark()
        }
      }
    })
  cleanup.add(() => statusBarHandle?.destroy())
  commentsOverlay?.sync()
  linkOverlay?.sync()
  syncToolbarLinkInsertAvailability(toolbar, options.editor, readonlyOptions.enabled === true)

  return {
    elements: {
      ...toolbar.elements,
      statusBar: statusBarHandle?.elements ?? null,
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
    setTheme(theme): void {
      applyUiTheme(theme)
    },
    setLocale(locale, messages): void {
      applyUiLocale(locale, messages)
    },
    setWatermark(nextWatermark): void {
      watermark.setWatermark(nextWatermark)
      toolbar.refresh()
    },
    clearWatermark(): void {
      watermark.clearWatermark()
      toolbar.refresh()
    },
    getWatermark(): ReturnType<typeof watermark.getWatermark> {
      return watermark.getWatermark()
    },
    refresh(): void {
      toolbar.refresh()
      statusBarHandle?.refresh()
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
    destroy: cleanup.destroy
  }

  /** 动态应用 UI 主题，并同步状态栏当前值。 */
  function applyUiTheme(theme: JWordUiThemeOptions): void {
    currentThemeName = theme.name ?? currentThemeName
    themeController.setTheme(theme)
    toolbar.setThemeName(currentThemeName)
    statusBarHandle?.setThemeName(currentThemeName)
  }

  /** 动态应用 UI 语言，并同步 toolbar/statusBar 文案。 */
  function applyUiLocale(locale: JWordStatusBarLocale, messages?: JWordUiI18nDictionary): void {
    currentLocale = locale
    i18n = resolveJWordUiI18n({
      ...(options.i18n ?? {}),
      locale,
      messages: {
        ...(options.i18n?.messages ?? {}),
        ...(messages ?? {})
      }
    })
    toolbar.setI18n(i18n)
    statusBarHandle?.setI18n(i18n, currentLocale)
    headerFooter?.setI18n(i18n)
    headingOutline?.setI18n(i18n)
    findReplace?.setI18n(i18n)
    revisions?.setI18n(i18n)
    link?.setI18n(i18n)
    comments?.setI18n(i18n)
    media?.setI18n(i18n)
    table?.setI18n(i18n)
    selectionActions?.setI18n(i18n)
    imageSelection?.setI18n(i18n)
  }
}

interface JWordUiCleanup {
  add(cleanup: () => void): void
  destroy(): void
}

/** 创建幂等反序清理栈，供正常销毁与构造失败共同使用。 */
function createJWordUiCleanup(): JWordUiCleanup {
  const cleanups: Array<() => void> = []
  let destroyed = false

  return {
    add(cleanup): void {
      cleanups.push(cleanup)
    },
    destroy(): void {
      if (destroyed) {
        return
      }

      destroyed = true
      for (const cleanup of cleanups.reverse()) {
        cleanup()
      }
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

/** 把公开状态栏语言收口到首批中英文。 */
function normalizeStatusBarLocale(locale: string | undefined): JWordStatusBarLocale {
  return locale === 'en-US' ? 'en-US' : 'zh-CN'
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
