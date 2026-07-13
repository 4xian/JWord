/**
 * 职责：把 core editor 的 facade 状态转换成 toolbar 可直接渲染的只读状态。
 * 边界：不创建 DOM，不绑定事件，只负责状态归一化和文案生成。
 * 协作模块：controller 调用这里构建状态与播报文案，dom 只消费结果。
 * 性能/安全约束：复用现有 facade 能力，不引入第二套文档状态或命令语义。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import type {
  Block,
  DocumentProjection,
  Editor,
  FormattingStateValue,
  PageConfig,
  PageOrientation,
  PagePreset,
  Paragraph,
  ParagraphAlignment,
  ParagraphList,
  SelectionFormattingState,
  SelectionState,
  TextPosition
} from '@4xian/jword-core'
import { createSelectionFormattingState } from '@4xian/jword-core'
import { readJWordUiText, resolveJWordUiI18n, type ResolvedJWordUiI18n } from '../i18n'
import {
  DEFAULT_BACKGROUND_COLOR,
  DEFAULT_TEXT_COLOR,
  FONT_FAMILY_EMPTY_VALUE,
  FONT_FAMILY_MIXED_VALUE,
  FONT_SIZE_EMPTY_VALUE,
  FONT_SIZE_MIXED_VALUE,
  stringifyParagraphListSelectValue,
  TOOLBAR_SELECT_EMPTY_VALUE,
  TOOLBAR_SELECT_MIXED_VALUE
} from './builtin-tools'
import type { JWordUiI18nKey } from '../types'

/** 按钮按压态。 */
export type ToolbarPressedState = 'true' | 'false' | 'mixed'

/** 字段值态。 */
export type ToolbarValueState = 'empty' | 'value' | 'mixed'

/** toolbar 最小渲染状态。 */
export interface ToolbarState {
  readonly canUndo: boolean
  readonly canRedo: boolean
  readonly runFormatEnabled: boolean
  readonly paragraphFormatEnabled: boolean
  readonly pagePresetValue: PagePreset | 'custom'
  readonly pageOrientationValue: PageOrientation
  readonly boldPressed: ToolbarPressedState
  readonly italicPressed: ToolbarPressedState
  readonly underlinePressed: ToolbarPressedState
  readonly strikePressed: ToolbarPressedState
  readonly superscriptPressed: ToolbarPressedState
  readonly subscriptPressed: ToolbarPressedState
  readonly fontFamilyValue: string
  readonly fontFamilyState: ToolbarValueState
  readonly fontSizeValue: string
  readonly fontSizeState: ToolbarValueState
  readonly textColorValue: string
  readonly textColorState: ToolbarValueState
  readonly textColorLabel: string
  readonly backgroundColorValue: string
  readonly backgroundColorState: ToolbarValueState
  readonly backgroundColorLabel: string
  readonly paragraphAlignmentValue: string
  readonly paragraphAlignmentState: ToolbarValueState
  readonly paragraphIndentLeftValue: string
  readonly paragraphIndentLeftState: ToolbarValueState
  readonly paragraphLineHeightValue: string
  readonly paragraphLineHeightState: ToolbarValueState
  readonly paragraphSpacingBeforeValue: string
  readonly paragraphSpacingBeforeState: ToolbarValueState
  readonly paragraphSpacingAfterValue: string
  readonly paragraphSpacingAfterState: ToolbarValueState
  readonly paragraphFirstLineIndentValue: string
  readonly paragraphFirstLineIndentState: ToolbarValueState
  readonly paragraphHangingIndentValue: string
  readonly paragraphHangingIndentState: ToolbarValueState
  readonly paragraphStyleValue: string
  readonly paragraphStyleState: ToolbarValueState
  readonly paragraphListValue: string
  readonly paragraphListState: ToolbarValueState
}

interface SelectionEndpointContext {
  readonly paragraphId: string
  readonly runId: string
  readonly graphemeIndex: number
}

interface SelectionContext {
  readonly anchor: SelectionEndpointContext
  readonly focus: SelectionEndpointContext
}

const SUPPORTED_PARAGRAPH_TWIPS_VALUES = new Set([
  '0',
  '120',
  '240',
  '360',
  '480',
  '600',
  '720',
  '960',
  '1080',
  '1440',
  '1800',
  '2160',
  '2880'
])
const SUPPORTED_PARAGRAPH_LINE_HEIGHT_VALUES = new Set(['1', '1.15', '1.25', '1.5', '1.75', '1.8', '2', '2.5', '3'])
const SUPPORTED_PARAGRAPH_STYLE_VALUES = new Set(['Normal', 'Heading1', 'Heading2', 'Heading3'])

/** 读取当前 editor 对应的 toolbar 状态。 */
export function buildToolbarState(editor: Editor): ToolbarState {
  const selection = editor.getSelection()
  const formattingState = editor.getSelectionFormattingState()
  const projection = editor.getProjection()
  const context = selection === null ? null : resolveSelectionContext(editor, projection, selection)
  const fontFamily = readSelectState(formattingState.run?.fontFamily ?? null, FONT_FAMILY_EMPTY_VALUE, FONT_FAMILY_MIXED_VALUE)
  const fontSize = readNumberSelectState(formattingState.run?.fontSizeTwips ?? null, FONT_SIZE_EMPTY_VALUE, FONT_SIZE_MIXED_VALUE)
  const textColor = readColorControlState(formattingState.run?.color ?? null, DEFAULT_TEXT_COLOR)
  const backgroundColor = readColorControlState(formattingState.run?.backgroundColor ?? null, DEFAULT_BACKGROUND_COLOR)
  const paragraphAlignment = readParagraphAlignmentSelectState(formattingState.paragraph?.alignment ?? null)
  const paragraphIndentLeft = readParagraphTwipsSelectState(formattingState.paragraph?.indentLeftTwips ?? null)
  const paragraphLineHeight = readParagraphLineHeightSelectState(formattingState.paragraph?.lineHeight ?? null)
  const paragraphSpacingBefore = readParagraphTwipsSelectState(formattingState.paragraph?.spacingBeforeTwips ?? null)
  const paragraphSpacingAfter = readParagraphTwipsSelectState(formattingState.paragraph?.spacingAfterTwips ?? null)
  const paragraphFirstLineIndent = readParagraphTwipsSelectState(formattingState.paragraph?.firstLineIndentTwips ?? null)
  const paragraphHangingIndent = readParagraphTwipsSelectState(formattingState.paragraph?.hangingIndentTwips ?? null)
  const paragraphStyle = readParagraphStyleSelectState(formattingState.paragraph?.styleId ?? null)
  const paragraphList = readParagraphListSelectState(formattingState.paragraph?.list ?? null)

  return {
    canUndo: editor.canUndo(),
    canRedo: editor.canRedo(),
    runFormatEnabled: formattingState.run !== null,
    paragraphFormatEnabled: formattingState.paragraph !== null,
    pagePresetValue: readToolbarPagePresetValue(editor),
    pageOrientationValue: editor.getPageConfig().orientation,
    boldPressed: readPressedState(formattingState.run?.bold ?? null),
    italicPressed: readPressedState(formattingState.run?.italic ?? null),
    underlinePressed: readPressedState(formattingState.run?.underline ?? null),
    strikePressed: readPressedState(formattingState.run?.strike ?? null),
    superscriptPressed: readPressedState(formattingState.run?.superscript ?? null),
    subscriptPressed: readPressedState(formattingState.run?.subscript ?? null),
    fontFamilyValue: fontFamily.value,
    fontFamilyState: fontFamily.state,
    fontSizeValue: fontSize.value,
    fontSizeState: fontSize.state,
    textColorValue: textColor.value,
    textColorState: textColor.state,
    textColorLabel: textColor.label,
    backgroundColorValue: backgroundColor.value,
    backgroundColorState: backgroundColor.state,
    backgroundColorLabel: backgroundColor.label,
    paragraphAlignmentValue: paragraphAlignment.value,
    paragraphAlignmentState: paragraphAlignment.state,
    paragraphIndentLeftValue: paragraphIndentLeft.value,
    paragraphIndentLeftState: paragraphIndentLeft.state,
    paragraphLineHeightValue: paragraphLineHeight.value,
    paragraphLineHeightState: paragraphLineHeight.state,
    paragraphSpacingBeforeValue: paragraphSpacingBefore.value,
    paragraphSpacingBeforeState: paragraphSpacingBefore.state,
    paragraphSpacingAfterValue: paragraphSpacingAfter.value,
    paragraphSpacingAfterState: paragraphSpacingAfter.state,
    paragraphFirstLineIndentValue: paragraphFirstLineIndent.value,
    paragraphFirstLineIndentState: paragraphFirstLineIndent.state,
    paragraphHangingIndentValue: paragraphHangingIndent.value,
    paragraphHangingIndentState: paragraphHangingIndent.state,
    paragraphStyleValue: paragraphStyle.value,
    paragraphStyleState: paragraphStyle.state,
    paragraphListValue: paragraphList.value,
    paragraphListState: paragraphList.state
  }
}

/** 判断事务是否需要触发 UI 层播报。 */
export function shouldAnnounceTransaction(commandName: string): boolean {
  switch (commandName) {
    case 'insertText':
    case 'replaceText':
    case 'deleteSelection':
    case 'deleteBackward':
    case 'deleteForward':
    case 'mergeParagraphBackward':
    case 'mergeParagraphForward':
    case 'splitParagraph':
      return false
    default:
      return true
  }
}

/** 生成 page preset 切换后的播报文案。 */
export function readPagePresetAnnouncement(value: PagePreset, pageConfig: PageConfig): string {
  return `已切换纸张为 ${readPagePresetLabel(value)}，页面尺寸 ${Math.round(pageConfig.widthCssPx)} × ${Math.round(pageConfig.heightCssPx)} px，已重新分页。`
}

/** 生成格式命令完成后的播报文案。 */
export function readTransactionAnnouncement(
  editor: Editor,
  commandName: string,
  i18n: ResolvedJWordUiI18n = resolveJWordUiI18n()
): string {
  const selection = editor.getSelection()
  const context = selection === null ? null : resolveSelectionContext(editor, editor.getProjection(), selection)
  const label = readTransactionLabel(i18n, commandName)

  if (label !== null) {
    const selectionSummary = selection === null ? null : readSelectionSummary(context, selection, i18n)
    const template = readJWordUiText(
      i18n,
      selectionSummary === null ? 'a11y.toolbar.transaction.completed' : 'a11y.toolbar.transaction.completedWithSelection'
    )

    return template
      .replace('{selection}', selectionSummary ?? '')
      .replace('{label}', label)
  }

  return readJWordUiText(i18n, 'a11y.toolbar.transaction.executed')
    .replace('{command}', commandName)
}

/** 生成选区变更后的播报文案。 */
export function readSelectionAnnouncement(
  editor: Editor,
  selection: SelectionState | null,
  i18n: ResolvedJWordUiI18n = resolveJWordUiI18n()
): string {
  if (selection === null) {
    return readJWordUiText(i18n, 'a11y.toolbar.selection.cleared')
  }

  const context = resolveSelectionContext(editor, editor.getProjection(), selection)

  return context === null
    ? readJWordUiText(i18n, 'a11y.toolbar.selection.unresolved')
    : readJWordUiText(i18n, 'a11y.toolbar.selection.updated')
      .replace('{selection}', readSelectionSummary(context, selection, i18n))
}

/** 读取格式事务对应的当前语言工具名称。 */
function readTransactionLabel(i18n: ResolvedJWordUiI18n, commandName: string): string | null {
  const labels: Readonly<Record<string, [string, string]>> = {
    setBold: ['toolbar.format.bold.label', '加粗'],
    setItalic: ['toolbar.format.italic.label', '斜体'],
    setUnderline: ['toolbar.format.underline.label', '下划线'],
    setStrike: ['toolbar.format.strike.label', '删除线'],
    setSuperscript: ['toolbar.format.superscript.label', '上标'],
    setSubscript: ['toolbar.format.subscript.label', '下标'],
    setFontFamily: ['toolbar.format.fontFamily.label', '字体'],
    setFontSize: ['toolbar.format.fontSize.label', '字号'],
    setTextColor: ['toolbar.format.textColor.label', '文字颜色'],
    setBackgroundColor: ['toolbar.format.backgroundColor.label', '背景色'],
    setParagraphAlignment: ['toolbar.paragraph.alignment.label', '段落对齐'],
    setParagraphLineHeight: ['toolbar.paragraph.lineHeight.label', '段落行距'],
    setParagraphIndent: ['toolbar.paragraph.indentLeft.label', '左缩进'],
    adjustParagraphIndent: ['toolbar.paragraph.indentLeft.label', '左缩进'],
    setParagraphSpacingBefore: ['toolbar.paragraph.spacingBefore.label', '段前间距'],
    setParagraphSpacingAfter: ['toolbar.paragraph.spacingAfter.label', '段后间距'],
    setParagraphFirstLineIndent: ['toolbar.paragraph.firstLineIndent.label', '首行缩进'],
    setParagraphHangingIndent: ['toolbar.paragraph.hangingIndent.label', '悬挂缩进'],
    setParagraphStyle: ['toolbar.paragraph.style.label', '段落样式'],
    setParagraphList: ['toolbar.paragraph.list.label', '列表语义']
  }
  const entry = labels[commandName]

  return entry === undefined ? null : readJWordUiText(i18n, entry[0] as JWordUiI18nKey)
}

/** 把 PagePreset 映射成可读标签。 */
export function readPagePresetLabel(value: PagePreset): string {
  switch (value) {
    case 'a3':
      return 'A3'
    case 'a4':
      return 'A4'
    case 'a5':
      return 'A5'
    case 'b5':
      return 'B5'
    case 'letter':
      return 'Letter'
    case 'legal':
      return 'Legal'
    case 'envelope3':
      return '3号信封'
    case 'envelope5':
      return '5号信封'
    case 'envelope6':
      return '6号信封'
    case 'envelope7':
      return '7号信封'
    case 'envelope9':
      return '9号信封'
  }
}

/** 复制当前选区快照，供颜色控件冻结使用。 */
export function cloneSelection(selection: SelectionState | null): SelectionState | null {
  if (selection === null) {
    return null
  }

  return {
    anchor: selection.anchor,
    focus: selection.focus,
    range: selection.range,
    direction: selection.direction,
    affinity: selection.affinity
  }
}

/** 读取指定选区的 formatting state，避免颜色提交依赖变化后的当前选区。 */
export function readSelectionFormattingState(
  editor: Editor,
  selection: SelectionState
): SelectionFormattingState {
  return editor.getSelection() === selection
    ? editor.getSelectionFormattingState()
    : createFormattingState(editor, selection)
}

/** 判断目标字符串格式是否已经处于期望值。 */
export function isRunStringFormatAlreadyApplied(
  formattingState: SelectionFormattingState,
  property: 'fontFamily' | 'textColor' | 'backgroundColor',
  value: string
): boolean {
  const state = formattingState.run

  if (state === null) {
    return false
  }

  switch (property) {
    case 'fontFamily':
      return state.fontFamily.mixed !== true && state.fontFamily.value === value
    case 'textColor':
      return state.color.mixed !== true && state.color.value === value
    case 'backgroundColor':
      return state.backgroundColor.mixed !== true && state.backgroundColor.value === value
  }
}

/** 判断目标字号是否已经处于期望值。 */
export function isRunNumberFormatAlreadyApplied(
  formattingState: SelectionFormattingState,
  value: number
): boolean {
  const state = formattingState.run

  if (state === null) {
    return false
  }

  return state.fontSizeTwips.mixed !== true && state.fontSizeTwips.value === value
}

/** 规范化 hex 颜色值。 */
export function normalizeHexColor(value: string): string | null {
  const normalized = value.trim()

  if (/^#[0-9a-fA-F]{6}$/.test(normalized)) {
    return normalized.toLowerCase()
  }

  if (/^#[0-9a-fA-F]{3}$/.test(normalized)) {
    const [one, two, three] = normalized.slice(1).split('')

    if (one === undefined || two === undefined || three === undefined) {
      return null
    }

    return `#${one}${one}${two}${two}${three}${three}`.toLowerCase()
  }

  return null
}

/** 基于当前 editor 选区即时构造 formatting state。 */
function createFormattingState(editor: Editor, selection: SelectionState): SelectionFormattingState {
  return createSelectionFormattingState(editor.getProjection(), selection)
}

/** 把 runtime page preset 规范化到工具栏可显示的预设值。 */
function readToolbarPagePresetValue(editor: Editor): PagePreset | 'custom' {
  return editor.getPageConfig().preset
}

/** 解析当前选区映射到的 paragraph/run 上下文。 */
function resolveSelectionContext(
  editor: Editor,
  projection: DocumentProjection,
  selection: SelectionState
): SelectionContext | null {
  const anchorPosition = editor.resolveTextPosition(selection.anchor)
  const focusPosition = editor.resolveTextPosition(selection.focus)
  const anchorRun = resolveParagraphRun(projection, anchorPosition)
  const focusRun = resolveParagraphRun(projection, focusPosition)

  if (anchorRun === null || focusRun === null) {
    return null
  }

  return {
    anchor: {
      paragraphId: anchorRun.paragraph.id,
      runId: anchorRun.runId,
      graphemeIndex: anchorPosition.graphemeIndex
    },
    focus: {
      paragraphId: focusRun.paragraph.id,
      runId: focusRun.runId,
      graphemeIndex: focusPosition.graphemeIndex
    }
  }
}

/** 把文本位置映射回 paragraph/run。 */
function resolveParagraphRun(
  projection: DocumentProjection,
  position: TextPosition
): { readonly paragraph: Paragraph, readonly runId: string } | null {
  const section = projection.document.sections.find((item) => item.id === position.sectionId)
  const paragraph = section === undefined ? null : findParagraphById(section.blocks, position.blockId)

  if (paragraph === null) {
    return null
  }

  const run = paragraph.runs.find((item) => item.id === position.runId)

  if (run === undefined) {
    return null
  }

  return {
    paragraph,
    runId: run.id
  }
}

/** 在 block 树里定位目标 paragraph。 */
function findParagraphById(blocks: readonly Block[], blockId: string): Paragraph | null {
  for (const block of blocks) {
    if (block.kind === 'paragraph' && block.id === blockId) {
      return block
    }

    if (block.kind === 'table') {
      for (const row of block.rows) {
        for (const cell of row.cells) {
          const nested = findParagraphById(cell.blocks, blockId)

          if (nested !== null) {
            return nested
          }
        }
      }
    }
  }

  return null
}

/** 生成人类可读的选区摘要。 */
function readSelectionSummary(
  context: SelectionContext | null,
  selection: SelectionState | null,
  i18n: ResolvedJWordUiI18n
): string {
  if (selection === null) {
    return readJWordUiText(i18n, 'a11y.toolbar.selection.none')
  }

  if (context === null) {
    return readJWordUiText(i18n, 'a11y.toolbar.selection.unmapped')
  }

  if (
    context.anchor.paragraphId === context.focus.paragraphId
    && context.anchor.runId === context.focus.runId
  ) {
    const start = Math.min(context.anchor.graphemeIndex, context.focus.graphemeIndex)
    const end = Math.max(context.anchor.graphemeIndex, context.focus.graphemeIndex)

    return readJWordUiText(i18n, 'a11y.toolbar.selection.range')
      .replace('{paragraph}', context.anchor.paragraphId)
      .replace('{run}', context.anchor.runId)
      .replace('{start}', String(start))
      .replace('{end}', String(end))
  }

  return readJWordUiText(i18n, 'a11y.toolbar.selection.between')
    .replace('{anchor}', readSelectionEndpoint(context.anchor))
    .replace('{focus}', readSelectionEndpoint(context.focus))
}

/** 序列化单个选区端点。 */
function readSelectionEndpoint(endpoint: SelectionEndpointContext): string {
  return `${endpoint.paragraphId} / ${endpoint.runId} / ${endpoint.graphemeIndex}`
}

/** 读取按钮按压态。 */
function readPressedState(value: FormattingStateValue<boolean> | null): ToolbarPressedState {
  if (value === null) {
    return 'false'
  }

  if (value.mixed) {
    return 'mixed'
  }

  return value.value === true ? 'true' : 'false'
}

/** 读取字符串下拉框的显示态。 */
function readSelectState(
  value: FormattingStateValue<string> | null,
  emptyValue: string,
  mixedValue: string
): { readonly value: string, readonly state: ToolbarValueState } {
  if (value === null) {
    return { value: emptyValue, state: 'empty' }
  }

  if (value.mixed) {
    return { value: mixedValue, state: 'mixed' }
  }

  if (value.value === undefined || value.value.length === 0) {
    return { value: emptyValue, state: 'empty' }
  }

  return { value: value.value, state: 'value' }
}

/** 读取数字下拉框的显示态。 */
function readNumberSelectState(
  value: FormattingStateValue<number> | null,
  emptyValue: string,
  mixedValue: string
): { readonly value: string, readonly state: ToolbarValueState } {
  if (value === null) {
    return { value: emptyValue, state: 'empty' }
  }

  if (value.mixed) {
    return { value: mixedValue, state: 'mixed' }
  }

  if (value.value === undefined) {
    return { value: emptyValue, state: 'empty' }
  }

  return { value: String(value.value), state: 'value' }
}

/** 读取颜色字段的显示态。 */
function readColorControlState(
  value: FormattingStateValue<string> | null,
  fallback: string
): { readonly value: string, readonly state: ToolbarValueState, readonly label: string } {
  if (value === null) {
    return { value: fallback, state: 'empty', label: '默认' }
  }

  if (value.mixed) {
    return { value: fallback, state: 'mixed', label: '混合' }
  }

  if (value.value === undefined) {
    return { value: fallback, state: 'empty', label: '默认' }
  }

  return {
    value: normalizeHexColor(value.value) ?? fallback,
    state: 'value',
    label: value.value
  }
}

/** 读取段落对齐 select 的显示态。 */
function readParagraphAlignmentSelectState(
  value: FormattingStateValue<ParagraphAlignment> | null
): { readonly value: string, readonly state: ToolbarValueState } {
  if (value === null) {
    return { value: TOOLBAR_SELECT_EMPTY_VALUE, state: 'empty' }
  }

  if (value.mixed) {
    return { value: TOOLBAR_SELECT_MIXED_VALUE, state: 'mixed' }
  }

  if (value.value === undefined) {
    return { value: TOOLBAR_SELECT_EMPTY_VALUE, state: 'empty' }
  }

  return { value: value.value, state: 'value' }
}

/** 读取段落数值 select 的显示态；未显式设置时按 0 值回显。 */
function readParagraphTwipsSelectState(
  value: FormattingStateValue<number> | null
): { readonly value: string, readonly state: ToolbarValueState } {
  if (value === null) {
    return { value: TOOLBAR_SELECT_EMPTY_VALUE, state: 'empty' }
  }

  if (value.mixed) {
    return { value: TOOLBAR_SELECT_MIXED_VALUE, state: 'mixed' }
  }

  const normalizedValue = String(value.value ?? 0)

  return SUPPORTED_PARAGRAPH_TWIPS_VALUES.has(normalizedValue)
    ? { value: normalizedValue, state: 'value' }
    : { value: TOOLBAR_SELECT_EMPTY_VALUE, state: 'empty' }
}

/** 读取段落行距 select 的显示态。 */
function readParagraphLineHeightSelectState(
  value: FormattingStateValue<number> | null
): { readonly value: string, readonly state: ToolbarValueState } {
  if (value === null) {
    return { value: TOOLBAR_SELECT_EMPTY_VALUE, state: 'empty' }
  }

  if (value.mixed) {
    return { value: TOOLBAR_SELECT_MIXED_VALUE, state: 'mixed' }
  }

  if (value.value === undefined) {
    return { value: TOOLBAR_SELECT_EMPTY_VALUE, state: 'empty' }
  }

  const normalizedValue = String(value.value)

  return SUPPORTED_PARAGRAPH_LINE_HEIGHT_VALUES.has(normalizedValue)
    ? { value: normalizedValue, state: 'value' }
    : { value: TOOLBAR_SELECT_EMPTY_VALUE, state: 'empty' }
}

/** 读取段落样式 select 的显示态。 */
function readParagraphStyleSelectState(
  value: FormattingStateValue<string | null> | null
): { readonly value: string, readonly state: ToolbarValueState } {
  if (value === null) {
    return { value: TOOLBAR_SELECT_EMPTY_VALUE, state: 'empty' }
  }

  if (value.mixed) {
    return { value: TOOLBAR_SELECT_MIXED_VALUE, state: 'mixed' }
  }

  if (value.value === undefined || value.value === null) {
    return { value: TOOLBAR_SELECT_EMPTY_VALUE, state: 'empty' }
  }

  return SUPPORTED_PARAGRAPH_STYLE_VALUES.has(value.value)
    ? { value: value.value, state: 'value' }
    : { value: TOOLBAR_SELECT_EMPTY_VALUE, state: 'empty' }
}

/** 读取段落列表 select 的显示态。 */
function readParagraphListSelectState(
  value: FormattingStateValue<ParagraphList | null> | null
): { readonly value: string, readonly state: ToolbarValueState } {
  if (value === null) {
    return { value: TOOLBAR_SELECT_EMPTY_VALUE, state: 'empty' }
  }

  if (value.mixed) {
    return { value: TOOLBAR_SELECT_MIXED_VALUE, state: 'mixed' }
  }

  const normalizedValue = stringifyParagraphListSelectValue(value.value)

  return {
    value: normalizedValue,
    state: normalizedValue === TOOLBAR_SELECT_EMPTY_VALUE ? 'empty' : 'value'
  }
}
