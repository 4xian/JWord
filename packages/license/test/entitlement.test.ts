/**
 * @vitest-environment node
 *
 * 职责：锁定 Gate 5 商业授权 entitlement 的公开契约。
 * 边界：只验证 license 包的 feature matrix、稳定诊断和离线宽限判断，不触碰 DOCX/PDF 运行时。
 * 协作模块：packages/docx、packages/pdf、examples/docx 和后续商业包发布检查复用这些类型与错误码。
 * 约束：授权判断必须是纯函数；未授权、过期、feature 不匹配和服务不可用都要返回稳定 code。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import { describe, expect, it } from 'vitest'

import {
  GATE5_FORMAT_FEATURES,
  GATE6_COLLAB_FEATURES,
  JWORD_LICENSE_DIAGNOSTIC_CODE_METADATA,
  assertJWordFeatureEntitled,
  createJWordLicenseError,
  createInsecureTestOnlyJWordLicenseSignature,
  isJWordLicenseDiagnosticCode,
  type JWordLicenseEntitlement,
  type JWordLicenseSignaturePayload
} from '../src/index'
import { INSECURE_TEST_ONLY_LICENSE_PRIVATE_KEY_SEED } from '../../../fixtures/license/insecure-test-only-keys'

describe('@4xian/jword-license entitlement contract', () => {
  it('exposes the Gate 5 format feature keys', () => {
    expect(GATE5_FORMAT_FEATURES).toEqual({
      docxImport: 'docx.import',
      docxExport: 'docx.export',
      pdfExport: 'pdf.export'
    })
  })

  it('exposes the Gate 6 collaboration feature keys', () => {
    expect(GATE6_COLLAB_FEATURES).toEqual({
      multiplayer: 'collaboration.multiplayer',
      offline: 'collaboration.offline',
      history: 'collaboration.history',
      server: 'collaboration.server',
      autoInsert: 'automation.autoInsert'
    })
  })

  it('accepts Gate 6 collaboration feature keys in entitlement checks', () => {
    const entitlement: JWordLicenseEntitlement = {
      ...createValidEntitlement([
        GATE6_COLLAB_FEATURES.multiplayer,
        GATE6_COLLAB_FEATURES.autoInsert
      ])
    }

    expect(assertJWordFeatureEntitled(entitlement, GATE6_COLLAB_FEATURES.autoInsert)).toEqual({
      ok: true,
      feature: GATE6_COLLAB_FEATURES.autoInsert,
      customerId: 'customer-gate5',
      offlineGrace: false
    })
  })

  it('returns stable diagnostics for missing, expired, mismatched and server unavailable licenses', () => {
    expect(() => assertJWordFeatureEntitled(undefined, 'docx.import')).toThrowError(
      expect.objectContaining({
        name: 'JWordLicenseError',
        code: 'JWORD_LICENSE_MISSING',
        feature: 'docx.import'
      })
    )
    expect(() => assertJWordFeatureEntitled(createExpiredEntitlement(), 'docx.export', {
      now: new Date('2026-05-27T00:00:00Z')
    })).toThrowError(expect.objectContaining({
      code: 'JWORD_LICENSE_EXPIRED',
      feature: 'docx.export',
      customerId: 'customer-gate5'
    }))
    expect(() => assertJWordFeatureEntitled(createValidEntitlement(['docx.import']), 'pdf.export')).toThrowError(
      expect.objectContaining({
        code: 'JWORD_FEATURE_NOT_ENTITLED',
        feature: 'pdf.export',
        customerId: 'customer-gate5'
      })
    )
    expect(() => assertJWordFeatureEntitled(createSignedEntitlement({
      ...createUnsignedEntitlement(['docx.import']),
      status: 'server-unavailable'
    }), 'docx.import')).toThrowError(expect.objectContaining({
      code: 'JWORD_LICENSE_SERVER_UNAVAILABLE',
      feature: 'docx.import'
    }))
  })

  it('emits JWL1 Ed25519 tokens and rejects tampered payload fields', () => {
    const entitlement = createValidEntitlement(['docx.import'])

    expect(entitlement.signature?.startsWith('JWL1.')).toBe(true)
    expect(() => assertJWordFeatureEntitled({
      ...entitlement,
      features: ['docx.export']
    }, 'docx.import')).toThrowError(expect.objectContaining({
      code: 'JWORD_LICENSE_SIGNATURE_INVALID',
      feature: 'docx.import',
      customerId: 'customer-gate5'
    }))
  })

  it('rejects unsigned and tampered entitlements with a stable signature diagnostic', () => {
    const entitlement = createValidEntitlement(['docx.import'])

    expect(() => assertJWordFeatureEntitled({
      ...entitlement,
      signature: ''
    }, 'docx.import')).toThrowError(expect.objectContaining({
      code: 'JWORD_LICENSE_SIGNATURE_INVALID',
      feature: 'docx.import',
      customerId: 'customer-gate5'
    }))
    expect(() => assertJWordFeatureEntitled({
      ...entitlement,
      features: ['docx.export']
    }, 'docx.import')).toThrowError(expect.objectContaining({
      code: 'JWORD_LICENSE_SIGNATURE_INVALID',
      feature: 'docx.import',
      customerId: 'customer-gate5'
    }))
  })

  it('honors offline grace after expiry and exposes diagnostic metadata', () => {
    const entitlement = createSignedEntitlement({
      ...createExpiredUnsignedEntitlement(),
      offlineGraceUntil: '2026-05-28T00:00:00Z'
    })

    expect(assertJWordFeatureEntitled(entitlement, 'docx.export', {
      now: new Date('2026-05-27T00:00:00Z')
    })).toEqual({
      ok: true,
      feature: 'docx.export',
      customerId: 'customer-gate5',
      offlineGrace: true
    })
    expect(isJWordLicenseDiagnosticCode('JWORD_LICENSE_EXPIRED')).toBe(true)
    expect(JWORD_LICENSE_DIAGNOSTIC_CODE_METADATA.JWORD_FEATURE_NOT_ENTITLED).toMatchObject({
      severity: 'error',
      recoverable: true
    })
    expect(createJWordLicenseError('JWORD_LICENSE_MISSING', 'pdf.export')).toMatchObject({
      name: 'JWordLicenseError',
      code: 'JWORD_LICENSE_MISSING',
      feature: 'pdf.export'
    })
  })
})

/** 创建包含指定 feature 的有效 entitlement。 */
function createValidEntitlement(features: readonly string[]): JWordLicenseEntitlement {
  return createSignedEntitlement(createUnsignedEntitlement(features))
}

/** 创建未签名的基础 entitlement payload。 */
function createUnsignedEntitlement(features: readonly string[]): JWordLicenseSignaturePayload {
  return {
    customerId: 'customer-gate5',
    licenseToken: 'token-gate5',
    features,
    issuer: 'jword-test-issuer',
    issuedAt: '2026-05-01T00:00:00Z',
    expiresAt: '2099-06-01T00:00:00Z',
    status: 'valid'
  }
}

/** 创建已过期但结构完整的 entitlement。 */
function createExpiredEntitlement(): JWordLicenseEntitlement {
  return createSignedEntitlement(createExpiredUnsignedEntitlement())
}

/** 创建已过期但未签名的 entitlement payload。 */
function createExpiredUnsignedEntitlement(): JWordLicenseSignaturePayload {
  return {
    customerId: 'customer-gate5',
    licenseToken: 'token-gate5',
    features: ['docx.import', 'docx.export', 'pdf.export'],
    issuer: 'jword-test-issuer',
    issuedAt: '2026-05-01T00:00:00Z',
    expiresAt: '2026-05-01T00:00:00Z',
    status: 'valid'
  }
}

/** 创建带确定性签名的 entitlement。 */
function createSignedEntitlement(
  entitlement: JWordLicenseSignaturePayload
): JWordLicenseEntitlement {
  return {
    ...entitlement,
    signature: createInsecureTestOnlyJWordLicenseSignature(entitlement, INSECURE_TEST_ONLY_LICENSE_PRIVATE_KEY_SEED)
  }
}
