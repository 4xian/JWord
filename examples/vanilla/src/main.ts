/**
 * 职责：启动无框架 Vite demo，挂载 core Editor facade，并在 examples 层提供 Gate 3 第一版 toolbar 与最小 a11y 支架。
 * 边界：不实现 contenteditable、IME、键盘输入或 core 内部命令 helper；只接通 examples 层能真实调用的 facade 能力。
 * 协作模块：@4xian/jword-core 的 Editor mount/undo/redo/command/selection facade、分页 canvas 生命周期和 demo HTML host。
 * 性能/安全约束：只在 demo 入口访问 DOM，不用 innerHTML 构造 UI；完整选区格式化若缺 core 能力则只在 examples 层显式降级。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/03-architecture.md 与 05-implementation-gates.md。
 */
import { createEditor } from '@4xian/jword-core'
import type {
  Block,
  DocumentProjection,
  FormattingStateValue,
  Paragraph,
  ParagraphAlignment,
  RangeRef,
  SelectionFormattingState,
  SelectionState,
  TextPosition
} from '@4xian/jword-core'
import { createGate2FixtureEditorText } from '../../../fixtures/plain-text/gate2-fixture.mjs'
import type { JWordDemoSelectionInput } from './vite-env'
import gate2FixtureText from '../../../fixtures/plain-text/gate2-50-pages.txt?raw'
import './styles.css'

type RunBooleanFormatKey = 'bold' | 'italic' | 'underline' | 'strike'
type RunStringFormatKey = 'fontFamily' | 'textColor' | 'backgroundColor'
type RunNumberFormatKey = 'fontSize'
type ToolbarPressedState = 'true' | 'false' | 'mixed'
type ToolbarValueState = 'empty' | 'value' | 'mixed'

interface ToolbarElements {
  readonly host: HTMLElement
  readonly loadAlphaSampleButton: HTMLButtonElement
  readonly restoreGate2FixtureButton: HTMLButtonElement
  readonly selectSampleButton: HTMLButtonElement
  readonly clearSelectionButton: HTMLButtonElement
  readonly undoButton: HTMLButtonElement
  readonly redoButton: HTMLButtonElement
  readonly boldButton: HTMLButtonElement
  readonly italicButton: HTMLButtonElement
  readonly underlineButton: HTMLButtonElement
  readonly strikeButton: HTMLButtonElement
  readonly fontFamilySelect: HTMLSelectElement
  readonly fontSizeSelect: HTMLSelectElement
  readonly textColorInput: HTMLInputElement
  readonly textColorValueNode: HTMLElement
  readonly backgroundColorInput: HTMLInputElement
  readonly backgroundColorValueNode: HTMLElement
  readonly alignLeftButton: HTMLButtonElement
  readonly alignCenterButton: HTMLButtonElement
  readonly alignRightButton: HTMLButtonElement
  readonly alignJustifyButton: HTMLButtonElement
  readonly indentDecreaseButton: HTMLButtonElement
  readonly indentIncreaseButton: HTMLButtonElement
  readonly indentValueNode: HTMLElement
  readonly selectionSummaryNode: HTMLElement
  readonly runSummaryNode: HTMLElement
  readonly blockedSummaryNode: HTMLElement
}

interface ToolbarState {
  readonly canUndo: boolean
  readonly canRedo: boolean
  readonly selectionSummary: string
  readonly runSummary: string
  readonly blockedSummary: string
  readonly selectSampleEnabled: boolean
  readonly clearSelectionEnabled: boolean
  readonly runFormatEnabled: boolean
  readonly paragraphFormatEnabled: boolean
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

interface ToolbarOption {
  readonly value: string
  readonly label: string
}

const FONT_FAMILY_EMPTY_VALUE = ''
const FONT_FAMILY_MIXED_VALUE = '__mixed__'
const FONT_SIZE_EMPTY_VALUE = ''
const FONT_SIZE_MIXED_VALUE = '__mixed__'
const DEFAULT_TEXT_COLOR = '#111111'
const DEFAULT_BACKGROUND_COLOR = '#fff59d'
const INDENT_STEP_TWIPS = 720
const FONT_FAMILY_OPTIONS: readonly ToolbarOption[] = [
  { value: FONT_FAMILY_EMPTY_VALUE, label: '字体' },
  { value: FONT_FAMILY_MIXED_VALUE, label: '混合' },
  { value: 'Inter', label: 'Inter' },
  { value: 'Arial', label: 'Arial' },
  { value: 'SimSun', label: '宋体' },
  { value: 'KaiTi', label: '楷体' },
  { value: 'SimHei', label: '黑体' },
  { value: 'FangSong', label: '仿宋' }
] as const
const FONT_SIZE_OPTIONS: readonly ToolbarOption[] = [
  { value: FONT_SIZE_EMPTY_VALUE, label: '字号' },
  { value: FONT_SIZE_MIXED_VALUE, label: '混合' },
  { value: '180', label: '9 pt' },
  { value: '200', label: '10 pt' },
  { value: '220', label: '11 pt' },
  { value: '240', label: '12 pt' },
  { value: '280', label: '14 pt' },
  { value: '320', label: '16 pt' },
  { value: '360', label: '18 pt' },
  { value: '420', label: '21 pt' }
] as const

const editorHost = document.querySelector<HTMLElement>('#jword-editor')
const statusNode = document.querySelector<HTMLElement>('#jword-status')
const toolbarHost = document.querySelector<HTMLElement>('.jw-demo__toolbar')

if (editorHost === null) {
  throw new Error('JWord vanilla demo requires #jword-editor.')
}

if (toolbarHost === null) {
  throw new Error('JWord vanilla demo requires .jw-demo__toolbar.')
}

const editor = createEditor({
  initialText: createGate2DemoText(gate2FixtureText)
})
const toolbar = createToolbar(toolbarHost)
const textMirror = createTextMirror()
let lastLiveMessage = ''
let lastMirrorText = ''
let lastToolbarStateKey = ''
const alphaDemoText = createAlphaDemoText()

statusNode?.setAttribute('data-jword-live-region', 'true')
statusNode?.setAttribute('role', 'status')
editor.mount(editorHost)
editorHost.append(textMirror)

const unsubscribeEditor = editor.subscribe((event) => {
  if (event.kind === 'selectionChange') {
    renderRuntimeState(event.selection, event.formattingState)
    syncTextMirror()
    return
  }

  if (event.kind === 'transaction') {
    renderRuntimeState(editor.getSelection(), editor.getSelectionFormattingState())
    announceStatus(readTransactionAnnouncement(event.transaction.commandName), true)
    return
  }

  if (event.kind === 'destroyed') {
    announceStatus('JWord demo editor 已销毁。')
  }
})

window.__jwordDemo = Object.freeze({
  editor,
  selectTextRange
})

toolbar.selectSampleButton.addEventListener('click', () => {
  if (editor.getLayout().pages.length > 4) {
    announceStatus('BLOCKED: 当前 Gate 2 大夹具上的选区体验先禁用；请先加载 Alpha 样例。')
    return
  }

  const input = findFirstFragmentSelectionInput()

  if (input === null) {
    announceStatus('BLOCKED: 当前分页布局没有可选文本片段。')
    return
  }

  selectTextRange(input)
})

toolbar.loadAlphaSampleButton.addEventListener('click', () => {
  editor.createDocument({ text: alphaDemoText })
  syncRuntimeState()
  announceStatus('已加载 Alpha 工具栏样例。', true)
})

toolbar.restoreGate2FixtureButton.addEventListener('click', () => {
  editor.createDocument({ text: createGate2DemoText(gate2FixtureText) })
  syncRuntimeState()
  announceStatus('已恢复 Gate 2 50 页夹具。', true)
})

toolbar.clearSelectionButton.addEventListener('click', () => {
  editor.setSelection(null)
  syncRuntimeState()
  announceStatus('选区已清空。')
})

toolbar.undoButton.addEventListener('click', () => {
  const result = editor.undo()

  syncRuntimeState()
  announceStatus(result.stackItem === null ? '没有可撤销的本地操作。' : '已撤销最近一次本地操作。', result.stackItem !== null)
})

toolbar.redoButton.addEventListener('click', () => {
  const result = editor.redo()

  syncRuntimeState()
  announceStatus(result.stackItem === null ? '没有可重做的本地操作。' : '已重做最近一次本地操作。', result.stackItem !== null)
})

toolbar.boldButton.addEventListener('click', () => {
  toggleActiveRunBooleanFormat('bold', '加粗')
})

toolbar.italicButton.addEventListener('click', () => {
  toggleActiveRunBooleanFormat('italic', '斜体')
})

toolbar.underlineButton.addEventListener('click', () => {
  toggleActiveRunBooleanFormat('underline', '下划线')
})

toolbar.strikeButton.addEventListener('click', () => {
  toggleActiveRunBooleanFormat('strike', '删除线')
})

toolbar.fontFamilySelect.addEventListener('change', () => {
  const value = toolbar.fontFamilySelect.value

  if (value === FONT_FAMILY_EMPTY_VALUE || value === FONT_FAMILY_MIXED_VALUE) {
    syncRuntimeState()
    return
  }

  applyRunStringFormat('fontFamily', '字体', value)
})

toolbar.fontSizeSelect.addEventListener('change', () => {
  const value = toolbar.fontSizeSelect.value

  if (value === FONT_SIZE_EMPTY_VALUE || value === FONT_SIZE_MIXED_VALUE) {
    syncRuntimeState()
    return
  }

  const parsedValue = Number.parseInt(value, 10)

  if (!Number.isFinite(parsedValue)) {
    announceStatus(`BLOCKED: 无法识别字号值 ${value}。`)
    syncRuntimeState()
    return
  }

  applyRunNumberFormat('fontSize', '字号', parsedValue)
})

toolbar.textColorInput.addEventListener('change', () => {
  applyRunStringFormat('textColor', '文字颜色', toolbar.textColorInput.value.toLowerCase())
})

toolbar.backgroundColorInput.addEventListener('change', () => {
  applyRunStringFormat('backgroundColor', '背景色', toolbar.backgroundColorInput.value.toLowerCase())
})

toolbar.alignLeftButton.addEventListener('click', () => {
  applyParagraphAlignment('left', '左对齐')
})

toolbar.alignCenterButton.addEventListener('click', () => {
  applyParagraphAlignment('center', '居中对齐')
})

toolbar.alignRightButton.addEventListener('click', () => {
  applyParagraphAlignment('right', '右对齐')
})

toolbar.alignJustifyButton.addEventListener('click', () => {
  applyParagraphAlignment('justify', '两端对齐')
})

toolbar.indentDecreaseButton.addEventListener('click', () => {
  adjustParagraphIndent(-INDENT_STEP_TWIPS, '减少缩进')
})

toolbar.indentIncreaseButton.addEventListener('click', () => {
  adjustParagraphIndent(INDENT_STEP_TWIPS, '增加缩进')
})

syncRuntimeState()
syncTextMirror()
announceStatus(
  `Gate 3 Alpha toolbar 已挂载，pages: ${editor.getLayout().pages.length}。当前已接通 facade-driven 基础格式命令、状态同步、撤销重做、aria-live 与文本镜像。`,
  true
)

window.addEventListener(
  'beforeunload',
  () => {
    unsubscribeEditor()
    delete window.__jwordDemo
    editor.destroy()
  },
  { once: true }
)

function createGate2DemoText(fixtureText: string): string {
  return createGate2FixtureEditorText(fixtureText)
}

function selectTextRange(input: JWordDemoSelectionInput): SelectionState {
  const anchor = editor.createTextAnchor({
    sectionId: input.sectionId,
    blockId: input.blockId,
    runId: input.runId,
    graphemeIndex: input.anchorGraphemeIndex
  })
  const focus = editor.createTextAnchor({
    sectionId: input.sectionId,
    blockId: input.blockId,
    runId: input.runId,
    graphemeIndex: input.focusGraphemeIndex
  })
  const selection = Object.freeze({
    anchor,
    focus,
    range: Object.freeze({ anchor, focus }) as RangeRef,
    direction: input.anchorGraphemeIndex === input.focusGraphemeIndex
      ? 'none'
      : input.anchorGraphemeIndex < input.focusGraphemeIndex ? 'forward' : 'backward',
    affinity: 'none'
  }) satisfies SelectionState

  editor.setSelection(selection)
  syncRuntimeState()
  announceStatus(readSelectionAnnouncement(selection))

  return selection
}

function announceStatus(message?: string, refreshMirror = false): void {
  if (refreshMirror) {
    syncTextMirror()
  }

  if (statusNode !== null) {
    if (message !== undefined) {
      lastLiveMessage = message
    }

    statusNode.textContent = lastLiveMessage
  }
}

function syncRuntimeState(): void {
  renderRuntimeState(editor.getSelection(), editor.getSelectionFormattingState())
}

function renderRuntimeState(
  selection: SelectionState | null,
  formattingState: SelectionFormattingState
): void {
  const state = buildToolbarState(selection, formattingState)
  const nextStateKey = JSON.stringify(state)

  if (nextStateKey === lastToolbarStateKey) {
    return
  }

  lastToolbarStateKey = nextStateKey
  renderToolbarState(toolbar, state)
}

function syncTextMirror(): void {
  const nextText = readProjectionPlainText(editor.getProjection())

  if (nextText === lastMirrorText) {
    return
  }

  textMirror.textContent = nextText
  lastMirrorText = nextText
}

function buildToolbarState(
  selection: SelectionState | null,
  formattingState: SelectionFormattingState
): ToolbarState {
  const context = selection === null ? null : resolveSelectionContext(editor.getProjection(), selection)
  const canUndo = editor.canUndo()
  const canRedo = editor.canRedo()
  const clearSelectionEnabled = selection !== null
  const selectSampleEnabled = editor.getLayout().pages.length <= 4
  const runFormatEnabled = formattingState.run !== null
  const paragraphFormatEnabled = formattingState.paragraph !== null
  const fontFamily = readSelectState(formattingState.run?.fontFamily ?? null, FONT_FAMILY_EMPTY_VALUE, FONT_FAMILY_MIXED_VALUE)
  const fontSize = readNumberSelectState(formattingState.run?.fontSizeTwips ?? null, FONT_SIZE_EMPTY_VALUE, FONT_SIZE_MIXED_VALUE)
  const textColor = readColorControlState(formattingState.run?.color ?? null, DEFAULT_TEXT_COLOR)
  const backgroundColor = readColorControlState(formattingState.run?.backgroundColor ?? null, DEFAULT_BACKGROUND_COLOR)
  const alignment = readAlignmentControlState(formattingState.paragraph?.alignment ?? null)

  return {
    canUndo,
    canRedo,
    selectionSummary: readSelectionSummary(context, selection),
    runSummary: readRunSummary(formattingState),
    blockedSummary: readBlockedSummary(context, formattingState),
    selectSampleEnabled,
    clearSelectionEnabled,
    runFormatEnabled,
    paragraphFormatEnabled,
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
    indentState: readValueState(formattingState.paragraph?.indentLeftTwips ?? null)
  }
}

function renderToolbarState(elements: ToolbarElements, state: ToolbarState): void {
  elements.selectSampleButton.disabled = !state.selectSampleEnabled
  elements.undoButton.disabled = !state.canUndo
  elements.redoButton.disabled = !state.canRedo
  elements.clearSelectionButton.disabled = !state.clearSelectionEnabled
  elements.boldButton.disabled = !state.runFormatEnabled
  elements.italicButton.disabled = !state.runFormatEnabled
  elements.underlineButton.disabled = !state.runFormatEnabled
  elements.strikeButton.disabled = !state.runFormatEnabled
  elements.fontFamilySelect.disabled = !state.runFormatEnabled
  elements.fontSizeSelect.disabled = !state.runFormatEnabled
  elements.textColorInput.disabled = !state.runFormatEnabled
  elements.backgroundColorInput.disabled = !state.runFormatEnabled
  elements.alignLeftButton.disabled = !state.paragraphFormatEnabled
  elements.alignCenterButton.disabled = !state.paragraphFormatEnabled
  elements.alignRightButton.disabled = !state.paragraphFormatEnabled
  elements.alignJustifyButton.disabled = !state.paragraphFormatEnabled
  elements.indentDecreaseButton.disabled = !state.paragraphFormatEnabled
  elements.indentIncreaseButton.disabled = !state.paragraphFormatEnabled

  elements.boldButton.setAttribute('aria-pressed', state.boldPressed)
  elements.italicButton.setAttribute('aria-pressed', state.italicPressed)
  elements.underlineButton.setAttribute('aria-pressed', state.underlinePressed)
  elements.strikeButton.setAttribute('aria-pressed', state.strikePressed)
  setAlignmentButtonState(elements.alignLeftButton, state, 'left')
  setAlignmentButtonState(elements.alignCenterButton, state, 'center')
  setAlignmentButtonState(elements.alignRightButton, state, 'right')
  setAlignmentButtonState(elements.alignJustifyButton, state, 'justify')

  elements.fontFamilySelect.value = state.fontFamilyValue
  elements.fontFamilySelect.setAttribute('data-jword-state', state.fontFamilyState)
  elements.fontSizeSelect.value = state.fontSizeValue
  elements.fontSizeSelect.setAttribute('data-jword-state', state.fontSizeState)
  elements.textColorInput.value = state.textColorValue
  elements.textColorInput.setAttribute('data-jword-state', state.textColorState)
  elements.textColorValueNode.textContent = `字色：${state.textColorLabel}`
  elements.backgroundColorInput.value = state.backgroundColorValue
  elements.backgroundColorInput.setAttribute('data-jword-state', state.backgroundColorState)
  elements.backgroundColorValueNode.textContent = `底色：${state.backgroundColorLabel}`
  elements.indentValueNode.textContent = `缩进：${state.indentLabel}`
  elements.indentValueNode.setAttribute('data-jword-state', state.indentState)

  elements.selectionSummaryNode.textContent = state.selectionSummary
  elements.runSummaryNode.textContent = state.runSummary
  elements.blockedSummaryNode.textContent = state.blockedSummary
}

function toggleActiveRunBooleanFormat(property: RunBooleanFormatKey, label: string): void {
  const selection = editor.getSelection()
  const formattingState = editor.getSelectionFormattingState()

  if (selection === null || formattingState.run === null) {
    announceStatus(`BLOCKED: ${label} 需要当前有可格式化的文本选区。`)
    return
  }

  const state = formattingState.run[property]
  const nextValue = readNextBooleanValue(state)
  void selection
  void nextValue

  switch (property) {
    case 'bold':
      editor.toggleBold()
      return
    case 'italic':
      editor.toggleItalic()
      return
    case 'underline':
      editor.toggleUnderline()
      return
    case 'strike':
      editor.toggleStrike()
      return
  }
}

function applyRunStringFormat(property: RunStringFormatKey, label: string, value: string): void {
  const selection = editor.getSelection()
  const formattingState = editor.getSelectionFormattingState()

  if (selection === null || formattingState.run === null) {
    announceStatus(`BLOCKED: ${label} 需要当前有可格式化的文本选区。`)
    syncRuntimeState()
    return
  }

  if (isRunStringFormatAlreadyApplied(formattingState, property, value)) {
    announceStatus(`${label} 已经处于目标状态。`)
    syncRuntimeState()
    return
  }

  void selection

  switch (property) {
    case 'fontFamily':
      editor.setFontFamily(value)
      return
    case 'textColor':
      editor.setTextColor(value)
      return
    case 'backgroundColor':
      editor.setBackgroundColor(value)
      return
  }
}

function applyRunNumberFormat(property: RunNumberFormatKey, label: string, value: number): void {
  const selection = editor.getSelection()
  const formattingState = editor.getSelectionFormattingState()

  if (selection === null || formattingState.run === null) {
    announceStatus(`BLOCKED: ${label} 需要当前有可格式化的文本选区。`)
    syncRuntimeState()
    return
  }

  if (isRunNumberFormatAlreadyApplied(formattingState, property, value)) {
    announceStatus(`${label} 已经处于目标状态。`)
    syncRuntimeState()
    return
  }

  void selection

  switch (property) {
    case 'fontSize':
      editor.setFontSize(value)
      return
  }
}

function applyParagraphAlignment(value: ParagraphAlignment, label: string): void {
  const selection = editor.getSelection()
  const formattingState = editor.getSelectionFormattingState()

  if (selection === null || formattingState.paragraph === null) {
    announceStatus(`BLOCKED: ${label} 需要当前有可格式化的段落选区。`)
    return
  }

  if (formattingState.paragraph.alignment.mixed !== true && formattingState.paragraph.alignment.value === value) {
    announceStatus(`${label} 已经处于目标状态。`)
    return
  }

  void selection
  editor.setParagraphAlignment(value)
}

function adjustParagraphIndent(deltaTwips: number, label: string): void {
  const selection = editor.getSelection()
  const formattingState = editor.getSelectionFormattingState()

  if (selection === null || formattingState.paragraph === null) {
    announceStatus(`BLOCKED: ${label} 需要当前有可格式化的段落选区。`)
    return
  }

  const currentIndent = formattingState.paragraph.indentLeftTwips.mixed
    ? 0
    : formattingState.paragraph.indentLeftTwips.value ?? 0
  const nextIndent = Math.max(0, currentIndent + deltaTwips)

  if (currentIndent === nextIndent) {
    announceStatus(`${label} 已经处于目标状态。`)
    return
  }

  void selection
  editor.adjustParagraphIndent(deltaTwips)
}

function isRunStringFormatAlreadyApplied(
  formattingState: SelectionFormattingState,
  property: RunStringFormatKey,
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

function isRunNumberFormatAlreadyApplied(
  formattingState: SelectionFormattingState,
  property: RunNumberFormatKey,
  value: number
): boolean {
  const state = formattingState.run

  if (state === null) {
    return false
  }

  switch (property) {
    case 'fontSize':
      return state.fontSizeTwips.mixed !== true && state.fontSizeTwips.value === value
  }
}

function findFirstFragmentSelectionInput(): JWordDemoSelectionInput | null {
  const firstPage = editor.getLayout().pages[0]
  const firstLine = firstPage?.lines.find((line) => line.fragments.length > 0)
  const firstFragment = firstLine?.fragments[0]

  if (firstFragment === undefined) {
    return null
  }

  const focusGraphemeIndex = Math.min(firstFragment.end.graphemeIndex, firstFragment.start.graphemeIndex + 4)

  return {
    sectionId: firstFragment.sectionId,
    blockId: firstFragment.blockId,
    runId: firstFragment.runId,
    anchorGraphemeIndex: firstFragment.start.graphemeIndex,
    focusGraphemeIndex
  }
}

function resolveSelectionContext(projection: DocumentProjection, selection: SelectionState): SelectionContext | null {
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

function readSelectionEndpoint(endpoint: SelectionEndpointContext): string {
  return `${endpoint.paragraphId} / ${endpoint.runId} / ${endpoint.graphemeIndex}`
}

function readRunSummary(formattingState: SelectionFormattingState): string {
  if (formattingState.run === null || formattingState.paragraph === null) {
    return '当前格式：未定位'
  }

  return [
    `B ${readFormattingToken(formattingState.run.bold, '开', '关')}`,
    `I ${readFormattingToken(formattingState.run.italic, '开', '关')}`,
    `U ${readFormattingToken(formattingState.run.underline, '开', '关')}`,
    `S ${readFormattingToken(formattingState.run.strike, '开', '关')}`,
    `字体 ${readStringFormattingToken(formattingState.run.fontFamily, '默认')}`,
    `字号 ${readNumberFormattingToken(formattingState.run.fontSizeTwips, '默认', formatFontSizeTwips)}`,
    `字色 ${readStringFormattingToken(formattingState.run.color, '默认')}`,
    `底色 ${readStringFormattingToken(formattingState.run.backgroundColor, '默认')}`,
    `对齐 ${readStringFormattingToken(formattingState.paragraph.alignment, '默认')}`,
    `缩进 ${readNumberFormattingToken(formattingState.paragraph.indentLeftTwips, '0 pt', formatIndentTwips)}`
  ].join(' / ')
}

function readPressedState(value: FormattingStateValue<boolean> | null): ToolbarPressedState {
  if (value === null) {
    return 'false'
  }

  if (value.mixed) {
    return 'mixed'
  }

  return value.value === true ? 'true' : 'false'
}

function readNextBooleanValue(value: FormattingStateValue<boolean>): boolean {
  if (value.mixed) {
    return true
  }

  return value.value !== true
}

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

function readStringFormattingToken(
  value: FormattingStateValue<string>,
  emptyLabel: string
): string {
  if (value.mixed) {
    return '混合'
  }

  return value.value === undefined ? emptyLabel : value.value
}

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

function readBlockedSummary(
  context: SelectionContext | null,
  formattingState: SelectionFormattingState
): string {
  if (editor.getLayout().pages.length > 4) {
    return 'Gate 2 的 50 页夹具仍用于分页验证；toolbar 交互请先切到 Alpha 样例。最小缺口是 core 需要把大文档 selection/render 热路径降到可交互级别。'
  }

  if (context === null) {
    return '当前已接通 facade-driven 基础格式、颜色、对齐和缩进；请先选择片段后再格式化。'
  }

  if (hasMixedFormattingState(formattingState)) {
    return '当前选区已覆盖多个 run 或段落；toolbar 会直接显示 mixed，并把下一次格式命令统一归一到整个选区上。'
  }

  return '当前已可通过 facade 事件和 command builder 执行基础格式化、颜色、对齐和缩进；键盘/IME、剪贴板与真实 pointer selection 仍待 Gate 3 后续步骤。'
}

function hasMixedFormattingState(formattingState: SelectionFormattingState): boolean {
  return formattingState.run !== null && (
    formattingState.run.bold.mixed
      || formattingState.run.italic.mixed
      || formattingState.run.underline.mixed
      || formattingState.run.strike.mixed
      || formattingState.run.fontFamily.mixed
      || formattingState.run.fontSizeTwips.mixed
      || formattingState.run.color.mixed
      || formattingState.run.backgroundColor.mixed
  ) || formattingState.paragraph !== null && (
    formattingState.paragraph.alignment.mixed
      || formattingState.paragraph.indentLeftTwips.mixed
  )
}

function readSelectionAnnouncement(selection: SelectionState | null): string {
  if (selection === null) {
    return '选区已清空。'
  }

  const context = resolveSelectionContext(editor.getProjection(), selection)

  return context === null ? '选区已更新，但当前未能定位到可格式化的 paragraph/run。' : `${readSelectionSummary(context, selection)}。`
}

function readTransactionAnnouncement(commandName: string): string {
  const selection = editor.getSelection()
  const summaryPrefix = selection === null
    ? ''
    : `${readSelectionSummary(resolveSelectionContext(editor.getProjection(), selection), selection)}，`

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

function createToolbar(host: HTMLElement): ToolbarElements {
  host.replaceChildren()
  host.removeAttribute('aria-hidden')
  host.classList.add('jw-toolbar')
  host.setAttribute('data-jword-toolbar', 'gate3')
  host.setAttribute('aria-label', 'JWord Gate 3 Alpha toolbar')

  const brandGroup = document.createElement('div')
  const actionGroup = document.createElement('div')
  const historyGroup = document.createElement('div')
  const inlineFormatGroup = document.createElement('div')
  const runValueGroup = document.createElement('div')
  const paragraphGroup = document.createElement('div')
  const summaryGroup = document.createElement('div')
  const titleNode = document.createElement('strong')
  const subtitleNode = document.createElement('span')
  const selectionSummaryNode = document.createElement('span')
  const runSummaryNode = document.createElement('span')
  const blockedSummaryNode = document.createElement('span')
  const loadAlphaSampleButton = createToolbarButton('加载 Alpha 样例', 'jw-toolbar__button--secondary')
  const restoreGate2FixtureButton = createToolbarButton('恢复 Gate 2 夹具')
  const selectSampleButton = createToolbarButton('选择首页片段', 'jw-toolbar__button--primary')
  const clearSelectionButton = createToolbarButton('清除选区')
  const undoButton = createToolbarButton('撤销')
  const redoButton = createToolbarButton('重做')
  const boldButton = createToolbarButton('加粗')
  const italicButton = createToolbarButton('斜体')
  const underlineButton = createToolbarButton('下划线')
  const strikeButton = createToolbarButton('删除线')
  const fontFamilySelect = createToolbarSelect(FONT_FAMILY_OPTIONS, '选择字体')
  const fontSizeSelect = createToolbarSelect(FONT_SIZE_OPTIONS, '选择字号')
  const textColorInput = createToolbarColorInput('选择文字颜色')
  const textColorValueNode = document.createElement('span')
  const backgroundColorInput = createToolbarColorInput('选择背景色')
  const backgroundColorValueNode = document.createElement('span')
  const alignLeftButton = createToolbarButton('左')
  const alignCenterButton = createToolbarButton('中')
  const alignRightButton = createToolbarButton('右')
  const alignJustifyButton = createToolbarButton('两端')
  const indentDecreaseButton = createToolbarButton('缩进-')
  const indentIncreaseButton = createToolbarButton('缩进+')
  const indentValueNode = document.createElement('span')

  const fontFamilyField = createToolbarField('字体', fontFamilySelect)
  const fontSizeField = createToolbarField('字号', fontSizeSelect)
  const textColorField = createToolbarField('字色', textColorInput, textColorValueNode)
  const backgroundColorField = createToolbarField('底色', backgroundColorInput, backgroundColorValueNode)
  const paragraphLabel = document.createElement('span')

  brandGroup.className = 'jw-toolbar__group jw-toolbar__group--brand'
  actionGroup.className = 'jw-toolbar__group'
  historyGroup.className = 'jw-toolbar__group'
  inlineFormatGroup.className = 'jw-toolbar__group'
  runValueGroup.className = 'jw-toolbar__group'
  paragraphGroup.className = 'jw-toolbar__group jw-toolbar__group--stack'
  summaryGroup.className = 'jw-toolbar__summary'
  titleNode.className = 'jw-toolbar__title'
  subtitleNode.className = 'jw-toolbar__subtitle'
  selectionSummaryNode.className = 'jw-toolbar__meta'
  selectionSummaryNode.setAttribute('data-jword-selection-summary', 'true')
  runSummaryNode.className = 'jw-toolbar__meta'
  runSummaryNode.setAttribute('data-jword-run-summary', 'true')
  blockedSummaryNode.className = 'jw-toolbar__note'
  blockedSummaryNode.setAttribute('data-jword-blocked-summary', 'true')
  textColorValueNode.className = 'jw-toolbar__field-value'
  backgroundColorValueNode.className = 'jw-toolbar__field-value'
  indentValueNode.className = 'jw-toolbar__field-value'
  paragraphLabel.className = 'jw-toolbar__field-label'

  loadAlphaSampleButton.setAttribute('data-jword-load-alpha', 'true')
  restoreGate2FixtureButton.setAttribute('data-jword-restore-gate2', 'true')
  selectSampleButton.setAttribute('data-jword-select-sample', 'true')
  clearSelectionButton.setAttribute('data-jword-clear-selection', 'true')
  undoButton.setAttribute('data-jword-history-undo', 'true')
  redoButton.setAttribute('data-jword-history-redo', 'true')
  boldButton.setAttribute('data-jword-format-bold', 'true')
  italicButton.setAttribute('data-jword-format-italic', 'true')
  underlineButton.setAttribute('data-jword-format-underline', 'true')
  strikeButton.setAttribute('data-jword-format-strike', 'true')
  fontFamilySelect.setAttribute('data-jword-format-font-family', 'true')
  fontSizeSelect.setAttribute('data-jword-format-font-size', 'true')
  textColorInput.setAttribute('data-jword-format-text-color', 'true')
  backgroundColorInput.setAttribute('data-jword-format-background-color', 'true')
  alignLeftButton.setAttribute('data-jword-format-align-left', 'true')
  alignCenterButton.setAttribute('data-jword-format-align-center', 'true')
  alignRightButton.setAttribute('data-jword-format-align-right', 'true')
  alignJustifyButton.setAttribute('data-jword-format-align-justify', 'true')
  indentDecreaseButton.setAttribute('data-jword-format-indent-decrease', 'true')
  indentIncreaseButton.setAttribute('data-jword-format-indent-increase', 'true')

  alignLeftButton.setAttribute('aria-label', '左对齐')
  alignCenterButton.setAttribute('aria-label', '居中对齐')
  alignRightButton.setAttribute('aria-label', '右对齐')
  alignJustifyButton.setAttribute('aria-label', '两端对齐')

  titleNode.textContent = 'JWord'
  subtitleNode.textContent = 'Gate 3 vanilla toolbar'
  paragraphLabel.textContent = '段落'

  brandGroup.append(titleNode, subtitleNode)
  actionGroup.append(loadAlphaSampleButton, restoreGate2FixtureButton, selectSampleButton, clearSelectionButton)
  historyGroup.append(undoButton, redoButton)
  inlineFormatGroup.append(boldButton, italicButton, underlineButton, strikeButton)
  runValueGroup.append(fontFamilyField, fontSizeField, textColorField, backgroundColorField)
  paragraphGroup.append(
    paragraphLabel,
    alignLeftButton,
    alignCenterButton,
    alignRightButton,
    alignJustifyButton,
    indentDecreaseButton,
    indentIncreaseButton,
    indentValueNode
  )
  summaryGroup.append(selectionSummaryNode, runSummaryNode, blockedSummaryNode)
  host.append(brandGroup, actionGroup, historyGroup, inlineFormatGroup, runValueGroup, paragraphGroup, summaryGroup)

  return {
    host,
    loadAlphaSampleButton,
    restoreGate2FixtureButton,
    selectSampleButton,
    clearSelectionButton,
    undoButton,
    redoButton,
    boldButton,
    italicButton,
    underlineButton,
    strikeButton,
    fontFamilySelect,
    fontSizeSelect,
    textColorInput,
    textColorValueNode,
    backgroundColorInput,
    backgroundColorValueNode,
    alignLeftButton,
    alignCenterButton,
    alignRightButton,
    alignJustifyButton,
    indentDecreaseButton,
    indentIncreaseButton,
    indentValueNode,
    selectionSummaryNode,
    runSummaryNode,
    blockedSummaryNode
  }
}

function createToolbarButton(label: string, extraClassName?: string): HTMLButtonElement {
  const button = document.createElement('button')

  button.type = 'button'
  button.className = extraClassName === undefined ? 'jw-toolbar__button' : `jw-toolbar__button ${extraClassName}`
  button.textContent = label

  return button
}

function createToolbarSelect(
  options: readonly ToolbarOption[],
  ariaLabel: string
): HTMLSelectElement {
  const select = document.createElement('select')

  select.className = 'jw-toolbar__select'
  select.setAttribute('aria-label', ariaLabel)

  for (const option of options) {
    const node = document.createElement('option')

    node.value = option.value
    node.textContent = option.label

    if (option.value === FONT_FAMILY_MIXED_VALUE || option.value === FONT_SIZE_MIXED_VALUE) {
      node.disabled = true
    }

    select.append(node)
  }

  return select
}

function createToolbarColorInput(ariaLabel: string): HTMLInputElement {
  const input = document.createElement('input')

  input.type = 'color'
  input.className = 'jw-toolbar__color'
  input.setAttribute('aria-label', ariaLabel)

  return input
}

function createToolbarField(
  label: string,
  control: HTMLElement,
  valueNode?: HTMLElement
): HTMLElement {
  const field = document.createElement('label')
  const labelNode = document.createElement('span')

  field.className = 'jw-toolbar__field'
  labelNode.className = 'jw-toolbar__field-label'
  labelNode.textContent = label
  field.append(labelNode, control)

  if (valueNode !== undefined) {
    field.append(valueNode)
  }

  return field
}

function createTextMirror(): HTMLElement {
  const mirror = document.createElement('div')

  mirror.className = 'jw-demo__text-mirror'
  mirror.setAttribute('data-jword-text-mirror', 'true')
  mirror.setAttribute('role', 'document')
  mirror.setAttribute('aria-label', 'JWord plain text mirror')

  return mirror
}

function createAlphaDemoText(): string {
  return [
    'Alpha toolbar sample 第一段：用于验证单 run 选区、撤销重做以及基础格式、颜色与字体状态同步。',
    '第二段：保持分页 canvas 路线，但把交互样例收敛到小文档，避免大夹具的 selection 热路径拖慢体验。'
  ].join('\n\n')
}

function readProjectionPlainText(projection: DocumentProjection): string {
  return projection.document.sections
    .map((section) => section.blocks.map((block) => readBlockPlainText(block)).join('\n'))
    .join('\n\n')
}

function readBlockPlainText(block: Block): string {
  if (block.kind === 'paragraph') {
    return block.runs.map((run) => readRunPlainText(run)).join('')
  }

  return block.rows
    .map((row) => row.cells.map((cell) => cell.blocks.map((nested) => readBlockPlainText(nested)).join('\n')).join('\t'))
    .join('\n')
}

function readRunPlainText(run: Paragraph['runs'][number]): string {
  return run.inlines
    .map((inline) => {
      if (inline.kind === 'text') {
        return inline.text
      }

      if (inline.kind === 'break') {
        return '\n'
      }

      if (inline.kind === 'image') {
        return '[image]'
      }

      return ''
    })
    .join('')
}

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

  const normalized = normalizeHexColor(value.value)

  return {
    value: normalized ?? fallback,
    state: 'value',
    label: value.value
  }
}

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

function readIndentLabel(value: FormattingStateValue<number> | null): string {
  if (value === null) {
    return '未定位'
  }

  if (value.mixed) {
    return '混合'
  }

  return formatIndentTwips(value.value ?? 0)
}

function readValueState<Value>(value: FormattingStateValue<Value> | null): ToolbarValueState {
  if (value === null) {
    return 'empty'
  }

  if (value.mixed) {
    return 'mixed'
  }

  return value.value === undefined ? 'empty' : 'value'
}

function setAlignmentButtonState(
  button: HTMLButtonElement,
  state: ToolbarState,
  alignment: ParagraphAlignment
): void {
  const pressed = state.alignmentState === 'mixed'
    ? 'mixed'
    : state.alignmentValue === alignment ? 'true' : 'false'

  button.setAttribute('aria-pressed', pressed)
  button.setAttribute('data-jword-state', state.alignmentState)
}

function normalizeHexColor(value: string): string | null {
  const normalized = value.trim()

  if (/^#[0-9a-fA-F]{6}$/.test(normalized)) {
    return normalized.toLowerCase()
  }

  if (/^#[0-9a-fA-F]{3}$/.test(normalized)) {
    const [one, two, three] = normalized.slice(1).split('')

    return `#${one}${one}${two}${two}${three}${three}`.toLowerCase()
  }

  return null
}

function formatFontSizeTwips(value: number): string {
  const points = value / 20

  return Number.isInteger(points) ? `${points} pt` : `${points.toFixed(1)} pt`
}

function formatIndentTwips(value: number): string {
  return `${(value / 20).toFixed(value % 20 === 0 ? 0 : 1)} pt`
}
