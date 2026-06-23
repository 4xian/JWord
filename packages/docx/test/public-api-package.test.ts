/**
 * @vitest-environment node
 *
 * 职责：验证 @4xian/jword-docx public API package graph。
 * 边界：只覆盖拆分后的 focused public API 行为，不扩大 Gate 5 功能范围。
 * 协作模块：packages/docx/src/index.ts、fixtures helper 和 Gate 5 兼容验证复用这些契约。
 * 约束：测试文件保持小体量，避免一个 public API 文件承载全部 DOCX 纵线。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#gate-5docx-导入导出与-pdf-导出。
 */

import { describe, expect, it } from 'vitest'

import {
  createDocxIndexes,
  inspectDocxPackage
} from '../src/index'
import {
  createDocxPublicApiLicense,
  createDocxIndexPackage,
  createMinimalDocxPackage,
  createZip
} from './public-api-fixtures'

describe('@4xian/jword-docx public API package graph', () => {
  it('inspects the minimal OPC package graph without writing to JWord', async () => {
    const bytes = await createMinimalDocxPackage()
    const result = await inspectDocxPackage(bytes, {
      requestId: 'docx-inspect-2',
      license: createDocxPublicApiLicense(['docx.import'])
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
      requestId: 'docx-invalid-zip',
      license: createDocxPublicApiLicense(['docx.import'])
    })).rejects.toMatchObject({
      name: 'DocxPackageError',
      code: 'DOCX_PACKAGE_INVALID',
      requestId: 'docx-invalid-zip'
    })
    await expect(inspectDocxPackage(await createZip({}), {
      requestId: 'docx-missing-content-types',
      license: createDocxPublicApiLicense(['docx.import'])
    })).rejects.toMatchObject({
      name: 'DocxPackageError',
      code: 'DOCX_CONTENT_TYPES_MISSING',
      requestId: 'docx-missing-content-types'
    })
    await expect(inspectDocxPackage(await createZip({
      '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
      '_rels/.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>'
    }), {
      requestId: 'docx-missing-document',
      license: createDocxPublicApiLicense(['docx.import'])
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
      requestId: 'docx-broken-optional-rel',
      license: createDocxPublicApiLicense(['docx.import'])
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
      requestId: 'docx-indexes-1',
      license: createDocxPublicApiLicense(['docx.import'])
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
})
