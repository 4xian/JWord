/**
 * @vitest-environment node
 *
 * 职责：验证布局文本分段的 grapheme advance 与性能敏感测量路径。
 * 边界：只覆盖 text-segments 的纯函数输出，不访问 DOM、不触发分页或 Canvas 渲染。
 * 协作模块：font-manager 提供可注入测量器，layout query 依赖 advanceTwips 做命中定位。
 * 约束：长段落 advance 必须保持线性测量，避免输入热路径退化为重复前缀扫描。
 * Specs：docs/superpowers/reports/2026-07-02-gate2-gate3-review.md#G2-05。
 */
import { describe, expect, it } from 'vitest'

import { createFontManager, type TextMeasurer } from '../../src/layout/font-manager'
import { cssPxToTwips } from '../../src/layout/page-config'
import { measureLayoutTextSegment, segmentTextForLayout } from '../../src/layout/text-segments'

describe('布局文本分段 advance', () => {
  it('按单个 grapheme 累加 advance，避免重复测量递增前缀', () => {
    const measuredTexts: string[] = []
    const textMeasurer: TextMeasurer = {
      measureText(text) {
        measuredTexts.push(text)

        return {
          widthCssPx: measureAsciiFixtureWidth(text),
          baselineRatio: 0.78
        }
      }
    }
    const fontManager = createFontManager({
      fallbackFontFamily: 'Arial',
      availableFontFamilies: ['Arial'],
      textMeasurer
    })
    const segment = segmentTextForLayout('abcde', 0)[0]

    if (segment === undefined) {
      throw new Error('测试文本未生成布局片段')
    }

    const measured = measureLayoutTextSegment({
      fontManager,
      segment,
      style: {
        fontFamily: 'Arial',
        fontSizePx: 16
      }
    })

    expect(measured.advanceTwips).toEqual([0, 1, 3, 6, 10, 15].map((width) => cssPxToTwips(width)))
    expect(measuredTexts).toEqual(['abcde', 'a', 'b', 'c', 'd'])
  })
})

/**
 * 为测试文本提供可加和的确定性宽度。
 */
function measureAsciiFixtureWidth(text: string): number {
  const widths: Record<string, number> = {
    a: 1,
    b: 2,
    c: 3,
    d: 4,
    e: 5
  }

  return [...text].reduce((total, character) => total + (widths[character] ?? 0), 0)
}
