/**
 * 职责：实现 Editor facade 的中立位置 API。
 * 边界：不访问 DOM、不读取布局、不接 provider，只把现有 anchor/range/selection 映射为公开纯数据。
 * 协作模块：facade-runtime 提供基础 anchor 与 range 恢复，location-query 提供 projection 扫描。
 * 性能/安全约束：返回可序列化对象，不暴露内部锚点、范围、协同状态、文档存储、浏览器选区或画布坐标。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md Step 6.22-6.24。
 */

import { isSelectionCollapsed } from '../model/selection'
import type { AnchorRef } from '../model/position'
import type { TextPosition, TextRange } from '../operations/transaction'
import { JWordEditorFacadeRuntime } from './facade-runtime'
import { createQueryResult, createRangeSnapshot, createTextLocation, findProjectionTextLocations } from './location-query'
import type { EditorAnchorSnapshot, EditorLocationQuery, EditorLocationTarget, EditorRangeSnapshot, EditorRangeSnapshotInput, EditorResolvedLocation, EditorSelectionSnapshot, EditorTextLocation, EditorTextQueryResult } from './location-types'

export abstract class JWordEditorLocationRuntime extends JWordEditorFacadeRuntime {
  /** 创建公开 anchor 快照。 */
  createAnchorSnapshot(input: EditorTextLocation): EditorAnchorSnapshot {
    this.assertActive()

    const anchor = this.createTextAnchor(input)

    return createAnchorSnapshotFromLocation(this.resolveAnchorLocation(anchor))
  }

  /** 创建公开 range 快照。 */
  createRangeSnapshot(input: EditorRangeSnapshotInput): EditorRangeSnapshot {
    this.assertActive()

    return createRangeSnapshot(
      this.resolveAnchorLocation(this.createTextAnchor(input.anchor)),
      this.resolveAnchorLocation(this.createTextAnchor(input.focus))
    )
  }

  /** 读取当前 selection 的公开快照。 */
  readSelectionSnapshot(): EditorSelectionSnapshot | null {
    this.assertActive()

    const selection = this.currentSelection

    if (selection === null) {
      return null
    }

    const anchor = this.resolveAnchorLocation(selection.anchor)
    const focus = this.resolveAnchorLocation(selection.focus)

    return Object.freeze({
      kind: 'selection',
      collapsed: isSelectionCollapsed(selection),
      direction: selection.direction,
      affinity: selection.affinity,
      anchor: createAnchorSnapshotFromLocation(anchor),
      focus: createAnchorSnapshotFromLocation(focus),
      range: createRangeSnapshot(anchor, focus)
    })
  }

  /** 按公开查询输入读取中立文本位置。 */
  findTextLocations(query: EditorLocationQuery): readonly EditorTextQueryResult[] {
    this.assertActive()

    if (query.kind === 'comment') {
      return this.findCommentLocation(query.commentId)
    }

    if (query.kind === 'rangeSnapshot') {
      return this.findRangeSnapshotLocation(query.range)
    }

    return findProjectionTextLocations(this.currentProjection, query)
  }

  /** 把公开 location 输入解析成当前文档中的稳定纯数据位置。 */
  resolveLocation(input: EditorLocationTarget): EditorResolvedLocation | null {
    this.assertActive()

    const range = normalizeLocationTarget(input)

    if (range === null) {
      return null
    }

    try {
      const anchor = this.resolveAnchorLocation(this.createTextAnchor(range.anchor))
      const focus = this.resolveAnchorLocation(this.createTextAnchor(range.focus))

      return Object.freeze({
        kind: 'resolvedLocation',
        location: anchor,
        range: createRangeSnapshot(anchor, focus)
      })
    } catch {
      return null
    }
  }

  /** 解析运行时 AnchorRef 为公开文本位置。 */
  private resolveAnchorLocation(anchor: AnchorRef): EditorTextLocation {
    const position = this.resolveTextPosition(anchor)

    return createTextLocation(
      position.sectionId,
      position.blockId,
      position.runId,
      position.graphemeIndex,
      position.assoc
    )
  }

  /** 按批注 ID 读取当前 range 的公开位置。 */
  private findCommentLocation(commentId: string): readonly EditorTextQueryResult[] {
    const range = this.locateCommentThread(commentId)

    if (range === null) {
      return []
    }

    const anchor = this.resolveAnchorLocation(range.anchor)
    const focus = this.resolveAnchorLocation(range.focus)
    const rangeSnapshot = createRangeSnapshot(anchor, focus)

    return [createQueryResult('comment', anchor, rangeSnapshot, {
      index: 0
    })]
  }

  /** 按公开 range 快照读取当前位置。 */
  private findRangeSnapshotLocation(
    range: EditorRangeSnapshot
  ): readonly EditorTextQueryResult[] {
    const located = normalizePublicRangeSnapshot(range)

    const anchor = textPositionToLocation(located.anchor)
    const focus = textPositionToLocation(located.focus)
    const rangeSnapshot = createRangeSnapshot(anchor, focus)

    return [createQueryResult('rangeSnapshot', anchor, rangeSnapshot, {
      index: 0
    })]
  }
}

/** 创建公开 anchor 快照纯数据。 */
function createAnchorSnapshotFromLocation(location: EditorTextLocation): EditorAnchorSnapshot {
  return Object.freeze({
    kind: 'anchor',
    location
  })
}

/** 归一化公开 range 快照为 TextRange。 */
function normalizePublicRangeSnapshot(range: EditorRangeSnapshot): TextRange {
  return {
    anchor: range.anchor,
    focus: range.focus
  }
}

/** 把 operation 文本位置转换成公开文本位置。 */
function textPositionToLocation(position: TextPosition): EditorTextLocation {
  return createTextLocation(
    position.sectionId,
    position.blockId,
    position.runId,
    position.graphemeIndex,
    position.assoc
  )
}

/** 归一化公开 location 输入为 range 输入。 */
function normalizeLocationTarget(input: EditorLocationTarget): EditorRangeSnapshotInput | null {
  if (!('kind' in input)) {
    return {
      anchor: input,
      focus: input
    }
  }

  if (input.kind === 'anchor') {
    return {
      anchor: input.location,
      focus: input.location
    }
  }

  if (input.kind === 'range') {
    return {
      anchor: input.anchor,
      focus: input.focus
    }
  }

  if (input.kind === 'selection' || input.kind === 'queryResult') {
    return {
      anchor: input.range.anchor,
      focus: input.range.focus
    }
  }

  return null
}
