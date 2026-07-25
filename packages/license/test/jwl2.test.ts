/**
 * @vitest-environment node
 *
 * 职责：验证 JWL2 parser、固定验签、公开激活、opaque handle 与 worker transfer。
 * 边界：通过公开激活和 transfer seam 验证身份、运行时时间与 worker 重新激活。
 * 协作模块：jwl2.ts、trust-store.ts、verify-jwl2.ts 与 license.ts 共同完成 LIC-102/105。
 * 性能/安全约束：只保存固定 golden token，不读取或保存生产私钥；测试 seed 不受生产信任。
 * 实现说明：本文件锁定 parser/验签边界以及 LIC-104/105 handle 与 transfer 行为。
 */

import { describe, expect, it, vi } from 'vitest'

import {
  decodeBase64Url,
  encodeBase64Url,
  encodeUtf8,
  verifyEd25519
} from '../src/crypto.js'
import {
  JWORD_FEATURES,
  activateJWordLicense,
  assertJWordFeatureLicensed,
  createJWordLicenseTransfer,
  isJWordFeatureLicensed,
  type JWordLicense,
  type JWordLicenseTransfer
} from '../src/index.js'
import {
  parseJWordLicenseClaims,
  parseJWordLicenseToken,
  type JWordLicenseClaimsV2
} from '../src/jwl2.js'
import { assertJWordLicenseTimeValid } from '../src/license.js'
import { readTrustedJWordLicensePublicKey } from '../src/trust-store.js'
import { verifyJWordLicenseToken } from '../src/verify-jwl2.js'
import { TEST_ONLY_JWL2_TOKEN } from '../../../fixtures/license/test-only-jwl2-fixture.js'

const PRODUCTION_GOLDEN_TOKEN = 'JWL2.eyJzY2hlbWFWZXJzaW9uIjoyLCJsaWNlbnNlSWQiOiJsaWMtMTAzLWdvbGRlbi1leHBpcmVkIiwiaXNzdWVyIjoiandvcmQiLCJrZXlJZCI6Imp3b3JkLXByb2QtMjAyNi1rMSIsImxpY2Vuc2VDbGFzcyI6ImV2YWx1YXRpb24iLCJmZWF0dXJlcyI6WyJmb3JtYXRzIl0sImlzc3VlZEF0IjoiMjAyNi0wMS0wMVQwMDowMDowMC4wMDBaIiwiZXhwaXJlc0F0IjoiMjAyNi0wMS0zMVQwMDowMDowMC4wMDBaIn0.kV6uaOYbb40qoekidoGmab_FfhGPDS3AsrGKZr4l_m9PwyJ8rNIpf4xNHEO66onSFhA6_7YSvTm00R6EazkiAw'
const VALID_JWL2_TOKEN = 'JWL2.eyJzY2hlbWFWZXJzaW9uIjoyLCJsaWNlbnNlSWQiOiJsaWMtdGVzdC0wMDEiLCJpc3N1ZXIiOiJqd29yZCIsImtleUlkIjoiandvcmQtcHJvZC0yMDI2LWsxIiwibGljZW5zZUNsYXNzIjoicHJvZHVjdGlvbiIsImZlYXR1cmVzIjpbImNvbGxhYm9yYXRpb24iLCJmb3JtYXRzIiwicHJvZmVzc2lvbmFsLmVkaXRpbmciXSwiaXNzdWVkQXQiOiIyMDI2LTAxLTAxVDAwOjAwOjAwLjAwMFoiLCJzdWJzY3JpcHRpb25FbmRzQXQiOiIyMDI2LTEyLTMxVDAwOjAwOjAwLjAwMFoiLCJleHBpcmVzQXQiOiIyMDI3LTAxLTE1VDAwOjAwOjAwLjAwMFoifQ.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const VALID_PAYLOAD_JSON = '{"schemaVersion":2,"licenseId":"lic-test-001","issuer":"jword","keyId":"jword-prod-2026-k1","licenseClass":"production","features":["collaboration","formats","professional.editing"],"issuedAt":"2026-01-01T00:00:00.000Z","subscriptionEndsAt":"2026-12-31T00:00:00.000Z","expiresAt":"2027-01-15T00:00:00.000Z"}'
const PLACEHOLDER_SIGNATURE = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'

describe('Ed25519 verifier', () => {
  it('accepts RFC 8032 and rejects tampered or malformed inputs in strict mode', () => {
    // RFC 8032 section 7.1, TEST 1: https://www.rfc-editor.org/rfc/rfc8032.html#section-7.1
    const message = new Uint8Array()
    const signature = decodeHex(
      'e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e06522490155' +
      '5fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b'
    )
    const publicKey = decodeHex('d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a')
    const tamperedSignature = signature.slice()
    const tamperedPublicKey = publicKey.slice()
    tamperedSignature[0] = (tamperedSignature[0] ?? 0) ^ 1
    tamperedPublicKey[0] = (tamperedPublicKey[0] ?? 0) ^ 1

    // ZIP-215 first test vector: https://zips.z.cash/zip-0215#test-vectors
    const smallOrderPublicKey = decodeHex('0100000000000000000000000000000000000000000000000000000000000000')
    const smallOrderSignature = decodeHex(
      '0100000000000000000000000000000000000000000000000000000000000000' +
      '0000000000000000000000000000000000000000000000000000000000000000'
    )
    const cases = [
      { name: 'RFC 8032 TEST 1', message, signature, publicKey, expected: true },
      { name: 'tampered message', message: Uint8Array.of(0), signature, publicKey, expected: false },
      { name: 'tampered signature', message, signature: tamperedSignature, publicKey, expected: false },
      { name: 'tampered public key', message, signature, publicKey: tamperedPublicKey, expected: false },
      { name: 'invalid signature length', message, signature: signature.slice(0, 63), publicKey, expected: false },
      { name: 'invalid public key length', message, signature, publicKey: publicKey.slice(0, 31), expected: false },
      { name: 'invalid public key encoding', message, signature, publicKey: new Uint8Array(32).fill(0xff), expected: false },
      {
        name: 'ZIP-215 small-order input',
        message: encodeUtf8('Zcash'),
        signature: smallOrderSignature,
        publicKey: smallOrderPublicKey,
        expected: false
      }
    ] as const

    for (const testCase of cases) {
      expect(
        verifyEd25519(testCase.message, testCase.signature, testCase.publicKey),
        testCase.name
      ).toBe(testCase.expected)
    }
  })
})

describe('JWL2 parser', () => {
  it('verifies the production golden token before returning claims', () => {
    expect(readTrustedJWordLicensePublicKey('jword', 'jword-prod-2026-k1')).toHaveLength(32)
    expect(verifyJWordLicenseToken(PRODUCTION_GOLDEN_TOKEN)).toEqual({
      schemaVersion: 2,
      licenseId: 'lic-103-golden-expired',
      issuer: 'jword',
      keyId: 'jword-prod-2026-k1',
      licenseClass: 'evaluation',
      features: ['formats'],
      issuedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2026-01-31T00:00:00.000Z'
    })
  })

  it('rejects an unknown issuer during fixed trust lookup', () => {
    const token = replacePayloadText(PRODUCTION_GOLDEN_TOKEN, '"issuer":"jword"', '"issuer":"attacker"')

    expect(readTrustedJWordLicensePublicKey('attacker', 'jword-prod-2026-k1')).toBeUndefined()
    expect(() => verifyJWordLicenseToken(token)).toThrowError(expect.objectContaining({
      code: 'JWORD_LICENSE_ISSUER_INVALID'
    }))
  })

  it('rejects an unknown keyId during fixed trust lookup', () => {
    const token = replacePayloadText(
      PRODUCTION_GOLDEN_TOKEN,
      '"keyId":"jword-prod-2026-k1"',
      '"keyId":"jword-prod-2026-k2"'
    )

    expect(readTrustedJWordLicensePublicKey('jword', 'jword-prod-2026-k2')).toBeUndefined()
    expect(() => verifyJWordLicenseToken(token)).toThrowError(expect.objectContaining({
      code: 'JWORD_LICENSE_KEY_UNKNOWN'
    }))
  })

  it('rejects a tampered payload', () => {
    const token = replacePayloadText(PRODUCTION_GOLDEN_TOKEN, 'golden-expired', 'golden-altered')

    expect(() => verifyJWordLicenseToken(token)).toThrowError(expect.objectContaining({
      code: 'JWORD_LICENSE_SIGNATURE_INVALID'
    }))
  })

  it('rejects a tampered signature', () => {
    const parts = PRODUCTION_GOLDEN_TOKEN.split('.')
    const signature = decodeBase64Url(parts[2] ?? '')
    signature[0] = (signature[0] ?? 0) ^ 1
    const token = `${parts[0]}.${parts[1]}.${encodeBase64Url(signature)}`

    expect(() => verifyJWordLicenseToken(token)).toThrowError(expect.objectContaining({
      code: 'JWORD_LICENSE_SIGNATURE_INVALID'
    }))
  })

  it('does not treat parser output as verified claims', () => {
    const envelope = parseJWordLicenseToken(VALID_JWL2_TOKEN)

    expect(parseJWordLicenseClaims(envelope).licenseId).toBe('lic-test-001')
    expect(() => verifyJWordLicenseToken(VALID_JWL2_TOKEN)).toThrowError(expect.objectContaining({
      code: 'JWORD_LICENSE_SIGNATURE_INVALID'
    }))
    expect(() => verifyJWordLicenseToken(envelope as unknown as string)).toThrowError(expect.objectContaining({
      code: 'JWORD_LICENSE_TOKEN_INVALID'
    }))
  })

  it('does not trust a JWL2 token signed by the repository test key', () => {
    expect(() => verifyJWordLicenseToken(TEST_ONLY_JWL2_TOKEN)).toThrowError(expect.objectContaining({
      code: 'JWORD_LICENSE_KEY_UNKNOWN'
    }))
  })

  it('parses the canonical envelope and minimum claims', () => {
    const envelope = parseJWordLicenseToken(VALID_JWL2_TOKEN)
    const claims = parseJWordLicenseClaims(envelope)

    expect(envelope.issuer).toBe('jword')
    expect(envelope.keyId).toBe('jword-prod-2026-k1')
    expect(envelope.signature).toHaveLength(64)
    expect(new TextDecoder().decode(envelope.signingInput)).toBe(`JWL2.${VALID_JWL2_TOKEN.split('.')[1]}`)
    expect(claims).toEqual({
      schemaVersion: 2,
      licenseId: 'lic-test-001',
      issuer: 'jword',
      keyId: 'jword-prod-2026-k1',
      licenseClass: 'production',
      features: ['collaboration', 'formats', 'professional.editing'],
      issuedAt: '2026-01-01T00:00:00.000Z',
      subscriptionEndsAt: '2026-12-31T00:00:00.000Z',
      expiresAt: '2027-01-15T00:00:00.000Z'
    })
  })

  it('rejects duplicate trust hint fields before trust lookup', () => {
    const duplicateIssuerPayload = '{"schemaVersion":2,"issuer":"jword","issuer":"attacker","keyId":"jword-prod-2026-k1"}'

    expect(() => parseJWordLicenseToken(createToken(duplicateIssuerPayload))).toThrow('Invalid JWL2 token')
  })

  it('rejects non-canonical UTF-8 before trust lookup', () => {
    const overlongPayloadBytes = Buffer.concat([
      Buffer.from('{"schemaVersion":2,"issuer":"'),
      Buffer.from([0xc1, 0xaa]),
      Buffer.from('word","keyId":"jword-prod-2026-k1"}')
    ])
    const surrogatePayloadBytes = Buffer.concat([
      Buffer.from('{"schemaVersion":2,"issuer":"jword","keyId":"jword-prod-2026-k1","extra":"'),
      Buffer.from([0xed, 0xa0, 0x80]),
      Buffer.from('"}')
    ])

    expect(() => parseJWordLicenseToken(createTokenFromPayloadSegment(overlongPayloadBytes.toString('base64url'))))
      .toThrow('Invalid JWL2 token')
    expect(() => parseJWordLicenseToken(createTokenFromPayloadSegment(surrogatePayloadBytes.toString('base64url'))))
      .toThrow('Invalid JWL2 token')
  })

  it('rejects invalid envelope structure, encoding and resource sizes', () => {
    const payloadSegment = VALID_JWL2_TOKEN.split('.')[1] ?? ''
    const oversizedPayloadSegment = Buffer.alloc(8193, 0x20).toString('base64url')
    const invalidTokens = [
      '',
      VALID_JWL2_TOKEN.replace('JWL2.', 'JWL1.'),
      `JWL2..${PLACEHOLDER_SIGNATURE}`,
      `JWL2.${payloadSegment}=.${PLACEHOLDER_SIGNATURE}`,
      `JWL2.${payloadSegment}.AA`,
      `${VALID_JWL2_TOKEN}.extra`,
      createTokenFromPayloadSegment(oversizedPayloadSegment),
      createTokenFromPayloadSegment('A'.repeat(16 * 1024)),
      createToken(VALID_PAYLOAD_JSON.replace('"schemaVersion":2', '"schemaVersion":1')),
      createToken(VALID_PAYLOAD_JSON.replace('"keyId":"jword-prod-2026-k1"', '"keyId":"invalid key"'))
    ]

    for (const token of invalidTokens) {
      expect(() => parseJWordLicenseToken(token)).toThrow('Invalid JWL2 token')
    }
  })

  it('accepts the four approved license classes', () => {
    for (const licenseClass of ['evaluation', 'nonProduction', 'production', 'disasterRecovery']) {
      const payloadJson = VALID_PAYLOAD_JSON.replace('"licenseClass":"production"', `"licenseClass":"${licenseClass}"`)
      const claims = parseJWordLicenseClaims(parseJWordLicenseToken(createToken(payloadJson)))

      expect(claims.licenseClass).toBe(licenseClass)
    }
  })

  it('accepts minimum claims without subscriptionEndsAt', () => {
    const payloadJson = VALID_PAYLOAD_JSON.replace(',"subscriptionEndsAt":"2026-12-31T00:00:00.000Z"', '')
    const claims = parseJWordLicenseClaims(parseJWordLicenseToken(createToken(payloadJson)))

    expect(claims.subscriptionEndsAt).toBeUndefined()
  })

  it('rejects claims outside the frozen canonical schema', () => {
    const invalidPayloads = [
      VALID_PAYLOAD_JSON.replace('"licenseId":"lic-test-001"', '"licenseId":""'),
      VALID_PAYLOAD_JSON.replace('"issuer":"jword"', '"issuer":"another"'),
      VALID_PAYLOAD_JSON.replace('"licenseClass":"production"', '"licenseClass":"commercial"'),
      VALID_PAYLOAD_JSON.replace('"licenseClass":"production"', '"licenseClass":1'),
      VALID_PAYLOAD_JSON.replace('"formats"', '"unknown"'),
      VALID_PAYLOAD_JSON.replace(
        '["collaboration","formats","professional.editing"]',
        '[]'
      ),
      VALID_PAYLOAD_JSON.replace(
        '["collaboration","formats","professional.editing"]',
        '["collaboration","formats","professional.editing","formats"]'
      ),
      VALID_PAYLOAD_JSON.replace(
        '["collaboration","formats","professional.editing"]',
        '["formats","collaboration"]'
      ),
      VALID_PAYLOAD_JSON.replace(
        '["collaboration","formats","professional.editing"]',
        '["formats","formats"]'
      ),
      VALID_PAYLOAD_JSON.replace(
        '["collaboration","formats","professional.editing"]',
        '"formats"'
      ),
      VALID_PAYLOAD_JSON.replace('"issuedAt":"2026-01-01T00:00:00.000Z"', '"issuedAt":"2026-01-01T00:00:00Z"'),
      VALID_PAYLOAD_JSON.replace('"expiresAt":', '"customerId":"forbidden","expiresAt":'),
      VALID_PAYLOAD_JSON.replace(',"expiresAt":"2027-01-15T00:00:00.000Z"', ''),
      VALID_PAYLOAD_JSON.replace('{"schemaVersion":2,"licenseId":"lic-test-001"', '{"licenseId":"lic-test-001","schemaVersion":2'),
      VALID_PAYLOAD_JSON.replace('{"schemaVersion":2', '{ "schemaVersion":2')
    ]

    for (const payloadJson of invalidPayloads) {
      const envelope = parseJWordLicenseToken(createToken(payloadJson))
      expect(() => parseJWordLicenseClaims(envelope)).toThrow('Invalid JWL2 claims')
    }
  })
})

describe('JWL2 activation and opaque handle', () => {
  it('activates the production token into a frozen minimal handle', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-15T00:00:00.000Z'))

    try {
      const license = activateJWordLicense(PRODUCTION_GOLDEN_TOKEN)

      expect(license).toEqual({
        licenseId: 'lic-103-golden-expired',
        expiresAt: '2026-01-31T00:00:00.000Z'
      })
      expect(Object.keys(license)).toEqual(['licenseId', 'expiresAt'])
      expect(Object.isFrozen(license)).toBe(true)
      expect(JSON.stringify(license)).toBe(
        '{"licenseId":"lic-103-golden-expired","expiresAt":"2026-01-31T00:00:00.000Z"}'
      )
      expect(isJWordFeatureLicensed(license, JWORD_FEATURES.formats)).toBe(true)
      expect(() => assertJWordFeatureLicensed(license, JWORD_FEATURES.formats)).not.toThrow()
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects a module feature that is absent from the verified claims', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-15T00:00:00.000Z'))

    try {
      const license = activateJWordLicense(PRODUCTION_GOLDEN_TOKEN)
      let error: unknown

      expect(isJWordFeatureLicensed(license, JWORD_FEATURES.collaboration)).toBe(false)
      try {
        assertJWordFeatureLicensed(license, JWORD_FEATURES.collaboration)
      } catch (caught) {
        error = caught
      }

      expect(error).toEqual(expect.objectContaining({
        code: 'JWORD_FEATURE_NOT_ENTITLED',
        feature: JWORD_FEATURES.collaboration
      }))

      const serializedError = `${String(error)}\n${JSON.stringify(error)}`
      expect(serializedError).not.toContain(PRODUCTION_GOLDEN_TOKEN)
      expect(serializedError).not.toContain('licenseClass')
      expect(serializedError).not.toContain('"features"')
      expect(serializedError).not.toContain('Y5x05lXUVsNO4nVtxHk65IVSMQz-_gMAGw-C48EFlhg')
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects forged, copied, cloned and claims-shaped objects as handles', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-15T00:00:00.000Z'))

    try {
      const license = activateJWordLicense(PRODUCTION_GOLDEN_TOKEN)
      const clonedLicense = structuredClone(license)
      const candidates = [
        {
          licenseId: license.licenseId,
          expiresAt: license.expiresAt
        },
        { ...license },
        clonedLicense,
        parseJWordLicenseClaims(parseJWordLicenseToken(PRODUCTION_GOLDEN_TOKEN)),
        verifyJWordLicenseToken(PRODUCTION_GOLDEN_TOKEN)
      ] as readonly JWordLicense[]

      expect(isJWordFeatureLicensed(null, JWORD_FEATURES.formats)).toBe(false)
      expect(isJWordFeatureLicensed(undefined, JWORD_FEATURES.formats)).toBe(false)
      expect(clonedLicense).toEqual({
        licenseId: license.licenseId,
        expiresAt: license.expiresAt
      })
      expect(JSON.stringify(clonedLicense)).not.toContain('JWL2.')
      expect(JSON.stringify(clonedLicense)).not.toContain('features')

      for (const candidate of candidates) {
        expect(isJWordFeatureLicensed(candidate, JWORD_FEATURES.formats)).toBe(false)
        expect(() => assertJWordFeatureLicensed(candidate, JWORD_FEATURES.formats))
          .toThrowError(expect.objectContaining({
            code: 'JWORD_LICENSE_HANDLE_INVALID',
            feature: JWORD_FEATURES.formats
          }))
      }
    } finally {
      vi.useRealTimers()
    }
  })

  it('checks activation time and rechecks expiry for every feature access', () => {
    vi.useFakeTimers()

    try {
      vi.setSystemTime(new Date('2025-12-31T23:54:59.000Z'))
      expect(() => activateJWordLicense(PRODUCTION_GOLDEN_TOKEN))
        .toThrowError(expect.objectContaining({
          code: 'JWORD_LICENSE_NOT_YET_VALID'
        }))

      vi.setSystemTime(new Date('2026-01-31T00:00:00.000Z'))
      expect(() => activateJWordLicense(PRODUCTION_GOLDEN_TOKEN))
        .toThrowError(expect.objectContaining({
          code: 'JWORD_LICENSE_EXPIRED'
        }))

      vi.setSystemTime(new Date('2026-01-15T00:00:00.000Z'))
      const license = activateJWordLicense(PRODUCTION_GOLDEN_TOKEN)

      vi.setSystemTime(new Date('2026-01-31T00:00:00.000Z'))
      expect(isJWordFeatureLicensed(license, JWORD_FEATURES.formats)).toBe(false)
      expect(() => assertJWordFeatureLicensed(license, JWORD_FEATURES.formats))
        .toThrowError(expect.objectContaining({
          code: 'JWORD_LICENSE_EXPIRED',
          feature: JWORD_FEATURES.formats
        }))
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects invalid evaluation duration and subscription grace relationships as invalid tokens', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-15T00:00:00.000Z'))

    try {
      const verifiedClaims = verifyJWordLicenseToken(PRODUCTION_GOLDEN_TOKEN)
      const subscriptionClaims: JWordLicenseClaimsV2 = {
        ...verifiedClaims,
        licenseClass: 'production',
        subscriptionEndsAt: '2026-01-16T00:00:00.000Z',
        expiresAt: '2026-01-31T00:00:00.000Z'
      }
      const {
        subscriptionEndsAt: _subscriptionEndsAt,
        ...productionClaimsWithoutSubscription
      } = subscriptionClaims
      const invalidClaims: readonly JWordLicenseClaimsV2[] = [
        {
          ...verifiedClaims,
          expiresAt: '2026-01-31T00:00:00.001Z'
        },
        {
          ...verifiedClaims,
          subscriptionEndsAt: '2026-01-16T00:00:00.000Z'
        },
        {
          ...productionClaimsWithoutSubscription
        },
        {
          ...subscriptionClaims,
          subscriptionEndsAt: subscriptionClaims.issuedAt
        },
        {
          ...subscriptionClaims,
          expiresAt: '2026-01-31T00:00:00.001Z'
        }
      ]

      expect(() => assertJWordLicenseTimeValid(verifiedClaims)).not.toThrow()
      expect(() => assertJWordLicenseTimeValid(subscriptionClaims)).not.toThrow()

      for (const claims of invalidClaims) {
        expect(() => assertJWordLicenseTimeValid(claims))
          .toThrowError(expect.objectContaining({
            code: 'JWORD_LICENSE_TOKEN_INVALID'
          }))
      }
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('JWL2 worker transfer', () => {
  it('creates a cloneable token-only transfer and reactivates a new trusted handle', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-15T00:00:00.000Z'))

    try {
      const license = activateJWordLicense(PRODUCTION_GOLDEN_TOKEN)
      const transfer = createJWordLicenseTransfer(license)
      const clonedTransfer: JWordLicenseTransfer = structuredClone(transfer)
      const workerLicense = activateJWordLicense(clonedTransfer.token)

      expect(Object.keys(transfer)).toEqual(['token'])
      expect(transfer).toEqual({ token: PRODUCTION_GOLDEN_TOKEN })
      expect(clonedTransfer).toEqual({ token: PRODUCTION_GOLDEN_TOKEN })
      expect(workerLicense).not.toBe(license)
      expect(workerLicense).toEqual(license)
      expect(isJWordFeatureLicensed(workerLicense, JWORD_FEATURES.formats)).toBe(true)
      expect(JSON.stringify(license)).not.toContain(PRODUCTION_GOLDEN_TOKEN)
      expect(transfer).not.toHaveProperty('claims')
      expect(transfer).not.toHaveProperty('features')
      expect(transfer).not.toHaveProperty('licenseClass')
      expect(transfer).not.toHaveProperty('privateKey')
      expect(transfer).not.toHaveProperty('publicKeyBase64Url')
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects forged, copied and cloned handles without leaking the token', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-15T00:00:00.000Z'))

    try {
      const license = activateJWordLicense(PRODUCTION_GOLDEN_TOKEN)
      const candidates = [
        {
          licenseId: license.licenseId,
          expiresAt: license.expiresAt
        },
        { ...license },
        structuredClone(license)
      ] as readonly JWordLicense[]

      expect(JSON.stringify(license)).not.toContain(PRODUCTION_GOLDEN_TOKEN)

      for (const candidate of candidates) {
        let error: unknown

        try {
          createJWordLicenseTransfer(candidate)
        } catch (caught) {
          error = caught
        }

        expect(error).toEqual(expect.objectContaining({
          code: 'JWORD_LICENSE_HANDLE_INVALID'
        }))
        const serializedError = `${String(error)}\n${JSON.stringify(error)}`

        expect(JSON.stringify(candidate)).not.toContain(PRODUCTION_GOLDEN_TOKEN)
        expect(serializedError).not.toContain(PRODUCTION_GOLDEN_TOKEN)
        expect(serializedError).not.toContain('JWL2.')
      }
    } finally {
      vi.useRealTimers()
    }
  })

  it('returns stable diagnostics when transferred tokens fail reactivation', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-15T00:00:00.000Z'))

    try {
      const transfer = structuredClone(createJWordLicenseTransfer(
        activateJWordLicense(PRODUCTION_GOLDEN_TOKEN)
      ))
      const tamperedToken = replacePayloadText(
        transfer.token,
        'golden-expired',
        'golden-altered'
      )
      const tamperedSignature = replaceSignatureByte(transfer.token)
      const cases = [
        {
          name: 'malformed token',
          token: 'invalid',
          code: 'JWORD_LICENSE_TOKEN_INVALID'
        },
        {
          name: 'untrusted issuer',
          token: replacePayloadText(transfer.token, '"issuer":"jword"', '"issuer":"other"'),
          code: 'JWORD_LICENSE_ISSUER_INVALID'
        },
        {
          name: 'unknown key',
          token: replacePayloadText(transfer.token, 'jword-prod-2026-k1', 'jword-prod-2026-k2'),
          code: 'JWORD_LICENSE_KEY_UNKNOWN'
        },
        {
          name: 'tampered payload',
          token: tamperedToken,
          code: 'JWORD_LICENSE_SIGNATURE_INVALID'
        },
        {
          name: 'tampered signature',
          token: tamperedSignature,
          code: 'JWORD_LICENSE_SIGNATURE_INVALID'
        }
      ] as const

      for (const testCase of cases) {
        expect(() => activateJWordLicense(testCase.token), testCase.name)
          .toThrowError(expect.objectContaining({
            name: 'JWordLicenseError',
            code: testCase.code
          }))
      }

      vi.setSystemTime(new Date('2026-01-31T00:00:00.000Z'))
      expect(() => activateJWordLicense(transfer.token))
        .toThrowError(expect.objectContaining({
          code: 'JWORD_LICENSE_EXPIRED'
        }))
    } finally {
      vi.useRealTimers()
    }
  })
})

/** 创建不执行验签的 parser 输入 token。 */
function createToken(payloadJson: string): string {
  return createTokenFromPayloadSegment(Buffer.from(payloadJson).toString('base64url'))
}

/** 从 payload segment 创建不执行验签的 parser 输入 token。 */
function createTokenFromPayloadSegment(payloadSegment: string): string {
  return `JWL2.${payloadSegment}.${PLACEHOLDER_SIGNATURE}`
}

/** 修改 token 签名首字节，保留规范长度和编码。 */
function replaceSignatureByte(token: string): string {
  const parts = token.split('.')
  const signature = decodeBase64Url(parts[2] ?? '')
  signature[0] = (signature[0] ?? 0) ^ 1

  return `${parts[0]}.${parts[1]}.${encodeBase64Url(signature)}`
}

/** 将权威测试向量中的十六进制字节转换为 Uint8Array。 */
function decodeHex(value: string): Uint8Array {
  return Uint8Array.from(Buffer.from(value, 'hex'))
}

/** 替换 payload 文本但保留原签名，构造篡改或未知 trust hint。 */
function replacePayloadText(token: string, search: string, replacement: string): string {
  const parts = token.split('.')
  const payloadJson = Buffer.from(parts[1] ?? '', 'base64url').toString('utf8')
  const payloadSegment = Buffer.from(payloadJson.replace(search, replacement)).toString('base64url')

  return `${parts[0]}.${payloadSegment}.${parts[2]}`
}
