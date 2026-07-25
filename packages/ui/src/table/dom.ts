/**
 * 职责：创建并渲染 Gate 4 表格入口与独立辅助浮层 DOM。
 * 边界：只管理表格工具节点结构和状态展示，不调用 editor 或 command adapter。
 * 协作模块：table controller 绑定交互，table state 生成摘要文案，toolbar icons 提供入口图标。
 * 性能/安全约束：DOM 结构保持轻量，样式不依赖 grid/gap。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import {
  readJWordUiText,
  resolveJWordUiI18n,
  type ResolvedJWordUiI18n
} from '../i18n'
import { createToolbarIcon } from '../toolbar/icons'
import type { JWordTablePanelElements } from '../types'

export interface TablePanelDom extends JWordTablePanelElements {}

interface TablePanelViewState {
  readonly summary: string
  readonly insertRows: number
  readonly insertColumns: number
  readonly previewRows: number
  readonly previewColumns: number
  readonly insertMenuOpen: boolean
  readonly customSizeDialogOpen: boolean
  readonly helperAnchorsVisible: boolean
  readonly quickToolsVisible: boolean
  readonly targetAvailable: boolean
  readonly canDeleteRow: boolean
  readonly canDeleteColumn: boolean
  readonly canMergeRight: boolean
  readonly busy: boolean
}

const PREVIEW_GRID_ROWS = 6
const PREVIEW_GRID_COLUMNS = 6

/** 创建表格工具 DOM。 */
export function createTablePanelDom(
  host: HTMLElement,
  overlayHost: HTMLElement,
  title: string
): JWordTablePanelElements {
  const i18n = resolveJWordUiI18n()
  const root = document.createElement('div')
  const insertTriggerButton = document.createElement('button')
  const insertTriggerLabel = document.createElement('span')
  const insertMenu = document.createElement('div')
  const insertPreviewLabel = document.createElement('p')
  const preview = document.createElement('div')
  const customSizeButton = createButton(readTableText(i18n, 'customSize'), 'data-jword-table-custom-size')
  const customSizeDialog = document.createElement('div')
  const customSizeDialogPanel = document.createElement('div')
  const customSizeDialogTitle = document.createElement('p')
  const insertRowsInput = createNumberInput(readTableText(i18n, 'rows'), 'data-jword-table-insert-rows')
  const insertColumnsInput = createNumberInput(readTableText(i18n, 'columns'), 'data-jword-table-insert-columns')
  const insertConfirmButton = createButton(readTableText(i18n, 'insert'), 'data-jword-table-insert-confirm')
  const customSizeCancelButton = createButton(readTableText(i18n, 'cancel'), 'data-jword-table-custom-size-cancel')
  const overlay = document.createElement('div')
  const topAnchor = document.createElement('button')
  const leftAnchor = document.createElement('button')
  const quickTools = document.createElement('div')
  const summary = document.createElement('p')
  const actionRow = createRow()
  const insertRowBeforeButton = createIconButton(readTableText(i18n, 'insertRowBefore'), 'data-jword-table-action', 'insert-row-before')
  const insertRowAfterButton = createIconButton(readTableText(i18n, 'insertRowAfter'), 'data-jword-table-action', 'insert-row-after')
  const deleteRowButton = createIconButton(readTableText(i18n, 'deleteRow'), 'data-jword-table-action', 'delete-row')
  const insertColumnBeforeButton = createIconButton(readTableText(i18n, 'insertColumnBefore'), 'data-jword-table-action', 'insert-column-before')
  const insertColumnAfterButton = createIconButton(readTableText(i18n, 'insertColumnAfter'), 'data-jword-table-action', 'insert-column-after')
  const deleteColumnButton = createIconButton(readTableText(i18n, 'deleteColumn'), 'data-jword-table-action', 'delete-column')
  const mergeRightButton = createIconButton(readTableText(i18n, 'mergeRight'), 'data-jword-table-action', 'merge-right')
  const insertPreviewButtons: HTMLButtonElement[] = []

  root.className = 'jw-table-toolbar'
  root.setAttribute('data-jword-table-toolbar', 'true')

  insertTriggerButton.type = 'button'
  insertTriggerButton.className = 'jw-toolbar__button jw-table-toolbar__trigger'
  insertTriggerButton.setAttribute('aria-label', title)
  insertTriggerButton.setAttribute('aria-haspopup', 'menu')
  insertTriggerButton.setAttribute('aria-expanded', 'false')
  insertTriggerButton.setAttribute('data-jword-table-insert-trigger', 'true')
  insertTriggerLabel.className = 'jw-table-toolbar__trigger-label'
  insertTriggerLabel.textContent = title
  insertTriggerButton.append(createToolbarIcon('table'), insertTriggerLabel)

  insertMenu.className = 'jw-table-toolbar__insert-menu'
  insertMenu.setAttribute('data-jword-table-insert-menu', 'true')
  insertMenu.hidden = true

  insertPreviewLabel.className = 'jw-table-toolbar__preview-label'
  insertPreviewLabel.setAttribute('data-jword-table-insert-preview-label', 'true')
  insertPreviewLabel.textContent = '1 x 1'

  preview.className = 'jw-table-toolbar__preview'
  for (let rowIndex = 1; rowIndex <= PREVIEW_GRID_ROWS; rowIndex += 1) {
    const previewRow = document.createElement('div')

    previewRow.className = 'jw-table-toolbar__preview-row'

    for (let columnIndex = 1; columnIndex <= PREVIEW_GRID_COLUMNS; columnIndex += 1) {
      const previewButton = document.createElement('button')

      previewButton.type = 'button'
      previewButton.className = 'jw-table-toolbar__preview-cell'
      previewButton.setAttribute('aria-label', readTablePreviewCellText(i18n, rowIndex, columnIndex))
      previewButton.setAttribute('data-jword-table-preview-cell', 'true')
      previewButton.dataset.jwordRows = String(rowIndex)
      previewButton.dataset.jwordColumns = String(columnIndex)
      previewRow.append(previewButton)
      insertPreviewButtons.push(previewButton)
    }

    preview.append(previewRow)
  }

  customSizeDialog.className = 'jw-table-toolbar__dialog'
  customSizeDialog.setAttribute('data-jword-table-custom-size-dialog', 'true')
  customSizeDialog.hidden = true
  customSizeDialogPanel.className = 'jw-table-toolbar__dialog-panel'
  customSizeDialogTitle.className = 'jw-table-toolbar__dialog-title'
  customSizeDialogTitle.textContent = readJWordUiText(i18n, 'dialog.table.customSizeTitle')

  const customSizeFields = createRow()
  customSizeFields.classList.add('jw-table-toolbar__dialog-fields')
  customSizeFields.append(
    createField(readTableText(i18n, 'rows'), insertRowsInput),
    createField(readTableText(i18n, 'columns'), insertColumnsInput)
  )

  const customSizeActions = createRow()
  customSizeActions.className = 'jw-table-toolbar__dialog-actions'
  customSizeCancelButton.classList.add('jw-table-toolbar__dialog-button', 'jw-table-toolbar__dialog-button--secondary')
  insertConfirmButton.classList.add('jw-table-toolbar__dialog-button', 'jw-table-toolbar__dialog-button--primary')
  customSizeActions.append(customSizeCancelButton, insertConfirmButton)

  customSizeDialogPanel.append(customSizeDialogTitle, customSizeFields, customSizeActions)
  customSizeDialog.append(customSizeDialogPanel)
  insertMenu.append(insertPreviewLabel, preview, customSizeButton)

  overlay.className = 'jw-table-panel__overlay'
  overlay.setAttribute('data-jword-table-overlay', 'true')
  overlay.hidden = true

  topAnchor.type = 'button'
  topAnchor.className = 'jw-table-panel__anchor jw-table-panel__anchor--top'
  topAnchor.setAttribute('aria-label', readTableText(i18n, 'openTopTools'))
  topAnchor.setAttribute('data-jword-table-anchor', 'top')
  topAnchor.setAttribute('data-jword-table-anchor-role', 'helper')

  leftAnchor.type = 'button'
  leftAnchor.className = 'jw-table-panel__anchor jw-table-panel__anchor--left'
  leftAnchor.setAttribute('aria-label', readTableText(i18n, 'openLeftTools'))
  leftAnchor.setAttribute('data-jword-table-anchor', 'left')
  leftAnchor.setAttribute('data-jword-table-anchor-role', 'helper')

  quickTools.className = 'jw-table-panel__quick-tools jw-table-toolbar__quick-tools'
  quickTools.setAttribute('data-jword-table-quick-tools', 'true')
  quickTools.hidden = true

  summary.className = 'jw-table-toolbar__summary'
  summary.setAttribute('data-jword-table-summary', 'true')
  summary.hidden = true

  insertRowBeforeButton.classList.add('jw-table-toolbar__action-button')
  insertRowAfterButton.classList.add('jw-table-toolbar__action-button')
  deleteRowButton.classList.add('jw-table-toolbar__action-button')
  insertColumnBeforeButton.classList.add('jw-table-toolbar__action-button')
  insertColumnAfterButton.classList.add('jw-table-toolbar__action-button')
  deleteColumnButton.classList.add('jw-table-toolbar__action-button')
  mergeRightButton.classList.add('jw-table-toolbar__action-button')

  decorateActionButton(insertRowBeforeButton, createTableActionGlyph('row-before'))
  decorateActionButton(insertRowAfterButton, createTableActionGlyph('row-after'))
  decorateActionButton(deleteRowButton, createTableActionGlyph('row-delete'))
  decorateActionButton(insertColumnBeforeButton, createTableActionGlyph('column-before'))
  decorateActionButton(insertColumnAfterButton, createTableActionGlyph('column-after'))
  decorateActionButton(deleteColumnButton, createTableActionGlyph('column-delete'))
  decorateActionButton(mergeRightButton, createTableActionGlyph('merge-right'))

  actionRow.className = 'jw-table-toolbar__group-row jw-table-toolbar__action-row'
  actionRow.append(
    insertRowBeforeButton,
    insertRowAfterButton,
    deleteRowButton,
    insertColumnBeforeButton,
    insertColumnAfterButton,
    deleteColumnButton,
    mergeRightButton
  )

  quickTools.append(summary)
  overlay.append(topAnchor, leftAnchor, quickTools)

  root.append(insertTriggerButton, insertMenu, actionRow)
  host.append(root)
  resolveOverlayMountHost(overlayHost).append(overlay)
  resolveDialogMountHost(overlayHost).append(customSizeDialog)

  return {
    host: root,
    overlay,
    insertTriggerButton,
    insertMenu,
    insertPreviewLabel,
    insertPreviewButtons,
    customSizeDialog,
    customSizeButton,
    customSizeCancelButton,
    topAnchor,
    leftAnchor,
    quickTools,
    summary,
    insertRowsInput,
    insertColumnsInput,
    insertConfirmButton,
    insertRowBeforeButton,
    insertRowAfterButton,
    deleteRowButton,
    insertColumnBeforeButton,
    insertColumnAfterButton,
    deleteColumnButton,
    mergeRightButton
  }
}

/** 动态刷新表格工具文案。 */
export function localizeTablePanelDom(dom: JWordTablePanelElements, i18n: ResolvedJWordUiI18n, title: string): void {
  const triggerLabel = dom.insertTriggerButton.querySelector<HTMLElement>('.jw-table-toolbar__trigger-label')
  const dialogTitle = dom.customSizeDialog.querySelector<HTMLElement>('.jw-table-toolbar__dialog-title')
  const fieldLabels = dom.customSizeDialog.querySelectorAll<HTMLElement>('.jw-table-toolbar__field-label')

  setButtonText(dom.insertTriggerButton, title)
  if (triggerLabel !== null) {
    triggerLabel.textContent = title
  }
  setButtonText(dom.customSizeButton, readTableText(i18n, 'customSize'))
  setButtonText(dom.customSizeCancelButton, readTableText(i18n, 'cancel'))
  setButtonText(dom.insertConfirmButton, readTableText(i18n, 'insert'))
  dom.insertRowsInput.setAttribute('aria-label', readTableText(i18n, 'rows'))
  dom.insertColumnsInput.setAttribute('aria-label', readTableText(i18n, 'columns'))
  if (fieldLabels[0] !== undefined) {
    fieldLabels[0].textContent = readTableText(i18n, 'rows')
  }
  if (fieldLabels[1] !== undefined) {
    fieldLabels[1].textContent = readTableText(i18n, 'columns')
  }
  if (dialogTitle !== null) {
    dialogTitle.textContent = readJWordUiText(i18n, 'dialog.table.customSizeTitle')
  }
  setButtonText(dom.insertRowBeforeButton, readTableText(i18n, 'insertRowBefore'))
  setButtonText(dom.insertRowAfterButton, readTableText(i18n, 'insertRowAfter'))
  setButtonText(dom.deleteRowButton, readTableText(i18n, 'deleteRow'))
  setButtonText(dom.insertColumnBeforeButton, readTableText(i18n, 'insertColumnBefore'))
  setButtonText(dom.insertColumnAfterButton, readTableText(i18n, 'insertColumnAfter'))
  setButtonText(dom.deleteColumnButton, readTableText(i18n, 'deleteColumn'))
  setButtonText(dom.mergeRightButton, readTableText(i18n, 'mergeRight'))
  dom.topAnchor.setAttribute('aria-label', readTableText(i18n, 'openTopTools'))
  dom.leftAnchor.setAttribute('aria-label', readTableText(i18n, 'openLeftTools'))

  for (const button of dom.insertPreviewButtons) {
    const rows = Number.parseInt(button.dataset.jwordRows ?? '0', 10)
    const columns = Number.parseInt(button.dataset.jwordColumns ?? '0', 10)

    button.setAttribute('aria-label', readTablePreviewCellText(i18n, rows, columns))
  }
}

/** 渲染表格工具状态。 */
export function renderTablePanel(dom: JWordTablePanelElements, state: TablePanelViewState): void {
  dom.insertTriggerButton.setAttribute('aria-expanded', String(state.insertMenuOpen))
  dom.insertTriggerButton.setAttribute('data-jword-open', String(state.insertMenuOpen))
  dom.insertMenu.hidden = !state.insertMenuOpen
  dom.insertPreviewLabel.textContent = `${state.previewRows} x ${state.previewColumns}`
  dom.customSizeDialog.hidden = !state.customSizeDialogOpen
  dom.quickTools.hidden = !state.targetAvailable || !state.quickToolsVisible
  dom.topAnchor.hidden = !state.targetAvailable || !state.helperAnchorsVisible
  dom.leftAnchor.hidden = !state.targetAvailable || !state.helperAnchorsVisible
  dom.summary.hidden = true
  dom.summary.textContent = state.summary
  dom.insertRowsInput.value = String(state.insertRows)
  dom.insertColumnsInput.value = String(state.insertColumns)
  dom.insertTriggerButton.disabled = state.busy
  dom.customSizeButton.disabled = state.busy
  dom.insertRowsInput.disabled = state.busy
  dom.insertColumnsInput.disabled = state.busy
  dom.insertConfirmButton.disabled = state.busy
  dom.customSizeCancelButton.disabled = state.busy
  dom.topAnchor.disabled = state.busy || !state.targetAvailable
  dom.leftAnchor.disabled = state.busy || !state.targetAvailable
  dom.insertRowBeforeButton.disabled = state.busy || !state.targetAvailable
  dom.insertRowAfterButton.disabled = state.busy || !state.targetAvailable
  dom.deleteRowButton.disabled = state.busy || !state.canDeleteRow
  dom.insertColumnBeforeButton.disabled = state.busy || !state.targetAvailable
  dom.insertColumnAfterButton.disabled = state.busy || !state.targetAvailable
  dom.deleteColumnButton.disabled = state.busy || !state.canDeleteColumn
  dom.mergeRightButton.disabled = state.busy || !state.canMergeRight

  for (const button of dom.insertPreviewButtons) {
    const row = Number.parseInt(button.dataset.jwordRows ?? '0', 10)
    const column = Number.parseInt(button.dataset.jwordColumns ?? '0', 10)
    const active = row <= state.previewRows && column <= state.previewColumns

    button.disabled = state.busy
    button.setAttribute('data-jword-active', String(active))
  }
}

/** 销毁表格工具 DOM。 */
export function destroyTablePanel(dom: JWordTablePanelElements): void {
  dom.customSizeDialog.remove()
  dom.overlay.remove()
  dom.host.remove()
}

/** 创建数值输入。 */
function createNumberInput(label: string, dataAttribute: string): HTMLInputElement {
  const input = document.createElement('input')

  input.type = 'number'
  input.min = '1'
  input.max = '12'
  input.value = '2'
  input.className = 'jw-table-toolbar__input'
  input.setAttribute('aria-label', label)
  input.setAttribute(dataAttribute, 'true')

  return input
}

/** 创建按钮。 */
function createButton(label: string, dataAttribute: string, dataValue = 'true'): HTMLButtonElement {
  const button = document.createElement('button')

  button.type = 'button'
  button.className = 'jw-toolbar__button jw-table-toolbar__button'
  button.textContent = label
  button.setAttribute('aria-label', label)
  button.title = label
  button.setAttribute(dataAttribute, dataValue)

  return button
}

/** 更新按钮文案、title 与 aria-label。 */
function setButtonText(button: HTMLButtonElement, text: string): void {
  const actionLabel = button.querySelector<HTMLElement>('.jw-table-toolbar__action-label')

  if (
    !button.classList.contains('jw-table-toolbar__icon-button')
    && button.querySelector('.jw-table-toolbar__trigger-label') === null
  ) {
    button.textContent = text
  }
  if (actionLabel !== null) {
    actionLabel.textContent = text
  }
  button.title = text
  button.setAttribute('aria-label', text)
}

/** 创建图标动作按钮。 */
function createIconButton(label: string, dataAttribute: string, dataValue = 'true'): HTMLButtonElement {
  const button = createButton(label, dataAttribute, dataValue)

  button.classList.add('jw-table-toolbar__icon-button')

  return button
}

/** 创建一行 flex 容器。 */
function createRow(): HTMLDivElement {
  const row = document.createElement('div')

  row.className = 'jw-table-toolbar__row'

  return row
}

/** 创建带可见标签的输入项。 */
function createField(label: string, input: HTMLInputElement): HTMLLabelElement {
  const field = document.createElement('label')
  const labelNode = document.createElement('span')

  field.className = 'jw-table-toolbar__field'
  labelNode.className = 'jw-table-toolbar__field-label'
  labelNode.textContent = label
  field.append(labelNode, input)

  return field
}

/** 读取表格工具文案。 */
function readTableText(i18n: ResolvedJWordUiI18n, key: string): string {
  return readJWordUiText(i18n, `menu.table.${key}`)
}

/** 读取表格预览单元格文案。 */
function readTablePreviewCellText(i18n: ResolvedJWordUiI18n, rows: number, columns: number): string {
  return readTableText(i18n, 'previewCell')
    .replace('{rows}', String(rows))
    .replace('{columns}', String(columns))
}

/** 解析 overlay 挂载宿主。 */
function resolveOverlayMountHost(overlayHost: HTMLElement): HTMLElement {
  return overlayHost.querySelector<HTMLElement>('[data-jword-canvas-container]') ?? overlayHost
}

/** 解析自定义尺寸弹层挂载宿主。 */
function resolveDialogMountHost(overlayHost: HTMLElement): HTMLElement {
  overlayHost.style.position = overlayHost.style.position || 'relative'

  return overlayHost
}

type TableActionGlyphKind =
  | 'row-before'
  | 'row-after'
  | 'row-delete'
  | 'column-before'
  | 'column-after'
  | 'column-delete'
  | 'merge-right'

/** 为动作按钮挂载图标化内容。 */
function decorateActionButton(button: HTMLButtonElement, glyph: HTMLElement): void {
  const label = document.createElement('span')

  label.className = 'jw-table-toolbar__action-label'
  label.textContent = button.getAttribute('aria-label') ?? ''
  button.replaceChildren(glyph, label)
}

/** 创建表格动作图标。 */
function createTableActionGlyph(kind: TableActionGlyphKind): HTMLElement {
  const glyph = document.createElement('span')
  const baseIcon = createToolbarIcon(resolveTableActionBaseIcon(kind))

  glyph.className = 'jw-table-toolbar__glyph'
  glyph.setAttribute('aria-hidden', 'true')
  baseIcon.classList.add('jw-table-toolbar__glyph-icon')
  glyph.append(baseIcon)

  const badge = createTableActionBadge(kind)

  if (badge !== null) {
    glyph.append(badge)
  }

  return glyph
}

/** 读取动作图标的底图。 */
function resolveTableActionBaseIcon(kind: TableActionGlyphKind): Parameters<typeof createToolbarIcon>[0] {
  if (kind === 'row-delete' || kind === 'column-delete') {
    return 'trash'
  }

  if (kind === 'merge-right') {
    return 'layout'
  }

  return 'table'
}

/** 创建动作图标右下角的小标记。 */
function createTableActionBadge(kind: TableActionGlyphKind): HTMLElement | null {
  const badge = document.createElement('span')

  badge.className = 'jw-table-toolbar__glyph-badge'

  if (kind === 'merge-right') {
    badge.classList.add('jw-table-toolbar__glyph-badge--arrow')
    badge.textContent = '→'
    return badge
  }

  if (kind === 'row-before') {
    badge.classList.add('jw-table-toolbar__glyph-badge--edge-top')
    badge.textContent = '+'
    return badge
  }

  if (kind === 'row-after') {
    badge.classList.add('jw-table-toolbar__glyph-badge--edge-bottom')
    badge.textContent = '+'
    return badge
  }

  if (kind === 'column-before') {
    badge.classList.add('jw-table-toolbar__glyph-badge--edge-left')
    badge.textContent = '+'
    return badge
  }

  if (kind === 'column-after') {
    badge.classList.add('jw-table-toolbar__glyph-badge--edge-right')
    badge.textContent = '+'
    return badge
  }

  if (kind === 'row-delete') {
    badge.classList.add('jw-table-toolbar__glyph-badge--row-delete')
    badge.textContent = '−'
    return badge
  }

  if (kind === 'column-delete') {
    badge.classList.add('jw-table-toolbar__glyph-badge--column-delete')
    badge.textContent = '−'
    return badge
  }

  return null
}
