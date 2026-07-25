/**
 * @vitest-environment node
 *
 * 职责：验证 Gate 5 DOCX public API 直调路径的商业授权边界。
 * 边界：只覆盖 importDocx/exportDocx 授权 fail-fast，不扩展 DOCX 格式能力。
 * 协作模块：packages/docx/src/index.ts 与 packages/license 共享稳定授权诊断。
 * 约束：缺授权时必须在读取或输出用户文档内容前失败，错误不携带文档内容。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import type { JWordLicenseEntitlement, JWordLicenseSignaturePayload } from '@4xian/jword-license'
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
import { INSECURE_TEST_ONLY_LICENSE_PRIVATE_KEY_SEED } from '../../../fixtures/license/insecure-test-only-keys'
import { createInsecureTestOnlyJWordLicenseSignature } from '../../../fixtures/license/create-insecure-test-only-jwl1-token'
import { createTestOnlyJWordLicenseEntitlement } from '../../../fixtures/license/test-only-entitlement-fixture.mjs'

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
      feature: 'docx.import'
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

  it('fails import for legacy JWL1 even when public entitlement fields are tampered', async () => {
    await expect(importDocx(await createMinimalDocxPackage(), {
      requestId: 'docx-public-license-signature-invalid-1',
      license: {
        ...createLegacyJwl1DocxPublicLicense(['docx.import']),
        features: ['docx.export']
      }
    })).rejects.toMatchObject({
      name: 'JWordLicenseError',
      code: 'JWORD_LICENSE_SIGNATURE_INVALID',
      feature: 'docx.import'
    })
  })

  it('keeps import and export business coverage through the test-only entitlement seam', async () => {
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

/** 创建 DOCX public API 业务测试使用的 test-only entitlement。 */
function createDocxPublicLicense(features: readonly string[]): JWordLicenseEntitlement {
  return createTestOnlyJWordLicenseEntitlement(features, {
    customerId: 'customer-docx-public'
  })
}

/** 创建必须由真实生产入口 fail closed 的旧 JWL1 entitlement。 */
function createLegacyJwl1DocxPublicLicense(features: readonly string[]): JWordLicenseEntitlement {
  const entitlement: JWordLicenseSignaturePayload = {
    customerId: 'customer-docx-public',
    licenseToken: 'token-docx-public',
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
