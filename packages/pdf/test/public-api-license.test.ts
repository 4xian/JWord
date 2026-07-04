/**
 * @vitest-environment node
 *
 * 职责：验证 Gate 5 PDF public API 直调路径的商业授权边界。
 * 边界：只覆盖 exportPdfFromLayout 授权 fail-fast，不扩展 PDF 渲染能力。
 * 协作模块：packages/pdf/src/index.ts、core layout 和 packages/license 稳定诊断。
 * 约束：缺授权时必须在映射 layout 或生成 PDF 字节前失败，错误不携带文档内容。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#step-5-commercial-readiness。
 */

import {
  createFontManager,
  createPageConfig,
  layoutDocument,
  type DocumentLayout
} from '@4xian/jword-core'
import type { JWordLicenseEntitlement, JWordLicenseSignaturePayload } from '@4xian/jword-license'
import { createInsecureTestOnlyJWordLicenseSignature } from '@4xian/jword-license'
import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'

import { exportPdfFromLayout } from '../src/index'
import { INSECURE_TEST_ONLY_LICENSE_PRIVATE_KEY_SEED } from '../../../fixtures/license/insecure-test-only-keys'

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
      feature: 'pdf.export',
      customerId: 'customer-pdf-public'
    })
  })

  it('keeps export available with a matching PDF feature', async () => {
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

/** 创建 PDF public API 授权测试使用的有效 entitlement。 */
function createPdfPublicLicense(features: readonly string[]): JWordLicenseEntitlement {
  const entitlement: JWordLicenseSignaturePayload = {
    customerId: 'customer-pdf-public',
    licenseToken: 'token-pdf-public',
    features,
    issuer: 'jword-test-issuer',
    issuedAt: '2026-05-01T00:00:00Z',
    expiresAt: '2099-06-01T00:00:00Z',
    status: 'valid'
  }

  return {
    ...entitlement,
    signature: createInsecureTestOnlyJWordLicenseSignature(entitlement, INSECURE_TEST_ONLY_LICENSE_PRIVATE_KEY_SEED)
  }
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
