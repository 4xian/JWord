/**
 * 职责：驱动 Gate 4 表格工具栏生命周期，装配状态同步、动作、选择和 resize 子控制器。
 * 边界：不实现 core table builder 或 demo 业务；这里只维护 UI 生命周期并调度宿主注入的命令适配器。
 * 协作模块：create-ui 负责装配，table dom 负责节点结构，宿主通过 table options 注入命令桥接。
 * 性能/安全约束：所有表格写入都必须继续走 editor facade 的 transaction pipeline，不旁路修改 projection。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import type { Editor } from '@4xian/jword-core'
import type {
  JWordTableCommandContext,
  JWordTableOptions,
  JWordTablePanelElements,
  JWordReadonlyMode,
  JWordTableSelectionTarget,
  JWordUiLiveRegionController
} from '../types'
import { createTablePanelDom, destroyTablePanel, localizeTablePanelDom } from './dom'
import {
  readJWordUiText,
  resolveJWordUiI18n,
  type ResolvedJWordUiI18n
} from '../i18n'
import {
  createResizeHandlesLayer,
  createResizePreviewLine,
  createTableContextMenu,
  localizeTableContextMenu,
  requireHiddenTextarea
} from './controller-helpers'
import { createTableActionController } from './table-actions'
import { createTableResizeController } from './table-resize'
import { bindTableSelectionEvents, resolveEditorShell } from './table-selection'
import {
  createInitialTableControllerState,
  refreshTableControllerState
} from './table-state-sync'

interface CreateTableControllerOptions {
  readonly editor: Editor
  readonly toolbarHost: HTMLElement
  readonly editorHost: HTMLElement
  readonly table: JWordTableOptions
  readonly readonly?: JWordReadonlyMode
  readonly i18n?: ResolvedJWordUiI18n
  readonly assistive: {
    readonly liveRegion: JWordUiLiveRegionController | null
  }
}

interface TableControllerHandle {
  readonly elements: JWordTablePanelElements
  setI18n(i18n: ResolvedJWordUiI18n): void
  refresh(): void
  destroy(): void
}

/** 创建 Gate 4 表格工具栏 controller。 */
export function createTableController(options: CreateTableControllerOptions): TableControllerHandle {
  let i18n = options.i18n ?? resolveJWordUiI18n()
  const dom = createTablePanelDom(
    options.toolbarHost,
    options.editorHost,
    readTableTitle(i18n, options.table.title)
  )
  const commands = options.table.commands
  const liveRegion = options.assistive.liveRegion
  const signalController = new AbortController()
  const hiddenTextarea = requireHiddenTextarea(options.editorHost)
  const overlayHost = resolveEditorShell(options.editorHost)
  const readonlyMode = options.readonly === true || (typeof options.readonly === 'object' && options.readonly.enabled === true)
  const contextMenu = createTableContextMenu(overlayHost, i18n)
  const resizeHandlesLayer = createResizeHandlesLayer(options.editorHost)
  const resizePreview = createResizePreviewLine(options.editorHost)
  const state = createInitialTableControllerState()
  const toolbarRoot = readToolbarRoot()
  localizeTablePanelDom(dom, i18n, readTableTitle(i18n, options.table.title))
  syncTableToolbarMode(dom, toolbarRoot)
  toolbarRoot?.addEventListener('jword-toolbar-modechange', () => {
    syncTableToolbarMode(dom, readToolbarRoot())
  }, { signal: signalController.signal })

  /** 统一触发 live region 播报。 */
  function announce(message: string): void {
    liveRegion?.announce(message, { force: true })
  }

  /** 读取当前 editor 上下文。 */
  function readCommandContext(): JWordTableCommandContext {
    return {
      editor: options.editor,
      projection: options.editor.getProjection(),
      selection: options.editor.getSelection()
    }
  }

  /** 解析当前选区命中的表格目标。 */
  function readTarget(): JWordTableSelectionTarget | null {
    return commands.resolveActiveTableTarget?.(readCommandContext()) ?? null
  }

  /** 用当前状态重绘表格工具。 */
  function refresh(): void {
    syncTableToolbarMode(dom, readToolbarRoot())
    refreshTableControllerState(state, {
      editor: options.editor,
      editorHost: options.editorHost,
      readonlyMode,
      dom,
      contextMenu,
      resizeHandlesLayer,
      resizePreview,
      i18n,
      readTarget,
      startResizeSession: resizeController.startResizeSession
    })
  }

  /** 在一次操作完成后把焦点还给 editor。 */
  function restoreEditorFocusSoon(): void {
    queueMicrotask(() => {
      if (signalController.signal.aborted) {
        return
      }

      options.editor.focus()
    })
  }

  /** 关闭当前表格右键菜单。 */
  function closeContextMenu(): void {
    state.contextMenuTarget = null
    contextMenu.root.hidden = true
  }

  /** 读取当前表格扩展入口所属的 toolbar 根节点。 */
  function readToolbarRoot(): HTMLElement | null {
    return options.toolbarHost.closest<HTMLElement>('[data-jword-toolbar="true"]')
  }

  const actionController = createTableActionController({
    state,
    editor: options.editor,
    dom,
    commands,
    hiddenTextarea,
    contextMenu,
    signal: signalController.signal,
    readonlyMode,
    announce,
    readCommandContext,
    readTarget,
    refresh,
    restoreEditorFocusSoon,
    closeContextMenu
  })
  const resizeController = createTableResizeController({
    state,
    commands,
    resizePreview,
    signal: signalController.signal,
    readCommandContext,
    closeContextMenu,
    refresh,
    runAction: actionController.runAction
  })
  const unsubscribeEditor = options.editor.subscribe((event) => {
    if (event.kind === 'selectionChange' || event.kind === 'transaction') {
      refresh()
      return
    }

    if (event.kind === 'destroyed') {
      state.busy = false
      refresh()
      announce('JWord editor 已销毁，表格工具已关闭。')
    }
  })

  actionController.bindActionEvents()
  bindTableSelectionEvents({
    state,
    editor: options.editor,
    editorHost: options.editorHost,
    overlayHost,
    dom,
    contextMenu,
    resizeHandlesLayer,
    signal: signalController.signal,
    closeContextMenu,
    refresh,
    restoreEditorFocusSoon
  })
  resizeController.bindResizeEvents()
  refresh()

  return {
    elements: dom,
    setI18n(nextI18n): void {
      i18n = nextI18n
      localizeTablePanelDom(dom, i18n, readTableTitle(i18n, options.table.title))
      localizeTableContextMenu(contextMenu, i18n)
      refresh()
    },
    refresh,
    destroy(): void {
      resizeController.clearResizeSession()
      signalController.abort()
      unsubscribeEditor()
      contextMenu.root.remove()
      resizePreview.remove()
      resizeHandlesLayer.remove()
      destroyTablePanel(dom)
    }
  }
}

/** 读取表格入口标题，宿主自定义 title 优先。 */
function readTableTitle(i18n: ResolvedJWordUiI18n, title: string | undefined): string {
  return title ?? readJWordUiText(i18n, 'menu.table.insert', '插入表格')
}

/** 根据 toolbar 当前模式隐藏只属于专业表格 Tab 的结构操作。 */
function syncTableToolbarMode(dom: JWordTablePanelElements, toolbarRoot: HTMLElement | null): void {
  const actionRow = dom.host.querySelector<HTMLElement>('.jw-table-toolbar__action-row')

  if (actionRow === null) {
    return
  }

  const hidden = toolbarRoot?.getAttribute('data-jword-toolbar-mode') === 'common'

  actionRow.hidden = hidden
  actionRow.style.display = hidden ? 'none' : ''
  for (const button of actionRow.querySelectorAll<HTMLButtonElement>('[data-jword-table-action]')) {
    button.hidden = hidden
  }
}
