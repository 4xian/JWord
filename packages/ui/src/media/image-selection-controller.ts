/**
 * 职责：为当前选中的图片提供覆盖层、顶部工具栏、八点缩放和拖拽鬼影的最小控制器。
 * 边界：只消费 editor facade、layout 和 media command adapter，不改写 selection/right-click 模块，不旁路 core transaction pipeline。
 * 协作模块：create-ui 负责装配生命周期，core-command-adapter 负责尺寸/旋转/删除命令桥接，image-selection-* 模块负责 DOM、几何和会话细节。
 * 性能/安全约束：覆盖层只在已选中图片时存在，DOM 直接挂在 canvas container 内，缩放和拖拽统一通过 transaction pipeline 提交。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import { createSelectionState, type Editor } from '@4xian/jword-core'
import type { JWordMediaCommandAdapter, JWordReadonlyMode, JWordSelectedImageTarget } from '../types'
import { resolveJWordUiI18n, type ResolvedJWordUiI18n } from '../i18n'
import {
  bindImageSelectionEvents,
  createImageSelectionDom,
  hideSelection,
  localizeImageSelectionDom,
  resizeLayer,
  syncDropCaret,
  syncImageSelectionOverlay,
  type ResizeHandleId
} from './image-selection-dom'
import {
  readImageCommandContext,
  resolveCanvasContainer,
  resolveImageSelectionSnapshot,
  type ImageSelectionSnapshot
} from './image-overlay-geometry'
import { createResizeSession, updateResizePreview, type ResizeSession } from './image-resize-session'
import {
  createDragGhostSession, hideGhost, resolveDragDropPreview,
  resolvePointerAnchorFromClientPoint, updateGhostPreview,
  type DragDropPreview,
  type DragGhostSession
} from './image-drag-drop'

interface CreateImageSelectionControllerOptions {
  readonly editor: Editor
  readonly editorHost: HTMLElement
  readonly commands: JWordMediaCommandAdapter | undefined
  readonly readonly?: JWordReadonlyMode
  readonly i18n?: ResolvedJWordUiI18n
}

interface ImageSelectionControllerHandle {
  setI18n(i18n: ResolvedJWordUiI18n): void
  refresh(): void
  destroy(): void
}

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

  const commands = options.commands
  const mountedCanvasContainer = resolveCanvasContainer(options.editorHost)

  if (mountedCanvasContainer === null) {
    return null
  }
  const canvasContainer = mountedCanvasContainer
  const dom = createImageSelectionDom(canvasContainer, options.i18n ?? resolveJWordUiI18n())
  const signalController = new AbortController()
  const readonlyMode = options.readonly === true || (typeof options.readonly === 'object' && options.readonly.enabled === true)
  let currentSnapshot: ImageSelectionSnapshot | null = null
  let resizeSession: ResizeSession | null = null
  let dragGhostSession: DragGhostSession | null = null
  let dragDropPreview: DragDropPreview | null = null

  /** 刷新 overlay 的显隐、位置和按钮状态。 */
  function refresh(): void {
    resizeLayer(dom.layer, canvasContainer)

    if (readonlyMode) {
      resizeSession = null
      dragDropPreview = null
      hideSelection(dom)
      return
    }

    const snapshot = resolveImageSelectionSnapshot(options.editor, canvasContainer, commands)

    currentSnapshot = snapshot

    if (snapshot === null) {
      resizeSession = null
      dragDropPreview = null
      hideSelection(dom)
      return
    }

    syncImageSelectionOverlay({
      dom,
      snapshot,
      resizeSession,
      dragging: dragGhostSession !== null
    })
  }

  /** 读取当前执行命令所需的上下文。 */
  function readCommandContext(target: JWordSelectedImageTarget) {
    return readImageCommandContext(options.editor, commands, target)
  }

  /** 执行顺时针 90 度旋转。 */
  async function handleRotate(): Promise<void> {
    const snapshot = currentSnapshot

    if (snapshot === null || commands.setSelectedImageRotation === undefined) {
      return
    }

    const context = readCommandContext(snapshot.target)

    if (context === null) {
      return
    }

    await commands.setSelectedImageRotation({
      editor: options.editor,
      projection: context.projection,
      selection: context.selection,
      target: context.target,
      rotationDegrees: ((context.target.rotationDegrees ?? 0) + 90) % 360
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

    await resetImageSizeIfNeeded(snapshot, context)
    await resetImageRotationIfNeeded(snapshot, context.target.rotationDegrees ?? 0)
    resizeSession = null
    options.editor.focus()
    refresh()
  }

  /** 删除当前图片。 */
  async function handleDelete(): Promise<void> {
    const snapshot = currentSnapshot

    if (snapshot === null || commands.deleteSelectedImage === undefined) {
      return
    }

    const context = readCommandContext(snapshot.target)

    if (context === null) {
      return
    }

    await commands.deleteSelectedImage({
      editor: options.editor,
      projection: context.projection,
      selection: context.selection,
      target: context.target
    })
    resizeSession = null
    options.editor.focus()
    refresh()
  }

  /** 进入缩放预览会话。 */
  function startResize(handleId: ResizeHandleId, event: PointerEvent): void {
    resizeSession = createResizeSession(handleId, event, currentSnapshot)
    refresh()
  }

  /** 进入拖拽鬼影会话。 */
  function startGhostDrag(event: PointerEvent): void {
    dragGhostSession = createDragGhostSession(event, currentSnapshot)
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
      dragDropPreview = resolveDragDropPreview(options.editor, canvasContainer, event)
      syncDropCaret(dom, dragDropPreview)
      refresh()
    }
  }

  /** 在 pointerup 时提交缩放或图片移动。 */
  async function handlePointerUp(event: PointerEvent | MouseEvent): Promise<void> {
    if (resizeSession !== null) {
      await commitResize(event)
      return
    }

    if (dragGhostSession !== null) {
      await commitDrag(event)
    }
  }

  /** 提交缩放命令。 */
  async function commitResize(event: PointerEvent | MouseEvent): Promise<void> {
    event.preventDefault()
    const session = resizeSession

    resizeSession = null

    if (session !== null && commands.resizeSelectedImage !== undefined && hasResizeChanged(session)) {
      const context = readCommandContext(session.target)

      if (context !== null) {
        await commands.resizeSelectedImage({
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
  }

  /** 提交拖拽移动命令。 */
  async function commitDrag(event: PointerEvent | MouseEvent): Promise<void> {
    event.preventDefault()
    const session = dragGhostSession

    dragGhostSession = null

    if (session?.started === true) {
      await moveImageToDropTarget(event)
    }

    dragDropPreview = null
    hideGhost(dom)
    syncDropCaret(dom, null)
    options.editor.focus()
    refresh()
  }

  /** 将图片移动到当前 drop 落点。 */
  async function moveImageToDropTarget(event: PointerEvent | MouseEvent): Promise<void> {
    const snapshot = currentSnapshot

    if (snapshot === null || commands.moveSelectedImage === undefined) {
      return
    }

    const context = readCommandContext(snapshot.target)
    const dropAnchor = dragDropPreview?.anchor ?? resolvePointerAnchorFromClientPoint(
      options.editor,
      canvasContainer,
      event.clientX,
      event.clientY
    )

    if (context !== null && dropAnchor !== null) {
      await commands.moveSelectedImage({
        editor: options.editor,
        projection: context.projection,
        selection: context.selection,
        target: context.target,
        dropSelection: createSelectionState(dropAnchor, dropAnchor)
      })
    }
  }

  /** 按需恢复原图尺寸。 */
  async function resetImageSizeIfNeeded(
    snapshot: ImageSelectionSnapshot,
    context: NonNullable<ReturnType<typeof readCommandContext>>
  ): Promise<void> {
    if (
      snapshot.naturalWidthTwips === undefined
      || snapshot.naturalHeightTwips === undefined
      || commands.resizeSelectedImage === undefined
      || (
        context.target.widthTwips === snapshot.naturalWidthTwips
        && context.target.heightTwips === snapshot.naturalHeightTwips
      )
    ) {
      return
    }

    await commands.resizeSelectedImage({
      editor: options.editor,
      projection: context.projection,
      selection: context.selection,
      target: context.target,
      widthTwips: snapshot.naturalWidthTwips,
      heightTwips: snapshot.naturalHeightTwips
    })
  }

  /** 按需恢复 0 度旋转。 */
  async function resetImageRotationIfNeeded(snapshot: ImageSelectionSnapshot, rotationDegrees: number): Promise<void> {
    if (commands.setSelectedImageRotation === undefined || rotationDegrees === 0) {
      return
    }

    const nextContext = readCommandContext(snapshot.target)

    if (nextContext !== null) {
      await commands.setSelectedImageRotation({
        editor: options.editor,
        projection: nextContext.projection,
        selection: nextContext.selection,
        target: nextContext.target,
        rotationDegrees: 0
      })
    }
  }

  /** 判断缩放预览是否产生了真实尺寸变化。 */
  function hasResizeChanged(session: ResizeSession): boolean {
    return session.previewWidthTwips !== session.startWidthTwips
      || session.previewHeightTwips !== session.startHeightTwips
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

  bindImageSelectionEvents({
    dom,
    canvasContainer,
    signal: signalController.signal,
    onRotate: () => {
      void handleRotate()
    },
    onReset: () => {
      void handleReset()
    },
    onDelete: () => {
      void handleDelete()
    },
    onResizeStart: startResize,
    onDragStart: startGhostDrag,
    onPointerMove: handlePointerMove,
    onPointerUp: (event) => {
      void handlePointerUp(event)
    },
    onRefresh: refresh
  })
  refresh()

  return {
    setI18n(nextI18n): void {
      localizeImageSelectionDom(dom, nextI18n)
      refresh()
    },
    refresh,
    destroy
  }
}
