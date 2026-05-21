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
import * as Y from 'yjs'

import { renderPageCanvas } from '../../src/canvas/renderer'
import type { CanvasLike, CanvasRenderingContextLike } from '../../src/canvas/pool'
import { createFontManager } from '../../src/layout/font-manager'
import { createPageConfig } from '../../src/layout/page-config'
import {
  hitTestDocumentLayout,
  layoutDocument
} from '../../src/layout/runtime'
import {
  DOCUMENT_STORE_FIELDS,
  createDocumentStore,
  createSectionRecord
} from '../../src/model/document-store'
import type { DocumentId, SectionId } from '../../src/model/position'
import type { DocumentProjection } from '../../src/model/projection'
import { createDocumentProjection } from '../../src/model/projection'
import {
  buildInsertTableCommand,
  buildSetTableColumnWidthCommand,
  buildSetTableRowHeightCommand
} from '../../src/operations/command-builders'
import { createTransactionPipeline } from '../../src/operations/transaction'

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
    expect(canvas.calls.some((call) => call.startsWith('fillText:A1,'))).toBe(true)
    expect(canvas.calls.some((call) => call.startsWith('fillText:B1,'))).toBe(true)
  })

  it('uses smaller default column width and taller default row height for inserted tables', () => {
    const { pipeline, projection } = createTransactionFixture()
    const insertCommand = buildInsertTableCommand(projection, null, {
      rows: 2,
      columns: 2
    })

    expect(insertCommand?.operations[0]).toMatchObject({
      kind: 'insertTable',
      table: {
        grid: [1500, 1500],
        rows: [{
          properties: {
            heightTwips: 600
          }
        }, {
          properties: {
            heightTwips: 600
          }
        }]
      }
    })

    if (insertCommand === null) {
      throw new Error('expected insert table command')
    }

    const result = pipeline.run(insertCommand, {
      origin: 'layout-test'
    })
    const tableProjection = findProjectedTable(result.projection)
    const tableLayout = findLaidOutTable(layoutDocument({
      projection: result.projection,
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
    }))

    expect(tableProjection?.grid).toEqual([1500, 1500])
    expect(tableProjection?.rows[0]?.properties).toMatchObject({
      heightTwips: 600
    })
    expect(tableLayout).toMatchObject({
      grid: [1500, 1500],
      height: 1200
    })
    expect(tableLayout?.rows[0]?.height).toBe(600)
    expect(tableLayout?.rows[1]?.y).toBe((tableLayout?.y ?? 0) + 600)
    expect(tableLayout?.rows[0]?.cells[0]?.width).toBe(1500)
  })

  it('updates layout after setting table column width and row height through commands', () => {
    const { pipeline, projection } = createTransactionFixture()
    const insertCommand = buildInsertTableCommand(projection, null, {
      rows: 1,
      columns: 2
    })

    if (insertCommand === null) {
      throw new Error('expected insert table command')
    }

    const inserted = pipeline.run(insertCommand, {
      origin: 'layout-test'
    }).projection
    const tableId = findProjectedTable(inserted)?.id

    if (tableId === undefined) {
      throw new Error('expected inserted table id')
    }

    const setColumnWidthCommand = buildSetTableColumnWidthCommand(inserted, tableId, 0, 2100)

    expect(setColumnWidthCommand).toEqual({
      name: 'setTableColumnWidth',
      operations: [{
        kind: 'setTableColumnWidth',
        tableId,
        columnIndex: 0,
        widthTwips: 2100
      }]
    })

    if (setColumnWidthCommand === null) {
      throw new Error('expected set table column width command')
    }

    const resizedColumns = pipeline.run(setColumnWidthCommand, {
      origin: 'layout-test'
    }).projection
    const setRowHeightCommand = buildSetTableRowHeightCommand(resizedColumns, tableId, 0, 720)

    expect(setRowHeightCommand).toEqual({
      name: 'setTableRowHeight',
      operations: [{
        kind: 'setTableRowHeight',
        tableId,
        rowIndex: 0,
        heightTwips: 720
      }]
    })

    if (setRowHeightCommand === null) {
      throw new Error('expected set table row height command')
    }

    const resizedLayout = findLaidOutTable(layoutDocument({
      projection: pipeline.run(setRowHeightCommand, {
        origin: 'layout-test'
      }).projection,
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
    }))

    expect(resizedLayout).toMatchObject({
      grid: [2100, 1500],
      height: 720
    })
    expect(resizedLayout?.rows[0]?.height).toBe(720)
    expect(resizedLayout?.rows[0]?.cells[0]?.width).toBe(2100)
    expect(resizedLayout?.rows[0]?.cells[1]?.width).toBe(1500)
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

function createTransactionFixture(): Readonly<{
  pipeline: ReturnType<typeof createTransactionPipeline>
  projection: DocumentProjection
}> {
  const doc = new Y.Doc()
  const store = createDocumentStore(doc)
  const section = createSectionRecord('section-transaction-layout' as SectionId)

  store.document.set(DOCUMENT_STORE_FIELDS.document.id, 'document-transaction-layout' as DocumentId)
  store.sections.push([section])

  return {
    pipeline: createTransactionPipeline(doc),
    projection: createDocumentProjection(store)
  }
}

function findProjectedTable(projection: DocumentProjection) {
  return projection.document.sections
    .flatMap((section) => section.blocks)
    .find((block) => block.kind === 'table')
}

function findLaidOutTable(layout: ReturnType<typeof layoutDocument>) {
  return layout.pages
    .flatMap((page) => page.blocks)
    .find((block) => block.kind === 'table')
}
