/**
 * 职责：同步挂载后的辅助 DOM、文本镜像、光标闪烁和指针选区绘制。
 * 边界：不解析键盘输入语义，不生成编辑 operations。
 * 协作模块：布局运行时、DOM 辅助函数、渲染辅助函数和选择区运行时。
 * 性能/安全约束：构造函数和顶层代码不访问浏览器对象，DOM 只在挂载后创建，编辑命令统一进入事务流水线。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/03-architecture.md 与 04-engineering-standards.md#45-模块边界。
 */
import { renderPageCanvas } from '../canvas/renderer'
import { createSelectionFormattingState } from '../model/formatting-state'
import { getCaretRect as getLayoutCaretRect } from '../layout/runtime'
import type { DocumentLayout, LayoutRect } from '../layout/runtime'
import { isSelectionCollapsed } from '../model/selection'
import type { SelectionState } from '../model/selection'
import { CARET_BLINK_INTERVAL_MS, DEFERRED_DOCUMENT_RENDER_DELAY_MS, DEFERRED_TEXT_MIRROR_SYNC_DELAY_MS } from './constants'
import { focusHiddenTextarea, syncHiddenTextareaPosition } from './dom'
import { JWordEditorLayoutRuntime } from './layout-runtime'
import { createCanvasElement, mergePageIndexes, renderPointerSelectionCanvas, resolveCanvasPixelRatio } from './rendering'
import { readProjectionPlainText } from './text-runtime'
import type { EditorEvent } from './types'

export abstract class JWordEditorMountedRuntime extends JWordEditorLayoutRuntime {
  protected emit(event: EditorEvent): void {
    for (const listener of this.listeners) {
      listener(event)
    }
  }

  protected emitSelectionChange(): void {
    this.emit({
      kind: 'selectionChange',
      selection: this.currentSelection,
      formattingState: this.readCurrentSelectionFormattingState()
    })
  }

  protected syncMountedAssistiveDom(
    layout: DocumentLayout,
    options: Readonly<{
      caretRect?: LayoutRect
    }> = {}
  ): void {
    const mountedDom = this.mountedDom

    if (mountedDom === undefined) {
      return
    }

    this.cancelDeferredTextMirrorSync()
    this.syncMountedTextMirror()
    syncHiddenTextareaPosition({
      mountedDom,
      caretRect: options.caretRect ?? this.resolveSelectionCaretRect(layout),
      scale: this.pageConfig.scale
    })
  }

  protected syncMountedTextMirror(): void {
    const mountedDom = this.mountedDom

    if (mountedDom === undefined || !this.mountedTextMirrorNeedsRefresh) {
      return
    }

    mountedDom.textMirror.textContent = readProjectionPlainText(this.currentProjection)
    this.mountedTextMirrorNeedsRefresh = false
  }

  protected scheduleDeferredTextMirrorSync(caretRect?: LayoutRect): void {
    const mountedDom = this.mountedDom

    if (mountedDom === undefined) {
      return
    }

    if (this.deferredTextMirrorSyncId !== undefined) {
      return
    }

    const timeoutId = setTimeout(() => {
      this.deferredTextMirrorSyncId = undefined

      if (this.mountedDom !== undefined) {
        this.mountedDom.deferredTextMirrorSyncId = undefined
      }

      if (this.isDestroyed) {
        return
      }

      this.syncMountedTextMirror()
      syncHiddenTextareaPosition({
        mountedDom,
        caretRect,
        scale: this.pageConfig.scale
      })
    }, DEFERRED_TEXT_MIRROR_SYNC_DELAY_MS)

    this.deferredTextMirrorSyncId = timeoutId
    mountedDom.deferredTextMirrorSyncId = timeoutId
  }

  /**
   * 职责：把 mounted document render 挪到当前事务热路径之后再执行。
   */
  protected scheduleDeferredDocumentRender(): void {
    if (this.mountedDom === undefined || this.deferredDocumentRenderId !== undefined) {
      return
    }

    this.deferredDocumentRenderId = setTimeout(() => {
      this.deferredDocumentRenderId = undefined

      if (this.isDestroyed) {
        return
      }

      this.renderMountedLayout('document')
    }, DEFERRED_DOCUMENT_RENDER_DELAY_MS)
  }

  /**
   * 职责：取消尚未执行的 mounted document render。
   */
  protected cancelDeferredDocumentRender(): void {
    if (this.deferredDocumentRenderId === undefined) {
      return
    }

    clearTimeout(this.deferredDocumentRenderId)
    this.deferredDocumentRenderId = undefined
  }

  /**
   * 职责：保留显式文档切换的同步渲染语义，其余事务默认允许延后。
   */
  protected shouldRenderMountedDocumentImmediately(commandName: string): boolean {
    return commandName === 'createDocument' || commandName === 'loadFixture'
  }

  protected cancelDeferredTextMirrorSync(): void {
    if (this.deferredTextMirrorSyncId === undefined) {
      return
    }

    clearTimeout(this.deferredTextMirrorSyncId)
    this.deferredTextMirrorSyncId = undefined

    if (this.mountedDom !== undefined) {
      this.mountedDom.deferredTextMirrorSyncId = undefined
    }
  }

  protected resolveSelectionCaretRect(layout: DocumentLayout): LayoutRect | undefined {
    if (this.currentSelection === null) {
      return undefined
    }

    try {
      return getLayoutCaretRect(layout, this.resolveTextPosition(this.currentSelection.focus))
    } catch {
      return undefined
    }
  }

  protected refreshMountedSelectionRuntime(previousSelection: SelectionState | null): void {
    if (this.mountedDom === undefined) {
      return
    }

    if (
      previousSelection !== this.currentSelection
      || (this.currentSelection === null && this.selectionPageIndexes.length > 0)
    ) {
      this.renderMountedLayout('selection')
      return
    }

    this.syncMountedAssistiveDom(this.cachedLayout ?? this.ensureCurrentLayout())
  }

  /** 共享事务刷新文档后，同步当前稳定 selection 到新的正文位置。 */
  protected refreshSelectionAfterSharedTransaction(previousSelection: SelectionState | null): void {
    if (this.currentSelection === null) {
      return
    }

    this.refreshMountedSelectionRuntime(previousSelection)
    this.emitSelectionChange()
  }

  protected syncCaretBlinkState(): void {
    this.stopCaretBlink()

    if (!this.isInputFocused || this.currentSelection === null || !isSelectionCollapsed(this.currentSelection)) {
      this.caretBlinkVisible = false
      return
    }

    this.caretBlinkVisible = true
    this.caretBlinkIntervalId = setInterval(() => {
      if (this.isDestroyed || this.currentSelection === null || !isSelectionCollapsed(this.currentSelection)) {
        this.stopCaretBlink()
        return
      }

      this.caretBlinkVisible = !this.caretBlinkVisible
      this.refreshBlinkingCaretRender()
    }, CARET_BLINK_INTERVAL_MS)
  }

  protected stopCaretBlink(): void {
    if (this.caretBlinkIntervalId !== undefined) {
      clearInterval(this.caretBlinkIntervalId)
      this.caretBlinkIntervalId = undefined
    }
  }

  protected refreshBlinkingCaretRender(): void {
    const mountedDom = this.mountedDom

    if (mountedDom === undefined) {
      return
    }

    if (mountedDom.pointerState.anchor !== null) {
      this.renderMountedPointerSelection()
      return
    }

    this.renderMountedLayout('selection')
  }

  protected renderMountedPointerSelection(): void {
    const mountedDom = this.mountedDom

    if (mountedDom === undefined) {
      return
    }

    const layout = this.cachedLayout ?? this.ensureCurrentLayout()
    const selectionRender = this.createSelectionRenderState(layout)
    const affectedPageIndexes = mergePageIndexes(
      mountedDom.pointerState.paintedPageIndexes,
      selectionRender.pageIndexes
    )
    const pageLookup = new Map(layout.pages.map((page) => [page.pageIndex, page]))

    this.syncMountedBaseCanvases(layout, affectedPageIndexes)

    for (const pageIndex of affectedPageIndexes) {
      const canvas = mountedDom.canvases.get(pageIndex)
      const baseCanvas = mountedDom.baseCanvases.get(pageIndex)
      const page = pageLookup.get(pageIndex)

      if (!(canvas instanceof HTMLCanvasElement) || baseCanvas === undefined || page === undefined) {
        continue
      }

      renderPointerSelectionCanvas({
        canvas,
        baseCanvas,
        page,
        ...(selectionRender.selectionRects === undefined
          ? {}
          : { selectionRects: selectionRender.selectionRects }),
        ...(selectionRender.caretRect === undefined
          ? {}
          : { caretRect: selectionRender.caretRect }),
        scale: this.pageConfig.scale
      })
    }

    mountedDom.pointerState.paintedPageIndexes = selectionRender.pageIndexes
  }

  protected scheduleDeferredPointerSelectionRender(delayMs = 0): void {
    if (this.deferredPointerSelectionRenderId !== undefined) {
      return
    }

    this.deferredPointerSelectionRenderId = setTimeout(() => {
      this.deferredPointerSelectionRenderId = undefined

      if (this.isDestroyed) {
        return
      }

      this.renderMountedPointerSelection()
    }, delayMs)
  }

  protected cancelDeferredPointerSelectionWork(): void {
    if (this.deferredPointerSelectionRenderId !== undefined) {
      clearTimeout(this.deferredPointerSelectionRenderId)
      this.deferredPointerSelectionRenderId = undefined
    }

    if (this.deferredSelectionChangeId !== undefined) {
      clearTimeout(this.deferredSelectionChangeId)
      this.deferredSelectionChangeId = undefined
    }

    if (this.deferredPointerAutoScrollId !== undefined) {
      clearInterval(this.deferredPointerAutoScrollId)
      this.deferredPointerAutoScrollId = undefined
    }

    if (this.mountedDom !== undefined) {
      this.mountedDom.pointerState.autoScrollDeltaY = 0
    }
  }

  protected syncMountedBaseCanvases(layout: DocumentLayout, pageIndexes: readonly number[]): void {
    const mountedDom = this.mountedDom

    if (mountedDom === undefined) {
      return
    }

    const activePageIndexes = new Set(layout.pages.map((page) => page.pageIndex))

    for (const pageIndex of Array.from(mountedDom.baseCanvases.keys())) {
      if (!activePageIndexes.has(pageIndex)) {
        mountedDom.baseCanvases.delete(pageIndex)
      }
    }

    const pageLookup = new Map(layout.pages.map((page) => [page.pageIndex, page]))
    const pixelRatio = resolveCanvasPixelRatio(mountedDom)

    for (const pageIndex of pageIndexes) {
      const page = pageLookup.get(pageIndex)

      if (page === undefined) {
        continue
      }

      const canvas = mountedDom.baseCanvases.get(pageIndex) ?? createCanvasElement(
        mountedDom.canvasContainer.ownerDocument
      )

      renderPageCanvas({
        canvas,
        page,
        scale: this.pageConfig.scale,
        pixelRatio,
        commentRects: this.collectCommentRects(layout),
        ...(mountedDom.imageResourceResolver === undefined
          ? {}
          : { imageResourceResolver: mountedDom.imageResourceResolver })
      })
      mountedDom.baseCanvases.set(pageIndex, canvas)
    }
  }

  protected finalizeMountedPointerSelection(): void {
    const mountedDom = this.mountedDom

    if (mountedDom === undefined) {
      this.emitSelectionChange()
      return
    }

    this.renderMountedPointerSelection()
    this.selectionPageIndexes = mountedDom.pointerState.paintedPageIndexes
    mountedDom.pointerState.paintedPageIndexes = []
    this.syncMountedAssistiveDom(this.cachedLayout ?? this.ensureCurrentLayout())
    this.emitSelectionChange()
    focusHiddenTextarea(mountedDom)
  }

  protected scheduleDeferredPointerSelectionFinalize(delayMs = 0): void {
    if (this.deferredSelectionChangeId !== undefined) {
      return
    }

    this.deferredSelectionChangeId = setTimeout(() => {
      this.deferredSelectionChangeId = undefined

      if (this.isDestroyed) {
        return
      }

      this.finalizeMountedPointerSelection()
    }, delayMs)
  }

  protected abstract override handleRuntimeInput(event: Event): void
  protected abstract override handleRuntimeCompositionStart(event: Event): void
  protected abstract override handleRuntimeCompositionUpdate(event: Event): void
  protected abstract override handleRuntimeCompositionEnd(event: Event): void
  protected abstract override handleRuntimeKeyDown(event: KeyboardEvent): void
  protected abstract override handleRuntimeCopy(event: Event): void
  protected abstract override handleRuntimeCut(event: Event): void
  protected abstract override handleRuntimePaste(event: Event): void
  protected abstract override handleRuntimePointerDown(event: MouseEvent): void
  protected abstract override handleRuntimePointerMove(event: MouseEvent): void
  protected abstract override handleRuntimePointerUp(event: MouseEvent): void
  protected abstract override handleRuntimeDoubleClick(event: MouseEvent): void
}
