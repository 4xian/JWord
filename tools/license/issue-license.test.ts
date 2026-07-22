/**
 * @vitest-environment node
 *
 * 职责：验证受控 JWL2 License 签发 CLI 的输入、期限、canonical payload 与签名输出。
 * 边界：只通过 CLI 使用进程内临时 Ed25519 密钥，不读取或替换生产 trust store。
 * 协作模块：tools/license/issue-license.mjs 与 packages/license 的 JWL2 parser、Ed25519 verifier。
 * 性能/安全约束：测试私钥只存在于测试进程环境，不写入仓库、fixture、dist 或 tarball。
 * 实现说明：通过真实 stdin/环境变量入口锁定 LIC-108，不新增 package testing export。
 */

import { spawnSync } from 'node:child_process'
import { createPublicKey, generateKeyPairSync } from 'node:crypto'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { verifyEd25519 } from '../../packages/license/src/crypto.js'
import {
  parseJWordLicenseClaims,
  parseJWordLicenseToken
} from '../../packages/license/src/jwl2.js'
import { verifyJWordLicenseToken } from '../../packages/license/src/verify-jwl2.js'

const SCRIPT_PATH = fileURLToPath(new URL('./issue-license.mjs', import.meta.url))
const { privateKey } = generateKeyPairSync('ed25519')
const PRIVATE_KEY_PEM = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString()
const PUBLIC_KEY = Buffer.from(createPublicKey(privateKey).export({ format: 'jwk' }).x ?? '', 'base64url')
const ISSUED_AT = '2026-01-01T00:00:00.000Z'
const SUBSCRIPTION_ENDS_AT = '2026-12-31T00:00:00.000Z'
const EVALUATION_EXPIRES_AT = '2026-01-31T00:00:00.000Z'
const SUBSCRIPTION_EXPIRES_AT = '2027-01-15T00:00:00.000Z'
const PRODUCTION_GOLDEN_PAYLOAD_JSON = '{"schemaVersion":2,"licenseId":"lic-103-golden-expired","issuer":"jword","keyId":"jword-prod-2026-k1","licenseClass":"evaluation","features":["formats"],"issuedAt":"2026-01-01T00:00:00.000Z","expiresAt":"2026-01-31T00:00:00.000Z"}'
const PRODUCTION_GOLDEN_PAYLOAD_SEGMENT = 'eyJzY2hlbWFWZXJzaW9uIjoyLCJsaWNlbnNlSWQiOiJsaWMtMTAzLWdvbGRlbi1leHBpcmVkIiwiaXNzdWVyIjoiandvcmQiLCJrZXlJZCI6Imp3b3JkLXByb2QtMjAyNi1rMSIsImxpY2Vuc2VDbGFzcyI6ImV2YWx1YXRpb24iLCJmZWF0dXJlcyI6WyJmb3JtYXRzIl0sImlzc3VlZEF0IjoiMjAyNi0wMS0wMVQwMDowMDowMC4wMDBaIiwiZXhwaXJlc0F0IjoiMjAyNi0wMS0zMVQwMDowMDowMC4wMDBaIn0'
const PRODUCTION_GOLDEN_SIGNATURE_SEGMENT = 'kV6uaOYbb40qoekidoGmab_FfhGPDS3AsrGKZr4l_m9PwyJ8rNIpf4xNHEO66onSFhA6_7YSvTm00R6EazkiAw'
const PRODUCTION_GOLDEN_TOKEN = `JWL2.${PRODUCTION_GOLDEN_PAYLOAD_SEGMENT}.${PRODUCTION_GOLDEN_SIGNATURE_SEGMENT}`

describe('issue-license JWL2 CLI', () => {
  it.each([
    ['evaluation', undefined, EVALUATION_EXPIRES_AT],
    ['nonProduction', SUBSCRIPTION_ENDS_AT, SUBSCRIPTION_EXPIRES_AT],
    ['production', SUBSCRIPTION_ENDS_AT, SUBSCRIPTION_EXPIRES_AT],
    ['disasterRecovery', SUBSCRIPTION_ENDS_AT, SUBSCRIPTION_EXPIRES_AT]
  ] as const)('signs canonical %s claims accepted by the runtime parser and verifier', (
    licenseClass,
    subscriptionEndsAt,
    expiresAt
  ) => {
    const result = issueLicense({
      licenseId: `lic-${licenseClass}`,
      licenseClass,
      features: ['collaboration', 'formats', 'professional.editing'],
      issuedAt: ISSUED_AT,
      ...(licenseClass === 'production'
        ? { issuer: 'jword', keyId: 'jword-prod-2026-k1', expiresAt }
        : {}),
      ...(subscriptionEndsAt === undefined ? {} : { subscriptionEndsAt })
    })

    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')

    const token = result.stdout.trim()
    const envelope = parseJWordLicenseToken(token)
    const claims = parseJWordLicenseClaims(envelope)

    expect(token.startsWith('JWL2.')).toBe(true)
    expect(token).not.toContain('JWL1.')
    expect(verifyEd25519(envelope.signingInput, envelope.signature, PUBLIC_KEY)).toBe(true)
    expect(claims).toEqual({
      schemaVersion: 2,
      licenseId: `lic-${licenseClass}`,
      issuer: 'jword',
      keyId: 'jword-prod-2026-k1',
      licenseClass,
      features: ['collaboration', 'formats', 'professional.editing'],
      issuedAt: ISSUED_AT,
      ...(subscriptionEndsAt === undefined ? {} : { subscriptionEndsAt }),
      expiresAt
    })
    expect(envelope.payloadJson).not.toContain('customerId')
    expect(envelope.payloadJson).not.toContain('offlineGraceDays')
  })

  it('rejects fields and values outside the frozen JWL2 signing contract', () => {
    const validSubscription = createSubscriptionPayload()
    const invalidPayloads = [
      { ...validSubscription, issuer: 'another' },
      { ...validSubscription, keyId: 'jword-prod-2026-k2' },
      { ...validSubscription, customerId: 'forbidden' },
      { ...validSubscription, schemaVersion: 2 },
      { ...validSubscription, licenseId: '' },
      { ...validSubscription, licenseId: 'a'.repeat(129) },
      { ...validSubscription, licenseClass: 'commercial' },
      { ...validSubscription, features: ['unknown'] },
      { ...validSubscription, features: [] },
      { ...validSubscription, features: ['formats', 'formats'] },
      { ...validSubscription, features: ['formats', 'collaboration'] },
      { ...validSubscription, issuedAt: '2026-01-01T00:00:00Z' },
      { ...validSubscription, issuedAt: '2026-02-30T00:00:00.000Z' },
      { ...validSubscription, subscriptionEndsAt: ISSUED_AT },
      { ...validSubscription, subscriptionEndsAt: '2025-12-31T00:00:00.000Z' },
      { ...validSubscription, expiresAt: ISSUED_AT },
      { ...validSubscription, expiresAt: '2027-01-15T00:00:00.001Z' },
      {
        licenseId: 'lic-evaluation-subscription',
        licenseClass: 'evaluation',
        features: ['formats'],
        issuedAt: ISSUED_AT,
        subscriptionEndsAt: SUBSCRIPTION_ENDS_AT
      },
      {
        licenseId: 'lic-evaluation-expiry',
        licenseClass: 'evaluation',
        features: ['formats'],
        issuedAt: ISSUED_AT,
        expiresAt: '2026-01-31T00:00:00.001Z'
      }
    ]

    for (const payload of invalidPayloads) {
      const result = issueLicense(payload)

      expect(result.status, JSON.stringify(payload)).toBe(1)
      expect(result.stdout, JSON.stringify(payload)).toBe('')
      expect(result.stderr, JSON.stringify(payload)).not.toContain('JWL2.')
      expect(result.stderr, JSON.stringify(payload)).not.toContain('BEGIN PRIVATE KEY')
    }
  })

  it('rejects duplicate top-level JSON keys before signing', () => {
    const source = '{"licenseId":"lic-first","licenseId":"lic-second","licenseClass":"production","features":["formats"],"issuedAt":"2026-01-01T00:00:00.000Z","subscriptionEndsAt":"2026-12-31T00:00:00.000Z"}'
    const result = issueLicenseSource(source)

    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('duplicate top-level field')
  })

  it('locks signer canonical bytes to the fixed production runtime golden vector', () => {
    const result = issueLicense({
      licenseId: 'lic-103-golden-expired',
      licenseClass: 'evaluation',
      features: ['formats'],
      issuedAt: ISSUED_AT
    })
    const signerEnvelope = parseJWordLicenseToken(result.stdout.trim())
    const runtimeEnvelope = parseJWordLicenseToken(PRODUCTION_GOLDEN_TOKEN)

    expect(result.status).toBe(0)
    expect(signerEnvelope.payloadJson).toBe(PRODUCTION_GOLDEN_PAYLOAD_JSON)
    expect(signerEnvelope.payloadSegment).toBe(PRODUCTION_GOLDEN_PAYLOAD_SEGMENT)
    expect(signerEnvelope.signingInput).toEqual(runtimeEnvelope.signingInput)
    expect(new TextDecoder().decode(signerEnvelope.signingInput)).toBe(
      `JWL2.${PRODUCTION_GOLDEN_PAYLOAD_SEGMENT}`
    )
    expect(PRODUCTION_GOLDEN_TOKEN.split('.')[2]).toBe(PRODUCTION_GOLDEN_SIGNATURE_SEGMENT)
    expect(verifyJWordLicenseToken(PRODUCTION_GOLDEN_TOKEN).licenseId).toBe(
      'lic-103-golden-expired'
    )
  })

  it('rejects missing or ambiguous private key sources without partial token output', () => {
    const payload = createSubscriptionPayload()
    const missing = issueLicense(payload, {})
    const ambiguous = issueLicense(payload, {
      JWORD_LICENSE_PRIVATE_KEY_PEM: PRIVATE_KEY_PEM,
      JWORD_LICENSE_PRIVATE_KEY_PATH: '/unused/private-key.pem'
    })

    for (const result of [missing, ambiguous]) {
      expect(result.status).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).not.toContain('JWL2.')
      expect(result.stderr).not.toContain('BEGIN PRIVATE KEY')
    }
  })

  it('rejects a private key path that resolves inside the repository', () => {
    const result = issueLicense(createSubscriptionPayload(), {
      JWORD_LICENSE_PRIVATE_KEY_PATH: SCRIPT_PATH
    })

    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('Private key path must be outside the repository')
  })
})

/** 创建合法的 production 签发输入。 */
function createSubscriptionPayload(): Readonly<Record<string, unknown>> {
  return {
    licenseId: 'lic-production',
    licenseClass: 'production',
    features: ['collaboration', 'formats', 'professional.editing'],
    issuedAt: ISSUED_AT,
    subscriptionEndsAt: SUBSCRIPTION_ENDS_AT
  }
}

/** 通过真实 CLI stdin 和隔离环境签发或拒绝一个 payload。 */
function issueLicense(
  payload: Readonly<Record<string, unknown>>,
  keyEnvironment: Readonly<Record<string, string>> = {
    JWORD_LICENSE_PRIVATE_KEY_PEM: PRIVATE_KEY_PEM
  }
) {
  return issueLicenseSource(JSON.stringify(payload), keyEnvironment)
}

/** 通过真实 CLI stdin 签发或拒绝原始 JSON，以覆盖重复 key。 */
function issueLicenseSource(
  source: string,
  keyEnvironment: Readonly<Record<string, string>> = {
    JWORD_LICENSE_PRIVATE_KEY_PEM: PRIVATE_KEY_PEM
  }
) {
  const environment = { ...process.env }
  delete environment.JWORD_LICENSE_PRIVATE_KEY_PEM
  delete environment.JWORD_LICENSE_PRIVATE_KEY_PATH

  return spawnSync(process.execPath, [SCRIPT_PATH], {
    encoding: 'utf8',
    env: { ...environment, ...keyEnvironment },
    input: source
  })
}
