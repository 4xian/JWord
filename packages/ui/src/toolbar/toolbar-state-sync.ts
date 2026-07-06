/**
 * 职责：封装 toolbar 渲染、只读禁用态和 assistive 同步。
 * 边界：不绑定具体按钮业务动作，不创建 toolbar DOM。
 * 协作模块：controller 提供生命周期，format/paragraph/insert/panel 控件模块复用这里的绑定上下文。
 * 性能/安全约束：只读 editor facade 与现有 DOM 控件，不保存第二套编辑状态。
 * Specs：docs/superpowers/reports/2026-07-03-remediation-execution-supplement.md#310-phase-5-超大文件拆分目标结构。
 */

import type { Editor } from '@4xian/jword-core'
import type {
  JWordReadonlyMode,
  JWordToolbarControlElement,
  JWordToolbarToolId
} from '../types'
import type { LiveRegionController } from '../assistive/live-region'
import type { TextMirrorController } from '../assistive/text-mirror'
import type { ToolbarDom } from './dom'
import { renderToolbarState } from './dom'
import { buildToolbarState } from './state'
import { BUILTIN_TOOL_IDS } from './builtin-tools'

export interface ToolbarControllerAssistive {
  readonly liveRegion: LiveRegionController
  readonly textMirror: TextMirrorController | null
}

export type ToolbarReadonlyMode = Readonly<{
  enabled: boolean
  allowNavigation: boolean
}>

export interface ToolbarActionContext {
  readonly dom: ToolbarDom
  readonly editor: Editor
  readonly readonlyMode: ToolbarReadonlyMode
  readonly signal: AbortSignal
  announce(message: string, refreshMirror?: boolean): void
  render(): void
  markToolbarTransaction(): void
  restoreEditorFocusSoon(): void
  closeActiveColorPicker(): void
}

interface CreateToolbarStateSyncOptions {
  readonly dom: ToolbarDom
  readonly editor: Editor
  readonly assistive: ToolbarControllerAssistive
  readonly readonlyMode: ToolbarReadonlyMode
  readHeadingOutlineAvailable(): boolean
  readHeadingOutlineActive(): boolean
  readActiveColorPicker(): 'textColor' | 'backgroundColor' | null
}

export interface ToolbarStateSyncHandle {
  render(): void
  syncTextMirror(immediate?: boolean): void
  announce(message: string, refreshMirror?: boolean): void
  destroyAssistive(): void
}

/** 创建 toolbar 状态同步器。 */
export function createToolbarStateSync(options: CreateToolbarStateSyncOptions): ToolbarStateSyncHandle {
  const { assistive, dom, editor, readonlyMode } = options

  /** 只重绘 toolbar，不触发额外 assistive 副作用。 */
  function render(): void {
    if (readonlyMode.enabled) {
      renderToolbarState(dom, buildToolbarState(editor), null, {
        headingOutline: false,
        headingOutlineAvailable: readonlyMode.allowNavigation && options.readHeadingOutlineAvailable()
      })

      disableReadonlyToolbarControls(dom, readonlyMode)
      return
    }

    renderToolbarState(dom, buildToolbarState(editor), options.readActiveColorPicker(), {
      headingOutline: options.readHeadingOutlineActive(),
      headingOutlineAvailable: options.readHeadingOutlineAvailable()
    })
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

  return {
    render,
    syncTextMirror,
    announce,
    destroyAssistive() {
      assistive.liveRegion.destroy()
      assistive.textMirror?.destroy()
    }
  }
}

/** 规范化只读配置。 */
export function normalizeReadonlyMode(readonly: JWordReadonlyMode): ToolbarReadonlyMode {
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

/** 在 toolbar 按钮上绑定点击并按需恢复编辑器焦点。 */
export function bindToolbarButton(
  context: ToolbarActionContext,
  control: JWordToolbarControlElement | undefined,
  handler: (control: HTMLButtonElement) => void,
  focusOptions: { readonly restoreEditorFocus?: boolean } = {}
): void {
  if (!(control instanceof HTMLButtonElement)) {
    return
  }

  bindButton(control, () => {
    handler(control)
    if (focusOptions.restoreEditorFocus !== false) {
      context.restoreEditorFocusSoon()
    }
  }, context.signal)
}

/** 在 toolbar select 上绑定 change 并恢复编辑器焦点。 */
export function bindToolbarSelect(
  context: ToolbarActionContext,
  control: JWordToolbarControlElement | undefined,
  handler: () => void
): void {
  bindSelect(control, () => {
    context.closeActiveColorPicker()
    handler()
    context.restoreEditorFocusSoon()
  }, context.signal)
}

/** 在颜色控件上绑定打开 picker 前后的关键事件。 */
export function bindColorClick(
  control: JWordToolbarControlElement | undefined,
  handler: () => void,
  signal: AbortSignal
): void {
  if (!(control instanceof HTMLInputElement)) {
    return
  }

  control.addEventListener('pointerdown', handler, { signal })
  control.addEventListener('mousedown', handler, { signal })
  control.addEventListener('click', handler, { signal })
}

/** 在颜色控件上绑定即时 input 与最终 change 事件。 */
export function bindColorInput(
  control: JWordToolbarControlElement | undefined,
  handler: (event: Event) => void,
  signal: AbortSignal
): void {
  if (!(control instanceof HTMLInputElement)) {
    return
  }

  control.addEventListener('input', handler, { signal })
  control.addEventListener('change', handler, { signal })
}

/** 安全读取 select 控件。 */
export function readSelect(control: JWordToolbarControlElement | undefined): HTMLSelectElement | null {
  return control instanceof HTMLSelectElement ? control : null
}

/** 安全读取颜色控件。 */
export function readColor(control: JWordToolbarControlElement | undefined): HTMLInputElement | null {
  return control instanceof HTMLInputElement ? control : null
}

/** 从 toolbar select 中安全读取数字值。 */
export function readNumericToolbarSelectValue(control: JWordToolbarControlElement | undefined): number | null {
  const select = readSelect(control)

  if (select === null || isPlaceholderSelectValue(select.value)) {
    return null
  }

  const value = Number.parseFloat(select.value)

  return Number.isFinite(value) ? value : null
}

/** 只读模式下禁用编辑入口。 */
function disableReadonlyToolbarControls(dom: ToolbarDom, readonlyMode: ToolbarReadonlyMode): void {
  for (const toolId of BUILTIN_TOOL_IDS) {
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

/** 在按钮上绑定点击事件。 */
function bindButton(
  control: JWordToolbarControlElement | undefined,
  handler: () => void,
  signal: AbortSignal
): void {
  if (!(control instanceof HTMLButtonElement)) {
    return
  }

  control.addEventListener('click', handler, { signal })
}

/** 在 select 上绑定 change 事件。 */
function bindSelect(
  control: JWordToolbarControlElement | undefined,
  handler: () => void,
  signal: AbortSignal
): void {
  if (!(control instanceof HTMLSelectElement)) {
    return
  }

  control.addEventListener('change', handler, { signal })
}

/** 判断 toolbar select 是否是占位值，避免和 builtin-tools 形成循环依赖。 */
function isPlaceholderSelectValue(value: string): boolean {
  return value.startsWith('__jword_') && value.endsWith('__')
}
