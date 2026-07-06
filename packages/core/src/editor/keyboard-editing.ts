/**
 * 职责：实现文本编辑 runtime 的 Backspace/Delete、跨 run 删除和快捷加粗/斜体命令。
 * 边界：不绑定 DOM 键盘事件，只提供 input runtime 调用的编辑能力。
 * 协作模块：段落拆分层、删除计划层、文本运行时、格式命令构建器与事务流水线。
 * 性能/安全约束：键盘编辑只构造最小 operation，并保持所有变更带 origin 进入事务流水线。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/03-architecture.md 与 05-implementation-gates.md#gate-3---输入与基础编辑。
 */

import {
  buildSetBoldCommand,
  buildSetItalicCommand
} from '../operations/command-builders'
import { createSelectionState, isSelectionCollapsed } from '../model/selection'
import type { TextPosition } from '../operations/transaction'
import {
  collectParagraphRuntimeContexts,
  createRuntimeAnchor
} from './text-runtime'
import { JWordEditorParagraphSplitRuntime } from './paragraph-split'

export abstract class JWordEditorKeyboardEditingRuntime extends JWordEditorParagraphSplitRuntime {
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
