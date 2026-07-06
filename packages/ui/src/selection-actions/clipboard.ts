/**
 * 职责：实现 selection-actions 右键菜单的复制、剪切、粘贴动作。
 * 边界：不绑定按钮事件，不计算浮层显示状态，不直接修改 Y.Doc。
 * 协作模块：selection-actions/controller 提供 editor、hidden textarea 与状态回调，native-clipboard 负责事件兼容层。
 * 性能/安全约束：系统剪贴板失败时不改文档；剪切与粘贴仍通过 core facade 的 clipboard 事件路径执行。
 * Specs：docs/superpowers/reports/2026-07-03-remediation-execution-supplement.md#310-phase-5-超大文件拆分目标结构。
 */
import type { Editor, SelectionState } from '@4xian/jword-core'
import { collectClipboardBuffer, createClipboardData, dispatchClipboardEvent, runNativeExecCommand } from './native-clipboard'

/** controller 提供给剪贴板动作的最小上下文。 */
export interface SelectionActionsClipboardContext {
  readonly editor: Editor
  readonly hiddenTextarea: HTMLTextAreaElement
  readonly announce: (message: string) => void
  readonly clearStableContextPoint: () => void
  readonly restoreEditorFocusSoon: () => void
}

/** 把复制事件序列化到系统剪贴板；写失败时不改动文档。 */
export async function copyStableSelectionToClipboard(
  context: SelectionActionsClipboardContext,
  selection: SelectionState | null
): Promise<void> {
  if (selection === null) {
    context.announce('BLOCKED: 当前没有可复制的稳定选区。')
    return
  }

  const clipboard = navigator.clipboard

  if (clipboard === undefined || typeof clipboard.writeText !== 'function') {
    if (!runNativeExecCommand('copy')) {
      context.announce('BLOCKED: 当前浏览器拒绝写入系统剪贴板。')
    }
    return
  }

  context.editor.setSelection(selection)
  const buffer = collectClipboardBuffer(context.hiddenTextarea, 'copy')

  if (buffer.plainText.length === 0) {
    context.announce('BLOCKED: 当前稳定选区没有可复制文本。')
    return
  }

  await clipboard.writeText(buffer.plainText)
  context.clearStableContextPoint()
  context.restoreEditorFocusSoon()
}

/** 先写系统剪贴板，再通过 facade 的 cut 路径删除稳定选区。 */
export async function cutStableSelection(
  context: SelectionActionsClipboardContext,
  selection: SelectionState | null
): Promise<void> {
  if (selection === null) {
    context.announce('BLOCKED: 当前没有可剪切的稳定选区。')
    return
  }

  const clipboard = navigator.clipboard

  if (clipboard === undefined || typeof clipboard.writeText !== 'function') {
    if (!runNativeExecCommand('cut')) {
      context.announce('BLOCKED: 当前浏览器拒绝执行剪切。')
    }
    return
  }

  context.editor.setSelection(selection)
  const buffer = collectClipboardBuffer(context.hiddenTextarea, 'copy')

  if (buffer.plainText.length === 0) {
    context.announce('BLOCKED: 当前稳定选区没有可剪切文本。')
    return
  }

  await clipboard.writeText(buffer.plainText)
  dispatchClipboardEvent(context.hiddenTextarea, 'cut', createClipboardData({
    plainText: '',
    htmlText: ''
  }))
  context.clearStableContextPoint()
  context.restoreEditorFocusSoon()
}

/** 走浏览器原生 paste，失败后再降级到仅文本粘贴。 */
export async function pasteFromClipboard(
  context: SelectionActionsClipboardContext,
  selection: SelectionState | null
): Promise<void> {
  if (selection !== null) {
    context.editor.setSelection(selection)
  } else {
    context.editor.focus()
  }

  if (runNativeExecCommand('paste')) {
    context.clearStableContextPoint()
    context.restoreEditorFocusSoon()
    return
  }

  await pastePlainTextFromClipboard(context, selection)
}

/** 通过 navigator.clipboard.readText + 合成 paste 事件执行仅文本粘贴。 */
export async function pastePlainTextFromClipboard(
  context: SelectionActionsClipboardContext,
  selection: SelectionState | null
): Promise<void> {
  const clipboard = navigator.clipboard

  if (clipboard === undefined || typeof clipboard.readText !== 'function') {
    context.announce('BLOCKED: 当前浏览器不允许读取纯文本剪贴板。')
    return
  }

  const text = await clipboard.readText()

  if (text.length === 0) {
    context.announce('BLOCKED: 系统剪贴板当前没有纯文本内容。')
    return
  }

  if (selection !== null) {
    context.editor.setSelection(selection)
  } else {
    context.editor.focus()
  }

  dispatchClipboardEvent(context.hiddenTextarea, 'paste', createClipboardData({
    plainText: text,
    htmlText: text
  }))
  context.clearStableContextPoint()
  context.restoreEditorFocusSoon()
}
