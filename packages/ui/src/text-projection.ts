/**
 * 职责：封装 UI 装配层读取 projection 纯文本和 run 的共享 helper。
 * 边界：只读 core DocumentProjection，不访问 DOM，不执行 editor 命令。
 * 协作模块：ui-lifecycle、comments-rail 与 link-overlay 复用这些纯读取函数。
 * 性能/安全约束：保持同步轻量读取，所有写入仍由 editor transaction pipeline 处理。
 * Specs：docs/superpowers/reports/2026-07-03-remediation-execution-supplement.md#310-phase-5-超大文件拆分目标结构。
 */
import type {
  Block,
  DocumentProjection,
  Editor,
  Paragraph,
  Run,
  SelectionState,
  TextRange
} from '@4xian/jword-core'

/** 读取 selection 覆盖的纯文本。 */
export function readSelectionText(editor: Editor, selection: SelectionState): string {
  return readTextRangePlainText(editor.getProjection(), {
    anchor: editor.resolveTextPosition(selection.anchor),
    focus: editor.resolveTextPosition(selection.focus)
  })
}

/** 读取文本范围覆盖的纯文本；跨 run 时返回范围首尾的可读摘要。 */
export function readTextRangePlainText(projection: DocumentProjection, range: TextRange): string {
  const anchorRun = findRunById(projection, range.anchor.runId)
  const focusRun = findRunById(projection, range.focus.runId)

  if (anchorRun === null || focusRun === null) {
    return ''
  }

  if (range.anchor.runId === range.focus.runId) {
    return sliceRunText(anchorRun, range.anchor.graphemeIndex, range.focus.graphemeIndex)
  }

  const anchorText = sliceRunText(anchorRun, range.anchor.graphemeIndex, Number.POSITIVE_INFINITY)
  const focusText = sliceRunText(focusRun, 0, range.focus.graphemeIndex)
  const text = `${anchorText}${focusText}`.trim()

  return text.length > 0 ? text : '跨段选区'
}

/** 按 run ID 查找 run。 */
export function findRunById(projection: DocumentProjection, runId: string): Run | null {
  for (const section of projection.document.sections) {
    const matched = findRunInBlocks(section.blocks, runId)

    if (matched !== null) {
      return matched
    }
  }

  return null
}

/** 在块树内递归查找 run。 */
function findRunInBlocks(blocks: readonly Block[], runId: string): Run | null {
  for (const block of blocks) {
    if (block.kind === 'paragraph') {
      const run = block.runs.find((candidate) => candidate.id === runId)

      if (run !== undefined) {
        return run
      }

      continue
    }

    for (const row of block.rows) {
      for (const cell of row.cells) {
        const nested = findRunInBlocks(cell.blocks, runId)

        if (nested !== null) {
          return nested
        }
      }
    }
  }

  return null
}

/** 按 grapheme 边界裁剪 run 文本。 */
function sliceRunText(run: Run, start: number, end: number): string {
  const graphemes = Array.from(readRunPlainText(run))
  const from = Math.max(0, Math.min(start, end))
  const to = Math.min(Math.max(start, end), graphemes.length)

  return graphemes.slice(from, to).join('')
}

/** 从 projection 读取纯文本镜像内容。 */
export function readProjectionPlainText(projection: DocumentProjection): string {
  return projection.document.sections
    .map((section) => section.blocks.map(readBlockPlainText).join('\n'))
    .join('\n\n')
}

/** 从 block 读取纯文本内容。 */
function readBlockPlainText(block: Block): string {
  if (block.kind === 'paragraph') {
    return readParagraphPlainText(block)
  }

  return block.rows
    .map((row) => row.cells.map((cell) => cell.blocks.map(readBlockPlainText).join('\n')).join('\t'))
    .join('\n')
}

/** 从段落读取 run 级纯文本内容。 */
function readParagraphPlainText(paragraph: Paragraph): string {
  return paragraph.runs.map(readRunPlainText).join('')
}

/** 从 run 读取 inline 级纯文本内容。 */
export function readRunPlainText(run: Run): string {
  return run.inlines
    .map((inline) => {
      if (inline.kind === 'text') {
        return inline.text
      }

      if (inline.kind === 'break') {
        return '\n'
      }

      if (inline.kind === 'image') {
        return '[image]'
      }

      return ''
    })
    .join('')
}
