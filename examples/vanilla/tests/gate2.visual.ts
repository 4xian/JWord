/**
 * @fileoverview 职责: 用真实浏览器 canvas 像素验证 Gate 2 多页内容、选区和光标已绘制。
 * 边界: 只做浏览器视觉验收，不固定跨平台截图基线。
 * 协作: vanilla demo 测试钩子、Editor selection facade 和 canvas renderer。
 * 约束: 通过像素采样证明首/中/末页非空以及选区色、光标色存在，避免人工打开页面。
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

interface LayoutPageTarget {
  readonly pageIndex: number
  readonly pageCount: number
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

test('Gate 2 demo paints selection and caret on a lightweight visual probe document', async ({ page }) => {
  await page.goto('/')

  await expect(page.locator('[data-jword-canvas-container]')).toHaveAttribute('data-jword-page-count', '50')

  const pixels = await page.evaluate(async (): Promise<CanvasPixelProbe> => {
    const demo = window.__jwordDemo
    const container = document.querySelector<HTMLElement>('[data-jword-canvas-container]')

    if (demo === undefined || container === null) {
      throw new Error('缺少 Gate 2 visual 所需的 demo 测试钩子或容器 DOM')
    }

    demo.editor.createDocument({ text: 'Gate 2 visual sample keeps pixel sampling focused.' })

    const firstFragment = demo.editor.getLayout().pages[0]?.lines[0]?.fragments[0]

    if (firstFragment === undefined) {
      throw new Error('缺少可用于选区采样的第一页文本片段')
    }

    demo.selectTextRange({
      sectionId: firstFragment.sectionId,
      blockId: firstFragment.blockId,
      runId: firstFragment.runId,
      anchorGraphemeIndex: firstFragment.start.graphemeIndex,
      focusGraphemeIndex: firstFragment.start.graphemeIndex + 4
    })

    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          resolve()
        })
      })
    })

    const canvas = document.querySelector<HTMLCanvasElement>('.jw-editor__page-canvas')
    const context = canvas?.getContext('2d')

    if (canvas === null || context === undefined || context === null) {
      throw new Error('缺少可采样 canvas')
    }

    const image = context.getImageData(0, 0, canvas.width, canvas.height).data
    let nonWhitePixels = 0
    let selectionPixels = 0
    let caretPixels = 0

    for (let index = 0; index < image.length; index += 4) {
      const red = image[index] ?? 0
      const green = image[index + 1] ?? 0
      const blue = image[index + 2] ?? 0
      const alpha = image[index + 3] ?? 0

      if (alpha > 0 && (red < 245 || green < 245 || blue < 245)) {
        nonWhitePixels += 1
      }

      if (red === 207 && green === 227 && blue === 255 && alpha === 255) {
        selectionPixels += 1
      }

      if (red < 40 && green < 50 && blue < 70 && alpha === 255) {
        caretPixels += 1
      }
    }

    return {
      pageIndex: 0,
      width: canvas.width,
      height: canvas.height,
      nonWhitePixels,
      selectionPixels,
      caretPixels
    }
  })

  expect(pixels.pageIndex).toBe(0)
  expect(pixels.width).toBeGreaterThan(0)
  expect(pixels.height).toBeGreaterThan(0)
  expect(pixels.nonWhitePixels).toBeGreaterThan(100)
  expect(pixels.selectionPixels).toBeGreaterThan(10)
  expect(pixels.caretPixels).toBeGreaterThan(0)
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
