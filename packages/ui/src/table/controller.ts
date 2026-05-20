/**
 * 职责：驱动 Gate 4 表格工具栏，连接宿主命令适配器、当前选区解析和最小行列边框操作。
 * 边界：不实现 core table builder 或 demo 业务；这里只维护 UI 状态并调度宿主注入的命令适配器。
 * 协作模块：create-ui 负责装配，table dom 负责节点结构，宿主通过 table options 注入命令桥接。
 * 性能/安全约束：所有表格写入都必须继续走 editor facade 的 transaction pipeline，不旁路修改 projection。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md Step 4.7。
 */
import { twipsToCssPx, type DocumentLayout, type Editor, type LayoutBox } from '@4xian/jword-core'
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

/** 创建 Gate 4 表格工具栏 controller。 */
export function createTableController(options: CreateTableControllerOptions): TableControllerHandle {
  const dom = createTablePanelDom(
    options.toolbarHost,
    options.editorHost,
    options.table.title ?? '表格'
  )
  const commands = options.table.commands
  const liveRegion = options.assistive.liveRegion
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
    const targetAvailable = target !== null

    if (!targetAvailable) {
      overlayVisible = false
    }

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
  }

  /** 在一次操作完成后把焦点还给 editor。 */
  function restoreEditorFocusSoon(): void {
    queueMicrotask(() => {
      options.editor.focus()
    })
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
    document.addEventListener('pointerdown', handleOutsidePointerDown)
    document.addEventListener('keydown', handleGlobalKeyDown)
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
    ) {
      return
    }

    if (!insertMenuOpen && !customSizeDialogOpen && !overlayVisible) {
      return
    }

    insertMenuOpen = false
    customSizeDialogOpen = false
    overlayVisible = false
    refresh()
  }

  /** Escape 收起表格下拉或二级弹窗。 */
  function handleGlobalKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') {
      return
    }

    if (!insertMenuOpen && !customSizeDialogOpen && !overlayVisible) {
      return
    }

    insertMenuOpen = false
    customSizeDialogOpen = false
    overlayVisible = false
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

  bindEvents()
  refresh()

  return {
    elements: dom,
    refresh,
    destroy(): void {
      unsubscribeEditor()
      document.removeEventListener('pointerdown', handleOutsidePointerDown)
      document.removeEventListener('keydown', handleGlobalKeyDown)
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

/** 归一化 table controller 的异常消息。 */
function readTableErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message
  }

  return '表格操作失败。'
}
