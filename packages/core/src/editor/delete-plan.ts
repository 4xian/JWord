/**
 * 职责：构造文本选区删除计划，并处理图片 run 与资源清理相关删除辅助。
 * 边界：只生成删除相关 operation 并复用事务入口，不处理键盘事件分发。
 * 协作模块：runtime-selection、selection-targets、图片命令构建器与 transaction pipeline。
 * 性能/安全约束：删除前只遍历选区命中的 run 和 projection 引用计数，不直接写 Projection。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/03-architecture.md 与 05-implementation-gates.md#gate-3---输入与基础编辑。
 */

import { buildDeleteSelectedImageCommand } from '../operations/command-builders'
import { createSelectionState } from '../model/selection'
import { collectSelectionTargets } from '../model/selection-targets'
import type { Paragraph, Run } from '../model/types'
import type { Operation, TextPosition } from '../operations/transaction'
import { collectParagraphRuntimeContexts, createRuntimeAnchor } from './text-runtime'
import { JWordEditorRuntimeSelection } from './runtime-selection'

export abstract class JWordEditorDeletePlanRuntime extends JWordEditorRuntimeSelection {
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
}
