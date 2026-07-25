/**
 * @vitest-environment node
 *
 * 职责：验证布局分页、分节边界和增量分页复用行为。
 * 边界：只测试 DocumentProjection 到分页布局盒的纯派生，不覆盖画布渲染器或 DOM 调度。
 * 协作模块：布局运行时、页面配置、字体管理器与共享测试辅助函数。
 * 性能/安全约束：测试不读取 Y.Doc，不访问 DOM，不放宽 Phase 5 文件拆分预算。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import { describe, expect, it } from 'vitest'

import { createFontManager } from '../../src/layout/font-manager'
import { layoutDocument, layoutDocumentIncrementally } from '../../src/layout/runtime'
import { createPageConfig } from '../../src/layout/page-config'
import {
  createCountingFontManager,
  createExplicitThreePageProjection,
  createProjection,
  createThreePageBreakProjection
} from './runtime-test-helpers'
import type { DocumentProjection } from '../../src/model/projection'
import type { DocumentLayout, LayoutInput } from '../../src/layout/runtime'

describe('Gate 2 布局分页', () => {
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


  it('resolves section breaks, inherited header footer ids and page numbering for downstream export', () => {
    const layout = layoutDocument({
      projection: {
        document: {
          kind: 'document',
          id: 'document-layout-section-page-numbering',
          sections: [
            {
              kind: 'section',
              id: 'section-layout-page-numbering-1',
              headerIds: ['header-a'],
              footerIds: ['footer-a'],
              pageNumbering: {
                mode: 'continue'
              },
              blocks: [
                {
                  kind: 'paragraph',
                  id: 'paragraph-layout-page-numbering-1',
                  runs: [
                    {
                      kind: 'run',
                      id: 'run-layout-page-numbering-1',
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
              id: 'section-layout-page-numbering-2',
              breakType: 'next-page',
              headerFooterSameAsPrevious: true,
              pageNumbering: {
                mode: 'restart',
                start: 7
              },
              blocks: [
                {
                  kind: 'paragraph',
                  id: 'paragraph-layout-page-numbering-2',
                  runs: [
                    {
                      kind: 'run',
                      id: 'run-layout-page-numbering-2',
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
        heightTwips: 2400,
        marginTwips: {
          top: 240,
          right: 240,
          bottom: 240,
          left: 240
        }
      }),
      fontManager: createFontManager({
        fallbackFontFamily: 'Arial',
        availableFontFamilies: ['Arial']
      })
    })
    const firstPage = layout.pages[0]
    const secondPage = layout.pages[1]

    expect(layout.pages).toHaveLength(2)
    expect(firstPage).toMatchObject({
      sectionBoundary: 'single',
      sectionId: 'section-layout-page-numbering-1',
      headerIds: ['header-a'],
      footerIds: ['footer-a'],
      pageNumber: 1,
      headerFooterBoxes: [
        expect.objectContaining({
          kind: 'headerFooter',
          role: 'header',
          sectionId: 'section-layout-page-numbering-1',
          sourceId: 'header-a',
          pageNumber: 1
        }),
        expect.objectContaining({
          kind: 'headerFooter',
          role: 'footer',
          sectionId: 'section-layout-page-numbering-1',
          sourceId: 'footer-a',
          pageNumber: 1
        })
      ]
    })
    expect(secondPage).toMatchObject({
      sectionBoundary: 'single',
      sectionId: 'section-layout-page-numbering-2',
      headerIds: ['header-a'],
      footerIds: ['footer-a'],
      pageNumber: 7,
      headerFooterBoxes: [
        expect.objectContaining({
          kind: 'headerFooter',
          role: 'header',
          sectionId: 'section-layout-page-numbering-2',
          sourceId: 'header-a',
          pageNumber: 7
        }),
        expect.objectContaining({
          kind: 'headerFooter',
          role: 'footer',
          sectionId: 'section-layout-page-numbering-2',
          sourceId: 'footer-a',
          pageNumber: 7
        })
      ]
    })
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
