/**
 * @vitest-environment node
 *
 * 职责：验证 Gate 4 表格纵线的 layout、canvas render 与 hit-test 最小闭环。
 * 边界：只覆盖 core 纯数据布局、边框绘制和单元格文本命中，不测试浏览器事件系统。
 * 协作模块：layout 产出表格几何，renderer 消费表格盒绘制边框，query 把页面点映射回单元格文本位置。
 * 性能/安全约束：测试使用内存 mock canvas，不访问 DOM、网络或磁盘。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#iteration-2---表格纵线step-44-47。
 */

import { describe, expect, it } from 'vitest'

import { renderPageCanvas } from '../../src/canvas/renderer'
import type { CanvasLike, CanvasRenderingContextLike } from '../../src/canvas/pool'
import { createFontManager } from '../../src/layout/font-manager'
import { createPageConfig } from '../../src/layout/page-config'
import {
  hitTestDocumentLayout,
  layoutDocument
} from '../../src/layout/runtime'
import type { DocumentProjection } from '../../src/model/projection'

describe('table layout render hit-test', () => {
  it('emits table cell geometry, renders borders and hits the first cell text position', () => {
    const layout = layoutDocument({
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
    const page = layout.pages[0]
    const table = page?.blocks.find((block) => block.kind === 'table')
    const firstCell = table?.rows[0]?.cells[0]

    expect(table).toMatchObject({
      kind: 'table',
      tableId: 'table-layout',
      grid: [1800, 1800],
      rowCount: 1,
      cellCount: 2,
      border: {
        color: '#94a3b8',
        widthTwips: 24
      }
    })
    expect(firstCell).toMatchObject({
      cellId: 'cell-layout-1',
      border: {
        color: '#2563eb',
        widthTwips: 24
      }
    })
    expect(firstCell?.text).toBe('A1')

    const hit = hitTestDocumentLayout(layout, {
      pageIndex: 0,
      x: ((firstCell?.x ?? 0) - (page?.x ?? 0)) + 1,
      y: ((firstCell?.y ?? 0) - (page?.y ?? 0)) + 1
    })

    expect(hit).toEqual({
      sectionId: 'section-layout',
      blockId: 'cell-layout-paragraph-1',
      runId: 'cell-layout-run-1',
      graphemeIndex: 0
    })

    const canvas = createMockCanvas()

    renderPageCanvas({
      canvas,
      page: page!
    })

    expect(canvas.calls).toContain('fillStyle:#94a3b8')
    expect(canvas.calls).toContain('fillStyle:#2563eb')
    expect(canvas.calls.some((call) => call.startsWith('fillText:A1,'))).toBe(true)
    expect(canvas.calls.some((call) => call.startsWith('fillText:B1,'))).toBe(true)
  })
})

/**
 * 创建带边框和单元格文本的最小表格 projection。
 */
function createTableProjection(): DocumentProjection {
  return {
    document: {
      kind: 'document',
      id: 'document-layout',
      sections: [
        {
          kind: 'section',
          id: 'section-layout',
          blocks: [
            {
              kind: 'table',
              id: 'table-layout',
              grid: [1800, 1800],
              border: {
                color: '#94a3b8',
                widthTwips: 24
              },
              rows: [
                {
                  id: 'row-layout-1',
                  cells: [
                    {
                      id: 'cell-layout-1',
                      border: {
                        color: '#2563eb',
                        widthTwips: 24
                      },
                      blocks: [
                        {
                          kind: 'paragraph',
                          id: 'cell-layout-paragraph-1',
                          runs: [
                            {
                              kind: 'run',
                              id: 'cell-layout-run-1',
                              properties: {
                                fontSizePx: 16
                              },
                              inlines: [{ kind: 'text', text: 'A1' }]
                            }
                          ]
                        }
                      ]
                    },
                    {
                      id: 'cell-layout-2',
                      blocks: [
                        {
                          kind: 'paragraph',
                          id: 'cell-layout-paragraph-2',
                          runs: [
                            {
                              kind: 'run',
                              id: 'cell-layout-run-2',
                              properties: {
                                fontSizePx: 16
                              },
                              inlines: [{ kind: 'text', text: 'B1' }]
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

/**
 * 创建记录绘制调用顺序的 mock canvas。
 */
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

/**
 * 创建最小 2d context mock，仅记录当前测试关心的绘制调用。
 */
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
