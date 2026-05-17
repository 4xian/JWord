/**
 * 职责：提供 Gate 2 无 DOM 字体状态、fallback、文本度量和 度量缓存。
 * 边界：不加载真实字体文件，不访问 画布、window 或 document，不做布局分页。
 * 协作模块：layout 使用 字体管理器 测量 文本片段，PDF 后续复用缺字体状态。
 * 性能/安全约束：缓存 key 只包含纯数据样式和文本，缺字体以可诊断状态返回。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/03-architecture.md#36-layout-engine。
 */

import { splitGraphemes } from '../shared/grapheme'

export type FontAvailabilityStatus = 'available' | 'fallback' | 'loading' | 'missing'

export interface RunTextStyle {
  readonly fontFamily?: string
  readonly fontSizePx?: number
  readonly fontSizeTwips?: number
  readonly bold?: boolean
  readonly italic?: boolean
  readonly underline?: boolean
  readonly strike?: boolean
  readonly color?: string
  readonly backgroundColor?: string
  readonly lineHeight?: number
}

export interface ResolvedFontStyle extends RunTextStyle {
  readonly fontFamily: string
  readonly requestedFontFamily?: string
  readonly fontSizePx: number
  readonly status: FontAvailabilityStatus
}

export interface TextMeasurement {
  readonly widthCssPx: number
  readonly heightCssPx: number
  readonly baselineCssPx: number
  readonly graphemeCount: number
  readonly resolvedFont: ResolvedFontStyle
}

export interface FontCacheStats {
  readonly size: number
  readonly hits: number
  readonly misses: number
}

export interface FontManagerOptions {
  readonly fallbackFontFamily?: string
  readonly availableFontFamilies?: readonly string[]
}

export interface FontManager {
  resolveFont(style?: RunTextStyle): ResolvedFontStyle
  measureText(text: string, style?: RunTextStyle): TextMeasurement
  registerFontFamily(fontFamily: string): void
  markFontFamilyAvailable(fontFamily: string): void
  getLoadingFontFamilies(): readonly string[]
  getMissingFontFamilies(): readonly string[]
  getCacheStats(): FontCacheStats
  clearCache(): void
}

const DEFAULT_FONT_SIZE_PX = 16
const DEFAULT_FALLBACK_FONT = 'Arial'

/**
 * 创建无 DOM 字体管理器。
 *
 * @param options fallback 字体和当前可用字体列表。
 * @returns 字体解析、度量和缓存服务。
 */
export function createFontManager(options: FontManagerOptions = {}): FontManager {
  const fallbackFontFamily = options.fallbackFontFamily ?? DEFAULT_FALLBACK_FONT
  const availableFontFamilies = new Set(options.availableFontFamilies ?? [fallbackFontFamily])
  const loadingFontFamilies = new Set<string>()
  const missingFontFamilies = new Set<string>()
  const cache = new Map<string, TextMeasurement>()
  let hits = 0
  let misses = 0

  const resetCache = (): void => {
    cache.clear()
    hits = 0
    misses = 0
  }

  return {
    resolveFont(style: RunTextStyle = {}): ResolvedFontStyle {
      const requestedFontFamily = style.fontFamily
      const fontSizePx = normalizeFontSizePx(style)

      if (requestedFontFamily === undefined) {
        return {
          ...style,
          fontFamily: fallbackFontFamily,
          fontSizePx,
          status: availableFontFamilies.has(fallbackFontFamily) ? 'available' : 'fallback'
        }
      }

      if (availableFontFamilies.has(requestedFontFamily)) {
        return {
          ...style,
          fontFamily: requestedFontFamily,
          fontSizePx,
          status: 'available'
        }
      }

      if (loadingFontFamilies.has(requestedFontFamily)) {
        return {
          ...style,
          fontFamily: fallbackFontFamily,
          requestedFontFamily,
          fontSizePx,
          status: 'loading'
        }
      }

      missingFontFamilies.add(requestedFontFamily)

      return {
        ...style,
        fontFamily: fallbackFontFamily,
        requestedFontFamily,
        fontSizePx,
        status: 'missing'
      }
    },
    measureText(text: string, style: RunTextStyle = {}): TextMeasurement {
      const resolvedFont = this.resolveFont(style)
      const key = createMeasurementCacheKey(text, resolvedFont)
      const cached = cache.get(key)

      if (cached !== undefined) {
        hits += 1
        return cached
      }

      misses += 1

      const graphemes = splitGraphemes(text)
      const widthCssPx = graphemes.reduce(
        (total, grapheme) => total + measureGraphemeWidth(grapheme, resolvedFont),
        0
      )
      const heightCssPx = resolveLineHeightCssPx(resolvedFont)
      const measurement = Object.freeze({
        widthCssPx,
        heightCssPx,
        baselineCssPx: heightCssPx * 0.78,
        graphemeCount: graphemes.length,
        resolvedFont
      })

      cache.set(key, measurement)

      return measurement
    },
    registerFontFamily(fontFamily: string): void {
      if (fontFamily.length === 0 || availableFontFamilies.has(fontFamily) || loadingFontFamilies.has(fontFamily)) {
        return
      }

      missingFontFamilies.delete(fontFamily)
      loadingFontFamilies.add(fontFamily)
      resetCache()
    },
    markFontFamilyAvailable(fontFamily: string): void {
      if (fontFamily.length === 0 || availableFontFamilies.has(fontFamily)) {
        return
      }

      loadingFontFamilies.delete(fontFamily)
      missingFontFamilies.delete(fontFamily)
      availableFontFamilies.add(fontFamily)
      resetCache()
    },
    getLoadingFontFamilies(): readonly string[] {
      return Object.freeze([...loadingFontFamilies])
    },
    getMissingFontFamilies(): readonly string[] {
      return Object.freeze([...missingFontFamilies])
    },
    getCacheStats(): FontCacheStats {
      return {
        size: cache.size,
        hits,
        misses
      }
    },
    clearCache(): void {
      resetCache()
    }
  }
}

function normalizeFontSizePx(style: RunTextStyle): number {
  if (style.fontSizePx !== undefined) {
    return style.fontSizePx
  }

  if (style.fontSizeTwips !== undefined) {
    return style.fontSizeTwips / 15
  }

  return DEFAULT_FONT_SIZE_PX
}

function resolveLineHeightCssPx(style: ResolvedFontStyle): number {
  if (style.lineHeight === undefined) {
    return style.fontSizePx * 1.2
  }

  if (style.lineHeight <= 3) {
    return style.fontSizePx * style.lineHeight
  }

  return style.lineHeight
}

function measureGraphemeWidth(grapheme: string, style: ResolvedFontStyle): number {
  const baseWidth = style.fontSizePx * getWidthRatio(grapheme)
  const boldFactor = style.bold === true ? 1.06 : 1
  const italicFactor = style.italic === true ? 1.02 : 1

  return baseWidth * boldFactor * italicFactor
}

/**
 * 按 East Asian Width 的整宽/半宽思路做近似，优先保证 CJK 正文、全角标点和 ASCII 文本的相对宽度关系。
 */
function getWidthRatio(grapheme: string): number {
  const eastAsianFullwidthRatio = readEastAsianFullwidthRatio(grapheme)

  if (eastAsianFullwidthRatio !== undefined) {
    return eastAsianFullwidthRatio
  }

  if (/^\s$/u.test(grapheme)) {
    return 0.33
  }

  if (/\p{Extended_Pictographic}/u.test(grapheme)) {
    return 1
  }

  if (/\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u.test(grapheme)) {
    return 1
  }

  const halfwidthPunctuationRatio = readHalfwidthPunctuationWidthRatio(grapheme)

  if (halfwidthPunctuationRatio !== undefined) {
    return halfwidthPunctuationRatio
  }

  if (/^[\p{P}\p{S}]$/u.test(grapheme)) {
    return 0.42
  }

  return readLatinWidthRatio(grapheme) ?? 0.56
}

/**
 * 依据 UAX #11 常见 W/F 区段，给全角中文标点、全角空格和兼容全角符号保留整字格 advance。
 */
function readEastAsianFullwidthRatio(grapheme: string): number | undefined {
  const codePoint = grapheme.codePointAt(0)

  if (codePoint === undefined) {
    return undefined
  }

  if (
    isCodePointInRange(codePoint, 0x3000, 0x303F)
    || isCodePointInRange(codePoint, 0xFE10, 0xFE19)
    || isCodePointInRange(codePoint, 0xFE30, 0xFE6B)
    || isCodePointInRange(codePoint, 0xFF01, 0xFF60)
    || isCodePointInRange(codePoint, 0xFFE0, 0xFFE6)
  ) {
    return 1
  }

  return undefined
}

/**
 * 对 ASCII 半角标点使用窄宽近似，避免把 . , ! : ; 等误当成接近全角标点的宽度。
 */
function readHalfwidthPunctuationWidthRatio(grapheme: string): number | undefined {
  if (!/^[\u0021-\u007E]$/u.test(grapheme) || !/^[\p{P}\p{S}]$/u.test(grapheme)) {
    return undefined
  }

  return HALFWIDTH_PUNCTUATION_WIDTH_RATIOS[grapheme] ?? 0.42
}

/**
 * 使用接近 Arial/Helvetica 的无 DOM ASCII 宽度表，降低英文长串光标和命中测试累计偏移。
 */
function readLatinWidthRatio(grapheme: string): number | undefined {
  if (!/^[\p{Letter}\p{Number}]$/u.test(grapheme)) {
    return undefined
  }

  if (/^[0-9]$/u.test(grapheme)) {
    return 0.556
  }

  return LATIN_WIDTH_RATIOS[grapheme] ?? (/^[a-z]$/u.test(grapheme) ? 0.556 : 0.667)
}

/**
 * 抽出简单区间判断，避免把 East Asian Width 的区段条件写散。
 */
function isCodePointInRange(codePoint: number, start: number, end: number): boolean {
  return codePoint >= start && codePoint <= end
}

const HALFWIDTH_PUNCTUATION_WIDTH_RATIOS: Readonly<Record<string, number>> = Object.freeze({
  '!': 0.278,
  '"': 0.355,
  '#': 0.556,
  '$': 0.556,
  '%': 0.889,
  '&': 0.667,
  '\'': 0.191,
  '(': 0.333,
  ')': 0.333,
  '*': 0.389,
  '+': 0.584,
  ',': 0.278,
  '-': 0.333,
  '.': 0.278,
  '/': 0.278,
  ':': 0.278,
  ';': 0.278,
  '<': 0.584,
  '=': 0.584,
  '>': 0.584,
  '?': 0.556,
  '@': 1.015,
  '[': 0.278,
  '\\': 0.278,
  ']': 0.278,
  '^': 0.469,
  '_': 0.556,
  '`': 0.333,
  '{': 0.334,
  '|': 0.26,
  '}': 0.334,
  '~': 0.584
})

const LATIN_WIDTH_RATIOS: Readonly<Record<string, number>> = Object.freeze({
  a: 0.556,
  b: 0.556,
  c: 0.5,
  d: 0.556,
  e: 0.556,
  f: 0.278,
  g: 0.556,
  h: 0.556,
  i: 0.222,
  j: 0.222,
  k: 0.5,
  l: 0.222,
  m: 0.833,
  n: 0.556,
  o: 0.556,
  p: 0.556,
  q: 0.556,
  r: 0.333,
  s: 0.5,
  t: 0.278,
  u: 0.556,
  v: 0.5,
  w: 0.722,
  x: 0.5,
  y: 0.5,
  z: 0.5,
  A: 0.667,
  B: 0.667,
  C: 0.722,
  D: 0.722,
  E: 0.667,
  F: 0.611,
  G: 0.778,
  H: 0.722,
  I: 0.278,
  J: 0.5,
  K: 0.667,
  L: 0.556,
  M: 0.833,
  N: 0.722,
  O: 0.778,
  P: 0.667,
  Q: 0.778,
  R: 0.722,
  S: 0.667,
  T: 0.611,
  U: 0.722,
  V: 0.667,
  W: 0.944,
  X: 0.667,
  Y: 0.667,
  Z: 0.611
})

function createMeasurementCacheKey(text: string, style: ResolvedFontStyle): string {
  return [
    text,
    style.fontFamily,
    style.requestedFontFamily ?? '',
    style.fontSizePx,
    style.bold === true ? 'bold' : 'normal',
    style.italic === true ? 'italic' : 'upright',
    style.underline === true ? 'underline' : 'no-underline',
    style.strike === true ? 'strike' : 'no-strike',
    style.color ?? '',
    style.backgroundColor ?? '',
    style.lineHeight ?? '',
    style.status
  ].join('\u0000')
}
