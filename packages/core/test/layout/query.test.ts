/**
 * @vitest-environment node
 *
 * 职责：验证 Gate 2 命中测试 与 TextPosition/范围形态 到 光标和选区矩形 的映射。
 * 边界：只测试 布局盒坐标索引，不创建 锚点引用，不读取 Y.Doc，不覆盖真实 pointer 事件。
 * 协作模块：编辑器工厂 后续可把 TextPosition 转成 锚点引用，渲染器后续消费 rect 绘制 caret/selection。
 * 约束：测试不访问 DOM，不依赖 Canvas，不实现输入系统。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/05-implementation-gates.md#gate-2---分页-layout-与-canvas-render。
 */

import { describe, expect, it } from 'vitest'

import { createFontManager } from '../../src/layout/font-manager'
import {
  getCaretRect,
  getSelectionRects,
  hitTestDocumentLayout,
  layoutDocument
} from '../../src/layout/runtime'
import type { Inline } from '../../src/model/types'
import { createPageConfig, cssPxToTwips } from '../../src/layout/page-config'
import type { DocumentProjection } from '../../src/model/projection'

describe('Gate 2 命中测试 and 矩形映射', () => {
  it('maps a page point to a TextPosition without requiring Y.Doc', () => {
    const layout = createSingleLineLayout()
    const fragment = layout.pages[0]?.lines[0]?.fragments[0]

    expect(fragment).toBeDefined()

    const position = hitTestDocumentLayout(layout, {
      pageIndex: 0,
      x: (fragment?.x ?? 0) + (fragment?.advanceTwips[1] ?? 0) + 1,
      y: (fragment?.y ?? 0) + 1
    })

    expect(position).toEqual({
      sectionId: 'section-hit',
      blockId: 'paragraph-hit',
      runId: 'run-hit',
      graphemeIndex: 1
    })
  })

  it('maps TextPosition and range-like values to caret and selection rects', () => {
    const layout = createSingleLineLayout()
    const fragment = layout.pages[0]?.lines[0]?.fragments[0]
    const caret = getCaretRect(layout, {
      sectionId: 'section-hit',
      blockId: 'paragraph-hit',
      runId: 'run-hit',
      graphemeIndex: 1
    })
    const rects = getSelectionRects(layout, {
      anchor: {
        sectionId: 'section-hit',
        blockId: 'paragraph-hit',
        runId: 'run-hit',
        graphemeIndex: 1
      },
      focus: {
        sectionId: 'section-hit',
        blockId: 'paragraph-hit',
        runId: 'run-hit',
        graphemeIndex: 4
      }
    })

    expect(layout.pages[0]?.lines[0]?.fragments).toHaveLength(1)
    expect(caret?.width).toBe(0)
    expect(caret?.height).toBeGreaterThan(0)
    expect(caret?.x).toBe((fragment?.x ?? 0) + (fragment?.advanceTwips[1] ?? 0))
    expect(rects).toHaveLength(1)
    expect(rects[0]?.width).toBeGreaterThan(0)
    expect(rects[0]?.x).toBe(caret?.x)
  })

  it('maps points inside a merged latin fragment to internal grapheme positions', () => {
    const layout = createSingleLineLayout()
    const fragment = layout.pages[0]?.lines[0]?.fragments[0]

    expect(fragment).toBeDefined()
    expect(fragment?.text).toBe('abcd')

    const position = hitTestDocumentLayout(layout, {
      pageIndex: 0,
      x: (fragment?.x ?? 0) + (fragment?.advanceTwips[2] ?? 0) + 1,
      y: (fragment?.y ?? 0) + 1
    })

    expect(position).toEqual({
      sectionId: 'section-hit',
      blockId: 'paragraph-hit',
      runId: 'run-hit',
      graphemeIndex: 2
    })
  })

  it('maps page-local points on later pages to the correct TextPosition', () => {
    const layout = layoutDocument({
      projection: createProjection('第一页', '第二页'),
      pageConfig: createPageConfig({
        widthTwips: 6000,
        heightTwips: 2400,
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
    const secondPageFragment = layout.pages[1]?.lines[0]?.fragments[0]

    expect(secondPageFragment).toBeDefined()

    const position = hitTestDocumentLayout(layout, {
      pageIndex: 1,
      x: (secondPageFragment?.x ?? 0) - (layout.pages[1]?.x ?? 0) + (secondPageFragment?.advanceTwips[1] ?? 0) + 1,
      y: (secondPageFragment?.y ?? 0) - (layout.pages[1]?.y ?? 0) + 1
    })

    expect(position).toEqual({
      sectionId: 'section-hit',
      blockId: 'paragraph-hit',
      runId: 'run-hit',
      graphemeIndex: 4
    })
  })

  it('falls back to the nearest line when clicking page whitespace above visible text', () => {
    const layout = createSingleLineLayout()
    const firstLine = layout.pages[0]?.lines[0]
    const fragment = firstLine?.fragments[0]

    expect(firstLine).toBeDefined()
    expect(fragment).toBeDefined()

    const position = hitTestDocumentLayout(layout, {
      pageIndex: 0,
      x: (fragment?.x ?? 0) - (layout.pages[0]?.x ?? 0) + (fragment?.advanceTwips[2] ?? 0) + 1,
      y: Math.max(0, ((firstLine?.y ?? 0) - (layout.pages[0]?.y ?? 0)) - 24)
    })

    expect(position).toEqual({
      sectionId: 'section-hit',
      blockId: 'paragraph-hit',
      runId: 'run-hit',
      graphemeIndex: 2
    })
  })

  it('keeps round-trip stable at shared boundary around an inline page break', () => {
    const layout = layoutDocument({
      projection: createProjection('第一页', '第二页'),
      pageConfig: createPageConfig({
        widthTwips: 6000,
        heightTwips: 2400,
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
    const firstPageTail = layout.pages[0]?.lines[0]?.fragments.at(-1)
    const secondPageHead = layout.pages[1]?.lines[0]?.fragments[0]

    expect(firstPageTail).toBeDefined()
    expect(secondPageHead).toBeDefined()

    const secondPagePosition = hitTestDocumentLayout(layout, {
      pageIndex: 1,
      x: ((secondPageHead?.x ?? 0) - (layout.pages[1]?.x ?? 0)) + 1,
      y: ((secondPageHead?.y ?? 0) - (layout.pages[1]?.y ?? 0)) + 1
    })
    const firstPagePosition = hitTestDocumentLayout(layout, {
      pageIndex: 0,
      x: ((firstPageTail?.x ?? 0) - (layout.pages[0]?.x ?? 0)) + (firstPageTail?.width ?? 0) - 1,
      y: ((firstPageTail?.y ?? 0) - (layout.pages[0]?.y ?? 0)) + 1
    })

    expect(getCaretRect(layout, secondPagePosition!)).toMatchObject({
      pageIndex: 1,
      x: secondPageHead?.x,
      y: secondPageHead?.y
    })
    expect(getCaretRect(layout, firstPagePosition!)).toMatchObject({
      pageIndex: 0,
      x: (firstPageTail?.x ?? 0) + (firstPageTail?.width ?? 0),
      y: firstPageTail?.y
    })
  })

  it('keeps image hit-test on the bitmap and routes right-side whitespace to the trailing text run', () => {
    const layout = layoutDocument({
      projection: createImageOnlyProjection(),
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
    const line = layout.pages[0]?.lines[0]
    const beforeInline = line?.inlines.find((inline) => inline.runId === 'run-before')
    const afterInline = line?.inlines.find((inline) => inline.runId === 'run-after')
    const imageInline = line?.inlines.find((inline) => inline.runId === 'run-image-only')

    expect(beforeInline).toBeDefined()
    expect(afterInline).toBeDefined()
    expect(imageInline).toBeDefined()
    expect(imageInline?.width).toBe(cssPxToTwips(48))
    expect(imageInline?.height).toBe(cssPxToTwips(32))

    const imagePosition = hitTestDocumentLayout(layout, {
      pageIndex: 0,
      x: ((imageInline?.x ?? 0) - (layout.pages[0]?.x ?? 0)) + ((imageInline?.width ?? 0) / 2),
      y: ((imageInline?.y ?? 0) - (layout.pages[0]?.y ?? 0)) + 1
    })
    const afterPosition = hitTestDocumentLayout(layout, {
      pageIndex: 0,
      x: ((imageInline?.x ?? 0) - (layout.pages[0]?.x ?? 0)) + (imageInline?.width ?? 0) + 24,
      y: ((imageInline?.y ?? 0) - (layout.pages[0]?.y ?? 0)) + 1
    })

    expect(imagePosition).toEqual({
      sectionId: 'section-image-only',
      blockId: 'paragraph-image-only',
      runId: 'run-image-only',
      graphemeIndex: 0
    })
    expect(afterPosition).toEqual({
      sectionId: 'section-image-only',
      blockId: 'paragraph-image-only',
      runId: 'run-after',
      graphemeIndex: 0
    })

    expect(getSelectionRects(layout, {
      anchor: imagePosition!,
      focus: imagePosition!
    })).toEqual([
      {
        pageIndex: imageInline?.pageIndex ?? 0,
        x: imageInline?.x ?? 0,
        y: imageInline?.y ?? 0,
        width: imageInline?.width ?? 0,
        height: imageInline?.height ?? 0
      }
    ])
    expect(getSelectionRects(layout, {
      anchor: afterPosition!,
      focus: afterPosition!
    })).toEqual([])
    expect(getCaretRect(layout, afterPosition!)).toMatchObject({
      x: (imageInline?.x ?? 0) + (imageInline?.width ?? 0)
    })
    expect((getCaretRect(layout, afterPosition!)?.height ?? 0)).toBeLessThan(imageInline?.height ?? Number.POSITIVE_INFINITY)
  })

  it('aligns inline images to the line baseline by bottom edge instead of top edge', () => {
    const layout = layoutDocument({
      projection: createImageProjection(),
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
    const line = layout.pages[0]?.lines[0]
    const beforeFragment = line?.fragments.find((fragment) => fragment.runId === 'run-before')
    const afterFragment = line?.fragments.find((fragment) => fragment.runId === 'run-after')
    const imageInline = line?.inlines.find((inline) => inline.runId === 'run-image')
    const afterCaret = getCaretRect(layout, {
      sectionId: 'section-image',
      blockId: 'paragraph-image',
      runId: 'run-after',
      graphemeIndex: 0
    })

    expect(beforeFragment).toBeDefined()
    expect(afterFragment).toBeDefined()
    expect(imageInline).toBeDefined()
    expect(line?.baseline).toBe((imageInline?.y ?? 0) + (imageInline?.height ?? 0))
    expect(beforeFragment?.baseline).toBe(line?.baseline)
    expect(afterFragment?.baseline).toBe(line?.baseline)
    expect(beforeFragment?.y ?? 0).toBeGreaterThan(imageInline?.y ?? Number.NEGATIVE_INFINITY)
    expect(afterFragment?.y ?? 0).toBeGreaterThan(imageInline?.y ?? Number.NEGATIVE_INFINITY)
    expect(afterCaret?.y).toBe(afterFragment?.y)
  })

  it('maps whitespace after an image-only line to a trailing caret boundary instead of reselecting the image', () => {
    const layout = layoutDocument({
      projection: createImageOnlyProjection(),
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
    const line = layout.pages[0]?.lines[0]
    const imageInline = line?.inlines.find((inline) => inline.runId === 'run-image-only')

    expect(imageInline).toBeDefined()

    const position = hitTestDocumentLayout(layout, {
      pageIndex: 0,
      x: ((imageInline?.x ?? 0) - (layout.pages[0]?.x ?? 0)) + (imageInline?.width ?? 0) + 24,
      y: ((imageInline?.y ?? 0) - (layout.pages[0]?.y ?? 0)) + 1
    })

    expect(position).toEqual({
      sectionId: 'section-image-only',
      blockId: 'paragraph-image-only',
      runId: 'run-after',
      graphemeIndex: 0
    })
    expect(getSelectionRects(layout, {
      anchor: position!,
      focus: position!
    })).toEqual([])
    expect(getCaretRect(layout, position!)).toMatchObject({
      x: (imageInline?.x ?? 0) + (imageInline?.width ?? 0)
    })
    expect((getCaretRect(layout, position!)?.height ?? 0)).toBeLessThan(imageInline?.height ?? Number.POSITIVE_INFINITY)
  })

  it('maps clicks after an end-of-text inline image to the trailing empty text run', () => {
    const layout = layoutDocument({
      projection: createImageTrailingEmptyProjection(),
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
    const line = layout.pages[0]?.lines[0]
    const imageInline = line?.inlines.find((inline) => inline.runId === 'run-image-tail')

    expect(imageInline).toBeDefined()

    const position = hitTestDocumentLayout(layout, {
      pageIndex: 0,
      x: ((imageInline?.x ?? 0) - (layout.pages[0]?.x ?? 0)) + (imageInline?.width ?? 0) + 24,
      y: ((imageInline?.y ?? 0) - (layout.pages[0]?.y ?? 0)) + 1
    })

    expect(position).toEqual({
      sectionId: 'section-image-tail',
      blockId: 'paragraph-image-tail',
      runId: 'run-after-tail',
      graphemeIndex: 0
    })
    expect(getSelectionRects(layout, {
      anchor: position!,
      focus: position!
    })).toEqual([])
    expect((getCaretRect(layout, position!)?.height ?? 0)).toBeLessThan(imageInline?.height ?? Number.POSITIVE_INFINITY)
  })
})

function createSingleLineLayout() {
  return layoutDocument({
    projection: createProjection('abcd'),
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

function createProjection(text: string, secondPageText?: string): DocumentProjection {
  const inlines: readonly Inline[] = secondPageText === undefined
    ? [{ kind: 'text', text }]
    : [
        {
          kind: 'text',
          text
        },
        {
          kind: 'break',
          breakType: 'page'
        },
        {
          kind: 'text',
          text: secondPageText
        }
      ]

  const projection: DocumentProjection = {
    document: {
      kind: 'document',
      id: 'document-hit',
      sections: [
        {
          kind: 'section',
          id: 'section-hit',
          blocks: [
            {
              kind: 'paragraph',
              id: 'paragraph-hit',
              runs: [
                {
                  kind: 'run',
                  id: 'run-hit',
                  properties: {
                    fontSizePx: 16
                  },
                  inlines
                }
              ]
            }
          ]
        }
      ]
    }
  }

  return projection
}

function createImageProjection(): DocumentProjection {
  return {
    document: {
      kind: 'document',
      id: 'document-image',
      resourceIds: ['image-1'],
      resources: [
        {
          kind: 'resource',
          id: 'image-1',
          mime: 'image/png',
          source: {
            kind: 'dataUrl',
            url: 'data:image/png;base64,AAAA'
          },
          status: 'success'
        }
      ],
      sections: [
        {
          kind: 'section',
          id: 'section-image',
          blocks: [
            {
              kind: 'paragraph',
              id: 'paragraph-image',
              runs: [
                {
                  kind: 'run',
                  id: 'run-before',
                  properties: {
                    fontSizePx: 16
                  },
                  inlines: [
                    {
                      kind: 'text',
                      text: '前'
                    }
                  ]
                },
                {
                  kind: 'run',
                  id: 'run-image',
                  inlines: [
                    {
                      kind: 'image',
                      resourceId: 'image-1',
                      alt: '占位图',
                      widthTwips: cssPxToTwips(48),
                      heightTwips: cssPxToTwips(32)
                    }
                  ]
                },
                {
                  kind: 'run',
                  id: 'run-after',
                  properties: {
                    fontSizePx: 16
                  },
                  inlines: [
                    {
                      kind: 'text',
                      text: '后'
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

function createImageOnlyProjection(): DocumentProjection {
  return {
    document: {
      kind: 'document',
      id: 'document-image-only',
      resourceIds: ['image-only-1'],
      resources: [
        {
          kind: 'resource',
          id: 'image-only-1',
          mime: 'image/png',
          source: {
            kind: 'dataUrl',
            url: 'data:image/png;base64,AAAA'
          },
          status: 'success'
        }
      ],
      sections: [
        {
          kind: 'section',
          id: 'section-image-only',
          blocks: [
            {
              kind: 'paragraph',
              id: 'paragraph-image-only',
              runs: [
                {
                  kind: 'run',
                  id: 'run-before',
                  inlines: [
                    {
                      kind: 'text',
                      text: ''
                    }
                  ]
                },
                {
                  kind: 'run',
                  id: 'run-image-only',
                  inlines: [
                    {
                      kind: 'image',
                      resourceId: 'image-only-1',
                      widthTwips: cssPxToTwips(48),
                      heightTwips: cssPxToTwips(32)
                    }
                  ]
                },
                {
                  kind: 'run',
                  id: 'run-after',
                  inlines: [
                    {
                      kind: 'text',
                      text: ''
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

function createImageTrailingEmptyProjection(): DocumentProjection {
  return {
    document: {
      kind: 'document',
      id: 'document-image-tail',
      resourceIds: ['image-tail-1'],
      resources: [
        {
          kind: 'resource',
          id: 'image-tail-1',
          mime: 'image/png',
          source: {
            kind: 'dataUrl',
            url: 'data:image/png;base64,AAAA'
          },
          status: 'success'
        }
      ],
      sections: [
        {
          kind: 'section',
          id: 'section-image-tail',
          blocks: [
            {
              kind: 'paragraph',
              id: 'paragraph-image-tail',
              runs: [
                {
                  kind: 'run',
                  id: 'run-before-tail',
                  inlines: [
                    {
                      kind: 'text',
                      text: '前'
                    }
                  ]
                },
                {
                  kind: 'run',
                  id: 'run-image-tail',
                  inlines: [
                    {
                      kind: 'image',
                      resourceId: 'image-tail-1',
                      widthTwips: cssPxToTwips(48),
                      heightTwips: cssPxToTwips(32)
                    }
                  ]
                },
                {
                  kind: 'run',
                  id: 'run-after-tail',
                  inlines: [
                    {
                      kind: 'text',
                      text: ''
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
