/**
 * @vitest-environment node
 *
 * 职责：验证 @4xian/jword-docx public API core conversion。
 * 边界：只覆盖拆分后的 focused public API 行为，不扩大 Gate 5 功能范围。
 * 协作模块：packages/docx/src/index.ts、fixtures helper 和 Gate 5 兼容验证复用这些契约。
 * 约束：测试文件保持小体量，避免一个 public API 文件承载全部 DOCX 纵线。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import { createEditor } from '@4xian/jword-core'
import { describe, expect, it, vi } from 'vitest'

import { convertDocxImportDocumentToCoreDocument } from '../src/index'

describe('@4xian/jword-docx public API core conversion', () => {
  it('converts the import middle model into a core document for host demos', () => {
    const document = convertDocxImportDocumentToCoreDocument({
      kind: 'docx-import-document',
      metadata: {
        mainDocumentPart: 'word/document.xml',
        styleIds: ['Heading1'],
        numberingIds: []
      },
      sections: [
        {
          kind: 'section',
          id: 'section-docx-host',
          breakType: 'next-page',
          page: {
            widthTwips: 12240,
            heightTwips: 15840
          },
          headerIds: ['word/header1.xml'],
          footerIds: ['word/footer1.xml'],
          blocks: [
            {
              kind: 'paragraph',
              id: 'paragraph-docx-host',
              styleId: 'Heading1',
              properties: {
                listNumberingId: '5',
                listLevel: 0
              },
              runs: [
                {
                  kind: 'run',
                  id: 'run-docx-host',
                  properties: {
                    bold: true
                  },
                  inlines: [
                    {
                      kind: 'text',
                      text: 'DOCX host'
                    },
                    {
                      kind: 'image',
                      resourceId: 'word/media/image1.png',
                      alt: 'Inline',
                      display: 'inline',
                      widthTwips: 1440,
                      heightTwips: 720
                    }
                  ]
                }
              ]
            }
          ]
        }
      ],
      resources: [
        {
          kind: 'resource',
          resourceId: 'word/media/image1.png',
          mimeType: 'image/png',
          extension: 'png',
          targetPart: 'word/media/image1.png',
          bytes: new Uint8Array([137, 80, 78, 71])
        }
      ],
      comments: [],
      opaque: {
        unsupportedParts: [],
        unsupportedRelationships: [],
        unsupportedElementFragments: [],
        originalStyleIds: ['Heading1'],
        originalNumberingIds: []
      }
    })

    expect(document).toMatchObject({
      kind: 'document',
      id: 'document-docx-import',
      styleIds: ['Heading1'],
      resourceIds: ['word/media/image1.png'],
      resources: [
        {
          kind: 'resource',
          id: 'word/media/image1.png',
          mime: 'image/png',
          status: 'success'
        }
      ],
      sections: [
        {
          kind: 'section',
          id: 'section-docx-host',
          breakType: 'next-page',
          headerIds: ['word/header1.xml'],
          footerIds: ['word/footer1.xml'],
          blocks: [
            {
              kind: 'paragraph',
              id: 'paragraph-docx-host',
              styleId: 'Heading1',
              properties: {
                styleId: 'Heading1',
                listNumberingId: '5',
                listLevel: 0
              },
              list: {
                numberingId: '5',
                level: 0
              },
              runs: [
                {
                  kind: 'run',
                  id: 'run-docx-host',
                  properties: {
                    bold: true
                  },
                  inlines: [
                    {
                      kind: 'text',
                      text: 'DOCX host'
                    },
                    {
                      kind: 'image',
                      resourceId: 'word/media/image1.png',
                      alt: 'Inline',
                      display: 'inline',
                      widthTwips: 1440,
                      heightTwips: 720
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    })
  })

  it('keeps the import middle model aligned with current core document structures', () => {
    const document = convertDocxImportDocumentToCoreDocument({
      kind: 'docx-import-document',
      metadata: {
        mainDocumentPart: 'word/document.xml',
        styleIds: ['Normal'],
        numberingIds: []
      },
      sections: [
        {
          kind: 'section',
          id: 'section-docx-core-coverage',
          columns: 2,
          headerIds: [],
          footerIds: [],
          blocks: [
            {
              kind: 'paragraph',
              id: 'paragraph-docx-core-coverage',
              tabs: [720, 1440],
              runs: [
                {
                  kind: 'run',
                  id: 'run-docx-core-coverage',
                  field: {
                    code: 'PAGE',
                    result: '3'
                  },
                  revisionId: 'revision-docx-1',
                  inlines: [
                    {
                      kind: 'bookmark',
                      id: 'bookmark-docx-1',
                      name: 'Important',
                      edge: 'start'
                    },
                    {
                      kind: 'image',
                      resourceId: 'word/media/image1.png',
                      rotationDegrees: 90
                    }
                  ]
                }
              ]
            },
            {
              kind: 'table',
              id: 'table-docx-core-coverage',
              border: {
                color: '#111111',
                widthTwips: 20
              },
              rows: [
                {
                  id: 'row-docx-core-coverage',
                  properties: {
                    cantSplit: true
                  },
                  cells: [
                    {
                      id: 'cell-docx-core-coverage',
                      border: {
                        color: '#222222',
                        widthTwips: 30
                      },
                      blocks: []
                    }
                  ]
                }
              ]
            }
          ]
        }
      ],
      resources: [
        {
          kind: 'resource',
          resourceId: 'word/media/image1.png',
          mimeType: 'image/png',
          extension: 'png',
          targetPart: 'word/media/image1.png',
          bytes: new Uint8Array([137, 80, 78, 71])
        }
      ],
      comments: [],
      opaque: {
        unsupportedParts: [],
        unsupportedRelationships: [],
        unsupportedElementFragments: [],
        originalStyleIds: ['Normal'],
        originalNumberingIds: []
      }
    })

    expect(document.sections[0]).toMatchObject({
      columns: 2,
      blocks: [
        {
          kind: 'paragraph',
          tabs: [720, 1440],
          runs: [
            {
              field: {
                code: 'PAGE',
                result: '3'
              },
              revisionId: 'revision-docx-1',
              inlines: [
                {
                  kind: 'bookmark',
                  id: 'bookmark-docx-1',
                  name: 'Important',
                  edge: 'start'
                },
                {
                  kind: 'image',
                  resourceId: 'word/media/image1.png',
                  rotationDegrees: 90
                }
              ]
            }
          ]
        },
        {
          kind: 'table',
          border: {
            color: '#111111',
            widthTwips: 20
          },
          rows: [
            {
              properties: {
                cantSplit: true
              },
              cells: [
                {
                  border: {
                    color: '#222222',
                    widthTwips: 30
                  }
                }
              ]
            }
          ]
        }
      ]
    })
  })

  it('converts DOCX resource bytes to data URL in bounded chunks', () => {
    const originalFromCharCode = String.fromCharCode
    const calls: number[] = []
    const spy = vi.spyOn(String, 'fromCharCode').mockImplementation((...codes: number[]) => {
      calls.push(codes.length)

      return originalFromCharCode(...codes)
    })

    try {
      const document = convertDocxImportDocumentToCoreDocument({
        kind: 'docx-import-document',
        metadata: {
          mainDocumentPart: 'word/document.xml',
          styleIds: [],
          numberingIds: []
        },
        sections: [],
        resources: [
          {
            kind: 'resource',
            resourceId: 'word/media/large.png',
            mimeType: 'image/png',
            extension: 'png',
            targetPart: 'word/media/large.png',
            bytes: new Uint8Array(0x8000 + 3).fill(65)
          }
        ],
        comments: [],
        opaque: {
          unsupportedParts: [],
          unsupportedRelationships: [],
          unsupportedElementFragments: [],
          originalStyleIds: [],
          originalNumberingIds: []
        }
      })

      expect(document.resources?.[0]?.source.url).toMatch(/^data:image\/png;base64,/u)
      expect(calls).toEqual([0x8000, 3])
    } finally {
      spy.mockRestore()
    }
  })
})
