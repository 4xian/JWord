/**
 * @fileoverview 职责: 覆盖 Gate 3 大文档样例下指针双击与长拖响应回归。
 * 边界: 只固定当前浏览器项目的大夹具指针响应路径，不覆盖普通样例的基础选区能力。
 * 协作: 输入辅助模块、大文档样例、画布命中测试与浏览器鼠标事件。
 * 约束: 长拖和双击断言必须通过真实浏览器鼠标事件、选区快照和画布像素探针完成。
 * Specs: docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md Gate 3 Step 3.12。
 */
import { expect, test } from '@playwright/test'
import {
  readClientPointForGrapheme,
  readLargeFixtureDoubleClickPlan,
  readLargeFixtureLongDragPlan,
  readResolvedSelectionSnapshot,
  readSelectionSummary,
  readSelectionVisualProbe,
  runPromiseWithTimeout,
  waitForGate3LargeFixtureReady
} from './gate3-input-helpers'

test('Gate 3 large-fixture pointer double click keeps responding after a collapsed canvas selection', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', '当前大夹具双击回归只固定 Chromium。')

  await page.goto('/?fixture=gate2')
  await waitForGate3LargeFixtureReady(page)

  const doubleClickPlan = await readLargeFixtureDoubleClickPlan(page)
  const wordPoint = await readClientPointForGrapheme(
    page,
    doubleClickPlan.targetGraphemeIndex,
    doubleClickPlan.pageIndex
  )

  await runPromiseWithTimeout({
    label: '单击大夹具命中点建立折叠选区',
    promise: page.mouse.click(wordPoint.clientX, wordPoint.clientY),
    timeoutMs: 700
  })

  const collapsedSnapshot = await readResolvedSelectionSnapshot(page)

  if (collapsedSnapshot.range === null) {
    throw new Error(`大夹具单击后没有折叠选区。摘要=${collapsedSnapshot.summary}`)
  }

  expect(collapsedSnapshot.range.startGraphemeIndex).toBe(doubleClickPlan.targetGraphemeIndex)
  expect(collapsedSnapshot.range.endGraphemeIndex).toBe(doubleClickPlan.targetGraphemeIndex)

  await runPromiseWithTimeout({
    label: '在已有折叠选区后双击大夹具命中点',
    promise: page.mouse.dblclick(wordPoint.clientX, wordPoint.clientY),
    timeoutMs: 700,
    diagnostics: `单击后选区摘要=${collapsedSnapshot.summary}`,
    onTimeout: () => page.close()
  })

  const expandedSnapshot = await runPromiseWithTimeout({
    label: '读取大夹具双击后的选区快照',
    promise: readResolvedSelectionSnapshot(page),
    timeoutMs: 700
  })

  if (expandedSnapshot.range === null) {
    throw new Error(`大夹具双击后没有选区。摘要=${expandedSnapshot.summary}`)
  }

  expect(expandedSnapshot.range.startGraphemeIndex).toBeLessThanOrEqual(doubleClickPlan.targetGraphemeIndex)
  expect(expandedSnapshot.range.endGraphemeIndex).toBeGreaterThan(doubleClickPlan.targetGraphemeIndex)
})

test('Gate 3 large-fixture pointer drag keeps responding while mouse is held and paints the final selection', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', '当前长拖拽回归只固定 Chromium。')

  await page.goto('/?fixture=gate2')
  await waitForGate3LargeFixtureReady(page)

  const dragPlan = await readLargeFixtureLongDragPlan(page)
  const dragStart = await readClientPointForGrapheme(page, dragPlan.startGraphemeIndex, dragPlan.pageIndex)
  const dragEnd = await readClientPointForGrapheme(page, dragPlan.endGraphemeIndex, dragPlan.pageIndex)

  await runPromiseWithTimeout({
    label: '定位到大夹具长拖起点',
    promise: page.mouse.move(dragStart.clientX, dragStart.clientY),
    timeoutMs: 700
  })
  await runPromiseWithTimeout({
    label: '按下鼠标左键开始大夹具长拖',
    promise: page.mouse.down(),
    timeoutMs: 700
  })

  let lastSummary = await readSelectionSummary(page)
  let maxResolvedEnd = dragPlan.startGraphemeIndex
  let progressStepCount = 0

  for (let step = 1; step <= dragPlan.stepCount; step += 1) {
    const nextClientX = dragStart.clientX + ((dragEnd.clientX - dragStart.clientX) * step) / dragPlan.stepCount
    const nextClientY = dragStart.clientY + ((dragEnd.clientY - dragStart.clientY) * step) / dragPlan.stepCount

    await runPromiseWithTimeout({
      label: `大夹具长拖第 ${step}/${dragPlan.stepCount} 步的 pointer move`,
      promise: page.mouse.move(nextClientX, nextClientY),
      timeoutMs: 700,
      diagnostics: `上一步选区摘要=${lastSummary}`
    })

    const snapshot = await runPromiseWithTimeout({
      label: `大夹具长拖第 ${step}/${dragPlan.stepCount} 步后的选区快照`,
      promise: readResolvedSelectionSnapshot(page),
      timeoutMs: 700,
      diagnostics: `目标终点 grapheme=${dragPlan.endGraphemeIndex}`
    })

    lastSummary = snapshot.summary

    if (snapshot.range === null) {
      throw new Error(`大夹具长拖第 ${step}/${dragPlan.stepCount} 步后仍然没有选区。摘要=${snapshot.summary}`)
    }

    if (snapshot.range.startGraphemeIndex !== dragPlan.startGraphemeIndex) {
      throw new Error(
        `大夹具长拖第 ${step}/${dragPlan.stepCount} 步后选区起点漂移到了 ${snapshot.range.startGraphemeIndex}。摘要=${snapshot.summary}`
      )
    }

    if (snapshot.range.endGraphemeIndex < maxResolvedEnd) {
      throw new Error(
        `大夹具长拖第 ${step}/${dragPlan.stepCount} 步后选区终点回退到了 ${snapshot.range.endGraphemeIndex}。摘要=${snapshot.summary}`
      )
    }

    if (snapshot.range.endGraphemeIndex > maxResolvedEnd) {
      maxResolvedEnd = snapshot.range.endGraphemeIndex
      progressStepCount += 1
    }
  }

  await runPromiseWithTimeout({
    label: '释放大夹具长拖的鼠标左键',
    promise: page.mouse.up(),
    timeoutMs: 700,
    diagnostics: `释放前选区摘要=${lastSummary}`
  })

  const finalSnapshot = await readResolvedSelectionSnapshot(page)

  if (finalSnapshot.range === null) {
    throw new Error(`大夹具长拖释放鼠标后没有最终选区。摘要=${finalSnapshot.summary}`)
  }

  expect(finalSnapshot.range.startGraphemeIndex).toBe(dragPlan.startGraphemeIndex)
  expect(finalSnapshot.range.endGraphemeIndex).toBeGreaterThanOrEqual(dragPlan.endGraphemeIndex - 2)
  expect(progressStepCount).toBeGreaterThanOrEqual(4)

  const visualProbe = await readSelectionVisualProbe(page, dragPlan.pageIndex)
  expect(visualProbe.selectionPixels).toBeGreaterThan(20)
})
