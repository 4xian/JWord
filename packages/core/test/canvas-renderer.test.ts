/**
 * @vitest-environment node
 *
 * 职责：验证 Gate 2 画布渲染器 每页独立绘制，并遵守背景、选区、文本、光标的视觉层级。
 * 边界：只覆盖只读 布局盒到画布 指令的转换，不覆盖布局生成、命中测试和矩形映射 或真实浏览器画布。
 * 协作模块：渲染器消费布局盒，结合 视口虚拟器和画布池 管理每页 canvas。
 * 性能/安全约束：测试使用确定性 mock canvas，不访问 DOM，不创建真实图形资源，不使用单长 canvas。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/03-architecture.md#35-分页-canvas-渲染。
 */

import { describe, expect, it } from 'vitest'

import { createCanvasPool } from '../src/canvas-pool'
import { renderPageCanvas, syncPageCanvases } from '../src/canvas-renderer'
import { cssPxToTwips } from '../src/page-config'
import type { CanvasLike, CanvasRenderingContextLike } from '../src/canvas-pool'
import type { LayoutBox } from '../src/layout'

describe('renderPageCanvas', () => {
  it('按 page background、selection、text、caret 顺序绘制单页 canvas', () => {
    const canvas = createMockCanvas()
    const page = createPageLayout(0, '你好 JWord') satisfies LayoutBox

    renderPageCanvas({
      canvas,
      page,
      selectionRects: [
        {
          pageIndex: 0,
          x: cssPxToTwips(72),
          y: cssPxToTwips(96),
          width: cssPxToTwips(48),
          height: cssPxToTwips(18)
        }
      ],
      caretRect: {
        pageIndex: 0,
        x: cssPxToTwips(130),
        y: cssPxToTwips(96),
        width: cssPxToTwips(2),
        height: cssPxToTwips(18)
      }
    })

    expect(canvas.calls).toEqual([
      'clearRect:0,0,600,800',
      'fillStyle:#ffffff',
      'fillRect:0,0,600,800',
      'fillStyle:#cfe3ff',
      'fillRect:72,96,48,18',
      'fillStyle:#111827',
      'font:16px sans-serif',
      'textBaseline:alphabetic',
      'fillText:你好 JWord,72,110',
      'fillStyle:#111827',
      'fillRect:130,96,2,18'
    ])
  })

  it('只绘制属于当前页的 selection 和 caret', () => {
    const canvas = createMockCanvas()
    const page = createPageLayout(1, '第二页') satisfies LayoutBox

    renderPageCanvas({
      canvas,
      page,
      selectionRects: [
        {
          pageIndex: 0,
          x: cssPxToTwips(72),
          y: cssPxToTwips(96),
          width: cssPxToTwips(48),
          height: cssPxToTwips(18)
        }
      ],
      caretRect: {
        pageIndex: 0,
        x: cssPxToTwips(130),
        y: cssPxToTwips(96),
        width: cssPxToTwips(2),
        height: cssPxToTwips(18)
      }
    })

    expect(canvas.calls).not.toContain('fillRect:72,96,48,18')
    expect(canvas.calls).not.toContain('fillRect:130,96,2,18')
    expect(canvas.calls).toContain('fillText:第二页,72,110')
  })

  it('限制异常大页面的 canvas 尺寸，避免保留超大画布', () => {
    const canvas = createMockCanvas()
    const basePage = createPageLayout(0, '大页面')
    const page = {
      ...basePage,
      width: cssPxToTwips(12000),
      height: cssPxToTwips(12000)
    } satisfies LayoutBox

    renderPageCanvas({
      canvas,
      page,
      scale: 2
    })

    expect(canvas.width).toBeLessThanOrEqual(4096)
    expect(canvas.height).toBeLessThanOrEqual(4096)
  })
})

describe('syncPageCanvases', () => {
  it('为保留页持有独立 canvas，并回收离屏页到 画布池', () => {
    const pool = createCanvasPool({
      createCanvas: () => createMockCanvas()
    })
    const pages = [
      createPageLayout(0, '第一页') satisfies LayoutBox,
      createPageLayout(1, '第二页') satisfies LayoutBox,
      createPageLayout(2, '第三页') satisfies LayoutBox
    ]

    const first = syncPageCanvases({
      pages,
      retainedPageIndexes: [0, 1],
      canvases: new Map(),
      pool
    })
    const pageZeroCanvas = first.get(0)
    const pageOneCanvas = first.get(1)

    expect(pageZeroCanvas).toBeDefined()
    expect(pageOneCanvas).toBeDefined()
    expect(pageZeroCanvas).not.toBe(pageOneCanvas)
    expect(pageZeroCanvas?.width).toBe(600)
    expect(pageOneCanvas?.width).toBe(600)

    const second = syncPageCanvases({
      pages,
      retainedPageIndexes: [1],
      canvases: first,
      pool
    })

    expect(pageZeroCanvas?.width).toBe(1)
    expect(pageZeroCanvas?.height).toBe(1)
    expect(second.has(0)).toBe(false)
    expect(second.get(1)).toBe(pageOneCanvas)

    const third = syncPageCanvases({
      pages,
      retainedPageIndexes: [1, 2],
      canvases: second,
      pool
    })

    expect(third.get(1)).toBe(pageOneCanvas)
    expect(third.get(2)).toBe(pageZeroCanvas)
  })
})

interface MockCanvas extends CanvasLike {
  readonly calls: string[]
}

function createMockCanvas(): MockCanvas {
  const calls: string[] = []
  const context: CanvasRenderingContextLike = {
    set fillStyle(value: string) {
      calls.push(`fillStyle:${value}`)
    },
    set font(value: string) {
      calls.push(`font:${value}`)
    },
    set textBaseline(value: CanvasTextBaseline) {
      calls.push(`textBaseline:${value}`)
    },
    clearRect: (x, y, width, height) => {
      calls.push(`clearRect:${x},${y},${width},${height}`)
    },
    fillRect: (x, y, width, height) => {
      calls.push(`fillRect:${x},${y},${width},${height}`)
    },
    fillText: (text, x, y) => {
      calls.push(`fillText:${text},${x},${y}`)
    }
  }

  return {
    width: 0,
    height: 0,
    calls,
    getContext: () => context
  }
}

function createPageLayout(pageIndex: number, text: string): LayoutBox {
  const pageTop = cssPxToTwips(pageIndex * 820)
  const lineTop = pageTop + cssPxToTwips(96)
  const lineBaseline = pageTop + cssPxToTwips(110)

  return {
    kind: 'page',
    pageIndex,
    x: 0,
    y: pageTop,
    width: cssPxToTwips(600),
    height: cssPxToTwips(800),
    lines: [
      {
        kind: 'line',
        pageIndex,
        sectionId: 'section-render',
        paragraphId: 'paragraph-render',
        x: cssPxToTwips(72),
        y: lineTop,
        width: cssPxToTwips(456),
        height: cssPxToTwips(20),
        baseline: lineBaseline,
        inlines: [],
        fragments: [
          {
            kind: 'textFragment',
            pageIndex,
            sectionId: 'section-render',
            blockId: 'paragraph-render',
            runId: 'run-render',
            text,
            x: cssPxToTwips(72),
            y: lineTop,
            width: cssPxToTwips(120),
            height: cssPxToTwips(18),
            baseline: lineBaseline,
            style: {
              color: '#111827',
              fontSizePx: 16
            },
            start: {
              sectionId: 'section-render',
              blockId: 'paragraph-render',
              runId: 'run-render',
              graphemeIndex: 0
            },
            end: {
              sectionId: 'section-render',
              blockId: 'paragraph-render',
              runId: 'run-render',
              graphemeIndex: text.length
            },
            advanceTwips: [0, cssPxToTwips(120)]
          }
        ]
      }
    ],
    paragraphs: [],
    contentRect: {
      pageIndex,
      x: cssPxToTwips(72),
      y: lineTop,
      width: cssPxToTwips(456),
      height: cssPxToTwips(620)
    }
  }
}
