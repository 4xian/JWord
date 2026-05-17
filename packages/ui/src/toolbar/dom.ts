/**
 * 职责：创建和渲染 UI 包官方 toolbar DOM，不承载 editor 命令语义。
 * 边界：只负责节点结构、data selector、tooltip 包裹和样式类名，不读取 projection。
 * 协作模块：controller 绑定事件，state 提供只读渲染状态，icons/tooltip 提供细粒度部件。
 * 性能/安全约束：保持 DOM 结构扁平稳定，延续 Gate 3 已验证的 selector 契约。
 * Specs：docs/superpowers/plans/2026-05-17-jword-ui-sdk-gate4-integration.md#phase-1---冻结当前可观察行为。
 */
import type { JWordToolbarControlElement, JWordToolbarElements, JWordToolbarToolId } from '../types'
import {
  FONT_FAMILY_EMPTY_VALUE,
  FONT_FAMILY_MIXED_VALUE,
  FONT_SIZE_EMPTY_VALUE,
  FONT_SIZE_MIXED_VALUE,
  getBuiltinToolDefinition,
  type BuiltinToolDefinition,
  type ToolbarOption
} from './builtin-tools'
import type { ResolvedToolbarConfig } from './config'
import { createToolbarIcon } from './icons'
import {
  readAlignmentPressedState,
  type ToolbarState
} from './state'
import { wrapWithTooltip } from './tooltip'

interface SummaryNodes {
  readonly selectionSummary: HTMLElement | null
  readonly runSummary: HTMLElement | null
  readonly blockedSummary: HTMLElement | null
}

interface ControlParts {
  readonly wrapper: HTMLElement
  readonly control: JWordToolbarControlElement
  readonly destroy?: () => void
}

/** toolbar DOM 结构。 */
export interface ToolbarDom extends JWordToolbarElements {
  readonly bar: HTMLElement
  readonly destroyParts: readonly (() => void)[]
  readonly groups: readonly HTMLElement[]
}

/** 创建 toolbar DOM。 */
export function createToolbarDom(host: HTMLElement, config: ResolvedToolbarConfig): ToolbarDom {
  host.replaceChildren()
  host.classList.add('jw-toolbar')
  host.setAttribute('data-jword-toolbar', 'true')
  host.setAttribute('aria-label', 'JWord toolbar')
  const bar = document.createElement('div')
  const controls: Partial<Record<JWordToolbarToolId, JWordToolbarControlElement>> = {}
  const destroyParts: Array<() => void> = []
  const groups: HTMLElement[] = []
  let previousGroupId: string | null = null

  bar.className = 'jw-toolbar__bar'
  host.append(bar)

  for (const toolId of config.toolIds) {
    const definition = getBuiltinToolDefinition(toolId)
    let group = groups.at(-1) ?? null

    if (group === null || previousGroupId !== definition.group) {
      group = createToolbarGroup(groups.length > 0)
      bar.append(group)
      groups.push(group)
      previousGroupId = definition.group
    }

    const control = createControl(definition)
    const { anchor } = wrapWithTooltip(control.wrapper, definition.tooltip)

    group.append(anchor)
    controls[toolId] = control.control
    if (control.destroy !== undefined) {
      destroyParts.push(control.destroy)
    }
  }

  const summaryNodes = config.showSummaries ? createSummaryNodes() : createEmptySummaries()

  if (config.showSummaries) {
    const summaryRow = createSummaryRow(summaryNodes)

    host.append(summaryRow)
  }

  return {
    host,
    bar,
    controls,
    destroyParts,
    groups,
    selectionSummary: summaryNodes.selectionSummary,
    runSummary: summaryNodes.runSummary,
    blockedSummary: summaryNodes.blockedSummary
  }
}

/** 根据最新状态重绘工具栏。 */
export function renderToolbarState(dom: ToolbarDom, state: ToolbarState): void {
  setActionButtonState(dom.controls['history.undo'], state.canUndo)
  setActionButtonState(dom.controls['history.redo'], state.canRedo)
  setSelectState(dom.controls['document.pagePreset'], false, state.pagePresetValue, 'value')
  setToggleButtonState(dom.controls['format.bold'], state.runFormatEnabled, state.boldPressed)
  setToggleButtonState(dom.controls['format.italic'], state.runFormatEnabled, state.italicPressed)
  setToggleButtonState(dom.controls['format.underline'], state.runFormatEnabled, state.underlinePressed)
  setToggleButtonState(dom.controls['format.strike'], state.runFormatEnabled, state.strikePressed)
  setSelectState(dom.controls['format.fontFamily'], !state.runFormatEnabled, state.fontFamilyValue, state.fontFamilyState)
  setSelectState(dom.controls['format.fontSize'], !state.runFormatEnabled, state.fontSizeValue, state.fontSizeState)
  setColorState(dom.controls['format.textColor'], !state.runFormatEnabled, state.textColorValue, state.textColorState)
  setColorState(dom.controls['format.backgroundColor'], !state.runFormatEnabled, state.backgroundColorValue, state.backgroundColorState)
  setAlignButtonState(dom.controls['paragraph.alignLeft'], state, 'left')
  setAlignButtonState(dom.controls['paragraph.alignCenter'], state, 'center')
  setAlignButtonState(dom.controls['paragraph.alignRight'], state, 'right')
  setAlignButtonState(dom.controls['paragraph.alignJustify'], state, 'justify')
  setActionButtonState(dom.controls['paragraph.indentDecrease'], state.paragraphFormatEnabled)
  setActionButtonState(dom.controls['paragraph.indentIncrease'], state.paragraphFormatEnabled)

  if (dom.selectionSummary !== null) {
    dom.selectionSummary.textContent = state.selectionSummary
  }

  if (dom.runSummary !== null) {
    dom.runSummary.textContent = state.runSummary
  }

  if (dom.blockedSummary !== null) {
    dom.blockedSummary.textContent = state.blockedSummary
  }
}

/** 销毁 toolbar DOM。 */
export function destroyToolbarDom(dom: ToolbarDom): void {
  for (const destroy of dom.destroyParts) {
    destroy()
  }

  dom.host.replaceChildren()
  dom.host.removeAttribute('data-jword-toolbar')
  dom.host.removeAttribute('aria-label')
  dom.host.classList.remove('jw-toolbar')
}

/** 创建单个分组容器。 */
function createToolbarGroup(separated: boolean): HTMLElement {
  const group = document.createElement('div')

  group.className = separated
    ? 'jw-toolbar__group jw-toolbar__group--separated'
    : 'jw-toolbar__group'

  return group
}

/** 创建单个工具对应的控件包装。 */
function createControl(definition: BuiltinToolDefinition): ControlParts {
  switch (definition.kind) {
    case 'button': {
      const button = createToolbarButton(definition)

      button.setAttribute('data-jword-tool-id', definition.id)

      return {
        wrapper: button,
        control: button
      }
    }
    case 'select': {
      const { wrapper, control } = createToolbarSelectControl(definition.options ?? [], definition.label)

      wrapper.setAttribute('data-jword-tool-id', definition.id)
      control.setAttribute(definition.dataAttribute, 'true')

      return { wrapper, control }
    }
    case 'color': {
      const { wrapper, control } = createToolbarColorControl(definition.label, definition.icon)

      wrapper.setAttribute('data-jword-tool-id', definition.id)
      control.setAttribute(definition.dataAttribute, 'true')

      return { wrapper, control }
    }
  }
}

/** 创建按钮控件。 */
function createToolbarButton(definition: BuiltinToolDefinition): HTMLButtonElement {
  const button = document.createElement('button')

  button.type = 'button'
  button.className = 'jw-toolbar__button'
  button.setAttribute('aria-label', definition.label)
  button.setAttribute(definition.dataAttribute, 'true')

  if (definition.icon !== undefined) {
    button.append(createToolbarIcon(definition.icon))
  }

  return button
}

/** 创建 select 控件包装。 */
function createToolbarSelectControl(
  options: readonly ToolbarOption[],
  ariaLabel: string
): { readonly wrapper: HTMLElement, readonly control: HTMLSelectElement, readonly destroy: () => void } {
  const wrapper = document.createElement('div')
  const trigger = document.createElement('button')
  const triggerLabel = document.createElement('span')
  const menu = document.createElement('div')
  const select = document.createElement('select')
  const signalController = new AbortController()

  wrapper.className = 'jw-toolbar__select-wrap'
  trigger.className = 'jw-toolbar__select-trigger'
  trigger.type = 'button'
  trigger.setAttribute('aria-haspopup', 'listbox')
  trigger.setAttribute('aria-expanded', 'false')
  trigger.setAttribute('aria-label', ariaLabel)
  triggerLabel.className = 'jw-toolbar__select-label'
  menu.className = 'jw-toolbar__select-menu'
  menu.hidden = true
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

    if (node.disabled || option.value === FONT_FAMILY_EMPTY_VALUE || option.value === FONT_SIZE_EMPTY_VALUE) {
      continue
    }

    const optionButton = document.createElement('button')

    optionButton.type = 'button'
    optionButton.className = 'jw-toolbar__select-option'
    optionButton.textContent = option.label
    optionButton.setAttribute('data-jword-option-value', option.value)
    optionButton.addEventListener(
      'click',
      () => {
        if (select.disabled || select.value === option.value) {
          closeToolbarSelect(wrapper, trigger, menu)
          return
        }

        select.value = option.value
        syncToolbarSelectVisual(select)
        select.dispatchEvent(new Event('change', { bubbles: true }))
        closeToolbarSelect(wrapper, trigger, menu)
      },
      { signal: signalController.signal }
    )
    menu.append(optionButton)
  }

  trigger.append(triggerLabel)
  wrapper.append(trigger, menu, select)

  trigger.addEventListener(
    'click',
    () => {
      if (select.disabled) {
        return
      }

      if (wrapper.getAttribute('data-jword-open') === 'true') {
        closeToolbarSelect(wrapper, trigger, menu)
        return
      }

      openToolbarSelect(wrapper, trigger, menu)
    },
    { signal: signalController.signal }
  )

  document.addEventListener(
    'pointerdown',
    (event) => {
      if (!(event.target instanceof Node) || wrapper.contains(event.target)) {
        return
      }

      closeToolbarSelect(wrapper, trigger, menu)
    },
    { signal: signalController.signal }
  )

  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key !== 'Escape') {
        return
      }

      closeToolbarSelect(wrapper, trigger, menu)
    },
    { signal: signalController.signal }
  )

  select.addEventListener(
    'change',
    () => {
      syncToolbarSelectVisual(select)
    },
    { signal: signalController.signal }
  )
  syncToolbarSelectVisual(select)

  return {
    wrapper,
    control: select,
    destroy: () => {
      signalController.abort()
    }
  }
}

/** 创建颜色控件包装。 */
function createToolbarColorControl(
  ariaLabel: string,
  iconName: BuiltinToolDefinition['icon']
): { readonly wrapper: HTMLElement, readonly control: HTMLInputElement } {
  const wrapper = document.createElement('label')
  const visual = document.createElement('span')
  const indicator = document.createElement('span')
  const input = document.createElement('input')

  input.type = 'color'
  input.className = 'jw-toolbar__color'
  input.setAttribute('aria-label', ariaLabel)
  wrapper.className = 'jw-toolbar__color-wrap'
  visual.className = 'jw-toolbar__color-visual'
  indicator.className = 'jw-toolbar__color-indicator'

  if (iconName !== undefined) {
    visual.append(createToolbarIcon(iconName))
  }

  visual.append(indicator)
  wrapper.append(visual, input)

  return {
    wrapper,
    control: input
  }
}

/** 打开自绘下拉。 */
function openToolbarSelect(wrapper: HTMLElement, trigger: HTMLButtonElement, menu: HTMLElement): void {
  wrapper.setAttribute('data-jword-open', 'true')
  trigger.setAttribute('aria-expanded', 'true')
  menu.hidden = false
}

/** 关闭自绘下拉。 */
function closeToolbarSelect(wrapper: HTMLElement, trigger: HTMLButtonElement, menu: HTMLElement): void {
  wrapper.setAttribute('data-jword-open', 'false')
  trigger.setAttribute('aria-expanded', 'false')
  menu.hidden = true
}

/** 同步自绘下拉的触发器文案与选中态。 */
function syncToolbarSelectVisual(control: HTMLSelectElement): void {
  const wrapper = control.parentElement
  const triggerLabel = wrapper?.querySelector<HTMLElement>('.jw-toolbar__select-label')
  const selectedOption = control.selectedOptions.item(0)
  const value = selectedOption?.value ?? control.value
  const label = selectedOption?.label ?? selectedOption?.textContent ?? control.value

  if (triggerLabel !== null && triggerLabel !== undefined) {
    triggerLabel.textContent = label
  }

  for (const optionButton of wrapper?.querySelectorAll<HTMLElement>('.jw-toolbar__select-option') ?? []) {
    optionButton.setAttribute(
      'data-jword-selected',
      optionButton.getAttribute('data-jword-option-value') === value ? 'true' : 'false'
    )
  }
}

/** 创建 summary 区域节点。 */
function createSummaryNodes(): SummaryNodes {
  const selectionSummary = document.createElement('span')
  const runSummary = document.createElement('span')
  const blockedSummary = document.createElement('span')

  selectionSummary.className = 'jw-toolbar__meta'
  selectionSummary.setAttribute('data-jword-selection-summary', 'true')
  selectionSummary.setAttribute('aria-label', '当前选区状态')
  runSummary.className = 'jw-toolbar__meta'
  runSummary.setAttribute('data-jword-run-summary', 'true')
  runSummary.setAttribute('aria-label', '当前格式状态')
  blockedSummary.className = 'jw-toolbar__note'
  blockedSummary.setAttribute('data-jword-blocked-summary', 'true')
  blockedSummary.setAttribute('aria-label', '当前阻塞提示')

  return {
    selectionSummary,
    runSummary,
    blockedSummary
  }
}

/** 创建关闭 summary 时的空节点占位。 */
function createEmptySummaries(): SummaryNodes {
  return {
    selectionSummary: null,
    runSummary: null,
    blockedSummary: null
  }
}

/** 创建 summary 行。 */
function createSummaryRow(nodes: SummaryNodes): HTMLElement {
  const row = document.createElement('div')

  row.className = 'jw-toolbar__summary'

  if (nodes.selectionSummary !== null) {
    row.append(nodes.selectionSummary)
  }

  if (nodes.runSummary !== null) {
    row.append(nodes.runSummary)
  }

  if (nodes.blockedSummary !== null) {
    row.append(nodes.blockedSummary)
  }

  return row
}

/** 设置动作按钮状态。 */
function setActionButtonState(
  control: JWordToolbarControlElement | undefined,
  enabled: boolean
): void {
  if (!(control instanceof HTMLButtonElement)) {
    return
  }

  control.disabled = !enabled
  control.removeAttribute('aria-pressed')
}

/** 设置 toggle 按钮状态。 */
function setToggleButtonState(
  control: JWordToolbarControlElement | undefined,
  enabled: boolean,
  pressed: 'true' | 'false' | 'mixed'
): void {
  if (!(control instanceof HTMLButtonElement)) {
    return
  }

  control.disabled = !enabled
  control.setAttribute('aria-pressed', pressed)
}

/** 设置 select 状态。 */
function setSelectState(
  control: JWordToolbarControlElement | undefined,
  disabled: boolean,
  value: string,
  state: string
): void {
  if (!(control instanceof HTMLSelectElement)) {
    return
  }

  control.disabled = disabled
  control.value = value
  control.setAttribute('data-jword-state', state)
  control.parentElement?.setAttribute('data-jword-state', state)
  control.parentElement?.setAttribute('data-jword-disabled', String(disabled))
  const trigger = control.parentElement?.querySelector<HTMLButtonElement>('.jw-toolbar__select-trigger')
  if (trigger !== null && trigger !== undefined) {
    trigger.disabled = disabled
  }
  syncToolbarSelectVisual(control)
}

/** 设置颜色控件状态。 */
function setColorState(
  control: JWordToolbarControlElement | undefined,
  disabled: boolean,
  value: string,
  state: string
): void {
  if (!(control instanceof HTMLInputElement)) {
    return
  }

  control.disabled = disabled
  control.value = value
  control.setAttribute('data-jword-state', state)
  control.parentElement?.setAttribute('data-jword-state', state)
  control.parentElement?.setAttribute('data-jword-disabled', String(disabled))
  control.parentElement?.style.setProperty('--jw-toolbar-color', value)
}

/** 设置对齐按钮状态。 */
function setAlignButtonState(
  control: JWordToolbarControlElement | undefined,
  state: ToolbarState,
  alignment: 'left' | 'center' | 'right' | 'justify'
): void {
  if (!(control instanceof HTMLButtonElement)) {
    return
  }

  control.disabled = !state.paragraphFormatEnabled
  control.setAttribute('aria-pressed', readAlignmentPressedState(state, alignment))
  control.setAttribute('data-jword-state', state.alignmentState)
}
