/**
 * 职责：处理 Enter 拆分段落并在范围选区下先执行删除计划。
 * 边界：只构造 splitBlock 相关命令，不处理键盘事件监听或布局。
 * 协作模块：粘贴计划层、删除计划层、文本运行时与事务流水线。
 * 性能/安全约束：段落拆分只读取当前 selection 和 projection，不直接写 Y.Doc。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/03-architecture.md 与 05-implementation-gates.md#gate-3---输入与基础编辑。
 */

import { createSelectionState, isSelectionCollapsed } from '../model/selection'
import { allocateParagraphSplitIds, createRuntimeAnchor } from './text-runtime'
import { JWordEditorPastePlanRuntime } from './paste-plan'

export abstract class JWordEditorParagraphSplitRuntime extends JWordEditorPastePlanRuntime {
  protected splitParagraphFromRuntime(): void {
    const selection = this.currentSelection

    if (selection === null) {
      return
    }

    const selectedRange = isSelectionCollapsed(selection) ? undefined : this.resolveSelectedTextRange()
    const deletePlan = selectedRange === undefined ? undefined : this.buildDeleteSelectionPlan(selectedRange)

    if (!isSelectionCollapsed(selection) && deletePlan === undefined) {
      return
    }

    const position = deletePlan?.caret ?? this.resolveTextPosition(selection.focus)
    const leadingOperations = deletePlan?.operations ?? []
    const identifiers = allocateParagraphSplitIds(this.currentProjection, leadingOperations)
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
        operations: [
          ...leadingOperations,
          {
            kind: 'splitBlock',
            at: position,
            newBlockId: identifiers.blockId,
            newRunId: identifiers.runId
          }
        ]
      },
      { selectionAfter }
    )
  }
}
