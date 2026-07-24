/**
 * @fileoverview 职责: 为 Phase 4 提供浏览器内存回归门禁，覆盖 mount/destroy 循环和 50 页长滚动采样。
 * 边界: 只测 vanilla demo 在 Chromium 下的 DOM、canvas 和 JS heap 采样，不替代 Node heap benchmark 或泄漏根因单测。
 * 协作: demo 测试钩子、画布容器、浏览器调试协议和 Playwright 性能项目。
 * 约束: 指标使用 CDP HeapProfiler/Performance 采样；阈值固定为冒烟护栏，避免内存泄漏类回归静默进入主线。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import { expect, test } from '@playwright/test'
import type { CDPSession, Page } from '@playwright/test'
import { expectedGate2PageCount } from './gate2-test-contract'

interface Phase4MemoryMetrics {
  readonly mountDestroyCycleCount: number
  readonly mountDestroyHeapDeltaBytes: number
  readonly mountDestroyDomNodesDelta: number
  readonly mountDestroyListenerDelta: number
  readonly longScrollSampleCount: number
  readonly longScrollHeapDeltaBytes: number
  readonly longScrollPeakCanvasCount: number
  readonly longScrollPeakCanvasBytes: number
  readonly finalMountedCanvasCount: number
}

const mountDestroyCycleCount = 5
const longScrollSampleCount = 36

test('phase4-memory keeps mount destroy and long scroll heap within smoke bounds', async ({ page, browserName }, testInfo) => {
  test.setTimeout(60000)
  test.skip(browserName !== 'chromium', 'Phase 4 内存门禁当前只固定 Chromium CDP 口径。')

  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Performance.enable')
  await cdp.send('HeapProfiler.enable')

  const mountDestroy = await measureMountDestroy(page, cdp)
  const longScroll = await measureLongScroll(page, cdp)
  const metrics: Phase4MemoryMetrics = {
    mountDestroyCycleCount,
    mountDestroyHeapDeltaBytes: mountDestroy.heapDeltaBytes,
    mountDestroyDomNodesDelta: mountDestroy.domNodesDelta,
    mountDestroyListenerDelta: mountDestroy.listenerDelta,
    longScrollSampleCount,
    longScrollHeapDeltaBytes: longScroll.heapDeltaBytes,
    longScrollPeakCanvasCount: longScroll.peakMountedCanvasCount,
    longScrollPeakCanvasBytes: longScroll.peakCanvasBytes,
    finalMountedCanvasCount: longScroll.finalMountedCanvasCount
  }

  console.log(`PHASE4_MEMORY ${JSON.stringify(metrics)}`)
  await testInfo.attach('phase4-memory', {
    body: JSON.stringify(metrics, null, 2),
    contentType: 'application/json'
  })

  expect(metrics.mountDestroyHeapDeltaBytes).toBeLessThanOrEqual(8_000_000)
  expect(metrics.mountDestroyDomNodesDelta).toBeLessThanOrEqual(80)
  expect(metrics.mountDestroyListenerDelta).toBeLessThanOrEqual(80)
  expect(metrics.longScrollHeapDeltaBytes).toBeLessThanOrEqual(12_000_000)
  expect(metrics.longScrollPeakCanvasCount).toBeLessThanOrEqual(5)
  expect(metrics.longScrollPeakCanvasBytes).toBeLessThanOrEqual(20_000_000)
  expect(metrics.finalMountedCanvasCount).toBeLessThanOrEqual(4)
})

/** 循环加载并显式销毁 demo，采样 heap、DOM 节点和监听器增长。 */
async function measureMountDestroy(
  page: Page,
  cdp: CDPSession
): Promise<Readonly<{ heapDeltaBytes: number, domNodesDelta: number, listenerDelta: number }>> {
  await page.goto('/test-fixture.html')
  await waitForDemoReady(page)
  await page.evaluate(() => {
    window.__jwordTestFixture?.destroy()
  })
  await expect(page.locator('[data-jword-hidden-textarea]')).toHaveCount(0)
  await collectGarbage(cdp)

  await page.goto('/test-fixture.html')
  await waitForDemoReady(page)
  await page.evaluate(() => {
    window.__jwordTestFixture?.destroy()
  })
  await expect(page.locator('[data-jword-hidden-textarea]')).toHaveCount(0)
  const baseline = await collectBrowserMemorySnapshot(cdp)

  for (let index = 0; index < mountDestroyCycleCount; index += 1) {
    await page.goto('/test-fixture.html')
    await waitForDemoReady(page)
    await page.evaluate(() => {
      window.__jwordTestFixture?.destroy()
    })
    await expect(page.locator('[data-jword-hidden-textarea]')).toHaveCount(0)
    await collectGarbage(cdp)
  }

  const after = await collectBrowserMemorySnapshot(cdp)

  return {
    heapDeltaBytes: Math.max(0, after.JSHeapUsedSize - baseline.JSHeapUsedSize),
    domNodesDelta: Math.max(0, after.Nodes - baseline.Nodes),
    listenerDelta: Math.max(0, after.JSEventListeners - baseline.JSEventListeners)
  }
}

/** 在 50 页级夹具中反复滚动并采样 heap 与 canvas 池峰值。 */
async function measureLongScroll(
  page: Page,
  cdp: CDPSession
): Promise<Readonly<{
  heapDeltaBytes: number
  peakMountedCanvasCount: number
  peakCanvasBytes: number
  finalMountedCanvasCount: number
}>> {
  await page.goto('/test-fixture.html?fixture=gate2')
  await waitForGate2Ready(page)
  await collectGarbage(cdp)
  const baseline = await collectBrowserMemorySnapshot(cdp)
  let peakMountedCanvasCount = 0
  let peakCanvasBytes = 0

  for (let index = 0; index < longScrollSampleCount; index += 1) {
    const ratio = index % 2 === 0
      ? index / Math.max(1, longScrollSampleCount - 1)
      : 1 - (index / Math.max(1, longScrollSampleCount - 1))
    const metrics = await scrollAndReadCanvasMetrics(page, ratio)

    peakMountedCanvasCount = Math.max(peakMountedCanvasCount, metrics.mountedCanvasCount)
    peakCanvasBytes = Math.max(peakCanvasBytes, metrics.canvasBytes)
  }

  await collectGarbage(cdp)
  const after = await collectBrowserMemorySnapshot(cdp)
  const finalCanvasMetrics = await readCanvasMetrics(page)

  return {
    heapDeltaBytes: Math.max(0, after.JSHeapUsedSize - baseline.JSHeapUsedSize),
    peakMountedCanvasCount,
    peakCanvasBytes,
    finalMountedCanvasCount: finalCanvasMetrics.mountedCanvasCount
  }
}

/** 等待 demo 测试钩子与编辑器输入层完成挂载。 */
async function waitForDemoReady(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__jwordTestFixture !== undefined)
  await expect(page.locator('[data-jword-hidden-textarea]')).toHaveCount(1)
}

/** 等待 Gate 2 夹具完成分页并拥有可见 canvas。 */
async function waitForGate2Ready(page: Page): Promise<void> {
  await waitForDemoReady(page)
  await expect(page.locator('[data-jword-canvas-container]')).toHaveAttribute('data-jword-page-count', String(expectedGate2PageCount))
  await expect.poll(async () => readCanvasMetrics(page).then((metrics) => metrics.mountedCanvasCount)).toBeGreaterThan(0)
}

/** 滚动到指定比例并读取当前 canvas 池指标。 */
async function scrollAndReadCanvasMetrics(
  page: Page,
  ratio: number
): Promise<Readonly<{ mountedCanvasCount: number, canvasBytes: number }>> {
  return page.evaluate(async (scrollRatio) => {
    const container = document.querySelector<HTMLElement>('[data-jword-canvas-container]')

    if (container === null) {
      throw new Error('缺少 Phase 4 内存门禁 canvas 容器。')
    }

    const nextFrame = async (): Promise<void> =>
      new Promise((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            resolve()
          })
        })
      })
    const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight)

    container.scrollTop = maxScrollTop * scrollRatio
    container.dispatchEvent(new Event('scroll'))
    await nextFrame()

    const canvases = [...document.querySelectorAll<HTMLCanvasElement>('.jw-editor__page-canvas')]

    return {
      mountedCanvasCount: canvases.length,
      canvasBytes: canvases.reduce((total, canvas) => total + canvas.width * canvas.height * 4, 0)
    }
  }, ratio)
}

/** 读取当前挂载 canvas 数量和字节数。 */
async function readCanvasMetrics(
  page: Page
): Promise<Readonly<{ mountedCanvasCount: number, canvasBytes: number }>> {
  return page.evaluate(() => {
    const canvases = [...document.querySelectorAll<HTMLCanvasElement>('.jw-editor__page-canvas')]

    return {
      mountedCanvasCount: canvases.length,
      canvasBytes: canvases.reduce((total, canvas) => total + canvas.width * canvas.height * 4, 0)
    }
  })
}

/** 触发浏览器 GC，降低采样噪声。 */
async function collectGarbage(cdp: CDPSession): Promise<void> {
  await cdp.send('HeapProfiler.collectGarbage')
}

/** 读取 CDP Performance 内存相关计数。 */
async function collectBrowserMemorySnapshot(cdp: CDPSession): Promise<Readonly<{
  JSHeapUsedSize: number
  Nodes: number
  JSEventListeners: number
}>> {
  await collectGarbage(cdp)
  const { metrics } = await cdp.send('Performance.getMetrics')
  const readMetric = (name: string): number => metrics.find((metric) => metric.name === name)?.value ?? 0

  return {
    JSHeapUsedSize: readMetric('JSHeapUsedSize'),
    Nodes: readMetric('Nodes'),
    JSEventListeners: readMetric('JSEventListeners')
  }
}
