/**
 * @vitest-environment node
 *
 * 职责：验证 Gate 1 SelectionState 的 anchor/focus、direction、affinity 和 restore 快照。
 * 边界：只覆盖纯数据选择区，不测试 DOM 输入、hit-test、布局或 history undo。
 * 协作模块：history、input、comment、revision 和 remote cursor 后续复用这些选择区状态。
 * 性能/安全约束：测试只使用不可变 AnchorRef，不触发 DOM、网络或磁盘写入。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/03-architecture.md#35-anchor-与-selection。
 */

import { describe, expect, it } from 'vitest'

import {
  createCollapsedSelection,
  createSelectionRestoreSnapshot,
  createSelectionState,
  isSelectionCollapsed,
  restoreSelection
} from '../src/selection'
import { createAnchorRef, createGraphemeIndex } from '../src/position'
import type { BlockId, DocumentId, RunId, SectionId } from '../src/position'

describe('SelectionState', () => {
  it('creates forward and backward selections with anchor focus and range', () => {
    const anchor = createTestAnchor(1)
    const focus = createTestAnchor(5)
    const selection = createSelectionState(anchor, focus)
    const backwardSelection = createSelectionState(focus, anchor)

    expect(selection.anchor).toBe(anchor)
    expect(selection.focus).toBe(focus)
    expect(selection.range.anchor).toBe(anchor)
    expect(selection.range.focus).toBe(focus)
    expect(selection.direction).toBe('forward')
    expect(selection.affinity).toBe('none')
    expect(backwardSelection.direction).toBe('backward')
    expect(isSelectionCollapsed(selection)).toBe(false)
    expect(Object.isFrozen(selection)).toBe(true)
  })

  it('creates collapsed selections with affinity', () => {
    const anchor = createTestAnchor(2)
    const selection = createCollapsedSelection(anchor, 'after')

    expect(selection.anchor).toBe(anchor)
    expect(selection.focus).toBe(anchor)
    expect(selection.direction).toBe('none')
    expect(selection.affinity).toBe('after')
    expect(isSelectionCollapsed(selection)).toBe(true)
  })

  it('restores selection from an immutable snapshot', () => {
    const selection = createSelectionState(createTestAnchor(0), createTestAnchor(3), {
      direction: 'forward',
      affinity: 'before'
    })
    const snapshot = createSelectionRestoreSnapshot(selection)

    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(restoreSelection(snapshot)).toBe(selection)
  })
})

function createTestAnchor(graphemeIndex: number) {
  return createAnchorRef({
    documentId: 'document-1' as DocumentId,
    sectionId: 'section-1' as SectionId,
    blockId: 'paragraph-1' as BlockId,
    runId: 'run-1' as RunId,
    graphemeIndex: createGraphemeIndex(graphemeIndex)
  })
}
