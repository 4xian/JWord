/**
 * 职责：承载 Editor facade 的 focus、mount、destroy DOM 外观生命周期。
 * 边界：不生成编辑 command，不处理布局算法，不暴露 Y.Doc 或 store。
 * 协作模块：facade-runtime 提供文档和选择区状态，mounted/input/pointer runtime 提供具体事件处理。
 * 性能/安全约束：顶层不访问 DOM；只有 mount 传入宿主元素后才创建浏览器对象。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/04-engineering-standards.md#45-模块边界。
 */

import { createCanvasPool } from '../canvas/pool'
import { createCanvasTextMeasurer, createFontManager, type CanvasTextMeasurerContext } from '../layout/font-manager'
import { createMountedCanvasImageResourceResolver } from '../resources/canvas-image-resolver'
import { createJWordError } from '../shared/errors'
import { createSelectionState } from '../model/selection'
import { twipsToCssPx } from '../layout/page-config'
import { createCanvasElement } from './rendering'
import { createHiddenTextareaElement, createLiveRegionElement, createTextMirrorElement, focusHiddenTextarea } from './dom'
import { JWordEditorLocationRuntime } from './location-runtime'
import type { EditorLocationTarget, EditorScrollToLocationOptions } from './location-types'

const BROWSER_MEASURABLE_FONT_FAMILIES = Object.freeze([
  'Arial',
  'Helvetica',
  'Helvetica Neue',
  'Times New Roman',
  'Courier New',
  'SimSun',
  'KaiTi',
  'Microsoft YaHei',
  'PingFang SC',
  'serif',
  'sans-serif',
  'monospace'
])

export abstract class JWordEditorMountFacadeRuntime extends JWordEditorLocationRuntime {
  /** 聚焦已挂载编辑器输入层。 */
  focus(): void {
    this.assertActive()

    const mountedDom = this.mountedDom

    if (mountedDom === undefined) {
      return
    }

    focusHiddenTextarea(mountedDom)
    this.updateInputFocusState(true)

    if (this.currentSelection !== null) {
      return
    }

    const anchor = this.initialFocusPosition === 'start'
      ? this.resolveInitialStartFocusAnchor()
      : this.resolveInitialEndFocusAnchor()

    if (anchor === undefined) {
      return
    }

    this.commitSelection(createSelectionState(anchor, anchor), {
      source: 'api'
    })
  }

  /** 让已挂载编辑器输入层失焦。 */
  blur(): void {
    this.assertActive()

    const mountedDom = this.mountedDom

    if (mountedDom === undefined) {
      return
    }

    mountedDom.hiddenTextarea.blur()
    this.updateInputFocusState(false)
  }

  /** 滚动已挂载编辑器到公开 location，不改写当前选择区。 */
  scrollToLocation(input: EditorLocationTarget, options: EditorScrollToLocationOptions = {}): boolean {
    this.assertActive()

    const mountedDom = this.mountedDom
    const resolved = this.resolveLocation(input)

    if (mountedDom === undefined || resolved === null) {
      return false
    }

    const range = createSelectionState(
      this.createTextAnchor(resolved.range.anchor),
      this.createTextAnchor(resolved.range.focus)
    ).range
    const rect = this.getSelectionRects(range)[0] ?? this.getCaretRect(range.anchor)

    if (rect === undefined) {
      return false
    }

    const layout = this.getLayout()
    const page = layout.pages[rect.pageIndex]

    if (page === undefined) {
      return false
    }

    const pageElement = mountedDom.canvasContainer.querySelector<HTMLElement>(`[data-jword-page="${page.pageIndex}"]`)
    const pageTop = twipsToCssPx(rect.y - page.y, this.getPageConfig().scale)
    const scrollTop = pageElement === null
      ? twipsToCssPx(rect.y, this.getPageConfig().scale)
      : pageElement.offsetTop + pageTop
    const targetTop = Math.max(0, scrollTop - Math.round(mountedDom.canvasContainer.clientHeight * 0.32))

    if (typeof mountedDom.canvasContainer.scrollTo === 'function') {
      mountedDom.canvasContainer.scrollTo({
        top: targetTop,
        behavior: options.behavior ?? 'auto'
      })
    } else {
      mountedDom.canvasContainer.scrollTop = targetTop
    }

    return true
  }

  /** 挂载编辑器 DOM，并登记输入、剪贴板和指针事件。 */
  mount(host: HTMLElement): void {
    this.assertActive()

    if (this.mountedDom !== undefined) {
      throw createJWordError('EDITOR_ALREADY_MOUNTED', 'JWord editor is already mounted.')
    }

    const ownerDocument = host.ownerDocument
    const canvasTextMeasurerContext = createRuntimeCanvasTextMeasurerContext(ownerDocument)

    if (canvasTextMeasurerContext !== null) {
      this.fontManager = createFontManager({
        availableFontFamilies: BROWSER_MEASURABLE_FONT_FAMILIES,
        textMeasurer: createCanvasTextMeasurer(canvasTextMeasurerContext)
      })
      this.layoutNeedsRefresh = true
      this.cachedLayout = undefined
      this.pendingLayoutContinuation = undefined
    }

    const eventAbortController = new (ownerDocument.defaultView?.AbortController ?? AbortController)()
    const eventListenerOptions = { signal: eventAbortController.signal }
    const shell = ownerDocument.createElement('div')
    shell.className = 'jw-editor'
    shell.setAttribute('data-jword-editor', '')
    shell.setAttribute('role', 'application')
    shell.setAttribute('aria-label', this.label)

    const canvasContainer = ownerDocument.createElement('div')
    canvasContainer.className = 'jw-editor__canvas-container'
    canvasContainer.setAttribute('data-jword-canvas-container', '')
    const hiddenTextarea = createHiddenTextareaElement(ownerDocument)
    const liveRegion = createLiveRegionElement(ownerDocument)
    const textMirror = createTextMirrorElement(ownerDocument)
    shell.style.width = '100%'
    shell.style.height = '100%'
    shell.style.position = 'relative'
    canvasContainer.style.width = '100%'
    canvasContainer.style.height = '100%'
    canvasContainer.style.overflow = 'auto'
    canvasContainer.style.position = 'relative'
    canvasContainer.style.cursor = 'text'

    const handleScroll = () => {
      this.renderMountedLayout('viewport')
    }
    const handleInput = (event: Event) => {
      this.handleRuntimeInput(event)
    }
    const handleBeforeInput = (event: Event) => {
      this.handleRuntimeBeforeInput(event)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      this.handleRuntimeKeyDown(event)
    }
    const handleCopy = (event: Event) => {
      this.handleRuntimeCopy(event)
    }
    const handleCut = (event: Event) => {
      this.handleRuntimeCut(event)
    }
    const handlePaste = (event: Event) => {
      this.handleRuntimePaste(event)
    }
    const handlePointerDown = (event: MouseEvent) => {
      this.handleRuntimePointerDown(event)
    }
    const handlePointerMove = (event: MouseEvent) => {
      this.handleRuntimePointerMove(event)
    }
    const handlePointerUp = (event: MouseEvent) => {
      this.handleRuntimePointerUp(event)
    }
    const handleDoubleClick = (event: MouseEvent) => {
      this.handleRuntimeDoubleClick(event)
    }
    const handleCompositionStart = (event: Event) => {
      this.handleRuntimeCompositionStart(event)
    }
    const handleCompositionUpdate = (event: Event) => {
      this.handleRuntimeCompositionUpdate(event)
    }
    const handleCompositionEnd = (event: Event) => {
      this.handleRuntimeCompositionEnd(event)
    }
    const handleFocus = () => {
      this.updateInputFocusState(true)
    }
    const handleBlur = () => {
      this.updateInputFocusState(false)
    }

    canvasContainer.addEventListener('scroll', handleScroll, eventListenerOptions)
    canvasContainer.addEventListener('mousedown', handlePointerDown, eventListenerOptions)
    canvasContainer.addEventListener('mousemove', handlePointerMove, eventListenerOptions)
    ownerDocument.addEventListener('mouseup', handlePointerUp, eventListenerOptions)
    canvasContainer.addEventListener('dblclick', handleDoubleClick, eventListenerOptions)
    hiddenTextarea.addEventListener('beforeinput', handleBeforeInput, eventListenerOptions)
    hiddenTextarea.addEventListener('input', handleInput, eventListenerOptions)
    hiddenTextarea.addEventListener('keydown', handleKeyDown, eventListenerOptions)
    hiddenTextarea.addEventListener('copy', handleCopy, eventListenerOptions)
    hiddenTextarea.addEventListener('cut', handleCut, eventListenerOptions)
    hiddenTextarea.addEventListener('paste', handlePaste, eventListenerOptions)
    hiddenTextarea.addEventListener('compositionstart', handleCompositionStart, eventListenerOptions)
    hiddenTextarea.addEventListener('compositionupdate', handleCompositionUpdate, eventListenerOptions)
    hiddenTextarea.addEventListener('compositionend', handleCompositionEnd, eventListenerOptions)
    hiddenTextarea.addEventListener('focus', handleFocus, eventListenerOptions)
    hiddenTextarea.addEventListener('blur', handleBlur, eventListenerOptions)
    shell.append(canvasContainer, hiddenTextarea, liveRegion, textMirror)
    host.append(shell)

    this.mountedDom = {
      shell,
      canvasContainer,
      hiddenTextarea,
      liveRegion,
      textMirror,
      eventAbortController,
      handleScroll,
      handleInput,
      handleBeforeInput,
      handleKeyDown,
      handleCopy,
      handleCut,
      handlePaste,
      handlePointerDown,
      handlePointerMove,
      handlePointerUp,
      handleDoubleClick,
      handleCompositionStart,
      handleCompositionUpdate,
      handleCompositionEnd,
      handleFocus,
      handleBlur,
      pool: createCanvasPool({
        createCanvas: () => createCanvasElement(ownerDocument)
      }),
      pageWrappers: new Map(),
      baseCanvases: new Map(),
      imageResourceResolver: createMountedCanvasImageResourceResolver({
        ownerDocument,
        onInvalidate: () => {
          if (this.isDestroyed || this.mountedDom === undefined) {
            return
          }

          this.renderMountedLayout('resource')
        }
      }),
      commentPageIndexes: [],
      inputState: {
        isComposing: false,
        compositionText: '',
        pendingPlainInputText: ''
      },
      pointerState: {
        anchor: null,
        pageMetrics: null,
        paintedPageIndexes: [],
        autoScrollDeltaY: 0
      },
      canvases: new Map(),
      deferredRender: undefined,
      deferredTextMirrorSyncId: undefined
    }
    this.renderMountedLayout('mount')
  }

  /** 销毁已挂载 DOM、历史状态和事件监听。 */
  destroy(): void {
    if (this.isDestroyed) {
      return
    }

    if (this.mountedDom !== undefined) {
      this.cancelDeferredDocumentRender()
      this.cancelDeferredRender()
      this.cancelDeferredPointerSelectionWork()
      this.cancelDeferredTextMirrorSync()
      this.stopCaretBlink()
      this.mountedDom.eventAbortController.abort()
      this.mountedDom.imageResourceResolver?.dispose()

      for (const canvas of this.mountedDom.canvases.values()) {
        this.mountedDom.pool.release(canvas)
      }

      this.mountedDom.pool.dispose()
      this.mountedDom.shell.remove()
    }

    this.mountedDom = undefined
    this.history.clear()
    this.unsubscribePipeline()
    this.emit({ kind: 'destroyed' })
    this.listeners.clear()
    this.isDestroyed = true
  }

  protected abstract handleRuntimeInput(event: Event): void
  protected abstract handleRuntimeBeforeInput(event: Event): void
  protected abstract handleRuntimeCompositionStart(event: Event): void
  protected abstract handleRuntimeCompositionUpdate(event: Event): void
  protected abstract handleRuntimeCompositionEnd(event: Event): void
  protected abstract handleRuntimeKeyDown(event: KeyboardEvent): void
  protected abstract handleRuntimeCopy(event: Event): void
  protected abstract handleRuntimeCut(event: Event): void
  protected abstract handleRuntimePaste(event: Event): void
  protected abstract handleRuntimePointerDown(event: MouseEvent): void
  protected abstract handleRuntimePointerMove(event: MouseEvent): void
  protected abstract handleRuntimePointerUp(event: MouseEvent): void
  protected abstract handleRuntimeDoubleClick(event: MouseEvent): void
  protected abstract cancelDeferredRender(): void
  protected abstract cancelDeferredTextMirrorSync(): void
  protected abstract stopCaretBlink(): void
}

/** 创建 mount 期专用的 canvas 文本度量上下文。 */
function createRuntimeCanvasTextMeasurerContext(ownerDocument: Document): CanvasTextMeasurerContext | null {
  const canvas = ownerDocument.createElement('canvas')
  const context = canvas.getContext('2d')

  if (context === null || typeof context.measureText !== 'function') {
    return null
  }

  return context
}
