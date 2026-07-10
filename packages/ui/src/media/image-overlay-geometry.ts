/**
 * 职责：把 layout 图片盒、caret rect 和 DOM 页面元素转换为图片 overlay 坐标。
 * 边界：不创建 DOM、不绑定事件、不执行 media command。
 * 协作模块：image-selection-controller 读取选中图片快照，image-drag-drop 读取 drop caret 几何。
 * 性能/安全约束：只读取已挂载 canvas container 和 editor 只读 layout/projection。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import {
  twipsToCssPx,
  type DocumentLayout,
  type Editor,
  type InlineBox,
  type LayoutBox,
  type LayoutRect
} from '@4xian/jword-core'
import type { DocumentProjection } from '@4xian/jword-core'
import type { JWordMediaCommandAdapter, JWordSelectedImageTarget } from '../types'

export interface ImageOverlayRect {
  readonly leftPx: number
  readonly topPx: number
  readonly widthPx: number
  readonly heightPx: number
  readonly scale: number
}

export interface ImageSelectionSnapshot {
  readonly target: JWordSelectedImageTarget
  readonly rect: ImageOverlayRect
  readonly sourceUrl?: string
  readonly naturalWidthTwips?: number
  readonly naturalHeightTwips?: number
}

/** 读取当前最新图片快照。 */
export function resolveImageSelectionSnapshot(
  editor: Editor,
  canvasContainer: HTMLElement,
  commands: JWordMediaCommandAdapter
): ImageSelectionSnapshot | null {
  const projection = editor.getProjection()
  const selection = editor.getSelection()
  const target = commands.resolveSelectedImageTarget?.(projection, selection) ?? null

  if (target === null) {
    return null
  }

  const rect = resolveSelectedImageRect(editor.getLayout(), canvasContainer, target.resourceId)

  if (rect === null) {
    return null
  }

  const resource = resolveProjectionResource(projection, target.resourceId)
  const naturalWidthTwips = readPositiveNumber(resource?.metadata?.widthTwips)
  const naturalHeightTwips = readPositiveNumber(resource?.metadata?.heightTwips)

  return {
    target,
    rect,
    ...(resource?.source.url === undefined ? {} : { sourceUrl: resource.source.url }),
    ...(naturalWidthTwips === undefined ? {} : { naturalWidthTwips }),
    ...(naturalHeightTwips === undefined ? {} : { naturalHeightTwips })
  }
}

/** 读取当前执行命令所需的上下文。 */
export function readImageCommandContext(
  editor: Editor,
  commands: JWordMediaCommandAdapter,
  target: JWordSelectedImageTarget
): Readonly<{
  projection: DocumentProjection
  selection: ReturnType<Editor['getSelection']>
  target: JWordSelectedImageTarget
}> | null {
  const projection = editor.getProjection()
  const selection = editor.getSelection()
  const latestTarget = commands.resolveSelectedImageTarget?.(projection, selection) ?? null

  if (latestTarget === null || latestTarget.resourceId !== target.resourceId) {
    return null
  }

  return {
    projection,
    selection,
    target: latestTarget
  }
}

/** 从当前 layout 和挂载 DOM 解析已选图片的绝对矩形。 */
export function resolveSelectedImageRect(
  layout: DocumentLayout,
  canvasContainer: HTMLElement,
  resourceId: string
): ImageOverlayRect | null {
  for (const page of layout.pages) {
    const imageInline = page.lines
      .flatMap((line) => line.inlines)
      .find((inline) => isImageInlineBox(inline, resourceId))

    if (imageInline === undefined) {
      continue
    }

    const pageElement = canvasContainer.querySelector<HTMLElement>(`[data-jword-page="${page.pageIndex}"]`)

    if (pageElement === null) {
      return null
    }

    const scale = resolvePageScale(pageElement, page)

    return {
      leftPx: pageElement.offsetLeft + twipsToCssPx(imageInline.x - page.x, scale),
      topPx: pageElement.offsetTop + twipsToCssPx(imageInline.y - page.y, scale),
      widthPx: twipsToCssPx(imageInline.width, scale),
      heightPx: twipsToCssPx(imageInline.height, scale),
      scale
    }
  }

  return null
}

/** 把 layout rect 转成挂载 overlay 所在容器的像素矩形。 */
export function resolveLayoutRectOverlay(
  rect: LayoutRect,
  layout: DocumentLayout,
  canvasContainer: HTMLElement
): ImageOverlayRect | undefined {
  const page = layout.pages[rect.pageIndex]
  const pageElement = canvasContainer.querySelector<HTMLElement>(`[data-jword-page="${rect.pageIndex}"]`)

  if (page === undefined || pageElement === null) {
    return undefined
  }

  const scale = resolvePageScale(pageElement, page)

  return {
    leftPx: pageElement.offsetLeft + twipsToCssPx(rect.x - page.x, scale),
    topPx: pageElement.offsetTop + twipsToCssPx(rect.y - page.y, scale),
    widthPx: twipsToCssPx(rect.width, scale),
    heightPx: twipsToCssPx(rect.height, scale),
    scale
  }
}

/** 把 viewport client 坐标转换成 canvas container 内的绝对像素坐标。 */
export function resolveContainerPointer(
  canvasContainer: HTMLElement,
  clientX: number,
  clientY: number
): Readonly<{
  x: number
  y: number
}> {
  const rect = canvasContainer.getBoundingClientRect()

  return {
    x: clientX - rect.left + canvasContainer.scrollLeft,
    y: clientY - rect.top + canvasContainer.scrollTop
  }
}

/** 解析 editor host 里已挂载的 canvas container。 */
export function resolveCanvasContainer(editorHost: HTMLElement): HTMLElement | null {
  return editorHost.querySelector<HTMLElement>('[data-jword-canvas-container]')
}

/** 判断 inline 是否是目标图片。 */
function isImageInlineBox(
  inline: InlineBox,
  resourceId: string
): inline is Extract<InlineBox, { kind: 'inlineObject' }> {
  return inline.kind === 'inlineObject'
    && inline.inlineKind === 'image'
    && isImageInlinePayload(inline.payload)
    && inline.payload.resourceId === resourceId
}

/** 判断 payload 是否为图片载荷。 */
function isImageInlinePayload(
  payload: Extract<InlineBox, { kind: 'inlineObject' }>['payload']
): payload is Extract<Extract<InlineBox, { kind: 'inlineObject' }>['payload'], { resourceId: string }> {
  return typeof Reflect.get(payload, 'resourceId') === 'string'
}

/** 从页面 DOM 宽度反推当前渲染 scale。 */
function resolvePageScale(pageElement: HTMLElement, page: LayoutBox): number {
  const baseWidthPx = twipsToCssPx(page.width)

  if (baseWidthPx <= 0) {
    return 1
  }

  return pageElement.clientWidth / baseWidthPx
}

/** 查找当前 projection 中的资源快照。 */
function resolveProjectionResource(projection: DocumentProjection, resourceId: string) {
  return projection.document.resources?.find((resource) => resource.id === resourceId)
}

/** 读取正数元数据。 */
function readPositiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : undefined
}
