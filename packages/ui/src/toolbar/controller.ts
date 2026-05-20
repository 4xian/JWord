/**
 * 职责：连接 toolbar DOM、core editor facade 和 assistive 句柄，保持 Gate 3 命令语义不变。
 * 边界：不创建 demo-only 场景控件，不修改 core 命令实现，也不实现 assistive 模块内部细节。
 * 协作模块：config 解析显隐，dom 管理节点，state 负责只读状态与文案，assistive 通过句柄协作。
 * 性能/安全约束：所有格式命令继续走 facade/transaction pipeline，不生成第二套编辑状态。
 * Specs：docs/superpowers/plans/2026-05-17-jword-ui-sdk-gate4-integration.md#41-必须迁入-packagesui-的内容。
 */
import {
  buildSetBackgroundColorCommand,
  buildSetParagraphIndentCommand,
  buildSetTextColorCommand,
  type Block,
  type Command,
  type Editor,
  type FormattingStateValue,
  type PagePreset,
  type Paragraph,
  type ParagraphAlignment,
  type ParagraphList,
  type SelectionState
} from '@4xian/jword-core'
import type {
  CreateJWordUiOptions,
  JWordToolbarControlElement,
  JWordToolbarElements
} from '../types'
import type { SelectionActionsColorFormatController } from '../selection-actions/types'
import type { LiveRegionController } from '../assistive/live-region'
import type { TextMirrorController } from '../assistive/text-mirror'
import {
  FONT_SIZE_TWIPS_STEPS,
  FONT_FAMILY_EMPTY_VALUE,
  FONT_FAMILY_MIXED_VALUE,
  FONT_SIZE_EMPTY_VALUE,
  FONT_SIZE_MIXED_VALUE,
  isToolbarPlaceholderSelectValue,
  parseParagraphListSelectValue,
  readParagraphAlignmentLabel as readParagraphAlignmentText
} from './builtin-tools'
import { resolveToolbarConfig } from './config'
import {
  createToolbarDom,
  destroyToolbarDom,
  renderToolbarState
} from './dom'
import {
  buildToolbarState,
  cloneSelection,
  isRunNumberFormatAlreadyApplied,
  isRunStringFormatAlreadyApplied,
  normalizeHexColor,
  readPagePresetAnnouncement,
  readSelectionAnnouncement,
  readSelectionFormattingState,
  readTransactionAnnouncement,
  shouldAnnounceTransaction
} from './state'

interface ToolbarControllerAssistive {
  readonly liveRegion: LiveRegionController
  readonly textMirror: TextMirrorController | null
}

interface CreateToolbarControllerOptions extends CreateJWordUiOptions {
  readonly assistive: ToolbarControllerAssistive
}

interface ToolbarControllerHandle {
  readonly elements: JWordToolbarElements
  readonly mediaHost: HTMLElement | null
  readonly tableHost: HTMLElement | null
  readonly colorFormat: SelectionActionsColorFormatController
  refresh(): void
  destroy(): void
}

/** 创建并接管官方 toolbar。 */
export function createToolbarController(options: CreateToolbarControllerOptions): ToolbarControllerHandle {
  const toolbarConfig = resolveToolbarConfig(options.toolbar)
  const dom = createToolbarDom(options.toolbarHost, toolbarConfig)
  const mediaHost = options.media === undefined
    ? null
    : createToolbarExtensionHost(dom.bar, 'media')
  const tableHost = options.table === undefined
    ? null
    : createToolbarExtensionHost(dom.bar, 'table')
  const assistive = options.assistive
  const editor = options.editor
  let suppressSelectionAnnouncementsUntil = 0
  let suppressAfterToolbarTransaction = false
  const frozenColorSelections = {
    text: null as SelectionState | null,
    background: null as SelectionState | null
  }
  const unsubscribeEditor = editor.subscribe((event) => {
    if (event.kind === 'selectionChange') {
      render()
      syncTextMirror()

      if (performance.now() >= suppressSelectionAnnouncementsUntil) {
        announce(readSelectionAnnouncement(editor, event.selection))
      }

      return
    }

    if (event.kind === 'transaction') {
      render()

      if (shouldAnnounceTransaction(event.transaction.commandName)) {
        if (suppressAfterToolbarTransaction) {
          suppressSelectionAnnouncementsUntil = performance.now() + 160
        }

        suppressAfterToolbarTransaction = false
        announce(readTransactionAnnouncement(editor, event.transaction.commandName), true)
      }

      return
    }

    if (event.kind === 'destroyed') {
      assistive?.liveRegion?.announce('JWord editor 已销毁。')
    }
  })

  /** 只重绘 toolbar，不触发额外 assistive 副作用。 */
  function render(): void {
    renderToolbarState(dom, buildToolbarState(editor))
  }

  /** 同步 assistive text mirror。 */
  function syncTextMirror(immediate = false): void {
    assistive.textMirror?.sync(immediate ? { immediate: true } : undefined)
  }

  /** 统一处理 live region 播报，并按需先刷新 text mirror。 */
  function announce(message: string, refreshMirror = false): void {
    if (refreshMirror) {
      syncTextMirror(true)
    }

    assistive.liveRegion.announce(message)
  }

  /** 标记下一次 toolbar 触发的事务应当压住紧随其后的选区播报。 */
  function markToolbarTransaction(): void {
    suppressAfterToolbarTransaction = true

    queueMicrotask(() => {
      suppressAfterToolbarTransaction = false
    })
  }

  /** 在 toolbar 动作结束后把输入焦点还给 editor hidden textarea。 */
  function restoreEditorFocusSoon(): void {
    queueMicrotask(() => {
      editor.focus()
    })
  }

  /** 绑定所有实际挂载出来的控件事件。 */
  function bindEvents(): void {
    const bindToolbarButton = (control: JWordToolbarControlElement | undefined, handler: () => void) => {
      bindButton(control, () => {
        handler()
        restoreEditorFocusSoon()
      })
    }
    const bindToolbarSelect = (control: JWordToolbarControlElement | undefined, handler: () => void) => {
      bindSelect(control, () => {
        handler()
        restoreEditorFocusSoon()
      })
    }
    const bindToolbarColorInput = (control: JWordToolbarControlElement | undefined, handler: () => void) => {
      bindColorInput(control, () => {
        handler()
        restoreEditorFocusSoon()
      })
    }

    bindToolbarButton(dom.controls['history.undo'], () => {
      markToolbarTransaction()
      const result = editor.undo()

      refresh()
      announce(result.stackItem === null ? '没有可撤销的本地操作。' : '已撤销最近一次本地操作。', result.stackItem !== null)
    })
    bindToolbarButton(dom.controls['history.redo'], () => {
      markToolbarTransaction()
      const result = editor.redo()

      refresh()
      announce(result.stackItem === null ? '没有可重做的本地操作。' : '已重做最近一次本地操作。', result.stackItem !== null)
    })
    bindToolbarSelect(dom.controls['document.pagePreset'], () => {
      const control = readSelect(dom.controls['document.pagePreset'])

      if (control === null) {
        return
      }

      const nextPreset = control.value as PagePreset
      const currentPreset = editor.getPageConfig().preset

      if (currentPreset === nextPreset) {
        render()
        return
      }

      markToolbarTransaction()
      const nextPageConfig = editor.setPageConfig({
        preset: nextPreset
      })

      render()
      announce(readPagePresetAnnouncement(nextPreset, nextPageConfig), true)
    })
    bindToolbarButton(dom.controls['format.bold'], () => {
      toggleActiveRunBooleanFormat('bold', '加粗')
    })
    bindToolbarButton(dom.controls['format.italic'], () => {
      toggleActiveRunBooleanFormat('italic', '斜体')
    })
    bindToolbarButton(dom.controls['format.underline'], () => {
      toggleActiveRunBooleanFormat('underline', '下划线')
    })
    bindToolbarButton(dom.controls['format.strike'], () => {
      toggleActiveRunBooleanFormat('strike', '删除线')
    })
    bindToolbarButton(dom.controls['format.superscript'], () => {
      toggleActiveRunBooleanFormat('superscript', '上标')
    })
    bindToolbarButton(dom.controls['format.subscript'], () => {
      toggleActiveRunBooleanFormat('subscript', '下标')
    })
    bindToolbarSelect(dom.controls['format.fontFamily'], () => {
      const control = readSelect(dom.controls['format.fontFamily'])

      if (control === null) {
        return
      }

      const value = control.value

      if (value === FONT_FAMILY_EMPTY_VALUE || value === FONT_FAMILY_MIXED_VALUE) {
        render()
        return
      }

      applyRunStringFormat('fontFamily', '字体', value)
    })
    bindToolbarSelect(dom.controls['format.fontSize'], () => {
      const control = readSelect(dom.controls['format.fontSize'])

      if (control === null) {
        return
      }

      const value = control.value

      if (value === FONT_SIZE_EMPTY_VALUE || value === FONT_SIZE_MIXED_VALUE) {
        render()
        return
      }

      const parsedValue = Number.parseInt(value, 10)

      if (!Number.isFinite(parsedValue)) {
        announce(`BLOCKED: 无法识别字号值 ${value}。`)
        render()
        return
      }

      applyRunNumberFormat('字号', parsedValue)
    })
    bindToolbarButton(dom.controls['format.fontSizeDecrease'], () => {
      applyFontSizeStep(-1)
    })
    bindToolbarButton(dom.controls['format.fontSizeIncrease'], () => {
      applyFontSizeStep(1)
    })
    bindColorClick(dom.controls['format.textColor'], () => {
      captureColorSelection('textColor', cloneSelection(editor.getSelection()))
    })
    bindColorClick(dom.controls['format.backgroundColor'], () => {
      captureColorSelection('backgroundColor', cloneSelection(editor.getSelection()))
    })
    bindToolbarColorInput(dom.controls['format.textColor'], () => {
      const control = readColor(dom.controls['format.textColor'])

      if (control === null) {
        return
      }

      applyColorFormatFromFrozenSelection('textColor', '文字颜色', control.value.toLowerCase())
    })
    bindToolbarColorInput(dom.controls['format.backgroundColor'], () => {
      const control = readColor(dom.controls['format.backgroundColor'])

      if (control === null) {
        return
      }

      applyColorFormatFromFrozenSelection('backgroundColor', '背景色', control.value.toLowerCase())
    })
    bindToolbarSelect(dom.controls['paragraph.alignment'], () => {
      const control = readSelect(dom.controls['paragraph.alignment'])
      const value = control === null ? null : parseParagraphAlignmentValue(control.value)

      if (value === null) {
        render()
        return
      }

      applyParagraphAlignment(value, readParagraphAlignmentText(value) ?? '段落对齐')
    })
    bindToolbarButton(dom.controls['paragraph.indentDecrease'], () => {
      adjustParagraphIndentBy(-360)
    })
    bindToolbarButton(dom.controls['paragraph.indentIncrease'], () => {
      adjustParagraphIndentBy(360)
    })
    bindToolbarSelect(dom.controls['paragraph.indentLeft'], () => {
      const value = readNumericToolbarSelectValue(dom.controls['paragraph.indentLeft'])

      if (value === null) {
        render()
        return
      }

      applyParagraphIndentLeft(value)
    })
    bindToolbarSelect(dom.controls['paragraph.lineHeight'], () => {
      const value = readNumericToolbarSelectValue(dom.controls['paragraph.lineHeight'])

      if (value === null) {
        render()
        return
      }

      applyParagraphLineHeight(value)
    })
    bindToolbarSelect(dom.controls['paragraph.spacingBefore'], () => {
      const value = readNumericToolbarSelectValue(dom.controls['paragraph.spacingBefore'])

      if (value === null) {
        render()
        return
      }

      applyParagraphSpacingBefore(value)
    })
    bindToolbarSelect(dom.controls['paragraph.spacingAfter'], () => {
      const value = readNumericToolbarSelectValue(dom.controls['paragraph.spacingAfter'])

      if (value === null) {
        render()
        return
      }

      applyParagraphSpacingAfter(value)
    })
    bindToolbarSelect(dom.controls['paragraph.firstLineIndent'], () => {
      const value = readNumericToolbarSelectValue(dom.controls['paragraph.firstLineIndent'])

      if (value === null) {
        render()
        return
      }

      applyParagraphFirstLineIndent(value)
    })
    bindToolbarSelect(dom.controls['paragraph.hangingIndent'], () => {
      const value = readNumericToolbarSelectValue(dom.controls['paragraph.hangingIndent'])

      if (value === null) {
        render()
        return
      }

      applyParagraphHangingIndent(value)
    })
    bindToolbarSelect(dom.controls['paragraph.style'], () => {
      const control = readSelect(dom.controls['paragraph.style'])

      if (control === null || isToolbarPlaceholderSelectValue(control.value)) {
        render()
        return
      }

      applyParagraphStyle(control.value)
    })
    bindToolbarSelect(dom.controls['paragraph.list'], () => {
      const control = readSelect(dom.controls['paragraph.list'])
      const value = control === null ? undefined : parseParagraphListSelectValue(control.value)

      if (value === undefined) {
        render()
        return
      }

      applyParagraphList(value)
    })
  }

  /** 在当前选区上切换布尔格式。 */
  function toggleActiveRunBooleanFormat(
    property: 'bold' | 'italic' | 'underline' | 'strike' | 'superscript' | 'subscript',
    label: string
  ): void {
    const selection = editor.getSelection()
    const formattingState = editor.getSelectionFormattingState()

    if (selection === null || formattingState.run === null) {
      announce(`BLOCKED: ${label} 需要当前有可格式化的文本选区。`)
      return
    }

    switch (property) {
      case 'bold':
        markToolbarTransaction()
        editor.toggleBold()
        return
      case 'italic':
        markToolbarTransaction()
        editor.toggleItalic()
        return
      case 'underline':
        markToolbarTransaction()
        editor.toggleUnderline()
        return
      case 'strike':
        markToolbarTransaction()
        editor.toggleStrike()
        return
      case 'superscript':
        markToolbarTransaction()
        editor.toggleSuperscript()
        return
      case 'subscript':
        markToolbarTransaction()
        editor.toggleSubscript()
        return
    }
  }

  /** 应用字符串格式。 */
  function applyRunStringFormat(
    property: 'fontFamily' | 'textColor' | 'backgroundColor',
    label: string,
    value: string
  ): void {
    const selection = editor.getSelection()
    const formattingState = editor.getSelectionFormattingState()

    if (selection === null || formattingState.run === null) {
      announce(`BLOCKED: ${label} 需要当前有可格式化的文本选区。`)
      render()
      return
    }

    if (isRunStringFormatAlreadyApplied(formattingState, property, value)) {
      announce(`${label} 已经处于目标状态。`)
      render()
      return
    }

    switch (property) {
      case 'fontFamily':
        markToolbarTransaction()
        editor.setFontFamily(value)
        return
      case 'textColor':
        markToolbarTransaction()
        editor.setTextColor(value)
        return
      case 'backgroundColor':
        markToolbarTransaction()
        editor.setBackgroundColor(value)
        return
    }
  }

  /** 应用冻结选区上的颜色格式。 */
  function applyColorFormatFromFrozenSelection(
    property: 'textColor' | 'backgroundColor',
    label: string,
    value: string
  ): void {
    const selection = property === 'textColor'
      ? frozenColorSelections.text ?? editor.getSelection()
      : frozenColorSelections.background ?? editor.getSelection()
    const formattingState = selection === null ? null : readSelectionFormattingState(editor, selection)
    const normalizedValue = normalizeHexColor(value) ?? value

    if (selection === null || formattingState === null || formattingState.run === null) {
      announce(`BLOCKED: ${label} 需要当前有可格式化的文本选区。`)
      render()
      clearFrozenColorSelection(property)
      return
    }

    if (isRunStringFormatAlreadyApplied(formattingState, property, normalizedValue)) {
      announce(`${label} 已经处于目标状态。`)
      render()
      clearFrozenColorSelection(property)
      return
    }

    const command = property === 'textColor'
      ? buildSetTextColorCommand(editor.getProjection(), selection, normalizedValue)
      : buildSetBackgroundColorCommand(editor.getProjection(), selection, normalizedValue)

    if (command === null) {
      announce(`BLOCKED: ${label} 当前没有可应用的文本目标。`)
      render()
      clearFrozenColorSelection(property)
      return
    }

    markToolbarTransaction()
    editor.executeCommand(command, {
      selectionAfter: selection
    })
    clearFrozenColorSelection(property)
  }

  /** 捕获颜色控件打开时的选区，供 picker change 阶段复用。 */
  function captureColorSelection(property: 'textColor' | 'backgroundColor', selection: SelectionState | null): void {
    if (property === 'textColor') {
      frozenColorSelections.text = selection
      return
    }

    frozenColorSelections.background = selection
  }

  /** 对内部 UI 子模块暴露同一套颜色提交能力。 */
  function applyColorFromSelection(
    property: 'textColor' | 'backgroundColor',
    selection: SelectionState | null,
    value: string
  ): void {
    captureColorSelection(property, cloneSelection(selection))
    applyColorFormatFromFrozenSelection(
      property,
      property === 'textColor' ? '文字颜色' : '背景色',
      value
    )
  }

  /** 应用字号格式。 */
  function applyRunNumberFormat(label: string, value: number): void {
    const selection = editor.getSelection()
    const formattingState = editor.getSelectionFormattingState()

    if (selection === null || formattingState.run === null) {
      announce(`BLOCKED: ${label} 需要当前有可格式化的文本选区。`)
      render()
      return
    }

    if (isRunNumberFormatAlreadyApplied(formattingState, value)) {
      announce(`${label} 已经处于目标状态。`)
      render()
      return
    }

    markToolbarTransaction()
    editor.setFontSize(value)
  }

  /** 沿固定字号档位向上或向下步进。 */
  function applyFontSizeStep(direction: -1 | 1): void {
    const selection = editor.getSelection()
    const formattingState = editor.getSelectionFormattingState()

    if (selection === null || formattingState.run === null) {
      announce(`BLOCKED: ${direction > 0 ? '增大字号' : '减小字号'} 需要当前有可格式化的文本选区。`)
      render()
      return
    }

    const currentValue = formattingState.run.fontSizeTwips.mixed === true
      ? 240
      : (formattingState.run.fontSizeTwips.value ?? 240)
    const nextValue = resolveNextFontSizeStep(currentValue, direction)

    if (nextValue === currentValue) {
      announce(direction > 0 ? '字号 已经处于最大档位。' : '字号 已经处于最小档位。')
      render()
      return
    }

    markToolbarTransaction()
    editor.setFontSize(nextValue)
  }

  /** 应用段落对齐。 */
  function applyParagraphAlignment(value: 'left' | 'center' | 'right' | 'justify', label: string): void {
    const selection = editor.getSelection()
    const formattingState = editor.getSelectionFormattingState()

    if (selection === null || formattingState.paragraph === null) {
      announce(`BLOCKED: ${label} 需要当前有可格式化的段落选区。`)
      render()
      return
    }

    if (formattingState.paragraph.alignment.mixed !== true && formattingState.paragraph.alignment.value === value) {
      announce(`${label} 已经处于目标状态。`)
      render()
      return
    }

    markToolbarTransaction()
    editor.setParagraphAlignment(value)
  }

  /** 应用段落左缩进。 */
  function applyParagraphIndentLeft(value: number): void {
    const selection = editor.getSelection()
    const formattingState = editor.getSelectionFormattingState()

    if (selection === null || formattingState.paragraph === null) {
      announce('BLOCKED: 左缩进需要当前有可格式化的段落选区。')
      render()
      return
    }

    if (formattingState.paragraph.indentLeftTwips.mixed !== true && (formattingState.paragraph.indentLeftTwips.value ?? 0) === value) {
      announce('左缩进 已经处于目标状态。')
      render()
      return
    }

    const command = buildSetParagraphIndentCommand(editor.getProjection(), selection, value)

    if (command === null) {
      announce('BLOCKED: 当前没有可应用左缩进的段落目标。')
      render()
      return
    }

    markToolbarTransaction()
    editor.executeCommand(command, {
      selectionAfter: selection
    })
  }

  /** 按腾讯文档式按钮对当前段落做缩进步进，并在 0 处钳制。 */
  function adjustParagraphIndentBy(deltaTwips: number): void {
    const selection = editor.getSelection()
    const formattingState = editor.getSelectionFormattingState()

    if (selection === null || formattingState.paragraph === null) {
      announce(`BLOCKED: ${deltaTwips > 0 ? '增加缩进' : '减少缩进'} 需要当前有可格式化的段落选区。`)
      render()
      return
    }

    const command = buildAdjustParagraphIndentCommand(editor, selection, deltaTwips)

    if (command === null) {
      announce(deltaTwips > 0 ? '增加缩进 已经处于目标状态。' : '减少缩进 已经处于目标状态。')
      render()
      return
    }

    markToolbarTransaction()
    editor.executeCommand(command, {
      selectionAfter: selection
    })
  }

  /** 应用段落行距。 */
  function applyParagraphLineHeight(value: number): void {
    const selection = editor.getSelection()
    const formattingState = editor.getSelectionFormattingState()

    if (selection === null || formattingState.paragraph === null) {
      announce('BLOCKED: 行距需要当前有可格式化的段落选区。')
      render()
      return
    }

    if (isParagraphNumberStateAlreadyApplied(formattingState.paragraph.lineHeight, value)) {
      announce('行距 已经处于目标状态。')
      render()
      return
    }

    markToolbarTransaction()
    editor.setParagraphLineHeight(value)
  }

  /** 应用段前间距。 */
  function applyParagraphSpacingBefore(value: number): void {
    const selection = editor.getSelection()
    const formattingState = editor.getSelectionFormattingState()

    if (selection === null || formattingState.paragraph === null) {
      announce('BLOCKED: 段前间距需要当前有可格式化的段落选区。')
      render()
      return
    }

    if (isParagraphNumberStateAlreadyApplied(formattingState.paragraph.spacingBeforeTwips, value)) {
      announce('段前间距 已经处于目标状态。')
      render()
      return
    }

    markToolbarTransaction()
    editor.setParagraphSpacingBefore(value)
  }

  /** 应用段后间距。 */
  function applyParagraphSpacingAfter(value: number): void {
    const selection = editor.getSelection()
    const formattingState = editor.getSelectionFormattingState()

    if (selection === null || formattingState.paragraph === null) {
      announce('BLOCKED: 段后间距需要当前有可格式化的段落选区。')
      render()
      return
    }

    if (isParagraphNumberStateAlreadyApplied(formattingState.paragraph.spacingAfterTwips, value)) {
      announce('段后间距 已经处于目标状态。')
      render()
      return
    }

    markToolbarTransaction()
    editor.setParagraphSpacingAfter(value)
  }

  /** 应用首行缩进。 */
  function applyParagraphFirstLineIndent(value: number): void {
    const selection = editor.getSelection()
    const formattingState = editor.getSelectionFormattingState()

    if (selection === null || formattingState.paragraph === null) {
      announce('BLOCKED: 首行缩进需要当前有可格式化的段落选区。')
      render()
      return
    }

    if (isParagraphNumberStateAlreadyApplied(formattingState.paragraph.firstLineIndentTwips, value)) {
      announce('首行缩进 已经处于目标状态。')
      render()
      return
    }

    markToolbarTransaction()
    editor.setParagraphFirstLineIndent(value)
  }

  /** 应用悬挂缩进。 */
  function applyParagraphHangingIndent(value: number): void {
    const selection = editor.getSelection()
    const formattingState = editor.getSelectionFormattingState()

    if (selection === null || formattingState.paragraph === null) {
      announce('BLOCKED: 悬挂缩进需要当前有可格式化的段落选区。')
      render()
      return
    }

    if (isParagraphNumberStateAlreadyApplied(formattingState.paragraph.hangingIndentTwips, value)) {
      announce('悬挂缩进 已经处于目标状态。')
      render()
      return
    }

    markToolbarTransaction()
    editor.setParagraphHangingIndent(value)
  }

  /** 应用段落样式。 */
  function applyParagraphStyle(value: string): void {
    const selection = editor.getSelection()
    const formattingState = editor.getSelectionFormattingState()

    if (selection === null || formattingState.paragraph === null) {
      announce('BLOCKED: 段落样式需要当前有可格式化的段落选区。')
      render()
      return
    }

    if (formattingState.paragraph.styleId.mixed !== true && formattingState.paragraph.styleId.value === value) {
      announce('段落样式 已经处于目标状态。')
      render()
      return
    }

    markToolbarTransaction()
    editor.setParagraphStyle(value)
  }

  /** 应用段落列表；清空列表时先走当前 UI 层兼容 command。 */
  function applyParagraphList(value: ParagraphList | null): void {
    const selection = editor.getSelection()
    const formattingState = editor.getSelectionFormattingState()

    if (selection === null || formattingState.paragraph === null) {
      announce('BLOCKED: 列表语义需要当前有可格式化的段落选区。')
      render()
      return
    }

    if (areParagraphListsEquivalent(formattingState.paragraph.list.value ?? null, value, formattingState.paragraph.list.mixed)) {
      announce('列表语义 已经处于目标状态。')
      render()
      return
    }

    if (value === null) {
      const command = buildClearParagraphListCommand(editor, selection)

      if (command === null) {
        announce('BLOCKED: 当前没有可清空的列表目标。')
        render()
        return
      }

      markToolbarTransaction()
      editor.executeCommand(command, {
        selectionAfter: selection
      })
      return
    }

    markToolbarTransaction()
    editor.setParagraphList(value)
  }

  /** 清除单次颜色冻结快照。 */
  function clearFrozenColorSelection(property: 'textColor' | 'backgroundColor'): void {
    if (property === 'textColor') {
      frozenColorSelections.text = null
      return
    }

    frozenColorSelections.background = null
  }

  /** 对宿主暴露的手动刷新入口，同时同步隐藏 mirror。 */
  function refresh(): void {
    render()
    syncTextMirror()
  }

  bindEvents()
  refresh()

  return {
    elements: dom,
    mediaHost,
    tableHost,
    colorFormat: {
      applyColorFromSelection
    },
    refresh,
    destroy(): void {
      unsubscribeEditor()
      assistive.liveRegion.destroy()
      assistive.textMirror?.destroy()
      destroyToolbarDom(dom)
    }
  }
}

/** 为 Gate 4 扩展入口补一个挂到 toolbar bar 末尾的独立分组。 */
function createToolbarExtensionHost(bar: HTMLElement, kind: 'media' | 'table'): HTMLElement {
  const group = document.createElement('div')

  group.className = 'jw-toolbar__group'
  group.setAttribute(`data-jword-${kind}-host`, 'true')
  bar.append(group)

  return group
}

/** 在按钮上绑定点击事件。 */
function bindButton(control: JWordToolbarControlElement | undefined, handler: () => void): void {
  if (!(control instanceof HTMLButtonElement)) {
    return
  }

  control.addEventListener('click', handler)
}

/** 在 select 上绑定 change 事件。 */
function bindSelect(control: JWordToolbarControlElement | undefined, handler: () => void): void {
  if (!(control instanceof HTMLSelectElement)) {
    return
  }

  control.addEventListener('change', handler)
}

/** 在颜色控件上绑定 click 事件。 */
function bindColorClick(control: JWordToolbarControlElement | undefined, handler: () => void): void {
  if (!(control instanceof HTMLInputElement)) {
    return
  }

  control.addEventListener('click', handler)
}

/** 在颜色控件上绑定即时 input 与最终 change 事件。 */
function bindColorInput(control: JWordToolbarControlElement | undefined, handler: () => void): void {
  if (!(control instanceof HTMLInputElement)) {
    return
  }

  control.addEventListener('input', handler)
  control.addEventListener('change', handler)
}

/** 安全读取 select 控件。 */
function readSelect(control: JWordToolbarControlElement | undefined): HTMLSelectElement | null {
  return control instanceof HTMLSelectElement ? control : null
}

/** 安全读取颜色控件。 */
function readColor(control: JWordToolbarControlElement | undefined): HTMLInputElement | null {
  return control instanceof HTMLInputElement ? control : null
}

/** 把段落对齐 select 的字符串值收敛成 facade 可接受的枚举。 */
function parseParagraphAlignmentValue(value: string): ParagraphAlignment | null {
  switch (value) {
    case 'left':
    case 'center':
    case 'right':
    case 'justify':
      return value
    default:
      return null
  }
}

/** 从 toolbar select 中安全读取数字值。 */
function readNumericToolbarSelectValue(control: JWordToolbarControlElement | undefined): number | null {
  const select = readSelect(control)

  if (select === null || isToolbarPlaceholderSelectValue(select.value)) {
    return null
  }

  const value = Number.parseFloat(select.value)

  return Number.isFinite(value) ? value : null
}

/** 判断段落数字格式是否已处于目标状态。 */
function isParagraphNumberStateAlreadyApplied(value: FormattingStateValue<number>, target: number): boolean {
  return value.mixed !== true && value.value === target
}

/** 判断段落列表是否已处于目标状态。 */
function areParagraphListsEquivalent(
  current: ParagraphList | null,
  target: ParagraphList | null,
  mixed: boolean
): boolean {
  if (mixed) {
    return false
  }

  if (current === null || target === null) {
    return current === target
  }

  return current.numberingId === target.numberingId && current.level === target.level
}

/** 把固定字号档位向前或向后推进一档。 */
function resolveNextFontSizeStep(currentValue: number, direction: -1 | 1): number {
  if (direction > 0) {
    return FONT_SIZE_TWIPS_STEPS.find((item) => item > currentValue) ?? currentValue
  }

  return [...FONT_SIZE_TWIPS_STEPS].reverse().find((item) => item < currentValue) ?? currentValue
}

/** 为缩进步进按钮构造带 0 下限钳制的 command。 */
function buildAdjustParagraphIndentCommand(editor: Editor, selection: SelectionState, deltaTwips: number): Command | null {
  if (deltaTwips === 0) {
    return null
  }

  const operations = collectSelectedParagraphs(editor, selection).flatMap((paragraph) => {
    const currentIndent = typeof paragraph.properties?.indentLeftTwips === 'number'
      ? paragraph.properties.indentLeftTwips
      : 0
    const nextIndent = Math.max(0, currentIndent + deltaTwips)

    return currentIndent === nextIndent
      ? []
      : [{
          kind: 'setParagraphProperties' as const,
          paragraphId: paragraph.id,
          properties: {
            indentLeftTwips: nextIndent
          }
        }]
  })

  return operations.length === 0
    ? null
    : {
        name: 'adjustParagraphIndent',
        operations
      }
}

/** 为 clear-list 构造当前 UI 层的兼容 command。 */
function buildClearParagraphListCommand(editor: Editor, selection: SelectionState): Command | null {
  const paragraphs = collectSelectedParagraphs(editor, selection)
  const operations = paragraphs
    .filter((paragraph) => !isParagraphPropertiesEquivalent(paragraph, {
      listNumberingId: null,
      listLevel: null
    }))
    .map((paragraph) => ({
      kind: 'setParagraphProperties' as const,
      paragraphId: paragraph.id,
      properties: {
        listNumberingId: null,
        listLevel: null
      }
    }))

  if (operations.length === 0) {
    return null
  }

  return {
    name: 'setParagraphList',
    operations
  }
}

/** 以文档顺序收集当前选区覆盖的段落。 */
function collectSelectedParagraphs(editor: Editor, selection: SelectionState): readonly Paragraph[] {
  const projection = editor.getProjection()
  const paragraphs = flattenParagraphs(projection.document.sections.flatMap((section) => section.blocks))
  const anchorPosition = editor.resolveTextPosition(selection.anchor)
  const focusPosition = editor.resolveTextPosition(selection.focus)
  const anchorIndex = paragraphs.findIndex((paragraph) => paragraph.id === anchorPosition.blockId)
  const focusIndex = paragraphs.findIndex((paragraph) => paragraph.id === focusPosition.blockId)

  if (anchorIndex < 0 || focusIndex < 0) {
    return []
  }

  const startIndex = Math.min(anchorIndex, focusIndex)
  const endIndex = Math.max(anchorIndex, focusIndex)

  return paragraphs.slice(startIndex, endIndex + 1)
}

/** 把 block 树拍平成文档顺序段落数组。 */
function flattenParagraphs(blocks: readonly Block[]): readonly Paragraph[] {
  const paragraphs: Paragraph[] = []

  for (const block of blocks) {
    if (block.kind === 'paragraph') {
      paragraphs.push(block)
      continue
    }

    for (const row of block.rows) {
      for (const cell of row.cells) {
        paragraphs.push(...flattenParagraphs(cell.blocks))
      }
    }
  }

  return paragraphs
}

/** 判断段落属性是否已经等价于目标值；null 与缺失统一视为“已清空”。 */
function isParagraphPropertiesEquivalent(
  paragraph: Paragraph,
  properties: Readonly<Record<string, string | number | null>>
): boolean {
  return Object.entries(properties).every(([key, value]) => {
    const currentValue = paragraph.properties?.[key]

    if (value === null) {
      return currentValue === null || currentValue === undefined
    }

    return Object.is(currentValue, value)
  })
}
