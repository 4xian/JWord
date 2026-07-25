/**
 * @vitest-environment node
 *
 * 职责：锁定旧 entitlement 公开契约和调用方公钥注入的 fail-closed 行为。
 * 边界：只验证 license 包的 feature matrix、稳定诊断和 JWL1 信任边界，不触碰 DOCX/PDF 运行时。
 * 协作模块：packages/docx、packages/pdf、examples/docx 和后续商业包发布检查复用这些类型与错误码。
 * 约束：授权判断必须是纯函数；调用方额外传入测试公钥不能改变生产 trust root。
 * 实现说明：LIC-103 后 JWL1 token 在 feature、期限或状态判断前统一 fail closed。
 */

import { describe, expect, it } from 'vitest'

import {
  GATE5_FORMAT_FEATURES,
  GATE6_COLLAB_FEATURES,
  JWORD_LICENSE_DIAGNOSTIC_CODE_METADATA,
  assertJWordFeatureEntitled,
  createJWordLicenseError,
  isJWordLicenseDiagnosticCode,
  type JWordLicenseEntitlement,
  type JWordLicenseSignaturePayload
} from '../src/index'
import { createInsecureTestOnlyJWordLicenseSignature } from '../../../fixtures/license/create-insecure-test-only-jwl1-token'
import { INSECURE_TEST_ONLY_JWL1_FIXTURE_TOKEN } from '../../../fixtures/license/insecure-test-only-jwl1-fixture.mjs'
import {
  INSECURE_TEST_ONLY_LICENSE_PRIVATE_KEY_SEED,
  INSECURE_TEST_ONLY_LICENSE_PUBLIC_KEY
} from '../../../fixtures/license/insecure-test-only-keys'

const CALLER_KEY_INJECTION_OPTIONS = {
  now: new Date('2026-05-27T00:00:00Z'),
  publicKeyBase64Url: INSECURE_TEST_ONLY_LICENSE_PUBLIC_KEY
}

describe('@4xian/jword-license entitlement contract', () => {
  it('keeps the repository test-only signer byte-compatible with the legacy JWL1 vector', () => {
    expect(createInsecureTestOnlyJWordLicenseSignature({
      customerId: 'lic-106-vector-customer',
      licenseToken: 'lic-106-vector-token',
      issuer: 'jword-insecure-test-only',
      issuedAt: '2026-01-02T03:04:05Z',
      expiresAt: '2027-01-02T03:04:05Z',
      features: ['pdf.export', 'docx.import'],
      offlineGraceDays: 15,
      schemaVersion: 1
    }, INSECURE_TEST_ONLY_LICENSE_PRIVATE_KEY_SEED)).toBe(INSECURE_TEST_ONLY_JWL1_FIXTURE_TOKEN)
  })

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

  it('does not let a caller-provided public key replace the production trust root', () => {
    const entitlement: JWordLicenseEntitlement = {
      ...createValidEntitlement([
        GATE6_COLLAB_FEATURES.multiplayer,
        GATE6_COLLAB_FEATURES.autoInsert
      ])
    }

    expect(() => assertJWordFeatureEntitled(
      entitlement,
      GATE6_COLLAB_FEATURES.autoInsert,
      CALLER_KEY_INJECTION_OPTIONS
    )).toThrowError(expect.objectContaining({
      code: 'JWORD_LICENSE_SIGNATURE_INVALID',
      feature: GATE6_COLLAB_FEATURES.autoInsert
    }))
  })

  it('rejects repository test-key tokens at the production entry without a trusted production root', () => {
    const entitlement = createValidEntitlement(['docx.import'])

    expect(() => assertJWordFeatureEntitled(entitlement, 'docx.import')).toThrowError(
      expect.objectContaining({
        code: 'JWORD_LICENSE_SIGNATURE_INVALID',
        feature: 'docx.import'
      })
    )
  })

  it('fails closed before trusting legacy expiry, feature or status fields', () => {
    expect(() => assertJWordFeatureEntitled(undefined, 'docx.import')).toThrowError(
      expect.objectContaining({
        name: 'JWordLicenseError',
        code: 'JWORD_LICENSE_MISSING',
        feature: 'docx.import'
      })
    )
    expect(() => assertJWordFeatureEntitled(createExpiredEntitlement(), 'docx.export', {
      ...CALLER_KEY_INJECTION_OPTIONS,
      now: new Date('2026-05-27T00:00:00Z')
    })).toThrowError(expect.objectContaining({
      code: 'JWORD_LICENSE_SIGNATURE_INVALID',
      feature: 'docx.export'
    }))
    expect(() => assertJWordFeatureEntitled(
      createValidEntitlement(['docx.import']),
      'pdf.export',
      CALLER_KEY_INJECTION_OPTIONS
    )).toThrowError(expect.objectContaining({
      code: 'JWORD_LICENSE_SIGNATURE_INVALID',
      feature: 'pdf.export'
    }))
    expect(() => assertJWordFeatureEntitled(createSignedEntitlement({
      ...createUnsignedEntitlement(['docx.import']),
      status: 'server-unavailable'
    }), 'docx.import', CALLER_KEY_INJECTION_OPTIONS)).toThrowError(expect.objectContaining({
      code: 'JWORD_LICENSE_SIGNATURE_INVALID',
      feature: 'docx.import'
    }))
  })

  it('emits JWL1 Ed25519 tokens and rejects tampered payload fields', () => {
    const entitlement = createValidEntitlement(['docx.import'])

    expect(entitlement.signature?.startsWith('JWL1.')).toBe(true)
    expect(() => assertJWordFeatureEntitled({
      ...entitlement,
      features: ['docx.export']
    }, 'docx.import', CALLER_KEY_INJECTION_OPTIONS)).toThrowError(expect.objectContaining({
      code: 'JWORD_LICENSE_SIGNATURE_INVALID',
      feature: 'docx.import'
    }))
  })

  it('rejects unsigned and tampered entitlements with a stable signature diagnostic', () => {
    const entitlement = createValidEntitlement(['docx.import'])

    expect(() => assertJWordFeatureEntitled({
      ...entitlement,
      signature: ''
    }, 'docx.import', CALLER_KEY_INJECTION_OPTIONS)).toThrowError(expect.objectContaining({
      code: 'JWORD_LICENSE_SIGNATURE_INVALID',
      feature: 'docx.import'
    }))
    expect(() => assertJWordFeatureEntitled({
      ...entitlement,
      features: ['docx.export']
    }, 'docx.import', CALLER_KEY_INJECTION_OPTIONS)).toThrowError(expect.objectContaining({
      code: 'JWORD_LICENSE_SIGNATURE_INVALID',
      feature: 'docx.import'
    }))
  })

  it('does not restore legacy offline grace through caller key injection', () => {
    const entitlement = createSignedEntitlement({
      ...createExpiredUnsignedEntitlement(),
      offlineGraceUntil: '2026-05-28T00:00:00Z'
    })

    expect(() => assertJWordFeatureEntitled(entitlement, 'docx.export', {
      ...CALLER_KEY_INJECTION_OPTIONS,
      now: new Date('2026-05-27T00:00:00Z')
    })).toThrowError(expect.objectContaining({
      code: 'JWORD_LICENSE_SIGNATURE_INVALID',
      feature: 'docx.export'
    }))
    expect(isJWordLicenseDiagnosticCode('JWORD_LICENSE_EXPIRED')).toBe(true)
    expect(JWORD_LICENSE_DIAGNOSTIC_CODE_METADATA.JWORD_FEATURE_NOT_ENTITLED).toMatchObject({
      severity: 'error',
      recoverable: true
    })
    expect(JWORD_LICENSE_DIAGNOSTIC_CODE_METADATA.JWORD_FEATURE_NOT_ENTITLED)
      .not.toHaveProperty('description')
    expect(createJWordLicenseError('JWORD_LICENSE_MISSING', 'pdf.export')).toMatchObject({
      name: 'JWordLicenseError',
      code: 'JWORD_LICENSE_MISSING',
      feature: 'pdf.export'
    })
  })

  it('keeps legacy fixture warnings language-neutral and offlineGrace false', () => {
    const warnings: unknown[] = []
    const result = assertJWordFeatureEntitled(
      createLegacyFixtureEntitlement('active'),
      'docx.export',
      {
        allowInsecureFixtureLicense: true,
        now: new Date('2026-05-27T00:00:00Z'),
        onWarning: (warning) => warnings.push(warning)
      }
    )

    expect(result).toMatchObject({
      ok: true,
      feature: 'docx.export',
      customerId: 'customer-gate5',
      offlineGrace: false
    })
    expect(warnings).toEqual([{
      code: 'JWORD_LICENSE_INSECURE_FIXTURE_ACCEPTED'
    }])
  })

  it('does not authorize an expired legacy fixture during its offline grace period', () => {
    expect(() => assertJWordFeatureEntitled(
      createLegacyFixtureEntitlement('expired'),
      'docx.export',
      {
        allowInsecureFixtureLicense: true,
        now: new Date('2026-05-27T00:00:00Z')
      }
    )).toThrowError(expect.objectContaining({
      code: 'JWORD_LICENSE_EXPIRED',
      feature: 'docx.export'
    }))
  })

  it('treats a legacy fixture as expired when now equals expiresAt', () => {
    expect(() => assertJWordFeatureEntitled(
      createLegacyFixtureEntitlement('expired'),
      'docx.export',
      {
        allowInsecureFixtureLicense: true,
        now: new Date('2026-05-01T00:00:00Z')
      }
    )).toThrowError(expect.objectContaining({
      code: 'JWORD_LICENSE_EXPIRED',
      feature: 'docx.export'
    }))
  })

  it('maps legacy server-unavailable input to a customer-free signature failure', () => {
    let thrown: unknown

    try {
      assertJWordFeatureEntitled(
        createLegacyFixtureEntitlement('server-unavailable'),
        'docx.export',
        {
          allowInsecureFixtureLicense: true,
          now: new Date('2026-05-27T00:00:00Z')
        }
      )
    } catch (error) {
      thrown = error
    }

    expect(thrown).toMatchObject({
      name: 'JWordLicenseError',
      code: 'JWORD_LICENSE_SIGNATURE_INVALID',
      feature: 'docx.export'
    })
    expect(thrown).not.toHaveProperty('customerId')
    expect(isJWordLicenseDiagnosticCode('JWORD_LICENSE_SERVER_UNAVAILABLE')).toBe(false)
    expect(JWORD_LICENSE_DIAGNOSTIC_CODE_METADATA)
      .not.toHaveProperty('JWORD_LICENSE_SERVER_UNAVAILABLE')
  })
})

const LEGACY_FIXTURE_SIGNATURES = {
  active: 'jword-license-v1:5dfa3256',
  expired: 'jword-license-v1:1187c8f7',
  'server-unavailable': 'jword-license-v1:a4fc32a2'
} as const

/** 创建使用固定旧 FNV 向量的兼容 entitlement。 */
function createLegacyFixtureEntitlement(
  state: keyof typeof LEGACY_FIXTURE_SIGNATURES
): JWordLicenseEntitlement {
  const active = state !== 'expired'

  return {
    customerId: 'customer-gate5',
    licenseToken: 'token-gate5',
    issuer: 'jword-test-issuer',
    issuedAt: '2026-05-01T00:00:00Z',
    expiresAt: active ? '2099-06-01T00:00:00Z' : '2026-05-01T00:00:00Z',
    features: ['docx.export'],
    offlineGraceUntil: active ? '2099-06-16T00:00:00Z' : '2026-05-28T00:00:00Z',
    status: state === 'server-unavailable' ? 'server-unavailable' : 'valid',
    signature: LEGACY_FIXTURE_SIGNATURES[state]
  }
}

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
