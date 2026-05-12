/**
 * 职责：集中处理 grapheme 边界与 UTF-16/Yjs 文本下标之间的转换。
 * 边界：只处理纯字符串边界计算，不访问 DOM、不读取文档状态、不承载编辑语义。
 * 协作模块：position 和 operation-adapter 用它在公开 grapheme index 与 Y.Text UTF-16 index 之间转换。
 * 性能/安全约束：Gate 1 只覆盖小文本片段，按需分段即可；非法边界统一抛 JWordError。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/03-architecture.md#35-anchor-与-selection。
 */

import { createJWordError } from './errors'

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/**
 * 读取字符串的 grapheme 数量。
 *
 * @param text UTF-16 字符串。
 * @returns grapheme cluster 数量。
 */
export function countGraphemes(text: string): number {
  return collectGraphemeBoundaries(text).length - 1
}

/**
 * 把 grapheme 边界下标转换成 Y.Text 使用的 UTF-16 下标。
 *
 * @param text UTF-16 字符串。
 * @param graphemeIndex grapheme 边界下标。
 * @returns UTF-16/Yjs 下标。
 */
export function graphemeIndexToUtf16Index(text: string, graphemeIndex: number): number {
  const boundaries = collectGraphemeBoundaries(text)
  const utf16Index = boundaries[graphemeIndex]

  if (!Number.isInteger(graphemeIndex) || utf16Index === undefined) {
    throw createJWordError('OPERATION_TEXT_INDEX_OUT_OF_BOUNDS', '文本 grapheme 位置越界', {
      index: graphemeIndex,
      length: boundaries.length - 1
    })
  }

  return utf16Index
}

/**
 * 把 Y.Text 的 UTF-16 下标转换成 grapheme 边界下标。
 *
 * @param text UTF-16 字符串。
 * @param utf16Index UTF-16/Yjs 下标。
 * @returns grapheme 边界下标。
 */
export function utf16IndexToGraphemeIndex(text: string, utf16Index: number): number {
  const boundaries = collectGraphemeBoundaries(text)
  const graphemeIndex = boundaries.indexOf(utf16Index)

  if (!Number.isInteger(utf16Index) || graphemeIndex < 0) {
    throw createJWordError('OPERATION_TEXT_INDEX_OUT_OF_BOUNDS', '文本 UTF-16 位置不是 grapheme 边界', {
      index: utf16Index,
      length: text.length
    })
  }

  return graphemeIndex
}

function collectGraphemeBoundaries(text: string): readonly number[] {
  const boundaries = [0]

  for (const segment of segmenter.segment(text)) {
    boundaries.push(segment.index + segment.segment.length)
  }

  return boundaries
}
