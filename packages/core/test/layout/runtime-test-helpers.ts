/**
 * @vitest-environment node
 *
 * 职责：为布局运行时拆分测试提供共享投影、字体度量和文本读取辅助函数。
 * 边界：只服务 packages/core/test/layout 下的测试文件，不进入生产代码导出面。
 * 协作模块：布局运行时、字体管理器、页面配置与文档投影类型。
 * 性能/安全约束：辅助函数只构造只读测试数据，不访问 DOM、网络或磁盘。
 * Specs：docs/superpowers/reports/2026-07-03-remediation-execution-supplement.md §3.10 T2。
 */

import { createFontManager } from '../../src/layout/font-manager'
import { layoutDocument } from '../../src/layout/runtime'
import { createPageConfig } from '../../src/layout/page-config'
import type { FontManager } from '../../src/layout/font-manager'
import type { DocumentLayout } from '../../src/layout/runtime'
import type { DocumentProjection } from '../../src/model/projection'

/** 创建单段文本投影。 */
export function createProjection(text: string): DocumentProjection {
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
export function createLatinWrapPageConfig() {
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
export function createLatinWrapFontManager() {
  return createFontManager({
    fallbackFontFamily: 'Arial',
    availableFontFamilies: ['Arial']
  })
}

/**
 * 读取指定行上的纯文本内容。
 */
export function readLineText(layout: DocumentLayout, pageIndex: number, lineIndex: number) {
  return layout.pages[pageIndex]?.lines[lineIndex]?.fragments.map((fragment) => fragment.text).join('')
}

/**
 * 找到“单词单独占一行能放下，但跟在前缀后面会跨行”的最小样例。
 */
export function findLatinWordThatFitsOnFreshLine() {
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

/** 创建依赖自然分页的三页投影。 */
export function createThreePageBreakProjection(
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

/** 创建带显式分页符的三页投影。 */
export function createExplicitThreePageProjection(
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

/** 创建记录测量文本的字体管理器。 */
export function createCountingFontManager(): FontManager & {
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
