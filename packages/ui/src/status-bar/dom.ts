/**
 * 职责：创建和刷新 JWord 官方底部状态栏 DOM。
 * 边界：只负责节点结构、稳定 data selector 和文案刷新，不读取 editor 或执行命令。
 * 协作模块：status-bar/controller 绑定事件并写入状态，i18n 提供中英文文案。
 * 性能/安全约束：DOM 结构扁平，所有控件通过 data-jword-status-bar-action 稳定定位。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import {
  readJWordUiText,
  type ResolvedJWordUiI18n
} from '../i18n'
import { createToolbarIcon, type ToolbarIconName } from '../toolbar/icons'
import type {
  JWordStatusBarElements,
  JWordStatusBarItemId,
  JWordStatusBarLocale,
  JWordUiThemeName
} from '../types'

export interface StatusBarDom extends JWordStatusBarElements {
  readonly zoomSlider: HTMLInputElement | null
  readonly zoomOutButton: HTMLButtonElement | null
  readonly zoomInButton: HTMLButtonElement | null
  readonly themeSelect: HTMLSelectElement | null
  readonly localeSelect: HTMLSelectElement | null
}

export interface StatusBarDomState {
  readonly words: number
  readonly characters: number
  readonly paragraphs: number
  readonly currentPage: number
  readonly totalPages: number
  readonly selectionText: string
  readonly zoomPercent: number
  readonly fullscreen: boolean
  readonly fullscreenAvailable: boolean
  readonly fitMode: 'width' | 'page' | null
  readonly presentation: boolean
  readonly theme: JWordUiThemeName
  readonly locale: JWordStatusBarLocale
}

interface CreateStatusBarDomOptions {
  readonly host: HTMLElement
  readonly items: readonly JWordStatusBarItemId[]
  readonly i18n: ResolvedJWordUiI18n
  readonly brandLabel: string
  readonly minZoomPercent: number
  readonly maxZoomPercent: number
  readonly zoomStepPercent: number
  readonly themes: readonly JWordUiThemeName[]
  readonly locales: readonly JWordStatusBarLocale[]
}

const LEFT_STATUS_BAR_ITEMS = new Set<JWordStatusBarItemId>([
  'brand',
  'wordCount',
  'characterCount',
  'paragraphCount',
  'page',
  'selection'
])

/** 创建状态栏 DOM。 */
export function createStatusBarDom(options: CreateStatusBarDomOptions): StatusBarDom {
  const { host } = options
  const ownerDocument = host.ownerDocument
  const root = ownerDocument.createElement('div')
  const left = ownerDocument.createElement('div')
  const right = ownerDocument.createElement('div')
  const controls: Partial<Record<JWordStatusBarItemId, HTMLElement>> = {}

  host.replaceChildren()
  host.classList.add('jw-status-bar')
  host.setAttribute('data-jword-status-bar', 'true')
  host.setAttribute('lang', options.i18n.locale)
  if (options.i18n.dir !== undefined) {
    host.setAttribute('dir', options.i18n.dir)
  }
  root.className = 'jw-status-bar__root'
  root.setAttribute('data-jword-status-bar-root', 'true')
  root.setAttribute('role', 'toolbar')
  root.setAttribute('aria-label', readJWordUiText(options.i18n, 'statusBar.ariaLabel'))
  left.className = 'jw-status-bar__side jw-status-bar__side--left'
  left.setAttribute('data-jword-status-bar-left', 'true')
  right.className = 'jw-status-bar__side jw-status-bar__side--right'
  right.setAttribute('data-jword-status-bar-right', 'true')
  root.append(left, right)
  host.append(root)

  for (const item of options.items) {
    const element = createStatusBarItem(ownerDocument, item, options)

    controls[item] = element
    if (LEFT_STATUS_BAR_ITEMS.has(item)) {
      left.append(element)
    } else {
      right.append(element)
    }
  }

  return {
    host,
    root,
    left,
    right,
    controls,
    zoomSlider: readControl<HTMLInputElement>(controls.zoomSlider, 'input'),
    zoomOutButton: controls.zoomSlider?.querySelector<HTMLButtonElement>('[data-jword-status-bar-zoom-minus]') ?? null,
    zoomInButton: controls.zoomSlider?.querySelector<HTMLButtonElement>('[data-jword-status-bar-zoom-plus]') ?? null,
    themeSelect: readControl<HTMLSelectElement>(controls.themeSwitcher, 'select'),
    localeSelect: readControl<HTMLSelectElement>(controls.localeSwitcher, 'select')
  }
}

/** 刷新状态栏静态文案。 */
export function localizeStatusBarDom(
  dom: StatusBarDom,
  i18n: ResolvedJWordUiI18n,
  themes: readonly JWordUiThemeName[],
  locales: readonly JWordStatusBarLocale[]
): void {
  dom.host.setAttribute('lang', i18n.locale)
  if (i18n.dir === undefined) {
    dom.host.removeAttribute('dir')
  } else {
    dom.host.setAttribute('dir', i18n.dir)
  }
  dom.root.setAttribute('aria-label', readJWordUiText(i18n, 'statusBar.ariaLabel'))
  updateControlText(dom.controls.wordCount, readJWordUiText(i18n, 'statusBar.stats.words'))
  updateControlText(dom.controls.characterCount, readJWordUiText(i18n, 'statusBar.stats.characters'))
  updateControlText(dom.controls.paragraphCount, readJWordUiText(i18n, 'statusBar.stats.paragraphs'))
  updateControlText(dom.controls.selection, readJWordUiText(i18n, 'statusBar.stats.selection'))
  updateButtonLabel(dom.controls.fullscreen, readJWordUiText(i18n, 'statusBar.view.fullscreen'))
  updateButtonLabel(dom.controls.presentation, readJWordUiText(i18n, 'statusBar.view.presentation'))
  updateInputLabel(dom.controls.zoomSlider, readJWordUiText(i18n, 'statusBar.zoom.label'))
  updateZoomStepButtonLabel(dom.zoomOutButton, readJWordUiText(i18n, 'statusBar.zoom.decrease'))
  updateZoomStepButtonLabel(dom.zoomInButton, readJWordUiText(i18n, 'statusBar.zoom.increase'))
  updateButtonLabel(dom.controls.zoomReset, readJWordUiText(i18n, 'statusBar.zoom.reset'))
  updateButtonLabel(dom.controls.fitWidth, readJWordUiText(i18n, 'statusBar.zoom.fitWidth'))
  updateButtonLabel(dom.controls.fitPage, readJWordUiText(i18n, 'statusBar.zoom.fitPage'))
  updateSelectLabel(dom.controls.themeSwitcher, readJWordUiText(i18n, 'statusBar.theme.label'))
  updateSelectLabel(dom.controls.localeSwitcher, readJWordUiText(i18n, 'statusBar.locale.label'))
  syncThemeOptions(dom.themeSelect, themes, i18n)
  syncLocaleOptions(dom.localeSelect, locales, i18n)
}

/** 刷新状态栏动态状态。 */
export function renderStatusBarDomState(dom: StatusBarDom, state: StatusBarDomState, i18n: ResolvedJWordUiI18n): void {
  setValueText(dom.controls.wordCount, String(state.words))
  setValueText(dom.controls.characterCount, String(state.characters))
  setValueText(dom.controls.paragraphCount, String(state.paragraphs))
  setValueText(dom.controls.page, readJWordUiText(i18n, 'statusBar.page.current')
    .replace('{current}', String(state.currentPage))
    .replace('{total}', String(state.totalPages)))
  setValueText(dom.controls.selection, state.selectionText)
  setValueText(dom.controls.zoomPercent, `${state.zoomPercent}%`)
  updateButtonLabel(
    dom.controls.fullscreen,
    state.fullscreen
      ? readJWordUiText(i18n, 'statusBar.view.exitFullscreen')
      : readJWordUiText(i18n, 'statusBar.view.fullscreen'),
    state.fullscreen ? 'exitFullscreen' : 'fullscreen'
  )
  updateButtonLabel(
    dom.controls.presentation,
    state.presentation
      ? readJWordUiText(i18n, 'statusBar.view.exitPresentation')
      : readJWordUiText(i18n, 'statusBar.view.presentation'),
    state.presentation ? 'exitPresentation' : 'presentation'
  )
  dom.zoomSlider?.setAttribute('value', String(state.zoomPercent))
  if (dom.zoomSlider !== null) {
    dom.zoomSlider.value = String(state.zoomPercent)
  }
  updateZoomSliderProgress(dom.zoomSlider, state.zoomPercent)
  setPressed(dom.controls.fitWidth, state.fitMode === 'width')
  setPressed(dom.controls.fitPage, state.fitMode === 'page')
  setPressed(dom.controls.fullscreen, state.fullscreen)
  setPressed(dom.controls.presentation, state.presentation)
  setDisabled(dom.controls.fullscreen, !state.fullscreenAvailable)
  if (dom.themeSelect !== null) {
    dom.themeSelect.value = state.theme
  }
  updateSelectVisual(dom.controls.themeSwitcher, state.theme === 'dark' ? 'themeDark' : 'themeLight')
  if (dom.localeSelect !== null) {
    dom.localeSelect.value = state.locale
  }
  updateSelectVisual(dom.controls.localeSwitcher, 'language')
  dom.root.setAttribute('data-jword-presentation', state.presentation ? 'true' : 'false')
}

/** 销毁状态栏 DOM。 */
export function destroyStatusBarDom(dom: StatusBarDom): void {
  dom.host.replaceChildren()
  dom.host.removeAttribute('data-jword-status-bar')
  dom.host.removeAttribute('lang')
  dom.host.removeAttribute('dir')
  dom.host.classList.remove('jw-status-bar')
}

/** 创建单个状态栏 item。 */
function createStatusBarItem(
  ownerDocument: Document,
  item: JWordStatusBarItemId,
  options: CreateStatusBarDomOptions
): HTMLElement {
  switch (item) {
    case 'brand':
      return createLabel(ownerDocument, item, options.brandLabel)
    case 'wordCount':
      return createMetric(ownerDocument, item, readJWordUiText(options.i18n, 'statusBar.stats.words'))
    case 'characterCount':
      return createMetric(ownerDocument, item, readJWordUiText(options.i18n, 'statusBar.stats.characters'))
    case 'paragraphCount':
      return createMetric(ownerDocument, item, readJWordUiText(options.i18n, 'statusBar.stats.paragraphs'))
    case 'page':
      return createValue(ownerDocument, item)
    case 'selection':
      return createMetric(ownerDocument, item, readJWordUiText(options.i18n, 'statusBar.stats.selection'))
    case 'fullscreen':
      return createButton(ownerDocument, item, readJWordUiText(options.i18n, 'statusBar.view.fullscreen'), 'fullscreen')
    case 'presentation':
      return createButton(ownerDocument, item, readJWordUiText(options.i18n, 'statusBar.view.presentation'), 'presentation')
    case 'zoomSlider':
      return createZoomSlider(ownerDocument, options)
    case 'zoomPercent':
      return createValue(ownerDocument, item)
    case 'zoomReset':
      return createButton(ownerDocument, item, readJWordUiText(options.i18n, 'statusBar.zoom.reset'), 'reset')
    case 'fitWidth':
      return createButton(ownerDocument, item, readJWordUiText(options.i18n, 'statusBar.zoom.fitWidth'), 'fitWidth')
    case 'fitPage':
      return createButton(ownerDocument, item, readJWordUiText(options.i18n, 'statusBar.zoom.fitPage'), 'fitPage')
    case 'themeSwitcher':
      return createThemeSelect(ownerDocument, options)
    case 'localeSwitcher':
      return createLocaleSelect(ownerDocument, options)
  }
}

/** 创建只读标签。 */
function createLabel(ownerDocument: Document, item: JWordStatusBarItemId, text: string): HTMLElement {
  const element = ownerDocument.createElement('span')

  if (item !== 'brand') {
    element.className = 'jw-status-bar__item jw-status-bar__label'
  }
  element.setAttribute('data-jword-status-bar-action', item)
  element.textContent = text

  return element
}

/** 创建带 label/value 的指标节点。 */
function createMetric(ownerDocument: Document, item: JWordStatusBarItemId, label: string): HTMLElement {
  const element = ownerDocument.createElement('span')
  const labelNode = ownerDocument.createElement('span')
  const valueNode = ownerDocument.createElement('span')

  element.className = 'jw-status-bar__item jw-status-bar__metric'
  element.setAttribute('data-jword-status-bar-action', item)
  labelNode.className = 'jw-status-bar__metric-label'
  labelNode.textContent = label
  valueNode.className = 'jw-status-bar__metric-value'
  valueNode.setAttribute('data-jword-status-bar-value', 'true')
  element.append(labelNode, valueNode)

  return element
}

/** 创建只显示值的状态节点。 */
function createValue(ownerDocument: Document, item: JWordStatusBarItemId): HTMLElement {
  const element = ownerDocument.createElement('span')

  element.className = 'jw-status-bar__item jw-status-bar__value'
  element.setAttribute('data-jword-status-bar-action', item)
  element.setAttribute('data-jword-status-bar-value', 'true')

  return element
}

/** 创建按钮。 */
function createButton(
  ownerDocument: Document,
  item: JWordStatusBarItemId,
  label: string,
  icon: ToolbarIconName
): HTMLButtonElement {
  const button = ownerDocument.createElement('button')

  button.type = 'button'
  button.className = 'jw-status-bar__item jw-status-bar__button'
  button.setAttribute('data-jword-status-bar-action', item)
  button.setAttribute('aria-label', label)
  button.title = label
  button.append(createToolbarIcon(icon))

  return button
}

/** 创建缩放滑块。 */
function createZoomSlider(ownerDocument: Document, options: CreateStatusBarDomOptions): HTMLElement {
  const wrapper = ownerDocument.createElement('span')
  const minus = createZoomStepButton(
    ownerDocument,
    'zoomOut',
    readJWordUiText(options.i18n, 'statusBar.zoom.decrease'),
    'data-jword-status-bar-zoom-minus'
  )
  const input = ownerDocument.createElement('input')
  const plus = createZoomStepButton(
    ownerDocument,
    'zoomIn',
    readJWordUiText(options.i18n, 'statusBar.zoom.increase'),
    'data-jword-status-bar-zoom-plus'
  )

  wrapper.className = 'jw-status-bar__item jw-status-bar__zoom-control'
  wrapper.setAttribute('data-jword-status-bar-action', 'zoomSlider')
  input.type = 'range'
  input.className = 'jw-status-bar__zoom-slider'
  input.setAttribute('aria-label', readJWordUiText(options.i18n, 'statusBar.zoom.label'))
  input.min = String(options.minZoomPercent)
  input.max = String(options.maxZoomPercent)
  input.step = String(options.zoomStepPercent)
  wrapper.append(minus, input, plus)

  return wrapper
}

/** 创建缩放步进图标按钮。 */
function createZoomStepButton(
  ownerDocument: Document,
  icon: ToolbarIconName,
  label: string,
  dataAttribute: string
): HTMLButtonElement {
  const button = ownerDocument.createElement('button')

  button.type = 'button'
  button.className = 'jw-status-bar__zoom-edge jw-status-bar__zoom-step'
  button.setAttribute(dataAttribute, 'true')
  button.setAttribute('aria-label', label)
  button.title = label
  button.append(createToolbarIcon(icon))

  return button
}

/** 创建主题切换 select。 */
function createThemeSelect(ownerDocument: Document, options: CreateStatusBarDomOptions): HTMLElement {
  const select = ownerDocument.createElement('select')
  const wrapper = createIconSelectWrapper(ownerDocument, 'themeLight')

  wrapper.setAttribute('data-jword-status-bar-action', 'themeSwitcher')
  select.className = 'jw-status-bar__select'
  select.setAttribute('data-jword-status-bar-action', 'themeSwitcher')
  select.setAttribute('aria-label', readJWordUiText(options.i18n, 'statusBar.theme.label'))
  select.title = readJWordUiText(options.i18n, 'statusBar.theme.label')
  syncThemeOptions(select, options.themes, options.i18n)
  wrapper.append(select)

  return wrapper
}

/** 创建语言切换 select。 */
function createLocaleSelect(ownerDocument: Document, options: CreateStatusBarDomOptions): HTMLElement {
  const select = ownerDocument.createElement('select')
  const wrapper = createIconSelectWrapper(ownerDocument, 'language')

  wrapper.setAttribute('data-jword-status-bar-action', 'localeSwitcher')
  select.className = 'jw-status-bar__select'
  select.setAttribute('data-jword-status-bar-action', 'localeSwitcher')
  select.setAttribute('aria-label', readJWordUiText(options.i18n, 'statusBar.locale.label'))
  select.title = readJWordUiText(options.i18n, 'statusBar.locale.label')
  syncLocaleOptions(select, options.locales, options.i18n)
  wrapper.append(select)

  return wrapper
}

/** 创建图标化 select 包装。 */
function createIconSelectWrapper(ownerDocument: Document, icon: ToolbarIconName): HTMLElement {
  const wrapper = ownerDocument.createElement('span')
  const iconHost = ownerDocument.createElement('span')

  wrapper.className = 'jw-status-bar__item jw-status-bar__select-wrap'
  iconHost.className = 'jw-status-bar__select-icon'
  iconHost.setAttribute('data-jword-status-bar-select-icon', 'true')
  iconHost.append(createToolbarIcon(icon))
  wrapper.append(iconHost)

  return wrapper
}

/** 同步主题下拉选项文案。 */
function syncThemeOptions(select: HTMLSelectElement | null, themes: readonly JWordUiThemeName[], i18n: ResolvedJWordUiI18n): void {
  if (select === null) {
    return
  }

  const currentValue = select.value

  select.replaceChildren()
  for (const theme of themes) {
    const option = select.ownerDocument.createElement('option')

    option.value = theme
    option.textContent = readThemeLabel(i18n, theme)
    select.append(option)
  }
  select.value = currentValue
}

/** 同步语言下拉选项文案。 */
function syncLocaleOptions(select: HTMLSelectElement | null, locales: readonly JWordStatusBarLocale[], i18n: ResolvedJWordUiI18n): void {
  if (select === null) {
    return
  }

  const currentValue = select.value

  select.replaceChildren()
  for (const locale of locales) {
    const option = select.ownerDocument.createElement('option')

    option.value = locale
    option.textContent = locale === 'en-US'
      ? readJWordUiText(i18n, 'statusBar.locale.enUS')
      : readJWordUiText(i18n, 'statusBar.locale.zhCN')
    select.append(option)
  }
  select.value = currentValue
}

/** 读取主题文案。 */
function readThemeLabel(i18n: ResolvedJWordUiI18n, theme: JWordUiThemeName): string {
  if (theme === 'dark') {
    return readJWordUiText(i18n, 'statusBar.theme.dark')
  }

  return readJWordUiText(i18n, 'statusBar.theme.light')
}

/** 读取特定类型控件。 */
function readControl<T extends HTMLElement>(element: HTMLElement | undefined, tagName: string): T | null {
  if (element === undefined) {
    return null
  }

  if (element.tagName.toLowerCase() === tagName) {
    return element as T
  }

  return element.querySelector<T>(tagName)
}

/** 更新指标 label 文案。 */
function updateControlText(control: HTMLElement | undefined, text: string): void {
  const label = control?.querySelector<HTMLElement>('.jw-status-bar__metric-label')

  if (label !== null && label !== undefined) {
    label.textContent = text
  }
}

/** 更新按钮文案。 */
function updateButtonLabel(control: HTMLElement | undefined, label: string, icon?: ToolbarIconName): void {
  if (!(control instanceof HTMLButtonElement)) {
    return
  }

  control.setAttribute('aria-label', label)
  control.title = label
  if (icon !== undefined) {
    control.replaceChildren(createToolbarIcon(icon))
  }
}

/** 更新 input 无障碍文案。 */
function updateInputLabel(control: HTMLElement | undefined, label: string): void {
  const input = readControl<HTMLInputElement>(control, 'input')

  input?.setAttribute('aria-label', label)
}

/** 更新缩放步进按钮文案。 */
function updateZoomStepButtonLabel(control: HTMLButtonElement | null, label: string): void {
  if (control === null) {
    return
  }

  control.setAttribute('aria-label', label)
  control.title = label
}

/** 更新 select 无障碍文案。 */
function updateSelectLabel(control: HTMLElement | undefined, label: string): void {
  const select = readControl<HTMLSelectElement>(control, 'select')

  select?.setAttribute('aria-label', label)
  if (select !== null) {
    select.title = label
  }
  if (control !== undefined) {
    control.title = label
  }
}

/** 更新控件值文案。 */
function setValueText(control: HTMLElement | undefined, value: string): void {
  const valueNode = control?.matches('[data-jword-status-bar-value="true"]') === true
    ? control
    : control?.querySelector<HTMLElement>('[data-jword-status-bar-value="true"]')

  if (valueNode !== null && valueNode !== undefined) {
    valueNode.textContent = value
  }
}

/** 同步缩放滑块进度 CSS 变量，供细灰色进度条渲染。 */
function updateZoomSliderProgress(input: HTMLInputElement | null, value: number): void {
  if (input === null) {
    return
  }

  const min = Number.parseFloat(input.min)
  const max = Number.parseFloat(input.max)
  const range = max - min
  const progress = range <= 0
    ? 0
    : Math.min(100, Math.max(0, (value - min) / range * 100))

  input.style.setProperty('--jw-status-bar-zoom-progress', `${progress.toFixed(2)}%`)
}

/** 更新按钮按下态。 */
function setPressed(control: HTMLElement | undefined, pressed: boolean): void {
  if (control instanceof HTMLButtonElement) {
    control.setAttribute('aria-pressed', pressed ? 'true' : 'false')
  }
}

/** 更新按钮禁用态。 */
function setDisabled(control: HTMLElement | undefined, disabled: boolean): void {
  if (control instanceof HTMLButtonElement) {
    control.disabled = disabled
  }
}

/** 更新图标化 select 当前展示图标。 */
function updateSelectVisual(control: HTMLElement | undefined, icon: ToolbarIconName): void {
  const iconHost = control?.querySelector<HTMLElement>('[data-jword-status-bar-select-icon]')

  if (iconHost === undefined || iconHost === null) {
    return
  }

  iconHost.replaceChildren(createToolbarIcon(icon))
}
