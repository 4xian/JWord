/**
 * @fileoverview 职责: 用真实浏览器 canvas 像素补齐 Gate 3 输入阶段的最小视觉证据，覆盖选区高亮与光标渲染。
 * 边界: 不生成跨平台截图基线，不声称等同 Windows 原生 IME 视觉验收。
 * 协作: `window.__jwordDemo`、隐藏输入框测试钩子、Alpha 样例和 canvas renderer。
 * 约束: 证据必须来自真实 canvas 像素与公开 facade 的 caret/selection 几何，避免退化成纯 DOM 断言。
 * Specs: docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md Gate 3 Step 3.12、3.13。
 */
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

interface Gate3VisualProbe {
  readonly pageIndex: number
  readonly width: number
  readonly height: number
  readonly selectionPixels: number
  readonly caretPixels: number
  readonly nonWhitePixels: number
}

test('Gate 3 Alpha paints selection highlight and caret on the real page canvas', async ({ page }) => {
  await page.goto('/?fixture=gate2')
  await waitForGate3AlphaReady(page)

  const selectionProbe = await selectSampleAndReadVisualProbe(page)

  expect(selectionProbe.width).toBeGreaterThan(0)
  expect(selectionProbe.height).toBeGreaterThan(0)
  expect(selectionProbe.nonWhitePixels).toBeGreaterThan(100)
  expect(selectionProbe.selectionPixels).toBeGreaterThan(20)
  expect(selectionProbe.caretPixels).toBe(0)

  const caretProbe = await collapseSelectionAndReadVisualProbe(page)

  expect(caretProbe.width).toBeGreaterThan(0)
  expect(caretProbe.height).toBeGreaterThan(0)
  expect(caretProbe.nonWhitePixels).toBeGreaterThan(100)
  expect(caretProbe.selectionPixels).toBe(0)

  await expect.poll(async () => {
    const visibleCaretProbe = await readCurrentVisualProbe(page)

    return visibleCaretProbe.caretPixels
  }, {
    timeout: 1400
  }).toBeGreaterThan(0)
})

async function waitForGate3AlphaReady(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__jwordDemo !== undefined)
  await expect(page.locator('[data-jword-hidden-textarea]')).toHaveCount(1)
  await page.getByRole('button', { name: '加载 Alpha 样例' }).click()
  await expect(page.locator('[data-jword-canvas-container]')).toHaveAttribute('data-jword-page-count', '1')
}

async function selectSampleAndReadVisualProbe(page: Page): Promise<Gate3VisualProbe> {
  await page.getByRole('button', { name: '选择首页片段' }).click()

  await expect.poll(() => page.evaluate(() => {
    return document.querySelector<HTMLElement>('[data-jword-selection-summary]')?.textContent ?? ''
  })).toContain('run-1')

  return readCurrentVisualProbe(page)
}

async function collapseSelectionAndReadVisualProbe(page: Page): Promise<Gate3VisualProbe> {
  const point = await page.evaluate(() => {
    const demo = window.__jwordDemo

    if (demo === undefined) {
      throw new Error('缺少 Gate 3 demo 测试钩子')
    }

    const firstBlock = demo.editor.getProjection().document.sections[0]?.blocks[0]
    const firstRun = firstBlock?.kind === 'paragraph' ? firstBlock.runs[0] : undefined
    const runText = firstRun?.inlines.map((inline) => inline.kind === 'text' ? inline.text : '').join('') ?? ''
    const graphemeIndex = Array.from(runText).length

    const anchor = demo.editor.createTextAnchor({
      sectionId: 'section-1',
      blockId: 'paragraph-1',
      runId: 'run-1',
      graphemeIndex
    })

    const caretRect = demo.editor.getCaretRect(anchor)
    const pageBox = demo.editor.getLayout().pages[caretRect?.pageIndex ?? 0]
    const canvas = document.querySelector<HTMLCanvasElement>(`[data-jword-page="${caretRect?.pageIndex ?? 0}"] .jw-editor__page-canvas`)
    const canvasRect = canvas?.getBoundingClientRect()

    if (caretRect === undefined || pageBox === undefined || canvasRect === undefined) {
      throw new Error('无法读取 Gate 3 visual caret 点击坐标')
    }

    return {
      clientX: canvasRect.left + ((caretRect.x - pageBox.x + 1) * canvasRect.width) / pageBox.width,
      clientY: canvasRect.top + ((caretRect.y - pageBox.y + caretRect.height / 2) * canvasRect.height) / pageBox.height,
      selectionSummary: `${graphemeIndex}→${graphemeIndex}`
    }
  })

  await page.mouse.click(point.clientX, point.clientY)

  await expect.poll(() => page.evaluate(() => {
    return document.querySelector<HTMLElement>('[data-jword-selection-summary]')?.textContent ?? ''
  })).toContain(point.selectionSummary)

  return readCurrentVisualProbe(page)
}

async function readCurrentVisualProbe(page: Page): Promise<Gate3VisualProbe> {
  return page.evaluate(() => {
    const demo = window.__jwordDemo
    const pageBox = demo?.editor.getLayout().pages[0]
    const pageIndex = pageBox?.pageIndex ?? 0
    const selection = demo?.editor.getSelection() ?? null
    const anchorPosition = selection === null ? undefined : demo?.editor.resolveTextPosition(selection.anchor)
    const focusPosition = selection === null ? undefined : demo?.editor.resolveTextPosition(selection.focus)
    const caretRect = selection === null
      || anchorPosition === undefined
      || focusPosition === undefined
      || anchorPosition.sectionId !== focusPosition.sectionId
      || anchorPosition.blockId !== focusPosition.blockId
      || anchorPosition.runId !== focusPosition.runId
      || anchorPosition.graphemeIndex !== focusPosition.graphemeIndex
      ? undefined
      : demo?.editor.getCaretRect(selection.focus)

    const canvas = document.querySelector<HTMLCanvasElement>(`[data-jword-page="${pageIndex}"] .jw-editor__page-canvas`)
    const context = canvas?.getContext('2d')

    if (canvas === null || context === null || context === undefined) {
      throw new Error(`缺少第 ${pageIndex + 1} 页 Gate 3 visual canvas`)
    }

    const image = context.getImageData(0, 0, canvas.width, canvas.height).data
    let nonWhitePixels = 0
    let selectionPixels = 0
    let caretPixels = 0
    const caretLeft = caretRect === undefined || pageBox === undefined
      ? -1
      : Math.max(0, Math.floor(((caretRect.x - pageBox.x) * canvas.width) / pageBox.width) - 3)
    const caretTop = caretRect === undefined || pageBox === undefined
      ? -1
      : Math.max(0, Math.floor(((caretRect.y - pageBox.y) * canvas.height) / pageBox.height))
    const caretRight = caretRect === undefined
      ? -1
      : Math.min(
          canvas.width,
          Math.ceil((((caretRect.x - (pageBox?.x ?? 0)) + Math.max(1, caretRect.width)) * canvas.width) / (pageBox?.width ?? 1)) + 4
        )
    const caretBottom = caretRect === undefined
      ? -1
      : Math.min(
          canvas.height,
          Math.ceil((((caretRect.y - (pageBox?.y ?? 0)) + Math.max(1, caretRect.height)) * canvas.height) / (pageBox?.height ?? 1))
        )

    for (let index = 0; index < image.length; index += 4) {
      const red = image[index] ?? 0
      const green = image[index + 1] ?? 0
      const blue = image[index + 2] ?? 0
      const alpha = image[index + 3] ?? 0
      const pixelIndex = index / 4
      const pixelX = pixelIndex % canvas.width
      const pixelY = Math.floor(pixelIndex / canvas.width)

      if (alpha === 0) {
        continue
      }

      if (red < 245 || green < 245 || blue < 245) {
        nonWhitePixels += 1
      }

      if (red >= 200 && red <= 215 && green >= 224 && green <= 235 && blue >= 250) {
        selectionPixels += 1
      }

      if (
        caretRect !== undefined
        && pixelX >= caretLeft
        && pixelX < caretRight
        && pixelY >= caretTop
        && pixelY < caretBottom
        && red <= 80
        && green <= 90
        && blue <= 110
      ) {
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
