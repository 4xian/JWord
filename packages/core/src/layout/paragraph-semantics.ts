/**
 * 职责：把段落 styleId/list 语义解析成 layout 可消费的默认属性和 marker helper。
 * 边界：只做纯数据默认值和标签推导，不访问 DOM、不绘制 Canvas、不读取运行时状态。
 * 协作模块：internal 复用 run 默认样式，paragraph-flow 复用缩进/间距和列表 marker 规则。
 * 性能/安全约束：保持纯函数，避免把编号状态散落到多个模块；编号累加仍由 flow 游标持有。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#step-316。
 */

import { twipsToCssPx } from './page-config'
import type { RunTextStyle } from './font-manager'
import type { Paragraph, ParagraphList } from '../model/types'

export interface ParagraphLayoutProperties {
  readonly alignment: 'left' | 'center' | 'right' | 'justify'
  readonly indentLeftTwips: number
  readonly firstLineIndentTwips: number
  readonly hangingIndentTwips: number
  readonly spacingBeforeTwips: number
  readonly spacingAfterTwips: number
  readonly markerGapTwips: number
}

interface HeadingStyleDefaults {
  readonly runStyle: RunTextStyle
  readonly spacingBeforeTwips: number
  readonly spacingAfterTwips: number
}

const DEFAULT_FONT_SIZE_PX = 16
const LIST_BASE_INDENT_TWIPS = 720
const LIST_LEVEL_OFFSET_TWIPS = 360
const LIST_MARKER_GAP_TWIPS = 120
const BULLET_MARKERS = Object.freeze(['•', '◦', '▪'])
const HEADING_DEFAULTS: Readonly<Record<string, HeadingStyleDefaults>> = Object.freeze({
  Heading1: Object.freeze({
    runStyle: Object.freeze({
      fontSizeTwips: 480,
      fontSizePx: twipsToCssPx(480),
      bold: true
    }),
    spacingBeforeTwips: 240,
    spacingAfterTwips: 120
  }),
  Heading2: Object.freeze({
    runStyle: Object.freeze({
      fontSizeTwips: 360,
      fontSizePx: twipsToCssPx(360),
      bold: true
    }),
    spacingBeforeTwips: 180,
    spacingAfterTwips: 120
  }),
  Heading3: Object.freeze({
    runStyle: Object.freeze({
      fontSizeTwips: 300,
      fontSizePx: twipsToCssPx(300),
      bold: true
    }),
    spacingBeforeTwips: 120,
    spacingAfterTwips: 60
  })
})

/**
 * 读取段落在 layout 阶段要使用的默认几何属性。
 */
export function resolveParagraphLayoutProperties(paragraph: Paragraph): ParagraphLayoutProperties {
  const styleId = resolveParagraphStyleId(paragraph)
  const list = resolveParagraphList(paragraph)
  const headingDefaults = readHeadingStyleDefaults(styleId)

  return Object.freeze({
    alignment: readParagraphAlignment(paragraph),
    indentLeftTwips: readNumberProperty(paragraph.properties, 'indentLeftTwips')
      ?? resolveListIndentLeft(list),
    firstLineIndentTwips: readNumberProperty(paragraph.properties, 'firstLineIndentTwips') ?? 0,
    hangingIndentTwips: readNumberProperty(paragraph.properties, 'hangingIndentTwips') ?? 0,
    spacingBeforeTwips: readNumberProperty(paragraph.properties, 'spacingBeforeTwips')
      ?? headingDefaults?.spacingBeforeTwips
      ?? 0,
    spacingAfterTwips: readNumberProperty(paragraph.properties, 'spacingAfterTwips')
      ?? headingDefaults?.spacingAfterTwips
      ?? 0,
    markerGapTwips: LIST_MARKER_GAP_TWIPS
  })
}

/**
 * 读取段落 styleId 带来的 run 默认样式，显式 run properties 仍可覆盖。
 */
export function resolveParagraphRunStyleDefaults(paragraph: Paragraph): RunTextStyle {
  return readHeadingStyleDefaults(resolveParagraphStyleId(paragraph))?.runStyle ?? {
    fontSizePx: DEFAULT_FONT_SIZE_PX
  }
}

/**
 * 读取段落的稳定 heading styleId，兼容 projection 直接构造时只填 properties 的场景。
 */
export function resolveParagraphStyleId(paragraph: Paragraph): string | undefined {
  return paragraph.styleId ?? readStringProperty(paragraph.properties, 'styleId')
}

/**
 * 读取段落的稳定列表语义，兼容 projection 直接构造时只填 properties 的场景。
 */
export function resolveParagraphList(paragraph: Paragraph): ParagraphList | undefined {
  if (paragraph.list !== undefined) {
    return paragraph.list
  }

  const numberingId = readStringProperty(paragraph.properties, 'listNumberingId')
  const level = readNumberProperty(paragraph.properties, 'listLevel')

  if (numberingId === undefined || level === undefined) {
    return undefined
  }

  return Object.freeze({
    numberingId,
    level
  })
}

/**
 * 归一化列表类型，当前只区分 ordered / bullet。
 */
export function resolveParagraphListKind(list: ParagraphList): 'bullet' | 'ordered' {
  return list.numberingId.toLowerCase().includes('bullet') ? 'bullet' : 'ordered'
}

/**
 * 把 projection 里的 0-based list level 归一成 flow 里的 1-based 层级。
 */
export function resolveParagraphListLevel(list: ParagraphList): number {
  return Math.max(0, list.level) + 1
}

/**
 * 为 bullet list 选择稳定的层级 marker。
 */
export function resolveParagraphListBulletLabel(level: number): string {
  return BULLET_MARKERS[Math.max(0, level - 1) % BULLET_MARKERS.length] ?? BULLET_MARKERS[0]!
}

function readHeadingStyleDefaults(styleId: string | undefined): HeadingStyleDefaults | undefined {
  if (styleId === undefined) {
    return undefined
  }

  return HEADING_DEFAULTS[styleId]
}

function resolveListIndentLeft(list: ParagraphList | undefined): number {
  if (list === undefined) {
    return 0
  }

  return LIST_BASE_INDENT_TWIPS + Math.max(0, list.level) * LIST_LEVEL_OFFSET_TWIPS
}

function readParagraphAlignment(paragraph: Paragraph): ParagraphLayoutProperties['alignment'] {
  const alignment = paragraph.properties?.alignment

  return alignment === 'center' || alignment === 'right' || alignment === 'justify' ? alignment : 'left'
}

function readStringProperty(properties: Paragraph['properties'], key: string): string | undefined {
  const value = properties?.[key]

  return typeof value === 'string' ? value : undefined
}

function readNumberProperty(properties: Paragraph['properties'], key: string): number | undefined {
  const value = properties?.[key]

  return typeof value === 'number' ? value : undefined
}
