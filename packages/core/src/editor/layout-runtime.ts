/**
 * 职责：实现编辑器运行时的布局读取、增量布局和页面调度编排。
 * 边界：不处理键盘输入和剪贴板输入，不创建文档模型。
 * 协作模块：外观运行时、布局引擎、视口虚拟化器和渲染辅助函数。
 * 性能/安全约束：构造函数和顶层代码不访问浏览器对象，DOM 只在挂载后创建，编辑命令统一进入事务流水线。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import { getCaretRect as getLayoutCaretRect, getSelectionRects as getLayoutSelectionRects, layoutDocumentIncrementally } from '../layout/runtime'
import type { DocumentLayout, LayoutRect } from '../layout/runtime'
import { createLayoutSchedule } from '../layout/scheduler'
import { twipsToCssPx } from '../layout/page-config'
import { isSelectionCollapsed } from '../model/selection'
import type { Command, TextPosition } from '../operations/transaction'
import { computeViewportPages } from '../canvas/viewport-virtualizer'
import { JWordEditorMountFacadeRuntime } from './mount-facade-runtime'
import { createPageStartKeys, isSameTextPosition, mergePageIndexes, renderPageBatch, resolveCanvasPixelRatio, resolveOperationDirtyPageIndexes } from './rendering'
import { cancelDeferredVisualTask, scheduleDeferredVisualTask } from './visual-task-scheduler'
import type { RenderReason, TransientLayoutQuerySnapshot } from './types'

export abstract class JWordEditorLayoutRuntime extends JWordEditorMountFacadeRuntime {
  protected renderMountedLayout(reason: RenderReason): void {
    const mountedDom = this.mountedDom

    if (mountedDom === undefined) {
      return
    }

    if (reason !== 'document') {
      this.cancelDeferredDocumentRender()
    }

    let layout: DocumentLayout
    let schedule: ReturnType<typeof createLayoutSchedule>

    if (reason === 'document') {
      this.cancelDeferredRender()
      const pass = this.runLayoutPass({
        maxPages: 1
      })

      layout = pass.layout
      schedule = createLayoutSchedule({
        pageCount: Math.max(layout.pages.length, (pass.continuation?.dirtyPageIndex ?? -1) + 1),
        dirtyPageIndex: this.dirtyPageIndex,
        immediatePageIndexes: pass.laidOutPageIndexes,
        ...(pass.continuation?.dirtyPageIndex === undefined
          ? {}
          : { deferredStartPageIndex: pass.continuation.dirtyPageIndex }),
        ...(pass.continuation === undefined && pass.stoppedAtPageIndex !== undefined
          ? { stoppedAtPageIndexHint: pass.stoppedAtPageIndex }
          : {}),
        chunkSize: 4
      })
    } else {
      layout = this.cachedLayout ?? this.ensureCurrentLayout()
      const nextPageStartKeys = createPageStartKeys(layout)

      schedule = createLayoutSchedule({
        pageCount: layout.pages.length,
        dirtyPageIndex: this.dirtyPageIndex,
        previousPageStartKeys: this.pageStartKeys,
        nextPageStartKeys,
        chunkSize: 4
      })
    }

    const nextPageStartKeys = createPageStartKeys(layout)
    const viewport = computeViewportPages({
      pages: layout.pages.map((page) => ({
        pageIndex: page.pageIndex,
        top: twipsToCssPx(page.y, this.pageConfig.scale),
        height: twipsToCssPx(page.height, this.pageConfig.scale)
      })),
      scrollTop: mountedDom.canvasContainer.scrollTop,
      viewportHeight: mountedDom.canvasContainer.clientHeight || this.pageConfig.heightCssPx,
      bufferPages: 1
    })
    const selectionRender = this.createSelectionRenderState(layout)
    const experimentalDecorations = this.pluginHost.readDecorations({
      projection: this.currentProjection,
      layout,
      selection: this.currentSelection,
      reason
    })
    const decorationPageIndexes = mergePageIndexes(experimentalDecorations.map((decoration) => decoration.pageIndex))
    const shouldUseSchedule = reason === 'document'
    const scheduledImmediatePageIndexes = shouldUseSchedule ? schedule.immediatePageIndexes : []
    const retainedPageIndexes = mergePageIndexes(
      viewport.retainedPageIndexes,
      scheduledImmediatePageIndexes,
      selectionRender.pageIndexes,
      mountedDom.commentPageIndexes,
      this.selectionPageIndexes
    )
    const rerenderPageIndexes = mergePageIndexes(
      reason === 'mount' || reason === 'resource' ? viewport.retainedPageIndexes : [],
      scheduledImmediatePageIndexes,
      selectionRender.pageIndexes,
      mountedDom.commentPageIndexes,
      this.selectionPageIndexes,
      decorationPageIndexes
    )

    mountedDom.canvases = renderPageBatch({
      mountedDom,
      pages: layout.pages,
      retainedPageIndexes,
      rerenderPageIndexes,
      selectionRender,
      experimentalDecorations,
      scale: this.pageConfig.scale,
      pixelRatio: resolveCanvasPixelRatio(mountedDom)
    })
    mountedDom.canvasContainer.setAttribute('data-jword-page-count', String(layout.pages.length))
    mountedDom.canvasContainer.setAttribute('data-jword-layout-immediate-pages', schedule.immediatePageIndexes.join(','))
    mountedDom.canvasContainer.setAttribute(
      'data-jword-layout-deferred-chunks',
      schedule.deferredChunks.map((chunk) => chunk.join(',')).join(';')
    )

    if (schedule.stoppedAtPageIndex === undefined) {
      mountedDom.canvasContainer.removeAttribute('data-jword-layout-stopped-at')
    } else {
      mountedDom.canvasContainer.setAttribute('data-jword-layout-stopped-at', String(schedule.stoppedAtPageIndex))
    }

    mountedDom.canvasContainer.setAttribute('data-jword-layout-rerender-pages', rerenderPageIndexes.join(','))
    mountedDom.commentPageIndexes = selectionRender.commentRects === undefined
      ? []
      : mergePageIndexes(selectionRender.commentRects.map((rect) => rect.pageIndex))
    this.pageStartKeys = nextPageStartKeys
    this.selectionPageIndexes = selectionRender.pageIndexes
    if (reason === 'document') {
      this.scheduleDeferredTextMirrorSync(selectionRender.caretRect)
    } else {
      this.syncMountedAssistiveDom(layout, {
        ...(selectionRender.caretRect === undefined ? {} : { caretRect: selectionRender.caretRect })
      })
    }

    if (reason === 'document' && this.pendingLayoutContinuation !== undefined) {
      this.scheduleDeferredRender(this.pendingLayoutContinuation, 4)
    }
  }

  protected ensureCurrentLayout(): DocumentLayout {
    if (this.cachedLayout !== undefined && !this.layoutNeedsRefresh && this.pendingLayoutContinuation === undefined) {
      return this.cachedLayout
    }

    if (this.pendingLayoutContinuation !== undefined && this.cachedLayout !== undefined && !this.layoutNeedsRefresh) {
      const pass = this.runLayoutPass({
        dirtyPageIndex: this.pendingLayoutContinuation.dirtyPageIndex,
        dirtyPageEndIndex: this.pendingLayoutContinuation.dirtyPageEndIndex,
        startPosition: this.pendingLayoutContinuation.startPosition
      })

      this.cancelDeferredRender()

      return pass.layout
    }

    return this.runLayoutPass().layout
  }

  protected readLayoutForQuery(): DocumentLayout {
    if (this.cachedLayout !== undefined && !this.layoutNeedsRefresh) {
      return this.cachedLayout
    }

    if (!this.layoutNeedsRefresh) {
      return this.ensureCurrentLayout()
    }

    if (this.mountedDom !== undefined) {
      return this.readTransientLayoutThroughPage(this.dirtyPageEndIndex)
    }

    return this.runLayoutPass({
      maxPages: Math.max(1, this.dirtyPageEndIndex - this.dirtyPageIndex + 1)
    }).layout
  }

  protected readTransientLayoutThroughPage(pageIndex: number): DocumentLayout {
    let snapshot = this.createTransientLayoutQuerySnapshot()

    while (true) {
      if (
        snapshot.layout !== undefined
        && (
          snapshot.staleFromPageIndex === undefined
          || pageIndex < snapshot.staleFromPageIndex
        )
      ) {
        return snapshot.layout
      }

      if (!this.canAdvanceTransientLayoutQuerySnapshot(snapshot)) {
        return snapshot.layout ?? this.ensureCurrentLayout()
      }

      snapshot = this.advanceTransientLayoutQuerySnapshot(
        snapshot,
        this.resolveTransientLayoutPassPageCount(snapshot, pageIndex)
      )
    }
  }

  protected readTransientLayoutForPosition(position: TextPosition): DocumentLayout {
    let snapshot = this.createTransientLayoutQuerySnapshot()

    while (true) {
      const layout = snapshot.layout
      const rect = layout === undefined ? undefined : getLayoutCaretRect(layout, position)

      if (
        layout !== undefined
        && (
          snapshot.staleFromPageIndex === undefined
          || (rect !== undefined && rect.pageIndex < snapshot.staleFromPageIndex)
        )
      ) {
        return layout
      }

      if (!this.canAdvanceTransientLayoutQuerySnapshot(snapshot)) {
        return layout ?? this.ensureCurrentLayout()
      }

      snapshot = this.advanceTransientLayoutQuerySnapshot(
        snapshot,
        this.resolveTransientLayoutPassPageCount(
          snapshot,
          rect?.pageIndex ?? snapshot.staleFromPageIndex ?? this.dirtyPageEndIndex
        )
      )
    }
  }

  protected readTransientLayoutForRange(range: Readonly<{
    anchor: TextPosition
    focus: TextPosition
  }>): DocumentLayout {
    if (isSameTextPosition(range.anchor, range.focus)) {
      return this.readLayoutForQuery()
    }

    let snapshot = this.createTransientLayoutQuerySnapshot()

    while (true) {
      const layout = snapshot.layout
      const anchorRect = layout === undefined ? undefined : getLayoutCaretRect(layout, range.anchor)
      const focusRect = layout === undefined ? undefined : getLayoutCaretRect(layout, range.focus)

      if (
        layout !== undefined
        && (
          snapshot.staleFromPageIndex === undefined
          || (
            anchorRect !== undefined
            && focusRect !== undefined
            && anchorRect.pageIndex < snapshot.staleFromPageIndex
            && focusRect.pageIndex < snapshot.staleFromPageIndex
          )
        )
      ) {
        return layout
      }

      if (!this.canAdvanceTransientLayoutQuerySnapshot(snapshot)) {
        return layout ?? this.ensureCurrentLayout()
      }

      snapshot = this.advanceTransientLayoutQuerySnapshot(
        snapshot,
        this.resolveTransientLayoutPassPageCount(
          snapshot,
          Math.max(
            anchorRect?.pageIndex ?? -1,
            focusRect?.pageIndex ?? -1,
            snapshot.staleFromPageIndex ?? this.dirtyPageEndIndex
          )
        )
      )
    }
  }

  protected createTransientLayoutQuerySnapshot(): TransientLayoutQuerySnapshot {
    if (this.layoutNeedsRefresh) {
      return {
        ...(this.cachedLayout === undefined ? {} : { layout: this.cachedLayout }),
        staleFromPageIndex: this.dirtyPageIndex,
        needsInitialPass: true
      }
    }

    if (this.pendingLayoutContinuation !== undefined) {
      return {
        ...(this.cachedLayout === undefined ? {} : { layout: this.cachedLayout }),
        continuation: this.pendingLayoutContinuation,
        staleFromPageIndex: this.pendingLayoutContinuation.dirtyPageIndex,
        needsInitialPass: this.cachedLayout === undefined
      }
    }

    return {
      ...(this.cachedLayout === undefined ? {} : { layout: this.cachedLayout }),
      needsInitialPass: this.cachedLayout === undefined
    }
  }

  protected canAdvanceTransientLayoutQuerySnapshot(snapshot: TransientLayoutQuerySnapshot): boolean {
    return snapshot.needsInitialPass || snapshot.continuation !== undefined
  }

  protected resolveTransientLayoutPassPageCount(
    snapshot: TransientLayoutQuerySnapshot,
    targetPageIndex: number
  ): number | undefined {
    const normalizedTargetPageIndex = Math.max(0, targetPageIndex)

    if (snapshot.continuation !== undefined) {
      return Math.max(1, normalizedTargetPageIndex - snapshot.continuation.dirtyPageIndex + 1)
    }

    if (!snapshot.needsInitialPass || !this.layoutNeedsRefresh) {
      return undefined
    }

    return Math.max(
      1,
      this.dirtyPageEndIndex - this.dirtyPageIndex + 1,
      normalizedTargetPageIndex - this.dirtyPageIndex + 1
    )
  }

  protected advanceTransientLayoutQuerySnapshot(
    snapshot: TransientLayoutQuerySnapshot,
    maxPages?: number
  ): TransientLayoutQuerySnapshot {
    const pass = layoutDocumentIncrementally({
      projection: this.currentProjection,
      pageConfig: this.pageConfig,
      fontManager: this.fontManager,
      layoutOptions: this.layoutOptions,
      ...(snapshot.layout === undefined ? {} : { previousLayout: snapshot.layout }),
      ...(snapshot.continuation === undefined
        ? {
            ...(this.layoutNeedsRefresh
              ? {
                  dirtyPageIndex: this.dirtyPageIndex,
                  dirtyPageEndIndex: this.dirtyPageEndIndex
                }
              : {}),
            ...(this.layoutNeedsRefresh && this.layoutDirtyRange !== undefined
              ? { dirtyRange: this.layoutDirtyRange }
              : {})
          }
        : {
            dirtyPageIndex: snapshot.continuation.dirtyPageIndex,
            dirtyPageEndIndex: snapshot.continuation.dirtyPageEndIndex,
            startPosition: snapshot.continuation.startPosition
          }),
      ...(maxPages === undefined ? {} : { maxPages })
    })

    if (snapshot.continuation !== undefined || this.mountedDom !== undefined) {
      this.cachedLayout = pass.layout
      this.pendingLayoutContinuation = pass.continuation
      this.syncDeferredRenderWithCurrentContinuation()
    }

    return {
      layout: pass.layout,
      ...(pass.continuation === undefined
        ? {}
        : {
            continuation: pass.continuation,
            staleFromPageIndex: pass.continuation.dirtyPageIndex
          }),
      needsInitialPass: false
    }
  }

  protected syncDeferredRenderWithCurrentContinuation(): void {
    const mountedDom = this.mountedDom
    const deferredRender = mountedDom?.deferredRender

    if (mountedDom === undefined || deferredRender === undefined) {
      return
    }

    cancelDeferredVisualTask(deferredRender.taskHandle)

    if (this.pendingLayoutContinuation === undefined) {
      mountedDom.deferredRender = undefined
      return
    }

    mountedDom.deferredRender = {
      taskHandle: scheduleDeferredVisualTask(mountedDom, () => {
        this.flushDeferredRenderChunk()
      }),
      chunkSize: deferredRender.chunkSize,
      continuation: this.pendingLayoutContinuation
    }
  }

  protected resolveCurrentSelectionPageIndex(): number | undefined {
    if (this.currentSelection === null) {
      return undefined
    }

    try {
      const selectionPosition = this.resolveTextPosition(this.currentSelection.anchor)
      const cachedPageIndex = this.cachedLayout === undefined
        ? undefined
        : getLayoutCaretRect(this.cachedLayout, selectionPosition)?.pageIndex

      return cachedPageIndex ?? getLayoutCaretRect(this.ensureCurrentLayout(), selectionPosition)?.pageIndex
    } catch {
      return undefined
    }
  }

  protected resolveCommandDirtyPageIndex(command: Command): number | undefined {
    return this.resolveCommandDirtyPageBounds(command)?.start
  }

  protected resolveCommandDirtyPageBounds(command: Command): Readonly<{
    start: number
    end: number
  }> | undefined {
    if (command.operations.length === 0) {
      return undefined
    }

    const cachedPageIndexes = this.cachedLayout === undefined
      ? []
      : mergePageIndexes(...command.operations.map((operation) => resolveOperationDirtyPageIndexes(this.cachedLayout!, operation)))

    if (cachedPageIndexes.length > 0) {
      return {
        start: cachedPageIndexes[0]!,
        end: cachedPageIndexes[cachedPageIndexes.length - 1]!
      }
    }

    const layout = this.ensureCurrentLayout()
    const pageIndexes = mergePageIndexes(...command.operations.map((operation) => resolveOperationDirtyPageIndexes(layout, operation)))

    if (pageIndexes.length === 0) {
      return undefined
    }

    return {
      start: pageIndexes[0]!,
      end: pageIndexes[pageIndexes.length - 1]!
    }
  }

  protected runLayoutPass(input: Readonly<{
    dirtyPageIndex?: number
    dirtyPageEndIndex?: number
    startPosition?: TextPosition
    maxPages?: number
  }> = {}): Readonly<{
    layout: DocumentLayout
    laidOutPageIndexes: readonly number[]
    continuation?: Readonly<{
      dirtyPageIndex: number
      dirtyPageEndIndex: number
      startPosition: TextPosition
    }>
    stoppedAtPageIndex?: number
  }> {
    const pass = layoutDocumentIncrementally({
      projection: this.currentProjection,
      pageConfig: this.pageConfig,
      fontManager: this.fontManager,
      layoutOptions: this.layoutOptions,
      ...(this.cachedLayout === undefined ? {} : { previousLayout: this.cachedLayout }),
      ...(input.dirtyPageIndex !== undefined || this.layoutNeedsRefresh
        ? { dirtyPageIndex: input.dirtyPageIndex ?? this.dirtyPageIndex }
        : {}),
      ...(input.dirtyPageEndIndex !== undefined || this.layoutNeedsRefresh
        ? { dirtyPageEndIndex: input.dirtyPageEndIndex ?? this.dirtyPageEndIndex }
        : {}),
      ...(input.startPosition === undefined ? {} : { startPosition: input.startPosition }),
      ...(this.layoutDirtyRange === undefined || input.startPosition !== undefined ? {} : { dirtyRange: this.layoutDirtyRange }),
      ...(input.maxPages === undefined ? {} : { maxPages: input.maxPages })
    })

    this.cachedLayout = pass.layout
    this.pendingLayoutContinuation = pass.continuation
    this.layoutNeedsRefresh = false
    this.layoutDirtyRange = undefined

    return pass
  }

  protected createSelectionRenderState(layout: DocumentLayout): Readonly<{
    selectionRects?: readonly LayoutRect[]
    commentRects?: readonly LayoutRect[]
    caretRect?: LayoutRect
    pageIndexes: readonly number[]
  }> {
    const commentRects = this.collectCommentRects(layout)
    const commentPageIndexes = commentRects.map((rect) => rect.pageIndex)

    if (this.currentSelection === null) {
      return {
        ...(commentRects.length === 0 ? {} : { commentRects }),
        pageIndexes: mergePageIndexes(commentPageIndexes)
      }
    }

    try {
      const range = {
        anchor: this.resolveTextPosition(this.currentSelection.anchor),
        focus: this.resolveTextPosition(this.currentSelection.focus)
      }
      const selectionRects = getLayoutSelectionRects(layout, range)
      const caretRect = isSelectionCollapsed(this.currentSelection) && this.caretBlinkVisible && selectionRects.length === 0
        ? getLayoutCaretRect(layout, range.focus)
        : undefined
      const pageIndexes = mergePageIndexes(
        selectionRects.map((rect) => rect.pageIndex),
        commentPageIndexes,
        caretRect === undefined ? [] : [caretRect.pageIndex]
      )

      return {
        ...(selectionRects.length === 0 ? {} : { selectionRects }),
        ...(commentRects.length === 0 ? {} : { commentRects }),
        ...(caretRect === undefined ? {} : { caretRect }),
        pageIndexes
      }
    } catch {
      return {
        ...(commentRects.length === 0 ? {} : { commentRects }),
        pageIndexes: mergePageIndexes(commentPageIndexes)
      }
    }
  }

  /** 汇总未解决批注范围的 canvas 高亮矩形。 */
  protected collectCommentRects(layout: DocumentLayout): readonly LayoutRect[] {
    const rects: LayoutRect[] = []

    for (const thread of this.currentProjection.document.comments ?? []) {
      if (thread.resolved) {
        continue
      }

      try {
        const range = this.locateCommentThread(thread.id)

        if (range === null) {
          continue
        }

        rects.push(...getLayoutSelectionRects(layout, {
          anchor: this.resolveTextPosition(range.anchor),
          focus: this.resolveTextPosition(range.focus)
        }))
      } catch {
        continue
      }
    }

    return Object.freeze(rects)
  }

  protected abstract override cancelDeferredRender(): void
  protected abstract scheduleDeferredRender(continuation: Readonly<{ dirtyPageIndex: number, dirtyPageEndIndex: number, startPosition: TextPosition }>, chunkSize: number): void
  protected abstract scheduleDeferredTextMirrorSync(caretRect?: LayoutRect): void
  protected abstract syncMountedAssistiveDom(layout: DocumentLayout, options?: Readonly<{ caretRect?: LayoutRect }>): void
  protected abstract flushDeferredRenderChunk(): void
}
