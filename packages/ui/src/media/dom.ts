/**
 * 职责：创建并渲染 Gate 4 toolbar 内图片入口 DOM。
 * 边界：只负责节点结构、稳定 data-attributes 和纯展示，不调用 editor 或上传适配器。
 * 协作模块：media controller 绑定交互并维护状态，toolbar controller 提供挂载点。
 * 性能/安全约束：保持结构紧凑，不再生成独立大面板，只保留 toolbar 下拉和 URL 弹框。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import {
  readJWordUiText,
  resolveJWordUiI18n,
  type ResolvedJWordUiI18n
} from '../i18n'
import { createToolbarIcon } from '../toolbar/icons'
import type { JWordMediaPanelElements } from '../types'

interface MediaToolbarViewState {
  readonly menuOpen: boolean
  readonly urlDialogOpen: boolean
  readonly urlValue: string
  readonly urlError: string
  readonly busy: boolean
}

/** toolbar 图片入口 DOM 句柄。 */
export interface MediaPanelDom extends JWordMediaPanelElements {}

/** 在 toolbar 分组里创建图片入口。 */
export function createMediaPanelDom(host: HTMLElement, title: string): MediaPanelDom {
  const i18n = resolveJWordUiI18n()
  const root = document.createElement('div')
  const triggerButton = document.createElement('button')
  const triggerLabel = document.createElement('span')
  const menu = document.createElement('div')
  const fileActionButton = document.createElement('button')
  const urlActionButton = document.createElement('button')
  const fileInput = document.createElement('input')
  const urlDialog = document.createElement('div')
  const dialogCard = document.createElement('div')
  const dialogTitle = document.createElement('h3')
  const dialogDescription = document.createElement('p')
  const dialogInput = document.createElement('input')
  const dialogError = document.createElement('p')
  const dialogActions = document.createElement('div')
  const dialogCancelButton = document.createElement('button')
  const dialogConfirmButton = document.createElement('button')

  root.className = 'jw-media-toolbar'
  root.setAttribute('data-jword-media-toolbar', 'true')

  triggerButton.type = 'button'
  triggerButton.className = 'jw-toolbar__button jw-media-toolbar__trigger'
  triggerButton.setAttribute('aria-label', title)
  triggerButton.setAttribute('aria-haspopup', 'menu')
  triggerButton.setAttribute('aria-expanded', 'false')
  triggerButton.setAttribute('data-jword-media-trigger', 'true')
  triggerButton.append(createToolbarIcon('image'))
  triggerLabel.className = 'jw-media-toolbar__trigger-label'
  triggerLabel.textContent = title
  triggerButton.append(triggerLabel)

  menu.className = 'jw-toolbar__select-menu jw-media-toolbar__menu'
  menu.setAttribute('data-jword-media-menu', 'true')
  menu.hidden = true

  fileActionButton.type = 'button'
  fileActionButton.className = 'jw-toolbar__select-option jw-media-toolbar__menu-button'
  fileActionButton.textContent = readMediaText(i18n, 'localUpload')
  fileActionButton.setAttribute('data-jword-media-action-file', 'true')

  urlActionButton.type = 'button'
  urlActionButton.className = 'jw-toolbar__select-option jw-media-toolbar__menu-button'
  urlActionButton.textContent = readMediaText(i18n, 'url')
  urlActionButton.setAttribute('data-jword-media-action-url', 'true')

  menu.append(fileActionButton, urlActionButton)

  fileInput.type = 'file'
  fileInput.accept = 'image/*,.svg'
  fileInput.className = 'jw-media-toolbar__file-input'
  fileInput.setAttribute('data-jword-media-file-input', 'true')
  fileInput.setAttribute('aria-hidden', 'true')
  fileInput.tabIndex = -1

  urlDialog.className = 'jw-media-toolbar__dialog'
  urlDialog.setAttribute('data-jword-media-url-dialog', 'true')
  urlDialog.hidden = true

  dialogCard.className = 'jw-media-toolbar__dialog-card'
  dialogTitle.className = 'jw-media-toolbar__dialog-title'
  dialogTitle.textContent = readJWordUiText(i18n, 'dialog.media.urlTitle')
  dialogDescription.className = 'jw-media-toolbar__dialog-description'
  dialogDescription.textContent = readJWordUiText(i18n, 'dialog.media.urlDescription')
  dialogInput.type = 'url'
  dialogInput.className = 'jw-media-toolbar__dialog-input'
  dialogInput.placeholder = readJWordUiText(i18n, 'dialog.media.urlPlaceholder')
  dialogInput.setAttribute('data-jword-media-url-dialog-input', 'true')
  dialogError.className = 'jw-media-toolbar__dialog-error'
  dialogError.setAttribute('data-jword-media-url-dialog-error', 'true')

  dialogActions.className = 'jw-media-toolbar__dialog-actions'
  dialogCancelButton.type = 'button'
  dialogCancelButton.className = 'jw-media-toolbar__dialog-button'
  dialogCancelButton.textContent = readJWordUiText(i18n, 'dialog.media.cancel')
  dialogCancelButton.setAttribute('data-jword-media-url-dialog-cancel', 'true')
  dialogConfirmButton.type = 'button'
  dialogConfirmButton.className = 'jw-media-toolbar__dialog-button jw-media-toolbar__dialog-button--primary'
  dialogConfirmButton.textContent = readJWordUiText(i18n, 'dialog.media.confirm')
  dialogConfirmButton.setAttribute('data-jword-media-url-dialog-confirm', 'true')
  dialogActions.append(dialogCancelButton, dialogConfirmButton)

  dialogCard.append(dialogTitle, dialogDescription, dialogInput, dialogError, dialogActions)
  urlDialog.append(dialogCard)
  root.append(triggerButton, menu, fileInput, urlDialog)
  host.append(root)

  return {
    host: root,
    triggerButton,
    menu,
    fileActionButton,
    urlActionButton,
    fileInput,
    urlDialog,
    urlDialogInput: dialogInput,
    urlDialogConfirmButton: dialogConfirmButton,
    urlDialogCancelButton: dialogCancelButton,
    urlDialogError: dialogError
  }
}

/** 动态刷新图片入口文案。 */
export function localizeMediaPanelDom(dom: MediaPanelDom, i18n: ResolvedJWordUiI18n, title: string): void {
  const triggerLabel = dom.triggerButton.querySelector<HTMLElement>('.jw-media-toolbar__trigger-label')
  const dialogTitle = dom.urlDialog.querySelector<HTMLElement>('.jw-media-toolbar__dialog-title')
  const dialogDescription = dom.urlDialog.querySelector<HTMLElement>('.jw-media-toolbar__dialog-description')

  dom.triggerButton.setAttribute('aria-label', title)
  dom.triggerButton.title = title
  if (triggerLabel !== null) {
    triggerLabel.textContent = title
  }
  dom.fileActionButton.textContent = readMediaText(i18n, 'localUpload')
  dom.urlActionButton.textContent = readMediaText(i18n, 'url')
  if (dialogTitle !== null) {
    dialogTitle.textContent = readJWordUiText(i18n, 'dialog.media.urlTitle')
  }
  if (dialogDescription !== null) {
    dialogDescription.textContent = readJWordUiText(i18n, 'dialog.media.urlDescription')
  }
  dom.urlDialogInput.placeholder = readJWordUiText(i18n, 'dialog.media.urlPlaceholder')
  dom.urlDialogCancelButton.textContent = readJWordUiText(i18n, 'dialog.media.cancel')
  dom.urlDialogConfirmButton.textContent = readJWordUiText(i18n, 'dialog.media.confirm')
}

/** 根据当前状态重绘 toolbar 图片入口。 */
export function renderMediaPanel(dom: MediaPanelDom, state: MediaToolbarViewState): void {
  dom.triggerButton.disabled = state.busy
  dom.triggerButton.setAttribute('aria-expanded', String(state.menuOpen))
  dom.triggerButton.setAttribute('data-jword-open', String(state.menuOpen))
  dom.menu.hidden = !state.menuOpen
  dom.fileActionButton.disabled = state.busy
  dom.urlActionButton.disabled = state.busy
  dom.urlDialog.hidden = !state.urlDialogOpen
  dom.urlDialogInput.value = state.urlValue
  dom.urlDialogInput.disabled = state.busy
  dom.urlDialogConfirmButton.disabled = state.busy
  dom.urlDialogCancelButton.disabled = state.busy
  dom.urlDialogError.textContent = state.urlError
  dom.urlDialogError.hidden = state.urlError.length === 0
}

/** 销毁图片入口 DOM。 */
export function destroyMediaPanel(dom: MediaPanelDom): void {
  dom.host.remove()
}

/** 重置文件输入框，避免重复上传同一文件时浏览器不触发 change。 */
export function resetMediaFileInput(dom: MediaPanelDom): void {
  dom.fileInput.value = ''
}

/** 读取图片入口文案。 */
function readMediaText(i18n: ResolvedJWordUiI18n, key: string): string {
  return readJWordUiText(i18n, `menu.media.${key}`)
}
