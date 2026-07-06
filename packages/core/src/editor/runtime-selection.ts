/**
 * 职责：承载文本编辑 runtime 的选区读取、全文选择、光标移动与 projection 只读定位辅助。
 * 边界：不构造编辑 operation，不执行事务，不处理 DOM 事件绑定。
 * 协作模块：文本编辑入口、删除计划层、键盘编辑层、布局运行时与剪贴板运行时。
 * 性能/安全约束：只读取当前 projection、selection 和 layout，不写 Y.Doc、不访问 top-level DOM。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/03-architecture.md 与 05-implementation-gates.md#gate-3---输入与基础编辑。
 */

import { countGraphemes, splitGraphemes } from '../shared/grapheme'
import { getCaretRect as getLayoutCaretRect } from '../layout/runtime'
import { createSelectionState, isSelectionCollapsed } from '../model/selection'
import { collectSelectionTargets } from '../model/selection-targets'
import type { Paragraph, Run } from '../model/types'
import type { TextPosition } from '../operations/transaction'
import { createAllTextSelection, readSelectionHtmlFromProjection } from './clipboard-runtime'
import {
  flattenLayoutLines,
  hitTestLineAtAbsoluteX,
  isLayoutLineMatchingCaret,
  resolveLineBoundaryPosition
} from './rendering'
import { JWordEditorMountedRuntime } from './mounted-runtime'
import {
  compareRuntimeTextPositions,
  createRuntimeAnchor,
  moveTextPosition
} from './text-runtime'

export abstract class JWordEditorRuntimeSelection extends JWordEditorMountedRuntime {
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

  protected moveSelectionHorizontally(delta: -1 | 1, extending = false): void {
    const selection = this.currentSelection

    if (selection === null) {
      return
    }

    if (!extending && !isSelectionCollapsed(selection)) {
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

    this.setSelectionToTextPosition(selection.anchor, nextPosition, extending)
  }

  protected moveSelectionVertically(direction: -1 | 1, extending = false): void {
    const selection = this.currentSelection

    if (selection === null) {
      return
    }

    if (!extending && !isSelectionCollapsed(selection)) {
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

    const currentLineIndex = lines.findIndex((line) => isLayoutLineMatchingCaret(line, caretRect))

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

    this.setSelectionToTextPosition(selection.anchor, targetPosition, extending)
  }

  protected moveSelectionToLineBoundary(boundary: 'start' | 'end', extending = false): void {
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

    const line = flattenLayoutLines(layout).find((candidate) => isLayoutLineMatchingCaret(candidate, caretRect))
    const targetPosition = line === undefined
      ? undefined
      : resolveLineBoundaryPosition(line, boundary)

    if (targetPosition === undefined) {
      return
    }

    this.setSelectionToTextPosition(selection.anchor, targetPosition, extending)
  }

  /** 移动键盘选区的 focus；扩展时保留原 anchor，不扩展时折叠到目标位置。 */
  protected setSelectionToTextPosition(
    anchor: ReturnType<typeof createRuntimeAnchor>,
    position: TextPosition,
    extending: boolean
  ): void {
    const focus = createRuntimeAnchor({
      documentId: this.currentProjection.document.id,
      ...position
    })

    this.setSelection(createSelectionState(
      extending ? anchor : focus,
      focus
    ))
  }
}
