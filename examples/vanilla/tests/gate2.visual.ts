/**
 * @fileoverview 职责: 用真实浏览器 canvas 像素验证 Gate 2 页面、选区和光标已绘制。
 * 边界: 只做浏览器视觉 smoke，不固定跨平台截图基线。
 * 协作: vanilla demo 测试钩子、Editor selection facade 和 canvas renderer。
 * 约束: 通过像素采样证明非空、选区色和光标色存在，避免人工打开页面。
 * Specs: docs/superpowers/specs/2026-05-11-jword-canonical/06-acceptance-and-testing.md。
 */
import { expect, test } from '@playwright/test'

interface CanvasPixelProbe {
  readonly width: number
  readonly height: number
  readonly nonWhitePixels: number
  readonly selectionPixels: number
  readonly caretPixels: number
}

test('Gate 2 demo paints page content, selection, and caret on a real canvas', async ({ page }) => {
  await page.goto('/')

  await expect(page.locator('[data-jword-canvas-container]')).toHaveAttribute('data-jword-page-count', '50')

  const pixels = await page.evaluate((): CanvasPixelProbe => {
    const demo = window.__jwordDemo

    if (demo === undefined) {
      throw new Error('缺少 Gate 2 demo 测试钩子')
    }

    demo.editor.createDocument({ text: 'Gate 2 visual sample keeps pixel sampling focused.' })
    const firstFragment = demo.editor.getLayout().pages[0]?.lines[0]?.fragments[0]

    if (firstFragment === undefined) {
      throw new Error('缺少第一页文本片段')
    }

    demo.selectTextRange({
      sectionId: firstFragment.sectionId,
      blockId: firstFragment.blockId,
      runId: firstFragment.runId,
      anchorGraphemeIndex: firstFragment.start.graphemeIndex,
      focusGraphemeIndex: firstFragment.start.graphemeIndex + 4
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
      width: canvas.width,
      height: canvas.height,
      nonWhitePixels,
      selectionPixels,
      caretPixels
    }
  })

  expect(pixels.width).toBeGreaterThan(0)
  expect(pixels.height).toBeGreaterThan(0)
  expect(pixels.nonWhitePixels).toBeGreaterThan(100)
  expect(pixels.selectionPixels).toBeGreaterThan(10)
  expect(pixels.caretPixels).toBeGreaterThan(0)
})
