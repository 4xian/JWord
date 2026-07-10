/**
 * 职责：管理编辑器实例级页面水印和内置版权水印 DOM。
 * 边界：只挂载 UI 水印层，不修改 core 文档模型、事务或导出数据。
 * 协作模块：ui-lifecycle 暴露公开 API，toolbar/statusBar 可调用本 controller。
 * 性能/安全约束：只监听 SDK 自己创建的水印层，避免全局 MutationObserver。
 * 实现说明：用户水印与品牌保护水印分层管理，clearWatermark 只清除用户水印。
 */
import type { JWordWatermarkOptions } from '../types'

export interface WatermarkControllerHandle {
  setWatermark(options: JWordWatermarkOptions): void
  clearWatermark(): void
  getWatermark(): JWordWatermarkOptions | null
  setBrandWatermark(text: string): void
  clearBrandWatermark(): void
  destroy(): void
}

interface WatermarkLayerState {
  readonly text: string
  readonly fontSizePx: number
  readonly color: string
  readonly opacity: number
  readonly rotateDeg: number
}

interface WatermarkLayerEntry {
  readonly host: HTMLElement
  readonly layer: HTMLElement
}

type WatermarkLayerKind = typeof USER_WATERMARK_KIND | typeof BRAND_WATERMARK_KIND

const USER_WATERMARK_KIND = 'user'
const BRAND_WATERMARK_KIND = 'brand'
const WATERMARK_INTEGRITY_INTERVAL_MS = 500
const WATERMARK_ALLOWED_ATTRIBUTES = new Set([
  'class',
  'data-jword-watermark-layer',
  'aria-hidden',
  'style'
])
const WATERMARK_ALLOWED_STYLE_PROPERTIES = new Set([
  'background-image',
  'background-repeat',
  'background-size',
  'bottom',
  'display',
  'inset',
  'left',
  'opacity',
  'pointer-events',
  'position',
  'right',
  'top',
  'visibility',
  'z-index'
])
const DEFAULT_USER_WATERMARK: Omit<WatermarkLayerState, 'text'> = {
  fontSizePx: 28,
  color: '#9ca3af',
  opacity: 0.18,
  rotateDeg: -30
}
const DEFAULT_BRAND_WATERMARK: Omit<WatermarkLayerState, 'text'> = {
  fontSizePx: 22,
  color: '#9ca3af',
  opacity: 0.14,
  rotateDeg: -30
}

/** 创建编辑器水印 controller。 */
export function createWatermarkController(editorHost: HTMLElement | undefined): WatermarkControllerHandle {
  const container = readWatermarkContainer(editorHost)
  const observers: MutationObserver[] = []
  let integrityTimer: ReturnType<typeof setInterval> | null = null
  let userState: WatermarkLayerState | null = null
  let brandState: WatermarkLayerState | null = null
  let userLayers: WatermarkLayerEntry[] = []
  let brandLayers: WatermarkLayerEntry[] = []
  let restoringLayers = false
  let destroyed = false

  if (container !== null) {
    observeContainer(container)
    integrityTimer = setInterval(syncWatermarkIntegrity, WATERMARK_INTEGRITY_INTERVAL_MS)
  }

  return {
    setWatermark(options): void {
      const nextState = normalizeWatermarkOptions(options)

      if (nextState === null) {
        this.clearWatermark()
        return
      }

      userState = nextState
      userLayers = ensureLayers(USER_WATERMARK_KIND, userLayers, userState)
    },
    clearWatermark(): void {
      userState = null
      removeLayers(userLayers)
      userLayers = []
    },
    getWatermark(): JWordWatermarkOptions | null {
      if (userState === null) {
        return null
      }

      return { ...userState }
    },
    setBrandWatermark(text): void {
      const normalizedText = text.trim()

      if (normalizedText.length === 0) {
        this.clearBrandWatermark()
        return
      }

      brandState = {
        ...DEFAULT_BRAND_WATERMARK,
        text: normalizedText
      }
      brandLayers = ensureLayers(BRAND_WATERMARK_KIND, brandLayers, brandState)
    },
    clearBrandWatermark(): void {
      brandState = null
      removeLayers(brandLayers)
      brandLayers = []
    },
    destroy(): void {
      destroyed = true
      for (const observer of observers) {
        observer.disconnect()
      }
      observers.length = 0
      if (integrityTimer !== null) {
        clearInterval(integrityTimer)
        integrityTimer = null
      }
      removeLayers(userLayers)
      removeLayers(brandLayers)
      userLayers = []
      brandLayers = []
    }
  }

  /** 为每个页面创建或恢复指定水印层。 */
  function ensureLayers(
    kind: WatermarkLayerKind,
    currentLayers: readonly WatermarkLayerEntry[],
    state: WatermarkLayerState
  ): WatermarkLayerEntry[] {
    if (container === null || destroyed) {
      return []
    }

    const hosts = readWatermarkHosts(container)
    const nextLayers = hosts.map((host) => {
      const currentLayer = currentLayers.find((entry) => entry.host === host && entry.layer.parentElement === host)?.layer
      const layer = currentLayer
        ?? readDirectWatermarkLayer(host, kind)
        ?? createWatermarkLayer(container.ownerDocument, kind)

      renderWatermarkLayer(layer, kind, state)
      if (layer.parentElement !== host) {
        host.append(layer)
      }

      return { host, layer }
    })

    for (const entry of currentLayers) {
      if (!nextLayers.some((nextEntry) => nextEntry.layer === entry.layer)) {
        entry.layer.remove()
      }
    }

    return nextLayers
  }

  /** 监听容器和水印层删除/隐藏，进行 best-effort 恢复。 */
  function observeContainer(target: HTMLElement): void {
    const MutationObserverCtor = target.ownerDocument.defaultView?.MutationObserver ?? MutationObserver
    const observer = new MutationObserverCtor(() => {
      if (destroyed || restoringLayers) {
        return
      }

      syncWatermarkIntegrity()
    })

    observer.observe(target, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true
    })
    observers.push(observer)
  }

  /** 周期性校验水印完整性，覆盖外部样式表或 CSSOM 改写。 */
  function syncWatermarkIntegrity(): void {
    if (container === null || destroyed || restoringLayers) {
      return
    }

    let restored = false
    if (userState !== null && areLayersTampered(USER_WATERMARK_KIND, userLayers, container, userState)) {
      userLayers = ensureLayers(USER_WATERMARK_KIND, userLayers, userState)
      restored = true
    }
    if (brandState !== null && areLayersTampered(BRAND_WATERMARK_KIND, brandLayers, container, brandState)) {
      brandLayers = ensureLayers(BRAND_WATERMARK_KIND, brandLayers, brandState)
      restored = true
    }
    if (restored) {
      restoringLayers = true
      setTimeout(() => {
        restoringLayers = false
      }, 0)
    }
  }
}

/** 规范化用户水印配置。 */
export function normalizeWatermarkOptions(options: JWordWatermarkOptions): WatermarkLayerState | null {
  const text = normalizeWatermarkText(options.text)

  if (text.length === 0) {
    return null
  }

  return {
    text,
    fontSizePx: normalizePositiveNumber(options.fontSizePx, DEFAULT_USER_WATERMARK.fontSizePx),
    color: options.color?.trim() || DEFAULT_USER_WATERMARK.color,
    opacity: clampNumber(options.opacity ?? DEFAULT_USER_WATERMARK.opacity, 0.01, 1),
    rotateDeg: Number.isFinite(options.rotateDeg) ? Number(options.rotateDeg) : DEFAULT_USER_WATERMARK.rotateDeg
  }
}

/** 创建水印层 DOM。 */
function createWatermarkLayer(ownerDocument: Document, kind: WatermarkLayerKind): HTMLElement {
  const layer = ownerDocument.createElement('div')

  layer.className = `jw-watermark-layer jw-watermark-layer--${kind}`
  layer.setAttribute('data-jword-watermark-layer', kind)
  layer.setAttribute('aria-hidden', 'true')

  return layer
}

/** 渲染水印层样式。 */
function renderWatermarkLayer(layer: HTMLElement, kind: WatermarkLayerKind, state: WatermarkLayerState): void {
  removeUnexpectedWatermarkAttributes(layer)
  layer.removeAttribute('style')
  layer.className = readWatermarkClassName(kind)
  layer.setAttribute('data-jword-watermark-layer', kind)
  layer.setAttribute('aria-hidden', 'true')
  layer.hidden = false
  layer.replaceChildren()
  layer.style.setProperty('position', 'absolute', 'important')
  layer.style.setProperty('inset', '0', 'important')
  layer.style.setProperty('z-index', kind === BRAND_WATERMARK_KIND ? '3' : '2', 'important')
  layer.style.setProperty('display', 'block', 'important')
  layer.style.setProperty('visibility', 'visible', 'important')
  layer.style.setProperty('opacity', '1', 'important')
  layer.style.setProperty('pointer-events', 'none', 'important')
  layer.style.setProperty('background-image', `url("${createWatermarkDataUrl(state)}")`, 'important')
  layer.style.setProperty('background-size', '260px 180px', 'important')
  layer.style.setProperty('background-repeat', 'repeat', 'important')
}

/** 创建 SVG data URL 水印背景。 */
function createWatermarkDataUrl(state: WatermarkLayerState): string {
  const lines = state.text.split('\n')
  const width = 260
  const height = 180
  const centerY = height / 2 - (lines.length - 1) * state.fontSizePx * 0.62 / 2
  const textNodes = lines.map((line, index) => {
    const y = centerY + index * state.fontSizePx * 1.24

    return `<text x="50%" y="${escapeSvgAttribute(String(y))}" dominant-baseline="middle" text-anchor="middle">${escapeSvgText(line)}</text>`
  }).join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><g transform="rotate(${escapeSvgAttribute(String(state.rotateDeg))} ${width / 2} ${height / 2})" fill="${escapeSvgAttribute(state.color)}" fill-opacity="${escapeSvgAttribute(String(state.opacity))}" font-family="Arial, sans-serif" font-size="${escapeSvgAttribute(String(state.fontSizePx))}">${textNodes}</g></svg>`

  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

/** 读取水印挂载容器。 */
function readWatermarkContainer(editorHost: HTMLElement | undefined): HTMLElement | null {
  return editorHost?.querySelector<HTMLElement>('[data-jword-canvas-container]') ?? null
}

/** 读取水印真正挂载的页面区域。 */
function readWatermarkHosts(container: HTMLElement): readonly HTMLElement[] {
  const pages = [...container.querySelectorAll<HTMLElement>('[data-jword-page], .jw-editor__page')]

  if (pages.length === 0) {
    ensureRelativePosition(container)
    return [container]
  }

  for (const page of pages) {
    ensureRelativePosition(page)
  }

  return pages
}

/** 确保水印绝对定位限制在当前宿主内。 */
function ensureRelativePosition(host: HTMLElement): void {
  if (host.style.position === '') {
    host.style.position = 'relative'
  }
}

/** 读取宿主下已有的直接水印层。 */
function readDirectWatermarkLayer(host: HTMLElement, kind: WatermarkLayerKind): HTMLElement | null {
  return [...host.children].find((child) => child.getAttribute('data-jword-watermark-layer') === kind) as HTMLElement | undefined ?? null
}

/** 判断任一页面水印层是否被删除、隐藏、改写或页面数量已变化。 */
function areLayersTampered(
  kind: WatermarkLayerKind,
  layers: readonly WatermarkLayerEntry[],
  container: HTMLElement,
  state: WatermarkLayerState
): boolean {
  const hosts = readWatermarkHosts(container)

  if (layers.length !== hosts.length) {
    return true
  }

  return hosts.some((host) => {
    const entry = layers.find((layerEntry) => layerEntry.host === host)

    return entry === undefined || isLayerTampered(kind, entry, state)
  })
}

/** 判断单个水印层是否被删除、隐藏或属性样式被改写。 */
function isLayerTampered(kind: WatermarkLayerKind, entry: WatermarkLayerEntry, state: WatermarkLayerState): boolean {
  const computedStyle = entry.layer.ownerDocument.defaultView?.getComputedStyle(entry.layer)

  return entry.layer.parentElement !== entry.host
    || entry.layer.className !== readWatermarkClassName(kind)
    || entry.layer.getAttribute('data-jword-watermark-layer') !== kind
    || entry.layer.getAttribute('aria-hidden') !== 'true'
    || entry.layer.hidden === true
    || entry.layer.childNodes.length > 0
    || hasUnexpectedWatermarkAttribute(entry.layer)
    || !hasExpectedWatermarkStyle(entry.layer, kind, state)
    || computedStyle?.display === 'none'
    || computedStyle?.visibility === 'hidden'
    || computedStyle?.opacity === '0'
}

/** 读取水印层标准 class。 */
function readWatermarkClassName(kind: WatermarkLayerKind): string {
  return `jw-watermark-layer jw-watermark-layer--${kind}`
}

/** 判断水印层是否存在额外属性。 */
function hasUnexpectedWatermarkAttribute(layer: HTMLElement): boolean {
  return [...layer.attributes].some((attribute) => !WATERMARK_ALLOWED_ATTRIBUTES.has(attribute.name))
}

/** 移除水印层上不属于官方结构的属性。 */
function removeUnexpectedWatermarkAttributes(layer: HTMLElement): void {
  for (const attribute of [...layer.attributes]) {
    if (!WATERMARK_ALLOWED_ATTRIBUTES.has(attribute.name)) {
      layer.removeAttribute(attribute.name)
    }
  }
}

/** 判断水印层关键内联样式是否仍为官方值。 */
function hasExpectedWatermarkStyle(layer: HTMLElement, kind: WatermarkLayerKind, state: WatermarkLayerState): boolean {
  const style = layer.style
  const expectedBackground = createWatermarkDataUrl(state)

  return !hasUnexpectedWatermarkStyleProperty(style)
    && style.getPropertyValue('position') === 'absolute'
    && style.getPropertyPriority('position') === 'important'
    && (style.getPropertyValue('inset') === '0' || style.getPropertyValue('inset') === '0px')
    && style.getPropertyPriority('inset') === 'important'
    && style.getPropertyValue('z-index') === (kind === BRAND_WATERMARK_KIND ? '3' : '2')
    && style.getPropertyPriority('z-index') === 'important'
    && style.getPropertyValue('display') === 'block'
    && style.getPropertyPriority('display') === 'important'
    && style.getPropertyValue('visibility') === 'visible'
    && style.getPropertyPriority('visibility') === 'important'
    && style.getPropertyValue('opacity') === '1'
    && style.getPropertyPriority('opacity') === 'important'
    && style.getPropertyValue('pointer-events') === 'none'
    && style.getPropertyPriority('pointer-events') === 'important'
    && style.getPropertyValue('background-image').includes(expectedBackground)
    && style.getPropertyPriority('background-image') === 'important'
    && style.getPropertyValue('background-size') === '260px 180px'
    && style.getPropertyPriority('background-size') === 'important'
    && style.getPropertyValue('background-repeat') === 'repeat'
    && style.getPropertyPriority('background-repeat') === 'important'
}

/** 判断水印层是否存在额外内联样式。 */
function hasUnexpectedWatermarkStyleProperty(style: CSSStyleDeclaration): boolean {
  for (let index = 0; index < style.length; index += 1) {
    const property = style.item(index)

    if (!WATERMARK_ALLOWED_STYLE_PROPERTIES.has(property)) {
      return true
    }
  }

  return false
}

/** 移除一组水印层。 */
function removeLayers(layers: readonly WatermarkLayerEntry[]): void {
  for (const entry of layers) {
    entry.layer.remove()
  }
}

/** 规范化水印多行内容。 */
function normalizeWatermarkText(text: string): string {
  return text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n')
}

/** 读取正数配置。 */
function normalizePositiveNumber(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return fallback
  }

  return Math.round(value)
}

/** 限制数值范围。 */
function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** 转义 SVG 属性。 */
function escapeSvgAttribute(value: string): string {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/"/gu, '&quot;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
}

/** 转义 SVG 文本。 */
function escapeSvgText(value: string): string {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
}
