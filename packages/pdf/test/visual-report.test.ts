/**
 * @vitest-environment node
 *
 * 职责：验证 Gate 5 PDF.js 视觉报告入口能渲染 PDF canvas 并生成可复查差异。
 * 边界：只在显式 artifact 目录下保存截图二进制，不做真实浏览器人工验收、不覆盖中文字体嵌入。
 * 协作模块：PDF 导出入口、PDF.js renderer、JWord layout baseline 共同产出结构化报告。
 * 约束：测试先行，报告必须包含 page count、page size、文本框、图片框和表格线字段。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import {
  createFontManager,
  createPageConfig,
  layoutDocument
} from '@4xian/jword-core'
import {
  createInsecureTestOnlyJWordLicenseSignature,
  type JWordLicenseEntitlement
} from '@4xian/jword-license'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import type { ExportPdfOptions } from '../src/index'
import { exportPdfFromLayout as exportPdfFromLayoutPublic } from '../src/index'
import { INSECURE_TEST_ONLY_LICENSE_PRIVATE_KEY_SEED } from '../../../fixtures/license/insecure-test-only-keys'

/** 以有效授权调用 PDF export，保持视觉报告测试聚焦于渲染证据。 */
function exportPdfFromLayout(
  layout: Parameters<typeof exportPdfFromLayoutPublic>[0],
  options: ExportPdfOptions = {}
) {
  return exportPdfFromLayoutPublic(layout, {
    ...options,
    license: createVisualReportLicense()
  })
}

/** 创建视觉报告测试使用的有效授权。 */
function createVisualReportLicense(): JWordLicenseEntitlement {
  const entitlement = {
    customerId: 'customer-pdf-visual-test',
    licenseToken: 'token-pdf-visual-test',
    issuer: 'jword-pdf-visual-test',
    issuedAt: '2026-05-01T00:00:00Z',
    features: ['pdf.export'],
    expiresAt: '2099-06-01T00:00:00Z',
    status: 'valid' as const
  }

  return {
    ...entitlement,
    signature: createInsecureTestOnlyJWordLicenseSignature(entitlement, INSECURE_TEST_ONLY_LICENSE_PRIVATE_KEY_SEED)
  }
}

describe('PDF visual report', () => {
  it('renders exported PDF through PDF.js and compares it with the JWord layout baseline', async () => {
    const api = await import('../src/index') as typeof import('../src/index') & {
      readonly createPdfVisualReport?: CreatePdfVisualReport
    }
    const layout = createVisualTextLayout()
    const exportResult = await exportPdfFromLayout(layout)

    expect(typeof api.createPdfVisualReport).toBe('function')

    const report = await api.createPdfVisualReport(layout, exportResult.bytes, {
      fixtureId: 'pdf-basic-text',
      tolerancePoints: 1
    })

    expect(report).toMatchObject({
      fixtureId: 'pdf-basic-text',
      viewer: 'PDF.js',
      status: 'pass',
      tolerancePoints: 1,
      pageCount: {
        layout: 1,
        pdf: 1,
        passed: true
      }
    })
    expect(report.pages).toHaveLength(1)
    expect(report.pages[0]).toMatchObject({
      pageIndex: 0,
      renderedCanvas: {
        width: 360,
        height: 504,
        scale: 1,
        nonEmptyPixelCount: expect.any(Number)
      },
      pageSizeDelta: {
        widthPoints: 0,
        heightPoints: 0,
        passed: true
      },
      canvasBaseline: {
        textBoundingBoxes: expect.any(Array),
        imageBoundingBoxes: expect.any(Array),
        tableLineBounds: expect.any(Array)
      },
      pdfTextBoundingBoxes: expect.any(Array),
      textBoundingBoxDeltas: expect.any(Array),
      imageBoundingBoxDeltas: expect.any(Array),
      tableLineDeltas: expect.any(Array)
    })
    expect(report.pages[0]?.renderedCanvas.nonEmptyPixelCount).toBeGreaterThan(0)
    expect(report.pages[0]?.canvasBaseline.textBoundingBoxes.map((box) => box.text).join('')).toBe('Hello PDF')
    expect(report.pages[0]?.pdfTextBoundingBoxes.map((box) => box.text).join(' ')).toContain('Hello')
  })

  it('persists rendered page screenshots when an artifact directory is provided', async () => {
    const api = await import('../src/index') as typeof import('../src/index') & {
      readonly createPdfVisualReport?: CreatePdfVisualReport
    }
    const artifactDirectory = await mkdtemp(join(tmpdir(), 'jword-pdf-visual-'))
    const layout = createVisualTextLayout()
    const exportResult = await exportPdfFromLayout(layout)

    try {
      const report = await api.createPdfVisualReport?.(layout, exportResult.bytes, {
        artifactDirectory,
        fixtureId: 'pdf-basic-text',
        tolerancePoints: 1
      })

      const artifact = report?.pages[0]?.screenshotArtifact
      const canvasArtifact = report?.pages[0]?.jwordCanvasArtifact

      expect(artifact).toMatchObject({
        mimeType: 'image/png',
        width: 360,
        height: 504,
        scale: 1
      })
      expect(artifact?.path.startsWith(artifactDirectory)).toBe(true)
      expect(artifact?.byteLength).toBeGreaterThan(0)
      expect(canvasArtifact).toMatchObject({
        mimeType: 'image/png',
        width: 480,
        height: 672,
        scale: 1
      })
      expect(canvasArtifact?.path.startsWith(artifactDirectory)).toBe(true)
      expect(canvasArtifact?.byteLength).toBeGreaterThan(0)

      const artifactStat = await stat(artifact?.path ?? '')
      const bytes = await readFile(artifact?.path ?? '')
      const canvasBytes = await readFile(canvasArtifact?.path ?? '')

      expect(artifactStat.size).toBe(artifact?.byteLength)
      expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
      expect([...canvasBytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    } finally {
      await rm(artifactDirectory, { recursive: true, force: true })
    }
  })

  it('reports rendered pixel coverage for image boxes and table lines', async () => {
    const api = await import('../src/index') as typeof import('../src/index') & {
      readonly createPdfVisualReport?: CreatePdfVisualReport
    }
    const layout = createVisualTableImageLayout()
    const exportResult = await exportPdfFromLayout(layout, {
      images: [{
        kind: 'dataUrl',
        id: 'image-pdf-visual-inline-1',
        dataUrl: ONE_PIXEL_PNG_DATA_URL
      }]
    })

    const report = await api.createPdfVisualReport?.(layout, exportResult.bytes, {
      fixtureId: 'pdf-table-image',
      tolerancePoints: 1
    })
    const page = report?.pages[0]

    expect(report?.status).toBe('pass')
    expect(page?.canvasBaseline.imageBoundingBoxes).toHaveLength(1)
    expect(page?.canvasBaseline.tableLineBounds.length).toBeGreaterThan(0)
    expect(page?.pdfTextBoundingBoxes.map((box) => box.text).join(' ')).toContain('A1')
    expect(page?.pdfTextBoundingBoxes.map((box) => box.text).join(' ')).toContain('B1')
    expect(page?.imageBoundingBoxDeltas[0]).toMatchObject({
      expected: 1,
      actual: 1,
      passed: true,
      actualNonEmptyPixelCount: expect.any(Number),
      actualCoverageRatio: expect.any(Number)
    })
    expect(page?.imageBoundingBoxDeltas[0]?.actualNonEmptyPixelCount).toBeGreaterThan(0)
    expect(page?.tableLineDeltas.every((delta) => {
      return delta.actualNonEmptyPixelCount !== undefined &&
        delta.actualNonEmptyPixelCount > 0 &&
        delta.passed
    })).toBe(true)
  })
})

type CreatePdfVisualReport = (
  layout: Parameters<typeof exportPdfFromLayout>[0],
  bytes: ArrayBuffer,
  options: {
    readonly artifactDirectory?: string
    readonly fixtureId: string
    readonly tolerancePoints?: number
  }
) => Promise<{
  readonly fixtureId: string
  readonly viewer: 'PDF.js'
  readonly status: 'pass' | 'warn' | 'fail'
  readonly tolerancePoints: number
  readonly pageCount: {
    readonly layout: number
    readonly pdf: number
    readonly passed: boolean
  }
  readonly pages: readonly VisualReportPage[]
}>

interface VisualReportPage {
  readonly pageIndex: number
  readonly renderedCanvas: {
    readonly width: number
    readonly height: number
    readonly scale: number
    readonly nonEmptyPixelCount: number
  }
  readonly screenshotArtifact?: {
    readonly path: string
    readonly mimeType: 'image/png'
    readonly width: number
    readonly height: number
    readonly scale: number
    readonly byteLength: number
  }
  readonly jwordCanvasArtifact?: {
    readonly path: string
    readonly mimeType: 'image/png'
    readonly width: number
    readonly height: number
    readonly scale: number
    readonly byteLength: number
  }
  readonly pageSizeDelta: {
    readonly widthPoints: number
    readonly heightPoints: number
    readonly passed: boolean
  }
  readonly canvasBaseline: {
    readonly textBoundingBoxes: readonly { readonly text: string }[]
    readonly imageBoundingBoxes: readonly unknown[]
    readonly tableLineBounds: readonly unknown[]
  }
  readonly pdfTextBoundingBoxes: readonly { readonly text: string }[]
  readonly textBoundingBoxDeltas: readonly unknown[]
  readonly imageBoundingBoxDeltas: readonly VisualPixelDelta[]
  readonly tableLineDeltas: readonly VisualPixelDelta[]
}

interface VisualPixelDelta {
  readonly expected: number
  readonly actual: number
  readonly passed: boolean
  readonly actualNonEmptyPixelCount?: number
  readonly actualCoverageRatio?: number
}

/** 创建视觉报告测试用的基础英文 layout。 */
function createVisualTextLayout(): Parameters<typeof exportPdfFromLayout>[0] {
  return layoutDocument({
    projection: {
      document: {
        kind: 'document',
        id: 'document-pdf-visual-text',
        sections: [
          {
            kind: 'section',
            id: 'section-pdf-visual-text',
            blocks: [
              {
                kind: 'paragraph',
                id: 'paragraph-pdf-visual-text',
                runs: [
                  {
                    kind: 'run',
                    id: 'run-pdf-visual-text',
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

const ONE_PIXEL_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lYgWtwAAAABJRU5ErkJggg=='

/** 创建视觉报告测试用的图片和表格 layout。 */
function createVisualTableImageLayout(): Parameters<typeof exportPdfFromLayout>[0] {
  return layoutDocument({
    projection: {
      document: {
        kind: 'document',
        id: 'document-pdf-visual-table-image',
        resourceIds: ['image-pdf-visual-inline-1'],
        resources: [{
          kind: 'resource',
          id: 'image-pdf-visual-inline-1',
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
            id: 'section-pdf-visual-table-image',
            blocks: [
              {
                kind: 'paragraph',
                id: 'paragraph-pdf-visual-image',
                runs: [
                  {
                    kind: 'run',
                    id: 'run-pdf-visual-image',
                    inlines: [
                      {
                        kind: 'image',
                        resourceId: 'image-pdf-visual-inline-1',
                        widthTwips: 720,
                        heightTwips: 720
                      }
                    ]
                  }
                ]
              },
              {
                kind: 'table',
                id: 'table-pdf-visual-border',
                grid: [1440, 1440],
                border: {
                  color: '#336699',
                  widthTwips: 20
                },
                rows: [
                  {
                    id: 'row-pdf-visual-border-1',
                    cells: [
                      {
                        id: 'cell-pdf-visual-border-1',
                        blocks: [createVisualTableCellParagraph('A1')]
                      },
                      {
                        id: 'cell-pdf-visual-border-2',
                        blocks: [createVisualTableCellParagraph('B1')]
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

/** 创建视觉报告表格单元格段落。 */
function createVisualTableCellParagraph(text: string) {
  return {
    kind: 'paragraph' as const,
    id: `paragraph-pdf-visual-cell-${text}`,
    runs: [
      {
        kind: 'run' as const,
        id: `run-pdf-visual-cell-${text}`,
        inlines: [
          {
            kind: 'text' as const,
            text
          }
        ]
      }
    ]
  }
}
