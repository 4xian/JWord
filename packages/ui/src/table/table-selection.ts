/**
 * 职责：处理 Gate 4 表格命中选择、右键菜单定位和全局收起事件。
 * 边界：不执行表格结构命令，不处理行列尺寸拖拽提交。
 * 协作模块：table controller 注入状态和生命周期，controller-helpers 提供表格 hit-test。
 * 性能/安全约束：只通过 editor facade 设置 selection/focus，不绕过 core transaction pipeline。
 * Specs：docs/superpowers/reports/2026-07-03-remediation-execution-supplement.md §3.10 S11。
 */
import type { Editor, SelectionState } from '@4xian/jword-core'
import type { JWordTablePanelElements } from '../types'
import {
  hitTestTablePoint,
  type TableContextMenuElements
} from './controller-helpers'
import type { TableControllerState } from './table-state-sync'

interface TableSelectionEventsOptions {
  readonly state: TableControllerState
  readonly editor: Editor
  readonly editorHost: HTMLElement
  readonly overlayHost: HTMLElement
  readonly dom: JWordTablePanelElements
  readonly contextMenu: TableContextMenuElements
  readonly resizeHandlesLayer: HTMLElement
  readonly signal: AbortSignal
  closeContextMenu(): void
  refresh(): void
  restoreEditorFocusSoon(): void
}

/** 读取 editor.mount 创建的内部定位宿主。 */
export function resolveEditorShell(editorHost: HTMLElement): HTMLElement {
  if (editorHost.matches('[data-jword-editor]')) {
    return editorHost
  }

  return editorHost.querySelector<HTMLElement>('[data-jword-editor]') ?? editorHost
}

/** 绑定表格选择和全局收起事件。 */
export function bindTableSelectionEvents(options: TableSelectionEventsOptions): void {
  options.editorHost.addEventListener('mousedown', (event) => {
    handleEditorMouseDown(options, event)
  }, { signal: options.signal })
  options.editorHost.addEventListener('contextmenu', (event) => {
    handleEditorContextMenu(options, event)
  }, { signal: options.signal })
  document.addEventListener('pointerdown', (event) => {
    handleOutsidePointerDown(options, event)
  }, { signal: options.signal })
  document.addEventListener('keydown', (event) => {
    handleGlobalKeyDown(options, event)
  }, { signal: options.signal })
}

/** 命中表格单元格后把 selection 放回 editor，保证点击后能进入可编辑态。 */
function handleEditorMouseDown(options: TableSelectionEventsOptions, event: MouseEvent): void {
  if (options.state.busy || event.button !== 0 || options.state.resizeSession !== null) {
    return
  }

  const hit = hitTestTablePoint(options.editor, event)

  if (hit === null) {
    return
  }

  options.closeContextMenu()
  setEditorSelection(options.editor, hit.selection)
  options.editor.focus()
  options.state.helperAnchorsVisible = true
  options.state.quickToolsVisible = false
  options.refresh()
}

/** 只在表格命中时弹出表格专用右键菜单。 */
function handleEditorContextMenu(options: TableSelectionEventsOptions, event: MouseEvent): void {
  const hit = hitTestTablePoint(options.editor, event)

  if (hit === null) {
    options.closeContextMenu()
    options.refresh()
    return
  }

  event.preventDefault()
  event.stopImmediatePropagation()
  setEditorSelection(options.editor, hit.selection)
  options.state.helperAnchorsVisible = true
  options.state.quickToolsVisible = false
  options.state.contextMenuTarget = hit.target
  const hostRect = options.overlayHost.getBoundingClientRect()
  options.contextMenu.root.hidden = false
  options.contextMenu.root.style.left = `${event.clientX - hostRect.left}px`
  options.contextMenu.root.style.top = `${event.clientY - hostRect.top}px`
  options.refresh()
  options.restoreEditorFocusSoon()
}

/** 点击组件外部时关闭插入面板。 */
function handleOutsidePointerDown(options: TableSelectionEventsOptions, event: PointerEvent): void {
  if (
    !(event.target instanceof Node)
    || options.dom.host.contains(event.target)
    || options.dom.customSizeDialog.contains(event.target)
    || options.dom.overlay.contains(event.target)
    || options.resizeHandlesLayer.contains(event.target)
    || options.contextMenu.root.contains(event.target)
  ) {
    return
  }

  if (isTransientUiClosed(options)) {
    return
  }

  options.state.insertMenuOpen = false
  options.state.customSizeDialogOpen = false
  options.state.helperAnchorsVisible = false
  options.state.quickToolsVisible = false
  options.closeContextMenu()
  options.refresh()
}

/** Escape 收起表格下拉或二级弹窗。 */
function handleGlobalKeyDown(options: TableSelectionEventsOptions, event: KeyboardEvent): void {
  if (event.key !== 'Escape') {
    return
  }

  if (isTransientUiClosed(options)) {
    return
  }

  options.state.insertMenuOpen = false
  options.state.customSizeDialogOpen = false
  options.state.helperAnchorsVisible = false
  options.state.quickToolsVisible = false
  options.closeContextMenu()
  options.refresh()
}

/** 判断当前临时浮层是否已经全部关闭。 */
function isTransientUiClosed(options: TableSelectionEventsOptions): boolean {
  return !options.state.insertMenuOpen
    && !options.state.customSizeDialogOpen
    && !options.state.helperAnchorsVisible
    && !options.state.quickToolsVisible
    && options.contextMenu.root.hidden === true
}

/** 通过 editor facade 写回 selection。 */
function setEditorSelection(editor: Editor, selection: SelectionState): void {
  editor.setSelection(selection)
}
