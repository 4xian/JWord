/**
 * @fileoverview 职责: 用真实浏览器 canvas 像素验证 Gate 2 多页内容和中段挂载窗口的真实渲染。
 * 边界: 只做浏览器视觉验收，不固定跨平台截图基线，不把 Gate 3 手势语义算作 Gate 2 证据。
 * 协作: vanilla demo 测试钩子和 canvas renderer。
 * 约束: 通过像素采样证明首/中/末页非空以及中段窗口页已绘制，避免人工打开页面。
 * Specs: docs/superpowers/specs/2026-05-11-jword-canonical/06-acceptance-and-testing.md。
 */
import { expect, test } from '@playwright/test'

interface CanvasPixelProbe {
  readonly pageIndex: number
  readonly width: number
  readonly height: number
  readonly nonWhitePixels: number
  readonly selectionPixels: number
  readonly caretPixels: number
}

interface MountedWindowProbe {
  readonly pageCount: number
  readonly mountedCanvasCount: number
  readonly mountedPageIndexes: readonly number[]
  readonly beforeMountedPageIndex: number | null
  readonly beforeMountedHasCanvas: boolean | null
  readonly afterMountedPageIndex: number | null
  readonly afterMountedHasCanvas: boolean | null
}

test('Gate 2 demo paints first, middle, and last fixture pages on real canvases', async ({ page }) => {
  await page.goto('/')

  await expect(page.locator('[data-jword-canvas-container]')).toHaveAttribute('data-jword-page-count', '50')

  const { firstPageIndex, lastPageIndex } = await readFixturePageBounds(page)

  await scrollToRatio(page, 0)
  const firstTargetPageIndex = await readMountedEdgePageIndex(page, 'first')
  const firstPixels = await samplePagePixels(page, firstTargetPageIndex)

  expect(firstPixels.width).toBeGreaterThan(0)
  expect(firstPixels.height).toBeGreaterThan(0)
  expect(firstPixels.nonWhitePixels).toBeGreaterThan(100)
  expect(firstPixels.selectionPixels).toBe(0)
  expect(firstPixels.caretPixels).toBe(0)
  expect(firstPixels.pageIndex).toBe(firstPageIndex)

  await scrollToRatio(page, 0.5)
  const middleTargetPageIndex = await readMountedMedianPageIndex(page)
  const middlePixels = await samplePagePixels(page, middleTargetPageIndex)

  expect(middlePixels.width).toBeGreaterThan(0)
  expect(middlePixels.height).toBeGreaterThan(0)
  expect(middlePixels.nonWhitePixels).toBeGreaterThan(100)
  expect(middlePixels.pageIndex).toBeGreaterThan(firstPageIndex)
  expect(middlePixels.pageIndex).toBeLessThan(lastPageIndex)

  await scrollToRatio(page, 1)
  const lastTargetPageIndex = await readMountedEdgePageIndex(page, 'last')
  const lastPixels = await samplePagePixels(page, lastTargetPageIndex)

  expect(lastPixels.width).toBeGreaterThan(0)
  expect(lastPixels.height).toBeGreaterThan(0)
  expect(lastPixels.nonWhitePixels).toBeGreaterThan(100)
  expect(lastPixels.pageIndex).toBe(lastPageIndex)
})

test('Gate 2 demo paints only the mounted middle-window pages after scrolling the 50-page fixture', async ({ page }) => {
  await page.goto('/')

  await expect(page.locator('[data-jword-canvas-container]')).toHaveAttribute('data-jword-page-count', '50')

  await scrollToRatio(page, 0.5)
  const probe = await readMountedWindowProbe(page)

  expect(probe.pageCount).toBe(50)
  expect(probe.mountedCanvasCount).toBeLessThanOrEqual(5)
  expect(probe.mountedPageIndexes).toHaveLength(probe.mountedCanvasCount)
  expect(probe.mountedPageIndexes[0]).toBeGreaterThan(0)
  expect(probe.mountedPageIndexes[probe.mountedPageIndexes.length - 1]).toBeLessThan(probe.pageCount - 1)
  expect(probe.beforeMountedPageIndex).not.toBeNull()
  expect(probe.afterMountedPageIndex).not.toBeNull()
  expect(probe.beforeMountedHasCanvas).toBe(false)
  expect(probe.afterMountedHasCanvas).toBe(false)

  for (let index = 1; index < probe.mountedPageIndexes.length; index += 1) {
    const previousPageIndex = probe.mountedPageIndexes[index - 1]
    const currentPageIndex = probe.mountedPageIndexes[index]

    expect(currentPageIndex).toBe((previousPageIndex ?? 0) + 1)
  }

  const firstWindowPixels = await samplePagePixels(page, probe.mountedPageIndexes[0]!)
  const lastWindowPixels = await samplePagePixels(page, probe.mountedPageIndexes[probe.mountedPageIndexes.length - 1]!)

  expect(firstWindowPixels.width).toBeGreaterThan(0)
  expect(firstWindowPixels.height).toBeGreaterThan(0)
  expect(firstWindowPixels.nonWhitePixels).toBeGreaterThan(100)
  expect(firstWindowPixels.pageIndex).toBe(probe.mountedPageIndexes[0])
  expect(lastWindowPixels.width).toBeGreaterThan(0)
  expect(lastWindowPixels.height).toBeGreaterThan(0)
  expect(lastWindowPixels.nonWhitePixels).toBeGreaterThan(100)
  expect(lastWindowPixels.pageIndex).toBe(probe.mountedPageIndexes[probe.mountedPageIndexes.length - 1])
})

async function readFixturePageBounds(page: import('@playwright/test').Page): Promise<Readonly<{
  firstPageIndex: number
  lastPageIndex: number
}>> {
  return page.evaluate(() => {
    const demo = window.__jwordDemo
    const pages = demo?.editor.getLayout().pages

    if (demo === undefined || pages === undefined || pages.length === 0) {
      throw new Error('缺少 Gate 2 fixture 页布局数据')
    }

    const first = pages[0]
    const last = pages[pages.length - 1]

    if (first === undefined || last === undefined) {
      throw new Error('Gate 2 fixture 缺少首末页')
    }

    return {
      firstPageIndex: first.pageIndex,
      lastPageIndex: last.pageIndex
    }
  })
}

async function scrollToRatio(page: import('@playwright/test').Page, ratio: number): Promise<void> {
  await page.evaluate((inputRatio) => {
    const container = document.querySelector<HTMLElement>('[data-jword-canvas-container]')

    if (container === null) {
      throw new Error('缺少 Gate 2 visual 容器')
    }

    const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight)

    container.scrollTop = maxScrollTop * inputRatio
    container.dispatchEvent(new Event('scroll'))
  }, ratio)

  await expect.poll(async () => {
    return page.evaluate(() => {
      return document.querySelectorAll('[data-jword-page] canvas').length
    })
  }).toBeGreaterThan(0)
}

async function readMountedEdgePageIndex(
  page: import('@playwright/test').Page,
  edge: 'first' | 'last'
): Promise<number> {
  return page.evaluate((targetEdge) => {
    const pageIndexes = [...document.querySelectorAll<HTMLElement>('[data-jword-page]')]
      .filter((element) => element.querySelector('canvas') !== null)
      .map((element) => Number(element.getAttribute('data-jword-page')))
      .filter((value) => Number.isFinite(value))
      .sort((left, right) => left - right)

    if (pageIndexes.length === 0) {
      throw new Error('当前没有已挂载 canvas 页可供采样')
    }

    return targetEdge === 'first'
      ? pageIndexes[0] ?? 0
      : pageIndexes[pageIndexes.length - 1] ?? 0
  }, edge)
}

async function readMountedMedianPageIndex(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() => {
    const pageIndexes = [...document.querySelectorAll<HTMLElement>('[data-jword-page]')]
      .filter((element) => element.querySelector('canvas') !== null)
      .map((element) => Number(element.getAttribute('data-jword-page')))
      .filter((value) => Number.isFinite(value))
      .sort((left, right) => left - right)

    if (pageIndexes.length === 0) {
      throw new Error('当前没有已挂载 canvas 页可供中间页采样')
    }

    return pageIndexes[Math.floor(pageIndexes.length / 2)] ?? pageIndexes[0] ?? 0
  })
}

async function readMountedWindowProbe(page: import('@playwright/test').Page): Promise<MountedWindowProbe> {
  return page.evaluate(() => {
    const demo = window.__jwordDemo

    if (demo === undefined) {
      throw new Error('缺少 Gate 2 visual 所需的 demo 测试钩子')
    }

    const mountedPageIndexes = [...document.querySelectorAll<HTMLElement>('[data-jword-page]')]
      .filter((element) => element.querySelector('canvas') !== null)
      .map((element) => Number(element.getAttribute('data-jword-page')))
      .filter((value): value is number => Number.isFinite(value))
      .sort((left, right) => left - right)

    if (mountedPageIndexes.length < 2) {
      throw new Error('缺少 Gate 2 middle-window 像素采样所需的已挂载文本页')
    }

    const pageCount = demo.editor.getLayout().pages.length
    const firstMountedPageIndex = mountedPageIndexes[0] ?? null
    const lastMountedPageIndex = mountedPageIndexes[mountedPageIndexes.length - 1] ?? null

    return {
      pageCount,
      mountedCanvasCount: mountedPageIndexes.length,
      mountedPageIndexes,
      beforeMountedPageIndex: firstMountedPageIndex === null || firstMountedPageIndex <= 0 ? null : firstMountedPageIndex - 1,
      beforeMountedHasCanvas: firstMountedPageIndex === null || firstMountedPageIndex <= 0
        ? null
        : document.querySelector(`[data-jword-page="${firstMountedPageIndex - 1}"] canvas`) !== null,
      afterMountedPageIndex: lastMountedPageIndex === null || lastMountedPageIndex >= pageCount - 1
        ? null
        : lastMountedPageIndex + 1,
      afterMountedHasCanvas: lastMountedPageIndex === null || lastMountedPageIndex >= pageCount - 1
        ? null
        : document.querySelector(`[data-jword-page="${lastMountedPageIndex + 1}"] canvas`) !== null
    }
  })
}

async function samplePagePixels(page: import('@playwright/test').Page, pageIndex: number): Promise<CanvasPixelProbe> {
  return page.evaluate((targetPageIndex): CanvasPixelProbe => {
    const canvas = document.querySelector<HTMLCanvasElement>(`[data-jword-page="${targetPageIndex}"] .jw-editor__page-canvas`)
    const context = canvas?.getContext('2d')

    if (canvas === null || context === undefined || context === null) {
      throw new Error(`缺少第 ${targetPageIndex + 1} 页可采样 canvas`)
    }

    const image = context.getImageData(0, 0, canvas.width, canvas.height).data
    let nonWhitePixels = 0

    for (let index = 0; index < image.length; index += 4) {
      const red = image[index] ?? 0
      const green = image[index + 1] ?? 0
      const blue = image[index + 2] ?? 0
      const alpha = image[index + 3] ?? 0

      if (alpha > 0 && (red < 245 || green < 245 || blue < 245)) {
        nonWhitePixels += 1
      }
    }

    return {
      pageIndex: targetPageIndex,
      width: canvas.width,
      height: canvas.height,
      nonWhitePixels,
      selectionPixels: 0,
      caretPixels: 0
    }
  }, pageIndex)
}
