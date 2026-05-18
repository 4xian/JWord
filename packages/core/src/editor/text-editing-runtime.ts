/**
 * 职责：实现 editor runtime 的纯文本插入、删除、段落拆分、光标移动和快捷格式命令。
 * 边界：不绑定 DOM 事件，不处理 pointer 命中，不创建文档模型。
 * 协作模块：input runtime 调用这里的文本编辑能力，selection、transaction 和 text-runtime helper 提供状态边界。
 * 性能/安全约束：所有编辑命令统一进入 transaction pipeline，不直接改 projection，不访问 top-level DOM。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/03-architecture.md 与 05-implementation-gates.md#gate-3---输入与基础编辑。
 */
import {
  buildDeleteSelectedImageCommand,
  buildSetBoldCommand,
  buildSetItalicCommand
} from '../operations/command-builders'
import { countGraphemes, splitGraphemes } from '../shared/grapheme'
import { getCaretRect as getLayoutCaretRect } from '../layout/runtime'
import { createSelectionState, isSelectionCollapsed } from '../model/selection'
import { collectSelectionTargets } from '../model/selection-targets'
import type { ModelProperties, Paragraph, Run } from '../model/types'
import type { Command, Operation, TextPosition } from '../operations/transaction'
import { createAllTextSelection, readSelectionHtmlFromProjection } from './clipboard-runtime'
import { flattenLayoutLines, hitTestLineAtAbsoluteX, resolveLineBoundaryPosition } from './rendering'
import { JWordEditorMountedRuntime } from './mounted-runtime'
import {
  allocateParagraphSplitIds,
  collectParagraphRuntimeContexts,
  compareRuntimeTextPositions,
  createRuntimeAnchor,
  moveTextPosition,
  normalizePlainText
} from './text-runtime'

export abstract class JWordEditorTextEditingRuntime extends JWordEditorMountedRuntime {
  protected insertPlainTextFromRuntime(text: string): void {
    const selection = this.currentSelection

    if (selection !== null && !isSelectionCollapsed(selection)) {
      if (!this.replaceSelectedTextFromRuntime(normalizePlainText(text))) {
        return
      }

      return
    }

    this.insertTextFromRuntime(normalizePlainText(text))
  }

  protected insertTextFromRuntime(text: string): void {
    const selection = this.currentSelection

    if (selection === null || !isSelectionCollapsed(selection)) {
      return
    }

    if (text.length === 0) {
      return
    }

    const position = this.resolveTextPosition(selection.focus)
    const command = this.buildPlainTextInsertCommand(position, text)

    if (command === undefined) {
      return
    }

    this.executeCommand(command.command, {
      selectionAfter: command.selectionAfter
    })
  }

  protected replaceSelectedTextFromRuntime(text: string): boolean {
    const range = this.resolveSelectedTextRange()

    if (range === undefined) {
      return false
    }

    const normalizedText = normalizePlainText(text)
    const deletePlan = this.buildDeleteSelectionPlan(range)

    if (deletePlan === undefined) {
      return false
    }

    const command = this.buildPlainTextInsertCommand(deletePlan.caret, normalizedText, deletePlan.operations)

    if (command === undefined) {
      return false
    }

    this.executeCommand(command.command, {
      selectionAfter: command.selectionAfter
    })

    return true
  }

  protected deleteSelectedTextFromRuntime(): boolean {
    const range = this.resolveSelectedTextRange()

    if (range === undefined) {
      return false
    }

    const deletePlan = this.buildDeleteSelectionPlan(range)

    if (deletePlan === undefined) {
      return false
    }

    this.executeCommand(
      {
        name: 'deleteSelection',
        operations: deletePlan.operations
      },
      {
        selectionAfter: createSelectionState(
          createRuntimeAnchor({
            documentId: this.currentProjection.document.id,
            ...deletePlan.caret
          }),
          createRuntimeAnchor({
            documentId: this.currentProjection.document.id,
            ...deletePlan.caret
          })
        )
      }
    )

    return true
  }

  protected buildPlainTextInsertCommand(
    start: TextPosition,
    text: string,
    leadingOperations: readonly Operation[] = []
  ): Readonly<{
    command: Command
    selectionAfter: ReturnType<typeof createSelectionState>
  }> | undefined {
    const parts = text.split('\n')
    const operations: Operation[] = [...leadingOperations]
    const pendingRunProperties = this.pendingCollapsedRunProperties
    const usedRunIds = pendingRunProperties === undefined ? undefined : collectProjectionRunIds(this.currentProjection)
    let currentPosition: TextPosition = { ...start }
    let currentRunId = start.runId
    let currentBlockId = start.blockId
    let currentRunGraphemeLength = this.resolveRuntimeRunGraphemeLength(start)

    if (parts.length === 1 && parts[0]?.length === 0 && leadingOperations.length === 0) {
      return undefined
    }

    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index] ?? ''

      if (part.length > 0) {
        const insertedStartGraphemeIndex = currentPosition.graphemeIndex
        const insertedGraphemeLength = countGraphemes(part)
        operations.push({
          kind: 'insertText',
          at: currentPosition,
          text: part
        })

        currentRunGraphemeLength += insertedGraphemeLength
        currentPosition = {
          ...currentPosition,
          runId: currentRunId,
          blockId: currentBlockId,
          graphemeIndex: insertedStartGraphemeIndex + insertedGraphemeLength
        }

        if (pendingRunProperties !== undefined && usedRunIds !== undefined) {
          const pendingCaret = this.appendPendingCollapsedRunPropertiesToInsertedText(
            operations,
            usedRunIds,
            currentRunId,
            insertedStartGraphemeIndex,
            insertedGraphemeLength,
            currentRunGraphemeLength,
            pendingRunProperties
          )

          currentRunId = pendingCaret.runId
          currentRunGraphemeLength = insertedGraphemeLength
          currentPosition = {
            ...currentPosition,
            runId: currentRunId,
            graphemeIndex: pendingCaret.graphemeIndex
          }
        }
      }

      if (index >= parts.length - 1) {
        continue
      }

      const splitRunTailGraphemeLength = Math.max(0, currentRunGraphemeLength - currentPosition.graphemeIndex)
      const identifiers = allocateParagraphSplitIds(this.currentProjection, operations)

      operations.push({
        kind: 'splitBlock',
        at: currentPosition,
        newBlockId: identifiers.blockId,
        newRunId: identifiers.runId
      })

      currentBlockId = identifiers.blockId
      currentRunId = identifiers.runId
      currentRunGraphemeLength = splitRunTailGraphemeLength
      usedRunIds?.add(identifiers.runId)
      currentPosition = {
        sectionId: currentPosition.sectionId,
        blockId: currentBlockId,
        runId: currentRunId,
        graphemeIndex: 0
      }
    }

    const selectionAfter = createSelectionState(
      createRuntimeAnchor({
        documentId: this.currentProjection.document.id,
        ...currentPosition
      }),
      createRuntimeAnchor({
        documentId: this.currentProjection.document.id,
        ...currentPosition
      })
    )

    return {
      command: {
        name: leadingOperations.length > 0 ? 'replaceText' : 'insertText',
        operations
      },
      selectionAfter
    }
  }

  /**
   * 把折叠光标的待输入上下标只补到本次新增文本上。
   */
  protected appendPendingCollapsedRunPropertiesToInsertedText(
    operations: Operation[],
    usedRunIds: Set<string>,
    runId: string,
    startGraphemeIndex: number,
    insertedGraphemeLength: number,
    graphemeLengthAfterInsert: number,
    properties: ModelProperties
  ): Readonly<{
    runId: string
    graphemeIndex: number
  }> {
    if (startGraphemeIndex === 0 && insertedGraphemeLength === graphemeLengthAfterInsert) {
      operations.push({
        kind: 'setRunProperties',
        runId,
        properties
      })

      return {
        runId,
        graphemeIndex: insertedGraphemeLength
      }
    }

    const formattedRunId = startGraphemeIndex > 0
      ? allocateGeneratedRuntimeRunId(usedRunIds, runId, 'format')
      : runId
    const endGraphemeIndex = startGraphemeIndex + insertedGraphemeLength

    operations.push({
      kind: 'setRunProperties',
      runId,
      properties,
      range: {
        startGraphemeIndex,
        endGraphemeIndex,
        ...(startGraphemeIndex > 0 ? { formattedRunId } : {}),
        ...(endGraphemeIndex < graphemeLengthAfterInsert
          ? { trailingRunId: allocateGeneratedRuntimeRunId(usedRunIds, runId, 'tail') }
          : {})
      }
    })

    return {
      runId: formattedRunId,
      graphemeIndex: insertedGraphemeLength
    }
  }

  /**
   * 读取当前插入落点 run 的 grapheme 长度，用于后续只格式化新增文本。
   */
  protected resolveRuntimeRunGraphemeLength(position: TextPosition): number {
    const paragraphs = collectParagraphRuntimeContexts(this.currentProjection)
    const paragraph = paragraphs.find((candidate) => candidate.blockId === position.blockId)
    const run = paragraph?.runs.find((candidate) => candidate.id === position.runId)

    return run?.graphemeLength ?? 0
  }

  protected buildDeleteSelectionPlan(range: Readonly<{
    start: TextPosition
    end: TextPosition
  }>): Readonly<{
    operations: readonly Operation[]
    caret: TextPosition
  }> | undefined {
    const paragraphs = collectParagraphRuntimeContexts(this.currentProjection)
    const startParagraphIndex = paragraphs.findIndex((paragraph) => paragraph.blockId === range.start.blockId)
    const endParagraphIndex = paragraphs.findIndex((paragraph) => paragraph.blockId === range.end.blockId)

    if (startParagraphIndex < 0 || endParagraphIndex < 0) {
      return undefined
    }

    const startParagraph = paragraphs[startParagraphIndex]
    const endParagraph = paragraphs[endParagraphIndex]

    if (startParagraph === undefined || endParagraph === undefined) {
      return undefined
    }

    const startRunIndex = startParagraph.runs.findIndex((run) => run.id === range.start.runId)
    const endRunIndex = endParagraph.runs.findIndex((run) => run.id === range.end.runId)

    if (startRunIndex < 0 || endRunIndex < 0) {
      return undefined
    }

    const operations: Operation[] = []
    const selection = createSelectionState(
      createRuntimeAnchor({
        documentId: this.currentProjection.document.id,
        ...range.start
      }),
      createRuntimeAnchor({
        documentId: this.currentProjection.document.id,
        ...range.end
      })
    )
    const targets = collectSelectionTargets(this.currentProjection, selection)

    for (let targetIndex = targets.runs.length - 1; targetIndex >= 0; targetIndex -= 1) {
      const target = targets.runs[targetIndex]

      if (target === undefined) {
        continue
      }

      if (this.readSingleImageResourceId(target.run) !== undefined) {
        operations.push({
          kind: 'deleteImage',
          runId: target.run.id
        })
        continue
      }

      if (target.selectedEndGraphemeIndex <= target.selectedStartGraphemeIndex) {
        continue
      }

      operations.push({
        kind: 'deleteRange',
        range: {
          anchor: {
            sectionId: range.start.sectionId,
            blockId: target.paragraphId,
            runId: target.run.id,
            graphemeIndex: target.selectedStartGraphemeIndex
          },
          focus: {
            sectionId: range.start.sectionId,
            blockId: target.paragraphId,
            runId: target.run.id,
            graphemeIndex: target.selectedEndGraphemeIndex
          }
        }
      })
    }

    for (const resourceId of this.collectFullyDeletedImageResourceIds(targets.runs)) {
      operations.push({
        kind: 'deleteResource',
        resourceId
      })
    }

    for (let paragraphIndex = endParagraphIndex; paragraphIndex > startParagraphIndex; paragraphIndex -= 1) {
      const paragraph = paragraphs[paragraphIndex]

      if (paragraph === undefined) {
        continue
      }

      operations.push({
        kind: 'mergeBlock',
        targetBlockId: paragraphs[paragraphIndex - 1]!.blockId,
        sourceBlockId: paragraph.blockId
      })
    }

    if (operations.length === 0) {
      return undefined
    }

    return {
      operations,
      caret: {
        ...range.start
      }
    }
  }

  protected resolveSelectedTextRange(): Readonly<{
    start: TextPosition
    end: TextPosition
  }> | undefined {
    const selection = this.currentSelection

    if (selection === null || isSelectionCollapsed(selection)) {
      return undefined
    }

    const anchor = this.resolveTextPosition(selection.anchor)
    const focus = this.resolveTextPosition(selection.focus)

    const order = compareRuntimeTextPositions(this.currentProjection, anchor, focus)

    if (order <= 0) {
      return { start: anchor, end: focus }
    }

    return { start: focus, end: anchor }
  }

  protected readSelectionPlainText(): string {
    const selection = this.currentSelection

    if (selection === null || isSelectionCollapsed(selection)) {
      return ''
    }

    const targets = collectSelectionTargets(this.currentProjection, selection)
    let text = ''
    let previousParagraphId: string | undefined

    for (const target of targets.runs) {
      if (previousParagraphId !== undefined && previousParagraphId !== target.paragraphId) {
        text += '\n'
      }

      text += splitGraphemes(
        target.run.inlines.flatMap((inline) => inline.kind === 'text' ? [inline.text] : []).join('')
      )
        .slice(target.selectedStartGraphemeIndex, target.selectedEndGraphemeIndex)
        .join('')
      previousParagraphId = target.paragraphId
    }

    return text
  }

  /**
   * 读取当前选区的 HTML 剪贴板片段。
   */
  protected readSelectionHtml(): string {
    return readSelectionHtmlFromProjection(this.currentProjection, this.currentSelection)
  }

  /**
   * 选中当前文档内的全部文本。
   */
  protected selectAllTextFromRuntime(): void {
    const selection = createAllTextSelection(this.currentProjection, this.currentProjection.document.id)

    if (selection === undefined) {
      return
    }

    this.setSelection(selection)
  }

  /**
   * 当前位置如果紧邻图片 run，则优先复用现有图片删除命令。
   */
  protected tryDeleteAdjacentImageFromRuntime(
    position: TextPosition,
    direction: 'backward' | 'forward'
  ): boolean {
    const paragraph = this.findProjectionParagraph(position.blockId)

    if (paragraph === undefined) {
      return false
    }

    const imageRun = this.resolveAdjacentImageRun(paragraph, position, direction)

    if (imageRun === undefined) {
      return false
    }

    const imageSelection = createSelectionState(
      createRuntimeAnchor({
        documentId: this.currentProjection.document.id,
        sectionId: position.sectionId,
        blockId: position.blockId,
        runId: imageRun.id,
        graphemeIndex: 0
      }),
      createRuntimeAnchor({
        documentId: this.currentProjection.document.id,
        sectionId: position.sectionId,
        blockId: position.blockId,
        runId: imageRun.id,
        graphemeIndex: 0
      })
    )
    const command = buildDeleteSelectedImageCommand(this.currentProjection, imageSelection)

    if (command === null) {
      return false
    }

    const selectionAfter = createSelectionState(
      createRuntimeAnchor({
        documentId: this.currentProjection.document.id,
        ...position
      }),
      createRuntimeAnchor({
        documentId: this.currentProjection.document.id,
        ...position
      })
    )

    this.executeCommand(command, { selectionAfter })

    return true
  }

  /**
   * 把当前光标边界解析成“可直接删除的相邻图片 run”。
   */
  protected resolveAdjacentImageRun(
    paragraph: Paragraph,
    position: TextPosition,
    direction: 'backward' | 'forward'
  ): Run | undefined {
    const runIndex = paragraph.runs.findIndex((candidate) => candidate.id === position.runId)

    if (runIndex < 0) {
      return undefined
    }

    const currentRun = paragraph.runs[runIndex]

    if (currentRun === undefined) {
      return undefined
    }

    const currentRunLength = this.readProjectionRunGraphemeLength(currentRun)

    if (direction === 'backward') {
      if (
        position.assoc !== undefined
        && position.assoc < 0
        && position.graphemeIndex === currentRunLength
      ) {
        return this.findAdjacentImageRunThroughEmptyText(paragraph.runs, runIndex + 1, 1)
      }

      if (position.graphemeIndex === 0) {
        return this.findAdjacentImageRunThroughEmptyText(paragraph.runs, runIndex - 1, -1)
      }

      return undefined
    }

    if (position.graphemeIndex !== currentRunLength) {
      return undefined
    }

    return this.findAdjacentImageRunThroughEmptyText(paragraph.runs, runIndex + 1, 1)
  }

  /**
   * 连续图片之间可能夹着多个空文本尾 run，这里要跨过去找到真正可删的图片。
   */
  protected findAdjacentImageRunThroughEmptyText(
    runs: readonly Run[],
    startIndex: number,
    step: -1 | 1
  ): Run | undefined {
    for (let index = startIndex; index >= 0 && index < runs.length; index += step) {
      const run = runs[index]

      if (this.isSingleImageRun(run)) {
        return run
      }

      if (!this.isEmptyTextRun(run)) {
        return undefined
      }
    }

    return undefined
  }

  /**
   * 只把“单一 image inline 的 run”视为第一版图片目标。
   */
  protected isSingleImageRun(run: Run | undefined): run is Run {
    return run?.inlines.length === 1 && run.inlines[0]?.kind === 'image'
  }

  /**
   * 多图连续插入后，空文本尾 run 只是 caret 占位，不应阻断继续删图。
   */
  protected isEmptyTextRun(run: Run | undefined): boolean {
    return run !== undefined
      && run.inlines.every((inline) => inline.kind === 'text')
      && this.readProjectionRunText(run).length === 0
  }

  /**
   * 读取 projection run 里的纯文本内容。
   */
  protected readProjectionRunText(run: Run): string {
    return run.inlines.flatMap((inline) => inline.kind === 'text' ? [inline.text] : []).join('')
  }

  /**
   * 读取 projection run 的 grapheme 长度，避免把图片 run 误判成可删文本。
   */
  protected readProjectionRunGraphemeLength(run: Run): number {
    return countGraphemes(this.readProjectionRunText(run))
  }

  /**
   * 从当前只读 projection 里找到目标段落，兼容未来表格单元格内图片。
   */
  protected findProjectionParagraph(blockId: string): Paragraph | undefined {
    for (const section of this.currentProjection.document.sections) {
      const paragraph = this.findProjectionParagraphInBlocks(section.blocks, blockId)

      if (paragraph !== undefined) {
        return paragraph
      }
    }

    return undefined
  }

  /**
   * 递归遍历块树，返回匹配 blockId 的段落。
   */
  protected findProjectionParagraphInBlocks(
    blocks: readonly import('../model/types').Block[],
    blockId: string
  ): Paragraph | undefined {
    for (const block of blocks) {
      if (block.kind === 'paragraph' && block.id === blockId) {
        return block
      }

      if (block.kind === 'table') {
        for (const row of block.rows) {
          for (const cell of row.cells) {
            const paragraph = this.findProjectionParagraphInBlocks(cell.blocks, blockId)

            if (paragraph !== undefined) {
              return paragraph
            }
          }
        }
      }
    }

    return undefined
  }

  /**
   * 选区一次删掉多张图片时，只有资源在文档内不再被任何图片引用时才清理资源表。
   */
  protected collectFullyDeletedImageResourceIds(
    runs: readonly Readonly<{
      run: Run
    }>[]
  ): readonly string[] {
    const selectedCounts = new Map<string, number>()

    for (const target of runs) {
      const resourceId = this.readSingleImageResourceId(target.run)

      if (resourceId === undefined) {
        continue
      }

      selectedCounts.set(resourceId, (selectedCounts.get(resourceId) ?? 0) + 1)
    }

    const resourceIds: string[] = []

    for (const [resourceId, selectedCount] of selectedCounts) {
      if (this.countImageResourceReferences(resourceId) <= selectedCount) {
        resourceIds.push(resourceId)
      }
    }

    return Object.freeze(resourceIds)
  }

  /**
   * 统计当前 projection 里某个图片资源还被多少 image inline 引用。
   */
  protected countImageResourceReferences(resourceId: string): number {
    let count = 0

    for (const section of this.currentProjection.document.sections) {
      count += this.countImageResourceReferencesInBlocks(section.blocks, resourceId)
    }

    return count
  }

  /**
   * 递归统计段落/表格内的图片资源引用数。
   */
  protected countImageResourceReferencesInBlocks(
    blocks: readonly import('../model/types').Block[],
    resourceId: string
  ): number {
    let count = 0

    for (const block of blocks) {
      if (block.kind === 'paragraph') {
        for (const run of block.runs) {
          const imageResourceId = this.readSingleImageResourceId(run)

          if (imageResourceId === resourceId) {
            count += 1
          }
        }

        continue
      }

      for (const row of block.rows) {
        for (const cell of row.cells) {
          count += this.countImageResourceReferencesInBlocks(cell.blocks, resourceId)
        }
      }
    }

    return count
  }

  /**
   * 只在第一版单图片 run 上读取资源 id，避免把普通文本 run 混进图片删除计划。
   */
  protected readSingleImageResourceId(run: Run | undefined): string | undefined {
    if (run === undefined || run.inlines.length !== 1) {
      return undefined
    }

    const inline = run.inlines[0]

    return inline?.kind === 'image' ? inline.resourceId : undefined
  }

  protected deleteBackwardFromRuntime(): void {
    const selection = this.currentSelection

    if (selection === null) {
      return
    }

    if (!isSelectionCollapsed(selection)) {
      this.deleteSelectedTextFromRuntime()
      return
    }

    const position = this.resolveTextPosition(selection.focus)
    const paragraphs = collectParagraphRuntimeContexts(this.currentProjection)
    const paragraph = paragraphs.find((candidate) => candidate.blockId === position.blockId)

    if (paragraph === undefined) {
      return
    }

    if (this.tryDeleteAdjacentImageFromRuntime(position, 'backward')) {
      return
    }

    if (position.graphemeIndex > 0) {
      const selectionAfter = createSelectionState(
        createRuntimeAnchor({
          documentId: this.currentProjection.document.id,
          sectionId: position.sectionId,
          blockId: position.blockId,
          runId: position.runId,
          graphemeIndex: position.graphemeIndex - 1
        }),
        createRuntimeAnchor({
          documentId: this.currentProjection.document.id,
          sectionId: position.sectionId,
          blockId: position.blockId,
          runId: position.runId,
          graphemeIndex: position.graphemeIndex - 1
        })
      )

      this.executeCommand(
        {
          name: 'deleteBackward',
          operations: [{
            kind: 'deleteRange',
            range: {
              anchor: {
                ...position,
                graphemeIndex: position.graphemeIndex - 1
              },
              focus: position
            }
          }]
        },
        { selectionAfter }
      )
      return
    }

    if (this.tryDeleteAcrossRunTextFromRuntime(position, 'backward')) {
      return
    }

    const paragraphIndex = paragraphs.indexOf(paragraph)
    const previousParagraph = paragraphIndex > 0 ? paragraphs[paragraphIndex - 1] : undefined

    if (previousParagraph === undefined || paragraph.runs[0]?.id !== position.runId) {
      return
    }

    const selectionCaret = this.resolveParagraphBackwardDeleteCaret(previousParagraph)

    this.executeCommand(
      {
        name: 'mergeParagraphBackward',
        operations: [{
          kind: 'mergeBlock',
          targetBlockId: previousParagraph.blockId,
          sourceBlockId: paragraph.blockId
        }]
      },
      {
        selectionAfter: createSelectionState(
          createRuntimeAnchor({
            documentId: this.currentProjection.document.id,
            sectionId: previousParagraph.sectionId,
            blockId: previousParagraph.blockId,
            ...selectionCaret
          }),
          createRuntimeAnchor({
            documentId: this.currentProjection.document.id,
            sectionId: previousParagraph.sectionId,
            blockId: previousParagraph.blockId,
            ...selectionCaret
          })
        )
      }
    )
  }

  /**
   * Backspace 合并段落后，光标应落在上一段最后一个还能继续删除的位置。
   */
  protected resolveParagraphBackwardDeleteCaret(paragraph: Readonly<{
    runs: readonly Readonly<{
      id: string
      graphemeLength: number
    }>[]
  }>): Readonly<{
    runId: string
    graphemeIndex: number
  }> {
    const paragraphTail = this.findParagraphTailDeleteCaret(paragraph)

    if (paragraphTail !== undefined) {
      return paragraphTail
    }

    const firstRun = paragraph.runs[0]

    return {
      runId: firstRun!.id,
      graphemeIndex: 0
    }
  }

  /**
   * 查找一段里最后一个仍可继续删除的位置；空格等尾部文本也属于有效删除目标。
   */
  protected findParagraphTailDeleteCaret(paragraph: Readonly<{
    runs: readonly Readonly<{
      id: string
      graphemeLength: number
    }>[]
  }>): Readonly<{
    runId: string
    graphemeIndex: number
  }> | undefined {
    for (let index = paragraph.runs.length - 1; index >= 0; index -= 1) {
      const run = paragraph.runs[index]

      if (run !== undefined && run.graphemeLength > 0) {
        return {
          runId: run.id,
          graphemeIndex: run.graphemeLength
        }
      }
    }

    return undefined
  }

  protected deleteForwardFromRuntime(): void {
    const selection = this.currentSelection

    if (selection === null) {
      return
    }

    if (!isSelectionCollapsed(selection)) {
      this.deleteSelectedTextFromRuntime()
      return
    }

    const position = this.resolveTextPosition(selection.focus)
    const paragraphs = collectParagraphRuntimeContexts(this.currentProjection)
    const paragraph = paragraphs.find((candidate) => candidate.blockId === position.blockId)

    if (paragraph === undefined) {
      return
    }

    const currentRun = paragraph.runs.find((candidate) => candidate.id === position.runId)

    if (currentRun === undefined) {
      return
    }

    if (this.tryDeleteAdjacentImageFromRuntime(position, 'forward')) {
      return
    }

    if (position.graphemeIndex < currentRun.graphemeLength) {
      const selectionAfter = createSelectionState(
        createRuntimeAnchor({
          documentId: this.currentProjection.document.id,
          ...position
        }),
        createRuntimeAnchor({
          documentId: this.currentProjection.document.id,
          ...position
        })
      )

      this.executeCommand(
        {
          name: 'deleteForward',
          operations: [{
            kind: 'deleteRange',
            range: {
              anchor: position,
              focus: {
                ...position,
                graphemeIndex: position.graphemeIndex + 1
              }
            }
          }]
        },
        { selectionAfter }
      )
      return
    }

    if (this.tryDeleteAcrossRunTextFromRuntime(position, 'forward')) {
      return
    }

    const paragraphIndex = paragraphs.indexOf(paragraph)
    const nextParagraph = paragraphIndex >= 0 ? paragraphs[paragraphIndex + 1] : undefined

    if (nextParagraph === undefined || paragraph.runs[paragraph.runs.length - 1]?.id !== position.runId) {
      return
    }

    const nextRun = nextParagraph.runs[0]

    if (nextRun === undefined) {
      return
    }

    const selectionCaret = this.resolveParagraphForwardDeleteCaret(paragraph, nextParagraph)

    this.executeCommand(
      {
        name: 'mergeParagraphForward',
        operations: [{
          kind: 'mergeBlock',
          targetBlockId: paragraph.blockId,
          sourceBlockId: nextParagraph.blockId
        }]
      },
      {
        selectionAfter: createSelectionState(
          createRuntimeAnchor({
            documentId: this.currentProjection.document.id,
            sectionId: paragraph.sectionId,
            blockId: paragraph.blockId,
            ...selectionCaret
          }),
          createRuntimeAnchor({
            documentId: this.currentProjection.document.id,
            sectionId: paragraph.sectionId,
            blockId: paragraph.blockId,
            ...selectionCaret
          })
        )
      }
    )
  }

  /**
   * Delete 合并下一段后，优先保留当前段尾部位置；当前段为空时退到下一段首个可见位置。
   */
  protected resolveParagraphForwardDeleteCaret(
    paragraph: Readonly<{
      runs: readonly Readonly<{
        id: string
        graphemeLength: number
      }>[]
    }>,
    nextParagraph: Readonly<{
      runs: readonly Readonly<{
        id: string
        graphemeLength: number
      }>[]
    }>
  ): Readonly<{
    runId: string
    graphemeIndex: number
  }> {
    const paragraphTail = this.findParagraphTailDeleteCaret(paragraph)

    if (paragraphTail !== undefined) {
      return paragraphTail
    }

    for (let index = 0; index < nextParagraph.runs.length; index += 1) {
      const run = nextParagraph.runs[index]

      if (run !== undefined && run.graphemeLength > 0) {
        return {
          runId: run.id,
          graphemeIndex: 0
        }
      }
    }

    return {
      runId: paragraph.runs[0]!.id,
      graphemeIndex: 0
    }
  }

  /**
   * 光标卡在 run 边界时，继续跨过空文本占位 run，删除真正相邻的文本字符。
   */
  protected tryDeleteAcrossRunTextFromRuntime(
    position: TextPosition,
    direction: 'backward' | 'forward'
  ): boolean {
    const paragraph = this.findProjectionParagraph(position.blockId)

    if (paragraph === undefined) {
      return false
    }

    const runIndex = paragraph.runs.findIndex((candidate) => candidate.id === position.runId)

    if (runIndex < 0) {
      return false
    }

    const startIndex = direction === 'backward' ? runIndex - 1 : runIndex + 1
    const step = direction === 'backward' ? -1 : 1

    for (let index = startIndex; index >= 0 && index < paragraph.runs.length; index += step) {
      const run = paragraph.runs[index]

      if (run === undefined) {
        continue
      }

      if (this.readSingleImageResourceId(run) !== undefined) {
        return false
      }

      if (this.isEmptyTextRun(run)) {
        continue
      }

      const graphemeLength = this.readProjectionRunGraphemeLength(run)

      if (graphemeLength <= 0) {
        continue
      }

      const anchor = direction === 'backward'
        ? {
            sectionId: position.sectionId,
            blockId: position.blockId,
            runId: run.id,
            graphemeIndex: graphemeLength - 1
          }
        : {
            sectionId: position.sectionId,
            blockId: position.blockId,
            runId: run.id,
            graphemeIndex: 0
          }
      const focus = direction === 'backward'
        ? {
            sectionId: position.sectionId,
            blockId: position.blockId,
            runId: run.id,
            graphemeIndex: graphemeLength
          }
        : {
            sectionId: position.sectionId,
            blockId: position.blockId,
            runId: run.id,
            graphemeIndex: 1
          }
      const selectionAfterPosition = direction === 'backward'
        ? anchor
        : position

      this.executeCommand(
        {
          name: direction === 'backward' ? 'deleteBackward' : 'deleteForward',
          operations: [{
            kind: 'deleteRange',
            range: {
              anchor,
              focus
            }
          }]
        },
        {
          selectionAfter: createSelectionState(
            createRuntimeAnchor({
              documentId: this.currentProjection.document.id,
              ...selectionAfterPosition
            }),
            createRuntimeAnchor({
              documentId: this.currentProjection.document.id,
              ...selectionAfterPosition
            })
          )
        }
      )

      return true
    }

    return false
  }

  protected splitParagraphFromRuntime(): void {
    const selection = this.currentSelection

    if (selection === null || !isSelectionCollapsed(selection)) {
      return
    }

    const position = this.resolveTextPosition(selection.focus)
    const identifiers = allocateParagraphSplitIds(this.currentProjection)
    const selectionAfter = createSelectionState(
      createRuntimeAnchor({
        documentId: this.currentProjection.document.id,
        sectionId: position.sectionId,
        blockId: identifiers.blockId,
        runId: identifiers.runId,
        graphemeIndex: 0
      }),
      createRuntimeAnchor({
        documentId: this.currentProjection.document.id,
        sectionId: position.sectionId,
        blockId: identifiers.blockId,
        runId: identifiers.runId,
        graphemeIndex: 0
      })
    )

    this.executeCommand(
      {
        name: 'splitParagraph',
        operations: [{
          kind: 'splitBlock',
          at: position,
          newBlockId: identifiers.blockId,
          newRunId: identifiers.runId
        }]
      },
      { selectionAfter }
    )
  }

  protected moveSelectionHorizontally(delta: -1 | 1): void {
    const selection = this.currentSelection

    if (selection === null) {
      return
    }

    if (!isSelectionCollapsed(selection)) {
      const anchor = delta < 0
        ? selection.direction === 'backward' ? selection.focus : selection.anchor
        : selection.direction === 'backward' ? selection.anchor : selection.focus

      this.setSelection(createSelectionState(anchor, anchor))
      return
    }

    const nextPosition = moveTextPosition(this.currentProjection, this.resolveTextPosition(selection.focus), delta)

    if (nextPosition === undefined) {
      return
    }

    this.setSelection(createSelectionState(
      createRuntimeAnchor({
        documentId: this.currentProjection.document.id,
        ...nextPosition
      }),
      createRuntimeAnchor({
        documentId: this.currentProjection.document.id,
        ...nextPosition
      })
    ))
  }

  protected moveSelectionVertically(direction: -1 | 1): void {
    const selection = this.currentSelection

    if (selection === null) {
      return
    }

    if (!isSelectionCollapsed(selection)) {
      const anchor = direction < 0
        ? selection.direction === 'backward' ? selection.focus : selection.anchor
        : selection.direction === 'backward' ? selection.anchor : selection.focus

      this.setSelection(createSelectionState(anchor, anchor))
      return
    }

    const focus = this.resolveTextPosition(selection.focus)
    const layout = this.ensureCurrentLayout()
    const caretRect = getLayoutCaretRect(layout, focus)
    const lines = flattenLayoutLines(layout)

    if (caretRect === undefined) {
      return
    }

    const currentLineIndex = lines.findIndex((line) =>
      line.pageIndex === caretRect.pageIndex
      && line.y === caretRect.y
      && line.height === caretRect.height
    )

    if (currentLineIndex < 0) {
      return
    }

    const targetLine = lines[currentLineIndex + direction]
    const targetPosition = targetLine === undefined
      ? undefined
      : hitTestLineAtAbsoluteX(layout, targetLine, caretRect.x)

    if (targetPosition === undefined) {
      return
    }

    this.setSelection(createSelectionState(
      createRuntimeAnchor({
        documentId: this.currentProjection.document.id,
        ...targetPosition
      }),
      createRuntimeAnchor({
        documentId: this.currentProjection.document.id,
        ...targetPosition
      })
    ))
  }

  protected moveSelectionToLineBoundary(boundary: 'start' | 'end'): void {
    const selection = this.currentSelection

    if (selection === null) {
      return
    }

    const focus = this.resolveTextPosition(selection.focus)
    const layout = this.ensureCurrentLayout()
    const caretRect = getLayoutCaretRect(layout, focus)

    if (caretRect === undefined) {
      return
    }

    const line = flattenLayoutLines(layout).find((candidate) =>
      candidate.pageIndex === caretRect.pageIndex
      && candidate.y === caretRect.y
      && candidate.height === caretRect.height
    )
    const targetPosition = line === undefined
      ? undefined
      : resolveLineBoundaryPosition(line, boundary)

    if (targetPosition === undefined) {
      return
    }

    this.setSelection(createSelectionState(
      createRuntimeAnchor({
        documentId: this.currentProjection.document.id,
        ...targetPosition
      }),
      createRuntimeAnchor({
        documentId: this.currentProjection.document.id,
        ...targetPosition
      })
    ))
  }

  protected toggleRuntimeBold(): void {
    const command = buildSetBoldCommand(
      this.currentProjection,
      this.currentSelection,
      this.getSelectionFormattingState().run?.bold.value !== true
    )

    if (command === null) {
      return
    }

    this.executeCommand(command, {
      selectionAfter: this.currentSelection
    })
  }

  protected toggleRuntimeItalic(): void {
    const command = buildSetItalicCommand(
      this.currentProjection,
      this.currentSelection,
      this.getSelectionFormattingState().run?.italic.value !== true
    )

    if (command === null) {
      return
    }

    this.executeCommand(command, {
      selectionAfter: this.currentSelection
    })
  }
}

function collectProjectionRunIds(
  projection: import('../model/projection').DocumentProjection
): Set<string> {
  return new Set(
    collectParagraphRuntimeContexts(projection).flatMap((paragraph) => paragraph.runs.map((run) => run.id))
  )
}

function allocateGeneratedRuntimeRunId(
  usedRunIds: Set<string>,
  runId: string,
  suffix: 'format' | 'tail'
): string {
  let sequence = 1
  let candidate = `${runId}__${suffix}-${sequence}`

  while (usedRunIds.has(candidate)) {
    sequence += 1
    candidate = `${runId}__${suffix}-${sequence}`
  }

  usedRunIds.add(candidate)

  return candidate
}
