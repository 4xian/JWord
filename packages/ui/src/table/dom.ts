/**
 * 职责：创建并渲染 Gate 4 表格入口与独立辅助浮层 DOM。
 * 边界：只管理表格工具节点结构和状态展示，不调用 editor 或 command adapter。
 * 协作模块：table controller 绑定交互，table state 生成摘要文案，toolbar icons 提供入口图标。
 * 性能/安全约束：DOM 结构保持轻量，样式不依赖 grid/gap。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md Step 4.7。
 */
import { createToolbarIcon } from '../toolbar/icons'
import type { JWordTableBorderPreset, JWordTablePanelElements, JWordTableSelectionScope } from '../types'
import { readBorderPresetLabel } from './state'

export interface TablePanelDom extends JWordTablePanelElements {}

interface TablePanelViewState {
  readonly summary: string
  readonly insertRows: number
  readonly insertColumns: number
  readonly previewRows: number
  readonly previewColumns: number
  readonly insertMenuOpen: boolean
  readonly customSizeDialogOpen: boolean
  readonly quickToolsVisible: boolean
  readonly scope: JWordTableSelectionScope
  readonly borderPreset: JWordTableBorderPreset
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
  const root = document.createElement('div')
  const insertTriggerButton = document.createElement('button')
  const insertMenu = document.createElement('div')
  const insertPreviewLabel = document.createElement('p')
  const preview = document.createElement('div')
  const customSizeButton = createButton('自定义行列', 'data-jword-table-custom-size')
  const customSizeDialog = document.createElement('div')
  const customSizeDialogTitle = document.createElement('p')
  const insertRowsInput = createNumberInput('行数', 'data-jword-table-insert-rows')
  const insertColumnsInput = createNumberInput('列数', 'data-jword-table-insert-columns')
  const insertConfirmButton = createButton('插入表格', 'data-jword-table-insert-confirm')
  const customSizeCancelButton = createButton('取消', 'data-jword-table-custom-size-cancel')
  const overlay = document.createElement('div')
  const topAnchor = document.createElement('button')
  const leftAnchor = document.createElement('button')
  const quickTools = document.createElement('div')
  const summary = document.createElement('p')
  const actionRow = createRow()
  const secondaryRow = createRow()
  const scopeGroup = createRow()
  const borderGroup = createRow()
  const scopeCellButton = createButton('单元格', 'data-jword-table-scope', 'cell')
  const scopeRowButton = createButton('行', 'data-jword-table-scope', 'row')
  const scopeColumnButton = createButton('列', 'data-jword-table-scope', 'column')
  const insertRowBeforeButton = createButton('上方插入行', 'data-jword-table-action', 'insert-row-before')
  const insertRowAfterButton = createButton('下方插入行', 'data-jword-table-action', 'insert-row-after')
  const deleteRowButton = createButton('删除行', 'data-jword-table-action', 'delete-row')
  const insertColumnBeforeButton = createButton('左侧插入列', 'data-jword-table-action', 'insert-column-before')
  const insertColumnAfterButton = createButton('右侧插入列', 'data-jword-table-action', 'insert-column-after')
  const deleteColumnButton = createButton('删除列', 'data-jword-table-action', 'delete-column')
  const mergeRightButton = createButton('向右合并', 'data-jword-table-action', 'merge-right')
  const borderPresetSelect = document.createElement('select')
  const applyBorderButton = createButton('边框', 'data-jword-table-apply-border')
  const insertPreviewButtons: HTMLButtonElement[] = []

  root.className = 'jw-table-toolbar'
  root.setAttribute('data-jword-table-toolbar', 'true')

  insertTriggerButton.type = 'button'
  insertTriggerButton.className = 'jw-toolbar__button jw-table-toolbar__trigger'
  insertTriggerButton.setAttribute('aria-label', title)
  insertTriggerButton.setAttribute('aria-haspopup', 'menu')
  insertTriggerButton.setAttribute('aria-expanded', 'false')
  insertTriggerButton.setAttribute('data-jword-table-insert-trigger', 'true')
  insertTriggerButton.append(createToolbarIcon('table'))

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
      previewButton.setAttribute('aria-label', `${rowIndex} 行 ${columnIndex} 列`)
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
  customSizeDialogTitle.className = 'jw-table-toolbar__dialog-title'
  customSizeDialogTitle.textContent = '自定义表格尺寸'

  const customSizeFields = createRow()
  customSizeFields.append(
    createField('行数', insertRowsInput),
    createField('列数', insertColumnsInput)
  )

  const customSizeActions = createRow()
  customSizeActions.className = 'jw-table-toolbar__dialog-actions'
  customSizeActions.append(customSizeCancelButton, insertConfirmButton)

  customSizeDialog.append(customSizeDialogTitle, customSizeFields, customSizeActions)
  insertMenu.append(insertPreviewLabel, preview, customSizeButton, customSizeDialog)

  overlay.className = 'jw-table-panel__overlay'
  overlay.setAttribute('data-jword-table-overlay', 'true')
  overlay.hidden = true

  topAnchor.type = 'button'
  topAnchor.className = 'jw-table-panel__anchor jw-table-panel__anchor--top'
  topAnchor.setAttribute('aria-label', '打开表格顶部快捷工具')
  topAnchor.setAttribute('data-jword-table-anchor', 'top')

  leftAnchor.type = 'button'
  leftAnchor.className = 'jw-table-panel__anchor jw-table-panel__anchor--left'
  leftAnchor.setAttribute('aria-label', '打开表格左侧快捷工具')
  leftAnchor.setAttribute('data-jword-table-anchor', 'left')

  quickTools.className = 'jw-table-panel__quick-tools jw-table-toolbar__quick-tools'
  quickTools.setAttribute('data-jword-table-quick-tools', 'true')
  quickTools.hidden = true

  summary.className = 'jw-table-toolbar__summary'
  summary.setAttribute('data-jword-table-summary', 'true')

  scopeGroup.className = 'jw-table-toolbar__group-row'
  scopeCellButton.classList.add('jw-table-toolbar__scope-button')
  scopeRowButton.classList.add('jw-table-toolbar__scope-button')
  scopeColumnButton.classList.add('jw-table-toolbar__scope-button')
  scopeGroup.append(scopeCellButton, scopeRowButton, scopeColumnButton)

  borderPresetSelect.className = 'jw-table-toolbar__select'
  borderPresetSelect.setAttribute('aria-label', '表格边框预设')
  borderPresetSelect.setAttribute('data-jword-table-border-preset', 'true')
  for (const preset of ['all', 'outer', 'innerHorizontal', 'innerVertical', 'none'] as const) {
    const option = document.createElement('option')

    option.value = preset
    option.textContent = readBorderPresetLabel(preset)
    borderPresetSelect.append(option)
  }

  insertRowBeforeButton.classList.add('jw-table-toolbar__action-button')
  insertRowAfterButton.classList.add('jw-table-toolbar__action-button')
  deleteRowButton.classList.add('jw-table-toolbar__action-button')
  insertColumnBeforeButton.classList.add('jw-table-toolbar__action-button')
  insertColumnAfterButton.classList.add('jw-table-toolbar__action-button')
  deleteColumnButton.classList.add('jw-table-toolbar__action-button')
  mergeRightButton.classList.add('jw-table-toolbar__action-button')
  applyBorderButton.classList.add('jw-table-toolbar__action-button')

  actionRow.className = 'jw-table-toolbar__group-row'
  actionRow.append(
    insertRowBeforeButton,
    insertRowAfterButton,
    deleteRowButton,
    insertColumnBeforeButton,
    insertColumnAfterButton,
    deleteColumnButton,
    mergeRightButton
  )

  borderGroup.className = 'jw-table-toolbar__group-row jw-table-toolbar__group-row--end'
  borderGroup.append(borderPresetSelect, applyBorderButton)

  secondaryRow.className = 'jw-table-toolbar__group-row jw-table-toolbar__group-row--between'
  secondaryRow.append(scopeGroup, borderGroup)

  quickTools.append(summary, actionRow, secondaryRow)
  overlay.append(topAnchor, leftAnchor, quickTools)

  root.append(insertTriggerButton, insertMenu)
  host.append(root)
  resolveOverlayMountHost(overlayHost).append(overlay)

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
    scopeCellButton,
    scopeRowButton,
    scopeColumnButton,
    insertRowBeforeButton,
    insertRowAfterButton,
    deleteRowButton,
    insertColumnBeforeButton,
    insertColumnAfterButton,
    deleteColumnButton,
    mergeRightButton,
    borderPresetSelect,
    applyBorderButton
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
  dom.topAnchor.hidden = !state.targetAvailable
  dom.leftAnchor.hidden = !state.targetAvailable
  dom.summary.textContent = state.summary
  dom.insertRowsInput.value = String(state.insertRows)
  dom.insertColumnsInput.value = String(state.insertColumns)
  syncPressedState(dom.scopeCellButton, state.scope === 'cell')
  syncPressedState(dom.scopeRowButton, state.scope === 'row')
  syncPressedState(dom.scopeColumnButton, state.scope === 'column')
  dom.insertTriggerButton.disabled = state.busy
  dom.customSizeButton.disabled = state.busy
  dom.insertRowsInput.disabled = state.busy
  dom.insertColumnsInput.disabled = state.busy
  dom.insertConfirmButton.disabled = state.busy
  dom.customSizeCancelButton.disabled = state.busy
  dom.topAnchor.disabled = state.busy || !state.targetAvailable
  dom.leftAnchor.disabled = state.busy || !state.targetAvailable
  dom.scopeCellButton.disabled = state.busy || !state.targetAvailable
  dom.scopeRowButton.disabled = state.busy || !state.targetAvailable
  dom.scopeColumnButton.disabled = state.busy || !state.targetAvailable
  dom.insertRowBeforeButton.disabled = state.busy || !state.targetAvailable
  dom.insertRowAfterButton.disabled = state.busy || !state.targetAvailable
  dom.deleteRowButton.disabled = state.busy || !state.canDeleteRow
  dom.insertColumnBeforeButton.disabled = state.busy || !state.targetAvailable
  dom.insertColumnAfterButton.disabled = state.busy || !state.targetAvailable
  dom.deleteColumnButton.disabled = state.busy || !state.canDeleteColumn
  dom.mergeRightButton.disabled = state.busy || !state.canMergeRight
  dom.borderPresetSelect.value = state.borderPreset
  dom.borderPresetSelect.disabled = state.busy || !state.targetAvailable
  dom.applyBorderButton.disabled = state.busy || !state.targetAvailable

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
  button.setAttribute(dataAttribute, dataValue)

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

/** 解析 overlay 挂载宿主。 */
function resolveOverlayMountHost(overlayHost: HTMLElement): HTMLElement {
  return overlayHost.querySelector<HTMLElement>('[data-jword-canvas-container]') ?? overlayHost
}

/** 同步 scope 按钮的按下状态。 */
function syncPressedState(button: HTMLButtonElement, pressed: boolean): void {
  button.setAttribute('aria-pressed', String(pressed))
  button.setAttribute('data-jword-active', String(pressed))
}
