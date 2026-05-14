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

import { createFontManager } from '../src/font-manager'
import {
  getCaretRect,
  getSelectionRects,
  hitTestDocumentLayout,
  layoutDocument
} from '../src/layout'
import type { Inline } from '../src/model'
import { createPageConfig } from '../src/page-config'
import type { DocumentProjection } from '../src/projection'

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

    expect(caret?.width).toBe(0)
    expect(caret?.height).toBeGreaterThan(0)
    expect(rects).toHaveLength(1)
    expect(rects[0]?.width).toBeGreaterThan(0)
    expect(rects[0]?.x).toBe(caret?.x)
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
