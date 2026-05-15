/**
 * @fileoverview 职责: 为 Gate 3 Alpha toolbar 提供可执行的浏览器侧性能验收入口，并输出当前阈值与实测指标。
 * 边界: 只测 examples/vanilla 真实接通的 UI/facade 闭环，不覆盖 core benchmark、IME、剪贴板或跨浏览器性能基线。
 * 协作: examples/vanilla/src/main.ts 的 demo 测试钩子、真实 toolbar DOM、@4xian/jword-core Editor facade 和 Playwright Chromium。
 * 约束: 当前门槛只固定 Chromium；若超阈值必须直接失败，避免把性能回归藏进文档说明。
 * Specs: docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md Gate 3 Step 3.13。
 */
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

interface Gate3PerfMetrics {
  readonly gate2ScrollMs: number
  readonly largeDocumentInsertP95Ms: number
  readonly alphaLoadMs: number
  readonly selectionSummarySyncMs: number
  readonly toggleBoldP95Ms: number
  readonly undoP95Ms: number
  readonly redoP95Ms: number
}

const GATE3_ALPHA_THRESHOLDS: Gate3PerfMetrics = {
  gate2ScrollMs: 120,
  largeDocumentInsertP95Ms: 140,
  alphaLoadMs: 80,
  selectionSummarySyncMs: 140,
  toggleBoldP95Ms: 140,
  undoP95Ms: 140,
  redoP95Ms: 140
}

test('Gate 3 Alpha perf stays within the current Chromium thresholds', async ({ page, browserName }, testInfo) => {
  test.skip(browserName !== 'chromium', '当前 Gate 3 Alpha perf 门槛只固定 Chromium。')

  await page.goto('/')
  await waitForDemoReady(page)

  const metrics = await readGate3PerfMetrics(page)

  console.log(`GATE3_PERF ${JSON.stringify(metrics)}`)
  await testInfo.attach('gate3-alpha-perf', {
    body: JSON.stringify(
      {
        thresholds: GATE3_ALPHA_THRESHOLDS,
        metrics
      },
      null,
      2
    ),
    contentType: 'application/json'
  })

  expect(metrics.gate2ScrollMs).toBeLessThanOrEqual(GATE3_ALPHA_THRESHOLDS.gate2ScrollMs)
  expect(metrics.largeDocumentInsertP95Ms).toBeLessThanOrEqual(GATE3_ALPHA_THRESHOLDS.largeDocumentInsertP95Ms)
  expect(metrics.alphaLoadMs).toBeLessThanOrEqual(GATE3_ALPHA_THRESHOLDS.alphaLoadMs)
  expect(metrics.selectionSummarySyncMs).toBeLessThanOrEqual(GATE3_ALPHA_THRESHOLDS.selectionSummarySyncMs)
  expect(metrics.toggleBoldP95Ms).toBeLessThanOrEqual(GATE3_ALPHA_THRESHOLDS.toggleBoldP95Ms)
  expect(metrics.undoP95Ms).toBeLessThanOrEqual(GATE3_ALPHA_THRESHOLDS.undoP95Ms)
  expect(metrics.redoP95Ms).toBeLessThanOrEqual(GATE3_ALPHA_THRESHOLDS.redoP95Ms)
})

async function readGate3PerfMetrics(page: Page): Promise<Gate3PerfMetrics> {
  return page.evaluate(async () => {
    const demo = window.__jwordDemo
    const container = document.querySelector<HTMLElement>('[data-jword-canvas-container]')
    const selectionSummaryNode = document.querySelector<HTMLElement>('[data-jword-selection-summary]')
    const loadAlphaButton = document.querySelector<HTMLButtonElement>('[data-jword-load-alpha]')
    const clearSelectionButton = document.querySelector<HTMLButtonElement>('[data-jword-clear-selection]')
    const selectSampleButton = document.querySelector<HTMLButtonElement>('[data-jword-select-sample]')
    const boldButton = document.querySelector<HTMLButtonElement>('[data-jword-format-bold]')
    const undoButton = document.querySelector<HTMLButtonElement>('[data-jword-history-undo]')
    const redoButton = document.querySelector<HTMLButtonElement>('[data-jword-history-redo]')

    if (
      demo === undefined
      || container === null
      || selectionSummaryNode === null
      || loadAlphaButton === null
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

    const readFirstParagraphText = (): string => {
      const firstBlock = demo.editor.getProjection().document.sections[0]?.blocks[0]

      if (firstBlock === undefined || firstBlock.kind !== 'paragraph') {
        throw new Error('缺少 Gate 3 perf 首段文本')
      }

      return firstBlock.runs
        .flatMap((run) => run.inlines.flatMap((inline) => inline.kind === 'text' ? [inline.text] : []))
        .join('')
    }

    const collapseLargeFixtureSelectionAtStart = (): void => {
      const firstPage = demo.editor.getLayout().pages[0]
      const firstLine = firstPage?.lines.find((line) => line.fragments.length > 0)
      const firstFragment = firstLine?.fragments[0]

      if (firstFragment === undefined) {
        throw new Error('缺少 Gate 3 perf 大文档首个文本片段')
      }

      demo.selectTextRange({
        sectionId: firstFragment.sectionId,
        blockId: firstFragment.blockId,
        runId: firstFragment.runId,
        anchorGraphemeIndex: firstFragment.start.graphemeIndex,
        focusGraphemeIndex: firstFragment.start.graphemeIndex
      })
    }

    const measureGate2Scroll = async (): Promise<number> => {
      const lastPageIndex = demo.editor.getLayout().pages.length - 1
      const readLastPageMounted = (): boolean => document.querySelector(`[data-jword-page="${lastPageIndex}"] canvas`) !== null

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
    const largeDocumentInsertSamples: number[] = []
    const originalFirstParagraphText = readFirstParagraphText()
    const input = document.querySelector<HTMLTextAreaElement>('[data-jword-hidden-textarea]')

    if (input === null) {
      throw new Error('缺少 Gate 3 perf hidden textarea')
    }

    for (let index = 0; index < 8; index += 1) {
      collapseLargeFixtureSelectionAtStart()

      const duration = await runAndMeasure(
        `大文档输入-${index + 1}`,
        () => {
          input.focus()
          input.value = '热'
          input.dispatchEvent(new Event('input', {
            bubbles: true,
            cancelable: true
          }))
        },
        () => readFirstParagraphText() === `热${originalFirstParagraphText}`
      )

      largeDocumentInsertSamples.push(duration)

      await runAndMeasure(
        `大文档撤销-${index + 1}`,
        () => {
          demo.editor.undo()
        },
        () => readFirstParagraphText() === originalFirstParagraphText
      )
    }

    const alphaLoadMs = await runAndMeasure('加载 Alpha 样例', () => loadAlphaButton.click(), () => selectSampleButton.disabled === false)

    if (clearSelectionButton.disabled === false) {
      await runAndMeasure(
        '清空选区',
        () => clearSelectionButton.click(),
        () => selectionSummaryNode.textContent?.includes('无选区') === true
      )
    }

    const selectionSummarySyncMs = await runAndMeasure(
      '同步首页片段选区',
      () => selectSampleButton.click(),
      () => selectionSummaryNode.textContent?.includes('选区：') === true
    )

    if (boldButton.getAttribute('aria-pressed') === 'true') {
      await runAndMeasure('重置加粗状态', () => boldButton.click(), () => boldButton.getAttribute('aria-pressed') === 'false')
    }

    const toggleBoldSamples: number[] = []
    for (let index = 0; index < 8; index += 1) {
      const nextPressed = boldButton.getAttribute('aria-pressed') !== 'true'
      const duration = await runAndMeasure(
        `切换加粗-${index + 1}`,
        () => boldButton.click(),
        () => boldButton.getAttribute('aria-pressed') === String(nextPressed)
      )

      toggleBoldSamples.push(duration)
    }

    const undoSamples: number[] = []
    for (let index = 0; index < 4; index += 1) {
      const nextPressed = boldButton.getAttribute('aria-pressed') !== 'true'
      const duration = await runAndMeasure(
        `撤销-${index + 1}`,
        () => undoButton.click(),
        () => boldButton.getAttribute('aria-pressed') === String(nextPressed)
      )

      undoSamples.push(duration)
    }

    const redoSamples: number[] = []
    for (let index = 0; index < 4; index += 1) {
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
      largeDocumentInsertP95Ms: readP95(largeDocumentInsertSamples),
      alphaLoadMs: Number(alphaLoadMs.toFixed(2)),
      selectionSummarySyncMs: Number(selectionSummarySyncMs.toFixed(2)),
      toggleBoldP95Ms: readP95(toggleBoldSamples),
      undoP95Ms: readP95(undoSamples),
      redoP95Ms: readP95(redoSamples)
    }
  })
}

async function waitForDemoReady(page: Page): Promise<void> {
  await expect(page.locator('[data-jword-canvas-container]')).toHaveAttribute('data-jword-page-count', '50')
  await page.waitForFunction(() => window.__jwordDemo !== undefined)
}
