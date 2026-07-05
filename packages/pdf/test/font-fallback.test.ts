/**
 * @vitest-environment node
 *
 * 职责：验证 Gate 5 PDF 字体子集化和多字体 fallback 链。
 * 边界：只覆盖公开 exportPdfFromLayout 入口，不直接访问字体注册表内部实现。
 * 协作模块：packages/pdf/src/index.ts、public-api fixture 和 PDF 视觉报告复用这些契约。
 * 约束：测试文件不放入 src，保持小体量，字体 fixture 仅使用仓库内小子集。
 * Specs：docs/superpowers/reports/2026-07-03-remediation-execution-supplement.md#37-pdf-字体子集化--fallback-链phase-3cl。
 */

import { describe, expect, it } from 'vitest'

import {
  exportPdfFromLayout as exportPdfFromLayoutPublic
} from '../src/index'
import type {
  ExportPdfOptions,
  PdfError
} from '../src/index'
import {
  createPdfPublicApiLicense,
  readChineseFontFixture,
  readFixtureBytes,
  readTestFontBytes
} from './public-api-fixtures'
import { createStyledTextLayout } from './public-api-pdf-style-helpers'

/** 以有效授权调用 PDF export，保持测试聚焦于字体行为。 */
function exportPdfFromLayout(
  layout: Parameters<typeof exportPdfFromLayoutPublic>[0],
  options: ExportPdfOptions = {}
) {
  return exportPdfFromLayoutPublic(layout, {
    ...options,
    license: createPdfPublicApiLicense(['pdf.export'])
  })
}

describe('@4xian/jword-pdf font fallback and subset', () => {
  it('subsets embedded fonts by default and allows full embedding through font config', async () => {
    const layout = createStyledTextLayout([
      {
        id: 'subset',
        text: 'Subset PDF text',
        properties: { fontFamily: 'LiberationSans' }
      }
    ])
    const subsetResult = await exportPdfFromLayout(layout, {
      requestId: 'pdf-font-subset-default-1',
      fonts: [{
        family: 'LiberationSans',
        source: {
          kind: 'arrayBuffer',
          data: readTestFontBytes()
        }
      }]
    })
    const fullResult = await exportPdfFromLayout(layout, {
      requestId: 'pdf-font-subset-full-1',
      fonts: [{
        family: 'LiberationSans',
        source: {
          kind: 'arrayBuffer',
          data: readTestFontBytes()
        },
        subset: false
      }]
    })

    expect(subsetResult.bytes.byteLength).toBeLessThan(fullResult.bytes.byteLength)
    expect(subsetResult.warnings).toEqual([])
    expect(fullResult.warnings).toEqual([])
  })

  it('exports mixed text when no single embedded font covers all characters', async () => {
    const fixture = readChineseFontFixture()
    const text = '中文 Café'
    const layout = createStyledTextLayout([
      { id: 'mixed', text }
    ])
    const result = await exportPdfFromLayout(layout, {
      requestId: 'pdf-font-fallback-chain-1',
      fonts: [
        {
          family: fixture.font.family,
          source: {
            kind: 'arrayBuffer',
            data: readFixtureBytes(fixture.font.path)
          }
        },
        {
          family: 'LiberationSans',
          source: {
            kind: 'arrayBuffer',
            data: readTestFontBytes()
          }
        }
      ]
    })
    expect(result.warnings).toEqual([])
    expect(result.bytes.byteLength).toBeGreaterThan(0)
  })

  it('reports the missing glyph sample when no configured font can cover characters', async () => {
    const errors: PdfError[] = []

    await expect(exportPdfFromLayout(createStyledTextLayout([
      { id: 'missing', text: '中文😀' }
    ]), {
      requestId: 'pdf-font-missing-sample-1',
      fonts: [{
        family: 'LiberationSans',
        source: {
          kind: 'arrayBuffer',
          data: readTestFontBytes()
        }
      }],
      onError: (error) => {
        errors.push(error)
      }
    })).rejects.toMatchObject({
      code: 'PDF_FONT_MISSING',
      message: '配置的 PDF 字体不覆盖当前文本',
      requestId: 'pdf-font-missing-sample-1',
      fontFamily: 'LiberationSans',
      recoverable: true,
      missingTextSample: '中文😀'
    })
    expect(errors[0]).toMatchObject({
      code: 'PDF_FONT_MISSING',
      missingTextSample: '中文😀'
    })
  })
})
