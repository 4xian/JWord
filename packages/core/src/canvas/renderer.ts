/**
 * 职责：把 Gate 2 只读页面 布局盒 绘制到每页独立 canvas。
 * 边界：只消费结构化页面布局和选择/光标矩形，不生成布局、不访问 DOM、不处理输入事件。
 * 协作模块：layout 产出 页面盒、行盒和文本片段，视口虚拟器 决定保留页，画布池 管理 画布生命周期。
 * 性能/安全约束：每页单独 canvas，离屏页交给 画布池 回收，不实现单长 canvas，不默认 叠加层画布。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/03-architecture.md#35-分页-canvas-渲染。
 */

import type { CanvasLike, CanvasPool } from './pool'
import { twipsToCssPx } from '../layout/page-config'
import type { ImageInlineLayoutPayload, InlineBox, LayoutBox, LayoutRect, TextFragment } from '../layout/runtime'
import type { CanvasImageResourceResolution, CanvasImageResourceResolver } from '../resources/canvas-image-resolver'

export interface RenderPageInput {
  readonly canvas: CanvasLike
  readonly page: LayoutBox
  readonly selectionRects?: readonly LayoutRect[]
  readonly caretRect?: LayoutRect
  readonly backgroundColor?: string
  readonly selectionColor?: string
  readonly caretColor?: string
  readonly scale?: number
  readonly pixelRatio?: number
  readonly imageResourceResolver?: CanvasImageResourceResolver
}

export interface SyncPageCanvasesInput {
  readonly pages: readonly LayoutBox[]
  readonly retainedPageIndexes: readonly number[]
  readonly rerenderPageIndexes?: readonly number[]
  readonly canvases: ReadonlyMap<number, CanvasLike>
  readonly pool: CanvasPool
  readonly selectionRects?: readonly LayoutRect[]
  readonly caretRect?: LayoutRect
  readonly scale?: number
  readonly pixelRatio?: number
  readonly imageResourceResolver?: CanvasImageResourceResolver
}

const MAX_CANVAS_SIDE_PX = 4096
const MAX_CANVAS_AREA_PX = 16777216
const DEFAULT_CANVAS_TEXT_COLOR = '#374151'
const DEFAULT_CANVAS_CARET_COLOR = '#111827'
const SUPERSCRIPT_BASELINE_SHIFT_RATIO = 0.35
const SUBSCRIPT_BASELINE_SHIFT_RATIO = 0.15
const IMAGE_STATUS_COLORS = Object.freeze({
  pending: { fill: '#fff7ed', border: '#f59e0b', text: '#92400e' },
  success: { fill: '#eff6ff', border: '#2563eb', text: '#1d4ed8' },
  failed: { fill: '#fef2f2', border: '#dc2626', text: '#991b1b' }
})

export function renderPageCanvas(input: RenderPageInput): void {
  const context = input.canvas.getContext('2d')

  if (context === null) {
    return
  }

  const cssScale = input.scale ?? 1
  const pixelRatio = Math.max(1, input.pixelRatio ?? 1)
  const cssWidth = Math.max(1, Math.round(twipsToCssPx(input.page.width, cssScale)))
  const cssHeight = Math.max(1, Math.round(twipsToCssPx(input.page.height, cssScale)))
  const backingStoreScale = resolveBackingStoreScale(input.page, cssScale, pixelRatio)
  const effectivePixelRatio = backingStoreScale / cssScale
  const canvasWidth = Math.max(1, Math.round(twipsToCssPx(input.page.width, backingStoreScale)))
  const canvasHeight = Math.max(1, Math.round(twipsToCssPx(input.page.height, backingStoreScale)))
  const supportsTransform = typeof context.setTransform === 'function'
  const drawingScale = supportsTransform ? cssScale : backingStoreScale

  applyCanvasDisplaySize(input.canvas, cssWidth, cssHeight)
  input.canvas.width = canvasWidth
  input.canvas.height = canvasHeight

  context.setTransform?.(1, 0, 0, 1, 0, 0)
  context.clearRect(0, 0, canvasWidth, canvasHeight)
  if (supportsTransform && effectivePixelRatio !== 1) {
    context.setTransform?.(effectivePixelRatio, 0, 0, effectivePixelRatio, 0, 0)
  }
  context.fillStyle = input.backgroundColor ?? '#ffffff'
  context.fillRect(0, 0, supportsTransform ? cssWidth : canvasWidth, supportsTransform ? cssHeight : canvasHeight)

  renderTextBackgrounds(context, input.page, drawingScale)
  renderSelectionRects(context, input, drawingScale)
  renderParagraphListMarkers(context, input.page, drawingScale)
  renderTextFragments(context, input.page, drawingScale)
  renderInlineObjects(context, input.page, drawingScale, input.imageResourceResolver)

  if (input.caretRect?.pageIndex === input.page.pageIndex) {
    context.fillStyle = input.caretColor ?? DEFAULT_CANVAS_CARET_COLOR
    context.fillRect(
      toCanvasX(input.page, input.caretRect.x, drawingScale),
      toCanvasY(input.page, input.caretRect.y, drawingScale),
      Math.max(1, twipsToCssPx(input.caretRect.width, drawingScale)),
      twipsToCssPx(input.caretRect.height, drawingScale)
    )
  }
}

function renderSelectionRects(
  context: NonNullable<ReturnType<CanvasLike['getContext']>>,
  input: RenderPageInput,
  drawingScale: number
): void {
  for (const rect of input.selectionRects ?? []) {
    if (rect.pageIndex === input.page.pageIndex) {
      context.fillStyle = input.selectionColor ?? '#cfe3ff'
      context.fillRect(
        toCanvasX(input.page, rect.x, drawingScale),
        toCanvasY(input.page, rect.y, drawingScale),
        twipsToCssPx(rect.width, drawingScale),
        twipsToCssPx(rect.height, drawingScale)
      )
    }
  }
}

function renderTextBackgrounds(
  context: NonNullable<ReturnType<CanvasLike['getContext']>>,
  page: LayoutBox,
  drawingScale: number
): void {
  for (const line of page.lines) {
    for (const fragment of line.fragments) {
      if (fragment.style.backgroundColor === undefined) {
        continue
      }

      context.fillStyle = fragment.style.backgroundColor
      context.fillRect(
        toCanvasX(page, fragment.x, drawingScale),
        toCanvasY(page, fragment.y, drawingScale),
        twipsToCssPx(fragment.width, drawingScale),
        twipsToCssPx(fragment.height, drawingScale)
      )
    }
  }
}

function renderTextFragments(
  context: NonNullable<ReturnType<CanvasLike['getContext']>>,
  page: LayoutBox,
  drawingScale: number
): void {
  for (const line of page.lines) {
    for (const fragment of line.fragments) {
      const x = toCanvasX(page, fragment.x, drawingScale)
      const baseline = toCanvasY(page, fragment.baseline, drawingScale)
        + readCanvasBaselineShiftPx(fragment, drawingScale)
      const width = twipsToCssPx(fragment.width, drawingScale)

      context.fillStyle = fragment.style.color ?? DEFAULT_CANVAS_TEXT_COLOR
      context.font = formatCanvasFont(fragment, drawingScale)
      context.textBaseline = 'alphabetic'
      context.fillText(fragment.text, x, baseline)
      renderTextDecoration(context, fragment, x, baseline, width, drawingScale)
    }
  }
}

function renderParagraphListMarkers(
  context: NonNullable<ReturnType<CanvasLike['getContext']>>,
  page: LayoutBox,
  drawingScale: number
): void {
  for (const paragraph of page.paragraphs) {
    if (paragraph.listMarker === undefined) {
      continue
    }

    const line = paragraph.lines[0]

    if (line === undefined) {
      continue
    }

    const referenceFragment = line.fragments[0]
    const referenceFontSizePx = referenceFragment?.style.fontSizePx ?? 16
    const markerText = paragraph.listMarker.text ?? paragraph.listMarker.label
    const baseline = referenceFragment === undefined
      ? toCanvasY(page, line.baseline, drawingScale)
      : toCanvasY(page, referenceFragment.baseline, drawingScale)
    const markerX = toCanvasX(page, line.x - paragraph.listMarker.gapTwips, drawingScale)
      - estimateParagraphMarkerWidthPx(markerText, referenceFontSizePx, drawingScale)

    context.fillStyle = referenceFragment?.style.color ?? DEFAULT_CANVAS_TEXT_COLOR
    context.font = referenceFragment === undefined
      ? `${Math.max(1, Math.round(referenceFontSizePx * drawingScale))}px sans-serif`
      : formatCanvasFont(referenceFragment, drawingScale)
    context.textBaseline = 'alphabetic'
    context.fillText(markerText, markerX, baseline)
  }
}

function renderInlineObjects(
  context: NonNullable<ReturnType<CanvasLike['getContext']>>,
  page: LayoutBox,
  drawingScale: number,
  imageResourceResolver?: CanvasImageResourceResolver
): void {
  for (const line of page.lines) {
    for (const inline of line.inlines) {
      if (inline.kind !== 'inlineObject' || inline.inlineKind !== 'image') {
        continue
      }

      renderImageInlineBox(context, page, inline, drawingScale, imageResourceResolver)
    }
  }
}

/**
 * 职责：优先绘制已解码图片，无法绘制时回退到状态占位图。
 */
function renderImageInlineBox(
  context: NonNullable<ReturnType<CanvasLike['getContext']>>,
  page: LayoutBox,
  inline: Extract<InlineBox, { readonly kind: 'inlineObject' }>,
  drawingScale: number,
  imageResourceResolver?: CanvasImageResourceResolver
): void {
  const payload = inline.payload as ImageInlineLayoutPayload
  const x = toCanvasX(page, inline.x, drawingScale)
  const y = toCanvasY(page, inline.y, drawingScale)
  const width = Math.max(1, twipsToCssPx(inline.width, drawingScale))
  const height = Math.max(1, twipsToCssPx(inline.height, drawingScale))
  const resolution = resolveImageInlineResource(imageResourceResolver, payload)
  const rotationDegrees = normalizeImageRotationDegrees(payload.rotationDegrees ?? 0)

  if (resolution?.status === 'ready' && typeof context.drawImage === 'function') {
    drawRotatedImage(context, resolution.image.source, x, y, width, height, rotationDegrees)
    return
  }

  const status = resolveImagePlaceholderStatus(payload, resolution)
  const palette = IMAGE_STATUS_COLORS[status]
  const label = status === 'failed'
    ? 'Image failed'
    : status === 'success'
      ? 'Image ready'
      : 'Image uploading'
  const detail = status === 'failed'
    ? payload.resourceErrorMessage ?? payload.alt ?? payload.resourceMime ?? payload.resourceId
    : payload.alt ?? payload.resourceMime ?? payload.resourceId
  const textX = x + 10
  const textBaseline = y + Math.max(20, height / 2)
  const handleSize = Math.max(6, Math.min(8, Math.round(Math.min(width, height) / 4)))
  const handleX = x + Math.max(0, width - handleSize - 4)
  const handleY = y + Math.max(0, height - handleSize - 4)

  context.fillStyle = palette.fill
  context.fillRect(x, y, width, height)
  context.fillStyle = palette.border
  context.fillRect(x, y, width, 2)
  context.fillRect(x, y + height - 2, width, 2)
  context.fillRect(x, y, 2, height)
  context.fillRect(x + width - 2, y, 2, height)
  context.fillStyle = palette.text
  context.font = `${Math.max(11, Math.round(12 * drawingScale))}px sans-serif`
  context.textBaseline = 'alphabetic'
  context.fillText(label, textX, textBaseline)
  context.fillText(detail.slice(0, 28), textX, Math.min(y + height - 8, textBaseline + 16))
  context.fillStyle = palette.border
  context.fillRect(handleX, handleY, handleSize, handleSize)
  context.fillStyle = palette.fill
  context.fillRect(handleX + 1, handleY + 1, handleSize - 2, handleSize - 2)
}

/**
 * 职责：根据资源状态和浏览器解码结果推导当前应显示的占位态。
 */
function resolveImagePlaceholderStatus(
  payload: ImageInlineLayoutPayload,
  resolution: CanvasImageResourceResolution | undefined
): keyof typeof IMAGE_STATUS_COLORS {
  if (resolution?.status === 'failed') {
    return 'failed'
  }

  return payload.resourceStatus ?? 'pending'
}

/**
 * 职责：仅在 success 态且存在可用 URL 时查询浏览器图片缓存。
 */
function resolveImageInlineResource(
  resolver: CanvasImageResourceResolver | undefined,
  payload: ImageInlineLayoutPayload
): CanvasImageResourceResolution | undefined {
  if (
    resolver === undefined
    || payload.resourceStatus !== 'success'
    || typeof payload.resourceSourceUrl !== 'string'
    || payload.resourceSourceUrl.length === 0
  ) {
    return undefined
  }

  return resolver.resolve(payload.resourceId, payload.resourceSourceUrl)
}

/** 以图片盒中心为轴绘制旋转后的图片。 */
function drawRotatedImage(
  context: NonNullable<ReturnType<CanvasLike['getContext']>>,
  source: unknown,
  x: number,
  y: number,
  width: number,
  height: number,
  rotationDegrees: number
): void {
  const drawImage = context.drawImage

  if (drawImage === undefined) {
    return
  }

  if (rotationDegrees === 0) {
    drawImage.call(context, source, x, y, width, height)
    return
  }

  if (
    context.save === undefined
    || context.restore === undefined
    || context.translate === undefined
    || context.rotate === undefined
  ) {
    drawImage.call(context, source, x, y, width, height)
    return
  }

  const centerX = x + (width / 2)
  const centerY = y + (height / 2)
  const quarterTurns = Math.abs(rotationDegrees / 90) % 2 === 1
  const drawBox = quarterTurns
    ? resolveQuarterTurnImageDrawBox(width, height)
    : { width, height }

  context.save()
  context.translate(centerX, centerY)
  context.rotate((rotationDegrees * Math.PI) / 180)
  drawImage.call(
    context,
    source,
    -drawBox.width / 2,
    -drawBox.height / 2,
    drawBox.width,
    drawBox.height
  )
  context.restore()
}

/** 在 90/270 度下缩放图片，避免在固定盒内被裁剪。 */
function resolveQuarterTurnImageDrawBox(width: number, height: number): Readonly<{
  width: number
  height: number
}> {
  const scale = Math.min(height / width, width / height)

  return {
    width: Math.max(1, width * scale),
    height: Math.max(1, height * scale)
  }
}

/** 统一把图片角度约束到 0-359。 */
function normalizeImageRotationDegrees(rotationDegrees: number): number {
  const normalized = Math.round(rotationDegrees) % 360

  return normalized < 0 ? normalized + 360 : normalized
}

function renderTextDecoration(
  context: NonNullable<ReturnType<CanvasLike['getContext']>>,
  fragment: TextFragment,
  x: number,
  baseline: number,
  width: number,
  drawingScale: number
): void {
  if (fragment.style.underline !== true && fragment.style.strike !== true) {
    return
  }

  const thickness = Math.max(1, Math.round(fragment.style.fontSizePx * drawingScale / 14))

  context.fillStyle = fragment.style.color ?? DEFAULT_CANVAS_TEXT_COLOR
  if (fragment.style.underline === true) {
    context.fillRect(x, baseline + Math.max(1, thickness), width, thickness)
  }

  if (fragment.style.strike === true) {
    context.fillRect(x, baseline - Math.max(2, fragment.style.fontSizePx * drawingScale * 0.3), width, thickness)
  }
}

export function syncPageCanvases(input: SyncPageCanvasesInput): Map<number, CanvasLike> {
  const retained = new Set(input.retainedPageIndexes)
  const rerendered = input.rerenderPageIndexes === undefined ? undefined : new Set(input.rerenderPageIndexes)
  const next = new Map<number, CanvasLike>()

  for (const [pageIndex, canvas] of input.canvases) {
    if (!retained.has(pageIndex)) {
      input.pool.release(canvas)
    }
  }

  for (const page of input.pages) {
    if (!retained.has(page.pageIndex)) {
      continue
    }

    const dimensions = getCanvasDimensions(page, input.scale ?? 1, input.pixelRatio ?? 1)
    const existingCanvas = input.canvases.get(page.pageIndex)
    const canvas = existingCanvas ?? input.pool.acquire(dimensions.width, dimensions.height)
    const shouldRender = existingCanvas === undefined || rerendered === undefined || rerendered.has(page.pageIndex)

    if (shouldRender) {
      const renderInput: RenderPageInput = {
        canvas,
        page,
        ...(input.selectionRects === undefined ? {} : { selectionRects: input.selectionRects }),
        ...(input.caretRect === undefined ? {} : { caretRect: input.caretRect }),
        ...(input.scale === undefined ? {} : { scale: input.scale }),
        ...(input.pixelRatio === undefined ? {} : { pixelRatio: input.pixelRatio }),
        ...(input.imageResourceResolver === undefined
          ? {}
          : { imageResourceResolver: input.imageResourceResolver })
      }

      renderPageCanvas(renderInput)
    }

    next.set(page.pageIndex, canvas)
  }

  return next
}

function applyCanvasDisplaySize(canvas: CanvasLike, width: number, height: number): void {
  const styledCanvas = canvas as CanvasLike & {
    style?: {
      width: string
      height: string
      display: string
    }
  }

  if (styledCanvas.style === undefined) {
    return
  }

  styledCanvas.style.width = `${width}px`
  styledCanvas.style.height = `${height}px`
  styledCanvas.style.display = 'block'
}

function getCanvasDimensions(
  page: LayoutBox,
  scale: number,
  pixelRatio: number
): Readonly<{
  width: number
  height: number
}> {
  const backingStoreScale = resolveBackingStoreScale(page, scale, pixelRatio)

  return {
    width: Math.max(1, Math.round(twipsToCssPx(page.width, backingStoreScale))),
    height: Math.max(1, Math.round(twipsToCssPx(page.height, backingStoreScale)))
  }
}

function resolveBackingStoreScale(page: LayoutBox, scale: number, pixelRatio: number): number {
  const rawWidth = twipsToCssPx(page.width, scale * pixelRatio)
  const rawHeight = twipsToCssPx(page.height, scale * pixelRatio)
  const sideScale = Math.min(1, MAX_CANVAS_SIDE_PX / rawWidth, MAX_CANVAS_SIDE_PX / rawHeight)
  const areaScale = Math.min(1, Math.sqrt(MAX_CANVAS_AREA_PX / Math.max(1, rawWidth * rawHeight)))

  return scale * pixelRatio * Math.min(sideScale, areaScale)
}

function toCanvasX(page: LayoutBox, x: number, scale: number): number {
  return twipsToCssPx(x - page.x, scale)
}

function toCanvasY(page: LayoutBox, y: number, scale: number): number {
  return twipsToCssPx(y - page.y, scale)
}

function formatCanvasFont(fragment: TextFragment, scale: number): string {
  const style = fragment.style
  const traits = [
    style.italic === true ? 'italic' : '',
    style.bold === true ? '700' : ''
  ].filter((trait) => trait.length > 0)
  const fontSizePx = Math.max(1, Math.round(style.fontSizePx * scale))
  const fontFamily = style.fontFamily

  return [...traits, `${fontSizePx}px`, fontFamily].join(' ')
}

function readCanvasBaselineShiftPx(fragment: TextFragment, scale: number): number {
  const baseFontSizePx = fragment.style.baseFontSizePx ?? fragment.style.fontSizePx

  if (fragment.style.superscript === true) {
    return -baseFontSizePx * SUPERSCRIPT_BASELINE_SHIFT_RATIO * scale
  }

  if (fragment.style.subscript === true) {
    return baseFontSizePx * SUBSCRIPT_BASELINE_SHIFT_RATIO * scale
  }

  return 0
}

function estimateParagraphMarkerWidthPx(label: string, fontSizePx: number, scale: number): number {
  return Math.max(1, Math.round(label.length * fontSizePx * 0.375 * scale))
}
