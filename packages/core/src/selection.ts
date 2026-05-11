/**
 * 职责：定义 Gate 1 的 SelectionState 纯数据模型和 restore 快照。
 * 边界：只处理 anchor/focus、direction、affinity 和恢复快照，不读取 DOM、不做 hit-test、不触发布局。
 * 协作模块：输入系统、历史模块、批注、修订和远端光标后续复用同一套 AnchorRef/RangeRef。
 * 性能/安全约束：选择区对象冻结后只读，不持有可写 Yjs 容器，不访问浏览器环境。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/03-architecture.md#35-anchor-与-selection。
 */

import {
  createRangeRef,
  readAnchorRefSnapshot
} from './position'
import type { AnchorRef, RangeRef } from './position'

/** 选择方向。 */
export type SelectionDirection = 'none' | 'forward' | 'backward'

/** 光标亲和性，用于边界处恢复光标。 */
export type SelectionAffinity = 'none' | 'before' | 'after'

/**
 * 创建选择区时的可选项。
 */
export interface SelectionStateOptions {
  readonly direction?: SelectionDirection
  readonly affinity?: SelectionAffinity
}

/**
 * Gate 1 第一版选择区状态。
 */
export interface SelectionState {
  readonly anchor: AnchorRef
  readonly focus: AnchorRef
  readonly range: RangeRef
  readonly direction: SelectionDirection
  readonly affinity: SelectionAffinity
}

/**
 * 用于 history 或异常恢复的选择区快照。
 */
export interface SelectionRestoreSnapshot {
  readonly selection: SelectionState
}

/**
 * 创建选择区状态。
 *
 * @param anchor 选择起点。
 * @param focus 选择焦点。
 * @param options 方向与亲和性。
 * @returns 冻结后的选择区状态。
 */
export function createSelectionState(
  anchor: AnchorRef,
  focus: AnchorRef,
  options: SelectionStateOptions = {}
): SelectionState {
  return Object.freeze({
    anchor,
    focus,
    range: createRangeRef(anchor, focus),
    direction: options.direction ?? inferDirection(anchor, focus),
    affinity: options.affinity ?? 'none'
  })
}

/**
 * 创建折叠选择区。
 *
 * @param anchor 光标位置。
 * @param affinity 光标亲和性。
 * @returns anchor 与 focus 相同的选择区状态。
 */
export function createCollapsedSelection(
  anchor: AnchorRef,
  affinity: SelectionAffinity = 'none'
): SelectionState {
  return createSelectionState(anchor, anchor, {
    direction: 'none',
    affinity
  })
}

/**
 * 判断选择区是否折叠。
 *
 * @param selection 选择区状态。
 * @returns anchor 与 focus 是否指向同一位置。
 */
export function isSelectionCollapsed(selection: SelectionState): boolean {
  return areAnchorsAtSamePosition(selection.anchor, selection.focus)
}

/**
 * 创建 selection restore 快照。
 *
 * @param selection 当前选择区。
 * @returns 冻结后的恢复快照。
 */
export function createSelectionRestoreSnapshot(selection: SelectionState): SelectionRestoreSnapshot {
  return Object.freeze({
    selection
  })
}

/**
 * 从 restore 快照恢复选择区。
 *
 * @param snapshot 历史或错误恢复保存的快照。
 * @returns 快照中的选择区状态。
 */
export function restoreSelection(snapshot: SelectionRestoreSnapshot): SelectionState {
  return snapshot.selection
}

function inferDirection(anchor: AnchorRef, focus: AnchorRef): SelectionDirection {
  const anchorSnapshot = readAnchorRefSnapshot(anchor)
  const focusSnapshot = readAnchorRefSnapshot(focus)

  if (areAnchorsAtSamePosition(anchor, focus)) {
    return 'none'
  }

  if (
    anchorSnapshot.documentId === focusSnapshot.documentId &&
    anchorSnapshot.sectionId === focusSnapshot.sectionId &&
    anchorSnapshot.blockId === focusSnapshot.blockId &&
    anchorSnapshot.runId === focusSnapshot.runId
  ) {
    return Number(anchorSnapshot.graphemeIndex) < Number(focusSnapshot.graphemeIndex)
      ? 'forward'
      : 'backward'
  }

  return 'forward'
}

function areAnchorsAtSamePosition(anchor: AnchorRef, focus: AnchorRef): boolean {
  const anchorSnapshot = readAnchorRefSnapshot(anchor)
  const focusSnapshot = readAnchorRefSnapshot(focus)

  return (
    anchorSnapshot.documentId === focusSnapshot.documentId &&
    anchorSnapshot.sectionId === focusSnapshot.sectionId &&
    anchorSnapshot.blockId === focusSnapshot.blockId &&
    anchorSnapshot.runId === focusSnapshot.runId &&
    anchorSnapshot.graphemeIndex === focusSnapshot.graphemeIndex
  )
}
