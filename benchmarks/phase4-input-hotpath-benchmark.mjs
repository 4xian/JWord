/**
 * 职责：输出 Phase 4 输入热路径在 10 万字 / 200 页 fixture 上的分段 benchmark 指标。
 * 边界：只测 core 公开 Editor facade、layout 和 canvas 渲染 helper，不访问浏览器 DOM，不声明最终 P95 达标。
 * 协作模块：fixtures/plain-text/gate2-large-fixture.mjs、packages/core 和 tools/bench/run-bench.mjs。
 * 约束：输出必须是可机器读取 JSON；本脚本先固化基线，P95 < 50ms 门禁在专项优化达标后再写入 perf e2e。
 * Specs：docs/superpowers/reports/2026-07-03-remediation-execution-supplement.md#39-phase-4-性能专项输入热路径-p95--50ms。
 */
import { performance } from 'node:perf_hooks'

import {
  GATE2_LARGE_EXPECTED_PAGE_COUNT,
  GATE2_LARGE_MIN_CHARACTER_COUNT,
  createGate2LargeFixtureParagraphs
} from '../fixtures/plain-text/gate2-large-fixture.mjs'
import {
  computeViewportPages,
  createCanvasPool,
  createEditor,
  createTextInserter,
  syncPageCanvases
} from '../packages/core/dist/index.js'

const P95_SAMPLE_COUNT = 20
const WARMUP_SAMPLE_COUNT = 2
const fixturePath = 'fixtures/plain-text/gate2-large-fixture.mjs'
const paragraphs = createGate2LargeFixtureParagraphs()
const characterCount = paragraphs.join('\n').length
const documentModelMeasure = measureTask('phase4:createDocumentModel', () => createBenchmarkDocument(paragraphs))
const editor = createEditor()
const modelLoadMeasure = measureTask('phase4:modelLoad', () => {
  editor.loadDocumentModel({
    document: documentModelMeasure.result
  })
})
const initialLayoutMeasure = measureTask('phase4:initialLayout', () => editor.getLayout())
const visibleRenderMeasure = measureTask('phase4:visibleRender', () => renderVisiblePages(initialLayoutMeasure.result))
const inputWarmups = []
const inputSamples = []

try {
  validateLargeFixture(initialLayoutMeasure.result.pages.length)

  for (let index = 0; index < WARMUP_SAMPLE_COUNT; index += 1) {
    inputWarmups.push(runInputSample(editor, index, 'warmup'))
  }

  for (let index = 0; index < P95_SAMPLE_COUNT; index += 1) {
    inputSamples.push(runInputSample(editor, index, 'sample'))
  }

  const inputHotPathSamples = inputSamples.map((sample) => sample.inputHotPathMs)
  const transactionSamples = inputSamples.map((sample) => sample.transactionDurationMs)
  const layoutSamples = inputSamples.map((sample) => sample.layoutAfterInputDurationMs)

  validateBenchmarkMetrics({
    inputHotPathSamples,
    transactionSamples,
    layoutSamples,
    visibleRenderDrawCalls: visibleRenderMeasure.result.drawCalls
  })

  console.log(
    JSON.stringify(
      {
        status: 'ok',
        benchmark: 'phase4-input-hotpath',
        fixture: fixturePath,
        paragraphCount: paragraphs.length,
        characterCount,
        pageCount: initialLayoutMeasure.result.pages.length,
        sampling: {
          warmupSampleCount: WARMUP_SAMPLE_COUNT,
          p95SampleCount: P95_SAMPLE_COUNT
        },
        inputHotPathP50Ms: readPercentile(inputHotPathSamples, 0.5),
        inputHotPathP95Ms: readPercentile(inputHotPathSamples, 0.95),
        inputTransactionP50Ms: readPercentile(transactionSamples, 0.5),
        inputTransactionP95Ms: readPercentile(transactionSamples, 0.95),
        inputLayoutP50Ms: readPercentile(layoutSamples, 0.5),
        inputLayoutP95Ms: readPercentile(layoutSamples, 0.95),
        segments: {
          documentModelCreateDurationMs: documentModelMeasure.durationMs,
          modelLoadDurationMs: modelLoadMeasure.durationMs,
          initialLayoutDurationMs: initialLayoutMeasure.durationMs,
          visibleRenderDurationMs: visibleRenderMeasure.durationMs,
          visibleRenderDrawCalls: visibleRenderMeasure.result.drawCalls,
          visibleRenderFrames: visibleRenderMeasure.result.frames
        },
        sampleSummary: summarizeInputSamples(inputSamples),
        performanceMarks: performance
          .getEntriesByType('measure')
          .map((entry) => ({
            name: entry.name,
            durationMs: roundMetric(entry.duration)
          })),
        note: 'Phase 4 基线 benchmark：先定位 projection/layout/render/input 分段耗时，不在本脚本强制 P95 < 50ms。'
      },
      null,
      2
    )
  )
} finally {
  editor.destroy()
}

/**
 * 用 performance mark 包裹一个同步任务并返回耗时。
 */
function measureTask(label, task) {
  const startMark = `${label}:start`
  const endMark = `${label}:end`
  const fallbackStart = performance.now()

  performance.mark(startMark)
  const result = task()
  performance.mark(endMark)
  performance.measure(label, startMark, endMark)

  const measure = performance.getEntriesByName(label, 'measure').at(-1)

  return {
    result,
    durationMs: roundMetric(measure?.duration ?? performance.now() - fallbackStart)
  }
}

/**
 * 运行一次单字符输入样本并拆分事务与布局耗时。
 */
function runInputSample(editorRuntime, index, phase) {
  const sampleLabel = `phase4:input:${phase}:${index + 1}`
  const transactionMeasure = measureTask(`${sampleLabel}:transaction`, () => {
    const position = readFirstRunPosition(editorRuntime)
    const inserter = createTextInserter(editorRuntime, {
      requestId: `${phase}-${index + 1}`,
      anchor: editorRuntime.createTextAnchor({
        ...position,
        graphemeIndex: 0
      }),
      undoScope: 'user'
    })

    return inserter.write('热')
  })
  const layoutMeasure = measureTask(`${sampleLabel}:layout`, () => editorRuntime.getLayout())

  if (transactionMeasure.result === null) {
    throw new Error(`Phase 4 input benchmark ${phase}-${index + 1} did not commit.`)
  }

  return {
    phase,
    index: index + 1,
    inputHotPathMs: roundMetric(transactionMeasure.durationMs + layoutMeasure.durationMs),
    transactionDurationMs: transactionMeasure.durationMs,
    layoutAfterInputDurationMs: layoutMeasure.durationMs,
    updateByteLength: transactionMeasure.result.diagnostic.updateByteLength,
    pageCount: layoutMeasure.result.pages.length
  }
}

/**
 * 读取当前文档首个 run 的稳定位置字段。
 */
function readFirstRunPosition(editorRuntime) {
  const firstSection = editorRuntime.getProjection().document.sections[0]
  const firstBlock = firstSection?.blocks[0]

  if (firstSection === undefined || firstBlock?.kind !== 'paragraph') {
    throw new Error('Phase 4 input benchmark fixture missing first paragraph.')
  }

  const firstRun = firstBlock.runs[0]

  if (firstRun === undefined) {
    throw new Error('Phase 4 input benchmark fixture missing first run.')
  }

  return {
    sectionId: firstSection.id,
    blockId: firstBlock.id,
    runId: firstRun.id
  }
}

/**
 * 创建 benchmark 使用的 canonical 文档模型。
 */
function createBenchmarkDocument(lines) {
  return {
    kind: 'document',
    id: 'phase4-input-hotpath-document',
    sections: [
      {
        kind: 'section',
        id: 'phase4-input-hotpath-section',
        blocks: lines.map((line, index) => ({
          kind: 'paragraph',
          id: `phase4-input-hotpath-paragraph-${index + 1}`,
          runs: [
            {
              kind: 'run',
              id: `phase4-input-hotpath-run-${index + 1}`,
              properties: {
                fontSizePx: 16
              },
              inlines: [
                {
                  kind: 'text',
                  text: line
                }
              ]
            }
          ]
        }))
      }
    ]
  }
}

/**
 * 渲染首、中、尾三个视口，建立 render 分段基线。
 */
function renderVisiblePages(layout) {
  const viewportPages = layout.pages.map((page) => ({
    pageIndex: page.pageIndex,
    top: page.y,
    height: page.height
  }))
  const targetPageIndexes = [
    0,
    Math.floor(layout.pages.length / 2),
    layout.pages.length - 1
  ]
  const allCanvases = []
  let canvases = new Map()
  let drawCalls = 0
  const pool = createCanvasPool({
    createCanvas: () => {
      const canvas = createMockCanvas(() => {
        drawCalls += 1
      })

      allCanvases.push(canvas)

      return canvas
    }
  })

  for (const pageIndex of targetPageIndexes) {
    const page = layout.pages[pageIndex]

    if (page === undefined) {
      continue
    }

    const viewport = computeViewportPages({
      pages: viewportPages,
      scrollTop: page.y,
      viewportHeight: page.height,
      bufferPages: 1
    })

    canvases = syncPageCanvases({
      pages: layout.pages,
      retainedPageIndexes: viewport.retainedPageIndexes,
      canvases,
      pool
    })
  }

  return {
    frames: targetPageIndexes.length,
    createdCanvasCount: allCanvases.length,
    retainedCanvasCount: canvases.size,
    drawCalls
  }
}

/**
 * 创建记录绘制调用次数的最小 canvas。
 */
function createMockCanvas(recordCall) {
  const context = {
    set fillStyle(_value) {
      recordCall()
    },
    set font(_value) {
      recordCall()
    },
    set textBaseline(_value) {
      recordCall()
    },
    clearRect() {
      recordCall()
    },
    fillRect() {
      recordCall()
    },
    fillText() {
      recordCall()
    }
  }

  return {
    width: 1,
    height: 1,
    getContext: () => context
  }
}

/**
 * 校验大文档 fixture 的关键规模。
 */
function validateLargeFixture(pageCount) {
  if (characterCount < GATE2_LARGE_MIN_CHARACTER_COUNT) {
    throw new Error(`Phase 4 fixture expected at least ${GATE2_LARGE_MIN_CHARACTER_COUNT} characters, got ${characterCount}.`)
  }

  if (pageCount !== GATE2_LARGE_EXPECTED_PAGE_COUNT) {
    throw new Error(`Phase 4 fixture expected ${GATE2_LARGE_EXPECTED_PAGE_COUNT} pages, got ${pageCount}.`)
  }
}

/**
 * 校验 benchmark 指标完整性。
 */
function validateBenchmarkMetrics(metrics) {
  const allSamples = [
    ...metrics.inputHotPathSamples,
    ...metrics.transactionSamples,
    ...metrics.layoutSamples
  ]

  if (allSamples.length !== P95_SAMPLE_COUNT * 3 || allSamples.some((sample) => !Number.isFinite(sample) || sample <= 0)) {
    throw new Error('Phase 4 input benchmark produced invalid timing samples.')
  }

  if (metrics.visibleRenderDrawCalls <= 0) {
    throw new Error('Phase 4 input benchmark did not render visible pages.')
  }
}

/**
 * 读取百分位指标。
 */
function readPercentile(samples, percentile) {
  const sorted = [...samples].sort((left, right) => left - right)
  const rank = Math.max(0, Math.ceil(sorted.length * percentile) - 1)

  return roundMetric(sorted[rank] ?? 0)
}

/**
 * 汇总输入样本，保留 delta 分析需要的首尾和 update 字节。
 */
function summarizeInputSamples(samples) {
  return {
    first: samples[0],
    last: samples.at(-1),
    maxUpdateByteLength: Math.max(...samples.map((sample) => sample.updateByteLength))
  }
}

/**
 * 保留两位小数，避免 benchmark 输出随小数尾数抖动。
 */
function roundMetric(value) {
  return Math.round(value * 100) / 100
}
