/**
 * 职责：提供 Gate 2 无 DOM 字体状态、fallback、文本度量和 度量缓存。
 * 边界：不加载真实字体文件，不访问 画布、window 或 document，不做布局分页。
 * 协作模块：layout 使用 字体管理器 测量 文本片段，PDF 后续复用缺字体状态。
 * 性能/安全约束：缓存 key 只包含纯数据样式和文本，缺字体以可诊断状态返回。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/03-architecture.md#36-layout-engine。
 */

import { splitGraphemes } from './grapheme'

export type FontAvailabilityStatus = 'available' | 'fallback' | 'loading' | 'missing'

export interface RunTextStyle {
  readonly fontFamily?: string
  readonly fontSizePx?: number
  readonly fontSizeTwips?: number
  readonly bold?: boolean
  readonly italic?: boolean
  readonly color?: string
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

function getWidthRatio(grapheme: string): number {
  if (/^\s$/u.test(grapheme)) {
    return 0.33
  }

  if (/\p{Extended_Pictographic}/u.test(grapheme)) {
    return 1
  }

  if (/\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u.test(grapheme)) {
    return 1
  }

  if (/^[\p{P}\p{S}]$/u.test(grapheme)) {
    return 0.42
  }

  return 0.56
}

function createMeasurementCacheKey(text: string, style: ResolvedFontStyle): string {
  return [
    text,
    style.fontFamily,
    style.requestedFontFamily ?? '',
    style.fontSizePx,
    style.bold === true ? 'bold' : 'normal',
    style.italic === true ? 'italic' : 'upright',
    style.lineHeight ?? '',
    style.status
  ].join('\u0000')
}
