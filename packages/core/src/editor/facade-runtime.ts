/**
 * 职责：实现 Editor facade 的公开方法和文档/选择区提交编排。
 * 边界：不处理 DOM 事件细节，不直接绘制 canvas。
 * 协作模块：状态层、文档辅助函数、格式命令、历史记录、选择区和布局/渲染子类。
 * 性能/安全约束：构造函数和顶层代码不访问浏览器对象，DOM 只在挂载后创建，编辑命令统一进入事务流水线。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import * as Y from 'yjs'
import { createDocumentProjection } from '../model/projection'
import { countGraphemes, utf16IndexToGraphemeIndex } from '../shared/grapheme'
import { createJWordError } from '../shared/errors'
import { createSelectionFormattingState } from '../model/formatting-state'
import type { SelectionFormattingState } from '../model/formatting-types'
import type { Block, Run } from '../model/types'
import { DEFAULT_HISTORY_ORIGIN, readHistoryScopeTransactionOrigin } from '../operations/history'
import type { HistoryOperationResult, HistoryScope } from '../operations/history'
import type { PageConfig, PageConfigInput } from '../layout/page-config'
import { getCaretRect as getLayoutCaretRect, getSelectionRects as getLayoutSelectionRects, hitTestDocumentLayout, layoutDocument } from '../layout/runtime'
import type { DocumentLayout, LayoutDirtyRange, LayoutRect } from '../layout/runtime'
import { createAnchorRef, createGraphemeIndex, createTextAnchorRef, createTextRangeRecord, readAnchorRefSnapshot, resolveAnchorRef } from '../model/position'
import type { AnchorRef, BlockId, RangeRef, RunId, SectionId, TextRangeRecord } from '../model/position'
import type { DocumentProjection } from '../model/projection'
import { createSelectionRestoreSnapshot, createSelectionState, isSelectionCollapsed, restoreSelection } from '../model/selection'
import type { SelectionRestoreSnapshot, SelectionState } from '../model/selection'
import type { Command, TextPosition, TransactionMetadata, TransactionResult } from '../operations/transaction'
import { DOCUMENT_CREATE_ORIGIN, DOCUMENT_MODEL_LOAD_ORIGIN, FIXTURE_LOAD_ORIGIN } from './constants'
import { findRunText, locateCommentThreadRange, readCurrentDocumentId, replaceStoreDocument, replaceStoreDocumentModel, restoreTextRangeRecord } from './document'
import { JWordEditorFormattingFacadeRuntime } from './formatting-facade-runtime'
import { resolveCommandDirtyRange } from './rendering'
import type { EditorCommandOptions, EditorDocumentInput, EditorDocumentModelInput, EditorEventListener, EditorFixture, EditorHitTestPoint, EditorRichTextFragment, EditorTextAnchorInput, SelectionUpdateSource } from './types'
import type { PluginDiagnostic } from '../plugins/types'
import { createJWordDiagnosticsSnapshot, createJWordLayoutMetricsSummary, createJWordSelectionSummary } from './observability'
import type { JWordDiagnosticsSnapshot } from './observability'

export abstract class JWordEditorFacadeRuntime extends JWordEditorFormattingFacadeRuntime {
  /** 粘贴已清洗的富文本片段，具体 command 生成由输入运行时实现。 */
  abstract pasteRichTextFragment(fragment: EditorRichTextFragment): boolean

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

  loadDocumentModel(input: EditorDocumentModelInput): DocumentProjection {
    this.assertActive()

    return this.replaceDocumentModel(input, 'loadDocumentModel', DOCUMENT_MODEL_LOAD_ORIGIN)
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

  /**
   * 捕获当前 range 的稳定快照。
   */
  captureRangeSnapshot(range: RangeRef): TextRangeRecord {
    this.assertActive()

    this.rangeSnapshotSequence += 1

    return createTextRangeRecord(`range-snapshot-${this.rangeSnapshotSequence}`, range)
  }

  /**
   * 解析稳定 range 快照的当前位置。
   */
  locateRangeSnapshot(snapshot: TextRangeRecord) {
    this.assertActive()

    const restoredRange = restoreTextRangeRecord(this.store, snapshot)

    return restoredRange === null
      ? null
      : {
          anchor: this.resolveTextPosition(restoredRange.anchor),
          focus: this.resolveTextPosition(restoredRange.focus)
        }
  }

  getSelection(): SelectionState | null {
    this.assertActive()

    return this.currentSelection
  }

  getSelectionFormattingState(): SelectionFormattingState {
    this.assertActive()

    return this.readCurrentSelectionFormattingState()
  }

  /**
   * 读取当前本地用户快照。
   */
  getCurrentUser() {
    this.assertActive()

    return this.currentUser
  }

  /**
   * 定位批注线程当前绑定的稳定范围。
   */
  locateCommentThread(threadId: string): RangeRef | null {
    this.assertActive()

    return locateCommentThreadRange(this.store, threadId)
  }

  setSelection(selection: SelectionState | null): void {
    this.assertActive()

    this.commitSelection(selection, {
      source: 'api'
    })
  }


  executeCommand(command: Command, options: EditorCommandOptions = {}): TransactionResult {
    this.assertActive()

    return this.pluginHost.runCommandMiddleware({ command, options }, (nextCommand, nextOptions) =>
      this.executePipelineCommand(nextCommand, nextOptions)
    )
  }

  /** 执行已经通过插件中间件的命令。 */
  protected executePipelineCommand(command: Command, options: EditorCommandOptions = {}): TransactionResult {
    this.assertActive()

    const origin = options.origin ?? DEFAULT_HISTORY_ORIGIN
    const metadata = createTransactionMetadata(origin, options)
    const historyScope = options.historyScope
    const shouldTrackHistory = (historyScope !== undefined || this.history.trackedOrigins.has(origin)) &&
      command.operations.length > 0
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
      }, historyScope)
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
        this.history.discardNextTransactionMetadata(historyScope)
      }

      throw error
    }
  }

  /** 执行已注册插件命令。 */
  executePluginCommand(commandName: string, input?: unknown): TransactionResult | undefined {
    this.assertActive()

    return this.pluginHost.executePluginCommand(commandName, input)
  }

  /** 读取插件诊断快照。 */
  getPluginDiagnostics(): readonly PluginDiagnostic[] {
    this.assertActive()

    return this.pluginHost.getDiagnostics()
  }

  /** 导出隐私裁剪后的 diagnostics 快照。 */
  exportDiagnostics(): JWordDiagnosticsSnapshot {
    this.assertActive()

    return createJWordDiagnosticsSnapshot(this.pluginHost.getDiagnostics(), {
      operations: this.operationSummary,
      layout: createJWordLayoutMetricsSummary(this.getLayout()),
      selection: createJWordSelectionSummary(this.currentSelection)
    })
  }

  undo(scope?: HistoryScope): HistoryOperationResult {
    this.assertActive()

    const result = this.history.undo(scope)

    if (result.stackItem !== null) {
      this.currentProjection = createDocumentProjection(this.store)
      this.layoutNeedsRefresh = true
      this.dirtyPageIndex = 0
      this.dirtyPageEndIndex = 0
      this.layoutDirtyRange = undefined
      this.mountedTextMirrorNeedsRefresh = true
    }

    if (result.metadata?.selectionBefore !== undefined) {
      this.commitSelection(this.restoreHistorySelection(result.metadata.selectionBefore), {
        source: 'history',
        render: false,
        emit: false
      })
    }

    if (result.stackItem !== null) {
      this.cancelDeferredDocumentRender()
      if (this.shouldRenderMountedDocumentImmediately('undo')) {
        this.renderMountedLayout('document')
      } else {
        this.scheduleDeferredDocumentRender()
      }
    }
    this.emitSelectionChange()

    return result
  }

  redo(scope?: HistoryScope): HistoryOperationResult {
    this.assertActive()

    const result = this.history.redo(scope)

    if (result.stackItem !== null) {
      this.currentProjection = createDocumentProjection(this.store)
      this.layoutNeedsRefresh = true
      this.dirtyPageIndex = 0
      this.dirtyPageEndIndex = 0
      this.layoutDirtyRange = undefined
      this.mountedTextMirrorNeedsRefresh = true
    }

    if (result.metadata?.selectionAfter !== undefined) {
      this.commitSelection(this.restoreHistorySelection(result.metadata.selectionAfter), {
        source: 'history',
        render: false,
        emit: false
      })
    }

    if (result.stackItem !== null) {
      this.cancelDeferredDocumentRender()
      if (this.shouldRenderMountedDocumentImmediately('redo')) {
        this.renderMountedLayout('document')
      } else {
        this.scheduleDeferredDocumentRender()
      }
    }
    this.emitSelectionChange()

    return result
  }

  canUndo(scope?: HistoryScope): boolean {
    this.assertActive()

    return this.history.canUndo(scope)
  }

  canRedo(scope?: HistoryScope): boolean {
    this.assertActive()

    return this.history.canRedo(scope)
  }

  subscribe(listener: EditorEventListener): () => void {
    this.assertActive()
    this.listeners.add(listener)

    return () => {
      this.listeners.delete(listener)
    }
  }

  protected replaceDocument(
    input: EditorDocumentInput,
    commandName: string,
    origin: string
  ): DocumentProjection {
    const previousSelection = this.currentSelection

    this.commitSelection(null, {
      source: 'document',
      render: false,
      emit: false
    })

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

  protected replaceDocumentModel(
    input: EditorDocumentModelInput,
    commandName: string,
    origin: string
  ): DocumentProjection {
    const previousSelection = this.currentSelection

    this.commitSelection(null, {
      source: 'document',
      render: false,
      emit: false
    })

    this.dirtyPageIndex = 0
    this.dirtyPageEndIndex = 0
    this.layoutDirtyRange = undefined
    const result = this.pipeline.runMutation(commandName, { origin }, () => {
      replaceStoreDocumentModel(this.store, input.document)
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

  protected updateInputFocusState(nextFocused: boolean): void {
    if (this.isInputFocused === nextFocused) {
      return
    }

    this.isInputFocused = nextFocused
    this.syncCaretBlinkState()

    if (this.currentSelection !== null) {
      this.renderMountedLayout('selection')
    }
  }

  protected resolveInitialStartFocusAnchor(): AnchorRef | undefined {
    for (const section of this.currentProjection.document.sections) {
      const target = this.findFirstFocusableRunInBlocks(section.id, section.blocks)

      if (target !== undefined) {
        return this.createTextAnchor({
          sectionId: target.sectionId,
          blockId: target.blockId,
          runId: target.runId,
          graphemeIndex: 0
        })
      }
    }

    return undefined
  }

  /** 解析首次 focus 时的文档末尾锚点。 */
  protected resolveInitialEndFocusAnchor(): AnchorRef | undefined {
    for (const section of [...this.currentProjection.document.sections].reverse()) {
      const target = this.findLastFocusableRunInBlocks(section.id, section.blocks)

      if (target !== undefined) {
        return this.createTextAnchor({
          sectionId: target.sectionId,
          blockId: target.blockId,
          runId: target.run.id,
          graphemeIndex: countGraphemes(this.readRunText(target.run))
        })
      }
    }

    return undefined
  }

  protected findFirstFocusableRunInBlocks(
    sectionId: string,
    blocks: readonly Block[]
  ): Readonly<{
    sectionId: string
    blockId: string
    runId: string
  }> | undefined {
    for (const block of blocks) {
      if (block.kind === 'paragraph') {
        const preferredRun = block.runs.find((run) => this.isFocusableRun(run))
        const run = preferredRun ?? block.runs[0]

        if (run !== undefined) {
          return {
            sectionId,
            blockId: block.id,
            runId: run.id
          }
        }

        continue
      }

      for (const row of block.rows) {
        for (const cell of row.cells) {
          const target = this.findFirstFocusableRunInBlocks(sectionId, cell.blocks)

          if (target !== undefined) {
            return target
          }
        }
      }
    }

    return undefined
  }

  /** 从 block 树尾部寻找最后一个可聚焦 run。 */
  protected findLastFocusableRunInBlocks(
    sectionId: string,
    blocks: readonly Block[]
  ): Readonly<{
    sectionId: string
    blockId: string
    run: Run
  }> | undefined {
    for (const block of [...blocks].reverse()) {
      if (block.kind === 'paragraph') {
        const preferredRun = [...block.runs].reverse().find((run) => this.isFocusableRun(run))
        const run = preferredRun ?? block.runs.at(-1)

        if (run !== undefined) {
          return {
            sectionId,
            blockId: block.id,
            run
          }
        }

        continue
      }

      for (const row of [...block.rows].reverse()) {
        for (const cell of [...row.cells].reverse()) {
          const target = this.findLastFocusableRunInBlocks(sectionId, cell.blocks)

          if (target !== undefined) {
            return target
          }
        }
      }
    }

    return undefined
  }

  /** 判断 run 是否可承载文本光标。 */
  protected isFocusableRun(run: Run): boolean {
    return run.inlines.some((inline) => inline.kind === 'text')
  }

  /** 恢复历史选择区，并在锚点已失效时回退到当前文档开头。 */
  protected restoreHistorySelection(snapshot: SelectionRestoreSnapshot): SelectionState | null {
    const restoredSelection = restoreSelection(snapshot)

    if (restoredSelection === null) {
      return null
    }

    if (restoredSelection === this.currentSelection) {
      return restoredSelection
    }

    if (this.isSelectionValidInCurrentProjection(restoredSelection)) {
      return restoredSelection
    }

    const anchor = this.restoreHistoryAnchor(restoredSelection.anchor)
    const focus = this.restoreHistoryAnchor(restoredSelection.focus)

    if (anchor !== undefined && focus !== undefined) {
      if (anchor === restoredSelection.anchor && focus === restoredSelection.focus) {
        return restoredSelection
      }

      return createSelectionState(anchor, focus, {
        direction: restoredSelection.direction,
        affinity: restoredSelection.affinity
      })
    }

    const fallbackAnchor = this.resolveInitialStartFocusAnchor()

    return fallbackAnchor === undefined ? null : createSelectionState(fallbackAnchor, fallbackAnchor)
  }

  /** 恢复单个历史锚点，优先用 Y.RelativePosition 找回当前 run。 */
  protected restoreHistoryAnchor(anchor: AnchorRef): AnchorRef | undefined {
    const snapshot = readAnchorRefSnapshot(anchor)
    const relativePosition = snapshot.relativePosition

    if (relativePosition !== undefined) {
      const absolute = Y.createAbsolutePositionFromRelativePosition(relativePosition, this.store.doc)

      if (absolute === null || !(absolute.type instanceof Y.Text)) {
        return undefined
      }

      const graphemeIndex = utf16IndexToGraphemeIndex(absolute.type.toString(), absolute.index)
      const locatedAnchor = this.locateHistoryAnchorByText(absolute.type, graphemeIndex, snapshot.assoc)

      if (locatedAnchor === undefined) {
        return undefined
      }

      return this.areHistoryAnchorsAtSameResolvedPosition(anchor, locatedAnchor) ? anchor : locatedAnchor
    }

    return this.hasTextPositionInCurrentProjection({
      sectionId: String(snapshot.sectionId),
      blockId: String(snapshot.blockId),
      runId: String(snapshot.runId),
      graphemeIndex: Number(snapshot.graphemeIndex),
      ...(snapshot.assoc === undefined ? {} : { assoc: snapshot.assoc })
    }) ? anchor : undefined
  }

  /** 判断两个历史锚点解析后是否仍指向同一文本位置。 */
  protected areHistoryAnchorsAtSameResolvedPosition(left: AnchorRef, right: AnchorRef): boolean {
    const leftPosition = this.tryResolveHistorySelectionPosition(left)
    const rightPosition = this.tryResolveHistorySelectionPosition(right)

    return leftPosition !== undefined &&
      rightPosition !== undefined &&
      leftPosition.sectionId === rightPosition.sectionId &&
      leftPosition.blockId === rightPosition.blockId &&
      leftPosition.runId === rightPosition.runId &&
      leftPosition.graphemeIndex === rightPosition.graphemeIndex
  }

  /** 根据解析出的 Y.Text 句柄在当前投影中找回可用锚点。 */
  protected locateHistoryAnchorByText(
    text: Y.Text,
    graphemeIndex: number,
    assoc: number | undefined
  ): AnchorRef | undefined {
    for (const section of this.currentProjection.document.sections) {
      const anchor = this.locateHistoryAnchorByTextInBlocks(section.id, section.blocks, text, graphemeIndex, assoc)

      if (anchor !== undefined) {
        return anchor
      }
    }

    return undefined
  }

  /** 在 block 树中根据 Y.Text 句柄找回历史锚点。 */
  protected locateHistoryAnchorByTextInBlocks(
    sectionId: string,
    blocks: readonly Block[],
    text: Y.Text,
    graphemeIndex: number,
    assoc: number | undefined
  ): AnchorRef | undefined {
    for (const block of blocks) {
      if (block.kind === 'paragraph') {
        for (const run of block.runs) {
          const runText = findRunText(this.store, {
            sectionId,
            blockId: block.id,
            runId: run.id,
            graphemeIndex: 0
          })

          if (runText === text) {
            return this.createTextAnchor({
              sectionId,
              blockId: block.id,
              runId: run.id,
              graphemeIndex,
              ...(assoc === undefined ? {} : { assoc })
            })
          }
        }

        continue
      }

      for (const row of block.rows) {
        for (const cell of row.cells) {
          const anchor = this.locateHistoryAnchorByTextInBlocks(sectionId, cell.blocks, text, graphemeIndex, assoc)

          if (anchor !== undefined) {
            return anchor
          }
        }
      }
    }

    return undefined
  }

  /** 判断选择区两端是否仍能解析到当前投影里的文本位置。 */
  protected isSelectionValidInCurrentProjection(selection: SelectionState): boolean {
    const anchor = this.tryResolveHistorySelectionPosition(selection.anchor)
    const focus = this.tryResolveHistorySelectionPosition(selection.focus)

    return anchor !== undefined &&
      focus !== undefined &&
      this.hasTextPositionInCurrentProjection(anchor) &&
      this.hasTextPositionInCurrentProjection(focus)
  }

  /** 尝试解析历史选择锚点，失败时返回 undefined 供回退逻辑处理。 */
  protected tryResolveHistorySelectionPosition(anchor: AnchorRef): TextPosition | undefined {
    try {
      return this.resolveTextPosition(anchor)
    } catch {
      return undefined
    }
  }

  /** 判断文本位置是否仍存在于当前文档投影中。 */
  protected hasTextPositionInCurrentProjection(position: TextPosition): boolean {
    const section = this.currentProjection.document.sections.find((candidate) => candidate.id === position.sectionId)

    return section === undefined ? false : this.hasTextPositionInBlocks(section.blocks, position)
  }

  /** 在 block 树中递归查找文本位置。 */
  protected hasTextPositionInBlocks(blocks: readonly Block[], position: TextPosition): boolean {
    for (const block of blocks) {
      if (block.kind === 'paragraph') {
        const run = block.id === position.blockId
          ? block.runs.find((candidate) => candidate.id === position.runId)
          : undefined

        if (run !== undefined) {
          return position.graphemeIndex >= 0 && position.graphemeIndex <= countGraphemes(this.readRunText(run))
        }

        continue
      }

      if (block.rows.some((row) =>
        row.cells.some((cell) => this.hasTextPositionInBlocks(cell.blocks, position))
      )) {
        return true
      }
    }

    return false
  }

  /** 读取 run 中所有文本 inline 的纯文本。 */
  protected readRunText(run: Run): string {
    return run.inlines
      .flatMap((inline) => inline.kind === 'text' ? [inline.text] : [])
      .join('')
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

    if (options.source !== 'command') {
      this.pendingCollapsedRunProperties = undefined
    }

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

  /**
   * 读取当前选区格式状态，并在折叠光标时叠加待输入上下标态。
   */
  protected readCurrentSelectionFormattingState(): SelectionFormattingState {
    const formattingState = createSelectionFormattingState(this.currentProjection, this.currentSelection)

    return this.applyPendingCollapsedRunProperties(formattingState)
  }

  /**
   * 折叠光标下的上下标切换只影响后续输入，不回改未选中的现有文字。
   */
  protected toggleCollapsedScriptFormatting(kind: 'superscript' | 'subscript'): void {
    const currentRunState = this.readCurrentSelectionFormattingState().run
    const shouldEnable = kind === 'superscript'
      ? currentRunState?.superscript.value !== true
      : currentRunState?.subscript.value !== true

    this.pendingCollapsedRunProperties = Object.freeze(kind === 'superscript'
      ? shouldEnable
        ? { superscript: true, subscript: false }
        : { superscript: false, subscript: false }
      : shouldEnable
        ? { superscript: false, subscript: true }
        : { superscript: false, subscript: false })

    this.emitSelectionChange()
  }

  /**
   * 把折叠光标的待输入上下标态覆盖到当前格式状态，供 toolbar 与外部读取。
   */
  protected applyPendingCollapsedRunProperties(
    formattingState: SelectionFormattingState
  ): SelectionFormattingState {
    if (
      this.pendingCollapsedRunProperties === undefined
      || this.currentSelection === null
      || !isSelectionCollapsed(this.currentSelection)
      || formattingState.run === null
    ) {
      return formattingState
    }

    return {
      ...formattingState,
      run: {
        ...formattingState.run,
        superscript: {
          value: this.pendingCollapsedRunProperties.superscript === true,
          mixed: false
        },
        subscript: {
          value: this.pendingCollapsedRunProperties.subscript === true,
          mixed: false
        }
      }
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
}

function createTransactionMetadata(origin: string, options: EditorCommandOptions): TransactionMetadata {
  return {
    origin,
    ...(options.historyScope === undefined ? {} : {
      historyOrigin: readHistoryScopeTransactionOrigin(options.historyScope)
    }),
    ...(options.label === undefined ? {} : { label: options.label }),
    ...(options.requestId === undefined ? {} : { requestId: options.requestId }),
    ...(options.roomId === undefined ? {} : { roomId: options.roomId }),
    ...(options.clientId === undefined ? {} : { clientId: options.clientId }),
    ...(options.authorId === undefined ? {} : { authorId: options.authorId }),
    ...(options.snapshotId === undefined ? {} : { snapshotId: options.snapshotId }),
    ...(options.versionId === undefined ? {} : { versionId: options.versionId }),
    ...(options.recoverable === undefined ? {} : { recoverable: options.recoverable })
  }
}
