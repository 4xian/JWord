/**
 * 职责：把 Gate 2 只读页面 布局盒 绘制到每页独立 canvas。
 * 边界：只消费结构化页面布局和选择/光标矩形，不生成布局、不访问 DOM、不处理输入事件。
 * 协作模块：layout 产出 页面盒、行盒和文本片段，视口虚拟器 决定保留页，画布池 管理 画布生命周期。
 * 性能/安全约束：每页单独 canvas，离屏页交给 画布池 回收，不实现单长 canvas，不默认 叠加层画布。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/03-architecture.md#35-分页-canvas-渲染。
 */

import type { CanvasLike, CanvasPool } from './canvas-pool'
import { twipsToCssPx } from './page-config'
import type { LayoutBox, LayoutRect, TextFragment } from './layout'

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
}

const MAX_CANVAS_SIDE_PX = 4096
const MAX_CANVAS_AREA_PX = 16777216

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

  for (const line of input.page.lines) {
    for (const fragment of line.fragments) {
      context.fillStyle = fragment.style?.color ?? '#111827'
      context.font = formatCanvasFont(fragment, drawingScale)
      context.textBaseline = 'alphabetic'
      context.fillText(
        fragment.text,
        toCanvasX(input.page, fragment.x, drawingScale),
        toCanvasY(input.page, fragment.baseline, drawingScale)
      )
    }
  }

  if (input.caretRect?.pageIndex === input.page.pageIndex) {
    context.fillStyle = input.caretColor ?? '#111827'
    context.fillRect(
      toCanvasX(input.page, input.caretRect.x, drawingScale),
      toCanvasY(input.page, input.caretRect.y, drawingScale),
      Math.max(1, twipsToCssPx(input.caretRect.width, drawingScale)),
      twipsToCssPx(input.caretRect.height, drawingScale)
    )
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
        ...(input.pixelRatio === undefined ? {} : { pixelRatio: input.pixelRatio })
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
