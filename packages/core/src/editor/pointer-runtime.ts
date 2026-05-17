/**
 * 职责：处理指针命中、双击扩词和增量渲染分块的延迟调度。
 * 边界：不处理键盘输入，不创建公开外观类型。
 * 协作模块：输入运行时、布局运行时、渲染辅助函数和文本运行时辅助函数。
 * 性能/安全约束：构造函数和顶层代码不访问浏览器对象，DOM 只在挂载后创建，编辑命令统一进入事务流水线。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/03-architecture.md 与 04-engineering-standards.md#45-模块边界。
 */
import { hitTestDocumentLayout } from '../layout/runtime'
import type { TextPosition } from '../operations/transaction'
import { createJWordError } from '../shared/errors'
import { readAnchorRefSnapshot } from '../model/position'
import type { AnchorRef } from '../model/position'
import { createSelectionState } from '../model/selection'
import type { SelectionState } from '../model/selection'
import { splitGraphemes } from '../shared/grapheme'
import { createLayoutSchedule } from '../layout/scheduler'
import { twipsToCssPx } from '../layout/page-config'
import { computeViewportPages } from '../canvas/viewport-virtualizer'
import { JWordEditorInputRuntime } from './input-runtime'
import { createPageStartKeys, mergePageIndexes, renderPageBatch, resolveCanvasPixelRatio } from './rendering'
import {
  createRuntimeAnchor,
  isWordLikeGrapheme,
  readDoubleClickExpansionKind,
  readProjectionRunText,
  resolveWordSelectionIndex
} from './text-runtime'
import type { PointerPageMetrics } from './types'

export abstract class JWordEditorPointerRuntime extends JWordEditorInputRuntime {
  protected resolvePointerPageMetrics(
    event: MouseEvent,
    cachedPageMetrics?: PointerPageMetrics
  ): PointerPageMetrics | undefined {
    const target = event.target

    if (!(target instanceof Element)) {
      return undefined
    }

    const page = target.closest('[data-jword-page]')

    if (!(page instanceof HTMLElement)) {
      return undefined
    }

    const pageIndex = Number.parseInt(page.getAttribute('data-jword-page') ?? '-1', 10)

    if (!Number.isInteger(pageIndex) || pageIndex < 0) {
      return undefined
    }

    if (cachedPageMetrics?.pageIndex === pageIndex) {
      return cachedPageMetrics
    }

    return this.readPointerPageMetrics(pageIndex, page)
  }

  protected resolvePointerAnchor(
    event: MouseEvent,
    pageMetrics: PointerPageMetrics
  ): AnchorRef | undefined {
    const point = {
      pageIndex: pageMetrics.pageIndex,
      x: (event.clientX - pageMetrics.left) / pageMetrics.scaleX,
      y: (event.clientY - pageMetrics.top) / pageMetrics.scaleY
    }
    const layout = this.cachedLayout !== undefined && !this.layoutNeedsRefresh
      ? this.cachedLayout
      : this.readTransientLayoutThroughPage(pageMetrics.pageIndex)
    const position = hitTestDocumentLayout(layout, point)

    if (position === undefined) {
      return undefined
    }

    return createRuntimeAnchor({
      documentId: this.currentProjection.document.id,
      ...position
    })
  }

  protected readPointerPageMetrics(pageIndex: number, page: HTMLElement): PointerPageMetrics {
    const layout = this.cachedLayout !== undefined && !this.layoutNeedsRefresh
      ? this.cachedLayout
      : this.readTransientLayoutThroughPage(pageIndex)
    const pageBox = layout.pages[pageIndex]

    if (pageBox === undefined) {
      throw createJWordError('EDITOR_POINTER_PAGE_MISSING', 'pointer 目标页缺失')
    }

    const rect = page.getBoundingClientRect()

    return {
      pageIndex,
      left: rect.left,
      top: rect.top,
      scaleX: rect.width / pageBox.width,
      scaleY: rect.height / pageBox.height
    }
  }

  protected expandWordSelection(anchor: AnchorRef): SelectionState {
    const position = this.resolveTextPosition(anchor)
    const snapshot = readAnchorRefSnapshot(anchor)
    const text = readProjectionRunText(this.currentProjection, position.blockId, position.runId)
    const graphemes = splitGraphemes(text)

    if (graphemes.length === 0) {
      return createSelectionState(anchor, anchor)
    }

    const index = resolveWordSelectionIndex(graphemes, position.graphemeIndex, snapshot.assoc)
    const expansionKind = readDoubleClickExpansionKind(graphemes[index] ?? '')
    const isWord = expansionKind === 'word'
    let start = index
    let end = index + 1

    if (isWord) {
      while (start > 0 && isWordLikeGrapheme(graphemes[start - 1] ?? '')) {
        start -= 1
      }

      while (end < graphemes.length && isWordLikeGrapheme(graphemes[end] ?? '')) {
        end += 1
      }
    }

    return createSelectionState(
      createRuntimeAnchor({
        documentId: this.currentProjection.document.id,
        sectionId: position.sectionId,
        blockId: position.blockId,
        runId: position.runId,
        graphemeIndex: start
      }),
      createRuntimeAnchor({
        documentId: this.currentProjection.document.id,
        sectionId: position.sectionId,
        blockId: position.blockId,
        runId: position.runId,
        graphemeIndex: end
      })
    )
  }

  protected scheduleDeferredRender(
    continuation: Readonly<{
      dirtyPageIndex: number
      dirtyPageEndIndex: number
      startPosition: TextPosition
    }>,
    chunkSize: number
  ): void {
    const mountedDom = this.mountedDom

    if (mountedDom === undefined) {
      return
    }

    const deferredRender = {
      timeoutId: setTimeout(() => {
        this.flushDeferredRenderChunk()
      }, 0),
      chunkSize,
      continuation
    }

    mountedDom.deferredRender = deferredRender
  }

  protected flushDeferredRenderChunk(): void {
    const mountedDom = this.mountedDom
    const deferredRender = mountedDom?.deferredRender

    if (mountedDom === undefined || deferredRender === undefined) {
      return
    }

    const pass = this.runLayoutPass({
      dirtyPageIndex: deferredRender.continuation.dirtyPageIndex,
      dirtyPageEndIndex: deferredRender.continuation.dirtyPageEndIndex,
      startPosition: deferredRender.continuation.startPosition,
      maxPages: deferredRender.chunkSize
    })
    const layout = pass.layout
    const schedule = createLayoutSchedule({
      pageCount: Math.max(layout.pages.length, (pass.continuation?.dirtyPageIndex ?? -1) + 1),
      dirtyPageIndex: deferredRender.continuation.dirtyPageIndex,
      immediatePageIndexes: pass.laidOutPageIndexes,
      ...(pass.continuation?.dirtyPageIndex === undefined
        ? {}
        : { deferredStartPageIndex: pass.continuation.dirtyPageIndex }),
      ...(pass.continuation === undefined && pass.stoppedAtPageIndex !== undefined
        ? { stoppedAtPageIndexHint: pass.stoppedAtPageIndex }
        : {}),
      chunkSize: deferredRender.chunkSize
    })

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
    const retainedPageIndexes = mergePageIndexes(
      viewport.retainedPageIndexes,
      pass.laidOutPageIndexes,
      selectionRender.pageIndexes,
      this.selectionPageIndexes
    )
    const rerenderPageIndexes = mergePageIndexes(
      pass.laidOutPageIndexes,
      selectionRender.pageIndexes,
      this.selectionPageIndexes
    )

    mountedDom.canvases = renderPageBatch({
      mountedDom,
      pages: layout.pages,
      retainedPageIndexes,
      rerenderPageIndexes,
      selectionRender,
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
    this.selectionPageIndexes = selectionRender.pageIndexes
    this.pageStartKeys = createPageStartKeys(layout)
    this.scheduleDeferredTextMirrorSync(selectionRender.caretRect)

    if (pass.continuation === undefined) {
      mountedDom.deferredRender = undefined
      return
    }

    mountedDom.deferredRender = {
      timeoutId: setTimeout(() => {
        this.flushDeferredRenderChunk()
      }, 0),
      chunkSize: deferredRender.chunkSize,
      continuation: pass.continuation
    }
  }

  protected cancelDeferredRender(): void {
    const deferredRender = this.mountedDom?.deferredRender

    if (deferredRender === undefined) {
      return
    }

    clearTimeout(deferredRender.timeoutId)
    this.mountedDom!.deferredRender = undefined
  }
}
