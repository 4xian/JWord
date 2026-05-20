/**
 * 职责：创建并渲染 Gate 4 表格 toolbar DOM。
 * 边界：只管理表格工具节点结构和状态展示，不调用 editor 或 command adapter。
 * 协作模块：table controller 绑定交互，table state 生成摘要文案。
 * 性能/安全约束：DOM 结构保持轻量，样式不依赖 grid/gap。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md Step 4.7。
 */
import type { JWordTableBorderPreset, JWordTablePanelElements, JWordTableSelectionScope } from '../types'
import { readBorderPresetLabel } from './state'

export interface TablePanelDom extends JWordTablePanelElements {}

interface TablePanelViewState {
  readonly summary: string
  readonly insertRows: number
  readonly insertColumns: number
  readonly scope: JWordTableSelectionScope
  readonly borderPreset: JWordTableBorderPreset
  readonly targetAvailable: boolean
  readonly canDeleteRow: boolean
  readonly canDeleteColumn: boolean
  readonly canMergeRight: boolean
  readonly busy: boolean
}

/** 创建表格工具 DOM。 */
export function createTablePanelDom(host: HTMLElement, title: string): JWordTablePanelElements {
  const root = document.createElement('div')
  const titleNode = document.createElement('span')
  const summary = document.createElement('span')
  const insertRowsInput = createNumberInput('行数', 'data-jword-table-insert-rows')
  const insertColumnsInput = createNumberInput('列数', 'data-jword-table-insert-columns')
  const insertConfirmButton = createButton('插入表格', 'data-jword-table-insert-confirm')
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

  root.className = 'jw-table-toolbar'
  root.setAttribute('data-jword-table-toolbar', 'true')
  titleNode.className = 'jw-table-toolbar__title'
  titleNode.textContent = title
  summary.className = 'jw-table-toolbar__summary'
  summary.setAttribute('data-jword-table-summary', 'true')

  borderPresetSelect.className = 'jw-table-toolbar__select'
  borderPresetSelect.setAttribute('aria-label', '表格边框预设')
  borderPresetSelect.setAttribute('data-jword-table-border-preset', 'true')
  for (const preset of ['all', 'outer', 'innerHorizontal', 'innerVertical', 'none'] as const) {
    const option = document.createElement('option')

    option.value = preset
    option.textContent = readBorderPresetLabel(preset)
    borderPresetSelect.append(option)
  }

  const headerRow = createRow()
  const insertRow = createRow()
  const scopeRow = createRow()
  const actionRow = createRow()
  const borderRow = createRow()

  headerRow.append(titleNode)
  insertRow.append(
    createField('行数', insertRowsInput),
    createField('列数', insertColumnsInput),
    insertConfirmButton
  )
  scopeRow.append(scopeCellButton, scopeRowButton, scopeColumnButton)
  actionRow.append(
    insertRowBeforeButton,
    insertRowAfterButton,
    deleteRowButton,
    insertColumnBeforeButton,
    insertColumnAfterButton,
    deleteColumnButton,
    mergeRightButton
  )
  borderRow.append(borderPresetSelect, applyBorderButton)
  root.append(headerRow, summary, insertRow, scopeRow, actionRow, borderRow)
  host.append(root)

  return {
    host: root,
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
  dom.summary.textContent = state.summary
  dom.insertRowsInput.value = String(state.insertRows)
  dom.insertColumnsInput.value = String(state.insertColumns)
  syncPressedState(dom.scopeCellButton, state.scope === 'cell')
  syncPressedState(dom.scopeRowButton, state.scope === 'row')
  syncPressedState(dom.scopeColumnButton, state.scope === 'column')
  dom.insertRowsInput.disabled = state.busy
  dom.insertColumnsInput.disabled = state.busy
  dom.insertConfirmButton.disabled = state.busy
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
}

/** 销毁表格工具 DOM。 */
export function destroyTablePanel(dom: JWordTablePanelElements): void {
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

/** 同步 scope 按钮的按下状态。 */
function syncPressedState(button: HTMLButtonElement, pressed: boolean): void {
  button.setAttribute('aria-pressed', String(pressed))
  button.setAttribute('data-jword-active', String(pressed))
}
