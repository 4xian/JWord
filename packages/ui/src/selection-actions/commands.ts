/**
 * 职责：封装 selection-actions 的格式命令与颜色命令，复用 core command builder 与 editor facade。
 * 边界：不绑定 DOM 事件，不管理浮层显示时序，不实现剪贴板语义。
 * 协作模块：selection-actions/controller 提供运行态回调，selection-rebind 保持表格等选区回绑。
 * 性能/安全约束：所有文档写入继续走 editor.executeCommand 或既有 colorFormat facade，禁止直接写状态。
 * Specs：docs/superpowers/reports/2026-07-03-remediation-execution-supplement.md#310-phase-5-超大文件拆分目标结构。
 */
import type { Command, Editor, SelectionState } from '@4xian/jword-core'
import {
  buildSetBackgroundColorCommand,
  buildSetBoldCommand,
  buildSetItalicCommand,
  buildSetStrikeCommand,
  buildSetSubscriptCommand,
  buildSetSuperscriptCommand,
  buildSetTextColorCommand,
  buildSetUnderlineCommand
} from '@4xian/jword-core'
import { createSelectionRebindSnapshot, restoreSelectionFromRebindSnapshot } from '../selection-rebind'
import { DEFAULT_BACKGROUND_COLOR, DEFAULT_TEXT_COLOR } from '../toolbar/builtin-tools'
import { cloneSelection, normalizeHexColor, readSelectionFormattingState } from '../toolbar/state'
import { copyStableSelectionToClipboard, cutStableSelection, pasteFromClipboard, pastePlainTextFromClipboard } from './clipboard'
import type { SelectionActionsClipboardContext } from './clipboard'
import type { SelectionActionColorKind, SelectionActionsColorFormatController, SelectionActionsDom, SelectionActionsInsertController, SelectionActionsRuntimeState } from './types'

/** controller 提供给 selection-actions 命令层的最小回调。 */
export interface SelectionActionCommandContext {
  readonly editor: Editor
  readonly colorFormat: SelectionActionsColorFormatController
  readonly announce: (message: string) => void
  readonly readActiveSelectionSnapshot: () => SelectionState | null
  readonly readFrozenColorSelection: (kind: SelectionActionColorKind) => SelectionState | null
  readonly writeFrozenColorSelection: (kind: SelectionActionColorKind, selection: SelectionState | null) => void
  readonly writeActiveColorValue: (kind: SelectionActionColorKind, value: string) => void
  readonly freezeFloatingToolbarForSelection: (selection: SelectionState | null) => void
  readonly keepFloatingToolbarVisible: (selection: SelectionState | null) => void
  readonly keepFloatingToolbarAtStickyPosition: (selection: SelectionState | null) => void
  readonly restoreEditorFocusSoon: () => void
  readonly closeColorPicker: (kind: SelectionActionColorKind) => void
  readonly clearStableContextPoint: () => void
  readonly resetDismissedSelection: () => void
}

/** controller 提供给按钮绑定层的最小上下文。 */
export interface SelectionActionsBindingContext {
  readonly dom: SelectionActionsDom
  readonly state: SelectionActionsRuntimeState
  readonly signal: AbortSignal
  readonly insertActions: SelectionActionsInsertController | undefined
  readonly commandContext: SelectionActionCommandContext
  readonly clipboardContext: SelectionActionsClipboardContext
  readonly announce: (message: string) => void
  readonly render: () => void
  readonly bindButton: (target: HTMLButtonElement, handler: () => void) => void
}

/** 统一执行基于选区快照的 facade command。 */
export function executeSelectionCommand(
  editor: Editor,
  selection: SelectionState | null,
  command: Command | null
): boolean {
  if (selection === null || command === null) {
    return false
  }

  const rebindSnapshot = createSelectionRebindSnapshot(editor, selection)

  editor.executeCommand(command, {
    selectionAfter: selection
  })
  restoreSelectionFromRebindSnapshot(editor, rebindSnapshot)

  return true
}

/** 切换当前快照上的布尔 run 格式。 */
export function toggleRunFormat(
  context: SelectionActionCommandContext,
  selection: SelectionState | null,
  property: 'bold' | 'italic' | 'underline' | 'strike'
): void {
  if (selection === null) {
    context.announce('BLOCKED: 当前没有可格式化的有效文本选区。')
    return
  }

  const formattingState = readSelectionFormattingState(context.editor, selection)

  if (formattingState.run === null) {
    context.announce('BLOCKED: 当前选区没有可格式化的文本 run。')
    return
  }

  const nextValue = formattingState.run[property].mixed || formattingState.run[property].value !== true
  const command = createRunFormatCommand(context.editor, selection, property, nextValue)

  context.freezeFloatingToolbarForSelection(selection)

  if (!executeSelectionCommand(context.editor, selection, command)) {
    context.announce('BLOCKED: 当前选区未生成可执行的格式命令。')
    return
  }

  context.keepFloatingToolbarAtStickyPosition(selection)
  context.clearStableContextPoint()
}

/** 把冻结选区上的颜色写回 editor facade。 */
export function applyColorFormat(
  context: SelectionActionCommandContext,
  selection: SelectionState | null,
  kind: SelectionActionColorKind,
  rawValue: string,
  keepPickerOpen: boolean
): void {
  if (selection === null) {
    context.announce('BLOCKED: 当前没有可用于颜色更新的有效文本选区。')
    return
  }

  const value = normalizeHexColor(rawValue)

  if (value === null) {
    context.announce(`BLOCKED: 颜色值 ${rawValue} 非法。`)
    return
  }

  const formattingState = readSelectionFormattingState(context.editor, selection)

  if (formattingState.run === null) {
    context.announce('BLOCKED: 当前选区没有可格式化的文本 run。')
    return
  }

  const rebindSnapshot = createSelectionRebindSnapshot(context.editor, selection)

  context.colorFormat.applyColorFromSelection(
    kind === 'text' ? 'textColor' : 'backgroundColor',
    selection,
    value
  )
  restoreSelectionFromRebindSnapshot(context.editor, rebindSnapshot)
  context.writeFrozenColorSelection(kind, context.readActiveSelectionSnapshot() ?? selection)
  context.writeActiveColorValue(kind, value)

  if (!keepPickerOpen) {
    context.closeColorPicker(kind)
  }

  context.keepFloatingToolbarAtStickyPosition(context.readFrozenColorSelection(kind) ?? selection)
  context.clearStableContextPoint()
}

/** 清除当前稳定选区上的常见 run 级格式，但保留段落语义与标题结构。 */
export function clearStableSelectionFormatting(
  context: SelectionActionCommandContext,
  selection: SelectionState | null
): void {
  if (selection === null) {
    context.announce('BLOCKED: 右键菜单当前没有稳定选区可供清除格式。')
    return
  }

  const commands = [
    buildSetBoldCommand(context.editor.getProjection(), selection, false),
    buildSetItalicCommand(context.editor.getProjection(), selection, false),
    buildSetUnderlineCommand(context.editor.getProjection(), selection, false),
    buildSetStrikeCommand(context.editor.getProjection(), selection, false),
    buildSetSuperscriptCommand(context.editor.getProjection(), selection, false),
    buildSetSubscriptCommand(context.editor.getProjection(), selection, false),
    buildSetTextColorCommand(context.editor.getProjection(), selection, DEFAULT_TEXT_COLOR),
    buildSetBackgroundColorCommand(context.editor.getProjection(), selection, DEFAULT_BACKGROUND_COLOR)
  ]
  let applied = false

  for (const command of commands) {
    if (command === null) {
      continue
    }

    context.editor.executeCommand(command, {
      selectionAfter: selection
    })
    applied = true
  }

  if (!applied) {
    context.announce('BLOCKED: 当前稳定选区没有可清除的常见 run 级格式。')
    return
  }

  context.clearStableContextPoint()
  context.resetDismissedSelection()
  context.restoreEditorFocusSoon()
}

/** 读取当前选区快照，并确保是有效非折叠文本选区。 */
export function cloneActiveSelection(
  editor: Editor,
  isActiveTextSelection: (selection: SelectionState | null) => selection is SelectionState
): SelectionState | null {
  const selection = cloneSelection(editor.getSelection())

  return isActiveTextSelection(selection) ? selection : null
}

/** 绑定浮动工具栏格式按钮与颜色输入。 */
export function bindToolbarActions(context: SelectionActionsBindingContext): void {
  const { dom } = context

  context.bindButton(dom.formatControls.bold, () => {
    toggleRunFormat(context.commandContext, context.commandContext.readActiveSelectionSnapshot(), 'bold')
  })
  context.bindButton(dom.formatControls.italic, () => {
    toggleRunFormat(context.commandContext, context.commandContext.readActiveSelectionSnapshot(), 'italic')
  })
  context.bindButton(dom.formatControls.underline, () => {
    toggleRunFormat(context.commandContext, context.commandContext.readActiveSelectionSnapshot(), 'underline')
  })
  context.bindButton(dom.formatControls.strike, () => {
    toggleRunFormat(context.commandContext, context.commandContext.readActiveSelectionSnapshot(), 'strike')
  })
  context.bindButton(dom.formatControls.insertLink, () => {
    if (context.insertActions === undefined) {
      context.announce('BLOCKED: 当前宿主未启用链接弹窗。')
      return
    }

    context.insertActions.openLink(cloneSelection(context.commandContext.readActiveSelectionSnapshot()))
    context.commandContext.clearStableContextPoint()
    context.render()
  })
  context.bindButton(dom.formatControls.openLink, () => {
    if (context.insertActions?.openActiveLink === undefined) {
      context.announce('BLOCKED: 当前宿主未启用链接打开能力。')
      return
    }

    context.insertActions.openActiveLink(cloneSelection(context.commandContext.readActiveSelectionSnapshot()))
    context.commandContext.clearStableContextPoint()
    context.render()
  })
  context.bindButton(dom.formatControls.editLink, () => {
    if (context.insertActions?.editLink === undefined) {
      context.announce('BLOCKED: 当前宿主未启用链接编辑能力。')
      return
    }

    context.insertActions.editLink(cloneSelection(context.commandContext.readActiveSelectionSnapshot()))
    context.commandContext.clearStableContextPoint()
    context.render()
  })
  context.bindButton(dom.formatControls.removeLink, () => {
    if (context.insertActions?.removeLink === undefined) {
      context.announce('BLOCKED: 当前宿主未启用链接删除能力。')
      return
    }

    context.insertActions.removeLink(cloneSelection(context.commandContext.readActiveSelectionSnapshot()))
    context.commandContext.clearStableContextPoint()
    context.render()
  })

  bindColorInput(context, dom.formatControls.textColor, 'text')
  bindColorInput(context, dom.formatControls.backgroundColor, 'background')
  dom.formatControls.textColor.addEventListener('focus', () => {
    context.state.openColorPicker = 'text'
    context.commandContext.keepFloatingToolbarVisible(captureColorSelection(context, 'text'))
  }, { signal: context.signal })
  dom.formatControls.backgroundColor.addEventListener('focus', () => {
    context.state.openColorPicker = 'background'
    context.commandContext.keepFloatingToolbarVisible(captureColorSelection(context, 'background'))
  }, { signal: context.signal })
  dom.formatControls.textColor.addEventListener('click', () => {
    context.state.openColorPicker = 'text'
    context.commandContext.keepFloatingToolbarVisible(captureColorSelection(context, 'text'))
  }, { signal: context.signal })
  dom.formatControls.backgroundColor.addEventListener('click', () => {
    context.state.openColorPicker = 'background'
    context.commandContext.keepFloatingToolbarVisible(captureColorSelection(context, 'background'))
  }, { signal: context.signal })
  bindColorPreview(context, dom.formatControls.textColor, 'text')
  bindColorPreview(context, dom.formatControls.backgroundColor, 'background')
}

/** 绑定右键菜单动作。 */
export function bindContextMenuActions(context: SelectionActionsBindingContext): void {
  const { dom, state } = context

  context.bindButton(dom.contextControls.cut, () => {
    void cutStableSelection(context.clipboardContext, cloneSelection(state.stableContextSelection.selection))
  })
  context.bindButton(dom.contextControls.copy, () => {
    void copyStableSelectionToClipboard(context.clipboardContext, cloneSelection(state.stableContextSelection.selection))
  })
  context.bindButton(dom.contextControls.paste, () => {
    void pasteFromClipboard(context.clipboardContext, cloneSelection(state.stableContextSelection.selection))
  })
  context.bindButton(dom.contextControls.pastePlainText, () => {
    void pastePlainTextFromClipboard(context.clipboardContext, cloneSelection(state.stableContextSelection.selection))
  })
  context.bindButton(dom.contextControls.clear, () => {
    clearStableSelectionFormatting(context.commandContext, cloneSelection(state.stableContextSelection.selection))
  })
  context.bindButton(dom.contextControls.insertComment, () => {
    if (context.insertActions === undefined) {
      context.announce('BLOCKED: 当前宿主未启用批注侧栏。')
      return
    }

    context.insertActions.openComment(cloneSelection(state.stableContextSelection.selection))
    context.commandContext.clearStableContextPoint()
    context.render()
  })
  context.bindButton(dom.contextControls.insertLink, () => {
    if (context.insertActions === undefined) {
      context.announce('BLOCKED: 当前宿主未启用链接弹窗。')
      return
    }

    context.insertActions.openLink(cloneSelection(state.stableContextSelection.selection))
    context.commandContext.clearStableContextPoint()
    context.render()
  })
  bindContextLinkActions(context)
}

/** 绑定已有链接相关右键动作。 */
function bindContextLinkActions(context: SelectionActionsBindingContext): void {
  const { dom, state } = context

  context.bindButton(dom.contextControls.openLink, () => {
    if (context.insertActions?.openActiveLink === undefined) {
      context.announce('BLOCKED: 当前宿主未启用链接打开能力。')
      return
    }

    context.insertActions.openActiveLink(cloneSelection(state.stableContextSelection.linkSelection))
    clearContextLinkState(context)
  })
  context.bindButton(dom.contextControls.editLink, () => {
    if (context.insertActions?.editLink === undefined) {
      context.announce('BLOCKED: 当前宿主未启用链接编辑能力。')
      return
    }

    context.insertActions.editLink(cloneSelection(state.stableContextSelection.linkSelection))
    clearContextLinkState(context)
  })
  context.bindButton(dom.contextControls.removeLink, () => {
    if (context.insertActions?.removeLink === undefined) {
      context.announce('BLOCKED: 当前宿主未启用链接删除能力。')
      return
    }

    context.insertActions.removeLink(cloneSelection(state.stableContextSelection.linkSelection))
    clearContextLinkState(context)
  })
}

/** 清除右键菜单中的链接快照。 */
function clearContextLinkState(context: SelectionActionsBindingContext): void {
  context.commandContext.clearStableContextPoint()
  context.state.stableContextSelection.linkSelection = null
  context.render()
}

/** 在颜色控件的 pointerdown/mousedown 阶段先冻结选区。 */
function bindColorInput(
  context: SelectionActionsBindingContext,
  target: HTMLInputElement,
  kind: SelectionActionColorKind
): void {
  const armPicker = () => {
    const selection = captureColorSelection(context, kind)
    context.state.openColorPicker = kind
    context.commandContext.keepFloatingToolbarVisible(selection)
  }

  target.addEventListener('pointerdown', armPicker, { signal: context.signal })
  target.addEventListener('mousedown', armPicker, { signal: context.signal })
}

/** 颜色选择过程中即时提交 input，同时保留 change 作为浏览器兼容兜底。 */
function bindColorPreview(
  context: SelectionActionsBindingContext,
  target: HTMLInputElement,
  kind: SelectionActionColorKind
): void {
  const applyPreview = (event: Event) => {
    const selection = context.commandContext.readFrozenColorSelection(kind)
    const value = readActiveColorValue(context, kind, target.value, event.type)

    applyColorFormat(context.commandContext, selection, kind, value, true)
    syncColorPreview(context, kind, value)
  }

  target.addEventListener('input', applyPreview, { signal: context.signal })
  target.addEventListener('change', applyPreview, { signal: context.signal })
}

/** 捕获颜色控件选区，避免空选区覆盖 pointerdown 阶段已冻结的有效选区。 */
function captureColorSelection(
  context: SelectionActionsBindingContext,
  kind: SelectionActionColorKind
): SelectionState | null {
  const activeSelection = context.commandContext.readActiveSelectionSnapshot()

  if (activeSelection !== null) {
    context.commandContext.writeFrozenColorSelection(kind, activeSelection)
    const control = kind === 'text'
      ? context.dom.formatControls.textColor
      : context.dom.formatControls.backgroundColor

    context.commandContext.writeActiveColorValue(kind, control.value)
    writeActiveColorInputSeen(context.state, kind, false)
    writeActiveColorReturnedToEditor(context.state, kind, false)
    return activeSelection
  }

  const frozenSelection = context.commandContext.readFrozenColorSelection(kind)

  if (frozenSelection !== null) {
    context.commandContext.editor.setSelection(frozenSelection)
  }

  return frozenSelection
}

/** 读取当前颜色 picker 会话中的最后有效颜色。 */
function readActiveColorValue(
  context: SelectionActionsBindingContext,
  kind: SelectionActionColorKind,
  rawValue: string,
  eventType: string
): string {
  const value = normalizeHexColor(rawValue)
  const inputSeen = kind === 'text'
    ? context.state.activeColorInputSeen.text
    : context.state.activeColorInputSeen.background
  const returnedToEditor = kind === 'text'
    ? context.state.activeColorReturnedToEditor.text
    : context.state.activeColorReturnedToEditor.background

  if (eventType === 'change' && inputSeen && returnedToEditor) {
    return kind === 'text'
      ? context.state.activeColorValues.text ?? rawValue
      : context.state.activeColorValues.background ?? rawValue
  }

  if (value !== null) {
    context.commandContext.writeActiveColorValue(kind, value)
    writeActiveColorInputSeen(context.state, kind, eventType === 'input')
    writeActiveColorReturnedToEditor(context.state, kind, false)
    return value
  }

  return kind === 'text'
    ? context.state.activeColorValues.text ?? rawValue
    : context.state.activeColorValues.background ?? rawValue
}

/** 让原生颜色 picker 打开期间的可视色条跟随当前选择值。 */
function syncColorPreview(
  context: SelectionActionsBindingContext,
  kind: SelectionActionColorKind,
  rawValue: string
): void {
  const value = normalizeHexColor(rawValue)

  if (value === null) {
    return
  }

  const target = kind === 'text'
    ? context.dom.formatControls.textColor
    : context.dom.formatControls.backgroundColor

  target.parentElement?.style.setProperty('--jw-selection-toolbar-color', value)
}

/** 记录当前 picker 会话是否已经通过 input 实时预览过。 */
export function writeActiveColorInputSeen(
  state: SelectionActionsRuntimeState,
  kind: SelectionActionColorKind,
  value: boolean
): void {
  if (kind === 'text') {
    state.activeColorInputSeen.text = value
    return
  }

  state.activeColorInputSeen.background = value
}

/** 记录当前 picker 会话是否已由用户点回编辑器收口。 */
export function writeActiveColorReturnedToEditor(
  state: SelectionActionsRuntimeState,
  kind: SelectionActionColorKind,
  value: boolean
): void {
  if (kind === 'text') {
    state.activeColorReturnedToEditor.text = value
    return
  }

  state.activeColorReturnedToEditor.background = value
}

/** 按格式属性创建对应 core 命令。 */
function createRunFormatCommand(
  editor: Editor,
  selection: SelectionState,
  property: 'bold' | 'italic' | 'underline' | 'strike',
  nextValue: boolean
): Command | null {
  switch (property) {
    case 'bold':
      return buildSetBoldCommand(editor.getProjection(), selection, nextValue)
    case 'italic':
      return buildSetItalicCommand(editor.getProjection(), selection, nextValue)
    case 'underline':
      return buildSetUnderlineCommand(editor.getProjection(), selection, nextValue)
    case 'strike':
      return buildSetStrikeCommand(editor.getProjection(), selection, nextValue)
  }
}
