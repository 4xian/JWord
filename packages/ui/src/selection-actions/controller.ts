/**
 * 职责：驱动 Gate 4 选区浮动工具栏、右键菜单与局部快捷键，复用现有 editor facade 命令语义。
 * 边界：不修改 core command builder 本体，不实现图片模块，也不持有第二套文档状态。
 * 协作模块：create-ui 负责装配，selection-actions/dom 负责节点结构，selection-actions/state 负责只读状态。
 * 性能/安全约束：所有动作继续走 facade/transaction pipeline，右键菜单只绑定稳定选区快照，不沿用旧状态。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md Gate 4 选区浮层收尾项。
 */
import type { Command, SelectionState } from '@4xian/jword-core'
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
import type { JWordSelectionActionElements } from '../types'
import { createSelectionRebindSnapshot, restoreSelectionFromRebindSnapshot } from '../selection-rebind'
import { DEFAULT_BACKGROUND_COLOR, DEFAULT_TEXT_COLOR } from '../toolbar/builtin-tools'
import { cloneSelection, normalizeHexColor, readSelectionFormattingState } from '../toolbar/state'
import { createSelectionActionsDom, destroySelectionActionsDom, renderSelectionActionsDom } from './dom'
import { buildSelectionActionsViewState, hasActiveTextSelection, readFloatingToolbarPosition, readInteractiveFocus, readSelectionKey } from './state'
import type { CreateSelectionActionsControllerOptions, SelectionActionPosition, SelectionActionsControllerHandle, StableContextSelectionState } from './types'

interface ClipboardBuffer {
  plainText: string
  htmlText: string
}

/** 创建 Gate 4 选区浮层 controller。 */
export function createSelectionActionsController(
  options: CreateSelectionActionsControllerOptions
): SelectionActionsControllerHandle {
  const editor = options.editor
  const editorHost = options.editorHost
  const colorFormat = options.colorFormat
  const insertActions = options.insertActions
  const hiddenTextarea = requireHiddenTextarea(editorHost)
  const canvasContainer = requireCanvasContainer(editorHost)
  const overlayHost = resolveEditorShell(editorHost)
  const dom = createSelectionActionsDom(overlayHost)
  const signalController = new AbortController()
  const liveRegion = options.assistive.liveRegion
  const readonlyMode = options.readonly === true || (typeof options.readonly === 'object' && options.readonly.enabled === true)
  const stableContextSelection: StableContextSelectionState = {
    selection: null,
    linkSelection: null,
    point: null
  }
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
  let dismissedSelectionKey: string | null = null
  let stickyFloatingSelectionKey: string | null = null
  let stickyFloatingPosition: SelectionActionPosition | null = null
  let openColorPicker: 'text' | 'background' | null = null
  let interactiveFocus = readEffectiveInteractiveFocus()
  let destroyed = false

  const unsubscribeEditor = editor.subscribe((event) => {
    if (destroyed) {
      return
    }

    if (event.kind === 'selectionChange') {
      interactiveFocus = readEffectiveInteractiveFocus()
      const currentKey = readSelectionKey(editor, event.selection)

      if (dismissedSelectionKey !== null && currentKey !== dismissedSelectionKey) {
        dismissedSelectionKey = null
      }

      if (stickyFloatingSelectionKey !== null && currentKey !== stickyFloatingSelectionKey) {
        clearStickyFloatingToolbar()
      }

      render()
      return
    }

    if (event.kind === 'transaction') {
      interactiveFocus = readEffectiveInteractiveFocus()
      render()
      return
    }

    if (event.kind === 'destroyed') {
      stableContextSelection.selection = null
      stableContextSelection.linkSelection = null
      stableContextSelection.point = null
      destroyController()
    }
  })

  bindToolbarActions()
  bindContextMenuActions()
  bindLifecycleEvents()
  render()

  /** 用当前 editor 与弹层状态刷新 DOM。 */
  function render(): void {
    if (destroyed) {
      return
    }

    if (readonlyMode) {
      renderReadonlyState()
      return
    }

    const colorSelection = openColorPicker === null ? null : readFrozenColorSelection(openColorPicker)

    renderSelectionActionsDom(dom, buildSelectionActionsViewState({
      editor,
      editorHost: overlayHost,
      interactiveFocus,
      dismissedSelectionKey,
      contextSelection: stableContextSelection.selection,
      contextLinkSelection: stableContextSelection.linkSelection,
      contextPoint: stableContextSelection.point,
      colorSelection,
      activeColorPicker: openColorPicker,
      stickyFloatingToolbar: {
        selectionKey: stickyFloatingSelectionKey,
        position: stickyFloatingPosition
      },
      hasLink: (selection) => insertActions?.hasLink?.(selection) ?? false,
      readLinkUrl: (selection) => insertActions?.readLinkUrl?.(selection) ?? null
    }))
  }

  /** 只读模式下只渲染最小状态。 */
  function renderReadonlyState(): void {
    dom.floatingToolbar.hidden = true
    dom.contextMenu.hidden = true
    dom.formatControls.bold.disabled = true
    dom.formatControls.italic.disabled = true
    dom.formatControls.underline.disabled = true
    dom.formatControls.strike.disabled = true
    dom.formatControls.insertLink.disabled = true
    dom.formatControls.openLink.disabled = true
    dom.formatControls.editLink.disabled = true
    dom.formatControls.removeLink.disabled = true
    dom.formatControls.textColor.disabled = true
    dom.formatControls.backgroundColor.disabled = true
    dom.contextControls.cut.disabled = true
    dom.contextControls.copy.disabled = false
    dom.contextControls.paste.disabled = true
    dom.contextControls.pastePlainText.disabled = true
    dom.contextControls.clear.disabled = true
    dom.contextControls.insertLink.disabled = true
    dom.contextControls.openLink.disabled = true
    dom.contextControls.editLink.disabled = true
    dom.contextControls.removeLink.disabled = true
    dom.contextControls.insertComment.disabled = true
  }

  /** 同步当前 document.activeElement 是否仍在 editor 交互范围内。 */
  function updateInteractiveFocus(): void {
    if (destroyed) {
      return
    }

    interactiveFocus = readEffectiveInteractiveFocus()

    if (!interactiveFocus) {
      stableContextSelection.point = null
      stableContextSelection.linkSelection = null
    }

    render()
  }

  /** 统一用 live region 输出 blocked 或降级文案。 */
  function announce(message: string): void {
    liveRegion?.announce(message, { force: true })
  }

  /** 在动作结束后把焦点尽快还给 editor。 */
  function restoreEditorFocusSoon(): void {
    queueMicrotask(() => {
      if (destroyed) {
        return
      }

      editor.focus()
      updateInteractiveFocus()
    })
  }

  /** 读取当前是否仍应维持选区浮层交互态。 */
  function readEffectiveInteractiveFocus(): boolean {
    return openColorPicker !== null
      || stickyFloatingSelectionKey !== null
      || readInteractiveFocus(editorHost, dom.host, document.activeElement)
  }

  /** 清空当前浮动工具栏冻结锚点。 */
  function clearStickyFloatingToolbar(): void {
    stickyFloatingSelectionKey = null
    stickyFloatingPosition = null
  }

  /** 为当前选区冻结浮动工具栏锚点，避免首次格式改动后位置漂移。 */
  function freezeFloatingToolbarForSelection(selection: SelectionState | null): void {
    if (selection === null) {
      clearStickyFloatingToolbar()
      return
    }

    stickyFloatingSelectionKey = readSelectionKey(editor, selection)
    stickyFloatingPosition = readFloatingToolbarPosition(editor, editorHost, selection)
  }

  /** 在工具栏交互后继续保持当前选区的工具栏可见。 */
  function keepFloatingToolbarVisible(selection: SelectionState | null): void {
    freezeFloatingToolbarForSelection(selection)
    dismissedSelectionKey = null
    interactiveFocus = true
    render()
  }

  /** 在颜色预览后沿用已冻结位置，只把锚点同步到命令后的当前选区。 */
  function keepFloatingToolbarAtStickyPosition(selection: SelectionState | null): void {
    if (stickyFloatingPosition === null) {
      freezeFloatingToolbarForSelection(selection)
    } else {
      const currentSelectionKey = readSelectionKey(editor, editor.getSelection())

      stickyFloatingSelectionKey = currentSelectionKey.length > 0
        ? currentSelectionKey
        : readSelectionKey(editor, selection)
    }

    dismissedSelectionKey = null
    interactiveFocus = true
    render()
  }

  /** 回到编辑器主交互区时收起当前选区的浮动工具栏。 */
  function dismissFloatingToolbarForCurrentSelection(): void {
    const selection = editor.getSelection()

    if (hasActiveTextSelection(selection)) {
      dismissedSelectionKey = readSelectionKey(editor, selection)
    }

    openColorPicker = null
    clearStickyFloatingToolbar()
    render()
  }

  /** 读取当前选区快照，并确保是有效非折叠文本选区。 */
  function readActiveSelectionSnapshot(): SelectionState | null {
    const selection = cloneSelection(editor.getSelection())

    return hasActiveTextSelection(selection) ? selection : null
  }

  /** 读取当前颜色控件已冻结的选区。 */
  function readFrozenColorSelection(kind: 'text' | 'background'): SelectionState | null {
    return kind === 'text' ? frozenColorSelections.text : frozenColorSelections.background
  }

  /** 写入当前颜色控件已冻结的选区。 */
  function writeFrozenColorSelection(kind: 'text' | 'background', selection: SelectionState | null): void {
    if (kind === 'text') {
      frozenColorSelections.text = selection
      return
    }

    frozenColorSelections.background = selection
  }

  /** 捕获颜色控件选区，避免空选区覆盖 pointerdown 阶段已冻结的有效选区。 */
  function captureColorSelection(kind: 'text' | 'background'): SelectionState | null {
    const activeSelection = readActiveSelectionSnapshot()

    if (activeSelection !== null) {
      writeFrozenColorSelection(kind, activeSelection)
      const control = kind === 'text'
        ? dom.formatControls.textColor
        : dom.formatControls.backgroundColor

      writeActiveColorValue(kind, control.value)
      writeActiveColorInputSeen(kind, false)
      writeActiveColorReturnedToEditor(kind, false)
      return activeSelection
    }

    const frozenSelection = readFrozenColorSelection(kind)

    if (frozenSelection !== null) {
      editor.setSelection(frozenSelection)
    }

    return frozenSelection
  }

  /** 统一执行基于选区快照的 facade command。 */
  function executeSelectionCommand(selection: SelectionState | null, command: Command | null): boolean {
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
  function toggleRunFormat(
    selection: SelectionState | null,
    property: 'bold' | 'italic' | 'underline' | 'strike'
  ): void {
    if (selection === null) {
      announce('BLOCKED: 当前没有可格式化的有效文本选区。')
      return
    }

    const formattingState = readSelectionFormattingState(editor, selection)

    if (formattingState.run === null) {
      announce('BLOCKED: 当前选区没有可格式化的文本 run。')
      return
    }

    const nextValue = formattingState.run[property].mixed || formattingState.run[property].value !== true
    let command: Command | null = null

    switch (property) {
      case 'bold':
        command = buildSetBoldCommand(editor.getProjection(), selection, nextValue)
        break
      case 'italic':
        command = buildSetItalicCommand(editor.getProjection(), selection, nextValue)
        break
      case 'underline':
        command = buildSetUnderlineCommand(editor.getProjection(), selection, nextValue)
        break
      case 'strike':
        command = buildSetStrikeCommand(editor.getProjection(), selection, nextValue)
        break
    }

    freezeFloatingToolbarForSelection(selection)

    if (!executeSelectionCommand(selection, command)) {
      announce('BLOCKED: 当前选区未生成可执行的格式命令。')
      return
    }

    keepFloatingToolbarAtStickyPosition(selection)
    stableContextSelection.point = null
  }

  /** 把冻结选区上的颜色写回 editor facade。 */
  function applyColorFormat(
    selection: SelectionState | null,
    kind: 'text' | 'background',
    rawValue: string,
    keepPickerOpen: boolean
  ): void {
    if (selection === null) {
      announce('BLOCKED: 当前没有可用于颜色更新的有效文本选区。')
      return
    }

    const value = normalizeHexColor(rawValue)

    if (value === null) {
      announce(`BLOCKED: 颜色值 ${rawValue} 非法。`)
      return
    }

    const formattingState = readSelectionFormattingState(editor, selection)

    if (formattingState.run === null) {
      announce('BLOCKED: 当前选区没有可格式化的文本 run。')
      return
    }

    const rebindSnapshot = createSelectionRebindSnapshot(editor, selection)

    colorFormat.applyColorFromSelection(
      kind === 'text' ? 'textColor' : 'backgroundColor',
      selection,
      value
    )
    restoreSelectionFromRebindSnapshot(editor, rebindSnapshot)
    writeFrozenColorSelection(kind, readActiveSelectionSnapshot() ?? selection)
    writeActiveColorValue(kind, value)

    if (!keepPickerOpen && openColorPicker === kind) {
      openColorPicker = null
    }

    keepFloatingToolbarAtStickyPosition(readFrozenColorSelection(kind) ?? selection)
    stableContextSelection.point = null
  }

  /** 清除当前稳定选区上的常见 run 级格式，但保留段落语义与标题结构。 */
  function clearStableSelectionFormatting(selection: SelectionState | null): void {
    if (selection === null) {
      announce('BLOCKED: 右键菜单当前没有稳定选区可供清除格式。')
      return
    }

    const commands = [
      buildSetBoldCommand(editor.getProjection(), selection, false),
      buildSetItalicCommand(editor.getProjection(), selection, false),
      buildSetUnderlineCommand(editor.getProjection(), selection, false),
      buildSetStrikeCommand(editor.getProjection(), selection, false),
      buildSetSuperscriptCommand(editor.getProjection(), selection, false),
      buildSetSubscriptCommand(editor.getProjection(), selection, false),
      buildSetTextColorCommand(editor.getProjection(), selection, DEFAULT_TEXT_COLOR),
      buildSetBackgroundColorCommand(editor.getProjection(), selection, DEFAULT_BACKGROUND_COLOR)
    ]
    let applied = false

    for (const command of commands) {
      if (command === null) {
        continue
      }

      editor.executeCommand(command, {
        selectionAfter: selection
      })
      applied = true
    }

    if (!applied) {
      announce('BLOCKED: 当前稳定选区没有可清除的常见 run 级格式。')
      return
    }

    stableContextSelection.point = null
    dismissedSelectionKey = null
    restoreEditorFocusSoon()
  }

  /** 把复制事件序列化到系统剪贴板；写失败时不改动文档。 */
  async function copyStableSelectionToClipboard(selection: SelectionState | null): Promise<void> {
    if (selection === null) {
      announce('BLOCKED: 当前没有可复制的稳定选区。')
      return
    }

    const clipboard = navigator.clipboard

    if (clipboard === undefined || typeof clipboard.writeText !== 'function') {
      if (!runNativeExecCommand('copy')) {
        announce('BLOCKED: 当前浏览器拒绝写入系统剪贴板。')
      }
      return
    }

    editor.setSelection(selection)
    const buffer = collectClipboardBuffer(hiddenTextarea, 'copy')

    if (buffer.plainText.length === 0) {
      announce('BLOCKED: 当前稳定选区没有可复制文本。')
      return
    }

    await clipboard.writeText(buffer.plainText)
    stableContextSelection.point = null
    restoreEditorFocusSoon()
  }

  /** 先写系统剪贴板，再通过 facade 的 cut 路径删除稳定选区。 */
  async function cutStableSelection(selection: SelectionState | null): Promise<void> {
    if (selection === null) {
      announce('BLOCKED: 当前没有可剪切的稳定选区。')
      return
    }

    const clipboard = navigator.clipboard

    if (clipboard === undefined || typeof clipboard.writeText !== 'function') {
      if (!runNativeExecCommand('cut')) {
        announce('BLOCKED: 当前浏览器拒绝执行剪切。')
      }
      return
    }

    editor.setSelection(selection)
    const buffer = collectClipboardBuffer(hiddenTextarea, 'copy')

    if (buffer.plainText.length === 0) {
      announce('BLOCKED: 当前稳定选区没有可剪切文本。')
      return
    }

    await clipboard.writeText(buffer.plainText)
    dispatchClipboardEvent(hiddenTextarea, 'cut', createClipboardData({
      plainText: '',
      htmlText: ''
    }))
    stableContextSelection.point = null
    restoreEditorFocusSoon()
  }

  /** 走浏览器原生 paste，失败后再降级到仅文本粘贴。 */
  async function pasteFromClipboard(selection: SelectionState | null): Promise<void> {
    if (selection !== null) {
      editor.setSelection(selection)
    } else {
      editor.focus()
    }

    if (runNativeExecCommand('paste')) {
      stableContextSelection.point = null
      restoreEditorFocusSoon()
      return
    }

    await pastePlainTextFromClipboard(selection)
  }

  /** 通过 navigator.clipboard.readText + 合成 paste 事件执行仅文本粘贴。 */
  async function pastePlainTextFromClipboard(selection: SelectionState | null): Promise<void> {
    const clipboard = navigator.clipboard

    if (clipboard === undefined || typeof clipboard.readText !== 'function') {
      announce('BLOCKED: 当前浏览器不允许读取纯文本剪贴板。')
      return
    }

    const text = await clipboard.readText()

    if (text.length === 0) {
      announce('BLOCKED: 系统剪贴板当前没有纯文本内容。')
      return
    }

    if (selection !== null) {
      editor.setSelection(selection)
    } else {
      editor.focus()
    }

    dispatchClipboardEvent(hiddenTextarea, 'paste', createClipboardData({
      plainText: text,
      htmlText: text
    }))
    stableContextSelection.point = null
    restoreEditorFocusSoon()
  }

  /** 绑定浮动工具栏格式按钮与颜色输入。 */
  function bindToolbarActions(): void {
    if (readonlyMode) {
      return
    }

    bindButton(dom.formatControls.bold, () => {
      toggleRunFormat(readActiveSelectionSnapshot(), 'bold')
    })
    bindButton(dom.formatControls.italic, () => {
      toggleRunFormat(readActiveSelectionSnapshot(), 'italic')
    })
    bindButton(dom.formatControls.underline, () => {
      toggleRunFormat(readActiveSelectionSnapshot(), 'underline')
    })
    bindButton(dom.formatControls.strike, () => {
      toggleRunFormat(readActiveSelectionSnapshot(), 'strike')
    })
    bindButton(dom.formatControls.insertLink, () => {
      if (insertActions === undefined) {
        announce('BLOCKED: 当前宿主未启用链接弹窗。')
        return
      }

      insertActions.openLink(cloneSelection(readActiveSelectionSnapshot()))
      stableContextSelection.point = null
      render()
    })
    bindButton(dom.formatControls.openLink, () => {
      if (insertActions?.openActiveLink === undefined) {
        announce('BLOCKED: 当前宿主未启用链接打开能力。')
        return
      }

      insertActions.openActiveLink(cloneSelection(readActiveSelectionSnapshot()))
      stableContextSelection.point = null
      render()
    })
    bindButton(dom.formatControls.editLink, () => {
      if (insertActions?.editLink === undefined) {
        announce('BLOCKED: 当前宿主未启用链接编辑能力。')
        return
      }

      insertActions.editLink(cloneSelection(readActiveSelectionSnapshot()))
      stableContextSelection.point = null
      render()
    })
    bindButton(dom.formatControls.removeLink, () => {
      if (insertActions?.removeLink === undefined) {
        announce('BLOCKED: 当前宿主未启用链接删除能力。')
        return
      }

      insertActions.removeLink(cloneSelection(readActiveSelectionSnapshot()))
      stableContextSelection.point = null
      render()
    })

    bindColorInput(dom.formatControls.textColor, 'text')
    bindColorInput(dom.formatControls.backgroundColor, 'background')
    dom.formatControls.textColor.addEventListener('focus', () => {
      openColorPicker = 'text'
      keepFloatingToolbarVisible(captureColorSelection('text'))
    }, { signal: signalController.signal })
    dom.formatControls.backgroundColor.addEventListener('focus', () => {
      openColorPicker = 'background'
      keepFloatingToolbarVisible(captureColorSelection('background'))
    }, { signal: signalController.signal })
    dom.formatControls.textColor.addEventListener('click', () => {
      openColorPicker = 'text'
      keepFloatingToolbarVisible(captureColorSelection('text'))
    }, { signal: signalController.signal })
    dom.formatControls.backgroundColor.addEventListener('click', () => {
      openColorPicker = 'background'
      keepFloatingToolbarVisible(captureColorSelection('background'))
    }, { signal: signalController.signal })
    bindColorPreview(dom.formatControls.textColor, 'text')
    bindColorPreview(dom.formatControls.backgroundColor, 'background')
  }

  /** 在颜色控件的 pointerdown/mousedown 阶段先冻结选区，避免 hidden textarea blur 抢先把浮层收起。 */
  function bindColorInput(
    target: HTMLInputElement,
    kind: 'text' | 'background'
  ): void {
    const armPicker = () => {
      const selection = captureColorSelection(kind)
      openColorPicker = kind
      keepFloatingToolbarVisible(selection)
    }

    target.addEventListener('pointerdown', armPicker, { signal: signalController.signal })
    target.addEventListener('mousedown', armPicker, { signal: signalController.signal })
  }

  /** 颜色选择过程中即时提交 input，同时保留 change 作为浏览器兼容兜底。 */
  function bindColorPreview(
    target: HTMLInputElement,
    kind: 'text' | 'background'
  ): void {
    const applyPreview = (event: Event) => {
      const selection = readFrozenColorSelection(kind)
      const value = readActiveColorValue(kind, target.value, event.type)

      applyColorFormat(selection, kind, value, true)
      syncColorPreview(kind, value)
    }

    target.addEventListener('input', applyPreview, { signal: signalController.signal })
    target.addEventListener('change', applyPreview, { signal: signalController.signal })
  }

  /** 让原生颜色 picker 打开期间的可视色条跟随当前选择值。 */
  function syncColorPreview(kind: 'text' | 'background', rawValue: string): void {
    const value = normalizeHexColor(rawValue)

    if (value === null) {
      return
    }

    const target = kind === 'text'
      ? dom.formatControls.textColor
      : dom.formatControls.backgroundColor

    target.parentElement?.style.setProperty('--jw-selection-toolbar-color', value)
  }

  /** 读取当前颜色 picker 会话中的最后有效颜色，避免 editor mousedown render 后迟到 change 读到默认值。 */
  function readActiveColorValue(kind: 'text' | 'background', rawValue: string, eventType: string): string {
    const value = normalizeHexColor(rawValue)
    const inputSeen = kind === 'text'
      ? activeColorInputSeen.text
      : activeColorInputSeen.background
    const returnedToEditor = kind === 'text'
      ? activeColorReturnedToEditor.text
      : activeColorReturnedToEditor.background

    if (eventType === 'change' && inputSeen && returnedToEditor) {
      return kind === 'text'
        ? activeColorValues.text ?? rawValue
        : activeColorValues.background ?? rawValue
    }

    if (value !== null) {
      writeActiveColorValue(kind, value)
      writeActiveColorInputSeen(kind, eventType === 'input')
      writeActiveColorReturnedToEditor(kind, false)
      return value
    }

    return kind === 'text'
      ? activeColorValues.text ?? rawValue
      : activeColorValues.background ?? rawValue
  }

  /** 写入当前颜色 picker 会话中的最后有效颜色。 */
  function writeActiveColorValue(kind: 'text' | 'background', value: string): void {
    if (kind === 'text') {
      activeColorValues.text = value
      return
    }

    activeColorValues.background = value
  }

  /** 记录当前 picker 会话是否已经通过 input 实时预览过。 */
  function writeActiveColorInputSeen(kind: 'text' | 'background', value: boolean): void {
    if (kind === 'text') {
      activeColorInputSeen.text = value
      return
    }

    activeColorInputSeen.background = value
  }

  /** 记录当前 picker 会话是否已由用户点回编辑器收口。 */
  function writeActiveColorReturnedToEditor(kind: 'text' | 'background', value: boolean): void {
    if (kind === 'text') {
      activeColorReturnedToEditor.text = value
      return
    }

    activeColorReturnedToEditor.background = value
  }

  /** 绑定右键菜单动作。 */
  function bindContextMenuActions(): void {
    if (readonlyMode) {
      return
    }

    bindButton(dom.contextControls.cut, () => {
      void cutStableSelection(cloneSelection(stableContextSelection.selection))
    })
    bindButton(dom.contextControls.copy, () => {
      void copyStableSelectionToClipboard(cloneSelection(stableContextSelection.selection))
    })
    bindButton(dom.contextControls.paste, () => {
      void pasteFromClipboard(cloneSelection(stableContextSelection.selection))
    })
    bindButton(dom.contextControls.pastePlainText, () => {
      void pastePlainTextFromClipboard(cloneSelection(stableContextSelection.selection))
    })
    bindButton(dom.contextControls.clear, () => {
      clearStableSelectionFormatting(cloneSelection(stableContextSelection.selection))
    })
    bindButton(dom.contextControls.insertComment, () => {
      if (insertActions === undefined) {
        announce('BLOCKED: 当前宿主未启用批注侧栏。')
        return
      }

      insertActions.openComment(cloneSelection(stableContextSelection.selection))
      stableContextSelection.point = null
      render()
    })
    bindButton(dom.contextControls.insertLink, () => {
      if (insertActions === undefined) {
        announce('BLOCKED: 当前宿主未启用链接弹窗。')
        return
      }

      insertActions.openLink(cloneSelection(stableContextSelection.selection))
      stableContextSelection.point = null
      render()
    })
    bindButton(dom.contextControls.openLink, () => {
      if (insertActions?.openActiveLink === undefined) {
        announce('BLOCKED: 当前宿主未启用链接打开能力。')
        return
      }

      insertActions.openActiveLink(cloneSelection(stableContextSelection.linkSelection))
      stableContextSelection.point = null
      stableContextSelection.linkSelection = null
      render()
    })
    bindButton(dom.contextControls.editLink, () => {
      if (insertActions?.editLink === undefined) {
        announce('BLOCKED: 当前宿主未启用链接编辑能力。')
        return
      }

      insertActions.editLink(cloneSelection(stableContextSelection.linkSelection))
      stableContextSelection.point = null
      stableContextSelection.linkSelection = null
      render()
    })
    bindButton(dom.contextControls.removeLink, () => {
      if (insertActions?.removeLink === undefined) {
        announce('BLOCKED: 当前宿主未启用链接删除能力。')
        return
      }

      insertActions.removeLink(cloneSelection(stableContextSelection.linkSelection))
      stableContextSelection.point = null
      stableContextSelection.linkSelection = null
      render()
    })
  }

  /** 绑定 editor 生命周期、右键菜单、局部快捷键与失焦收口逻辑。 */
  function bindLifecycleEvents(): void {
    if (readonlyMode) {
      return
    }

    hiddenTextarea.addEventListener('focus', () => {
      queueMicrotask(updateInteractiveFocus)
    }, { signal: signalController.signal })
    hiddenTextarea.addEventListener('blur', () => {
      queueMicrotask(updateInteractiveFocus)
    }, { signal: signalController.signal })
    dom.host.addEventListener('focusin', () => {
      queueMicrotask(updateInteractiveFocus)
    }, { signal: signalController.signal })
    dom.host.addEventListener('focusout', () => {
      queueMicrotask(updateInteractiveFocus)
    }, { signal: signalController.signal })
    hiddenTextarea.addEventListener('keydown', (event) => {
      const lowerKey = event.key.toLowerCase()
      const usesCommandModifier = event.metaKey || event.ctrlKey

      if (usesCommandModifier && lowerKey === 'u') {
        event.preventDefault()
        toggleRunFormat(readActiveSelectionSnapshot(), 'underline')
        return
      }

      if (event.key === 'Escape') {
        event.preventDefault()
        dismissedSelectionKey = readSelectionKey(editor, editor.getSelection())
        openColorPicker = null
        clearStickyFloatingToolbar()
        stableContextSelection.point = null
        stableContextSelection.linkSelection = null
        render()
      }
    }, { signal: signalController.signal })
    editorHost.addEventListener('contextmenu', (event) => {
      event.preventDefault()
      openColorPicker = null
      clearStickyFloatingToolbar()
      const linkSelection = readContextLinkSelection(event)

      stableContextSelection.selection = linkSelection ?? cloneSelection(editor.getSelection())
      stableContextSelection.linkSelection = linkSelection
      stableContextSelection.point = {
        left: event.clientX,
        top: event.clientY
      }
      dismissedSelectionKey = null
      interactiveFocus = true
      render()
    }, { signal: signalController.signal })
    editorHost.addEventListener('mousedown', (event) => {
      if (!(event.target instanceof Node)) {
        return
      }

      if (isLinkOverlayTarget(event.target) && restoreDismissedLinkToolbar()) {
        return
      }

      if (!dom.host.contains(event.target)) {
        if (openColorPicker !== null) {
          writeActiveColorReturnedToEditor(openColorPicker, true)
        }
        dismissFloatingToolbarForCurrentSelection()
      }

      stableContextSelection.point = null
      stableContextSelection.linkSelection = null
      render()
    }, { signal: signalController.signal })
    canvasContainer.addEventListener('scroll', () => {
      stableContextSelection.point = null
      stableContextSelection.linkSelection = null
      render()
    }, { signal: signalController.signal })
    document.addEventListener('pointerdown', (event) => {
      if (!(event.target instanceof Node)) {
        return
      }

      if (editorHost.contains(event.target) || dom.host.contains(event.target)) {
        return
      }

      openColorPicker = null
      clearStickyFloatingToolbar()
      stableContextSelection.point = null
      stableContextSelection.linkSelection = null
      interactiveFocus = false
      render()
    }, { signal: signalController.signal })
  }

  /** 读取本次右键菜单可执行链接动作的选区，避免沿用旧链接状态。 */
  function readContextLinkSelection(event: MouseEvent): SelectionState | null {
    const targetSelection = event.target instanceof Element
      ? cloneSelection(insertActions?.readLinkSelectionFromTarget?.(event.target) ?? null)
      : null

    if (targetSelection !== null) {
      return targetSelection
    }

    const selection = cloneSelection(editor.getSelection())

    if (insertActions?.hasLink?.(selection) === true) {
      return selection
    }

    return null
  }

  /** 判断事件目标是否来自正文链接 overlay。 */
  function isLinkOverlayTarget(target: Node): boolean {
    return target instanceof Element
      && target.closest('[data-jword-link-target-index]') !== null
  }

  /** 再次点击已收起的链接选区时恢复浮动工具栏显示资格。 */
  function restoreDismissedLinkToolbar(): boolean {
    const selection = editor.getSelection()
    const currentSelectionKey = readSelectionKey(editor, selection)

    if (
      dismissedSelectionKey === null
      || currentSelectionKey.length === 0
      || dismissedSelectionKey !== currentSelectionKey
      || insertActions?.hasLink?.(selection) !== true
    ) {
      return false
    }

    dismissedSelectionKey = null
    openColorPicker = null
    clearStickyFloatingToolbar()
    stableContextSelection.point = null
    stableContextSelection.linkSelection = null
    interactiveFocus = true
    render()

    return true
  }

  /** 把按钮绑定为统一动作入口，并阻止鼠标按下抢走 hidden textarea 焦点。 */
  function bindButton(target: HTMLButtonElement, handler: () => void): void {
    target.addEventListener('pointerdown', preventDefaultEvent, { signal: signalController.signal })
    target.addEventListener('mousedown', preventDefaultEvent, { signal: signalController.signal })
    target.addEventListener('click', () => {
      if (!target.disabled) {
        handler()
      }
    }, { signal: signalController.signal })
  }

  /** 销毁 selection-actions controller。 */
  function destroyController(): void {
    if (destroyed) {
      return
    }

    destroyed = true
    signalController.abort()
    unsubscribeEditor()
    destroySelectionActionsDom(dom)
  }

  return {
    elements: {
      host: dom.host,
      floatingToolbar: dom.floatingToolbar,
      contextMenu: dom.contextMenu
    },
    refresh(): void {
      render()
    },
    destroy: destroyController
  }
}

/** 读取 editor mount 后的隐藏输入框。 */
function requireHiddenTextarea(editorHost: HTMLElement): HTMLTextAreaElement {
  const textarea = editorHost.querySelector('[data-jword-hidden-textarea]')

  if (!(textarea instanceof HTMLTextAreaElement)) {
    throw new Error('selection-actions 需要已挂载的 hidden textarea。')
  }

  return textarea
}

/** 读取 editor mount 后的 canvas 容器。 */
function requireCanvasContainer(editorHost: HTMLElement): HTMLElement {
  const container = editorHost.querySelector('[data-jword-canvas-container]')

  if (!(container instanceof HTMLElement)) {
    throw new Error('selection-actions 需要已挂载的 canvas container。')
  }

  return container
}

/** 读取 editor.mount 创建的内部定位宿主。 */
function resolveEditorShell(editorHost: HTMLElement): HTMLElement {
  if (editorHost.matches('[data-jword-editor]')) {
    return editorHost
  }

  return editorHost.querySelector<HTMLElement>('[data-jword-editor]') ?? editorHost
}

/** 创建可被 facade runtime 识别的最小 clipboardData 对象。 */
function createClipboardData(buffer: ClipboardBuffer): Readonly<{
  getData(type: string): string
  setData(type: string, value: string): void
}> {
  return {
    getData(type: string): string {
      if (type === 'text/plain') {
        return buffer.plainText
      }

      if (type === 'text/html') {
        return buffer.htmlText
      }

      return ''
    },
    setData(type: string, value: string): void {
      if (type === 'text/plain') {
        buffer.plainText = value
      }

      if (type === 'text/html') {
        buffer.htmlText = value
      }
    }
  }
}

/** 通过合成 clipboard 事件收集 core facade 生成的复制内容。 */
function collectClipboardBuffer(
  hiddenTextarea: HTMLTextAreaElement,
  kind: 'copy' | 'cut'
): ClipboardBuffer {
  const buffer: ClipboardBuffer = {
    plainText: '',
    htmlText: ''
  }

  dispatchClipboardEvent(hiddenTextarea, kind, createClipboardData(buffer))

  return buffer
}

/** 向当前 hidden textarea 分发一条带 clipboardData 的合成事件。 */
function dispatchClipboardEvent(
  hiddenTextarea: HTMLTextAreaElement,
  kind: 'copy' | 'cut' | 'paste',
  clipboardData: ReturnType<typeof createClipboardData>
): void {
  const event = new Event(kind, {
    bubbles: true,
    cancelable: true
  })

  Object.defineProperty(event, 'clipboardData', {
    configurable: true,
    value: clipboardData
  })

  hiddenTextarea.dispatchEvent(event)
}

/** 尝试通过浏览器原生命令完成 copy/cut/paste。 */
function runNativeExecCommand(command: 'copy' | 'cut' | 'paste'): boolean {
  const documentWithExec = document as Document & {
    execCommand?: (name: string) => boolean
  }

  return typeof documentWithExec.execCommand === 'function'
    && documentWithExec.execCommand(command) === true
}

/** 统一阻止鼠标按下默认行为，避免 editor hidden textarea 失焦。 */
function preventDefaultEvent(event: Event): void {
  event.preventDefault()
}
