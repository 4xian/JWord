/**
 * @vitest-environment node
 *
 * 职责：验证 Gate 5 DOCX public API 直调路径的商业授权边界。
 * 边界：只覆盖 importDocx/exportDocx 授权 fail-fast，不扩展 DOCX 格式能力。
 * 协作模块：packages/docx/src/index.ts 与 packages/license 共享稳定授权诊断。
 * 约束：缺授权时必须在读取或输出用户文档内容前失败，错误不携带文档内容。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#step-5-commercial-readiness。
 */

import type { JWordLicenseEntitlement, JWordLicenseSignaturePayload } from '@4xian/jword-license'
import { createJWordLicenseSignature } from '@4xian/jword-license'
import { describe, expect, it } from 'vitest'

import {
  exportDocx,
  createDocxIndexes,
  importDocx
} from '../src/index'
import {
  createMinimalDocxPackage,
  createProjection
} from './public-api-fixtures'

describe('@4xian/jword-docx public API license boundary', () => {
  it('fails import before reading invalid bytes when license is missing', async () => {
    await expect(importDocx(new ArrayBuffer(0), {
      requestId: 'docx-public-license-missing-import-1'
    })).rejects.toMatchObject({
      name: 'JWordLicenseError',
      code: 'JWORD_LICENSE_MISSING',
      feature: 'docx.import'
    })
  })

  it('fails import when license lacks the DOCX import feature', async () => {
    await expect(importDocx(await createMinimalDocxPackage(), {
      requestId: 'docx-public-license-mismatch-import-1',
      license: createDocxPublicLicense(['docx.export'])
    })).rejects.toMatchObject({
      name: 'JWordLicenseError',
      code: 'JWORD_FEATURE_NOT_ENTITLED',
      feature: 'docx.import',
      customerId: 'customer-docx-public'
    })
  })

  it('fails export before producing bytes when license is missing', async () => {
    await expect(exportDocx(createProjection(), {
      requestId: 'docx-public-license-missing-export-1'
    })).rejects.toMatchObject({
      name: 'JWordLicenseError',
      code: 'JWORD_LICENSE_MISSING',
      feature: 'docx.export'
    })
  })

  it('fails inspect and index creation before reading invalid bytes when license is missing', async () => {
    await expect(createDocxIndexes(new ArrayBuffer(0), {
      requestId: 'docx-public-license-missing-indexes-1'
    })).rejects.toMatchObject({
      name: 'JWordLicenseError',
      code: 'JWORD_LICENSE_MISSING',
      feature: 'docx.import'
    })
  })

  it('fails import when entitlement signature is tampered', async () => {
    await expect(importDocx(await createMinimalDocxPackage(), {
      requestId: 'docx-public-license-signature-invalid-1',
      license: {
        ...createDocxPublicLicense(['docx.import']),
        features: ['docx.export']
      }
    })).rejects.toMatchObject({
      name: 'JWordLicenseError',
      code: 'JWORD_LICENSE_SIGNATURE_INVALID',
      feature: 'docx.import',
      customerId: 'customer-docx-public'
    })
  })

  it('keeps import and export available with matching DOCX features', async () => {
    const exportResult = await exportDocx(createProjection(), {
      requestId: 'docx-public-license-export-ok-1',
      license: createDocxPublicLicense(['docx.export'])
    })
    const importResult = await importDocx(exportResult.bytes, {
      requestId: 'docx-public-license-import-ok-1',
      license: createDocxPublicLicense(['docx.import'])
    })

    expect(exportResult.diagnostics).toEqual({
      requestId: 'docx-public-license-export-ok-1',
      mainDocumentPart: 'word/document.xml'
    })
    expect(importResult.diagnostics).toEqual({
      requestId: 'docx-public-license-import-ok-1',
      mainDocumentPart: 'word/document.xml'
    })
  })
})

/** 创建 DOCX public API 授权测试使用的有效 entitlement。 */
function createDocxPublicLicense(features: readonly string[]): JWordLicenseEntitlement {
  const entitlement: JWordLicenseSignaturePayload = {
    customerId: 'customer-docx-public',
    licenseToken: 'token-docx-public',
    features,
    issuer: 'jword-test-issuer',
    issuedAt: '2026-05-01T00:00:00Z',
    expiresAt: '2026-06-01T00:00:00Z',
    status: 'valid'
  }

  return {
    ...entitlement,
    signature: createJWordLicenseSignature(entitlement)
  }
}
