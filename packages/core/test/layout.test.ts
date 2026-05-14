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
