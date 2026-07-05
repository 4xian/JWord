/**
 * 职责：维护 PDF 标准字体、嵌入字体、子集化和 fallback 链选择。
 * 边界：只处理字体加载、覆盖检查和绘制段拆分，不创建页面、不绘制表格或图片。
 * 协作模块：index.ts 在导出 PDF 时调用，fontkit 与 pdf-lib 通过此模块隔离。
 * 性能/安全约束：默认启用字体子集化，缺字在导出前 fail-fast，避免生成乱码 PDF。
 * Specs：docs/superpowers/reports/2026-07-03-remediation-execution-supplement.md#37-pdf-字体子集化--fallback-链phase-3cl。
 */

import type {
  PageBox,
  TextFragment
} from '@4xian/jword-core'
import type { PDFDocument as PdfLibDocument, PDFFont } from 'pdf-lib'

import type {
  ExportPdfOptions,
  PdfError,
  PdfFontSource,
  PdfProgressEvent,
  PdfProgressStage,
  PdfWarning
} from './types.js'
import { twipsToPdfPoints } from './pdf-geometry.js'

type PdfDocumentFontkit = Parameters<PdfLibDocument['registerFontkit']>[0]
type PdfStandardFontsModule = typeof import('pdf-lib')['StandardFonts']
type PdfFontStyle = 'normal' | 'italic'
type PdfCancelGuard = () => void

export interface PdfStandardFontSet {
  readonly regular: PDFFont
  readonly bold: PDFFont
  readonly italic: PDFFont
  readonly boldItalic: PDFFont
}

interface PdfFontkitModule {
  create(input: Uint8Array): PdfFontkitFont | PdfFontkitCollection
}

interface PdfFontkitFont {
  hasGlyphForCodePoint(codePoint: number): boolean
}

interface PdfFontkitCollection {
  readonly fonts: readonly PdfFontkitFont[]
}

interface PdfFontkitSubsetStream {
  on(event: 'data', handler: PdfFontkitSubsetDataHandler): PdfFontkitSubsetStream
  on(event: 'end', handler: PdfFontkitSubsetEndHandler): PdfFontkitSubsetStream
  on(event: 'error', handler: PdfFontkitSubsetErrorHandler): PdfFontkitSubsetStream
}

type PdfFontkitSubsetDataHandler = (bytes: Uint8Array) => void
type PdfFontkitSubsetEndHandler = () => void
type PdfFontkitSubsetErrorHandler = (error: unknown) => void

export interface PdfEmbeddedFont {
  readonly family: string
  readonly font: PDFFont
  readonly coverage: PdfFontkitFont
  readonly weight: number
  readonly style: PdfFontStyle
}

export interface PdfFontRegistry {
  readonly standardFonts: PdfStandardFontSet
  readonly embeddedFonts: readonly PdfEmbeddedFont[]
}

export interface PdfTextFontRun {
  readonly text: string
  readonly x: number
  readonly font: PDFFont
}

const pdfGraphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/** 嵌入 PDF 标准字体的常规、粗体、斜体和粗斜体变体。 */
export async function readPdfStandardFonts(
  pdfDocument: PdfLibDocument,
  standardFonts: PdfStandardFontsModule
): Promise<PdfStandardFontSet> {
  const [regular, bold, italic, boldItalic] = await Promise.all([
    pdfDocument.embedFont(standardFonts.Helvetica),
    pdfDocument.embedFont(standardFonts.HelveticaBold),
    pdfDocument.embedFont(standardFonts.HelveticaOblique),
    pdfDocument.embedFont(standardFonts.HelveticaBoldOblique)
  ])

  return {
    regular,
    bold,
    italic,
    boldItalic
  }
}

/** 读取并嵌入调用方配置的 PDF 字体。 */
export async function readPdfEmbeddedFonts(
  pdfDocument: PdfLibDocument,
  progress: PdfProgressEvent[],
  warnings: PdfWarning[],
  options: ExportPdfOptions,
  assertNotCancelled: PdfCancelGuard
): Promise<readonly PdfEmbeddedFont[]> {
  const fontConfigs = options.fonts ?? []

  if (fontConfigs.length === 0) {
    return []
  }

  pushPdfProgress(progress, options, 'font-loading')
  assertNotCancelled()

  const fontkitModule = await loadPdfFontkitModule()

  pdfDocument.registerFontkit(createPdfLibFontkitAdapter(fontkitModule) as PdfDocumentFontkit)

  const fonts: PdfEmbeddedFont[] = []

  for (const config of fontConfigs) {
    try {
      const bytes = await readPdfFontBytes(config.source)
      const coverage = readPdfFontCoverage(fontkitModule, bytes)
      const font = await pdfDocument.embedFont(bytes, { subset: config.subset ?? true })

      fonts.push({
        family: config.family,
        font,
        coverage,
        weight: normalizePdfFontWeight(config.weight),
        style: config.style ?? 'normal'
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

/** 根据文本内容选择可编码的 PDF 字体。 */
export function resolvePdfFontForText(
  text: string,
  registry: PdfFontRegistry,
  style?: TextFragment['style']
): PDFFont {
  const embeddedFont = findPdfEmbeddedFontForText(text, registry, style)

  if (embeddedFont !== undefined && (containsTextOutsidePdfStandardEncoding(text) || style?.fontFamily !== undefined)) {
    return embeddedFont.font
  }

  return resolvePdfStandardFontForStyle(registry.standardFonts, style)
}

/** 按字体覆盖把单个 layout 文本片段拆为多个 PDF 绘制段。 */
export function resolvePdfFontRunsForTextFragment(
  fragment: TextFragment,
  registry: PdfFontRegistry
): readonly PdfTextFontRun[] {
  const graphemes = splitPdfGraphemes(fragment.text)
  const runs: PdfTextFontRun[] = []

  for (let index = 0; index < graphemes.length; index += 1) {
    const text = graphemes[index] ?? ''
    const font = resolvePdfFontForText(text, registry, fragment.style)
    const x = twipsToPdfPoints(fragment.x + (fragment.advanceTwips[index] ?? 0))
    const previous = runs.at(-1)

    if (previous?.font === font) {
      runs[runs.length - 1] = {
        ...previous,
        text: `${previous.text}${text}`
      }
      continue
    }

    runs.push({ text, x, font })
  }

  return runs
}

/** 在缺少可用字体时提前阻止 PDF 标准字体不可编码文本乱码导出。 */
export function assertPdfFontsCanCoverLayout(
  pages: readonly PageBox[],
  registry: PdfFontRegistry,
  options: ExportPdfOptions
): void {
  let missingTextSample = ''

  for (const page of pages) {
    for (const fragment of iteratePdfVisibleTextFragments(page)) {
      missingTextSample = appendPdfMissingTextSample(
        missingTextSample,
        readPdfMissingTextSample(fragment.text, registry, fragment.style)
      )
    }

    for (const text of iteratePdfHeaderFooterText(page)) {
      missingTextSample = appendPdfMissingTextSample(
        missingTextSample,
        readPdfMissingTextSample(text, registry)
      )
    }
  }

  if (missingTextSample.length > 0) {
    throw createPdfFontMissingError(options.requestId, options, registry.embeddedFonts[0]?.family, missingTextSample)
  }
}

/** 发现嵌入字体缺少请求变体时记录可恢复 warning。 */
export function warnPdfMissingFontVariants(
  pages: readonly PageBox[],
  registry: PdfFontRegistry,
  warnings: PdfWarning[],
  options: ExportPdfOptions
): void {
  const emitted = new Set<string>()

  for (const page of pages) {
    for (const fragment of iteratePdfVisibleTextFragments(page)) {
      const family = fragment.style.fontFamily

      if (family === undefined) {
        continue
      }

      const weight = normalizePdfFontWeight(fragment.style.bold === true ? 700 : undefined)
      const fontStyle = fragment.style.italic === true ? 'italic' : 'normal'

      if (weight === 400 && fontStyle === 'normal') {
        continue
      }

      const familyFonts = registry.embeddedFonts.filter((font) =>
        font.family === family && canPdfFontCoverText(font.coverage, fragment.text))
      const hasExactVariant = familyFonts.some((font) => font.weight === weight && font.style === fontStyle)
      const hasRegularFallback = familyFonts.some((font) => font.weight === 400 && font.style === 'normal')
      const key = `${family}:${weight}:${fontStyle}`

      if (hasExactVariant || !hasRegularFallback || emitted.has(key)) {
        continue
      }

      emitted.add(key)
      pushPdfWarning(warnings, options, {
        code: 'PDF_FONT_MISSING',
        severity: 'warning',
        message: 'PDF 字体变体缺失，已回退常规字体',
        fontFamily: family,
        fallback: 'regular-font-variant',
        recoverable: true
      })
    }
  }
}

/** 格式化页眉页脚可见文本，隐藏内部页码 source id。 */
function formatPdfHeaderFooterText(sourceId: string, pageNumber: number): string {
  return sourceId.startsWith('page-number-')
    ? String(pageNumber)
    : sourceId
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
    throw new Error('PDF_FONT_MISSING')
  }

  return new Uint8Array(await response.arrayBuffer())
}

/** 建立字体覆盖检测对象，字体集合只使用第一张具体字体。 */
function readPdfFontCoverage(fontkitModule: PdfFontkitModule, bytes: Uint8Array): PdfFontkitFont {
  const font = fontkitModule.create(bytes)

  if (isPdfFontkitCollection(font)) {
    const firstFont = font.fonts[0]

    if (firstFont === undefined) {
      throw new Error('PDF_FONT_MISSING')
    }

    return firstFont
  }

  return font
}

/** 判断 fontkit 结果是否是字体集合。 */
function isPdfFontkitCollection(value: PdfFontkitFont | PdfFontkitCollection): value is PdfFontkitCollection {
  return Array.isArray(Reflect.get(value, 'fonts'))
}

/** 创建兼容 pdf-lib subset 接口的 fontkit 适配器。 */
function createPdfLibFontkitAdapter(fontkitModule: PdfFontkitModule): PdfFontkitModule {
  return {
    create(input: Uint8Array) {
      const font = fontkitModule.create(input)

      if (isPdfFontkitCollection(font)) {
        return {
          ...font,
          fonts: font.fonts.map(patchPdfLibFontkitFont)
        }
      }

      return patchPdfLibFontkitFont(font)
    }
  }
}

/** 为 fontkit 2 subset 补 pdf-lib 1 期望的 encodeStream。 */
function patchPdfLibFontkitFont(font: PdfFontkitFont): PdfFontkitFont {
  const createSubset = Reflect.get(font, 'createSubset')

  if (typeof createSubset !== 'function') {
    return font
  }

  Reflect.set(font, 'createSubset', () => {
    const subset = createSubset.call(font)
    const encode = Reflect.get(subset, 'encode')
    const encodeStream = Reflect.get(subset, 'encodeStream')

    if (typeof encode === 'function' && encodeStream === undefined) {
      Reflect.set(subset, 'encodeStream', () =>
        createPdfFontkitSubsetStream(() => encode.call(subset) as Uint8Array)
      )
    }

    return subset
  })

  return font
}

/** 把 fontkit 2 的同步 subset encode 包装成 pdf-lib 使用的流式接口。 */
function createPdfFontkitSubsetStream(readBytes: () => Uint8Array): PdfFontkitSubsetStream {
  const dataHandlers: PdfFontkitSubsetDataHandler[] = []
  const endHandlers: PdfFontkitSubsetEndHandler[] = []
  const errorHandlers: PdfFontkitSubsetErrorHandler[] = []
  let scheduled = false

  const stream: PdfFontkitSubsetStream = {
    on(event, handler) {
      if (event === 'data') {
        dataHandlers.push(handler as PdfFontkitSubsetDataHandler)
      } else if (event === 'end') {
        endHandlers.push(handler as PdfFontkitSubsetEndHandler)
      } else {
        errorHandlers.push(handler as PdfFontkitSubsetErrorHandler)
      }

      if (!scheduled) {
        scheduled = true
        queueMicrotask(() => {
          try {
            const bytes = readBytes()
            dataHandlers.forEach((dataHandler) => dataHandler(bytes))
            endHandlers.forEach((endHandler) => endHandler())
          } catch (error) {
            errorHandlers.forEach((errorHandler) => errorHandler(error))
          }
        })
      }

      return stream
    }
  }

  return stream
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

/** 按文本样式选择 PDF 标准字体变体。 */
function resolvePdfStandardFontForStyle(
  fonts: PdfStandardFontSet,
  style?: TextFragment['style']
): PDFFont {
  const bold = style?.bold === true
  const italic = style?.italic === true

  if (bold && italic) {
    return fonts.boldItalic
  }

  if (bold) {
    return fonts.bold
  }

  if (italic) {
    return fonts.italic
  }

  return fonts.regular
}

/** 查找覆盖整段文本的嵌入字体。 */
function findPdfEmbeddedFontForText(
  text: string,
  registry: PdfFontRegistry,
  style?: TextFragment['style']
): PdfEmbeddedFont | undefined {
  const family = style?.fontFamily
  const matchingFamilyCandidates = family === undefined
    ? []
    : registry.embeddedFonts.filter((font) => font.family === family && canPdfFontCoverText(font.coverage, text))
  const candidates = matchingFamilyCandidates.length > 0
    ? matchingFamilyCandidates
    : registry.embeddedFonts.filter((font) => canPdfFontCoverText(font.coverage, text))

  return resolvePdfEmbeddedFontVariant(candidates, style)
}

/** 按字重和字形选择最匹配的嵌入字体变体。 */
function resolvePdfEmbeddedFontVariant(
  candidates: readonly PdfEmbeddedFont[],
  style?: TextFragment['style']
): PdfEmbeddedFont | undefined {
  const weight = normalizePdfFontWeight(style?.bold === true ? 700 : undefined)
  const fontStyle = style?.italic === true ? 'italic' : 'normal'

  return candidates.find((font) => font.weight === weight && font.style === fontStyle)
    ?? candidates.find((font) => font.weight === 400 && font.style === 'normal')
    ?? candidates[0]
}

/** 把 PDF 字重归一到常规和粗体两档。 */
function normalizePdfFontWeight(weight: number | undefined): number {
  return weight !== undefined && weight >= 600 ? 700 : 400
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

/** 遍历当前 PDF renderer 会输出的页眉页脚文本。 */
function* iteratePdfHeaderFooterText(page: PageBox): Iterable<string> {
  for (const box of page.headerFooterBoxes) {
    yield formatPdfHeaderFooterText(box.sourceId, box.pageNumber)
  }
}

/** 遍历当前 PDF renderer 会输出的正文和表格文本片段。 */
function* iteratePdfVisibleTextFragments(page: PageBox): Iterable<TextFragment> {
  for (const line of page.lines) {
    yield* line.fragments
  }

  for (const block of page.blocks) {
    if (block.kind !== 'table') {
      continue
    }

    for (const row of block.rows) {
      for (const cell of row.cells) {
        for (const fragment of cell.fragments) {
          yield fragment
        }
      }
    }
  }
}

/** 读取当前字体集合无法覆盖的前 20 个 grapheme。 */
function readPdfMissingTextSample(
  text: string,
  registry: PdfFontRegistry,
  style?: TextFragment['style']
): string {
  return splitPdfGraphemes(text)
    .filter((grapheme) =>
      containsTextOutsidePdfStandardEncoding(grapheme) &&
      findPdfEmbeddedFontForText(grapheme, registry, style) === undefined
    )
    .slice(0, 20)
    .join('')
}

/** 合并缺字样本并限制到前 20 个 grapheme。 */
function appendPdfMissingTextSample(current: string, next: string): string {
  if (next.length === 0) {
    return current
  }

  return splitPdfGraphemes(`${current}${next}`).slice(0, 20).join('')
}

/** 判断文本是否超出 PDF 标准字体 WinAnsi 覆盖范围。 */
function containsTextOutsidePdfStandardEncoding(text: string): boolean {
  for (const character of text) {
    const codePoint = character.codePointAt(0)

    if (codePoint !== undefined && codePoint > 255) {
      return true
    }
  }

  return false
}

/** 按 grapheme cluster 切分 PDF 文本。 */
function splitPdfGraphemes(text: string): readonly string[] {
  return [...pdfGraphemeSegmenter.segment(text)].map((segment) => segment.segment)
}

/** 创建缺少 PDF 字体的稳定错误并触发回调。 */
function createPdfFontMissingError(
  requestId: string | undefined,
  options: ExportPdfOptions,
  fontFamily?: string,
  missingTextSample?: string
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
    ...(missingTextSample === undefined ? {} : { missingTextSample }),
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
