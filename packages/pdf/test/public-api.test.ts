/**
 * @vitest-environment node
 *
 * 职责：验证 Gate 5 PDF 包公开入口、worker 契约和基础 layout 到 PDF 映射。
 * 边界：不做 PDF.js 视觉截图、不验证真实自定义字体嵌入、不实现 PDF 导入。
 * 协作模块：后续 packages/pdf/src/index.ts、layout 输出和兼容验证复用这个契约。
 * 约束：测试先行，新增 PDF 行为必须先观察红灯再实现。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#iteration-23---实现-pdf-中文字体图片表格线和页眉页脚。
 */

import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'

import {
  createPdfVisualReport,
  exportPdfFromLayout as exportPdfFromLayoutPublic
} from '../src/index'
import type {
  ExportPdfOptions,
  ExportPdfWorkerRequest,
  PdfError,
  PdfFontConfig,
  PdfProgressEvent,
  PdfWarning,
  PdfWorkerRequest,
  PdfWorkerResponse
} from '../src/index'
import {
  ONE_PIXEL_JPEG_DATA_URL,
  ONE_PIXEL_PNG_DATA_URL,
  createPdfPublicApiLicense,
  readChineseFontFixture,
  readFixtureBytes,
  readTestFontBytes
} from './public-api-fixtures'
import {
  createAccentedTextLayout,
  createChineseFixtureTextLayout,
  createChineseTextLayout,
  createEmptyLayout,
  createHeaderFooterLayout,
  createJpegImageLayout,
  createOversizedPageLayout,
  createTableImageLayout,
  createTextLayout,
  createTwoPageLayout
} from './public-api-layout-fixtures'
import {
  countPdfStrokeOperations,
  createStyledTextLayout,
  hasPdfStrokeOperation,
  readFontResourceForText,
  readFontSizeForText,
  readInflatedPdfStreams,
  readStreamForText,
  readTextMatrixYForText
} from './public-api-pdf-style-helpers'

/** 以有效授权调用 PDF export，保持渲染测试聚焦于 PDF 输出行为。 */
function exportPdfFromLayout(
  layout: Parameters<typeof exportPdfFromLayoutPublic>[0],
  options: ExportPdfOptions = {}
) {
  return exportPdfFromLayoutPublic(layout, {
    ...options,
    license: createPdfPublicApiLicense(['pdf.export'])
  })
}

describe('@4xian/jword-pdf public API', () => {
  it('exports the layout to PDF entry point', () => {
    expect(typeof exportPdfFromLayout).toBe('function')
  })

  it('exports basic pages and text fragments from layout', async () => {
    const progress: PdfProgressEvent[] = []
    const result = await exportPdfFromLayout(createTextLayout(), {
      requestId: 'pdf-export-1',
      onProgress: (event) => {
        progress.push(event)
      }
    })
    const pdf = await PDFDocument.load(result.bytes)
    const page = pdf.getPage(0)
    const streams = readInflatedPdfStreams(result.bytes)

    expect(pdf.getPageCount()).toBe(1)
    expect(page.getWidth()).toBe(360)
    expect(page.getHeight()).toBe(504)
    expect(result.warnings).toEqual([])
    expect(result.progress.map((event) => event.stage)).toEqual([
      'queued',
      'mapping',
      'writing',
      'done'
    ])
    expect(progress.map((event) => event.stage)).toEqual(result.progress.map((event) => event.stage))
    expect(streams.some((stream) => stream.includes('<48656C6C6F> Tj'))).toBe(true)
    expect(streams.some((stream) => stream.includes('<504446> Tj'))).toBe(true)
    expect(streams.some((stream) => stream.includes(' 24 Tf'))).toBe(true)
    expect(streams.some((stream) => stream.includes('1 0 0 1 36 444.6 Tm'))).toBe(true)
    expect(streams.some((stream) => stream.includes('0.7529411764705882 0 0 rg'))).toBe(true)
  })


  it('rejects pages beyond the PDF 14400 point size limit', async () => {
    await expect(exportPdfFromLayout(createOversizedPageLayout(), {
      requestId: 'pdf-page-size-limit-1'
    })).rejects.toMatchObject({
      code: 'PDF_PAGE_SIZE_EXCEEDED',
      requestId: 'pdf-page-size-limit-1',
      recoverable: true
    })
  })

  it('reports page margin and content rect geometry in PDF points', async () => {
    const result = await exportPdfFromLayout(createTextLayout(), {
      requestId: 'pdf-export-geometry-1'
    })

    expect(result.pageGeometry).toEqual([
      {
        pageIndex: 0,
        pageSizePoints: {
          width: 360,
          height: 504
        },
        marginPoints: {
          top: 36,
          right: 36,
          bottom: 36,
          left: 36
        },
        contentRectPoints: {
          x: 36,
          y: 36,
          width: 288,
          height: 432
        }
      }
    ])
  })

  it('exports one PDF page for each layout page', async () => {
    const result = await exportPdfFromLayout(createTwoPageLayout())
    const pdf = await PDFDocument.load(result.bytes)

    expect(pdf.getPageCount()).toBe(2)
  })

  it('exports inline images and table borders from layout', async () => {
    const result = await exportPdfFromLayout(createTableImageLayout(), {
      images: [{
        kind: 'dataUrl',
        id: 'image-pdf-inline-1',
        dataUrl: ONE_PIXEL_PNG_DATA_URL
      }]
    })
    const streams = readInflatedPdfStreams(result.bytes)
    const rawPdf = Buffer.from(result.bytes).toString('latin1')

    expect(rawPdf).toContain('/Subtype /Image')
    expect(streams.some((stream) => stream.includes(' Do'))).toBe(true)
    expect(streams.some(hasPdfStrokeOperation)).toBe(true)
  })

  it('exports table cell text fragments from layout', async () => {
    const result = await exportPdfFromLayout(createTableImageLayout(), {
      images: [{
        kind: 'dataUrl',
        id: 'image-pdf-inline-1',
        dataUrl: ONE_PIXEL_PNG_DATA_URL
      }]
    })
    const streams = readInflatedPdfStreams(result.bytes)

    expect(streams.some((stream) => stream.includes('<4131> Tj'))).toBe(true)
    expect(streams.some((stream) => stream.includes('<4231> Tj'))).toBe(true)
  })

  it('exports JPEG inline images from layout', async () => {
    const result = await exportPdfFromLayout(createJpegImageLayout(), {
      images: [{
        kind: 'dataUrl',
        id: 'image-pdf-jpeg-1',
        dataUrl: ONE_PIXEL_JPEG_DATA_URL
      }]
    })
    const streams = readInflatedPdfStreams(result.bytes)
    const rawPdf = Buffer.from(result.bytes).toString('latin1')

    expect(rawPdf).toContain('/Subtype /Image')
    expect(rawPdf).toContain('/DCTDecode')
    expect(streams.some((stream) => stream.includes(' Do'))).toBe(true)
  })

  it('exports header footer text and page numbers from layout baselines', async () => {
    const layout = createHeaderFooterLayout()
    const headerBox = layout.pages[0]?.headerFooterBoxes.find((box) => box.sourceId === 'Company Header')
    const result = await exportPdfFromLayout(layout)
    const streams = readInflatedPdfStreams(result.bytes)

    expect(streams.some((stream) => stream.includes('<436F6D70616E7920486561646572> Tj'))).toBe(true)
    expect(streams.some((stream) => stream.includes('<436F6E666964656E7469616C20466F6F746572> Tj'))).toBe(true)
    expect(streams.some((stream) => stream.includes('<37> Tj'))).toBe(true)
    expect(streams.some((stream) => stream.includes('page-number-'))).toBe(false)
    expect(headerBox?.baseline).toEqual(expect.any(Number))
    expect(readTextMatrixYForText(streams, 'Company Header')).toBeCloseTo((layout.pages[0]!.height - headerBox!.baseline) / 20, 3)
  })

  it('returns a stable missing font error before exporting Chinese text without a configured font', async () => {
    const errors: PdfError[] = []

    await expect(exportPdfFromLayout(createChineseTextLayout(), {
      requestId: 'pdf-missing-font-1',
      onError: (error) => {
        errors.push(error)
      }
    })).rejects.toMatchObject({
      code: 'PDF_FONT_MISSING',
      message: '缺少可用于 PDF 中文文本的字体',
      requestId: 'pdf-missing-font-1'
    })
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({
      code: 'PDF_FONT_MISSING',
      message: '缺少可用于 PDF 中文文本的字体',
      requestId: 'pdf-missing-font-1'
    })
  })

  it('returns a stable missing font error before exporting Chinese text with an unembedded font config', async () => {
    await expect(exportPdfFromLayout(createChineseTextLayout(), {
      requestId: 'pdf-missing-font-2',
      fonts: [{
        family: 'NotoSansCJK',
        source: {
          kind: 'arrayBuffer',
          data: new ArrayBuffer(0)
        }
      }]
    })).rejects.toMatchObject({
      code: 'PDF_FONT_MISSING',
      message: '缺少可用于 PDF 中文文本的字体',
      requestId: 'pdf-missing-font-2'
    })
  })

  it('exports Latin-1 text with the standard PDF font when no embedded font is configured', async () => {
    const result = await exportPdfFromLayout(createAccentedTextLayout('Café über señor'), {
      requestId: 'pdf-latin-1-standard-font-1'
    })
    const pdf = await PDFDocument.load(result.bytes)
    const streams = readInflatedPdfStreams(result.bytes)

    expect(pdf.getPageCount()).toBe(1)
    expect(result.warnings).toEqual([])
    expect(result.progress.map((event) => event.stage)).toEqual([
      'queued',
      'mapping',
      'writing',
      'done'
    ])
    expect(streams.some((stream) => stream.includes('<436166E9> Tj'))).toBe(true)
    expect(streams.some((stream) => stream.includes('<FC626572> Tj'))).toBe(true)
    expect(streams.some((stream) => stream.includes('<7365F16F72> Tj'))).toBe(true)
  })

  it('embeds a configured font for non-ASCII text when the font covers all characters', async () => {
    const result = await exportPdfFromLayout(createAccentedTextLayout(), {
      requestId: 'pdf-embedded-font-1',
      fonts: [{
        family: 'LiberationSans',
        source: {
          kind: 'arrayBuffer',
          data: readTestFontBytes()
        }
      }]
    })
    const pdf = await PDFDocument.load(result.bytes)

    expect(pdf.getPageCount()).toBe(1)
    expect(result.warnings).toEqual([])
    expect(result.progress.map((event) => event.stage)).toEqual([
      'queued',
      'mapping',
      'font-loading',
      'writing',
      'done'
    ])
  })

  it('exports bold and italic text with matching PDF font variants', async () => {
    const result = await exportPdfFromLayout(createStyledTextLayout([
      { id: 'normal', text: 'Normal' },
      { id: 'bold', text: 'Bold', properties: { bold: true } },
      { id: 'italic', text: 'Italic', properties: { italic: true } },
      { id: 'both', text: 'Both', properties: { bold: true, italic: true } }
    ]))
    const rawPdf = Buffer.from(result.bytes).toString('latin1')
    const streams = readInflatedPdfStreams(result.bytes)
    const fontByText = new Map([
      ['Normal', readFontResourceForText(streams, 'Normal')],
      ['Bold', readFontResourceForText(streams, 'Bold')],
      ['Italic', readFontResourceForText(streams, 'Italic')],
      ['Both', readFontResourceForText(streams, 'Both')]
    ])

    expect(rawPdf).toContain('/BaseFont /Helvetica')
    expect(rawPdf).toContain('/BaseFont /Helvetica-Bold')
    expect(rawPdf).toContain('/BaseFont /Helvetica-Oblique')
    expect(rawPdf).toContain('/BaseFont /Helvetica-BoldOblique')
    expect(new Set(fontByText.values())).toHaveLength(4)
    expect(fontByText.get('Bold')).not.toBe(fontByText.get('Normal'))
    expect(fontByText.get('Italic')).not.toBe(fontByText.get('Normal'))
    expect(fontByText.get('Both')).not.toBe(fontByText.get('Bold'))
    expect(fontByText.get('Both')).not.toBe(fontByText.get('Italic'))
  })

  it('warns and falls back to an embedded regular font when a requested variant is missing', async () => {
    const result = await exportPdfFromLayout(createStyledTextLayout([
      {
        id: 'custom-bold',
        text: 'CustomBold',
        properties: { fontFamily: 'Arial', bold: true }
      }
    ]), {
      fonts: [{
        family: 'Arial',
        source: {
          kind: 'arrayBuffer',
          data: readTestFontBytes()
        },
        weight: 400,
        style: 'normal'
      }]
    })

    expect(result.warnings).toContainEqual({
      code: 'PDF_FONT_MISSING',
      severity: 'warning',
      message: 'PDF 字体变体缺失，已回退常规字体',
      fontFamily: 'Arial',
      fallback: 'regular-font-variant',
      recoverable: true
    })
  })

  it('exports underline and strike text decorations as PDF lines', async () => {
    const result = await exportPdfFromLayout(createStyledTextLayout([
      { id: 'underline', text: 'Underline', properties: { underline: true, color: '#223344' } },
      { id: 'strike', text: 'Strike', properties: { strike: true, color: '#223344' } }
    ]))
    const streams = readInflatedPdfStreams(result.bytes)
    const decorationStrokeCount = streams.reduce(
      (total, stream) => total + countPdfStrokeOperations(stream),
      0
    )

    expect(streams.some((stream) => stream.includes('<556E6465726C696E65> Tj'))).toBe(true)
    expect(streams.some((stream) => stream.includes('<537472696B65> Tj'))).toBe(true)
    expect(decorationStrokeCount).toBeGreaterThanOrEqual(2)
  })

  it('exports text background rectangles before text drawing', async () => {
    const result = await exportPdfFromLayout(createStyledTextLayout([
      { id: 'highlight', text: 'Highlight', properties: { backgroundColor: '#fff59d' } }
    ]))
    const stream = readStreamForText(readInflatedPdfStreams(result.bytes), 'Highlight')
    const backgroundFillIndex = stream.indexOf('\nf\n')
    const textIndex = stream.indexOf('<486967686C69676874> Tj')

    expect(backgroundFillIndex).toBeGreaterThanOrEqual(0)
    expect(backgroundFillIndex).toBeLessThan(textIndex)
  })

  it('exports superscript and subscript with shifted PDF baselines and reduced font size', async () => {
    const result = await exportPdfFromLayout(createStyledTextLayout([
      { id: 'base', text: 'Base', properties: { fontSizeTwips: 320 } },
      { id: 'sup', text: 'Sup', properties: { fontSizeTwips: 320, superscript: true } },
      { id: 'sub', text: 'Sub', properties: { fontSizeTwips: 320, subscript: true } }
    ]))
    const streams = readInflatedPdfStreams(result.bytes)
    const baseFontSize = readFontSizeForText(streams, 'Base')
    const superscriptFontSize = readFontSizeForText(streams, 'Sup')
    const subscriptFontSize = readFontSizeForText(streams, 'Sub')
    const baseY = readTextMatrixYForText(streams, 'Base')
    const superscriptY = readTextMatrixYForText(streams, 'Sup')
    const subscriptY = readTextMatrixYForText(streams, 'Sub')

    expect(superscriptFontSize).toBeLessThan(baseFontSize)
    expect(subscriptFontSize).toBeLessThan(baseFontSize)
    expect(superscriptY).toBeGreaterThan(baseY)
    expect(subscriptY).toBeLessThan(baseY)
  })

  it('exports Chinese text with the portable PDF font fixture', async () => {
    const fixture = readChineseFontFixture()
    const layout = createChineseFixtureTextLayout(fixture)
    const result = await exportPdfFromLayout(layout, {
      requestId: 'pdf-chinese-font-1',
      fonts: [{
        family: fixture.font.family,
        source: {
          kind: 'arrayBuffer',
          data: readFixtureBytes(fixture.font.path)
        }
      }]
    })
    const pdf = await PDFDocument.load(result.bytes)
    const report = await createPdfVisualReport(layout, result.bytes, {
      fixtureId: 'pdf-chinese-font',
      tolerancePoints: 2
    })

    expect(pdf.getPageCount()).toBe(1)
    expect(result.warnings).toEqual([])
    expect(result.progress.map((event) => event.stage)).toEqual([
      'queued',
      'mapping',
      'font-loading',
      'writing',
      'done'
    ])
    expect(report.pages[0]?.renderedCanvas.nonEmptyPixelCount).toBeGreaterThan(0)
    expect(report.pages[0]?.pdfTextBoundingBoxes.map((box) => box.text).join('').replace(/\s+/gu, '')).toContain(
      fixture.expectation.pdfJsText
    )
  })

  it('returns a stable missing font error when configured fonts do not cover Chinese text', async () => {
    const warnings: PdfWarning[] = []

    await expect(exportPdfFromLayout(createChineseTextLayout(), {
      requestId: 'pdf-missing-font-3',
      fonts: [{
        family: 'LiberationSans',
        source: {
          kind: 'arrayBuffer',
          data: readTestFontBytes()
        }
      }],
      onWarning: (warning) => {
        warnings.push(warning)
      }
    })).rejects.toMatchObject({
      code: 'PDF_FONT_MISSING',
      message: '配置的 PDF 字体不覆盖当前文本',
      requestId: 'pdf-missing-font-3',
      fontFamily: 'LiberationSans',
      recoverable: true
    })
    expect(warnings).toEqual([{
      code: 'PDF_FONT_MISSING',
      severity: 'warning',
      message: '配置的 PDF 字体不覆盖当前文本',
      fontFamily: 'LiberationSans',
      fallback: 'provide-compatible-font',
      recoverable: true
    }])
  })

  it('exports a blank PDF for empty layouts', async () => {
    const result = await exportPdfFromLayout(createEmptyLayout(), {
      requestId: 'pdf-export-empty-1'
    })
    const pdf = await PDFDocument.load(result.bytes)

    expect(pdf.getPageCount()).toBe(1)
    expect(result.warnings).toEqual([])
    expect(result.progress.map((event) => event.stage)).toEqual([
      'queued',
      'mapping',
      'writing',
      'done'
    ])
  })

  it('returns a stable cancelled error when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(exportPdfFromLayout(createEmptyLayout(), {
      requestId: 'pdf-export-cancel-1',
      signal: controller.signal
    })).rejects.toMatchObject({
      code: 'PDF_EXPORT_CANCELLED',
      message: '导出已取消',
      requestId: 'pdf-export-cancel-1',
      cancelled: true
    })
  })

  it('stops exporting when the signal is aborted during progress', async () => {
    const controller = new AbortController()
    const progress: PdfProgressEvent[] = []

    await expect(exportPdfFromLayout(createEmptyLayout(), {
      requestId: 'pdf-export-cancel-2',
      signal: controller.signal,
      onProgress: (event) => {
        progress.push(event)

        if (event.stage === 'queued') {
          controller.abort()
        }
      }
    })).rejects.toMatchObject({
      code: 'PDF_EXPORT_CANCELLED',
      message: '导出已取消',
      requestId: 'pdf-export-cancel-2',
      cancelled: true
    })
    expect(progress.map((event) => event.stage)).toEqual(['queued'])
  })

  it('accepts planned font, progress, warning, error, cancel and worker contract types', () => {
    const fonts: readonly PdfFontConfig[] = [
      { family: 'RemoteFont', source: { kind: 'url', url: 'https://example.test/font.woff2' } },
      { family: 'BinaryFont', source: { kind: 'arrayBuffer', data: new ArrayBuffer(0) } },
      { family: 'LocalFont', source: { kind: 'file', file: new File([], 'font.ttf') } }
    ]
    const progress: PdfProgressEvent = {
      stage: 'font-loading',
      loaded: 1,
      total: 3,
      requestId: 'pdf-export-2'
    }
    const warning: PdfWarning = {
      code: 'PDF_FONT_MISSING',
      severity: 'warning',
      message: '字体缺失',
      fontFamily: 'MissingFont',
      fallback: 'Arial',
      recoverable: true
    }
    const error: PdfError = {
      code: 'PDF_EXPORT_CANCELLED',
      message: '导出已取消',
      requestId: 'pdf-export-2',
      cancelled: true
    }
    const options: ExportPdfOptions = {
      requestId: 'pdf-export-2',
      fonts,
      onProgress: (event) => {
        expect(event.stage).toBe(progress.stage)
      },
      onWarning: (event) => {
        expect(event.code).toBe(warning.code)
      },
      onError: (event) => {
        expect(event.cancelled).toBe(error.cancelled)
      }
    }
    const request: ExportPdfWorkerRequest = {
      kind: 'export-layout',
      requestId: 'pdf-export-2',
      layout: createEmptyLayout(),
      options
    }
    const cancelRequest: PdfWorkerRequest = {
      kind: 'cancel',
      requestId: 'pdf-export-2'
    }
    const response: PdfWorkerResponse = {
      kind: 'error',
      error
    }

    expect(request.options.fonts).toHaveLength(3)
    expect(cancelRequest.kind).toBe('cancel')
    expect(response.error.cancelled).toBe(true)
  })

})
