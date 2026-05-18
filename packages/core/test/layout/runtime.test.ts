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

import { createFontManager } from '../../src/layout/font-manager'
import { layoutDocument, layoutDocumentIncrementally } from '../../src/layout/runtime'
import { createPageConfig, cssPxToTwips } from '../../src/layout/page-config'
import type { DocumentProjection } from '../../src/model/projection'
import type { LayoutInput, DocumentLayout } from '../../src/layout/runtime'
import type { FontManager } from '../../src/layout/font-manager'

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

  it('keeps latin words as contiguous fragments for natural canvas text rendering', () => {
    const layout = layoutDocument({
      projection: createProjection('JWord2026'),
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
    const fragments = layout.pages.flatMap((page) =>
      page.lines.flatMap((line) => line.fragments)
    )

    expect(fragments).toHaveLength(1)
    expect(fragments[0]?.text).toBe('JWord2026')
    expect(fragments[0]?.advanceTwips).toHaveLength(10)
    expect(fragments[0]?.end.graphemeIndex).toBe(9)
  })

  it('uses the current line tail before wrapping a latin word that only overflows the remaining width', () => {
    const word = findLatinWordThatFitsOnFreshLine()
    const text = `前缀 ${word}`
    const layout = layoutDocument({
      projection: createProjection(text),
      pageConfig: createLatinWrapPageConfig(),
      fontManager: createLatinWrapFontManager()
    })
    const firstLineText = readLineText(layout, 0, 0)
    const secondLineText = readLineText(layout, 0, 1)

    expect(layout.pages[0]?.lines.length).toBeGreaterThan(1)
    expect(firstLineText).toContain('前缀 ')
    expect(firstLineText).not.toBe('前缀 ')
    expect(firstLineText?.endsWith('h')).toBe(true)
    expect(secondLineText?.startsWith('h')).toBe(true)
    expect(`${firstLineText ?? ''}${secondLineText ?? ''}`).toBe(text)
  })

  it('keeps a latin word on the next line when whole-word wrap is enabled', () => {
    const word = findLatinWordThatFitsOnFreshLine()
    const layout = layoutDocument({
      projection: createProjection(`前缀 ${word}`),
      pageConfig: createLatinWrapPageConfig(),
      fontManager: createLatinWrapFontManager(),
      layoutOptions: {
        keepLatinWordWholeOnWrap: true
      }
    })
    const firstLineText = readLineText(layout, 0, 0)
    const secondLineText = readLineText(layout, 0, 1)

    expect(layout.pages[0]?.lines.length).toBeGreaterThan(1)
    expect(firstLineText).toBe('前缀 ')
    expect(secondLineText).toBe(word)
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

  it('reduces visual font size for superscript and subscript while preserving their flags', () => {
    const projection: DocumentProjection = {
      document: {
        kind: 'document',
        id: 'document-layout-script',
        sections: [
          {
            kind: 'section',
            id: 'section-layout-script',
            blocks: [
              {
                kind: 'paragraph',
                id: 'paragraph-layout-script',
                runs: [
                  {
                    kind: 'run',
                    id: 'run-layout-superscript',
                    properties: {
                      fontSizePx: 16,
                      superscript: true
                    },
                    inlines: [
                      {
                        kind: 'text',
                        text: '上'
                      }
                    ]
                  },
                  {
                    kind: 'run',
                    id: 'run-layout-subscript',
                    properties: {
                      fontSizePx: 16,
                      subscript: true
                    },
                    inlines: [
                      {
                        kind: 'text',
                        text: '下'
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
    const fragments = layout.pages[0]?.lines[0]?.fragments ?? []
    const superscript = fragments.find((fragment) => fragment.runId === 'run-layout-superscript')
    const subscript = fragments.find((fragment) => fragment.runId === 'run-layout-subscript')

    expect(superscript?.style).toMatchObject({
      superscript: true,
      baseFontSizePx: 16
    })
    expect(subscript?.style).toMatchObject({
      subscript: true,
      baseFontSizePx: 16
    })
    expect(superscript?.style.subscript).not.toBe(true)
    expect(subscript?.style.superscript).not.toBe(true)
    expect(superscript?.style.fontSizePx).toBeLessThan(16)
    expect(subscript?.style.fontSizePx).toBeLessThan(16)
    expect(superscript?.height).toBe(cssPxToTwips(20))
    expect(subscript?.height).toBe(cssPxToTwips(20))
  })

  it('applies paragraph alignment and indent to line geometry', () => {
    const layout = layoutDocument({
      projection: {
        document: {
          kind: 'document',
          id: 'document-layout-paragraph-alignment',
          sections: [
            {
              kind: 'section',
              id: 'section-layout-paragraph-alignment',
              blocks: [
                {
                  kind: 'paragraph',
                  id: 'paragraph-layout-paragraph-alignment',
                  properties: {
                    alignment: 'right',
                    indentLeftTwips: 240
                  },
                  runs: [
                    {
                      kind: 'run',
                      id: 'run-layout-paragraph-alignment',
                      inlines: [
                        {
                          kind: 'text',
                          text: 'align'
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
    const page = layout.pages[0]!
    const paragraph = page.paragraphs[0]!
    const line = page.lines[0]!
    const fragment = line.fragments[0]!

    expect(paragraph.x).toBe(360)
    expect(line.x + line.width).toBe(page.contentRect.x + page.contentRect.width)
    expect(fragment.x).toBe(line.x)
  })

  it('applies paragraph spacing and first-line or hanging indents to flow geometry', () => {
    const layout = layoutDocument({
      projection: {
        document: {
          kind: 'document',
          id: 'document-layout-paragraph-spacing',
          sections: [
            {
              kind: 'section',
              id: 'section-layout-paragraph-spacing',
              blocks: [
                {
                  kind: 'paragraph',
                  id: 'paragraph-layout-paragraph-spacing-1',
                  properties: {
                    indentLeftTwips: 120,
                    spacingBeforeTwips: 120,
                    spacingAfterTwips: 180,
                    firstLineIndentTwips: 240,
                    hangingIndentTwips: 360
                  },
                  runs: [
                    {
                      kind: 'run',
                      id: 'run-layout-paragraph-spacing-1',
                      inlines: [
                        {
                          kind: 'text',
                          text: '一二三四五六七八九十一二三四五六'
                        }
                      ]
                    }
                  ]
                },
                {
                  kind: 'paragraph',
                  id: 'paragraph-layout-paragraph-spacing-2',
                  properties: {
                    spacingBeforeTwips: 60
                  },
                  runs: [
                    {
                      kind: 'run',
                      id: 'run-layout-paragraph-spacing-2',
                      inlines: [
                        {
                          kind: 'text',
                          text: '次段'
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
        widthTwips: 1800,
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
    const page = layout.pages[0]!
    const paragraphOne = page.paragraphs.find((paragraph) => paragraph.paragraphId === 'paragraph-layout-paragraph-spacing-1')
    const firstParagraphLines = page.lines.filter((line) => line.paragraphId === 'paragraph-layout-paragraph-spacing-1')
    const secondParagraphLine = page.lines.find((line) => line.paragraphId === 'paragraph-layout-paragraph-spacing-2')
    const lastFirstParagraphLine = firstParagraphLines[firstParagraphLines.length - 1]

    expect(firstParagraphLines.length).toBeGreaterThan(1)
    expect(paragraphOne?.x).toBe(240)
    expect(firstParagraphLines[0]?.y).toBe(page.contentRect.y + 120)
    expect(firstParagraphLines[0]?.x).toBe(480)
    expect(firstParagraphLines[1]?.x).toBe(600)
    expect(secondParagraphLine?.y).toBe(
      (lastFirstParagraphLine?.y ?? 0)
      + (lastFirstParagraphLine?.height ?? 0)
      + 180
      + 60
    )
  })

  it('applies Heading defaults to layout fragments and keeps explicit run props above those defaults', () => {
    const layout = layoutDocument({
      projection: {
        document: {
          kind: 'document',
          id: 'document-layout-heading-defaults',
          sections: [
            {
              kind: 'section',
              id: 'section-layout-heading-defaults',
              blocks: [
                {
                  kind: 'paragraph',
                  id: 'paragraph-layout-heading-defaults-1',
                  properties: {
                    styleId: 'Heading1'
                  },
                  runs: [
                    {
                      kind: 'run',
                      id: 'run-layout-heading-defaults-1',
                      inlines: [
                        {
                          kind: 'text',
                          text: '标题一'
                        }
                      ]
                    }
                  ]
                },
                {
                  kind: 'paragraph',
                  id: 'paragraph-layout-heading-defaults-2',
                  properties: {
                    styleId: 'Heading2'
                  },
                  runs: [
                    {
                      kind: 'run',
                      id: 'run-layout-heading-defaults-2',
                      properties: {
                        fontSizePx: 18,
                        bold: false
                      },
                      inlines: [
                        {
                          kind: 'text',
                          text: '显式覆盖'
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
    const headingOneFragment = layout.pages[0]?.lines.find((line) =>
      line.paragraphId === 'paragraph-layout-heading-defaults-1'
    )?.fragments[0]
    const headingTwoFragment = layout.pages[0]?.lines.find((line) =>
      line.paragraphId === 'paragraph-layout-heading-defaults-2'
    )?.fragments[0]

    expect(headingOneFragment?.style).toMatchObject({
      fontSizePx: 32,
      bold: true
    })
    expect(headingTwoFragment?.style).toMatchObject({
      fontSizePx: 18,
      bold: false
    })
  })

  it('derives visible ordered and bullet list markers with basic nested indent', () => {
    const layout = layoutDocument({
      projection: {
        document: {
          kind: 'document',
          id: 'document-layout-list-semantics',
          sections: [
            {
              kind: 'section',
              id: 'section-layout-list-semantics',
              blocks: [
                {
                  kind: 'paragraph',
                  id: 'paragraph-layout-list-semantics-1',
                  properties: {
                    listNumberingId: 'jword-list-ordered',
                    listLevel: 0
                  },
                  runs: [
                    {
                      kind: 'run',
                      id: 'run-layout-list-semantics-1',
                      inlines: [
                        {
                          kind: 'text',
                          text: '第一项'
                        }
                      ]
                    }
                  ]
                },
                {
                  kind: 'paragraph',
                  id: 'paragraph-layout-list-semantics-2',
                  properties: {
                    listNumberingId: 'jword-list-ordered',
                    listLevel: 0
                  },
                  runs: [
                    {
                      kind: 'run',
                      id: 'run-layout-list-semantics-2',
                      inlines: [
                        {
                          kind: 'text',
                          text: '第二项'
                        }
                      ]
                    }
                  ]
                },
                {
                  kind: 'paragraph',
                  id: 'paragraph-layout-list-semantics-3',
                  properties: {
                    listNumberingId: 'jword-list-bullet',
                    listLevel: 1
                  },
                  runs: [
                    {
                      kind: 'run',
                      id: 'run-layout-list-semantics-3',
                      inlines: [
                        {
                          kind: 'text',
                          text: '子项'
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
    const orderedParagraphOne = page?.paragraphs.find((paragraph) =>
      paragraph.paragraphId === 'paragraph-layout-list-semantics-1'
    )
    const orderedParagraphTwo = page?.paragraphs.find((paragraph) =>
      paragraph.paragraphId === 'paragraph-layout-list-semantics-2'
    )
    const bulletParagraph = page?.paragraphs.find((paragraph) =>
      paragraph.paragraphId === 'paragraph-layout-list-semantics-3'
    )
    const orderedLineOne = page?.lines.find((line) => line.paragraphId === 'paragraph-layout-list-semantics-1')
    const orderedLineTwo = page?.lines.find((line) => line.paragraphId === 'paragraph-layout-list-semantics-2')
    const bulletLine = page?.lines.find((line) => line.paragraphId === 'paragraph-layout-list-semantics-3')

    expect(orderedParagraphOne?.listMarker?.label).toBe('1.')
    expect(orderedParagraphTwo?.listMarker?.label).toBe('2.')
    expect(bulletParagraph?.listMarker?.label).toBe('◦')
    expect(orderedLineOne?.x).toBe(orderedLineTwo?.x)
    expect(bulletLine?.x).toBeGreaterThan(orderedLineOne?.x ?? 0)
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

/**
 * 为拉丁单词换行测试创建固定页宽。
 */
function createLatinWrapPageConfig() {
  return createPageConfig({
    widthTwips: 3600,
    heightTwips: 4000,
    marginTwips: {
      top: 120,
      right: 120,
      bottom: 120,
      left: 120
    }
  })
}

/**
 * 为拉丁单词换行测试创建固定字体度量器。
 */
function createLatinWrapFontManager() {
  return createFontManager({
    fallbackFontFamily: 'Arial',
    availableFontFamilies: ['Arial']
  })
}

/**
 * 读取指定行上的纯文本内容。
 */
function readLineText(layout: DocumentLayout, pageIndex: number, lineIndex: number) {
  return layout.pages[pageIndex]?.lines[lineIndex]?.fragments.map((fragment) => fragment.text).join('')
}

/**
 * 找到“单词单独占一行能放下，但跟在前缀后面会跨行”的最小样例。
 */
function findLatinWordThatFitsOnFreshLine() {
  for (let length = 2; length <= 48; length += 1) {
    const word = 'h'.repeat(length)
    const standaloneLayout = layoutDocument({
      projection: createProjection(word),
      pageConfig: createLatinWrapPageConfig(),
      fontManager: createLatinWrapFontManager()
    })
    const wrappedLayout = layoutDocument({
      projection: createProjection(`前缀 ${word}`),
      pageConfig: createLatinWrapPageConfig(),
      fontManager: createLatinWrapFontManager(),
      layoutOptions: {
        keepLatinWordWholeOnWrap: true
      }
    })

    if (
      standaloneLayout.pages[0]?.lines.length === 1
      && (wrappedLayout.pages[0]?.lines.length ?? 0) > 1
    ) {
      return word
    }
  }

  throw new Error('未找到可复现当前行剩余宽度换行的拉丁单词样例')
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
