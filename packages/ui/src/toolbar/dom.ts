/**
 * 职责：创建和渲染 UI 包官方 toolbar DOM，不承载 editor 命令语义。
 * 边界：只负责节点结构、data selector、tooltip 包裹和样式类名，不读取 projection。
 * 协作模块：controller 绑定事件，state 提供只读渲染状态，icons/tooltip 提供细粒度部件。
 * 性能/安全约束：保持 DOM 结构扁平稳定，延续 Gate 3 已验证的 selector 契约。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import {
  localizeToolbarDefinition,
  readJWordUiText,
  resolveJWordUiI18n,
  type ResolvedJWordUiI18n
} from '../i18n'
import type {
  JWordToolbarControlElement,
  JWordToolbarElements,
  JWordToolbarMode,
  JWordToolbarTabId,
  JWordToolbarToolId
} from '../types'
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

interface ControlParts {
  readonly wrapper: HTMLElement
  readonly control: JWordToolbarControlElement
  readonly destroy?: () => void
}

interface ToolbarPanelRenderState {
  readonly headingOutline?: boolean
  readonly headingOutlineAvailable?: boolean
}

interface ToolbarModePickerParts {
  readonly picker: HTMLElement
  readonly button: HTMLButtonElement
  readonly destroy: () => void
}

/** toolbar DOM 结构。 */
export interface ToolbarDom extends JWordToolbarElements {
  readonly bar: HTMLElement
  readonly tabs: readonly HTMLButtonElement[]
  readonly tabPanels: Readonly<Partial<Record<JWordToolbarTabId, HTMLElement>>>
  readonly tabPanelToolHosts: Readonly<Partial<Record<JWordToolbarTabId, HTMLElement>>>
  readonly extensionSlots: Readonly<Partial<Record<JWordToolbarTabId | 'common', HTMLElement>>>
  readonly commonPanel: HTMLElement
  readonly modeSwitcher: HTMLButtonElement | null
  readonly destroyParts: readonly (() => void)[]
  readonly groups: readonly HTMLElement[]
}

/** 创建 toolbar DOM。 */
export function createToolbarDom(
  host: HTMLElement,
  config: ResolvedToolbarConfig,
  i18n: ResolvedJWordUiI18n = resolveJWordUiI18n()
): ToolbarDom {
  host.replaceChildren()
  host.classList.add('jw-toolbar')
  host.setAttribute('data-jword-toolbar', 'true')
  host.setAttribute('data-jword-toolbar-mode', config.mode)
  host.setAttribute('data-jword-toolbar-active-tab', config.activeTab)
  host.setAttribute('data-jword-toolbar-common-extensions', String(config.commonExtensions))
  host.setAttribute('aria-label', readJWordUiText(i18n, 'toolbar.ariaLabel', 'JWord toolbar'))
  host.setAttribute('role', 'toolbar')
  host.setAttribute('lang', i18n.locale)
  if (i18n.dir !== undefined) {
    host.setAttribute('dir', i18n.dir)
  }
  const ownerDocument = host.ownerDocument
  const rovingTabindex = createToolbarRovingTabindex(ownerDocument)
  const bar = ownerDocument.createElement('div')
  const topRow = ownerDocument.createElement('div')
  const tabsContainer = ownerDocument.createElement('div')
  const controls: Partial<Record<JWordToolbarToolId, JWordToolbarControlElement>> = {}
  const destroyParts: Array<() => void> = []
  const groups: HTMLElement[] = []
  const toolAnchors: Partial<Record<JWordToolbarToolId, HTMLElement>> = {}
  const tabButtons: HTMLButtonElement[] = []
  const tabPanels: Partial<Record<JWordToolbarTabId, HTMLElement>> = {}
  const tabPanelToolHosts: Partial<Record<JWordToolbarTabId, HTMLElement>> = {}
  const extensionSlots: Partial<Record<JWordToolbarTabId | 'common', HTMLElement>> = {}
  const commonPanel = ownerDocument.createElement('div')
  const commonToolHost = createToolbarPanelToolHost(ownerDocument, 'common')
  const commonExtensionSlot = createToolbarExtensionSlot(ownerDocument, 'common')
  let currentMode: JWordToolbarMode = config.mode
  let activeTab: JWordToolbarTabId = config.activeTab
  const modePicker = config.modeSwitcher
    ? createToolbarModePicker(ownerDocument, currentMode, i18n)
    : null
  const modeSwitcher = modePicker?.button ?? null

  topRow.className = 'jw-toolbar__top-row'
  tabsContainer.className = 'jw-toolbar__tabs'
  tabsContainer.setAttribute('role', 'tablist')
  tabsContainer.setAttribute('aria-label', readJWordUiText(i18n, 'toolbar.tabs.ariaLabel', 'Toolbar tabs'))
  bar.className = 'jw-toolbar__bar'
  commonPanel.className = 'jw-toolbar__tabpanel jw-toolbar__tabpanel--common'
  commonPanel.setAttribute('data-jword-toolbar-common-panel', 'true')
  commonPanel.append(commonToolHost, commonExtensionSlot)
  extensionSlots.common = commonExtensionSlot

  for (const tab of config.tabs) {
    const button = createToolbarTabButton(ownerDocument, tab.id, i18n)
    const panel = ownerDocument.createElement('div')
    const panelToolHost = createToolbarPanelToolHost(ownerDocument, tab.id)
    const extensionSlot = createToolbarExtensionSlot(ownerDocument, tab.id)

    panel.className = 'jw-toolbar__tabpanel'
    panel.setAttribute('role', 'tabpanel')
    panel.setAttribute('data-jword-toolbar-tab-panel', tab.id)
    panel.hidden = true
    panel.append(panelToolHost, extensionSlot)
    button.addEventListener('click', () => {
      setActiveTab(tab.id, true)
    })
    tabsContainer.append(button)
    bar.append(panel)
    tabButtons.push(button)
    tabPanels[tab.id] = panel
    tabPanelToolHosts[tab.id] = panelToolHost
    extensionSlots[tab.id] = extensionSlot
  }

  if (modeSwitcher !== null) {
    modeSwitcher.addEventListener('click', () => {
      toggleToolbarModeMenu(modeSwitcher)
    })
  }
  modePicker?.picker.querySelector<HTMLButtonElement>('[data-jword-toolbar-mode-option="professional"]')?.addEventListener('click', () => {
    closeToolbarModeMenu(modeSwitcher)
    setMode('professional', true)
  })
  modePicker?.picker.querySelector<HTMLButtonElement>('[data-jword-toolbar-mode-option="common"]')?.addEventListener('click', () => {
    closeToolbarModeMenu(modeSwitcher)
    setMode('common', true)
  })

  if (config.mode === 'professional' || modeSwitcher !== null) {
    topRow.append(tabsContainer)
    host.append(topRow)
  }
  bar.append(commonPanel)
  host.append(bar)
  if (modePicker !== null) {
    host.append(modePicker.picker)
    destroyParts.push(modePicker.destroy)
  }

  for (const toolId of config.toolIds) {
    const definition = localizeToolbarDefinition(getBuiltinToolDefinition(toolId), i18n)
    const control = createControl(definition, ownerDocument)
    const { anchor, destroy } = wrapWithTooltip(control.wrapper, definition.tooltip)

    rovingTabindex.register(readToolbarFocusableElement(control.wrapper, control.control))
    toolAnchors[toolId] = anchor
    controls[toolId] = control.control
    destroyParts.push(destroy)
    if (control.destroy !== undefined) {
      destroyParts.push(control.destroy)
    }
  }

  renderCurrentToolbarLayout()

  return {
    host,
    bar,
    controls,
    pluginControls: {},
    tabs: tabButtons,
    tabPanels,
    tabPanelToolHosts,
    extensionSlots,
    commonPanel,
    modeSwitcher,
    destroyParts: [...destroyParts, rovingTabindex.destroy],
    groups
  }

  /** 切换 toolbar 展示模式，并同步模式切换按钮文案。 */
  function setMode(nextMode: JWordToolbarMode, dispatchEvent: boolean): void {
    if (currentMode === nextMode) {
      return
    }

    currentMode = nextMode
    host.setAttribute('data-jword-toolbar-mode', currentMode)
    syncToolbarModeSwitcher(modeSwitcher, currentMode)
    renderCurrentToolbarLayout()

    if (dispatchEvent) {
      dispatchToolbarCustomEvent(host, 'jword-toolbar-modechange', {
        mode: currentMode
      })
    }
  }

  /** 切换专业模式当前 Tab。 */
  function setActiveTab(nextTab: JWordToolbarTabId, dispatchEvent: boolean): void {
    if (activeTab === nextTab || tabPanels[nextTab] === undefined) {
      return
    }

    activeTab = nextTab
    host.setAttribute('data-jword-toolbar-active-tab', activeTab)
    renderCurrentToolbarLayout()

    if (dispatchEvent) {
      dispatchToolbarCustomEvent(host, 'jword-toolbar-tabchange', {
        tab: activeTab
      })
    }
  }

  /** 按当前模式重排唯一控件节点，避免专业和常用模式创建两套控件。 */
  function renderCurrentToolbarLayout(): void {
    groups.length = 0

    for (const tab of config.tabs) {
      const panel = tabPanels[tab.id]

      if (panel === undefined) {
        continue
      }

      const toolHost = tabPanelToolHosts[tab.id]

      toolHost?.replaceChildren()
      panel.hidden = currentMode !== 'professional' || tab.id !== activeTab
      if (currentMode === 'professional' && toolHost !== undefined) {
        renderToolbarToolGroups(toolHost, tab.toolIds)
      }
    }

    commonToolHost.replaceChildren()
    commonPanel.hidden = currentMode !== 'common'
    topRow.hidden = currentMode !== 'professional'
    if (currentMode === 'common') {
      renderToolbarToolGroups(commonToolHost, config.commonToolIds)
    }

    tabsContainer.hidden = currentMode !== 'professional'
    syncToolbarExtensionHostLayout()
    syncToolbarTabs(tabButtons, activeTab)
    rovingTabindex.syncVisible()
  }

  /** 在专业 / 常用模式之间移动扩展宿主，复用同一份 media/table controller DOM。 */
  function syncToolbarExtensionHostLayout(): void {
    const extensionHosts = host.querySelectorAll<HTMLElement>('[data-jword-toolbar-extension-tab]')

    for (const extensionHost of extensionHosts) {
      const targetTab = extensionHost.getAttribute('data-jword-toolbar-extension-tab') as JWordToolbarTabId | null
      const targetSlot = currentMode === 'common'
        && host.getAttribute('data-jword-toolbar-common-extensions') === 'true'
        && extensionHost.getAttribute('data-jword-toolbar-extension-common') === 'true'
        ? extensionSlots.common
        : targetTab === null
          ? undefined
          : extensionSlots[targetTab]

      if (targetSlot !== undefined && extensionHost.parentElement !== targetSlot) {
        targetSlot.append(extensionHost)
      }
    }
  }

  /** 按工具分组把控件挂到目标面板。 */
  function renderToolbarToolGroups(container: HTMLElement, toolIds: readonly JWordToolbarToolId[]): void {
    let previousGroupId: string | null = null
    let hasGroup = false

    for (const toolId of toolIds) {
      const anchor = toolAnchors[toolId]

      if (anchor === undefined) {
        continue
      }

      const definition = getBuiltinToolDefinition(toolId)
      let group = container.lastElementChild instanceof HTMLElement
        ? container.lastElementChild
        : null

      if (group === null || previousGroupId !== definition.group) {
        group = createToolbarGroup(ownerDocument, hasGroup)
        container.append(group)
        groups.push(group)
        previousGroupId = definition.group
        hasGroup = true
      }

      group.append(anchor)
    }
  }
}

/** 创建专业模式 Tab 按钮。 */
function createToolbarTabButton(
  ownerDocument: Document,
  tabId: JWordToolbarTabId,
  i18n: ResolvedJWordUiI18n
): HTMLButtonElement {
  const button = ownerDocument.createElement('button')

  button.type = 'button'
  button.className = 'jw-toolbar__tab'
  button.setAttribute('role', 'tab')
  button.setAttribute('data-jword-toolbar-tab', tabId)
  button.textContent = readToolbarTabLabel(i18n, tabId)

  return button
}

/** 创建专业 / 常用模式下拉切换器。 */
function createToolbarModePicker(
  ownerDocument: Document,
  mode: JWordToolbarMode,
  i18n: ResolvedJWordUiI18n
): ToolbarModePickerParts {
  const signalController = new (ownerDocument.defaultView?.AbortController ?? AbortController)()
  const picker = ownerDocument.createElement('div')
  const button = ownerDocument.createElement('button')
  const menu = ownerDocument.createElement('div')

  picker.className = 'jw-toolbar__mode-picker'
  picker.setAttribute('data-jword-toolbar-mode-picker', 'true')
  button.type = 'button'
  button.className = 'jw-toolbar__mode-switcher'
  button.setAttribute('data-jword-toolbar-mode-switcher', 'true')
  button.setAttribute('aria-haspopup', 'menu')
  button.setAttribute('aria-expanded', 'false')
  button.append(
    createToolbarModeIcon(ownerDocument, 'outline', 'jw-toolbar__mode-switcher-icon'),
    createToolbarTextNode(ownerDocument, 'span', 'jw-toolbar__mode-switcher-label'),
    createToolbarModeIcon(ownerDocument, 'caretDown', 'jw-toolbar__mode-switcher-arrow')
  )
  menu.className = 'jw-toolbar__mode-menu'
  menu.setAttribute('data-jword-toolbar-mode-menu', 'true')
  menu.setAttribute('role', 'menu')
  menu.hidden = true
  menu.append(
    createToolbarModeOption(ownerDocument, 'professional', 'layout'),
    createToolbarModeOption(ownerDocument, 'common', 'outline')
  )
  picker.append(button, menu)
  localizeToolbarModeSwitcher(button, mode, i18n)

  ownerDocument.addEventListener('pointerdown', (event) => {
    if (!(event.target instanceof Node) || picker.contains(event.target)) {
      return
    }

    closeToolbarModeMenu(button)
  }, { signal: signalController.signal })

  ownerDocument.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') {
      return
    }

    closeToolbarModeMenu(button)
  }, { signal: signalController.signal })

  return {
    picker,
    button,
    destroy() {
      signalController.abort()
    }
  }
}

/** 创建模式切换菜单内的单个选项。 */
function createToolbarModeOption(
  ownerDocument: Document,
  mode: JWordToolbarMode,
  icon: ToolbarIconName
): HTMLButtonElement {
  const option = ownerDocument.createElement('button')

  option.type = 'button'
  option.className = 'jw-toolbar__mode-option'
  option.setAttribute('role', 'menuitemradio')
  option.setAttribute('data-jword-toolbar-mode-option', mode)
  option.append(
    createToolbarModeIcon(ownerDocument, icon, 'jw-toolbar__mode-option-icon'),
    createToolbarTextNode(ownerDocument, 'span', 'jw-toolbar__mode-option-label'),
    createToolbarModeIcon(ownerDocument, 'check', 'jw-toolbar__mode-option-check')
  )

  return option
}

/** 创建模式切换器使用的图标容器。 */
function createToolbarModeIcon(ownerDocument: Document, icon: ToolbarIconName, className: string): HTMLElement {
  const node = ownerDocument.createElement('span')

  node.className = className
  node.setAttribute('aria-hidden', 'true')
  node.append(createToolbarIcon(icon))

  return node
}

/** 创建 toolbar 内部纯文本节点容器。 */
function createToolbarTextNode(ownerDocument: Document, tagName: 'span', className: string): HTMLElement {
  const node = ownerDocument.createElement(tagName)

  node.className = className

  return node
}

/** 创建 Tab 面板内承载内建工具的稳定容器。 */
function createToolbarPanelToolHost(ownerDocument: Document, panelId: JWordToolbarTabId | 'common'): HTMLElement {
  const host = ownerDocument.createElement('div')

  host.className = 'jw-toolbar__tabpanel-tools'
  host.setAttribute('data-jword-toolbar-tools-host', panelId)

  return host
}

/** 创建 Tab 面板内承载扩展工具的稳定槽位。 */
function createToolbarExtensionSlot(ownerDocument: Document, panelId: JWordToolbarTabId | 'common'): HTMLElement {
  const slot = ownerDocument.createElement('div')

  slot.className = 'jw-toolbar__tabpanel-extensions'
  slot.setAttribute('data-jword-toolbar-extension-slot', panelId)

  return slot
}

/** 刷新专业模式所有 Tab 的选中态。 */
function syncToolbarTabs(
  tabs: readonly HTMLButtonElement[],
  activeTab: JWordToolbarTabId
): void {
  for (const tab of tabs) {
    const selected = tab.getAttribute('data-jword-toolbar-tab') === activeTab

    tab.setAttribute('aria-selected', selected ? 'true' : 'false')
    tab.tabIndex = selected ? 0 : -1
  }
}

/** 读取专业模式 Tab 的当前语言文案。 */
function readToolbarTabLabel(i18n: ResolvedJWordUiI18n, tabId: JWordToolbarTabId): string {
  const fallback: Record<JWordToolbarTabId, string> = {
    home: '开始',
    insert: '插入',
    table: '表格',
    page: '页面',
    tools: '工具',
    view: '视图',
    export: '导出'
  }

  return readJWordUiText(i18n, `toolbar.tabs.${tabId}`, fallback[tabId])
}

/** 按当前语言刷新模式切换按钮的可见文案和可访问名称。 */
function localizeToolbarModeSwitcher(
  button: HTMLButtonElement | null,
  mode: JWordToolbarMode,
  i18n: ResolvedJWordUiI18n
): void {
  if (button === null) {
    return
  }

  button.dataset.jwordSwitcherLabel = readJWordUiText(i18n, 'toolbar.mode.switcherLabel', '切换工具栏')
  button.dataset.jwordCommonToolbarLabel = readJWordUiText(i18n, 'toolbar.mode.commonToolbar', '常用工具栏')
  button.dataset.jwordProfessionalToolbarLabel = readJWordUiText(i18n, 'toolbar.mode.professionalToolbar', '专业工具栏')
  syncToolbarModeSwitcher(button, mode)
}

/** 根据当前模式同步模式切换按钮和下拉菜单选中态。 */
function syncToolbarModeSwitcher(button: HTMLButtonElement | null, mode: JWordToolbarMode): void {
  if (button === null) {
    return
  }

  const switcherLabel = button.dataset.jwordSwitcherLabel ?? '切换工具栏'
  const picker = button.closest<HTMLElement>('[data-jword-toolbar-mode-picker="true"]')
  const label = button.querySelector<HTMLElement>('.jw-toolbar__mode-switcher-label')

  button.title = switcherLabel
  button.setAttribute('aria-label', switcherLabel)
  button.setAttribute('data-jword-toolbar-mode-switcher-current', mode)
  if (label !== null) {
    label.textContent = switcherLabel
  }

  syncToolbarModeOption(
    picker?.querySelector<HTMLButtonElement>('[data-jword-toolbar-mode-option="professional"]') ?? null,
    mode === 'professional',
    button.dataset.jwordProfessionalToolbarLabel ?? '专业工具栏'
  )
  syncToolbarModeOption(
    picker?.querySelector<HTMLButtonElement>('[data-jword-toolbar-mode-option="common"]') ?? null,
    mode === 'common',
    button.dataset.jwordCommonToolbarLabel ?? '常用工具栏'
  )
}

/** 同步模式菜单单个选项文案与选中态。 */
function syncToolbarModeOption(option: HTMLButtonElement | null, selected: boolean, label: string): void {
  if (option === null) {
    return
  }

  option.setAttribute('aria-checked', selected ? 'true' : 'false')
  option.setAttribute('data-jword-selected', selected ? 'true' : 'false')
  option.setAttribute('aria-label', label)
  option.title = label
  option.querySelector<HTMLElement>('.jw-toolbar__mode-option-label')?.replaceChildren(
    option.ownerDocument.createTextNode(label)
  )
}

/** 切换模式下拉菜单显隐。 */
function toggleToolbarModeMenu(button: HTMLButtonElement | null): void {
  if (button === null) {
    return
  }

  setToolbarModeMenuOpen(button, button.getAttribute('aria-expanded') !== 'true')
}

/** 关闭模式下拉菜单。 */
function closeToolbarModeMenu(button: HTMLButtonElement | null): void {
  setToolbarModeMenuOpen(button, false)
}

/** 写入模式下拉菜单显隐状态。 */
function setToolbarModeMenuOpen(button: HTMLButtonElement | null, open: boolean): void {
  if (button === null) {
    return
  }

  const picker = button.closest<HTMLElement>('[data-jword-toolbar-mode-picker="true"]')
  const menu = picker?.querySelector<HTMLElement>('[data-jword-toolbar-mode-menu="true"]')

  button.setAttribute('aria-expanded', open ? 'true' : 'false')
  picker?.setAttribute('data-jword-open', open ? 'true' : 'false')
  if (menu !== null && menu !== undefined) {
    menu.hidden = !open
  }
}

/** 派发 toolbar 内部布局切换事件，供 controller 播报。 */
function dispatchToolbarCustomEvent(
  host: HTMLElement,
  name: 'jword-toolbar-modechange' | 'jword-toolbar-tabchange',
  detail: Record<string, string>
): void {
  const CustomEventCtor = host.ownerDocument.defaultView?.CustomEvent ?? CustomEvent

  host.dispatchEvent(new CustomEventCtor(name, {
    bubbles: true,
    detail
  }))
}

/** 从 toolbar 宿主读取当前展示模式。 */
function readToolbarMode(host: HTMLElement): JWordToolbarMode {
  return host.getAttribute('data-jword-toolbar-mode') === 'common'
    ? 'common'
    : 'professional'
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
  setSelectState(dom.controls['document.pageOrientation'], false, state.pageOrientationValue, 'value')
  setActionButtonState(dom.controls['document.customPageSize'], true)
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
  setActionButtonState(dom.controls['view.fitWidth'], true)
  setActionButtonState(dom.controls['view.fitPage'], true)
  setActionButtonState(dom.controls['view.fullscreen'], true)
  setActionButtonState(dom.controls['view.presentation'], true)
  setActionButtonState(dom.controls['view.zoomReset'], true)
  setActionButtonState(dom.controls['export.native'], true)
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

}

/** 按新的 i18n 字典刷新 toolbar 可见文案，不重建 editor 或 controller。 */
export function localizeToolbarDom(
  dom: ToolbarDom,
  config: ResolvedToolbarConfig,
  i18n: ResolvedJWordUiI18n
): void {
  dom.host.setAttribute('aria-label', readJWordUiText(i18n, 'toolbar.ariaLabel', 'JWord toolbar'))
  dom.host.setAttribute('lang', i18n.locale)
  if (i18n.dir === undefined) {
    dom.host.removeAttribute('dir')
  } else {
    dom.host.setAttribute('dir', i18n.dir)
  }

  const tabsContainer = dom.host.querySelector<HTMLElement>('.jw-toolbar__tabs')

  tabsContainer?.setAttribute('aria-label', readJWordUiText(i18n, 'toolbar.tabs.ariaLabel', 'Toolbar tabs'))
  for (const tab of dom.tabs) {
    const tabId = tab.getAttribute('data-jword-toolbar-tab') as JWordToolbarTabId | null

    if (tabId !== null) {
      tab.textContent = readToolbarTabLabel(i18n, tabId)
    }
  }
  localizeToolbarModeSwitcher(dom.modeSwitcher, readToolbarMode(dom.host), i18n)

  for (const toolId of config.toolIds) {
    const control = dom.controls[toolId]

    if (control === undefined) {
      continue
    }

    localizeToolbarControl(
      control,
      localizeToolbarDefinition(getBuiltinToolDefinition(toolId), i18n)
    )
  }
}

/** 销毁 toolbar DOM。 */
export function destroyToolbarDom(dom: ToolbarDom): void {
  for (const destroy of dom.destroyParts) {
    destroy()
  }

  dom.host.replaceChildren()
  dom.host.removeAttribute('data-jword-toolbar')
  dom.host.removeAttribute('data-jword-toolbar-mode')
  dom.host.removeAttribute('data-jword-toolbar-active-tab')
  dom.host.removeAttribute('data-jword-toolbar-common-extensions')
  dom.host.removeAttribute('aria-label')
  dom.host.removeAttribute('role')
  dom.host.removeAttribute('lang')
  dom.host.removeAttribute('dir')
  dom.host.classList.remove('jw-toolbar')
}

/** 创建单个分组容器。 */
function createToolbarGroup(ownerDocument: Document, separated: boolean): HTMLElement {
  const group = ownerDocument.createElement('div')

  group.className = separated
    ? 'jw-toolbar__group jw-toolbar__group--separated'
    : 'jw-toolbar__group'

  return group
}

/** 刷新单个 toolbar 控件文案。 */
function localizeToolbarControl(
  control: JWordToolbarControlElement,
  definition: BuiltinToolDefinition
): void {
  if (control instanceof HTMLSelectElement) {
    localizeToolbarSelectControl(control, definition)
    return
  }

  control.setAttribute('aria-label', definition.label)
  control.querySelector<HTMLElement>('.jw-toolbar__button-label')?.replaceChildren(
    control.ownerDocument.createTextNode(definition.label)
  )
  updateToolbarTooltipText(control, definition.tooltip)
}

/** 刷新 toolbar select 的 trigger、option 和 tooltip 文案。 */
function localizeToolbarSelectControl(control: HTMLSelectElement, definition: BuiltinToolDefinition): void {
  const wrapper = control.parentElement

  if (!(wrapper instanceof HTMLElement)) {
    return
  }

  const fieldLabel = definition.fieldLabel ?? definition.label
  const trigger = wrapper.querySelector<HTMLButtonElement>('.jw-toolbar__select-trigger')
  const triggerPrefix = wrapper.querySelector<HTMLElement>('.jw-toolbar__select-prefix')
  const triggerFieldLabel = wrapper.querySelector<HTMLElement>('.jw-toolbar__select-field-label')
  const menu = wrapper.querySelector<HTMLElement>('.jw-toolbar__select-menu')

  wrapper.setAttribute('data-jword-field-label', fieldLabel)
  trigger?.setAttribute('aria-label', definition.label)
  control.setAttribute('aria-label', definition.label)
  menu?.setAttribute('aria-label', definition.label)
  if (triggerPrefix !== null) {
    triggerPrefix.textContent = `${fieldLabel}：`
  }
  if (triggerFieldLabel !== null) {
    triggerFieldLabel.textContent = fieldLabel
  }

  for (const option of definition.options ?? []) {
    localizeToolbarSelectOption(control, wrapper, option)
  }

  updateToolbarTooltipText(wrapper, definition.tooltip)
  syncToolbarSelectVisual(control)
}

/** 刷新单个 select option 和自绘菜单项文案。 */
function localizeToolbarSelectOption(
  control: HTMLSelectElement,
  wrapper: HTMLElement,
  option: ToolbarOption
): void {
  for (const node of [...control.options]) {
    if (node.value === option.value && node.getAttribute('data-jword-runtime-option') !== 'true') {
      node.textContent = option.label
    }
  }

  for (const button of wrapper.querySelectorAll<HTMLElement>('.jw-toolbar__select-option')) {
    if (
      button.getAttribute('data-jword-option-value') !== option.value
      || button.getAttribute('data-jword-runtime-option') === 'true'
    ) {
      continue
    }

    const label = button.querySelector<HTMLElement>('.jw-toolbar__select-option-label')

    if (label !== null) {
      label.textContent = option.label
    }
  }
}

/** 刷新当前控件外层 tooltip 文案。 */
function updateToolbarTooltipText(surface: HTMLElement, text: string): void {
  const anchor = surface.closest<HTMLElement>('.jw-toolbar__tooltip-anchor')
  const tooltip = anchor?.querySelector<HTMLElement>('[role="tooltip"]')

  if (tooltip !== null && tooltip !== undefined) {
    tooltip.textContent = text
  }
}

/** 创建单个工具对应的控件包装。 */
function createControl(definition: BuiltinToolDefinition, ownerDocument: Document): ControlParts {
  switch (definition.kind) {
    case 'button': {
      const button = createToolbarButton(definition, ownerDocument)

      button.setAttribute('data-jword-tool-id', definition.id)

      return {
        wrapper: button,
        control: button
      }
    }
    case 'select': {
      const { wrapper, control } = createToolbarSelectControl(definition, ownerDocument)

      wrapper.setAttribute('data-jword-tool-id', definition.id)
      control.setAttribute(definition.dataAttribute, 'true')

      return { wrapper, control }
    }
    case 'color': {
      const { wrapper, control } = createToolbarColorControl(definition.label, definition.icon, ownerDocument)

      wrapper.setAttribute('data-jword-tool-id', definition.id)
      control.setAttribute(definition.dataAttribute, 'true')

      return { wrapper, control }
    }
  }
}

/** 创建按钮控件。 */
function createToolbarButton(
  definition: BuiltinToolDefinition,
  ownerDocument: Document
): HTMLButtonElement {
  const button = ownerDocument.createElement('button')
  const iconRow = ownerDocument.createElement('span')

  button.type = 'button'
  button.className = 'jw-toolbar__button'
  button.setAttribute('data-jword-tooltip-surface', 'true')
  button.setAttribute('aria-label', definition.label)
  button.setAttribute(definition.dataAttribute, 'true')
  iconRow.className = 'jw-toolbar__button-icon-row'

  if (definition.icon !== undefined) {
    iconRow.append(createToolbarIcon(definition.icon))
  }

  const label = ownerDocument.createElement('span')

  label.className = 'jw-toolbar__button-label'
  label.textContent = definition.label
  button.append(label)

  if (readButtonNeedsCaret(definition.id)) {
    const arrow = ownerDocument.createElement('span')

    arrow.className = 'jw-toolbar__button-caret'
    arrow.append(createToolbarIcon('caretDown'))
    iconRow.append(arrow)
  }

  if (iconRow.childElementCount > 0) {
    button.prepend(iconRow)
  }

  bindToolbarPointerFocusGuard(button)

  return button
}

/** 判断按钮是否需要显示下拉箭头。 */
function readButtonNeedsCaret(toolId: JWordToolbarToolId): boolean {
  return toolId === 'document.findReplace'
    || toolId === 'document.watermark'
    || toolId === 'document.headerFooter'
    || toolId === 'document.footer'
    || toolId === 'document.pageNumber'
}

/** 创建 select 控件包装。 */
function createToolbarSelectControl(
  definition: BuiltinToolDefinition,
  ownerDocument: Document
): { readonly wrapper: HTMLElement, readonly control: HTMLSelectElement, readonly destroy: () => void } {
  const options = definition.options ?? []
  const ariaLabel = definition.label
  const fieldLabel = definition.fieldLabel ?? definition.label
  const triggerVariant = definition.triggerVariant ?? 'plain'
  const menuLayout = resolveToolbarSelectMenuLayout(definition, options)
  const menuTextAlign = definition.menuTextAlign ?? 'start'
  const wrapper = ownerDocument.createElement('div')
  const trigger = ownerDocument.createElement('button')
  const triggerRow = ownerDocument.createElement('span')
  const triggerIcon = ownerDocument.createElement('span')
  const triggerPrefix = ownerDocument.createElement('span')
  const triggerLabel = ownerDocument.createElement('span')
  const triggerFieldLabel = ownerDocument.createElement('span')
  const triggerArrow = ownerDocument.createElement('span')
  const menu = ownerDocument.createElement('div')
  const select = ownerDocument.createElement('select')
  const signalController = new (ownerDocument.defaultView?.AbortController ?? AbortController)()

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
  const menuId = `jw-toolbar-select-menu-${definition.id.replace(/[^a-z0-9-]/gi, '-')}`

  trigger.setAttribute('aria-haspopup', 'listbox')
  trigger.setAttribute('aria-expanded', 'false')
  trigger.setAttribute('aria-label', ariaLabel)
  trigger.setAttribute('aria-controls', menuId)
  triggerRow.className = 'jw-toolbar__select-trigger-row'
  triggerIcon.className = 'jw-toolbar__select-trigger-icon'
  triggerPrefix.className = 'jw-toolbar__select-prefix'
  triggerPrefix.textContent = `${fieldLabel}：`
  triggerLabel.className = 'jw-toolbar__select-label'
  triggerFieldLabel.className = 'jw-toolbar__select-field-label'
  triggerFieldLabel.textContent = fieldLabel
  triggerArrow.className = 'jw-toolbar__select-arrow'
  triggerArrow.append(createToolbarIcon('caretDown'))
  menu.id = menuId
  menu.className = 'jw-toolbar__select-menu'
  menu.setAttribute('data-jword-tooltip-skip', 'true')
  menu.setAttribute('role', 'listbox')
  menu.setAttribute('aria-label', ariaLabel)
  menu.hidden = true
  select.className = 'jw-toolbar__select'
  select.tabIndex = -1
  select.setAttribute('aria-label', ariaLabel)

  for (const option of options) {
    const node = ownerDocument.createElement('option')

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

    const optionButton = ownerDocument.createElement('button')
    const optionLabel = ownerDocument.createElement('span')
    const optionCheck = ownerDocument.createElement('span')

    optionButton.type = 'button'
    optionButton.className = 'jw-toolbar__select-option'
    optionButton.setAttribute('role', 'option')
    optionButton.setAttribute('aria-selected', 'false')
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
      const optionIcon = ownerDocument.createElement('span')

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
    triggerRow.append(triggerPrefix)
  }
  triggerRow.append(triggerIcon, triggerLabel, triggerArrow)
  trigger.append(triggerRow, triggerFieldLabel)
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

  ownerDocument.addEventListener(
    'pointerdown',
    (event) => {
      if (!isNodeInDocument(ownerDocument, event.target) || wrapper.contains(event.target)) {
        return
      }

      closeToolbarSelect(wrapper, trigger, menu)
    },
    { signal: signalController.signal }
  )

  ownerDocument.addEventListener(
    'click',
    (event) => {
      if (!isNodeInDocument(ownerDocument, event.target) || wrapper.contains(event.target)) {
        return
      }

      closeToolbarSelect(wrapper, trigger, menu)
    },
    { signal: signalController.signal }
  )

  ownerDocument.addEventListener(
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
  iconName: BuiltinToolDefinition['icon'],
  ownerDocument: Document
): { readonly wrapper: HTMLElement, readonly control: HTMLInputElement } {
  const wrapper = ownerDocument.createElement('label')
  const visual = ownerDocument.createElement('span')
  const indicator = ownerDocument.createElement('span')
  const arrow = ownerDocument.createElement('span')
  const input = ownerDocument.createElement('input')

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
    optionButton.setAttribute('aria-selected', isSelected ? 'true' : 'false')

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
  const option = control.ownerDocument.createElement('option')
  const button = control.ownerDocument.createElement('button')
  const buttonLabel = control.ownerDocument.createElement('span')
  const buttonCheck = control.ownerDocument.createElement('span')
  const trigger = wrapper.querySelector<HTMLButtonElement>('.jw-toolbar__select-trigger')

  option.value = value
  option.textContent = label
  option.setAttribute('data-jword-runtime-option', 'true')
  control.append(option)
  control.value = value

  button.type = 'button'
  button.className = 'jw-toolbar__select-option'
  button.setAttribute('role', 'option')
  button.setAttribute('aria-selected', 'false')
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


interface ToolbarRovingTabindexController {
  register(element: HTMLElement): void
  syncVisible(): void
  destroy(): void
}

/** 创建 toolbar roving tabindex 控制器。 */
function createToolbarRovingTabindex(ownerDocument: Document): ToolbarRovingTabindexController {
  const signalController = new (ownerDocument.defaultView?.AbortController ?? AbortController)()
  const elements: HTMLElement[] = []
  let activeIndex = 0

  function register(element: HTMLElement): void {
    element.tabIndex = elements.length === activeIndex ? 0 : -1
    element.addEventListener('focus', () => {
      setActiveElement(element)
    }, { signal: signalController.signal })
    element.addEventListener('keydown', (event) => {
      handleToolbarRovingKeydown(event, element)
    }, { signal: signalController.signal })
    elements.push(element)
  }

  function syncVisible(): void {
    const visibleElements = readVisibleToolbarRovingElements(elements)
    const activeElement = elements[activeIndex]

    if (visibleElements.length === 0) {
      syncToolbarRovingTabindex(elements, -1)
      return
    }

    if (activeElement !== undefined && visibleElements.includes(activeElement)) {
      syncToolbarRovingTabindex(elements, activeIndex)
      return
    }

    activeIndex = elements.indexOf(visibleElements[0]!)
    syncToolbarRovingTabindex(elements, activeIndex)
  }

  function setActiveElement(element: HTMLElement): void {
    const nextIndex = elements.indexOf(element)

    if (nextIndex < 0) {
      return
    }

    activeIndex = nextIndex
    syncToolbarRovingTabindex(elements, activeIndex)
  }

  function handleToolbarRovingKeydown(event: KeyboardEvent, element: HTMLElement): void {
    const visibleElements = readVisibleToolbarRovingElements(elements)
    const currentIndex = visibleElements.indexOf(element)
    const nextIndex = readNextToolbarRovingIndex(event.key, currentIndex, visibleElements.length)

    if (nextIndex === null) {
      return
    }

    event.preventDefault()
    activeIndex = elements.indexOf(visibleElements[nextIndex]!)
    syncToolbarRovingTabindex(elements, activeIndex)
    visibleElements[nextIndex]?.focus()
  }

  return {
    register,
    syncVisible,
    destroy: () => {
      signalController.abort()
    }
  }
}

/** 读取当前可见面板中的 roving tabindex 元素。 */
function readVisibleToolbarRovingElements(elements: readonly HTMLElement[]): readonly HTMLElement[] {
  return elements.filter((element) => (
    element.parentElement !== null
    && element.closest('[hidden]') === null
  ))
}

/** 计算 toolbar roving tabindex 的下一焦点索引。 */
function readNextToolbarRovingIndex(key: string, currentIndex: number, length: number): number | null {
  if (length === 0 || currentIndex < 0) {
    return null
  }

  if (key === 'ArrowRight' || key === 'ArrowDown') {
    return (currentIndex + 1) % length
  }

  if (key === 'ArrowLeft' || key === 'ArrowUp') {
    return (currentIndex - 1 + length) % length
  }

  if (key === 'Home') {
    return 0
  }

  if (key === 'End') {
    return length - 1
  }

  return null
}

/** 同步 toolbar roving tabindex 状态。 */
function syncToolbarRovingTabindex(elements: readonly HTMLElement[], activeIndex: number): void {
  for (const [index, element] of elements.entries()) {
    element.tabIndex = index === activeIndex ? 0 : -1
  }
}

/** 读取 toolbar 工具对应的真实可聚焦元素。 */
function readToolbarFocusableElement(wrapper: HTMLElement, control: JWordToolbarControlElement): HTMLElement {
  const trigger = wrapper.querySelector<HTMLElement>('.jw-toolbar__select-trigger')

  if (trigger !== null) {
    return trigger
  }

  return control
}

/** 判断事件目标是否属于指定 document 的 Node。 */
function isNodeInDocument(ownerDocument: Document, target: EventTarget | null): target is Node {
  const NodeCtor = ownerDocument.defaultView?.Node ?? Node

  return target instanceof NodeCtor
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

/** 供 controller 同步非 editor formatting 来源的 toolbar select 状态。 */
export function syncToolbarSelectControlState(
  control: JWordToolbarControlElement | undefined,
  disabled: boolean,
  value: string,
  state = 'value'
): void {
  setSelectState(control, disabled, value, state)
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
