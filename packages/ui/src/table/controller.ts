/**
 * 职责：驱动 Gate 4 表格工具栏生命周期，装配状态同步、动作、选择和 resize 子控制器。
 * 边界：不实现 core table builder 或 demo 业务；这里只维护 UI 生命周期并调度宿主注入的命令适配器。
 * 协作模块：create-ui 负责装配，table dom 负责节点结构，宿主通过 table options 注入命令桥接。
 * 性能/安全约束：所有表格写入都必须继续走 editor facade 的 transaction pipeline，不旁路修改 projection。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md Step 4.7。
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
import { createTablePanelDom, destroyTablePanel } from './dom'
import {
  createResizeHandlesLayer,
  createResizePreviewLine,
  createTableContextMenu,
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
  readonly assistive: {
    readonly liveRegion: JWordUiLiveRegionController | null
  }
}

interface TableControllerHandle {
  readonly elements: JWordTablePanelElements
  refresh(): void
  destroy(): void
}

/** 创建 Gate 4 表格工具栏 controller。 */
export function createTableController(options: CreateTableControllerOptions): TableControllerHandle {
  const dom = createTablePanelDom(
    options.toolbarHost,
    options.editorHost,
    options.table.title ?? '表格'
  )
  const commands = options.table.commands
  const liveRegion = options.assistive.liveRegion
  const signalController = new AbortController()
  const hiddenTextarea = requireHiddenTextarea(options.editorHost)
  const overlayHost = resolveEditorShell(options.editorHost)
  const readonlyMode = options.readonly === true || (typeof options.readonly === 'object' && options.readonly.enabled === true)
  const contextMenu = createTableContextMenu(overlayHost)
  const resizeHandlesLayer = createResizeHandlesLayer(options.editorHost)
  const resizePreview = createResizePreviewLine(options.editorHost)
  const state = createInitialTableControllerState()

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
    refreshTableControllerState(state, {
      editor: options.editor,
      editorHost: options.editorHost,
      readonlyMode,
      dom,
      contextMenu,
      resizeHandlesLayer,
      resizePreview,
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
