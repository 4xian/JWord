/**
 * @vitest-environment node
 *
 * 职责：验证 @4xian/jword-docx public API import mapping。
 * 边界：只覆盖拆分后的 focused public API 行为，不扩大 Gate 5 功能范围。
 * 协作模块：packages/docx/src/index.ts、fixtures helper 和 Gate 5 兼容验证复用这些契约。
 * 约束：测试文件保持小体量，避免一个 public API 文件承载全部 DOCX 纵线。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import { createEditor } from '@4xian/jword-core'
import { describe, expect, expectTypeOf, it } from 'vitest'

import type { DocxImportDocument } from '../src/index'
import type {
  DocxBinaryInput,
  ImportDocxOptions,
  ImportDocxResult
} from '../src/index'
import {
  convertDocxImportDocumentToCoreDocument,
  importDocx as importDocxPublic
} from '../src/index'
import {
  createDocxPublicApiLicense,
  createDocxHeaderFooterTextPackage,
  createDocxImagePackage,
  createDocxIndexPackage,
  createDocxPageSetupPackage,
  createDocxParagraphSectionPackage,
  createDocxTablePackage,
  createZip
} from './public-api-fixtures'

/** 以有效授权调用 DOCX import，保持映射测试聚焦于导入结构。 */
function importDocx(input: DocxBinaryInput, options: ImportDocxOptions = {}): Promise<ImportDocxResult> {
  return importDocxPublic(input, {
    ...options,
    license: createDocxPublicApiLicense(['docx.import'])
  })
}

describe('@4xian/jword-docx public API import mapping', () => {
  it('imports a JSON-compatible middle model from XML and indexes', async () => {
    const bytes = await createDocxIndexPackage()
    const result = await importDocx(bytes, {
      requestId: 'docx-import-model-1'
    })
    const middleModel: DocxImportDocument = result.document

    expectTypeOf(middleModel).toMatchTypeOf<DocxImportDocument>()
    expect(result.document).toMatchObject({
      kind: 'docx-import-document',
      metadata: {
        mainDocumentPart: 'word/document.xml',
        styleIds: ['BodyText', 'Accent'],
        numberingIds: ['1', '5']
      },
      sections: [
        {
          kind: 'section',
          id: 'section-1',
          headerIds: ['word/header1.xml'],
          footerIds: ['word/footer1.xml'],
          blocks: [
              {
                kind: 'paragraph',
                id: 'paragraph-1',
                styleId: 'BodyText',
                properties: {
                  alignment: 'center',
                  spacingBeforeTwips: 240,
                  spacingAfterTwips: 120,
                  indentLeftTwips: 720,
                  firstLineIndentTwips: 360,
                  listNumberingId: '5',
                  listLevel: 1
                },
                runs: [
                {
                  kind: 'run',
                  id: 'run-1',
                  inlines: [
                    {
                      kind: 'text',
                      text: 'Hello'
                    }
                  ]
                },
                {
                  kind: 'run',
                  id: 'run-2',
                  properties: {
                    bold: true,
                    italic: true,
                    underline: true,
                    strike: true,
                    color: '#c00000',
                    fontFamily: 'Arial',
                    fontSizeTwips: 320,
                    backgroundColor: '#fff59d',
                    superscript: true
                  },
                  inlines: [
                    {
                      kind: 'text',
                      text: ' Styled'
                    },
                    {
                      kind: 'text',
                      text: '\t'
                    },
                    {
                      kind: 'text',
                      text: 'Text'
                    },
                    {
                      kind: 'break',
                      breakType: 'line'
                    },
                    {
                      kind: 'text',
                      text: 'Next'
                    }
                  ]
                },
                {
                  kind: 'run',
                  id: 'run-3',
                  link: {
                    target: 'https://example.com'
                  },
                  inlines: [
                    {
                      kind: 'text',
                      text: 'Link'
                    }
                  ]
                },
                {
                  kind: 'run',
                  id: 'run-4',
                  inlines: [
                    {
                      kind: 'commentRangeMarker',
                      commentId: 'comment-thread-docx-0',
                      edge: 'start'
                    },
                    {
                      kind: 'text',
                      text: 'Commented'
                    },
                    {
                      kind: 'commentRangeMarker',
                      commentId: 'comment-thread-docx-0',
                      edge: 'end'
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
          bytes: expect.any(Uint8Array)
        }
      ],
      comments: [
        {
          id: 'comment-thread-docx-0',
          author: 'JWord',
          commentId: '0',
          date: '2026-05-25T00:00:00Z',
          text: 'Index note'
        }
      ],
      opaque: {
        unsupportedParts: [],
        unsupportedRelationships: [],
        unsupportedElementFragments: [],
        originalStyleIds: ['BodyText', 'Accent'],
        originalNumberingIds: ['1', '5']
      }
    })
    expect(Array.isArray(result.document.sections)).toBe(true)
    expect(Array.isArray(result.document.resources)).toBe(true)
    expect(Array.isArray(result.document.comments)).toBe(true)
    expect(result.document.resources[0]?.bytes).toBeInstanceOf(Uint8Array)
    expect(Array.from(result.document.resources[0]?.bytes ?? [])).toEqual([137, 80, 78, 71])
    expect(JSON.parse(JSON.stringify(result.document))).toMatchObject({
      kind: 'docx-import-document'
    })
    expect(convertDocxImportDocumentToCoreDocument(result.document).sections[0]?.blocks[0]).toMatchObject({
      kind: 'paragraph',
      runs: [
        {},
        {},
        {
          link: {
            target: 'https://example.com'
          },
          inlines: [
            {
              kind: 'text',
              text: 'Link'
            }
          ]
        },
        {
          inlines: [
            {
              kind: 'commentRangeMarker',
              commentId: 'comment-thread-docx-0',
              edge: 'start'
            },
            {
              kind: 'text',
              text: 'Commented'
            },
            {
              kind: 'commentRangeMarker',
              commentId: 'comment-thread-docx-0',
              edge: 'end'
            }
          ]
        }
      ]
    })
    expect(convertDocxImportDocumentToCoreDocument(result.document).comments?.[0]).toMatchObject({
      id: 'comment-thread-docx-0',
      authorId: 'JWord',
      createdAt: '2026-05-25T00:00:00Z',
      anchorRangeId: 'comment-range-docx-0',
      resolved: false,
      rangeSnapshot: {
        id: 'comment-range-docx-0',
        anchor: {
          documentId: 'document-docx-import',
          sectionId: 'section-1',
          blockId: 'paragraph-1',
          runId: 'run-4',
          graphemeIndex: 0
        },
        focus: {
          documentId: 'document-docx-import',
          sectionId: 'section-1',
          blockId: 'paragraph-1',
          runId: 'run-4',
          graphemeIndex: 9
        }
      },
      messages: [
        {
          id: 'comment-message-docx-0',
          authorId: 'JWord',
          createdAt: '2026-05-25T00:00:00Z',
          anchorRangeId: 'comment-range-docx-0',
          text: 'Index note'
        }
      ]
    })

    const editor = createEditor()
    const projection = editor.loadDocumentModel({
      document: convertDocxImportDocumentToCoreDocument(result.document)
    })
    const comment = projection.document.comments?.[0]

    expect(comment).not.toBeUndefined()
    expect(editor.locateRangeSnapshot(comment!.rangeSnapshot)).toEqual({
      anchor: {
        sectionId: 'section-1',
        blockId: 'paragraph-1',
        runId: 'run-4',
        graphemeIndex: 0
      },
      focus: {
        sectionId: 'section-1',
        blockId: 'paragraph-1',
        runId: 'run-4',
        graphemeIndex: 9
      }
    })
    editor.destroy()
  })


  it('keeps DOCX comment text and markers when ids or marker order are irregular', async () => {
    const bytes = await createZip({
      '[Content_Types].xml': [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
        '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>',
        '</Types>'
      ].join(''),
      '_rels/.rels': [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>',
        '</Relationships>'
      ].join(''),
      'word/_rels/document.xml.rels': [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
        '<Relationship Id="rIdComments" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/>',
        '</Relationships>'
      ].join(''),
      'word/document.xml': [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
        '<w:body><w:p>',
        '<w:commentRangeEnd w:id="7"/>',
        '<w:r><w:t>Trailing marker text</w:t></w:r>',
        '</w:p></w:body>',
        '</w:document>'
      ].join(''),
      'word/comments.xml': [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
        '<w:comment w:author="Missing"><w:p><w:r><w:t>Skip me</w:t></w:r></w:p></w:comment>',
        '<w:comment w:id="7" w:author="JWord" w:date="2026-05-25T00:00:00Z">',
        '<w:p><w:r><w:t>Before<w:tab/>After</w:t></w:r></w:p>',
        '</w:comment>',
        '<w:comment w:author="Missing again"><w:p><w:r><w:t>Skip me too</w:t></w:r></w:p></w:comment>',
        '</w:comments>'
      ].join('')
    })
    const result = await importDocx(bytes, {
      requestId: 'docx-import-comment-remediation-1'
    })
    const paragraph = result.document.sections[0]?.blocks[0]

    expect(result.document.comments).toEqual([
      {
        id: 'comment-thread-docx-7',
        commentId: '7',
        author: 'JWord',
        date: '2026-05-25T00:00:00Z',
        text: 'BeforeAfter'
      }
    ])
    expect(result.warnings.map((warning) => ({ code: warning.code, path: warning.path }))).toEqual([
      { code: 'DOCX_COMMENT_ID_MISSING', path: 'word/comments.xml/comment-1' },
      { code: 'DOCX_COMMENT_ID_MISSING', path: 'word/comments.xml/comment-3' }
    ])
    expect(paragraph).toMatchObject({ kind: 'paragraph' })
    if (paragraph?.kind !== 'paragraph') {
      throw new Error('Expected first imported block to be a paragraph.')
    }
    expect(paragraph.runs[0]?.inlines).toEqual([
      {
        kind: 'commentRangeMarker',
        commentId: 'comment-thread-docx-7',
        edge: 'end'
      },
      {
        kind: 'text',
        text: 'Trailing marker text'
      }
    ])
  })


  it('respects OOXML run toggle off values and warns for unsupported underline styles', async () => {
    const bytes = await createZip({
      '[Content_Types].xml': [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>',
        '</Types>'
      ].join(''),
      '_rels/.rels': [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>',
        '</Relationships>'
      ].join(''),
      'word/_rels/document.xml.rels': [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
        '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
        '</Relationships>'
      ].join(''),
      'word/styles.xml': [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>'
      ].join(''),
      'word/document.xml': [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
        '<w:body><w:p>',
        '<w:r><w:rPr><w:b w:val="false"/><w:i w:val="0"/><w:strike w:val="off"/><w:u w:val="none"/></w:rPr><w:t>Disabled</w:t></w:r>',
        '<w:r><w:rPr><w:u w:val="double"/></w:rPr><w:t>Double</w:t></w:r>',
        '<w:r><w:rPr><w:b/><w:i/><w:strike/><w:u w:val="single"/></w:rPr><w:t>Enabled</w:t></w:r>',
        '</w:p></w:body>',
        '</w:document>'
      ].join('')
    })
    const result = await importDocx(bytes, {
      requestId: 'docx-import-toggle-off-1'
    })
    const block = result.document.sections[0]?.blocks[0]

    expect(block).toMatchObject({ kind: 'paragraph' })
    if (block?.kind !== 'paragraph') {
      throw new Error('Expected first imported block to be a paragraph.')
    }

    expect(block.runs.map((run) => run.properties ?? {})).toEqual([
      {},
      { underline: true },
      {
        bold: true,
        italic: true,
        strike: true,
        underline: true
      }
    ])
    expect(result.warnings.map((warning) => ({ code: warning.code, path: warning.path }))).toEqual([
      { code: 'DOCX_RUN_PROPERTY_UNSUPPORTED', path: 'run-1/b' },
      { code: 'DOCX_RUN_PROPERTY_UNSUPPORTED', path: 'run-1/i' },
      { code: 'DOCX_RUN_PROPERTY_UNSUPPORTED', path: 'run-1/u' },
      { code: 'DOCX_RUN_PROPERTY_UNSUPPORTED', path: 'run-1/strike' },
      { code: 'DOCX_RUN_PROPERTY_UNSUPPORTED', path: 'run-2/u' }
    ])
  })

  it('imports page setup, page breaks and section breaks into section metadata', async () => {
    const bytes = await createDocxPageSetupPackage()
    const result = await importDocx(bytes, {
      requestId: 'docx-import-page-setup-1'
    })

    expect(result.warnings).toEqual([])
    expect(result.document.sections).toHaveLength(1)
    expect(result.document.sections[0]).toMatchObject({
      kind: 'section',
      id: 'section-1',
      breakType: 'next-page',
      page: {
        widthTwips: 16838,
        heightTwips: 11906,
        marginTwips: {
          top: 1800,
          right: 1440,
          bottom: 1080,
          left: 1800
        }
      },
      headerIds: [],
      footerIds: [],
      blocks: [
        {
          kind: 'paragraph',
          id: 'paragraph-1',
          runs: [
            {
              kind: 'run',
              id: 'run-1',
              inlines: [
                {
                  kind: 'text',
                  text: 'First page'
                }
              ]
            }
          ]
        },
        {
          kind: 'paragraph',
          id: 'paragraph-2',
          runs: [
            {
              kind: 'run',
              id: 'run-1',
              inlines: [
                {
                  kind: 'text',
                  text: 'Page break'
                },
                {
                  kind: 'break',
                  breakType: 'page'
                },
                {
                  kind: 'text',
                  text: 'After break'
                }
              ]
            }
          ]
        }
      ]
    })
    expect(result.document.opaque.unsupportedElementFragments).toEqual([])
  })

  it('preserves signed section page margins from pgMar', async () => {
    const bytes = await createZip({
      '[Content_Types].xml': [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
        '</Types>'
      ].join(''),
      '_rels/.rels': [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>',
        '</Relationships>'
      ].join(''),
      'word/document.xml': [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
        '<w:body>',
        '<w:p><w:r><w:t>Negative margins</w:t></w:r></w:p>',
        '<w:sectPr>',
        '<w:pgMar w:top="-720" w:right="1440" w:bottom="-360" w:left="1800"/>',
        '</w:sectPr>',
        '</w:body>',
        '</w:document>'
      ].join('')
    })
    const result = await importDocx(bytes, {
      requestId: 'docx-import-negative-margin-1'
    })

    expect(result.warnings).toEqual([])
    expect(result.document.sections[0]?.page?.marginTwips).toEqual({
      top: -720,
      right: 1440,
      bottom: -360,
      left: 1800
    })
  })

  it('imports basic header text and footer page number source ids', async () => {
    const bytes = await createDocxHeaderFooterTextPackage()
    const result = await importDocx(bytes, {
      requestId: 'docx-import-header-footer-text-1'
    })

    expect(result.warnings).toEqual([])
    expect(result.document.sections[0]).toMatchObject({
      kind: 'section',
      id: 'section-1',
      headerIds: ['Imported header'],
      footerIds: ['page-number-bottom-center'],
      pageNumbering: {
        mode: 'restart',
        start: 3
      }
    })
    expect(convertDocxImportDocumentToCoreDocument(result.document).sections[0]).toMatchObject({
      headerIds: ['Imported header'],
      footerIds: ['page-number-bottom-center'],
      pageNumbering: {
        mode: 'restart',
        start: 3
      }
    })
  })

  it('splits paragraph section breaks and warns for unsupported section setup', async () => {
    const bytes = await createDocxParagraphSectionPackage()
    const result = await importDocx(bytes, {
      requestId: 'docx-import-section-breaks-1'
    })

    expect(result.warnings).toEqual([
      {
        code: 'DOCX_SECTION_ORIENTATION_UNSUPPORTED',
        severity: 'warning',
        part: 'word/document.xml',
        path: 'sectPr',
        message: 'DOCX section page orientation does not match page size: landscape',
        fallback: 'normalize-landscape-page-size',
        recoverable: true
      },
      {
        code: 'DOCX_SECTION_BREAK_UNSUPPORTED',
        severity: 'warning',
        part: 'word/document.xml',
        path: 'sectPr',
        message: 'DOCX section break type is not fully supported: oddPage',
        fallback: 'treat-as-next-page',
        recoverable: true
      },
      {
        code: 'DOCX_SECTION_COLUMNS_UNSUPPORTED',
        severity: 'warning',
        part: 'word/document.xml',
        path: 'sectPr',
        message: 'DOCX section columns are not fully supported: 2',
        fallback: 'ignore-columns',
        recoverable: true
      }
    ])
    expect(result.document.sections).toMatchObject([
      {
        kind: 'section',
        id: 'section-1',
        breakType: 'continuous',
        page: {
          widthTwips: 16838,
          heightTwips: 11906
        },
        blocks: [
          {
            kind: 'paragraph',
            id: 'paragraph-1',
            runs: [
              {
                kind: 'run',
                id: 'run-1',
                inlines: [
                  {
                    kind: 'text',
                    text: 'First section'
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        kind: 'section',
        id: 'section-2',
        breakType: 'next-page',
        page: {
          widthTwips: 16838,
          heightTwips: 11906,
          marginTwips: {
            top: 1440,
            right: 1440,
            bottom: 1440,
            left: 1440
          }
        },
        blocks: [
          {
            kind: 'paragraph',
            id: 'paragraph-2',
            runs: [
              {
                kind: 'run',
                id: 'run-1',
                inlines: [
                  {
                    kind: 'text',
                    text: 'Second section'
                  }
                ]
              }
            ]
          }
        ]
      }
    ])
  })

  it('imports table blocks with grid, borders, span and cell text', async () => {
    const bytes = await createDocxTablePackage()
    const result = await importDocx(bytes, {
      requestId: 'docx-import-table-1'
    })

    expect(result.warnings).toEqual([])
    expect(result.document).toMatchObject({
      kind: 'docx-import-document',
      metadata: {
        mainDocumentPart: 'word/document.xml',
        styleIds: [],
        numberingIds: []
      },
      sections: [
        {
          kind: 'section',
          id: 'section-1',
          headerIds: [],
          footerIds: [],
          blocks: [
            {
              kind: 'table',
              id: 'table-1',
              properties: {
                border: {
                  color: 'C0C0C0',
                  widthTwips: 10
                }
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
                          id: 'table-1-row-1-cell-1-paragraph-1',
                          runs: [
                            {
                              kind: 'run',
                              id: 'table-1-row-1-cell-1-paragraph-1-run-1',
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
                          id: 'table-1-row-1-cell-2-paragraph-1',
                          runs: [
                            {
                              kind: 'run',
                              id: 'table-1-row-1-cell-2-paragraph-1-run-1',
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
            }
          ]
        }
      ]
    })
    expect(Array.isArray(result.document.sections[0]?.blocks)).toBe(true)
    expect(result.document.sections[0]?.blocks[0]).toMatchObject({
      kind: 'table',
      grid: [1600, 1600, 1600]
    })
  })

  it('imports inline drawing images and preserves alt, size and resources', async () => {
    const bytes = await createDocxImagePackage()
    const result = await importDocx(bytes, {
      requestId: 'docx-import-image-1'
    })

    expect(result.warnings).toEqual([
      {
        code: 'DOCX_IMAGE_EXTERNAL_UNSUPPORTED',
        severity: 'warning',
        part: 'word/_rels/document.xml.rels',
        path: 'rIdExternalImage',
        message: 'DOCX external image is not fetched: https://example.com/external.png',
        fallback: 'preserve-alt-text',
        recoverable: true
      },
      {
        code: 'DOCX_DRAWING_FLOATING_UNSUPPORTED',
        severity: 'warning',
        part: 'word/document.xml',
        path: 'run-1',
        message: 'DOCX floating image is not supported yet: run-1',
        fallback: 'preserve-empty-inline',
        recoverable: true
      }
    ])
    expect(result.document.resources).toHaveLength(1)
    expect(result.document.resources[0]).toMatchObject({
      kind: 'resource',
      resourceId: 'word/media/image1.png',
      mimeType: 'image/png',
      extension: 'png',
      targetPart: 'word/media/image1.png',
      bytes: expect.any(Uint8Array)
    })
    expect(Array.from(result.document.resources[0]?.bytes ?? [])).toEqual([137, 80, 78, 71])
    expect(result.document.sections[0]?.blocks[0]).toMatchObject({
      kind: 'paragraph',
      runs: [
        {
          inlines: [
            {
              kind: 'image',
              resourceId: 'word/media/image1.png',
              alt: 'Inline image',
              display: 'inline',
              widthTwips: 3600,
              heightTwips: 1800
            }
          ]
        }
      ]
    })
    expect(result.document.sections[0]?.blocks[1]).toMatchObject({
      kind: 'paragraph',
      runs: [
        {
          inlines: [
            {
              kind: 'image',
              resourceId: 'rIdExternalImage',
              alt: 'External image',
              display: 'inline',
              widthTwips: 2400,
              heightTwips: 1200
            }
          ]
        }
      ]
    })
    expect(result.document.sections[0]?.blocks[2]).toMatchObject({
      kind: 'paragraph',
      runs: [
        {
          inlines: []
        }
      ]
    })
  })
})
