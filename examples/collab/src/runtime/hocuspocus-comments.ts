/**
 * 职责：提供 Hocuspocus demo 的批注范围 debug helper。
 * 边界：只处理首个 paragraph 的批注创建和范围文本读取，不实现批注侧栏或权限模型。
 * 协作：hocuspocus-runtime.ts 通过本 helper 触发 core comment command 并读取稳定 range 快照。
 * 约束：批注写入必须走 Editor transaction pipeline；debug 快照只用于 Gate 6 真实 provider 并发验收。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import {
  buildAddCommentThreadCommand,
  createSelectionState
} from '@4xian/jword-core'
import type { DocumentProjection, Editor } from '@4xian/jword-core'

import type {
  CommentRangeCreateSnapshot,
  CommentRangeSnapshot
} from '../runtime'
import {
  findProjectionTextOffset,
  readFirstTextPosition,
  readProjectionTextRange
} from './hocuspocus-projection'

/** 对 demo 首段指定 grapheme 范围创建批注 thread。 */
export function applyHocuspocusCommentRange(
  editor: Editor,
  start: number,
  end: number,
  text: string,
  authorId: string
): CommentRangeCreateSnapshot {
  const projection = editor.getProjection()
  const anchorPosition = readFirstTextPosition(projection, start)
  const focusPosition = readFirstTextPosition(projection, end)

  if (anchorPosition === null || focusPosition === null || start >= end) {
    return {
      threadId: null
    }
  }

  const selection = createSelectionState(
    editor.createTextAnchor(anchorPosition),
    editor.createTextAnchor(focusPosition)
  )
  const command = buildAddCommentThreadCommand(projection, selection, {
    authorId,
    createdAt: new Date().toISOString(),
    text
  })

  if (command === null) {
    return {
      threadId: null
    }
  }

  editor.setSelection(selection)
  editor.executeCommand(command, {
    origin: 'local-user'
  })

  return {
    threadId: command.operations[0]?.kind === 'addCommentThread'
      ? command.operations[0].thread.id
      : null
  }
}

/** 读取当前 projection 中所有批注 range 的定位文本。 */
export function readHocuspocusCommentRanges(
  editor: Editor,
  projection: DocumentProjection | null
): readonly CommentRangeSnapshot[] {
  if (projection === null) {
    return []
  }

  const ranges: CommentRangeSnapshot[] = []

  for (const thread of projection.document.comments ?? []) {
    const locatedRange = editor.locateRangeSnapshot(thread.rangeSnapshot)

    if (locatedRange === null) {
      continue
    }

    const anchorOffset = findProjectionTextOffset(projection, locatedRange.anchor)
    const focusOffset = findProjectionTextOffset(projection, locatedRange.focus)

    if (anchorOffset === null || focusOffset === null) {
      continue
    }

    ranges.push({
      threadId: thread.id,
      text: readProjectionTextRange(projection, locatedRange),
      start: Math.min(anchorOffset, focusOffset),
      end: Math.max(anchorOffset, focusOffset),
      resolved: thread.resolved
    })
  }

  return ranges
}
