/**
 * 职责：提供 selection-actions controller 所需的宿主元素定位、只读渲染与生命周期事件辅助。
 * 边界：不执行 editor command，不持有第二套 selection，只围绕 DOM 事件更新 controller 运行态。
 * 协作模块：selection-actions/controller 装配入口、selection-actions/dom DOM 句柄。
 * 性能/安全约束：查询范围限定在 editorHost 内，不持有第二套文档状态。
 * Specs：docs/superpowers/reports/2026-07-03-remediation-execution-supplement.md#310-phase-5-超大文件拆分目标结构。
 */
import type { Editor, SelectionState } from '@4xian/jword-core'
import { cloneSelection } from '../toolbar/state'
import { writeActiveColorReturnedToEditor } from './commands'
import { readSelectionKey } from './state'
import type { SelectionActionsDom, SelectionActionsInsertController, SelectionActionsRuntimeState } from './types'

/** selection-actions 生命周期事件绑定上下文。 */
export interface SelectionActionsLifecycleContext {
  readonly editor: Editor
  readonly editorHost: HTMLElement
  readonly hiddenTextarea: HTMLTextAreaElement
  readonly canvasContainer: HTMLElement
  readonly dom: SelectionActionsDom
  readonly state: SelectionActionsRuntimeState
  readonly signal: AbortSignal
  readonly insertActions: SelectionActionsInsertController | undefined
  readonly updateInteractiveFocus: () => void
  readonly clearStickyFloatingToolbar: () => void
  readonly dismissFloatingToolbarForCurrentSelection: () => void
  readonly onUnderlineShortcut: () => void
  readonly render: () => void
}

/** 读取 editor mount 后的隐藏输入框。 */
export function requireHiddenTextarea(editorHost: HTMLElement): HTMLTextAreaElement {
  const textarea = editorHost.querySelector('[data-jword-hidden-textarea]')

  if (!(textarea instanceof HTMLTextAreaElement)) {
    throw new Error('selection-actions 需要已挂载的 hidden textarea。')
  }

  return textarea
}

/** 读取 editor mount 后的 canvas 容器。 */
export function requireCanvasContainer(editorHost: HTMLElement): HTMLElement {
  const container = editorHost.querySelector('[data-jword-canvas-container]')

  if (!(container instanceof HTMLElement)) {
    throw new Error('selection-actions 需要已挂载的 canvas container。')
  }

  return container
}

/** 读取 editor.mount 创建的内部定位宿主。 */
export function resolveEditorShell(editorHost: HTMLElement): HTMLElement {
  if (editorHost.matches('[data-jword-editor]')) {
    return editorHost
  }

  return editorHost.querySelector<HTMLElement>('[data-jword-editor]') ?? editorHost
}

/** 只读模式下只渲染最小状态。 */
export function renderReadonlySelectionActionsState(dom: SelectionActionsDom): void {
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

/** 判断事件目标是否来自正文链接 overlay。 */
export function isLinkOverlayTarget(target: Node): boolean {
  return target instanceof Element
    && target.closest('[data-jword-link-target-index]') !== null
}

/** 绑定 editor 生命周期、右键菜单、局部快捷键与失焦收口逻辑。 */
export function bindSelectionActionsLifecycleEvents(context: SelectionActionsLifecycleContext): void {
  context.hiddenTextarea.addEventListener('focus', () => {
    queueMicrotask(context.updateInteractiveFocus)
  }, { signal: context.signal })
  context.hiddenTextarea.addEventListener('blur', () => {
    queueMicrotask(context.updateInteractiveFocus)
  }, { signal: context.signal })
  context.dom.host.addEventListener('focusin', () => {
    queueMicrotask(context.updateInteractiveFocus)
  }, { signal: context.signal })
  context.dom.host.addEventListener('focusout', () => {
    queueMicrotask(context.updateInteractiveFocus)
  }, { signal: context.signal })
  bindSelectionActionsKeyboardEvents(context)
  bindSelectionActionsPointerEvents(context)
}

/** 绑定隐藏输入框上的局部快捷键。 */
function bindSelectionActionsKeyboardEvents(context: SelectionActionsLifecycleContext): void {
  context.hiddenTextarea.addEventListener('keydown', (event) => {
    const lowerKey = event.key.toLowerCase()
    const usesCommandModifier = event.metaKey || event.ctrlKey

    if (usesCommandModifier && lowerKey === 'u') {
      event.preventDefault()
      context.onUnderlineShortcut()
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      context.state.dismissedSelectionKey = readSelectionKey(context.editor, context.editor.getSelection())
      context.state.openColorPicker = null
      context.clearStickyFloatingToolbar()
      context.state.stableContextSelection.point = null
      context.state.stableContextSelection.linkSelection = null
      context.render()
    }
  }, { signal: context.signal })
}

/** 绑定右键、编辑器鼠标、滚动和外部点击事件。 */
function bindSelectionActionsPointerEvents(context: SelectionActionsLifecycleContext): void {
  context.editorHost.addEventListener('contextmenu', (event) => {
    event.preventDefault()
    context.state.openColorPicker = null
    context.clearStickyFloatingToolbar()
    const linkSelection = readContextLinkSelection(context, event)

    context.state.stableContextSelection.selection = linkSelection ?? cloneSelection(context.editor.getSelection())
    context.state.stableContextSelection.linkSelection = linkSelection
    context.state.stableContextSelection.point = {
      left: event.clientX,
      top: event.clientY
    }
    context.state.dismissedSelectionKey = null
    context.state.interactiveFocus = true
    context.render()
  }, { signal: context.signal })
  context.editorHost.addEventListener('mousedown', (event) => {
    if (!(event.target instanceof Node)) {
      return
    }

    if (isLinkOverlayTarget(event.target) && restoreDismissedLinkToolbar(context)) {
      return
    }

    if (!context.dom.host.contains(event.target)) {
      if (context.state.openColorPicker !== null) {
        writeActiveColorReturnedToEditor(context.state, context.state.openColorPicker, true)
      }
      context.dismissFloatingToolbarForCurrentSelection()
    }

    context.state.stableContextSelection.point = null
    context.state.stableContextSelection.linkSelection = null
    context.render()
  }, { signal: context.signal })
  context.canvasContainer.addEventListener('scroll', () => {
    context.state.stableContextSelection.point = null
    context.state.stableContextSelection.linkSelection = null
    context.render()
  }, { signal: context.signal })
  document.addEventListener('pointerdown', (event) => {
    if (!(event.target instanceof Node)) {
      return
    }

    if (context.editorHost.contains(event.target) || context.dom.host.contains(event.target)) {
      return
    }

    context.state.openColorPicker = null
    context.clearStickyFloatingToolbar()
    context.state.stableContextSelection.point = null
    context.state.stableContextSelection.linkSelection = null
    context.state.interactiveFocus = false
    context.render()
  }, { signal: context.signal })
}

/** 读取本次右键菜单可执行链接动作的选区，避免沿用旧链接状态。 */
function readContextLinkSelection(
  context: SelectionActionsLifecycleContext,
  event: MouseEvent
): SelectionState | null {
  const targetSelection = event.target instanceof Element
    ? cloneSelection(context.insertActions?.readLinkSelectionFromTarget?.(event.target) ?? null)
    : null

  if (targetSelection !== null) {
    return targetSelection
  }

  const selection = cloneSelection(context.editor.getSelection())

  if (context.insertActions?.hasLink?.(selection) === true) {
    return selection
  }

  return null
}

/** 再次点击已收起的链接选区时恢复浮动工具栏显示资格。 */
function restoreDismissedLinkToolbar(context: SelectionActionsLifecycleContext): boolean {
  const selection = context.editor.getSelection()
  const currentSelectionKey = readSelectionKey(context.editor, selection)

  if (
    context.state.dismissedSelectionKey === null
    || currentSelectionKey.length === 0
    || context.state.dismissedSelectionKey !== currentSelectionKey
    || context.insertActions?.hasLink?.(selection) !== true
  ) {
    return false
  }

  context.state.dismissedSelectionKey = null
  context.state.openColorPicker = null
  context.clearStickyFloatingToolbar()
  context.state.stableContextSelection.point = null
  context.state.stableContextSelection.linkSelection = null
  context.state.interactiveFocus = true
  context.render()

  return true
}

/** 统一阻止鼠标按下默认行为，避免 editor hidden textarea 失焦。 */
export function preventDefaultEvent(event: Event): void {
  event.preventDefault()
}
