/**
 * 职责：统一管理 UI SDK 全局只读模式下的 DOM 输入阻断和入口禁用。
 * 边界：只在 UI 装配层处理 DOM 事件和控件状态，不改 core transaction pipeline。
 * 协作模块：create-ui 与各 UI controller 通过 canEdit/blockEdit 协作。
 * 性能/安全约束：只绑定固定输入类事件，销毁时恢复本模块写入的 DOM 状态。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import type {
  JWordReadonlyOptions,
  JWordToolbarControlElement,
  JWordToolbarToolId,
  JWordUiLiveRegionController
} from '../types'

export interface JWordInteractionGuard {
  readonly readonly: boolean
  canEdit(): boolean
  blockEdit(message?: string): false
  destroy(): void
}

export interface CreateJWordInteractionGuardOptions {
  readonly editorHost: HTMLElement
  readonly toolbarHost: HTMLElement
  readonly controls: Partial<Record<JWordToolbarToolId, JWordToolbarControlElement>>
  readonly readonly: JWordReadonlyOptions
  readonly assistive: {
    readonly liveRegion: JWordUiLiveRegionController | null
  }
}

const BLOCKED_EDIT_EVENTS = [
  'beforeinput',
  'input',
  'paste',
  'cut',
  'drop',
  'keydown',
  'contextmenu',
  'dblclick'
] as const

const DEFAULT_READONLY_MESSAGE = '当前为只读模式。'

/** 创建 UI 全局只读交互 guard。 */
export function createJWordInteractionGuard(options: CreateJWordInteractionGuardOptions): JWordInteractionGuard {
  const enabled = options.readonly.enabled === true
  const hideToolbar = options.readonly.hideToolbar !== false
  const signalController = new AbortController()
  const hiddenTextarea = options.editorHost.querySelector<HTMLTextAreaElement>('[data-jword-hidden-textarea]')
  const previousTextareaReadOnly = hiddenTextarea?.readOnly ?? false
  const previousToolbarHidden = options.toolbarHost.hidden
  const previousControlDisabled = new Map<JWordToolbarControlElement, boolean>()

  if (enabled) {
    applyReadonlyState(options, hiddenTextarea, previousControlDisabled, hideToolbar)
    bindReadonlyEvents(options, signalController)
  }

  return {
    readonly: enabled,
    canEdit(): boolean {
      return !enabled
    },
    blockEdit(message = DEFAULT_READONLY_MESSAGE): false {
      if (enabled) {
        options.assistive.liveRegion?.announce(message, { force: true })
      }

      return false
    },
    destroy(): void {
      signalController.abort()

      if (!enabled) {
        return
      }

      options.editorHost.removeAttribute('data-jword-readonly')
      options.toolbarHost.hidden = previousToolbarHidden

      if (hiddenTextarea !== null && hiddenTextarea !== undefined) {
        hiddenTextarea.readOnly = previousTextareaReadOnly
        hiddenTextarea.removeAttribute('aria-readonly')
      }

      for (const [control, disabled] of previousControlDisabled) {
        control.disabled = disabled
      }
    }
  }
}

/** 应用只读 DOM 状态。 */
function applyReadonlyState(
  options: CreateJWordInteractionGuardOptions,
  hiddenTextarea: HTMLTextAreaElement | null,
  previousControlDisabled: Map<JWordToolbarControlElement, boolean>,
  hideToolbar: boolean
): void {
  options.editorHost.setAttribute('data-jword-readonly', 'true')

  if (hideToolbar) {
    options.toolbarHost.hidden = true
  }

  if (hiddenTextarea !== null) {
    hiddenTextarea.readOnly = true
    hiddenTextarea.setAttribute('aria-readonly', 'true')
  }

  disableToolbarControls(options.controls, options.readonly, previousControlDisabled)
}

/** 绑定只读模式需要阻断的输入事件。 */
function bindReadonlyEvents(
  options: CreateJWordInteractionGuardOptions,
  signalController: AbortController
): void {
  for (const type of BLOCKED_EDIT_EVENTS) {
    options.editorHost.addEventListener(type, (event) => {
      if (isReadonlyAllowedKeydown(event)) {
        return
      }

      preventReadonlyEdit(event, options.assistive.liveRegion)
    }, {
      capture: true,
      signal: signalController.signal
    })
  }
}

/** 判断只读模式下仍允许透传的复制快捷键。 */
function isReadonlyAllowedKeydown(event: Event): boolean {
  if (!(event instanceof KeyboardEvent)) {
    return false
  }

  if (isReadonlyNavigationKey(event.key)) {
    return true
  }

  if (!event.altKey && (event.ctrlKey || event.metaKey)) {
    return ['a', 'c', 'f', 'h'].includes(event.key.toLowerCase())
  }

  return false
}

/** 判断键盘事件是否只移动或扩展选区。 */
function isReadonlyNavigationKey(key: string): boolean {
  return key === 'ArrowLeft'
    || key === 'ArrowRight'
    || key === 'ArrowUp'
    || key === 'ArrowDown'
    || key === 'Home'
    || key === 'End'
    || key === 'PageUp'
    || key === 'PageDown'
    || key === 'Escape'
}

/** 阻止一次只读模式下的编辑事件。 */
function preventReadonlyEdit(event: Event, liveRegion: JWordUiLiveRegionController | null): void {
  event.preventDefault()
  event.stopImmediatePropagation()
  blurReadonlyActiveElement(event)
  liveRegion?.announce(DEFAULT_READONLY_MESSAGE, { force: true })
}

/** 移除只读编辑区内部焦点，避免 hidden textarea 继续显示编辑光标。 */
function blurReadonlyActiveElement(event: Event): void {
  const target = event.currentTarget

  if (!(target instanceof HTMLElement)) {
    return
  }

  const activeElement = target.ownerDocument.activeElement

  if (activeElement instanceof HTMLElement && target.contains(activeElement)) {
    activeElement.blur()
  }
}

/** 禁用 toolbar 控件并记录原始 disabled 状态。 */
function disableToolbarControls(
  controls: Partial<Record<JWordToolbarToolId, JWordToolbarControlElement>>,
  readonlyOptions: JWordReadonlyOptions,
  previousControlDisabled: Map<JWordToolbarControlElement, boolean>
): void {
  const allowNavigation = readonlyOptions.allowNavigation !== false

  for (const [toolId, control] of Object.entries(controls) as [JWordToolbarToolId, JWordToolbarControlElement | undefined][]) {
    if (control !== undefined) {
      if (allowNavigation && isReadonlyNavigationTool(toolId)) {
        continue
      }

      previousControlDisabled.set(control, control.disabled)
      control.disabled = true
    }
  }
}

/** 判断只读模式下仍可保留的导航入口。 */
function isReadonlyNavigationTool(toolId: JWordToolbarToolId): boolean {
  return toolId === 'document.findReplace' || toolId === 'document.headingOutline'
}
