/**
 * 职责：驱动 Gate 4 表格工具栏，连接宿主命令适配器、当前选区解析和最小行列操作。
 * 边界：不实现 core table builder 或 demo 业务；这里只维护 UI 状态并调度宿主注入的命令适配器。
 * 协作模块：create-ui 负责装配，table dom 负责节点结构，宿主通过 table options 注入命令桥接。
 * 性能/安全约束：所有表格写入都必须继续走 editor facade 的 transaction pipeline，不旁路修改 projection。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md Step 4.7。
 */
import {
  createSelectionState,
  type Editor, type SelectionState
} from '@4xian/jword-core'
import type {
  JWordTableCommandContext,
  JWordTableCommandResult,
  JWordTableOptions,
  JWordTablePanelElements,
  JWordReadonlyMode,
  JWordTableSelectionTarget,
  JWordUiLiveRegionController
} from '../types'
import { createTablePanelDom, destroyTablePanel, renderTablePanel } from './dom'
import {
  collectClipboardBuffer,
  createClipboardData,
  createResizeHandlesLayer,
  createResizePreviewLine,
  createTableContextMenu,
  dispatchClipboardEvent,
  findTableBox,
  hitTestTablePoint,
  preventDefaultEvent,
  readPreviewDimension,
  readTableErrorMessage,
  requireHiddenTextarea,
  resolveTableOverlayGeometry,
  runNativeExecCommand,
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
  canMergeCellWithRight,
  readDefaultDeferredMessage,
  normalizeTableDimension
} from './state'

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

interface TableResizeSession {
  readonly axis: 'column' | 'row'
  readonly index: number
  readonly startClientX: number
  readonly startClientY: number
  readonly previewStart: TableResizePreviewGeometry
  readonly startValueTwips: number
  readonly scale: number
  readonly target: JWordTableSelectionTarget
}

const MIN_TABLE_COLUMN_WIDTH_TWIPS = 720
const MIN_TABLE_ROW_HEIGHT_TWIPS = 360

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
  const readonlyMode = options.readonly === true || (typeof options.readonly === 'object' && options.readonly.enabled === true)
  const contextMenu = createTableContextMenu(options.editorHost)
  const resizeHandlesLayer = createResizeHandlesLayer(options.editorHost)
  const resizePreview = createResizePreviewLine(options.editorHost)
  let insertRows = 2
  let insertColumns = 2
  let previewRows = 1
  let previewColumns = 1
  let insertMenuOpen = false
  let customSizeDialogOpen = false
  let busy = false
  let helperAnchorsVisible = false
  let quickToolsVisible = false
  let resizeSession: TableResizeSession | null = null
  let contextMenuTarget: JWordTableSelectionTarget | null = null
  const unsubscribeEditor = options.editor.subscribe((event) => {
    if (event.kind === 'selectionChange' || event.kind === 'transaction') {
      refresh()
      return
    }

    if (event.kind === 'destroyed') {
      busy = false
      refresh()
      announce('JWord editor 已销毁，表格工具已关闭。')
    }
  })

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
    if (readonlyMode) {
      helperAnchorsVisible = false
      quickToolsVisible = false
      contextMenuTarget = null
      renderTablePanel(dom, {
        summary: '',
        insertRows,
        insertColumns,
        previewRows,
        previewColumns,
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
      syncOverlay(dom, null, false)
      syncResizeHandles(resizeHandlesLayer, null, null, false, true, () => {})
      syncTableContextMenu(contextMenu, null, null, true)
      syncResizePreview(resizePreview, null)
      return
    }

    const target = readTarget()
    const layout = options.editor.getLayout()
    const overlayGeometry = target === null
      ? null
      : resolveTableOverlayGeometry(layout, options.editorHost, target)
    const tableBox = target === null ? null : findTableBox(layout, target.tableId)
    const targetAvailable = target !== null
    if (!targetAvailable) {
      helperAnchorsVisible = false
      quickToolsVisible = false
      contextMenuTarget = null
    }

    renderTablePanel(dom, {
      summary: '',
      insertRows,
      insertColumns,
      previewRows,
      previewColumns,
      insertMenuOpen,
      customSizeDialogOpen,
      helperAnchorsVisible,
      quickToolsVisible,
      targetAvailable,
      canDeleteRow: canDeleteTargetRow(target),
      canDeleteColumn: canDeleteTargetColumn(target),
      canMergeRight: canMergeCellWithRight(target),
      busy
    })

    syncOverlay(dom, overlayGeometry, targetAvailable)
    syncResizeHandles(
      resizeHandlesLayer,
      overlayGeometry,
      tableBox,
      targetAvailable,
      busy,
      (event) => {
        startResizeSession(event, target, tableBox, overlayGeometry)
      }
    )
    syncTableContextMenu(contextMenu, contextMenuTarget, target ?? readTarget(), busy)
    if (resizeSession === null) {
      syncResizePreview(resizePreview, null)
    }
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
    contextMenuTarget = null
    contextMenu.root.hidden = true
  }

  /** 统一执行命令型动作。 */
  async function runAction(
    actionLabel: string,
    runner: () => JWordTableCommandResult | Promise<JWordTableCommandResult>
  ): Promise<void> {
    if (readonlyMode) {
      announce('当前为只读模式。')
      return
    }

    if (busy) {
      return
    }

    busy = true
    refresh()

    try {
      const result = await runner()
      const message = result.message ?? (
        result.kind === 'applied'
          ? `${actionLabel}已完成。`
          : readDefaultDeferredMessage(actionLabel)
      )

      announce(message)
    } catch (error) {
      announce(readTableErrorMessage(error))
    } finally {
      busy = false
      refresh()
      restoreEditorFocusSoon()
    }
  }

  /** 绑定所有 DOM 事件。 */
  function bindEvents(): void {
    dom.insertTriggerButton.addEventListener('click', () => {
      if (readonlyMode) {
        announce('当前为只读模式。')
        return
      }

      if (busy) {
        return
      }

      insertMenuOpen = !insertMenuOpen
      if (insertMenuOpen) {
        customSizeDialogOpen = false
        helperAnchorsVisible = false
        quickToolsVisible = false
      }
      refresh()
    })
    dom.topAnchor.addEventListener('click', () => {
      if (readonlyMode) {
        announce('当前为只读模式。')
        return
      }

      if (busy || readTarget() === null) {
        return
      }

      insertMenuOpen = false
      customSizeDialogOpen = false
      helperAnchorsVisible = true
      quickToolsVisible = true
      refresh()
      restoreEditorFocusSoon()
    })
    dom.leftAnchor.addEventListener('click', () => {
      if (readonlyMode) {
        announce('当前为只读模式。')
        return
      }

      if (busy || readTarget() === null) {
        return
      }

      insertMenuOpen = false
      customSizeDialogOpen = false
      helperAnchorsVisible = true
      quickToolsVisible = true
      refresh()
      restoreEditorFocusSoon()
    })
    for (const button of dom.insertPreviewButtons) {
      button.addEventListener('pointerenter', () => {
        previewRows = readPreviewDimension(button.dataset.jwordRows, previewRows)
        previewColumns = readPreviewDimension(button.dataset.jwordColumns, previewColumns)
        insertRows = previewRows
        insertColumns = previewColumns
        refresh()
      })
      button.addEventListener('click', () => {
        if (readonlyMode) {
          announce('当前为只读模式。')
          return
        }

        previewRows = readPreviewDimension(button.dataset.jwordRows, previewRows)
        previewColumns = readPreviewDimension(button.dataset.jwordColumns, previewColumns)
        insertRows = previewRows
        insertColumns = previewColumns
        customSizeDialogOpen = false
        insertMenuOpen = false
        void runInsertTableAction()
      })
    }
    dom.customSizeButton.addEventListener('click', () => {
      if (readonlyMode) {
        announce('当前为只读模式。')
        return
      }

      if (busy) {
        return
      }

      customSizeDialogOpen = true
      refresh()
      dom.insertRowsInput.focus()
    })
    dom.customSizeCancelButton.addEventListener('click', () => {
      customSizeDialogOpen = false
      refresh()
    })
    options.editorHost.addEventListener('mousedown', handleEditorMouseDown, { signal: signalController.signal })
    options.editorHost.addEventListener('contextmenu', handleEditorContextMenu, { signal: signalController.signal })
    document.addEventListener('pointerdown', handleOutsidePointerDown, { signal: signalController.signal })
    document.addEventListener('pointermove', handleDocumentPointerMove, { signal: signalController.signal })
    document.addEventListener('pointerup', handleDocumentPointerUp, { signal: signalController.signal })
    document.addEventListener('keydown', handleGlobalKeyDown, { signal: signalController.signal })
    bindTableContextMenuEvents()
    dom.insertRowsInput.addEventListener('change', () => {
      insertRows = normalizeTableDimension(dom.insertRowsInput.value, insertRows)
      refresh()
    })
    dom.insertColumnsInput.addEventListener('change', () => {
      insertColumns = normalizeTableDimension(dom.insertColumnsInput.value, insertColumns)
      refresh()
    })
    dom.insertConfirmButton.addEventListener('click', () => {
      insertRows = normalizeTableDimension(dom.insertRowsInput.value, insertRows)
      insertColumns = normalizeTableDimension(dom.insertColumnsInput.value, insertColumns)
      customSizeDialogOpen = false
      insertMenuOpen = false

      void runInsertTableAction()
    })
    dom.insertRowBeforeButton.addEventListener('click', () => {
      void runTargetAction('在当前行上方插入一行', (target) => {
        return commands.insertRow?.({
          ...readCommandContext(),
          target,
          placement: 'before'
        }) ?? {
          kind: 'deferred',
          message: readDefaultDeferredMessage('插入行')
        }
      })
    })
    dom.insertRowAfterButton.addEventListener('click', () => {
      void runTargetAction('在当前行下方插入一行', (target) => {
        return commands.insertRow?.({
          ...readCommandContext(),
          target,
          placement: 'after'
        }) ?? {
          kind: 'deferred',
          message: readDefaultDeferredMessage('插入行')
        }
      })
    })
    dom.deleteRowButton.addEventListener('click', () => {
      void runTargetAction('删除当前行', (target) => {
        return commands.deleteRow?.({
          ...readCommandContext(),
          target
        }) ?? {
          kind: 'deferred',
          message: readDefaultDeferredMessage('删除行')
        }
      })
    })
    dom.insertColumnBeforeButton.addEventListener('click', () => {
      void runTargetAction('在当前列左侧插入一列', (target) => {
        return commands.insertColumn?.({
          ...readCommandContext(),
          target,
          placement: 'before'
        }) ?? {
          kind: 'deferred',
          message: readDefaultDeferredMessage('插入列')
        }
      })
    })
    dom.insertColumnAfterButton.addEventListener('click', () => {
      void runTargetAction('在当前列右侧插入一列', (target) => {
        return commands.insertColumn?.({
          ...readCommandContext(),
          target,
          placement: 'after'
        }) ?? {
          kind: 'deferred',
          message: readDefaultDeferredMessage('插入列')
        }
      })
    })
    dom.deleteColumnButton.addEventListener('click', () => {
      void runTargetAction('删除当前列', (target) => {
        return commands.deleteColumn?.({
          ...readCommandContext(),
          target
        }) ?? {
          kind: 'deferred',
          message: readDefaultDeferredMessage('删除列')
        }
      })
    })
    dom.mergeRightButton.addEventListener('click', () => {
      void runTargetAction('合并当前单元格与右侧单元格', (target) => {
        return commands.mergeCellWithRight?.({
          ...readCommandContext(),
          target
        }) ?? {
          kind: 'deferred',
          message: readDefaultDeferredMessage('合并单元格')
        }
      })
    })
  }

  /** 执行插入表格命令。 */
  function runInsertTableAction(): Promise<void> {
    helperAnchorsVisible = false
    quickToolsVisible = false
    return runAction('插入表格', () => {
      return commands.insertTable?.({
        ...readCommandContext(),
        rows: insertRows,
        columns: insertColumns
      }) ?? {
        kind: 'deferred',
        message: readDefaultDeferredMessage('插入表格')
      }
    })
  }

  /** 点击组件外部时关闭插入面板。 */
  function handleOutsidePointerDown(event: PointerEvent): void {
    if (
      !(event.target instanceof Node)
      || dom.host.contains(event.target)
      || dom.customSizeDialog.contains(event.target)
      || dom.overlay.contains(event.target)
      || resizeHandlesLayer.contains(event.target)
      || contextMenu.root.contains(event.target)
    ) {
      return
    }

    if (!insertMenuOpen && !customSizeDialogOpen && !helperAnchorsVisible && !quickToolsVisible && contextMenu.root.hidden) {
      return
    }

    insertMenuOpen = false
    customSizeDialogOpen = false
    helperAnchorsVisible = false
    quickToolsVisible = false
    closeContextMenu()
    refresh()
  }

  /** Escape 收起表格下拉或二级弹窗。 */
  function handleGlobalKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') {
      return
    }

    if (!insertMenuOpen && !customSizeDialogOpen && !helperAnchorsVisible && !quickToolsVisible && contextMenu.root.hidden) {
      return
    }

    insertMenuOpen = false
    customSizeDialogOpen = false
    helperAnchorsVisible = false
    quickToolsVisible = false
    closeContextMenu()
    refresh()
  }

  /** 统一执行“必须依赖当前表格目标”的动作。 */
  async function runTargetAction(
    actionLabel: string,
    runner: (target: JWordTableSelectionTarget) => JWordTableCommandResult | Promise<JWordTableCommandResult>
  ): Promise<void> {
    const target = readTarget()

    if (target === null) {
      announce('当前没有命中表格单元格，无法执行该操作。')
      restoreEditorFocusSoon()
      return
    }

    await runAction(actionLabel, () => runner(target))
  }

  /** 命中表格单元格后把 selection 放回 editor，保证点击后能进入可编辑态。 */
  function handleEditorMouseDown(event: MouseEvent): void {
    if (busy || event.button !== 0 || resizeSession !== null) {
      return
    }

    const hit = hitTestTablePoint(options.editor, event)

    if (hit === null) {
      return
    }

    closeContextMenu()
    options.editor.setSelection(hit.selection)
    options.editor.focus()
    helperAnchorsVisible = true
    quickToolsVisible = false
    refresh()
  }

  /** 只在表格命中时弹出表格专用右键菜单。 */
  function handleEditorContextMenu(event: MouseEvent): void {
    const hit = hitTestTablePoint(options.editor, event)

    if (hit === null) {
      closeContextMenu()
      refresh()
      return
    }

    event.preventDefault()
    event.stopImmediatePropagation()
    options.editor.setSelection(hit.selection)
    helperAnchorsVisible = true
    quickToolsVisible = false
    contextMenuTarget = hit.target
    const hostRect = options.editorHost.getBoundingClientRect()
    contextMenu.root.hidden = false
    contextMenu.root.style.left = `${event.clientX - hostRect.left}px`
    contextMenu.root.style.top = `${event.clientY - hostRect.top}px`
    refresh()
    restoreEditorFocusSoon()
  }

  /** 统一响应尺寸拖拽中的 pointermove。 */
  function startResizeSession(
    event: PointerEvent,
    target: JWordTableSelectionTarget | null,
    tableBox: TableLayoutBox | null,
    overlayGeometry: Readonly<{
      left: number
      top: number
      width: number
      height: number
    }> | null
  ): void {
    const handle = event.currentTarget

    if (
      busy
      || !(handle instanceof HTMLButtonElement)
      || target === null
      || tableBox === null
      || overlayGeometry === null
    ) {
      return
    }

    const descriptor = handle.getAttribute('data-jword-table-resize-handle')
      ?? handle.getAttribute('data-jword-table-resize-handle-segment')

    if (descriptor === null) {
      return
    }

    const match = /^(column|row)-(\d+)$/.exec(descriptor)

    if (match === null) {
      return
    }

    const axis = match[1] === 'column' ? 'column' : 'row'
    const index = Number.parseInt(match[2] ?? '-1', 10)

    if (!Number.isInteger(index) || index < 0) {
      return
    }

    const startValueTwips = axis === 'column'
      ? tableBox.grid[index]
      : tableBox.rows[index]?.height

    if (startValueTwips === undefined) {
      return
    }

    event.preventDefault()
    closeContextMenu()
    const previewStart: TableResizePreviewGeometry = {
      axis,
      left: axis === 'column' ? Number.parseFloat(handle.style.left || '0') + 2 : overlayGeometry.left,
      top: axis === 'column' ? overlayGeometry.top : Number.parseFloat(handle.style.top || '0') + 2,
      width: axis === 'column' ? 2 : Math.max(12, Math.round(overlayGeometry.width)),
      height: axis === 'column' ? Math.max(12, Math.round(overlayGeometry.height)) : 2
    }
    resizeSession = {
      axis,
      index,
      startClientX: event.clientX,
      startClientY: event.clientY,
      previewStart,
      startValueTwips,
      scale: axis === 'column'
        ? (tableBox.width === 0 ? 1 : overlayGeometry.width / tableBox.width)
        : (tableBox.height === 0 ? 1 : overlayGeometry.height / tableBox.height),
      target
    }
    handle.setPointerCapture?.(event.pointerId)
    syncResizePreview(resizePreview, previewStart)
    refresh()
  }

  /** 拖拽中实时移动蓝色预览线。 */
  function handleDocumentPointerMove(event: PointerEvent): void {
    if (resizeSession === null) {
      return
    }

    event.preventDefault()
    const deltaCssPx = resizeSession.axis === 'column'
      ? event.clientX - resizeSession.startClientX
      : event.clientY - resizeSession.startClientY
    const deltaTwips = deltaCssPx / Math.max(0.01, resizeSession.scale)
    const nextValue = Math.round(resizeSession.startValueTwips + deltaTwips)

    syncResizePreview(resizePreview, {
      axis: resizeSession.axis,
      left: resizeSession.axis === 'column'
        ? Math.round(resizeSession.previewStart.left + deltaCssPx)
        : resizeSession.previewStart.left,
      top: resizeSession.axis === 'column'
        ? resizeSession.previewStart.top
        : Math.round(resizeSession.previewStart.top + deltaCssPx),
      width: resizeSession.previewStart.width,
      height: resizeSession.previewStart.height
    })
    resizePreview.setAttribute(
      'data-jword-preview-value',
      String(resizeSession.axis === 'column'
        ? Math.max(MIN_TABLE_COLUMN_WIDTH_TWIPS, nextValue)
        : Math.max(MIN_TABLE_ROW_HEIGHT_TWIPS, nextValue))
    )
  }

  /** pointerup 时提交尺寸命令。 */
  function handleDocumentPointerUp(event: PointerEvent): void {
    const session = resizeSession

    if (session === null) {
      return
    }

    resizeSession = null
    resizePreview.removeAttribute('data-jword-preview-value')
    syncResizePreview(resizePreview, null)

    const deltaCssPx = session.axis === 'column'
      ? event.clientX - session.startClientX
      : event.clientY - session.startClientY
    const deltaTwips = deltaCssPx / Math.max(0.01, session.scale)

    if (session.axis === 'column') {
      const widthTwips = Math.max(MIN_TABLE_COLUMN_WIDTH_TWIPS, Math.round(session.startValueTwips + deltaTwips))

      void runAction('调整列宽', () => {
        return commands.setColumnWidth?.({
          ...readCommandContext(),
          target: session.target,
          columnIndex: session.index,
          widthTwips
        }) ?? {
          kind: 'deferred',
          message: readDefaultDeferredMessage('调整列宽')
        }
      })
      return
    }

    const heightTwips = Math.max(MIN_TABLE_ROW_HEIGHT_TWIPS, Math.round(session.startValueTwips + deltaTwips))

    void runAction('调整行高', () => {
      return commands.setRowHeight?.({
        ...readCommandContext(),
        target: session.target,
        rowIndex: session.index,
        heightTwips
      }) ?? {
        kind: 'deferred',
        message: readDefaultDeferredMessage('调整行高')
      }
    })
  }

  /** 绑定表格右键菜单按钮。 */
  function bindTableContextMenuEvents(): void {
    bindContextMenuButton(contextMenu.copyButton, () => {
      void copySelectionToClipboard(cloneCurrentSelection())
    })
    bindContextMenuButton(contextMenu.cutButton, () => {
      void cutSelectionToClipboard(cloneCurrentSelection())
    })
    bindContextMenuButton(contextMenu.pasteButton, () => {
      void pastePlainTextFromClipboard(cloneCurrentSelection())
    })
    bindContextMenuButton(contextMenu.insertRowBeforeButton, () => {
      void runContextTargetAction('插入行', (target) => {
        return commands.insertRow?.({
          ...readCommandContext(),
          target,
          placement: 'before'
        }) ?? {
          kind: 'deferred',
          message: readDefaultDeferredMessage('插入行')
        }
      })
    })
    bindContextMenuButton(contextMenu.insertRowAfterButton, () => {
      void runContextTargetAction('插入行', (target) => {
        return commands.insertRow?.({
          ...readCommandContext(),
          target,
          placement: 'after'
        }) ?? {
          kind: 'deferred',
          message: readDefaultDeferredMessage('插入行')
        }
      })
    })
    bindContextMenuButton(contextMenu.deleteRowButton, () => {
      void runContextTargetAction('删除行', (target) => {
        return commands.deleteRow?.({
          ...readCommandContext(),
          target
        }) ?? {
          kind: 'deferred',
          message: readDefaultDeferredMessage('删除行')
        }
      })
    })
    bindContextMenuButton(contextMenu.insertColumnBeforeButton, () => {
      void runContextTargetAction('插入列', (target) => {
        return commands.insertColumn?.({
          ...readCommandContext(),
          target,
          placement: 'before'
        }) ?? {
          kind: 'deferred',
          message: readDefaultDeferredMessage('插入列')
        }
      })
    })
    bindContextMenuButton(contextMenu.insertColumnAfterButton, () => {
      void runContextTargetAction('插入列', (target) => {
        return commands.insertColumn?.({
          ...readCommandContext(),
          target,
          placement: 'after'
        }) ?? {
          kind: 'deferred',
          message: readDefaultDeferredMessage('插入列')
        }
      })
    })
    bindContextMenuButton(contextMenu.deleteColumnButton, () => {
      void runContextTargetAction('删除列', (target) => {
        return commands.deleteColumn?.({
          ...readCommandContext(),
          target
        }) ?? {
          kind: 'deferred',
          message: readDefaultDeferredMessage('删除列')
        }
      })
    })
    bindContextMenuButton(contextMenu.mergeRightButton, () => {
      void runContextTargetAction('合并单元格', (target) => {
        return commands.mergeCellWithRight?.({
          ...readCommandContext(),
          target
        }) ?? {
          kind: 'deferred',
          message: readDefaultDeferredMessage('合并单元格')
        }
      })
    })
  }

  /** 从当前 selection 读取一份可复用快照。 */
  function cloneCurrentSelection(): SelectionState | null {
    const selection = options.editor.getSelection()

    if (selection === null) {
      return null
    }

    return createSelectionState(selection.anchor, selection.focus, {
      affinity: selection.affinity
    })
  }

  /** 运行依赖当前 context target 的动作。 */
  function runContextTargetAction(
    actionLabel: string,
    runner: (target: JWordTableSelectionTarget) => JWordTableCommandResult | Promise<JWordTableCommandResult>
  ): Promise<void> {
    const target = contextMenuTarget

    if (target === null) {
      announce('当前没有命中表格单元格，无法执行该操作。')
      closeContextMenu()
      refresh()
      return Promise.resolve()
    }

    closeContextMenu()
    return runAction(actionLabel, () => runner(target))
  }

  /** 绑定表格右键菜单按钮并阻止抢焦点。 */
  function bindContextMenuButton(target: HTMLButtonElement, handler: () => void): void {
    target.addEventListener('pointerdown', preventDefaultEvent, { signal: signalController.signal })
    target.addEventListener('mousedown', preventDefaultEvent, { signal: signalController.signal })
    target.addEventListener('click', () => {
      if (!target.disabled) {
        handler()
      }
    }, { signal: signalController.signal })
  }

  /** 写系统剪贴板。 */
  async function copySelectionToClipboard(selection: SelectionState | null): Promise<void> {
    if (selection === null) {
      announce('当前没有可复制的表格内容。')
      return
    }

    const clipboard = navigator.clipboard

    if (clipboard === undefined || typeof clipboard.writeText !== 'function') {
      if (!runNativeExecCommand('copy')) {
        announce('当前浏览器拒绝写入系统剪贴板。')
      }
      return
    }

    options.editor.setSelection(selection)
    const buffer = collectClipboardBuffer(hiddenTextarea, 'copy')

    if (buffer.plainText.length === 0) {
      announce('当前没有可复制的表格内容。')
      return
    }

    await clipboard.writeText(buffer.plainText)
    closeContextMenu()
    restoreEditorFocusSoon()
  }

  /** 剪切当前表格内容。 */
  async function cutSelectionToClipboard(selection: SelectionState | null): Promise<void> {
    if (selection === null) {
      announce('当前没有可剪切的表格内容。')
      return
    }

    const clipboard = navigator.clipboard

    if (clipboard === undefined || typeof clipboard.writeText !== 'function') {
      if (!runNativeExecCommand('cut')) {
        announce('当前浏览器拒绝执行剪切。')
      }
      return
    }

    options.editor.setSelection(selection)
    const buffer = collectClipboardBuffer(hiddenTextarea, 'copy')

    if (buffer.plainText.length === 0) {
      announce('当前没有可剪切的表格内容。')
      return
    }

    await clipboard.writeText(buffer.plainText)
    dispatchClipboardEvent(hiddenTextarea, 'cut', createClipboardData({
      plainText: '',
      htmlText: ''
    }))
    closeContextMenu()
    restoreEditorFocusSoon()
  }

  /** 读取系统剪贴板并走 facade paste 通道。 */
  async function pastePlainTextFromClipboard(selection: SelectionState | null): Promise<void> {
    const clipboard = navigator.clipboard

    if (clipboard === undefined || typeof clipboard.readText !== 'function') {
      announce('当前浏览器不允许读取系统剪贴板。')
      return
    }

    const text = await clipboard.readText()

    if (text.length === 0) {
      announce('系统剪贴板当前没有文本内容。')
      return
    }

    if (selection !== null) {
      options.editor.setSelection(selection)
    } else {
      options.editor.focus()
    }

    dispatchClipboardEvent(hiddenTextarea, 'paste', createClipboardData({
      plainText: text,
      htmlText: text
    }))
    closeContextMenu()
    restoreEditorFocusSoon()
  }

  bindEvents()
  refresh()

  return {
    elements: dom,
    refresh,
    destroy(): void {
      resizeSession = null
      signalController.abort()
      unsubscribeEditor()
      contextMenu.root.remove()
      resizePreview.remove()
      resizeHandlesLayer.remove()
      destroyTablePanel(dom)
    }
  }
}
