/**
 * 职责：创建 Gate 4 页眉页脚与页码基础面板 DOM。
 * 边界：只创建节点和读取表单草稿，不执行 editor 命令、不访问 projection。
 * 协作模块：header-footer controller 负责命令分发和刷新。
 * 性能/安全约束：使用 flex 友好的线性 DOM，不使用 grid / gap，不保存文档状态。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import {
  readJWordUiText,
  resolveJWordUiI18n,
  type ResolvedJWordUiI18n
} from '../i18n'

export interface HeaderFooterDom {
  readonly host: HTMLElement
  readonly root: HTMLElement
  readonly triggerButton: HTMLButtonElement
  readonly menu: HTMLElement
  readonly headerTriggerButton: HTMLButtonElement
  readonly headerMenu: HTMLElement
  readonly footerTriggerButton: HTMLButtonElement
  readonly footerMenu: HTMLElement
  readonly pageNumberTriggerButton: HTMLButtonElement
  readonly pageNumberMenu: HTMLElement
  readonly headerInput: HTMLInputElement
  readonly footerInput: HTMLInputElement
  readonly pageStartInput: HTMLInputElement
  readonly addHeaderButton: HTMLButtonElement
  readonly addFooterButton: HTMLButtonElement
  readonly deleteHeaderButton: HTMLButtonElement
  readonly deleteFooterButton: HTMLButtonElement
  readonly footerNextPageButton: HTMLButtonElement
  readonly footerContinuousButton: HTMLButtonElement
  readonly pageNumberTopLeftButton: HTMLButtonElement
  readonly pageNumberTopCenterButton: HTMLButtonElement
  readonly pageNumberTopRightButton: HTMLButtonElement
  readonly pageNumberBottomLeftButton: HTMLButtonElement
  readonly pageNumberBottomCenterButton: HTMLButtonElement
  readonly pageNumberBottomRightButton: HTMLButtonElement
  readonly deletePageNumberButton: HTMLButtonElement
  readonly nextPageButton: HTMLButtonElement
  readonly continuousButton: HTMLButtonElement
}

/**
 * 创建页眉页脚面板 DOM。
 */
export function createHeaderFooterDom(host: HTMLElement): HeaderFooterDom {
  const i18n = resolveJWordUiI18n()
  const root = document.createElement('section')
  const headerTriggerButton = createButton(readHeaderFooterText(i18n, 'header', '页眉'), 'data-jword-header-trigger')
  const headerMenu = document.createElement('div')
  const footerTriggerButton = createButton(readHeaderFooterText(i18n, 'footer', '页脚'), 'data-jword-footer-trigger')
  const footerMenu = document.createElement('div')
  const pageNumberTriggerButton = createButton(readHeaderFooterText(i18n, 'pageNumber', '页码'), 'data-jword-page-number-trigger')
  const pageNumberMenu = document.createElement('div')
  const headerInput = createTextInput(readHeaderFooterText(i18n, 'headerPlaceholder', '页眉标识'), 'data-jword-header-id-input')
  const footerInput = createTextInput(readHeaderFooterText(i18n, 'footerPlaceholder', '页脚标识'), 'data-jword-footer-id-input')
  const pageStartInput = createNumberInput(readHeaderFooterText(i18n, 'pageStart', '起始页码'))
  const addHeaderButton = createButton(readHeaderFooterText(i18n, 'addHeader', '添加页眉'), 'data-jword-add-header')
  const addFooterButton = createButton(readHeaderFooterText(i18n, 'addFooter', '添加页脚'), 'data-jword-add-footer')
  const deleteHeaderButton = createButton(readHeaderFooterText(i18n, 'deleteHeader', '删除页眉'), 'data-jword-delete-header')
  const deleteFooterButton = createButton(readHeaderFooterText(i18n, 'deleteFooter', '删除页脚'), 'data-jword-delete-footer')
  const pageNumberTopLeftButton = createButton(readHeaderFooterText(i18n, 'pageNumberTopLeft', '上左页码'), 'data-jword-page-number-top-left')
  const pageNumberTopCenterButton = createButton(readHeaderFooterText(i18n, 'pageNumberTopCenter', '上中页码'), 'data-jword-page-number-top-center')
  const pageNumberTopRightButton = createButton(readHeaderFooterText(i18n, 'pageNumberTopRight', '上右页码'), 'data-jword-page-number-top-right')
  const pageNumberBottomLeftButton = createButton(readHeaderFooterText(i18n, 'pageNumberBottomLeft', '下左页码'), 'data-jword-page-number-bottom-left')
  const pageNumberBottomCenterButton = createButton(readHeaderFooterText(i18n, 'pageNumberBottomCenter', '下中页码'), 'data-jword-page-number-bottom-center')
  const pageNumberBottomRightButton = createButton(readHeaderFooterText(i18n, 'pageNumberBottomRight', '下右页码'), 'data-jword-page-number-bottom-right')
  const deletePageNumberButton = createButton(readHeaderFooterText(i18n, 'deletePageNumber', '删除页码'), 'data-jword-delete-page-number')
  const nextPageButton = createButton(readHeaderFooterText(i18n, 'nextPage', '下一页分节'), 'data-jword-section-break-next-page')
  const continuousButton = createButton(readHeaderFooterText(i18n, 'continuous', '连续分节'), 'data-jword-section-break-continuous')
  const footerNextPageButton = createButton(readHeaderFooterText(i18n, 'nextPage', '下一页分节'), 'data-jword-footer-section-break-next-page')
  const footerContinuousButton = createButton(readHeaderFooterText(i18n, 'continuous', '连续分节'), 'data-jword-footer-section-break-continuous')

  root.className = 'jw-header-footer'
  root.setAttribute('data-jword-header-footer', 'true')
  root.hidden = true
  headerMenu.className = 'jw-header-footer__menu jw-header-footer__menu--header'
  headerMenu.setAttribute('data-jword-header-menu', 'true')
  headerMenu.setAttribute('data-jword-header-footer-menu', 'true')
  headerMenu.hidden = true
  footerMenu.className = 'jw-header-footer__menu jw-header-footer__menu--footer'
  footerMenu.setAttribute('data-jword-footer-menu', 'true')
  footerMenu.hidden = true
  pageNumberMenu.className = 'jw-header-footer__menu jw-header-footer__menu--page-number'
  pageNumberMenu.setAttribute('data-jword-page-number-menu', 'true')
  pageNumberMenu.hidden = true
  headerMenu.append(
    headerInput,
    addHeaderButton,
    deleteHeaderButton,
    nextPageButton,
    continuousButton
  )
  footerMenu.append(
    footerInput,
    addFooterButton,
    deleteFooterButton,
    footerNextPageButton,
    footerContinuousButton
  )
  pageNumberMenu.append(
    pageStartInput,
    pageNumberTopLeftButton,
    pageNumberTopCenterButton,
    pageNumberTopRightButton,
    pageNumberBottomLeftButton,
    pageNumberBottomCenterButton,
    pageNumberBottomRightButton,
    deletePageNumberButton
  )
  root.append(headerMenu, footerMenu, pageNumberMenu)
  host.append(root)

  return {
    host,
    root,
    triggerButton: headerTriggerButton,
    menu: headerMenu,
    headerTriggerButton,
    headerMenu,
    footerTriggerButton,
    footerMenu,
    pageNumberTriggerButton,
    pageNumberMenu,
    headerInput,
    footerInput,
    pageStartInput,
    addHeaderButton,
    addFooterButton,
    deleteHeaderButton,
    deleteFooterButton,
    footerNextPageButton,
    footerContinuousButton,
    pageNumberTopLeftButton,
    pageNumberTopCenterButton,
    pageNumberTopRightButton,
    pageNumberBottomLeftButton,
    pageNumberBottomCenterButton,
    pageNumberBottomRightButton,
    deletePageNumberButton,
    nextPageButton,
    continuousButton
  }
}

/** 动态刷新页眉页脚面板文案。 */
export function localizeHeaderFooterDom(dom: HeaderFooterDom, i18n: ResolvedJWordUiI18n): void {
  setButtonText(dom.headerTriggerButton, readHeaderFooterText(i18n, 'header', '页眉'))
  setButtonText(dom.footerTriggerButton, readHeaderFooterText(i18n, 'footer', '页脚'))
  setButtonText(dom.pageNumberTriggerButton, readHeaderFooterText(i18n, 'pageNumber', '页码'))
  dom.headerInput.placeholder = readHeaderFooterText(i18n, 'headerPlaceholder', '页眉标识')
  dom.footerInput.placeholder = readHeaderFooterText(i18n, 'footerPlaceholder', '页脚标识')
  dom.pageStartInput.setAttribute('aria-label', readHeaderFooterText(i18n, 'pageStart', '起始页码'))
  setButtonText(dom.addHeaderButton, readHeaderFooterText(i18n, 'addHeader', '添加页眉'))
  setButtonText(dom.addFooterButton, readHeaderFooterText(i18n, 'addFooter', '添加页脚'))
  setButtonText(dom.deleteHeaderButton, readHeaderFooterText(i18n, 'deleteHeader', '删除页眉'))
  setButtonText(dom.deleteFooterButton, readHeaderFooterText(i18n, 'deleteFooter', '删除页脚'))
  setButtonText(dom.footerNextPageButton, readHeaderFooterText(i18n, 'nextPage', '下一页分节'))
  setButtonText(dom.footerContinuousButton, readHeaderFooterText(i18n, 'continuous', '连续分节'))
  setButtonText(dom.pageNumberTopLeftButton, readHeaderFooterText(i18n, 'pageNumberTopLeft', '上左页码'))
  setButtonText(dom.pageNumberTopCenterButton, readHeaderFooterText(i18n, 'pageNumberTopCenter', '上中页码'))
  setButtonText(dom.pageNumberTopRightButton, readHeaderFooterText(i18n, 'pageNumberTopRight', '上右页码'))
  setButtonText(dom.pageNumberBottomLeftButton, readHeaderFooterText(i18n, 'pageNumberBottomLeft', '下左页码'))
  setButtonText(dom.pageNumberBottomCenterButton, readHeaderFooterText(i18n, 'pageNumberBottomCenter', '下中页码'))
  setButtonText(dom.pageNumberBottomRightButton, readHeaderFooterText(i18n, 'pageNumberBottomRight', '下右页码'))
  setButtonText(dom.deletePageNumberButton, readHeaderFooterText(i18n, 'deletePageNumber', '删除页码'))
  setButtonText(dom.nextPageButton, readHeaderFooterText(i18n, 'nextPage', '下一页分节'))
  setButtonText(dom.continuousButton, readHeaderFooterText(i18n, 'continuous', '连续分节'))
}

/**
 * 销毁页眉页脚面板 DOM。
 */
export function destroyHeaderFooterDom(dom: HeaderFooterDom): void {
  dom.root.remove()
}

/** 创建文本输入。 */
function createTextInput(label: string, dataAttribute: string): HTMLInputElement {
  const input = document.createElement('input')

  input.type = 'text'
  input.className = 'jw-header-footer__input'
  input.placeholder = label
  input.setAttribute(dataAttribute, 'true')

  return input
}

/** 创建页码起始输入。 */
function createNumberInput(label: string): HTMLInputElement {
  const input = document.createElement('input')

  input.type = 'number'
  input.min = '1'
  input.value = '1'
  input.className = 'jw-header-footer__input'
  input.setAttribute('aria-label', label)
  input.setAttribute('data-jword-page-start-input', 'true')

  return input
}

/** 创建命令按钮。 */
function createButton(label: string, dataAttribute: string): HTMLButtonElement {
  const button = document.createElement('button')

  button.type = 'button'
  button.className = 'jw-header-footer__button'
  button.textContent = label
  button.title = label
  button.setAttribute('aria-label', label)
  button.setAttribute(dataAttribute, 'true')

  return button
}

/** 更新按钮的可见和无障碍文案。 */
function setButtonText(button: HTMLButtonElement, text: string): void {
  button.textContent = text
  button.title = text
  button.setAttribute('aria-label', text)
}

/** 读取页眉页脚内建文案。 */
function readHeaderFooterText(i18n: ResolvedJWordUiI18n, key: string, fallback: string): string {
  return readJWordUiText(i18n, `menu.headerFooter.${key}`, fallback)
}
