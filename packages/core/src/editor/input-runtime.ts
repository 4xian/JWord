/**
 * 职责：处理隐藏输入框、输入法、快捷键、剪贴板和纯文本编辑命令构造。
 * 边界：不直接访问画布绘制细节，不修改布局引擎。
 * 协作模块：挂载运行时、选择区、事务操作和文本运行时辅助函数。
 * 性能/安全约束：构造函数和顶层代码不访问浏览器对象，DOM 只在挂载后创建，编辑命令统一进入事务流水线。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/03-architecture.md 与 04-engineering-standards.md#45-模块边界。
 */
import type { AnchorRef } from '../model/position'
import { createSelectionState, isSelectionCollapsed } from '../model/selection'
import type { SelectionState } from '../model/selection'
import { POINTER_MULTI_CLICK_GRACE_MS } from './constants'
import { focusHiddenTextarea } from './dom'
import { JWordEditorTextEditingRuntime } from './text-editing-runtime'
import { normalizePlainText, readClipboardData, readEventData, readInputType, isCompositionKeyboardEvent } from './text-runtime'
import type { PointerPageMetrics } from './types'

export abstract class JWordEditorInputRuntime extends JWordEditorTextEditingRuntime {
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

    this.runProtectedInputHandler(() => {
      this.insertPlainTextFromRuntime(text)
    })

    // 输入法提交后，同一任务内读取纯文本镜像的测试和无障碍消费方需要立即看到结果。
    this.cancelDeferredTextMirrorSync()
    this.syncMountedTextMirror()
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

    this.runProtectedInputHandler(() => {
      this.insertPlainTextFromRuntime(text)
    })

    // 输入法结束事件后，调用方会同步读取纯文本镜像。
    this.cancelDeferredTextMirrorSync()
    this.syncMountedTextMirror()
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
    this.runProtectedInputHandler(() => {
      this.splitParagraphFromRuntime()
    })
    this.cancelDeferredTextMirrorSync()
    this.syncMountedTextMirror()
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
      this.runProtectedInputHandler(() => {
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
      this.runProtectedInputHandler(() => {
        this.redo()
      })
      return
    }

    if (usesCommandModifier && lowerKey === 'a') {
      event.preventDefault()
      this.runProtectedInputHandler(() => {
        this.selectAllTextFromRuntime()
      })
      return
    }

    if (usesCommandModifier && lowerKey === 'b') {
      event.preventDefault()
      this.runProtectedInputHandler(() => {
        this.toggleRuntimeBold()
      })
      return
    }

    if (usesCommandModifier && lowerKey === 'i') {
      event.preventDefault()
      this.runProtectedInputHandler(() => {
        this.toggleRuntimeItalic()
      })
      return
    }

    switch (event.key) {
      case 'Backspace':
        event.preventDefault()
        this.runProtectedInputHandler(() => {
          this.deleteBackwardFromRuntime()
        })
        return
      case 'Delete':
        event.preventDefault()
        this.runProtectedInputHandler(() => {
          this.deleteForwardFromRuntime()
        })
        return
      case 'Enter':
        event.preventDefault()
        this.runProtectedInputHandler(() => {
          this.splitParagraphFromRuntime()
        })
        return
      case 'ArrowLeft':
        event.preventDefault()
        this.runProtectedInputHandler(() => {
          this.moveSelectionHorizontally(-1)
        })
        return
      case 'ArrowRight':
        event.preventDefault()
        this.runProtectedInputHandler(() => {
          this.moveSelectionHorizontally(1)
        })
        return
      case 'ArrowUp':
        event.preventDefault()
        this.runProtectedInputHandler(() => {
          this.moveSelectionVertically(-1)
        })
        return
      case 'ArrowDown':
        event.preventDefault()
        this.runProtectedInputHandler(() => {
          this.moveSelectionVertically(1)
        })
        return
      case 'Home':
        event.preventDefault()
        this.runProtectedInputHandler(() => {
          this.moveSelectionToLineBoundary('start')
        })
        return
      case 'End':
        event.preventDefault()
        this.runProtectedInputHandler(() => {
          this.moveSelectionToLineBoundary('end')
        })
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
    this.runProtectedInputHandler(() => {
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
    this.runProtectedInputHandler(() => {
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
        this.scheduleDeferredPointerSelectionFinalize()
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

  protected runProtectedInputHandler(action: () => void): void {
    const mountedDom = this.mountedDom

    try {
      action()

      if (mountedDom !== undefined) {
        mountedDom.liveRegion.textContent = ''
        mountedDom.hiddenTextarea.value = ''
      }
    } catch {
      if (mountedDom !== undefined) {
        mountedDom.liveRegion.textContent = '输入失败'
        mountedDom.hiddenTextarea.value = ''
      }
    }
  }

  protected abstract resolvePointerPageMetrics(event: MouseEvent, cachedPageMetrics?: PointerPageMetrics): PointerPageMetrics | undefined
  protected abstract resolvePointerAnchor(event: MouseEvent, pageMetrics: PointerPageMetrics): AnchorRef | undefined
  protected abstract expandWordSelection(
    anchor: AnchorRef,
    event?: MouseEvent,
    pageMetrics?: PointerPageMetrics
  ): SelectionState
}
