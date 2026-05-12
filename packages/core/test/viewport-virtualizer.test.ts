/**
 * @vitest-environment node
 *
 * 职责：验证 Gate 2 视口虚拟器 只保留可视页和 buffer 页。
 * 边界：只计算页索引集合，不创建 DOM、canvas 或执行渲染。
 * 协作模块：画布渲染器 根据 retainedPageIndexes 持有真实 canvas，画布池 回收离屏页。
 * 性能/安全约束：测试使用固定 PageBox 序列，避免滚动环境和计时器导致不确定性。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/03-architecture.md#35-分页-canvas-渲染。
 */

import { describe, expect, it } from 'vitest'

import { computeViewportPages } from '../src/viewport-virtualizer'
import type { VirtualizerPageBox } from '../src/viewport-virtualizer'

describe('computeViewportPages', () => {
  it('只返回视口相交页和前后 buffer 页', () => {
    const result = computeViewportPages({
      pages: createPages(10),
      scrollTop: 1900,
      viewportHeight: 500,
      bufferPages: 1
    })

    expect(result.visiblePageIndexes).toEqual([1, 2])
    expect(result.retainedPageIndexes).toEqual([0, 1, 2, 3])
  })

  it('滚到文档底部时不会越界保留不存在的页', () => {
    const result = computeViewportPages({
      pages: createPages(5),
      scrollTop: 4400,
      viewportHeight: 900,
      bufferPages: 2
    })

    expect(result.visiblePageIndexes).toEqual([4])
    expect(result.retainedPageIndexes).toEqual([2, 3, 4])
  })

  it('无可视交集时选择最近页作为锚点并保留 buffer', () => {
    const result = computeViewportPages({
      pages: createPages(4),
      scrollTop: 5200,
      viewportHeight: 300,
      bufferPages: 1
    })

    expect(result.visiblePageIndexes).toEqual([3])
    expect(result.retainedPageIndexes).toEqual([2, 3])
  })
})

function createPages(count: number): readonly VirtualizerPageBox[] {
  return Array.from({ length: count }, (_, pageIndex) => ({
    pageIndex,
    top: pageIndex * 1100,
    height: 1000
  }))
}
