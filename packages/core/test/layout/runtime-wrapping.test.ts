/**
 * @vitest-environment node
 *
 * 职责：验证布局换行、样式继承、列表标记和 inline object 派生。
 * 边界：只测试段落流布局输出，不覆盖分页增量复用、表格布局或调试 overlay。
 * 协作模块：布局运行时、字体管理器、页面配置与共享测试辅助函数。
 * 性能/安全约束：测试不访问 DOM，不修改文档状态，不夹带布局逻辑变更。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import { describe, expect, it } from 'vitest'

import { createFontManager } from '../../src/layout/font-manager'
import { layoutDocument } from '../../src/layout/runtime'
import { createPageConfig, cssPxToTwips } from '../../src/layout/page-config'
import {
  createLatinWrapFontManager,
  createLatinWrapPageConfig,
  createProjection,
  findLatinWordThatFitsOnFreshLine,
  readLineText
} from './runtime-test-helpers'
import type { DocumentProjection } from '../../src/model/projection'

describe('Gate 2 布局换行', () => {
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


  it('keeps ordered counters across non-list paragraphs and avoids substring bullet detection', () => {
    const layout = layoutDocument({
      projection: {
        document: {
          kind: 'document',
          id: 'document-layout-list-counter-continuity',
          sections: [
            {
              kind: 'section',
              id: 'section-layout-list-counter-continuity',
              blocks: [
                createListParagraph('paragraph-list-continuity-1', 'ordered-real', 0, '第一项'),
                createPlainParagraph('paragraph-list-continuity-plain', '中间说明'),
                createListParagraph('paragraph-list-continuity-2', 'ordered-real', 0, '第二项'),
                createListParagraph('paragraph-list-continuity-anti-bullet', 'anti-bullet-list', 0, '不是项目符号')
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
    const markerByParagraph = new Map(layout.pages[0]?.paragraphs.map((paragraph) => [
      paragraph.paragraphId,
      paragraph.listMarker
    ]))

    expect(markerByParagraph.get('paragraph-list-continuity-1')?.label).toBe('1.')
    expect(markerByParagraph.get('paragraph-list-continuity-2')?.label).toBe('2.')
    expect(markerByParagraph.get('paragraph-list-continuity-anti-bullet')?.kind).toBe('ordered')
    expect(markerByParagraph.get('paragraph-list-continuity-anti-bullet')?.label).toBe('1.')
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

})

/** 创建列表段落夹具。 */
function createListParagraph(id: string, numberingId: string, level: number, text: string): Extract<DocumentProjection['document']['sections'][number]['blocks'][number], { kind: 'paragraph' }> {
  return {
    kind: 'paragraph',
    id,
    properties: {
      listNumberingId: numberingId,
      listLevel: level
    },
    runs: [
      {
        kind: 'run',
        id: `${id}-run`,
        inlines: [{ kind: 'text', text }]
      }
    ]
  }
}

/** 创建普通段落夹具。 */
function createPlainParagraph(id: string, text: string): Extract<DocumentProjection['document']['sections'][number]['blocks'][number], { kind: 'paragraph' }> {
  return {
    kind: 'paragraph',
    id,
    runs: [
      {
        kind: 'run',
        id: `${id}-run`,
        inlines: [{ kind: 'text', text }]
      }
    ]
  }
}

