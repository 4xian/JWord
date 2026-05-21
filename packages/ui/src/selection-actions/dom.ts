/**
 * 职责：创建并渲染选区浮动工具栏与右键菜单 DOM，不承载 editor 命令语义。
 * 边界：只负责节点结构、稳定 data attribute 和展示状态，不读取 projection 或事务结果。
 * 协作模块：selection-actions/controller 绑定交互，state 计算显示状态，toolbar/icons 复用图标。
 * 性能/安全约束：DOM 结构保持扁平，所有交互节点都有稳定 selector，避免引入额外布局依赖。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md Gate 4 选区浮层收尾项。
 */
import { createToolbarIcon } from '../toolbar/icons'
import type { SelectionActionPosition, SelectionActionsContextControls, SelectionActionsDom, SelectionActionsFormatControls, SelectionActionsViewState } from './types'

/** 创建 selection-actions DOM。 */
export function createSelectionActionsDom(host: HTMLElement): SelectionActionsDom {
  const root = document.createElement('div')
  const floatingToolbar = document.createElement('div')
  const floatingBar = document.createElement('div')
  const contextMenu = document.createElement('div')
  const contextMenuGroup = document.createElement('div')
  const contextMetaGroup = document.createElement('div')
  const formatControls = createFormatControls()
  const contextControls = createContextControls()

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
    createColorLabel('文字颜色', 'text-color', 'textColor', formatControls.textColor),
    createColorLabel('背景色', 'background-color', 'backgroundColor', formatControls.backgroundColor)
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
  dom.formatControls.textColor.disabled = !state.formatEnabled
  dom.formatControls.backgroundColor.disabled = !state.formatEnabled
  if (state.activeColorPicker !== 'text') {
    dom.formatControls.textColor.value = state.textColorValue
  }
  if (state.activeColorPicker !== 'background') {
    dom.formatControls.backgroundColor.value = state.backgroundColorValue
  }
  syncColorControl(dom.formatControls.textColor, state.textColorValue)
  syncColorControl(dom.formatControls.backgroundColor, state.backgroundColorValue)

  dom.contextControls.cut.disabled = state.cutDisabled
  dom.contextControls.copy.disabled = state.copyDisabled
  dom.contextControls.clear.disabled = state.clearDisabled
}

/** 销毁 selection-actions DOM。 */
export function destroySelectionActionsDom(dom: SelectionActionsDom): void {
  dom.host.remove()
}

/** 创建浮动工具栏中的格式按钮集合。 */
function createFormatControls(): SelectionActionsFormatControls {
  return {
    bold: createFormatButton('format.bold', '加粗', 'bold'),
    italic: createFormatButton('format.italic', '斜体', 'italic'),
    underline: createFormatButton('format.underline', '下划线', 'underline'),
    strike: createFormatButton('format.strike', '删除线', 'strike'),
    textColor: createColorInput('format.textColor', '文字颜色', '#111111'),
    backgroundColor: createColorInput('format.backgroundColor', '背景色', '#fff59d')
  }
}

/** 创建右键菜单动作集合。 */
function createContextControls(): SelectionActionsContextControls {
  return {
    cut: createContextButton('clipboard.cut', '剪切', false, '⌘+X'),
    copy: createContextButton('clipboard.copy', '复制', false, '⌘+C'),
    paste: createContextButton('clipboard.paste', '粘贴', false, '⌘+V'),
    pastePlainText: createContextButton('clipboard.pastePlainText', '仅文本粘贴', false, '⌘+⇧+V'),
    clear: createContextButton('format.clear', '清除格式'),
    insertLink: createContextButton('insert.link', '插入链接', true),
    insertComment: createContextButton('insert.comment', '插入批注', true),
    insertBookmark: createContextButton('insert.bookmark', '插入书签', true),
    forwardReference: createContextButton('insert.referenceForward', '引用转发', true)
  }
}

/** 创建浮动工具栏里的单个格式按钮。 */
function createFormatButton(
  actionId: string,
  ariaLabel: string,
  iconName: 'bold' | 'italic' | 'underline' | 'strike'
): HTMLButtonElement {
  const button = document.createElement('button')

  button.type = 'button'
  button.className = 'jw-selection-toolbar__button'
  button.setAttribute('data-jword-selection-action', actionId)
  button.setAttribute('aria-label', ariaLabel)
  button.setAttribute('aria-pressed', 'false')
  button.append(createToolbarIcon(iconName))

  return button
}

/** 创建浮动工具栏里的颜色输入。 */
function createColorInput(actionId: string, ariaLabel: string, initialValue: string): HTMLInputElement {
  const input = document.createElement('input')

  input.type = 'color'
  input.value = initialValue
  input.className = 'jw-selection-toolbar__color-input'
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
  button.setAttribute('data-jword-context-action', actionId)
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
