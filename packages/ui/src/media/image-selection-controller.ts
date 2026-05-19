/**
 * 职责：为当前选中的图片提供覆盖层、顶部工具栏、八点缩放和拖拽鬼影的最小控制器。
 * 边界：只消费 editor facade、layout 和 media command adapter，不改写 selection/right-click 模块，不旁路 core transaction pipeline。
 * 协作模块：create-ui 负责装配生命周期，core-command-adapter 负责尺寸/旋转/删除命令桥接，toolbar icons 负责按钮图标。
 * 性能/安全约束：覆盖层只在已选中图片时存在，DOM 直接挂在 canvas container 内，缩放和拖拽统一通过 transaction pipeline 提交。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#iteration-1---图片纵线step-41-43。
 */
import {
  createSelectionState,
  cssPxToTwips,
  twipsToCssPx,
  type DocumentLayout,
  type Editor,
  type InlineBox,
  type LayoutBox,
  type LayoutRect,
  type TextPosition
} from '@4xian/jword-core'
import type { DocumentProjection } from '@4xian/jword-core'
import { createToolbarIcon } from '../toolbar/icons'
import type { JWordMediaCommandAdapter, JWordSelectedImageTarget } from '../types'

type ResizeHandleId =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'middle-left'
  | 'middle-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right'

interface CreateImageSelectionControllerOptions {
  readonly editor: Editor
  readonly editorHost: HTMLElement
  readonly commands: JWordMediaCommandAdapter | undefined
}

interface ImageSelectionControllerHandle {
  refresh(): void
  destroy(): void
}

interface ImageOverlayRect {
  readonly leftPx: number
  readonly topPx: number
  readonly widthPx: number
  readonly heightPx: number
  readonly scale: number
}

interface ImageSelectionSnapshot {
  readonly target: JWordSelectedImageTarget
  readonly rect: ImageOverlayRect
  readonly sourceUrl?: string
  readonly naturalWidthTwips?: number
  readonly naturalHeightTwips?: number
}

interface ResizeSession {
  readonly target: JWordSelectedImageTarget
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

interface DragGhostSession {
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

interface DragDropPreview {
  readonly anchor: ReturnType<Editor['createTextAnchor']>
  readonly rect: ImageOverlayRect
  readonly visualLeftPx: number
  readonly visualTopPx: number
}

interface ImageSelectionDom {
  readonly layer: HTMLElement
  readonly selection: HTMLElement
  readonly toolbar: HTMLElement
  readonly ghost: HTMLElement
  readonly ghostImage: HTMLImageElement
  readonly dropCaret: HTMLElement
  readonly rotateButton: HTMLButtonElement
  readonly resetButton: HTMLButtonElement
  readonly deleteButton: HTMLButtonElement
  readonly handles: Readonly<Record<ResizeHandleId, HTMLButtonElement>>
}

const RESIZE_HANDLE_IDS: readonly ResizeHandleId[] = Object.freeze([
  'top-left',
  'top-center',
  'top-right',
  'middle-left',
  'middle-right',
  'bottom-left',
  'bottom-center',
  'bottom-right'
])

const MIN_IMAGE_SIZE_TWIPS = cssPxToTwips(24)
const DRAG_GHOST_THRESHOLD_PX = 3
/** 创建图片选中 overlay controller。 */
export function createImageSelectionController(
  options: CreateImageSelectionControllerOptions
): ImageSelectionControllerHandle | null {
  if (
    options.commands === undefined
    || options.commands.resolveSelectedImageTarget === undefined
  ) {
    return null
  }

  const mountedCanvasContainer = resolveCanvasContainer(options.editorHost)

  if (mountedCanvasContainer === null) {
    return null
  }
  const canvasContainer = mountedCanvasContainer

  const dom = createImageSelectionDom(canvasContainer)
  const signalController = new AbortController()
  let currentSnapshot: ImageSelectionSnapshot | null = null
  let resizeSession: ResizeSession | null = null
  let dragGhostSession: DragGhostSession | null = null
  let dragDropPreview: DragDropPreview | null = null

  /** 读取当前最新图片快照。 */
  function readCurrentSnapshot(): ImageSelectionSnapshot | null {
    const projection = options.editor.getProjection()
    const selection = options.editor.getSelection()
    const target = options.commands?.resolveSelectedImageTarget?.(projection, selection) ?? null

    if (target === null) {
      return null
    }

    const rect = resolveSelectedImageRect(options.editor.getLayout(), canvasContainer, target.resourceId)

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

  /** 刷新 overlay 的显隐、位置和按钮状态。 */
  function refresh(): void {
    resizeLayer(dom.layer, canvasContainer)

    const snapshot = readCurrentSnapshot()

    currentSnapshot = snapshot

    if (snapshot === null) {
      resizeSession = null
      dragDropPreview = null
      hideSelection(dom)
      return
    }

    const previewWidthTwips = resizeSession?.target.resourceId === snapshot.target.resourceId
      ? resizeSession.previewWidthTwips
      : snapshot.target.widthTwips ?? snapshot.naturalWidthTwips
    const previewHeightTwips = resizeSession?.target.resourceId === snapshot.target.resourceId
      ? resizeSession.previewHeightTwips
      : snapshot.target.heightTwips ?? snapshot.naturalHeightTwips
    const previewRect = resizeSession?.target.resourceId === snapshot.target.resourceId
      ? resolveResizePreviewRect(snapshot.rect, resizeSession)
      : snapshot.rect
    const widthPx = previewWidthTwips === undefined
      ? snapshot.rect.widthPx
      : twipsToCssPx(previewWidthTwips, snapshot.rect.scale)
    const heightPx = previewHeightTwips === undefined
      ? snapshot.rect.heightPx
      : twipsToCssPx(previewHeightTwips, snapshot.rect.scale)

    dom.selection.hidden = false
    dom.selection.style.left = `${previewRect.leftPx}px`
    dom.selection.style.top = `${previewRect.topPx}px`
    dom.selection.style.width = `${widthPx}px`
    dom.selection.style.height = `${heightPx}px`
    dom.selection.setAttribute('data-jword-image-rotation', String(snapshot.target.rotationDegrees ?? 0))
    dom.selection.setAttribute('data-jword-image-dragging', String(dragGhostSession !== null))
  }

  /** 关闭 overlay 与拖拽鬼影。 */
  function hideSelection(selectionDom: ImageSelectionDom): void {
    selectionDom.selection.hidden = true
    selectionDom.selection.removeAttribute('data-jword-image-rotation')
    selectionDom.selection.removeAttribute('data-jword-image-dragging')
    selectionDom.ghost.hidden = true
    selectionDom.ghost.removeAttribute('data-jword-image-drag-ghost')
    selectionDom.ghostImage.removeAttribute('src')
    selectionDom.dropCaret.hidden = true
    selectionDom.dropCaret.removeAttribute('data-jword-image-drop-caret')
  }

  /** 读取当前执行命令所需的上下文。 */
  function readCommandContext(target: JWordSelectedImageTarget): Readonly<{
    projection: DocumentProjection
    selection: ReturnType<Editor['getSelection']>
    target: JWordSelectedImageTarget
  }> | null {
    const projection = options.editor.getProjection()
    const selection = options.editor.getSelection()
    const latestTarget = options.commands?.resolveSelectedImageTarget?.(projection, selection) ?? null

    if (latestTarget === null || latestTarget.resourceId !== target.resourceId) {
      return null
    }

    return {
      projection,
      selection,
      target: latestTarget
    }
  }

  /** 执行顺时针 90 度旋转。 */
  async function handleRotate(): Promise<void> {
    const snapshot = currentSnapshot

    if (snapshot === null || options.commands?.setSelectedImageRotation === undefined) {
      return
    }

    const context = readCommandContext(snapshot.target)

    if (context === null) {
      return
    }

    const nextRotationDegrees = ((context.target.rotationDegrees ?? 0) + 90) % 360

    await options.commands.setSelectedImageRotation({
      editor: options.editor,
      projection: context.projection,
      selection: context.selection,
      target: context.target,
      rotationDegrees: nextRotationDegrees
    })
    options.editor.focus()
    refresh()
  }

  /** 把图片恢复到原始尺寸和 0 度。 */
  async function handleReset(): Promise<void> {
    const snapshot = currentSnapshot

    if (snapshot === null) {
      return
    }

    const context = readCommandContext(snapshot.target)

    if (context === null) {
      return
    }

    if (
      snapshot.naturalWidthTwips !== undefined
      && snapshot.naturalHeightTwips !== undefined
      && options.commands?.resizeSelectedImage !== undefined
      && (
        context.target.widthTwips !== snapshot.naturalWidthTwips
        || context.target.heightTwips !== snapshot.naturalHeightTwips
      )
    ) {
      await options.commands.resizeSelectedImage({
        editor: options.editor,
        projection: context.projection,
        selection: context.selection,
        target: context.target,
        widthTwips: snapshot.naturalWidthTwips,
        heightTwips: snapshot.naturalHeightTwips
      })
    }

    if (
      options.commands?.setSelectedImageRotation !== undefined
      && (context.target.rotationDegrees ?? 0) !== 0
    ) {
      const nextContext = readCommandContext(snapshot.target)

      if (nextContext !== null) {
        await options.commands.setSelectedImageRotation({
          editor: options.editor,
          projection: nextContext.projection,
          selection: nextContext.selection,
          target: nextContext.target,
          rotationDegrees: 0
        })
      }
    }

    resizeSession = null
    options.editor.focus()
    refresh()
  }

  /** 删除当前图片。 */
  async function handleDelete(): Promise<void> {
    const snapshot = currentSnapshot

    if (snapshot === null || options.commands?.deleteSelectedImage === undefined) {
      return
    }

    const context = readCommandContext(snapshot.target)

    if (context === null) {
      return
    }

    await options.commands.deleteSelectedImage({
      editor: options.editor,
      projection: context.projection,
      selection: context.selection,
      target: context.target
    })
    resizeSession = null
    options.editor.focus()
    refresh()
  }

  /** 从 handle pointer 事件进入缩放预览会话。 */
  function startResize(handleId: ResizeHandleId, event: PointerEvent): void {
    const snapshot = currentSnapshot
    const widthTwips = snapshot?.target.widthTwips ?? snapshot?.naturalWidthTwips
    const heightTwips = snapshot?.target.heightTwips ?? snapshot?.naturalHeightTwips

    if (snapshot === null || widthTwips === undefined || heightTwips === undefined) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    resizeSession = {
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
    refresh()
  }

  /** 从图片主体 pointer 事件进入拖拽鬼影会话。 */
  function startGhostDrag(event: PointerEvent): void {
    const snapshot = currentSnapshot

    if (snapshot === null) {
      return
    }

    event.preventDefault()
    dragGhostSession = {
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
    dragDropPreview = null
    refresh()
  }

  /** 推进缩放预览或拖拽鬼影。 */
  function handlePointerMove(event: PointerEvent | MouseEvent): void {
    if (resizeSession !== null) {
      event.preventDefault()
      updateResizePreview(resizeSession, canvasContainer, event)
      refresh()
      return
    }

    if (dragGhostSession !== null) {
      event.preventDefault()
      updateGhostPreview(dom, canvasContainer, dragGhostSession, event)
      dragDropPreview = resolveDragDropPreview(
        options.editor,
        canvasContainer,
        dragGhostSession,
        event
      )
      syncDropCaret(dom, dragDropPreview)
      refresh()
    }
  }

  /** 在 pointerup 时提交缩放或清理拖拽鬼影。 */
  async function handlePointerUp(event: PointerEvent | MouseEvent): Promise<void> {
    if (resizeSession !== null) {
      event.preventDefault()
      const session = resizeSession

      resizeSession = null

      if (options.commands?.resizeSelectedImage !== undefined) {
        const context = readCommandContext(session.target)

        if (context !== null && (
          session.previewWidthTwips !== session.startWidthTwips
          || session.previewHeightTwips !== session.startHeightTwips
        )) {
          await options.commands.resizeSelectedImage({
            editor: options.editor,
            projection: context.projection,
            selection: context.selection,
            target: context.target,
            widthTwips: session.previewWidthTwips,
            heightTwips: session.previewHeightTwips
          })
        }
      }

      options.editor.focus()
      refresh()
      return
    }

    if (dragGhostSession !== null) {
      event.preventDefault()
      const session = dragGhostSession
      dragGhostSession = null

      if (session.started) {
        const snapshot = currentSnapshot

        if (snapshot !== null && options.commands?.moveSelectedImage !== undefined) {
          const context = readCommandContext(snapshot.target)
          const dropAnchor = dragDropPreview?.anchor ?? resolvePointerAnchorFromClientPoint(
            options.editor,
            canvasContainer,
            event.clientX,
            event.clientY
          )

          if (context !== null && dropAnchor !== null) {
            await options.commands.moveSelectedImage({
              editor: options.editor,
              projection: context.projection,
              selection: context.selection,
              target: context.target,
              dropSelection: createSelectionState(dropAnchor, dropAnchor)
            })
          }
        }
      }

      dragDropPreview = null
      hideGhost(dom)
      syncDropCaret(dom, null)
      options.editor.focus()
      refresh()
    }
  }

  /** 绑定 controller 需要的事件。 */
  function bindEvents(): void {
    dom.rotateButton.addEventListener('click', () => {
      void handleRotate()
    }, { signal: signalController.signal })
    dom.resetButton.addEventListener('click', () => {
      void handleReset()
    }, { signal: signalController.signal })
    dom.deleteButton.addEventListener('click', () => {
      void handleDelete()
    }, { signal: signalController.signal })

    for (const handleId of RESIZE_HANDLE_IDS) {
      dom.handles[handleId].addEventListener('pointerdown', (event) => {
        startResize(handleId, event)
      }, { signal: signalController.signal })
    }

    dom.selection.addEventListener('pointerdown', (event) => {
      if (!(event.target instanceof HTMLElement)) {
        return
      }

      if (event.target.closest('[data-jword-image-resize-handle]') !== null) {
        return
      }

      if (event.target.closest('[data-jword-image-toolbar="true"]') !== null) {
        return
      }

      startGhostDrag(event)
    }, { signal: signalController.signal })

    canvasContainer.ownerDocument.addEventListener('pointermove', (event) => {
      void handlePointerMove(event)
    }, { signal: signalController.signal })
    canvasContainer.ownerDocument.addEventListener('mousemove', (event) => {
      void handlePointerMove(event)
    }, { signal: signalController.signal })
    canvasContainer.ownerDocument.addEventListener('pointerup', (event) => {
      void handlePointerUp(event)
    }, { signal: signalController.signal })
    canvasContainer.ownerDocument.addEventListener('mouseup', (event) => {
      void handlePointerUp(event)
    }, { signal: signalController.signal })
    canvasContainer.addEventListener('scroll', () => {
      refresh()
    }, { signal: signalController.signal })
    canvasContainer.ownerDocument.defaultView?.addEventListener('resize', () => {
      refresh()
    }, { signal: signalController.signal })
  }

  const unsubscribeEditor = options.editor.subscribe((event) => {
    if (event.kind === 'destroyed') {
      currentSnapshot = null
      resizeSession = null
      dragGhostSession = null
      dragDropPreview = null
      destroy()
      return
    }

    refresh()
  })

  /** 销毁 controller 和 DOM。 */
  function destroy(): void {
    signalController.abort()
    unsubscribeEditor()
    dom.layer.remove()
  }

  bindEvents()
  refresh()

  return {
    refresh,
    destroy
  }
}

/** 创建 overlay DOM。 */
function createImageSelectionDom(canvasContainer: HTMLElement): ImageSelectionDom {
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

  const rotateButton = createImageSelectionToolButton('rotate', '旋转', false)
  const resetButton = createImageSelectionToolButton('reset', '重置', false)
  const deleteButton = createImageSelectionToolButton('trash', '删除', false)
  const downloadButton = createImageSelectionToolButton('download', '下载暂未开放', true)
  const cropButton = createImageSelectionToolButton('crop', '裁剪暂未开放', true)
  const layoutButton = createImageSelectionToolButton('layout', '版式暂未开放', true)
  const commentButton = createImageSelectionToolButton('comment', '评论暂未开放', true)

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
    handle.setAttribute('aria-label', readResizeHandleLabel(handleId))

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
    handles
  }
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

/** 在拖拽期间更新鬼影位置。 */
function updateGhostPreview(
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
function hideGhost(dom: ImageSelectionDom): void {
  dom.ghost.hidden = true
  dom.ghost.removeAttribute('data-jword-image-drag-ghost')
  dom.ghostImage.removeAttribute('src')
}

/** 同步拖拽落点 caret 的显隐与几何。 */
function syncDropCaret(dom: ImageSelectionDom, preview: DragDropPreview | null): void {
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

/** 根据 pointer 位移更新缩放预览。 */
function updateResizePreview(
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
function resolveResizePreviewRect(baseRect: ImageOverlayRect, session: ResizeSession): ImageOverlayRect {
  return session.previewRect ?? baseRect
}

/** 调整 overlay layer 尺寸，使其覆盖当前滚动内容区域。 */
function resizeLayer(layer: HTMLElement, canvasContainer: HTMLElement): void {
  layer.style.width = `${canvasContainer.clientWidth}px`
  layer.style.height = `${canvasContainer.clientHeight}px`
}

/** 从当前 layout 和挂载 DOM 解析已选图片的绝对矩形。 */
function resolveSelectedImageRect(
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

/** 解析 editor host 里已挂载的 canvas container。 */
function resolveCanvasContainer(editorHost: HTMLElement): HTMLElement | null {
  return editorHost.querySelector<HTMLElement>('[data-jword-canvas-container]')
}

/** 根据 client 坐标把当前拖拽落点映射回 editor 锚点。 */
function resolvePointerAnchorFromClientPoint(
  editor: Editor,
  canvasContainer: HTMLElement,
  clientX: number,
  clientY: number
) {
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

/** 解析拖拽中的实时落点锚点与 caret 几何。 */
function resolveDragDropPreview(
  editor: Editor,
  canvasContainer: HTMLElement,
  session: DragGhostSession,
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

/** 把 viewport client 坐标转换成 canvas container 内的绝对像素坐标。 */
function resolveContainerPointer(
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

/** 把 layout rect 转成挂载 overlay 所在容器的像素矩形。 */
function resolveLayoutRectOverlay(
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

/** 读取缩放手柄可见名称。 */
function readResizeHandleLabel(handleId: ResizeHandleId): string {
  switch (handleId) {
    case 'top-left':
      return '左上缩放'
    case 'top-center':
      return '顶部缩放'
    case 'top-right':
      return '右上缩放'
    case 'middle-left':
      return '左侧缩放'
    case 'middle-right':
      return '右侧缩放'
    case 'bottom-left':
      return '左下缩放'
    case 'bottom-center':
      return '底部缩放'
    case 'bottom-right':
      return '右下缩放'
  }
}
