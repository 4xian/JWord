/**
 * @vitest-environment node
 *
 * 职责：验证 PDF 图片资源在导出时按需读取并按 resourceId 复用。
 * 边界：只覆盖图片内存路径，不扩展字体、表格或视觉对比断言。
 * 协作模块：packages/pdf/src/index.ts、core layout 输出和 public API fixture。
 * 约束：通过真实 pdf-lib 输出验证资源复用，不依赖内部 cache 结构。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import {
  createFontManager,
  createPageConfig,
  layoutDocument
} from '@4xian/jword-core'
import { describe, expect, it } from 'vitest'

import { exportPdfFromLayout as exportPdfFromLayoutPublic } from '../src/index'
import type { ExportPdfOptions } from '../src/index'
import {
  ONE_PIXEL_PNG_DATA_URL,
  createPdfPublicApiLicense
} from './public-api-fixtures'
import { readInflatedPdfStreams } from './public-api-pdf-style-helpers'

/** 以有效授权调用 PDF export，保持测试聚焦于图片资源路径。 */
function exportPdfFromLayout(
  layout: Parameters<typeof exportPdfFromLayoutPublic>[0],
  options: ExportPdfOptions = {}
) {
  return exportPdfFromLayoutPublic(layout, {
    ...options,
    license: createPdfPublicApiLicense(['pdf.export'])
  })
}

describe('@4xian/jword-pdf image memory', () => {
  it('reuses one embedded PDF image when the same resource appears multiple times', async () => {
    const result = await exportPdfFromLayout(createRepeatedImageLayout(), {
      images: [{
        kind: 'dataUrl',
        id: 'image-pdf-inline-1',
        dataUrl: ONE_PIXEL_PNG_DATA_URL
      }]
    })
    const streams = readInflatedPdfStreams(result.bytes)
    const rawPdf = Buffer.from(result.bytes).toString('latin1')

    expect(rawPdf.match(/\/Subtype \/Image/gu)).toHaveLength(2)
    expect(streams.filter((stream) => stream.includes(' Do')).length).toBeGreaterThanOrEqual(2)
  })

  it('does not read unused image inputs before rendering referenced pages', async () => {
    const result = await exportPdfFromLayout(createImageLayout(), {
      images: [
        {
          kind: 'dataUrl',
          id: 'image-pdf-inline-1',
          dataUrl: ONE_PIXEL_PNG_DATA_URL
        },
        {
          kind: 'dataUrl',
          id: 'image-pdf-unused-gif',
          dataUrl: 'data:image/gif;base64,R0lGODlhAQABAAAAACw='
        }
      ]
    })
    const rawPdf = Buffer.from(result.bytes).toString('latin1')

    expect(rawPdf).toContain('/Subtype /Image')
  })
})

/** 创建只包含一个 inline 图片的 layout。 */
function createImageLayout(): Parameters<typeof exportPdfFromLayout>[0] {
  return layoutDocument({
    projection: {
      document: {
        kind: 'document',
        id: 'document-pdf-image-memory',
        resourceIds: ['image-pdf-inline-1'],
        resources: [{
          kind: 'resource',
          id: 'image-pdf-inline-1',
          mime: 'image/png',
          source: {
            kind: 'dataUrl',
            url: ONE_PIXEL_PNG_DATA_URL
          },
          status: 'success'
        }],
        sections: [
          {
            kind: 'section',
            id: 'section-pdf-image-memory',
            blocks: [
              {
                kind: 'paragraph',
                id: 'paragraph-pdf-image-memory',
                runs: [
                  {
                    kind: 'run',
                    id: 'run-pdf-image-memory',
                    inlines: [
                      {
                        kind: 'image',
                        resourceId: 'image-pdf-inline-1',
                        widthTwips: 720,
                        heightTwips: 720
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      }
    },
    pageConfig: createPageConfig({
      widthTwips: 7200,
      heightTwips: 10080,
      marginTwips: {
        top: 720,
        right: 720,
        bottom: 720,
        left: 720
      }
    }),
    fontManager: createFontManager()
  })
}

/** 创建重复引用同一图片资源的双页 layout。 */
function createRepeatedImageLayout(): Parameters<typeof exportPdfFromLayout>[0] {
  const layout = createImageLayout()
  const firstPage = layout.pages[0]

  if (firstPage === undefined) {
    return layout
  }

  return {
    ...layout,
    pages: [
      firstPage,
      {
        ...firstPage,
        pageIndex: 1,
        y: firstPage.y + firstPage.height
      }
    ]
  }
}
