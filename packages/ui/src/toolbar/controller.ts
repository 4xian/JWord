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
  JWordReadonlyMode,
  JWordToolbarControlElement,
  JWordToolbarElements,
  JWordToolbarToolId
} from '../types'
import type { SelectionActionsColorFormatController } from '../selection-actions/types'
import { createSelectionRebindSnapshot, restoreSelectionFromRebindSnapshot } from '../selection-rebind'
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
  readonly insertActions?: {
    readonly openComment?: () => void
    readonly openLink?: () => void
  }
  readonly panelActions?: {
    readonly toggleFindReplace?: () => void
    readonly toggleHeadingOutline?: () => void
    readonly toggleHeaderFooter?: (anchor: HTMLElement) => void
    readonly toggleFooter?: (anchor: HTMLElement) => void
    readonly togglePageNumber?: (anchor: HTMLElement) => void
    readonly toggleRevisions?: () => void
  }
  readonly panelState?: {
    readonly headingOutline?: () => boolean
    readonly headingOutlineAvailable?: () => boolean
  }
}

interface ToolbarControllerHandle {
  readonly elements: JWordToolbarElements
  readonly mediaHost: HTMLElement | null
  readonly tableHost: HTMLElement | null
  readonly linkHost: HTMLElement | null
  readonly panelHost: HTMLElement | null
  readonly colorFormat: SelectionActionsColorFormatController
  refresh(): void
  destroy(): void
}

/** 创建并接管官方 toolbar。 */
export function createToolbarController(options: CreateToolbarControllerOptions): ToolbarControllerHandle {
  const toolbarHidden = options.toolbar === false
  const previousToolbarHidden = options.toolbarHost.hidden
  const toolbarConfig = resolveToolbarConfig(toolbarHidden
    ? {
        visibleTools: []
      }
    : options.toolbar)
  const dom = createToolbarDom(options.toolbarHost, toolbarConfig)
  if (toolbarHidden) {
    options.toolbarHost.hidden = true
  }
  const mediaHost = options.media === undefined || toolbarHidden
    ? null
    : createToolbarExtensionHost(dom.bar, 'media')
  const tableHost = options.table === undefined || toolbarHidden
    ? null
    : createToolbarExtensionHost(dom.bar, 'table')
  const linkHost = options.link === undefined || toolbarHidden
    ? null
    : createToolbarExtensionHost(dom.bar, 'link')
  const panelHost = toolbarHidden
    || (options.headerFooter === undefined
    && options.headingOutline === undefined
    && options.findReplace === undefined
    && options.revisions === undefined)
    ? null
    : createToolbarExtensionHost(dom.bar, 'panel')
  const assistive = options.assistive
  const editor = options.editor
  const readonlyMode = normalizeReadonlyMode(options.readonly)
  const signalController = new AbortController()
  let suppressSelectionAnnouncementsUntil = 0
  let suppressAfterToolbarTransaction = false
  const frozenColorSelections = {
    text: null as SelectionState | null,
    background: null as SelectionState | null
  }
  const activeColorValues = {
    text: null as string | null,
    background: null as string | null
  }
  const activeColorInputSeen = {
    text: false,
    background: false
  }
  const activeColorReturnedToEditor = {
    text: false,
    background: false
  }
  let openColorPicker: 'textColor' | 'backgroundColor' | null = null
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
    if (readonlyMode.enabled) {
      renderToolbarState(dom, buildToolbarState(editor), null, {
        headingOutline: false,
        headingOutlineAvailable: readonlyMode.allowNavigation && readHeadingOutlineAvailable()
      })

      disableReadonlyToolbarControls()
      return
    }

    renderToolbarState(dom, buildToolbarState(editor), openColorPicker, {
      headingOutline: options.panelState?.headingOutline?.() === true,
      headingOutlineAvailable: readHeadingOutlineAvailable()
    })
  }

  /** 只读模式下禁用编辑入口。 */
  function disableReadonlyToolbarControls(): void {
    const editableToolIds = [
      'history.undo',
      'history.redo',
      'document.pagePreset',
      'document.findReplace',
      'document.headingOutline',
      'format.bold',
      'format.italic',
      'format.underline',
      'format.strike',
      'format.superscript',
      'format.subscript',
      'format.fontFamily',
      'format.fontSize',
      'format.fontSizeDecrease',
      'format.fontSizeIncrease',
      'format.textColor',
      'format.backgroundColor',
      'paragraph.alignment',
      'paragraph.indentDecrease',
      'paragraph.indentIncrease',
      'paragraph.indentLeft',
      'paragraph.lineHeight',
      'paragraph.spacingBefore',
      'paragraph.spacingAfter',
      'paragraph.firstLineIndent',
      'paragraph.hangingIndent',
      'paragraph.style',
      'paragraph.list',
      'insert.comment',
      'insert.link',
      'document.headerFooter',
      'document.footer',
      'document.pageNumber',
      'document.revisions'
    ] as const

    for (const toolId of editableToolIds) {
      const control = dom.controls[toolId]

      if (control !== undefined) {
        if (readonlyMode.allowNavigation && isReadonlyNavigationTool(toolId)) {
          continue
        }

        const disabled = true

        control.disabled = disabled
        syncReadonlyToolbarControlDisabledState(control, disabled)
      }
    }
  }

  /** 判断只读模式下由导航渲染状态自行决定的工具。 */
  function isReadonlyNavigationTool(toolId: JWordToolbarToolId): boolean {
    return toolId === 'document.findReplace' || toolId === 'document.headingOutline'
  }

  /** 同步只读禁用态到自绘 select / color 外层控件。 */
  function syncReadonlyToolbarControlDisabledState(control: JWordToolbarControlElement, disabled: boolean): void {
    if (control instanceof HTMLSelectElement) {
      const trigger = control.parentElement?.querySelector<HTMLButtonElement>('.jw-toolbar__select-trigger')

      control.parentElement?.setAttribute('data-jword-disabled', String(disabled))
      if (trigger !== null && trigger !== undefined) {
        trigger.disabled = disabled
      }
      return
    }

    if (control instanceof HTMLInputElement && control.type === 'color') {
      control.parentElement?.setAttribute('data-jword-disabled', String(disabled))
    }
  }

  /** 读取目录按钮当前是否有可打开的目录项。 */
  function readHeadingOutlineAvailable(): boolean {
    return options.panelState?.headingOutlineAvailable?.() === true
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
    const bindToolbarButton = (
      control: JWordToolbarControlElement | undefined,
      handler: (control: HTMLButtonElement) => void,
      focusOptions: { readonly restoreEditorFocus?: boolean } = {}
    ) => {
      if (!(control instanceof HTMLButtonElement)) {
        return
      }

      bindButton(control, () => {
        handler(control)
        if (focusOptions.restoreEditorFocus !== false) {
          restoreEditorFocusSoon()
        }
      })
    }
    const bindToolbarSelect = (control: JWordToolbarControlElement | undefined, handler: () => void) => {
      bindSelect(control, () => {
        openColorPicker = null
        handler()
        restoreEditorFocusSoon()
      })
    }
    const bindToolbarColorInput = (
      control: JWordToolbarControlElement | undefined,
      handler: (event: Event) => void
    ) => {
      bindColorInput(control, handler)
    }

    options.editorHost?.addEventListener('mousedown', () => {
      if (openColorPicker === null) {
        return
      }

      writeActiveColorReturnedToEditor(openColorPicker, true)
      openColorPicker = null
      render()
    }, { signal: signalController.signal })
    dom.host.ownerDocument.addEventListener('pointerdown', closeToolbarPanelsOnOutsideEvent, {
      signal: signalController.signal
    })
    dom.host.ownerDocument.addEventListener('click', closeToolbarPanelsOnOutsideEvent, {
      signal: signalController.signal
    })

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
    bindToolbarButton(dom.controls['document.findReplace'], () => {
      if (readonlyMode.enabled && !readonlyMode.allowNavigation) {
        announce('当前为只读模式。')
        return
      }

      options.panelActions?.toggleFindReplace?.()
      render()
    }, { restoreEditorFocus: false })
    bindToolbarButton(dom.controls['document.headingOutline'], () => {
      if (readonlyMode.enabled && !readonlyMode.allowNavigation) {
        announce('当前为只读模式。')
        return
      }

      if (!readHeadingOutlineAvailable()) {
        render()
        return
      }

      options.panelActions?.toggleHeadingOutline?.()
      render()
    }, { restoreEditorFocus: false })
    bindToolbarButton(dom.controls['document.headerFooter'], (control) => {
      if (readonlyMode.enabled) {
        announce('当前为只读模式。')
        return
      }

      options.panelActions?.toggleHeaderFooter?.(control)
      render()
    }, { restoreEditorFocus: false })
    bindToolbarButton(dom.controls['document.footer'], (control) => {
      if (readonlyMode.enabled) {
        announce('当前为只读模式。')
        return
      }

      options.panelActions?.toggleFooter?.(control)
      render()
    }, { restoreEditorFocus: false })
    bindToolbarButton(dom.controls['document.pageNumber'], (control) => {
      if (readonlyMode.enabled) {
        announce('当前为只读模式。')
        return
      }

      options.panelActions?.togglePageNumber?.(control)
      render()
    }, { restoreEditorFocus: false })
    bindToolbarButton(dom.controls['document.revisions'], () => {
      if (readonlyMode.enabled) {
        announce('当前为只读模式。')
        return
      }

      options.panelActions?.toggleRevisions?.()
      render()
    }, { restoreEditorFocus: false })
    bindToolbarButton(dom.controls['insert.comment'], () => {
      if (readonlyMode.enabled) {
        announce('当前为只读模式。')
        return
      }

      if (options.insertActions?.openComment === undefined) {
        announce('BLOCKED: 当前宿主未启用批注侧栏。')
        return
      }

      options.insertActions.openComment()
    }, { restoreEditorFocus: false })
    bindToolbarButton(dom.controls['insert.link'], () => {
      if (readonlyMode.enabled) {
        announce('当前为只读模式。')
        return
      }

      if (options.insertActions?.openLink === undefined) {
        announce('BLOCKED: 当前宿主未启用链接弹窗。')
        return
      }

      options.insertActions.openLink()
    }, { restoreEditorFocus: false })
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
      openColorPicker = 'textColor'
      captureColorSelection('textColor')
    })
    bindColorClick(dom.controls['format.backgroundColor'], () => {
      openColorPicker = 'backgroundColor'
      captureColorSelection('backgroundColor')
    })
    bindToolbarColorInput(dom.controls['format.textColor'], (event) => {
      const control = readColor(dom.controls['format.textColor'])

      if (control === null) {
        return
      }

      openColorPicker = 'textColor'
      applyColorFormatFromFrozenSelection('textColor', '文字颜色', readActiveColorValue('textColor', control.value, event.type))
    })
    bindToolbarColorInput(dom.controls['format.backgroundColor'], (event) => {
      const control = readColor(dom.controls['format.backgroundColor'])

      if (control === null) {
        return
      }

      openColorPicker = 'backgroundColor'
      applyColorFormatFromFrozenSelection('backgroundColor', '背景色', readActiveColorValue('backgroundColor', control.value, event.type))
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

  /** 点击 toolbar 与浮层外部时关闭当前打开的面板。 */
  function closeToolbarPanelsOnOutsideEvent(event: Event): void {
    const target = event.target

    if (!(target instanceof Node) || dom.host.contains(target) || isToolbarPanelTarget(target)) {
      return
    }

    closeVisibleToolbarPanels(panelHost)
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
    const frozenSelection = readFrozenColorSelection(property)
    const activeSelection = cloneSelection(editor.getSelection())
    const selection = frozenSelection ?? activeSelection
    const formattingState = selection === null ? null : readSelectionFormattingState(editor, selection)
    const normalizedValue = normalizeHexColor(value) ?? value

    if (activeSelection === null && frozenSelection !== null) {
      editor.setSelection(frozenSelection)
    }

    if (selection === null || formattingState === null || formattingState.run === null) {
      announce(`BLOCKED: ${label} 需要当前有可格式化的文本选区。`)
      render()
      return
    }

    if (isRunStringFormatAlreadyApplied(formattingState, property, normalizedValue)) {
      announce(`${label} 已经处于目标状态。`)
      render()
      return
    }

    const command = property === 'textColor'
      ? buildSetTextColorCommand(editor.getProjection(), selection, normalizedValue)
      : buildSetBackgroundColorCommand(editor.getProjection(), selection, normalizedValue)

    if (command === null) {
      announce(`BLOCKED: ${label} 当前没有可应用的文本目标。`)
      render()
      return
    }

    markToolbarTransaction()
    const rebindSnapshot = createSelectionRebindSnapshot(editor, selection)

    editor.executeCommand(command, {
      selectionAfter: selection
    })
    const reboundSelection = restoreSelectionFromRebindSnapshot(editor, rebindSnapshot)

    writeFrozenColorSelection(property, cloneSelection(reboundSelection) ?? cloneSelection(editor.getSelection()) ?? selection)
    writeActiveColorValue(property, normalizedValue)
  }

  /** 捕获颜色控件打开时的选区，供 picker change 阶段复用。 */
  function captureColorSelection(property: 'textColor' | 'backgroundColor'): SelectionState | null {
    const activeSelection = cloneSelection(editor.getSelection())

    if (activeSelection !== null) {
      writeFrozenColorSelection(property, activeSelection)
      const control = readColor(dom.controls[property === 'textColor' ? 'format.textColor' : 'format.backgroundColor'])

      if (control !== null) {
        writeActiveColorValue(property, control.value)
        writeActiveColorInputSeen(property, false)
        writeActiveColorReturnedToEditor(property, false)
      }

      return activeSelection
    }

    const frozenSelection = readFrozenColorSelection(property)

    if (frozenSelection !== null) {
      editor.setSelection(frozenSelection)
    }

    return frozenSelection
  }

  /** 对内部 UI 子模块暴露同一套颜色提交能力。 */
  function applyColorFromSelection(
    property: 'textColor' | 'backgroundColor',
    selection: SelectionState | null,
    value: string
  ): void {
    writeFrozenColorSelection(property, cloneSelection(selection))
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

  /** 读取颜色控件冻结快照。 */
  function readFrozenColorSelection(property: 'textColor' | 'backgroundColor'): SelectionState | null {
    return property === 'textColor' ? frozenColorSelections.text : frozenColorSelections.background
  }

  /** 写入颜色控件冻结快照。 */
  function writeFrozenColorSelection(property: 'textColor' | 'backgroundColor', selection: SelectionState | null): void {
    if (property === 'textColor') {
      frozenColorSelections.text = selection
      return
    }

    frozenColorSelections.background = selection
  }

  /** 读取当前颜色 picker 会话中的最后有效颜色，避免 editor mousedown render 后迟到 change 读到默认值。 */
  function readActiveColorValue(property: 'textColor' | 'backgroundColor', rawValue: string, eventType: string): string {
    const value = normalizeHexColor(rawValue)
    const inputSeen = property === 'textColor'
      ? activeColorInputSeen.text
      : activeColorInputSeen.background
    const returnedToEditor = property === 'textColor'
      ? activeColorReturnedToEditor.text
      : activeColorReturnedToEditor.background

    if (eventType === 'change' && inputSeen && returnedToEditor) {
      return property === 'textColor'
        ? activeColorValues.text ?? rawValue
        : activeColorValues.background ?? rawValue
    }

    if (value !== null) {
      writeActiveColorValue(property, value)
      writeActiveColorInputSeen(property, eventType === 'input')
      writeActiveColorReturnedToEditor(property, false)
      return value
    }

    return property === 'textColor'
      ? activeColorValues.text ?? rawValue
      : activeColorValues.background ?? rawValue
  }

  /** 写入当前颜色 picker 会话中的最后有效颜色。 */
  function writeActiveColorValue(property: 'textColor' | 'backgroundColor', value: string): void {
    if (property === 'textColor') {
      activeColorValues.text = value
      return
    }

    activeColorValues.background = value
  }

  /** 记录当前 picker 会话是否已经通过 input 实时预览过。 */
  function writeActiveColorInputSeen(property: 'textColor' | 'backgroundColor', value: boolean): void {
    if (property === 'textColor') {
      activeColorInputSeen.text = value
      return
    }

    activeColorInputSeen.background = value
  }

  /** 记录当前 picker 会话是否已由用户点回编辑器收口。 */
  function writeActiveColorReturnedToEditor(property: 'textColor' | 'backgroundColor', value: boolean): void {
    if (property === 'textColor') {
      activeColorReturnedToEditor.text = value
      return
    }

    activeColorReturnedToEditor.background = value
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
    linkHost,
    panelHost,
    colorFormat: {
      applyColorFromSelection
    },
    refresh,
    destroy(): void {
      signalController.abort()
      unsubscribeEditor()
      assistive.liveRegion.destroy()
      assistive.textMirror?.destroy()
      options.toolbarHost.hidden = previousToolbarHidden
      destroyToolbarDom(dom)
    }
  }
}

/** 为 Gate 4 扩展入口补一个挂到 toolbar bar 末尾的独立分组。 */
function createToolbarExtensionHost(bar: HTMLElement, kind: 'media' | 'table' | 'link' | 'panel'): HTMLElement {
  const group = document.createElement('div')

  group.className = kind === 'panel'
    ? 'jw-toolbar__group jw-toolbar__group--overlay'
    : 'jw-toolbar__group'
  group.setAttribute(`data-jword-${kind}-host`, 'true')
  bar.append(group)

  return group
}

/** 判断事件目标是否落在 toolbar 管理的面板内部。 */
function isToolbarPanelTarget(target: Node): boolean {
  return target instanceof Element && target.closest(readToolbarPanelSelector()) !== null
}

/** 关闭当前 toolbar 相关的可见面板。 */
function closeVisibleToolbarPanels(panelHost: HTMLElement | null): void {
  closeToolbarPanelHostChildren(panelHost)
}

/** 关闭挂在 toolbar overlay host 里的面板。 */
function closeToolbarPanelHostChildren(panelHost: HTMLElement | null): void {
  if (panelHost === null) {
    return
  }

  const panels = panelHost.querySelectorAll<HTMLElement>(
    '[data-jword-find-replace], [data-jword-header-footer], [data-jword-revisions-panel]'
  )

  for (const panel of panels) {
    panel.hidden = true
  }

  for (const menu of panelHost.querySelectorAll<HTMLElement>(
    '[data-jword-header-menu], [data-jword-footer-menu], [data-jword-header-footer-menu], [data-jword-page-number-menu]'
  )) {
    menu.hidden = true
  }
}

/** 读取所有 toolbar 弹出面板选择器。 */
function readToolbarPanelSelector(): string {
  return [
    '[data-jword-find-replace]',
    '[data-jword-header-footer]',
    '[data-jword-revisions-panel]'
  ].join(', ')
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

/** 在颜色控件上绑定打开 picker 前后的关键事件。 */
function bindColorClick(control: JWordToolbarControlElement | undefined, handler: () => void): void {
  if (!(control instanceof HTMLInputElement)) {
    return
  }

  control.addEventListener('pointerdown', handler)
  control.addEventListener('mousedown', handler)
  control.addEventListener('click', handler)
}

/** 在颜色控件上绑定即时 input 与最终 change 事件。 */
function bindColorInput(control: JWordToolbarControlElement | undefined, handler: (event: Event) => void): void {
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

/** 规范化只读配置。 */
function normalizeReadonlyMode(readonly: JWordReadonlyMode): Readonly<{ enabled: boolean, allowNavigation: boolean }> {
  if (readonly === true) {
    return {
      enabled: true,
      allowNavigation: true
    }
  }

  if (readonly === false || readonly === undefined) {
    return {
      enabled: false,
      allowNavigation: true
    }
  }

  return {
    enabled: readonly.enabled === true,
    allowNavigation: readonly.allowNavigation !== false
  }
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
