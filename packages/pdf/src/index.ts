/**
 * 职责：导出 Gate 5 PDF 包的公开契约和基础 LayoutBox/DocumentLayout 到 PDF 输出。
 * 边界：处理基础页面、文本 fragment、inline 图片、表格线和页眉页脚，不提供 PDF 导入、编辑或查看器。
 * 协作模块：core layout、后续 pdf-lib/fontkit renderer、worker 和视觉验证复用此入口。
 * 性能/安全约束：入口无副作用，不把 PDF 生成依赖强制拉入 core 或 vanilla 首屏。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#iteration-23---实现-pdf-中文字体图片表格线和页眉页脚。
 */
/// <reference path="./fontkit.d.ts" />

import type { DocumentLayout, PageBox, TextFragment } from '@4xian/jword-core'
import type { PDFDocument as PdfLibDocument, PDFFont, PDFImage, PDFPage, RGB } from 'pdf-lib'
import type {
  PdfDiagnosticSeverity,
  PdfErrorCode,
  PdfWarningCode
} from './diagnostics'

export {
  PDF_ERROR_CODE_METADATA,
  PDF_WARNING_CODE_METADATA
} from './diagnostics'
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
} from './visual-report'
export type {
  PdfDiagnosticCodeMetadata,
  PdfDiagnosticSeverity,
  PdfErrorCode,
  PdfWarningCode
} from './diagnostics'

export type PdfProgressStage =
  | 'queued'
  | 'font-loading'
  | 'reading'
  | 'mapping'
  | 'writing'
  | 'validating'
  | 'done'
  | 'cancelled'

export type PdfWarningSeverity = PdfDiagnosticSeverity

export type PdfFontSource =
  | { readonly kind: 'url', readonly url: string }
  | { readonly kind: 'file', readonly file: File }
  | { readonly kind: 'arrayBuffer', readonly data: ArrayBuffer }

export interface PdfFontConfig {
  readonly family: string
  readonly source: PdfFontSource
  readonly weight?: number
  readonly style?: 'normal' | 'italic'
  readonly fallback?: boolean
}

export interface PdfProgressEvent {
  readonly stage: PdfProgressStage
  readonly loaded?: number
  readonly total?: number
  readonly requestId?: string
}

export interface PdfWarning {
  readonly code: PdfWarningCode
  readonly severity: PdfWarningSeverity
  readonly path?: string
  readonly message: string
  readonly fontFamily?: string
  readonly fallback?: string
  readonly recoverable: boolean
}

export interface PdfError {
  readonly code: PdfErrorCode
  readonly message: string
  readonly requestId?: string
  readonly cancelled?: boolean
  readonly fontFamily?: string
  readonly recoverable?: boolean
}

export interface ExportPdfOptions {
  readonly requestId?: string
  readonly signal?: AbortSignal
  readonly fonts?: readonly PdfFontConfig[]
  readonly images?: readonly PdfExportImageInput[]
  readonly onProgress?: (event: PdfProgressEvent) => void
  readonly onWarning?: (warning: PdfWarning) => void
  readonly onError?: (error: PdfError) => void
}

export interface ExportPdfResult {
  readonly bytes: ArrayBuffer
  readonly warnings: readonly PdfWarning[]
  readonly progress: readonly PdfProgressEvent[]
  readonly pageGeometry: readonly PdfPageGeometry[]
}

export interface PdfPageGeometry {
  readonly pageIndex: number
  readonly pageSizePoints: PdfSizePoints
  readonly marginPoints: PdfMarginPoints
  readonly contentRectPoints: PdfRectPoints
}

export interface PdfSizePoints {
  readonly width: number
  readonly height: number
}

export interface PdfMarginPoints {
  readonly top: number
  readonly right: number
  readonly bottom: number
  readonly left: number
}

export interface PdfRectPoints {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export type PdfWorkerRequest = ExportPdfWorkerRequest | CancelPdfWorkerRequest

export interface ExportPdfWorkerRequest {
  readonly kind: 'export-layout'
  readonly requestId?: string
  readonly layout: DocumentLayout
  readonly options: ExportPdfOptions
}

export type PdfWorkerResponse =
  | { readonly kind: 'result', readonly result: ExportPdfResult }
  | { readonly kind: 'progress', readonly progress: PdfProgressEvent }
  | { readonly kind: 'warning', readonly warning: PdfWarning }
  | { readonly kind: 'error', readonly error: PdfError }

export type PdfTransferable = ArrayBuffer | MessagePort

export interface CancelPdfWorkerRequest {
  readonly kind: 'cancel'
  readonly requestId: string
}

export type PdfExportImageInput =
  | PdfDataUrlImageInput
  | PdfArrayBufferImageInput
  | PdfBlobImageInput

export interface PdfDataUrlImageInput {
  readonly kind: 'dataUrl'
  readonly id: string
  readonly dataUrl: string
  readonly alt?: string
}

export interface PdfArrayBufferImageInput {
  readonly kind: 'arrayBuffer'
  readonly id: string
  readonly data: ArrayBuffer | ArrayBufferView
  readonly mimeType: string
  readonly alt?: string
}

export interface PdfBlobImageInput {
  readonly kind: 'blob'
  readonly id: string
  readonly blob: Blob
  readonly alt?: string
}

export interface PdfImageAsset {
  readonly id: string
  readonly mimeType: string
  readonly bytes: Uint8Array
  readonly alt?: string
}

type PdfRgbFactory = (red: number, green: number, blue: number) => RGB
type PdfDocumentFontkit = Parameters<PdfLibDocument['registerFontkit']>[0]
type PdfInlineObjectBox = Extract<PageBox['lines'][number]['inlines'][number], { readonly kind: 'inlineObject' }>
type PdfImageInlineBox = PdfInlineObjectBox & {
  readonly inlineKind: 'image'
  readonly payload: Extract<PdfInlineObjectBox['payload'], { readonly resourceId: string }>
}
type PdfTableBox = Extract<PageBox['blocks'][number], { readonly kind: 'table' }>

interface PdfFontkitModule {
  create(input: Uint8Array): PdfFontkitFont | PdfFontkitCollection
}

interface PdfFontkitFont {
  hasGlyphForCodePoint(codePoint: number): boolean
}

interface PdfFontkitCollection {
  readonly fonts: readonly PdfFontkitFont[]
}

interface PdfEmbeddedFont {
  readonly family: string
  readonly font: PDFFont
  readonly coverage: PdfFontkitFont
}

interface PdfFontRegistry {
  readonly standardFont: PDFFont
  readonly embeddedFonts: readonly PdfEmbeddedFont[]
}

/** 创建 PDF worker 进度响应。 */
export function createPdfProgressResponse(
  requestId: string,
  stage: PdfProgressStage,
  detail: Omit<PdfProgressEvent, 'requestId' | 'stage'> = {}
): PdfWorkerResponse {
  return {
    kind: 'progress',
    progress: {
      requestId,
      stage,
      ...detail
    }
  }
}

/** 创建 PDF worker 错误响应。 */
export function createPdfErrorResponse(error: PdfError): PdfWorkerResponse {
  return {
    kind: 'error',
    error
  }
}

/** 创建 PDF worker 取消请求。 */
export function createCancelPdfWorkerRequest(requestId: string): CancelPdfWorkerRequest {
  return {
    kind: 'cancel',
    requestId
  }
}

/** 提取 PDF 导出结果可转移的底层 ArrayBuffer。 */
export function createPdfTransferables(input: ArrayBuffer | ArrayBufferView): readonly PdfTransferable[] {
  if (input instanceof ArrayBuffer) {
    return [input]
  }

  return input.buffer instanceof ArrayBuffer ? [input.buffer] : []
}

/** 读取 PDF 导出前需要的图片资源字节和 MIME 元数据。 */
export async function readPdfImageAsset(input: PdfExportImageInput): Promise<PdfImageAsset> {
  if (input.kind === 'dataUrl') {
    const asset = readDataUrlImageAsset(input)

    return {
      id: input.id,
      mimeType: asset.mimeType,
      bytes: asset.bytes,
      ...(input.alt === undefined ? {} : { alt: input.alt })
    }
  }

  if (input.kind === 'blob') {
    return {
      id: input.id,
      mimeType: readSupportedImageMimeType(input.blob.type),
      bytes: new Uint8Array(await input.blob.arrayBuffer()),
      ...(input.alt === undefined ? {} : { alt: input.alt })
    }
  }

  return {
    id: input.id,
    mimeType: readSupportedImageMimeType(input.mimeType),
    bytes: readArrayBufferViewBytes(input.data),
    ...(input.alt === undefined ? {} : { alt: input.alt })
  }
}

/** 处理 PDF worker 请求，供真实 worker 入口复用同一消息边界。 */
export async function handlePdfWorkerRequest(
  request: PdfWorkerRequest,
  signal?: AbortSignal
): Promise<PdfWorkerResponse> {
  if (request.kind === 'cancel') {
    return createPdfErrorResponse({
      code: 'PDF_EXPORT_CANCELLED',
      message: '导出已取消',
      requestId: request.requestId,
      cancelled: true
    })
  }

  try {
    const requestId = request.options.requestId ?? request.requestId
    const result = await exportPdfFromLayout(request.layout, {
      ...request.options,
      ...(requestId === undefined ? {} : { requestId }),
      ...(signal === undefined ? {} : { signal })
    })

    return {
      kind: 'result',
      result
    }
  } catch (error) {
    return createPdfErrorResponse(readPdfWorkerError(error, request.requestId))
  }
}

/** 从 JWord 当前分页 layout 导出 PDF。 */
export async function exportPdfFromLayout(
  layout: DocumentLayout,
  options: ExportPdfOptions = {}
): Promise<ExportPdfResult> {
  assertPdfExportNotCancelled(options)

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

  const font = await pdfDocument.embedFont(StandardFonts.Helvetica)
  assertPdfExportNotCancelled(options)

  const imageAssets = await readPdfImageAssets(options)
  assertPdfExportNotCancelled(options)

  const pages = layout.pages.length === 0 ? [createBlankPageFromLayout(layout)] : layout.pages
  const embeddedFonts = await readPdfEmbeddedFonts(pdfDocument, progress, warnings, options)
  const fontRegistry: PdfFontRegistry = {
    standardFont: font,
    embeddedFonts
  }

  assertPdfFontsCanCoverLayout(pages, fontRegistry, options)
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

/** 创建当前占位实现的稳定错误，避免调用方误判为成功导出。 */
function createUnsupportedError(code: PdfErrorCode, requestId?: string): Error & PdfError {
  const error = new Error(code) as Error & PdfError

  error.name = 'PdfExportUnsupportedError'
  Object.assign(error, {
    code,
    ...(requestId === undefined ? {} : { requestId })
  })

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
  imageAssets: ReadonlyMap<string, PdfImageAsset>
): Promise<void> {
  const pdfPage = pdfDocument.addPage([
    twipsToPdfPoints(page.width),
    twipsToPdfPoints(page.height)
  ])

  await renderPdfInlineImages(pdfDocument, pdfPage, page, imageAssets)
  renderPdfTables(pdfPage, page, createRgb)

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
  const font = resolvePdfFontForText(fragment.text, fontRegistry)

  pdfPage.drawText(fragment.text, {
    x: twipsToPdfPoints(fragment.x),
    y: twipsToPdfPoints(page.height - fragment.baseline),
    size: readPdfFontSize(fragment),
    font,
    color: readPdfTextColor(fragment, createRgb)
  })
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

/** 读取 PDF 字号，优先使用 layout 已解析出的 CSS px。 */
function readPdfFontSize(fragment: TextFragment): number {
  return (fragment.style.fontSizePx ?? 16) * 0.75
}

/** 读取 PDF 文本颜色。 */
function readPdfTextColor(fragment: TextFragment, createRgb: PdfRgbFactory): RGB {
  const color = fragment.style.color ?? '#000000'
  const match = /^#(?<red>[0-9a-f]{2})(?<green>[0-9a-f]{2})(?<blue>[0-9a-f]{2})$/iu.exec(color)

  if (match?.groups === undefined) {
    return createRgb(0, 0, 0)
  }

  return createRgb(
    parseInt(match.groups.red ?? '00', 16) / 255,
    parseInt(match.groups.green ?? '00', 16) / 255,
    parseInt(match.groups.blue ?? '00', 16) / 255
  )
}

/** 读取 PDF 边框颜色。 */
function readPdfBorderColor(color: string | undefined, createRgb: PdfRgbFactory): RGB {
  if (color === undefined) {
    return createRgb(0, 0, 0)
  }

  const match = /^#(?<red>[0-9a-f]{2})(?<green>[0-9a-f]{2})(?<blue>[0-9a-f]{2})$/iu.exec(color)

  if (match?.groups === undefined) {
    return createRgb(0, 0, 0)
  }

  return createRgb(
    parseInt(match.groups.red ?? '00', 16) / 255,
    parseInt(match.groups.green ?? '00', 16) / 255,
    parseInt(match.groups.blue ?? '00', 16) / 255
  )
}

/** 读取并嵌入调用方配置的 PDF 字体。 */
async function readPdfEmbeddedFonts(
  pdfDocument: PdfLibDocument,
  progress: PdfProgressEvent[],
  warnings: PdfWarning[],
  options: ExportPdfOptions
): Promise<readonly PdfEmbeddedFont[]> {
  const fontConfigs = options.fonts ?? []

  if (fontConfigs.length === 0) {
    return []
  }

  pushPdfProgress(progress, options, 'font-loading')
  assertPdfExportNotCancelled(options)

  const fontkitModule = await loadPdfFontkitModule()

  pdfDocument.registerFontkit(fontkitModule as PdfDocumentFontkit)

  const fonts: PdfEmbeddedFont[] = []

  for (const config of fontConfigs) {
    try {
      const bytes = await readPdfFontBytes(config.source)
      const coverage = readPdfFontCoverage(fontkitModule, bytes)
      const font = await pdfDocument.embedFont(bytes, { subset: false })

      fonts.push({
        family: config.family,
        font,
        coverage
      })
    } catch {
      pushPdfWarning(warnings, options, {
        code: 'PDF_FONT_MISSING',
        severity: 'warning',
        message: 'PDF 字体无法读取或嵌入',
        fontFamily: config.family,
        fallback: 'provide-compatible-font',
        recoverable: true
      })
    }
  }

  return fonts
}

/** 动态加载 fontkit，避免普通 PDF 导出路径提前拉入重依赖。 */
async function loadPdfFontkitModule(): Promise<PdfFontkitModule> {
  return import('fontkit') as Promise<unknown> as Promise<PdfFontkitModule>
}

/** 读取字体 source 的二进制内容。 */
async function readPdfFontBytes(source: PdfFontSource): Promise<Uint8Array> {
  if (source.kind === 'arrayBuffer') {
    return new Uint8Array(source.data)
  }

  if (source.kind === 'file') {
    return new Uint8Array(await source.file.arrayBuffer())
  }

  const response = await fetch(source.url)

  if (!response.ok) {
    throw createUnsupportedError('PDF_FONT_MISSING')
  }

  return new Uint8Array(await response.arrayBuffer())
}

/** 建立字体覆盖检测对象，字体集合只使用第一张具体字体。 */
function readPdfFontCoverage(fontkitModule: PdfFontkitModule, bytes: Uint8Array): PdfFontkitFont {
  const font = fontkitModule.create(bytes)

  if (isPdfFontkitCollection(font)) {
    const firstFont = font.fonts[0]

    if (firstFont === undefined) {
      throw createUnsupportedError('PDF_FONT_MISSING')
    }

    return firstFont
  }

  return font
}

/** 判断 fontkit 结果是否是字体集合。 */
function isPdfFontkitCollection(value: PdfFontkitFont | PdfFontkitCollection): value is PdfFontkitCollection {
  return Array.isArray(Reflect.get(value, 'fonts'))
}

/** 记录 PDF warning 并同步调用方回调。 */
function pushPdfWarning(
  warnings: PdfWarning[],
  options: ExportPdfOptions,
  warning: PdfWarning
): void {
  warnings.push(warning)
  options.onWarning?.(warning)
}

/** 根据文本内容选择可编码的 PDF 字体。 */
function resolvePdfFontForText(text: string, registry: PdfFontRegistry): PDFFont {
  if (!containsNonAsciiText(text)) {
    return registry.standardFont
  }

  return findPdfEmbeddedFontForText(text, registry)?.font ?? registry.standardFont
}

/** 读取 PDF 导出需要的图片资产。 */
async function readPdfImageAssets(options: ExportPdfOptions): Promise<ReadonlyMap<string, PdfImageAsset>> {
  const assets = await Promise.all((options.images ?? []).map(readPdfImageAsset))

  return new Map(assets.map((asset) => [asset.id, asset] as const))
}

/** 在缺少可用字体时提前阻止非 ASCII 文本乱码导出。 */
function assertPdfFontsCanCoverLayout(
  pages: readonly PageBox[],
  registry: PdfFontRegistry,
  options: ExportPdfOptions
): void {
  for (const page of pages) {
    for (const text of iteratePdfVisibleText(page)) {
      if (containsNonAsciiText(text) && findPdfEmbeddedFontForText(text, registry) === undefined) {
        throw createPdfFontMissingError(options.requestId, options, registry.embeddedFonts[0]?.family)
      }
    }
  }
}

/** 查找覆盖整段文本的嵌入字体。 */
function findPdfEmbeddedFontForText(text: string, registry: PdfFontRegistry): PdfEmbeddedFont | undefined {
  return registry.embeddedFonts.find((font) => canPdfFontCoverText(font.coverage, text))
}

/** 判断字体是否覆盖整段文本。 */
function canPdfFontCoverText(font: PdfFontkitFont, text: string): boolean {
  for (const character of text) {
    const codePoint = character.codePointAt(0)

    if (codePoint !== undefined && !font.hasGlyphForCodePoint(codePoint)) {
      return false
    }
  }

  return true
}

/** 遍历当前 PDF renderer 会输出的可见文本。 */
function* iteratePdfVisibleText(page: PageBox): Iterable<string> {
  for (const line of page.lines) {
    for (const fragment of line.fragments) {
      yield fragment.text
    }
  }

  for (const block of page.blocks) {
    if (block.kind !== 'table') {
      continue
    }

    for (const row of block.rows) {
      for (const cell of row.cells) {
        for (const fragment of cell.fragments) {
          yield fragment.text
        }
      }
    }
  }

  for (const box of page.headerFooterBoxes) {
    yield formatPdfHeaderFooterText(box.sourceId, box.pageNumber)
  }
}

/** 判断文本是否需要非标准 PDF 字体覆盖。 */
function containsNonAsciiText(text: string): boolean {
  for (const character of text) {
    const codePoint = character.codePointAt(0)

    if (codePoint !== undefined && codePoint > 127) {
      return true
    }
  }

  return false
}

/** 创建缺少 PDF 字体的稳定错误并触发回调。 */
function createPdfFontMissingError(
  requestId: string | undefined,
  options: ExportPdfOptions,
  fontFamily?: string
): Error & PdfError {
  const message = fontFamily === undefined
    ? '缺少可用于 PDF 中文文本的字体'
    : '配置的 PDF 字体不覆盖当前文本'
  const error = new Error(message) as Error & PdfError

  error.name = 'PdfExportFontMissingError'
  Object.assign(error, {
    code: 'PDF_FONT_MISSING',
    ...(fontFamily === undefined ? {} : {
      fontFamily,
      recoverable: true
    }),
    ...(requestId === undefined ? {} : { requestId })
  })

  if (fontFamily !== undefined) {
    options.onWarning?.({
      code: 'PDF_FONT_MISSING',
      severity: 'warning',
      message,
      fontFamily,
      fallback: 'provide-compatible-font',
      recoverable: true
    })
  }

  options.onError?.(error)

  return error
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

/** twips 转 PDF points。 */
function twipsToPdfPoints(twips: number): number {
  return twips / 20
}

/** 读取 data URL 图片资源。 */
function readDataUrlImageAsset(input: PdfDataUrlImageInput): Pick<PdfImageAsset, 'mimeType' | 'bytes'> {
  const match = /^data:([^;,]+);base64,(.*)$/u.exec(input.dataUrl)

  if (match === null) {
    throw createUnsupportedError('PDF_IMAGE_INVALID')
  }

  return {
    mimeType: readSupportedImageMimeType(match[1] ?? ''),
    bytes: readBase64Bytes(match[2] ?? '')
  }
}

/** 限制当前 PDF 图片 API 只接收后续 renderer 已计划支持的格式。 */
function readSupportedImageMimeType(mimeType: string): string {
  if (mimeType === 'image/png' || mimeType === 'image/jpeg') {
    return mimeType
  }

  throw createUnsupportedError('PDF_IMAGE_UNSUPPORTED')
}

/** 把 ArrayBuffer 或 view 转成独立 Uint8Array。 */
function readArrayBufferViewBytes(data: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data)
  }

  return new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength))
}

/** 把 Uint8Array 复制成独立 ArrayBuffer。 */
function readOwnedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const output = new ArrayBuffer(bytes.byteLength)

  new Uint8Array(output).set(bytes)

  return output
}

/** 读取 base64 图片字节。 */
function readBase64Bytes(base64: string): Uint8Array {
  const binary = globalThis.atob(base64)
  const bytes = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  return bytes
}

/** 把未知异常规整为 worker error 响应。 */
function readPdfWorkerError(error: unknown, requestId: string | undefined): PdfError {
  if (isPdfError(error)) {
    const resolvedRequestId = error.requestId ?? requestId

    return {
      code: error.code,
      message: error.message,
      ...(resolvedRequestId === undefined ? {} : { requestId: resolvedRequestId }),
      ...(error.cancelled === undefined ? {} : { cancelled: error.cancelled })
    }
  }

  return {
    code: 'PDF_WORKER_UNAVAILABLE',
    message: error instanceof Error ? error.message : 'PDF worker request failed.',
    ...(requestId === undefined ? {} : { requestId })
  }
}

/** 判断异常是否已经是稳定 PDF error。 */
function isPdfError(error: unknown): error is PdfError {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && typeof error.code === 'string'
    && 'message' in error
    && typeof error.message === 'string'
}
