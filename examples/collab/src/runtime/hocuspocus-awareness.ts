/**
 * 职责：维护 Hocuspocus demo 的 awareness 文本镜像和 selection debug 快照。
 * 边界：只处理 demo 首段纯文本 selection，不实现远端光标 UI 或 provider 通用协议。
 * 协作：hocuspocus-runtime.ts 写入 awareness state 前同步镜像，读取 debug API 时解析 range snapshot。
 * 约束：正文编辑仍走 Editor transaction pipeline；这里的 Y.Text 只作为 awareness 相对位置镜像。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import type {
  JWordAwarenessRangeSnapshot,
  JWordAwarenessState
} from '@4xian/jword-collab'
import * as Y from 'yjs'

import type { AwarenessUserSnapshot } from '../runtime'

/** 将 awareness 专用 Y.Text 镜像同步到当前 demo 正文。 */
export function syncHocuspocusAwarenessText(
  awarenessText: Y.Text,
  nextText: string
): void {
  const currentText = awarenessText.toString()

  if (currentText === nextText) {
    return
  }

  const diff = createTextDiff(currentText, nextText)

  if (diff.deletedLength > 0) {
    awarenessText.delete(diff.start, diff.deletedLength)
  }
  if (diff.insertedText.length > 0) {
    awarenessText.insert(diff.start, diff.insertedText)
  }
}

/** 创建带 Yjs relative position 的 awareness range snapshot。 */
export function createHocuspocusAwarenessRangeSnapshot(input: {
  readonly awarenessText: Y.Text
  readonly documentId: string
  readonly clientId: string
  readonly selectionStart: number
  readonly selectionEnd: number
}): JWordAwarenessRangeSnapshot {
  return {
    id: `${input.clientId}-selection`,
    anchor: createAwarenessTextAnchorRecord(input, input.selectionStart, -1),
    focus: createAwarenessTextAnchorRecord(input, input.selectionEnd, 1)
  }
}

/** 把 provider awareness state 映射成 demo debug 快照。 */
export function mapHocuspocusAwarenessUserSnapshot(input: {
  readonly state: JWordAwarenessState
  readonly document: Y.Doc
  readonly currentText: string
  readonly now: number
}): AwarenessUserSnapshot {
  const currentLength = countCodePoints(input.currentText)
  const resolvedRange = resolveAwarenessRange(input.state.rangeSnapshot, input.document, input.currentText)
  const selectionStart = resolvedRange?.start ?? input.state.cursor?.anchor.offset ?? currentLength
  const selectionEnd = resolvedRange?.end ?? input.state.cursor?.focus.offset ?? currentLength

  return {
    clientId: input.state.clientId,
    name: input.state.user.name,
    color: input.state.user.color ?? '#286fd6',
    cursorOffset: selectionEnd,
    selectionStart,
    selectionEnd,
    ...(resolvedRange === null ? {} : { selectionText: resolvedRange.text }),
    ...(input.state.selectionLabel === undefined ? {} : { selectionLabel: input.state.selectionLabel }),
    ...(input.state.rangeSnapshot === undefined ? {} : { rangeSnapshot: input.state.rangeSnapshot }),
    ...(input.state.viewport === undefined ? {} : { viewport: input.state.viewport }),
    connected: true,
    updatedAt: input.state.updatedAt || input.now
  }
}

interface TextDiff {
  readonly start: number
  readonly deletedLength: number
  readonly insertedText: string
}

interface ResolvedAwarenessRange {
  readonly start: number
  readonly end: number
  readonly text: string
}

/** 创建 awareness 文本锚点记录。 */
function createAwarenessTextAnchorRecord(
  input: {
    readonly awarenessText: Y.Text
    readonly documentId: string
  },
  graphemeIndex: number,
  assoc: number
): JWordAwarenessRangeSnapshot['anchor'] {
  const relativePosition = Y.createRelativePositionFromTypeIndex(
    input.awarenessText,
    Math.min(Math.max(graphemeIndex, 0), countCodePoints(input.awarenessText.toString())),
    assoc
  )

  return {
    documentId: input.documentId,
    sectionId: 'body-section',
    blockId: 'body',
    runId: 'body',
    graphemeIndex,
    assoc,
    relativePosition: Y.relativePositionToJSON(relativePosition)
  }
}

/** 解析 awareness range snapshot 在当前共享正文中的位置。 */
function resolveAwarenessRange(
  snapshot: JWordAwarenessRangeSnapshot | undefined,
  document: Y.Doc,
  currentText: string
): ResolvedAwarenessRange | null {
  if (snapshot === undefined) {
    return null
  }

  const anchorIndex = resolveAwarenessAnchorIndex(snapshot.anchor.relativePosition, document, currentText)
  const focusIndex = resolveAwarenessAnchorIndex(snapshot.focus.relativePosition, document, currentText)

  if (anchorIndex === null || focusIndex === null) {
    return null
  }

  const start = Math.min(anchorIndex, focusIndex)
  const end = Math.max(anchorIndex, focusIndex)

  return {
    start,
    end,
    text: Array.from(currentText).slice(start, end).join('')
  }
}

/** 解析单个 awareness relative position 的当前 grapheme index。 */
function resolveAwarenessAnchorIndex(
  snapshot: JWordAwarenessRangeSnapshot['anchor']['relativePosition'],
  document: Y.Doc,
  currentText: string
): number | null {
  const absolute = Y.createAbsolutePositionFromRelativePosition(
    Y.createRelativePositionFromJSON(snapshot),
    document
  )

  if (absolute === null || !(absolute.type instanceof Y.Text)) {
    return null
  }

  return Math.min(countCodePoints(currentText), countCodePoints(currentText.slice(0, absolute.index)))
}

/** 计算两个字符串之间的单段 diff。 */
function createTextDiff(previousText: string, nextText: string): TextDiff {
  let start = 0

  while (
    start < previousText.length &&
    start < nextText.length &&
    previousText[start] === nextText[start]
  ) {
    start += 1
  }

  let previousEnd = previousText.length
  let nextEnd = nextText.length

  while (
    previousEnd > start &&
    nextEnd > start &&
    previousText[previousEnd - 1] === nextText[nextEnd - 1]
  ) {
    previousEnd -= 1
    nextEnd -= 1
  }

  return {
    start,
    deletedLength: previousEnd - start,
    insertedText: nextText.slice(start, nextEnd)
  }
}

/** 统计当前 demo 文本的 code point 数。 */
function countCodePoints(text: string): number {
  return Array.from(text).length
}
