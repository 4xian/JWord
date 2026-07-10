/**
 * @vitest-environment node
 *
 * 职责：验证 Gate 1 SelectionState 的 anchor/focus、direction、affinity 和 restore 快照。
 * 边界：只覆盖纯数据选择区，不测试 DOM 输入、hit-test、布局或 history undo。
 * 协作模块：history、input、comment、revision 和 remote cursor 后续复用这些选择区状态。
 * 性能/安全约束：测试只使用不可变 AnchorRef，不触发 DOM、网络或磁盘写入。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import { describe, expect, it } from 'vitest'

import {
  createCollapsedSelection,
  createSelectionRestoreSnapshot,
  createSelectionState,
  isSelectionCollapsed,
  restoreSelection
} from '../../src/model/selection'
import { createAnchorRef, createGraphemeIndex } from '../../src/model/position'
import type { BlockId, DocumentId, RunId, SectionId } from '../../src/model/position'

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

  it('按文档序推断跨 run 与跨段反向选区', () => {
    const firstRunStart = createTestAnchor(0)
    const secondRunStart = createTestAnchor(0, { runId: 'run-2' })
    const firstParagraphStart = createTestAnchor(0)
    const secondParagraphStart = createTestAnchor(0, { blockId: 'paragraph-2', runId: 'run-3' })

    expect(createSelectionState(firstRunStart, secondRunStart).direction).toBe('forward')
    expect(createSelectionState(secondRunStart, firstRunStart).direction).toBe('backward')
    expect(createSelectionState(firstParagraphStart, secondParagraphStart).direction).toBe('forward')
    expect(createSelectionState(secondParagraphStart, firstParagraphStart).direction).toBe('backward')
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

function createTestAnchor(
  graphemeIndex: number,
  overrides: Partial<Readonly<{
    sectionId: string
    blockId: string
    runId: string
  }>> = {}
) {
  return createAnchorRef({
    documentId: 'document-1' as DocumentId,
    sectionId: (overrides.sectionId ?? 'section-1') as SectionId,
    blockId: (overrides.blockId ?? 'paragraph-1') as BlockId,
    runId: (overrides.runId ?? 'run-1') as RunId,
    graphemeIndex: createGraphemeIndex(graphemeIndex)
  })
}
