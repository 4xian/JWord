/**
 * @vitest-environment node
 *
 * 职责：验证 @4xian/jword-docx public API basics。
 * 边界：只覆盖拆分后的 focused public API 行为，不扩大 Gate 5 功能范围。
 * 协作模块：packages/docx/src/index.ts、fixtures helper 和 Gate 5 兼容验证复用这些契约。
 * 约束：测试文件保持小体量，避免一个 public API 文件承载全部 DOCX 纵线。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#gate-5docx-导入导出与-pdf-导出。
 */

import JSZip from 'jszip'
import { describe, expect, expectTypeOf, it, vi } from 'vitest'

import type {
  DocxBinaryInput,
  DocxError,
  DocxProgressEvent,
  DocxProgressStage,
  DocxTransferable,
  DocxWarningEvent,
  ExportDocxOptions,
  ExportDocxRequest,
  ExportDocxResult,
  ImportDocxOptions,
  ImportDocxRequest,
  ImportDocxResult,
  InspectDocxPackageRequest
} from '../src/index'
import {
  createCancelDocxRequest,
  createDocxErrorEvent,
  createDocxProgressEvent,
  createDocxTransferables,
  exportDocx as exportDocxPublic,
  inspectDocxPackage,
  importDocx as importDocxPublic
} from '../src/index'
import {
  createDocxPublicApiLicense,
  createProjection,
  createProjectionWithPngResource,
  createSha256Hex,
  createStyledTextProjection
} from './public-api-fixtures'

/** 以有效授权调用 DOCX import，保持格式测试聚焦于导入行为。 */
function importDocx(input: DocxBinaryInput, options: ImportDocxOptions = {}): Promise<ImportDocxResult> {
  return importDocxPublic(input, {
    ...options,
    license: createDocxPublicApiLicense(['docx.import'])
  })
}

/** 以有效授权调用 DOCX export，保持格式测试聚焦于导出行为。 */
function exportDocx(
  projection: Parameters<typeof exportDocxPublic>[0],
  options: ExportDocxOptions = {}
): Promise<ExportDocxResult> {
  return exportDocxPublic(projection, {
    ...options,
    license: createDocxPublicApiLicense(['docx.export'])
  })
}

describe('@4xian/jword-docx public API basics', () => {
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
      requestId: 'docx-export-inspect-1',
      license: createDocxPublicApiLicense(['docx.import'])
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
})
