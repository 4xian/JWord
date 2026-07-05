/**
 * 职责：承载键盘专用的逐词移动、PageUp/PageDown 和 Tab 编辑语义。
 * 边界：只扩展文本编辑 runtime 的键盘入口，不处理 DOM 事件绑定、不直接写 Y.Doc。
 * 协作模块：input-runtime 调用本模块，text-runtime 提供 word 边界，layout 查询提供行定位。
 * 性能/安全约束：所有编辑仍走 transaction pipeline，不访问顶层 DOM，不缓存跨事务状态。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/05-implementation-gates.md#gate-3---输入与基础编辑。
 */

import { cssPxToTwips } from '../layout/page-config'
import { getCaretRect as getLayoutCaretRect } from '../layout/runtime'
import { createSelectionState, isSelectionCollapsed } from '../model/selection'
import { collectSelectionTargets } from '../model/selection-targets'
import type { Block, TableCell } from '../model/types'
import { buildSetParagraphIndentCommand } from '../operations/command-builders'
import type { TextPosition } from '../operations/transaction'
import { flattenLayoutLines, hitTestLineAtAbsoluteX } from './rendering'
import { JWordEditorTextEditingRuntime } from './text-editing-runtime'
import { compareRuntimeTextPositions, createRuntimeAnchor, moveTextPositionByWord } from './text-runtime'

export abstract class JWordEditorKeyboardTextRuntime extends JWordEditorTextEditingRuntime {
  protected override deleteBackwardFromRuntime(wordWise = false): void {
    const selection = this.currentSelection

    if (!wordWise || selection === null || !isSelectionCollapsed(selection)) {
      super.deleteBackwardFromRuntime()
      return
    }

    if (!this.deleteWordFromRuntime(this.resolveTextPosition(selection.focus), 'backward')) {
      super.deleteBackwardFromRuntime()
    }
  }

  protected override deleteForwardFromRuntime(wordWise = false): void {
    const selection = this.currentSelection

    if (!wordWise || selection === null || !isSelectionCollapsed(selection)) {
      super.deleteForwardFromRuntime()
      return
    }

    if (!this.deleteWordFromRuntime(this.resolveTextPosition(selection.focus), 'forward')) {
      super.deleteForwardFromRuntime()
    }
  }

  protected override moveSelectionHorizontally(delta: -1 | 1, extending = false, wordWise = false): void {
    const selection = this.currentSelection

    if (!wordWise || selection !== null && !extending && !isSelectionCollapsed(selection)) {
      super.moveSelectionHorizontally(delta, extending)
      return
    }

    if (selection === null) {
      return
    }

    const nextPosition = moveTextPositionByWord(this.currentProjection, this.resolveTextPosition(selection.focus), delta)

    if (nextPosition !== undefined) {
      this.setSelectionToTextPosition(selection.anchor, nextPosition, extending)
    }
  }

  protected moveSelectionByPage(direction: -1 | 1, extending = false): void {
    const viewportHeight = this.mountedDom?.canvasContainer.clientHeight || this.pageConfig.contentHeightCssPx
    const averageLineHeight = cssPxToTwips(16 * 1.2, this.pageConfig.scale)
    const lineOffset = Math.max(1, Math.floor(cssPxToTwips(viewportHeight, this.pageConfig.scale) / averageLineHeight))

    this.moveSelectionByLineOffset(direction * lineOffset, extending)
  }

  protected handleTabFromRuntime(reverse = false): void {
    const selection = this.currentSelection

    if (selection !== null && isSelectionCollapsed(selection)) {
      const target = this.resolveTableCellTabTarget(this.resolveTextPosition(selection.focus), reverse)

      if (target !== undefined) {
        this.setSelectionToTextPosition(selection.anchor, target, false)
        return
      }
    }

    this.adjustParagraphIndentFromRuntime(reverse ? -360 : 360)
  }

  /** 按 PageUp/PageDown 的行数偏移移动 focus。 */
  private moveSelectionByLineOffset(lineOffset: number, extending: boolean): void {
    const selection = this.currentSelection
    const layout = this.ensureCurrentLayout()
    const focus = selection === null ? undefined : this.resolveTextPosition(selection.focus)
    const caretRect = focus === undefined ? undefined : getLayoutCaretRect(layout, focus)

    if (selection === null || caretRect === undefined) {
      return
    }

    const lines = flattenLayoutLines(layout)
    const currentLineIndex = lines.findIndex((line) =>
      line.pageIndex === caretRect.pageIndex && line.y === caretRect.y && line.height === caretRect.height
    )
    const targetLine = lines[Math.max(0, Math.min(lines.length - 1, currentLineIndex + lineOffset))]
    const targetPosition = targetLine === undefined ? undefined : hitTestLineAtAbsoluteX(layout, targetLine, caretRect.x)

    if (targetPosition !== undefined) {
      this.setSelectionToTextPosition(selection.anchor, targetPosition, extending)
    }
  }

  /** 按 Tab 语义调整段落缩进，不把焦点移出隐藏输入框。 */
  private adjustParagraphIndentFromRuntime(deltaTwips: number): void {
    const selection = this.currentSelection
    const target = collectSelectionTargets(this.currentProjection, selection).paragraphs[0]

    if (target === undefined) {
      return
    }

    const nextIndent = Math.max(0, Number(target.paragraph.properties?.indentLeftTwips ?? 0) + deltaTwips)
    const command = buildSetParagraphIndentCommand(this.currentProjection, selection, nextIndent)

    if (command !== null) {
      this.executeCommand(command, { selectionAfter: selection })
    }
  }

  /** 在表格单元格内按 Tab/Shift+Tab 跳到相邻单元格首个文本位置。 */
  private resolveTableCellTabTarget(position: TextPosition, reverse: boolean): TextPosition | undefined {
    for (const section of this.currentProjection.document.sections) {
      for (const block of section.blocks.filter((candidate) => candidate.kind === 'table')) {
        const cells = block.rows.flatMap((row) => row.cells)
        const currentIndex = cells.findIndex((cell) => containsBlockId(cell.blocks, position.blockId))
        const candidates = currentIndex < 0 ? [] : reverse ? cells.slice(0, currentIndex).reverse() : cells.slice(currentIndex + 1)

        for (const cell of candidates) {
          const target = readFirstTableCellTextPosition(section.id, cell)

          if (target !== undefined) {
            return target
          }
        }
      }
    }

    return undefined
  }

  /** 按 word 粒度删除一段文本，保持删除路径仍走 deleteRange 事务。 */
  private deleteWordFromRuntime(position: TextPosition, direction: 'backward' | 'forward'): boolean {
    const boundary = moveTextPositionByWord(this.currentProjection, position, direction === 'backward' ? -1 : 1)

    if (boundary === undefined || compareRuntimeTextPositions(this.currentProjection, position, boundary) === 0) {
      return false
    }

    const anchor = direction === 'backward' ? boundary : position
    const focus = direction === 'backward' ? position : boundary
    const selectionAfterPosition = direction === 'backward' ? boundary : position

    this.executeCommand({
      name: direction === 'backward' ? 'deleteWordBackward' : 'deleteWordForward',
      operations: [{ kind: 'deleteRange', range: { anchor, focus } }]
    }, {
      selectionAfter: createSelectionState(
        createRuntimeAnchor({ documentId: this.currentProjection.document.id, ...selectionAfterPosition }),
        createRuntimeAnchor({ documentId: this.currentProjection.document.id, ...selectionAfterPosition })
      )
    })

    return true
  }

}

/** 判断块列表是否包含指定 block。 */
function containsBlockId(blocks: readonly Block[], blockId: string): boolean {
  return blocks.some((block) =>
    block.id === blockId
    || block.kind === 'table' && block.rows.some((row) => row.cells.some((cell) => containsBlockId(cell.blocks, blockId)))
  )
}

/** 读取表格单元格首个可定位文本位置。 */
function readFirstTableCellTextPosition(sectionId: string, cell: TableCell): TextPosition | undefined {
  return readFirstTextPositionInBlocks(sectionId, cell.blocks)
}

/** 读取块列表首个可定位文本位置。 */
function readFirstTextPositionInBlocks(sectionId: string, blocks: readonly Block[]): TextPosition | undefined {
  for (const block of blocks) {
    if (block.kind === 'paragraph') {
      const run = block.runs[0]

      return run === undefined ? undefined : { sectionId, blockId: block.id, runId: run.id, graphemeIndex: 0 }
    }

    for (const row of block.rows) {
      for (const cell of row.cells) {
        const nested = readFirstTextPositionInBlocks(sectionId, cell.blocks)

        if (nested !== undefined) {
          return nested
        }
      }
    }
  }

  return undefined
}
