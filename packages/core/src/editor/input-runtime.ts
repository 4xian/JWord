/**
 * 职责：处理隐藏输入框、输入法、快捷键、剪贴板和纯文本编辑命令构造。
 * 边界：不直接访问画布绘制细节，不修改布局引擎。
 * 协作模块：挂载运行时、选择区、事务操作和文本运行时辅助函数。
 * 性能/安全约束：构造函数和顶层代码不访问浏览器对象，DOM 只在挂载后创建，编辑命令统一进入事务流水线。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import type { AnchorRef } from '../model/position'
import { createSelectionState, isSelectionCollapsed } from '../model/selection'
import type { SelectionState } from '../model/selection'
import { JWordError } from '../shared/errors'
import type { JWordErrorCode, JWordErrorDetails } from '../shared/errors'
import {
  POINTER_AUTO_SCROLL_EDGE_PX,
  POINTER_AUTO_SCROLL_INTERVAL_MS,
  POINTER_AUTO_SCROLL_MAX_STEP_PX,
  POINTER_MULTI_CLICK_GRACE_MS
} from './constants'
import { focusHiddenTextarea } from './dom'
import { JWordEditorKeyboardTextRuntime } from './keyboard-text-runtime'
import { normalizePlainText, readClipboardData, readEventData, readInputType, isCompositionKeyboardEvent } from './text-runtime'
import type { PointerPageMetrics } from './types'

export abstract class JWordEditorInputRuntime extends JWordEditorKeyboardTextRuntime {
  protected handleRuntimeInput(event: Event): void {
    const textarea = event.currentTarget
    const mountedDom = this.mountedDom

    if (!(textarea instanceof HTMLTextAreaElement)) {
      return
    }

    if (mountedDom?.inputState.isComposing) {
      const composingText = readEventData(event) || textarea.value

      if (composingText.length > 0) {
        mountedDom.inputState.compositionText = composingText
      }

      return
    }

    const text = textarea.value || readEventData(event)

    textarea.value = ''

    if (text.length === 0) {
      return
    }

    if (mountedDom !== undefined && mountedDom.inputState.pendingPlainInputText.length > 0) {
      const pendingText = mountedDom.inputState.pendingPlainInputText

      mountedDom.inputState.pendingPlainInputText = ''

      if (text === pendingText) {
        return
      }
    }

    this.runProtectedInputHandler('insertText', () => {
      this.insertPlainTextFromRuntime(text)
    })

    // 小文档保持同步镜像；大文档把全文串联让出 input 热路径。
    this.syncMountedTextMirrorAfterInput()
  }

  protected handleRuntimeCompositionStart(event: Event): void {
    const mountedDom = this.mountedDom

    if (mountedDom === undefined) {
      return
    }

    mountedDom.inputState.pendingPlainInputText = ''
    mountedDom.inputState.isComposing = true
    mountedDom.inputState.compositionText = readEventData(event) || mountedDom.hiddenTextarea.value
  }

  protected handleRuntimeCompositionUpdate(event: Event): void {
    const mountedDom = this.mountedDom

    if (mountedDom === undefined) {
      return
    }

    const compositionText = readEventData(event) || mountedDom.hiddenTextarea.value

    if (compositionText.length > 0) {
      mountedDom.inputState.compositionText = compositionText
    }
  }

  protected handleRuntimeCompositionEnd(event: Event): void {
    const mountedDom = this.mountedDom

    if (mountedDom === undefined) {
      return
    }

    const text = readEventData(event) || mountedDom.inputState.compositionText || mountedDom.hiddenTextarea.value

    mountedDom.inputState.isComposing = false
    mountedDom.inputState.compositionText = ''
    mountedDom.inputState.pendingPlainInputText = text
    mountedDom.hiddenTextarea.value = ''

    if (text.length === 0) {
      mountedDom.inputState.pendingPlainInputText = ''
      return
    }

    this.runProtectedInputHandler('insertText', () => {
      this.insertPlainTextFromRuntime(text)
    })

    // 小文档保持同步镜像；大文档把全文串联让出 composition 热路径。
    this.syncMountedTextMirrorAfterInput()
  }

  /**
   * 处理浏览器直接通过 beforeinput 发出的换行输入。
   */
  protected handleRuntimeBeforeInput(event: Event): void {
    const mountedDom = this.mountedDom

    if (mountedDom?.inputState.isComposing) {
      return
    }

    const inputType = readInputType(event)

    if (inputType !== 'insertParagraph' && inputType !== 'insertLineBreak') {
      return
    }

    event.preventDefault()
    this.runProtectedInputHandler('splitParagraph', () => {
      this.splitParagraphFromRuntime()
    })
    this.syncMountedTextMirrorAfterInput()
  }

  protected handleRuntimeKeyDown(event: KeyboardEvent): void {
    const mountedDom = this.mountedDom

    if (mountedDom !== undefined) {
      if (mountedDom.inputState.isComposing || isCompositionKeyboardEvent(event)) {
        return
      }

      mountedDom.inputState.pendingPlainInputText = ''
    }

    const lowerKey = event.key.toLowerCase()
    const usesCommandModifier = event.metaKey || event.ctrlKey

    if (usesCommandModifier && lowerKey === 'z') {
      event.preventDefault()
      this.runProtectedInputHandler(event.shiftKey ? 'redo' : 'undo', () => {
        if (event.shiftKey) {
          this.redo()
          return
        }

        this.undo()
      })
      return
    }

    if (usesCommandModifier && lowerKey === 'y') {
      event.preventDefault()
      this.runProtectedInputHandler('redo', () => {
        this.redo()
      })
      return
    }

    if (usesCommandModifier && lowerKey === 'a') {
      event.preventDefault()
      this.runProtectedInputHandler('selectAll', () => {
        this.selectAllTextFromRuntime()
      })
      return
    }

    if (usesCommandModifier && lowerKey === 'b') {
      event.preventDefault()
      this.runProtectedInputHandler('setBold', () => {
        this.toggleRuntimeBold()
      })
      return
    }

    if (usesCommandModifier && lowerKey === 'i') {
      event.preventDefault()
      this.runProtectedInputHandler('setItalic', () => {
        this.toggleRuntimeItalic()
      })
      return
    }

    switch (event.key) {
      case 'Backspace':
        event.preventDefault()
        this.runProtectedInputHandler('deleteBackward', () => {
          this.deleteBackwardFromRuntime(isWordModifierKey(event))
        })
        return
      case 'Delete':
        event.preventDefault()
        this.runProtectedInputHandler('deleteForward', () => {
          this.deleteForwardFromRuntime(isWordModifierKey(event))
        })
        return
      case 'Enter':
        event.preventDefault()
        this.runProtectedInputHandler('splitParagraph', () => {
          this.splitParagraphFromRuntime()
        })
        return
      case 'ArrowLeft':
        event.preventDefault()
        this.runProtectedInputHandler('moveSelection', () => {
          this.moveSelectionHorizontally(-1, event.shiftKey, isWordModifierKey(event))
        })
        return
      case 'ArrowRight':
        event.preventDefault()
        this.runProtectedInputHandler('moveSelection', () => {
          this.moveSelectionHorizontally(1, event.shiftKey, isWordModifierKey(event))
        })
        return
      case 'ArrowUp':
        event.preventDefault()
        this.runProtectedInputHandler('moveSelection', () => {
          this.moveSelectionVertically(-1, event.shiftKey)
        })
        return
      case 'ArrowDown':
        event.preventDefault()
        this.runProtectedInputHandler('moveSelection', () => {
          this.moveSelectionVertically(1, event.shiftKey)
        })
        return
      case 'Home':
        event.preventDefault()
        this.runProtectedInputHandler('moveSelection', () => {
          this.moveSelectionToLineBoundary('start', event.shiftKey)
        })
        return
      case 'End':
        event.preventDefault()
        this.runProtectedInputHandler('moveSelection', () => {
          this.moveSelectionToLineBoundary('end', event.shiftKey)
        })
        return
      case 'PageUp':
        event.preventDefault()
        this.runProtectedInputHandler('moveSelection', () => {
          this.moveSelectionByPage(-1, event.shiftKey)
        })
        return
      case 'PageDown':
        event.preventDefault()
        this.runProtectedInputHandler('moveSelection', () => {
          this.moveSelectionByPage(1, event.shiftKey)
        })
        return
      case 'Tab':
        event.preventDefault()
        this.runProtectedInputHandler('tab', () => {
          this.handleTabFromRuntime(event.shiftKey)
        })
        return
    }

    const pluginKeyBindingResult = this.pluginHost.handleKeyBinding({
      rawKey: event.key,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      projection: this.currentProjection,
      selection: this.currentSelection,
      mounted: this.mountedDom !== undefined
    })

    if (pluginKeyBindingResult.handled) {
      if (pluginKeyBindingResult.preventDefault) {
        event.preventDefault()
      }
      return
    }
  }

  protected handleRuntimeCopy(event: Event): void {
    const clipboardData = readClipboardData(event)
    const text = this.readSelectionPlainText()

    if (clipboardData === undefined || text.length === 0) {
      return
    }

    event.preventDefault()
    clipboardData.setData('text/plain', text)
    clipboardData.setData('text/html', this.readSelectionHtml())
  }

  protected handleRuntimeCut(event: Event): void {
    const clipboardData = readClipboardData(event)
    const text = this.readSelectionPlainText()

    if (clipboardData === undefined || text.length === 0) {
      return
    }

    event.preventDefault()
    clipboardData.setData('text/plain', text)
    clipboardData.setData('text/html', this.readSelectionHtml())
    this.runProtectedInputHandler('deleteSelection', () => {
      this.deleteSelectedTextFromRuntime()
    })
  }

  protected handleRuntimePaste(event: Event): void {
    const clipboardData = readClipboardData(event)

    if (clipboardData === undefined) {
      return
    }

    const text = clipboardData.getData('text/plain')

    if (text.length === 0) {
      return
    }

    event.preventDefault()
    this.runProtectedInputHandler('insertText', () => {
      this.insertPlainTextFromRuntime(text)
    })
  }

  protected handleRuntimePointerDown(event: MouseEvent): void {
    if (event.button !== 0) {
      return
    }

    const pageMetrics = this.resolvePointerPageMetrics(event)
    const anchor = pageMetrics === undefined ? undefined : this.resolvePointerAnchor(event, pageMetrics)
    const mountedDom = this.mountedDom

    if (anchor === undefined || mountedDom === undefined) {
      return
    }

    this.cancelDeferredPointerSelectionWork()
    event.preventDefault()

    if (event.detail >= 3) {
      mountedDom.pointerState.anchor = null
      mountedDom.pointerState.pageMetrics = null
      mountedDom.pointerState.paintedPageIndexes = this.selectionPageIndexes
      focusHiddenTextarea(mountedDom)
      this.commitSelection(this.expandParagraphSelection(anchor), {
        source: 'pointer',
        render: false,
        emit: false
      })
      this.finalizeMountedPointerSelection()
      return
    }

    mountedDom.pointerState.anchor = anchor
    mountedDom.pointerState.pageMetrics = pageMetrics ?? null
    mountedDom.pointerState.paintedPageIndexes = this.selectionPageIndexes
    focusHiddenTextarea(mountedDom)
    this.commitSelection(createSelectionState(anchor, anchor), {
      source: 'pointer',
      render: false,
      emit: false
    })
  }

  protected handleRuntimePointerMove(event: MouseEvent): void {
    const mountedDom = this.mountedDom

    if (mountedDom === undefined || mountedDom.pointerState.anchor === null) {
      return
    }

    this.updatePointerAutoScroll(event)

    const pageMetrics = this.resolvePointerPageMetrics(event, mountedDom.pointerState.pageMetrics ?? undefined)
    const focus = pageMetrics === undefined ? undefined : this.resolvePointerAnchor(event, pageMetrics)

    if (focus === undefined) {
      return
    }

    mountedDom.pointerState.pageMetrics = pageMetrics ?? null
    event.preventDefault()
    this.commitSelection(createSelectionState(mountedDom.pointerState.anchor, focus), {
      source: 'pointer',
      render: false,
      emit: false
    })
    this.renderMountedPointerSelection()
  }

  protected handleRuntimePointerUp(event: MouseEvent): void {
    const mountedDom = this.mountedDom

    if (mountedDom === undefined || mountedDom.pointerState.anchor === null) {
      return
    }

    const pageMetrics = this.resolvePointerPageMetrics(event, mountedDom.pointerState.pageMetrics ?? undefined)
    const focus = pageMetrics === undefined ? undefined : this.resolvePointerAnchor(event, pageMetrics)

    this.cancelDeferredPointerSelectionWork()

    if (focus !== undefined) {
      mountedDom.pointerState.pageMetrics = pageMetrics ?? null
      event.preventDefault()
      const selection = createSelectionState(mountedDom.pointerState.anchor, focus)

      this.commitSelection(selection, {
        source: 'pointer',
        render: false,
        emit: false
      })
      if (isSelectionCollapsed(selection)) {
        this.scheduleDeferredPointerSelectionRender(POINTER_MULTI_CLICK_GRACE_MS)
        this.scheduleDeferredPointerSelectionFinalize(POINTER_MULTI_CLICK_GRACE_MS)
      } else {
        this.finalizeMountedPointerSelection()
      }
    }

    mountedDom.pointerState.anchor = null
    mountedDom.pointerState.pageMetrics = null
  }

  protected handleRuntimeDoubleClick(event: MouseEvent): void {
    const pageMetrics = this.resolvePointerPageMetrics(event)
    const anchor = pageMetrics === undefined ? undefined : this.resolvePointerAnchor(event, pageMetrics)

    if (anchor === undefined) {
      return
    }

    this.cancelDeferredPointerSelectionWork()
    event.preventDefault()
    this.commitSelection(this.expandWordSelection(anchor, event, pageMetrics), {
      source: 'pointer',
      render: false,
      emit: false
    })
    this.scheduleDeferredPointerSelectionFinalize()
  }

  /**
   * 执行输入处理动作，并把异常转为宿主可观测的可恢复错误事件。
   */
  protected runProtectedInputHandler(commandName: string, action: () => void): void {
    const mountedDom = this.mountedDom

    try {
      action()

      if (mountedDom !== undefined) {
        mountedDom.liveRegion.textContent = ''
        mountedDom.hiddenTextarea.value = ''
      }
    } catch (error) {
      if (mountedDom !== undefined) {
        mountedDom.liveRegion.textContent = '输入失败'
        mountedDom.hiddenTextarea.value = ''
      }

      const payload = normalizeInputRuntimeError(error)

      this.emit({
        kind: 'error',
        commandName,
        recoverable: true,
        ...payload
      })
      logDevelopmentInputError(commandName, error)
    }
  }

  protected abstract resolvePointerPageMetrics(event: MouseEvent, cachedPageMetrics?: PointerPageMetrics): PointerPageMetrics | undefined
  protected abstract resolvePointerAnchor(event: MouseEvent, pageMetrics: PointerPageMetrics): AnchorRef | undefined
  protected abstract expandParagraphSelection(anchor: AnchorRef): SelectionState
  protected abstract expandWordSelection(
    anchor: AnchorRef,
    event?: MouseEvent,
    pageMetrics?: PointerPageMetrics
  ): SelectionState

  /** 根据拖拽指针与视口边缘距离启动或停止自动滚动。 */
  private updatePointerAutoScroll(event: MouseEvent): void {
    const mountedDom = this.mountedDom

    if (mountedDom === undefined) {
      return
    }

    const rect = mountedDom.canvasContainer.getBoundingClientRect()
    const distanceToTop = event.clientY - rect.top
    const distanceToBottom = rect.bottom - event.clientY
    const direction = distanceToTop < POINTER_AUTO_SCROLL_EDGE_PX
      ? -1
      : distanceToBottom < POINTER_AUTO_SCROLL_EDGE_PX
        ? 1
        : 0

    if (direction === 0) {
      this.cancelPointerAutoScroll()
      return
    }

    const edgeDistance = direction < 0 ? distanceToTop : distanceToBottom
    const edgeRatio = (POINTER_AUTO_SCROLL_EDGE_PX - Math.max(0, edgeDistance)) / POINTER_AUTO_SCROLL_EDGE_PX

    mountedDom.pointerState.autoScrollDeltaY = direction * Math.max(
      1,
      Math.ceil(edgeRatio * POINTER_AUTO_SCROLL_MAX_STEP_PX)
    )
    this.ensurePointerAutoScroll()
  }

  /** 保持拖拽自动滚动定时器唯一，并同步触发视口刷新。 */
  private ensurePointerAutoScroll(): void {
    if (this.deferredPointerAutoScrollId !== undefined) {
      return
    }

    this.deferredPointerAutoScrollId = setInterval(() => {
      const mountedDom = this.mountedDom

      if (mountedDom === undefined || mountedDom.pointerState.anchor === null) {
        this.cancelPointerAutoScroll()
        return
      }

      const previousScrollTop = mountedDom.canvasContainer.scrollTop

      mountedDom.canvasContainer.scrollTop = previousScrollTop + mountedDom.pointerState.autoScrollDeltaY

      if (mountedDom.canvasContainer.scrollTop !== previousScrollTop) {
        mountedDom.handleScroll()
      }
    }, POINTER_AUTO_SCROLL_INTERVAL_MS)
  }

  /** 停止拖拽自动滚动并重置本次拖拽步进。 */
  private cancelPointerAutoScroll(): void {
    if (this.deferredPointerAutoScrollId !== undefined) {
      clearInterval(this.deferredPointerAutoScrollId)
      this.deferredPointerAutoScrollId = undefined
    }

    if (this.mountedDom !== undefined) {
      this.mountedDom.pointerState.autoScrollDeltaY = 0
    }
  }
}

interface InputRuntimeErrorPayload {
  readonly code: JWordErrorCode
  readonly message: string
  readonly details?: JWordErrorDetails
}

/** 将未知异常收敛为稳定的输入错误事件 payload。 */
function normalizeInputRuntimeError(error: unknown): InputRuntimeErrorPayload {
  if (error instanceof JWordError) {
    return {
      code: error.code,
      message: error.message,
      ...(error.details === undefined ? {} : { details: error.details })
    }
  }

  if (error instanceof Error) {
    return {
      code: 'EDITOR_INPUT_HANDLER_FAILED',
      message: error.message
    }
  }

  return {
    code: 'EDITOR_INPUT_HANDLER_FAILED',
    message: '输入处理异常'
  }
}

/** 仅在开发模式下把输入异常同步输出到控制台，便于定位宿主集成问题。 */
function logDevelopmentInputError(commandName: string, error: unknown): void {
  const runtime = globalThis as typeof globalThis & {
    readonly process?: {
      readonly env?: {
        readonly NODE_ENV?: string
      }
    }
  }

  if (runtime.process?.env?.NODE_ENV !== 'development') {
    return
  }

  console.error(`[JWord] 输入处理失败：${commandName}`, error)
}

/** 判断平台逐词移动/删除修饰键。 */
function isWordModifierKey(event: KeyboardEvent): boolean {
  return event.ctrlKey || event.altKey
}
