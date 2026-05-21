/**
 * 职责：驱动 Gate 4 表格工具栏，连接宿主命令适配器、当前选区解析和最小行列边框操作。
 * 边界：不实现 core table builder 或 demo 业务；这里只维护 UI 状态并调度宿主注入的命令适配器。
 * 协作模块：create-ui 负责装配，table dom 负责节点结构，宿主通过 table options 注入命令桥接。
 * 性能/安全约束：所有表格写入都必须继续走 editor facade 的 transaction pipeline，不旁路修改 projection。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md Step 4.7。
 */
import {
  cssPxToTwips,
  createSelectionState,
  twipsToCssPx,
  type DocumentLayout,
  type Editor,
  type LayoutBox,
  type SelectionState
} from '@4xian/jword-core'
import type {
  JWordTableBorderPreset,
  JWordTableCommandContext,
  JWordTableCommandResult,
  JWordTableOptions,
  JWordTablePanelElements,
  JWordTableSelectionScope,
  JWordTableSelectionTarget,
  JWordUiLiveRegionController
} from '../types'
import { createTablePanelDom, destroyTablePanel, renderTablePanel } from './dom'
import {
  canDeleteTargetColumn,
  canDeleteTargetRow,
  canMergeCellWithRight,
  normalizeTableDimension,
  readBorderPresetLabel,
  readDefaultDeferredMessage,
  readTableSelectionSummary
} from './state'

interface CreateTableControllerOptions {
  readonly editor: Editor
  readonly toolbarHost: HTMLElement
  readonly editorHost: HTMLElement
  readonly table: JWordTableOptions
  readonly assistive: {
    readonly liveRegion: JWordUiLiveRegionController | null
  }
}

interface TableControllerHandle {
  readonly elements: JWordTablePanelElements
  refresh(): void
  destroy(): void
}

type TableLayoutBox = Extract<DocumentLayout['pages'][number]['blocks'][number], { kind: 'table' }>

interface TableContextMenuElements {
  readonly root: HTMLElement
  readonly copyButton: HTMLButtonElement
  readonly cutButton: HTMLButtonElement
  readonly pasteButton: HTMLButtonElement
  readonly insertRowBeforeButton: HTMLButtonElement
  readonly insertRowAfterButton: HTMLButtonElement
  readonly deleteRowButton: HTMLButtonElement
  readonly insertColumnBeforeButton: HTMLButtonElement
  readonly insertColumnAfterButton: HTMLButtonElement
  readonly deleteColumnButton: HTMLButtonElement
  readonly mergeRightButton: HTMLButtonElement
}

interface TableResizeSession {
  readonly axis: 'column' | 'row'
  readonly index: number
  readonly startClientX: number
  readonly startClientY: number
  readonly startLeftPx: number
  readonly startTopPx: number
  readonly startValueTwips: number
  readonly scale: number
  readonly target: JWordTableSelectionTarget
  readonly handle: HTMLButtonElement
}

interface TablePointHit {
  readonly target: JWordTableSelectionTarget
  readonly selection: SelectionState
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
  const contextMenu = createTableContextMenu(options.editorHost)
  const resizeHandlesLayer = createResizeHandlesLayer(options.editorHost)
  let insertRows = 2
  let insertColumns = 2
  let previewRows = 1
  let previewColumns = 1
  let insertMenuOpen = false
  let customSizeDialogOpen = false
  let scope: JWordTableSelectionScope = 'cell'
  let borderPreset: JWordTableBorderPreset = 'all'
  let busy = false
  let overlayVisible = false
  let resizeSession: TableResizeSession | null = null
  let contextMenuTarget: JWordTableSelectionTarget | null = null
  let previousTargetKey: string | null = null
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
    const target = readTarget()
    const layout = options.editor.getLayout()
    const overlayGeometry = target === null
      ? null
      : resolveTableOverlayGeometry(layout, options.editorHost, target)
    const tableBox = target === null ? null : findTableBox(layout, target.tableId)
    const targetAvailable = target !== null
    const targetKey = target === null
      ? null
      : [
        target.tableId,
        target.rowIndex,
        target.columnIndex,
        target.cellIndex,
        target.blockId,
        target.runId
      ].join(':')

    if (!targetAvailable) {
      overlayVisible = false
      contextMenuTarget = null
    } else if (targetKey !== previousTargetKey) {
      overlayVisible = true
    }
    previousTargetKey = targetKey

    renderTablePanel(dom, {
      summary: readTableSelectionSummary(target, scope),
      insertRows,
      insertColumns,
      previewRows,
      previewColumns,
      insertMenuOpen,
      customSizeDialogOpen,
      quickToolsVisible: overlayVisible,
      scope,
      borderPreset,
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
      if (busy) {
        return
      }

      insertMenuOpen = !insertMenuOpen
      if (insertMenuOpen) {
        customSizeDialogOpen = false
        overlayVisible = false
      }
      refresh()
    })
    dom.topAnchor.addEventListener('click', () => {
      if (busy || readTarget() === null) {
        return
      }

      insertMenuOpen = false
      customSizeDialogOpen = false
      overlayVisible = true
      refresh()
      restoreEditorFocusSoon()
    })
    dom.leftAnchor.addEventListener('click', () => {
      if (busy || readTarget() === null) {
        return
      }

      insertMenuOpen = false
      customSizeDialogOpen = false
      overlayVisible = true
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
    dom.scopeCellButton.addEventListener('click', () => {
      if (busy || readTarget() === null) {
        return
      }

      scope = 'cell'
      refresh()
      announce('表格工具已切换到单元格范围。')
      restoreEditorFocusSoon()
    })
    dom.scopeRowButton.addEventListener('click', () => {
      if (busy || readTarget() === null) {
        return
      }

      scope = 'row'
      refresh()
      announce('表格工具已切换到整行范围。')
      restoreEditorFocusSoon()
    })
    dom.scopeColumnButton.addEventListener('click', () => {
      if (busy || readTarget() === null) {
        return
      }

      scope = 'column'
      refresh()
      announce('表格工具已切换到整列范围。')
      restoreEditorFocusSoon()
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
    dom.borderPresetSelect.addEventListener('change', () => {
      const value = dom.borderPresetSelect.value

      if (
        value === 'all'
        || value === 'outer'
        || value === 'innerHorizontal'
        || value === 'innerVertical'
        || value === 'none'
      ) {
        borderPreset = value
      }

      refresh()
    })
    dom.applyBorderButton.addEventListener('click', () => {
      const currentPreset = borderPreset

      void runTargetAction(`应用${readBorderPresetLabel(currentPreset)}`, (target) => {
        return commands.applyBorderPreset?.({
          ...readCommandContext(),
          target,
          scope,
          preset: currentPreset
        }) ?? {
          kind: 'deferred',
          message: readDefaultDeferredMessage('应用边框')
        }
      })
    })
  }

  /** 执行插入表格命令。 */
  function runInsertTableAction(): Promise<void> {
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
      || dom.overlay.contains(event.target)
      || resizeHandlesLayer.contains(event.target)
      || contextMenu.root.contains(event.target)
    ) {
      return
    }

    if (!insertMenuOpen && !customSizeDialogOpen && !overlayVisible && contextMenu.root.hidden) {
      return
    }

    insertMenuOpen = false
    customSizeDialogOpen = false
    overlayVisible = false
    closeContextMenu()
    refresh()
  }

  /** Escape 收起表格下拉或二级弹窗。 */
  function handleGlobalKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') {
      return
    }

    if (!insertMenuOpen && !customSizeDialogOpen && !overlayVisible && contextMenu.root.hidden) {
      return
    }

    insertMenuOpen = false
    customSizeDialogOpen = false
    overlayVisible = false
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
    resizeSession = {
      axis,
      index,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startLeftPx: Number.parseFloat(handle.style.left || '0'),
      startTopPx: Number.parseFloat(handle.style.top || '0'),
      startValueTwips,
      scale: axis === 'column'
        ? (tableBox.width === 0 ? 1 : overlayGeometry.width / tableBox.width)
        : (tableBox.height === 0 ? 1 : overlayGeometry.height / tableBox.height),
      target,
      handle
    }
    handle.setPointerCapture?.(event.pointerId)
    refresh()
  }

  function handleDocumentPointerMove(event: PointerEvent): void {
    if (resizeSession === null) {
      return
    }

    event.preventDefault()
    const deltaCssPx = resizeSession.axis === 'column'
      ? event.clientX - resizeSession.startClientX
      : event.clientY - resizeSession.startClientY
    const deltaTwips = cssPxToTwips(deltaCssPx / Math.max(0.01, resizeSession.scale))
    const nextValue = Math.round(resizeSession.startValueTwips + deltaTwips)

    resizeSession.handle.setAttribute('data-jword-dragging', 'true')
    if (resizeSession.axis === 'column') {
      resizeSession.handle.style.left = `${Math.round(resizeSession.startLeftPx + deltaCssPx)}px`
    } else {
      resizeSession.handle.style.top = `${Math.round(resizeSession.startTopPx + deltaCssPx)}px`
    }
    resizeSession.handle.setAttribute(
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
    session.handle.removeAttribute('data-jword-dragging')
    session.handle.removeAttribute('data-jword-preview-value')

    const deltaCssPx = session.axis === 'column'
      ? event.clientX - session.startClientX
      : event.clientY - session.startClientY
    const deltaTwips = cssPxToTwips(deltaCssPx / Math.max(0.01, session.scale))

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
      previousTargetKey = null
      signalController.abort()
      unsubscribeEditor()
      contextMenu.root.remove()
      resizeHandlesLayer.remove()
      destroyTablePanel(dom)
    }
  }
}

/** 把表格辅助层定位到当前命中的表格附近。 */
function syncOverlay(
  dom: JWordTablePanelElements,
  geometry: Readonly<{
    left: number
    top: number
    width: number
    height: number
  }> | null,
  targetAvailable: boolean
): void {
  dom.overlay.hidden = !targetAvailable || geometry === null

  if (!targetAvailable || geometry === null) {
    return
  }

  dom.overlay.style.left = `${geometry.left}px`
  dom.overlay.style.top = `${geometry.top}px`
  dom.overlay.style.width = `${geometry.width}px`
  dom.overlay.style.height = `${geometry.height}px`
}

/** 解析当前表格在 editorHost 里的几何。 */
function resolveTableOverlayGeometry(
  layout: DocumentLayout,
  editorHost: HTMLElement,
  target: JWordTableSelectionTarget
): Readonly<{
  left: number
  top: number
  width: number
  height: number
}> | null {
  const canvasContainer = editorHost.querySelector<HTMLElement>('[data-jword-canvas-container]')
  if (canvasContainer === null) {
    return null
  }

  const tableBox = findTableBox(layout, target.tableId)
  if (tableBox === null) {
    return null
  }

  const pageElement = canvasContainer.querySelector<HTMLElement>(`[data-jword-page="${tableBox.pageIndex}"]`)
  const page = layout.pages[tableBox.pageIndex]
  if (pageElement === null || page === undefined) {
    return null
  }

  const scale = resolvePageScale(pageElement, page)
  const left = pageElement.offsetLeft + twipsToCssPx(tableBox.x - page.x, scale)
  const top = pageElement.offsetTop + twipsToCssPx(tableBox.y - page.y, scale)
  const width = twipsToCssPx(tableBox.width, scale)
  const height = twipsToCssPx(tableBox.height, scale)

  return {
    left,
    top,
    width,
    height
  }
}

/** 读取表格 box。 */
function findTableBox(layout: DocumentLayout, tableId: string): TableLayoutBox | null {
  for (const page of layout.pages) {
    const table = page.blocks.find((block) => block.kind === 'table' && block.tableId === tableId)

    if (table !== undefined && table.kind === 'table') {
      return table
    }
  }

  return null
}

/** 从 DOM 反推页面 scale。 */
function resolvePageScale(pageElement: HTMLElement, page: LayoutBox): number {
  const baseWidthPx = twipsToCssPx(page.width)

  if (baseWidthPx <= 0) {
    return 1
  }

  return pageElement.clientWidth / baseWidthPx
}

/** 读取预览网格上的行列值。 */
function readPreviewDimension(value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback
  }

  return normalizeTableDimension(value, fallback)
}

/** 创建表格专用右键菜单。 */
function createTableContextMenu(host: HTMLElement): TableContextMenuElements {
  const root = document.createElement('div')
  const group = document.createElement('div')
  const editGroup = document.createElement('div')
  const structureGroup = document.createElement('div')
  const copyButton = createContextMenuButton('clipboard.copy', '复制')
  const cutButton = createContextMenuButton('clipboard.cut', '剪切')
  const pasteButton = createContextMenuButton('clipboard.paste', '粘贴')
  const insertRowBeforeButton = createContextMenuButton('table.insert-row-before', '上方插入行')
  const insertRowAfterButton = createContextMenuButton('table.insert-row-after', '下方插入行')
  const deleteRowButton = createContextMenuButton('table.delete-row', '删除行')
  const insertColumnBeforeButton = createContextMenuButton('table.insert-column-before', '左侧插入列')
  const insertColumnAfterButton = createContextMenuButton('table.insert-column-after', '右侧插入列')
  const deleteColumnButton = createContextMenuButton('table.delete-column', '删除列')
  const mergeRightButton = createContextMenuButton('table.merge-right', '向右合并')

  root.className = 'jw-context-menu'
  root.hidden = true
  root.style.zIndex = '120'
  group.className = 'jw-context-menu__group'
  editGroup.className = 'jw-context-menu__group'
  structureGroup.className = 'jw-context-menu__group'
  group.append(copyButton, cutButton, pasteButton)
  editGroup.append(insertRowBeforeButton, insertRowAfterButton, deleteRowButton)
  structureGroup.append(insertColumnBeforeButton, insertColumnAfterButton, deleteColumnButton, mergeRightButton)
  root.append(group, editGroup, structureGroup)
  host.append(root)

  return {
    root,
    copyButton,
    cutButton,
    pasteButton,
    insertRowBeforeButton,
    insertRowAfterButton,
    deleteRowButton,
    insertColumnBeforeButton,
    insertColumnAfterButton,
    deleteColumnButton,
    mergeRightButton
  }
}

/** 创建表格行列尺寸拖拽 handle 容器。 */
function createResizeHandlesLayer(host: HTMLElement): HTMLElement {
  const layer = document.createElement('div')
  const mountHost = host.querySelector<HTMLElement>('[data-jword-canvas-container]') ?? host

  layer.className = 'jw-table-panel__overlay'
  layer.setAttribute('data-jword-table-resize-layer', 'true')
  layer.hidden = true
  mountHost.append(layer)

  return layer
}

/** 同步表格右键菜单按钮可用态。 */
function syncTableContextMenu(
  menu: TableContextMenuElements,
  contextTarget: JWordTableSelectionTarget | null,
  liveTarget: JWordTableSelectionTarget | null,
  busy: boolean
): void {
  const target = contextTarget ?? liveTarget

  menu.copyButton.disabled = busy || target === null
  menu.cutButton.disabled = busy || target === null
  menu.pasteButton.disabled = busy
  menu.insertRowBeforeButton.disabled = busy || target === null
  menu.insertRowAfterButton.disabled = busy || target === null
  menu.deleteRowButton.disabled = busy || !canDeleteTargetRow(target)
  menu.insertColumnBeforeButton.disabled = busy || target === null
  menu.insertColumnAfterButton.disabled = busy || target === null
  menu.deleteColumnButton.disabled = busy || !canDeleteTargetColumn(target)
  menu.mergeRightButton.disabled = busy || !canMergeCellWithRight(target)
}

/** 同步表格 resize handles。 */
function syncResizeHandles(
  layer: HTMLElement,
  geometry: Readonly<{
    left: number
    top: number
    width: number
    height: number
  }> | null,
  table: TableLayoutBox | null,
  targetAvailable: boolean,
  busy: boolean,
  onPointerDown: (event: PointerEvent) => void
): void {
  layer.hidden = !targetAvailable || geometry === null || table === null
  layer.replaceChildren()

  if (!targetAvailable || geometry === null || table === null || busy) {
    return
  }

  const scaleX = table.width === 0 ? 1 : geometry.width / table.width
  const scaleY = table.height === 0 ? 1 : geometry.height / table.height

  let columnOffset = 0
  for (let columnIndex = 0; columnIndex < table.grid.length; columnIndex += 1) {
    const width = table.grid[columnIndex] ?? 0
    columnOffset += width

    if (columnIndex >= table.grid.length - 1) {
      continue
    }

    let segmentTop = geometry.top
    for (let rowIndex = 0; rowIndex < table.rows.length; rowIndex += 1) {
      const row = table.rows[rowIndex]

      if (row === undefined) {
        continue
      }

      const segmentBottom = geometry.top + Math.round((row.y + row.height - table.y) * scaleY)
      const segmentHeight = Math.max(12, segmentBottom - segmentTop)
      const handle = document.createElement('button')

      handle.type = 'button'
      handle.className = 'jw-table-panel__anchor'
      handle.style.left = `${geometry.left + Math.round(columnOffset * scaleX) - 6}px`
      handle.style.top = `${segmentTop}px`
      handle.style.width = '12px'
      handle.style.height = `${segmentHeight}px`
      handle.style.borderRadius = '6px'
      handle.style.cursor = 'col-resize'
      handle.setAttribute('aria-label', `调整第 ${columnIndex + 1} 列宽度`)
      handle.setAttribute(
        rowIndex === 0
          ? 'data-jword-table-resize-handle'
          : 'data-jword-table-resize-handle-segment',
        `column-${columnIndex}`
      )
      handle.addEventListener('pointerdown', onPointerDown)
      layer.append(handle)
      segmentTop = segmentBottom
    }
  }

  for (let rowIndex = 0; rowIndex < table.rows.length - 1; rowIndex += 1) {
    const row = table.rows[rowIndex]

    if (row === undefined) {
      continue
    }

    const nextTop = geometry.top + Math.round((row.y + row.height - table.y) * scaleY)
    const handle = document.createElement('button')
    handle.type = 'button'
    handle.className = 'jw-table-panel__anchor'
    handle.style.left = `${geometry.left}px`
    handle.style.top = `${nextTop - 6}px`
    handle.style.width = `${Math.max(12, Math.round(geometry.width))}px`
    handle.style.height = '12px'
    handle.style.borderRadius = '6px'
    handle.style.cursor = 'row-resize'
    handle.setAttribute('aria-label', `调整第 ${rowIndex + 1} 行高度`)
    handle.setAttribute('data-jword-table-resize-handle', `row-${rowIndex}`)
    handle.addEventListener('pointerdown', onPointerDown)
    layer.append(handle)
  }
}

/** 从鼠标事件命中表格单元格。 */
function hitTestTablePoint(
  editor: Editor,
  event: MouseEvent
): TablePointHit | null {
  const pageMetrics = resolveMousePageMetrics(editor, event)

  if (pageMetrics === null) {
    return null
  }

  const anchor = editor.hitTest({
    pageIndex: pageMetrics.pageIndex,
    x: pageMetrics.xTwips,
    y: pageMetrics.yTwips
  })

  if (anchor === undefined) {
    return null
  }

  const position = editor.resolveTextPosition(anchor)
  const target = resolveTargetByPosition(editor.getProjection(), position.blockId, position.runId)

  if (target === null) {
    return null
  }

  const selection = createSelectionState(anchor, anchor)

  return {
    target,
    selection
  }
}

/** 把 viewport 鼠标坐标转换成 editor.hitTest 所需的 page twips。 */
function resolveMousePageMetrics(
  editor: Editor,
  event: MouseEvent
): Readonly<{
  pageIndex: number
  xTwips: number
  yTwips: number
}> | null {
  const target = event.target

  if (!(target instanceof Element)) {
    return null
  }

  const pageElement = target.closest<HTMLElement>('[data-jword-page]')

  if (pageElement === null) {
    return null
  }

  const pageIndex = Number.parseInt(pageElement.getAttribute('data-jword-page') ?? '-1', 10)
  const page = editor.getLayout().pages[pageIndex]

  if (!Number.isInteger(pageIndex) || pageIndex < 0 || page === undefined) {
    return null
  }

  const pageRect = pageElement.getBoundingClientRect()
  const scale = resolvePageScale(pageElement, page)

  return {
    pageIndex,
    xTwips: cssPxToTwips((event.clientX - pageRect.left) / Math.max(0.01, scale)),
    yTwips: cssPxToTwips((event.clientY - pageRect.top) / Math.max(0.01, scale))
  }
}

/** 通过 blockId/runId 找回当前表格目标。 */
function resolveTargetByPosition(
  projection: ReturnType<Editor['getProjection']>,
  blockId: string,
  runId: string
): JWordTableSelectionTarget | null {
  for (const section of projection.document.sections) {
    for (const block of section.blocks) {
      if (block.kind !== 'table') {
        continue
      }

      const columnCount = block.rows.reduce((count, row) => {
        return Math.max(count, row.cells.reduce((rowCount, cell) => rowCount + (cell.gridSpan ?? 1), 0))
      }, 0)

      for (let rowIndex = 0; rowIndex < block.rows.length; rowIndex += 1) {
        const row = block.rows[rowIndex]

        if (row === undefined) {
          continue
        }

        let columnIndex = 0

        for (let cellIndex = 0; cellIndex < row.cells.length; cellIndex += 1) {
          const cell = row.cells[cellIndex]

          if (cell === undefined) {
            continue
          }

          const paragraph = cell.blocks.find((child) => child.kind === 'paragraph' && child.id === blockId)
          const run = paragraph?.kind === 'paragraph'
            ? paragraph.runs.find((candidate) => candidate.id === runId)
            : undefined

          if (paragraph?.kind === 'paragraph' && run !== undefined) {
            return {
              tableId: block.id,
              sectionId: section.id,
              rowIndex,
              columnIndex,
              cellIndex,
              rowCount: block.rows.length,
              columnCount,
              rowCellCount: row.cells.length,
              cellId: cell.id,
              blockId: paragraph.id,
              runId: run.id,
              cellGridSpan: cell.gridSpan ?? 1
            }
          }

          columnIndex += cell.gridSpan ?? 1
        }
      }
    }
  }

  return null
}

/** 创建右键菜单按钮。 */
function createContextMenuButton(actionId: string, text: string): HTMLButtonElement {
  const button = document.createElement('button')
  const label = document.createElement('span')

  button.type = 'button'
  button.className = 'jw-context-menu__button'
  button.setAttribute('data-jword-context-action', actionId)
  label.className = 'jw-context-menu__label'
  label.textContent = text
  button.append(label)

  return button
}

/** 读取 editor mount 后的 hidden textarea。 */
function requireHiddenTextarea(editorHost: HTMLElement): HTMLTextAreaElement {
  const textarea = editorHost.querySelector('[data-jword-hidden-textarea]')

  if (!(textarea instanceof HTMLTextAreaElement)) {
    throw new Error('table controller 需要已挂载的 hidden textarea。')
  }

  return textarea
}

interface ClipboardBuffer {
  plainText: string
  htmlText: string
}

/** 创建最小 clipboardData 对象。 */
function createClipboardData(buffer: ClipboardBuffer): Readonly<{
  getData(type: string): string
  setData(type: string, value: string): void
}> {
  return {
    getData(type: string): string {
      if (type === 'text/plain') {
        return buffer.plainText
      }

      if (type === 'text/html') {
        return buffer.htmlText
      }

      return ''
    },
    setData(type: string, value: string): void {
      if (type === 'text/plain') {
        buffer.plainText = value
      }

      if (type === 'text/html') {
        buffer.htmlText = value
      }
    }
  }
}

/** 收集 facade copy/cut 生成的剪贴板内容。 */
function collectClipboardBuffer(
  hiddenTextarea: HTMLTextAreaElement,
  kind: 'copy' | 'cut'
): ClipboardBuffer {
  const buffer: ClipboardBuffer = {
    plainText: '',
    htmlText: ''
  }

  dispatchClipboardEvent(hiddenTextarea, kind, createClipboardData(buffer))

  return buffer
}

/** 分发一条带 clipboardData 的合成事件。 */
function dispatchClipboardEvent(
  hiddenTextarea: HTMLTextAreaElement,
  kind: 'copy' | 'cut' | 'paste',
  clipboardData: ReturnType<typeof createClipboardData>
): void {
  const event = new Event(kind, {
    bubbles: true,
    cancelable: true
  })

  Object.defineProperty(event, 'clipboardData', {
    configurable: true,
    value: clipboardData
  })

  hiddenTextarea.dispatchEvent(event)
}

/** 尝试通过浏览器原生命令执行 copy/cut/paste。 */
function runNativeExecCommand(command: 'copy' | 'cut' | 'paste'): boolean {
  const documentWithExec = document as Document & {
    execCommand?: (name: string) => boolean
  }

  return typeof documentWithExec.execCommand === 'function'
    && documentWithExec.execCommand(command) === true
}

/** 统一阻止按钮 pointerdown 抢走焦点。 */
function preventDefaultEvent(event: Event): void {
  event.preventDefault()
}

/** 归一化 table controller 的异常消息。 */
function readTableErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message
  }

  return '表格操作失败。'
}
