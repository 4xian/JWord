/**
 * @vitest-environment node
 *
 * 职责：覆盖 Gate 5 Iteration 18 的 DOCX rich block export roundtrip 契约。
 * 边界：只验证列表、基础表格和内联图片从 projection 导出后能被当前 importer 回读。
 * 协作模块：packages/docx/src/export.ts、importDocx 和 core DocumentProjection 类型。
 * 约束：测试不读取磁盘 fixture，不做 Microsoft Word 人工兼容性声明。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import type { DocumentProjection } from '@4xian/jword-core'
import { describe, expect, it } from 'vitest'

import { exportDocx, importDocx } from '../src/index'
import { createDocxPublicApiLicense } from './public-api-fixtures'

describe('@4xian/jword-docx rich block export', () => {
  it('exports T1 lists, tables and inline images for roundtrip import', async () => {
    const exportResult = await exportDocx(createRichBlocksProjection(), {
      requestId: 'docx-export-rich-blocks-1',
      license: createDocxPublicApiLicense(['docx.export'])
    })
    const importResult = await importDocx(exportResult.bytes, {
      requestId: 'docx-import-rich-blocks-1',
      license: createDocxPublicApiLicense(['docx.import'])
    })

    expect(exportResult.warnings).toEqual([])
    expect(importResult.warnings).toEqual([])
    expect(importResult.document.metadata.numberingIds).toEqual(['1', '5'])
    expect(importResult.document.resources).toEqual([
      {
        kind: 'resource',
        resourceId: 'word/media/image1.png',
        mimeType: 'image/png',
        extension: 'png',
        targetPart: 'word/media/image1.png',
        bytes: expect.any(Uint8Array)
      }
    ])
    expect(Array.from(importResult.document.resources[0]?.bytes ?? [])).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    expect(importResult.document.sections[0]?.blocks).toMatchObject([
      {
        kind: 'paragraph',
        properties: {
          listNumberingId: '5',
          listLevel: 1
        },
        runs: [
          {
            inlines: [
              {
                kind: 'text',
                text: 'List item'
              }
            ]
          }
        ]
      },
      {
        kind: 'table',
        properties: {
          border: {
            color: 'C0C0C0',
            widthTwips: 10
          }
        },
        grid: [1600, 1600, 1600],
        rows: [
          {
            cells: [
              {
                gridSpan: 2,
                blocks: [
                  {
                    kind: 'paragraph',
                    runs: [
                      {
                        inlines: [
                          {
                            kind: 'text',
                            text: 'Left'
                          }
                        ]
                      }
                    ]
                  }
                ]
              },
              {
                blocks: [
                  {
                    kind: 'paragraph',
                    runs: [
                      {
                        inlines: [
                          {
                            kind: 'text',
                            text: 'Right'
                          }
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        kind: 'paragraph',
        runs: [
          {
            inlines: [
              {
                kind: 'image',
                resourceId: 'word/media/image1.png',
                alt: 'Exported inline image',
                display: 'inline',
                widthTwips: 3600,
                heightTwips: 1800
              }
            ]
          }
        ]
      },
      {
        kind: 'paragraph',
        runs: [
          {
            link: {
              target: 'https://example.com/exported-link'
            },
            inlines: [
              {
                kind: 'text',
                text: 'Exported link'
              }
            ]
          }
        ]
      }
    ])
  })
})

/** 创建覆盖列表、表格和内联图片 export roundtrip 的只读投影。 */
function createRichBlocksProjection(): DocumentProjection {
  return {
    document: {
      kind: 'document',
      id: 'document-rich-blocks-export',
      resources: [
        {
          kind: 'resource',
          id: 'resource-rich-blocks-png-1',
          mime: 'image/png',
          source: {
            kind: 'dataUrl',
            url: 'data:image/png;base64,iVBORw0KGgo='
          },
          status: 'success'
        }
      ],
      sections: [
        {
          kind: 'section',
          id: 'section-1',
          blocks: [
            {
              kind: 'paragraph',
              id: 'paragraph-list-1',
              list: {
                numberingId: '5',
                level: 1
              },
              runs: [
                {
                  kind: 'run',
                  id: 'run-1',
                  inlines: [
                    {
                      kind: 'text',
                      text: 'List item'
                    }
                  ]
                }
              ]
            },
            {
              kind: 'table',
              id: 'table-1',
              border: {
                color: 'C0C0C0',
                widthTwips: 10
              },
              grid: [1600, 1600, 1600],
              rows: [
                {
                  id: 'table-1-row-1',
                  cells: [
                    {
                      id: 'table-1-row-1-cell-1',
                      gridSpan: 2,
                      blocks: [
                        {
                          kind: 'paragraph',
                          id: 'cell-1-paragraph-1',
                          runs: [
                            {
                              kind: 'run',
                              id: 'cell-1-run-1',
                              inlines: [
                                {
                                  kind: 'text',
                                  text: 'Left'
                                }
                              ]
                            }
                          ]
                        }
                      ]
                    },
                    {
                      id: 'table-1-row-1-cell-2',
                      blocks: [
                        {
                          kind: 'paragraph',
                          id: 'cell-2-paragraph-1',
                          runs: [
                            {
                              kind: 'run',
                              id: 'cell-2-run-1',
                              inlines: [
                                {
                                  kind: 'text',
                                  text: 'Right'
                                }
                              ]
                            }
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            },
            {
              kind: 'paragraph',
              id: 'paragraph-image-1',
              runs: [
                {
                  kind: 'run',
                  id: 'run-image-1',
                  inlines: [
                    {
                      kind: 'image',
                      resourceId: 'resource-rich-blocks-png-1',
                      alt: 'Exported inline image',
                      display: 'inline',
                      widthTwips: 3600,
                      heightTwips: 1800
                    }
                  ]
                }
              ]
            },
            {
              kind: 'paragraph',
              id: 'paragraph-link-1',
              runs: [
                {
                  kind: 'run',
                  id: 'run-link-1',
                  link: {
                    target: 'https://example.com/exported-link'
                  },
                  inlines: [
                    {
                      kind: 'text',
                      text: 'Exported link'
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
