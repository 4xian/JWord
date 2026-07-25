/**
 * 职责：在格式命令拆分 run 后，按段落内 grapheme 位置重建选区。
 * 边界：只依赖 core editor facade 和 document projection，不执行命令、不绑定 DOM。
 * 协作模块：toolbar/controller 与 selection-actions/controller 在 run 格式命令后复用。
 * 性能/安全约束：仅处理文本段落选区；无法解析时安静跳过，避免制造错误选区。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import {
  countGraphemes,
  createSelectionState,
  type Block,
  type DocumentProjection,
  type Editor,
  type Paragraph,
  type Run,
  type SelectionState
} from '@4xian/jword-core'

interface SelectionRebindSnapshot {
  readonly anchor: SelectionRebindEndpoint
  readonly focus: SelectionRebindEndpoint
  readonly affinity: SelectionState['affinity']
}

interface SelectionRebindEndpoint {
  readonly sectionId: string
  readonly blockId: string
  readonly paragraphGraphemeIndex: number
  readonly assoc?: number
}

/** 创建格式命令前的段落内选区快照，抵抗 run split 后旧 anchor 失效。 */
export function createSelectionRebindSnapshot(editor: Editor, selection: SelectionState): SelectionRebindSnapshot | null {
  const anchor = createSelectionRebindEndpoint(editor, selection.anchor)
  const focus = createSelectionRebindEndpoint(editor, selection.focus)

  if (anchor === null || focus === null) {
    return null
  }

  return {
    anchor,
    focus,
    affinity: selection.affinity
  }
}

/** 格式命令执行后按段落内绝对位置重建当前选区。 */
export function restoreSelectionFromRebindSnapshot(editor: Editor, snapshot: SelectionRebindSnapshot | null): SelectionState | null {
  if (snapshot === null) {
    return null
  }

  const anchor = restoreSelectionRebindEndpoint(editor, snapshot.anchor)
  const focus = restoreSelectionRebindEndpoint(editor, snapshot.focus)

  if (anchor === null || focus === null) {
    return null
  }

  const selection = createSelectionState(anchor, focus, {
    affinity: snapshot.affinity
  })

  editor.setSelection(selection)

  return selection
}

/** 把旧选区端点转换成段落内绝对 grapheme 位置。 */
function createSelectionRebindEndpoint(editor: Editor, anchor: SelectionState['anchor']): SelectionRebindEndpoint | null {
  const position = editor.resolveTextPosition(anchor)
  const paragraph = findParagraphById(editor.getProjection(), position.sectionId, position.blockId)

  if (paragraph === null) {
    return null
  }

  let paragraphGraphemeIndex = position.graphemeIndex

  for (const run of paragraph.runs) {
    if (run.id === position.runId) {
      return {
        sectionId: position.sectionId,
        blockId: position.blockId,
        paragraphGraphemeIndex,
        ...(position.assoc === undefined ? {} : { assoc: position.assoc })
      }
    }

    paragraphGraphemeIndex += readRunGraphemeLength(run)
  }

  return null
}

/** 把段落内绝对 grapheme 位置映射回当前 projection 的具体 run。 */
function restoreSelectionRebindEndpoint(editor: Editor, endpoint: SelectionRebindEndpoint): SelectionState['anchor'] | null {
  const paragraph = findParagraphById(editor.getProjection(), endpoint.sectionId, endpoint.blockId)

  if (paragraph === null || paragraph.runs.length === 0) {
    return null
  }

  let remainingIndex = endpoint.paragraphGraphemeIndex

  for (const run of paragraph.runs) {
    const length = readRunGraphemeLength(run)

    if (remainingIndex <= length) {
      return editor.createTextAnchor({
        sectionId: endpoint.sectionId,
        blockId: endpoint.blockId,
        runId: run.id,
        graphemeIndex: remainingIndex,
        ...(endpoint.assoc === undefined ? {} : { assoc: endpoint.assoc })
      })
    }

    remainingIndex -= length
  }

  const lastRun = paragraph.runs[paragraph.runs.length - 1]

  if (lastRun === undefined) {
    return null
  }

  return editor.createTextAnchor({
    sectionId: endpoint.sectionId,
    blockId: endpoint.blockId,
    runId: lastRun.id,
    graphemeIndex: readRunGraphemeLength(lastRun),
    ...(endpoint.assoc === undefined ? {} : { assoc: endpoint.assoc })
  })
}

/** 在当前投影中递归定位普通段落或表格单元格段落。 */
function findParagraphById(
  projection: DocumentProjection,
  sectionId: string,
  blockId: string
): Paragraph | null {
  const section = projection.document.sections.find((item) => item.id === sectionId)

  return section === undefined ? null : findParagraphInBlocks(section.blocks, blockId)
}

/** 在 block 树中查找段落。 */
function findParagraphInBlocks(blocks: readonly Block[], blockId: string): Paragraph | null {
  for (const block of blocks) {
    if (block.kind === 'paragraph' && block.id === blockId) {
      return block
    }

    if (block.kind !== 'table') {
      continue
    }

    for (const row of block.rows) {
      for (const cell of row.cells) {
        const nested = findParagraphInBlocks(cell.blocks, blockId)

        if (nested !== null) {
          return nested
        }
      }
    }
  }

  return null
}

/** 读取 run 内文本 grapheme 长度。 */
function readRunGraphemeLength(run: Run): number {
  return run.inlines.reduce((length, inline) => {
    return inline.kind === 'text' ? length + countGraphemes(inline.text) : length
  }, 0)
}
