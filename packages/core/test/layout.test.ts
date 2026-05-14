/**
 * @vitest-environment node
 *
 * 职责：验证 Gate 2 布局 输入输出、字素感知 断行、分页、run 样式和调试边界数据。
 * 边界：只测试纯 文档投影到布局盒 的派生，不覆盖 画布渲染器、DOM 或调度器。
 * 协作模块：renderer、PDF、命中测试和矩形映射 后续只消费 布局盒。
 * 约束：layout 不读取 Y.Doc，不访问 DOM，不实现单长 canvas。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/03-architecture.md#36-layout-engine。
 */

import { describe, expect, it } from 'vitest'

import { createFontManager } from '../src/font-manager'
import { layoutDocument, layoutDocumentIncrementally } from '../src/layout'
import { createPageConfig } from '../src/page-config'
import type { DocumentProjection } from '../src/projection'
import type { LayoutInput, DocumentLayout } from '../src/layout'
import type { FontManager } from '../src/font-manager'

describe('Gate 2 布局', () => {
  it('creates paged layout boxes from DocumentProjection without reading writable state', () => {
    const projection = createProjection('你好 A😊 e\u0301 word wrap')
    const layout = layoutDocument({
      projection,
      pageConfig: createPageConfig({
        widthTwips: 2600,
        heightTwips: 500,
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

    const fragments = layout.pages.flatMap((page) =>
      page.lines.flatMap((line) => line.fragments)
    )

    expect(layout.pages.length).toBeGreaterThan(1)
    expect(layout.input.projection).toBe(projection)
    expect(fragments.map((fragment) => fragment.text).join('')).toBe('你好 A😊 e\u0301 word wrap')
    expect(fragments.some((fragment) => fragment.text === '😊')).toBe(true)
    expect(fragments.every((fragment) => fragment.start.graphemeIndex < fragment.end.graphemeIndex)).toBe(true)
  })

  it('honors inline page breaks and preserves run style on fragments', () => {
    const projection: DocumentProjection = {
      document: {
        kind: 'document',
        id: 'document-layout-break',
        sections: [
          {
            kind: 'section',
            id: 'section-layout-break',
            blocks: [
              {
                kind: 'paragraph',
                id: 'paragraph-layout-break',
                runs: [
                  {
                    kind: 'run',
                    id: 'run-before',
                    properties: {
                      fontFamily: 'Inter',
                      fontSizePx: 18,
                      bold: true,
                      color: '#123456',
                      lineHeight: 1.4
                    },
                    inlines: [
                      {
                        kind: 'text',
                        text: '第一页'
                      },
                      {
                        kind: 'break',
                        breakType: 'page'
                      },
                      {
                        kind: 'text',
                        text: '第二页'
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
    const layout = layoutDocument({
      projection,
      pageConfig: createPageConfig(),
      fontManager: createFontManager({
        fallbackFontFamily: 'Arial',
        availableFontFamilies: ['Arial', 'Inter']
      })
    })
    const fragments = layout.pages.flatMap((page) =>
      page.lines.flatMap((line) => line.fragments)
    )

    expect(layout.pages).toHaveLength(2)
    expect(fragments[0]?.pageIndex).toBe(0)
    expect(fragments.find((fragment) => fragment.start.graphemeIndex === 3)?.pageIndex).toBe(1)
    expect(fragments[0]?.style).toMatchObject({
      fontFamily: 'Inter',
      fontSizePx: 18,
      bold: true,
      color: '#123456',
      lineHeight: 1.4
    })
  })

  it('stores resolved fallback font on fragments when requested font is unavailable', () => {
    const projection: DocumentProjection = {
      document: {
        kind: 'document',
        id: 'document-layout-fallback-font',
        sections: [
          {
            kind: 'section',
            id: 'section-layout-fallback-font',
            blocks: [
              {
                kind: 'paragraph',
                id: 'paragraph-layout-fallback-font',
                runs: [
                  {
                    kind: 'run',
                    id: 'run-layout-fallback-font',
                    properties: {
                      fontFamily: 'Missing Corp Sans',
                      fontSizePx: 16,
                      italic: true,
                      color: '#445566'
                    },
                    inlines: [
                      {
                        kind: 'text',
                        text: 'A'
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
    const layout = layoutDocument({
      projection,
      pageConfig: createPageConfig(),
      fontManager: createFontManager({
        fallbackFontFamily: 'Arial',
        availableFontFamilies: ['Arial']
      })
    })
    const fragment = layout.pages[0]?.lines[0]?.fragments[0]

    expect(fragment?.style).toMatchObject({
      fontFamily: 'Arial',
      requestedFontFamily: 'Missing Corp Sans',
      status: 'missing',
      fontSizePx: 16,
      italic: true,
      color: '#445566'
    })
  })

  it('keeps section page and header footer boundary on laid out page boxes', () => {
    const layout = layoutDocument({
      projection: {
        document: {
          kind: 'document',
          id: 'document-layout-section-boundary',
          sections: [
            {
              kind: 'section',
              id: 'section-layout-section-boundary',
              page: {
                widthTwips: 12240,
                heightTwips: 15840,
                marginTwips: {
                  top: 1440,
                  right: 1200,
                  bottom: 1440,
                  left: 1200
                }
              },
              headerIds: ['header-1'],
              footerIds: ['footer-1'],
              blocks: [
                {
                  kind: 'paragraph',
                  id: 'paragraph-layout-section-boundary',
                  runs: [
                    {
                      kind: 'run',
                      id: 'run-layout-section-boundary',
                      inlines: [
                        {
                          kind: 'text',
                          text: 'section boundary'
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
    const page = layout.pages[0]

    expect(page).toMatchObject({
      sectionBoundary: 'single',
      sectionIds: ['section-layout-section-boundary'],
      sectionId: 'section-layout-section-boundary',
      pageLayout: {
        widthTwips: 12240,
        heightTwips: 15840,
        marginTwips: {
          top: 1440,
          right: 1200,
          bottom: 1440,
          left: 1200
        }
      },
      headerIds: ['header-1'],
      footerIds: ['footer-1']
    })
  })

  it('marks a page as mixed when multiple sections share the same page instead of pretending the first section still owns it', () => {
    const layout = layoutDocument({
      projection: {
        document: {
          kind: 'document',
          id: 'document-layout-mixed-section-boundary',
          sections: [
            {
              kind: 'section',
              id: 'section-layout-mixed-section-boundary-1',
              page: {
                widthTwips: 12000
              },
              headerIds: ['header-a'],
              footerIds: ['footer-a'],
              blocks: [
                {
                  kind: 'paragraph',
                  id: 'paragraph-layout-mixed-section-boundary-1',
                  runs: [
                    {
                      kind: 'run',
                      id: 'run-layout-mixed-section-boundary-1',
                      inlines: [
                        {
                          kind: 'text',
                          text: 'section one'
                        }
                      ]
                    }
                  ]
                }
              ]
            },
            {
              kind: 'section',
              id: 'section-layout-mixed-section-boundary-2',
              page: {
                widthTwips: 14000
              },
              headerIds: ['header-b'],
              footerIds: ['footer-b'],
              blocks: [
                {
                  kind: 'paragraph',
                  id: 'paragraph-layout-mixed-section-boundary-2',
                  runs: [
                    {
                      kind: 'run',
                      id: 'run-layout-mixed-section-boundary-2',
                      inlines: [
                        {
                          kind: 'text',
                          text: 'section two'
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

    expect(page?.sectionBoundary).toBe('mixed')
    expect(page?.sectionIds).toEqual([
      'section-layout-mixed-section-boundary-1',
      'section-layout-mixed-section-boundary-2'
    ])
    expect(page?.sectionId).toBeUndefined()
    expect(page?.pageLayout).toBeUndefined()
    expect(page?.headerIds).toEqual([])
    expect(page?.footerIds).toEqual([])
  })

  it('moves an overflowing table onto a real next page and keeps that page tied to the owning section boundary', () => {
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
    const secondPageTable = secondPage?.blocks.find((block) => block.kind === 'table')

    expect(layout.pages).toHaveLength(2)
    expect(firstPage?.blocks.map((block) => block.kind)).toEqual(['paragraph'])
    expect(secondPageTable).toMatchObject({
      kind: 'table',
      pageIndex: 1,
      sectionId: 'section-layout-table-overflow',
      tableId: 'table-layout-overflow'
    })
    expect(secondPage).toMatchObject({
      sectionBoundary: 'single',
      sectionIds: ['section-layout-table-overflow'],
      sectionId: 'section-layout-table-overflow',
      pageLayout: {
        widthTwips: 12240
      },
      headerIds: ['header-table'],
      footerIds: ['footer-table']
    })
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
        {
          rowId: 'row-layout-boundary-1',
          cells: [
            {
              cellId: 'cell-layout-boundary-1',
              gridSpan: 1,
              blockIds: ['cell-layout-paragraph-1']
            },
            {
              cellId: 'cell-layout-boundary-2',
              gridSpan: 2,
              blockIds: []
            }
          ]
        }
      ]
    }))
  })

  it('emits explicit inline object boxes for non-text inline structure', () => {
    const layout = layoutDocument({
      projection: {
        document: {
          kind: 'document',
          id: 'document-layout-inline-boundary',
          sections: [
            {
              kind: 'section',
              id: 'section-layout-inline-boundary',
              blocks: [
                {
                  kind: 'paragraph',
                  id: 'paragraph-layout-inline-boundary',
                  runs: [
                    {
                      kind: 'run',
                      id: 'run-layout-inline-boundary',
                      inlines: [
                        {
                          kind: 'bookmark',
                          id: 'bookmark-1',
                          name: 'bookmark',
                          edge: 'start'
                        },
                        {
                          kind: 'image',
                          resourceId: 'image-1',
                          alt: 'cover'
                        },
                        {
                          kind: 'commentRangeMarker',
                          commentId: 'comment-1',
                          edge: 'start'
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
    const inlines = layout.pages[0]?.lines[0]?.inlines

    expect(inlines?.map((inline) => inline.kind)).toEqual([
      'inlineObject',
      'inlineObject',
      'inlineObject'
    ])
    expect(inlines?.map((inline) => inline.kind === 'inlineObject' ? inline.inlineKind : inline.kind)).toEqual([
      'bookmark',
      'image',
      'commentRangeMarker'
    ])
    expect(inlines?.map((inline) => inline.kind === 'inlineObject' ? inline.payload : undefined)).toEqual([
      {
        id: 'bookmark-1',
        name: 'bookmark',
        edge: 'start'
      },
      {
        resourceId: 'image-1',
        alt: 'cover'
      },
      {
        commentId: 'comment-1',
        edge: 'start'
      }
    ])
  })

  it('freezes paragraph blocks once and reuses the same frozen object in paragraphs and blocks', () => {
    const layout = layoutDocument({
      projection: createProjection('paragraph freeze'),
      pageConfig: createPageConfig(),
      fontManager: createFontManager({
        fallbackFontFamily: 'Arial',
        availableFontFamilies: ['Arial']
      })
    })
    const paragraph = layout.pages[0]?.paragraphs[0]
    const block = layout.pages[0]?.blocks[0]

    expect(block).toBe(paragraph)
    expect(Object.isFrozen(block)).toBe(true)
  })

  it('returns debug overlay boxes for page, line and fragment boundaries', () => {
    const layout = layoutDocument({
      projection: createProjection('debug'),
      pageConfig: createPageConfig(),
      fontManager: createFontManager({
        fallbackFontFamily: 'Arial',
        availableFontFamilies: ['Arial']
      })
    })

    expect(layout.debugOverlay.boxes.map((box) => box.kind)).toContain('page')
    expect(layout.debugOverlay.boxes.map((box) => box.kind)).toContain('line')
    expect(layout.debugOverlay.boxes.map((box) => box.kind)).toContain('fragment')
  })

  it('reuses unchanged suffix pages once later page starts are stable', () => {
    const pageConfig = createPageConfig({
      widthTwips: 6000,
      heightTwips: 560,
      marginTwips: {
        top: 120,
        right: 120,
        bottom: 120,
        left: 120
      }
    })
    const fontManager = createFontManager({
      fallbackFontFamily: 'Arial',
      availableFontFamilies: ['Arial']
    })
    const previousLayout = layoutDocument({
      projection: createThreePageBreakProjection('Alpha', 'Bravo', 'Charlie'),
      pageConfig,
      fontManager
    })
    const nextInput: LayoutInput & {
      readonly previousLayout: DocumentLayout
    } = {
      projection: createThreePageBreakProjection('Alpha updated', 'Bravo', 'Charlie'),
      pageConfig,
      fontManager,
      dirtyRange: {
        anchor: {
          sectionId: 'section-layout-break-reuse',
          blockId: 'paragraph-layout-break-reuse-1',
          runId: 'run-layout-break-reuse-1',
          graphemeIndex: 0
        },
        focus: {
          sectionId: 'section-layout-break-reuse',
          blockId: 'paragraph-layout-break-reuse-1',
          runId: 'run-layout-break-reuse-1',
          graphemeIndex: 0
        }
      },
      previousLayout
    }

    const nextLayout = layoutDocument(nextInput)

    expect(nextLayout.pages[1]).toBe(previousLayout.pages[1])
    expect(nextLayout.pages[2]).toBe(previousLayout.pages[2])
  })

  it('reuses unchanged suffix pages when equal page config and font manager come from new instances', () => {
    const previousPageConfig = createPageConfig({
      widthTwips: 6000,
      heightTwips: 560,
      marginTwips: {
        top: 120,
        right: 120,
        bottom: 120,
        left: 120
      }
    })
    const previousFontManager = createFontManager({
      fallbackFontFamily: 'Arial',
      availableFontFamilies: ['Arial']
    })
    const previousLayout = layoutDocument({
      projection: createThreePageBreakProjection('Alpha', 'Bravo', 'Charlie'),
      pageConfig: previousPageConfig,
      fontManager: previousFontManager
    })

    const nextLayout = layoutDocument({
      projection: createThreePageBreakProjection('Alpha updated', 'Bravo', 'Charlie'),
      pageConfig: createPageConfig({
        widthTwips: 6000,
        heightTwips: 560,
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
      }),
      dirtyRange: {
        anchor: {
          sectionId: 'section-layout-break-reuse',
          blockId: 'paragraph-layout-break-reuse-1',
          runId: 'run-layout-break-reuse-1',
          graphemeIndex: 0
        },
        focus: {
          sectionId: 'section-layout-break-reuse',
          blockId: 'paragraph-layout-break-reuse-1',
          runId: 'run-layout-break-reuse-1',
          graphemeIndex: 0
        }
      },
      previousLayout
    })

    expect(nextLayout.pages[1]).toBe(previousLayout.pages[1])
    expect(nextLayout.pages[2]).toBe(previousLayout.pages[2])
  })

  it('reuses unchanged prefix pages when dirty range starts on a later page', () => {
    const pageConfig = createPageConfig({
      widthTwips: 6000,
      heightTwips: 560,
      marginTwips: {
        top: 120,
        right: 120,
        bottom: 120,
        left: 120
      }
    })
    const fontManager = createFontManager({
      fallbackFontFamily: 'Arial',
      availableFontFamilies: ['Arial']
    })
    const previousLayout = layoutDocument({
      projection: createExplicitThreePageProjection('Alpha', 'Bravo', 'Charlie'),
      pageConfig,
      fontManager
    })
    const nextInput: LayoutInput & {
      readonly previousLayout: DocumentLayout
    } = {
      projection: createExplicitThreePageProjection('Alpha', 'Bravo', 'Charlie updated'),
      pageConfig,
      fontManager,
      dirtyRange: {
        anchor: {
          sectionId: 'section-layout-explicit-break',
          blockId: 'paragraph-layout-explicit-break-3',
          runId: 'run-layout-explicit-break-3',
          graphemeIndex: 0
        },
        focus: {
          sectionId: 'section-layout-explicit-break',
          blockId: 'paragraph-layout-explicit-break-3',
          runId: 'run-layout-explicit-break-3',
          graphemeIndex: 0
        }
      },
      previousLayout
    }

    const nextLayout = layoutDocument(nextInput)

    expect(nextLayout.pages[0]).toBe(previousLayout.pages[0])
    expect(nextLayout.pages[1]).toBe(previousLayout.pages[1])
  })

  it('reuses unchanged prefix pages when equal page config and font manager come from new instances', () => {
    const previousPageConfig = createPageConfig({
      widthTwips: 6000,
      heightTwips: 560,
      marginTwips: {
        top: 120,
        right: 120,
        bottom: 120,
        left: 120
      }
    })
    const previousFontManager = createFontManager({
      fallbackFontFamily: 'Arial',
      availableFontFamilies: ['Arial']
    })
    const previousLayout = layoutDocument({
      projection: createExplicitThreePageProjection('Alpha', 'Bravo', 'Charlie'),
      pageConfig: previousPageConfig,
      fontManager: previousFontManager
    })

    const nextLayout = layoutDocument({
      projection: createExplicitThreePageProjection('Alpha', 'Bravo', 'Charlie updated'),
      pageConfig: createPageConfig({
        widthTwips: 6000,
        heightTwips: 560,
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
      }),
      dirtyRange: {
        anchor: {
          sectionId: 'section-layout-explicit-break',
          blockId: 'paragraph-layout-explicit-break-3',
          runId: 'run-layout-explicit-break-3',
          graphemeIndex: 0
        },
        focus: {
          sectionId: 'section-layout-explicit-break',
          blockId: 'paragraph-layout-explicit-break-3',
          runId: 'run-layout-explicit-break-3',
          graphemeIndex: 0
        }
      },
      previousLayout
    })

    expect(nextLayout.pages[0]).toBe(previousLayout.pages[0])
    expect(nextLayout.pages[1]).toBe(previousLayout.pages[1])
  })

  it('consumes dirtyPageIndex and skips measuring unchanged prefix pages', () => {
    const pageConfig = createPageConfig()
    const fontManager = createCountingFontManager()
    const previousLayout = layoutDocument({
      projection: createExplicitThreePageProjection('甲甲', '乙乙', '丙丙'),
      pageConfig,
      fontManager
    })

    fontManager.resetMeasurements()

    const nextLayout = layoutDocument({
      projection: createExplicitThreePageProjection('甲甲', '乙乙', '丙丙新'),
      pageConfig,
      fontManager,
      previousLayout,
      dirtyPageIndex: 2
    })

    expect(nextLayout.pages[0]).toBe(previousLayout.pages[0])
    expect(nextLayout.pages[1]).toBe(previousLayout.pages[1])
    expect(fontManager.measuredTexts).not.toContain('甲')
    expect(fontManager.measuredTexts).not.toContain('乙')
  })

  it('stops after the dirty page once the next page start stays stable', () => {
    const pageConfig = createPageConfig()
    const fontManager = createCountingFontManager()
    const previousLayout = layoutDocument({
      projection: createExplicitThreePageProjection('甲甲', '乙乙', '丙丙'),
      pageConfig,
      fontManager
    })

    fontManager.resetMeasurements()

    const nextLayout = layoutDocument({
      projection: createExplicitThreePageProjection('甲甲新', '乙乙', '丙丙'),
      pageConfig,
      fontManager,
      previousLayout,
      dirtyPageIndex: 0,
      dirtyRange: {
        anchor: {
          sectionId: 'section-layout-explicit-break',
          blockId: 'paragraph-layout-explicit-break-1',
          runId: 'run-layout-explicit-break-1',
          graphemeIndex: 0
        },
        focus: {
          sectionId: 'section-layout-explicit-break',
          blockId: 'paragraph-layout-explicit-break-1',
          runId: 'run-layout-explicit-break-1',
          graphemeIndex: 0
        }
      }
    })

    expect(nextLayout.pages[1]).toBe(previousLayout.pages[1])
    expect(nextLayout.pages[2]).toBe(previousLayout.pages[2])
    expect(fontManager.measuredTexts).not.toContain('乙')
    expect(fontManager.measuredTexts).not.toContain('丙')
  })
  it('stops at the stable next page before maxPages continuation', () => {
    const pageConfig = createPageConfig()
    const fontManager = createFontManager({
      fallbackFontFamily: 'Arial',
      availableFontFamilies: ['Arial']
    })
    const previousLayout = layoutDocument({
      projection: createExplicitThreePageProjection('Alpha', 'Bravo', 'Charlie'),
      pageConfig,
      fontManager
    })

    const pass = layoutDocumentIncrementally({
      projection: createExplicitThreePageProjection('Alpha updated', 'Bravo', 'Charlie'),
      pageConfig,
      fontManager,
      previousLayout,
      dirtyRange: {
        anchor: {
          sectionId: 'section-layout-explicit-break',
          blockId: 'paragraph-layout-explicit-break-1',
          runId: 'run-layout-explicit-break-1',
          graphemeIndex: 0
        },
        focus: {
          sectionId: 'section-layout-explicit-break',
          blockId: 'paragraph-layout-explicit-break-1',
          runId: 'run-layout-explicit-break-1',
          graphemeIndex: 0
        }
      },
      maxPages: 1
    })

    expect(pass.laidOutPageIndexes).toEqual([0])
    expect(pass.continuation).toBeUndefined()
    expect(pass.stoppedAtPageIndex).toBe(1)
    expect(pass.layout.pages[1]).toBe(previousLayout.pages[1])
    expect(pass.layout.pages[2]).toBe(previousLayout.pages[2])
  })
})

function createProjection(text: string): DocumentProjection {
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
              kind: 'paragraph',
              id: 'paragraph-layout',
              runs: [
                {
                  kind: 'run',
                  id: 'run-layout',
                  properties: {
                    fontSizePx: 16
                  },
                  inlines: [
                    {
                      kind: 'text',
                      text
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

function createThreePageBreakProjection(
  firstPageText: string,
  secondPageText: string,
  thirdPageText: string
): DocumentProjection {
  return {
    document: {
      kind: 'document',
      id: 'document-layout-break-reuse',
      sections: [
        {
          kind: 'section',
          id: 'section-layout-break-reuse',
          blocks: [
            {
              kind: 'paragraph',
              id: 'paragraph-layout-break-reuse-1',
              runs: [
                {
                  kind: 'run',
                  id: 'run-layout-break-reuse-1',
                  properties: {
                    fontSizePx: 16
                  },
                  inlines: [
                    {
                      kind: 'text',
                      text: firstPageText
                    }
                  ]
                }
              ]
            },
            {
              kind: 'paragraph',
              id: 'paragraph-layout-break-reuse-2',
              runs: [
                {
                  kind: 'run',
                  id: 'run-layout-break-reuse-2',
                  properties: {
                    fontSizePx: 16
                  },
                  inlines: [
                    {
                      kind: 'text',
                      text: secondPageText
                    }
                  ]
                }
              ]
            },
            {
              kind: 'paragraph',
              id: 'paragraph-layout-break-reuse-3',
              runs: [
                {
                  kind: 'run',
                  id: 'run-layout-break-reuse-3',
                  properties: {
                    fontSizePx: 16
                  },
                  inlines: [
                    {
                      kind: 'text',
                      text: thirdPageText
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

function createExplicitThreePageProjection(
  firstPageText: string,
  secondPageText: string,
  thirdPageText: string
): DocumentProjection {
  return {
    document: {
      kind: 'document',
      id: 'document-layout-explicit-break',
      sections: [
        {
          kind: 'section',
          id: 'section-layout-explicit-break',
          blocks: [
            {
              kind: 'paragraph',
              id: 'paragraph-layout-explicit-break-1',
              runs: [
                {
                  kind: 'run',
                  id: 'run-layout-explicit-break-1',
                  properties: {
                    fontSizePx: 16
                  },
                  inlines: [
                    {
                      kind: 'text',
                      text: firstPageText
                    },
                    {
                      kind: 'break',
                      breakType: 'page'
                    }
                  ]
                }
              ]
            },
            {
              kind: 'paragraph',
              id: 'paragraph-layout-explicit-break-2',
              runs: [
                {
                  kind: 'run',
                  id: 'run-layout-explicit-break-2',
                  properties: {
                    fontSizePx: 16
                  },
                  inlines: [
                    {
                      kind: 'text',
                      text: secondPageText
                    },
                    {
                      kind: 'break',
                      breakType: 'page'
                    }
                  ]
                }
              ]
            },
            {
              kind: 'paragraph',
              id: 'paragraph-layout-explicit-break-3',
              runs: [
                {
                  kind: 'run',
                  id: 'run-layout-explicit-break-3',
                  properties: {
                    fontSizePx: 16
                  },
                  inlines: [
                    {
                      kind: 'text',
                      text: thirdPageText
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

function createCountingFontManager(): FontManager & {
  readonly measuredTexts: string[]
  resetMeasurements(): void
} {
  const base = createFontManager({
    fallbackFontFamily: 'Arial',
    availableFontFamilies: ['Arial']
  })
  const measuredTexts: string[] = []

  return {
    ...base,
    measuredTexts,
    measureText(text, style) {
      measuredTexts.push(text)
      return base.measureText(text, style)
    },
    resetMeasurements() {
      measuredTexts.length = 0
    }
  }
}
