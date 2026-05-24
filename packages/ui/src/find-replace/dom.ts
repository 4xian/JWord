/**
 * 职责：创建 Gate 4 查找替换基础面板 DOM。
 * 边界：只创建节点和展示状态，不读取 editor、不执行查找替换命令。
 * 协作模块：find-replace controller 负责读取表单、调用 core helper 和刷新状态。
 * 性能/安全约束：使用 flex 友好的线性 DOM，不使用 grid / gap，不保存 projection。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md Step 4.12。
 */

import type { JWordFindReplacePanelElements } from '../types'

/**
 * 创建查找替换面板 DOM。
 */
export function createFindReplaceDom(host: HTMLElement): JWordFindReplacePanelElements {
  const root = document.createElement('section')
  const header = document.createElement('div')
  const fields = document.createElement('div')
  const actions = document.createElement('div')
  const closeButton = createButton('关闭', 'data-jword-find-close-button')
  const queryInput = createTextInput('查找', 'data-jword-find-query-input')
  const replacementInput = createTextInput('替换为', 'data-jword-find-replacement-input')
  const findButton = createButton('查找', 'data-jword-find-button')
  const previousButton = createButton('上一个', 'data-jword-find-previous-button')
  const nextButton = createButton('下一个', 'data-jword-find-next-button')
  const replaceButton = createButton('替换', 'data-jword-replace-button')
  const replaceAllButton = createButton('全部替换', 'data-jword-replace-all-button')
  const status = document.createElement('output')

  root.className = 'jw-find-replace'
  root.setAttribute('data-jword-find-replace', 'true')
  root.setAttribute('role', 'dialog')
  root.setAttribute('aria-label', '查找替换')
  root.hidden = true
  header.className = 'jw-find-replace__header'
  fields.className = 'jw-find-replace__fields'
  actions.className = 'jw-find-replace__actions'
  actions.setAttribute('data-jword-find-actions', 'true')
  closeButton.className = 'jw-find-replace__close'
  closeButton.setAttribute('aria-label', '关闭查找替换')
  closeButton.textContent = '×'
  status.className = 'jw-find-replace__status'
  status.setAttribute('data-jword-find-status', 'true')
  status.setAttribute('aria-live', 'polite')
  status.textContent = '0 / 0'
  header.append(status, closeButton)
  fields.append(
    queryInput,
    replacementInput
  )
  actions.append(
    findButton,
    previousButton,
    nextButton,
    replaceButton,
    replaceAllButton
  )
  root.append(
    header,
    fields,
    actions
  )
  host.append(root)

  return {
    host,
    root,
    closeButton,
    queryInput,
    replacementInput,
    findButton,
    previousButton,
    nextButton,
    replaceButton,
    replaceAllButton,
    status
  }
}

/**
 * 销毁查找替换面板 DOM。
 */
export function destroyFindReplaceDom(dom: JWordFindReplacePanelElements): void {
  dom.root.remove()
}

/** 创建文本输入。 */
function createTextInput(label: string, dataAttribute: string): HTMLInputElement {
  const input = document.createElement('input')

  input.type = 'text'
  input.className = 'jw-find-replace__input'
  input.placeholder = label
  input.setAttribute(dataAttribute, 'true')

  return input
}

/** 创建命令按钮。 */
function createButton(label: string, dataAttribute: string): HTMLButtonElement {
  const button = document.createElement('button')

  button.type = 'button'
  button.className = 'jw-find-replace__button'
  button.textContent = label
  button.setAttribute(dataAttribute, 'true')

  return button
}
