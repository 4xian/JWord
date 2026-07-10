/**
 * 职责：维护图片拖拽鬼影、drop caret 和指针落点锚点解析。
 * 边界：不提交 move command，不创建 overlay DOM，不修改 editor selection。
 * 协作模块：image-selection-controller 负责命令提交，image-selection-dom 负责 caret DOM 同步。
 * 性能/安全约束：只读取已挂载页面元素和 editor 只读 hit-test/caret API。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import type {
  DocumentLayout,
  Editor,
  TextPosition
} from '@4xian/jword-core'

import type { ImageSelectionDom } from './image-selection-dom'
import type { ImageOverlayRect, ImageSelectionSnapshot } from './image-overlay-geometry'
import {
  resolveContainerPointer,
  resolveLayoutRectOverlay
} from './image-overlay-geometry'

const DRAG_GHOST_THRESHOLD_PX = 3

export interface DragGhostSession {
  readonly leftPx: number
  readonly topPx: number
  readonly widthPx: number
  readonly heightPx: number
  readonly startClientX: number
  readonly startClientY: number
  readonly sourceUrl?: string
  readonly rotationDegrees: number
  started: boolean
}

export interface DragDropPreview {
  readonly anchor: ReturnType<Editor['createTextAnchor']>
  readonly rect: ImageOverlayRect
  readonly visualLeftPx: number
  readonly visualTopPx: number
}

/** 从图片主体 pointer 事件创建拖拽鬼影会话。 */
export function createDragGhostSession(event: PointerEvent, snapshot: ImageSelectionSnapshot | null): DragGhostSession | null {
  if (snapshot === null) {
    return null
  }

  event.preventDefault()

  return {
    leftPx: snapshot.rect.leftPx,
    topPx: snapshot.rect.topPx,
    widthPx: snapshot.rect.widthPx,
    heightPx: snapshot.rect.heightPx,
    startClientX: event.clientX,
    startClientY: event.clientY,
    ...(snapshot.sourceUrl === undefined ? {} : { sourceUrl: snapshot.sourceUrl }),
    rotationDegrees: snapshot.target.rotationDegrees ?? 0,
    started: false
  }
}

/** 在拖拽期间更新鬼影位置。 */
export function updateGhostPreview(
  dom: ImageSelectionDom,
  canvasContainer: HTMLElement,
  session: DragGhostSession,
  event: PointerEvent | MouseEvent
): void {
  const deltaX = event.clientX - session.startClientX
  const deltaY = event.clientY - session.startClientY

  if (!session.started && Math.abs(deltaX) < DRAG_GHOST_THRESHOLD_PX && Math.abs(deltaY) < DRAG_GHOST_THRESHOLD_PX) {
    return
  }

  const pointer = resolveContainerPointer(canvasContainer, event.clientX, event.clientY)

  session.started = true
  dom.ghost.hidden = false
  dom.ghost.setAttribute('data-jword-image-drag-ghost', 'true')
  dom.ghost.style.left = `${pointer.x}px`
  dom.ghost.style.top = `${pointer.y}px`
  dom.ghost.style.width = `${session.widthPx}px`
  dom.ghost.style.height = `${session.heightPx}px`
  dom.ghost.style.transform = `rotate(${session.rotationDegrees}deg)`

  if (session.sourceUrl !== undefined) {
    dom.ghostImage.src = session.sourceUrl
  }
}

/** 关闭鬼影。 */
export function hideGhost(dom: ImageSelectionDom): void {
  dom.ghost.hidden = true
  dom.ghost.removeAttribute('data-jword-image-drag-ghost')
  dom.ghostImage.removeAttribute('src')
}

/** 解析拖拽中的实时落点锚点与 caret 几何。 */
export function resolveDragDropPreview(
  editor: Editor,
  canvasContainer: HTMLElement,
  event: PointerEvent | MouseEvent
): DragDropPreview | null {
  const pointer = resolveContainerPointer(canvasContainer, event.clientX, event.clientY)
  const anchor = resolvePointerAnchorFromClientPoint(
    editor,
    canvasContainer,
    event.clientX,
    event.clientY
  )

  if (anchor === null) {
    return null
  }

  const caretRect = editor.getCaretRect(anchor)
  const overlayRect = caretRect === undefined
    ? undefined
    : resolveLayoutRectOverlay(caretRect, editor.getLayout(), canvasContainer)

  if (overlayRect === undefined) {
    return null
  }

  return {
    anchor,
    rect: overlayRect,
    visualLeftPx: pointer.x,
    visualTopPx: pointer.y - (Math.max(overlayRect.heightPx, 18) / 2)
  }
}

/** 根据 client 坐标把当前拖拽落点映射回 editor 锚点。 */
export function resolvePointerAnchorFromClientPoint(
  editor: Editor,
  canvasContainer: HTMLElement,
  clientX: number,
  clientY: number
): ReturnType<Editor['createTextAnchor']> | null {
  const pageElements = Array.from(
    canvasContainer.querySelectorAll<HTMLElement>('[data-jword-page]')
  )
  const pageElement = pageElements.reduce<{
    distance: number
    element: HTMLElement
  } | null>((best, candidate) => {
    const rect = candidate.getBoundingClientRect()
    const deltaX = clientX < rect.left
      ? rect.left - clientX
      : clientX > rect.right
        ? clientX - rect.right
        : 0
    const deltaY = clientY < rect.top
      ? rect.top - clientY
      : clientY > rect.bottom
        ? clientY - rect.bottom
        : 0
    const distance = Math.hypot(deltaX, deltaY)

    if (best === null || distance < best.distance) {
      return {
        distance,
        element: candidate
      }
    }

    return best
  }, null)?.element

  if (pageElement === undefined) {
    return null
  }

  const pageIndex = Number.parseInt(pageElement.getAttribute('data-jword-page') ?? '-1', 10)
  const layout = editor.getLayout()
  const page = layout.pages[pageIndex]

  if (!Number.isInteger(pageIndex) || page === undefined) {
    return null
  }

  const rect = pageElement.getBoundingClientRect()
  const point = {
    pageIndex,
    x: (clientX - rect.left) / (rect.width / page.width),
    y: (clientY - rect.top) / (rect.height / page.height)
  }
  const directAnchor = editor.hitTest(point)

  if (directAnchor !== undefined) {
    return directAnchor
  }

  const fallbackPosition = resolveNearestDropPosition(page, point.x, point.y)

  return fallbackPosition === undefined
    ? null
    : editor.createTextAnchor(fallbackPosition)
}

/** 当 drop 点落在空白区时，吸附到当前页最近一行的可编辑边界。 */
function resolveNearestDropPosition(
  page: DocumentLayout['pages'][number],
  pageX: number,
  pageY: number
): TextPosition | undefined {
  const line = page.lines.reduce<{
    distance: number
    line: typeof page.lines[number]
  } | null>((best, candidate) => {
    const top = candidate.y
    const bottom = candidate.y + candidate.height
    const distance = pageY < top
      ? top - pageY
      : pageY > bottom
        ? pageY - bottom
        : 0

    if (best === null || distance < best.distance) {
      return {
        distance,
        line: candidate
      }
    }

    return best
  }, null)?.line

  if (line === undefined) {
    return undefined
  }

  const positions = [
    ...line.fragments.flatMap((fragment) => [
      {
        x: fragment.x,
        position: fragment.start
      },
      {
        x: fragment.x + fragment.width,
        position: {
          ...fragment.end,
          assoc: -1
        } satisfies TextPosition
      }
    ]),
    ...line.inlines.flatMap((inline) => [
      {
        x: inline.x,
        position: inline.at
      },
      {
        x: inline.x + inline.width,
        position: {
          ...inline.at,
          assoc: -1
        } satisfies TextPosition
      }
    ])
  ].sort((left, right) => left.x - right.x)

  if (positions.length === 0) {
    return undefined
  }

  if (pageX <= positions[0]!.x) {
    return positions[0]!.position
  }

  const last = positions[positions.length - 1]!

  if (pageX >= last.x) {
    return last.position
  }

  return positions.reduce((best, candidate) =>
    Math.abs(candidate.x - pageX) < Math.abs(best.x - pageX)
      ? candidate
      : best
  ).position
}
