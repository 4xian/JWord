/**
 * 职责：提供 PDF public API 测试复用的 layout fixture。
 * 边界：只构造测试用 DocumentLayout，不断言 PDF 内容、不读取真实 PDF。
 * 协作模块：public-api.test.ts 与 PDF visual report 测试复用这些 fixture。
 * 约束：测试 fixture 保持纯数据构造，不访问 DOM，不引入额外授权逻辑。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import {
  createFontManager,
  createPageConfig,
  layoutDocument,
  type DocumentLayout
} from '@4xian/jword-core'

import {
  ONE_PIXEL_JPEG_DATA_URL,
  ONE_PIXEL_PNG_DATA_URL,
  type PdfChineseFontFixture
} from './public-api-fixtures'

/** 创建最小空 layout，测试只验证 PDF 包入口契约，不依赖实际分页内容。 */
export function createEmptyLayout(): DocumentLayout {
  return layoutDocument({
    projection: {
      document: {
        kind: 'document',
        id: 'document-empty',
        sections: []
      }
    },
    pageConfig: createPageConfig(),
    fontManager: createFontManager()
  })
}

/** 创建只包含 JPEG inline 图片的 layout。 */
export function createJpegImageLayout(): DocumentLayout {
  return layoutDocument({
    projection: {
      document: {
        kind: 'document',
        id: 'document-pdf-jpeg-image',
        resourceIds: ['image-pdf-jpeg-1'],
        resources: [{
          kind: 'resource',
          id: 'image-pdf-jpeg-1',
          mime: 'image/jpeg',
          source: {
            kind: 'dataUrl',
            url: ONE_PIXEL_JPEG_DATA_URL
          },
          status: 'success'
        }],
        sections: [
          {
            kind: 'section',
            id: 'section-pdf-jpeg-image',
            blocks: [
              {
                kind: 'paragraph',
                id: 'paragraph-pdf-jpeg-image',
                runs: [
                  {
                    kind: 'run',
                    id: 'run-pdf-jpeg-image',
                    inlines: [
                      {
                        kind: 'image',
                        resourceId: 'image-pdf-jpeg-1',
                        widthTwips: 720,
                        heightTwips: 720
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
    fontManager: createFontManager()
  })
}

/** 创建含 inline 图片和表格边框的 layout。 */
export function createTableImageLayout(): DocumentLayout {
  return layoutDocument({
    projection: {
      document: {
        kind: 'document',
        id: 'document-pdf-table-image',
        resourceIds: ['image-pdf-inline-1'],
        resources: [{
          kind: 'resource',
          id: 'image-pdf-inline-1',
          mime: 'image/png',
          source: {
            kind: 'dataUrl',
            url: ONE_PIXEL_PNG_DATA_URL
          },
          status: 'success'
        }],
        sections: [
          {
            kind: 'section',
            id: 'section-pdf-table-image',
            blocks: [
              {
                kind: 'paragraph',
                id: 'paragraph-pdf-image',
                runs: [
                  {
                    kind: 'run',
                    id: 'run-pdf-image',
                    inlines: [
                      {
                        kind: 'image',
                        resourceId: 'image-pdf-inline-1',
                        widthTwips: 720,
                        heightTwips: 720
                      }
                    ]
                  }
                ]
              },
              {
                kind: 'table',
                id: 'table-pdf-border',
                grid: [1440, 1440],
                border: {
                  color: '#336699',
                  widthTwips: 20
                },
                rows: [
                  {
                    id: 'row-pdf-border-1',
                    cells: [
                      {
                        id: 'cell-pdf-border-1',
                        blocks: [createTableCellParagraph('A1')]
                      },
                      {
                        id: 'cell-pdf-border-2',
                        blocks: [createTableCellParagraph('B1')]
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
      widthTwips: 7200,
      heightTwips: 10080,
      marginTwips: {
        top: 720,
        right: 720,
        bottom: 720,
        left: 720
      }
    }),
    fontManager: createFontManager()
  })
}


/** 创建超出 PDF 单页尺寸上限的 layout。 */
export function createOversizedPageLayout(): DocumentLayout {
  return layoutDocument({
    projection: {
      document: {
        kind: 'document',
        id: 'document-pdf-oversized-page',
        sections: [
          {
            kind: 'section',
            id: 'section-pdf-oversized-page',
            blocks: []
          }
        ]
      }
    },
    pageConfig: createPageConfig({
      widthTwips: 14401 * 20,
      heightTwips: 10080,
      marginTwips: {
        top: 720,
        right: 720,
        bottom: 720,
        left: 720
      }
    }),
    fontManager: createFontManager()
  })
}

/** 创建含页眉、页脚和页码的 layout。 */
export function createHeaderFooterLayout(): DocumentLayout {
  return layoutDocument({
    projection: {
      document: {
        kind: 'document',
        id: 'document-pdf-header-footer',
        sections: [
          {
            kind: 'section',
            id: 'section-pdf-header-footer',
            headerIds: ['Company Header', 'page-number-top-right'],
            footerIds: ['Confidential Footer'],
            pageNumbering: {
              mode: 'restart',
              start: 7
            },
            blocks: [
              {
                kind: 'paragraph',
                id: 'paragraph-pdf-header-footer',
                runs: [
                  {
                    kind: 'run',
                    id: 'run-pdf-header-footer',
                    inlines: [
                      {
                        kind: 'text',
                        text: 'Header footer body'
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
      widthTwips: 7200,
      heightTwips: 10080,
      marginTwips: {
        top: 720,
        right: 720,
        bottom: 720,
        left: 720
      }
    }),
    fontManager: createFontManager()
  })
}

/** 创建包含中文文本但未配置 PDF 字体的 layout。 */
export function createChineseTextLayout(): DocumentLayout {
  return layoutDocument({
    projection: {
      document: {
        kind: 'document',
        id: 'document-pdf-chinese-text',
        sections: [
          {
            kind: 'section',
            id: 'section-pdf-chinese-text',
            blocks: [
              {
                kind: 'paragraph',
                id: 'paragraph-pdf-chinese-text',
                runs: [
                  {
                    kind: 'run',
                    id: 'run-pdf-chinese-text',
                    inlines: [
                      {
                        kind: 'text',
                        text: '中文 PDF'
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
    fontManager: createFontManager()
  })
}

/** 创建由便携中文字体 fixture 覆盖的 PDF layout。 */
export function createChineseFixtureTextLayout(fixture: PdfChineseFontFixture): DocumentLayout {
  return layoutDocument({
    projection: {
      document: {
        kind: 'document',
        id: fixture.document.id,
        sections: [
          {
            kind: 'section',
            id: fixture.document.sectionId,
            blocks: [
              {
                kind: 'paragraph',
                id: fixture.document.paragraphId,
                runs: [
                  {
                    kind: 'run',
                    id: fixture.document.runId,
                    inlines: [
                      {
                        kind: 'text',
                        text: fixture.document.text
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
    pageConfig: createPageConfig(fixture.pageConfig),
    fontManager: createFontManager({
      fallbackFontFamily: fixture.font.family,
      availableFontFamilies: [fixture.font.family]
    })
  })
}

/** 创建包含可由 PDF 标准字体或测试字体覆盖的拉丁扩展文本 layout。 */
export function createAccentedTextLayout(text = 'Café PDF'): DocumentLayout {
  return layoutDocument({
    projection: {
      document: {
        kind: 'document',
        id: 'document-pdf-accented-text',
        sections: [
          {
            kind: 'section',
            id: 'section-pdf-accented-text',
            blocks: [
              {
                kind: 'paragraph',
                id: 'paragraph-pdf-accented-text',
                runs: [
                  {
                    kind: 'run',
                    id: 'run-pdf-accented-text',
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
    },
    pageConfig: createPageConfig(),
    fontManager: createFontManager()
  })
}

/** 创建基础 PDF 输出测试使用的单页英文文本 layout。 */
export function createTextLayout(): DocumentLayout {
  return layoutDocument({
    projection: {
      document: {
        kind: 'document',
        id: 'document-pdf-basic-text',
        sections: [
          {
            kind: 'section',
            id: 'section-pdf-basic-text',
            blocks: [
              {
                kind: 'paragraph',
                id: 'paragraph-pdf-basic-text',
                runs: [
                  {
                    kind: 'run',
                    id: 'run-pdf-basic-text',
                    properties: {
                      fontSizeTwips: 480,
                      color: '#c00000'
                    },
                    inlines: [
                      {
                        kind: 'text',
                        text: 'Hello PDF'
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
      widthTwips: 7200,
      heightTwips: 10080,
      marginTwips: {
        top: 720,
        right: 720,
        bottom: 720,
        left: 720
      }
    }),
    fontManager: createFontManager({
      fallbackFontFamily: 'Arial',
      availableFontFamilies: ['Arial']
    })
  })
}

/** 创建双页 layout，隔离验证 PDF page count 映射。 */
export function createTwoPageLayout(): DocumentLayout {
  const layout = createTextLayout()
  const firstPage = layout.pages[0]

  if (firstPage === undefined) {
    return layout
  }

  return {
    ...layout,
    pages: [
      firstPage,
      {
        ...firstPage,
        pageIndex: 1,
        y: firstPage.y + firstPage.height
      }
    ]
  }
}

/** 创建表格单元格段落。 */
function createTableCellParagraph(text: string) {
  return {
    kind: 'paragraph',
    id: `paragraph-${text}`,
    runs: [
      {
        kind: 'run',
        id: `run-${text}`,
        inlines: [
          {
            kind: 'text',
            text
          }
        ]
      }
    ]
  } as const
}
