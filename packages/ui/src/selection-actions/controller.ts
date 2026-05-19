/**
 * 职责：驱动 Gate 4 选区浮动工具栏、右键菜单与局部快捷键，复用现有 editor facade 命令语义。
 * 边界：不修改 core command builder 本体，不实现图片模块，也不持有第二套文档状态。
 * 协作模块：create-ui 负责装配，selection-actions/dom 负责节点结构，selection-actions/state 负责只读状态。
 * 性能/安全约束：所有动作继续走 facade/transaction pipeline，右键菜单只绑定稳定选区快照，不沿用旧状态。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md Gate 4 选区浮层收尾项。
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
import type { JWordSelectionActionElements } from '../types'
import { DEFAULT_BACKGROUND_COLOR, DEFAULT_TEXT_COLOR } from '../toolbar/builtin-tools'
import { cloneSelection, normalizeHexColor, readSelectionFormattingState } from '../toolbar/state'
import { createSelectionActionsDom, destroySelectionActionsDom, renderSelectionActionsDom } from './dom'
import { buildSelectionActionsViewState, hasActiveTextSelection, readInteractiveFocus, readSelectionKey } from './state'
import type { CreateSelectionActionsControllerOptions, SelectionActionsControllerHandle, StableContextSelectionState } from './types'

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
  const dom = createSelectionActionsDom(editorHost)
  const hiddenTextarea = requireHiddenTextarea(editorHost)
  const canvasContainer = requireCanvasContainer(editorHost)
  const signalController = new AbortController()
  const liveRegion = options.assistive.liveRegion
  const stableContextSelection: StableContextSelectionState = {
    selection: null,
    point: null
  }
  const frozenColorSelections = {
    text: null as SelectionState | null,
    background: null as SelectionState | null
  }
  let dismissedSelectionKey: string | null = null
  let interactiveFocus = readInteractiveFocus(editorHost, dom.host, document.activeElement)
  let destroyed = false

  const unsubscribeEditor = editor.subscribe((event) => {
    if (destroyed) {
      return
    }

    if (event.kind === 'selectionChange') {
      interactiveFocus = readInteractiveFocus(editorHost, dom.host, document.activeElement)
      const currentKey = readSelectionKey(editor, event.selection)

      if (dismissedSelectionKey !== null && currentKey !== dismissedSelectionKey) {
        dismissedSelectionKey = null
      }

      render()
      return
    }

    if (event.kind === 'transaction') {
      interactiveFocus = readInteractiveFocus(editorHost, dom.host, document.activeElement)
      render()
      return
    }

    if (event.kind === 'destroyed') {
      stableContextSelection.selection = null
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

    renderSelectionActionsDom(dom, buildSelectionActionsViewState({
      editor,
      editorHost,
      interactiveFocus,
      dismissedSelectionKey,
      contextSelection: stableContextSelection.selection,
      contextPoint: stableContextSelection.point
    }))
  }

  /** 同步当前 document.activeElement 是否仍在 editor 交互范围内。 */
  function updateInteractiveFocus(): void {
    if (destroyed) {
      return
    }

    interactiveFocus = readInteractiveFocus(editorHost, dom.host, document.activeElement)

    if (!interactiveFocus) {
      stableContextSelection.point = null
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

  /** 读取当前选区快照，并确保是有效非折叠文本选区。 */
  function readActiveSelectionSnapshot(): SelectionState | null {
    const selection = cloneSelection(editor.getSelection())

    return hasActiveTextSelection(selection) ? selection : null
  }

  /** 统一执行基于选区快照的 facade command。 */
  function executeSelectionCommand(selection: SelectionState | null, command: Command | null): boolean {
    if (selection === null || command === null) {
      return false
    }

    editor.executeCommand(command, {
      selectionAfter: selection
    })

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

    if (!executeSelectionCommand(selection, command)) {
      announce('BLOCKED: 当前选区未生成可执行的格式命令。')
      return
    }

    dismissedSelectionKey = null
    stableContextSelection.point = null
    restoreEditorFocusSoon()
  }

  /** 把冻结选区上的颜色写回 editor facade。 */
  function applyColorFormat(
    selection: SelectionState | null,
    kind: 'text' | 'background',
    rawValue: string
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

    const command = kind === 'text'
      ? buildSetTextColorCommand(editor.getProjection(), selection, value)
      : buildSetBackgroundColorCommand(editor.getProjection(), selection, value)

    if (!executeSelectionCommand(selection, command)) {
      announce('BLOCKED: 当前颜色更新未生成可执行命令。')
      return
    }

    dismissedSelectionKey = null
    stableContextSelection.point = null
    restoreEditorFocusSoon()
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

    dom.formatControls.textColor.addEventListener('click', () => {
      frozenColorSelections.text = readActiveSelectionSnapshot()
    }, { signal: signalController.signal })
    dom.formatControls.backgroundColor.addEventListener('click', () => {
      frozenColorSelections.background = readActiveSelectionSnapshot()
    }, { signal: signalController.signal })
    dom.formatControls.textColor.addEventListener('change', () => {
      applyColorFormat(frozenColorSelections.text, 'text', dom.formatControls.textColor.value)
    }, { signal: signalController.signal })
    dom.formatControls.backgroundColor.addEventListener('change', () => {
      applyColorFormat(frozenColorSelections.background, 'background', dom.formatControls.backgroundColor.value)
    }, { signal: signalController.signal })
  }

  /** 绑定右键菜单动作。 */
  function bindContextMenuActions(): void {
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
  }

  /** 绑定 editor 生命周期、右键菜单、局部快捷键与失焦收口逻辑。 */
  function bindLifecycleEvents(): void {
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
        stableContextSelection.point = null
        render()
      }
    }, { signal: signalController.signal })
    editorHost.addEventListener('contextmenu', (event) => {
      event.preventDefault()
      stableContextSelection.selection = cloneSelection(editor.getSelection())
      stableContextSelection.point = {
        left: event.clientX,
        top: event.clientY
      }
      dismissedSelectionKey = null
      interactiveFocus = true
      render()
    }, { signal: signalController.signal })
    editorHost.addEventListener('mousedown', () => {
      stableContextSelection.point = null
      render()
    }, { signal: signalController.signal })
    canvasContainer.addEventListener('scroll', () => {
      stableContextSelection.point = null
      render()
    }, { signal: signalController.signal })
    document.addEventListener('pointerdown', (event) => {
      if (!(event.target instanceof Node)) {
        return
      }

      if (editorHost.contains(event.target) || dom.host.contains(event.target)) {
        return
      }

      stableContextSelection.point = null
      interactiveFocus = false
      render()
    }, { signal: signalController.signal })
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
