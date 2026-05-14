/**
 * 职责：启动无框架 Vite demo，挂载 core Editor facade，并在 examples 层提供 Gate 3 第一版 toolbar 与最小 a11y 支架。
 * 边界：不实现 contenteditable、IME、键盘输入或 core 内部命令 helper；只接通 examples 层能真实调用的 facade 能力。
 * 协作模块：@4xian/jword-core 的 Editor mount/undo/redo/command/selection facade、分页 canvas 生命周期和 demo HTML host。
 * 性能/安全约束：只在 demo 入口访问 DOM，不用 innerHTML 构造 UI；完整选区格式化若缺 core 能力则只在 examples 层显式降级。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/03-architecture.md 与 05-implementation-gates.md。
 */
import {
  buildSetBoldCommand,
  buildSetItalicCommand,
  createEditor
} from '@4xian/jword-core'
import type {
  Block,
  DocumentProjection,
  FormattingStateValue,
  Paragraph,
  RangeRef,
  Run,
  SelectionFormattingState,
  SelectionState,
  TextPosition
} from '@4xian/jword-core'
import { createGate2FixtureEditorText } from '../../../fixtures/plain-text/gate2-fixture.mjs'
import type { JWordDemoSelectionInput } from './vite-env'
import gate2FixtureText from '../../../fixtures/plain-text/gate2-50-pages.txt?raw'
import './styles.css'

type RunFormatKey = 'bold' | 'italic'
type ToolbarPressedState = 'true' | 'false' | 'mixed'

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
  readonly formatEnabled: boolean
  readonly boldPressed: ToolbarPressedState
  readonly italicPressed: ToolbarPressedState
}

interface SelectionContext {
  readonly anchorPosition: TextPosition
  readonly focusPosition: TextPosition
  readonly paragraph: Paragraph
  readonly run: Run
}

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
  announceStatus('已加载 Alpha 工具栏样例。', true)
})

toolbar.restoreGate2FixtureButton.addEventListener('click', () => {
  editor.createDocument({ text: createGate2DemoText(gate2FixtureText) })
  announceStatus('已恢复 Gate 2 50 页夹具。', true)
})

toolbar.clearSelectionButton.addEventListener('click', () => {
  editor.setSelection(null)
  announceStatus('选区已清空。')
})

toolbar.undoButton.addEventListener('click', () => {
  const result = editor.undo()

  announceStatus(result.stackItem === null ? '没有可撤销的本地操作。' : '已撤销最近一次本地操作。', result.stackItem !== null)
})

toolbar.redoButton.addEventListener('click', () => {
  const result = editor.redo()

  announceStatus(result.stackItem === null ? '没有可重做的本地操作。' : '已重做最近一次本地操作。', result.stackItem !== null)
})

toolbar.boldButton.addEventListener('click', () => {
  toggleActiveRunFormat('bold', '加粗')
})

toolbar.italicButton.addEventListener('click', () => {
  toggleActiveRunFormat('italic', '斜体')
})

renderRuntimeState(editor.getSelection(), editor.getSelectionFormattingState())
syncTextMirror()
announceStatus(
  `Gate 3 Alpha toolbar 已挂载，pages: ${editor.getLayout().pages.length}。当前已接通 facade-driven 选区状态、B/I、撤销重做、aria-live 与文本镜像。`,
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

function renderRuntimeState(
  selection: SelectionState | null,
  formattingState: SelectionFormattingState
): void {
  const state = buildToolbarState(selection, formattingState)
  const nextStateKey = [
    state.canUndo,
    state.canRedo,
    state.selectionSummary,
    state.runSummary,
    state.blockedSummary,
    state.selectSampleEnabled,
    state.clearSelectionEnabled,
    state.formatEnabled,
    state.boldPressed,
    state.italicPressed
  ].join('|')

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
  const formatEnabled = formattingState.run !== null

  return {
    canUndo,
    canRedo,
    selectionSummary: readSelectionSummary(context, selection),
    runSummary: readRunSummary(formattingState),
    blockedSummary: readBlockedSummary(context, formattingState),
    selectSampleEnabled,
    clearSelectionEnabled,
    formatEnabled,
    boldPressed: readPressedState(formattingState.run?.bold ?? null),
    italicPressed: readPressedState(formattingState.run?.italic ?? null)
  }
}

function renderToolbarState(elements: ToolbarElements, state: ToolbarState): void {
  elements.selectSampleButton.disabled = !state.selectSampleEnabled
  elements.undoButton.disabled = !state.canUndo
  elements.redoButton.disabled = !state.canRedo
  elements.clearSelectionButton.disabled = !state.clearSelectionEnabled
  elements.boldButton.disabled = !state.formatEnabled
  elements.italicButton.disabled = !state.formatEnabled
  elements.boldButton.setAttribute('aria-pressed', state.boldPressed)
  elements.italicButton.setAttribute('aria-pressed', state.italicPressed)
  elements.selectionSummaryNode.textContent = state.selectionSummary
  elements.runSummaryNode.textContent = state.runSummary
  elements.blockedSummaryNode.textContent = state.blockedSummary
}

function toggleActiveRunFormat(property: RunFormatKey, label: string): void {
  const selection = editor.getSelection()
  const formattingState = editor.getSelectionFormattingState()

  if (selection === null || formattingState.run === null) {
    announceStatus(`BLOCKED: ${label} 需要当前有可格式化的文本选区。`)
    return
  }

  const nextValue = readNextBooleanValue(property === 'bold' ? formattingState.run.bold : formattingState.run.italic)
  const command = property === 'bold'
    ? buildSetBoldCommand(editor.getProjection(), selection, nextValue)
    : buildSetItalicCommand(editor.getProjection(), selection, nextValue)

  if (command === null) {
    announceStatus(`${label} 已经处于目标状态。`)
    return
  }

  editor.executeCommand(command, {
    origin: 'local-user',
    label: `toolbar-${property}`,
    selectionAfter: selection
  })
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
  const section = projection.document.sections.find((item) => item.id === anchorPosition.sectionId)
  const block = section?.blocks.find((item) => item.id === anchorPosition.blockId)

  if (block === undefined || block.kind !== 'paragraph') {
    return null
  }

  const run = block.runs.find((item) => item.id === anchorPosition.runId)

  if (run === undefined) {
    return null
  }

  return {
    anchorPosition,
    focusPosition,
    paragraph: block,
    run
  }
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

  const start = Math.min(context.anchorPosition.graphemeIndex, context.focusPosition.graphemeIndex)
  const end = Math.max(context.anchorPosition.graphemeIndex, context.focusPosition.graphemeIndex)

  return `选区：${context.paragraph.id} / ${context.run.id} / ${start}→${end}`
}

function readRunSummary(formattingState: SelectionFormattingState): string {
  if (formattingState.run === null || formattingState.paragraph === null) {
    return '当前格式：未定位'
  }

  const bold = readFormattingToken(formattingState.run.bold, '开', '关')
  const italic = readFormattingToken(formattingState.run.italic, '开', '关')
  const alignment = readFormattingToken(formattingState.paragraph.alignment, undefined, 'inherit')

  return `当前格式：B ${bold} / I ${italic} / 对齐 ${alignment}`
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

function readBlockedSummary(
  context: SelectionContext | null,
  formattingState: SelectionFormattingState
): string {
  if (editor.getLayout().pages.length > 4) {
    return 'Gate 2 的 50 页夹具仍用于分页验证；toolbar 交互请先切到 Alpha 样例。最小缺口是 core 需要把大文档 selection/render 热路径降到可交互级别。'
  }

  if (context === null) {
    return '当前已接通 facade-driven B/I、撤销重做与 runtime 状态同步；请先选择片段后再格式化。'
  }

  if (formattingState.run?.bold.mixed === true || formattingState.run?.italic.mixed === true) {
    return '当前选区已跨多个 run；toolbar 会通过 facade formatting state 显示 mixed，并统一走 command builder 执行格式命令。'
  }

  return '当前已可通过 facade 事件和 command builder 执行基础 B/I；字体字号、段落对齐、键盘/IME、剪贴板与真实 pointer selection 仍待 Gate 3 后续步骤。'
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

  if (commandName === 'setBold') {
    return selection === null
      ? '已更新加粗状态。'
      : `${readSelectionSummary(resolveSelectionContext(editor.getProjection(), selection), selection)}，已同步加粗状态。`
  }

  if (commandName === 'setItalic') {
    return selection === null
      ? '已更新斜体状态。'
      : `${readSelectionSummary(resolveSelectionContext(editor.getProjection(), selection), selection)}，已同步斜体状态。`
  }

  return `已执行 ${commandName}。`
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
  const formatGroup = document.createElement('div')
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

  brandGroup.className = 'jw-toolbar__group jw-toolbar__group--brand'
  actionGroup.className = 'jw-toolbar__group'
  historyGroup.className = 'jw-toolbar__group'
  formatGroup.className = 'jw-toolbar__group'
  summaryGroup.className = 'jw-toolbar__summary'
  titleNode.className = 'jw-toolbar__title'
  subtitleNode.className = 'jw-toolbar__subtitle'
  selectionSummaryNode.className = 'jw-toolbar__meta'
  selectionSummaryNode.setAttribute('data-jword-selection-summary', 'true')
  runSummaryNode.className = 'jw-toolbar__meta'
  runSummaryNode.setAttribute('data-jword-run-summary', 'true')
  blockedSummaryNode.className = 'jw-toolbar__note'
  blockedSummaryNode.setAttribute('data-jword-blocked-summary', 'true')
  loadAlphaSampleButton.setAttribute('data-jword-load-alpha', 'true')
  restoreGate2FixtureButton.setAttribute('data-jword-restore-gate2', 'true')
  selectSampleButton.setAttribute('data-jword-select-sample', 'true')
  clearSelectionButton.setAttribute('data-jword-clear-selection', 'true')
  undoButton.setAttribute('data-jword-history-undo', 'true')
  redoButton.setAttribute('data-jword-history-redo', 'true')
  boldButton.setAttribute('data-jword-format-bold', 'true')
  italicButton.setAttribute('data-jword-format-italic', 'true')

  titleNode.textContent = 'JWord'
  subtitleNode.textContent = 'Gate 3 Alpha toolbar'

  brandGroup.append(titleNode, subtitleNode)
  actionGroup.append(loadAlphaSampleButton, restoreGate2FixtureButton, selectSampleButton, clearSelectionButton)
  historyGroup.append(undoButton, redoButton)
  formatGroup.append(boldButton, italicButton)
  summaryGroup.append(selectionSummaryNode, runSummaryNode, blockedSummaryNode)
  host.append(brandGroup, actionGroup, historyGroup, formatGroup, summaryGroup)

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
    'Alpha toolbar sample 第一段：用于验证单 run 选区、撤销重做和 B/I 状态同步。',
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

function readRunPlainText(run: Run): string {
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
