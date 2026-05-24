import { readFileSync } from 'node:fs'
import { posix } from 'node:path'
import { performance } from 'node:perf_hooks'

import { splitGate2FixtureParagraphs } from '../fixtures/plain-text/gate2-fixture.mjs'
import {
  computeViewportPages,
  createCanvasPool,
  createFontManager,
  createPageConfig,
  layoutDocument,
  syncPageCanvases
} from '../packages/core/dist/index.js'

const fixturePath = posix.join('fixtures', 'plain-text', 'gate2-50-pages.txt')
const fixtureText = readFileSync(fixturePath, 'utf8')
const fixtureLines = splitGate2FixtureParagraphs(fixtureText)
const expectedPageCount = 53
const pageConfig = createPageConfig()
const fontManager = createFontManager({
  fallbackFontFamily: 'Arial',
  availableFontFamilies: ['Arial']
})

const layoutStart = performance.now()
const layout = layoutDocument({
  projection: createProjection(fixtureLines),
  pageConfig,
  fontManager
})
const layoutDurationMs = roundMetric(performance.now() - layoutStart)

if (layout.pages.length !== expectedPageCount) {
  throw new Error(`Gate 2 benchmark expected exactly ${expectedPageCount} pages, got ${layout.pages.length}.`)
}

const renderStart = performance.now()
const renderMetrics = renderScrollSequence(layout.pages)
const renderDurationMs = roundMetric(performance.now() - renderStart)
const scrollFps = renderDurationMs === 0
  ? 0
  : roundMetric(renderMetrics.frames / (renderDurationMs / 1000))
const retainedCanvasLimit = 5

validateBenchmarkMetrics({
  pageCount: layout.pages.length,
  layoutDurationMs,
  renderDurationMs,
  scrollFps,
  retainedCanvasLimit,
  ...renderMetrics
})

console.log(
  JSON.stringify(
    {
      status: 'ok',
      benchmark: 'gate2-render',
      fixture: fixturePath,
      pageCount: layout.pages.length,
      layoutDurationMs,
      renderDurationMs,
      scrollFps,
      frames: renderMetrics.frames,
      maxCanvasCount: renderMetrics.maxCanvasCount,
      retainedCanvasLimit,
      canvasBytesPeak: renderMetrics.canvasBytesPeak,
      offscreenCanvasSize: renderMetrics.offscreenCanvasSize,
      drawCalls: renderMetrics.drawCalls,
      browserEvidence: {
        perfTest: 'examples/vanilla/tests/gate2.perf.e2e.ts',
        visualTest: 'examples/vanilla/tests/gate2.visual.ts'
      },
      note: '确定性 core layout/render benchmark；真实浏览器滚动/虚拟化指标与 canvas 绘制由 Playwright Gate 2 perf/visual 用例覆盖。'
    },
    null,
    2
  )
)

function createProjection(lines) {
  return {
    document: {
      kind: 'document',
      id: 'gate2-benchmark-document',
      sections: [
        {
          kind: 'section',
          id: 'gate2-benchmark-section',
          blocks: lines.map((line, index) => ({
            kind: 'paragraph',
            id: `gate2-benchmark-paragraph-${index + 1}`,
            runs: [
              {
                kind: 'run',
                id: `gate2-benchmark-run-${index + 1}`,
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
}

function validateBenchmarkMetrics(metrics) {
  const finiteMetrics = [
    metrics.layoutDurationMs,
    metrics.renderDurationMs,
    metrics.scrollFps
  ]

  if (finiteMetrics.some((metric) => !Number.isFinite(metric))) {
    throw new Error('Gate 2 benchmark produced a non-finite metric.')
  }

  if (metrics.maxCanvasCount > metrics.retainedCanvasLimit) {
    throw new Error(`Gate 2 benchmark retained ${metrics.maxCanvasCount} canvases, limit ${metrics.retainedCanvasLimit}.`)
  }

  if (metrics.offscreenCanvasSize !== '1x1') {
    throw new Error(`Gate 2 benchmark did not release offscreen canvases, got ${metrics.offscreenCanvasSize}.`)
  }

  if (metrics.canvasBytesPeak <= 0 || metrics.drawCalls <= 0 || metrics.frames !== metrics.pageCount) {
    throw new Error('Gate 2 benchmark render metrics are incomplete.')
  }
}

function renderScrollSequence(pages) {
  const allCanvases = []
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
  let canvases = new Map()
  let maxCanvasCount = 0
  let canvasBytesPeak = 0

  for (const page of pages) {
    const viewport = computeViewportPages({
      pages: pages.map((candidate) => ({
        pageIndex: candidate.pageIndex,
        top: candidate.y,
        height: candidate.height
      })),
      scrollTop: page.y,
      viewportHeight: page.height,
      bufferPages: 2
    })

    canvases = syncPageCanvases({
      pages,
      retainedPageIndexes: viewport.retainedPageIndexes,
      canvases,
      pool
    })
    maxCanvasCount = Math.max(maxCanvasCount, canvases.size)
    canvasBytesPeak = Math.max(canvasBytesPeak, estimateCanvasBytes(canvases))
  }

  const activeCanvases = new Set(canvases.values())
  const offscreenCanvases = allCanvases.filter((canvas) => !activeCanvases.has(canvas))
  const offscreenCanvasSize = offscreenCanvases.every((canvas) => canvas.width === 1 && canvas.height === 1)
    ? '1x1'
    : 'not-released'

  return {
    frames: pages.length,
    maxCanvasCount,
    canvasBytesPeak,
    offscreenCanvasSize,
    drawCalls
  }
}

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

function estimateCanvasBytes(canvases) {
  return [...canvases.values()].reduce(
    (total, canvas) => total + canvas.width * canvas.height * 4,
    0
  )
}

function roundMetric(value) {
  return Math.round(value * 100) / 100
}
