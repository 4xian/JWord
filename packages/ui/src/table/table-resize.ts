/**
 * 职责：处理 Gate 4 表格行列 resize 会话、拖拽预览和尺寸提交。
 * 边界：不负责表格选择命中和工具栏动作绑定。
 * 协作模块：table controller 注入命令执行入口，controller-helpers 负责预览线 DOM 同步。
 * 性能/安全约束：拖拽中只更新预览 DOM，pointerup 后通过 table command adapter 进入 transaction pipeline。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import type {
  JWordTableCommandContext,
  JWordTableCommandResult,
  JWordTableOptions,
  JWordTableSelectionTarget
} from '../types'
import {
  syncResizePreview,
  type TableLayoutBox,
  type TableResizePreviewGeometry
} from './controller-helpers'
import { readDefaultDeferredMessage } from './state'
import type {
  TableControllerState,
  TableOverlayGeometry
} from './table-state-sync'

interface TableResizeControllerOptions {
  readonly state: TableControllerState
  readonly commands: JWordTableOptions['commands']
  readonly resizePreview: HTMLElement
  readonly signal: AbortSignal
  readCommandContext(): JWordTableCommandContext
  closeContextMenu(): void
  refresh(): void
  runAction(
    actionLabel: string,
    runner: () => JWordTableCommandResult | Promise<JWordTableCommandResult>
  ): Promise<void>
}

export interface TableResizeController {
  bindResizeEvents(): void
  clearResizeSession(): void
  startResizeSession(
    event: PointerEvent,
    target: JWordTableSelectionTarget | null,
    tableBox: TableLayoutBox | null,
    overlayGeometry: TableOverlayGeometry | null
  ): void
}

const MIN_TABLE_COLUMN_WIDTH_TWIPS = 720
const MIN_TABLE_ROW_HEIGHT_TWIPS = 360

/** 创建表格 resize 控制器。 */
export function createTableResizeController(options: TableResizeControllerOptions): TableResizeController {
  /** 统一响应尺寸拖拽开始。 */
  function startResizeSession(
    event: PointerEvent,
    target: JWordTableSelectionTarget | null,
    tableBox: TableLayoutBox | null,
    overlayGeometry: TableOverlayGeometry | null
  ): void {
    const handle = event.currentTarget

    if (
      options.state.busy
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
    options.closeContextMenu()
    const previewStart: TableResizePreviewGeometry = {
      axis,
      left: axis === 'column' ? Number.parseFloat(handle.style.left || '0') + 2 : overlayGeometry.left,
      top: axis === 'column' ? overlayGeometry.top : Number.parseFloat(handle.style.top || '0') + 2,
      width: axis === 'column' ? 2 : Math.max(12, Math.round(overlayGeometry.width)),
      height: axis === 'column' ? Math.max(12, Math.round(overlayGeometry.height)) : 2
    }
    options.state.resizeSession = {
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
    syncResizePreview(options.resizePreview, previewStart)
    options.refresh()
  }

  /** 绑定 document 级 resize 事件。 */
  function bindResizeEvents(): void {
    document.addEventListener('pointermove', handleDocumentPointerMove, { signal: options.signal })
    document.addEventListener('pointerup', handleDocumentPointerUp, { signal: options.signal })
  }

  /** 清理 resize 会话状态。 */
  function clearResizeSession(): void {
    options.state.resizeSession = null
  }

  /** 拖拽中实时移动蓝色预览线。 */
  function handleDocumentPointerMove(event: PointerEvent): void {
    if (options.state.resizeSession === null) {
      return
    }

    event.preventDefault()
    const resizeSession = options.state.resizeSession
    const deltaCssPx = resizeSession.axis === 'column'
      ? event.clientX - resizeSession.startClientX
      : event.clientY - resizeSession.startClientY
    const deltaTwips = deltaCssPx / Math.max(0.01, resizeSession.scale)
    const nextValue = Math.round(resizeSession.startValueTwips + deltaTwips)

    syncResizePreview(options.resizePreview, {
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
    options.resizePreview.setAttribute(
      'data-jword-preview-value',
      String(resizeSession.axis === 'column'
        ? Math.max(MIN_TABLE_COLUMN_WIDTH_TWIPS, nextValue)
        : Math.max(MIN_TABLE_ROW_HEIGHT_TWIPS, nextValue))
    )
  }

  /** pointerup 时提交尺寸命令。 */
  function handleDocumentPointerUp(event: PointerEvent): void {
    const session = options.state.resizeSession

    if (session === null) {
      return
    }

    options.state.resizeSession = null
    options.resizePreview.removeAttribute('data-jword-preview-value')
    syncResizePreview(options.resizePreview, null)

    const deltaCssPx = session.axis === 'column'
      ? event.clientX - session.startClientX
      : event.clientY - session.startClientY
    const deltaTwips = deltaCssPx / Math.max(0.01, session.scale)

    if (session.axis === 'column') {
      const widthTwips = Math.max(MIN_TABLE_COLUMN_WIDTH_TWIPS, Math.round(session.startValueTwips + deltaTwips))

      void options.runAction('调整列宽', () => {
        return options.commands.setColumnWidth?.({
          ...options.readCommandContext(),
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

    void options.runAction('调整行高', () => {
      return options.commands.setRowHeight?.({
        ...options.readCommandContext(),
        target: session.target,
        rowIndex: session.index,
        heightTwips
      }) ?? {
        kind: 'deferred',
        message: readDefaultDeferredMessage('调整行高')
      }
    })
  }

  return {
    bindResizeEvents,
    clearResizeSession,
    startResizeSession
  }
}
