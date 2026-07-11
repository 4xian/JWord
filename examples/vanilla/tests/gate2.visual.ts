/**
 * @fileoverview 职责: 用真实浏览器 canvas 像素验证 Gate 2 多页内容和中段挂载窗口的真实渲染。
 * 边界: 只做浏览器视觉验收，固定少量 Gate 2 修复样张，不把 Gate 3 手势语义算作 Gate 2 证据。
 * 协作: vanilla demo 测试钩子和 canvas renderer。
 * 约束: 通过像素采样证明首/中/末页非空以及中段窗口页已绘制，避免人工打开页面。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

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
  readonly viewportPageIndexes: readonly number[]
  readonly beforeMountedPageIndex: number | null
  readonly beforeMountedHasCanvas: boolean | null
  readonly afterMountedPageIndex: number | null
  readonly afterMountedHasCanvas: boolean | null
}

test('Gate 2 demo paints first, middle, and last fixture pages on real canvases', async ({ page }) => {
  await page.goto('/test-fixture.html?fixture=gate2')
  await waitForGate2FixtureLayout(page)

  const { firstPageIndex, lastPageIndex, pageCount } = await readFixturePageBounds(page)

  await expect(page.locator('[data-jword-canvas-container]')).toHaveAttribute('data-jword-page-count', String(pageCount))

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
  await page.goto('/test-fixture.html?fixture=gate2')
  await waitForGate2FixtureLayout(page)

  const expectedPageCount = await readFixturePageCount(page)

  await expect(page.locator('[data-jword-canvas-container]')).toHaveAttribute('data-jword-page-count', String(expectedPageCount))

  await scrollToRatio(page, 0.5)
  const probe = await readMountedWindowProbe(page)

  expect(probe.pageCount).toBe(expectedPageCount)
  expect(probe.mountedCanvasCount).toBeLessThanOrEqual(5)
  expect(probe.mountedPageIndexes).toHaveLength(probe.mountedCanvasCount)
  expect(probe.viewportPageIndexes[0]).toBeGreaterThan(0)
  expect(probe.viewportPageIndexes[probe.viewportPageIndexes.length - 1]).toBeLessThan(probe.pageCount - 1)
  expect(probe.beforeMountedPageIndex).not.toBeNull()
  expect(probe.afterMountedPageIndex).not.toBeNull()
  expect(probe.beforeMountedHasCanvas).toBe(false)
  expect(probe.afterMountedHasCanvas).toBe(false)

  for (let index = 1; index < probe.viewportPageIndexes.length; index += 1) {
    const previousPageIndex = probe.viewportPageIndexes[index - 1]
    const currentPageIndex = probe.viewportPageIndexes[index]

    expect(currentPageIndex).toBe((previousPageIndex ?? 0) + 1)
  }

  const firstWindowPixels = await samplePagePixels(page, probe.viewportPageIndexes[0]!)
  const lastWindowPixels = await samplePagePixels(page, probe.viewportPageIndexes[probe.viewportPageIndexes.length - 1]!)

  expect(firstWindowPixels.width).toBeGreaterThan(0)
  expect(firstWindowPixels.height).toBeGreaterThan(0)
  expect(firstWindowPixels.nonWhitePixels).toBeGreaterThan(100)
  expect(firstWindowPixels.pageIndex).toBe(probe.viewportPageIndexes[0])
  expect(lastWindowPixels.width).toBeGreaterThan(0)
  expect(lastWindowPixels.height).toBeGreaterThan(0)
  expect(lastWindowPixels.nonWhitePixels).toBeGreaterThan(100)
  expect(lastWindowPixels.pageIndex).toBe(probe.viewportPageIndexes[probe.viewportPageIndexes.length - 1])
})

test('Gate 2 remediation visual baseline renders justify text and row-split table', async ({ page }) => {
  await page.setViewportSize({
    width: 1100,
    height: 900
  })
  await page.goto('/test-fixture.html')
  await waitForGate2FixtureLayout(page)
  await loadGate2RemediationVisualDocument(page)

  const probe = await readGate2RemediationProbe(page)

  expect(probe.pageCount).toBe(2)
  expect(probe.justifiedLineRightEdge).toBeCloseTo(probe.contentRightEdge, 5)
  expect(probe.tableBoxCount).toBe(2)
  expect(probe.tablePageIndexes).toEqual([0, 1])
  expect(probe.tableRowCounts).toEqual([4, 4])
  expect(probe.secondPageNonWhitePixels).toBeGreaterThan(100)
  await expect(page.locator('.jw-demo__workspace')).toHaveScreenshot('gate2-remediation-justify-table-baseline.png', {
    animations: 'disabled',
    caret: 'hide',
    maxDiffPixelRatio: 0.02
  })
})

/** 等待 demo 完成 Gate 2 fixture 初始化并产出分页 layout。 */
async function waitForGate2FixtureLayout(page: Page): Promise<void> {
  await expect.poll(async () => {
    return page.evaluate(() => {
      return window.__jwordTestFixture?.editor.getLayout().pages.length ?? 0
    })
  }).toBeGreaterThan(0)
}

async function readFixturePageBounds(page: Page): Promise<Readonly<{
  firstPageIndex: number
  lastPageIndex: number
  pageCount: number
}>> {
  return page.evaluate(() => {
    const demo = window.__jwordTestFixture
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
      lastPageIndex: last.pageIndex,
      pageCount: pages.length
    }
  })
}

/** 读取当前 demo layout 的页数，避免浏览器测试重复固化 draw-call baseline。 */
async function readFixturePageCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const pages = window.__jwordTestFixture?.editor.getLayout().pages

    if (pages === undefined || pages.length === 0) {
      throw new Error('缺少 Gate 2 fixture 页布局数据')
    }

    return pages.length
  })
}

async function scrollToRatio(page: Page, ratio: number): Promise<void> {
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
    return page.evaluate((targetRatio) => {
      const demo = window.__jwordTestFixture
      const pageCount = demo?.editor.getLayout().pages.length ?? 0
      const mountedPageIndexes = [...document.querySelectorAll<HTMLElement>('[data-jword-page]')]
        .filter((element) => element.querySelector('canvas') !== null)
        .map((element) => Number(element.getAttribute('data-jword-page')))
        .filter((value) => Number.isFinite(value))
        .sort((left, right) => left - right)
      const firstMounted = mountedPageIndexes[0]
      const lastMounted = mountedPageIndexes[mountedPageIndexes.length - 1]

      if (pageCount === 0 || firstMounted === undefined || lastMounted === undefined) {
        return false
      }

      if (targetRatio <= 0) {
        return firstMounted === 0
      }

      if (targetRatio >= 1) {
        return lastMounted === pageCount - 1
      }

      return mountedPageIndexes.some((pageIndex) => pageIndex > 0 && pageIndex < pageCount - 1)
    }, ratio)
  }).toBe(true)
}

async function readMountedEdgePageIndex(
  page: Page,
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

async function readMountedMedianPageIndex(page: Page): Promise<number> {
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

async function readMountedWindowProbe(page: Page): Promise<MountedWindowProbe> {
  return page.evaluate(() => {
    const demo = window.__jwordTestFixture

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
    const viewportPageIndexes = mountedPageIndexes.filter((pageIndex) => pageIndex > 0 && pageIndex < pageCount - 1)
    const firstMountedPageIndex = viewportPageIndexes[0] ?? null
    const lastMountedPageIndex = viewportPageIndexes[viewportPageIndexes.length - 1] ?? null

    return {
      pageCount,
      mountedCanvasCount: mountedPageIndexes.length,
      mountedPageIndexes,
      viewportPageIndexes,
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

/** 加载同时覆盖 justify 与跨页表格的视觉修复夹具。 */
async function loadGate2RemediationVisualDocument(page: Page): Promise<void> {
  await page.evaluate(() => {
    const demo = window.__jwordTestFixture

    if (demo === undefined) {
      throw new Error('缺少 Gate 2 remediation visual 所需的 demo 测试钩子')
    }

    demo.editor.setPageConfig({
      widthTwips: 3600,
      heightTwips: 4800,
      marginTwips: {
        top: 240,
        right: 240,
        bottom: 240,
        left: 240
      }
    })
    demo.editor.loadDocumentModel({
      document: {
        kind: 'document',
        id: 'gate2-remediation-visual-document',
        sections: [
          {
            kind: 'section',
            id: 'gate2-remediation-visual-section',
            blocks: [
              {
                kind: 'paragraph',
                id: 'gate2-remediation-justify-paragraph',
                properties: {
                  alignment: 'justify'
                },
                runs: [
                  {
                    kind: 'run',
                    id: 'gate2-remediation-justify-run',
                    properties: {
                      fontSizePx: 24
                    },
                    inlines: [
                      {
                        kind: 'text',
                        text: '甲乙丙丁戊己庚辛壬癸'
                      }
                    ]
                  }
                ]
              },
              {
                kind: 'table',
                id: 'gate2-remediation-split-table',
                grid: [960, 960, 960],
                border: {
                  color: '#334155',
                  widthTwips: 18
                },
                rows: Array.from({ length: 8 }, (_, rowIndex) => ({
                  id: `gate2-remediation-table-row-${rowIndex + 1}`,
                  properties: {
                    heightTwips: 720
                  },
                  cells: Array.from({ length: 3 }, (_, columnIndex) => ({
                    id: `gate2-remediation-table-cell-${rowIndex + 1}-${columnIndex + 1}`,
                    blocks: [
                      {
                        kind: 'paragraph',
                        id: `gate2-remediation-table-paragraph-${rowIndex + 1}-${columnIndex + 1}`,
                        runs: [
                          {
                            kind: 'run',
                            id: `gate2-remediation-table-run-${rowIndex + 1}-${columnIndex + 1}`,
                            properties: {
                              fontSizePx: 14
                            },
                            inlines: [
                              {
                                kind: 'text',
                                text: columnIndex === 0 ? `分页表格 ${rowIndex + 1}` : `C${columnIndex + 1}`
                              }
                            ]
                          }
                        ]
                      }
                    ]
                  }))
                }))
              }
            ]
          }
        ]
      }
    })
  })

  await expect.poll(async () => {
    return page.evaluate(() => {
      const layout = window.__jwordTestFixture?.editor.getLayout()
      const tableBoxes = layout?.pages.flatMap((pageBox) =>
        pageBox.blocks.filter((block) => block.kind === 'table')
      ) ?? []

      return layout?.pages.length === 2 && tableBoxes.length === 2
    })
  }).toBe(true)
}

/** 读取 Gate 2 修复样张的布局与像素探针。 */
async function readGate2RemediationProbe(page: Page): Promise<Readonly<{
  pageCount: number
  justifiedLineRightEdge: number
  contentRightEdge: number
  tableBoxCount: number
  tablePageIndexes: readonly number[]
  tableRowCounts: readonly number[]
  secondPageNonWhitePixels: number
}>> {
  const secondPagePixels = await samplePagePixels(page, 1)

  return page.evaluate((nonWhitePixels) => {
    const layout = window.__jwordTestFixture?.editor.getLayout()
    const firstPage = layout?.pages[0]
    const firstLine = firstPage?.lines.find((line) => line.paragraphId === 'gate2-remediation-justify-paragraph')
    const lastFragment = firstLine?.fragments.at(-1)
    const tableBoxes = layout?.pages.flatMap((pageBox) =>
      pageBox.blocks.filter((block) => block.kind === 'table')
    ) ?? []

    if (layout === undefined || firstPage === undefined || firstLine === undefined || lastFragment === undefined) {
      throw new Error('缺少 Gate 2 remediation visual 布局探针数据')
    }

    return {
      pageCount: layout.pages.length,
      justifiedLineRightEdge: lastFragment.x + lastFragment.width,
      contentRightEdge: firstPage.contentRect.x + firstPage.contentRect.width,
      tableBoxCount: tableBoxes.length,
      tablePageIndexes: tableBoxes.map((tableBox) => tableBox.pageIndex),
      tableRowCounts: tableBoxes.map((tableBox) => tableBox.rowCount),
      secondPageNonWhitePixels: nonWhitePixels
    }
  }, secondPagePixels.nonWhitePixels)
}

async function samplePagePixels(page: Page, pageIndex: number): Promise<CanvasPixelProbe> {
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
