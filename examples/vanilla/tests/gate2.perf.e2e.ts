/**
 * @fileoverview 职责: 用真实 Chromium 浏览器记录 Gate 2 长文夹具的滚动与虚拟化指标。
 * 边界: 只测 examples/vanilla 已接通的 Gate 2 demo，不替代 core Node benchmark 或 Gate 3 toolbar perf。
 * 协作: data-jword-canvas-container、window.__jwordTestFixture 和 Playwright perf-chromium 项目。
 * 约束: 指标必须来自浏览器 performance、requestAnimationFrame 和真实 canvas DOM，可附带 JSON 供复查。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { expectedGate2PageCount } from './gate2-test-contract'

interface Gate2PerfMetrics {
  readonly pageCount: number
  readonly initialMountedCanvasCount: number
  readonly initialCanvasBytes: number
  readonly scrollToMiddleMs: number
  readonly scrollToMiddleFrames: number
  readonly scrollToMiddleFps: number
  readonly scrollToEndMs: number
  readonly scrollToEndFrames: number
  readonly scrollToEndFps: number
  readonly peakMountedCanvasCount: number
  readonly peakCanvasBytes: number
  readonly maxCanvasSidePx: number
}

test('Gate 2 fixture exposes real browser scroll metrics and virtualization bounds', async ({ page, browserName }, testInfo) => {
  test.skip(browserName !== 'chromium', 'Gate 2 浏览器性能证据当前只固定在 Chromium。')

  await page.goto('/test-fixture.html?fixture=gate2')
  await waitForGate2Ready(page)

  const metrics = await readGate2PerfMetrics(page)

  console.log(`GATE2_PERF ${JSON.stringify(metrics)}`)
  await testInfo.attach('gate2-browser-perf', {
    body: JSON.stringify(metrics, null, 2),
    contentType: 'application/json'
  })

  expect(metrics.pageCount).toBe(expectedGate2PageCount)
  expect(metrics.initialMountedCanvasCount).toBeLessThanOrEqual(3)
  expect(metrics.peakMountedCanvasCount).toBeLessThanOrEqual(4)
  expect(metrics.initialCanvasBytes).toBeGreaterThan(0)
  expect(metrics.peakCanvasBytes).toBeGreaterThanOrEqual(metrics.initialCanvasBytes)
  expect(metrics.peakCanvasBytes).toBeLessThanOrEqual(16_000_000)
  expect(metrics.maxCanvasSidePx).toBeLessThanOrEqual(2048)
  expect(metrics.scrollToMiddleMs).toBeGreaterThan(0)
  expect(metrics.scrollToMiddleMs).toBeLessThanOrEqual(500)
  expect(metrics.scrollToMiddleFrames).toBeGreaterThan(0)
  expect(metrics.scrollToMiddleFps).toBeGreaterThan(0)
  expect(metrics.scrollToEndMs).toBeGreaterThan(0)
  expect(metrics.scrollToEndMs).toBeLessThanOrEqual(500)
  expect(metrics.scrollToEndFrames).toBeGreaterThan(0)
  expect(metrics.scrollToEndFps).toBeGreaterThan(0)
})

async function waitForGate2Ready(page: Page): Promise<void> {
  await expect(page.locator('[data-jword-canvas-container]')).toHaveAttribute('data-jword-page-count', String(expectedGate2PageCount))
  await page.waitForFunction(() => window.__jwordTestFixture !== undefined)
  await expect.poll(async () => {
    return page.evaluate(() => document.querySelectorAll('.jw-editor__page-canvas').length)
  }).toBeGreaterThan(0)
}

async function readGate2PerfMetrics(page: Page): Promise<Gate2PerfMetrics> {
  return page.evaluate(async () => {
    const demo = window.__jwordTestFixture
    const container = document.querySelector<HTMLElement>('[data-jword-canvas-container]')

    if (demo === undefined || container === null) {
      throw new Error('缺少 Gate 2 perf 所需的 demo 测试钩子或容器 DOM')
    }

    const layout = demo.editor.getLayout()
    const middlePageIndex = Math.floor(layout.pages.length / 2)
    const lastPageIndex = layout.pages.length - 1

    if (layout.pages.length === 0) {
      throw new Error('Gate 2 夹具缺少布局页')
    }

    const nextFrame = async (): Promise<number> =>
      new Promise((resolve) => {
        requestAnimationFrame((timestamp) => {
          resolve(timestamp)
        })
      })

    const readCanvasMetrics = (): Readonly<{
      mountedCanvasCount: number
      canvasBytes: number
      maxCanvasSidePx: number
    }> => {
      const canvases = [...document.querySelectorAll<HTMLCanvasElement>('.jw-editor__page-canvas')]

      return {
        mountedCanvasCount: canvases.length,
        canvasBytes: canvases.reduce((total, canvas) => total + canvas.width * canvas.height * 4, 0),
        maxCanvasSidePx: canvases.reduce((maxSide, canvas) => Math.max(maxSide, canvas.width, canvas.height), 0)
      }
    }

    let peakMountedCanvasCount = 0
    let peakCanvasBytes = 0
    let maxCanvasSidePx = 0

    const capturePeaks = (): void => {
      const metrics = readCanvasMetrics()

      peakMountedCanvasCount = Math.max(peakMountedCanvasCount, metrics.mountedCanvasCount)
      peakCanvasBytes = Math.max(peakCanvasBytes, metrics.canvasBytes)
      maxCanvasSidePx = Math.max(maxCanvasSidePx, metrics.maxCanvasSidePx)
    }

    const waitForMountedPage = async (
      pageIndex: number,
      scrollRatio: number,
      timeoutMs = 4000
    ): Promise<void> => {
      const start = performance.now()
      const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight)

      container.scrollTop = maxScrollTop * scrollRatio
      container.dispatchEvent(new Event('scroll'))

      while (document.querySelector(`[data-jword-page="${pageIndex}"] canvas`) === null) {
        await nextFrame()
        capturePeaks()

        if (performance.now() - start > timeoutMs) {
          throw new Error(`等待第 ${pageIndex + 1} 页 canvas 挂载超时`)
        }
      }
    }

    const measureScroll = async (
      targetPageIndex: number,
      scrollRatio: number
    ): Promise<Readonly<{
      elapsedMs: number
      frames: number
      fps: number
    }>> => {
      let frames = 1
      const start = performance.now()
      const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight)

      container.scrollTop = maxScrollTop * scrollRatio
      container.dispatchEvent(new Event('scroll'))
      await nextFrame()
      capturePeaks()

      while (document.querySelector(`[data-jword-page="${targetPageIndex}"] canvas`) === null) {
        await nextFrame()
        frames += 1
        capturePeaks()

        if (performance.now() - start > 4000) {
          throw new Error(`滚动到第 ${targetPageIndex + 1} 页超时`)
        }
      }

      capturePeaks()

      const elapsedMs = performance.now() - start

      return {
        elapsedMs: Number(elapsedMs.toFixed(2)),
        frames,
        fps: elapsedMs === 0 ? 0 : Number((frames / (elapsedMs / 1000)).toFixed(2))
      }
    }

    await waitForMountedPage(0, 0)
    capturePeaks()

    const initialCanvas = readCanvasMetrics()
    const middleScroll = await measureScroll(middlePageIndex, middlePageIndex / lastPageIndex)
    const endScroll = await measureScroll(lastPageIndex, 1)

    return {
      pageCount: layout.pages.length,
      initialMountedCanvasCount: initialCanvas.mountedCanvasCount,
      initialCanvasBytes: initialCanvas.canvasBytes,
      scrollToMiddleMs: middleScroll.elapsedMs,
      scrollToMiddleFrames: middleScroll.frames,
      scrollToMiddleFps: middleScroll.fps,
      scrollToEndMs: endScroll.elapsedMs,
      scrollToEndFrames: endScroll.frames,
      scrollToEndFps: endScroll.fps,
      peakMountedCanvasCount,
      peakCanvasBytes,
      maxCanvasSidePx
    }
  })
}
