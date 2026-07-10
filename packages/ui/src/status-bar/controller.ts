/**
 * 职责：连接底部状态栏 DOM、editor facade、主题/语言切换与视图控制。
 * 边界：只调用公开 editor facade，不读取 core 内部状态，不创建 demo-only 控件。
 * 协作模块：ui-lifecycle 传入 mount、i18n、主题控制和 live region。
 * 性能/安全约束：常规刷新优先读取已挂载 canvas 属性，避免在事务热路径强制 getLayout。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import {
  isSelectionCollapsed,
  type Editor
} from '@4xian/jword-core'

import {
  readJWordUiText,
  type ResolvedJWordUiI18n
} from '../i18n'
import { readSelectionText } from '../text-projection'
import type {
  JWordStatusBarElements,
  JWordStatusBarBrandProtectionMode,
  JWordStatusBarItemId,
  JWordStatusBarLocale,
  JWordStatusBarOptions,
  JWordUiLiveRegionController,
  JWordUiThemeName,
  JWordUiThemeOptions
} from '../types'
import {
  createStatusBarDocumentStats,
  createStatusBarTextStats,
  resolveStatusBarItems,
  resolveStatusBarLocaleOptions,
  resolveStatusBarZoomOptions
} from './state'
import {
  createStatusBarDom,
  destroyStatusBarDom,
  localizeStatusBarDom,
  renderStatusBarDomState,
  type StatusBarDom
} from './dom'
import {
  createJWordUiViewController,
  JWORD_UI_VIEW_STATE_CHANGE_EVENT
} from '../view-state'

export interface CreateStatusBarControllerOptions {
  readonly editor: Editor
  readonly editorHost?: HTMLElement
  readonly host: HTMLElement
  readonly fullscreenHost?: HTMLElement
  readonly statusBar: JWordStatusBarOptions
  readonly i18n: ResolvedJWordUiI18n
  readonly themeName: JWordUiThemeName
  readonly locale: JWordStatusBarLocale
  readonly assistive: {
    readonly liveRegion: JWordUiLiveRegionController | null
  }
  setTheme(theme: JWordUiThemeOptions): void
  setLocale(locale: JWordStatusBarLocale): void
  readonly brandWatermark?: {
    set(text: string): void
    clear(): void
  }
}

export interface StatusBarControllerHandle {
  readonly elements: JWordStatusBarElements
  setI18n(i18n: ResolvedJWordUiI18n, locale: JWordStatusBarLocale): void
  setThemeName(themeName: JWordUiThemeName): void
  refresh(): void
  destroy(): void
}

const DEFAULT_STATUS_BAR_THEMES = [
  'light',
  'dark'
] as const satisfies readonly JWordUiThemeName[]

const PRESENTATION_STATUS_BAR_EDGE_PX = 48
const BRAND_WATERMARK_FALLBACK_TAMPER_COUNT = 3
const BRAND_INTEGRITY_INTERVAL_MS = 500
const BRAND_ACTION_ATTRIBUTE = 'data-jword-status-bar-action'
const BRAND_ALLOWED_ATTRIBUTES = new Set([
  BRAND_ACTION_ATTRIBUTE,
  'style'
])
const BRAND_ALLOWED_STYLE_PROPERTIES = new Set([
  'align-items',
  'color',
  'display',
  'flex',
  'flex-basis',
  'flex-grow',
  'flex-shrink',
  'font-weight',
  'margin-right',
  'opacity',
  'text-wrap-mode',
  'visibility',
  'white-space',
  'white-space-collapse'
])

/** 创建状态栏 controller。 */
export function createStatusBarController(options: CreateStatusBarControllerOptions): StatusBarControllerHandle {
  const signalController = new AbortController()
  const zoomOptions = resolveStatusBarZoomOptions(options.statusBar.zoom)
  const brandProtection = resolveBrandProtection(options.statusBar.brand)
  const brandLabel = readStatusBarBrandLabel(options.statusBar.brand, options.i18n)
  const themes = options.statusBar.themeSwitcher === false
    ? []
    : options.statusBar.themeSwitcher?.themes ?? DEFAULT_STATUS_BAR_THEMES
  const locales = options.statusBar.localeSwitcher === false
    ? []
    : resolveStatusBarLocaleOptions(options.statusBar.localeSwitcher?.locales)
  const items = resolveVisibleItems(options.statusBar, brandProtection)
  let i18n = options.i18n
  let themeName = options.themeName
  let locale = options.locale
  let destroyed = false
  const dom = createStatusBarDom({
    host: options.host,
    items,
    i18n,
    brandLabel,
    minZoomPercent: zoomOptions.minPercent,
    maxZoomPercent: zoomOptions.maxPercent,
    zoomStepPercent: zoomOptions.stepPercent,
    themes,
    locales
  })
  const fullscreenHost = options.statusBar.fullscreenHost ?? options.fullscreenHost ?? options.editorHost ?? options.host
  const viewController = createJWordUiViewController({
    editor: options.editor,
    ...(options.editorHost === undefined ? {} : { editorHost: options.editorHost }),
    fullscreenHost,
    zoomOptions,
    presentationHosts: [
      dom.root,
      options.host,
      fullscreenHost
    ],
    presentationHiddenHosts: [
      dom.root,
      options.host
    ],
    presentationPeekHosts: [
      dom.root,
      options.host
    ]
  })
  const viewStateHost = viewController.stateHost
  const canvasContainer = readCanvasContainer(options.editorHost)
  const stopBrandProtection = bindBrandProtection()
  const unsubscribeEditor = options.editor.subscribe((event) => {
    if (event.kind === 'transaction' || event.kind === 'selectionChange') {
      refresh()
    }
  })

  bindStatusBarEvents()
  refresh()

  return {
    elements: dom,
    setI18n(nextI18n, nextLocale): void {
      i18n = nextI18n
      locale = nextLocale
      localizeStatusBarDom(dom, i18n, themes, locales)
      refresh()
    },
    setThemeName(nextThemeName): void {
      themeName = nextThemeName
      refresh()
    },
    refresh,
    destroy(): void {
      if (destroyed) {
        return
      }

      destroyed = true
      signalController.abort()
      stopBrandProtection()
      options.brandWatermark?.clear()
      unsubscribeEditor()
      options.host.removeAttribute('data-jword-presentation')
      options.host.removeAttribute('data-jword-presentation-hidden')
      options.host.removeAttribute('data-jword-presentation-peek')
      fullscreenHost.removeAttribute('data-jword-presentation')
      viewStateHost.removeAttribute('data-jword-view-fit-mode')
      destroyStatusBarDom(dom)
    }
  }

  /** 绑定状态栏交互和刷新来源。 */
  function bindStatusBarEvents(): void {
    dom.zoomSlider?.addEventListener('input', () => {
      applyZoomPercent(Number.parseFloat(dom.zoomSlider?.value ?? '100'))
    }, { signal: signalController.signal })
    bindButton(dom.zoomOutButton ?? undefined, () => {
      applyZoomStep(-1)
    })
    bindButton(dom.zoomInButton ?? undefined, () => {
      applyZoomStep(1)
    })

    bindButton(dom.controls.zoomReset, () => {
      applyZoomPercent(100)
    })
    bindButton(dom.controls.fitWidth, () => {
      applyFitScale('width')
    })
    bindButton(dom.controls.fitPage, () => {
      applyFitScale('page')
    })
    bindButton(dom.controls.presentation, () => {
      viewController.togglePresentation()
      refresh()
    })
    bindButton(dom.controls.fullscreen, () => {
      void toggleFullscreen()
    })
    dom.themeSelect?.addEventListener('change', () => {
      const nextTheme = dom.themeSelect?.value as JWordUiThemeName

      themeName = nextTheme
      options.setTheme({ name: nextTheme })
      announce(readJWordUiText(i18n, 'a11y.statusBar.themeChanged', '主题已切换为 {theme}。')
        .replace('{theme}', readThemeAnnouncementName(nextTheme)))
      refresh()
    }, { signal: signalController.signal })
    dom.localeSelect?.addEventListener('change', () => {
      const nextLocale = dom.localeSelect?.value as JWordStatusBarLocale

      options.setLocale(nextLocale)
    }, { signal: signalController.signal })
    canvasContainer?.addEventListener('scroll', refresh, { signal: signalController.signal })
    options.host.ownerDocument.defaultView?.addEventListener('resize', refresh, { signal: signalController.signal })
    options.host.ownerDocument.addEventListener('fullscreenchange', refresh, { signal: signalController.signal })
    options.host.ownerDocument.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || !viewController.readPresentation()) {
        return
      }

      event.preventDefault()
      viewController.writePresentation(false)
      refresh()
    }, {
      capture: true,
      signal: signalController.signal
    })
    fullscreenHost.addEventListener('mousemove', syncPresentationPeekFromPointer, { signal: signalController.signal })
    fullscreenHost.addEventListener('mouseleave', (event) => {
      if (isLeavingToStatusBar(event)) {
        return
      }

      viewController.writePresentationPeek(false)
    }, { signal: signalController.signal })
    options.host.addEventListener('mouseenter', () => {
      viewController.writePresentationPeek(true)
    }, { signal: signalController.signal })
    options.host.addEventListener('mouseleave', () => {
      viewController.writePresentationPeek(false)
    }, { signal: signalController.signal })
    viewStateHost.addEventListener(JWORD_UI_VIEW_STATE_CHANGE_EVENT, () => {
      viewController.syncPresentationAttributes()
      refresh()
    }, { signal: signalController.signal })
  }

  /** 绑定按钮点击。 */
  function bindButton(control: HTMLElement | undefined, listener: () => void): void {
    if (!(control instanceof HTMLButtonElement)) {
      return
    }

    control.addEventListener('click', listener, { signal: signalController.signal })
  }

  /** 根据鼠标是否靠近编辑器底部边缘同步状态栏临时显示状态。 */
  function syncPresentationPeekFromPointer(event: MouseEvent): void {
    if (!viewController.readPresentation()) {
      viewController.writePresentationPeek(false)
      return
    }

    const rect = fullscreenHost.getBoundingClientRect()
    const distanceFromBottom = rect.bottom - event.clientY
    const nearBottom = distanceFromBottom >= 0 && distanceFromBottom <= PRESENTATION_STATUS_BAR_EDGE_PX

    viewController.writePresentationPeek(nearBottom)
  }

  /** 判断鼠标是否从编辑器进入状态栏，避免刚唤出就立刻隐藏。 */
  function isLeavingToStatusBar(event: MouseEvent): boolean {
    const relatedTarget = event.relatedTarget
    const NodeCtor = options.host.ownerDocument.defaultView?.Node

    return NodeCtor !== undefined
      && relatedTarget instanceof NodeCtor
      && options.host.contains(relatedTarget)
  }

  /** 刷新状态栏动态内容。 */
  function refresh(): void {
    if (destroyed) {
      return
    }

    const stats = createStatusBarDocumentStats(options.editor.getProjection())
    const pageCount = readPageCount(options.editorHost, options.editor)
    const zoomPercent = viewController.readZoomPercent()

    renderStatusBarDomState(dom, {
      ...stats,
      currentPage: readCurrentPage(options.editorHost, pageCount),
      totalPages: pageCount,
      selectionText: readSelectionStatsText(),
      zoomPercent,
      fullscreen: viewController.readFullscreenActive(),
      fullscreenAvailable: viewController.readFullscreenAvailable(),
      fitMode: viewController.readFitMode(),
      presentation: viewController.readPresentation(),
      theme: themeName,
      locale
    }, i18n)
  }

  /** 应用具体缩放百分比。 */
  function applyZoomPercent(percent: number): void {
    const nextPercent = viewController.applyZoomPercent(percent)

    announce(readJWordUiText(i18n, 'a11y.statusBar.zoomChanged', '缩放已调整为 {percent}%。')
      .replace('{percent}', String(nextPercent)))
    refresh()
  }

  /** 按状态栏默认步长放大或缩小。 */
  function applyZoomStep(direction: -1 | 1): void {
    const nextPercent = viewController.applyZoomStep(direction)

    announce(readJWordUiText(i18n, 'a11y.statusBar.zoomChanged', '缩放已调整为 {percent}%。')
      .replace('{percent}', String(nextPercent)))
    refresh()
  }

  /** 应用适应宽度或整页缩放。 */
  function applyFitScale(mode: 'width' | 'page'): void {
    const nextPercent = viewController.applyFitScale(mode)

    if (nextPercent === null) {
      return
    }

    announce(readJWordUiText(i18n, 'a11y.statusBar.zoomChanged', '缩放已调整为 {percent}%。')
      .replace('{percent}', String(nextPercent)))
    refresh()
  }

  /** 切换全屏。 */
  async function toggleFullscreen(): Promise<void> {
    await viewController.toggleFullscreen()

    refresh()
  }

  /** 读取选区统计文案。 */
  function readSelectionStatsText(): string {
    const selection = options.editor.getSelection()

    if (selection === null || isSelectionCollapsed(selection)) {
      return readJWordUiText(i18n, 'statusBar.stats.selectionUnavailable', '选区统计暂不可用')
    }

    const selectedText = readSelectionText(options.editor, selection)

    if (selectedText.length === 0 || selectedText === '跨段选区') {
      return readJWordUiText(i18n, 'statusBar.stats.selectionUnavailable', '选区统计暂不可用')
    }

    const stats = createStatusBarTextStats(selectedText)

    return `${stats.words}/${stats.characters}`
  }

  /** 播报状态变化。 */
  function announce(message: string): void {
    options.assistive.liveRegion?.announce(message, { force: true })
  }

  /** 启动版权 DOM 防篡改监听。 */
  function bindBrandProtection(): () => void {
    if (brandProtection === 'hidden' || !(dom.controls.brand instanceof HTMLElement)) {
      return () => {}
    }

    const MutationObserverCtor = options.host.ownerDocument.defaultView?.MutationObserver ?? MutationObserver
    let restoring = false
    let tamperCount = 0
    const syncBrandIntegrity = (): void => {
      if (destroyed || restoring) {
        return
      }

      const brand = dom.controls.brand

      if (!(brand instanceof HTMLElement) || !isBrandTampered(brand, brandLabel, dom.left)) {
        return
      }

      tamperCount += 1
      restoring = true
      restoreBrandElement(brand, brandLabel, dom.left)
      restoring = false

      if (brandProtection === 'watermarkFallback' && tamperCount >= BRAND_WATERMARK_FALLBACK_TAMPER_COUNT) {
        options.brandWatermark?.set(brandLabel)
      }
    }
    const observer = new MutationObserverCtor(syncBrandIntegrity)
    const integrityTimer = setInterval(syncBrandIntegrity, BRAND_INTEGRITY_INTERVAL_MS)

    observer.observe(options.host, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true
    })
    restoreBrandElement(dom.controls.brand, brandLabel, dom.left)

    return () => {
      observer.disconnect()
      clearInterval(integrityTimer)
    }
  }
}

/** 解析真正显示的 item 列表。 */
function resolveVisibleItems(
  options: JWordStatusBarOptions,
  brandProtection: JWordStatusBarBrandProtectionMode
): readonly JWordStatusBarItemId[] {
  return resolveStatusBarItems(options).filter((item) => {
    if (item === 'brand' && brandProtection === 'hidden') {
      return false
    }

    if (item === 'themeSwitcher' && options.themeSwitcher === false) {
      return false
    }

    if (item === 'localeSwitcher' && options.localeSwitcher === false) {
      return false
    }

    return true
  })
}

/** 解析状态栏版权保护模式。 */
function resolveBrandProtection(brand: JWordStatusBarOptions['brand']): JWordStatusBarBrandProtectionMode {
  if (brand === false || brand?.protection === 'hidden') {
    return 'hidden'
  }

  return brand?.protection ?? 'restore'
}

/** 读取状态栏品牌文案。 */
function readStatusBarBrandLabel(
  brand: JWordStatusBarOptions['brand'],
  i18n: ResolvedJWordUiI18n
): string {
  if (brand === false) {
    return ''
  }

  return brand?.label ?? readJWordUiText(i18n, 'statusBar.brand.label', 'JWord')
}

/** 判断品牌节点是否被删除、隐藏或改写。 */
function isBrandTampered(brand: HTMLElement, label: string, left: HTMLElement): boolean {
  const computedStyle = brand.ownerDocument.defaultView?.getComputedStyle(brand)

  return brand.parentElement !== left
    || brand.hidden === true
    || brand.textContent !== label
    || !hasExpectedBrandStyle(brand)
    || brand.getAttribute(BRAND_ACTION_ATTRIBUTE) !== 'brand'
    || hasUnexpectedBrandAttribute(brand)
    || computedStyle?.display === 'none'
    || computedStyle?.visibility === 'hidden'
    || computedStyle?.opacity === '0'
}

/** 恢复品牌节点内容、样式和位置。 */
function restoreBrandElement(brand: HTMLElement, label: string, left: HTMLElement): void {
  removeUnexpectedBrandAttributes(brand)
  brand.removeAttribute('style')
  brand.setAttribute(BRAND_ACTION_ATTRIBUTE, 'brand')
  brand.hidden = false
  brand.textContent = label
  brand.style.setProperty('align-items', 'center', 'important')
  brand.style.setProperty('color', 'var(--jw-color-text-muted, #667085)', 'important')
  brand.style.setProperty('display', 'inline-flex', 'important')
  brand.style.setProperty('flex', '0 0 auto', 'important')
  brand.style.setProperty('font-weight', '600', 'important')
  brand.style.setProperty('margin-right', '10px', 'important')
  brand.style.setProperty('visibility', 'visible', 'important')
  brand.style.setProperty('opacity', '1', 'important')
  brand.style.setProperty('white-space', 'nowrap', 'important')
  if (brand.parentElement !== left) {
    left.prepend(brand)
  }
}

/** 判断品牌节点是否存在额外属性。 */
function hasUnexpectedBrandAttribute(brand: HTMLElement): boolean {
  return [...brand.attributes].some((attribute) => !BRAND_ALLOWED_ATTRIBUTES.has(attribute.name))
}

/** 判断品牌节点关键内联样式是否仍为官方保护值。 */
function hasExpectedBrandStyle(brand: HTMLElement): boolean {
  const style = brand.style

  return !hasUnexpectedBrandStyleProperty(style)
    && style.getPropertyValue('align-items') === 'center'
    && style.getPropertyPriority('align-items') === 'important'
    && style.getPropertyValue('color') === 'var(--jw-color-text-muted, #667085)'
    && style.getPropertyValue('display') === 'inline-flex'
    && style.getPropertyPriority('display') === 'important'
    && style.getPropertyValue('flex') === '0 0 auto'
    && style.getPropertyPriority('flex') === 'important'
    && style.getPropertyValue('font-weight') === '600'
    && style.getPropertyPriority('font-weight') === 'important'
    && style.getPropertyValue('margin-right') === '10px'
    && style.getPropertyPriority('margin-right') === 'important'
    && style.getPropertyValue('visibility') === 'visible'
    && style.getPropertyPriority('visibility') === 'important'
    && style.getPropertyValue('opacity') === '1'
    && style.getPropertyPriority('opacity') === 'important'
    && style.getPropertyValue('white-space') === 'nowrap'
    && style.getPropertyPriority('white-space') === 'important'
}

/** 判断品牌节点是否存在额外内联样式。 */
function hasUnexpectedBrandStyleProperty(style: CSSStyleDeclaration): boolean {
  for (let index = 0; index < style.length; index += 1) {
    const property = style.item(index)

    if (!BRAND_ALLOWED_STYLE_PROPERTIES.has(property)) {
      return true
    }
  }

  return false
}

/** 移除品牌节点上不属于官方结构的属性。 */
function removeUnexpectedBrandAttributes(brand: HTMLElement): void {
  for (const attribute of [...brand.attributes]) {
    if (!BRAND_ALLOWED_ATTRIBUTES.has(attribute.name)) {
      brand.removeAttribute(attribute.name)
    }
  }
}

/** 读取 canvas 容器。 */
function readCanvasContainer(editorHost: HTMLElement | undefined): HTMLElement | null {
  return editorHost?.querySelector<HTMLElement>('[data-jword-canvas-container]') ?? null
}

/** 优先从已挂载 DOM 读取页数，避免事务热路径触发布局。 */
function readPageCount(editorHost: HTMLElement | undefined, editor: Editor): number {
  const rawPageCount = readCanvasContainer(editorHost)?.getAttribute('data-jword-page-count')
  const mountedPageCount = rawPageCount === null || rawPageCount === undefined
    ? 0
    : Number.parseInt(rawPageCount, 10) || 0

  if (mountedPageCount > 0) {
    return mountedPageCount
  }

  return Math.max(1, editor.getLayout().pages.length)
}

/** 读取当前可见页，首批无可见页时回退第一页。 */
function readCurrentPage(editorHost: HTMLElement | undefined, totalPages: number): number {
  const container = readCanvasContainer(editorHost)

  if (container === null) {
    return 1
  }

  const pages = [...container.querySelectorAll<HTMLElement>('[data-jword-page]')]

  if (pages.length === 0) {
    return 1
  }

  const containerRect = container.getBoundingClientRect()
  const centerY = containerRect.top + containerRect.height / 2
  let closestPage = pages[0]
  let closestDistance = Number.POSITIVE_INFINITY

  for (const page of pages) {
    const rect = page.getBoundingClientRect()
    const pageCenter = rect.top + rect.height / 2
    const distance = Math.abs(centerY - pageCenter)

    if (distance < closestDistance) {
      closestDistance = distance
      closestPage = page
    }
  }

  const pageIndex = Number.parseInt(closestPage?.getAttribute('data-jword-page') ?? '0', 10) || 0

  return Math.min(totalPages, Math.max(1, pageIndex + 1))
}

/** 读取主题播报文案。 */
function readThemeAnnouncementName(theme: JWordUiThemeName): string {
  if (theme === 'dark') {
    return 'dark'
  }

  return 'light'
}
