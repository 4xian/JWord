import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'

import {
  computeViewportPages,
  createCanvasPool,
  createFontManager,
  createPageConfig,
  cssPxToTwips,
  layoutDocument,
  syncPageCanvases
} from '../packages/core/dist/index.js'

const fixturePath = join('fixtures', 'plain-text', 'gate2-50-pages.txt')
const fixtureText = readFileSync(fixturePath, 'utf8')
const fixtureLines = fixtureText.trim().split('\n').filter((line) => line.length > 0)
const pageConfig = createPageConfig({
  orientation: 'landscape',
  widthTwips: cssPxToTwips(1800),
  heightTwips: 400,
  marginTwips: {
    top: 40,
    right: cssPxToTwips(72),
    bottom: 40,
    left: cssPxToTwips(72)
  }
})
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

if (layout.pages.length !== 50) {
  throw new Error(`Gate 2 benchmark expected 50 pages, got ${layout.pages.length}.`)
}

const renderStart = performance.now()
const renderMetrics = renderScrollSequence(layout.pages)
const renderDurationMs = roundMetric(performance.now() - renderStart)
const scrollFps = renderDurationMs === 0
  ? 0
  : roundMetric(renderMetrics.frames / (renderDurationMs / 1000))

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
      retainedCanvasLimit: 5,
      canvasBytesPeak: renderMetrics.canvasBytesPeak,
      offscreenCanvasSize: renderMetrics.offscreenCanvasSize,
      drawCalls: renderMetrics.drawCalls,
      note: '真实 core layout/render benchmark，记录滚动 FPS、layout 耗时、render 耗时、canvas 数量和显存估算。'
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
