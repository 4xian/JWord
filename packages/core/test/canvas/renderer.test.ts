/**
 * @vitest-environment node
 *
 * 职责：验证 Gate 2 画布渲染器 每页独立绘制，并遵守页面背景、选区、文本背景、文本、光标的视觉层级。
 * 边界：只覆盖只读 布局盒到画布 指令的转换，不覆盖布局生成、命中测试和矩形映射 或真实浏览器画布。
 * 协作模块：渲染器消费布局盒，结合 视口虚拟器和画布池 管理每页 canvas。
 * 性能/安全约束：测试使用确定性 mock canvas，不访问 DOM，不创建真实图形资源，不使用单长 canvas。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/03-architecture.md#35-分页-canvas-渲染。
 */

import { describe, expect, it } from 'vitest'

import { createCanvasPool } from '../../src/canvas/pool'
import { renderPageCanvas, syncPageCanvases } from '../../src/canvas/renderer'
import { cssPxToTwips } from '../../src/layout/page-config'
import type { CanvasLike, CanvasRenderingContextLike } from '../../src/canvas/pool'
import type { LayoutBox } from '../../src/layout/runtime'

describe('renderPageCanvas', () => {
  it('按 page background、selection、text background、text、caret 顺序绘制单页 canvas', () => {
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
      'setTransform:1,0,0,1,0,0',
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

  it('在 run 背景之上、文本之下绘制选区高亮，避免背景色遮住选区', () => {
    const canvas = createMockCanvas()
    const page = createPageLayout(0, '背景色', {
      backgroundColor: '#00aa66'
    }) satisfies LayoutBox

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
      ]
    })

    expect(canvas.calls.indexOf('fillStyle:#00aa66')).toBeLessThan(canvas.calls.indexOf('fillStyle:#cfe3ff'))
    expect(canvas.calls.indexOf('fillStyle:#cfe3ff')).toBeLessThan(canvas.calls.indexOf('fillText:背景色,72,110'))
  })

  it('在选区之下绘制批注范围高亮，并过滤非当前页矩形', () => {
    const canvas = createMockCanvas()
    const page = createPageLayout(0, '批注文本') satisfies LayoutBox

    renderPageCanvas({
      canvas,
      page,
      commentRects: [
        {
          pageIndex: 0,
          x: cssPxToTwips(72),
          y: cssPxToTwips(96),
          width: cssPxToTwips(60),
          height: cssPxToTwips(18)
        },
        {
          pageIndex: 1,
          x: cssPxToTwips(72),
          y: cssPxToTwips(916),
          width: cssPxToTwips(60),
          height: cssPxToTwips(18)
        }
      ],
      selectionRects: [
        {
          pageIndex: 0,
          x: cssPxToTwips(84),
          y: cssPxToTwips(96),
          width: cssPxToTwips(36),
          height: cssPxToTwips(18)
        }
      ]
    })

    expect(canvas.calls).toContain('fillStyle:#fff3bf')
    expect(canvas.calls).toContain('fillRect:72,96,60,18')
    expect(canvas.calls).not.toContain('fillRect:72,916,60,18')
    expect(canvas.calls.indexOf('fillStyle:#fff3bf')).toBeLessThan(canvas.calls.indexOf('fillStyle:#cfe3ff'))
    expect(canvas.calls.indexOf('fillStyle:#cfe3ff')).toBeLessThan(canvas.calls.indexOf('fillText:批注文本,72,110'))
  })

  it('绘制 experimental 插件装饰且不把装饰画到错误页面', () => {
    const canvas = createMockCanvas()
    const page = createPageLayout(0, '插件装饰') satisfies LayoutBox

    renderPageCanvas({
      canvas,
      page,
      experimentalDecorations: [
        {
          kind: 'textHighlight',
          pluginName: 'review.decorations',
          providerName: 'highlights',
          id: 'range-1',
          pageIndex: 0,
          rects: [{
            pageIndex: 0,
            x: cssPxToTwips(72),
            y: cssPxToTwips(96),
            width: cssPxToTwips(48),
            height: cssPxToTwips(18)
          }],
          color: '#fde68a'
        },
        {
          kind: 'pageOverlay',
          pluginName: 'review.decorations',
          providerName: 'markers',
          id: 'marker-1',
          pageIndex: 0,
          rect: {
            pageIndex: 0,
            x: cssPxToTwips(180),
            y: cssPxToTwips(120),
            width: cssPxToTwips(60),
            height: cssPxToTwips(18)
          },
          color: '#bfdbfe',
          label: '审阅'
        },
        {
          kind: 'pageOverlay',
          pluginName: 'review.decorations',
          providerName: 'markers',
          id: 'marker-2',
          pageIndex: 1,
          rect: {
            pageIndex: 1,
            x: cssPxToTwips(180),
            y: cssPxToTwips(940),
            width: cssPxToTwips(60),
            height: cssPxToTwips(18)
          }
        }
      ]
    })

    expect(canvas.calls).toContain('fillStyle:#fde68a')
    expect(canvas.calls).toContain('fillRect:72,96,48,18')
    expect(canvas.calls.indexOf('fillStyle:#fde68a')).toBeLessThan(canvas.calls.indexOf('fillText:插件装饰,72,110'))
    expect(canvas.calls).toContain('fillStyle:#bfdbfe')
    expect(canvas.calls).toContain('fillRect:180,120,60,18')
    expect(canvas.calls.some((call) => call.startsWith('fillText:审阅,'))).toBe(true)
    expect(canvas.calls).not.toContain('fillRect:180,940,60,18')
  })

  it('在高 DPR 屏幕上放大 backing store，但保持页面 CSS 尺寸不变', () => {
    const canvas = createMockCanvas()
    const page = createPageLayout(0, '高清文本') satisfies LayoutBox

    renderPageCanvas({
      canvas,
      page,
      pixelRatio: 2
    })

    expect(canvas.width).toBe(1200)
    expect(canvas.height).toBe(1600)
    expect(canvas.style.width).toBe('600px')
    expect(canvas.style.height).toBe('800px')
    expect(canvas.calls).toContain('setTransform:2,0,0,2,0,0')
    expect(canvas.calls).toContain('fillText:高清文本,72,110')
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

  it('uses resolved fallback font when fragment requested font is unavailable', () => {
    const canvas = createMockCanvas()
    const page = createPageLayout(0, 'Fallback', {
      color: '#223344',
      fontFamily: 'Arial',
      requestedFontFamily: 'Missing Corp Sans',
      status: 'missing',
      italic: true,
      fontSizePx: 16
    }) satisfies LayoutBox

    renderPageCanvas({
      canvas,
      page
    })

    expect(canvas.calls).toContain('font:italic 16px Arial')
    expect(canvas.calls).not.toContain('font:italic 16px Missing Corp Sans')
  })

  it('paints run background and text decorations from fragment style', () => {
    const canvas = createMockCanvas()
    const page = createPageLayout(0, 'Decorated', {
      color: '#223344',
      backgroundColor: '#fff59d',
      underline: true,
      strike: true
    }) satisfies LayoutBox

    renderPageCanvas({
      canvas,
      page
    })

    expect(canvas.calls).toContain('fillStyle:#fff59d')
    expect(canvas.calls).toContain('fillRect:72,96,120,18')
    expect(canvas.calls).toContain('fillText:Decorated,72,110')
    expect(canvas.calls).toContain('fillRect:72,111,120,1')
    expect(canvas.calls).toContain('fillRect:72,105.2,120,1')
  })

  it('renders superscript and subscript with a shifted baseline and reduced font size', () => {
    const superscriptCanvas = createMockCanvas()
    const subscriptCanvas = createMockCanvas()
    const superscriptPage = createPageLayout(0, 'x2', {
      superscript: true,
      fontSizePx: 10.4,
      baseFontSizePx: 16
    }) satisfies LayoutBox
    const subscriptPage = createPageLayout(0, 'H2O', {
      subscript: true,
      fontSizePx: 10.4,
      baseFontSizePx: 16
    }) satisfies LayoutBox

    renderPageCanvas({
      canvas: superscriptCanvas,
      page: superscriptPage
    })
    renderPageCanvas({
      canvas: subscriptCanvas,
      page: subscriptPage
    })

    expect(superscriptCanvas.calls).toContain('font:10px sans-serif')
    expect(subscriptCanvas.calls).toContain('font:10px sans-serif')
    expect(findFillTextY(superscriptCanvas.calls, 'x2')).toBeLessThan(110)
    expect(findFillTextY(subscriptCanvas.calls, 'H2O')).toBeGreaterThan(110)
  })

  it('draws paragraph list markers before the paragraph text', () => {
    const canvas = createMockCanvas()
    const page = createListPageLayout(0, '列表项', '1.') satisfies LayoutBox

    renderPageCanvas({
      canvas,
      page
    })

    expect(canvas.calls).toContain('fillText:1.,56,110')
    expect(canvas.calls).toContain('fillText:列表项,72,110')
    expect(canvas.calls.indexOf('fillText:1.,56,110')).toBeLessThan(
      canvas.calls.indexOf('fillText:列表项,72,110')
    )
  })

  it('draws header footer boxes before body text', () => {
    const canvas = createMockCanvas()
    const page = createHeaderFooterPageLayout() satisfies LayoutBox

    renderPageCanvas({
      canvas,
      page
    })

    expect(canvas.calls).toContain('fillText:header-main,72,32')
    expect(canvas.calls).toContain('fillText:footer-main,72,772')
    expect(canvas.calls.indexOf('fillText:header-main,72,32')).toBeLessThan(
      canvas.calls.indexOf('fillText:正文,72,110')
    )
  })

  it('draws page-number source ids as page numbers without exposing source id text', () => {
    const canvas = createMockCanvas()
    const page = createHeaderFooterPageNumberLayout() satisfies LayoutBox

    renderPageCanvas({
      canvas,
      page
    })

    expect(canvas.calls).toContain('fillText:公司页眉,72,32')
    expect(canvas.calls).toContain('fillText:5,521,32')
    expect(canvas.calls).toContain('fillText:保密页脚,72,772')
    expect(canvas.calls.some((call) => call.includes('page-number-'))).toBe(false)
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

  it('draws image placeholders from inline object geometry and resource status', () => {
    const canvas = createMockCanvas()
    const page = createImagePageLayout(0) satisfies LayoutBox

    renderPageCanvas({
      canvas,
      page
    })

    expect(canvas.calls).toContain('fillStyle:#eff6ff')
    expect(canvas.calls).toContain('fillRect:72,96,48,32')
    expect(canvas.calls).toContain('font:12px sans-serif')
    expect(canvas.calls).toContain('fillText:Image ready,82,116')
    expect(canvas.calls).toContain('fillRect:108,116,8,8')
    expect(canvas.calls.indexOf('fillText:Image ready,82,116')).toBeLessThan(
      canvas.calls.indexOf('fillRect:108,116,8,8')
    )
  })

  it('draws decoded image content when success resource resolver returns ready image', () => {
    const canvas = createMockCanvas()
    const page = createImagePageLayout(0) satisfies LayoutBox

    renderPageCanvas({
      canvas,
      page,
      imageResourceResolver: {
        resolve: () => ({
          status: 'ready',
          image: {
            source: 'decoded-image',
            width: 48,
            height: 32
          }
        }),
        dispose: () => {}
      }
    })

    expect(canvas.calls).toContain('drawImage:decoded-image,72,96,48,32')
    expect(canvas.calls).not.toContain('fillText:Image ready,82,116')
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

  it('向页面渲染透传批注矩形', () => {
    const pool = createCanvasPool({
      createCanvas: () => createMockCanvas()
    })
    const pages = [createPageLayout(0, '批注页') satisfies LayoutBox]
    const result = syncPageCanvases({
      pages,
      retainedPageIndexes: [0],
      canvases: new Map(),
      pool,
      commentRects: [
        {
          pageIndex: 0,
          x: cssPxToTwips(72),
          y: cssPxToTwips(96),
          width: cssPxToTwips(60),
          height: cssPxToTwips(18)
        }
      ]
    })

    expect((result.get(0) as MockCanvas | undefined)?.calls).toContain('fillStyle:#fff3bf')
    expect((result.get(0) as MockCanvas | undefined)?.calls).toContain('fillRect:72,96,60,18')
  })
})

interface MockCanvas extends CanvasLike {
  readonly calls: string[]
  readonly style: {
    width: string
    height: string
    display: string
  }
}

function createMockCanvas(): MockCanvas {
  const calls: string[] = []
  const context = {
    set fillStyle(value: string) {
      calls.push(`fillStyle:${value}`)
    },
    set font(value: string) {
      calls.push(`font:${value}`)
    },
    set textBaseline(value: CanvasTextBaseline) {
      calls.push(`textBaseline:${value}`)
    },
    setTransform: (a, b, c, d, e, f) => {
      calls.push(`setTransform:${a},${b},${c},${d},${e},${f}`)
    },
    clearRect: (x, y, width, height) => {
      calls.push(`clearRect:${x},${y},${width},${height}`)
    },
    fillRect: (x, y, width, height) => {
      calls.push(`fillRect:${x},${y},${width},${height}`)
    },
    fillText: (text, x, y) => {
      calls.push(`fillText:${text},${x},${y}`)
    },
    drawImage: (image, x, y, width, height) => {
      calls.push(`drawImage:${String(image)},${x},${y},${width},${height}`)
    }
  } satisfies CanvasRenderingContextLike & {
    drawImage(image: unknown, x: number, y: number, width: number, height: number): void
  }

  return {
    width: 0,
    height: 0,
    calls,
    style: {
      width: '',
      height: '',
      display: ''
    },
    getContext: () => context
  }
}

function createPageLayout(
  pageIndex: number,
  text: string,
  styleOverrides: Partial<LayoutBox['lines'][number]['fragments'][number]['style']> = {}
): LayoutBox {
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
    sectionBoundary: 'single',
    sectionIds: ['section-render'],
    sectionId: 'section-render',
    headerIds: [],
    footerIds: [],
    headerFooterBoxes: [],
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
              fontFamily: 'sans-serif',
              fontSizePx: 16,
              status: 'available',
              ...styleOverrides
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
    blocks: [],
    contentRect: {
      pageIndex,
      x: cssPxToTwips(72),
      y: lineTop,
      width: cssPxToTwips(456),
      height: cssPxToTwips(620)
    }
  }
}

function findFillTextY(calls: readonly string[], text: string): number {
  const call = calls.find((entry) => entry.startsWith(`fillText:${text},`))

  if (call === undefined) {
    throw new Error(`missing fillText call for ${text}`)
  }

  return Number.parseFloat(call.split(',').at(-1) ?? 'NaN')
}

function createImagePageLayout(pageIndex: number): LayoutBox {
  const pageTop = cssPxToTwips(pageIndex * 820)
  const lineTop = pageTop + cssPxToTwips(96)

  return {
    kind: 'page',
    pageIndex,
    x: 0,
    y: pageTop,
    width: cssPxToTwips(600),
    height: cssPxToTwips(800),
    sectionBoundary: 'single',
    sectionIds: ['section-render'],
    sectionId: 'section-render',
    headerIds: [],
    footerIds: [],
    headerFooterBoxes: [],
    lines: [
      {
        kind: 'line',
        pageIndex,
        sectionId: 'section-render',
        paragraphId: 'paragraph-render',
        x: cssPxToTwips(72),
        y: lineTop,
        width: cssPxToTwips(456),
        height: cssPxToTwips(32),
        baseline: pageTop + cssPxToTwips(118),
        fragments: [],
        inlines: [
          {
            kind: 'inlineObject',
            inlineKind: 'image',
            pageIndex,
            sectionId: 'section-render',
            blockId: 'paragraph-render',
            runId: 'run-image',
            at: {
              sectionId: 'section-render',
              blockId: 'paragraph-render',
              runId: 'run-image',
              graphemeIndex: 0
            },
            x: cssPxToTwips(72),
            y: lineTop,
            width: cssPxToTwips(48),
            height: cssPxToTwips(32),
            payload: {
              resourceId: 'image-1',
              alt: '占位图',
              widthTwips: cssPxToTwips(48),
              heightTwips: cssPxToTwips(32),
              resourceStatus: 'success',
              resourceMime: 'image/png',
              resourceSourceKind: 'dataUrl',
              resourceSourceUrl: 'data:image/png;base64,AAAA'
            }
          }
        ]
      }
    ],
    paragraphs: [],
    blocks: [],
    contentRect: {
      pageIndex,
      x: cssPxToTwips(72),
      y: lineTop,
      width: cssPxToTwips(456),
      height: cssPxToTwips(620)
    }
  }
}

function createListPageLayout(pageIndex: number, text: string, markerText: string): LayoutBox {
  const page = createPageLayout(pageIndex, text)
  const line = page.lines[0]!

  return {
    ...page,
    paragraphs: [
      {
        kind: 'paragraph',
        pageIndex,
        sectionId: 'section-render',
        paragraphId: 'paragraph-render',
        pageBreakPolicy: {
          widowControl: true,
          orphanLines: 2,
          widowLines: 2
        },
        x: line.x,
        y: line.y,
        width: line.width,
        height: line.height,
        lines: [line],
        listMarker: {
          kind: 'ordered',
          label: markerText,
          text: markerText,
          level: 1,
          gapTwips: cssPxToTwips(4),
          list: {
            numberingId: 'jword-list-ordered',
            level: 0
          }
        }
      }
    ]
  }
}

/** 创建带页眉页脚 layout box 的页面。 */
function createHeaderFooterPageLayout(): LayoutBox {
  const page = createPageLayout(0, '正文')

  return {
    ...page,
    pageNumber: 5,
    headerIds: ['header-main'],
    footerIds: ['footer-main'],
    headerFooterBoxes: [
      {
        kind: 'headerFooter',
        role: 'header',
        sectionId: 'section-render',
        sourceId: 'header-main',
        pageNumber: 5,
        pageIndex: 0,
        x: cssPxToTwips(72),
        y: cssPxToTwips(20),
        width: cssPxToTwips(456),
        height: cssPxToTwips(20),
        baseline: cssPxToTwips(32)
      },
      {
        kind: 'headerFooter',
        role: 'footer',
        sectionId: 'section-render',
        sourceId: 'footer-main',
        pageNumber: 5,
        pageIndex: 0,
        x: cssPxToTwips(72),
        y: cssPxToTwips(760),
        width: cssPxToTwips(456),
        height: cssPxToTwips(20),
        baseline: cssPxToTwips(772)
      }
    ]
  }
}

/** 创建带独立页码 source id 的页眉页脚 layout box。 */
function createHeaderFooterPageNumberLayout(): LayoutBox {
  const page = createPageLayout(0, '正文')

  return {
    ...page,
    pageNumber: 5,
    headerIds: ['公司页眉', 'page-number-top-right'],
    footerIds: ['保密页脚'],
    headerFooterBoxes: [
      {
        kind: 'headerFooter',
        role: 'header',
        sectionId: 'section-render',
        sourceId: '公司页眉',
        pageNumber: 5,
        pageIndex: 0,
        x: cssPxToTwips(72),
        y: cssPxToTwips(20),
        width: cssPxToTwips(456),
        height: cssPxToTwips(20),
        baseline: cssPxToTwips(32)
      },
      {
        kind: 'headerFooter',
        role: 'header',
        sectionId: 'section-render',
        sourceId: 'page-number-top-right',
        pageNumber: 5,
        pageIndex: 0,
        x: cssPxToTwips(72),
        y: cssPxToTwips(20),
        width: cssPxToTwips(456),
        height: cssPxToTwips(20),
        baseline: cssPxToTwips(32)
      },
      {
        kind: 'headerFooter',
        role: 'footer',
        sectionId: 'section-render',
        sourceId: '保密页脚',
        pageNumber: 5,
        pageIndex: 0,
        x: cssPxToTwips(72),
        y: cssPxToTwips(760),
        width: cssPxToTwips(456),
        height: cssPxToTwips(20),
        baseline: cssPxToTwips(772)
      }
    ]
  }
}
