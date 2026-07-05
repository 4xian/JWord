/**
 * @vitest-environment node
 *
 * 职责：验证 G2-01/G2-02/G2-20 分页排版修复的核心行为。
 * 边界：只覆盖纯 layout 输出，不触发 Canvas、DOM、Y.Doc 或编辑输入管线。
 * 协作模块：layout engine、paragraph flow 与 dirty page 查询共同提供分页几何。
 * 性能/安全约束：测试使用确定性字体度量和内存投影，不访问网络或磁盘。
 * Specs：docs/superpowers/reports/2026-07-03-remediation-execution-supplement.md#32-g2-02--g2-20-表格跨页断行与续排段前距phase-1cl。
 */

import { describe, expect, it } from 'vitest'

import { findBlockPageIndexes } from '../../src/editor/rendering'
import { createFontManager } from '../../src/layout/font-manager'
import { createPageConfig } from '../../src/layout/page-config'
import { layoutDocument } from '../../src/layout/runtime'
import type { DocumentLayout } from '../../src/layout/runtime'
import type { PageConfig } from '../../src/layout/page-config'
import type { DocumentProjection } from '../../src/model/projection'
import type { Block, Inline, ModelProperties, TableRow } from '../../src/model/types'

describe('Gate 2 pagination remediation', () => {
  it('stretches non-final justify lines to the content right edge', () => {
    const layout = createLayout(
      createParagraphProjection({
        paragraphId: 'paragraph-layout-justify',
        runId: 'run-layout-justify',
        text: '甲乙丙丁戊',
        properties: {
          alignment: 'justify'
        }
      }),
      createPageConfig({
        widthTwips: 1240,
        heightTwips: 4000,
        marginTwips: {
          top: 120,
          right: 120,
          bottom: 120,
          left: 120
        }
      })
    )
    const page = layout.pages[0]!
    const firstLine = page.lines[0]!
    const secondLine = page.lines[1]!
    const lastFirstLineFragment = firstLine.fragments.at(-1)!

    expect(firstLine.fragments.map((fragment) => fragment.text).join('')).toBe('甲乙丙丁')
    expect(firstLine.width).toBeCloseTo(page.contentRect.width, 5)
    expect(lastFirstLineFragment.x + lastFirstLineFragment.width).toBeCloseTo(
      page.contentRect.x + page.contentRect.width,
      5
    )
    expect(secondLine.fragments.map((fragment) => fragment.text).join('')).toBe('戊')
    expect(secondLine.width).toBeLessThan(page.contentRect.width)
  })

  it('splits an overlong table by rows and reports every occupied page', () => {
    const layout = createLayout(
      {
        document: {
          kind: 'document',
          id: 'document-layout-table-split',
          sections: [
            {
              kind: 'section',
              id: 'section-layout-table-split',
              blocks: [
                {
                  kind: 'table',
                  id: 'table-layout-split',
                  rows: createRows(20, 300)
                }
              ]
            }
          ]
        }
      },
      createPageConfig({
        widthTwips: 6000,
        heightTwips: 6240,
        marginTwips: {
          top: 120,
          right: 120,
          bottom: 120,
          left: 120
        }
      })
    )
    const tables = layout.pages.flatMap((page) =>
      page.blocks.filter((block) => block.kind === 'table')
    )

    expect(layout.pages).toHaveLength(2)
    expect(tables).toHaveLength(2)
    expect(tables[0]).toMatchObject({
      pageIndex: 0,
      tableId: 'table-layout-split',
      startRowIndex: 0,
      continuesFromPreviousPage: false,
      continuesOnNextPage: true
    })
    expect(tables[0]?.rows).toHaveLength(10)
    expect(tables[0]?.rows[0]?.rowId).toBe('row-layout-split-1')
    expect(tables[0]?.rows[9]?.rowId).toBe('row-layout-split-10')
    expect(tables[1]).toMatchObject({
      pageIndex: 1,
      tableId: 'table-layout-split',
      startRowIndex: 10,
      continuesFromPreviousPage: true,
      continuesOnNextPage: false
    })
    expect(tables[1]?.rows).toHaveLength(10)
    expect(tables[1]?.rows[0]?.rowId).toBe('row-layout-split-11')
    expect(tables[1]?.rows[9]?.rowId).toBe('row-layout-split-20')
    expect(findBlockPageIndexes(layout, 'table-layout-split')).toEqual([0, 1])
  })

  it('moves the whole table to the next page when the first row cannot fit remaining space', () => {
    const layout = createLayout(
      {
        document: {
          kind: 'document',
          id: 'document-layout-table-next-page',
          sections: [
            {
              kind: 'section',
              id: 'section-layout-table-next-page',
              blocks: [
                createParagraphBlock({
                  paragraphId: 'paragraph-layout-table-before',
                  runId: 'run-layout-table-before',
                  text: '上'
                }),
                {
                  kind: 'table',
                  id: 'table-layout-next-page',
                  rows: createRows(1, 300)
                }
              ]
            }
          ]
        }
      },
      createPageConfig({
        orientation: 'landscape',
        widthTwips: 6000,
        heightTwips: 600,
        marginTwips: {
          top: 120,
          right: 120,
          bottom: 120,
          left: 120
        }
      })
    )
    const firstPageTables = layout.pages[0]?.blocks.filter((block) => block.kind === 'table')
    const secondPageTables = layout.pages[1]?.blocks.filter((block) => block.kind === 'table')

    expect(firstPageTables).toEqual([])
    expect(secondPageTables).toHaveLength(1)
    expect(secondPageTables?.[0]).toMatchObject({
      pageIndex: 1,
      tableId: 'table-layout-next-page',
      startRowIndex: 0,
      continuesFromPreviousPage: false,
      continuesOnNextPage: false
    })
    expect(secondPageTables?.[0]?.rows).toHaveLength(1)
  })

  it('moves a paragraph that overflows after spacingBefore without leaving an empty prior-page paragraph', () => {
    const layout = createLayout(
      {
        document: {
          kind: 'document',
          id: 'document-layout-spacing-before-page-top',
          sections: [
            {
              kind: 'section',
              id: 'section-layout-spacing-before-page-top',
              blocks: [
                createParagraphBlock({
                  paragraphId: 'paragraph-layout-spacing-before-previous',
                  runId: 'run-layout-spacing-before-previous',
                  text: '上'
                }),
                createParagraphBlock({
                  paragraphId: 'paragraph-layout-spacing-before-next',
                  runId: 'run-layout-spacing-before-next',
                  text: '下',
                  properties: {
                    spacingBeforeTwips: 200
                  }
                })
              ]
            }
          ]
        }
      },
      createPageConfig({
        orientation: 'landscape',
        widthTwips: 6000,
        heightTwips: 600,
        marginTwips: {
          top: 120,
          right: 120,
          bottom: 120,
          left: 120
        }
      })
    )
    const firstPageParagraphIds = layout.pages[0]?.paragraphs.map((paragraph) => paragraph.paragraphId)
    const continuedLine = layout.pages[1]?.lines.find((line) =>
      line.paragraphId === 'paragraph-layout-spacing-before-next'
    )

    expect(firstPageParagraphIds).toEqual(['paragraph-layout-spacing-before-previous'])
    expect(continuedLine?.y).toBe(layout.pages[1]?.contentRect.y)
  })

  it('moves a paragraph to the next page when only one orphan line fits at page tail', () => {
    const layout = createLayout(
      {
        document: {
          kind: 'document',
          id: 'document-layout-orphan-control',
          sections: [
            {
              kind: 'section',
              id: 'section-layout-orphan-control',
              blocks: [
                createParagraphBlock({
                  paragraphId: 'paragraph-layout-orphan-before',
                  runId: 'run-layout-orphan-before',
                  text: '上',
                  properties: {
                    spacingAfterTwips: 600
                  }
                }),
                createParagraphBlock({
                  paragraphId: 'paragraph-layout-orphan-target',
                  runId: 'run-layout-orphan-target',
                  text: '甲乙丙丁戊己庚辛壬癸',
                  properties: {
                    orphanLines: 2,
                    widowLines: 2
                  }
                })
              ]
            }
          ]
        }
      },
      createPageConfig({
        widthTwips: 640,
        heightTwips: 1440,
        marginTwips: {
          top: 120,
          right: 120,
          bottom: 120,
          left: 120
        }
      })
    )
    const firstPageTargetLines = layout.pages[0]?.lines.filter((line) =>
      line.paragraphId === 'paragraph-layout-orphan-target'
    )
    const secondPageTargetLines = layout.pages[1]?.lines
      .filter((line) => line.paragraphId === 'paragraph-layout-orphan-target')

    expect(firstPageTargetLines).toEqual([])
    expect(secondPageTargetLines?.length).toBeGreaterThanOrEqual(2)
  })

  it('keeps at least two widow lines on the continued page by moving the previous line forward', () => {
    const layout = createLayout(
      createParagraphProjection({
        paragraphId: 'paragraph-layout-widow-target',
        runId: 'run-layout-widow-target',
        text: '甲乙丙丁戊己庚辛壬',
        properties: {
          widowControl: true,
          orphanLines: 2,
          widowLines: 2
        }
      }),
      createPageConfig({
        widthTwips: 640,
        heightTwips: 1440,
        marginTwips: {
          top: 120,
          right: 120,
          bottom: 120,
          left: 120
        }
      })
    )
    const secondPageText = layout.pages[1]?.lines
    const thirdPageText = layout.pages[2]?.lines

    expect(secondPageText).toHaveLength(3)
    expect(thirdPageText).toHaveLength(2)
  })

  it('keeps table cell line breaks, inline images and cell block page lookup visible', () => {
    const layout = createLayout(
      {
        document: {
          kind: 'document',
          id: 'document-layout-table-cell-inline',
          resources: [
            {
              kind: 'resource',
              id: 'image-layout-table-cell',
              mime: 'image/png',
              status: 'success',
              source: {
                kind: 'dataUrl',
                url: 'data:image/png;base64,AAAA'
              }
            }
          ],
          sections: [
            {
              kind: 'section',
              id: 'section-layout-table-cell-inline',
              blocks: [
                {
                  kind: 'table',
                  id: 'table-layout-cell-inline',
                  grid: [2400],
                  rows: [
                    {
                      id: 'row-layout-cell-inline',
                      cells: [
                        {
                          id: 'cell-layout-cell-inline',
                          blocks: [
                            createParagraphBlockWithInlines({
                              paragraphId: 'paragraph-layout-cell-inline',
                              runId: 'run-layout-cell-inline',
                              inlines: [
                                {
                                  kind: 'text',
                                  text: 'A'
                                },
                                {
                                  kind: 'break',
                                  breakType: 'line'
                                },
                                {
                                  kind: 'image',
                                  resourceId: 'image-layout-table-cell',
                                  widthTwips: 480,
                                  heightTwips: 320
                                },
                                {
                                  kind: 'text',
                                  text: 'B'
                                }
                              ]
                            })
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
      },
      createPageConfig({
        widthTwips: 6000,
        heightTwips: 4000,
        marginTwips: {
          top: 120,
          right: 120,
          bottom: 120,
          left: 120
        }
      })
    )
    const table = layout.pages[0]?.blocks.find((block) => block.kind === 'table')
    const cell = table?.kind === 'table' ? table.rows[0]?.cells[0] : undefined
    const cellInlines = cell?.inlines.filter((inline) => inline.kind === 'inlineObject') ?? []
    const firstFragment = cell?.fragments.find((fragment) => fragment.text === 'A')
    const lastFragment = cell?.fragments.find((fragment) => fragment.text === 'B')

    expect(cell?.fragments.map((fragment) => fragment.text)).toEqual(['A', 'B'])
    expect(lastFragment?.y).toBeGreaterThan(firstFragment?.y ?? 0)
    expect(cellInlines.map((inline) => inline.inlineKind)).toEqual(['image'])
    expect(cellInlines[0]?.blockId).toBe('paragraph-layout-cell-inline')
    expect(findBlockPageIndexes(layout, 'paragraph-layout-cell-inline')).toEqual([0])
  })

  it('moves page-tail inline images into the next page instead of overflowing', () => {
    const layout = createLayout(
      {
        document: {
          kind: 'document',
          id: 'document-layout-inline-image-page-fit',
          resources: [
            {
              kind: 'resource',
              id: 'image-layout-page-fit',
              mime: 'image/png',
              status: 'success',
              source: {
                kind: 'dataUrl',
                url: 'data:image/png;base64,AAAA'
              }
            }
          ],
          sections: [
            {
              kind: 'section',
              id: 'section-layout-inline-image-page-fit',
              blocks: [
                createParagraphBlock({
                  paragraphId: 'paragraph-layout-before-image',
                  runId: 'run-layout-before-image',
                  text: '上',
                  properties: {
                    spacingAfterTwips: 240
                  }
                }),
                createParagraphBlockWithInlines({
                  paragraphId: 'paragraph-layout-page-fit-image',
                  runId: 'run-layout-page-fit-image',
                  inlines: [
                    {
                      kind: 'image',
                      resourceId: 'image-layout-page-fit',
                      widthTwips: 480,
                      heightTwips: 300
                    }
                  ]
                })
              ]
            }
          ]
        }
      },
      createPageConfig({
        orientation: 'landscape',
        widthTwips: 6000,
        heightTwips: 720,
        marginTwips: {
          top: 120,
          right: 120,
          bottom: 120,
          left: 120
        }
      })
    )
    const imageInline = layout.pages
      .flatMap((page) => page.lines)
      .flatMap((line) => line.inlines)
      .find((inline) => inline.kind === 'inlineObject' && inline.inlineKind === 'image')

    expect(imageInline?.pageIndex).toBe(1)
    expect(imageInline?.y).toBe(layout.pages[1]?.contentRect.y)
  })
})

/** 创建使用统一字体管理器的布局，保持断言稳定。 */
function createLayout(projection: DocumentProjection, pageConfig: PageConfig): DocumentLayout {
  return layoutDocument({
    projection,
    pageConfig,
    fontManager: createFontManager({
      fallbackFontFamily: 'Arial',
      availableFontFamilies: ['Arial']
    })
  })
}

/** 创建单段落投影。 */
function createParagraphProjection(input: Readonly<{
  paragraphId: string
  runId: string
  text: string
  properties?: ModelProperties
}>): DocumentProjection {
  return {
    document: {
      kind: 'document',
      id: `document-${input.paragraphId}`,
      sections: [
        {
          kind: 'section',
          id: `section-${input.paragraphId}`,
          blocks: [createParagraphBlock(input)]
        }
      ]
    }
  }
}

/** 创建段落块。 */
function createParagraphBlock(input: Readonly<{
  paragraphId: string
  runId: string
  text: string
  properties?: ModelProperties
}>): Block {
  return {
    kind: 'paragraph',
    id: input.paragraphId,
    ...(input.properties === undefined ? {} : { properties: input.properties }),
    runs: [
      {
        kind: 'run',
        id: input.runId,
        inlines: [
          {
            kind: 'text',
            text: input.text
          }
        ]
      }
    ]
  }
}

/** 创建带自定义 inline 的段落块。 */
function createParagraphBlockWithInlines(input: Readonly<{
  paragraphId: string
  runId: string
  inlines: readonly Inline[]
  properties?: ModelProperties
}>): Block {
  return {
    kind: 'paragraph',
    id: input.paragraphId,
    ...(input.properties === undefined ? {} : { properties: input.properties }),
    runs: [
      {
        kind: 'run',
        id: input.runId,
        inlines: input.inlines
      }
    ]
  }
}

/** 创建固定高度的测试表格行。 */
function createRows(count: number, heightTwips: number): readonly TableRow[] {
  return Object.freeze(Array.from({ length: count }, (_, index) => Object.freeze({
    id: `row-layout-split-${index + 1}`,
    properties: {
      heightTwips
    },
    cells: Object.freeze([
      {
        id: `cell-layout-split-${index + 1}`,
        blocks: Object.freeze([])
      }
    ])
  })))
}
