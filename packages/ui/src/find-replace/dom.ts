/**
 * 职责：创建 Gate 4 查找替换基础面板 DOM。
 * 边界：只创建节点和展示状态，不读取 editor、不执行查找替换命令。
 * 协作模块：find-replace controller 负责读取表单、调用 core helper 和刷新状态。
 * 性能/安全约束：使用 flex 友好的线性 DOM，不使用 grid / gap，不保存 projection。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import {
  readJWordUiText,
  resolveJWordUiI18n,
  type ResolvedJWordUiI18n
} from '../i18n'
import type { JWordFindReplacePanelElements } from '../types'

/**
 * 创建查找替换面板 DOM。
 */
export function createFindReplaceDom(
  host: HTMLElement,
  i18n: ResolvedJWordUiI18n = resolveJWordUiI18n()
): JWordFindReplacePanelElements {
  const root = document.createElement('section')
  const header = document.createElement('div')
  const fields = document.createElement('div')
  const actions = document.createElement('div')
  const closeButton = createButton(readFindReplaceText(i18n, 'close'), 'data-jword-find-close-button')
  const queryInput = createTextInput(readFindReplaceText(i18n, 'query'), 'data-jword-find-query-input')
  const replacementInput = createTextInput(readFindReplaceText(i18n, 'replacement'), 'data-jword-find-replacement-input')
  const findButton = createButton(readFindReplaceText(i18n, 'find'), 'data-jword-find-button')
  const previousButton = createButton(readFindReplaceText(i18n, 'previous'), 'data-jword-find-previous-button')
  const nextButton = createButton(readFindReplaceText(i18n, 'next'), 'data-jword-find-next-button')
  const replaceButton = createButton(readFindReplaceText(i18n, 'replace'), 'data-jword-replace-button')
  const replaceAllButton = createButton(readFindReplaceText(i18n, 'replaceAll'), 'data-jword-replace-all-button')
  const status = document.createElement('output')

  root.className = 'jw-find-replace'
  root.setAttribute('data-jword-find-replace', 'true')
  root.setAttribute('role', 'dialog')
  root.setAttribute('aria-label', readFindReplaceText(i18n, 'title'))
  root.hidden = true
  header.className = 'jw-find-replace__header'
  fields.className = 'jw-find-replace__fields'
  actions.className = 'jw-find-replace__actions'
  actions.setAttribute('data-jword-find-actions', 'true')
  closeButton.className = 'jw-find-replace__close'
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

/** 动态刷新查找替换面板文案。 */
export function localizeFindReplaceDom(
  dom: JWordFindReplacePanelElements,
  i18n: ResolvedJWordUiI18n
): void {
  dom.root.setAttribute('aria-label', readFindReplaceText(i18n, 'title'))
  setButtonLabel(dom.closeButton, readFindReplaceText(i18n, 'close'))
  dom.queryInput.placeholder = readFindReplaceText(i18n, 'query')
  dom.replacementInput.placeholder = readFindReplaceText(i18n, 'replacement')
  setButtonLabel(dom.findButton, readFindReplaceText(i18n, 'find'))
  setButtonLabel(dom.previousButton, readFindReplaceText(i18n, 'previous'))
  setButtonLabel(dom.nextButton, readFindReplaceText(i18n, 'next'))
  setButtonLabel(dom.replaceButton, readFindReplaceText(i18n, 'replace'))
  setButtonLabel(dom.replaceAllButton, readFindReplaceText(i18n, 'replaceAll'))
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
  button.title = label
  button.setAttribute('aria-label', label)
  button.setAttribute(dataAttribute, 'true')

  return button
}

/** 更新按钮文案、title 与 aria-label。 */
function setButtonLabel(button: HTMLButtonElement, label: string): void {
  if (!button.classList.contains('jw-find-replace__close')) {
    button.textContent = label
  }
  button.title = label
  button.setAttribute('aria-label', label)
}

/** 读取查找替换面板文案。 */
function readFindReplaceText(i18n: ResolvedJWordUiI18n, key: string): string {
  return readJWordUiText(i18n, `menu.findReplace.${key}`)
}
