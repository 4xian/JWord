/**
 * 职责：创建并渲染 Gate 4.10 link panel DOM，不承载宿主命令语义。
 * 边界：只负责节点结构、稳定 data attribute 和展示状态，不读取 editor 或 selection。
 * 协作模块：link/controller 绑定交互，link/state 负责纯状态计算。
 * 性能/安全约束：结构保持扁平稳定，保留快捷工具和编辑弹窗两层最小 UI。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import { readLinkConfirmDisabled, readLinkValidationError } from './state'
import {
  readJWordUiText,
  resolveJWordUiI18n,
  type ResolvedJWordUiI18n
} from '../i18n'
import { createToolbarIcon } from '../toolbar/icons'
import type { JWordLinkPanelDom, JWordLinkPanelState, JWordLinkUrlPolicy } from './types'

/** 创建 link panel DOM。 */
export function createLinkPanelDom(host: HTMLElement): JWordLinkPanelDom {
  const i18n = resolveJWordUiI18n()
  const root = document.createElement('div')
  const quickTools = document.createElement('div')
  const openLinkButton = document.createElement('button')
  const editLinkButton = document.createElement('button')
  const removeLinkButton = document.createElement('button')
  const dialog = document.createElement('div')
  const visibleTextInput = document.createElement('input')
  const urlInput = document.createElement('input')
  const errorText = document.createElement('p')
  const dialogActions = document.createElement('div')
  const cancelButton = document.createElement('button')
  const confirmButton = document.createElement('button')

  root.className = 'jw-link-panel'
  root.setAttribute('data-jword-link-panel', 'true')

  quickTools.className = 'jw-link-panel__quick-tools'
  quickTools.setAttribute('data-jword-link-quick-tools', 'true')
  quickTools.hidden = true

  configureQuickToolButton(openLinkButton, readLinkText(i18n, 'open', '打开链接'), 'data-jword-link-open', 'openLink')
  configureQuickToolButton(editLinkButton, readLinkText(i18n, 'edit', '编辑链接'), 'data-jword-link-edit', 'paragraphStyle')
  configureQuickToolButton(removeLinkButton, readLinkText(i18n, 'remove', '删除链接'), 'data-jword-link-remove', 'trash')

  quickTools.append(openLinkButton, editLinkButton, removeLinkButton)

  dialog.className = 'jw-link-panel__dialog'
  dialog.setAttribute('data-jword-link-dialog', 'true')
  dialog.setAttribute('role', 'dialog')
  dialog.hidden = true

  visibleTextInput.type = 'text'
  visibleTextInput.placeholder = readLinkText(i18n, 'visibleText', '显示文本')
  visibleTextInput.setAttribute('data-jword-link-visible-text-input', 'true')

  urlInput.type = 'url'
  urlInput.placeholder = 'https://example.com'
  urlInput.setAttribute('data-jword-link-url-input', 'true')

  errorText.className = 'jw-link-panel__error'
  errorText.setAttribute('data-jword-link-error', 'true')
  errorText.hidden = true

  cancelButton.type = 'button'
  cancelButton.textContent = readLinkText(i18n, 'cancel', '取消')
  cancelButton.setAttribute('data-jword-link-cancel', 'true')

  confirmButton.type = 'button'
  confirmButton.setAttribute('data-jword-link-confirm', 'true')

  dialogActions.className = 'jw-link-panel__dialog-actions'
  dialogActions.append(cancelButton, confirmButton)
  dialog.append(visibleTextInput, urlInput, errorText, dialogActions)
  root.append(quickTools, dialog)
  host.append(root)

  return {
    host: root,
    quickTools,
    dialog,
    visibleTextInput,
    urlInput,
    errorText,
    confirmButton,
    cancelButton,
    openLinkButton,
    editLinkButton,
    removeLinkButton
  }
}

/** 配置链接快捷工具图标按钮。 */
function configureQuickToolButton(
  button: HTMLButtonElement,
  label: string,
  dataAttribute: string,
  iconName: Parameters<typeof createToolbarIcon>[0]
): void {
  button.type = 'button'
  button.className = 'jw-link-panel__quick-button'
  button.title = label
  button.setAttribute('aria-label', label)
  button.setAttribute(dataAttribute, 'true')
  button.append(createToolbarIcon(iconName))
}

/** 根据当前状态重绘 link panel。 */
export function renderLinkPanel(
  dom: JWordLinkPanelDom,
  state: JWordLinkPanelState,
  policy: JWordLinkUrlPolicy = {},
  i18n: ResolvedJWordUiI18n = resolveJWordUiI18n()
): void {
  dom.quickTools.hidden = state.activeLink === null || !state.quickToolsVisible
  dom.dialog.hidden = state.dialog === null
  dom.editLinkButton.hidden = state.readonly === true
  dom.editLinkButton.disabled = state.readonly === true
  dom.editLinkButton.style.display = state.readonly === true ? 'none' : ''
  dom.removeLinkButton.hidden = state.readonly === true
  dom.removeLinkButton.disabled = state.readonly === true
  dom.removeLinkButton.style.display = state.readonly === true ? 'none' : ''
  dom.openLinkButton.disabled = state.activeLink === null

  if (state.dialog === null) {
    dom.errorText.hidden = true
    dom.errorText.textContent = ''
    return
  }

  const validationError = readLinkValidationError(state.dialog.draft, policy, i18n)
  const errorText = state.dialog.error.length > 0 ? state.dialog.error : validationError

  dom.visibleTextInput.value = state.dialog.draft.visibleText
  dom.visibleTextInput.disabled = state.dialog.busy
  dom.urlInput.value = state.dialog.draft.url
  dom.urlInput.disabled = state.dialog.busy
  dom.errorText.textContent = errorText
  dom.errorText.hidden = errorText.length === 0
  dom.cancelButton.disabled = state.dialog.busy
  dom.confirmButton.disabled = readLinkConfirmDisabled(state.dialog, policy, i18n)
  dom.confirmButton.textContent = state.dialog.mode === 'edit'
    ? readLinkText(i18n, 'save', '保存链接')
    : readLinkText(i18n, 'insert', '插入链接')
}

/** 动态刷新 link panel 静态文案。 */
export function localizeLinkPanelDom(dom: JWordLinkPanelDom, i18n: ResolvedJWordUiI18n): void {
  updateButtonLabel(dom.openLinkButton, readLinkText(i18n, 'open', '打开链接'))
  updateButtonLabel(dom.editLinkButton, readLinkText(i18n, 'edit', '编辑链接'))
  updateButtonLabel(dom.removeLinkButton, readLinkText(i18n, 'remove', '删除链接'))
  dom.visibleTextInput.placeholder = readLinkText(i18n, 'visibleText', '显示文本')
  dom.cancelButton.textContent = readLinkText(i18n, 'cancel', '取消')
}

/** 销毁 link panel DOM。 */
export function destroyLinkPanel(dom: JWordLinkPanelDom): void {
  dom.host.remove()
}

/** 更新链接图标按钮标签。 */
function updateButtonLabel(button: HTMLButtonElement, label: string): void {
  button.title = label
  button.setAttribute('aria-label', label)
}

/** 读取链接弹窗文案。 */
function readLinkText(i18n: ResolvedJWordUiI18n, key: string, fallback: string): string {
  return readJWordUiText(i18n, `dialog.link.${key}`, fallback)
}
