/**
 * 职责：构造已清洗富文本片段插入命令与新增 run 局部格式/链接操作。
 * 边界：只面向结构化富文本片段生成 operation，不读取剪贴板原始 HTML。
 * 协作模块：删除计划层、富文本辅助模块、文本运行时与事务流水线。
 * 性能/安全约束：只格式化本次新增文本，链接输入已由上游清洗，命令统一进入事务流水线。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/03-architecture.md 与 05-implementation-gates.md#gate-3---输入与基础编辑。
 */

import { countGraphemes } from '../shared/grapheme'
import { createSelectionState } from '../model/selection'
import type { ModelProperties, RunLink } from '../model/types'
import type { Command, Operation, TextPosition } from '../operations/transaction'
import {
  allocateParagraphSplitIds,
  collectParagraphRuntimeContexts,
  createRuntimeAnchor
} from './text-runtime'
import {
  allocateGeneratedRuntimeRunId,
  appendRichTextParagraphPropertyOperations,
  collectProjectionRunIds,
  hasModelProperties,
  type NormalizedRichTextParagraph
} from './rich-text-runtime-helpers'
import { JWordEditorDeletePlanRuntime } from './delete-plan'

export abstract class JWordEditorRichTextFragmentRuntime extends JWordEditorDeletePlanRuntime {
  protected buildRichTextInsertCommand(
    start: TextPosition,
    paragraphs: readonly NormalizedRichTextParagraph[],
    leadingOperations: readonly Operation[]
  ): Readonly<{
    command: Command
    selectionAfter: ReturnType<typeof createSelectionState>
  }> | undefined {
    const operations: Operation[] = [...leadingOperations]
    const usedRunIds = collectProjectionRunIds(this.currentProjection)
    const paragraphIds: string[] = [start.blockId]
    let currentPosition: TextPosition = { ...start }
    let currentRunId = start.runId
    let currentBlockId = start.blockId
    let currentRunGraphemeLength = this.resolveRuntimeRunGraphemeLength(start)

    for (let paragraphIndex = 0; paragraphIndex < paragraphs.length; paragraphIndex += 1) {
      const paragraph = paragraphs[paragraphIndex]

      if (paragraph === undefined) {
        continue
      }

      for (const run of paragraph.runs) {
        const insertedStartGraphemeIndex = currentPosition.graphemeIndex
        const insertedGraphemeLength = countGraphemes(run.text)
        const link = run.link
        let linkStartGraphemeIndex = insertedStartGraphemeIndex
        let linkRunGraphemeLength = currentRunGraphemeLength + insertedGraphemeLength

        operations.push({
          kind: 'insertText',
          at: currentPosition,
          text: run.text
        })
        currentRunGraphemeLength += insertedGraphemeLength
        currentPosition = {
          ...currentPosition,
          runId: currentRunId,
          blockId: currentBlockId,
          graphemeIndex: insertedStartGraphemeIndex + insertedGraphemeLength
        }

        if (hasModelProperties(run.properties)) {
          const pendingCaret = this.appendPendingCollapsedRunPropertiesToInsertedText(
            operations,
            usedRunIds,
            currentRunId,
            insertedStartGraphemeIndex,
            insertedGraphemeLength,
            currentRunGraphemeLength,
            run.properties
          )

          currentRunId = pendingCaret.runId
          currentRunGraphemeLength = insertedGraphemeLength
          linkStartGraphemeIndex = 0
          linkRunGraphemeLength = insertedGraphemeLength
          currentPosition = {
            ...currentPosition,
            runId: currentRunId,
            graphemeIndex: pendingCaret.graphemeIndex
          }
        }

        if (link !== undefined) {
          const pendingCaret = this.appendRichTextRunLinkToInsertedText(
            operations,
            usedRunIds,
            currentRunId,
            linkStartGraphemeIndex,
            insertedGraphemeLength,
            linkRunGraphemeLength,
            link
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

      if (paragraphIndex >= paragraphs.length - 1) {
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
      usedRunIds.add(identifiers.runId)
      paragraphIds.push(identifiers.blockId)
      currentBlockId = identifiers.blockId
      currentRunId = identifiers.runId
      currentRunGraphemeLength = splitRunTailGraphemeLength
      currentPosition = {
        sectionId: currentPosition.sectionId,
        blockId: currentBlockId,
        runId: currentRunId,
        graphemeIndex: 0
      }
    }

    appendRichTextParagraphPropertyOperations(operations, paragraphs, paragraphIds)

    if (operations.length === leadingOperations.length) {
      return undefined
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
        name: 'pasteRichText',
        operations
      },
      selectionAfter
    }
  }

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
   * 把富文本粘贴中的安全链接只补到本次新增文本上。
   */
  protected appendRichTextRunLinkToInsertedText(
    operations: Operation[],
    usedRunIds: Set<string>,
    runId: string,
    startGraphemeIndex: number,
    insertedGraphemeLength: number,
    graphemeLengthAfterInsert: number,
    link: RunLink
  ): Readonly<{
    runId: string
    graphemeIndex: number
  }> {
    if (startGraphemeIndex === 0 && insertedGraphemeLength === graphemeLengthAfterInsert) {
      operations.push({
        kind: 'setRunLink',
        runId,
        link
      })

      return {
        runId,
        graphemeIndex: insertedGraphemeLength
      }
    }

    const linkedRunId = startGraphemeIndex > 0
      ? allocateGeneratedRuntimeRunId(usedRunIds, runId, 'link')
      : runId
    const endGraphemeIndex = startGraphemeIndex + insertedGraphemeLength

    operations.push({
      kind: 'setRunLink',
      runId,
      link,
      range: {
        startGraphemeIndex,
        endGraphemeIndex,
        ...(startGraphemeIndex > 0 ? { linkedRunId } : {}),
        ...(endGraphemeIndex < graphemeLengthAfterInsert
          ? { trailingRunId: allocateGeneratedRuntimeRunId(usedRunIds, runId, 'tail') }
          : {})
      }
    })

    return {
      runId: linkedRunId,
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
}
