/**
 * @vitest-environment node
 *
 * 职责：验证 PDF 文本样式渲染器的颜色解析兼容性。
 * 边界：只覆盖颜色字符串到 pdf-lib RGB 入参的转换，不创建 PDF 文档。
 * 协作模块：packages/pdf/src/text-style-renderer.ts 供正文、边框和页眉页脚渲染复用。
 * 约束：颜色扩展必须覆盖 #RGB、rgba() 与命名颜色，未知值稳定回退黑色。
 * Specs：docs/superpowers/reports/2026-07-02-gate45-gate5-review.md#p3。
 */

import { describe, expect, it } from 'vitest'

import { readPdfBorderColor } from '../src/text-style-renderer'

describe('PDF text style color renderer', () => {
  it('parses short hex, rgba and named colors before falling back to black', () => {
    expect(readColor('#0f8')).toEqual([0, 1, 0.533333])
    expect(readColor('rgba(255, 128, 0, 0.25)')).toEqual([1, 0.501961, 0])
    expect(readColor('blue')).toEqual([0, 0, 1])
    expect(readColor('not-a-color')).toEqual([0, 0, 0])
  })
})

/** 通过边框颜色公开 helper 读取 RGB 三元组。 */
function readColor(color: string): readonly number[] {
  const result = readPdfBorderColor(color, (red, green, blue) => ({ red, green, blue } as ReturnType<typeof readPdfBorderColor>)) as unknown as {
    readonly red: number
    readonly green: number
    readonly blue: number
  }

  return [roundColor(result.red), roundColor(result.green), roundColor(result.blue)]
}

/** 规整浮点误差，便于断言。 */
function roundColor(value: number): number {
  return Math.round(value * 1000000) / 1000000
}
