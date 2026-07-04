/**
 * @vitest-environment node
 *
 * 职责：验证 Gate 5 PDF 包公开入口、worker 契约和基础 layout 到 PDF 映射。
 * 边界：不做 PDF.js 视觉截图、不验证真实自定义字体嵌入、不实现 PDF 导入。
 * 协作模块：后续 packages/pdf/src/index.ts、layout 输出和兼容验证复用这个契约。
 * 约束：测试先行，新增 PDF 行为必须先观察红灯再实现。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#iteration-23---实现-pdf-中文字体图片表格线和页眉页脚。
 */

import {
  createFontManager,
  createPageConfig,
  layoutDocument
} from '@4xian/jword-core'
import { inflateSync } from 'node:zlib'
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
  readTestFontBytes,
  type PdfChineseFontFixture
} from './public-api-fixtures'

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

  it('exports header footer text and page numbers from layout', async () => {
    const result = await exportPdfFromLayout(createHeaderFooterLayout())
    const streams = readInflatedPdfStreams(result.bytes)

    expect(streams.some((stream) => stream.includes('<436F6D70616E7920486561646572> Tj'))).toBe(true)
    expect(streams.some((stream) => stream.includes('<436F6E666964656E7469616C20466F6F746572> Tj'))).toBe(true)
    expect(streams.some((stream) => stream.includes('<37> Tj'))).toBe(true)
    expect(streams.some((stream) => stream.includes('page-number-'))).toBe(false)
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
    expect(report.pages[0]?.pdfTextBoundingBoxes.map((box) => box.text).join('')).toContain(fixture.expectation.pdfJsText)
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

/** 创建最小空 layout，测试只验证 PDF 包入口契约，不依赖实际分页内容。 */
function createEmptyLayout(): Parameters<typeof exportPdfFromLayout>[0] {
  return layoutDocument({
    projection: {
      document: {
        kind: 'document',
        id: 'document-empty',
        sections: []
      }
    },
    pageConfig: createPageConfig(),
    fontManager: createFontManager()
  })
}

/** 创建只包含 JPEG inline 图片的 layout。 */
function createJpegImageLayout(): Parameters<typeof exportPdfFromLayout>[0] {
  return layoutDocument({
    projection: {
      document: {
        kind: 'document',
        id: 'document-pdf-jpeg-image',
        resourceIds: ['image-pdf-jpeg-1'],
        resources: [{
          kind: 'resource',
          id: 'image-pdf-jpeg-1',
          mime: 'image/jpeg',
          source: {
            kind: 'dataUrl',
            url: ONE_PIXEL_JPEG_DATA_URL
          },
          status: 'success'
        }],
        sections: [
          {
            kind: 'section',
            id: 'section-pdf-jpeg-image',
            blocks: [
              {
                kind: 'paragraph',
                id: 'paragraph-pdf-jpeg-image',
                runs: [
                  {
                    kind: 'run',
                    id: 'run-pdf-jpeg-image',
                    inlines: [
                      {
                        kind: 'image',
                        resourceId: 'image-pdf-jpeg-1',
                        widthTwips: 720,
                        heightTwips: 720
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

/** 创建含 inline 图片和表格边框的 layout。 */
function createTableImageLayout(): Parameters<typeof exportPdfFromLayout>[0] {
  return layoutDocument({
    projection: {
      document: {
        kind: 'document',
        id: 'document-pdf-table-image',
        resourceIds: ['image-pdf-inline-1'],
        resources: [{
          kind: 'resource',
          id: 'image-pdf-inline-1',
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
            id: 'section-pdf-table-image',
            blocks: [
              {
                kind: 'paragraph',
                id: 'paragraph-pdf-image',
                runs: [
                  {
                    kind: 'run',
                    id: 'run-pdf-image',
                    inlines: [
                      {
                        kind: 'image',
                        resourceId: 'image-pdf-inline-1',
                        widthTwips: 720,
                        heightTwips: 720
                      }
                    ]
                  }
                ]
              },
              {
                kind: 'table',
                id: 'table-pdf-border',
                grid: [1440, 1440],
                border: {
                  color: '#336699',
                  widthTwips: 20
                },
                rows: [
                  {
                    id: 'row-pdf-border-1',
                    cells: [
                      {
                        id: 'cell-pdf-border-1',
                        blocks: [createTableCellParagraph('A1')]
                      },
                      {
                        id: 'cell-pdf-border-2',
                        blocks: [createTableCellParagraph('B1')]
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

/** 创建含页眉、页脚和页码的 layout。 */
function createHeaderFooterLayout(): Parameters<typeof exportPdfFromLayout>[0] {
  return layoutDocument({
    projection: {
      document: {
        kind: 'document',
        id: 'document-pdf-header-footer',
        sections: [
          {
            kind: 'section',
            id: 'section-pdf-header-footer',
            headerIds: ['Company Header', 'page-number-top-right'],
            footerIds: ['Confidential Footer'],
            pageNumbering: {
              mode: 'restart',
              start: 7
            },
            blocks: [
              {
                kind: 'paragraph',
                id: 'paragraph-pdf-header-footer',
                runs: [
                  {
                    kind: 'run',
                    id: 'run-pdf-header-footer',
                    inlines: [
                      {
                        kind: 'text',
                        text: 'Header footer body'
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

/** 创建包含中文文本但未配置 PDF 字体的 layout。 */
function createChineseTextLayout(): Parameters<typeof exportPdfFromLayout>[0] {
  return layoutDocument({
    projection: {
      document: {
        kind: 'document',
        id: 'document-pdf-chinese-text',
        sections: [
          {
            kind: 'section',
            id: 'section-pdf-chinese-text',
            blocks: [
              {
                kind: 'paragraph',
                id: 'paragraph-pdf-chinese-text',
                runs: [
                  {
                    kind: 'run',
                    id: 'run-pdf-chinese-text',
                    inlines: [
                      {
                        kind: 'text',
                        text: '中文 PDF'
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

/** 创建由便携中文字体 fixture 覆盖的 PDF layout。 */
function createChineseFixtureTextLayout(fixture: PdfChineseFontFixture): Parameters<typeof exportPdfFromLayout>[0] {
  return layoutDocument({
    projection: {
      document: {
        kind: 'document',
        id: fixture.document.id,
        sections: [
          {
            kind: 'section',
            id: fixture.document.sectionId,
            blocks: [
              {
                kind: 'paragraph',
                id: fixture.document.paragraphId,
                runs: [
                  {
                    kind: 'run',
                    id: fixture.document.runId,
                    inlines: [
                      {
                        kind: 'text',
                        text: fixture.document.text
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
    pageConfig: createPageConfig(fixture.pageConfig),
    fontManager: createFontManager({
      fallbackFontFamily: fixture.font.family,
      availableFontFamilies: [fixture.font.family]
    })
  })
}

/** 创建包含可由测试字体覆盖的非 ASCII 拉丁文本 layout。 */
function createAccentedTextLayout(): Parameters<typeof exportPdfFromLayout>[0] {
  return layoutDocument({
    projection: {
      document: {
        kind: 'document',
        id: 'document-pdf-accented-text',
        sections: [
          {
            kind: 'section',
            id: 'section-pdf-accented-text',
            blocks: [
              {
                kind: 'paragraph',
                id: 'paragraph-pdf-accented-text',
                runs: [
                  {
                    kind: 'run',
                    id: 'run-pdf-accented-text',
                    inlines: [
                      {
                        kind: 'text',
                        text: 'Café PDF'
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

/** 创建基础 PDF 输出测试使用的单页英文文本 layout。 */
function createTextLayout(): Parameters<typeof exportPdfFromLayout>[0] {
  return layoutDocument({
    projection: {
      document: {
        kind: 'document',
        id: 'document-pdf-basic-text',
        sections: [
          {
            kind: 'section',
            id: 'section-pdf-basic-text',
            blocks: [
              {
                kind: 'paragraph',
                id: 'paragraph-pdf-basic-text',
                runs: [
                  {
                    kind: 'run',
                    id: 'run-pdf-basic-text',
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

/** 创建双页 layout，隔离验证 PDF page count 映射。 */
function createTwoPageLayout(): Parameters<typeof exportPdfFromLayout>[0] {
  const layout = createTextLayout()
  const firstPage = layout.pages[0]

  if (firstPage === undefined) {
    return layout
  }

  return {
    ...layout,
    pages: [
      firstPage,
      {
        ...firstPage,
        pageIndex: 1,
        y: firstPage.y + firstPage.height
      }
    ]
  }
}

/** 创建表格单元格段落。 */
function createTableCellParagraph(text: string) {
  return {
    kind: 'paragraph',
    id: `paragraph-${text}`,
    runs: [
      {
        kind: 'run',
        id: `run-${text}`,
        inlines: [
          {
            kind: 'text',
            text
          }
        ]
      }
    ]
  } as const
}

/** 判断内容流中是否包含 PDF stroke 操作。 */
function hasPdfStrokeOperation(stream: string): boolean {
  return /(?:^|\s)S(?:\s|$)/u.test(stream)
}

/** 解压 pdf-lib 生成的 Flate 内容流，供基础文本输出测试复查绘制操作。 */
function readInflatedPdfStreams(bytes: ArrayBuffer): readonly string[] {
  const buffer = Buffer.from(bytes)
  const text = buffer.toString('latin1')
  const streams: string[] = []
  let index = 0

  while ((index = text.indexOf('stream', index)) !== -1) {
    let start = index + 'stream'.length
    if (text[start] === '\r' && text[start + 1] === '\n') {
      start += 2
    } else if (text[start] === '\n') {
      start += 1
    }

    const end = text.indexOf('endstream', start)
    if (end === -1) {
      break
    }

    try {
      streams.push(inflateSync(buffer.subarray(start, end)).toString('latin1'))
    } catch {
      streams.push(buffer.subarray(start, end).toString('latin1'))
    }

    index = end + 'endstream'.length
  }

  return streams
}
