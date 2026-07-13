/**
 * 职责：驱动 Gate 4 选区浮动工具栏、右键菜单与局部快捷键，复用现有 editor facade 命令语义。
 * 边界：不修改 core command builder 本体，不实现图片模块，也不持有第二套文档状态。
 * 协作模块：create-ui 负责装配，selection-actions/dom 负责节点结构，selection-actions/state 负责只读状态。
 * 性能/安全约束：所有动作继续走 facade/transaction pipeline，右键菜单只绑定稳定选区快照，不沿用旧状态。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import type { SelectionState } from '@4xian/jword-core'
import { resolveJWordUiI18n } from '../i18n'
import { bindContextMenuActions, bindToolbarActions, cloneActiveSelection, toggleRunFormat } from './commands'
import type { SelectionActionCommandContext, SelectionActionsBindingContext } from './commands'
import type { SelectionActionsClipboardContext } from './clipboard'
import { createSelectionActionsDom, destroySelectionActionsDom, localizeSelectionActionsDom, renderSelectionActionsDom } from './dom'
import { bindSelectionActionsLifecycleEvents, preventDefaultEvent, renderReadonlySelectionActionsState, requireCanvasContainer, requireHiddenTextarea, resolveEditorShell } from './geometry'
import { buildSelectionActionsViewState, hasActiveTextSelection, readFloatingToolbarPosition, readInteractiveFocus, readSelectionKey } from './state'
import type { CreateSelectionActionsControllerOptions, SelectionActionColorKind, SelectionActionsControllerHandle, SelectionActionsRuntimeState } from './types'

/** 创建 Gate 4 选区浮层 controller。 */
export function createSelectionActionsController(
  options: CreateSelectionActionsControllerOptions
): SelectionActionsControllerHandle {
  const editor = options.editor
  const editorHost = options.editorHost
  const colorFormat = options.colorFormat
  const insertActions = options.insertActions
  let i18n = options.i18n ?? resolveJWordUiI18n()
  const hiddenTextarea = requireHiddenTextarea(editorHost)
  const canvasContainer = requireCanvasContainer(editorHost)
  const overlayHost = resolveEditorShell(editorHost)
  const dom = createSelectionActionsDom(overlayHost, i18n)
  const signalController = new AbortController()
  const liveRegion = options.assistive.liveRegion
  const readonlyMode = options.readonly === true || (typeof options.readonly === 'object' && options.readonly.enabled === true)
  const state: SelectionActionsRuntimeState = {
    stableContextSelection: {
      selection: null,
      linkSelection: null,
      point: null
    },
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
    dismissedSelectionKey: null,
    stickyFloatingSelectionKey: null,
    stickyFloatingPosition: null,
    openColorPicker: null,
    interactiveFocus: false,
    destroyed: false
  }
  const commandContext: SelectionActionCommandContext = {
    editor,
    colorFormat,
    readI18n() {
      return i18n
    },
    announce,
    readActiveSelectionSnapshot,
    readFrozenColorSelection,
    writeFrozenColorSelection,
    writeActiveColorValue,
    freezeFloatingToolbarForSelection,
    keepFloatingToolbarVisible,
    keepFloatingToolbarAtStickyPosition,
    restoreEditorFocusSoon,
    closeColorPicker,
    clearStableContextPoint,
    resetDismissedSelection
  }
  const clipboardContext: SelectionActionsClipboardContext = {
    editor,
    hiddenTextarea,
    readI18n() {
      return i18n
    },
    announce,
    clearStableContextPoint,
    restoreEditorFocusSoon
  }
  const bindingContext: SelectionActionsBindingContext = {
    dom,
    state,
    signal: signalController.signal,
    insertActions,
    commandContext,
    clipboardContext,
    announce,
    render,
    bindButton
  }

  state.interactiveFocus = readEffectiveInteractiveFocus()

  const unsubscribeEditor = editor.subscribe((event) => {
    if (state.destroyed) {
      return
    }

    if (event.kind === 'selectionChange') {
      state.interactiveFocus = readEffectiveInteractiveFocus()
      const currentKey = readSelectionKey(editor, event.selection)

      if (state.dismissedSelectionKey !== null && currentKey !== state.dismissedSelectionKey) {
        state.dismissedSelectionKey = null
      }

      if (state.stickyFloatingSelectionKey !== null && currentKey !== state.stickyFloatingSelectionKey) {
        clearStickyFloatingToolbar()
      }

      render()
      return
    }

    if (event.kind === 'transaction') {
      state.interactiveFocus = readEffectiveInteractiveFocus()
      render()
      return
    }

    if (event.kind === 'destroyed') {
      state.stableContextSelection.selection = null
      state.stableContextSelection.linkSelection = null
      state.stableContextSelection.point = null
      destroyController()
    }
  })

  if (!readonlyMode) {
    bindToolbarActions(bindingContext)
    bindContextMenuActions(bindingContext)
  }
  bindLifecycleEvents()
  render()

  /** 用当前 editor 与弹层状态刷新 DOM。 */
  function render(): void {
    if (state.destroyed) {
      return
    }

    if (readonlyMode) {
      renderReadonlyState()
      return
    }

    const colorSelection = state.openColorPicker === null ? null : readFrozenColorSelection(state.openColorPicker)

    renderSelectionActionsDom(dom, buildSelectionActionsViewState({
      editor,
      editorHost: overlayHost,
      interactiveFocus: state.interactiveFocus,
      dismissedSelectionKey: state.dismissedSelectionKey,
      contextSelection: state.stableContextSelection.selection,
      contextLinkSelection: state.stableContextSelection.linkSelection,
      contextPoint: state.stableContextSelection.point,
      colorSelection,
      activeColorPicker: state.openColorPicker,
      stickyFloatingToolbar: {
        selectionKey: state.stickyFloatingSelectionKey,
        position: state.stickyFloatingPosition
      },
      hasLink: (selection) => insertActions?.hasLink?.(selection) ?? false,
      readLinkUrl: (selection) => insertActions?.readLinkUrl?.(selection) ?? null
    }))
  }

  /** 只读模式下只渲染最小状态。 */
  function renderReadonlyState(): void {
    renderReadonlySelectionActionsState(dom)
  }

  /** 同步当前 document.activeElement 是否仍在 editor 交互范围内。 */
  function updateInteractiveFocus(): void {
    if (state.destroyed) {
      return
    }

    state.interactiveFocus = readEffectiveInteractiveFocus()

    if (!state.interactiveFocus) {
      state.stableContextSelection.point = null
      state.stableContextSelection.linkSelection = null
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
      if (state.destroyed) {
        return
      }

      editor.focus()
      updateInteractiveFocus()
    })
  }

  /** 读取当前是否仍应维持选区浮层交互态。 */
  function readEffectiveInteractiveFocus(): boolean {
    return state.openColorPicker !== null
      || state.stickyFloatingSelectionKey !== null
      || readInteractiveFocus(editorHost, dom.host, document.activeElement)
  }

  /** 清空当前浮动工具栏冻结锚点。 */
  function clearStickyFloatingToolbar(): void {
    state.stickyFloatingSelectionKey = null
    state.stickyFloatingPosition = null
  }

  /** 为当前选区冻结浮动工具栏锚点，避免首次格式改动后位置漂移。 */
  function freezeFloatingToolbarForSelection(selection: SelectionState | null): void {
    if (selection === null) {
      clearStickyFloatingToolbar()
      return
    }

    state.stickyFloatingSelectionKey = readSelectionKey(editor, selection)
    state.stickyFloatingPosition = readFloatingToolbarPosition(editor, editorHost, selection)
  }

  /** 在工具栏交互后继续保持当前选区的工具栏可见。 */
  function keepFloatingToolbarVisible(selection: SelectionState | null): void {
    freezeFloatingToolbarForSelection(selection)
    state.dismissedSelectionKey = null
    state.interactiveFocus = true
    render()
  }

  /** 在颜色预览后沿用已冻结位置，只把锚点同步到命令后的当前选区。 */
  function keepFloatingToolbarAtStickyPosition(selection: SelectionState | null): void {
    if (state.stickyFloatingPosition === null) {
      freezeFloatingToolbarForSelection(selection)
    } else {
      const currentSelectionKey = readSelectionKey(editor, editor.getSelection())

      state.stickyFloatingSelectionKey = currentSelectionKey.length > 0
        ? currentSelectionKey
        : readSelectionKey(editor, selection)
    }

    state.dismissedSelectionKey = null
    state.interactiveFocus = true
    render()
  }

  /** 回到编辑器主交互区时收起当前选区的浮动工具栏。 */
  function dismissFloatingToolbarForCurrentSelection(): void {
    const selection = editor.getSelection()

    if (hasActiveTextSelection(selection)) {
      state.dismissedSelectionKey = readSelectionKey(editor, selection)
    }

    state.openColorPicker = null
    clearStickyFloatingToolbar()
    render()
  }

  /** 读取当前选区快照，并确保是有效非折叠文本选区。 */
  function readActiveSelectionSnapshot(): SelectionState | null {
    return cloneActiveSelection(editor, hasActiveTextSelection)
  }

  /** 读取当前颜色控件已冻结的选区。 */
  function readFrozenColorSelection(kind: 'text' | 'background'): SelectionState | null {
    return kind === 'text' ? state.frozenColorSelections.text : state.frozenColorSelections.background
  }

  /** 写入当前颜色控件已冻结的选区。 */
  function writeFrozenColorSelection(kind: 'text' | 'background', selection: SelectionState | null): void {
    if (kind === 'text') {
      state.frozenColorSelections.text = selection
      return
    }

    state.frozenColorSelections.background = selection
  }

  /** 关闭指定颜色 picker。 */
  function closeColorPicker(kind: SelectionActionColorKind): void {
    if (state.openColorPicker === kind) {
      state.openColorPicker = null
    }
  }

  /** 清除当前稳定右键菜单锚点。 */
  function clearStableContextPoint(): void {
    state.stableContextSelection.point = null
  }

  /** 清除当前选区浮层抑制标记。 */
  function resetDismissedSelection(): void {
    state.dismissedSelectionKey = null
  }

  /** 写入当前颜色 picker 会话中的最后有效颜色。 */
  function writeActiveColorValue(kind: SelectionActionColorKind, value: string): void {
    if (kind === 'text') {
      state.activeColorValues.text = value
      return
    }

    state.activeColorValues.background = value
  }

  /** 绑定 editor 生命周期、右键菜单、局部快捷键与失焦收口逻辑。 */
  function bindLifecycleEvents(): void {
    if (readonlyMode) {
      return
    }

    bindSelectionActionsLifecycleEvents({
      editor,
      editorHost,
      hiddenTextarea,
      canvasContainer,
      dom,
      state,
      signal: signalController.signal,
      insertActions,
      updateInteractiveFocus,
      clearStickyFloatingToolbar,
      dismissFloatingToolbarForCurrentSelection,
      onUnderlineShortcut(): void {
        toggleRunFormat(commandContext, readActiveSelectionSnapshot(), 'underline')
      },
      render
    })
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
    if (state.destroyed) {
      return
    }

    state.destroyed = true
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
    setI18n(nextI18n): void {
      i18n = nextI18n
      localizeSelectionActionsDom(dom, i18n)
      render()
    },
    refresh(): void {
      render()
    },
    destroy: destroyController
  }
}
