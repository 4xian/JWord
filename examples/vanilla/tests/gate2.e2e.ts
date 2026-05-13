/**
 * @fileoverview 职责: 用真实浏览器验证 Gate 2 vanilla demo 的分页滚动、canvas 虚拟化和 hit-test。
 * 边界: 只覆盖分页 layout/render 行为，不测试 Gate 3 输入系统。
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

test('Gate 2 demo scrolls a 50-page fixture without retaining every canvas', async ({ page }) => {
  await page.goto('/')

  const container = page.locator('[data-jword-canvas-container]')

  await expect(container).toHaveAttribute('data-jword-page-count', /^([5-9]\d|\d{3,})$/u)

  const firstProbe = await readDemoProbe(page)

  expect(firstProbe.pageCount).toBeGreaterThanOrEqual(50)
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
