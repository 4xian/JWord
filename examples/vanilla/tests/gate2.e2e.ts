/**
 * @fileoverview 职责: 用真实浏览器验证 Gate 2 vanilla demo 的分页滚动、canvas 虚拟化、hit-test、debug overlay 和 page geometry。
 * 边界: 只覆盖分页 layout/render 行为，不测试 Gate 3 输入系统或手势选择语义。
 * 协作: examples/vanilla 测试钩子、@4xian/jword-core Editor facade 和 Playwright 项目矩阵。
 * 约束: 不依赖截图人工判断，断言必须来自 DOM 属性、canvas 数量和公开 facade 返回值。
 * Specs: docs/superpowers/specs/2026-05-11-jword-canonical/06-acceptance-and-testing.md。
 */
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

interface TextPositionProbe {
  readonly sectionId: string
  readonly blockId: string
  readonly runId: string
  readonly graphemeIndex: number
  readonly assoc?: number
}

interface DemoProbe {
  readonly pageCount: number
  readonly mountedCanvasCount: number
  readonly maxCanvasSidePx: number
  readonly lastPageCanvasMounted: boolean
  readonly hitPageIndex: number | null
  readonly hitPosition: TextPositionProbe | null
  readonly hitCaretPageIndex: number | null
}

interface ClientPointProbe {
  readonly clientX: number
  readonly clientY: number
}

interface MountedPageGeometryProbe {
  readonly pageIndex: number
  readonly wrapperWidthPx: number
  readonly wrapperHeightPx: number
  readonly canvasWidthPx: number
  readonly canvasHeightPx: number
  readonly point: ClientPointProbe
  readonly pageOverlayBoxCount: number
  readonly fragmentOverlayBoxCount: number
}

interface MountedViewportProbe {
  readonly pageCount: number
  readonly mountedCanvasCount: number
  readonly mountedPageIndexes: readonly number[]
  readonly targetPages: readonly MountedPageGeometryProbe[]
  readonly beforeMountedPageIndex: number | null
  readonly beforeMountedHasCanvas: boolean | null
  readonly afterMountedPageIndex: number | null
  readonly afterMountedHasCanvas: boolean | null
}

test('Gate 2 demo scrolls a 50-page fixture without retaining every canvas', async ({ page }) => {
  await page.goto('/')

  const container = page.locator('[data-jword-canvas-container]')

  await expect(container).toHaveAttribute('data-jword-page-count', '50')

  const firstProbe = await readDemoProbe(page)

  expect(firstProbe.pageCount).toBe(50)
  expect(firstProbe.mountedCanvasCount).toBeLessThanOrEqual(5)
  expect(firstProbe.maxCanvasSidePx).toBeLessThanOrEqual(4096)
  expect(firstProbe.hitPosition).not.toBeNull()
  expect(firstProbe.hitPageIndex).toBeGreaterThan(0)
  expect(firstProbe.hitCaretPageIndex).toBe(firstProbe.hitPageIndex)

  await container.evaluate((element) => {
    element.scrollTop = element.scrollHeight - element.clientHeight
    element.dispatchEvent(new Event('scroll'))
  })

  await expect.poll(async () => (await readDemoProbe(page)).lastPageCanvasMounted).toBe(true)

  const lastProbe = await readDemoProbe(page)

  expect(lastProbe.mountedCanvasCount).toBeLessThanOrEqual(5)
  expect(lastProbe.maxCanvasSidePx).toBeLessThanOrEqual(4096)
})

test('Gate 2 demo keeps mounted page geometry and debug overlay aligned on the 50-page fixture', async ({ page }) => {
  await page.goto('/')

  const container = page.locator('[data-jword-canvas-container]')

  await expect(container).toHaveAttribute('data-jword-page-count', '50')

  await scrollToRatio(page, 0.5)

  const probe = await readMountedViewportProbe(page)

  expect(probe.pageCount).toBe(50)
  expect(probe.mountedCanvasCount).toBeLessThanOrEqual(5)
  expect(probe.mountedPageIndexes).toHaveLength(probe.mountedCanvasCount)
  expect(probe.mountedPageIndexes[0]).toBeGreaterThan(0)
  expect(probe.mountedPageIndexes[probe.mountedPageIndexes.length - 1]).toBeLessThan(probe.pageCount - 1)
  expect(probe.targetPages).toHaveLength(2)
  expect(probe.beforeMountedPageIndex).not.toBeNull()
  expect(probe.afterMountedPageIndex).not.toBeNull()
  expect(probe.beforeMountedHasCanvas).toBe(false)
  expect(probe.afterMountedHasCanvas).toBe(false)

  for (let index = 1; index < probe.mountedPageIndexes.length; index += 1) {
    const previousPageIndex = probe.mountedPageIndexes[index - 1]
    const currentPageIndex = probe.mountedPageIndexes[index]

    expect(currentPageIndex).toBe((previousPageIndex ?? 0) + 1)
  }

  for (const targetPage of probe.targetPages) {
    expect(targetPage.wrapperWidthPx).toBeGreaterThan(0)
    expect(targetPage.wrapperHeightPx).toBeGreaterThan(0)
    expect(Math.abs(targetPage.canvasWidthPx - targetPage.wrapperWidthPx)).toBeLessThanOrEqual(1)
    expect(Math.abs(targetPage.canvasHeightPx - targetPage.wrapperHeightPx)).toBeLessThanOrEqual(1)
    expect(targetPage.point.clientX).toBeGreaterThan(0)
    expect(targetPage.point.clientY).toBeGreaterThan(0)
    expect(targetPage.pageOverlayBoxCount).toBe(1)
    expect(targetPage.fragmentOverlayBoxCount).toBeGreaterThan(0)
  }
})

async function readDemoProbe(page: Page): Promise<DemoProbe> {
  return page.evaluate(() => {
    const demo = window.__jwordDemo

    if (demo === undefined) {
      throw new Error('缺少 Gate 2 demo 测试钩子')
    }

    const layout = demo.editor.getLayout()
    const hitPage = layout.pages.find((pageBox) =>
      pageBox.pageIndex > 0 && pageBox.lines.some((line) => line.fragments.length > 0)
    )
    const hitLine = hitPage?.lines.find((line) => line.fragments.length > 0)
    const hitFragment = hitLine?.fragments[0]
    const hitAnchor = hitPage === undefined || hitFragment === undefined
      ? undefined
      : demo.editor.hitTest({
          pageIndex: hitPage.pageIndex,
          x: hitFragment.x - hitPage.x + 1,
          y: hitFragment.y - hitPage.y + 1
        })
    const canvases = [...document.querySelectorAll<HTMLCanvasElement>('.jw-editor__page-canvas')]
    const lastPageIndex = layout.pages.length - 1

    return {
      pageCount: layout.pages.length,
      mountedCanvasCount: canvases.length,
      maxCanvasSidePx: canvases.reduce((maxSide, canvas) => Math.max(maxSide, canvas.width, canvas.height), 0),
      lastPageCanvasMounted: document.querySelector(`[data-jword-page="${lastPageIndex}"] canvas`) !== null,
      hitPageIndex: hitPage?.pageIndex ?? null,
      hitPosition: hitAnchor === undefined ? null : demo.editor.resolveTextPosition(hitAnchor),
      hitCaretPageIndex: hitAnchor === undefined ? null : demo.editor.getCaretRect(hitAnchor)?.pageIndex ?? null
    }
  })
}

async function scrollToRatio(page: Page, ratio: number): Promise<void> {
  await page.evaluate((inputRatio) => {
    const container = document.querySelector<HTMLElement>('[data-jword-canvas-container]')

    if (container === null) {
      throw new Error('缺少 Gate 2 e2e 容器')
    }

    const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight)

    container.scrollTop = maxScrollTop * inputRatio
    container.dispatchEvent(new Event('scroll'))
  }, ratio)

  await expect.poll(async () => {
    return page.evaluate(() => document.querySelectorAll('[data-jword-page] canvas').length)
  }).toBeGreaterThan(0)
}

async function readMountedViewportProbe(page: Page): Promise<MountedViewportProbe> {
  return page.evaluate(() => {
    const demo = window.__jwordDemo

    if (demo === undefined) {
      throw new Error('缺少 Gate 2 demo 测试钩子')
    }

    const layout = demo.editor.getLayout()
    const overlayBoxes = layout.debugOverlay.boxes
    const mountedPageIndexes = [...document.querySelectorAll<HTMLElement>('[data-jword-page]')]
      .filter((element) => element.querySelector('canvas') !== null)
      .map((element) => Number(element.getAttribute('data-jword-page')))
      .filter((pageIndex): pageIndex is number => Number.isFinite(pageIndex))
      .sort((left, right) => left - right)

    if (mountedPageIndexes.length < 2) {
      throw new Error('缺少 Gate 2 geometry probe 所需的已挂载文本页')
    }

    const visibleMountedPageIndexes = mountedPageIndexes.filter((pageIndex) => {
      const wrapper = document.querySelector<HTMLElement>(`[data-jword-page="${pageIndex}"]`)

      if (wrapper === null) {
        return false
      }

      const rect = wrapper.getBoundingClientRect()

      return rect.bottom > 0
        && rect.right > 0
        && rect.top < window.innerHeight
        && rect.left < window.innerWidth
    })

    const readMountedPageGeometry = (pageIndex: number): MountedPageGeometryProbe => {
      const pageBox = layout.pages[pageIndex]
      const wrapper = document.querySelector<HTMLElement>(`[data-jword-page="${pageIndex}"]`)
      const canvas = wrapper?.querySelector<HTMLCanvasElement>('.jw-editor__page-canvas')

      if (pageBox === undefined || wrapper === null || canvas === null || canvas === undefined) {
        throw new Error(`缺少第 ${pageIndex + 1} 页 geometry probe 所需的布局或 DOM`)
      }

      const wrapperRect = wrapper.getBoundingClientRect()
      const canvasRect = canvas.getBoundingClientRect()
      const visibleLeft = Math.max(wrapperRect.left, 0)
      const visibleRight = Math.min(wrapperRect.right, window.innerWidth)
      const visibleTop = Math.max(wrapperRect.top, 0)
      const visibleBottom = Math.min(wrapperRect.bottom, window.innerHeight)
      const point = {
        clientX: visibleRight > visibleLeft
          ? visibleLeft + (visibleRight - visibleLeft) / 2
          : wrapperRect.left + wrapperRect.width / 2,
        clientY: visibleBottom > visibleTop
          ? visibleTop + (visibleBottom - visibleTop) / 2
          : wrapperRect.top + wrapperRect.height / 2
      }

      return {
        pageIndex: pageBox.pageIndex,
        wrapperWidthPx: wrapperRect.width,
        wrapperHeightPx: wrapperRect.height,
        canvasWidthPx: canvasRect.width,
        canvasHeightPx: canvasRect.height,
        point,
        pageOverlayBoxCount: overlayBoxes.filter((box) => box.kind === 'page' && box.pageIndex === pageIndex).length,
        fragmentOverlayBoxCount: overlayBoxes.filter((box) => box.kind === 'fragment' && box.pageIndex === pageIndex).length
      }
    }

    const firstMountedPageIndex = mountedPageIndexes[0] ?? null
    const lastMountedPageIndex = mountedPageIndexes[mountedPageIndexes.length - 1] ?? null
    const targetPageIndexes = [
      visibleMountedPageIndexes[0] ?? firstMountedPageIndex,
      visibleMountedPageIndexes[visibleMountedPageIndexes.length - 1] ?? lastMountedPageIndex
    ].filter((pageIndex, index, values): pageIndex is number => {
      return pageIndex !== null && pageIndex !== undefined && values.indexOf(pageIndex) === index
    })

    return {
      pageCount: layout.pages.length,
      mountedCanvasCount: document.querySelectorAll<HTMLCanvasElement>('.jw-editor__page-canvas').length,
      mountedPageIndexes,
      targetPages: targetPageIndexes.map((pageIndex) => readMountedPageGeometry(pageIndex)),
      beforeMountedPageIndex: firstMountedPageIndex === null || firstMountedPageIndex <= 0 ? null : firstMountedPageIndex - 1,
      beforeMountedHasCanvas: firstMountedPageIndex === null || firstMountedPageIndex <= 0
        ? null
        : document.querySelector(`[data-jword-page="${firstMountedPageIndex - 1}"] canvas`) !== null,
      afterMountedPageIndex: lastMountedPageIndex === null || lastMountedPageIndex >= layout.pages.length - 1
        ? null
        : lastMountedPageIndex + 1,
      afterMountedHasCanvas: lastMountedPageIndex === null || lastMountedPageIndex >= layout.pages.length - 1
        ? null
        : document.querySelector(`[data-jword-page="${lastMountedPageIndex + 1}"] canvas`) !== null
    }
  })
}
