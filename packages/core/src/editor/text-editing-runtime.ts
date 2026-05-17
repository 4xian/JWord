/**
 * 职责：实现 editor runtime 的纯文本插入、删除、段落拆分、光标移动和快捷格式命令。
 * 边界：不绑定 DOM 事件，不处理 pointer 命中，不创建文档模型。
 * 协作模块：input runtime 调用这里的文本编辑能力，selection、transaction 和 text-runtime helper 提供状态边界。
 * 性能/安全约束：所有编辑命令统一进入 transaction pipeline，不直接改 projection，不访问 top-level DOM。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/03-architecture.md 与 05-implementation-gates.md#gate-3---输入与基础编辑。
 */
import { buildSetBoldCommand, buildSetItalicCommand } from '../operations/command-builders'
import { countGraphemes, splitGraphemes } from '../shared/grapheme'
import { getCaretRect as getLayoutCaretRect } from '../layout/runtime'
import { createSelectionState, isSelectionCollapsed } from '../model/selection'
import { collectSelectionTargets } from '../model/selection-targets'
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
    let currentPosition: TextPosition = { ...start }
    let currentRunId = start.runId
    let currentBlockId = start.blockId

    if (parts.length === 1 && parts[0]?.length === 0 && leadingOperations.length === 0) {
      return undefined
    }

    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index] ?? ''

      if (part.length > 0) {
        operations.push({
          kind: 'insertText',
          at: currentPosition,
          text: part
        })

        currentPosition = {
          ...currentPosition,
          runId: currentRunId,
          blockId: currentBlockId,
          graphemeIndex: currentPosition.graphemeIndex + countGraphemes(part)
        }
      }

      if (index >= parts.length - 1) {
        continue
      }

      const identifiers = allocateParagraphSplitIds(this.currentProjection, operations)

      operations.push({
        kind: 'splitBlock',
        at: currentPosition,
        newBlockId: identifiers.blockId,
        newRunId: identifiers.runId
      })

      currentBlockId = identifiers.blockId
      currentRunId = identifiers.runId
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

    for (let paragraphIndex = endParagraphIndex; paragraphIndex >= startParagraphIndex; paragraphIndex -= 1) {
      const paragraph = paragraphs[paragraphIndex]

      if (paragraph === undefined) {
        continue
      }

      const paragraphStartRunIndex = paragraphIndex === startParagraphIndex ? startRunIndex : 0
      const paragraphEndRunIndex = paragraphIndex === endParagraphIndex ? endRunIndex : paragraph.runs.length - 1

      for (let runIndex = paragraphEndRunIndex; runIndex >= paragraphStartRunIndex; runIndex -= 1) {
        const run = paragraph.runs[runIndex]

        if (run === undefined) {
          continue
        }

        const selectedStartGraphemeIndex = paragraphIndex === startParagraphIndex && runIndex === startRunIndex
          ? range.start.graphemeIndex
          : 0
        const selectedEndGraphemeIndex = paragraphIndex === endParagraphIndex && runIndex === endRunIndex
          ? range.end.graphemeIndex
          : run.graphemeLength

        if (selectedEndGraphemeIndex <= selectedStartGraphemeIndex) {
          continue
        }

        operations.push({
          kind: 'deleteRange',
          range: {
            anchor: {
              sectionId: paragraph.sectionId,
              blockId: paragraph.blockId,
              runId: run.id,
              graphemeIndex: selectedStartGraphemeIndex
            },
            focus: {
              sectionId: paragraph.sectionId,
              blockId: paragraph.blockId,
              runId: run.id,
              graphemeIndex: selectedEndGraphemeIndex
            }
          }
        })
      }
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

  protected deleteBackwardFromRuntime(): void {
    const selection = this.currentSelection

    if (selection === null || !isSelectionCollapsed(selection)) {
      return
    }

    const position = this.resolveTextPosition(selection.focus)
    const paragraphs = collectParagraphRuntimeContexts(this.currentProjection)
    const paragraph = paragraphs.find((candidate) => candidate.blockId === position.blockId)

    if (paragraph === undefined) {
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

    if (selection === null || !isSelectionCollapsed(selection)) {
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
