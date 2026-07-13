/**
 * 职责：封装 toolbar 字符格式、字号和颜色控件动作。
 * 边界：只处理 run 格式命令，不处理段落和插入类命令。
 * 协作模块：controller 提供颜色会话状态，toolbar-state-sync 提供统一绑定上下文。
 * 性能/安全约束：格式变更继续走 editor facade/transaction pipeline，不生成第二套编辑状态。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import {
  buildSetBackgroundColorCommand,
  buildSetTextColorCommand,
  type Editor,
  type SelectionState
} from '@4xian/jword-core'
import { createSelectionRebindSnapshot, restoreSelectionFromRebindSnapshot } from '../selection-rebind'
import { readJWordUiText } from '../i18n'
import {
  FONT_SIZE_TWIPS_STEPS,
  FONT_FAMILY_EMPTY_VALUE,
  FONT_FAMILY_MIXED_VALUE,
  FONT_SIZE_EMPTY_VALUE,
  FONT_SIZE_MIXED_VALUE
} from './builtin-tools'
import {
  cloneSelection,
  isRunNumberFormatAlreadyApplied,
  isRunStringFormatAlreadyApplied,
  normalizeHexColor,
  readSelectionFormattingState
} from './state'
import type { ToolbarActionContext } from './toolbar-state-sync'
import {
  bindColorClick,
  bindColorInput,
  bindToolbarButton,
  bindToolbarSelect,
  readColor,
  readSelect
} from './toolbar-state-sync'
import type { JWordToolbarControlElement, JWordToolbarToolId } from '../types'

export interface ToolbarColorSessionState {
  readonly frozenColorSelections: {
    text: SelectionState | null
    background: SelectionState | null
  }
  readonly activeColorValues: {
    text: string | null
    background: string | null
  }
  readonly activeColorInputSeen: {
    text: boolean
    background: boolean
  }
  readonly activeColorReturnedToEditor: {
    text: boolean
    background: boolean
  }
  readOpenColorPicker(): 'textColor' | 'backgroundColor' | null
  writeOpenColorPicker(value: 'textColor' | 'backgroundColor' | null): void
}

export interface ToolbarColorFormatHandle {
  applyColorFromSelection(
    property: 'textColor' | 'backgroundColor',
    selection: SelectionState | null,
    value: string
  ): void
}

/** 创建 toolbar 颜色控件会话状态。 */
export function createToolbarColorSessionState(): ToolbarColorSessionState {
  let openColorPicker: 'textColor' | 'backgroundColor' | null = null

  return {
    frozenColorSelections: {
      text: null,
      background: null
    },
    activeColorValues: {
      text: null,
      background: null
    },
    activeColorInputSeen: {
      text: false,
      background: false
    },
    activeColorReturnedToEditor: {
      text: false,
      background: false
    },
    readOpenColorPicker() {
      return openColorPicker
    },
    writeOpenColorPicker(value) {
      openColorPicker = value
    }
  }
}

/** 绑定字符格式相关 toolbar 控件。 */
export function bindFormatControls(context: ToolbarActionContext, colorState: ToolbarColorSessionState): ToolbarColorFormatHandle {
  const { dom } = context

  bindToolbarButton(context, dom.controls['format.bold'], () => {
    toggleActiveRunBooleanFormat(context, 'bold', readToolbarLabel(context, 'format.bold'))
  })
  bindToolbarButton(context, dom.controls['format.italic'], () => {
    toggleActiveRunBooleanFormat(context, 'italic', readToolbarLabel(context, 'format.italic'))
  })
  bindToolbarButton(context, dom.controls['format.underline'], () => {
    toggleActiveRunBooleanFormat(context, 'underline', readToolbarLabel(context, 'format.underline'))
  })
  bindToolbarButton(context, dom.controls['format.strike'], () => {
    toggleActiveRunBooleanFormat(context, 'strike', readToolbarLabel(context, 'format.strike'))
  })
  bindToolbarButton(context, dom.controls['format.superscript'], () => {
    toggleActiveRunBooleanFormat(context, 'superscript', readToolbarLabel(context, 'format.superscript'))
  })
  bindToolbarButton(context, dom.controls['format.subscript'], () => {
    toggleActiveRunBooleanFormat(context, 'subscript', readToolbarLabel(context, 'format.subscript'))
  })
  bindToolbarSelect(context, dom.controls['format.fontFamily'], () => {
    const control = readSelect(dom.controls['format.fontFamily'])

    if (control === null) {
      return
    }

    const value = control.value

    if (value === FONT_FAMILY_EMPTY_VALUE || value === FONT_FAMILY_MIXED_VALUE) {
      context.render()
      return
    }

    applyRunStringFormat(context, 'fontFamily', readToolbarLabel(context, 'format.fontFamily'), value)
  })
  bindToolbarSelect(context, dom.controls['format.fontSize'], () => {
    const control = readSelect(dom.controls['format.fontSize'])

    if (control === null) {
      return
    }

    const value = control.value

    if (value === FONT_SIZE_EMPTY_VALUE || value === FONT_SIZE_MIXED_VALUE) {
      context.render()
      return
    }

    const parsedValue = Number.parseInt(value, 10)

    if (!Number.isFinite(parsedValue)) {
      context.announce(readJWordUiText(
        context.readI18n(),
        'a11y.toolbar.format.invalidFontSize'
      ).replace('{value}', value))
      context.render()
      return
    }

    applyRunNumberFormat(context, readToolbarLabel(context, 'format.fontSize'), parsedValue)
  })
  bindToolbarButton(context, dom.controls['format.fontSizeDecrease'], () => {
    applyFontSizeStep(context, -1)
  })
  bindToolbarButton(context, dom.controls['format.fontSizeIncrease'], () => {
    applyFontSizeStep(context, 1)
  })
  bindColorClick(dom.controls['format.textColor'], () => {
    colorState.writeOpenColorPicker('textColor')
    captureColorSelection(context.editor, dom.controls['format.textColor'], colorState, 'textColor')
  }, context.signal)
  bindColorClick(dom.controls['format.backgroundColor'], () => {
    colorState.writeOpenColorPicker('backgroundColor')
    captureColorSelection(context.editor, dom.controls['format.backgroundColor'], colorState, 'backgroundColor')
  }, context.signal)
  bindColorInput(dom.controls['format.textColor'], (event) => {
    const control = readColor(dom.controls['format.textColor'])

    if (control === null) {
      return
    }

    colorState.writeOpenColorPicker('textColor')
    applyColorFormatFromFrozenSelection(context, colorState, 'textColor', readToolbarLabel(context, 'format.textColor'), readActiveColorValue(colorState, 'textColor', control.value, event.type))
  }, context.signal)
  bindColorInput(dom.controls['format.backgroundColor'], (event) => {
    const control = readColor(dom.controls['format.backgroundColor'])

    if (control === null) {
      return
    }

    colorState.writeOpenColorPicker('backgroundColor')
    applyColorFormatFromFrozenSelection(context, colorState, 'backgroundColor', readToolbarLabel(context, 'format.backgroundColor'), readActiveColorValue(colorState, 'backgroundColor', control.value, event.type))
  }, context.signal)

  return {
    applyColorFromSelection(property, selection, value) {
      writeFrozenColorSelection(colorState, property, cloneSelection(selection))
      applyColorFormatFromFrozenSelection(
        context,
        colorState,
        property,
        property === 'textColor'
          ? readToolbarLabel(context, 'format.textColor')
          : readToolbarLabel(context, 'format.backgroundColor'),
        value
      )
    }
  }
}

/** 标记当前颜色 picker 会话已经回到编辑器。 */
export function markActiveColorReturnedToEditor(colorState: ToolbarColorSessionState): void {
  const openColorPicker = colorState.readOpenColorPicker()

  if (openColorPicker === null) {
    return
  }

  writeActiveColorReturnedToEditor(colorState, openColorPicker, true)
  colorState.writeOpenColorPicker(null)
}

/** 在当前选区上切换布尔格式。 */
function toggleActiveRunBooleanFormat(
  context: ToolbarActionContext,
  property: 'bold' | 'italic' | 'underline' | 'strike' | 'superscript' | 'subscript',
  label: string
): void {
  const selection = context.editor.getSelection()
  const formattingState = context.editor.getSelectionFormattingState()

  if (selection === null || formattingState.run === null) {
    announceFormatSelectionRequired(context, label)
    return
  }

  switch (property) {
    case 'bold':
      context.markToolbarTransaction()
      context.editor.toggleBold()
      return
    case 'italic':
      context.markToolbarTransaction()
      context.editor.toggleItalic()
      return
    case 'underline':
      context.markToolbarTransaction()
      context.editor.toggleUnderline()
      return
    case 'strike':
      context.markToolbarTransaction()
      context.editor.toggleStrike()
      return
    case 'superscript':
      context.markToolbarTransaction()
      context.editor.toggleSuperscript()
      return
    case 'subscript':
      context.markToolbarTransaction()
      context.editor.toggleSubscript()
      return
  }
}

/** 应用字符串格式。 */
function applyRunStringFormat(
  context: ToolbarActionContext,
  property: 'fontFamily' | 'textColor' | 'backgroundColor',
  label: string,
  value: string
): void {
  const selection = context.editor.getSelection()
  const formattingState = context.editor.getSelectionFormattingState()

  if (selection === null || formattingState.run === null) {
    announceFormatSelectionRequired(context, label)
    context.render()
    return
  }

  if (isRunStringFormatAlreadyApplied(formattingState, property, value)) {
    announceAlreadyApplied(context, label)
    context.render()
    return
  }

  switch (property) {
    case 'fontFamily':
      context.markToolbarTransaction()
      context.editor.setFontFamily(value)
      return
    case 'textColor':
      context.markToolbarTransaction()
      context.editor.setTextColor(value)
      return
    case 'backgroundColor':
      context.markToolbarTransaction()
      context.editor.setBackgroundColor(value)
      return
  }
}

/** 应用冻结选区上的颜色格式。 */
function applyColorFormatFromFrozenSelection(
  context: ToolbarActionContext,
  colorState: ToolbarColorSessionState,
  property: 'textColor' | 'backgroundColor',
  label: string,
  value: string
): void {
  const frozenSelection = readFrozenColorSelection(colorState, property)
  const activeSelection = cloneSelection(context.editor.getSelection())
  const selection = frozenSelection ?? activeSelection
  const formattingState = selection === null ? null : readSelectionFormattingState(context.editor, selection)
  const normalizedValue = normalizeHexColor(value) ?? value

  if (activeSelection === null && frozenSelection !== null) {
    context.editor.setSelection(frozenSelection)
  }

  if (selection === null || formattingState === null || formattingState.run === null) {
    announceFormatSelectionRequired(context, label)
    context.render()
    return
  }

  if (isRunStringFormatAlreadyApplied(formattingState, property, normalizedValue)) {
    announceAlreadyApplied(context, label)
    context.render()
    return
  }

  const command = property === 'textColor'
    ? buildSetTextColorCommand(context.editor.getProjection(), selection, normalizedValue)
    : buildSetBackgroundColorCommand(context.editor.getProjection(), selection, normalizedValue)

  if (command === null) {
    context.announce(readJWordUiText(
      context.readI18n(),
      'a11y.toolbar.format.targetUnavailable'
    ).replace('{label}', label))
    context.render()
    return
  }

  context.markToolbarTransaction()
  const rebindSnapshot = createSelectionRebindSnapshot(context.editor, selection)

  context.editor.executeCommand(command, {
    selectionAfter: selection
  })
  const reboundSelection = restoreSelectionFromRebindSnapshot(context.editor, rebindSnapshot)

  writeFrozenColorSelection(colorState, property, cloneSelection(reboundSelection) ?? cloneSelection(context.editor.getSelection()) ?? selection)
  writeActiveColorValue(colorState, property, normalizedValue)
}

/** 捕获颜色控件打开时的选区，供 picker change 阶段复用。 */
function captureColorSelection(
  editor: Editor,
  controlElement: JWordToolbarControlElement | undefined,
  colorState: ToolbarColorSessionState,
  property: 'textColor' | 'backgroundColor'
): SelectionState | null {
  const activeSelection = cloneSelection(editor.getSelection())

  if (activeSelection !== null) {
    writeFrozenColorSelection(colorState, property, activeSelection)
    const control = readColor(controlElement)

    if (control !== null) {
      writeActiveColorValue(colorState, property, control.value)
      writeActiveColorInputSeen(colorState, property, false)
      writeActiveColorReturnedToEditor(colorState, property, false)
    }

    return activeSelection
  }

  const frozenSelection = readFrozenColorSelection(colorState, property)

  if (frozenSelection !== null) {
    editor.setSelection(frozenSelection)
  }

  return frozenSelection
}

/** 应用字号格式。 */
function applyRunNumberFormat(context: ToolbarActionContext, label: string, value: number): void {
  const selection = context.editor.getSelection()
  const formattingState = context.editor.getSelectionFormattingState()

  if (selection === null || formattingState.run === null) {
    announceFormatSelectionRequired(context, label)
    context.render()
    return
  }

  if (isRunNumberFormatAlreadyApplied(formattingState, value)) {
    announceAlreadyApplied(context, label)
    context.render()
    return
  }

  context.markToolbarTransaction()
  context.editor.setFontSize(value)
}

/** 沿固定字号档位向上或向下步进。 */
function applyFontSizeStep(context: ToolbarActionContext, direction: -1 | 1): void {
  const selection = context.editor.getSelection()
  const formattingState = context.editor.getSelectionFormattingState()

  if (selection === null || formattingState.run === null) {
    announceFormatSelectionRequired(
      context,
      readToolbarLabel(context, direction > 0 ? 'format.fontSizeIncrease' : 'format.fontSizeDecrease')
    )
    context.render()
    return
  }

  const currentValue = formattingState.run.fontSizeTwips.mixed === true
    ? 240
    : (formattingState.run.fontSizeTwips.value ?? 240)
  const nextValue = resolveNextFontSizeStep(currentValue, direction)

  if (nextValue === currentValue) {
    context.announce(readJWordUiText(
      context.readI18n(),
      direction > 0 ? 'a11y.toolbar.format.fontSizeMaximum' : 'a11y.toolbar.format.fontSizeMinimum'
    ))
    context.render()
    return
  }

  context.markToolbarTransaction()
  context.editor.setFontSize(nextValue)
}

/** 读取当前语言的工具名称。 */
function readToolbarLabel(context: ToolbarActionContext, toolId: JWordToolbarToolId): string {
  return readJWordUiText(context.readI18n(), `toolbar.${toolId}.label`)
}

/** 播报字符格式缺少有效选区。 */
function announceFormatSelectionRequired(context: ToolbarActionContext, label: string): void {
  context.announce(readJWordUiText(
    context.readI18n(),
    'a11y.toolbar.format.selectionRequired'
  ).replace('{label}', label))
}

/** 播报格式已经处于目标状态。 */
function announceAlreadyApplied(context: ToolbarActionContext, label: string): void {
  context.announce(readJWordUiText(
    context.readI18n(),
    'a11y.toolbar.format.alreadyApplied'
  ).replace('{label}', label))
}

/** 读取颜色控件冻结快照。 */
function readFrozenColorSelection(colorState: ToolbarColorSessionState, property: 'textColor' | 'backgroundColor'): SelectionState | null {
  return property === 'textColor' ? colorState.frozenColorSelections.text : colorState.frozenColorSelections.background
}

/** 写入颜色控件冻结快照。 */
function writeFrozenColorSelection(
  colorState: ToolbarColorSessionState,
  property: 'textColor' | 'backgroundColor',
  selection: SelectionState | null
): void {
  if (property === 'textColor') {
    colorState.frozenColorSelections.text = selection
    return
  }

  colorState.frozenColorSelections.background = selection
}

/** 读取当前颜色 picker 会话中的最后有效颜色，避免 editor mousedown render 后迟到 change 读到默认值。 */
function readActiveColorValue(
  colorState: ToolbarColorSessionState,
  property: 'textColor' | 'backgroundColor',
  rawValue: string,
  eventType: string
): string {
  const value = normalizeHexColor(rawValue)
  const inputSeen = property === 'textColor'
    ? colorState.activeColorInputSeen.text
    : colorState.activeColorInputSeen.background
  const returnedToEditor = property === 'textColor'
    ? colorState.activeColorReturnedToEditor.text
    : colorState.activeColorReturnedToEditor.background

  if (eventType === 'change' && inputSeen && returnedToEditor) {
    return property === 'textColor'
      ? colorState.activeColorValues.text ?? rawValue
      : colorState.activeColorValues.background ?? rawValue
  }

  if (value !== null) {
    writeActiveColorValue(colorState, property, value)
    writeActiveColorInputSeen(colorState, property, eventType === 'input')
    writeActiveColorReturnedToEditor(colorState, property, false)
    return value
  }

  return property === 'textColor'
    ? colorState.activeColorValues.text ?? rawValue
    : colorState.activeColorValues.background ?? rawValue
}

/** 写入当前颜色 picker 会话中的最后有效颜色。 */
function writeActiveColorValue(colorState: ToolbarColorSessionState, property: 'textColor' | 'backgroundColor', value: string): void {
  if (property === 'textColor') {
    colorState.activeColorValues.text = value
    return
  }

  colorState.activeColorValues.background = value
}

/** 记录当前 picker 会话是否已经通过 input 实时预览过。 */
function writeActiveColorInputSeen(colorState: ToolbarColorSessionState, property: 'textColor' | 'backgroundColor', value: boolean): void {
  if (property === 'textColor') {
    colorState.activeColorInputSeen.text = value
    return
  }

  colorState.activeColorInputSeen.background = value
}

/** 记录当前 picker 会话是否已由用户点回编辑器收口。 */
function writeActiveColorReturnedToEditor(
  colorState: ToolbarColorSessionState,
  property: 'textColor' | 'backgroundColor',
  value: boolean
): void {
  if (property === 'textColor') {
    colorState.activeColorReturnedToEditor.text = value
    return
  }

  colorState.activeColorReturnedToEditor.background = value
}

/** 把固定字号档位向前或向后推进一档。 */
function resolveNextFontSizeStep(currentValue: number, direction: -1 | 1): number {
  if (direction > 0) {
    return FONT_SIZE_TWIPS_STEPS.find((item) => item > currentValue) ?? currentValue
  }

  return [...FONT_SIZE_TWIPS_STEPS].reverse().find((item) => item < currentValue) ?? currentValue
}
