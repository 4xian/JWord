/**
 * @vitest-environment node
 *
 * 职责：先把 Gate 5 的 docx 包公开入口写成可验证契约。
 * 边界：只检查入口符号存在，不验证 OOXML 语义、worker、zip 或 core 写入。
 * 协作模块：后续 packages/docx/src/index.ts、core 结构化导入入口和 Gate 5 fixture 复用这个契约。
 * 约束：测试先行，当前应先失败，以驱动新包骨架落地。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#iteration-3---建立-packagesdocx-最小包与公开-api。
 */

import { createHash } from 'node:crypto'

import { createEditor, type DocumentProjection } from '@4xian/jword-core'
import JSZip from 'jszip'
import { describe, expect, expectTypeOf, it, vi } from 'vitest'

import type {
  DocxError,
  DocxIndexes,
  DocxImportDocument,
  DocxProgressEvent,
  DocxProgressStage,
  DocxTransferable,
  DocxWarningEvent,
  ExportDocxRequest,
  ImportDocxRequest,
  InspectDocxPackageRequest
} from '../src/index'
import {
  createCancelDocxRequest,
  createDocxErrorEvent,
  createDocxIndexes,
  createDocxProgressEvent,
  createDocxTransferables,
  convertDocxImportDocumentToCoreDocument,
  exportDocx,
  inspectDocxPackage,
  importDocx
} from '../src/index'

describe('@4xian/jword-docx public API', () => {
  it('exports import, export and inspect entry points', () => {
    expect(typeof importDocx).toBe('function')
    expect(typeof exportDocx).toBe('function')
    expect(typeof inspectDocxPackage).toBe('function')
  })

  it('throws stable errors for invalid import paths', async () => {
    await expect(importDocx(new ArrayBuffer(0), {
      requestId: 'docx-import-1'
    })).rejects.toMatchObject({
      name: 'DocxPackageError',
      code: 'DOCX_PACKAGE_INVALID',
      requestId: 'docx-import-1'
    })
  })

  it('exports a minimal Transitional DOCX package graph', async () => {
    const result = await exportDocx(createProjectionWithPngResource(), {
      requestId: 'docx-export-1'
    })
    const packageGraph = await inspectDocxPackage(result.bytes, {
      requestId: 'docx-export-inspect-1'
    })

    expect(result.warnings).toEqual([])
    expect(result.diagnostics).toEqual({
      requestId: 'docx-export-1',
      mainDocumentPart: 'word/document.xml'
    })
    expect(result.bytes).toBeInstanceOf(ArrayBuffer)
    expect(packageGraph.parts).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'docProps/app.xml',
      'docProps/core.xml',
      'word/_rels/document.xml.rels',
      'word/document.xml',
      'word/media/image1.png',
      'word/numbering.xml',
      'word/styles.xml'
    ])
    expect(packageGraph.relationships).toEqual([
      'officeDocument:word/document.xml',
      'core-properties:docProps/core.xml',
      'extended-properties:docProps/app.xml',
      'styles:word/styles.xml',
      'numbering:word/numbering.xml',
      'image:word/media/image1.png'
    ])
    expect(packageGraph.partGraph).toMatchObject({
      document: 'word/document.xml',
      styles: 'word/styles.xml',
      numbering: 'word/numbering.xml',
      headers: [],
      footers: [],
      comments: [],
      media: ['word/media/image1.png']
    })
    expect(packageGraph.warnings).toEqual([])
  })

  it('exports deterministic bytes for the same projection across system time changes', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })

    try {
      vi.setSystemTime(new Date('2026-05-25T00:00:00Z'))
      const first = await exportDocx(createProjectionWithPngResource(), {
        requestId: 'docx-export-deterministic-1'
      })

      vi.setSystemTime(new Date('2026-05-25T00:03:00Z'))
      const second = await exportDocx(createProjectionWithPngResource(), {
        requestId: 'docx-export-deterministic-2'
      })

      expect(createSha256Hex(second.bytes)).toBe(createSha256Hex(first.bytes))
    } finally {
      vi.useRealTimers()
    }
  })

  it('exports safe opaque parts and skips unsafe opaque preservation after edit', async () => {
    const result = await exportDocx(createProjection(), {
      requestId: 'docx-export-opaque-preserve-1',
      opaque: {
        unsupportedParts: [
          {
            part: 'customXml/item1.xml',
            contentType: 'application/xml',
            text: '<root><value>Safe</value></root>',
            unsafeToPreserveAfterEdit: false
          },
          {
            part: 'word/embeddings/oleObject1.bin',
            contentType: 'application/vnd.openxmlformats-officedocument.oleObject',
            bytes: [1, 2, 3],
            unsafeToPreserveAfterEdit: true
          }
        ],
        unsupportedRelationships: [
          {
            id: 'rIdCustom',
            kind: 'customXml',
            type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml',
            target: 'customXml/item1.xml',
            sourcePart: 'word/document.xml',
            unsafeToPreserveAfterEdit: false
          },
          {
            id: 'rIdUnsafeOle',
            kind: 'oleObject',
            type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject',
            target: 'word/embeddings/oleObject1.bin',
            sourcePart: 'word/document.xml',
            unsafeToPreserveAfterEdit: true
          }
        ],
        unsupportedElementFragments: [],
        originalStyleIds: [],
        originalNumberingIds: []
      }
    })
    const zip = await JSZip.loadAsync(result.bytes)

    expect(await zip.file('customXml/item1.xml')?.async('string')).toBe('<root><value>Safe</value></root>')
    expect(zip.file('word/embeddings/oleObject1.bin')).toBeNull()
    expect(await zip.file('[Content_Types].xml')?.async('string')).toContain(
      '<Override PartName="/customXml/item1.xml" ContentType="application/xml"/>'
    )
    expect(await zip.file('word/_rels/document.xml.rels')?.async('string')).toContain(
      '<Relationship Id="rIdCustom" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml" Target="../customXml/item1.xml"/>'
    )
    expect(await zip.file('word/_rels/document.xml.rels')?.async('string')).not.toContain('rIdUnsafeOle')
    expect(result.warnings).toEqual([
      {
        code: 'DOCX_OPAQUE_PART_PRESERVE_SKIPPED',
        severity: 'warning',
        part: 'word/embeddings/oleObject1.bin',
        message: 'DOCX opaque part was not preserved after edit: word/embeddings/oleObject1.bin',
        fallback: 'omit-unsafe-opaque-part',
        recoverable: true
      },
      {
        code: 'DOCX_OPAQUE_RELATIONSHIP_PRESERVE_SKIPPED',
        severity: 'warning',
        part: 'word/document.xml',
        path: 'rIdUnsafeOle',
        message: 'DOCX opaque relationship was not preserved after edit: rIdUnsafeOle',
        fallback: 'omit-unsafe-opaque-relationship',
        recoverable: true
      }
    ])
  })

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
          bytes: [137, 80, 78, 71]
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
          bytes: [137, 80, 78, 71]
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

  it('exports T1 text, run formatting, paragraph formatting and Heading styles for roundtrip import', async () => {
    const exportResult = await exportDocx(createStyledTextProjection(), {
      requestId: 'docx-export-t1-1'
    })
    const importResult = await importDocx(exportResult.bytes, {
      requestId: 'docx-import-t1-1'
    })

    expect(exportResult.warnings).toEqual([])
    expect(importResult.warnings).toEqual([])
    expect(importResult.document.metadata.styleIds).toEqual(['Normal', 'Heading1', 'Heading2', 'Heading3'])
    expect(importResult.document.sections[0]?.blocks).toMatchObject([
      {
        kind: 'paragraph',
        styleId: 'Heading1',
        properties: {
          alignment: 'center',
          spacingBeforeTwips: 240,
          spacingAfterTwips: 120,
          indentLeftTwips: 720,
          firstLineIndentTwips: 360
        },
        runs: [
          {
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
                text: 'A & B <tag>'
              },
              {
                kind: 'text',
                text: '\t'
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
            properties: {
              subscript: true
            },
            inlines: [
              {
                kind: 'text',
                text: 'Below'
              }
            ]
          }
        ]
      },
      {
        kind: 'paragraph',
        styleId: 'Heading2',
        runs: [
          {
            inlines: [
              {
                kind: 'text',
                text: 'Second heading'
              }
            ]
          }
        ]
      },
      {
        kind: 'paragraph',
        styleId: 'Heading3',
        runs: [
          {
            inlines: [
              {
                kind: 'text',
                text: 'Third heading'
              }
            ]
          }
        ]
      }
    ])
  })

  it('types worker messages without requiring a worker runtime', () => {
    const importRequest: ImportDocxRequest = {
      type: 'import',
      requestId: 'docx-import-2',
      input: new Uint8Array()
    }
    const exportRequest: ExportDocxRequest = {
      type: 'export',
      requestId: 'docx-export-2',
      document: createProjection()
    }
    const inspectRequest: InspectDocxPackageRequest = {
      type: 'inspect',
      requestId: 'docx-inspect-2',
      input: new Uint8Array()
    }
    const progress: DocxProgressEvent = {
      type: 'progress',
      requestId: 'docx-import-2',
      stage: 'reading',
      completed: 1,
      total: 4
    }
    const warning: DocxWarningEvent = {
      type: 'warning',
      requestId: 'docx-import-2',
      warning: {
        code: 'DOCX_PART_UNSUPPORTED',
        severity: 'warning',
        message: '测试警告',
        fallback: 'preserve-opaque-part',
        recoverable: true
      }
    }
    const error: DocxError = {
      name: 'DocxUnsupportedError',
      code: 'DOCX_USER_CANCELLED',
      message: '用户取消',
      requestId: 'docx-import-2'
    }
    const transferable: DocxTransferable = new ArrayBuffer(0)

    expectTypeOf(importRequest).toMatchTypeOf<ImportDocxRequest>()
    expectTypeOf(exportRequest).toMatchTypeOf<ExportDocxRequest>()
    expectTypeOf(inspectRequest).toMatchTypeOf<InspectDocxPackageRequest>()
    expectTypeOf(progress).toMatchTypeOf<DocxProgressEvent>()
    expectTypeOf(warning).toMatchTypeOf<DocxWarningEvent>()
    expectTypeOf(error).toMatchTypeOf<DocxError>()
    expectTypeOf(transferable).toMatchTypeOf<DocxTransferable>()
  })

  it('creates stable worker contract messages and transferables', () => {
    const stages: readonly DocxProgressStage[] = [
      'queued',
      'reading',
      'parsing',
      'mapping',
      'writing',
      'validating',
      'done'
    ]
    const buffer = new ArrayBuffer(2)

    expect(stages.map((stage) => createDocxProgressEvent('docx-worker-1', stage))).toEqual([
      { type: 'progress', requestId: 'docx-worker-1', stage: 'queued' },
      { type: 'progress', requestId: 'docx-worker-1', stage: 'reading' },
      { type: 'progress', requestId: 'docx-worker-1', stage: 'parsing' },
      { type: 'progress', requestId: 'docx-worker-1', stage: 'mapping' },
      { type: 'progress', requestId: 'docx-worker-1', stage: 'writing' },
      { type: 'progress', requestId: 'docx-worker-1', stage: 'validating' },
      { type: 'progress', requestId: 'docx-worker-1', stage: 'done' }
    ])
    expect(createCancelDocxRequest('docx-worker-1')).toEqual({
      type: 'cancel',
      requestId: 'docx-worker-1'
    })
    expect(createDocxErrorEvent('docx-worker-1', {
      name: 'DocxUnsupportedError',
      code: 'DOCX_USER_CANCELLED',
      message: '用户取消',
      requestId: 'docx-worker-1'
    })).toEqual({
      type: 'error',
      requestId: 'docx-worker-1',
      error: {
        name: 'DocxUnsupportedError',
        code: 'DOCX_USER_CANCELLED',
        message: '用户取消',
        requestId: 'docx-worker-1'
      }
    })
    expect(createDocxTransferables(buffer)).toEqual([buffer])
    expect(createDocxTransferables(new Uint8Array(buffer))).toEqual([buffer])
  })

  it('returns stable cancelled errors when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(importDocx(new ArrayBuffer(0), {
      requestId: 'docx-import-cancel-1',
      signal: controller.signal
    })).rejects.toMatchObject({
      name: 'DocxUnsupportedError',
      code: 'DOCX_USER_CANCELLED',
      requestId: 'docx-import-cancel-1'
    })
    await expect(exportDocx(createProjection(), {
      requestId: 'docx-export-cancel-1',
      signal: controller.signal
    })).rejects.toMatchObject({
      name: 'DocxUnsupportedError',
      code: 'DOCX_USER_CANCELLED',
      requestId: 'docx-export-cancel-1'
    })
    await expect(inspectDocxPackage(new ArrayBuffer(0), {
      requestId: 'docx-inspect-cancel-1',
      signal: controller.signal
    })).rejects.toMatchObject({
      name: 'DocxUnsupportedError',
      code: 'DOCX_USER_CANCELLED',
      requestId: 'docx-inspect-cancel-1'
    })
  })

  it('inspects the minimal OPC package graph without writing to JWord', async () => {
    const bytes = await createMinimalDocxPackage()
    const result = await inspectDocxPackage(bytes, {
      requestId: 'docx-inspect-2'
    })

    expect(result.parts).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'word/_rels/document.xml.rels',
      'word/document.xml',
      'word/styles.xml'
    ])
    expect(result.relationships).toEqual([
      'officeDocument:word/document.xml',
      'styles:word/styles.xml'
    ])
    expect(result.partGraph).toMatchObject({
      document: 'word/document.xml',
      styles: 'word/styles.xml',
      headers: [],
      footers: [],
      comments: [],
      media: []
    })
    expect(result.warnings).toEqual([])
    expect(result.diagnostics).toEqual({
      requestId: 'docx-inspect-2',
      mainDocumentPart: 'word/document.xml'
    })
  })

  it('returns stable inspect errors for invalid OPC packages', async () => {
    await expect(inspectDocxPackage(new Uint8Array([1, 2, 3]), {
      requestId: 'docx-invalid-zip'
    })).rejects.toMatchObject({
      name: 'DocxPackageError',
      code: 'DOCX_PACKAGE_INVALID',
      requestId: 'docx-invalid-zip'
    })
    await expect(inspectDocxPackage(await createZip({}), {
      requestId: 'docx-missing-content-types'
    })).rejects.toMatchObject({
      name: 'DocxPackageError',
      code: 'DOCX_CONTENT_TYPES_MISSING',
      requestId: 'docx-missing-content-types'
    })
    await expect(inspectDocxPackage(await createZip({
      '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
      '_rels/.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>'
    }), {
      requestId: 'docx-missing-document'
    })).rejects.toMatchObject({
      name: 'DocxPackageError',
      code: 'DOCX_MAIN_DOCUMENT_MISSING',
      requestId: 'docx-missing-document'
    })
  })

  it('reports broken optional document relationships as recoverable warnings', async () => {
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
      'word/document.xml': '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>',
      'word/_rels/document.xml.rels': [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
        '<Relationship Id="rIdMissingStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
        '</Relationships>'
      ].join('')
    })
    const result = await inspectDocxPackage(bytes, {
      requestId: 'docx-broken-optional-rel'
    })

    expect(result.warnings).toEqual([
      {
        code: 'DOCX_RELATIONSHIP_TARGET_MISSING',
        severity: 'warning',
        part: 'word/_rels/document.xml.rels',
        path: 'word/styles.xml',
        message: 'DOCX relationship target is missing: word/styles.xml',
        fallback: 'preserve-relationship-metadata',
        recoverable: true
      }
    ])
  })

  it('builds OOXML indexes from the package graph without rescanning consumers', async () => {
    const bytes = await createDocxIndexPackage()
    const indexes = await createDocxIndexes(bytes, {
      requestId: 'docx-indexes-1'
    })

    expect(indexes).toMatchObject({
      styles: {
        paragraphStyles: [
          {
            styleId: 'BodyText',
            kind: 'paragraph',
            name: 'Body Text',
            basedOn: 'Normal'
          }
        ],
        characterStyles: [
          {
            styleId: 'Accent',
            kind: 'character',
            name: 'Accent'
          }
        ],
        linkedStyles: [],
        tableStyleWarnings: [],
        defaultParagraphStyleId: undefined,
        defaultRunStyleId: undefined
      },
      numbering: {
        abstractNumberings: [
          {
            abstractNumberingId: '1',
            levels: [
              {
                level: 0,
                format: 'bullet',
                text: '•',
                start: 1
              }
            ]
          }
        ],
        numberingInstances: [
          {
            numberingId: '5',
            abstractNumberingId: '1'
          }
        ]
      },
      relationships: {
        internal: expect.arrayContaining([
          expect.objectContaining({
            kind: 'styles',
            target: 'word/styles.xml'
          }),
          expect.objectContaining({
            kind: 'numbering',
            target: 'word/numbering.xml'
          }),
          expect.objectContaining({
            kind: 'comments',
            target: 'word/comments.xml'
          }),
          expect.objectContaining({
            kind: 'header',
            target: 'word/header1.xml'
          }),
          expect.objectContaining({
            kind: 'footer',
            target: 'word/footer1.xml'
          }),
          expect.objectContaining({
            kind: 'image',
            target: 'word/media/image1.png'
          })
        ]),
        external: [
          expect.objectContaining({
            kind: 'hyperlink',
            target: 'https://example.com'
          })
        ],
        images: [
          expect.objectContaining({
            targetPart: 'word/media/image1.png',
            mimeType: 'image/png',
            extension: 'png'
          })
        ],
        hyperlinks: [
          expect.objectContaining({
            target: 'https://example.com',
            targetMode: 'External'
          })
        ],
        headerFooters: [
          expect.objectContaining({
            kind: 'header',
            target: 'word/header1.xml'
          }),
          expect.objectContaining({
            kind: 'footer',
            target: 'word/footer1.xml'
          })
        ]
      },
      media: {
        items: [
          expect.objectContaining({
            targetPart: 'word/media/image1.png',
            mimeType: 'image/png',
            extension: 'png',
            bytes: [137, 80, 78, 71]
          })
        ]
      },
      comments: {
        comments: [
          {
            commentId: '0',
            author: 'JWord',
            date: '2026-05-25T00:00:00Z',
            text: 'Index note'
          }
        ]
      },
      headerFooter: {
        headers: ['word/header1.xml'],
        footers: ['word/footer1.xml']
      }
    })
  })

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
          bytes: [137, 80, 78, 71]
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
      bytes: [137, 80, 78, 71]
    })
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

  it('warns and preserves opaque data for unsupported DOCX content', async () => {
    const bytes = await createDocxOpaquePackage()
    const result = await importDocx(bytes, {
      requestId: 'docx-import-opaque-1'
    })

    expect(result.warnings).toEqual([
      {
        code: 'DOCX_RELATIONSHIP_TARGET_MISSING',
        severity: 'warning',
        part: 'word/_rels/document.xml.rels',
        path: 'word/missing-data.xml',
        message: 'DOCX relationship target is missing: word/missing-data.xml',
        fallback: 'preserve-relationship-metadata',
        recoverable: true
      },
      {
        code: 'DOCX_RELATIONSHIP_UNSUPPORTED',
        severity: 'warning',
        part: 'word/_rels/document.xml.rels',
        path: 'rIdCustom',
        message: 'DOCX relationship is not mapped yet: customXml',
        fallback: 'preserve-opaque-relationship',
        recoverable: true
      },
      {
        code: 'DOCX_RELATIONSHIP_UNSUPPORTED',
        severity: 'warning',
        part: 'word/_rels/document.xml.rels',
        path: 'rIdExternalOle',
        message: 'DOCX relationship is not mapped yet: oleObject',
        fallback: 'preserve-opaque-relationship',
        recoverable: true
      },
      {
        code: 'DOCX_PART_UNSUPPORTED',
        severity: 'warning',
        part: 'word/embeddings/oleObject1.bin',
        message: 'DOCX part is not mapped yet: word/embeddings/oleObject1.bin',
        fallback: 'preserve-opaque-part',
        recoverable: true
      },
      {
        code: 'DOCX_PART_UNSUPPORTED',
        severity: 'warning',
        part: 'customXml/item1.xml',
        message: 'DOCX part is not mapped yet: customXml/item1.xml',
        fallback: 'preserve-opaque-part',
        recoverable: true
      },
      {
        code: 'DOCX_ELEMENT_UNSUPPORTED',
        severity: 'warning',
        part: 'word/document.xml',
        path: 'body/customContent',
        message: 'DOCX element is not mapped yet: customContent',
        fallback: 'preserve-opaque-element',
        recoverable: true
      },
      {
        code: 'DOCX_STYLE_UNKNOWN',
        severity: 'warning',
        part: 'word/document.xml',
        path: 'run-1',
        message: 'DOCX run style is missing from styles index: MissingCharacterStyle',
        fallback: 'preserve-style-id',
        recoverable: true
      },
      {
        code: 'DOCX_STYLE_UNKNOWN',
        severity: 'warning',
        part: 'word/document.xml',
        path: 'paragraph-1',
        message: 'DOCX paragraph style is missing from styles index: MissingStyle',
        fallback: 'preserve-style-id',
        recoverable: true
      }
    ])
    expect(result.document.sections[0]?.blocks[0]).toMatchObject({
      kind: 'paragraph',
      id: 'paragraph-1',
      styleId: 'MissingStyle',
      runs: [
        {
          kind: 'run',
          id: 'run-1',
          properties: {
            styleId: 'MissingCharacterStyle'
          },
          inlines: [
            {
              kind: 'text',
              text: 'Opaque text'
            }
          ]
        }
      ]
    })
    expect(result.document.opaque).toMatchObject({
      unsupportedParts: [
        {
          part: 'word/embeddings/oleObject1.bin',
          contentType: 'application/vnd.openxmlformats-officedocument.oleObject',
          bytes: [1, 2, 3],
          unsafeToPreserveAfterEdit: true
        },
        {
          part: 'customXml/item1.xml',
          contentType: 'application/xml',
          text: '<root><value>Opaque</value></root>',
          unsafeToPreserveAfterEdit: true
        }
      ],
      unsupportedRelationships: [
        {
          id: 'rIdCustom',
          kind: 'customXml',
          target: 'customXml/item1.xml',
          sourcePart: 'word/document.xml',
          unsafeToPreserveAfterEdit: true
        },
        {
          id: 'rIdExternalOle',
          kind: 'oleObject',
          target: 'https://example.com/ole',
          targetMode: 'External',
          sourcePart: 'word/document.xml',
          unsafeToPreserveAfterEdit: true
        }
      ],
      unsupportedElementFragments: [
        {
          part: 'word/document.xml',
          path: 'body/customContent',
          xml: '<w:customContent w:val="opaque"/>',
          unsafeToPreserveAfterEdit: true
        }
      ],
      originalStyleIds: ['Normal'],
      originalNumberingIds: []
    })
  })

  it('warns and preserves track changes revision metadata without importing edits silently', async () => {
    const bytes = await createDocxRevisionPackage()
    const result = await importDocx(bytes, {
      requestId: 'docx-import-revisions-1'
    })

    expect(result.warnings).toEqual([
      {
        code: 'DOCX_REVISION_METADATA_UNSUPPORTED',
        severity: 'warning',
        part: 'word/document.xml',
        path: 'paragraph-1/ins',
        message: 'DOCX revision metadata is preserved but not imported yet: ins',
        fallback: 'preserve-opaque-revision',
        recoverable: true
      },
      {
        code: 'DOCX_REVISION_METADATA_UNSUPPORTED',
        severity: 'warning',
        part: 'word/document.xml',
        path: 'paragraph-1/del',
        message: 'DOCX revision metadata is preserved but not imported yet: del',
        fallback: 'preserve-opaque-revision',
        recoverable: true
      }
    ])
    expect(result.document.sections[0]?.blocks[0]).toMatchObject({
      kind: 'paragraph',
      id: 'paragraph-1',
      runs: [
        {
          kind: 'run',
          id: 'run-1',
          inlines: [
            {
              kind: 'text',
              text: 'Stable'
            }
          ]
        }
      ]
    })
    expect(result.document.opaque.unsupportedElementFragments).toEqual([
      {
        part: 'word/document.xml',
        path: 'paragraph-1/ins',
        xml: '<w:ins w:id="1" w:author="Alice" w:date="2026-05-25T00:00:00Z"><w:r><w:t>Inserted</w:t></w:r></w:ins>',
        unsafeToPreserveAfterEdit: true
      },
      {
        part: 'word/document.xml',
        path: 'paragraph-1/del',
        xml: '<w:del w:id="2" w:author="Bob" w:date="2026-05-25T00:01:00Z"><w:r><w:delText>Deleted</w:delText></w:r></w:del>',
        unsafeToPreserveAfterEdit: true
      }
    ])
  })

  it('warns for unsupported formatting while preserving degradable paragraph properties', async () => {
    const bytes = await createDocxUnsupportedFormattingPackage()
    const result = await importDocx(bytes, {
      requestId: 'docx-import-format-warnings-1'
    })

    expect(result.warnings).toEqual([
      {
        code: 'DOCX_NUMBERING_FORMAT_UNSUPPORTED',
        severity: 'warning',
        part: 'word/numbering.xml',
        path: 'abstractNum-1/level-0',
        message: 'DOCX numbering format is not fully supported yet: lowerLetter',
        fallback: 'preserve-numbering-metadata',
        recoverable: true
      },
      {
        code: 'DOCX_RUN_PROPERTY_UNSUPPORTED',
        severity: 'warning',
        part: 'word/document.xml',
        path: 'run-1/smallCaps',
        message: 'DOCX run property is not mapped yet: smallCaps',
        fallback: 'preserve-run-text',
        recoverable: true
      },
      {
        code: 'DOCX_PARAGRAPH_PROPERTY_UNSUPPORTED',
        severity: 'warning',
        part: 'word/document.xml',
        path: 'paragraph-1/textDirection',
        message: 'DOCX paragraph property is not mapped yet: textDirection',
        fallback: 'preserve-paragraph-content',
        recoverable: true
      }
    ])
    expect(result.document.sections[0]?.blocks[0]).toMatchObject({
      kind: 'paragraph',
      properties: {
        keepWithNext: true,
        keepLines: true,
        widowControl: false,
        listNumberingId: '5',
        listLevel: 0
      },
      runs: [
        {
          inlines: [
            {
              kind: 'text',
              text: 'Unsupported formatting'
            }
          ]
        }
      ]
    })
    expect(result.document.opaque.originalNumberingIds).toEqual(['1', '5'])
  })
})

/** 创建公开 API 测试使用的最小只读文档投影。 */
function createProjection(): DocumentProjection {
  return {
    document: {
      kind: 'document',
      id: 'document-empty',
      sections: []
    }
  }
}

/** 创建带 data URL 图片资源的最小只读文档投影。 */
function createProjectionWithPngResource(): DocumentProjection {
  return {
    document: {
      kind: 'document',
      id: 'document-export',
      resources: [
        {
          kind: 'resource',
          id: 'resource-png-1',
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
              id: 'paragraph-1',
              runs: [
                {
                  kind: 'run',
                  id: 'run-1',
                  inlines: [
                    {
                      kind: 'text',
                      text: 'Hello export'
                    },
                    {
                      kind: 'image',
                      resourceId: 'resource-png-1',
                      alt: 'Exported image',
                      display: 'inline',
                      widthTwips: 1440,
                      heightTwips: 1440
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

/** 计算二进制内容的 SHA-256 十六进制摘要。 */
function createSha256Hex(bytes: ArrayBuffer): string {
  return createHash('sha256').update(Buffer.from(bytes)).digest('hex')
}

/** 创建覆盖 T1 export roundtrip 的只读文档投影。 */
function createStyledTextProjection(): DocumentProjection {
  return {
    document: {
      kind: 'document',
      id: 'document-styled-export',
      sections: [
        {
          kind: 'section',
          id: 'section-1',
          blocks: [
            {
              kind: 'paragraph',
              id: 'paragraph-1',
              styleId: 'Heading1',
              properties: {
                alignment: 'center',
                spacingBeforeTwips: 240,
                spacingAfterTwips: 120,
                indentLeftTwips: 720,
                firstLineIndentTwips: 360
              },
              runs: [
                {
                  kind: 'run',
                  id: 'run-1',
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
                      text: 'A & B <tag>'
                    },
                    {
                      kind: 'text',
                      text: '\t'
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
                  id: 'run-2',
                  properties: {
                    subscript: true
                  },
                  inlines: [
                    {
                      kind: 'text',
                      text: 'Below'
                    }
                  ]
                }
              ]
            },
            {
              kind: 'paragraph',
              id: 'paragraph-2',
              styleId: 'Heading2',
              runs: [
                {
                  kind: 'run',
                  id: 'run-1',
                  inlines: [
                    {
                      kind: 'text',
                      text: 'Second heading'
                    }
                  ]
                }
              ]
            },
            {
              kind: 'paragraph',
              id: 'paragraph-3',
              styleId: 'Heading3',
              runs: [
                {
                  kind: 'run',
                  id: 'run-1',
                  inlines: [
                    {
                      kind: 'text',
                      text: 'Third heading'
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

/** 创建测试用最小 DOCX OPC package。 */
async function createMinimalDocxPackage(): Promise<ArrayBuffer> {
  return createZip({
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
      '<w:body><w:p><w:r><w:t>Hello</w:t></w:r></w:p></w:body>',
      '</w:document>'
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
    ].join('')
  })
}

/** 创建内存 zip，测试不读取磁盘 fixture。 */
async function createZip(parts: Readonly<Record<string, string | Uint8Array>>): Promise<ArrayBuffer> {
  const zip = new JSZip()

  for (const [name, content] of Object.entries(parts)) {
    zip.file(name, content)
  }

  return zip.generateAsync({ type: 'arraybuffer' })
}

/** 创建带 indexes 和 middle model 覆盖的 DOCX package。 */
async function createDocxIndexPackage(): Promise<ArrayBuffer> {
  return createZip({
    '[Content_Types].xml': [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>',
      '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>',
      '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>',
      '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>',
      '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>',
      '<Override PartName="/word/media/image1.png" ContentType="image/png"/>',
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
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
      '<w:body>',
      '<w:p>',
      '<w:pPr>',
      '<w:pStyle w:val="BodyText"/>',
      '<w:numPr><w:ilvl w:val="1"/><w:numId w:val="5"/></w:numPr>',
      '<w:jc w:val="center"/>',
      '<w:spacing w:before="240" w:after="120"/>',
      '<w:ind w:left="720" w:firstLine="360"/>',
      '</w:pPr>',
      '<w:r><w:t>Hello</w:t></w:r>',
      '<w:r>',
      '<w:rPr>',
      '<w:b/>',
      '<w:i/>',
      '<w:u w:val="single"/>',
      '<w:strike/>',
      '<w:color w:val="C00000"/>',
      '<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Arial" w:cs="Arial"/>',
      '<w:sz w:val="32"/>',
      '<w:shd w:fill="FFF59D"/>',
      '<w:vertAlign w:val="superscript"/>',
      '</w:rPr>',
      '<w:t> Styled</w:t>',
      '<w:tab/>',
      '<w:t>Text</w:t>',
      '<w:br/>',
      '<w:t>Next</w:t>',
      '</w:r>',
      '<w:hyperlink r:id="rIdLink1">',
      '<w:r><w:t>Link</w:t></w:r>',
      '</w:hyperlink>',
      '<w:commentRangeStart w:id="0"/>',
      '<w:r><w:t>Commented</w:t></w:r>',
      '<w:commentRangeEnd w:id="0"/>',
      '<w:r><w:commentReference w:id="0"/></w:r>',
      '</w:p>',
      '<w:sectPr>',
      '<w:headerReference r:id="rIdHeader1" w:type="default"/>',
      '<w:footerReference r:id="rIdFooter1" w:type="default"/>',
      '</w:sectPr>',
      '</w:body>',
      '</w:document>'
    ].join(''),
    'word/_rels/document.xml.rels': [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
      '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
      '<Relationship Id="rIdNumbering" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>',
      '<Relationship Id="rIdComments" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/>',
      '<Relationship Id="rIdHeader1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>',
      '<Relationship Id="rIdFooter1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>',
      '<Relationship Id="rIdImage1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>',
      '<Relationship Id="rIdLink1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com" TargetMode="External"/>',
      '</Relationships>'
    ].join(''),
    'word/styles.xml': [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
      '<w:style w:type="paragraph" w:styleId="BodyText">',
      '<w:name w:val="Body Text"/>',
      '<w:basedOn w:val="Normal"/>',
      '</w:style>',
      '<w:style w:type="character" w:styleId="Accent">',
      '<w:name w:val="Accent"/>',
      '</w:style>',
      '</w:styles>'
    ].join(''),
    'word/numbering.xml': [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
      '<w:abstractNum w:abstractNumId="1">',
      '<w:lvl w:ilvl="0">',
      '<w:numFmt w:val="bullet"/>',
      '<w:lvlText w:val="•"/>',
      '<w:start w:val="1"/>',
      '</w:lvl>',
      '</w:abstractNum>',
      '<w:num w:numId="5">',
      '<w:abstractNumId w:val="1"/>',
      '</w:num>',
      '</w:numbering>'
    ].join(''),
    'word/comments.xml': [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
      '<w:comment w:id="0" w:author="JWord" w:date="2026-05-25T00:00:00Z">',
      '<w:p><w:r><w:t>Index note</w:t></w:r></w:p>',
      '</w:comment>',
      '</w:comments>'
    ].join(''),
    'word/header1.xml': [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>'
    ].join(''),
    'word/footer1.xml': [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>'
    ].join(''),
    'word/media/image1.png': new Uint8Array([137, 80, 78, 71])
  })
}

/** 创建包含页设置和分页符的 DOCX package。 */
async function createDocxPageSetupPackage(): Promise<ArrayBuffer> {
  return createZip({
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
      '<w:p>',
      '<w:r><w:t>First page</w:t></w:r>',
      '</w:p>',
      '<w:p>',
      '<w:r>',
      '<w:t>Page break</w:t>',
      '<w:br w:type="page"/>',
      '<w:t>After break</w:t>',
      '</w:r>',
      '</w:p>',
      '<w:sectPr>',
      '<w:type w:val="nextPage"/>',
      '<w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/>',
      '<w:pgMar w:top="1800" w:right="1440" w:bottom="1080" w:left="1800" w:header="720" w:footer="720" w:gutter="0"/>',
      '</w:sectPr>',
      '</w:body>',
      '</w:document>'
    ].join('')
  })
}

/** 创建包含基础页眉文本和页脚页码字段的 DOCX package。 */
async function createDocxHeaderFooterTextPackage(): Promise<ArrayBuffer> {
  return createZip({
    '[Content_Types].xml': [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
      '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>',
      '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>',
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
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
      '<w:body>',
      '<w:p><w:r><w:t>Body</w:t></w:r></w:p>',
      '<w:sectPr>',
      '<w:headerReference r:id="rIdHeader1" w:type="default"/>',
      '<w:footerReference r:id="rIdFooter1" w:type="default"/>',
      '<w:pgNumType w:start="3"/>',
      '</w:sectPr>',
      '</w:body>',
      '</w:document>'
    ].join(''),
    'word/_rels/document.xml.rels': [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
      '<Relationship Id="rIdHeader1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>',
      '<Relationship Id="rIdFooter1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>',
      '</Relationships>'
    ].join(''),
    'word/header1.xml': [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
      '<w:p><w:r><w:t>Imported header</w:t></w:r></w:p>',
      '</w:hdr>'
    ].join(''),
    'word/footer1.xml': [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
      '<w:p>',
      '<w:r><w:fldChar w:fldCharType="begin"/></w:r>',
      '<w:r><w:instrText> PAGE </w:instrText></w:r>',
      '<w:r><w:fldChar w:fldCharType="end"/></w:r>',
      '</w:p>',
      '</w:ftr>'
    ].join('')
  })
}

/** 创建包含段落级分节和不支持 section 设置的 DOCX package。 */
async function createDocxParagraphSectionPackage(): Promise<ArrayBuffer> {
  return createZip({
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
      '<w:p>',
      '<w:pPr>',
      '<w:sectPr>',
      '<w:type w:val="continuous"/>',
      '<w:pgSz w:w="11906" w:h="16838" w:orient="landscape"/>',
      '</w:sectPr>',
      '</w:pPr>',
      '<w:r><w:t>First section</w:t></w:r>',
      '</w:p>',
      '<w:p>',
      '<w:r><w:t>Second section</w:t></w:r>',
      '</w:p>',
      '<w:sectPr>',
      '<w:type w:val="oddPage"/>',
      '<w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/>',
      '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>',
      '<w:cols w:num="2"/>',
      '</w:sectPr>',
      '</w:body>',
      '</w:document>'
    ].join('')
  })
}

/** 创建包含基础表格的 DOCX package。 */
async function createDocxTablePackage(): Promise<ArrayBuffer> {
  return createZip({
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
      '<w:tbl>',
      '<w:tblPr>',
      '<w:tblBorders>',
      '<w:top w:val="single" w:sz="4" w:color="C0C0C0"/>',
      '<w:left w:val="single" w:sz="4" w:color="C0C0C0"/>',
      '<w:bottom w:val="single" w:sz="4" w:color="C0C0C0"/>',
      '<w:right w:val="single" w:sz="4" w:color="C0C0C0"/>',
      '<w:insideH w:val="single" w:sz="4" w:color="C0C0C0"/>',
      '<w:insideV w:val="single" w:sz="4" w:color="C0C0C0"/>',
      '</w:tblBorders>',
      '</w:tblPr>',
      '<w:tblGrid>',
      '<w:gridCol w:w="1600"/>',
      '<w:gridCol w:w="1600"/>',
      '<w:gridCol w:w="1600"/>',
      '</w:tblGrid>',
      '<w:tr>',
      '<w:tc>',
      '<w:tcPr><w:gridSpan w:val="2"/></w:tcPr>',
      '<w:p><w:r><w:t>Left</w:t></w:r></w:p>',
      '</w:tc>',
      '<w:tc>',
      '<w:p><w:r><w:t>Right</w:t></w:r></w:p>',
      '</w:tc>',
      '</w:tr>',
      '</w:tbl>',
      '<w:sectPr/>',
      '</w:body>',
      '</w:document>'
    ].join('')
  })
}

/** 创建包含 inline 图、外链图和浮动图的 DOCX package。 */
async function createDocxImagePackage(): Promise<ArrayBuffer> {
  return createZip({
    '[Content_Types].xml': [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
      '<Override PartName="/word/media/image1.png" ContentType="image/png"/>',
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
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
      '<w:body>',
      '<w:p>',
      '<w:r>',
      '<w:drawing>',
      '<wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" distT="0" distB="0" distL="0" distR="0">',
      '<wp:extent cx="2286000" cy="1143000"/>',
      '<wp:docPr id="1" name="Inline" descr="Inline image"/>',
      '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">',
      '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">',
      '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">',
      '<pic:blipFill>',
      '<a:blip r:embed="rIdImage1"/>',
      '</pic:blipFill>',
      '</pic:pic>',
      '</a:graphicData>',
      '</a:graphic>',
      '</wp:inline>',
      '</w:drawing>',
      '</w:r>',
      '</w:p>',
      '<w:p>',
      '<w:r>',
      '<w:drawing>',
      '<wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" distT="0" distB="0" distL="0" distR="0">',
      '<wp:extent cx="1524000" cy="762000"/>',
      '<wp:docPr id="2" name="External" descr="External image"/>',
      '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">',
      '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">',
      '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">',
      '<pic:blipFill>',
      '<a:blip r:link="rIdExternalImage"/>',
      '</pic:blipFill>',
      '</pic:pic>',
      '</a:graphicData>',
      '</a:graphic>',
      '</wp:inline>',
      '</w:drawing>',
      '</w:r>',
      '</w:p>',
      '<w:p>',
      '<w:r>',
      '<w:drawing>',
      '<wp:anchor xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" simplePos="0" relativeHeight="0" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">',
      '<wp:extent cx="1524000" cy="762000"/>',
      '<wp:docPr id="3" name="Floating" descr="Floating image"/>',
      '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">',
      '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">',
      '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">',
      '<pic:blipFill>',
      '<a:blip r:embed="rIdImage1"/>',
      '</pic:blipFill>',
      '</pic:pic>',
      '</a:graphicData>',
      '</a:graphic>',
      '</wp:anchor>',
      '</w:drawing>',
      '</w:r>',
      '</w:p>',
      '</w:body>',
      '</w:document>'
    ].join(''),
    'word/_rels/document.xml.rels': [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
      '<Relationship Id="rIdImage1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>',
      '<Relationship Id="rIdExternalImage" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="https://example.com/external.png" TargetMode="External"/>',
      '</Relationships>'
    ].join(''),
    'word/media/image1.png': new Uint8Array([137, 80, 78, 71])
  })
}

/** 创建包含 T3 unsupported 内容的 DOCX package。 */
async function createDocxOpaquePackage(): Promise<ArrayBuffer> {
  return createZip({
    '[Content_Types].xml': [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>',
      '<Override PartName="/word/embeddings/oleObject1.bin" ContentType="application/vnd.openxmlformats-officedocument.oleObject"/>',
      '<Override PartName="/customXml/item1.xml" ContentType="application/xml"/>',
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
      '<w:customContent w:val="opaque"/>',
      '<w:p>',
      '<w:pPr><w:pStyle w:val="MissingStyle"/></w:pPr>',
      '<w:r><w:rPr><w:rStyle w:val="MissingCharacterStyle"/></w:rPr><w:t>Opaque text</w:t></w:r>',
      '</w:p>',
      '</w:body>',
      '</w:document>'
    ].join(''),
    'word/_rels/document.xml.rels': [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
      '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
      '<Relationship Id="rIdCustom" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml" Target="../customXml/item1.xml"/>',
      '<Relationship Id="rIdExternalOle" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject" Target="https://example.com/ole" TargetMode="External"/>',
      '<Relationship Id="rIdMissing" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml" Target="missing-data.xml"/>',
      '</Relationships>'
    ].join(''),
    'word/styles.xml': [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
      '<w:style w:type="paragraph" w:styleId="Normal" w:default="1">',
      '<w:name w:val="Normal"/>',
      '</w:style>',
      '</w:styles>'
    ].join(''),
    'word/embeddings/oleObject1.bin': new Uint8Array([1, 2, 3]),
    'customXml/item1.xml': '<root><value>Opaque</value></root>'
  })
}

/** 创建包含未支持格式属性和复杂编号格式的 DOCX package。 */
async function createDocxUnsupportedFormattingPackage(): Promise<ArrayBuffer> {
  return createZip({
    '[Content_Types].xml': [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
      '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>',
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
      '<w:p>',
      '<w:pPr>',
      '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="5"/></w:numPr>',
      '<w:keepNext/>',
      '<w:keepLines/>',
      '<w:widowControl w:val="0"/>',
      '<w:textDirection w:val="tbRl"/>',
      '</w:pPr>',
      '<w:r>',
      '<w:rPr><w:smallCaps/></w:rPr>',
      '<w:t>Unsupported formatting</w:t>',
      '</w:r>',
      '</w:p>',
      '</w:body>',
      '</w:document>'
    ].join(''),
    'word/_rels/document.xml.rels': [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
      '<Relationship Id="rIdNumbering" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>',
      '</Relationships>'
    ].join(''),
    'word/numbering.xml': [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
      '<w:abstractNum w:abstractNumId="1">',
      '<w:lvl w:ilvl="0">',
      '<w:numFmt w:val="lowerLetter"/>',
      '<w:lvlText w:val="%1."/>',
      '<w:start w:val="1"/>',
      '</w:lvl>',
      '</w:abstractNum>',
      '<w:num w:numId="5">',
      '<w:abstractNumId w:val="1"/>',
      '</w:num>',
      '</w:numbering>'
    ].join('')
  })
}

/** 创建包含修订 metadata 的 DOCX package。 */
async function createDocxRevisionPackage(): Promise<ArrayBuffer> {
  return createZip({
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
      '<w:p>',
      '<w:r><w:t>Stable</w:t></w:r>',
      '<w:ins w:id="1" w:author="Alice" w:date="2026-05-25T00:00:00Z">',
      '<w:r><w:t>Inserted</w:t></w:r>',
      '</w:ins>',
      '<w:del w:id="2" w:author="Bob" w:date="2026-05-25T00:01:00Z">',
      '<w:r><w:delText>Deleted</w:delText></w:r>',
      '</w:del>',
      '</w:p>',
      '</w:body>',
      '</w:document>'
    ].join('')
  })
}
