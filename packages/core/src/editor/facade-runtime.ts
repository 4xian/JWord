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
  buildSetParagraphIndentCommand,
  buildSetParagraphFirstLineIndentCommand,
  buildSetParagraphHangingIndentCommand,
  buildSetParagraphLineHeightCommand,
  buildSetParagraphListCommand,
  buildSetParagraphSpacingAfterCommand,
  buildSetParagraphSpacingBeforeCommand,
  buildSetParagraphStyleCommand,
  buildSetSubscriptCommand,
  buildSetSuperscriptCommand,
  buildSetStrikeCommand,
  buildSetTextColorCommand,
  buildSetUnderlineCommand
} from '../operations/command-builders'
import { createDocumentProjection } from '../model/projection'
import { countGraphemes } from '../shared/grapheme'
import { createJWordError } from '../shared/errors'
import { createSelectionFormattingState } from '../model/formatting-state'
import type { ParagraphAlignment, SelectionFormattingState } from '../model/formatting-types'
import type { Block, ParagraphList, Run } from '../model/types'
import { DEFAULT_HISTORY_ORIGIN, readHistoryScopeTransactionOrigin } from '../operations/history'
import type { HistoryOperationResult, HistoryScope } from '../operations/history'
import type { PageConfig, PageConfigInput } from '../layout/page-config'
import { getCaretRect as getLayoutCaretRect, getSelectionRects as getLayoutSelectionRects, hitTestDocumentLayout, layoutDocument } from '../layout/runtime'
import type { DocumentLayout, LayoutDirtyRange, LayoutRect } from '../layout/runtime'
import { createAnchorRef, createGraphemeIndex, createTextAnchorRef, createTextRangeRecord, readAnchorRefSnapshot, resolveAnchorRef } from '../model/position'
import type { AnchorRef, BlockId, RangeRef, RunId, SectionId, TextRangeRecord } from '../model/position'
import type { DocumentProjection } from '../model/projection'
import { createSelectionRestoreSnapshot, createSelectionState, isSelectionCollapsed, restoreSelection } from '../model/selection'
import type { SelectionState } from '../model/selection'
import { collectSelectionTargets } from '../model/selection-targets'
import type { Command, TextPosition, TransactionMetadata, TransactionResult } from '../operations/transaction'
import { DOCUMENT_CREATE_ORIGIN, DOCUMENT_MODEL_LOAD_ORIGIN, FIXTURE_LOAD_ORIGIN } from './constants'
import { findRunText, locateCommentThreadRange, readCurrentDocumentId, replaceStoreDocument, replaceStoreDocumentModel, restoreTextRangeRecord } from './document'
import { JWordEditorState } from './state'
import { resolveCommandDirtyRange } from './rendering'
import type { EditorCommandOptions, EditorDocumentInput, EditorDocumentModelInput, EditorEventListener, EditorFixture, EditorHitTestPoint, EditorRichTextFragment, EditorTextAnchorInput, SelectionUpdateSource } from './types'

export abstract class JWordEditorFacadeRuntime extends JWordEditorState {
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

  /**
   * 切换当前选择区的上标状态。
   */
  toggleSuperscript(): void {
    this.assertActive()
    if (this.currentSelection !== null && isSelectionCollapsed(this.currentSelection)) {
      this.toggleCollapsedScriptFormatting('superscript')
      return
    }

    this.executeFacadeFormattingCommand(buildSetSuperscriptCommand(
      this.currentProjection,
      this.currentSelection,
      this.getSelectionFormattingState().run?.superscript.value !== true
    ))
  }

  /**
   * 切换当前选择区的下标状态。
   */
  toggleSubscript(): void {
    this.assertActive()
    if (this.currentSelection !== null && isSelectionCollapsed(this.currentSelection)) {
      this.toggleCollapsedScriptFormatting('subscript')
      return
    }

    this.executeFacadeFormattingCommand(buildSetSubscriptCommand(
      this.currentProjection,
      this.currentSelection,
      this.getSelectionFormattingState().run?.subscript.value !== true
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

  /**
   * 设置当前选择区段落的左缩进。
   */
  setParagraphIndent(value: number): void {
    this.assertActive()
    this.executeFacadeFormattingCommand(buildSetParagraphIndentCommand(
      this.currentProjection,
      this.currentSelection,
      value
    ))
  }

  /**
   * 设置当前选择区段落的行距。
   */
  setParagraphLineHeight(value: number): void {
    this.assertActive()
    this.executeFacadeFormattingCommand(buildSetParagraphLineHeightCommand(
      this.currentProjection,
      this.currentSelection,
      value
    ))
  }

  /**
   * 设置当前选择区段落的段前距。
   */
  setParagraphSpacingBefore(value: number): void {
    this.assertActive()
    this.executeFacadeFormattingCommand(buildSetParagraphSpacingBeforeCommand(
      this.currentProjection,
      this.currentSelection,
      value
    ))
  }

  /**
   * 设置当前选择区段落的段后距。
   */
  setParagraphSpacingAfter(value: number): void {
    this.assertActive()
    this.executeFacadeFormattingCommand(buildSetParagraphSpacingAfterCommand(
      this.currentProjection,
      this.currentSelection,
      value
    ))
  }

  /**
   * 设置当前选择区段落的首行缩进。
   */
  setParagraphFirstLineIndent(value: number): void {
    this.assertActive()
    this.executeFacadeFormattingCommand(buildSetParagraphFirstLineIndentCommand(
      this.currentProjection,
      this.currentSelection,
      value
    ))
  }

  /**
   * 设置当前选择区段落的悬挂缩进。
   */
  setParagraphHangingIndent(value: number): void {
    this.assertActive()
    this.executeFacadeFormattingCommand(buildSetParagraphHangingIndentCommand(
      this.currentProjection,
      this.currentSelection,
      value
    ))
  }

  /**
   * 设置当前选择区段落的稳定样式语义。
   */
  setParagraphStyle(value: string): void {
    this.assertActive()
    this.executeFacadeFormattingCommand(buildSetParagraphStyleCommand(
      this.currentProjection,
      this.currentSelection,
      value
    ))
  }

  /**
   * 设置当前选择区段落的稳定列表语义。
   */
  setParagraphList(value: ParagraphList | null): void {
    this.assertActive()
    this.executeFacadeFormattingCommand(buildSetParagraphListCommand(
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
