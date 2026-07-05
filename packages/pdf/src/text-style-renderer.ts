/**
 * 职责：把 layout 文本片段的样式转换为 PDF 文本绘制参数和附加装饰。
 * 边界：只处理颜色、背景、装饰线和上下标基线，不选择字体、不遍历页面内容。
 * 协作模块：index.ts 在绘制 TextFragment 时调用，core 提供上下标共享比例常量。
 * 性能/安全约束：无 DOM 访问，不保存 PDFPage 状态，所有坐标由 layout 只读数据推导。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#iteration-23---实现-pdf-中文字体图片表格线和页眉页脚。
 */

import {
  SUBSCRIPT_BASELINE_SHIFT_RATIO,
  SUPERSCRIPT_BASELINE_SHIFT_RATIO,
  type PageBox,
  type TextFragment
} from '@4xian/jword-core'
import type { PDFPage, RGB } from 'pdf-lib'

import { twipsToPdfPoints } from './pdf-geometry.js'

export type PdfRgbFactory = (red: number, green: number, blue: number) => RGB

/** 读取 PDF 字号，优先使用 layout 已解析出的 CSS px。 */
export function readPdfFontSize(fragment: TextFragment): number {
  return (fragment.style.fontSizePx ?? 16) * 0.75
}

/** 读取 PDF 文本基线坐标。 */
export function readPdfTextBaseline(page: PageBox, fragment: TextFragment): number {
  return twipsToPdfPoints(page.height - fragment.baseline)
    + readPdfScriptBaselineShift(fragment)
}

/** 绘制 PDF 文本背景色。 */
export function renderPdfTextBackground(
  pdfPage: PDFPage,
  page: PageBox,
  fragment: TextFragment,
  createRgb: PdfRgbFactory
): void {
  const backgroundColor = fragment.style.backgroundColor

  if (backgroundColor === undefined || backgroundColor.length === 0) {
    return
  }

  pdfPage.drawRectangle({
    x: twipsToPdfPoints(fragment.x),
    y: twipsToPdfPoints(page.height - fragment.y - fragment.height),
    width: twipsToPdfPoints(fragment.width),
    height: twipsToPdfPoints(fragment.height),
    color: readPdfColor(backgroundColor, createRgb)
  })
}

/** 绘制 PDF 文本装饰线。 */
export function renderPdfTextDecoration(
  pdfPage: PDFPage,
  fragment: TextFragment,
  x: number,
  baseline: number,
  size: number,
  color: RGB
): void {
  if (fragment.style.underline !== true && fragment.style.strike !== true) {
    return
  }

  const thickness = Math.max(0.5, size / 14)
  const width = twipsToPdfPoints(fragment.width)

  if (fragment.style.underline === true) {
    const y = baseline - Math.max(0.5, thickness)

    drawPdfLine(pdfPage, x, y, x + width, y, thickness, color)
  }

  if (fragment.style.strike === true) {
    const y = baseline + (size * 0.3)

    drawPdfLine(pdfPage, x, y, x + width, y, thickness, color)
  }
}

/** 读取 PDF 文本颜色。 */
export function readPdfTextColor(fragment: TextFragment, createRgb: PdfRgbFactory): RGB {
  return readPdfColor(fragment.style.color ?? '#000000', createRgb)
}

/** 读取 PDF 边框颜色。 */
export function readPdfBorderColor(color: string | undefined, createRgb: PdfRgbFactory): RGB {
  if (color === undefined) {
    return createRgb(0, 0, 0)
  }

  return readPdfColor(color, createRgb)
}

/** 读取上下标在 PDF 坐标系中的基线偏移。 */
function readPdfScriptBaselineShift(fragment: TextFragment): number {
  const baseFontSize = (fragment.style.baseFontSizePx ?? fragment.style.fontSizePx ?? 16) * 0.75

  if (fragment.style.superscript === true) {
    return baseFontSize * SUPERSCRIPT_BASELINE_SHIFT_RATIO
  }

  if (fragment.style.subscript === true) {
    return -baseFontSize * SUBSCRIPT_BASELINE_SHIFT_RATIO
  }

  return 0
}

/** 绘制一条 PDF 直线。 */
function drawPdfLine(
  pdfPage: PDFPage,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  thickness: number,
  color: RGB
): void {
  pdfPage.drawLine({
    start: { x: startX, y: startY },
    end: { x: endX, y: endY },
    thickness,
    color
  })
}

/** 读取 #rrggbb 颜色并转换成 PDF RGB。 */
function readPdfColor(color: string, createRgb: PdfRgbFactory): RGB {
  const match = /^#(?<red>[0-9a-f]{2})(?<green>[0-9a-f]{2})(?<blue>[0-9a-f]{2})$/iu.exec(color)

  if (match?.groups === undefined) {
    return createRgb(0, 0, 0)
  }

  return createRgb(
    parseInt(match.groups.red ?? '00', 16) / 255,
    parseInt(match.groups.green ?? '00', 16) / 255,
    parseInt(match.groups.blue ?? '00', 16) / 255
  )
}
