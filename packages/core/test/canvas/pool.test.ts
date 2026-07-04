/**
 * @vitest-environment node
 *
 * 职责：验证 Gate 2 画布池 的按页复用与离屏释放行为。
 * 边界：只覆盖 画布生命周期，不覆盖分页布局、视口计算或真实浏览器画布。
 * 协作模块：视口虚拟器和画布渲染器通过画布池 获取、释放每页独立 canvas。
 * 性能/安全约束：测试使用确定性 mock canvas，不访问 DOM，不创建真实图形资源。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/03-architecture.md#35-分页-canvas-渲染。
 */

import { describe, expect, it } from 'vitest'

import { createCanvasPool } from '../../src/canvas/pool'
import type { CanvasLike } from '../../src/canvas/pool'

describe('createCanvasPool', () => {
  it('获取 canvas 时按请求尺寸初始化，并记录活跃数量', () => {
    const pool = createCanvasPool({
      createCanvas: () => createMockCanvas()
    })

    const canvas = pool.acquire(640, 900)

    expect(canvas.width).toBe(640)
    expect(canvas.height).toBe(900)
    expect(pool.activeCount).toBe(1)
    expect(pool.availableCount).toBe(0)
  })

  it('释放离屏 canvas 时缩到 1x1 并允许后续复用', () => {
    const created: CanvasLike[] = []
    const pool = createCanvasPool({
      createCanvas: () => {
        const canvas = createMockCanvas()
        created.push(canvas)
        return canvas
      }
    })
    const first = pool.acquire(800, 1000)

    pool.release(first)

    expect(first.width).toBe(1)
    expect(first.height).toBe(1)
    expect(pool.activeCount).toBe(0)
    expect(pool.availableCount).toBe(1)

    const reused = pool.acquire(400, 500)

    expect(reused).toBe(first)
    expect(reused.width).toBe(400)
    expect(reused.height).toBe(500)
    expect(created).toHaveLength(1)
  })

  it('超过保留上限时仍释放显存尺寸但不继续缓存', () => {
    const pool = createCanvasPool({
      maxRetained: 1,
      createCanvas: () => createMockCanvas()
    })
    const first = pool.acquire(800, 1000)
    const second = pool.acquire(800, 1000)

    pool.release(first)
    pool.release(second)

    expect(first.width).toBe(1)
    expect(first.height).toBe(1)
    expect(second.width).toBe(1)
    expect(second.height).toBe(1)
    expect(pool.availableCount).toBe(1)
    expect(pool.activeCount).toBe(0)
  })

  it('dispose 后清空活跃与可复用 canvas 并拒绝再次获取', () => {
    const pool = createCanvasPool({
      createCanvas: () => createMockCanvas()
    })
    const activeCanvas = pool.acquire(800, 1000)
    const retainedCanvas = pool.acquire(400, 500)

    pool.release(retainedCanvas)
    pool.dispose()

    expect(activeCanvas.width).toBe(0)
    expect(activeCanvas.height).toBe(0)
    expect(retainedCanvas.width).toBe(0)
    expect(retainedCanvas.height).toBe(0)
    expect(pool.activeCount).toBe(0)
    expect(pool.availableCount).toBe(0)
    expect(readThrownCode(() => {
      pool.acquire(1, 1)
    })).toBe('CANVAS_POOL_DISPOSED')
  })
})

function createMockCanvas(): CanvasLike {
  return {
    width: 0,
    height: 0,
    getContext: () => null
  }
}

function readThrownCode(callback: () => void): unknown {
  try {
    callback()
  } catch (error) {
    return (error as { readonly code?: unknown }).code
  }

  return undefined
}
