/**
 * 职责：实现 Editor facade 的公开方法和文档/选择区提交编排。
 * 边界：不处理 DOM 事件细节，不直接绘制 canvas。
 * 协作模块：状态层、文档辅助函数、格式命令、历史记录、选择区和布局/渲染子类。
 * 性能/安全约束：构造函数和顶层代码不访问浏览器对象，DOM 只在挂载后创建，编辑命令统一进入事务流水线。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/03-architecture.md 与 04-engineering-standards.md#45-模块边界。
 */
import {
  buildSetBackgroundColorCommand,
  buildSetBoldCommand,
  buildSetFontFamilyCommand,
  buildSetFontSizeCommand,
  buildSetItalicCommand,
  buildSetParagraphAlignmentCommand,
  buildSetStrikeCommand,
  buildSetTextColorCommand,
  buildSetUnderlineCommand
} from '../operations/command-builders'
import { createCanvasPool } from '../canvas/pool'
import { createDocumentProjection } from '../model/projection'
import { createMountedCanvasImageResourceResolver } from '../resources/canvas-image-resolver'
import { createJWordError } from '../shared/errors'
import { createSelectionFormattingState } from '../model/formatting-state'
import type { ParagraphAlignment, SelectionFormattingState } from '../model/formatting-types'
import { DEFAULT_HISTORY_ORIGIN } from '../operations/history'
import type { HistoryOperationResult } from '../operations/history'
import type { PageConfig, PageConfigInput } from '../layout/page-config'
import { getCaretRect as getLayoutCaretRect, getSelectionRects as getLayoutSelectionRects, hitTestDocumentLayout, layoutDocument } from '../layout/runtime'
import type { DocumentLayout, LayoutDirtyRange, LayoutRect } from '../layout/runtime'
import { createAnchorRef, createGraphemeIndex, createTextAnchorRef, readAnchorRefSnapshot, resolveAnchorRef } from '../model/position'
import type { AnchorRef, BlockId, RangeRef, RunId, SectionId } from '../model/position'
import type { DocumentProjection } from '../model/projection'
import { createSelectionRestoreSnapshot, createSelectionState, restoreSelection } from '../model/selection'
import type { SelectionState } from '../model/selection'
import { collectSelectionTargets } from '../model/selection-targets'
import type { Command, TextPosition, TransactionMetadata, TransactionResult } from '../operations/transaction'
import { DOCUMENT_CREATE_ORIGIN, FIXTURE_LOAD_ORIGIN } from './constants'
import { createCanvasElement } from './rendering'
import { createHiddenTextareaElement, createLiveRegionElement, createTextMirrorElement } from './dom'
import { findRunText, readCurrentDocumentId, replaceStoreDocument } from './document'
import { JWordEditorState } from './state'
import { resolveCommandDirtyRange } from './rendering'
import type { Editor, EditorCommandOptions, EditorDocumentInput, EditorEventListener, EditorFixture, EditorHitTestPoint, EditorTextAnchorInput, SelectionUpdateSource } from './types'

export abstract class JWordEditorFacadeRuntime extends JWordEditorState implements Editor {
  getProjection(): DocumentProjection {
    this.assertActive()

    return this.currentProjection
  }

  createDocument(input: EditorDocumentInput = {}): DocumentProjection {
    this.assertActive()

    return this.replaceDocument(input, 'createDocument', DOCUMENT_CREATE_ORIGIN)
  }

  loadFixture(fixture: EditorFixture): DocumentProjection {
    this.assertActive()

    return this.replaceDocument(fixture, 'loadFixture', FIXTURE_LOAD_ORIGIN)
  }

  createTextAnchor(input: EditorTextAnchorInput): AnchorRef {
    this.assertActive()

    const text = findRunText(this.store, input)

    return createTextAnchorRef({
      documentId: readCurrentDocumentId(this.store),
      sectionId: input.sectionId as SectionId,
      blockId: input.blockId as BlockId,
      runId: input.runId as RunId,
      graphemeIndex: createGraphemeIndex(input.graphemeIndex),
      text,
      ...(input.assoc === undefined ? {} : { assoc: input.assoc })
    })
  }

  resolveTextPosition(anchor: AnchorRef): TextPosition {
    this.assertActive()

    const snapshot = resolveAnchorRef(anchor, this.store.doc)

    if (snapshot === undefined) {
      throw createJWordError('OPERATION_ANCHOR_UNRESOLVED', '锚点无法解析')
    }

    return {
      sectionId: String(snapshot.sectionId),
      blockId: String(snapshot.blockId),
      runId: String(snapshot.runId),
      graphemeIndex: Number(snapshot.graphemeIndex),
      ...(snapshot.assoc === undefined ? {} : { assoc: snapshot.assoc })
    }
  }

  getLayout(): DocumentLayout {
    this.assertActive()

    return this.readLayoutForQuery()
  }

  getPageConfig(): PageConfig {
    this.assertActive()

    return this.readPageConfig()
  }

  setPageConfig(input: PageConfigInput): PageConfig {
    this.assertActive()

    const nextPageConfig = this.applyPageConfig(input)

    if (this.mountedDom !== undefined) {
      this.renderMountedLayout('document')
    }

    return nextPageConfig
  }

  hitTest(point: EditorHitTestPoint): AnchorRef | undefined {
    this.assertActive()

    const position = hitTestDocumentLayout(this.readTransientLayoutThroughPage(point.pageIndex), point)

    if (position === undefined) {
      return undefined
    }

    return this.createTextAnchor({
      sectionId: position.sectionId,
      blockId: position.blockId,
      runId: position.runId,
      graphemeIndex: position.graphemeIndex,
      ...(position.assoc === undefined ? {} : { assoc: position.assoc })
    })
  }

  getCaretRect(anchor: AnchorRef): LayoutRect | undefined {
    this.assertActive()

    const position = this.resolveTextPosition(anchor)
    const snapshot = readAnchorRefSnapshot(anchor)

    return getLayoutCaretRect(this.readTransientLayoutForPosition(position), {
      ...position,
      ...(snapshot.assoc === undefined ? {} : { assoc: snapshot.assoc })
    })
  }

  getSelectionRects(range: RangeRef): readonly LayoutRect[] {
    this.assertActive()

    const resolvedRange = {
      anchor: this.resolveTextPosition(range.anchor),
      focus: this.resolveTextPosition(range.focus)
    }

    return getLayoutSelectionRects(this.readTransientLayoutForRange(resolvedRange), resolvedRange)
  }

  getSelection(): SelectionState | null {
    this.assertActive()

    return this.currentSelection
  }

  getSelectionFormattingState(): SelectionFormattingState {
    this.assertActive()

    return createSelectionFormattingState(this.currentProjection, this.currentSelection)
  }

  setSelection(selection: SelectionState | null): void {
    this.assertActive()

    this.commitSelection(selection, {
      source: 'api'
    })
  }

  toggleBold(): void {
    this.assertActive()
    this.executeFacadeFormattingCommand(buildSetBoldCommand(
      this.currentProjection,
      this.currentSelection,
      this.getSelectionFormattingState().run?.bold.value !== true
    ))
  }

  toggleItalic(): void {
    this.assertActive()
    this.executeFacadeFormattingCommand(buildSetItalicCommand(
      this.currentProjection,
      this.currentSelection,
      this.getSelectionFormattingState().run?.italic.value !== true
    ))
  }

  toggleUnderline(): void {
    this.assertActive()
    this.executeFacadeFormattingCommand(buildSetUnderlineCommand(
      this.currentProjection,
      this.currentSelection,
      this.getSelectionFormattingState().run?.underline.value !== true
    ))
  }

  toggleStrike(): void {
    this.assertActive()
    this.executeFacadeFormattingCommand(buildSetStrikeCommand(
      this.currentProjection,
      this.currentSelection,
      this.getSelectionFormattingState().run?.strike.value !== true
    ))
  }

  setFontFamily(value: string): void {
    this.assertActive()
    this.executeFacadeFormattingCommand(buildSetFontFamilyCommand(
      this.currentProjection,
      this.currentSelection,
      value
    ))
  }

  setFontSize(value: number): void {
    this.assertActive()
    this.executeFacadeFormattingCommand(buildSetFontSizeCommand(
      this.currentProjection,
      this.currentSelection,
      value
    ))
  }

  setTextColor(value: string): void {
    this.assertActive()
    this.executeFacadeFormattingCommand(buildSetTextColorCommand(
      this.currentProjection,
      this.currentSelection,
      value
    ))
  }

  setBackgroundColor(value: string): void {
    this.assertActive()
    this.executeFacadeFormattingCommand(buildSetBackgroundColorCommand(
      this.currentProjection,
      this.currentSelection,
      value
    ))
  }

  setParagraphAlignment(value: ParagraphAlignment): void {
    this.assertActive()
    this.executeFacadeFormattingCommand(buildSetParagraphAlignmentCommand(
      this.currentProjection,
      this.currentSelection,
      value
    ))
  }

  adjustParagraphIndent(deltaTwips: number): void {
    this.assertActive()

    if (deltaTwips === 0) {
      return
    }

    const targets = collectSelectionTargets(this.currentProjection, this.currentSelection)

    if (targets.paragraphs.length === 0) {
      return
    }

    const command = {
      name: 'adjustParagraphIndent',
      operations: targets.paragraphs.flatMap((target) => {
        const currentIndent = typeof target.paragraph.properties?.indentLeftTwips === 'number'
          ? target.paragraph.properties.indentLeftTwips
          : 0
        const nextIndent = currentIndent + deltaTwips

        return currentIndent === nextIndent
          ? []
          : [{
              kind: 'setParagraphProperties' as const,
              paragraphId: target.paragraph.id,
              properties: { indentLeftTwips: nextIndent }
            }]
      })
    }

    if (command.operations.length === 0) {
      return
    }

    this.executeCommand(command, {
      selectionAfter: this.currentSelection
    })
  }

  executeCommand(command: Command, options: EditorCommandOptions = {}): TransactionResult {
    this.assertActive()

    const origin = options.origin ?? DEFAULT_HISTORY_ORIGIN
    const metadata = createTransactionMetadata(origin, options.label)
    const shouldTrackHistory = this.history.trackedOrigins.has(origin) && command.operations.length > 0
    const selectionBefore = this.currentSelection
    const hasSelectionAfter = 'selectionAfter' in options
    const selectionAfter = hasSelectionAfter ? options.selectionAfter ?? null : this.currentSelection
    const dirtyPageBounds = this.resolveCommandDirtyPageBounds(command)
    const fallbackDirtyPageIndex = this.resolveCurrentSelectionPageIndex() ?? 0

    this.dirtyPageIndex = dirtyPageBounds?.start ?? fallbackDirtyPageIndex
    this.dirtyPageEndIndex = dirtyPageBounds?.end ?? this.dirtyPageIndex
    this.layoutDirtyRange = resolveCommandDirtyRange(command)

    if (shouldTrackHistory) {
      this.history.stopCapturing()
      this.history.captureNextTransaction({
        commandName: command.name,
        origin,
        ...(options.label === undefined ? {} : { description: options.label }),
        selectionBefore: createSelectionRestoreSnapshot(selectionBefore),
        selectionAfter: createSelectionRestoreSnapshot(selectionAfter)
      })
    }

    try {
      if (hasSelectionAfter) {
        this.commitSelection(selectionAfter, {
          source: 'command',
          render: false,
          emit: false
        })
      }

      const result = this.pipeline.run(command, metadata)

      if (!hasSelectionAfter) {
        this.refreshMountedSelectionRuntime(selectionBefore)
      }
      this.emitSelectionChange()

      return result
    } catch (error) {
      if (hasSelectionAfter) {
        this.commitSelection(selectionBefore, {
          source: 'command',
          render: false,
          emit: false
        })
      }

      if (shouldTrackHistory) {
        this.history.discardNextTransactionMetadata()
      }

      throw error
    }
  }

  undo(): HistoryOperationResult {
    this.assertActive()

    const result = this.history.undo()

    if (result.stackItem !== null) {
      this.currentProjection = createDocumentProjection(this.store)
      this.layoutNeedsRefresh = true
      this.dirtyPageIndex = 0
      this.dirtyPageEndIndex = 0
      this.layoutDirtyRange = undefined
      this.mountedTextMirrorNeedsRefresh = true
    }

    if (result.metadata?.selectionBefore !== undefined) {
      this.commitSelection(restoreSelection(result.metadata.selectionBefore), {
        source: 'history',
        render: false,
        emit: false
      })
    }

    if (result.stackItem !== null) {
      this.renderMountedLayout('document')
    }
    this.emitSelectionChange()

    return result
  }

  redo(): HistoryOperationResult {
    this.assertActive()

    const result = this.history.redo()

    if (result.stackItem !== null) {
      this.currentProjection = createDocumentProjection(this.store)
      this.layoutNeedsRefresh = true
      this.dirtyPageIndex = 0
      this.dirtyPageEndIndex = 0
      this.layoutDirtyRange = undefined
      this.mountedTextMirrorNeedsRefresh = true
    }

    if (result.metadata?.selectionAfter !== undefined) {
      this.commitSelection(restoreSelection(result.metadata.selectionAfter), {
        source: 'history',
        render: false,
        emit: false
      })
    }

    if (result.stackItem !== null) {
      this.renderMountedLayout('document')
    }
    this.emitSelectionChange()

    return result
  }

  canUndo(): boolean {
    this.assertActive()

    return this.history.canUndo()
  }

  canRedo(): boolean {
    this.assertActive()

    return this.history.canRedo()
  }

  subscribe(listener: EditorEventListener): () => void {
    this.assertActive()
    this.listeners.add(listener)

    return () => {
      this.listeners.delete(listener)
    }
  }

  mount(host: HTMLElement): void {
    this.assertActive()

    if (this.mountedDom !== undefined) {
      throw createJWordError('EDITOR_ALREADY_MOUNTED', 'JWord editor is already mounted.')
    }

    const ownerDocument = host.ownerDocument
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

    canvasContainer.addEventListener('scroll', handleScroll)
    canvasContainer.addEventListener('mousedown', handlePointerDown)
    canvasContainer.addEventListener('mousemove', handlePointerMove)
    canvasContainer.addEventListener('mouseup', handlePointerUp)
    canvasContainer.addEventListener('dblclick', handleDoubleClick)
    hiddenTextarea.addEventListener('beforeinput', handleBeforeInput)
    hiddenTextarea.addEventListener('input', handleInput)
    hiddenTextarea.addEventListener('keydown', handleKeyDown)
    hiddenTextarea.addEventListener('copy', handleCopy)
    hiddenTextarea.addEventListener('cut', handleCut)
    hiddenTextarea.addEventListener('paste', handlePaste)
    hiddenTextarea.addEventListener('compositionstart', handleCompositionStart)
    hiddenTextarea.addEventListener('compositionupdate', handleCompositionUpdate)
    hiddenTextarea.addEventListener('compositionend', handleCompositionEnd)
    shell.append(canvasContainer, hiddenTextarea, liveRegion, textMirror)
    host.append(shell)

    this.mountedDom = {
      shell,
      canvasContainer,
      hiddenTextarea,
      liveRegion,
      textMirror,
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
      inputState: {
        isComposing: false,
        compositionText: '',
        pendingPlainInputText: ''
      },
      pointerState: {
        anchor: null,
        pageMetrics: null,
        paintedPageIndexes: []
      },
      canvases: new Map(),
      deferredRender: undefined,
      deferredTextMirrorSyncId: undefined
    }
    this.renderMountedLayout('mount')
  }

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
      this.mountedDom.canvasContainer.removeEventListener('scroll', this.mountedDom.handleScroll)
      this.mountedDom.canvasContainer.removeEventListener('mousedown', this.mountedDom.handlePointerDown)
      this.mountedDom.canvasContainer.removeEventListener('mousemove', this.mountedDom.handlePointerMove)
      this.mountedDom.canvasContainer.removeEventListener('mouseup', this.mountedDom.handlePointerUp)
      this.mountedDom.canvasContainer.removeEventListener('dblclick', this.mountedDom.handleDoubleClick)
      this.mountedDom.hiddenTextarea.removeEventListener('beforeinput', this.mountedDom.handleBeforeInput)
      this.mountedDom.hiddenTextarea.removeEventListener('input', this.mountedDom.handleInput)
      this.mountedDom.hiddenTextarea.removeEventListener('keydown', this.mountedDom.handleKeyDown)
      this.mountedDom.hiddenTextarea.removeEventListener('copy', this.mountedDom.handleCopy)
      this.mountedDom.hiddenTextarea.removeEventListener('cut', this.mountedDom.handleCut)
      this.mountedDom.hiddenTextarea.removeEventListener('paste', this.mountedDom.handlePaste)
      this.mountedDom.hiddenTextarea.removeEventListener('compositionstart', this.mountedDom.handleCompositionStart)
      this.mountedDom.hiddenTextarea.removeEventListener('compositionupdate', this.mountedDom.handleCompositionUpdate)
      this.mountedDom.hiddenTextarea.removeEventListener('compositionend', this.mountedDom.handleCompositionEnd)
      this.mountedDom.imageResourceResolver?.dispose()

      for (const canvas of this.mountedDom.canvases.values()) {
        this.mountedDom.pool.release(canvas)
      }

      this.mountedDom.shell.remove()
    }

    this.mountedDom = undefined
    this.history.clear()
    this.unsubscribePipeline()
    this.emit({ kind: 'destroyed' })
    this.listeners.clear()
    this.isDestroyed = true
  }

  protected replaceDocument(
    input: EditorDocumentInput,
    commandName: string,
    origin: string
  ): DocumentProjection {
    const previousSelection = this.currentSelection

    this.dirtyPageIndex = 0
    this.dirtyPageEndIndex = 0
    this.layoutDirtyRange = undefined
    const result = this.pipeline.runMutation(commandName, { origin }, () => {
      replaceStoreDocument(this.store, input)
    })

    this.currentProjection = result.projection
    this.commitSelection(null, {
      source: 'document',
      previousSelection,
      render: true
    })

    return result.projection
  }

  protected executeFacadeFormattingCommand(command: Command | null): void {
    if (command === null) {
      return
    }

    this.executeCommand(command, {
      selectionAfter: this.currentSelection
    })
  }

  protected commitSelection(
    selection: SelectionState | null,
    options: Readonly<{
      source: SelectionUpdateSource
      previousSelection?: SelectionState | null
      render?: boolean
      emit?: boolean
    }>
  ): void {
    const previousSelection = options.previousSelection ?? this.currentSelection

    if (options.source !== 'pointer') {
      this.cancelDeferredPointerSelectionWork()
      if (this.mountedDom !== undefined) {
        this.mountedDom.pointerState.paintedPageIndexes = []
      }
    }

    this.currentSelection = selection
    this.syncCaretBlinkState()

    if (options.render !== false) {
      this.refreshMountedSelectionRuntime(previousSelection)
    }

    if (options.emit !== false) {
      this.emitSelectionChange()
    }
  }

  protected abstract cancelDeferredPointerSelectionWork(): void
  protected abstract syncCaretBlinkState(): void
  protected abstract refreshMountedSelectionRuntime(previousSelection: SelectionState | null): void
  protected abstract emitSelectionChange(): void
  protected abstract resolveCommandDirtyPageBounds(command: Command): Readonly<{ start: number, end: number }> | undefined
  protected abstract resolveCurrentSelectionPageIndex(): number | undefined
  protected abstract readLayoutForQuery(): DocumentLayout
  protected abstract readTransientLayoutThroughPage(pageIndex: number): DocumentLayout
  protected abstract readTransientLayoutForPosition(position: TextPosition): DocumentLayout
  protected abstract readTransientLayoutForRange(range: Readonly<{ anchor: TextPosition, focus: TextPosition }>): DocumentLayout
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

function createTransactionMetadata(origin: string, label: string | undefined): TransactionMetadata {
  return label === undefined ? { origin } : { origin, label }
}
