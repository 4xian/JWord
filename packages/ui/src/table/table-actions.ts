/**
 * 职责：绑定 Gate 4 表格工具栏和右键菜单动作，统一调度宿主 table command adapter。
 * 边界：不做表格命中测试和 resize 会话，不直接改写 Y.Doc。
 * 协作模块：table controller 注入 editor 上下文，controller-helpers 提供剪贴板桥接，state 提供默认文案。
 * 性能/安全约束：所有表格写入都通过宿主 commands 进入 editor transaction pipeline。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import {
  createSelectionState,
  type Editor,
  type SelectionState
} from '@4xian/jword-core'
import type {
  JWordTableCommandContext,
  JWordTableCommandResult,
  JWordTableOptions,
  JWordTablePanelElements,
  JWordTableSelectionTarget
} from '../types'
import {
  collectClipboardBuffer,
  createClipboardData,
  dispatchClipboardEvent,
  preventDefaultEvent,
  readPreviewDimension,
  readTableErrorMessage,
  runNativeExecCommand,
  type TableContextMenuElements
} from './controller-helpers'
import {
  readDefaultDeferredMessage,
  normalizeTableDimension
} from './state'
import { readJWordUiText, type ResolvedJWordUiI18n } from '../i18n'
import type { TableControllerState } from './table-state-sync'

interface TableActionControllerOptions {
  readonly state: TableControllerState
  readonly editor: Editor
  readonly dom: JWordTablePanelElements
  readonly commands: JWordTableOptions['commands']
  readonly hiddenTextarea: HTMLTextAreaElement
  readonly contextMenu: TableContextMenuElements
  readonly signal: AbortSignal
  readonly readonlyMode: boolean
  readI18n(): ResolvedJWordUiI18n
  announce(message: string): void
  readCommandContext(): JWordTableCommandContext
  readTarget(): JWordTableSelectionTarget | null
  refresh(): void
  restoreEditorFocusSoon(): void
  closeContextMenu(): void
}

export interface TableActionController {
  bindActionEvents(): void
  runAction(
    actionLabel: string,
    runner: () => JWordTableCommandResult | Promise<JWordTableCommandResult>
  ): Promise<void>
}

/** 创建表格动作控制器。 */
export function createTableActionController(options: TableActionControllerOptions): TableActionController {
  /** 读取当前语言的表格动作文案。 */
  function tableText(key: string, replacements: Readonly<Record<string, string>> = {}): string {
    let message = readJWordUiText(options.readI18n(), `a11y.table.${key}`)

    for (const [placeholder, value] of Object.entries(replacements)) {
      message = message.replace(`{${placeholder}}`, value)
    }

    return message
  }

  /** 读取当前语言的宿主未接入提示。 */
  function deferredMessage(actionLabel: string): string {
    return readDefaultDeferredMessage(actionLabel, options.readI18n())
  }

  /** 统一执行命令型动作。 */
  async function runAction(
    actionLabel: string,
    runner: () => JWordTableCommandResult | Promise<JWordTableCommandResult>
  ): Promise<void> {
    if (options.readonlyMode) {
      options.announce(tableText('readonly'))
      return
    }

    if (options.state.busy) {
      return
    }

    options.state.busy = true
    options.refresh()

    try {
      const result = await runner()
      const message = result.message ?? (
        result.kind === 'applied'
          ? tableText('completed', { action: actionLabel })
          : tableText('deferred', { action: actionLabel })
      )

      options.announce(message)
    } catch (error) {
      options.announce(readTableErrorMessage(error, options.readI18n()))
    } finally {
      options.state.busy = false
      options.refresh()
      options.restoreEditorFocusSoon()
    }
  }

  /** 绑定表格动作相关 DOM 事件。 */
  function bindActionEvents(): void {
    options.dom.insertTriggerButton.addEventListener('click', () => {
      if (options.readonlyMode) {
        options.announce(tableText('readonly'))
        return
      }

      if (options.state.busy) {
        return
      }

      options.state.insertMenuOpen = !options.state.insertMenuOpen
      if (options.state.insertMenuOpen) {
        options.state.customSizeDialogOpen = false
        options.state.helperAnchorsVisible = false
        options.state.quickToolsVisible = false
      }
      options.refresh()
    })
    options.dom.topAnchor.addEventListener('click', () => {
      openQuickToolsFromAnchor()
    })
    options.dom.leftAnchor.addEventListener('click', () => {
      openQuickToolsFromAnchor()
    })
    for (const button of options.dom.insertPreviewButtons) {
      button.addEventListener('pointerenter', () => {
        options.state.previewRows = readPreviewDimension(button.dataset.jwordRows, options.state.previewRows)
        options.state.previewColumns = readPreviewDimension(button.dataset.jwordColumns, options.state.previewColumns)
        options.state.insertRows = options.state.previewRows
        options.state.insertColumns = options.state.previewColumns
        options.refresh()
      })
      button.addEventListener('click', () => {
        if (options.readonlyMode) {
          options.announce(tableText('readonly'))
          return
        }

        options.state.previewRows = readPreviewDimension(button.dataset.jwordRows, options.state.previewRows)
        options.state.previewColumns = readPreviewDimension(button.dataset.jwordColumns, options.state.previewColumns)
        options.state.insertRows = options.state.previewRows
        options.state.insertColumns = options.state.previewColumns
        options.state.customSizeDialogOpen = false
        options.state.insertMenuOpen = false
        void runInsertTableAction()
      })
    }
    bindInsertPanelEvents()
    bindToolbarActionButtons()
    bindTableContextMenuEvents()
  }

  /** 从锚点打开快捷工具条。 */
  function openQuickToolsFromAnchor(): void {
    if (options.readonlyMode) {
      options.announce(tableText('readonly'))
      return
    }

    if (options.state.busy || options.readTarget() === null) {
      return
    }

    options.state.insertMenuOpen = false
    options.state.customSizeDialogOpen = false
    options.state.helperAnchorsVisible = true
    options.state.quickToolsVisible = true
    options.refresh()
    options.restoreEditorFocusSoon()
  }

  /** 绑定插入面板输入与确认按钮。 */
  function bindInsertPanelEvents(): void {
    options.dom.customSizeButton.addEventListener('click', () => {
      if (options.readonlyMode) {
      options.announce(tableText('readonly'))
        return
      }

      if (options.state.busy) {
        return
      }

      options.state.customSizeDialogOpen = true
      options.refresh()
      options.dom.insertRowsInput.focus()
    })
    options.dom.customSizeCancelButton.addEventListener('click', () => {
      options.state.customSizeDialogOpen = false
      options.refresh()
    })
    options.dom.insertRowsInput.addEventListener('change', () => {
      options.state.insertRows = normalizeTableDimension(options.dom.insertRowsInput.value, options.state.insertRows)
      options.refresh()
    })
    options.dom.insertColumnsInput.addEventListener('change', () => {
      options.state.insertColumns = normalizeTableDimension(options.dom.insertColumnsInput.value, options.state.insertColumns)
      options.refresh()
    })
    options.dom.insertConfirmButton.addEventListener('click', () => {
      options.state.insertRows = normalizeTableDimension(options.dom.insertRowsInput.value, options.state.insertRows)
      options.state.insertColumns = normalizeTableDimension(options.dom.insertColumnsInput.value, options.state.insertColumns)
      options.state.customSizeDialogOpen = false
      options.state.insertMenuOpen = false

      void runInsertTableAction()
    })
  }

  /** 绑定快捷工具条按钮。 */
  function bindToolbarActionButtons(): void {
    options.dom.insertRowBeforeButton.addEventListener('click', () => {
      void runTargetAction('在当前行上方插入一行', (target) => {
        return options.commands.insertRow?.({
          ...options.readCommandContext(),
          target,
          placement: 'before'
        }) ?? {
          kind: 'deferred',
          message: deferredMessage('插入行')
        }
      })
    })
    options.dom.insertRowAfterButton.addEventListener('click', () => {
      void runTargetAction('在当前行下方插入一行', (target) => {
        return options.commands.insertRow?.({
          ...options.readCommandContext(),
          target,
          placement: 'after'
        }) ?? {
          kind: 'deferred',
          message: deferredMessage('插入行')
        }
      })
    })
    options.dom.deleteRowButton.addEventListener('click', () => {
      void runTargetAction('删除当前行', (target) => {
        return options.commands.deleteRow?.({
          ...options.readCommandContext(),
          target
        }) ?? {
          kind: 'deferred',
          message: deferredMessage('删除行')
        }
      })
    })
    options.dom.insertColumnBeforeButton.addEventListener('click', () => {
      void runTargetAction('在当前列左侧插入一列', (target) => {
        return options.commands.insertColumn?.({
          ...options.readCommandContext(),
          target,
          placement: 'before'
        }) ?? {
          kind: 'deferred',
          message: deferredMessage('插入列')
        }
      })
    })
    options.dom.insertColumnAfterButton.addEventListener('click', () => {
      void runTargetAction('在当前列右侧插入一列', (target) => {
        return options.commands.insertColumn?.({
          ...options.readCommandContext(),
          target,
          placement: 'after'
        }) ?? {
          kind: 'deferred',
          message: deferredMessage('插入列')
        }
      })
    })
    options.dom.deleteColumnButton.addEventListener('click', () => {
      void runTargetAction('删除当前列', (target) => {
        return options.commands.deleteColumn?.({
          ...options.readCommandContext(),
          target
        }) ?? {
          kind: 'deferred',
          message: deferredMessage('删除列')
        }
      })
    })
    options.dom.mergeRightButton.addEventListener('click', () => {
      void runTargetAction('合并当前单元格与右侧单元格', (target) => {
        return options.commands.mergeCellWithRight?.({
          ...options.readCommandContext(),
          target
        }) ?? {
          kind: 'deferred',
          message: deferredMessage('合并单元格')
        }
      })
    })
  }

  /** 执行插入表格命令。 */
  function runInsertTableAction(): Promise<void> {
    options.state.helperAnchorsVisible = false
    options.state.quickToolsVisible = false
    return runAction('插入表格', () => {
      return options.commands.insertTable?.({
        ...options.readCommandContext(),
        rows: options.state.insertRows,
        columns: options.state.insertColumns
      }) ?? {
        kind: 'deferred',
        message: deferredMessage('插入表格')
      }
    })
  }

  /** 统一执行“必须依赖当前表格目标”的动作。 */
  async function runTargetAction(
    actionLabel: string,
    runner: (target: JWordTableSelectionTarget) => JWordTableCommandResult | Promise<JWordTableCommandResult>
  ): Promise<void> {
    const target = options.readTarget()

    if (target === null) {
      options.announce(tableText('targetMissing'))
      options.restoreEditorFocusSoon()
      return
    }

    await runAction(actionLabel, () => runner(target))
  }

  /** 绑定表格右键菜单按钮。 */
  function bindTableContextMenuEvents(): void {
    bindContextMenuButton(options.contextMenu.copyButton, () => {
      void copySelectionToClipboard(cloneCurrentSelection())
    })
    bindContextMenuButton(options.contextMenu.cutButton, () => {
      void cutSelectionToClipboard(cloneCurrentSelection())
    })
    bindContextMenuButton(options.contextMenu.pasteButton, () => {
      void pastePlainTextFromClipboard(cloneCurrentSelection())
    })
    bindContextMenuButton(options.contextMenu.insertRowBeforeButton, () => {
      void runContextTargetAction('插入行', (target) => {
        return options.commands.insertRow?.({
          ...options.readCommandContext(),
          target,
          placement: 'before'
        }) ?? {
          kind: 'deferred',
          message: deferredMessage('插入行')
        }
      })
    })
    bindContextMenuButton(options.contextMenu.insertRowAfterButton, () => {
      void runContextTargetAction('插入行', (target) => {
        return options.commands.insertRow?.({
          ...options.readCommandContext(),
          target,
          placement: 'after'
        }) ?? {
          kind: 'deferred',
          message: deferredMessage('插入行')
        }
      })
    })
    bindContextMenuButton(options.contextMenu.deleteRowButton, () => {
      void runContextTargetAction('删除行', (target) => {
        return options.commands.deleteRow?.({
          ...options.readCommandContext(),
          target
        }) ?? {
          kind: 'deferred',
          message: deferredMessage('删除行')
        }
      })
    })
    bindContextMenuButton(options.contextMenu.insertColumnBeforeButton, () => {
      void runContextTargetAction('插入列', (target) => {
        return options.commands.insertColumn?.({
          ...options.readCommandContext(),
          target,
          placement: 'before'
        }) ?? {
          kind: 'deferred',
          message: deferredMessage('插入列')
        }
      })
    })
    bindContextMenuButton(options.contextMenu.insertColumnAfterButton, () => {
      void runContextTargetAction('插入列', (target) => {
        return options.commands.insertColumn?.({
          ...options.readCommandContext(),
          target,
          placement: 'after'
        }) ?? {
          kind: 'deferred',
          message: deferredMessage('插入列')
        }
      })
    })
    bindContextMenuButton(options.contextMenu.deleteColumnButton, () => {
      void runContextTargetAction('删除列', (target) => {
        return options.commands.deleteColumn?.({
          ...options.readCommandContext(),
          target
        }) ?? {
          kind: 'deferred',
          message: deferredMessage('删除列')
        }
      })
    })
    bindContextMenuButton(options.contextMenu.mergeRightButton, () => {
      void runContextTargetAction('合并单元格', (target) => {
        return options.commands.mergeCellWithRight?.({
          ...options.readCommandContext(),
          target
        }) ?? {
          kind: 'deferred',
          message: deferredMessage('合并单元格')
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
    const target = options.state.contextMenuTarget

    if (target === null) {
      options.announce(tableText('targetMissing'))
      options.closeContextMenu()
      options.refresh()
      return Promise.resolve()
    }

    options.closeContextMenu()
    return runAction(actionLabel, () => runner(target))
  }

  /** 绑定表格右键菜单按钮并阻止抢焦点。 */
  function bindContextMenuButton(target: HTMLButtonElement, handler: () => void): void {
    target.addEventListener('pointerdown', preventDefaultEvent, { signal: options.signal })
    target.addEventListener('mousedown', preventDefaultEvent, { signal: options.signal })
    target.addEventListener('click', () => {
      if (!target.disabled) {
        handler()
      }
    }, { signal: options.signal })
  }

  /** 写系统剪贴板。 */
  async function copySelectionToClipboard(selection: SelectionState | null): Promise<void> {
    if (selection === null) {
      options.announce(tableText('copyMissing'))
      return
    }

    const clipboard = navigator.clipboard

    if (clipboard === undefined || typeof clipboard.writeText !== 'function') {
      if (!runNativeExecCommand('copy')) {
        options.announce(tableText('clipboardWriteDenied'))
      }
      return
    }

    options.editor.setSelection(selection)
    const buffer = collectClipboardBuffer(options.hiddenTextarea, 'copy')

    if (buffer.plainText.length === 0) {
      options.announce(tableText('copyMissing'))
      return
    }

    await clipboard.writeText(buffer.plainText)
    options.closeContextMenu()
    options.restoreEditorFocusSoon()
  }

  /** 剪切当前表格内容。 */
  async function cutSelectionToClipboard(selection: SelectionState | null): Promise<void> {
    if (selection === null) {
      options.announce(tableText('cutMissing'))
      return
    }

    const clipboard = navigator.clipboard

    if (clipboard === undefined || typeof clipboard.writeText !== 'function') {
      if (!runNativeExecCommand('cut')) {
        options.announce(tableText('cutDenied'))
      }
      return
    }

    options.editor.setSelection(selection)
    const buffer = collectClipboardBuffer(options.hiddenTextarea, 'copy')

    if (buffer.plainText.length === 0) {
      options.announce(tableText('cutMissing'))
      return
    }

    await clipboard.writeText(buffer.plainText)
    dispatchClipboardEvent(options.hiddenTextarea, 'cut', createClipboardData({
      plainText: '',
      htmlText: ''
    }))
    options.closeContextMenu()
    options.restoreEditorFocusSoon()
  }

  /** 读取系统剪贴板并走 facade paste 通道。 */
  async function pastePlainTextFromClipboard(selection: SelectionState | null): Promise<void> {
    const clipboard = navigator.clipboard

    if (clipboard === undefined || typeof clipboard.readText !== 'function') {
      options.announce(tableText('clipboardReadDenied'))
      return
    }

    const text = await clipboard.readText()

    if (text.length === 0) {
      options.announce(tableText('clipboardEmpty'))
      return
    }

    if (selection !== null) {
      options.editor.setSelection(selection)
    } else {
      options.editor.focus()
    }

    dispatchClipboardEvent(options.hiddenTextarea, 'paste', createClipboardData({
      plainText: text,
      htmlText: text
    }))
    options.closeContextMenu()
    options.restoreEditorFocusSoon()
  }

  return {
    bindActionEvents,
    runAction
  }
}
