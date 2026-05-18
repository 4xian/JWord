/**
 * 职责：把 core editor 的 facade 状态转换成 toolbar 可直接渲染的只读状态。
 * 边界：不创建 DOM，不绑定事件，只负责状态归一化和文案生成。
 * 协作模块：controller 调用这里构建状态与播报文案，dom 只消费结果。
 * 性能/安全约束：复用现有 facade 能力，不引入第二套文档状态或命令语义。
 * Specs：docs/superpowers/plans/2026-05-17-jword-ui-sdk-gate4-integration.md#phase-1---冻结当前可观察行为。
 */
import type {
  Block,
  DocumentProjection,
  Editor,
  FormattingStateValue,
  PageConfig,
  PagePreset,
  Paragraph,
  ParagraphAlignment,
  ParagraphList,
  SelectionFormattingState,
  SelectionState,
  TextPosition
} from '@4xian/jword-core'
import { createSelectionFormattingState } from '@4xian/jword-core'
import {
  DEFAULT_BACKGROUND_COLOR,
  DEFAULT_TEXT_COLOR,
  FONT_FAMILY_EMPTY_VALUE,
  FONT_FAMILY_MIXED_VALUE,
  FONT_SIZE_EMPTY_VALUE,
  FONT_SIZE_MIXED_VALUE
} from './builtin-tools'

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
  readonly pagePresetValue: PagePreset
  readonly boldPressed: ToolbarPressedState
  readonly italicPressed: ToolbarPressedState
  readonly underlinePressed: ToolbarPressedState
  readonly strikePressed: ToolbarPressedState
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
  readonly alignmentValue: ParagraphAlignment | ''
  readonly alignmentState: ToolbarValueState
  readonly indentLabel: string
  readonly indentState: ToolbarValueState
  readonly selectionSummary: string
  readonly runSummary: string
  readonly blockedSummary: string
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
  const alignment = readAlignmentControlState(formattingState.paragraph?.alignment ?? null)

  return {
    canUndo: editor.canUndo(),
    canRedo: editor.canRedo(),
    runFormatEnabled: formattingState.run !== null,
    paragraphFormatEnabled: formattingState.paragraph !== null,
    pagePresetValue: readToolbarPagePresetValue(editor),
    boldPressed: readPressedState(formattingState.run?.bold ?? null),
    italicPressed: readPressedState(formattingState.run?.italic ?? null),
    underlinePressed: readPressedState(formattingState.run?.underline ?? null),
    strikePressed: readPressedState(formattingState.run?.strike ?? null),
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
    alignmentValue: alignment.value,
    alignmentState: alignment.state,
    indentLabel: readIndentLabel(formattingState.paragraph?.indentLeftTwips ?? null),
    indentState: readValueState(formattingState.paragraph?.indentLeftTwips ?? null),
    selectionSummary: readSelectionSummary(context, selection),
    runSummary: readRunSummary(formattingState),
    blockedSummary: readBlockedSummary(editor.getLayout().pages.length, context, formattingState)
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
export function readTransactionAnnouncement(editor: Editor, commandName: string): string {
  const selection = editor.getSelection()
  const context = selection === null ? null : resolveSelectionContext(editor, editor.getProjection(), selection)
  const summaryPrefix = selection === null ? '' : `${readSelectionSummary(context, selection)}，`

  switch (commandName) {
    case 'setBold':
      return `${summaryPrefix}已同步加粗状态。`
    case 'setItalic':
      return `${summaryPrefix}已同步斜体状态。`
    case 'setUnderline':
      return `${summaryPrefix}已同步下划线状态。`
    case 'setStrike':
      return `${summaryPrefix}已同步删除线状态。`
    case 'setFontFamily':
      return `${summaryPrefix}已同步字体。`
    case 'setFontSize':
      return `${summaryPrefix}已同步字号。`
    case 'setTextColor':
      return `${summaryPrefix}已同步文字颜色。`
    case 'setBackgroundColor':
      return `${summaryPrefix}已同步背景色。`
    case 'setParagraphAlignment':
      return `${summaryPrefix}已同步段落对齐。`
    case 'setParagraphIndent':
    case 'adjustParagraphIndent':
      return `${summaryPrefix}已同步段落缩进。`
    default:
      return `已执行 ${commandName}。`
  }
}

/** 生成选区变更后的播报文案。 */
export function readSelectionAnnouncement(editor: Editor, selection: SelectionState | null): string {
  if (selection === null) {
    return '选区已清空。'
  }

  const context = resolveSelectionContext(editor, editor.getProjection(), selection)

  return context === null
    ? '选区已更新，但当前未能定位到可格式化的 paragraph/run。'
    : `${readSelectionSummary(context, selection)}。`
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
    case 'letter':
      return 'Letter'
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

/** 把 ParagraphAlignment 状态映射为按钮 aria-pressed 值。 */
export function readAlignmentPressedState(state: ToolbarState, alignment: ParagraphAlignment): ToolbarPressedState {
  if (state.alignmentState === 'mixed') {
    return 'mixed'
  }

  return state.alignmentValue === alignment ? 'true' : 'false'
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
function readToolbarPagePresetValue(editor: Editor): PagePreset {
  const preset = editor.getPageConfig().preset

  return preset === 'custom' ? 'a4' : preset
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
  selection: SelectionState | null
): string {
  if (selection === null) {
    return '无选区'
  }

  if (context === null) {
    return '选区已更新，但当前未能映射到可读文本位置。'
  }

  if (
    context.anchor.paragraphId === context.focus.paragraphId
    && context.anchor.runId === context.focus.runId
  ) {
    const start = Math.min(context.anchor.graphemeIndex, context.focus.graphemeIndex)
    const end = Math.max(context.anchor.graphemeIndex, context.focus.graphemeIndex)

    return `选区：${context.anchor.paragraphId} / ${context.anchor.runId} / ${start}→${end}`
  }

  return `选区：${readSelectionEndpoint(context.anchor)} → ${readSelectionEndpoint(context.focus)}`
}

/** 序列化单个选区端点。 */
function readSelectionEndpoint(endpoint: SelectionEndpointContext): string {
  return `${endpoint.paragraphId} / ${endpoint.runId} / ${endpoint.graphemeIndex}`
}

/** 生成格式摘要文本。 */
function readRunSummary(formattingState: SelectionFormattingState): string {
  if (formattingState.run === null || formattingState.paragraph === null) {
    return '当前格式：未定位'
  }

  return [
    `B ${readFormattingToken(formattingState.run.bold, '开', '关')}`,
    `I ${readFormattingToken(formattingState.run.italic, '开', '关')}`,
    `U ${readFormattingToken(formattingState.run.underline, '开', '关')}`,
    `S ${readFormattingToken(formattingState.run.strike, '开', '关')}`,
    `上标 ${readFormattingToken(formattingState.run.superscript, '开', '关')}`,
    `下标 ${readFormattingToken(formattingState.run.subscript, '开', '关')}`,
    `字体 ${readStringFormattingToken(formattingState.run.fontFamily, '默认')}`,
    `字号 ${readNumberFormattingToken(formattingState.run.fontSizeTwips, '默认', formatFontSizeTwips)}`,
    `字色 ${readStringFormattingToken(formattingState.run.color, '默认')}`,
    `底色 ${readStringFormattingToken(formattingState.run.backgroundColor, '默认')}`,
    `对齐 ${readStringFormattingToken(formattingState.paragraph.alignment, '默认')}`,
    `行距 ${readNumberFormattingToken(formattingState.paragraph.lineHeight, '默认', formatLineHeight)}`,
    `缩进 ${readNumberFormattingToken(formattingState.paragraph.indentLeftTwips, '0 pt', formatIndentTwips)}`,
    `段前 ${readNumberFormattingToken(formattingState.paragraph.spacingBeforeTwips, '0 pt', formatIndentTwips)}`,
    `段后 ${readNumberFormattingToken(formattingState.paragraph.spacingAfterTwips, '0 pt', formatIndentTwips)}`,
    `首行 ${readNumberFormattingToken(formattingState.paragraph.firstLineIndentTwips, '0 pt', formatIndentTwips)}`,
    `悬挂 ${readNumberFormattingToken(formattingState.paragraph.hangingIndentTwips, '0 pt', formatIndentTwips)}`,
    `样式 ${readNullableStringFormattingToken(formattingState.paragraph.styleId, '默认')}`,
    `列表 ${readParagraphListFormattingToken(formattingState.paragraph.list)}`
  ].join(' / ')
}

/** 生成 blocked summary。 */
function readBlockedSummary(
  mountedPageCount: number,
  context: SelectionContext | null,
  formattingState: SelectionFormattingState
): string {
  if (mountedPageCount > 4) {
    return 'Gate 2 的 50 页夹具仍用于分页验证；toolbar 交互请先切到 Alpha 样例。最小缺口是 core 需要把大文档 selection/render 热路径降到可交互级别。'
  }

  if (context === null) {
    return '当前已接通 facade-driven 基础格式、颜色、对齐和缩进；请先选择片段后再格式化。'
  }

  if (hasMixedFormattingState(formattingState)) {
    return '当前选区已覆盖多个 run 或段落；toolbar 会直接显示 mixed，并把下一次格式命令统一归一到整个选区上。'
  }

  return '当前已可通过同一 Editor Facade 执行键盘输入、IME 合成、纯文本剪贴板、真实 pointer selection 与基础格式命令；剩余缺口主要在跨平台实机输入证据与 Alpha 性能达标。'
}

/** 判断当前 formatting state 是否含 mixed。 */
function hasMixedFormattingState(formattingState: SelectionFormattingState): boolean {
  return formattingState.run !== null && (
    formattingState.run.bold.mixed
      || formattingState.run.italic.mixed
      || formattingState.run.underline.mixed
      || formattingState.run.strike.mixed
      || formattingState.run.superscript.mixed
      || formattingState.run.subscript.mixed
      || formattingState.run.fontFamily.mixed
      || formattingState.run.fontSizeTwips.mixed
      || formattingState.run.color.mixed
      || formattingState.run.backgroundColor.mixed
  ) || formattingState.paragraph !== null && (
    formattingState.paragraph.alignment.mixed
      || formattingState.paragraph.indentLeftTwips.mixed
      || formattingState.paragraph.lineHeight.mixed
      || formattingState.paragraph.spacingBeforeTwips.mixed
      || formattingState.paragraph.spacingAfterTwips.mixed
      || formattingState.paragraph.firstLineIndentTwips.mixed
      || formattingState.paragraph.hangingIndentTwips.mixed
      || formattingState.paragraph.styleId.mixed
      || formattingState.paragraph.list.mixed
  )
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

/** 读取对齐控件的显示态。 */
function readAlignmentControlState(
  value: FormattingStateValue<ParagraphAlignment> | null
): { readonly value: ParagraphAlignment | '', readonly state: ToolbarValueState } {
  if (value === null) {
    return { value: '', state: 'empty' }
  }

  if (value.mixed) {
    return { value: '', state: 'mixed' }
  }

  if (value.value === undefined) {
    return { value: '', state: 'empty' }
  }

  return { value: value.value, state: 'value' }
}

/** 读取缩进字段标签。 */
function readIndentLabel(value: FormattingStateValue<number> | null): string {
  if (value === null) {
    return '未定位'
  }

  if (value.mixed) {
    return '混合'
  }

  return formatIndentTwips(value.value ?? 0)
}

/** 读取字段通用值态。 */
function readValueState<Value>(value: FormattingStateValue<Value> | null): ToolbarValueState {
  if (value === null) {
    return 'empty'
  }

  if (value.mixed) {
    return 'mixed'
  }

  return value.value === undefined ? 'empty' : 'value'
}

/** 把格式值转换成摘要 token。 */
function readFormattingToken<Value>(
  value: FormattingStateValue<Value>,
  activeLabel: string | undefined,
  inactiveLabel: string
): string {
  if (value.mixed) {
    return '混合'
  }

  if (value.value === undefined) {
    return inactiveLabel
  }

  if (typeof value.value === 'boolean') {
    return value.value ? (activeLabel ?? '开') : inactiveLabel
  }

  return String(value.value)
}

/** 把字符串格式值转换成摘要 token。 */
function readStringFormattingToken(
  value: FormattingStateValue<string | ParagraphAlignment>,
  emptyLabel: string
): string {
  if (value.mixed) {
    return '混合'
  }

  return value.value === undefined ? emptyLabel : value.value
}

/**
 * 把可空字符串格式值转换成摘要 token。
 */
function readNullableStringFormattingToken(
  value: FormattingStateValue<string | null>,
  emptyLabel: string
): string {
  if (value.mixed) {
    return '混合'
  }

  return value.value === undefined || value.value === null
    ? emptyLabel
    : value.value
}

/** 把数字格式值转换成摘要 token。 */
function readNumberFormattingToken(
  value: FormattingStateValue<number>,
  emptyLabel: string,
  formatter: (value: number) => string
): string {
  if (value.mixed) {
    return '混合'
  }

  return value.value === undefined ? emptyLabel : formatter(value.value)
}

/** 把字号 twips 转成 pt 文案。 */
function formatFontSizeTwips(value: number): string {
  const points = value / 20

  return Number.isInteger(points) ? `${points} pt` : `${points.toFixed(1)} pt`
}

/**
 * 把行距值转成摘要文案。
 */
function formatLineHeight(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}

/** 把缩进 twips 转成 pt 文案。 */
function formatIndentTwips(value: number): string {
  return `${(value / 20).toFixed(value % 20 === 0 ? 0 : 1)} pt`
}

/**
 * 把稳定列表语义转换成 toolbar 摘要文案。
 */
function readParagraphListFormattingToken(value: FormattingStateValue<ParagraphList | null>): string {
  if (value.mixed) {
    return '混合'
  }

  if (value.value === undefined || value.value === null) {
    return '无'
  }

  return `${value.value.numberingId} / L${value.value.level}`
}
