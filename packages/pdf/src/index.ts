/**
 * 职责：导出 Gate 5 PDF 包的公开契约和基础 LayoutBox/DocumentLayout 到 PDF 输出。
 * 边界：处理基础页面、文本 fragment、inline 图片、表格线和页眉页脚，不提供 PDF 导入、编辑或查看器。
 * 协作模块：core layout、后续 pdf-lib/fontkit renderer、worker 和视觉验证复用此入口。
 * 性能/安全约束：入口无副作用，不把 PDF 生成依赖强制拉入 core 或 vanilla 首屏。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
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
  PdfExportImageInput,
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
export {
  PDF_WORKER_CSP_DIRECTIVES,
  detectPdfWorkerCapability
} from './worker-capability.js'
export { createPdfExportPluginAdapter } from './plugin-adapter.js'
export type {
  PdfDiagnosticCodeMetadata,
  PdfDiagnosticSeverity,
  PdfErrorCode,
  PdfWarningCode
} from './diagnostics.js'
export type {
  DetectPdfWorkerCapabilityOptions,
  PdfWorkerCapability,
  PdfWorkerCapabilityRequirement,
  PdfWorkerCapabilityStatus
} from './worker-capability.js'
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
const MAX_PDF_PAGE_SIZE_POINTS = 14400

interface PdfImageRenderContext {
  readonly inputsById: ReadonlyMap<string, PdfExportImageInput>
  readonly assetsById: Map<string, Promise<PdfImageAsset>>
  readonly embeddedById: Map<string, Promise<PDFImage | undefined>>
}

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

  const imageContext = createPdfImageRenderContext(options)
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
  assertPdfPageSizesWithinLimit(pages, options)
  warnPdfMissingFontVariants(pages, fontRegistry, warnings, options)
  assertPdfExportNotCancelled(options)

  for (const page of pages) {
    assertPdfExportNotCancelled(options)
    await renderPdfPage(pdfDocument, fontRegistry, page, rgb, imageContext)
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

/** 校验 PDF 单页尺寸不超过 14400 points 的规范上限。 */
function assertPdfPageSizesWithinLimit(pages: readonly PageBox[], options: ExportPdfOptions): void {
  for (const page of pages) {
    const widthPoints = twipsToPdfPoints(page.width)
    const heightPoints = twipsToPdfPoints(page.height)

    if (widthPoints <= MAX_PDF_PAGE_SIZE_POINTS && heightPoints <= MAX_PDF_PAGE_SIZE_POINTS) {
      continue
    }

    throw createPdfPageSizeExceededError(page, options)
  }
}

/** 创建 PDF 页面尺寸超限错误并同步调用方回调。 */
function createPdfPageSizeExceededError(page: PageBox, options: ExportPdfOptions): Error & PdfError {
  const error = new Error('PDF 单页尺寸超过 14400 points 上限') as Error & PdfError

  error.name = 'PdfPageSizeExceededError'
  Object.assign(error, {
    code: 'PDF_PAGE_SIZE_EXCEEDED',
    recoverable: true,
    widthTwips: page.width,
    heightTwips: page.height,
    ...(options.requestId === undefined ? {} : { requestId: options.requestId })
  })
  options.onError?.(error)

  return error
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
  imageContext: PdfImageRenderContext
): Promise<void> {
  const pdfPage = pdfDocument.addPage([
    twipsToPdfPoints(page.width),
    twipsToPdfPoints(page.height)
  ])

  await renderPdfInlineImages(pdfDocument, pdfPage, page, imageContext)
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

/** 创建按需读取和嵌入图片资源的上下文。 */
function createPdfImageRenderContext(options: ExportPdfOptions): PdfImageRenderContext {
  return {
    inputsById: new Map((options.images ?? []).map((input) => [input.id, input] as const)),
    assetsById: new Map(),
    embeddedById: new Map()
  }
}

/** 渲染页面里的 inline 图片。 */
async function renderPdfInlineImages(
  pdfDocument: PdfLibDocument,
  pdfPage: PDFPage,
  page: PageBox,
  imageContext: PdfImageRenderContext
): Promise<void> {
  for (const line of page.lines) {
    for (const inline of line.inlines) {
      if (!isPdfImageInlineBox(inline)) {
        continue
      }

      const image = await embedPdfImage(pdfDocument, imageContext, inline.payload.resourceId)

      if (image === undefined) {
        continue
      }

      pdfPage.drawImage(image, {
        x: twipsToPdfPoints(inline.x),
        y: twipsToPdfPoints(page.height - inline.y - inline.height),
        width: twipsToPdfPoints(inline.width),
        height: twipsToPdfPoints(inline.height)
      })
    }
  }
}

/** 嵌入已读取的 PDF 图片资源，并按 resourceId 复用同一个 PDFImage。 */
async function embedPdfImage(
  pdfDocument: PdfLibDocument,
  imageContext: PdfImageRenderContext,
  resourceId: string
): Promise<PDFImage | undefined> {
  const cached = imageContext.embeddedById.get(resourceId)

  if (cached !== undefined) {
    return cached
  }

  const embedded = readPdfImageAssetById(imageContext, resourceId)
    .then((asset) => {
      if (asset === undefined) {
        return undefined
      }

      return embedPdfImageAsset(pdfDocument, asset)
    })

  imageContext.embeddedById.set(resourceId, embedded)

  return embedded
}

/** 按 resourceId 延迟读取图片输入。 */
async function readPdfImageAssetById(
  imageContext: PdfImageRenderContext,
  resourceId: string
): Promise<PdfImageAsset | undefined> {
  const input = imageContext.inputsById.get(resourceId)

  if (input === undefined) {
    return undefined
  }

  let asset = imageContext.assetsById.get(resourceId)

  if (asset === undefined) {
    asset = readPdfImageAsset(input)
    imageContext.assetsById.set(resourceId, asset)
  }

  return asset
}

/** 嵌入单个已读取的 PDF 图片资源。 */
async function embedPdfImageAsset(pdfDocument: PdfLibDocument, asset: PdfImageAsset): Promise<PDFImage> {
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
      y: twipsToPdfPoints(page.height - box.baseline),
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

/** 读取 Uint8Array 覆盖的 ArrayBuffer，完整拥有时避免额外复制。 */
function readOwnedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  if (bytes.buffer instanceof ArrayBuffer) {
    return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
      ? bytes.buffer
      : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  }

  const output = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(output).set(bytes)

  return output
}
