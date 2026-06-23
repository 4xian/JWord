/**
 * 职责：提供 Hocuspocus demo 的文本格式化 debug helper。
 * 边界：只处理首个 paragraph run 的 bold 范围和格式快照，不实现完整工具栏或复杂富文本 UI。
 * 协作：hocuspocus-runtime.ts 通过本 helper 触发 Editor facade 格式命令并读取 projection 格式状态。
 * 约束：格式变更必须走 Editor transaction pipeline；debug 快照只用于 Gate 6 真实 provider 并发验收。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md Gate 6 Step 6.10。
 */
import {
  buildSetBoldCommand,
  createSelectionState
} from '@4xian/jword-core'
import type { DocumentProjection, Editor } from '@4xian/jword-core'

import type { TextFormatRangeSnapshot } from '../runtime'
import {
  countDemoGraphemes,
  readFirstTextPosition,
  readRunText
} from './hocuspocus-projection'

/** 对 demo 首段指定 grapheme 范围应用加粗。 */
export function applyHocuspocusBoldRange(
  editor: Editor,
  start: number,
  end: number
): boolean {
  const projection = editor.getProjection()
  const anchorPosition = readFirstTextPosition(projection, start)
  const focusPosition = readFirstTextPosition(projection, end)

  if (anchorPosition === null || focusPosition === null || start >= end) {
    return false
  }

  const selection = createSelectionState(
    editor.createTextAnchor(anchorPosition),
    editor.createTextAnchor(focusPosition)
  )
  const command = buildSetBoldCommand(projection, selection, true)

  if (command === null) {
    return false
  }

  editor.setSelection(selection)
  editor.executeCommand(command, {
    origin: 'local-user'
  })

  return true
}

/** 读取当前 projection 中每个 text run 的格式快照。 */
export function readHocuspocusTextFormatRanges(
  projection: DocumentProjection | null
): readonly TextFormatRangeSnapshot[] {
  if (projection === null) {
    return []
  }

  const ranges: TextFormatRangeSnapshot[] = []
  let offset = 0

  for (const section of projection.document.sections) {
    for (const block of section.blocks) {
      if (block.kind !== 'paragraph') {
        continue
      }

      for (const run of block.runs) {
        const text = readRunText(run)
        const length = countDemoGraphemes(text)

        if (length === 0) {
          continue
        }

        ranges.push({
          text,
          start: offset,
          end: offset + length,
          bold: run.properties?.bold === true
        })
        offset += length
      }
    }
  }

  return ranges
}
