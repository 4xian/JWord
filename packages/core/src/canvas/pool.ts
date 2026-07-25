/**
 * 职责：为 Gate 2 分页渲染提供可复用的 canvas 池。
 * 边界：只管理 canvas 对象尺寸和复用队列，不创建 DOM、不做布局、不执行绘制。
 * 协作模块：视口虚拟器 决定哪些页保留真实 canvas，画布渲染器 通过本模块获取和释放页面 canvas。
 * 性能/安全约束：离屏 canvas 必须缩到 1x1，避免非可视页继续占用大尺寸图形资源。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import { createJWordError } from '../shared/errors'

export interface CanvasRenderingContextLike {
  fillStyle: unknown
  font: unknown
  textBaseline: unknown
  setTransform?(a: number, b: number, c: number, d: number, e: number, f: number): void
  save?(): void
  restore?(): void
  translate?(x: number, y: number): void
  rotate?(angle: number): void
  clearRect(x: number, y: number, width: number, height: number): void
  fillRect(x: number, y: number, width: number, height: number): void
  fillText(text: string, x: number, y: number): void
  drawImage?(image: unknown, x: number, y: number, width: number, height: number): void
}

export interface CanvasLike {
  width: number
  height: number
  getContext(contextId: '2d'): CanvasRenderingContextLike | null
}

export interface CanvasPoolOptions {
  readonly createCanvas: () => CanvasLike
  readonly maxRetained?: number
}

export interface CanvasPool {
  readonly activeCount: number
  readonly availableCount: number
  acquire(width: number, height: number): CanvasLike
  release(canvas: CanvasLike): void
  dispose(): void
}

export function createCanvasPool(options: CanvasPoolOptions): CanvasPool {
  const maxRetained = options.maxRetained ?? 32
  const available: CanvasLike[] = []
  const active = new Set<CanvasLike>()
  let disposed = false

  return {
    get activeCount() {
      return active.size
    },
    get availableCount() {
      return available.length
    },
    acquire(width, height) {
      if (disposed) {
        throw createJWordError('CANVAS_POOL_DISPOSED', 'CanvasPool 已释放，不能再次获取 canvas')
      }

      const canvas = available.pop() ?? options.createCanvas()

      canvas.width = width
      canvas.height = height
      active.add(canvas)

      return canvas
    },
    release(canvas) {
      if (disposed) {
        releaseCanvasMemory(canvas)
        return
      }

      active.delete(canvas)
      canvas.width = 1
      canvas.height = 1

      if (available.length < maxRetained) {
        available.push(canvas)
      }
    },
    dispose() {
      disposed = true

      for (const canvas of active) {
        releaseCanvasMemory(canvas)
      }

      for (const canvas of available) {
        releaseCanvasMemory(canvas)
      }

      active.clear()
      available.splice(0, available.length)
    }
  }
}

/** 释放 canvas 底层位图资源。 */
function releaseCanvasMemory(canvas: CanvasLike): void {
  canvas.width = 0
  canvas.height = 0
}
