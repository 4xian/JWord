/**
 * 职责：用 PDF.js 渲染导出的 PDF，并和 JWord layout baseline 生成结构化视觉差异报告。
 * 边界：仅在调用方显式提供 artifact 目录时保存 PDF.js 渲染截图，不做人工查看器验收、不实现 PDF 导入或编辑。
 * 协作模块：index.ts 导出的 PDF 字节、core 布局框、PDF.js 旧版渲染器和后续视觉矩阵复用报告。
 * 性能/安全约束：PDF.js 和 Node artifact 写入只在调用报告入口时动态加载，避免进入普通导出热路径。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#iteration-24---建立-pdf-视觉验证。
 */

import type { CanvasLike, CanvasRenderingContextLike, DocumentLayout, PageBox, TextFragment } from '@4xian/jword-core'

export type PdfVisualReportStatus = 'pass' | 'warn' | 'fail'

type PdfLayoutTableCellBox = Extract<PageBox['blocks'][number], { readonly kind: 'table' }>['rows'][number]['cells'][number]

export interface PdfVisualReportOptions {
  readonly fixtureId: string
  readonly artifactDirectory?: string
  readonly scale?: number
  readonly tolerancePoints?: number
}

export interface PdfVisualReport {
  readonly fixtureId: string
  readonly viewer: 'PDF.js'
  readonly viewerVersion: string
  readonly status: PdfVisualReportStatus
  readonly tolerancePoints: number
  readonly pageCount: PdfVisualPageCountDelta
  readonly pages: readonly PdfVisualPageReport[]
  readonly notes: readonly string[]
}

export interface PdfVisualPageCountDelta {
  readonly layout: number
  readonly pdf: number
  readonly passed: boolean
}

export interface PdfVisualPageReport {
  readonly pageIndex: number
  readonly renderedCanvas: PdfRenderedCanvasSummary
  readonly screenshotArtifact?: PdfVisualScreenshotArtifact
  readonly jwordCanvasArtifact?: PdfVisualScreenshotArtifact
  readonly pageSizeDelta: PdfVisualPageSizeDelta
  readonly canvasBaseline: PdfCanvasBaselineSummary
  readonly pdfTextBoundingBoxes: readonly PdfTextBoundingBox[]
  readonly textBoundingBoxDeltas: readonly PdfTextBoundingBoxDelta[]
  readonly imageBoundingBoxDeltas: readonly PdfBoxCountDelta[]
  readonly tableLineDeltas: readonly PdfBoxCountDelta[]
}

export interface PdfRenderedCanvasSummary {
  readonly width: number
  readonly height: number
  readonly scale: number
  readonly nonEmptyPixelCount: number
}

export interface PdfVisualScreenshotArtifact {
  readonly path: string
  readonly mimeType: 'image/png'
  readonly width: number
  readonly height: number
  readonly scale: number
  readonly byteLength: number
}

export interface PdfVisualPageSizeDelta {
  readonly widthPoints: number
  readonly heightPoints: number
  readonly passed: boolean
}

export interface PdfCanvasBaselineSummary {
  readonly textBoundingBoxes: readonly PdfTextBoundingBox[]
  readonly imageBoundingBoxes: readonly PdfVisualBox[]
  readonly tableLineBounds: readonly PdfVisualLine[]
}

export interface PdfVisualBox {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface PdfTextBoundingBox extends PdfVisualBox {
  readonly text: string
}

export interface PdfVisualLine {
  readonly x1: number
  readonly y1: number
  readonly x2: number
  readonly y2: number
}

export interface PdfTextBoundingBoxDelta {
  readonly text: string
  readonly matchedText?: string
  readonly dx: number
  readonly dy: number
  readonly widthDelta: number
  readonly heightDelta: number
  readonly passed: boolean
}

export interface PdfBoxCountDelta {
  readonly expected: number
  readonly actual: number
  readonly passed: boolean
  readonly expectedBox?: PdfVisualBox
  readonly expectedLine?: PdfVisualLine
  readonly expectedPixelCount?: number
  readonly actualNonEmptyPixelCount?: number
  readonly actualCoverageRatio?: number
}

interface PdfJsModule {
  readonly version: string
  getDocument(input: PdfJsDocumentInit): PdfJsLoadingTask
}

interface PdfJsDocumentInit {
  readonly data: Uint8Array
  readonly disableWorker: true
  readonly isOffscreenCanvasSupported: false
  readonly isImageDecoderSupported: false
}

interface PdfJsLoadingTask {
  readonly promise: Promise<PdfJsDocument>
}

interface PdfJsDocument {
  readonly numPages: number
  readonly canvasFactory: PdfJsCanvasFactory
  getPage(pageNumber: number): Promise<PdfJsPage>
  destroy(): Promise<void>
}

interface PdfJsPage {
  getViewport(options: { readonly scale: number }): PdfJsViewport
  getTextContent(): Promise<PdfJsTextContent>
  render(options: {
    readonly canvasContext: PdfJsCanvasContext
    readonly viewport: PdfJsViewport
  }): { readonly promise: Promise<void> }
  cleanup(resetStats?: boolean): boolean
}

interface PdfJsViewport {
  readonly width: number
  readonly height: number
}

interface PdfJsTextContent {
  readonly items: readonly PdfJsTextItem[]
}

interface PdfJsTextItem {
  readonly str?: string
  readonly transform?: readonly unknown[]
  readonly width?: number
  readonly height?: number
}

interface PdfJsCanvasFactory {
  create(width: number, height: number): PdfJsCanvasAndContext
  destroy(canvasAndContext: PdfJsCanvasAndContext): void
}

interface PdfJsCanvasAndContext {
  readonly canvas: CanvasLike
  readonly context: PdfJsCanvasContext
}

interface PdfJsCanvasContext extends CanvasRenderingContextLike {
  getImageData(x: number, y: number, width: number, height: number): {
    readonly data: Uint8ClampedArray
  }
}

interface PdfVisualArtifactOptions {
  readonly directory: string
  readonly fixtureId: string
}

interface PdfRenderedPageCapture {
  readonly renderedCanvas: PdfRenderedCanvasSummary
  readonly pixels: PdfRenderedPixelBuffer
  readonly screenshotArtifact?: PdfVisualScreenshotArtifact
}

interface PdfRenderedPixelBuffer {
  readonly data: Uint8ClampedArray
  readonly width: number
  readonly height: number
  readonly scale: number
}

interface PdfPixelRegion {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

/** 用 PDF.js 渲染导出的 PDF，并生成和 JWord layout baseline 的结构化差异报告。 */
export async function createPdfVisualReport(
  layout: DocumentLayout,
  bytes: ArrayBuffer,
  options: PdfVisualReportOptions
): Promise<PdfVisualReport> {
  const pdfjs = await loadPdfJs()
  const scale = options.scale ?? 1
  const tolerancePoints = options.tolerancePoints ?? 1
  const pdfDocument = await pdfjs.getDocument({
    data: new Uint8Array(bytes),
    disableWorker: true,
    isOffscreenCanvasSupported: false,
    isImageDecoderSupported: false
  }).promise

  try {
    const pages = await createPdfVisualPageReports(
      layout,
      pdfDocument,
      scale,
      tolerancePoints,
      resolvePdfVisualArtifactOptions(options)
    )
    const pageCount = {
      layout: layout.pages.length,
      pdf: pdfDocument.numPages,
      passed: layout.pages.length === pdfDocument.numPages
    }

    return {
      fixtureId: options.fixtureId,
      viewer: 'PDF.js',
      viewerVersion: pdfjs.version,
      status: resolvePdfVisualReportStatus(pageCount, pages),
      tolerancePoints,
      pageCount,
      pages,
      notes: [
        'PDF.js legacy build rendered each exported page to a Node canvas.',
        options.artifactDirectory === undefined
          ? 'Canvas baseline fields are derived from JWord layout boxes; screenshot files are not persisted by this report.'
          : 'Canvas baseline fields are rendered through JWord core canvas; PDF.js and JWord Canvas screenshot artifacts are persisted for review.'
      ]
    }
  } finally {
    await pdfDocument.destroy()
  }
}

/** 动态加载 Node 兼容的 PDF.js legacy build。 */
async function loadPdfJs(): Promise<PdfJsModule> {
  const modulePath = ['pdfjs-dist', 'legacy', 'build', 'pdf.mjs'].join('/')

  return import(modulePath) as Promise<unknown> as Promise<PdfJsModule>
}

/** 为每页创建视觉报告。 */
async function createPdfVisualPageReports(
  layout: DocumentLayout,
  pdfDocument: PdfJsDocument,
  scale: number,
  tolerancePoints: number,
  artifactOptions: PdfVisualArtifactOptions | undefined
): Promise<readonly PdfVisualPageReport[]> {
  const reports: PdfVisualPageReport[] = []
  const count = Math.max(layout.pages.length, pdfDocument.numPages)

  for (let pageIndex = 0; pageIndex < count; pageIndex += 1) {
    const page = layout.pages[pageIndex]

    if (page === undefined || pageIndex >= pdfDocument.numPages) {
      reports.push(createMissingPdfVisualPageReport(pageIndex, page))
      continue
    }

    reports.push(await createPdfVisualPageReport(page, pdfDocument, pageIndex, scale, tolerancePoints, artifactOptions))
  }

  return reports
}

/** 为单页创建视觉报告。 */
async function createPdfVisualPageReport(
  page: PageBox,
  pdfDocument: PdfJsDocument,
  pageIndex: number,
  scale: number,
  tolerancePoints: number,
  artifactOptions: PdfVisualArtifactOptions | undefined
): Promise<PdfVisualPageReport> {
  const pdfPage = await pdfDocument.getPage(pageIndex + 1)

  try {
    const viewport = pdfPage.getViewport({ scale })
    const capture = await renderPdfPageToCanvas(pdfDocument, pdfPage, viewport, scale, pageIndex, artifactOptions)
    const jwordCanvasArtifact = await renderJWordPageToCanvas(
      pdfDocument.canvasFactory,
      page,
      scale,
      pageIndex,
      artifactOptions
    )
    const canvasBaseline = createCanvasBaselineSummary(page)
    const pdfTextBoundingBoxes = await readPdfTextBoundingBoxes(pdfPage)
    const textBoundingBoxDeltas = createTextBoundingBoxDeltas(
      canvasBaseline.textBoundingBoxes,
      pdfTextBoundingBoxes,
      tolerancePoints
    )

    return {
      pageIndex,
      renderedCanvas: capture.renderedCanvas,
      ...(capture.screenshotArtifact === undefined ? {} : { screenshotArtifact: capture.screenshotArtifact }),
      ...(jwordCanvasArtifact === undefined ? {} : { jwordCanvasArtifact }),
      pageSizeDelta: createPageSizeDelta(page, viewport, tolerancePoints),
      canvasBaseline,
      pdfTextBoundingBoxes,
      textBoundingBoxDeltas,
      imageBoundingBoxDeltas: createImagePixelDeltas(canvasBaseline.imageBoundingBoxes, capture.pixels),
      tableLineDeltas: createTableLinePixelDeltas(canvasBaseline.tableLineBounds, capture.pixels)
    }
  } finally {
    pdfPage.cleanup()
  }
}

/** 为缺失的 layout 或 PDF page 生成失败报告。 */
function createMissingPdfVisualPageReport(pageIndex: number, page: PageBox | undefined): PdfVisualPageReport {
  return {
    pageIndex,
    renderedCanvas: {
      width: 0,
      height: 0,
      scale: 1,
      nonEmptyPixelCount: 0
    },
    pageSizeDelta: {
      widthPoints: page === undefined ? Number.POSITIVE_INFINITY : twipsToPdfPoints(page.width),
      heightPoints: page === undefined ? Number.POSITIVE_INFINITY : twipsToPdfPoints(page.height),
      passed: false
    },
    canvasBaseline: page === undefined
      ? { textBoundingBoxes: [], imageBoundingBoxes: [], tableLineBounds: [] }
      : createCanvasBaselineSummary(page),
    pdfTextBoundingBoxes: [],
    textBoundingBoxDeltas: [],
    imageBoundingBoxDeltas: [],
    tableLineDeltas: []
  }
}

/** 用 PDF.js 把页面渲染到 Node canvas，并读取像素摘要。 */
async function renderPdfPageToCanvas(
  pdfDocument: PdfJsDocument,
  pdfPage: PdfJsPage,
  viewport: PdfJsViewport,
  scale: number,
  pageIndex: number,
  artifactOptions: PdfVisualArtifactOptions | undefined
): Promise<PdfRenderedPageCapture> {
  const canvasAndContext = pdfDocument.canvasFactory.create(
    Math.floor(viewport.width),
    Math.floor(viewport.height)
  )

  try {
    await pdfPage.render({
      canvasContext: canvasAndContext.context,
      viewport
    }).promise
    const width = canvasAndContext.canvas.width
    const height = canvasAndContext.canvas.height
    const rgba = canvasAndContext.context.getImageData(0, 0, width, height).data
    const screenshotArtifact = await writePdfScreenshotArtifact(
      rgba,
      width,
      height,
      scale,
      pageIndex,
      'pdfjs',
      artifactOptions
    )

    return {
      renderedCanvas: {
        width,
        height,
        scale,
        nonEmptyPixelCount: countNonEmptyPixels(rgba)
      },
      pixels: {
        data: rgba,
        width,
        height,
        scale
      },
      ...(screenshotArtifact === undefined ? {} : { screenshotArtifact })
    }
  } finally {
    pdfDocument.canvasFactory.destroy(canvasAndContext)
  }
}

/** 用 JWord core canvas renderer 渲染真实 baseline artifact。 */
async function renderJWordPageToCanvas(
  canvasFactory: PdfJsCanvasFactory,
  page: PageBox,
  scale: number,
  pageIndex: number,
  artifactOptions: PdfVisualArtifactOptions | undefined
): Promise<PdfVisualScreenshotArtifact | undefined> {
  if (artifactOptions === undefined) {
    return undefined
  }

  const { renderPageCanvas } = await import('@4xian/jword-core')
  const canvasAndContext = canvasFactory.create(1, 1)

  try {
    renderPageCanvas({
      canvas: canvasAndContext.canvas,
      page,
      scale
    })

    const width = canvasAndContext.canvas.width
    const height = canvasAndContext.canvas.height
    const rgba = canvasAndContext.context.getImageData(0, 0, width, height).data

    return writePdfScreenshotArtifact(
      rgba,
      width,
      height,
      scale,
      pageIndex,
      'jword-canvas',
      artifactOptions
    )
  } finally {
    canvasFactory.destroy(canvasAndContext)
  }
}

/** 统计渲染 canvas 中非透明像素数量。 */
function countNonEmptyPixels(data: Uint8ClampedArray): number {
  let count = 0

  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3] !== 0) {
      count += 1
    }
  }

  return count
}

/** 读取截图 artifact 选项。 */
function resolvePdfVisualArtifactOptions(options: PdfVisualReportOptions): PdfVisualArtifactOptions | undefined {
  if (options.artifactDirectory === undefined) {
    return undefined
  }

  return {
    directory: options.artifactDirectory,
    fixtureId: options.fixtureId
  }
}

/** 按需保存 PDF.js 渲染截图。 */
async function writePdfScreenshotArtifact(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  scale: number,
  pageIndex: number,
  source: 'pdfjs' | 'jword-canvas',
  options: PdfVisualArtifactOptions | undefined
): Promise<PdfVisualScreenshotArtifact | undefined> {
  if (options === undefined) {
    return undefined
  }

  const { mkdir, writeFile } = await import('node:fs/promises')
  const { join } = await import('node:path')
  const bytes = await encodePng(rgba, width, height)
  const path = join(options.directory, `${sanitizeArtifactName(options.fixtureId)}-${source}-page-${pageIndex + 1}.png`)

  await mkdir(options.directory, { recursive: true })
  await writeFile(path, bytes)

  return {
    path,
    mimeType: 'image/png',
    width,
    height,
    scale,
    byteLength: bytes.byteLength
  }
}

/** 编码最小 RGBA PNG，用于测试和人工复查 artifact。 */
async function encodePng(rgba: Uint8ClampedArray, width: number, height: number): Promise<Uint8Array> {
  const { deflateSync } = await import('node:zlib')
  const scanlines = new Uint8Array((width * 4 + 1) * height)

  for (let y = 0; y < height; y += 1) {
    const scanlineOffset = y * (width * 4 + 1)
    const rgbaOffset = y * width * 4

    scanlines[scanlineOffset] = 0
    scanlines.set(rgba.subarray(rgbaOffset, rgbaOffset + width * 4), scanlineOffset + 1)
  }

  return concatUint8Arrays([
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    createPngChunk('IHDR', createPngHeader(width, height)),
    createPngChunk('IDAT', deflateSync(scanlines)),
    createPngChunk('IEND', new Uint8Array())
  ])
}

/** 创建 PNG IHDR 数据。 */
function createPngHeader(width: number, height: number): Uint8Array {
  const header = new Uint8Array(13)

  writeUint32(header, 0, width)
  writeUint32(header, 4, height)
  header[8] = 8
  header[9] = 6
  header[10] = 0
  header[11] = 0
  header[12] = 0

  return header
}

/** 创建 PNG chunk。 */
function createPngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type)
  const chunk = new Uint8Array(12 + data.byteLength)

  writeUint32(chunk, 0, data.byteLength)
  chunk.set(typeBytes, 4)
  chunk.set(data, 8)
  writeUint32(chunk, 8 + data.byteLength, crc32(chunk.subarray(4, 8 + data.byteLength)))

  return chunk
}

/** 计算 PNG CRC32。 */
function crc32(data: Uint8Array): number {
  let crc = 0xffffffff

  for (const byte of data) {
    crc = (crc >>> 8) ^ readCrc32TableEntry((crc ^ byte) & 0xff)
  }

  return (crc ^ 0xffffffff) >>> 0
}

/** 读取 CRC32 表项。 */
function readCrc32TableEntry(index: number): number {
  let value = index

  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  }

  return value >>> 0
}

/** 写入大端 uint32。 */
function writeUint32(target: Uint8Array, offset: number, value: number): void {
  target[offset] = (value >>> 24) & 0xff
  target[offset + 1] = (value >>> 16) & 0xff
  target[offset + 2] = (value >>> 8) & 0xff
  target[offset + 3] = value & 0xff
}

/** 合并 Uint8Array。 */
function concatUint8Arrays(parts: readonly Uint8Array[]): Uint8Array {
  const byteLength = parts.reduce((sum, part) => sum + part.byteLength, 0)
  const output = new Uint8Array(byteLength)
  let offset = 0

  for (const part of parts) {
    output.set(part, offset)
    offset += part.byteLength
  }

  return output
}

/** 清理 artifact 文件名。 */
function sanitizeArtifactName(value: string): string {
  const name = value.replace(/[^a-zA-Z0-9._-]+/gu, '-').replace(/^-+|-+$/gu, '')

  return name.length === 0 ? 'pdf-visual' : name
}

/** 从 layout 生成 JWord canvas baseline 摘要。 */
function createCanvasBaselineSummary(page: PageBox): PdfCanvasBaselineSummary {
  return {
    textBoundingBoxes: page.lines.flatMap((line) => line.fragments.map(readLayoutTextBoundingBox)),
    imageBoundingBoxes: page.lines.flatMap((line) => {
      return line.inlines
        .filter((inline) => inline.kind === 'inlineObject' && inline.inlineKind === 'image')
        .map((inline) => ({
          x: twipsToPdfPoints(inline.x),
          y: twipsToPdfPoints(inline.y),
          width: twipsToPdfPoints(inline.width),
          height: twipsToPdfPoints(inline.height)
        }))
    }),
    tableLineBounds: page.blocks.flatMap((block) => {
      if (block.kind !== 'table') {
        return []
      }

      return block.rows.flatMap((row) => {
        return row.cells.flatMap((cell) => readTableCellLines(cell))
      })
    })
  }
}

/** 从 layout 文本 fragment 读取 baseline 文本框。 */
function readLayoutTextBoundingBox(fragment: TextFragment): PdfTextBoundingBox {
  return {
    text: fragment.text,
    x: twipsToPdfPoints(fragment.x),
    y: twipsToPdfPoints(fragment.y),
    width: twipsToPdfPoints(fragment.width),
    height: twipsToPdfPoints(fragment.height)
  }
}

/** 从 PDF.js text content 读取文本框。 */
async function readPdfTextBoundingBoxes(pdfPage: PdfJsPage): Promise<readonly PdfTextBoundingBox[]> {
  const content = await pdfPage.getTextContent()

  return content.items.flatMap((item) => {
    if (!isPdfJsTextItem(item)) {
      return []
    }

    const transform = item.transform
    const x = readNumber(transform[4])
    const y = readNumber(transform[5])
    const width = item.width ?? 0
    const height = item.height ?? 0

    return [{
      text: item.str,
      x,
      y: y - height,
      width,
      height
    }]
  })
}

/** 创建文本框差异。 */
function createTextBoundingBoxDeltas(
  expected: readonly PdfTextBoundingBox[],
  actual: readonly PdfTextBoundingBox[],
  tolerancePoints: number
): readonly PdfTextBoundingBoxDelta[] {
  return expected.map((box, index) => {
    const actualBox = actual[index]

    if (actualBox === undefined) {
      return {
        text: box.text,
        dx: Number.POSITIVE_INFINITY,
        dy: Number.POSITIVE_INFINITY,
        widthDelta: Number.POSITIVE_INFINITY,
        heightDelta: Number.POSITIVE_INFINITY,
        passed: false
      }
    }

    const dx = actualBox.x - box.x
    const dy = actualBox.y - box.y
    const widthDelta = actualBox.width - box.width
    const heightDelta = actualBox.height - box.height

    return {
      text: box.text,
      matchedText: actualBox.text,
      dx,
      dy,
      widthDelta,
      heightDelta,
      passed: Math.abs(dx) <= tolerancePoints
        && Math.abs(dy) <= tolerancePoints
        && Math.abs(widthDelta) <= Math.max(tolerancePoints, box.width)
        && Math.abs(heightDelta) <= Math.max(tolerancePoints, box.height)
    }
  })
}

/** 创建 page size 差异。 */
function createPageSizeDelta(page: PageBox, viewport: PdfJsViewport, tolerancePoints: number): PdfVisualPageSizeDelta {
  const widthPoints = viewport.width - twipsToPdfPoints(page.width)
  const heightPoints = viewport.height - twipsToPdfPoints(page.height)

  return {
    widthPoints,
    heightPoints,
    passed: Math.abs(widthPoints) <= tolerancePoints && Math.abs(heightPoints) <= tolerancePoints
  }
}

/** 创建数量型差异。 */
function createBoxCountDelta(expected: number, actual: number): PdfBoxCountDelta {
  return {
    expected,
    actual,
    passed: expected === actual
  }
}

/** 创建图片区域像素覆盖差异。 */
function createImagePixelDeltas(
  boxes: readonly PdfVisualBox[],
  pixels: PdfRenderedPixelBuffer
): readonly PdfBoxCountDelta[] {
  return boxes.map((box) => {
    const coverage = readPixelRegionCoverage(readBoxPixelRegion(box, pixels.scale), pixels)

    return {
      expected: 1,
      actual: coverage.actualNonEmptyPixelCount > 0 ? 1 : 0,
      passed: coverage.actualNonEmptyPixelCount > 0,
      expectedBox: box,
      expectedPixelCount: coverage.expectedPixelCount,
      actualNonEmptyPixelCount: coverage.actualNonEmptyPixelCount,
      actualCoverageRatio: coverage.actualCoverageRatio
    }
  })
}

/** 创建表格线像素覆盖差异。 */
function createTableLinePixelDeltas(
  lines: readonly PdfVisualLine[],
  pixels: PdfRenderedPixelBuffer
): readonly PdfBoxCountDelta[] {
  return lines.map((line) => {
    const coverage = readPixelRegionCoverage(readLinePixelRegion(line, pixels.scale), pixels)

    return {
      expected: 1,
      actual: coverage.actualNonEmptyPixelCount > 0 ? 1 : 0,
      passed: coverage.actualNonEmptyPixelCount > 0,
      expectedLine: line,
      expectedPixelCount: coverage.expectedPixelCount,
      actualNonEmptyPixelCount: coverage.actualNonEmptyPixelCount,
      actualCoverageRatio: coverage.actualCoverageRatio
    }
  })
}

/** 把 layout box 转成 PDF.js canvas 像素区域。 */
function readBoxPixelRegion(box: PdfVisualBox, scale: number): PdfPixelRegion {
  return {
    left: Math.floor(box.x * scale),
    top: Math.floor(box.y * scale),
    width: Math.max(1, Math.ceil(box.width * scale)),
    height: Math.max(1, Math.ceil(box.height * scale))
  }
}

/** 把 layout line 转成带容差的 PDF.js canvas 像素区域。 */
function readLinePixelRegion(line: PdfVisualLine, scale: number): PdfPixelRegion {
  const padding = 2
  const left = Math.floor(Math.min(line.x1, line.x2) * scale) - padding
  const top = Math.floor(Math.min(line.y1, line.y2) * scale) - padding
  const right = Math.ceil(Math.max(line.x1, line.x2) * scale) + padding
  const bottom = Math.ceil(Math.max(line.y1, line.y2) * scale) + padding

  return {
    left,
    top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top)
  }
}

/** 读取像素区域里可见墨迹的覆盖情况。 */
function readPixelRegionCoverage(region: PdfPixelRegion, pixels: PdfRenderedPixelBuffer) {
  const left = Math.max(0, region.left)
  const top = Math.max(0, region.top)
  const right = Math.min(pixels.width, region.left + region.width)
  const bottom = Math.min(pixels.height, region.top + region.height)
  let actualNonEmptyPixelCount = 0

  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      if (isVisibleInkPixel(pixels.data, (y * pixels.width + x) * 4)) {
        actualNonEmptyPixelCount += 1
      }
    }
  }

  const expectedPixelCount = Math.max(0, right - left) * Math.max(0, bottom - top)

  return {
    expectedPixelCount,
    actualNonEmptyPixelCount,
    actualCoverageRatio: expectedPixelCount === 0 ? 0 : actualNonEmptyPixelCount / expectedPixelCount
  }
}

/** 判断像素是否代表页面上的非白色可见内容。 */
function isVisibleInkPixel(data: Uint8ClampedArray, offset: number): boolean {
  const alpha = data[offset + 3] ?? 0

  if (alpha === 0) {
    return false
  }

  return (data[offset] ?? 255) < 245 ||
    (data[offset + 1] ?? 255) < 245 ||
    (data[offset + 2] ?? 255) < 245
}

/** 读取表格单元格四条边。 */
function readTableCellLines(cell: PdfLayoutTableCellBox): readonly PdfVisualLine[] {
  const left = twipsToPdfPoints(cell.x)
  const right = twipsToPdfPoints(cell.x + cell.width)
  const top = twipsToPdfPoints(cell.y)
  const bottom = twipsToPdfPoints(cell.y + cell.height)

  return [
    { x1: left, y1: top, x2: right, y2: top },
    { x1: left, y1: bottom, x2: right, y2: bottom },
    { x1: left, y1: bottom, x2: left, y2: top },
    { x1: right, y1: bottom, x2: right, y2: top }
  ]
}

/** 解析 PDF.js text item。 */
function isPdfJsTextItem(item: PdfJsTextItem): item is Required<Pick<PdfJsTextItem, 'str' | 'transform'>> & PdfJsTextItem {
  return typeof item.str === 'string' && Array.isArray(item.transform)
}

/** 读取数字。 */
function readNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/** 计算整体报告状态。 */
function resolvePdfVisualReportStatus(
  pageCount: PdfVisualPageCountDelta,
  pages: readonly PdfVisualPageReport[]
): PdfVisualReportStatus {
  if (!pageCount.passed) {
    return 'fail'
  }

  return pages.every(isPdfVisualPagePassed) ? 'pass' : 'warn'
}

/** 判断单页视觉报告是否通过。 */
function isPdfVisualPagePassed(page: PdfVisualPageReport): boolean {
  return page.renderedCanvas.nonEmptyPixelCount > 0
    && page.pageSizeDelta.passed
    && page.imageBoundingBoxDeltas.every((delta) => delta.passed)
    && page.tableLineDeltas.every((delta) => delta.passed)
}

/** twips 转 PDF points。 */
function twipsToPdfPoints(twips: number): number {
  return twips / 20
}
