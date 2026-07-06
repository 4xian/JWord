/**
 * @vitest-environment node
 *
 * 职责：验证布局 runtime 输出表格块、行列盒和跨页续表结构。
 * 边界：只测试表格 layout box 派生，不覆盖 UI 表格交互或 Canvas 渲染。
 * 协作模块：布局运行时、表格布局、页面配置与字体管理器。
 * 性能/安全约束：测试只读 DocumentProjection，不访问 DOM，不夹带表格能力变更。
 * Specs：docs/superpowers/reports/2026-07-03-remediation-execution-supplement.md §3.10 T2。
 */

import { describe, expect, it } from 'vitest'

import { createFontManager } from '../../src/layout/font-manager'
import { layoutDocument } from '../../src/layout/runtime'
import { createPageConfig } from '../../src/layout/page-config'

describe('Gate 2 表格布局', () => {
  it('splits an overflowing table by rows and keeps continuation pages tied to the owning section boundary', () => {
    const layout = layoutDocument({
      projection: {
        document: {
          kind: 'document',
          id: 'document-layout-table-overflow',
          sections: [
            {
              kind: 'section',
              id: 'section-layout-table-overflow',
              page: {
                widthTwips: 12240
              },
              headerIds: ['header-table'],
              footerIds: ['footer-table'],
              blocks: [
                {
                  kind: 'paragraph',
                  id: 'paragraph-layout-table-overflow',
                  runs: [
                    {
                      kind: 'run',
                      id: 'run-layout-table-overflow',
                      properties: {
                        fontSizePx: 16
                      },
                      inlines: [
                        {
                          kind: 'text',
                          text: 'table moves to next page'
                        }
                      ]
                    }
                  ]
                },
                {
                  kind: 'table',
                  id: 'table-layout-overflow',
                  rows: [
                    {
                      id: 'row-layout-overflow-1',
                      cells: [
                        {
                          id: 'cell-layout-overflow-1',
                          blocks: []
                        }
                      ]
                    },
                    {
                      id: 'row-layout-overflow-2',
                      cells: [
                        {
                          id: 'cell-layout-overflow-2',
                          blocks: []
                        }
                      ]
                    },
                    {
                      id: 'row-layout-overflow-3',
                      cells: [
                        {
                          id: 'cell-layout-overflow-3',
                          blocks: []
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        }
      },
      pageConfig: createPageConfig({
        orientation: 'landscape',
        widthTwips: 12240,
        heightTwips: 1140,
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
    const firstPage = layout.pages[0]
    const secondPage = layout.pages[1]
    const thirdPage = layout.pages[2]
    const firstPageTable = firstPage?.blocks.find((block) => block.kind === 'table')
    const secondPageTable = secondPage?.blocks.find((block) => block.kind === 'table')
    const thirdPageTable = thirdPage?.blocks.find((block) => block.kind === 'table')

    expect(layout.pages).toHaveLength(3)
    expect(firstPage?.blocks.map((block) => block.kind)).toEqual(['paragraph', 'table'])
    expect(firstPageTable).toMatchObject({
      kind: 'table',
      pageIndex: 0,
      sectionId: 'section-layout-table-overflow',
      tableId: 'table-layout-overflow',
      startRowIndex: 0,
      continuesFromPreviousPage: false,
      continuesOnNextPage: true,
      rowCount: 1
    })
    expect(secondPageTable).toMatchObject({
      kind: 'table',
      pageIndex: 1,
      sectionId: 'section-layout-table-overflow',
      tableId: 'table-layout-overflow',
      startRowIndex: 1,
      continuesFromPreviousPage: true,
      continuesOnNextPage: true,
      rowCount: 1
    })
    expect(thirdPageTable).toMatchObject({
      kind: 'table',
      pageIndex: 2,
      sectionId: 'section-layout-table-overflow',
      tableId: 'table-layout-overflow',
      startRowIndex: 2,
      continuesFromPreviousPage: true,
      continuesOnNextPage: false,
      rowCount: 1
    })
    for (const page of layout.pages) {
      expect(page).toMatchObject({
        sectionBoundary: 'single',
        sectionIds: ['section-layout-table-overflow'],
        sectionId: 'section-layout-table-overflow',
        pageLayout: {
          widthTwips: 12240
        },
        headerIds: ['header-table'],
        footerIds: ['footer-table']
      })
    }
  })


  it('emits explicit table block boxes instead of dropping table structure', () => {
    const layout = layoutDocument({
      projection: {
        document: {
          kind: 'document',
          id: 'document-layout-table-boundary',
          sections: [
            {
              kind: 'section',
              id: 'section-layout-table-boundary',
              blocks: [
                {
                  kind: 'table',
                  id: 'table-layout-boundary',
                  grid: [1200, 2400],
                  rows: [
                    {
                      id: 'row-layout-boundary-1',
                      cells: [
                        {
                          id: 'cell-layout-boundary-1',
                          blocks: [
                            {
                              kind: 'paragraph',
                              id: 'cell-layout-paragraph-1',
                              runs: []
                            }
                          ]
                        },
                        {
                          id: 'cell-layout-boundary-2',
                          gridSpan: 2,
                          blocks: []
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        }
      },
      pageConfig: createPageConfig(),
      fontManager: createFontManager({
        fallbackFontFamily: 'Arial',
        availableFontFamilies: ['Arial']
      })
    })
    const table = layout.pages[0]?.blocks.find((block) => block.kind === 'table')

    expect(table).toEqual(expect.objectContaining({
      kind: 'table',
      sectionId: 'section-layout-table-boundary',
      tableId: 'table-layout-boundary',
      grid: [1200, 2400],
      rowCount: 1,
      cellCount: 2,
      rows: [
        expect.objectContaining({
          rowId: 'row-layout-boundary-1',
          cells: [
            expect.objectContaining({
              cellId: 'cell-layout-boundary-1',
              gridSpan: 1,
              blockIds: ['cell-layout-paragraph-1']
            }),
            expect.objectContaining({
              cellId: 'cell-layout-boundary-2',
              gridSpan: 2,
              blockIds: []
            })
          ]
        })
      ]
    }))
  })

})
