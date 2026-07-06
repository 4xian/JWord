/**
 * 职责：维护图片八点缩放会话与预览尺寸计算。
 * 边界：不绑定 DOM 事件，不提交 resize command，不读取 editor projection。
 * 协作模块：image-selection-controller 创建和提交会话，image-selection-dom 读取预览矩形。
 * 性能/安全约束：只做同步几何计算，不访问 DOM 顶层对象。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#iteration-1---图片纵线step-41-43。
 */

import { cssPxToTwips, twipsToCssPx } from '@4xian/jword-core'

import type { ResizeHandleId } from './image-selection-dom'
import type { ImageOverlayRect, ImageSelectionSnapshot } from './image-overlay-geometry'
import { resolveContainerPointer } from './image-overlay-geometry'

const MIN_IMAGE_SIZE_TWIPS = cssPxToTwips(24)

export interface ResizeSession {
  readonly target: ImageSelectionSnapshot['target']
  readonly handleId: ResizeHandleId
  readonly startRect: ImageOverlayRect
  readonly startClientX: number
  readonly startClientY: number
  readonly startWidthTwips: number
  readonly startHeightTwips: number
  previewRect: ImageOverlayRect
  previewWidthTwips: number
  previewHeightTwips: number
}

/** 从 handle pointer 事件创建缩放预览会话。 */
export function createResizeSession(
  handleId: ResizeHandleId,
  event: PointerEvent,
  snapshot: ImageSelectionSnapshot | null
): ResizeSession | null {
  const widthTwips = snapshot?.target.widthTwips ?? snapshot?.naturalWidthTwips
  const heightTwips = snapshot?.target.heightTwips ?? snapshot?.naturalHeightTwips

  if (snapshot === null || widthTwips === undefined || heightTwips === undefined) {
    return null
  }

  event.preventDefault()
  event.stopPropagation()

  return {
    target: snapshot.target,
    handleId,
    startRect: snapshot.rect,
    startClientX: event.clientX,
    startClientY: event.clientY,
    startWidthTwips: widthTwips,
    startHeightTwips: heightTwips,
    previewRect: snapshot.rect,
    previewWidthTwips: widthTwips,
    previewHeightTwips: heightTwips
  }
}

/** 根据 pointer 位移更新缩放预览。 */
export function updateResizePreview(
  session: ResizeSession,
  canvasContainer: HTMLElement,
  event: PointerEvent | MouseEvent
): void {
  const pointer = resolveContainerPointer(canvasContainer, event.clientX, event.clientY)
  const minSizePx = twipsToCssPx(MIN_IMAGE_SIZE_TWIPS, session.startRect.scale)
  const startLeft = session.startRect.leftPx
  const startTop = session.startRect.topPx
  const startRight = session.startRect.leftPx + session.startRect.widthPx
  const startBottom = session.startRect.topPx + session.startRect.heightPx
  let nextLeft = startLeft
  let nextTop = startTop
  let nextRight = startRight
  let nextBottom = startBottom

  if (session.handleId.endsWith('left')) {
    nextLeft = Math.min(pointer.x, startRight - minSizePx)
  }
  if (session.handleId.endsWith('right')) {
    nextRight = Math.max(pointer.x, startLeft + minSizePx)
  }
  if (session.handleId.startsWith('top')) {
    nextTop = Math.min(pointer.y, startBottom - minSizePx)
  }
  if (session.handleId.startsWith('bottom')) {
    nextBottom = Math.max(pointer.y, startTop + minSizePx)
  }

  const previewRect = {
    ...session.startRect,
    leftPx: nextLeft,
    topPx: nextTop,
    widthPx: Math.max(minSizePx, nextRight - nextLeft),
    heightPx: Math.max(minSizePx, nextBottom - nextTop)
  } satisfies ImageOverlayRect

  session.previewRect = previewRect
  session.previewWidthTwips = Math.max(
    MIN_IMAGE_SIZE_TWIPS,
    cssPxToTwips(previewRect.widthPx / session.startRect.scale)
  )
  session.previewHeightTwips = Math.max(
    MIN_IMAGE_SIZE_TWIPS,
    cssPxToTwips(previewRect.heightPx / session.startRect.scale)
  )
}

/** 读取当前缩放预览对应的 overlay 矩形。 */
export function resolveResizePreviewRect(baseRect: ImageOverlayRect, session: ResizeSession): ImageOverlayRect {
  return session.previewRect ?? baseRect
}
