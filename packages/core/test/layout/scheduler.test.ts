/**
 * @vitest-environment node
 *
 * 职责：验证 Gate 2 布局 scheduler 的 脏页 优先、后续页分片和页起点早停语义。
 * 边界：只测试纯调度计划，不执行真实布局、不访问 DOM、不绘制 Canvas。
 * 协作模块：Editor 后续可用调度结果决定当前页同步重排和后续页分片重排。
 * 约束：测试不读取 Y.Doc，不创建浏览器资源，不实现输入系统。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import { describe, expect, it } from 'vitest'

import { createLayoutSchedule } from '../../src/layout/scheduler'

describe('createLayoutSchedule', () => {
  it('优先同步 脏页，并把后续页按分片计划重排', () => {
    const schedule = createLayoutSchedule({
      pageCount: 6,
      dirtyPageIndex: 2,
      previousPageStartKeys: ['p0', 'p1', 'p2-old', 'p3-old', 'p4-old', 'p5-old'],
      nextPageStartKeys: ['p0', 'p1', 'p2-new', 'p3-new', 'p4-new', 'p5-new'],
      chunkSize: 2
    })

    expect(schedule.immediatePageIndexes).toEqual([2])
    expect(schedule.deferredChunks).toEqual([[3, 4], [5]])
    expect(schedule.stoppedAtPageIndex).toBeUndefined()
  })

  it('后续页起点未变化时早停，避免无意义重排', () => {
    const schedule = createLayoutSchedule({
      pageCount: 6,
      dirtyPageIndex: 1,
      previousPageStartKeys: ['p0', 'p1-old', 'p2', 'p3', 'p4', 'p5'],
      nextPageStartKeys: ['p0', 'p1-new', 'p2', 'p3', 'p4', 'p5'],
      chunkSize: 2
    })

    expect(schedule.immediatePageIndexes).toEqual([1])
    expect(schedule.deferredChunks).toEqual([])
    expect(schedule.stoppedAtPageIndex).toBe(2)
  })
})
