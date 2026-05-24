/**
 * 职责：创建 Gate 4 页眉页脚与页码基础面板 DOM。
 * 边界：只创建节点和读取表单草稿，不执行 editor 命令、不访问 projection。
 * 协作模块：header-footer controller 负责命令分发和刷新。
 * 性能/安全约束：使用 flex 友好的线性 DOM，不使用 grid / gap，不保存文档状态。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md Step 4.13。
 */

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
  const root = document.createElement('section')
  const headerTriggerButton = createButton('页眉', 'data-jword-header-trigger')
  const headerMenu = document.createElement('div')
  const footerTriggerButton = createButton('页脚', 'data-jword-footer-trigger')
  const footerMenu = document.createElement('div')
  const pageNumberTriggerButton = createButton('页码', 'data-jword-page-number-trigger')
  const pageNumberMenu = document.createElement('div')
  const headerInput = createTextInput('页眉标识', 'data-jword-header-id-input')
  const footerInput = createTextInput('页脚标识', 'data-jword-footer-id-input')
  const pageStartInput = createNumberInput()
  const addHeaderButton = createButton('添加页眉', 'data-jword-add-header')
  const addFooterButton = createButton('添加页脚', 'data-jword-add-footer')
  const deleteHeaderButton = createButton('删除页眉', 'data-jword-delete-header')
  const deleteFooterButton = createButton('删除页脚', 'data-jword-delete-footer')
  const pageNumberTopLeftButton = createButton('上左页码', 'data-jword-page-number-top-left')
  const pageNumberTopCenterButton = createButton('上中页码', 'data-jword-page-number-top-center')
  const pageNumberTopRightButton = createButton('上右页码', 'data-jword-page-number-top-right')
  const pageNumberBottomLeftButton = createButton('下左页码', 'data-jword-page-number-bottom-left')
  const pageNumberBottomCenterButton = createButton('下中页码', 'data-jword-page-number-bottom-center')
  const pageNumberBottomRightButton = createButton('下右页码', 'data-jword-page-number-bottom-right')
  const deletePageNumberButton = createButton('删除页码', 'data-jword-delete-page-number')
  const nextPageButton = createButton('下一页分节', 'data-jword-section-break-next-page')
  const continuousButton = createButton('连续分节', 'data-jword-section-break-continuous')
  const footerNextPageButton = createButton('下一页分节', 'data-jword-footer-section-break-next-page')
  const footerContinuousButton = createButton('连续分节', 'data-jword-footer-section-break-continuous')

  root.className = 'jw-header-footer'
  root.setAttribute('data-jword-header-footer', 'true')
  root.hidden = true
  headerTriggerButton.title = '页眉'
  footerTriggerButton.title = '页脚'
  pageNumberTriggerButton.title = '页码'
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
function createNumberInput(): HTMLInputElement {
  const input = document.createElement('input')

  input.type = 'number'
  input.min = '1'
  input.value = '1'
  input.className = 'jw-header-footer__input'
  input.setAttribute('data-jword-page-start-input', 'true')

  return input
}

/** 创建命令按钮。 */
function createButton(label: string, dataAttribute: string): HTMLButtonElement {
  const button = document.createElement('button')

  button.type = 'button'
  button.className = 'jw-header-footer__button'
  button.textContent = label
  button.setAttribute(dataAttribute, 'true')

  return button
}
