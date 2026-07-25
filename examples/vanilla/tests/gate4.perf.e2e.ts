/**
 * @fileoverview 职责: 为 Gate 4 Beta 前半段提供 Chromium 浏览器侧性能护栏和可复查 JSON 指标。
 * 边界: 只记录当前 demo 可执行的图片、表格、批注、修订、目录、滚动和查找规模指标。
 * 协作: vanilla demo 测试钩子、真实 toolbar DOM、@4xian/jword-core Editor facade 和 Playwright perf-chromium 项目。
 * 约束: 指标必须来自浏览器 performance、requestAnimationFrame 和真实 DOM，不使用 Node-only benchmark 代替交互路径。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

interface Gate4PerfMetrics {
  readonly initialPageCount: number
  readonly imageInsertMs: number
  readonly tableInsertEditMs: number
  readonly commentCreateMs: number
  readonly revisionCreateMs: number
  readonly findScaleCollectMs: number
  readonly findScaleMatchCount: number
  readonly findUiInteractionMs: number
  readonly overlayScrollMs: number
  readonly overlayCompositeScrollRawP95Ms: number
  readonly overlayCompositeFrameBaselineP95Ms: number
  readonly overlayCompositeScrollIncrementalP95Ms: number
  readonly mountedCanvasCount: number
}

const OVERLAY_COMPOSITE_SAMPLE_COUNT = 30

const GATE4_PERF_THRESHOLDS = {
  imageInsertMs: 2200,
  tableInsertEditMs: 1600,
  commentCreateMs: 1200,
  revisionCreateMs: 800,
  findScaleCollectMs: 600,
  findUiInteractionMs: 1200,
  overlayScrollMs: 700,
  overlayCompositeScrollIncrementalP95Ms: 700,
  mountedCanvasCount: 5
} as const

test.setTimeout(120000)

test('Gate 4 perf guard records image table find and overlay interaction metrics', async ({ page, browserName }, testInfo) => {
  test.skip(browserName !== 'chromium', '当前 Gate 4 perf 护栏只固定 Chromium。')

  await page.goto('/test-fixture.html?fixture=gate2')
  await waitForGate4PerfReady(page)

  const metrics = await readGate4PerfMetrics(page)

  console.log(`GATE4_PERF ${JSON.stringify(metrics)}`)
  await testInfo.attach('gate4-browser-perf', {
    body: JSON.stringify({
      sampling: {
        overlayCompositeSampleCount: OVERLAY_COMPOSITE_SAMPLE_COUNT,
        overlayCompositeMetric: 'paired-frame-baseline-p95'
      },
      thresholds: GATE4_PERF_THRESHOLDS,
      metrics
    }, null, 2),
    contentType: 'application/json'
  })

  expect(metrics.initialPageCount).toBeGreaterThanOrEqual(1)
  expect(metrics.imageInsertMs).toBeLessThanOrEqual(GATE4_PERF_THRESHOLDS.imageInsertMs)
  expect(metrics.tableInsertEditMs).toBeLessThanOrEqual(GATE4_PERF_THRESHOLDS.tableInsertEditMs)
  expect(metrics.commentCreateMs).toBeLessThanOrEqual(GATE4_PERF_THRESHOLDS.commentCreateMs)
  expect(metrics.revisionCreateMs).toBeLessThanOrEqual(GATE4_PERF_THRESHOLDS.revisionCreateMs)
  expect(metrics.findScaleCollectMs).toBeLessThanOrEqual(GATE4_PERF_THRESHOLDS.findScaleCollectMs)
  expect(metrics.findScaleMatchCount).toBeGreaterThan(10)
  expect(metrics.findUiInteractionMs).toBeLessThanOrEqual(GATE4_PERF_THRESHOLDS.findUiInteractionMs)
  expect(metrics.overlayScrollMs).toBeLessThanOrEqual(GATE4_PERF_THRESHOLDS.overlayScrollMs)
  expect(metrics.overlayCompositeScrollIncrementalP95Ms)
    .toBeLessThanOrEqual(GATE4_PERF_THRESHOLDS.overlayCompositeScrollIncrementalP95Ms)
  expect(metrics.mountedCanvasCount).toBeLessThanOrEqual(GATE4_PERF_THRESHOLDS.mountedCanvasCount)
})

/** 等待 Gate 4 perf 所需的 demo 和 canvas 完成挂载。 */
async function waitForGate4PerfReady(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__jwordTestFixture !== undefined)
  await expect(page.locator('[data-jword-canvas-container]')).toBeVisible()
  await expect.poll(() => page.evaluate(() => document.querySelectorAll('.jw-editor__page-canvas').length)).toBeGreaterThan(0)
}

/** 在真实浏览器内执行并记录 Gate 4 关键交互指标。 */
async function readGate4PerfMetrics(page: Page): Promise<Gate4PerfMetrics> {
  return page.evaluate(async ({ overlayCompositeSampleCount }) => {
    const demo = window.__jwordTestFixture
    const container = document.querySelector<HTMLElement>('[data-jword-canvas-container]')
    const mediaTrigger = document.querySelector<HTMLButtonElement>('[data-jword-media-trigger="true"]')
    const mediaUrlAction = document.querySelector<HTMLButtonElement>('[data-jword-media-action-url="true"]')
    const mediaUrlInput = document.querySelector<HTMLInputElement>('[data-jword-media-url-dialog-input="true"]')
    const mediaUrlConfirm = document.querySelector<HTMLButtonElement>('[data-jword-media-url-dialog-confirm="true"]')
    const tableTrigger = document.querySelector<HTMLButtonElement>('[data-jword-table-insert-trigger="true"]')
    const tableCell2x2 = document.querySelector<HTMLButtonElement>('[data-jword-table-preview-cell="true"][data-jword-rows="2"][data-jword-columns="2"]')
    const commentButton = document.querySelector<HTMLButtonElement>('[data-jword-insert-comment]')
    const findInput = document.querySelector<HTMLInputElement>('[data-jword-find-query-input]')
    const findButton = document.querySelector<HTMLButtonElement>('[data-jword-find-button]')
    const findStatus = document.querySelector<HTMLOutputElement>('[data-jword-find-status]')

    if (
      demo === undefined
      || container === null
      || mediaTrigger === null
      || mediaUrlAction === null
      || mediaUrlInput === null
      || mediaUrlConfirm === null
      || tableTrigger === null
      || tableCell2x2 === null
      || commentButton === null
      || findInput === null
      || findButton === null
      || findStatus === null
    ) {
      throw new Error('缺少 Gate 4 perf 所需 DOM 或 demo hook。')
    }

    const nextFrame = async (): Promise<void> =>
      new Promise((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            resolve()
          })
        })
      })

    /** 读取当前配对采样的 p95 耗时。 */
    const readP95 = (samples: readonly number[]): number => {
      const sorted = [...samples].sort((left, right) => left - right)
      const rank = Math.max(0, Math.ceil(sorted.length * 0.95) - 1)

      return Number(sorted[rank]?.toFixed(2) ?? 0)
    }

    /** 测量与两次真实滚动相同的四帧调度基线。 */
    const measureCompositeFrameBaseline = async (): Promise<number> => {
      const start = performance.now()

      await nextFrame()
      await nextFrame()

      return performance.now() - start
    }

    const waitForCondition = async (label: string, predicate: () => boolean, timeoutMs = 4000): Promise<number> => {
      const start = performance.now()

      while (!predicate()) {
        await nextFrame()

        if (performance.now() - start > timeoutMs) {
          throw new Error(`等待 ${label} 超时。`)
        }
      }

      return performance.now() - start
    }

    const selectFirstRunRange = (anchorIndex: number, focusIndex: number): void => {
      const selectionTarget = readTextSelectionTarget(Math.max(anchorIndex, focusIndex))

      if (selectionTarget === null) {
        throw new Error('缺少 Gate 4 perf 选区目标。')
      }

      demo.selectTextRange({
        sectionId: selectionTarget.sectionId,
        blockId: selectionTarget.blockId,
        runId: selectionTarget.runId,
        anchorGraphemeIndex: anchorIndex,
        focusGraphemeIndex: focusIndex
      })
    }

    const readTextSelectionTarget = (requiredLength: number): {
      readonly sectionId: string
      readonly blockId: string
      readonly runId: string
    } | null => {
      for (const section of demo.editor.getProjection().document.sections) {
        for (const block of section.blocks) {
          if (block.kind !== 'paragraph') {
            continue
          }

          for (const run of block.runs) {
            const textLength = run.inlines.reduce((length, inline) => {
              return inline.kind === 'text' ? length + Array.from(inline.text).length : length
            }, 0)

            if (textLength >= requiredLength) {
              return {
                sectionId: section.id,
                blockId: block.id,
                runId: run.id
              }
            }
          }
        }
      }

      return null
    }

    const readImageCount = (): number => demo.editor.getProjection().document.sections
      .flatMap((section) => section.blocks)
      .filter((block) => block.kind === 'paragraph')
      .flatMap((block) => block.runs)
      .flatMap((run) => run.inlines)
      .filter((inline) => inline.kind === 'image').length

    const readTableCount = (): number => demo.editor.getProjection().document.sections
      .flatMap((section) => section.blocks)
      .filter((block) => block.kind === 'table').length

    const countMatchesInProjection = (query: string): number => {
      const text = demo.editor.getProjection().document.sections.flatMap((section) => section.blocks).flatMap((block) => {
        if (block.kind === 'paragraph') {
          return block.runs.flatMap((run) => run.inlines.flatMap((inline) => inline.kind === 'text' ? [inline.text] : []))
        }

        return block.rows.flatMap((row) => row.cells.flatMap((cell) => cell.blocks.flatMap((cellBlock) => {
          return cellBlock.kind === 'paragraph'
            ? cellBlock.runs.flatMap((run) => run.inlines.flatMap((inline) => inline.kind === 'text' ? [inline.text] : []))
            : []
        })))
      }).join('\n')
      let count = 0
      let index = text.indexOf(query)

      while (index >= 0) {
        count += 1
        index = text.indexOf(query, index + query.length)
      }

      return count
    }

    const initialPageCount = demo.editor.getLayout().pages.length

    selectFirstRunRange(0, 0)
    mediaTrigger.click()
    mediaUrlAction.click()
    await nextFrame()
    mediaUrlInput.value = demo.media.getFixtureUrl()
    mediaUrlInput.dispatchEvent(new Event('input', { bubbles: true }))
    const imageStart = performance.now()
    mediaUrlConfirm.click()
    const imageInsertMs = await waitForCondition('图片插入落地', () => readImageCount() === 1)

    selectFirstRunRange(0, 0)
    demo.editor.setParagraphStyle('Heading1')
    await waitForCondition('目录项刷新', () => document.querySelectorAll('[data-jword-heading-outline-item]').length > 0)

    tableTrigger.click()
    await nextFrame()
    const tableStart = performance.now()
    tableCell2x2.click()
    await waitForCondition('表格插入落地', () => readTableCount() === 1)
    demo.table.setCellText(0, 0, 'perf-table')
    const tableInsertEditMs = performance.now() - tableStart

    selectFirstRunRange(1, 4)
    const commentStart = performance.now()
    commentButton.click()
    await waitForCondition('批注草稿打开', () => document.querySelector('[data-jword-comment-input="draft"]') !== null)
    const commentInput = document.querySelector<HTMLTextAreaElement>('[data-jword-comment-input="draft"]')
    const commentConfirm = document.querySelector<HTMLButtonElement>('[data-jword-comment-action="confirm-draft"]')

    if (commentInput === null || commentConfirm === null) {
      throw new Error('缺少批注草稿输入框。')
    }

    commentInput.value = 'perf-comment'
    commentInput.dispatchEvent(new Event('input', { bubbles: true }))
    commentConfirm.click()
    await waitForCondition('批注 projection 落地', () => demo.comments.readThreadCount() === 1)
    const commentCreateMs = performance.now() - commentStart

    selectFirstRunRange(2, 5)
    const revisionStart = performance.now()
    const revisionCreated = demo.revisions.addRevision({
      authorId: 'demo-user',
      createdAt: '2026-05-24T08:30:00.000Z',
      type: 'format',
      summary: 'perf revision'
    })

    if (!revisionCreated) {
      throw new Error('修订 metadata 创建失败。')
    }

    await waitForCondition('修订 projection 落地', () => demo.revisions.readRevisionCount() === 1)
    const revisionCreateMs = performance.now() - revisionStart

    const findStart = performance.now()
    const findScaleMatchCount = countMatchesInProjection('paragraph')
    const findScaleCollectMs = performance.now() - findStart

    findInput.value = 'paragraph'
    findInput.dispatchEvent(new Event('input', { bubbles: true }))
    const findUiStart = performance.now()
    findButton.click()
    await waitForCondition('官方查找 UI 结果刷新', () => /^\d+ \/ \d+$/.test(findStatus.textContent ?? ''))
    const findUiInteractionMs = performance.now() - findUiStart

    const scrollStart = performance.now()
    container.scrollTop = Math.max(0, container.scrollHeight - container.clientHeight) / 2
    container.dispatchEvent(new Event('scroll'))
    await nextFrame()
    const overlayScrollMs = performance.now() - scrollStart

    await waitForCondition('目录批注修订同屏可见', () => {
      return document.querySelectorAll('[data-jword-heading-outline-item]').length > 0
        && document.querySelectorAll('[data-jword-comment-thread-id]').length > 0
        && document.querySelectorAll('[data-jword-revision-item]').length > 0
    })
    const overlayCompositeScrollRawSamples: number[] = []
    const overlayCompositeFrameBaselineSamples: number[] = []
    const overlayCompositeScrollIncrementalSamples: number[] = []

    for (let index = 0; index < overlayCompositeSampleCount; index += 1) {
      const frameBaselineDuration = await measureCompositeFrameBaseline()
      const overlayCompositeScrollStart = performance.now()

      container.scrollTop = 0
      container.dispatchEvent(new Event('scroll'))
      await nextFrame()
      container.scrollTop = Math.max(0, container.scrollHeight - container.clientHeight)
      container.dispatchEvent(new Event('scroll'))
      await nextFrame()

      const duration = performance.now() - overlayCompositeScrollStart
      overlayCompositeScrollRawSamples.push(duration)
      overlayCompositeFrameBaselineSamples.push(frameBaselineDuration)
      overlayCompositeScrollIncrementalSamples.push(Math.max(0, duration - frameBaselineDuration))
    }

    return {
      initialPageCount,
      imageInsertMs: Number(imageInsertMs.toFixed(2)),
      tableInsertEditMs: Number(tableInsertEditMs.toFixed(2)),
      commentCreateMs: Number(commentCreateMs.toFixed(2)),
      revisionCreateMs: Number(revisionCreateMs.toFixed(2)),
      findScaleCollectMs: Number(findScaleCollectMs.toFixed(2)),
      findScaleMatchCount,
      findUiInteractionMs: Number(findUiInteractionMs.toFixed(2)),
      overlayScrollMs: Number(overlayScrollMs.toFixed(2)),
      overlayCompositeScrollRawP95Ms: readP95(overlayCompositeScrollRawSamples),
      overlayCompositeFrameBaselineP95Ms: readP95(overlayCompositeFrameBaselineSamples),
      overlayCompositeScrollIncrementalP95Ms: readP95(overlayCompositeScrollIncrementalSamples),
      mountedCanvasCount: document.querySelectorAll('.jw-editor__page-canvas').length
    }
  }, {
    overlayCompositeSampleCount: OVERLAY_COMPOSITE_SAMPLE_COUNT
  })
}
