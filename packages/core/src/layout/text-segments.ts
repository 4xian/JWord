/**
 * 职责：把 run 内文本切成适合布局和 Canvas 绘制的自然片段，并保留 grapheme advance。
 * 边界：只处理纯文本分段和字体度量，不访问 DOM、不绘制 Canvas、不读取文档状态。
 * 协作模块：engine 使用这里生成 TextFragment，query 通过 advanceTwips 做片段内部命中。
 * 性能/安全约束：只对当前 inline 文本做线性扫描，避免逐字符 Canvas 绘制拉开英文单词。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/03-architecture.md#36-layout-engine。
 */

import { segmentGraphemes } from '../shared/grapheme'
import { cssPxToTwips } from './page-config'
import type { FontManager, ResolvedFontStyle, RunTextStyle } from './font-manager'

export interface LayoutTextSegment {
  readonly text: string
  readonly startGraphemeIndex: number
  readonly endGraphemeIndex: number
  readonly graphemes: readonly string[]
}

export interface MeasuredLayoutTextSegment extends LayoutTextSegment {
  readonly width: number
  readonly height: number
  readonly baseline: number
  readonly style: ResolvedFontStyle
  readonly advanceTwips: readonly number[]
}

/**
 * 按自然绘制边界切分文本。
 *
 * @param text inline 文本。
 * @param startGraphemeIndex run 内起始 grapheme 下标。
 * @returns 可直接测量和绘制的文本片段。
 */
export function segmentTextForLayout(text: string, startGraphemeIndex: number): readonly LayoutTextSegment[] {
  const segments = segmentGraphemes(text)
  const output: LayoutTextSegment[] = []
  let pending: string[] = []
  let pendingStart = startGraphemeIndex
  let pendingKind: TextSegmentKind | undefined

  for (const segment of segments) {
    const kind = classifyTextSegment(segment.segment)
    const absoluteIndex = startGraphemeIndex + segment.graphemeIndex

    if (pending.length === 0) {
      pending = [segment.segment]
      pendingStart = absoluteIndex
      pendingKind = kind
      continue
    }

    if (kind === pendingKind && kind !== 'single') {
      pending.push(segment.segment)
      continue
    }

    output.push(createLayoutTextSegment(pending, pendingStart))
    pending = [segment.segment]
    pendingStart = absoluteIndex
    pendingKind = kind
  }

  if (pending.length > 0) {
    output.push(createLayoutTextSegment(pending, pendingStart))
  }

  return Object.freeze(output)
}

/**
 * 把自然片段退回单 grapheme 片段。
 *
 * @param segment 已分组的布局文本片段。
 * @returns 每个 grapheme 一个片段。
 */
export function splitTextSegmentIntoGraphemes(segment: LayoutTextSegment): readonly LayoutTextSegment[] {
  return Object.freeze(segment.graphemes.map((grapheme, index) =>
    createLayoutTextSegment([grapheme], segment.startGraphemeIndex + index)
  ))
}

/**
 * 测量一个自然片段，必要时退回 grapheme 级片段。
 *
 * @param input 字体管理器、文本片段、样式和单行最大宽度。
 * @returns 一个或多个可追加到布局行的测量片段。
 */
export function measureTextSegmentForLayout(input: Readonly<{
  fontManager: FontManager
  segment: LayoutTextSegment
  style: RunTextStyle
  maxWidth: number
}>): readonly MeasuredLayoutTextSegment[] {
  const measured = measureLayoutTextSegment({
    fontManager: input.fontManager,
    segment: input.segment,
    style: input.style
  })

  if (measured.width <= input.maxWidth || input.segment.graphemes.length <= 1) {
    return Object.freeze([measured])
  }

  return Object.freeze(splitTextSegmentIntoGraphemes(input.segment).map((segment) =>
    measureLayoutTextSegment({
      fontManager: input.fontManager,
      segment,
      style: input.style
    })
  ))
}

/**
 * 测量文本片段并生成 grapheme 边界 advance。
 *
 * @param input 字体管理器、文本片段和 run 样式。
 * @returns 带布局宽高和内部 advance 的片段。
 */
export function measureLayoutTextSegment(input: Readonly<{
  fontManager: FontManager
  segment: LayoutTextSegment
  style: RunTextStyle
}>): MeasuredLayoutTextSegment {
  const measurement = input.fontManager.measureText(input.segment.text, input.style)
  const width = cssPxToTwips(measurement.widthCssPx)

  return {
    ...input.segment,
    width,
    height: cssPxToTwips(measurement.heightCssPx),
    baseline: cssPxToTwips(measurement.baselineCssPx),
    style: measurement.resolvedFont,
    advanceTwips: createAdvanceTwips(input.fontManager, input.segment, input.style, width)
  }
}

type TextSegmentKind = 'word' | 'space' | 'single'

/**
 * 识别 grapheme 可否并入自然绘制片段。
 */
function classifyTextSegment(segment: string): TextSegmentKind {
  if (/^[\p{Letter}\p{Number}]$/u.test(segment) && !isCjkSegment(segment)) {
    return 'word'
  }

  if (/^\s$/u.test(segment)) {
    return 'space'
  }

  return 'single'
}

/**
 * 判断 grapheme 是否属于可逐字换行的 CJK 文本。
 */
function isCjkSegment(segment: string): boolean {
  return /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u.test(segment)
}

/**
 * 从 grapheme 列表创建布局片段。
 */
function createLayoutTextSegment(graphemes: readonly string[], startGraphemeIndex: number): LayoutTextSegment {
  return Object.freeze({
    text: graphemes.join(''),
    startGraphemeIndex,
    endGraphemeIndex: startGraphemeIndex + graphemes.length,
    graphemes: Object.freeze([...graphemes])
  })
}

/**
 * 生成片段内部每个 grapheme 边界的 advance。
 */
function createAdvanceTwips(
  fontManager: FontManager,
  segment: LayoutTextSegment,
  style: RunTextStyle,
  width: number
): readonly number[] {
  const advances = [0]
  let advance = 0

  for (let index = 0; index < segment.graphemes.length; index += 1) {
    if (index === segment.graphemes.length - 1) {
      advances.push(width)
      continue
    }

    advance += cssPxToTwips(fontManager.measureText(segment.graphemes[index] ?? '', style).widthCssPx)
    advances.push(advance)
  }

  return Object.freeze(advances)
}
