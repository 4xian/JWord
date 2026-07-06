/**
 * @fileoverview 职责: 覆盖 Gate 3 输入阶段的真实 canvas 点击、拖拽、双击与中文命中偏移选区回归。
 * 边界: 只验证普通样例的指针选区，不覆盖大文档长拖或键盘编辑路径。
 * 协作: 输入辅助模块、浏览器演示钩子、画布命中测试与样例文档。
 * 约束: 断言必须来自真实 canvas 命中、选区快照和绘制像素探针，不伪造内部 selection。
 * Specs: docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md Gate 3 Step 3.12。
 */
import { expect, test } from '@playwright/test'
import {
  readAlphaChineseDoubleClickProbes,
  readCanvasCursor,
  readClientPointForGrapheme,
  readResolvedSelectionSnapshot,
  readSelectionSummary,
  readSelectionVisualProbe,
  waitForGate3AlphaReady
} from './gate3-input-helpers'

test('Gate 3 runtime pointer selection supports click drag and double click on the real canvas', async ({ page }) => {
  await page.goto('/?fixture=gate2')
  await waitForGate3AlphaReady(page)

  const clickPoint = await readClientPointForGrapheme(page, 1)

  await page.mouse.click(clickPoint.clientX, clickPoint.clientY)
  await expect.poll(() => readSelectionSummary(page)).toContain('1→1')

  const dragStart = await readClientPointForGrapheme(page, 1)
  const dragEnd = await readClientPointForGrapheme(page, 5)

  await page.mouse.move(dragStart.clientX, dragStart.clientY)
  await page.mouse.down()
  await page.mouse.move(dragEnd.clientX, dragEnd.clientY, { steps: 8 })
  await expect.poll(async () => {
    const probe = await readSelectionVisualProbe(page, 0)

    return probe.selectionPixels
  }).toBeGreaterThan(20)
  await page.mouse.up()
  await expect.poll(async () => {
    const snapshot = await readResolvedSelectionSnapshot(page)

    return snapshot.range
  }).toMatchObject({
    startGraphemeIndex: 1,
    endGraphemeIndex: 5
  })
  await expect.poll(() => readCanvasCursor(page, 0)).toBe('text')

  const wordPoint = await readClientPointForGrapheme(page, 2)

  await page.mouse.dblclick(wordPoint.clientX, wordPoint.clientY)
  await expect.poll(() => readSelectionSummary(page)).toContain('0→5')

  const secondWordPoint = await readClientPointForGrapheme(page, 7)

  await page.mouse.dblclick(secondWordPoint.clientX, secondWordPoint.clientY)
  await expect.poll(() => readSelectionSummary(page)).toContain('6→13')
})

test('Gate 3 runtime double click expands Chinese selection by the real hit bias on the real canvas', async ({ page }) => {
  await page.goto('/')
  await waitForGate3AlphaReady(page)

  const chineseProbes = await readAlphaChineseDoubleClickProbes(page)

  for (const probe of chineseProbes) {
    await page.mouse.dblclick(probe.clientX, probe.clientY)

    await expect.poll(async () => {
      const snapshot = await readResolvedSelectionSnapshot(page)

      return snapshot.range
    }).toEqual({
      startGraphemeIndex: probe.expectedStartGraphemeIndex,
      endGraphemeIndex: probe.expectedEndGraphemeIndex
    })
  }
})
