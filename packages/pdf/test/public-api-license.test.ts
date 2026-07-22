/**
 * @vitest-environment node
 *
 * 职责：验证 Gate 5 PDF public API 直调路径的商业授权边界。
 * 边界：只覆盖 exportPdfFromLayout 授权 fail-fast，不扩展 PDF 渲染能力。
 * 协作模块：packages/pdf/src/index.ts、core layout 和 packages/license 稳定诊断。
 * 约束：缺授权时必须在映射 layout 或生成 PDF 字节前失败，错误不携带文档内容。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import {
  createFontManager,
  createPageConfig,
  layoutDocument,
  type DocumentLayout
} from '@4xian/jword-core'
import type { JWordLicenseEntitlement } from '@4xian/jword-license'
import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'

import { exportPdfFromLayout } from '../src/index'
import { createTestOnlyJWordLicenseEntitlement } from '../../../fixtures/license/test-only-entitlement-fixture.mjs'

describe('@4xian/jword-pdf public API license boundary', () => {
  it('fails export before mapping layout when license is missing', async () => {
    await expect(exportPdfFromLayout(createLicenseTestLayout(), {
      requestId: 'pdf-public-license-missing-export-1'
    })).rejects.toMatchObject({
      name: 'JWordLicenseError',
      code: 'JWORD_LICENSE_MISSING',
      feature: 'pdf.export'
    })
  })

  it('fails export when license lacks the PDF feature', async () => {
    await expect(exportPdfFromLayout(createLicenseTestLayout(), {
      requestId: 'pdf-public-license-mismatch-export-1',
      license: createPdfPublicLicense(['docx.import'])
    })).rejects.toMatchObject({
      name: 'JWordLicenseError',
      code: 'JWORD_FEATURE_NOT_ENTITLED',
      feature: 'pdf.export'
    })
  })

  it('keeps export business coverage through the test-only entitlement seam', async () => {
    const result = await exportPdfFromLayout(createLicenseTestLayout(), {
      requestId: 'pdf-public-license-export-ok-1',
      license: createPdfPublicLicense(['pdf.export'])
    })
    const pdf = await PDFDocument.load(result.bytes)

    expect(pdf.getPageCount()).toBe(1)
    expect(result.progress.map((event) => event.stage)).toEqual([
      'queued',
      'mapping',
      'writing',
      'done'
    ])
  })
})

/** 创建 PDF public API 业务测试使用的 test-only entitlement。 */
function createPdfPublicLicense(features: readonly string[]): JWordLicenseEntitlement {
  return createTestOnlyJWordLicenseEntitlement(features, {
    customerId: 'customer-pdf-public'
  })
}

/** 创建授权边界测试使用的最小 layout。 */
function createLicenseTestLayout(): DocumentLayout {
  return layoutDocument({
    projection: {
      document: {
        kind: 'document',
        id: 'document-license-test',
        sections: []
      }
    },
    pageConfig: createPageConfig(),
    fontManager: createFontManager()
  })
}
