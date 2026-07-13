/**
 * 职责：创建并渲染选区浮动工具栏与右键菜单 DOM，不承载 editor 命令语义。
 * 边界：只负责节点结构、稳定 data attribute 和展示状态，不读取 projection 或事务结果。
 * 协作模块：selection-actions/controller 绑定交互，state 计算显示状态，toolbar/icons 复用图标。
 * 性能/安全约束：DOM 结构保持扁平，所有交互节点都有稳定 selector，避免引入额外布局依赖。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import {
  readJWordUiText,
  resolveJWordUiI18n,
  type ResolvedJWordUiI18n
} from '../i18n'
import { createToolbarIcon } from '../toolbar/icons'
import type { SelectionActionPosition, SelectionActionsContextControls, SelectionActionsDom, SelectionActionsFormatControls, SelectionActionsViewState } from './types'

/** 创建 selection-actions DOM。 */
export function createSelectionActionsDom(
  host: HTMLElement,
  i18n: ResolvedJWordUiI18n = resolveJWordUiI18n()
): SelectionActionsDom {
  const root = document.createElement('div')
  const floatingToolbar = document.createElement('div')
  const floatingBar = document.createElement('div')
  const contextMenu = document.createElement('div')
  const contextMenuGroup = document.createElement('div')
  const contextMetaGroup = document.createElement('div')
  const formatControls = createFormatControls(i18n)
  const contextControls = createContextControls(i18n)

  root.className = 'jw-selection-actions'
  root.setAttribute('data-jword-selection-actions', 'true')
  floatingToolbar.className = 'jw-selection-toolbar'
  floatingToolbar.setAttribute('data-jword-floating-toolbar', 'true')
  floatingToolbar.hidden = true
  floatingBar.className = 'jw-selection-toolbar__bar'
  floatingBar.append(
    formatControls.bold,
    formatControls.italic,
    formatControls.underline,
    formatControls.strike,
    formatControls.insertLink,
    formatControls.openLink,
    formatControls.editLink,
    formatControls.removeLink,
    createColorLabel(readSelectionActionText(i18n, 'textColor'), 'text-color', 'textColor', formatControls.textColor),
    createColorLabel(readSelectionActionText(i18n, 'backgroundColor'), 'background-color', 'backgroundColor', formatControls.backgroundColor)
  )
  floatingToolbar.append(floatingBar)

  contextMenu.className = 'jw-context-menu'
  contextMenu.setAttribute('data-jword-context-menu', 'true')
  contextMenu.hidden = true
  contextMenuGroup.className = 'jw-context-menu__group'
  contextMenuGroup.append(
    contextControls.cut,
    contextControls.copy,
    contextControls.paste,
    contextControls.pastePlainText,
    contextControls.clear
  )
  contextMetaGroup.className = 'jw-context-menu__group jw-context-menu__group--meta'
  contextMetaGroup.append(
    contextControls.insertLink,
    contextControls.openLink,
    contextControls.editLink,
    contextControls.removeLink,
    contextControls.insertComment,
    contextControls.insertBookmark,
    contextControls.forwardReference
  )
  contextMenu.append(contextMenuGroup, contextMetaGroup)

  root.append(floatingToolbar, contextMenu)
  host.append(root)

  return {
    host: root,
    floatingToolbar,
    contextMenu,
    formatControls,
    contextControls
  }
}

/** 动态刷新 selection actions 文案。 */
export function localizeSelectionActionsDom(dom: SelectionActionsDom, i18n: ResolvedJWordUiI18n): void {
  updateButtonLabel(dom.formatControls.bold, readSelectionActionText(i18n, 'bold'))
  updateButtonLabel(dom.formatControls.italic, readSelectionActionText(i18n, 'italic'))
  updateButtonLabel(dom.formatControls.underline, readSelectionActionText(i18n, 'underline'))
  updateButtonLabel(dom.formatControls.strike, readSelectionActionText(i18n, 'strike'))
  updateButtonLabel(dom.formatControls.insertLink, readSelectionActionText(i18n, 'insertLink'))
  updateButtonLabel(dom.formatControls.openLink, readSelectionActionText(i18n, 'openLink'))
  updateButtonLabel(dom.formatControls.editLink, readSelectionActionText(i18n, 'editLink'))
  updateButtonLabel(dom.formatControls.removeLink, readSelectionActionText(i18n, 'removeLink'))
  updateInputLabel(dom.formatControls.textColor, readSelectionActionText(i18n, 'textColor'))
  updateInputLabel(dom.formatControls.backgroundColor, readSelectionActionText(i18n, 'backgroundColor'))
  updateColorLabel(dom.formatControls.textColor, readSelectionActionText(i18n, 'textColor'))
  updateColorLabel(dom.formatControls.backgroundColor, readSelectionActionText(i18n, 'backgroundColor'))
  updateContextButton(dom.contextControls.cut, readSelectionActionText(i18n, 'cut'))
  updateContextButton(dom.contextControls.copy, readSelectionActionText(i18n, 'copy'))
  updateContextButton(dom.contextControls.paste, readSelectionActionText(i18n, 'paste'))
  updateContextButton(dom.contextControls.pastePlainText, readSelectionActionText(i18n, 'pastePlainText'))
  updateContextButton(dom.contextControls.clear, readSelectionActionText(i18n, 'clear'))
  updateContextButton(dom.contextControls.insertLink, readSelectionActionText(i18n, 'insertLink'))
  updateContextButton(dom.contextControls.openLink, readSelectionActionText(i18n, 'openLink'))
  updateContextButton(dom.contextControls.editLink, readSelectionActionText(i18n, 'editLink'))
  updateContextButton(dom.contextControls.removeLink, readSelectionActionText(i18n, 'removeLink'))
  updateContextButton(dom.contextControls.insertComment, readSelectionActionText(i18n, 'insertComment'))
  updateContextButton(dom.contextControls.insertBookmark, readSelectionActionText(i18n, 'insertBookmark'))
  updateContextButton(dom.contextControls.forwardReference, readSelectionActionText(i18n, 'forwardReference'))
}

/** 根据最新状态重绘 selection-actions DOM。 */
export function renderSelectionActionsDom(dom: SelectionActionsDom, state: SelectionActionsViewState): void {
  dom.floatingToolbar.hidden = !state.floatingVisible
  dom.contextMenu.hidden = !state.contextMenuVisible
  dom.contextMenu.setAttribute('data-jword-selection-key', state.contextSelectionKey)
  syncPosition(dom.floatingToolbar, state.floatingPosition)
  syncPosition(dom.contextMenu, state.contextMenuPosition)

  setToggleState(dom.formatControls.bold, state.formatEnabled, state.boldPressed)
  setToggleState(dom.formatControls.italic, state.formatEnabled, state.italicPressed)
  setToggleState(dom.formatControls.underline, state.formatEnabled, state.underlinePressed)
  setToggleState(dom.formatControls.strike, state.formatEnabled, state.strikePressed)
  syncFormatActionVisibility(dom)
  syncLinkActionVisibility(dom, state)
  dom.formatControls.textColor.disabled = !state.formatEnabled
  dom.formatControls.backgroundColor.disabled = !state.formatEnabled
  if (state.activeColorPicker !== 'text') {
    dom.formatControls.textColor.value = state.textColorValue
  }
  if (state.activeColorPicker !== 'background') {
    dom.formatControls.backgroundColor.value = state.backgroundColorValue
  }
  syncColorControl(
    dom.formatControls.textColor,
    state.activeColorPicker === 'text' ? dom.formatControls.textColor.value : state.textColorValue
  )
  syncColorControl(
    dom.formatControls.backgroundColor,
    state.activeColorPicker === 'background' ? dom.formatControls.backgroundColor.value : state.backgroundColorValue
  )

  dom.contextControls.cut.disabled = state.cutDisabled
  dom.contextControls.copy.disabled = state.copyDisabled
  dom.contextControls.clear.disabled = state.clearDisabled
}

/** 销毁 selection-actions DOM。 */
export function destroySelectionActionsDom(dom: SelectionActionsDom): void {
  dom.host.remove()
}

/** 创建浮动工具栏中的格式按钮集合。 */
function createFormatControls(i18n: ResolvedJWordUiI18n): SelectionActionsFormatControls {
  return {
    bold: createFormatButton('format.bold', readSelectionActionText(i18n, 'bold'), 'bold'),
    italic: createFormatButton('format.italic', readSelectionActionText(i18n, 'italic'), 'italic'),
    underline: createFormatButton('format.underline', readSelectionActionText(i18n, 'underline'), 'underline'),
    strike: createFormatButton('format.strike', readSelectionActionText(i18n, 'strike'), 'strike'),
    insertLink: createFormatButton('insert.link', readSelectionActionText(i18n, 'insertLink'), 'link'),
    openLink: createFormatButton('link.open', readSelectionActionText(i18n, 'openLink'), 'openLink'),
    editLink: createFormatButton('link.edit', readSelectionActionText(i18n, 'editLink'), 'paragraphStyle'),
    removeLink: createFormatButton('link.remove', readSelectionActionText(i18n, 'removeLink'), 'trash'),
    textColor: createColorInput('format.textColor', readSelectionActionText(i18n, 'textColor'), '#111111'),
    backgroundColor: createColorInput('format.backgroundColor', readSelectionActionText(i18n, 'backgroundColor'), '#fff59d')
  }
}

/** 创建右键菜单动作集合。 */
function createContextControls(i18n: ResolvedJWordUiI18n): SelectionActionsContextControls {
  return {
    cut: createContextButton('clipboard.cut', readSelectionActionText(i18n, 'cut'), false, '⌘+X'),
    copy: createContextButton('clipboard.copy', readSelectionActionText(i18n, 'copy'), false, '⌘+C'),
    paste: createContextButton('clipboard.paste', readSelectionActionText(i18n, 'paste'), false, '⌘+V'),
    pastePlainText: createContextButton('clipboard.pastePlainText', readSelectionActionText(i18n, 'pastePlainText'), false, '⌘+⇧+V'),
    clear: createContextButton('format.clear', readSelectionActionText(i18n, 'clear')),
    insertLink: createContextButton('insert.link', readSelectionActionText(i18n, 'insertLink')),
    openLink: createContextButton('link.open', readSelectionActionText(i18n, 'openLink')),
    editLink: createContextButton('link.edit', readSelectionActionText(i18n, 'editLink')),
    removeLink: createContextButton('link.remove', readSelectionActionText(i18n, 'removeLink')),
    insertComment: createContextButton('insert.comment', readSelectionActionText(i18n, 'insertComment')),
    insertBookmark: createContextButton('insert.bookmark', readSelectionActionText(i18n, 'insertBookmark'), true),
    forwardReference: createContextButton('insert.referenceForward', readSelectionActionText(i18n, 'forwardReference'), true)
  }
}

/** 读取选区动作双语文案。 */
function readSelectionActionText(i18n: ResolvedJWordUiI18n, key: string): string {
  return readJWordUiText(i18n, `menu.selectionActions.${key}`)
}

/** 更新图标按钮的无障碍文案。 */
function updateButtonLabel(button: HTMLButtonElement, label: string): void {
  button.title = label
  button.setAttribute('aria-label', label)
}

/** 更新颜色输入的无障碍文案。 */
function updateInputLabel(input: HTMLInputElement, label: string): void {
  input.title = label
  input.setAttribute('aria-label', label)
}

/** 更新颜色控件包装的无障碍文案。 */
function updateColorLabel(input: HTMLInputElement, label: string): void {
  updateInputLabel(input, label)
  input.parentElement?.setAttribute('aria-label', label)
  if (input.parentElement !== null) {
    input.parentElement.title = label
  }
}

/** 更新右键菜单按钮的可见文案。 */
function updateContextButton(button: HTMLButtonElement, label: string): void {
  const labelNode = button.querySelector<HTMLElement>('.jw-context-menu__label')

  button.title = label
  button.setAttribute('aria-label', label)
  if (labelNode !== null) {
    labelNode.title = label
    labelNode.textContent = label
  }
}

/** 创建浮动工具栏里的单个格式按钮。 */
function createFormatButton(
  actionId: string,
  ariaLabel: string,
  iconName: 'bold' | 'italic' | 'underline' | 'strike' | 'link' | 'openLink'
  | 'paragraphStyle' | 'trash'
): HTMLButtonElement {
  const button = document.createElement('button')

  button.type = 'button'
  button.className = 'jw-selection-toolbar__button'
  button.title = ariaLabel
  button.setAttribute('data-jword-selection-action', actionId)
  button.setAttribute('aria-label', ariaLabel)
  button.setAttribute('aria-pressed', 'false')
  button.append(createToolbarIcon(iconName))

  return button
}

/** 按当前链接命中状态切换新增链接与已有链接操作。 */
function syncLinkActionVisibility(dom: SelectionActionsDom, state: SelectionActionsViewState): void {
  const hasActiveLink = state.activeLinkUrl !== null

  setActionVisibility(dom.formatControls.insertLink, !hasActiveLink)
  setActionVisibility(dom.formatControls.openLink, hasActiveLink)
  setActionVisibility(dom.formatControls.editLink, hasActiveLink)
  setActionVisibility(dom.formatControls.removeLink, hasActiveLink)
  dom.formatControls.insertLink.disabled = hasActiveLink || !state.insertLinkEnabled
  dom.formatControls.openLink.disabled = !hasActiveLink
  dom.formatControls.editLink.disabled = !hasActiveLink
  dom.formatControls.removeLink.disabled = !hasActiveLink
  setActionVisibility(dom.contextControls.insertLink, !state.contextHasLink)
  setActionVisibility(dom.contextControls.openLink, state.contextHasLink)
  setActionVisibility(dom.contextControls.editLink, state.contextHasLink)
  setActionVisibility(dom.contextControls.removeLink, state.contextHasLink)
  dom.contextControls.insertLink.disabled = state.contextHasLink
  dom.contextControls.openLink.disabled = !state.contextHasLink
  dom.contextControls.editLink.disabled = !state.contextHasLink
  dom.contextControls.removeLink.disabled = !state.contextHasLink
}

/** 浮动工具栏可见时格式动作保持可见，链接动作由独立逻辑控制。 */
function syncFormatActionVisibility(dom: SelectionActionsDom): void {
  setActionVisibility(dom.formatControls.bold, true)
  setActionVisibility(dom.formatControls.italic, true)
  setActionVisibility(dom.formatControls.underline, true)
  setActionVisibility(dom.formatControls.strike, true)
  dom.formatControls.textColor.parentElement?.toggleAttribute('hidden', false)
  dom.formatControls.backgroundColor.parentElement?.toggleAttribute('hidden', false)
}

/** 同步动作按钮的真实可见性，避免 CSS display 覆盖 hidden 属性。 */
function setActionVisibility(target: HTMLButtonElement, visible: boolean): void {
  target.hidden = !visible
  target.style.display = visible ? '' : 'none'
}

/** 创建浮动工具栏里的颜色输入。 */
function createColorInput(actionId: string, ariaLabel: string, initialValue: string): HTMLInputElement {
  const input = document.createElement('input')

  input.type = 'color'
  input.value = initialValue
  input.className = 'jw-selection-toolbar__color-input'
  input.title = ariaLabel
  input.setAttribute('data-jword-selection-action', actionId)
  input.setAttribute('aria-label', ariaLabel)

  return input
}

/** 创建浮动工具栏的颜色包装。 */
function createColorLabel(
  ariaLabel: string,
  tone: string,
  iconName: 'textColor' | 'backgroundColor',
  input: HTMLInputElement
): HTMLLabelElement {
  const label = document.createElement('label')
  const visual = document.createElement('span')
  const indicator = document.createElement('span')

  label.className = 'jw-selection-toolbar__color'
  label.title = ariaLabel
  label.setAttribute('data-jword-color-tone', tone)
  label.setAttribute('aria-label', ariaLabel)
  visual.className = 'jw-selection-toolbar__color-visual'
  indicator.className = 'jw-selection-toolbar__color-indicator'
  visual.append(createToolbarIcon(iconName), indicator)
  label.append(visual, input)

  return label
}

/** 创建右键菜单按钮。 */
function createContextButton(
  actionId: string,
  text: string,
  disabled = false,
  shortcut = ''
): HTMLButtonElement {
  const button = document.createElement('button')
  const label = document.createElement('span')

  button.type = 'button'
  button.className = 'jw-context-menu__button'
  button.disabled = disabled
  button.title = text
  button.setAttribute('data-jword-context-action', actionId)
  button.setAttribute('aria-label', text)
  label.className = 'jw-context-menu__label'
  label.title = text
  label.textContent = text
  button.append(label)

  if (shortcut.length > 0) {
    const shortcutElement = document.createElement('span')

    shortcutElement.className = 'jw-context-menu__shortcut'
    shortcutElement.textContent = shortcut
    button.append(shortcutElement)
  }

  return button
}

/** 同步浮层绝对定位。 */
function syncPosition(target: HTMLElement, position: SelectionActionPosition | null): void {
  if (position === null) {
    target.style.left = '0px'
    target.style.top = '0px'
    return
  }

  target.style.left = `${position.left}px`
  target.style.top = `${position.top}px`
}

/** 同步格式按钮启用态和按压态。 */
function setToggleState(target: HTMLButtonElement, enabled: boolean, pressed: 'true' | 'false' | 'mixed'): void {
  target.disabled = !enabled
  target.setAttribute('aria-pressed', pressed)
}

/** 同步颜色控件当前色值到可视色条。 */
function syncColorControl(control: HTMLInputElement, value: string): void {
  control.parentElement?.style.setProperty('--jw-selection-toolbar-color', value)
  control.parentElement?.setAttribute('data-jword-disabled', String(control.disabled))
}
