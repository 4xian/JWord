/**
 * 职责：连接 Gate 4 页眉页脚基础 UI 与核心分节命令。
 * 边界：不实现完整页眉页脚编辑器、不保存第二份文档状态、不直接改 projection。
 * 协作模块：页眉页脚 DOM、核心分节命令构造器和编辑器门面。
 * 性能/安全约束：每次点击只读取当前 projection 和表单草稿，销毁时释放事件监听。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import { buildSetSectionPropertiesCommand, type Editor, type SectionPropertiesInput } from '@4xian/jword-core'
import { createHeaderFooterDom, destroyHeaderFooterDom, localizeHeaderFooterDom } from './dom'
import type { HeaderFooterDom } from './dom'
import { resolveJWordUiI18n, type ResolvedJWordUiI18n } from '../i18n'
import type { JWordReadonlyMode } from '../types'

export interface CreateHeaderFooterControllerOptions {
  readonly editor: Editor
  readonly host: HTMLElement
  readonly readonly?: JWordReadonlyMode
  readonly i18n?: ResolvedJWordUiI18n
  readonly announce?: (message: string) => void
}

export interface HeaderFooterControllerHandle {
  readonly elements: HeaderFooterDom
  toggleHeaderFooterMenu(anchor?: HTMLElement): void
  toggleFooterMenu(anchor?: HTMLElement): void
  togglePageNumberMenu(anchor?: HTMLElement): void
  setI18n(i18n: ResolvedJWordUiI18n): void
  refresh(): void
  destroy(): void
}

type HeaderFooterMenuKind = 'header' | 'footer' | 'page-number'
type PageNumberPosition =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right'

const MENU_VIEWPORT_PADDING_PX = 16
const MENU_ANCHOR_OFFSET_PX = 8
const HEADER_FOOTER_MENU_WIDTH_PX = 176
const PAGE_NUMBER_MENU_WIDTH_PX = 204

/**
 * 创建页眉页脚基础 controller。
 */
export function createHeaderFooterController(
  options: CreateHeaderFooterControllerOptions
): HeaderFooterControllerHandle {
  const dom = createHeaderFooterDom(options.host)
  const signalController = new AbortController()
  const readonlyMode = options.readonly === true || (typeof options.readonly === 'object' && options.readonly.enabled === true)
  const i18n = options.i18n ?? resolveJWordUiI18n()
  let destroyed = false

  localizeHeaderFooterDom(dom, i18n)

  /** 切换页眉页脚下拉。 */
  function toggleHeaderFooterMenu(anchor?: HTMLElement): void {
    if (readonlyMode) {
      announceReadonly()
      return
    }

    const nextVisible = dom.root.hidden || dom.headerMenu.hidden

    prepareMenuOpen('header', anchor)
    dom.root.hidden = !nextVisible
    dom.headerMenu.hidden = !nextVisible
    dom.footerMenu.hidden = true
    dom.pageNumberMenu.hidden = true
  }

  /** 切换页脚下拉。 */
  function toggleFooterMenu(anchor?: HTMLElement): void {
    if (readonlyMode) {
      announceReadonly()
      return
    }

    const nextVisible = dom.root.hidden || dom.footerMenu.hidden

    prepareMenuOpen('footer', anchor)
    dom.root.hidden = !nextVisible
    dom.headerMenu.hidden = true
    dom.footerMenu.hidden = !nextVisible
    dom.pageNumberMenu.hidden = true
  }

  /** 切换页码下拉。 */
  function togglePageNumberMenu(anchor?: HTMLElement): void {
    if (readonlyMode) {
      announceReadonly()
      return
    }

    const nextVisible = dom.root.hidden || dom.pageNumberMenu.hidden

    prepareMenuOpen('page-number', anchor)
    dom.root.hidden = !nextVisible
    dom.pageNumberMenu.hidden = !nextVisible
    dom.headerMenu.hidden = true
    dom.footerMenu.hidden = true
  }

  /** 打开菜单前同步当前菜单类型与 toolbar 按钮锚点。 */
  function prepareMenuOpen(kind: HeaderFooterMenuKind, anchor: HTMLElement | undefined): void {
    dom.root.setAttribute('data-jword-active-menu', kind)
    dom.root.style.setProperty('--jw-header-footer-menu-width', `${readMenuWidth(kind)}px`)
    if (anchor !== undefined) {
      dom.root.setAttribute('data-jword-anchored', 'true')
      positionMenuUnderAnchor(kind, anchor)
      return
    }

    dom.root.removeAttribute('data-jword-anchored')
  }

  /** 根据当前菜单类型读取紧凑宽度。 */
  function readMenuWidth(kind: HeaderFooterMenuKind): number {
    return kind === 'page-number'
      ? PAGE_NUMBER_MENU_WIDTH_PX
      : HEADER_FOOTER_MENU_WIDTH_PX
  }

  /** 把下拉根节点定位到 toolbar 按钮下方，并避免贴住视口边缘。 */
  function positionMenuUnderAnchor(kind: HeaderFooterMenuKind, anchor: HTMLElement): void {
    const rect = anchor.getBoundingClientRect()
    const viewportWidth = anchor.ownerDocument.defaultView?.innerWidth
      ?? anchor.ownerDocument.documentElement.clientWidth
    const menuWidth = Math.min(readMenuWidth(kind), Math.max(0, viewportWidth - MENU_VIEWPORT_PADDING_PX * 2))
    const maxLeft = Math.max(MENU_VIEWPORT_PADDING_PX, viewportWidth - MENU_VIEWPORT_PADDING_PX - menuWidth)
    const left = Math.min(Math.max(MENU_VIEWPORT_PADDING_PX, rect.left), maxLeft)
    const top = Math.max(0, rect.bottom + MENU_ANCHOR_OFFSET_PX)

    dom.root.style.setProperty('--jw-header-footer-menu-left', `${Math.round(left)}px`)
    dom.root.style.setProperty('--jw-header-footer-menu-top', `${Math.round(top)}px`)
  }

  /** 添加当前输入框中的页眉标识。 */
  function addHeader(): void {
    if (readonlyMode) {
      announceReadonly()
      return
    }

    const current = options.editor.getProjection().document.sections[0]

    applySectionProperties({
      headerIds: mergeUserIdsWithPageNumberIds(
        readUserHeaderFooterIds(dom.headerInput.value),
        current?.headerIds ?? []
      )
    })
  }

  /** 添加当前输入框中的页脚标识。 */
  function addFooter(): void {
    if (readonlyMode) {
      announceReadonly()
      return
    }

    const current = options.editor.getProjection().document.sections[0]

    applySectionProperties({
      footerIds: mergeUserIdsWithPageNumberIds(
        readUserHeaderFooterIds(dom.footerInput.value),
        current?.footerIds ?? []
      )
    })
  }

  /** 删除当前分节页眉。 */
  function deleteHeader(): void {
    if (readonlyMode) {
      announceReadonly()
      return
    }

    const current = options.editor.getProjection().document.sections[0]

    applySectionProperties({
      headerIds: readPageNumberIds(current?.headerIds ?? [])
    })
  }

  /** 删除当前分节页脚。 */
  function deleteFooter(): void {
    if (readonlyMode) {
      announceReadonly()
      return
    }

    const current = options.editor.getProjection().document.sections[0]

    applySectionProperties({
      footerIds: readPageNumberIds(current?.footerIds ?? [])
    })
  }

  /** 在指定位置启用页码。 */
  function applyPageNumber(position: PageNumberPosition): void {
    if (readonlyMode) {
      announceReadonly()
      return
    }

    const current = options.editor.getProjection().document.sections[0]
    const pageNumberSourceId = `page-number-${position}`
    const userHeaderIds = readUserIds(current?.headerIds ?? [])
    const userFooterIds = readUserIds(current?.footerIds ?? [])
    const headerIds = position.startsWith('top-')
      ? [...userHeaderIds, pageNumberSourceId]
      : userHeaderIds
    const footerIds = position.startsWith('bottom-')
      ? [...userFooterIds, pageNumberSourceId]
      : userFooterIds

    applySectionProperties({
      headerIds,
      footerIds,
      pageNumbering: {
        mode: 'restart',
        start: readPageStart(dom.pageStartInput.value)
      }
    })
  }

  /** 删除当前分节页码。 */
  function deletePageNumber(): void {
    if (readonlyMode) {
      announceReadonly()
      return
    }

    const current = options.editor.getProjection().document.sections[0]

    applySectionProperties({
      headerIds: (current?.headerIds ?? []).filter((id) => !isPageNumberSourceId(id)),
      footerIds: (current?.footerIds ?? []).filter((id) => !isPageNumberSourceId(id)),
      pageNumbering: null
    })
  }

  /** 应用下一页分节配置。 */
  function applyNextPageSection(): void {
    if (readonlyMode) {
      announceReadonly()
      return
    }

    const current = options.editor.getProjection().document.sections[0]

    applySectionProperties({
      breakType: 'next-page',
      headerIds: mergeUserIdsWithPageNumberIds(
        readUserHeaderFooterIds(dom.headerInput.value),
        current?.headerIds ?? []
      ),
      footerIds: mergeUserIdsWithPageNumberIds(
        readUserHeaderFooterIds(dom.footerInput.value),
        current?.footerIds ?? []
      ),
      pageNumbering: {
        mode: 'restart',
        start: readPageStart(dom.pageStartInput.value)
      }
    })
  }

  /** 应用连续分节配置。 */
  function applyContinuousSection(): void {
    if (readonlyMode) {
      announceReadonly()
      return
    }

    const current = options.editor.getProjection().document.sections[0]

    applySectionProperties({
      breakType: 'continuous',
      headerIds: mergeUserIdsWithPageNumberIds(
        readUserHeaderFooterIds(dom.headerInput.value),
        current?.headerIds ?? []
      ),
      footerIds: mergeUserIdsWithPageNumberIds(
        readUserHeaderFooterIds(dom.footerInput.value),
        current?.footerIds ?? []
      ),
      pageNumbering: {
        mode: 'continue'
      }
    })
  }

  /** 通过 core transaction pipeline 写入 section 属性。 */
  function applySectionProperties(input: SectionPropertiesInput): void {
    if (readonlyMode) {
      announceReadonly()
      return
    }

    const sectionId = options.editor.getProjection().document.sections[0]?.id

    if (sectionId === undefined) {
      options.announce?.('BLOCKED: 当前文档缺少可配置的分节。')
      return
    }

    const command = buildSetSectionPropertiesCommand(options.editor.getProjection(), sectionId, input)

    if (command === null) {
      options.announce?.('BLOCKED: 当前分节无法更新。')
      return
    }

    options.editor.executeCommand(command)
    options.announce?.('已更新分节、页眉页脚和页码设置。')
    refresh()
  }

  /** 播报只读阻断。 */
  function announceReadonly(): void {
    options.announce?.('当前为只读模式。')
  }

  /** 从当前 projection 回填表单。 */
  function refresh(): void {
    if (destroyed) {
      return
    }

    const section = options.editor.getProjection().document.sections[0]

    dom.headerInput.value = formatUserHeaderFooterValue(section?.headerIds ?? [])
    dom.footerInput.value = formatUserHeaderFooterValue(section?.footerIds ?? [])
    dom.pageStartInput.value = String(section?.pageNumbering?.start ?? 1)
  }

  /** 销毁 controller。 */
  function destroy(): void {
    if (destroyed) {
      return
    }

    destroyed = true
    signalController.abort()
    destroyHeaderFooterDom(dom)
  }

  dom.nextPageButton.addEventListener('click', applyNextPageSection, {
    signal: signalController.signal
  })
  dom.continuousButton.addEventListener('click', applyContinuousSection, {
    signal: signalController.signal
  })
  dom.footerNextPageButton.addEventListener('click', applyNextPageSection, {
    signal: signalController.signal
  })
  dom.footerContinuousButton.addEventListener('click', applyContinuousSection, {
    signal: signalController.signal
  })
  dom.headerTriggerButton.addEventListener('click', () => {
    toggleHeaderFooterMenu()
  }, {
    signal: signalController.signal
  })
  dom.footerTriggerButton.addEventListener('click', () => {
    toggleFooterMenu()
  }, {
    signal: signalController.signal
  })
  dom.pageNumberTriggerButton.addEventListener('click', () => {
    togglePageNumberMenu()
  }, {
    signal: signalController.signal
  })
  dom.addHeaderButton.addEventListener('click', addHeader, {
    signal: signalController.signal
  })
  dom.addFooterButton.addEventListener('click', addFooter, {
    signal: signalController.signal
  })
  dom.deleteHeaderButton.addEventListener('click', deleteHeader, {
    signal: signalController.signal
  })
  dom.deleteFooterButton.addEventListener('click', deleteFooter, {
    signal: signalController.signal
  })
  dom.pageNumberTopLeftButton.addEventListener('click', () => {
    applyPageNumber('top-left')
  }, { signal: signalController.signal })
  dom.pageNumberTopCenterButton.addEventListener('click', () => {
    applyPageNumber('top-center')
  }, { signal: signalController.signal })
  dom.pageNumberTopRightButton.addEventListener('click', () => {
    applyPageNumber('top-right')
  }, { signal: signalController.signal })
  dom.pageNumberBottomLeftButton.addEventListener('click', () => {
    applyPageNumber('bottom-left')
  }, { signal: signalController.signal })
  dom.pageNumberBottomCenterButton.addEventListener('click', () => {
    applyPageNumber('bottom-center')
  }, { signal: signalController.signal })
  dom.pageNumberBottomRightButton.addEventListener('click', () => {
    applyPageNumber('bottom-right')
  }, { signal: signalController.signal })
  dom.deletePageNumberButton.addEventListener('click', deletePageNumber, {
    signal: signalController.signal
  })
  refresh()

  return {
    elements: dom,
    toggleHeaderFooterMenu,
    toggleFooterMenu,
    togglePageNumberMenu,
    setI18n(i18n): void {
      localizeHeaderFooterDom(dom, i18n)
    },
    refresh,
    destroy
  }
}

/** 读取逗号分隔的用户页眉页脚内容。 */
function readUserHeaderFooterIds(value: string): readonly string[] {
  return readUserIds(value.split(',').map((item) => item.trim()).filter((item) => item.length > 0))
}

/** 过滤内部页码 source id，避免进入用户可见输入。 */
function readUserIds(ids: readonly string[]): readonly string[] {
  return Object.freeze(ids.filter((id) => !isPageNumberSourceId(id)))
}

/** 读取内部页码 source id。 */
function readPageNumberIds(ids: readonly string[]): readonly string[] {
  return Object.freeze(ids.filter((id) => isPageNumberSourceId(id)))
}

/** 合并用户内容和现有页码 source id，保持两类状态互不覆盖。 */
function mergeUserIdsWithPageNumberIds(userIds: readonly string[], currentIds: readonly string[]): readonly string[] {
  return Object.freeze([
    ...userIds,
    ...readPageNumberIds(currentIds)
  ])
}

/** 格式化用户可见页眉页脚输入内容。 */
function formatUserHeaderFooterValue(ids: readonly string[]): string {
  return readUserIds(ids).join(', ')
}

/** 读取页码起始值。 */
function readPageStart(value: string): number {
  const parsed = Number.parseInt(value, 10)

  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1
}

/** 判断页眉页脚标识是否由页码工具生成。 */
function isPageNumberSourceId(value: string): boolean {
  return value.startsWith('page-number-')
}
