/**
 * 职责：同步 toolbar 本地化文案和 editor 事件对应的辅助播报。
 * 边界：只处理用户可感知文案，不绑定编辑命令或保存第二套编辑状态。
 * 协作模块：controller 提供生命周期，dom、state 和 page-size-dialog 提供文案来源与目标节点。
 * 性能/安全约束：只更新已存在的节点，不创建新的编辑器状态。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import {
  readJWordUiText,
  type ResolvedJWordUiI18n
} from '../i18n'
import type { Editor } from '@4xian/jword-core'
import type { JWordUiI18nKey } from '../types'
import {
  readSelectionAnnouncement,
  readTransactionAnnouncement,
  shouldAnnounceTransaction
} from './state'
import type { ToolbarStateSyncHandle } from './toolbar-state-sync'

interface CreateToolbarEditorAnnouncementsOptions {
  readonly editor: Editor
  readonly stateSync: ToolbarStateSyncHandle
  readonly readI18n: () => ResolvedJWordUiI18n
  render(): void
  announceDestroyed(): void
}

export interface ToolbarEditorAnnouncementsHandle {
  markToolbarTransaction(): void
  destroy(): void
}

/** 创建 editor 事件对应的 toolbar 辅助播报订阅。 */
export function createToolbarEditorAnnouncements(
  options: CreateToolbarEditorAnnouncementsOptions
): ToolbarEditorAnnouncementsHandle {
  let suppressSelectionAnnouncementsUntil = 0
  let suppressAfterToolbarTransaction = false
  const unsubscribe = options.editor.subscribe((event) => {
    if (event.kind === 'selectionChange') {
      options.render()
      options.stateSync.syncTextMirror()

      if (performance.now() >= suppressSelectionAnnouncementsUntil) {
        options.stateSync.announce(readSelectionAnnouncement(options.editor, event.selection, options.readI18n()))
      }

      return
    }

    if (event.kind === 'transaction') {
      options.render()

      if (shouldAnnounceTransaction(event.transaction.commandName)) {
        if (suppressAfterToolbarTransaction) {
          suppressSelectionAnnouncementsUntil = performance.now() + 160
        }

        suppressAfterToolbarTransaction = false
        options.stateSync.announce(readTransactionAnnouncement(
          options.editor,
          event.transaction.commandName,
          options.readI18n()
        ), true)
      }

      return
    }

    if (event.kind === 'destroyed') {
      options.announceDestroyed()
    }
  })

  /** 标记下一次 toolbar 事务应压住紧随其后的选区播报。 */
  function markToolbarTransaction(): void {
    suppressAfterToolbarTransaction = true

    queueMicrotask(() => {
      suppressAfterToolbarTransaction = false
    })
  }

  return {
    markToolbarTransaction,
    destroy: unsubscribe
  }
}

/** 绑定 toolbar 模式和 Tab 切换后的辅助播报。 */
export function bindToolbarLayoutAnnouncements(
  host: HTMLElement,
  readI18n: () => ResolvedJWordUiI18n,
  announce: (message: string) => void,
  signal: AbortSignal
): void {
  host.addEventListener('jword-toolbar-modechange', (event) => {
    const mode = readToolbarCustomEventDetail(event, 'mode')

    if (mode === null) {
      return
    }

    const i18n = readI18n()
    const modeLabel = readJWordUiText(
      i18n,
      mode === 'common' ? 'toolbar.mode.common' : 'toolbar.mode.professional'
    )
    const template = readJWordUiText(i18n, 'a11y.toolbar.modeChanged')

    announce(template.replace('{mode}', modeLabel))
  }, { signal })

  host.addEventListener('jword-toolbar-tabchange', (event) => {
    const tab = readToolbarCustomEventDetail(event, 'tab')

    if (tab === null) {
      return
    }

    const i18n = readI18n()
    const tabLabel = readJWordUiText(i18n, `toolbar.tabs.${tab}` as JWordUiI18nKey)
    const template = readJWordUiText(i18n, 'a11y.toolbar.tabChanged')

    announce(template.replace('{tab}', tabLabel))
  }, { signal })
}

/** 刷新 toolbar 内部插件消费者文案。 */
export function localizeInternalToolbarPluginControls(bar: HTMLElement, i18n: ResolvedJWordUiI18n): void {
  const pagePreset = bar.querySelector<HTMLElement>('[data-jword-plugin-menu-key="plugin:jword.ui:pagePreset"]')

  if (pagePreset === null) {
    return
  }

  const label = readJWordUiText(i18n, 'menu.pagePreset.label')
  const ariaLabel = readJWordUiText(i18n, 'menu.pagePreset.ariaLabel')
  const tooltip = readJWordUiText(i18n, 'menu.pagePreset.tooltip')
  const trigger = pagePreset.querySelector<HTMLButtonElement>('.jw-toolbar__select-trigger')
  const labelNode = pagePreset.querySelector<HTMLElement>('.jw-toolbar__select-label')
  const fieldLabelNode = pagePreset.querySelector<HTMLElement>('.jw-toolbar__select-field-label')
  const tooltipNode = pagePreset.closest<HTMLElement>('.jw-toolbar__tooltip-anchor')?.querySelector<HTMLElement>('[role="tooltip"]')

  pagePreset.setAttribute('data-jword-field-label', label)
  trigger?.setAttribute('aria-label', ariaLabel)
  if (labelNode !== null) {
    labelNode.textContent = label
  }
  if (fieldLabelNode !== null) {
    fieldLabelNode.textContent = label
  }
  if (tooltipNode !== null && tooltipNode !== undefined) {
    tooltipNode.textContent = tooltip
  }

  for (const option of pagePreset.querySelectorAll<HTMLButtonElement>('.jw-toolbar__select-option')) {
    localizeInternalPagePresetOption(option, i18n)
  }
}

/** 刷新已打开的自定义页面大小弹窗文案。 */
export function localizePageSizeDialog(host: HTMLElement, i18n: ResolvedJWordUiI18n): void {
  const dialog = host.querySelector<HTMLElement>('[data-jword-page-size-dialog="true"]')

  if (dialog === null) {
    return
  }

  const title = dialog.querySelector<HTMLElement>('[data-jword-page-size-title="true"]')
  const description = dialog.querySelector<HTMLElement>('[data-jword-page-size-description="true"]')
  const cancel = dialog.querySelector<HTMLButtonElement>('[data-jword-page-size-cancel="true"]')
  const apply = dialog.querySelector<HTMLButtonElement>('[data-jword-page-size-apply="true"]')
  const error = dialog.querySelector<HTMLElement>('[data-jword-page-size-error="true"]')
  const unit = readJWordUiText(i18n, 'dialog.pageSize.unitCm')

  if (title !== null) {
    title.textContent = readJWordUiText(i18n, 'dialog.pageSize.title')
  }
  if (description !== null) {
    description.textContent = readJWordUiText(i18n, 'dialog.pageSize.description')
  }
  if (cancel !== null) {
    cancel.textContent = readJWordUiText(i18n, 'dialog.pageSize.cancel')
  }
  if (apply !== null) {
    apply.textContent = readJWordUiText(i18n, 'dialog.pageSize.apply')
  }
  if (error !== null && error.textContent !== '') {
    const errorKey = error.getAttribute('data-jword-page-size-error-key')

    if (errorKey === 'dialog.pageSize.errorInvalid' || errorKey === 'dialog.pageSize.errorContent') {
      error.textContent = readJWordUiText(i18n, errorKey)
    }
  }

  for (const field of dialog.querySelectorAll<HTMLElement>('[data-jword-page-size-field]')) {
    localizePageSizeDialogField(field, i18n, unit)
  }
}

/** 读取 toolbar 自定义事件中的字符串 detail。 */
function readToolbarCustomEventDetail(event: Event, key: string): string | null {
  if (!('detail' in event) || typeof event.detail !== 'object' || event.detail === null) {
    return null
  }

  const value = (event.detail as Record<string, unknown>)[key]

  return typeof value === 'string' ? value : null
}

/** 刷新默认页面尺寸菜单单个选项文案。 */
function localizeInternalPagePresetOption(option: HTMLButtonElement, i18n: ResolvedJWordUiI18n): void {
  const optionName = option.getAttribute('data-jword-plugin-menu-item')
  const labelNode = option.querySelector<HTMLElement>('.jw-toolbar__select-option-label')
  const descriptionNode = option.querySelector<HTMLElement>('.jw-toolbar__select-option-description')

  if (optionName === null || labelNode === null) {
    return
  }

  const label = readJWordUiText(i18n, readPagePresetOptionLabelKey(optionName))
  const description = descriptionNode === null
    ? ''
    : readJWordUiText(i18n, `menu.pagePreset.option.${optionName}.size`)

  labelNode.textContent = label
  if (descriptionNode !== null) {
    descriptionNode.textContent = description
  }
  option.setAttribute('aria-label', `${label} ${description}`.trim())
}

/** 读取页面尺寸菜单选项 label 的 i18n key。 */
function readPagePresetOptionLabelKey(optionName: string): JWordUiI18nKey {
  return optionName === 'custom'
    ? 'menu.pagePreset.option.custom.label'
    : `toolbar.document.pagePreset.option.${optionName}` as JWordUiI18nKey
}

/** 刷新自定义页面大小弹窗单个字段文案。 */
function localizePageSizeDialogField(field: HTMLElement, i18n: ResolvedJWordUiI18n, unit: string): void {
  const fieldName = field.getAttribute('data-jword-page-size-field')
  const label = field.querySelector<HTMLElement>('.jw-page-size-dialog__field-label')
  const input = field.querySelector<HTMLInputElement>('.jw-page-size-dialog__input')
  const unitNode = field.querySelector<HTMLElement>('.jw-page-size-dialog__unit')

  if (fieldName === null || label === null) {
    return
  }

  const labelText = readJWordUiText(i18n, readPageSizeFieldLabelKey(fieldName))

  label.textContent = labelText
  input?.setAttribute('aria-label', labelText)
  if (unitNode !== null) {
    unitNode.textContent = unit
  }
}

/** 读取自定义页面大小字段 label 的 i18n key。 */
function readPageSizeFieldLabelKey(fieldName: string): JWordUiI18nKey {
  return `dialog.pageSize.${fieldName}` as JWordUiI18nKey
}
