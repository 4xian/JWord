/**
 * 职责：导出 Gate 5 PDF 包的公开契约和基础 LayoutBox/DocumentLayout 到 PDF 输出。
 * 边界：处理基础页面、文本 fragment、inline 图片、表格线和页眉页脚，不提供 PDF 导入、编辑或查看器。
 * 协作模块：core layout、后续 pdf-lib/fontkit renderer、worker 和视觉验证复用此入口。
 * 性能/安全约束：入口无副作用，不把 PDF 生成依赖强制拉入 core 或 vanilla 首屏。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#iteration-23---实现-pdf-中文字体图片表格线和页眉页脚。
 */
/// <reference path="./fontkit.d.ts" />

import {
  type DocumentLayout,
  type PageBox,
  type TextFragment
} from '@4xian/jword-core'
import {
  assertJWordFeatureEntitled
} from '@4xian/jword-license'
import type { PDFDocument as PdfLibDocument, PDFFont, PDFImage, PDFPage, RGB } from 'pdf-lib'
import type {
  ExportPdfOptions,
  ExportPdfResult,
  PdfError,
  PdfImageAsset,
  PdfPageGeometry,
  PdfProgressEvent,
  PdfProgressStage,
  PdfWarning
} from './types.js'
import {
  assertPdfFontsCanCoverLayout,
  readPdfEmbeddedFonts,
  readPdfStandardFonts,
  resolvePdfFontForText,
  resolvePdfFontRunsForTextFragment,
  warnPdfMissingFontVariants,
  type PdfFontRegistry,
  type PdfStandardFontSet
} from './font-registry.js'
import { readPdfImageAsset } from './image-assets.js'
import { twipsToPdfPoints } from './pdf-geometry.js'
import {
  readPdfBorderColor,
  readPdfFontSize,
  readPdfTextBaseline,
  readPdfTextColor,
  renderPdfTextBackground,
  renderPdfTextDecoration,
  type PdfRgbFactory
} from './text-style-renderer.js'

export {
  PDF_ERROR_CODE_METADATA,
  PDF_WARNING_CODE_METADATA
} from './diagnostics.js'
export {
  createPdfVisualReport,
  type PdfBoxCountDelta,
  type PdfCanvasBaselineSummary,
  type PdfRenderedCanvasSummary,
  type PdfTextBoundingBox,
  type PdfTextBoundingBoxDelta,
  type PdfVisualBox,
  type PdfVisualLine,
  type PdfVisualPageCountDelta,
  type PdfVisualPageReport,
  type PdfVisualPageSizeDelta,
  type PdfVisualReport,
  type PdfVisualReportOptions,
  type PdfVisualReportStatus
} from './visual-report.js'
export type {
  PdfDiagnosticCodeMetadata,
  PdfDiagnosticSeverity,
  PdfErrorCode,
  PdfWarningCode
} from './diagnostics.js'
export type {
  CancelPdfWorkerRequest,
  ExportPdfOptions,
  ExportPdfResult,
  ExportPdfWorkerRequest,
  PdfArrayBufferImageInput,
  PdfBlobImageInput,
  PdfDataUrlImageInput,
  PdfError,
  PdfExportImageInput,
  PdfFontConfig,
  PdfFontSource,
  PdfImageAsset,
  PdfMarginPoints,
  PdfPageGeometry,
  PdfProgressEvent,
  PdfProgressStage,
  PdfRectPoints,
  PdfSizePoints,
  PdfTransferable,
  PdfWarning,
  PdfWarningSeverity,
  PdfWorkerRequest,
  PdfWorkerResponse
} from './types.js'

type PdfInlineObjectBox = Extract<PageBox['lines'][number]['inlines'][number], { readonly kind: 'inlineObject' }>
type PdfImageInlineBox = PdfInlineObjectBox & {
  readonly inlineKind: 'image'
  readonly payload: Extract<PdfInlineObjectBox['payload'], { readonly resourceId: string }>
}
type PdfTableBox = Extract<PageBox['blocks'][number], { readonly kind: 'table' }>

/** 从 JWord 当前分页 layout 导出 PDF。 */
export async function exportPdfFromLayout(
  layout: DocumentLayout,
  options: ExportPdfOptions = {}
): Promise<ExportPdfResult> {
  assertPdfExportNotCancelled(options)
  assertJWordFeatureEntitled(options.license, 'pdf.export')

  const progress: PdfProgressEvent[] = []
  const warnings: PdfWarning[] = []
  pushPdfProgress(progress, options, 'queued')
  assertPdfExportNotCancelled(options)
  pushPdfProgress(progress, options, 'mapping')
  assertPdfExportNotCancelled(options)

  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
  assertPdfExportNotCancelled(options)

  const pdfDocument = await PDFDocument.create()
  assertPdfExportNotCancelled(options)

  const standardFonts = await readPdfStandardFonts(pdfDocument, StandardFonts)
  assertPdfExportNotCancelled(options)

  const imageAssets = await readPdfImageAssets(options)
  assertPdfExportNotCancelled(options)

  const pages = layout.pages.length === 0 ? [createBlankPageFromLayout(layout)] : layout.pages
  const embeddedFonts = await readPdfEmbeddedFonts(pdfDocument, progress, warnings, options, () => {
    assertPdfExportNotCancelled(options)
  })
  const fontRegistry: PdfFontRegistry = {
    standardFonts,
    embeddedFonts
  }

  assertPdfFontsCanCoverLayout(pages, fontRegistry, options)
  warnPdfMissingFontVariants(pages, fontRegistry, warnings, options)
  assertPdfExportNotCancelled(options)

  for (const page of pages) {
    assertPdfExportNotCancelled(options)
    await renderPdfPage(pdfDocument, fontRegistry, page, rgb, imageAssets)
    assertPdfExportNotCancelled(options)
  }

  pushPdfProgress(progress, options, 'writing')
  assertPdfExportNotCancelled(options)

  const bytes = await pdfDocument.save({ useObjectStreams: false })
  assertPdfExportNotCancelled(options)

  pushPdfProgress(progress, options, 'done')
  assertPdfExportNotCancelled(options)

  return {
    bytes: readOwnedArrayBuffer(bytes),
    warnings,
    progress,
    pageGeometry: readPdfPageGeometry(pages)
  }
}

/** 检查 PDF 导出是否已被取消。 */
function assertPdfExportNotCancelled(options: ExportPdfOptions): void {
  if (options.signal?.aborted !== true) {
    return
  }

  throw createPdfCancelledError(options.requestId)
}

/** 创建稳定取消错误。 */
function createPdfCancelledError(requestId?: string): Error & PdfError {
  const error = new Error('导出已取消') as Error & PdfError

  error.name = 'PdfExportCancelledError'
  Object.assign(error, {
    code: 'PDF_EXPORT_CANCELLED',
    cancelled: true,
    ...(requestId === undefined ? {} : { requestId })
  })

  return error
}

/** 记录 PDF 导出进度并同步回调调用方。 */
function pushPdfProgress(
  progress: PdfProgressEvent[],
  options: ExportPdfOptions,
  stage: PdfProgressStage
): void {
  const event = {
    stage,
    ...(options.requestId === undefined ? {} : { requestId: options.requestId })
  }

  progress.push(event)
  options.onProgress?.(event)
}

/** 为空 layout 创建一页空白输出。 */
function createBlankPageFromLayout(layout: DocumentLayout): PageBox {
  const pageConfig = layout.input.pageConfig

  return {
    kind: 'page',
    pageIndex: 0,
    x: 0,
    y: 0,
    width: pageConfig.widthTwips,
    height: pageConfig.heightTwips,
    sectionBoundary: 'single',
    sectionIds: [],
    headerIds: [],
    footerIds: [],
    headerFooterBoxes: [],
    lines: [],
    paragraphs: [],
    blocks: [],
    contentRect: {
      pageIndex: 0,
      x: pageConfig.marginTwips.left,
      y: pageConfig.marginTwips.top,
      width: pageConfig.contentWidthTwips,
      height: pageConfig.contentHeightTwips
    }
  }
}

/** 渲染单页 layout 到 PDF 页面。 */
async function renderPdfPage(
  pdfDocument: PdfLibDocument,
  fontRegistry: PdfFontRegistry,
  page: PageBox,
  createRgb: PdfRgbFactory,
  imageAssets: ReadonlyMap<string, PdfImageAsset>
): Promise<void> {
  const pdfPage = pdfDocument.addPage([
    twipsToPdfPoints(page.width),
    twipsToPdfPoints(page.height)
  ])

  await renderPdfInlineImages(pdfDocument, pdfPage, page, imageAssets)
  renderPdfTables(pdfPage, page, createRgb)
  renderPdfTableText(pdfPage, fontRegistry, page, createRgb)

  for (const line of page.lines) {
    for (const fragment of line.fragments) {
      renderPdfTextFragment(pdfPage, fontRegistry, page, fragment, createRgb)
    }
  }

  renderPdfHeaderFooterBoxes(pdfPage, fontRegistry, page, createRgb)
}

/** 渲染一个文本 fragment。 */
function renderPdfTextFragment(
  pdfPage: PDFPage,
  fontRegistry: PdfFontRegistry,
  page: PageBox,
  fragment: TextFragment,
  createRgb: PdfRgbFactory
): void {
  const x = twipsToPdfPoints(fragment.x)
  const baseline = readPdfTextBaseline(page, fragment)
  const size = readPdfFontSize(fragment)
  const color = readPdfTextColor(fragment, createRgb)

  renderPdfTextBackground(pdfPage, page, fragment, createRgb)
  for (const run of resolvePdfFontRunsForTextFragment(fragment, fontRegistry)) {
    pdfPage.drawText(run.text, {
      x: run.x,
      y: baseline,
      size,
      font: run.font,
      color
    })
  }
  renderPdfTextDecoration(pdfPage, fragment, x, baseline, size, color)
}

/** 读取 PDF 导出需要的图片资产。 */
async function readPdfImageAssets(options: ExportPdfOptions): Promise<ReadonlyMap<string, PdfImageAsset>> {
  const assets = await Promise.all((options.images ?? []).map(readPdfImageAsset))

  return new Map(assets.map((asset) => [asset.id, asset] as const))
}

/** 渲染页面里的 inline 图片。 */
async function renderPdfInlineImages(
  pdfDocument: PdfLibDocument,
  pdfPage: PDFPage,
  page: PageBox,
  imageAssets: ReadonlyMap<string, PdfImageAsset>
): Promise<void> {
  for (const line of page.lines) {
    for (const inline of line.inlines) {
      if (!isPdfImageInlineBox(inline)) {
        continue
      }

      const asset = imageAssets.get(inline.payload.resourceId)

      if (asset === undefined) {
        continue
      }

      const image = await embedPdfImage(pdfDocument, asset)

      pdfPage.drawImage(image, {
        x: twipsToPdfPoints(inline.x),
        y: twipsToPdfPoints(page.height - inline.y - inline.height),
        width: twipsToPdfPoints(inline.width),
        height: twipsToPdfPoints(inline.height)
      })
    }
  }
}

/** 嵌入已读取的 PDF 图片资源。 */
async function embedPdfImage(pdfDocument: PdfLibDocument, asset: PdfImageAsset): Promise<PDFImage> {
  if (asset.mimeType === 'image/png') {
    return pdfDocument.embedPng(asset.bytes)
  }

  return pdfDocument.embedJpg(asset.bytes)
}

/** 渲染基础表格边框线。 */
function renderPdfTables(pdfPage: PDFPage, page: PageBox, createRgb: PdfRgbFactory): void {
  for (const block of page.blocks) {
    if (block.kind !== 'table') {
      continue
    }

    renderPdfTableBorders(pdfPage, page, block, createRgb)
  }
}

/** 渲染表格单元格中的文本 fragment。 */
function renderPdfTableText(
  pdfPage: PDFPage,
  fontRegistry: PdfFontRegistry,
  page: PageBox,
  createRgb: PdfRgbFactory
): void {
  for (const table of page.blocks) {
    if (table.kind !== 'table') {
      continue
    }

    for (const row of table.rows) {
      for (const cell of row.cells) {
        for (const fragment of cell.fragments) {
          renderPdfTextFragment(pdfPage, fontRegistry, page, fragment, createRgb)
        }
      }
    }
  }
}

/** 渲染单个表格的外框和单元格边框。 */
function renderPdfTableBorders(
  pdfPage: PDFPage,
  page: PageBox,
  table: PdfTableBox,
  createRgb: PdfRgbFactory
): void {
  for (const row of table.rows) {
    for (const cell of row.cells) {
      const border = cell.border ?? table.border
      const color = readPdfBorderColor(border?.color, createRgb)
      const thickness = twipsToPdfPoints(border?.widthTwips ?? 15)
      const left = twipsToPdfPoints(cell.x)
      const right = twipsToPdfPoints(cell.x + cell.width)
      const top = twipsToPdfPoints(page.height - cell.y)
      const bottom = twipsToPdfPoints(page.height - cell.y - cell.height)

      drawPdfLine(pdfPage, left, top, right, top, thickness, color)
      drawPdfLine(pdfPage, left, bottom, right, bottom, thickness, color)
      drawPdfLine(pdfPage, left, bottom, left, top, thickness, color)
      drawPdfLine(pdfPage, right, bottom, right, top, thickness, color)
    }
  }
}

/** 绘制一条 PDF 直线。 */
function drawPdfLine(
  pdfPage: PDFPage,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  thickness: number,
  color: RGB
): void {
  pdfPage.drawLine({
    start: { x: startX, y: startY },
    end: { x: endX, y: endY },
    thickness,
    color
  })
}

/** 渲染页眉页脚和页码文本。 */
function renderPdfHeaderFooterBoxes(
  pdfPage: PDFPage,
  fontRegistry: PdfFontRegistry,
  page: PageBox,
  createRgb: PdfRgbFactory
): void {
  for (const box of page.headerFooterBoxes) {
    const text = formatPdfHeaderFooterText(box.sourceId, box.pageNumber)
    const size = 9
    const font = resolvePdfFontForText(text, fontRegistry)

    pdfPage.drawText(text, {
      x: resolvePdfHeaderFooterTextX(page, box, text, font, size),
      y: twipsToPdfPoints(page.height - box.y - (box.height * 0.6)),
      size,
      font,
      color: createRgb(0.42, 0.45, 0.5)
    })
  }
}

/** 格式化页眉页脚可见文本，隐藏内部页码 source id。 */
function formatPdfHeaderFooterText(sourceId: string, pageNumber: number): string {
  return isPdfPageNumberSourceId(sourceId)
    ? String(pageNumber)
    : sourceId
}

/** 计算 PDF 页眉页脚文本横向位置。 */
function resolvePdfHeaderFooterTextX(
  page: PageBox,
  box: PageBox['headerFooterBoxes'][number],
  text: string,
  font: PDFFont,
  size: number
): number {
  const align = readPdfPageNumberAlignment(box.sourceId)

  if (align === 'center') {
    return twipsToPdfPoints(box.x + (box.width / 2)) - (font.widthOfTextAtSize(text, size) / 2)
  }

  if (align === 'right') {
    return twipsToPdfPoints(box.x + box.width) - font.widthOfTextAtSize(text, size)
  }

  return twipsToPdfPoints(box.x)
}

/** 从页码 source id 读取水平对齐方式。 */
function readPdfPageNumberAlignment(sourceId: string): 'left' | 'center' | 'right' {
  if (!isPdfPageNumberSourceId(sourceId)) {
    return 'left'
  }

  if (sourceId.endsWith('-center')) {
    return 'center'
  }

  if (sourceId.endsWith('-right')) {
    return 'right'
  }

  return 'left'
}

/** 判断页眉页脚标识是否是页码占位。 */
function isPdfPageNumberSourceId(value: string): boolean {
  return value.startsWith('page-number-')
}

/** 判断 inlineObject 是否是图片。 */
function isPdfImageInlineBox(inline: PageBox['lines'][number]['inlines'][number]): inline is PdfImageInlineBox {
  return inline.kind === 'inlineObject'
    && inline.inlineKind === 'image'
    && typeof Reflect.get(inline.payload, 'resourceId') === 'string'
}

/** 读取每页 PDF points 单位的页面、边距和正文区域几何。 */
function readPdfPageGeometry(pages: readonly PageBox[]): readonly PdfPageGeometry[] {
  return pages.map((page) => {
    const contentX = page.contentRect.x - page.x
    const contentY = page.contentRect.y - page.y

    return {
      pageIndex: page.pageIndex,
      pageSizePoints: {
        width: twipsToPdfPoints(page.width),
        height: twipsToPdfPoints(page.height)
      },
      marginPoints: {
        top: twipsToPdfPoints(contentY),
        right: twipsToPdfPoints(page.width - contentX - page.contentRect.width),
        bottom: twipsToPdfPoints(page.height - contentY - page.contentRect.height),
        left: twipsToPdfPoints(contentX)
      },
      contentRectPoints: {
        x: twipsToPdfPoints(contentX),
        y: twipsToPdfPoints(contentY),
        width: twipsToPdfPoints(page.contentRect.width),
        height: twipsToPdfPoints(page.contentRect.height)
      }
    }
  })
}

/** 把 Uint8Array 复制成独立 ArrayBuffer。 */
function readOwnedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const output = new ArrayBuffer(bytes.byteLength)

  new Uint8Array(output).set(bytes)

  return output
}
