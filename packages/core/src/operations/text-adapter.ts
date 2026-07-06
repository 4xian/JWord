/**
 * 职责：应用文本 run 与链接类 operation 到 Y.Doc 段落 run 结构。
 * 边界：只处理 insertText、deleteRange、setRunProperties、setRunLink，不处理段落块结构和图片 run。
 * 协作模块：operation-adapter 负责分发，adapter-location 负责定位、拆 run 与批注范围迁移。
 * 性能/安全约束：不访问 DOM，不直接触发布局；所有写入发生在外层 transaction pipeline 中。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/03-architecture.md#34-operation。
 */

import {
  DOCUMENT_STORE_FIELDS,
  getRunText,
  setRunLinkValue
} from '../model/document-store'
import { isAllowedLinkUrl } from '../links/policy'
import { createJWordError } from '../shared/errors'
import { countGraphemes } from '../shared/grapheme'
import type { DocumentStore } from '../model/document-store'
import type { RunId } from '../model/position'
import type { Operation, TextPosition } from './transaction'
import {
  assertRunIdUnused,
  assertRunPropertyRange,
  findBlockLocation,
  findRunLocation,
  resolveOperationPosition,
  splitRunAtGraphemeIndex
} from './adapter-location'
import type { ResolvedTextPosition } from './adapter-location'
import { mergeBlock } from './block-adapter'
import { assertBlockKind, setProperties } from './operation-record-utils'

/** 在指定文本位置插入字符串。 */
export function insertText(store: DocumentStore, position: TextPosition, text: string): void {
  const location = resolveOperationPosition(store, position)
  const sharedText = getRunText(location.runLocation.run)

  sharedText.insert(location.utf16Index, text)
}

/** 删除指定文本范围，支持同 run、同段跨 run 与相邻段落。 */
export function deleteRange(
  store: DocumentStore,
  anchor: TextPosition,
  focus: TextPosition
): void {
  const anchorSnapshot = resolveOperationPosition(store, anchor)
  const focusSnapshot = resolveOperationPosition(store, focus)
  const { start, end } = normalizeDeleteRange(store, anchorSnapshot, focusSnapshot)

  if (start.runId === end.runId) {
    deleteSameRunRange(start, end)
    return
  }

  if (start.blockId === end.blockId) {
    deleteSameBlockRange(start, end)
    return
  }

  deleteCrossBlockRange(store, start, end)
}

/** 设置 run 属性，range 存在时先拆分目标 run。 */
export function setRunProperties(
  store: DocumentStore,
  operation: Extract<Operation, { kind: 'setRunProperties' }>
): void {
  const runLocation = findRunLocation(store, operation.runId as RunId)
  const range = operation.range

  if (range === undefined) {
    setProperties(runLocation.run, DOCUMENT_STORE_FIELDS.run.properties, operation.properties)
    return
  }

  const runText = getRunText(runLocation.run).toString()
  const graphemeLength = countGraphemes(runText)

  assertRunPropertyRange(range.startGraphemeIndex, range.endGraphemeIndex, graphemeLength)

  if (range.startGraphemeIndex === 0 && range.endGraphemeIndex === graphemeLength) {
    setProperties(runLocation.run, DOCUMENT_STORE_FIELDS.run.properties, operation.properties)
    return
  }

  let formattedRunLocation = runLocation

  if (range.startGraphemeIndex > 0) {
    if (range.formattedRunId === undefined) {
      throw createJWordError('OPERATION_RUN_FORMAT_RANGE_INVALID', '局部 run 格式缺少 formattedRunId', {
        runId: operation.runId
      })
    }

    assertRunIdUnused(store, range.formattedRunId as RunId)
    formattedRunLocation = splitRunAtGraphemeIndex(
      store,
      runLocation,
      range.startGraphemeIndex,
      range.formattedRunId as RunId
    )
  }

  if (range.endGraphemeIndex < graphemeLength) {
    if (range.trailingRunId === undefined) {
      throw createJWordError('OPERATION_RUN_FORMAT_RANGE_INVALID', '局部 run 格式缺少 trailingRunId', {
        runId: operation.runId
      })
    }

    assertRunIdUnused(store, range.trailingRunId as RunId)
    splitRunAtGraphemeIndex(
      store,
      formattedRunLocation,
      range.endGraphemeIndex - range.startGraphemeIndex,
      range.trailingRunId as RunId
    )
  }

  setProperties(formattedRunLocation.run, DOCUMENT_STORE_FIELDS.run.properties, operation.properties)
}

/** 设置 run 链接，range 存在时先拆分目标 run。 */
export function setRunLink(
  store: DocumentStore,
  operation: Extract<Operation, { kind: 'setRunLink' }>
): void {
  if (operation.link !== null && !isAllowedLinkUrl(operation.link.target)) {
    throw createJWordError('OPERATION_LINK_URL_DISALLOWED', '链接 URL 不在 allowlist 内', {
      target: operation.link.target
    })
  }

  const runLocation = findRunLocation(store, operation.runId as RunId)
  const range = operation.range

  if (range === undefined) {
    setRunLinkValue(runLocation.run, operation.link)
    return
  }

  const runText = getRunText(runLocation.run).toString()
  const graphemeLength = countGraphemes(runText)

  assertRunPropertyRange(range.startGraphemeIndex, range.endGraphemeIndex, graphemeLength)

  if (range.startGraphemeIndex === 0 && range.endGraphemeIndex === graphemeLength) {
    setRunLinkValue(runLocation.run, operation.link)
    return
  }

  let linkedRunLocation = runLocation

  if (range.startGraphemeIndex > 0) {
    if (range.linkedRunId === undefined) {
      throw createJWordError('OPERATION_RUN_FORMAT_RANGE_INVALID', '局部 run 链接缺少 linkedRunId', {
        runId: operation.runId
      })
    }

    assertRunIdUnused(store, range.linkedRunId as RunId)
    linkedRunLocation = splitRunAtGraphemeIndex(
      store,
      runLocation,
      range.startGraphemeIndex,
      range.linkedRunId as RunId
    )
  }

  if (range.endGraphemeIndex < graphemeLength) {
    if (range.trailingRunId === undefined) {
      throw createJWordError('OPERATION_RUN_FORMAT_RANGE_INVALID', '局部 run 链接缺少 trailingRunId', {
        runId: operation.runId
      })
    }

    assertRunIdUnused(store, range.trailingRunId as RunId)
    splitRunAtGraphemeIndex(
      store,
      linkedRunLocation,
      range.endGraphemeIndex - range.startGraphemeIndex,
      range.trailingRunId as RunId
    )
  }

  setRunLinkValue(linkedRunLocation.run, operation.link)
}

/** 标准化删除范围方向并校验跨 section 语义。 */
function normalizeDeleteRange(
  store: DocumentStore,
  anchor: ResolvedTextPosition,
  focus: ResolvedTextPosition
): Readonly<{
  start: ResolvedTextPosition
  end: ResolvedTextPosition
}> {
  if (anchor.sectionId !== focus.sectionId) {
    throw createJWordError('OPERATION_DELETE_RANGE_UNSUPPORTED_SECTION', 'deleteRange 暂不支持跨 section 删除', {
      anchorSectionId: String(anchor.sectionId),
      focusSectionId: String(focus.sectionId)
    })
  }

  return compareResolvedTextPositions(store, anchor, focus) <= 0
    ? { start: anchor, end: focus }
    : { start: focus, end: anchor }
}

/** 比较两个已解析文本位置在当前容器中的先后顺序。 */
function compareResolvedTextPositions(
  store: DocumentStore,
  left: ResolvedTextPosition,
  right: ResolvedTextPosition
): number {
  if (left.blockId === right.blockId) {
    if (left.runLocation.index !== right.runLocation.index) {
      return left.runLocation.index - right.runLocation.index
    }

    return left.utf16Index - right.utf16Index
  }

  const leftBlock = findBlockLocation(store, left.blockId)
  const rightBlock = findBlockLocation(store, right.blockId)

  if (leftBlock.container !== rightBlock.container) {
    throw createJWordError('OPERATION_DELETE_RANGE_UNSUPPORTED_CONTAINER', 'deleteRange 暂不支持跨容器删除', {
      anchorBlockId: String(left.blockId),
      focusBlockId: String(right.blockId)
    })
  }

  return leftBlock.index - rightBlock.index
}

/** 删除同一 run 内的一段文本。 */
function deleteSameRunRange(start: ResolvedTextPosition, end: ResolvedTextPosition): void {
  const sharedText = getRunText(start.runLocation.run)
  const from = Math.min(start.utf16Index, end.utf16Index)
  const length = Math.abs(end.utf16Index - start.utf16Index)

  if (length > 0) {
    sharedText.delete(from, length)
  }
}

/** 删除同一段落内跨 run 的文本。 */
function deleteSameBlockRange(start: ResolvedTextPosition, end: ResolvedTextPosition): void {
  const runs = start.runLocation.container
  const endText = getRunText(end.runLocation.run)
  const startText = getRunText(start.runLocation.run)

  if (end.utf16Index > 0) {
    endText.delete(0, end.utf16Index)
  }

  if (start.utf16Index < startText.length) {
    startText.delete(start.utf16Index, startText.length - start.utf16Index)
  }

  const middleRunCount = end.runLocation.index - start.runLocation.index - 1

  if (middleRunCount > 0) {
    runs.delete(start.runLocation.index + 1, middleRunCount)
  }
}

/** 删除同一容器内跨段落文本，并合并首尾段落。 */
function deleteCrossBlockRange(store: DocumentStore, start: ResolvedTextPosition, end: ResolvedTextPosition): void {
  const startBlock = findBlockLocation(store, start.blockId)
  const endBlock = findBlockLocation(store, end.blockId)

  if (startBlock.container !== endBlock.container) {
    throw createJWordError('OPERATION_DELETE_RANGE_UNSUPPORTED_CONTAINER', 'deleteRange 暂不支持跨容器删除', {
      anchorBlockId: String(start.blockId),
      focusBlockId: String(end.blockId)
    })
  }

  assertBlockKind(startBlock.block, 'paragraph')
  assertBlockKind(endBlock.block, 'paragraph')

  const startRuns = start.runLocation.container
  const endRuns = end.runLocation.container
  const startText = getRunText(start.runLocation.run)
  const endText = getRunText(end.runLocation.run)

  if (start.utf16Index < startText.length) {
    startText.delete(start.utf16Index, startText.length - start.utf16Index)
  }

  if (startRuns.length > start.runLocation.index + 1) {
    startRuns.delete(start.runLocation.index + 1, startRuns.length - start.runLocation.index - 1)
  }

  if (end.utf16Index > 0) {
    endText.delete(0, end.utf16Index)
  }

  if (end.runLocation.index > 0) {
    endRuns.delete(0, end.runLocation.index)
  }

  const middleBlockCount = endBlock.index - startBlock.index - 1

  if (middleBlockCount > 0) {
    startBlock.container.delete(startBlock.index + 1, middleBlockCount)
  }

  mergeBlock(store, String(start.blockId), String(end.blockId))
}
