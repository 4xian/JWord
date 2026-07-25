/**
 * 职责：承载纯文本输入、选区替换与结构化富文本粘贴入口。
 * 边界：只构造文本插入/替换命令，不处理 DOM 事件和剪贴板安全清洗。
 * 协作模块：富文本片段层、删除计划层、文本运行时与输入运行时。
 * 性能/安全约束：所有文本变更统一封装为 command 后进入 transaction pipeline。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import { countGraphemes } from '../shared/grapheme'
import { createSelectionState, isSelectionCollapsed } from '../model/selection'
import type { Command, Operation, TextPosition } from '../operations/transaction'
import type { EditorRichTextFragment } from './types'
import {
  allocateParagraphSplitIds,
  createRuntimeAnchor,
  normalizePlainText
} from './text-runtime'
import {
  collectProjectionRunIds,
  normalizeRichTextParagraphs
} from './rich-text-runtime-helpers'
import { JWordEditorRichTextFragmentRuntime } from './rich-text-fragment'

export abstract class JWordEditorPastePlanRuntime extends JWordEditorRichTextFragmentRuntime {
  /** 粘贴 UI 层已清洗过的结构化富文本片段。 */
  pasteRichTextFragment(fragment: EditorRichTextFragment): boolean {
    const selection = this.currentSelection
    const paragraphs = normalizeRichTextParagraphs(fragment)

    if (selection === null || paragraphs.length === 0) {
      return false
    }

    const selectedRange = isSelectionCollapsed(selection) ? undefined : this.resolveSelectedTextRange()
    const deletePlan = selectedRange === undefined ? undefined : this.buildDeleteSelectionPlan(selectedRange)
    const start = deletePlan?.caret ?? this.resolveTextPosition(selection.focus)
    const leadingOperations = deletePlan?.operations ?? []

    if (!isSelectionCollapsed(selection) && deletePlan === undefined) {
      return false
    }

    const command = this.buildRichTextInsertCommand(start, paragraphs, leadingOperations)

    if (command === undefined) {
      return false
    }

    this.executeCommand(command.command, {
      selectionAfter: command.selectionAfter
    })

    return true
  }

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

}
