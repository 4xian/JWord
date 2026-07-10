/**
 * 职责：创建和同步图片选中 overlay DOM、工具栏按钮与事件绑定。
 * 边界：不读取 editor、不执行 media command、不计算 drop 锚点。
 * 协作模块：image-selection-controller 负责装配，image-resize-session 提供预览尺寸。
 * 性能/安全约束：DOM 只挂载到已存在 canvas container 内，不做顶层 DOM 访问。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import { twipsToCssPx } from '@4xian/jword-core'

import {
  readJWordUiText,
  resolveJWordUiI18n,
  type ResolvedJWordUiI18n
} from '../i18n'
import { createToolbarIcon } from '../toolbar/icons'
import type { DragDropPreview } from './image-drag-drop'
import type { ImageOverlayRect, ImageSelectionSnapshot } from './image-overlay-geometry'
import { resolveResizePreviewRect, type ResizeSession } from './image-resize-session'

export type ResizeHandleId =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'middle-left'
  | 'middle-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right'

export interface ImageSelectionDom {
  readonly layer: HTMLElement
  readonly selection: HTMLElement
  readonly toolbar: HTMLElement
  readonly ghost: HTMLElement
  readonly ghostImage: HTMLImageElement
  readonly dropCaret: HTMLElement
  readonly rotateButton: HTMLButtonElement
  readonly resetButton: HTMLButtonElement
  readonly deleteButton: HTMLButtonElement
  readonly downloadButton: HTMLButtonElement
  readonly cropButton: HTMLButtonElement
  readonly layoutButton: HTMLButtonElement
  readonly commentButton: HTMLButtonElement
  readonly handles: Readonly<Record<ResizeHandleId, HTMLButtonElement>>
}

export const RESIZE_HANDLE_IDS: readonly ResizeHandleId[] = Object.freeze([
  'top-left',
  'top-center',
  'top-right',
  'middle-left',
  'middle-right',
  'bottom-left',
  'bottom-center',
  'bottom-right'
])

/** 创建 overlay DOM。 */
export function createImageSelectionDom(
  canvasContainer: HTMLElement,
  i18n: ResolvedJWordUiI18n = resolveJWordUiI18n()
): ImageSelectionDom {
  const layer = canvasContainer.ownerDocument.createElement('div')
  const selection = canvasContainer.ownerDocument.createElement('div')
  const toolbar = canvasContainer.ownerDocument.createElement('div')
  const ghost = canvasContainer.ownerDocument.createElement('div')
  const ghostImage = canvasContainer.ownerDocument.createElement('img')
  const dropCaret = canvasContainer.ownerDocument.createElement('div')

  layer.className = 'jw-image-selection-layer'
  selection.className = 'jw-image-selection'
  toolbar.className = 'jw-image-selection__toolbar'
  ghost.className = 'jw-image-selection__ghost'
  dropCaret.className = 'jw-image-selection__drop-caret'
  selection.setAttribute('data-jword-image-selection', 'true')
  toolbar.setAttribute('data-jword-image-toolbar', 'true')
  selection.hidden = true
  ghost.hidden = true
  dropCaret.hidden = true

  const rotateButton = createImageSelectionToolButton('rotate', readMediaText(i18n, 'rotate', '旋转'), false)
  const resetButton = createImageSelectionToolButton('reset', readMediaText(i18n, 'reset', '重置'), false)
  const deleteButton = createImageSelectionToolButton('trash', readMediaText(i18n, 'delete', '删除'), false)
  const downloadButton = createImageSelectionToolButton('download', readMediaText(i18n, 'downloadUnavailable', '下载暂未开放'), true)
  const cropButton = createImageSelectionToolButton('crop', readMediaText(i18n, 'cropUnavailable', '裁剪暂未开放'), true)
  const layoutButton = createImageSelectionToolButton('layout', readMediaText(i18n, 'layoutUnavailable', '版式暂未开放'), true)
  const commentButton = createImageSelectionToolButton('comment', readMediaText(i18n, 'commentUnavailable', '评论暂未开放'), true)

  rotateButton.setAttribute('data-jword-image-toolbar-action', 'rotate')
  resetButton.setAttribute('data-jword-image-toolbar-action', 'reset')
  deleteButton.setAttribute('data-jword-image-toolbar-action', 'delete')
  downloadButton.setAttribute('data-jword-image-toolbar-action', 'download')
  cropButton.setAttribute('data-jword-image-toolbar-action', 'crop')
  layoutButton.setAttribute('data-jword-image-toolbar-action', 'layout')
  commentButton.setAttribute('data-jword-image-toolbar-action', 'comment')

  toolbar.append(
    rotateButton,
    resetButton,
    deleteButton,
    downloadButton,
    cropButton,
    layoutButton,
    commentButton
  )

  const handles = Object.fromEntries(RESIZE_HANDLE_IDS.map((handleId) => {
    const handle = canvasContainer.ownerDocument.createElement('button')

    handle.type = 'button'
    handle.className = `jw-image-selection__handle jw-image-selection__handle--${handleId}`
    handle.setAttribute('data-jword-image-resize-handle', handleId)
    handle.setAttribute('aria-label', readResizeHandleLabel(i18n, handleId))

    return [handleId, handle]
  })) as Record<ResizeHandleId, HTMLButtonElement>

  selection.append(toolbar)
  for (const handleId of RESIZE_HANDLE_IDS) {
    selection.append(handles[handleId])
  }

  ghostImage.className = 'jw-image-selection__ghost-image'
  ghost.append(ghostImage)
  layer.append(selection, ghost, dropCaret)
  canvasContainer.append(layer)

  return {
    layer,
    selection,
    toolbar,
    ghost,
    ghostImage,
    dropCaret,
    rotateButton,
    resetButton,
    deleteButton,
    downloadButton,
    cropButton,
    layoutButton,
    commentButton,
    handles
  }
}

/** 动态刷新图片 overlay 工具文案。 */
export function localizeImageSelectionDom(dom: ImageSelectionDom, i18n: ResolvedJWordUiI18n): void {
  setButtonLabel(dom.rotateButton, readMediaText(i18n, 'rotate', '旋转'))
  setButtonLabel(dom.resetButton, readMediaText(i18n, 'reset', '重置'))
  setButtonLabel(dom.deleteButton, readMediaText(i18n, 'delete', '删除'))
  setButtonLabel(dom.downloadButton, readMediaText(i18n, 'downloadUnavailable', '下载暂未开放'))
  setButtonLabel(dom.cropButton, readMediaText(i18n, 'cropUnavailable', '裁剪暂未开放'))
  setButtonLabel(dom.layoutButton, readMediaText(i18n, 'layoutUnavailable', '版式暂未开放'))
  setButtonLabel(dom.commentButton, readMediaText(i18n, 'commentUnavailable', '评论暂未开放'))

  for (const handleId of RESIZE_HANDLE_IDS) {
    dom.handles[handleId].setAttribute('aria-label', readResizeHandleLabel(i18n, handleId))
  }
}

/** 绑定图片 overlay controller 需要的事件。 */
export function bindImageSelectionEvents(input: Readonly<{
  dom: ImageSelectionDom
  canvasContainer: HTMLElement
  signal: AbortSignal
  onRotate: () => void
  onReset: () => void
  onDelete: () => void
  onResizeStart: (handleId: ResizeHandleId, event: PointerEvent) => void
  onDragStart: (event: PointerEvent) => void
  onPointerMove: (event: PointerEvent | MouseEvent) => void
  onPointerUp: (event: PointerEvent | MouseEvent) => void
  onRefresh: () => void
}>): void {
  input.dom.rotateButton.addEventListener('click', input.onRotate, { signal: input.signal })
  input.dom.resetButton.addEventListener('click', input.onReset, { signal: input.signal })
  input.dom.deleteButton.addEventListener('click', input.onDelete, { signal: input.signal })

  for (const handleId of RESIZE_HANDLE_IDS) {
    input.dom.handles[handleId].addEventListener('pointerdown', (event) => {
      input.onResizeStart(handleId, event)
    }, { signal: input.signal })
  }

  input.dom.selection.addEventListener('pointerdown', (event) => {
    if (!(event.target instanceof HTMLElement)) {
      return
    }

    if (event.target.closest('[data-jword-image-resize-handle]') !== null) {
      return
    }

    if (event.target.closest('[data-jword-image-toolbar="true"]') !== null) {
      return
    }

    input.onDragStart(event)
  }, { signal: input.signal })

  input.canvasContainer.ownerDocument.addEventListener('pointermove', input.onPointerMove, { signal: input.signal })
  input.canvasContainer.ownerDocument.addEventListener('mousemove', input.onPointerMove, { signal: input.signal })
  input.canvasContainer.ownerDocument.addEventListener('pointerup', input.onPointerUp, { signal: input.signal })
  input.canvasContainer.ownerDocument.addEventListener('mouseup', input.onPointerUp, { signal: input.signal })
  input.canvasContainer.addEventListener('scroll', input.onRefresh, { signal: input.signal })
  input.canvasContainer.ownerDocument.defaultView?.addEventListener('resize', input.onRefresh, { signal: input.signal })
}

/** 同步 overlay 的显隐、位置和按钮状态。 */
export function syncImageSelectionOverlay(input: Readonly<{
  dom: ImageSelectionDom
  snapshot: ImageSelectionSnapshot
  resizeSession: ResizeSession | null
  dragging: boolean
}>): void {
  const previewWidthTwips = input.resizeSession?.target.resourceId === input.snapshot.target.resourceId
    ? input.resizeSession.previewWidthTwips
    : input.snapshot.target.widthTwips ?? input.snapshot.naturalWidthTwips
  const previewHeightTwips = input.resizeSession?.target.resourceId === input.snapshot.target.resourceId
    ? input.resizeSession.previewHeightTwips
    : input.snapshot.target.heightTwips ?? input.snapshot.naturalHeightTwips
  const previewRect = input.resizeSession?.target.resourceId === input.snapshot.target.resourceId
    ? resolveResizePreviewRect(input.snapshot.rect, input.resizeSession)
    : input.snapshot.rect
  const widthPx = previewWidthTwips === undefined
    ? input.snapshot.rect.widthPx
    : twipsToCssPx(previewWidthTwips, input.snapshot.rect.scale)
  const heightPx = previewHeightTwips === undefined
    ? input.snapshot.rect.heightPx
    : twipsToCssPx(previewHeightTwips, input.snapshot.rect.scale)

  applySelectionRect(input.dom.selection, previewRect, widthPx, heightPx)
  input.dom.selection.hidden = false
  input.dom.selection.setAttribute('data-jword-image-rotation', String(input.snapshot.target.rotationDegrees ?? 0))
  input.dom.selection.setAttribute('data-jword-image-dragging', String(input.dragging))
}

/** 关闭 overlay 与拖拽鬼影。 */
export function hideSelection(selectionDom: ImageSelectionDom): void {
  selectionDom.selection.hidden = true
  selectionDom.selection.removeAttribute('data-jword-image-rotation')
  selectionDom.selection.removeAttribute('data-jword-image-dragging')
  selectionDom.ghost.hidden = true
  selectionDom.ghost.removeAttribute('data-jword-image-drag-ghost')
  selectionDom.ghostImage.removeAttribute('src')
  selectionDom.dropCaret.hidden = true
  selectionDom.dropCaret.removeAttribute('data-jword-image-drop-caret')
}

/** 调整 overlay layer 尺寸，使其覆盖当前滚动内容区域。 */
export function resizeLayer(layer: HTMLElement, canvasContainer: HTMLElement): void {
  layer.style.width = `${canvasContainer.clientWidth}px`
  layer.style.height = `${canvasContainer.clientHeight}px`
}

/** 同步拖拽落点 caret 的显隐与几何。 */
export function syncDropCaret(dom: ImageSelectionDom, preview: DragDropPreview | null): void {
  if (preview === null) {
    dom.dropCaret.hidden = true
    dom.dropCaret.removeAttribute('data-jword-image-drop-caret')
    return
  }

  dom.dropCaret.hidden = false
  dom.dropCaret.setAttribute('data-jword-image-drop-caret', 'true')
  dom.dropCaret.style.left = `${preview.visualLeftPx}px`
  dom.dropCaret.style.top = `${preview.visualTopPx}px`
  dom.dropCaret.style.height = `${Math.max(preview.rect.heightPx, 18)}px`
}

/** 创建一个图标工具按钮。 */
function createImageSelectionToolButton(
  icon: Parameters<typeof createToolbarIcon>[0],
  label: string,
  disabled: boolean
): HTMLButtonElement {
  const button = document.createElement('button')

  button.type = 'button'
  button.className = 'jw-image-selection__tool'
  button.title = label
  button.disabled = disabled
  button.setAttribute('aria-label', label)
  button.append(createToolbarIcon(icon))

  return button
}

/** 写入 selection overlay 几何样式。 */
function applySelectionRect(selection: HTMLElement, rect: ImageOverlayRect, widthPx: number, heightPx: number): void {
  selection.style.left = `${rect.leftPx}px`
  selection.style.top = `${rect.topPx}px`
  selection.style.width = `${widthPx}px`
  selection.style.height = `${heightPx}px`
}

/** 读取缩放手柄可见名称。 */
function readResizeHandleLabel(i18n: ResolvedJWordUiI18n, handleId: ResizeHandleId): string {
  switch (handleId) {
    case 'top-left':
      return readMediaText(i18n, 'resizeTopLeft', '左上缩放')
    case 'top-center':
      return readMediaText(i18n, 'resizeTop', '顶部缩放')
    case 'top-right':
      return readMediaText(i18n, 'resizeTopRight', '右上缩放')
    case 'middle-left':
      return readMediaText(i18n, 'resizeLeft', '左侧缩放')
    case 'middle-right':
      return readMediaText(i18n, 'resizeRight', '右侧缩放')
    case 'bottom-left':
      return readMediaText(i18n, 'resizeBottomLeft', '左下缩放')
    case 'bottom-center':
      return readMediaText(i18n, 'resizeBottom', '底部缩放')
    case 'bottom-right':
      return readMediaText(i18n, 'resizeBottomRight', '右下缩放')
  }
}

/** 更新图片 overlay 图标按钮标签。 */
function setButtonLabel(button: HTMLButtonElement, label: string): void {
  button.title = label
  button.setAttribute('aria-label', label)
}

/** 读取图片 overlay 文案。 */
function readMediaText(i18n: ResolvedJWordUiI18n, key: string, fallback: string): string {
  return readJWordUiText(i18n, `menu.media.${key}`, fallback)
}
