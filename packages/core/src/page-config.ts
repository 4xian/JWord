/**
 * 职责：定义 Gate 2 页面配置、纸张预设、边距、缩放和 twip/CSS px 换算。
 * 边界：只处理纯数据页面几何，不做布局、渲染、输入、字体加载或 DOM 访问。
 * 协作模块：layout 使用 页面配置 计算分页，渲染器和 PDF 后续复用尺寸和单位转换。
 * 性能/安全约束：无副作用、无浏览器 API，所有输出不可变，避免单长 canvas 路线依赖。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/03-architecture.md#36-layout-engine。
 */

export const TWIPS_PER_INCH = 1440
export const CSS_PX_PER_INCH = 96

export type PagePreset = 'a4' | 'letter'
export type PageOrientation = 'portrait' | 'landscape'

export interface PageMargins {
  readonly top: number
  readonly right: number
  readonly bottom: number
  readonly left: number
}

export interface PageConfigInput {
  readonly preset?: PagePreset
  readonly orientation?: PageOrientation
  readonly widthTwips?: number
  readonly heightTwips?: number
  readonly marginTwips?: Partial<PageMargins>
  readonly scale?: number
}

export interface PageConfig {
  readonly preset: PagePreset | 'custom'
  readonly orientation: PageOrientation
  readonly widthTwips: number
  readonly heightTwips: number
  readonly contentWidthTwips: number
  readonly contentHeightTwips: number
  readonly marginTwips: PageMargins
  readonly scale: number
  readonly widthCssPx: number
  readonly heightCssPx: number
  readonly contentWidthCssPx: number
  readonly contentHeightCssPx: number
  readonly marginCssPx: PageMargins
}

const PAGE_PRESETS: Readonly<Record<PagePreset, Readonly<{
  widthTwips: number
  heightTwips: number
}>>> = {
  a4: {
    widthTwips: 11906,
    heightTwips: 16838
  },
  letter: {
    widthTwips: 12240,
    heightTwips: 15840
  }
}

const DEFAULT_MARGIN_TWIPS: PageMargins = {
  top: 1440,
  right: 1440,
  bottom: 1440,
  left: 1440
}

/**
 * 创建规范化页面配置。
 *
 * @param input 页面预设、方向、边距和缩放。
 * @returns 可供 layout 使用的不可变页面配置。
 */
export function createPageConfig(input: PageConfigInput = {}): PageConfig {
  const preset = input.preset ?? (hasCustomSize(input) ? 'custom' : 'a4')
  const orientation = input.orientation ?? 'portrait'
  const presetSize = preset === 'custom' ? PAGE_PRESETS.a4 : PAGE_PRESETS[preset]
  const baseWidthTwips = input.widthTwips ?? presetSize.widthTwips
  const baseHeightTwips = input.heightTwips ?? presetSize.heightTwips
  const size = orientSize(baseWidthTwips, baseHeightTwips, orientation)
  const marginTwips = normalizeMargins(input.marginTwips)
  const scale = input.scale ?? 1
  const contentWidthTwips = Math.max(0, size.widthTwips - marginTwips.left - marginTwips.right)
  const contentHeightTwips = Math.max(0, size.heightTwips - marginTwips.top - marginTwips.bottom)

  return Object.freeze({
    preset,
    orientation,
    widthTwips: size.widthTwips,
    heightTwips: size.heightTwips,
    contentWidthTwips,
    contentHeightTwips,
    marginTwips,
    scale,
    widthCssPx: twipsToCssPx(size.widthTwips, scale),
    heightCssPx: twipsToCssPx(size.heightTwips, scale),
    contentWidthCssPx: twipsToCssPx(contentWidthTwips, scale),
    contentHeightCssPx: twipsToCssPx(contentHeightTwips, scale),
    marginCssPx: Object.freeze({
      top: twipsToCssPx(marginTwips.top, scale),
      right: twipsToCssPx(marginTwips.right, scale),
      bottom: twipsToCssPx(marginTwips.bottom, scale),
      left: twipsToCssPx(marginTwips.left, scale)
    })
  })
}

/**
 * twip 转 CSS px。
 *
 * @param twips twip 数值。
 * @param scale 页面缩放。
 * @returns CSS px 数值。
 */
export function twipsToCssPx(twips: number, scale = 1): number {
  return twips * CSS_PX_PER_INCH / TWIPS_PER_INCH * scale
}

/**
 * CSS px 转 twip。
 *
 * @param cssPx CSS px 数值。
 * @param scale 页面缩放。
 * @returns twip 数值。
 */
export function cssPxToTwips(cssPx: number, scale = 1): number {
  return cssPx / scale * TWIPS_PER_INCH / CSS_PX_PER_INCH
}

function hasCustomSize(input: PageConfigInput): boolean {
  return input.widthTwips !== undefined || input.heightTwips !== undefined
}

function orientSize(
  widthTwips: number,
  heightTwips: number,
  orientation: PageOrientation
): Readonly<{
  widthTwips: number
  heightTwips: number
}> {
  if (orientation === 'landscape' && widthTwips < heightTwips) {
    return {
      widthTwips: heightTwips,
      heightTwips: widthTwips
    }
  }

  if (orientation === 'portrait' && widthTwips > heightTwips) {
    return {
      widthTwips: heightTwips,
      heightTwips: widthTwips
    }
  }

  return {
    widthTwips,
    heightTwips
  }
}

function normalizeMargins(input: Partial<PageMargins> | undefined): PageMargins {
  return Object.freeze({
    top: input?.top ?? DEFAULT_MARGIN_TWIPS.top,
    right: input?.right ?? DEFAULT_MARGIN_TWIPS.right,
    bottom: input?.bottom ?? DEFAULT_MARGIN_TWIPS.bottom,
    left: input?.left ?? DEFAULT_MARGIN_TWIPS.left
  })
}
