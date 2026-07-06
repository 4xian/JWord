/**
 * 职责：同步 Gate 4 表格 controller 的可变 UI 状态到 DOM 与辅助浮层。
 * 边界：不绑定事件、不执行表格命令，只根据当前状态和 editor 只读投影刷新视图。
 * 协作模块：table controller 持有生命周期，controller-helpers 提供几何与浮层同步，state 提供按钮可用态。
 * 性能/安全约束：只读取 editor projection/layout，不直接修改文档，所有写入仍由 table actions 走 transaction pipeline。
 * Specs：docs/superpowers/reports/2026-07-03-remediation-execution-supplement.md §3.10 S11。
 */
import type { Editor } from '@4xian/jword-core'
import type { JWordTablePanelElements, JWordTableSelectionTarget } from '../types'
import { renderTablePanel } from './dom'
import {
  findTableBox,
  resolveTableOverlayGeometry,
  syncOverlay,
  syncResizeHandles,
  syncResizePreview,
  syncTableContextMenu,
  type TableContextMenuElements,
  type TableLayoutBox,
  type TableResizePreviewGeometry
} from './controller-helpers'
import {
  canDeleteTargetColumn,
  canDeleteTargetRow,
  canMergeCellWithRight
} from './state'

export interface TableOverlayGeometry {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

export interface TableResizeSession {
  readonly axis: 'column' | 'row'
  readonly index: number
  readonly startClientX: number
  readonly startClientY: number
  readonly previewStart: TableResizePreviewGeometry
  readonly startValueTwips: number
  readonly scale: number
  readonly target: JWordTableSelectionTarget
}

export interface TableControllerState {
  insertRows: number
  insertColumns: number
  previewRows: number
  previewColumns: number
  insertMenuOpen: boolean
  customSizeDialogOpen: boolean
  busy: boolean
  helperAnchorsVisible: boolean
  quickToolsVisible: boolean
  resizeSession: TableResizeSession | null
  contextMenuTarget: JWordTableSelectionTarget | null
}

export interface TableStateSyncOptions {
  readonly editor: Editor
  readonly editorHost: HTMLElement
  readonly readonlyMode: boolean
  readonly dom: JWordTablePanelElements
  readonly contextMenu: TableContextMenuElements
  readonly resizeHandlesLayer: HTMLElement
  readonly resizePreview: HTMLElement
  readTarget(): JWordTableSelectionTarget | null
  startResizeSession(
    event: PointerEvent,
    target: JWordTableSelectionTarget | null,
    tableBox: TableLayoutBox | null,
    overlayGeometry: TableOverlayGeometry | null
  ): void
}

/** 创建表格 controller 的初始可变状态。 */
export function createInitialTableControllerState(): TableControllerState {
  return {
    insertRows: 2,
    insertColumns: 2,
    previewRows: 1,
    previewColumns: 1,
    insertMenuOpen: false,
    customSizeDialogOpen: false,
    busy: false,
    helperAnchorsVisible: false,
    quickToolsVisible: false,
    resizeSession: null,
    contextMenuTarget: null
  }
}

/** 用当前状态重绘表格工具。 */
export function refreshTableControllerState(
  state: TableControllerState,
  options: TableStateSyncOptions
): void {
  if (options.readonlyMode) {
    state.helperAnchorsVisible = false
    state.quickToolsVisible = false
    state.contextMenuTarget = null
    renderTablePanel(options.dom, {
      summary: '',
      insertRows: state.insertRows,
      insertColumns: state.insertColumns,
      previewRows: state.previewRows,
      previewColumns: state.previewColumns,
      insertMenuOpen: false,
      customSizeDialogOpen: false,
      helperAnchorsVisible: false,
      quickToolsVisible: false,
      targetAvailable: false,
      canDeleteRow: false,
      canDeleteColumn: false,
      canMergeRight: false,
      busy: true
    })
    syncOverlay(options.dom, null, false)
    syncResizeHandles(options.resizeHandlesLayer, null, null, false, true, () => {})
    syncTableContextMenu(options.contextMenu, null, null, true)
    syncResizePreview(options.resizePreview, null)
    return
  }

  const target = options.readTarget()
  const targetAvailable = target !== null
  const layout = targetAvailable ? options.editor.getLayout() : null
  const overlayGeometry = target === null || layout === null
    ? null
    : resolveTableOverlayGeometry(layout, options.editorHost, target)
  const tableBox = target === null || layout === null ? null : findTableBox(layout, target.tableId)

  if (!targetAvailable) {
    state.helperAnchorsVisible = false
    state.quickToolsVisible = false
    state.contextMenuTarget = null
  }

  renderTablePanel(options.dom, {
    summary: '',
    insertRows: state.insertRows,
    insertColumns: state.insertColumns,
    previewRows: state.previewRows,
    previewColumns: state.previewColumns,
    insertMenuOpen: state.insertMenuOpen,
    customSizeDialogOpen: state.customSizeDialogOpen,
    helperAnchorsVisible: state.helperAnchorsVisible,
    quickToolsVisible: state.quickToolsVisible,
    targetAvailable,
    canDeleteRow: canDeleteTargetRow(target),
    canDeleteColumn: canDeleteTargetColumn(target),
    canMergeRight: canMergeCellWithRight(target),
    busy: state.busy
  })

  syncOverlay(options.dom, overlayGeometry, targetAvailable)
  syncResizeHandles(
    options.resizeHandlesLayer,
    overlayGeometry,
    tableBox,
    targetAvailable,
    state.busy,
    (event) => {
      options.startResizeSession(event, target, tableBox, overlayGeometry)
    }
  )
  syncTableContextMenu(options.contextMenu, state.contextMenuTarget, target ?? options.readTarget(), state.busy)
  if (state.resizeSession === null) {
    syncResizePreview(options.resizePreview, null)
  }
}
