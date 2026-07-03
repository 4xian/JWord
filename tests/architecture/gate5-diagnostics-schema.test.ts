/**
 * @vitest-environment node
 *
 * 职责：验证 Gate 5 DOCX/PDF warning/error code 具备统一 schema registry。
 * 边界：只检查公开 registry 和源码诊断 code 覆盖，不执行 DOCX/PDF 导入导出。
 * 协作模块：packages/docx、packages/pdf 的公开诊断类型和后续 fixture 矩阵复用这些 code。
 * 约束：新增诊断 code 必须先进入 registry，避免 warning/error 字段漂移或口头约定。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#step-54建立统一-warningerror-schema。
 */

import { readFileSync } from 'node:fs'

import {
  createFontManager,
  createPageConfig,
  layoutDocument
} from '@4xian/jword-core'
import { createJWordLicenseSignature, type JWordLicenseEntitlement, type JWordLicenseSignaturePayload } from '@4xian/jword-license'
import JSZip from 'jszip'
import {
  DOCX_ERROR_CODE_METADATA,
  DOCX_WARNING_CODE_METADATA,
  importDocx
} from '../../packages/docx/src/index'
import type {
  DocxError,
  DocxWarning
} from '../../packages/docx/src/index'
import {
  PDF_ERROR_CODE_METADATA,
  PDF_WARNING_CODE_METADATA,
  exportPdfFromLayout
} from '../../packages/pdf/src/index'
import type {
  PdfError,
  PdfWarning
} from '../../packages/pdf/src/index'
import { describe, expect, it } from 'vitest'

describe('Gate 5 diagnostics schema', () => {
  it('registers every DOCX warning and error code used by package source', () => {
    const sourceCodes = readDiagnosticCodes('DOCX', [
      'packages/docx/src/index.ts',
      'packages/docx/src/export.ts',
      'packages/docx/src/import.ts',
      'packages/docx/src/import-readers.ts',
      'packages/docx/src/import-sections.ts',
      'packages/docx/src/messages.ts',
      'packages/docx/src/package.ts',
      'packages/docx/src/worker.ts'
    ])
    const registryCodes = readRegistryCodes(DOCX_WARNING_CODE_METADATA, DOCX_ERROR_CODE_METADATA)

    expect(sourceCodes).toEqual(registryCodes)
    expect(Object.values(DOCX_WARNING_CODE_METADATA).every(hasWarningMetadata)).toBe(true)
    expect(Object.values(DOCX_ERROR_CODE_METADATA).every(hasErrorMetadata)).toBe(true)
  })

  it('registers every PDF warning and error code used by package source', () => {
    const sourceCodes = readDiagnosticCodes('PDF', [
      'packages/pdf/src/index.ts',
      'packages/pdf/src/worker.ts'
    ])
    const registryCodes = readRegistryCodes(PDF_WARNING_CODE_METADATA, PDF_ERROR_CODE_METADATA)

    expect(sourceCodes).toEqual(registryCodes)
    expect(Object.values(PDF_WARNING_CODE_METADATA).every(hasWarningMetadata)).toBe(true)
    expect(Object.values(PDF_ERROR_CODE_METADATA).every(hasErrorMetadata)).toBe(true)
  })

  it('keeps DOCX and PDF fixture expected warnings aligned with public diagnostic codes', () => {
    const docxRegistry = readFixtureRegistry('fixtures/docx/registry.json')
    const pdfRegistry = readFixtureRegistry('fixtures/pdf/registry.json')
    const publicCodes = new Map<string, Gate5DiagnosticCodeMetadata>([
      ...Object.entries(DOCX_WARNING_CODE_METADATA),
      ...Object.entries(DOCX_ERROR_CODE_METADATA),
      ...Object.entries(PDF_WARNING_CODE_METADATA),
      ...Object.entries(PDF_ERROR_CODE_METADATA)
    ])

    for (const warning of [...readExpectedWarnings(docxRegistry), ...readExpectedWarnings(pdfRegistry)]) {
      const metadata = publicCodes.get(warning.code)

      expect(metadata, `${warning.fixtureId}:${warning.code}`).toBeDefined()
      expect(warning.severity).toBe(metadata?.severity)
      expect(warning.recoverable).toBe(metadata?.recoverable)
      if (metadata?.fallback !== undefined) {
        expect(warning.fallback).toBe(metadata.fallback)
      }
    }
  })

  it('keeps runtime warning fields aligned with public diagnostic metadata', async () => {
    const docxResult = await importDocx(await createDiagnosticDocxPackage(), {
      license: createGate5DiagnosticsLicense(['docx.import'])
    })
    const pdfWarnings: PdfWarning[] = []
    const pdfResult = await exportPdfFromLayout(createDiagnosticPdfLayout(), {
      license: createGate5DiagnosticsLicense(['pdf.export']),
      fonts: [{
        family: 'BrokenFont',
        source: {
          kind: 'arrayBuffer',
          data: new ArrayBuffer(0)
        }
      }],
      onWarning: (warning) => {
        pdfWarnings.push(warning)
      }
    })

    expect(docxResult.warnings.map((warning) => warning.code)).toEqual(expect.arrayContaining([
      'DOCX_RELATIONSHIP_TARGET_MISSING',
      'DOCX_ELEMENT_UNSUPPORTED',
      'DOCX_STYLE_UNKNOWN',
      'DOCX_IMAGE_EXTERNAL_UNSUPPORTED',
      'DOCX_DRAWING_FLOATING_UNSUPPORTED'
    ]))
    expect(pdfResult.warnings).toEqual(pdfWarnings)
    expect(pdfWarnings.map((warning) => warning.code)).toEqual(['PDF_FONT_MISSING'])

    expectWarningsMatchMetadata(docxResult.warnings, DOCX_WARNING_CODE_METADATA)
    expectWarningsMatchMetadata(pdfWarnings, PDF_WARNING_CODE_METADATA)
  })

  it('keeps runtime error codes registered in public diagnostic metadata', async () => {
    const docxController = new AbortController()
    const pdfController = new AbortController()

    docxController.abort()
    pdfController.abort()

    const docxCancelled = await captureRejected<DocxError>(() => importDocx(new ArrayBuffer(0), {
      requestId: 'docx-diagnostic-cancel',
      signal: docxController.signal
    }))
    const pdfCancelled = await captureRejected<PdfError>(() => exportPdfFromLayout(createDiagnosticPdfLayout(), {
      requestId: 'pdf-diagnostic-cancel',
      signal: pdfController.signal
    }))
    const pdfMissingFont = await captureRejected<PdfError>(() => exportPdfFromLayout(createChineseDiagnosticPdfLayout(), {
      requestId: 'pdf-diagnostic-font-missing',
      license: createGate5DiagnosticsLicense(['pdf.export'])
    }))

    expect(Object.keys(DOCX_ERROR_CODE_METADATA)).toContain(docxCancelled.code)
    expect(Object.keys(PDF_ERROR_CODE_METADATA)).toContain(pdfCancelled.code)
    expect(Object.keys(PDF_ERROR_CODE_METADATA)).toContain(pdfMissingFont.code)
  })
})

/** 创建 Gate 5 diagnostics 运行时测试使用的有效授权。 */
function createGate5DiagnosticsLicense(features: readonly string[]): JWordLicenseEntitlement {
  const entitlement: JWordLicenseSignaturePayload = {
    customerId: 'customer-gate5-diagnostics',
    licenseToken: 'token-gate5-diagnostics',
    features,
    issuer: 'jword-test-issuer',
    issuedAt: '2026-05-01T00:00:00Z',
    expiresAt: '2099-06-01T00:00:00Z',
    status: 'valid'
  }

  return {
    ...entitlement,
    signature: createJWordLicenseSignature(entitlement)
  }
}

interface Gate5DiagnosticCodeMetadata {
  readonly severity?: string
  readonly description?: string
  readonly recoverable?: boolean
  readonly fallback?: string
}

interface Gate5FixtureRegistry {
  readonly fixtures: readonly Gate5Fixture[]
}

interface Gate5Fixture {
  readonly id: string
  readonly expectedWarnings?: readonly Gate5FixtureExpectedWarning[]
}

interface Gate5FixtureExpectedWarning {
  readonly code: string
  readonly severity: string
  readonly recoverable: boolean
  readonly fallback?: string
}

interface Gate5FixtureExpectedWarningWithFixture extends Gate5FixtureExpectedWarning {
  readonly fixtureId: string
}

/** 读取源码中出现的稳定诊断 code。 */
function readDiagnosticCodes(prefix: 'DOCX' | 'PDF', paths: readonly string[]): readonly string[] {
  const pattern = new RegExp(`'(${prefix}_[A-Z0-9_]+)'`, 'g')
  const codes = new Set<string>()

  for (const path of paths) {
    const source = readFileSync(path, 'utf8')
    for (const match of source.matchAll(pattern)) {
      codes.add(match[1] ?? '')
    }
  }

  return [...codes].filter(Boolean).sort()
}

/** 读取 fixture registry。 */
function readFixtureRegistry(path: string): Gate5FixtureRegistry {
  return JSON.parse(readFileSync(path, 'utf8')) as Gate5FixtureRegistry
}

/** 读取 registry 中声明的期望 warning。 */
function readExpectedWarnings(registry: Gate5FixtureRegistry): readonly Gate5FixtureExpectedWarningWithFixture[] {
  return registry.fixtures.flatMap((fixture) => {
    return (fixture.expectedWarnings ?? []).map((warning) => ({
      fixtureId: fixture.id,
      ...warning
    }))
  })
}

/** 合并 warning/error registry code。 */
function readRegistryCodes(
  warningRegistry: Record<string, unknown>,
  errorRegistry: Record<string, unknown>
): readonly string[] {
  return [...new Set([
    ...Object.keys(warningRegistry),
    ...Object.keys(errorRegistry)
  ])].sort()
}

/** 检查 warning code metadata 是否包含运行时 warning 必需字段。 */
function hasWarningMetadata(metadata: Gate5DiagnosticCodeMetadata): boolean {
  return metadata.severity === 'warning' &&
    typeof metadata.description === 'string' &&
    metadata.description.length > 0 &&
    typeof metadata.fallback === 'string' &&
    metadata.fallback.length > 0 &&
    typeof metadata.recoverable === 'boolean'
}

/** 检查 error code metadata 是否包含运行时 error 必需字段。 */
function hasErrorMetadata(metadata: Gate5DiagnosticCodeMetadata): boolean {
  return metadata.severity === 'error' &&
    typeof metadata.description === 'string' &&
    metadata.description.length > 0 &&
    typeof metadata.recoverable === 'boolean'
}

/** 校验运行时 warning 字段和公开 metadata 一致。 */
function expectWarningsMatchMetadata(
  warnings: readonly (DocxWarning | PdfWarning)[],
  registry: Record<string, Gate5DiagnosticCodeMetadata>
): void {
  for (const warning of warnings) {
    const metadata = registry[warning.code]

    expect(metadata, warning.code).toBeDefined()
    expect(warning.severity).toBe(metadata?.severity)
    expect(warning.recoverable).toBe(metadata?.recoverable)
    if (metadata?.fallback !== undefined) {
      expect(warning.fallback).toBe(metadata.fallback)
    }
  }
}

/** 捕获预期会 reject 的诊断错误。 */
async function captureRejected<TError>(run: () => Promise<unknown>): Promise<TError> {
  try {
    await run()
  } catch (error) {
    return error as TError
  }

  throw new Error('Expected promise to reject')
}

/** 创建覆盖 Step 5.4 warning 场景的最小 DOCX package。 */
async function createDiagnosticDocxPackage(): Promise<ArrayBuffer> {
  const zip = new JSZip()

  for (const [path, content] of Object.entries(createDiagnosticDocxParts())) {
    zip.file(path, content)
  }

  const bytes = await zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE'
  })
  const output = new ArrayBuffer(bytes.byteLength)

  new Uint8Array(output).set(bytes)

  return output
}

/** 创建覆盖 Step 5.4 warning 场景的最小 DOCX part 集合。 */
function createDiagnosticDocxParts(): Readonly<Record<string, string>> {
  return {
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
    'word/document.xml': [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">',
      '<w:body>',
      '<w:customContent w:val="diagnostic"/>',
      '<w:p>',
      '<w:pPr><w:pStyle w:val="MissingStyle"/></w:pPr>',
      '<w:r><w:rPr><w:rStyle w:val="MissingCharacterStyle"/></w:rPr><w:t>Diagnostics</w:t></w:r>',
      '</w:p>',
      '<w:p><w:r><w:drawing><wp:inline><wp:extent cx="914400" cy="914400"/><wp:docPr id="1" name="External" descr="External image"/><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:link="rIdExternalImage"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>',
      '<w:p><w:r><w:drawing><wp:anchor><wp:docPr id="2" name="Floating"/></wp:anchor></w:drawing></w:r></w:p>',
      '</w:body>',
      '</w:document>'
    ].join(''),
    'word/_rels/document.xml.rels': [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
      '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
      '<Relationship Id="rIdMissing" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml" Target="missing-data.xml"/>',
      '<Relationship Id="rIdExternalImage" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="https://example.com/external.png" TargetMode="External"/>',
      '</Relationships>'
    ].join(''),
    'word/styles.xml': [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
      '<w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="Normal"/></w:style>',
      '</w:styles>'
    ].join('')
  }
}

/** 创建触发 PDF warning 的 ASCII layout。 */
function createDiagnosticPdfLayout(): Parameters<typeof exportPdfFromLayout>[0] {
  return layoutDocument({
    projection: {
      document: {
        kind: 'document',
        id: 'document-diagnostic-pdf',
        sections: [
          {
            kind: 'section',
            id: 'section-diagnostic-pdf',
            blocks: [
              {
                kind: 'paragraph',
                id: 'paragraph-diagnostic-pdf',
                runs: [
                  {
                    kind: 'run',
                    id: 'run-diagnostic-pdf',
                    inlines: [
                      {
                        kind: 'text',
                        text: 'Diagnostics'
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

/** 创建触发 PDF 缺字体 error 的中文 layout。 */
function createChineseDiagnosticPdfLayout(): Parameters<typeof exportPdfFromLayout>[0] {
  return layoutDocument({
    projection: {
      document: {
        kind: 'document',
        id: 'document-diagnostic-pdf-font',
        sections: [
          {
            kind: 'section',
            id: 'section-diagnostic-pdf-font',
            blocks: [
              {
                kind: 'paragraph',
                id: 'paragraph-diagnostic-pdf-font',
                runs: [
                  {
                    kind: 'run',
                    id: 'run-diagnostic-pdf-font',
                    inlines: [
                      {
                        kind: 'text',
                        text: '中文诊断'
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
