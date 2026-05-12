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
}

export interface SyncPageCanvasesInput {
  readonly pages: readonly LayoutBox[]
  readonly retainedPageIndexes: readonly number[]
  readonly canvases: ReadonlyMap<number, CanvasLike>
  readonly pool: CanvasPool
  readonly selectionRects?: readonly LayoutRect[]
  readonly caretRect?: LayoutRect
  readonly scale?: number
}

const MAX_CANVAS_SIDE_PX = 4096
const MAX_CANVAS_AREA_PX = 16777216

export function renderPageCanvas(input: RenderPageInput): void {
  const context = input.canvas.getContext('2d')

  if (context === null) {
    return
  }

  const renderScale = resolveRenderScale(input.page, input.scale ?? 1)
  const canvasWidth = Math.max(1, Math.round(twipsToCssPx(input.page.width, renderScale)))
  const canvasHeight = Math.max(1, Math.round(twipsToCssPx(input.page.height, renderScale)))

  input.canvas.width = canvasWidth
  input.canvas.height = canvasHeight

  context.clearRect(0, 0, canvasWidth, canvasHeight)
  context.fillStyle = input.backgroundColor ?? '#ffffff'
  context.fillRect(0, 0, canvasWidth, canvasHeight)

  for (const rect of input.selectionRects ?? []) {
    if (rect.pageIndex === input.page.pageIndex) {
      context.fillStyle = input.selectionColor ?? '#cfe3ff'
      context.fillRect(
        toCanvasX(input.page, rect.x, renderScale),
        toCanvasY(input.page, rect.y, renderScale),
        twipsToCssPx(rect.width, renderScale),
        twipsToCssPx(rect.height, renderScale)
      )
    }
  }

  for (const line of input.page.lines) {
    for (const fragment of line.fragments) {
      context.fillStyle = fragment.style?.color ?? '#111827'
      context.font = formatCanvasFont(fragment, renderScale)
      context.textBaseline = 'alphabetic'
      context.fillText(
        fragment.text,
        toCanvasX(input.page, fragment.x, renderScale),
        toCanvasY(input.page, fragment.baseline, renderScale)
      )
    }
  }

  if (input.caretRect?.pageIndex === input.page.pageIndex) {
    context.fillStyle = input.caretColor ?? '#111827'
    context.fillRect(
      toCanvasX(input.page, input.caretRect.x, renderScale),
      toCanvasY(input.page, input.caretRect.y, renderScale),
      Math.max(1, twipsToCssPx(input.caretRect.width, renderScale)),
      twipsToCssPx(input.caretRect.height, renderScale)
    )
  }
}

export function syncPageCanvases(input: SyncPageCanvasesInput): Map<number, CanvasLike> {
  const retained = new Set(input.retainedPageIndexes)
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

    const renderScale = resolveRenderScale(page, input.scale ?? 1)
    const canvas = input.canvases.get(page.pageIndex) ?? input.pool.acquire(
      Math.max(1, Math.round(twipsToCssPx(page.width, renderScale))),
      Math.max(1, Math.round(twipsToCssPx(page.height, renderScale)))
    )

    const renderInput: RenderPageInput = {
      canvas,
      page,
      ...(input.selectionRects === undefined ? {} : { selectionRects: input.selectionRects }),
      ...(input.caretRect === undefined ? {} : { caretRect: input.caretRect }),
      ...(input.scale === undefined ? {} : { scale: input.scale })
    }

    renderPageCanvas(renderInput)
    next.set(page.pageIndex, canvas)
  }

  return next
}

function resolveRenderScale(page: LayoutBox, scale: number): number {
  const rawWidth = twipsToCssPx(page.width, scale)
  const rawHeight = twipsToCssPx(page.height, scale)
  const sideScale = Math.min(1, MAX_CANVAS_SIDE_PX / rawWidth, MAX_CANVAS_SIDE_PX / rawHeight)
  const areaScale = Math.min(1, Math.sqrt(MAX_CANVAS_AREA_PX / Math.max(1, rawWidth * rawHeight)))

  return scale * Math.min(sideScale, areaScale)
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
  const fontSizePx = Math.max(1, Math.round((style.fontSizePx ?? 16) * scale))
  const fontFamily = style.fontFamily ?? 'sans-serif'

  return [...traits, `${fontSizePx}px`, fontFamily].join(' ')
}
