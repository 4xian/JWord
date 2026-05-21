/**
 * @vitest-environment node
 *
 * 职责：补充表格点击 caret 与 canvas 边框一致性的定向回归测试。
 * 边界：只覆盖 core 的 table hit-test、caret 几何和 canvas 边框绘制，不测试 UI 浮层或浏览器事件。
 * 协作模块：layout 产出 table/cell 盒模型，query 负责位置到 caret 映射，renderer 负责单次网格描边。
 * 性能/安全约束：使用内存 mock canvas，不访问 DOM、网络或磁盘。
 * Specs：腾讯文档取证事实包关于表格点击进入编辑与内部边框宽度一致。
 */

import { describe, expect, it } from 'vitest'

import { renderPageCanvas } from '../../src/canvas/renderer'
import type { CanvasLike, CanvasRenderingContextLike } from '../../src/canvas/pool'
import { createFontManager } from '../../src/layout/font-manager'
import { createPageConfig, twipsToCssPx } from '../../src/layout/page-config'
import {
  getCaretRect,
  hitTestDocumentLayout,
  layoutDocument
} from '../../src/layout/runtime'
import type { DocumentProjection } from '../../src/model/projection'

describe('table caret render hit targeted', () => {
  it('draws the shared vertical divider once so inner borders stay even', () => {
    const layout = createTableLayout()
    const page = layout.pages[0]
    const table = page?.blocks.find((block) => block.kind === 'table')
    const borderWidth = Math.max(1, Math.round(twipsToCssPx(table?.border?.widthTwips ?? 15, 1)))
    const tableHeight = Math.max(1, twipsToCssPx(table?.height ?? 0, 1))
    const canvas = createMockCanvas()

    renderPageCanvas({
      canvas,
      page: page!
    })

    const verticalBorders = readFillRectCalls(canvas.calls).filter((rect) =>
      rect.width === borderWidth && rect.height === tableHeight
    )

    expect(verticalBorders).toHaveLength(3)
  })

  it('routes a shared cell-edge click to the trailing cell and returns a caret rect inside it', () => {
    const layout = createTableLayout()
    const page = layout.pages[0]
    const table = page?.blocks.find((block) => block.kind === 'table')
    const secondCell = table?.rows[0]?.cells[1]
    const hit = hitTestDocumentLayout(layout, {
      pageIndex: 0,
      x: (secondCell?.x ?? 0) - (page?.x ?? 0),
      y: ((secondCell?.y ?? 0) - (page?.y ?? 0)) + 1
    })
    const caret = hit === undefined ? undefined : getCaretRect(layout, hit)

    expect(hit).toEqual({
      sectionId: 'section-table-targeted',
      blockId: 'paragraph-table-targeted-2',
      runId: 'run-table-targeted-2',
      graphemeIndex: 0
    })
    expect(caret).toMatchObject({
      pageIndex: 0,
      x: secondCell?.fragments[0]?.x,
      y: secondCell?.fragments[0]?.y,
      height: secondCell?.fragments[0]?.height
    })
  })

  it('returns a visible caret rect after clicking inside the first table cell', () => {
    const layout = createTableLayout()
    const page = layout.pages[0]
    const table = page?.blocks.find((block) => block.kind === 'table')
    const firstCell = table?.rows[0]?.cells[0]
    const position = hitTestDocumentLayout(layout, {
      pageIndex: 0,
      x: ((firstCell?.x ?? 0) - (page?.x ?? 0)) + 1,
      y: ((firstCell?.y ?? 0) - (page?.y ?? 0)) + 1
    })
    const caret = position === undefined ? undefined : getCaretRect(layout, position)

    expect(position).toEqual({
      sectionId: 'section-table-targeted',
      blockId: 'paragraph-table-targeted-1',
      runId: 'run-table-targeted-1',
      graphemeIndex: 0
    })
    expect(caret).toMatchObject({
      pageIndex: 0,
      x: firstCell?.fragments[0]?.x,
      y: firstCell?.fragments[0]?.y,
      height: firstCell?.fragments[0]?.height
    })
  })
})

function createTableLayout() {
  return layoutDocument({
    projection: createTableProjection(),
    pageConfig: createPageConfig({
      widthTwips: 6000,
      heightTwips: 4000,
      marginTwips: {
        top: 120,
        right: 120,
        bottom: 120,
        left: 120
      }
    }),
    fontManager: createFontManager({
      fallbackFontFamily: 'Arial',
      availableFontFamilies: ['Arial']
    })
  })
}

function createTableProjection(): DocumentProjection {
  return {
    document: {
      kind: 'document',
      id: 'document-table-targeted',
      sections: [
        {
          kind: 'section',
          id: 'section-table-targeted',
          blocks: [
            {
              kind: 'table',
              id: 'table-targeted',
              grid: [1800, 1800],
              border: {
                color: '#94a3b8',
                widthTwips: 24
              },
              rows: [
                {
                  id: 'row-table-targeted-1',
                  cells: [
                    {
                      id: 'cell-table-targeted-1',
                      border: {
                        color: '#2563eb',
                        widthTwips: 24
                      },
                      blocks: [
                        {
                          kind: 'paragraph',
                          id: 'paragraph-table-targeted-1',
                          runs: [
                            {
                              kind: 'run',
                              id: 'run-table-targeted-1',
                              properties: {
                                fontSizePx: 16
                              },
                              inlines: [
                                {
                                  kind: 'text',
                                  text: 'A1'
                                }
                              ]
                            }
                          ]
                        }
                      ]
                    },
                    {
                      id: 'cell-table-targeted-2',
                      blocks: [
                        {
                          kind: 'paragraph',
                          id: 'paragraph-table-targeted-2',
                          runs: [
                            {
                              kind: 'run',
                              id: 'run-table-targeted-2',
                              properties: {
                                fontSizePx: 16
                              },
                              inlines: [
                                {
                                  kind: 'text',
                                  text: 'B1'
                                }
                              ]
                            }
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    }
  }
}

function createMockCanvas(): CanvasLike & { calls: string[], style: Record<string, string> } {
  const calls: string[] = []
  const context = createMockContext(calls)

  return {
    width: 0,
    height: 0,
    style: {},
    getContext() {
      return context
    },
    calls
  }
}

function createMockContext(calls: string[]): CanvasRenderingContextLike {
  const state = {
    fillStyle: '#000000',
    font: '10px sans-serif',
    textBaseline: 'alphabetic' as CanvasTextBaseline
  }

  return {
    get fillStyle() {
      return state.fillStyle
    },
    set fillStyle(value) {
      state.fillStyle = String(value)
      calls.push(`fillStyle:${state.fillStyle}`)
    },
    get font() {
      return state.font
    },
    set font(value) {
      state.font = String(value)
      calls.push(`font:${state.font}`)
    },
    get textBaseline() {
      return state.textBaseline
    },
    set textBaseline(value) {
      state.textBaseline = value
      calls.push(`textBaseline:${String(value)}`)
    },
    clearRect(x, y, width, height) {
      calls.push(`clearRect:${x},${y},${width},${height}`)
    },
    fillRect(x, y, width, height) {
      calls.push(`fillRect:${x},${y},${width},${height}`)
    },
    fillText(text, x, y) {
      calls.push(`fillText:${String(text)},${x},${y}`)
    },
    setTransform(a, b, c, d, e, f) {
      calls.push(`setTransform:${a},${b},${c},${d},${e},${f}`)
    }
  }
}

function readFillRectCalls(calls: readonly string[]): ReadonlyArray<Readonly<{
  x: number
  y: number
  width: number
  height: number
}>> {
  return calls
    .filter((call) => call.startsWith('fillRect:'))
    .flatMap((call) => {
      const [x, y, width, height] = call.slice('fillRect:'.length).split(',').map(Number)

      if (
        x === undefined
        || y === undefined
        || width === undefined
        || height === undefined
        || !Number.isFinite(x)
        || !Number.isFinite(y)
        || !Number.isFinite(width)
        || !Number.isFinite(height)
      ) {
        return []
      }

      return [Object.freeze({
        x,
        y,
        width,
        height
      })]
    })
}
