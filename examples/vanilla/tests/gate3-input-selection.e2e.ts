/**
 * @fileoverview 职责: 覆盖 Gate 3 输入阶段的真实 canvas 点击、拖拽、双击与中文命中偏移选区回归。
 * 边界: 只验证普通样例的指针选区，不覆盖大文档长拖或键盘编辑路径。
 * 协作: 输入辅助模块、浏览器演示钩子、画布命中测试与样例文档。
 * 约束: 断言必须来自真实 canvas 命中、选区快照和绘制像素探针，不伪造内部 selection。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
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
  await page.goto('/test-fixture.html?fixture=gate2')
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

  await page.getByRole('button', { name: '加载 Alpha 样例' }).click()
  await expect(page.locator('[data-jword-canvas-container]')).toHaveAttribute('data-jword-page-count', '1')

  const wordPoint = await readClientPointForGrapheme(page, 2)

  await page.mouse.dblclick(wordPoint.clientX, wordPoint.clientY)
  await expect.poll(() => readSelectionSummary(page)).toContain('0→5')

  await page.getByRole('button', { name: '加载 Alpha 样例' }).click()
  await expect(page.locator('[data-jword-canvas-container]')).toHaveAttribute('data-jword-page-count', '1')

  const secondWordPoint = await readClientPointForGrapheme(page, 7)

  await page.mouse.dblclick(secondWordPoint.clientX, secondWordPoint.clientY)
  await expect.poll(() => readSelectionSummary(page)).toContain('6→13')
})

test('Gate 3 demo keeps caret centered after punctuation and latin text', async ({ page }) => {
  await page.goto('/test-fixture.html')
  await waitForGate3AlphaReady(page)

  const probe = await page.evaluate(() => {
    const demo = window.__jwordTestFixture

    if (demo === undefined) {
      throw new Error('缺少 Gate 3 demo caret 垂直居中测试钩子')
    }

    demo.editor.createDocument({
      text: '保持一致。pqrstuvwxyz，观察。'
    })

    const layout = demo.editor.getLayout()
    const lines = layout.pages[0]?.lines ?? []
    const firstLine = lines[0]

    if (firstLine === undefined || firstLine.fragments.length === 0) {
      throw new Error('缺少 demo caret 垂直居中断言所需的首行片段')
    }

    const readSpread = (values: readonly number[]): number => Math.max(...values) - Math.min(...values)
    const readCaretCenterDelta = (lineIndex: number, fragmentText: string): number => {
      const line = lines[lineIndex]
      const fragment = line?.fragments.find((candidate) => candidate.text === fragmentText)

      if (line === undefined || fragment === undefined) {
        throw new Error('缺少 demo caret 垂直居中断言所需的行或片段')
      }

      const caret = demo.editor.getCaretRect(demo.editor.createTextAnchor({
        ...fragment.end,
        assoc: -1
      }))

      if (caret === undefined) {
        throw new Error('无法读取 demo caret rect')
      }

      return Math.abs((caret.y + (caret.height / 2)) - (line.y + (line.height / 2)))
    }
    const firstFragment = firstLine.fragments[0]
    const lastFragment = firstLine.fragments.at(-1)
    const selection = firstFragment === undefined || lastFragment === undefined
      ? null
      : demo.selectTextRange({
          sectionId: firstFragment.sectionId,
          blockId: firstFragment.blockId,
          runId: firstFragment.runId,
          anchorGraphemeIndex: firstFragment.start.graphemeIndex,
          focusGraphemeIndex: lastFragment.end.graphemeIndex
        })
    const selectionRects = selection === null ? [] : demo.editor.getSelectionRects(selection.range)

    return {
      chinesePunctuationDelta: readCaretCenterDelta(0, '。'),
      latinCommaDelta: readCaretCenterDelta(0, '，'),
      fragmentTopSpread: readSpread(firstLine.fragments.map((fragment) => fragment.y)),
      fragmentHeightSpread: readSpread(firstLine.fragments.map((fragment) => fragment.height)),
      lineHeight: firstLine.height,
      selectionHeight: selectionRects[0]?.height ?? 0
    }
  })

  expect(probe.chinesePunctuationDelta).toBeLessThanOrEqual(1)
  expect(probe.latinCommaDelta).toBeLessThanOrEqual(1)
  expect(probe.fragmentTopSpread).toBeLessThanOrEqual(1)
  expect(probe.fragmentHeightSpread).toBeLessThanOrEqual(1)
  expect(probe.lineHeight).toBeLessThanOrEqual(360)
  expect(probe.selectionHeight).toBeLessThanOrEqual(360)
})

test('Gate 3 demo keeps soft wrapped line-end clicks on the trailing boundary', async ({ page }) => {
  await page.goto('/test-fixture.html')
  await waitForGate3AlphaReady(page)

  const clickPlan = await page.evaluate(() => {
    const demo = window.__jwordTestFixture

    if (demo === undefined) {
      throw new Error('缺少 Gate 3 demo 行尾点击测试钩子')
    }

    demo.editor.createDocument({
      text: '第一段：保持分页 canvas 路线，但把交互样例收敛到小文档，避免大夹具的阿德 selection 热路径拖慢体验。继续补充一些文本来稳定触发软换行。'
    })

    const layout = demo.editor.getLayout()
    const pageBox = layout.pages[0]
    const firstLine = pageBox?.lines[0]
    const secondLine = pageBox?.lines[1]
    const lastFragment = firstLine?.fragments.at(-1)
    const wrapper = document.querySelector<HTMLElement>('[data-jword-page="0"]')

    if (
      pageBox === undefined
      || firstLine === undefined
      || secondLine === undefined
      || lastFragment === undefined
      || wrapper === null
    ) {
      throw new Error('缺少 Gate 3 demo 行尾点击所需的页面、行或 DOM')
    }

    const wrapperRect = wrapper.getBoundingClientRect()
    const scaleX = wrapperRect.width / pageBox.width
    const scaleY = wrapperRect.height / pageBox.height

    return {
      clientX: wrapperRect.left + ((lastFragment.x - pageBox.x + lastFragment.width + 1) * scaleX),
      clientY: wrapperRect.top + ((firstLine.y - pageBox.y + (firstLine.height / 2)) * scaleY),
      expected: {
        ...lastFragment.end,
        assoc: -1
      },
      secondLineStart: secondLine.fragments[0]?.start ?? null
    }
  })

  await page.mouse.click(clickPlan.clientX, clickPlan.clientY)

  const focus = await page.evaluate(() => {
    const demo = window.__jwordTestFixture
    const selection = demo?.editor.getSelection()

    if (demo === undefined || selection === undefined || selection === null) {
      throw new Error('行尾点击后缺少选区')
    }

    return demo.editor.resolveTextPosition(selection.focus)
  })

  expect(focus).toEqual(clickPlan.expected)
  expect(focus).not.toEqual(clickPlan.secondLineStart)
})

test('Gate 3 runtime double click expands Chinese selection by the real hit bias on the real canvas', async ({ page }) => {
  await page.goto('/test-fixture.html')
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
