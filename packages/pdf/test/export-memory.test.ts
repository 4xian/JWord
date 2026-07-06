/**
 * @vitest-environment node
 *
 * 职责：验证 PDF 导出内存优化相关公开行为。
 * 边界：只覆盖导出结果 buffer 所有权，不验证真实 PDF 渲染内容。
 * 协作模块：packages/pdf/src/index.ts 的导出入口与 pdf-lib save 结果。
 * 约束：测试通过 mock pdf-lib 隔离内存复制行为，不依赖 PDF 字节解析。
 * Specs：docs/superpowers/reports/2026-07-02-jword-remediation-plan.md#phase-4---性能与内存优化。
 */

import {
  createFontManager,
  createPageConfig,
  layoutDocument
} from '@4xian/jword-core'
import { describe, expect, it, vi } from 'vitest'

import { exportPdfFromLayout } from '../src/index'
import { createPdfPublicApiLicense } from './public-api-fixtures'

const savedBuffer = new ArrayBuffer(8)
const savedBytes = new Uint8Array(savedBuffer)

vi.mock('pdf-lib', () => {
  const pdfDocument = {
    embedFont: vi.fn(async () => ({
      widthOfTextAtSize: () => 0
    })),
    addPage: vi.fn(() => ({
      drawText: vi.fn(),
      drawLine: vi.fn(),
      drawRectangle: vi.fn(),
      drawImage: vi.fn()
    })),
    save: vi.fn(async () => savedBytes),
    registerFontkit: vi.fn()
  }

  return {
    PDFDocument: {
      create: vi.fn(async () => pdfDocument)
    },
    StandardFonts: {
      Helvetica: 'Helvetica',
      HelveticaBold: 'Helvetica-Bold',
      HelveticaOblique: 'Helvetica-Oblique',
      HelveticaBoldOblique: 'Helvetica-BoldOblique'
    },
    rgb: vi.fn((red: number, green: number, blue: number) => ({ red, green, blue }))
  }
})

describe('@4xian/jword-pdf export memory', () => {
  it('returns the owned pdf-lib save buffer without an extra full copy', async () => {
    const result = await exportPdfFromLayout(createBlankLayout(), {
      license: createPdfPublicApiLicense(['pdf.export'])
    })

    expect(result.bytes).toBe(savedBuffer)
  })
})

/** 创建无文本与图片的最小 layout，避免 mock 字体参与真实绘制。 */
function createBlankLayout(): Parameters<typeof exportPdfFromLayout>[0] {
  return layoutDocument({
    projection: {
      document: {
        kind: 'document',
        id: 'document-pdf-memory',
        sections: [
          {
            kind: 'section',
            id: 'section-pdf-memory',
            blocks: []
          }
        ]
      }
    },
    pageConfig: createPageConfig(),
    fontManager: createFontManager()
  })
}
