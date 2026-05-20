/**
 * 职责：驱动 Gate 4 表格工具栏，连接宿主命令适配器、当前选区解析和最小行列边框操作。
 * 边界：不实现 core table builder 或 demo 业务；这里只维护 UI 状态并调度宿主注入的命令适配器。
 * 协作模块：create-ui 负责装配，table dom 负责节点结构，宿主通过 table options 注入命令桥接。
 * 性能/安全约束：所有表格写入都必须继续走 editor facade 的 transaction pipeline，不旁路修改 projection。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md Step 4.7。
 */
import type { Editor } from '@4xian/jword-core'
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
  readonly host: HTMLElement
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

/** 创建 Gate 4 表格工具栏 controller。 */
export function createTableController(options: CreateTableControllerOptions): TableControllerHandle {
  const dom = createTablePanelDom(options.host, options.table.title ?? '表格')
  const commands = options.table.commands
  const liveRegion = options.assistive.liveRegion
  let insertRows = 2
  let insertColumns = 2
  let scope: JWordTableSelectionScope = 'cell'
  let borderPreset: JWordTableBorderPreset = 'all'
  let busy = false
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

    renderTablePanel(dom, {
      summary: readTableSelectionSummary(target, scope),
      insertRows,
      insertColumns,
      scope,
      borderPreset,
      targetAvailable: target !== null,
      canDeleteRow: canDeleteTargetRow(target),
      canDeleteColumn: canDeleteTargetColumn(target),
      canMergeRight: canMergeCellWithRight(target),
      busy
    })
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

      void runAction('插入表格', () => {
        return commands.insertTable?.({
          ...readCommandContext(),
          rows: insertRows,
          columns: insertColumns
        }) ?? {
          kind: 'deferred',
          message: readDefaultDeferredMessage('插入表格')
        }
      })
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
      destroyTablePanel(dom)
    }
  }
}

/** 归一化 table controller 的异常消息。 */
function readTableErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message
  }

  return '表格操作失败。'
}
