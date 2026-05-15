/**
 * @fileoverview 职责: 用真实浏览器 canvas 像素补齐 Gate 3 输入阶段的最小视觉证据，覆盖选区高亮与光标渲染。
 * 边界: 不生成跨平台截图基线，不声称等同 Windows 原生 IME 视觉验收。
 * 协作: `window.__jwordDemo`、隐藏输入框测试钩子、Alpha 样例和 canvas renderer。
 * 约束: 证据必须来自真实 canvas 像素与公开 facade 的 caret/selection 几何，避免退化成纯 DOM 断言。
 * Specs: docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md Gate 3 Step 3.12、3.13。
 */
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import type { RangeRef } from '@4xian/jword-core'

interface Gate3VisualProbe {
  readonly pageIndex: number
  readonly width: number
  readonly height: number
  readonly selectionPixels: number
  readonly caretPixels: number
  readonly nonWhitePixels: number
}

test('Gate 3 Alpha paints selection highlight and caret on the real page canvas', async ({ page }) => {
  await page.goto('/')
  await waitForGate3AlphaReady(page)

  const selectionProbe = await selectSampleAndReadVisualProbe(page)

  expect(selectionProbe.width).toBeGreaterThan(0)
  expect(selectionProbe.height).toBeGreaterThan(0)
  expect(selectionProbe.nonWhitePixels).toBeGreaterThan(100)
  expect(selectionProbe.selectionPixels).toBeGreaterThan(20)
  expect(selectionProbe.caretPixels).toBeGreaterThan(0)

  const caretProbe = await collapseSelectionAndReadVisualProbe(page)

  expect(caretProbe.width).toBeGreaterThan(0)
  expect(caretProbe.height).toBeGreaterThan(0)
  expect(caretProbe.nonWhitePixels).toBeGreaterThan(100)
  expect(caretProbe.selectionPixels).toBe(0)
  expect(caretProbe.caretPixels).toBeGreaterThan(0)
})

async function waitForGate3AlphaReady(page: Page): Promise<void> {
  await expect(page.locator('[data-jword-canvas-container]')).toHaveAttribute('data-jword-page-count', '50')
  await page.waitForFunction(() => window.__jwordDemo !== undefined)
  await page.getByRole('button', { name: '加载 Alpha 样例' }).click()
  await expect(page.locator('[data-jword-canvas-container]')).toHaveAttribute('data-jword-page-count', '1')
}

async function selectSampleAndReadVisualProbe(page: Page): Promise<Gate3VisualProbe> {
  await page.getByRole('button', { name: '选择首页片段' }).click()

  await expect.poll(() => page.evaluate(() => {
    return document.querySelector<HTMLElement>('[data-jword-selection-summary]')?.textContent ?? ''
  })).toContain('run-1')

  return page.evaluate(() => {
    const demo = window.__jwordDemo
    const pageIndex = demo?.editor.getLayout().pages[0]?.pageIndex ?? 0

    const canvas = document.querySelector<HTMLCanvasElement>(`[data-jword-page="${pageIndex}"] .jw-editor__page-canvas`)
    const context = canvas?.getContext('2d')

    if (canvas === null || context === null || context === undefined) {
      throw new Error(`缺少第 ${pageIndex + 1} 页 Gate 3 visual canvas`)
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

      if (alpha === 0) {
        continue
      }

      if (red < 245 || green < 245 || blue < 245) {
        nonWhitePixels += 1
      }

      if (red >= 200 && red <= 215 && green >= 224 && green <= 235 && blue >= 250) {
        selectionPixels += 1
      }

      if (red <= 32 && green <= 40 && blue <= 55) {
        caretPixels += 1
      }
    }

    return {
      pageIndex,
      width: canvas.width,
      height: canvas.height,
      selectionPixels,
      caretPixels,
      nonWhitePixels
    }
  })
}

async function collapseSelectionAndReadVisualProbe(page: Page): Promise<Gate3VisualProbe> {
  await page.evaluate(() => {
    const demo = window.__jwordDemo

    if (demo === undefined) {
      throw new Error('缺少 Gate 3 demo 测试钩子')
    }

    const anchor = demo.editor.createTextAnchor({
      sectionId: 'section-1',
      blockId: 'paragraph-1',
      runId: 'run-1',
      graphemeIndex: 1
    })

    demo.editor.setSelection({
      anchor,
      focus: anchor,
      range: Object.freeze({ anchor, focus: anchor }) as RangeRef,
      direction: 'none',
      affinity: 'none'
    })
  })

  await expect.poll(() => page.evaluate(() => {
    return document.querySelector<HTMLElement>('[data-jword-selection-summary]')?.textContent ?? ''
  })).toContain('1→1')

  return page.evaluate(() => {
    const demo = window.__jwordDemo
    const pageIndex = demo?.editor.getLayout().pages[0]?.pageIndex ?? 0

    const canvas = document.querySelector<HTMLCanvasElement>(`[data-jword-page="${pageIndex}"] .jw-editor__page-canvas`)
    const context = canvas?.getContext('2d')

    if (canvas === null || context === null || context === undefined) {
      throw new Error(`缺少第 ${pageIndex + 1} 页 Gate 3 visual canvas`)
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

      if (alpha === 0) {
        continue
      }

      if (red < 245 || green < 245 || blue < 245) {
        nonWhitePixels += 1
      }

      if (red >= 200 && red <= 215 && green >= 224 && green <= 235 && blue >= 250) {
        selectionPixels += 1
      }

      if (red <= 32 && green <= 40 && blue <= 55) {
        caretPixels += 1
      }
    }

    return {
      pageIndex,
      width: canvas.width,
      height: canvas.height,
      selectionPixels,
      caretPixels,
      nonWhitePixels
    }
  })
}
