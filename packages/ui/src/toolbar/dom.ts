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
  isToolbarPlaceholderSelectValue,
  TOOLBAR_SELECT_MIXED_VALUE,
  type BuiltinToolDefinition,
  type ToolbarMenuLayout,
  type ToolbarOption
} from './builtin-tools'
import type { ResolvedToolbarConfig } from './config'
import { createToolbarIcon, type ToolbarIconName } from './icons'
import type { ToolbarState } from './state'
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

interface ToolbarPanelRenderState {
  readonly headingOutline?: boolean
  readonly headingOutlineAvailable?: boolean
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
export function renderToolbarState(
  dom: ToolbarDom,
  state: ToolbarState,
  activeColorPicker: 'textColor' | 'backgroundColor' | null = null,
  activePanels: ToolbarPanelRenderState = {}
): void {
  setActionButtonState(dom.controls['history.undo'], state.canUndo)
  setActionButtonState(dom.controls['history.redo'], state.canRedo)
  setSelectState(dom.controls['document.pagePreset'], false, state.pagePresetValue, 'value')
  setActionButtonState(dom.controls['document.findReplace'], true)
  setToggleButtonState(
    dom.controls['document.headingOutline'],
    activePanels.headingOutlineAvailable === true,
    activePanels.headingOutlineAvailable === true && activePanels.headingOutline === true ? 'true' : 'false'
  )
  setActionButtonState(dom.controls['document.headerFooter'], true)
  setActionButtonState(dom.controls['document.footer'], true)
  setActionButtonState(dom.controls['document.pageNumber'], true)
  setActionButtonState(dom.controls['document.revisions'], true)
  setToggleButtonState(dom.controls['format.bold'], state.runFormatEnabled, state.boldPressed)
  setToggleButtonState(dom.controls['format.italic'], state.runFormatEnabled, state.italicPressed)
  setToggleButtonState(dom.controls['format.underline'], state.runFormatEnabled, state.underlinePressed)
  setToggleButtonState(dom.controls['format.strike'], state.runFormatEnabled, state.strikePressed)
  setToggleButtonState(dom.controls['format.superscript'], state.runFormatEnabled, state.superscriptPressed)
  setToggleButtonState(dom.controls['format.subscript'], state.runFormatEnabled, state.subscriptPressed)
  setSelectState(dom.controls['format.fontFamily'], !state.runFormatEnabled, state.fontFamilyValue, state.fontFamilyState)
  setSelectState(dom.controls['format.fontSize'], !state.runFormatEnabled, state.fontSizeValue, state.fontSizeState)
  setActionButtonState(dom.controls['format.fontSizeDecrease'], state.runFormatEnabled)
  setActionButtonState(dom.controls['format.fontSizeIncrease'], state.runFormatEnabled)
  setColorState(
    dom.controls['format.textColor'],
    !state.runFormatEnabled,
    state.textColorValue,
    state.textColorState,
    activeColorPicker === 'textColor'
  )
  setColorState(
    dom.controls['format.backgroundColor'],
    !state.runFormatEnabled,
    state.backgroundColorValue,
    state.backgroundColorState,
    activeColorPicker === 'backgroundColor'
  )
  setSelectState(dom.controls['paragraph.alignment'], !state.paragraphFormatEnabled, state.paragraphAlignmentValue, state.paragraphAlignmentState)
  setActionButtonState(dom.controls['paragraph.indentDecrease'], state.paragraphFormatEnabled)
  setActionButtonState(dom.controls['paragraph.indentIncrease'], state.paragraphFormatEnabled)
  setSelectState(dom.controls['paragraph.indentLeft'], !state.paragraphFormatEnabled, state.paragraphIndentLeftValue, state.paragraphIndentLeftState)
  setSelectState(dom.controls['paragraph.lineHeight'], !state.paragraphFormatEnabled, state.paragraphLineHeightValue, state.paragraphLineHeightState)
  setSelectState(dom.controls['paragraph.spacingBefore'], !state.paragraphFormatEnabled, state.paragraphSpacingBeforeValue, state.paragraphSpacingBeforeState)
  setSelectState(dom.controls['paragraph.spacingAfter'], !state.paragraphFormatEnabled, state.paragraphSpacingAfterValue, state.paragraphSpacingAfterState)
  setSelectState(dom.controls['paragraph.firstLineIndent'], !state.paragraphFormatEnabled, state.paragraphFirstLineIndentValue, state.paragraphFirstLineIndentState)
  setSelectState(dom.controls['paragraph.hangingIndent'], !state.paragraphFormatEnabled, state.paragraphHangingIndentValue, state.paragraphHangingIndentState)
  setSelectState(dom.controls['paragraph.style'], !state.paragraphFormatEnabled, state.paragraphStyleValue, state.paragraphStyleState)
  setSelectState(dom.controls['paragraph.list'], !state.paragraphFormatEnabled, state.paragraphListValue, state.paragraphListState)

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
      const { wrapper, control } = createToolbarSelectControl(definition)

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
  button.setAttribute('data-jword-tooltip-surface', 'true')
  button.setAttribute('aria-label', definition.label)
  button.setAttribute(definition.dataAttribute, 'true')

  if (definition.icon !== undefined) {
    button.append(createToolbarIcon(definition.icon))
  }

  if (readButtonNeedsCaret(definition.id)) {
    const arrow = document.createElement('span')

    arrow.className = 'jw-toolbar__button-caret'
    arrow.append(createToolbarIcon('caretDown'))
    button.append(arrow)
  }

  bindToolbarPointerFocusGuard(button)

  return button
}

/** 判断按钮是否需要显示下拉箭头。 */
function readButtonNeedsCaret(toolId: JWordToolbarToolId): boolean {
  return toolId === 'document.findReplace'
    || toolId === 'document.headerFooter'
    || toolId === 'document.footer'
    || toolId === 'document.pageNumber'
}

/** 创建 select 控件包装。 */
function createToolbarSelectControl(
  definition: BuiltinToolDefinition
): { readonly wrapper: HTMLElement, readonly control: HTMLSelectElement, readonly destroy: () => void } {
  const options = definition.options ?? []
  const ariaLabel = definition.label
  const fieldLabel = definition.fieldLabel ?? definition.label
  const triggerVariant = definition.triggerVariant ?? 'plain'
  const menuLayout = resolveToolbarSelectMenuLayout(definition, options)
  const menuTextAlign = definition.menuTextAlign ?? 'start'
  const wrapper = document.createElement('div')
  const trigger = document.createElement('button')
  const triggerIcon = document.createElement('span')
  const triggerPrefix = document.createElement('span')
  const triggerLabel = document.createElement('span')
  const triggerArrow = document.createElement('span')
  const menu = document.createElement('div')
  const select = document.createElement('select')
  const signalController = new AbortController()

  wrapper.className = 'jw-toolbar__select-wrap'
  wrapper.setAttribute('data-jword-field-label', fieldLabel)
  wrapper.setAttribute('data-jword-trigger-variant', triggerVariant)
  wrapper.setAttribute('data-jword-menu-layout', menuLayout)
  wrapper.setAttribute('data-jword-menu-text-align', menuTextAlign)
  if (definition.triggerIcon !== undefined) {
    wrapper.setAttribute('data-jword-trigger-icon', definition.triggerIcon)
  }
  applyToolbarSelectSizing(wrapper, definition)
  trigger.className = 'jw-toolbar__select-trigger'
  trigger.type = 'button'
  trigger.setAttribute('data-jword-tooltip-surface', 'true')
  trigger.setAttribute('aria-haspopup', 'listbox')
  trigger.setAttribute('aria-expanded', 'false')
  trigger.setAttribute('aria-label', ariaLabel)
  triggerIcon.className = 'jw-toolbar__select-trigger-icon'
  triggerPrefix.className = 'jw-toolbar__select-prefix'
  triggerPrefix.textContent = `${fieldLabel}：`
  triggerLabel.className = 'jw-toolbar__select-label'
  triggerArrow.className = 'jw-toolbar__select-arrow'
  triggerArrow.append(createToolbarIcon('caretDown'))
  menu.className = 'jw-toolbar__select-menu'
  menu.setAttribute('data-jword-tooltip-skip', 'true')
  menu.hidden = true
  select.className = 'jw-toolbar__select'
  select.setAttribute('aria-label', ariaLabel)

  for (const option of options) {
    const node = document.createElement('option')

    node.value = option.value
    node.textContent = option.label

    if (
      option.value === FONT_FAMILY_MIXED_VALUE
      || option.value === FONT_SIZE_MIXED_VALUE
      || option.value === TOOLBAR_SELECT_MIXED_VALUE
    ) {
      node.disabled = true
    }

    select.append(node)

    if (
      node.disabled
      || option.value === FONT_FAMILY_EMPTY_VALUE
      || option.value === FONT_SIZE_EMPTY_VALUE
      || isToolbarPlaceholderSelectValue(option.value)
    ) {
      continue
    }

    const optionButton = document.createElement('button')
    const optionLabel = document.createElement('span')
    const optionCheck = document.createElement('span')

    optionButton.type = 'button'
    optionButton.className = 'jw-toolbar__select-option'
    optionLabel.className = 'jw-toolbar__select-option-label'
    optionLabel.textContent = option.label
    optionCheck.className = 'jw-toolbar__select-option-check'
    optionCheck.setAttribute('data-jword-option-check', 'true')
    optionCheck.append(createToolbarIcon('check'))
    optionButton.setAttribute('data-jword-option-value', option.value)
    if (option.icon !== undefined) {
      optionButton.setAttribute('data-jword-option-icon', option.icon)
    }
    bindToolbarPointerFocusGuard(optionButton, signalController.signal)
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

    if (menuLayout === 'icon') {
      const optionIcon = document.createElement('span')

      optionIcon.className = 'jw-toolbar__select-option-icon'

      if (option.icon !== undefined) {
        optionIcon.append(createToolbarIcon(option.icon))
      } else {
        optionIcon.hidden = true
      }

      optionButton.append(optionIcon, optionLabel, optionCheck)
    } else {
      optionButton.append(optionLabel, optionCheck)
    }

    menu.append(optionButton)
  }

  if (triggerVariant === 'plain') {
    trigger.append(triggerPrefix)
  }

  trigger.append(triggerIcon, triggerLabel, triggerArrow)
  wrapper.append(trigger, menu, select)
  bindToolbarPointerFocusGuard(trigger, signalController.signal)

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
    'click',
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
  const arrow = document.createElement('span')
  const input = document.createElement('input')

  input.type = 'color'
  input.className = 'jw-toolbar__color'
  input.setAttribute('aria-label', ariaLabel)
  wrapper.className = 'jw-toolbar__color-wrap'
  wrapper.setAttribute('data-jword-tooltip-surface', 'true')
  visual.className = 'jw-toolbar__color-visual'
  indicator.className = 'jw-toolbar__color-indicator'
  arrow.className = 'jw-toolbar__color-arrow'
  arrow.append(createToolbarIcon('caretDown'))

  if (iconName !== undefined) {
    visual.append(createToolbarIcon(iconName))
  }

  visual.append(indicator)
  wrapper.append(visual, arrow, input)

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
  syncToolbarSelectRuntimeOption(control)
  const wrapper = control.parentElement
  const triggerLabel = wrapper?.querySelector<HTMLElement>('.jw-toolbar__select-label')
  const triggerIcon = wrapper?.querySelector<HTMLElement>('.jw-toolbar__select-trigger-icon')
  const selectedOption = control.selectedOptions.item(0)
  const value = selectedOption?.value ?? control.value
  const label = selectedOption?.label ?? selectedOption?.textContent ?? control.value
  let selectedIconName = wrapper?.getAttribute('data-jword-trigger-icon') ?? undefined

  if (triggerLabel !== null && triggerLabel !== undefined) {
    triggerLabel.textContent = label
  }

  for (const optionButton of wrapper?.querySelectorAll<HTMLElement>('.jw-toolbar__select-option') ?? []) {
    const isSelected = optionButton.getAttribute('data-jword-option-value') === value

    optionButton.setAttribute(
      'data-jword-selected',
      isSelected ? 'true' : 'false'
    )

    if (isSelected) {
      selectedIconName = optionButton.getAttribute('data-jword-option-icon') ?? selectedIconName
    }
  }

  if (triggerIcon !== null && triggerIcon !== undefined) {
    renderToolbarSelectTriggerIcon(triggerIcon, selectedIconName)
  }
}

/** 为当前值补一个运行时 option，保证未静态声明的字体/字号也能显示出来。 */
function syncToolbarSelectRuntimeOption(control: HTMLSelectElement): void {
  const wrapper = control.parentElement
  const menu = wrapper?.querySelector<HTMLElement>('.jw-toolbar__select-menu')
  const runtimeOption = control.querySelector<HTMLOptionElement>('option[data-jword-runtime-option="true"]')
  const runtimeButton = menu?.querySelector<HTMLElement>('[data-jword-runtime-option="true"]')
  const value = control.getAttribute('data-jword-render-value') ?? control.value
  const hasStaticOption = [...control.options].some((option) =>
    option.getAttribute('data-jword-runtime-option') !== 'true' && option.value === value
  )

  runtimeOption?.remove()
  runtimeButton?.remove()

  if (
    !(wrapper instanceof HTMLElement)
    || !(menu instanceof HTMLElement)
    || value.length === 0
    || isToolbarPlaceholderSelectValue(value)
    || hasStaticOption
  ) {
    return
  }

  const label = readToolbarRuntimeOptionLabel(control, value)
  const option = document.createElement('option')
  const button = document.createElement('button')
  const buttonLabel = document.createElement('span')
  const buttonCheck = document.createElement('span')
  const trigger = wrapper.querySelector<HTMLButtonElement>('.jw-toolbar__select-trigger')

  option.value = value
  option.textContent = label
  option.setAttribute('data-jword-runtime-option', 'true')
  control.append(option)
  control.value = value

  button.type = 'button'
  button.className = 'jw-toolbar__select-option'
  button.setAttribute('data-jword-option-value', value)
  button.setAttribute('data-jword-runtime-option', 'true')
  buttonLabel.className = 'jw-toolbar__select-option-label'
  buttonLabel.textContent = label
  buttonCheck.className = 'jw-toolbar__select-option-check'
  buttonCheck.setAttribute('data-jword-option-check', 'true')
  buttonCheck.append(createToolbarIcon('check'))
  button.append(buttonLabel, buttonCheck)
  bindToolbarPointerFocusGuard(button)
  button.addEventListener('click', () => {
    if (trigger !== null) {
      closeToolbarSelect(wrapper, trigger, menu)
    }
  })
  menu.prepend(button)
}

/** 把运行时值格式化成 toolbar 可读标签。 */
function readToolbarRuntimeOptionLabel(control: HTMLSelectElement, value: string): string {
  const toolId = control.parentElement?.getAttribute('data-jword-tool-id')

  if (toolId === 'format.fontSize') {
    const twips = Number.parseFloat(value)

    if (Number.isFinite(twips)) {
      return `${formatToolbarPointValue(twips / 20)} pt`
    }
  }

  return value
}

/** 规范化 pt 文案，避免出现多余的尾随 0。 */
function formatToolbarPointValue(value: number): string {
  if (Number.isInteger(value)) {
    return String(value)
  }

  return value.toFixed(2).replace(/\.?0+$/, '')
}

/** 同步 select trigger 上的 SVG 图标。 */
function renderToolbarSelectTriggerIcon(target: HTMLElement, iconName: string | undefined): void {
  target.replaceChildren()

  if (iconName === undefined || iconName === '') {
    target.hidden = true
    return
  }

  target.hidden = false
  target.append(createToolbarIcon(iconName as ToolbarIconName))
}

/** 阻止 toolbar 按钮通过鼠标按下抢走 editor hidden textarea 的焦点。 */
function bindToolbarPointerFocusGuard(target: HTMLElement, signal?: AbortSignal): void {
  const listener = (event: Event) => {
    event.preventDefault()
  }
  const options = signal === undefined ? undefined : { signal }

  target.addEventListener('pointerdown', listener, options)
  target.addEventListener('mousedown', listener, options)
}

/** 推断当前 select 菜单项的布局模式。 */
function resolveToolbarSelectMenuLayout(
  definition: BuiltinToolDefinition,
  options: readonly ToolbarOption[]
): ToolbarMenuLayout {
  if (definition.menuLayout !== undefined) {
    return definition.menuLayout
  }

  return options.some((option) => option.icon !== undefined && !isToolbarPlaceholderSelectValue(option.value))
    ? 'icon'
    : 'text'
}

/** 把内建 select 的尺寸元数据映射成 CSS 变量。 */
function applyToolbarSelectSizing(wrapper: HTMLElement, definition: BuiltinToolDefinition): void {
  if (definition.triggerMinWidthPx !== undefined) {
    wrapper.style.setProperty('--jw-toolbar-trigger-min-width', `${definition.triggerMinWidthPx}px`)
  }

  if (definition.menuMinWidthPx !== undefined) {
    wrapper.style.setProperty('--jw-toolbar-select-menu-min-width', `${definition.menuMinWidthPx}px`)
  }

  if (definition.menuMaxWidthPx !== undefined) {
    wrapper.style.setProperty('--jw-toolbar-select-menu-max-width', `${definition.menuMaxWidthPx}px`)
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
  control.setAttribute('data-jword-render-value', value)
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
  state: string,
  preserveInputValue = false
): void {
  if (!(control instanceof HTMLInputElement)) {
    return
  }

  control.disabled = disabled
  if (!preserveInputValue) {
    control.value = value
  }
  control.setAttribute('data-jword-state', state)
  control.parentElement?.setAttribute('data-jword-state', state)
  control.parentElement?.setAttribute('data-jword-disabled', String(disabled))
  control.parentElement?.style.setProperty('--jw-toolbar-color', preserveInputValue ? control.value : value)
}
