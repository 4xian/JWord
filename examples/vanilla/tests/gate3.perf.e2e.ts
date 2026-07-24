/**
 * @fileoverview 职责: 为 Gate 3 Alpha toolbar 提供可执行的浏览器侧性能验收入口，并输出当前阈值与实测指标。
 * 边界: 只测 examples/vanilla 真实接通的 UI/facade 闭环，不覆盖 core benchmark、IME、剪贴板或跨浏览器性能基线。
 * 协作: examples/vanilla/src/main.ts 的 demo 测试钩子、真实 toolbar DOM、@4xian/jword-core Editor facade 和 Playwright Chromium。
 * 约束: 当前门槛只固定 Chromium；若超阈值必须直接失败，避免把性能回归藏进文档说明。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { expectedGate2PageCount } from './gate2-test-contract'

interface Gate3PerfMetrics {
  readonly gate2ScrollMs: number
  readonly largeDocumentInsertRawP95Ms: number
  readonly largeDocumentFrameBaselineP95Ms: number
  readonly largeDocumentInsertIncrementalP95Ms: number
  readonly alphaLoadRawP95Ms: number
  readonly alphaLoadFrameBaselineP95Ms: number
  readonly alphaLoadIncrementalP95Ms: number
  readonly selectionSyncMs: number
  readonly toggleBoldP95Ms: number
  readonly undoP95Ms: number
  readonly redoP95Ms: number
}

interface Gate3PerfThresholds {
  readonly gate2ScrollMs: number
  readonly largeDocumentInsertIncrementalP95Ms: number
  readonly alphaLoadIncrementalP95Ms: number
  readonly selectionSyncMs: number
  readonly toggleBoldP95Ms: number
  readonly undoP95Ms: number
  readonly redoP95Ms: number
}

const P95_SAMPLE_COUNT = 30
const LARGE_DOCUMENT_INSERT_WARMUP_COUNT = 2

const GATE3_ALPHA_THRESHOLDS: Gate3PerfThresholds = {
  gate2ScrollMs: 120,
  largeDocumentInsertIncrementalP95Ms: 50,
  alphaLoadIncrementalP95Ms: 80,
  selectionSyncMs: 140,
  toggleBoldP95Ms: 140,
  undoP95Ms: 140,
  redoP95Ms: 140
}

test('Gate 3 Alpha perf stays within the current Chromium thresholds', async ({ page, browserName }, testInfo) => {
  test.setTimeout(180000)
  test.skip(browserName !== 'chromium', '当前 Gate 3 Alpha perf 门槛只固定 Chromium。')

  await page.goto('/test-fixture.html?fixture=gate2')
  await waitForDemoReady(page)

  const metrics = await readGate3PerfMetrics(page)

  console.log(`GATE3_PERF ${JSON.stringify(metrics)}`)
  await testInfo.attach('gate3-alpha-perf', {
    body: JSON.stringify(
      {
        sampling: {
          p95SampleCount: P95_SAMPLE_COUNT,
          largeDocumentInsertWarmupCount: LARGE_DOCUMENT_INSERT_WARMUP_COUNT,
          largeDocumentInsertMetric: 'paired-frame-baseline-p95',
          alphaLoadSampleCount: P95_SAMPLE_COUNT,
          alphaLoadMetric: 'paired-frame-baseline-p95'
        },
        thresholds: GATE3_ALPHA_THRESHOLDS,
        metrics
      },
      null,
      2
    ),
    contentType: 'application/json'
  })

  expect(metrics.gate2ScrollMs).toBeLessThanOrEqual(GATE3_ALPHA_THRESHOLDS.gate2ScrollMs)
  expect(metrics.largeDocumentInsertIncrementalP95Ms)
    .toBeLessThanOrEqual(GATE3_ALPHA_THRESHOLDS.largeDocumentInsertIncrementalP95Ms)
  expect(metrics.alphaLoadIncrementalP95Ms)
    .toBeLessThanOrEqual(GATE3_ALPHA_THRESHOLDS.alphaLoadIncrementalP95Ms)
  expect(metrics.selectionSyncMs).toBeLessThanOrEqual(GATE3_ALPHA_THRESHOLDS.selectionSyncMs)
  expect(metrics.toggleBoldP95Ms).toBeLessThanOrEqual(GATE3_ALPHA_THRESHOLDS.toggleBoldP95Ms)
  expect(metrics.undoP95Ms).toBeLessThanOrEqual(GATE3_ALPHA_THRESHOLDS.undoP95Ms)
  expect(metrics.redoP95Ms).toBeLessThanOrEqual(GATE3_ALPHA_THRESHOLDS.redoP95Ms)
})

async function readGate3PerfMetrics(page: Page): Promise<Gate3PerfMetrics> {
  return page.evaluate(async ({ p95SampleCount, largeDocumentInsertWarmupCount }) => {
    const demo = window.__jwordTestFixture
    const container = document.querySelector<HTMLElement>('[data-jword-canvas-container]')
    const loadAlphaButton = document.querySelector<HTMLButtonElement>('[data-jword-load-alpha]')
    const restoreGate2FixtureButton = document.querySelector<HTMLButtonElement>('[data-jword-restore-gate2]')
    const clearSelectionButton = document.querySelector<HTMLButtonElement>('[data-jword-clear-selection]')
    const selectSampleButton = document.querySelector<HTMLButtonElement>('[data-jword-select-sample]')
    const boldButton = document.querySelector<HTMLButtonElement>('[data-jword-format-bold]')
    const undoButton = document.querySelector<HTMLButtonElement>('[data-jword-history-undo]')
    const redoButton = document.querySelector<HTMLButtonElement>('[data-jword-history-redo]')

    if (
      demo === undefined
      || container === null
      || loadAlphaButton === null
      || restoreGate2FixtureButton === null
      || clearSelectionButton === null
      || selectSampleButton === null
      || boldButton === null
      || undoButton === null
      || redoButton === null
    ) {
      throw new Error('缺少 Gate 3 perf 所需的 demo 测试钩子或 toolbar DOM')
    }

    const nextFrame = async (): Promise<void> =>
      new Promise((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            resolve()
          })
        })
      })

    const waitForCondition = async (
      label: string,
      predicate: () => boolean,
      timeoutMs = 2400
    ): Promise<number> =>
      new Promise((resolve, reject) => {
        const start = performance.now()

        const tick = (): void => {
          if (predicate()) {
            resolve(performance.now() - start)
            return
          }

          if (performance.now() - start > timeoutMs) {
            reject(new Error(`等待 ${label} 超时`))
            return
          }

          requestAnimationFrame(tick)
        }

        tick()
      })

    const waitForSettledFrames = async (frameCount = 2): Promise<void> => {
      for (let index = 0; index < frameCount; index += 1) {
        await nextFrame()
      }
    }

    const runAndMeasure = async (
      label: string,
      action: () => void,
      predicate: () => boolean,
      timeoutMs = 2400
    ): Promise<number> => {
      const start = performance.now()

      action()
      await nextFrame()

      if (predicate()) {
        return performance.now() - start
      }

      await waitForCondition(label, predicate, timeoutMs)

      return performance.now() - start
    }

    const readP95 = (samples: readonly number[]): number => {
      const sorted = [...samples].sort((left, right) => left - right)
      const rank = Math.max(0, Math.ceil(sorted.length * 0.95) - 1)

      return Number(sorted[rank]?.toFixed(2) ?? 0)
    }

    /** 测量与真实输入相同的双帧调度基线。 */
    const measureFrameBaseline = async (): Promise<number> => {
      const start = performance.now()

      await nextFrame()

      return performance.now() - start
    }

    const readSelectionPositions = (): Readonly<{
      anchorSectionId: string
      anchorBlockId: string
      anchorRunId: string
      anchorGraphemeIndex: number
      focusSectionId: string
      focusBlockId: string
      focusRunId: string
      focusGraphemeIndex: number
    }> | null => {
      const selection = demo.editor.getSelection()
      const anchor = selection === null ? undefined : demo.editor.resolveTextPosition(selection.anchor)
      const focus = selection === null ? undefined : demo.editor.resolveTextPosition(selection.focus)

      if (anchor === undefined || focus === undefined) {
        return null
      }

      return {
        anchorSectionId: anchor.sectionId,
        anchorBlockId: anchor.blockId,
        anchorRunId: anchor.runId,
        anchorGraphemeIndex: anchor.graphemeIndex,
        focusSectionId: focus.sectionId,
        focusBlockId: focus.blockId,
        focusRunId: focus.runId,
        focusGraphemeIndex: focus.graphemeIndex
      }
    }

    const hasActiveTextSelection = (): boolean => {
      const positions = readSelectionPositions()

      return positions !== null && (
        positions.anchorSectionId !== positions.focusSectionId
        || positions.anchorBlockId !== positions.focusBlockId
        || positions.anchorRunId !== positions.focusRunId
        || positions.anchorGraphemeIndex !== positions.focusGraphemeIndex
      )
    }

    const readFirstParagraphText = (): string => {
      const firstBlock = demo.editor.getProjection().document.sections[0]?.blocks[0]

      if (firstBlock === undefined || firstBlock.kind !== 'paragraph') {
        throw new Error('缺少 Gate 3 perf 首段文本')
      }

      return firstBlock.runs
        .flatMap((run) => run.inlines.flatMap((inline) => inline.kind === 'text' ? [inline.text] : []))
        .join('')
    }

    const readLargeFixtureSelectionStart = (): Readonly<{
      sectionId: string
      blockId: string
      runId: string
      graphemeIndex: number
    }> => {
      const firstPage = demo.editor.getLayout().pages[0]
      const firstLine = firstPage?.lines.find((line) => line.fragments.length > 0)
      const firstFragment = firstLine?.fragments[0]

      if (firstFragment === undefined) {
        throw new Error('缺少 Gate 3 perf 大文档首个文本片段')
      }

      return {
        sectionId: firstFragment.sectionId,
        blockId: firstFragment.blockId,
        runId: firstFragment.runId,
        graphemeIndex: firstFragment.start.graphemeIndex
      }
    }

    const largeFixtureSelectionStart = readLargeFixtureSelectionStart()

    const collapseLargeFixtureSelectionAtStart = (): void => {
      demo.selectTextRange({
        sectionId: largeFixtureSelectionStart.sectionId,
        blockId: largeFixtureSelectionStart.blockId,
        runId: largeFixtureSelectionStart.runId,
        anchorGraphemeIndex: largeFixtureSelectionStart.graphemeIndex,
        focusGraphemeIndex: largeFixtureSelectionStart.graphemeIndex
      })
    }

    const readLargeFixtureSelectionReady = (): boolean => {
      const positions = readSelectionPositions()

      return positions !== null
        && positions.anchorSectionId === largeFixtureSelectionStart.sectionId
        && positions.anchorBlockId === largeFixtureSelectionStart.blockId
        && positions.anchorRunId === largeFixtureSelectionStart.runId
        && positions.anchorGraphemeIndex === largeFixtureSelectionStart.graphemeIndex
        && positions.focusSectionId === largeFixtureSelectionStart.sectionId
        && positions.focusBlockId === largeFixtureSelectionStart.blockId
        && positions.focusRunId === largeFixtureSelectionStart.runId
        && positions.focusGraphemeIndex === largeFixtureSelectionStart.graphemeIndex
    }

    const measureGate2Scroll = async (): Promise<number> => {
      const lastPageIndex = demo.editor.getLayout().pages.length - 1
      const readLastPageMounted = (): boolean => document.querySelector(`[data-jword-page="${lastPageIndex}"] canvas`) !== null

      demo.editor.setSelection(null)
      await waitForSettledFrames()
      container.scrollTop = 0
      container.dispatchEvent(new Event('scroll'))
      await nextFrame()
      await waitForCondition(
        'Gate 2 顶部卸载最后一页 canvas',
        () => readLastPageMounted() === false,
        3200
      )

      const start = performance.now()

      container.scrollTop = container.scrollHeight - container.clientHeight
      container.dispatchEvent(new Event('scroll'))
      await nextFrame()

      if (readLastPageMounted() === false) {
        await waitForCondition('Gate 2 底部挂载最后一页 canvas', readLastPageMounted, 3200)
      }

      return performance.now() - start
    }

    const gate2ScrollMs = await measureGate2Scroll()
    const largeDocumentInsertRawSamples: number[] = []
    const largeDocumentFrameBaselineSamples: number[] = []
    const largeDocumentInsertIncrementalSamples: number[] = []
    const originalFirstParagraphText = readFirstParagraphText()
    const originalBlockCount = demo.editor.getProjection().document.sections[0]?.blocks.length ?? 0
    const input = document.querySelector<HTMLTextAreaElement>('[data-jword-hidden-textarea]')

    if (input === null) {
      throw new Error('缺少 Gate 3 perf hidden textarea')
    }

    const prepareLargeDocumentInsertState = async (): Promise<void> => {
      collapseLargeFixtureSelectionAtStart()
      input.value = ''

      if (document.activeElement !== input) {
        input.focus()
      }

      await waitForCondition(
        '大文档输入起点归一化',
        () => {
          return readFirstParagraphText() === originalFirstParagraphText
            && readLargeFixtureSelectionReady()
            && document.activeElement === input
        }
      )
      await waitForSettledFrames()
    }

    for (let index = 0; index < largeDocumentInsertWarmupCount; index += 1) {
      await prepareLargeDocumentInsertState()
      await runAndMeasure(
        `大文档输入预热-${index + 1}`,
        () => {
          input.value = '热'
          input.dispatchEvent(new Event('input', {
            bubbles: true,
            cancelable: true
          }))
        },
        () => readFirstParagraphText() === `热${originalFirstParagraphText}`
      )
      await runAndMeasure(
        `大文档撤销预热-${index + 1}`,
        () => {
          demo.editor.undo()
        },
        () => readFirstParagraphText() === originalFirstParagraphText
      )
      await waitForSettledFrames()
    }

    for (let index = 0; index < p95SampleCount; index += 1) {
      await prepareLargeDocumentInsertState()
      const frameBaselineDuration = await measureFrameBaseline()

      const duration = await runAndMeasure(
        `大文档输入-${index + 1}`,
        () => {
          input.value = '热'
          input.dispatchEvent(new Event('input', {
            bubbles: true,
            cancelable: true
          }))
        },
        () => readFirstParagraphText() === `热${originalFirstParagraphText}`
      )

      largeDocumentInsertRawSamples.push(duration)
      largeDocumentFrameBaselineSamples.push(frameBaselineDuration)
      largeDocumentInsertIncrementalSamples.push(Math.max(0, duration - frameBaselineDuration))

      await runAndMeasure(
        `大文档撤销-${index + 1}`,
        () => {
          demo.editor.undo()
        },
        () => readFirstParagraphText() === originalFirstParagraphText
      )
      await waitForSettledFrames()
    }

    const alphaLoadRawSamples: number[] = []
    const alphaLoadFrameBaselineSamples: number[] = []
    const alphaLoadIncrementalSamples: number[] = []

    for (let index = 0; index < p95SampleCount; index += 1) {
      const frameBaselineDuration = await measureFrameBaseline()
      const duration = await runAndMeasure(
        `加载 Alpha 样例-${index + 1}`,
        () => loadAlphaButton.click(),
        () => container.getAttribute('data-jword-page-count') === '1' && selectSampleButton.disabled === false
      )

      alphaLoadRawSamples.push(duration)
      alphaLoadFrameBaselineSamples.push(frameBaselineDuration)
      alphaLoadIncrementalSamples.push(Math.max(0, duration - frameBaselineDuration))

      if (index === p95SampleCount - 1) {
        continue
      }

      await runAndMeasure(
        `恢复 Gate 2 夹具-${index + 1}`,
        () => restoreGate2FixtureButton.click(),
        () => readFirstParagraphText() === originalFirstParagraphText
          && demo.editor.getProjection().document.sections[0]?.blocks.length === originalBlockCount
      )
      await waitForSettledFrames()
    }

    if (clearSelectionButton.disabled === false) {
      await runAndMeasure(
        '清空选区',
        () => clearSelectionButton.click(),
        () => demo.editor.getSelection() === null
      )
    }

    const selectionSyncMs = await runAndMeasure(
      '同步首页片段选区',
      () => selectSampleButton.click(),
      () => hasActiveTextSelection()
    )

    if (boldButton.getAttribute('aria-pressed') === 'true') {
      await runAndMeasure('重置加粗状态', () => boldButton.click(), () => boldButton.getAttribute('aria-pressed') === 'false')
    }

    await waitForSettledFrames()

    const toggleBoldSamples: number[] = []
    for (let index = 0; index < p95SampleCount; index += 1) {
      const nextPressed = boldButton.getAttribute('aria-pressed') !== 'true'
      const duration = await runAndMeasure(
        `切换加粗-${index + 1}`,
        () => boldButton.click(),
        () => boldButton.getAttribute('aria-pressed') === String(nextPressed)
      )

      toggleBoldSamples.push(duration)
    }

    const undoSamples: number[] = []
    for (let index = 0; index < p95SampleCount; index += 1) {
      const nextPressed = boldButton.getAttribute('aria-pressed') !== 'true'
      const duration = await runAndMeasure(
        `撤销-${index + 1}`,
        () => undoButton.click(),
        () => boldButton.getAttribute('aria-pressed') === String(nextPressed)
      )

      undoSamples.push(duration)
    }

    const redoSamples: number[] = []
    for (let index = 0; index < p95SampleCount; index += 1) {
      const nextPressed = boldButton.getAttribute('aria-pressed') !== 'true'
      const duration = await runAndMeasure(
        `重做-${index + 1}`,
        () => redoButton.click(),
        () => boldButton.getAttribute('aria-pressed') === String(nextPressed)
      )

      redoSamples.push(duration)
    }

    return {
      gate2ScrollMs: Number(gate2ScrollMs.toFixed(2)),
      largeDocumentInsertRawP95Ms: readP95(largeDocumentInsertRawSamples),
      largeDocumentFrameBaselineP95Ms: readP95(largeDocumentFrameBaselineSamples),
      largeDocumentInsertIncrementalP95Ms: readP95(largeDocumentInsertIncrementalSamples),
      alphaLoadRawP95Ms: readP95(alphaLoadRawSamples),
      alphaLoadFrameBaselineP95Ms: readP95(alphaLoadFrameBaselineSamples),
      alphaLoadIncrementalP95Ms: readP95(alphaLoadIncrementalSamples),
      selectionSyncMs: Number(selectionSyncMs.toFixed(2)),
      toggleBoldP95Ms: readP95(toggleBoldSamples),
      undoP95Ms: readP95(undoSamples),
      redoP95Ms: readP95(redoSamples)
    }
  }, {
    p95SampleCount: P95_SAMPLE_COUNT,
    largeDocumentInsertWarmupCount: LARGE_DOCUMENT_INSERT_WARMUP_COUNT
  })
}

async function waitForDemoReady(page: Page): Promise<void> {
  await expect(page.locator('[data-jword-canvas-container]')).toHaveAttribute('data-jword-page-count', String(expectedGate2PageCount))
  await page.waitForFunction(() => window.__jwordTestFixture !== undefined)
  await expect(page.locator('[data-jword-hidden-textarea]')).toHaveCount(1)
  await expect.poll(async () => {
    return page.evaluate(() => document.querySelectorAll('.jw-editor__page-canvas').length)
  }).toBeGreaterThan(0)
}
