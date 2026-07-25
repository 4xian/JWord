/**
 * @vitest-environment node
 *
 * 职责：验证 LIC-110 隔离 JWL2 test-only trust replacement。
 * 边界：只在本测试进程额外信任临时测试 key，不修改生产 trust store 或公开 export。
 * 协作模块：fixtures/license 提供固定测试 token，License 公开入口完成激活、feature 和 transfer 校验。
 * 性能/安全约束：测试 seed、signer 和 trust replacement 不得进入 packages/license/src、dist 或 tarball。
 * 实现说明：未命中测试 key 时委托真实 production trust lookup，并单独证明默认生产配置拒绝测试 token。
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/trust-store.js', async (importOriginal) => {
  const productionTrust = await importOriginal<typeof import('../src/trust-store.js')>()
  const fixture = await import('../../../fixtures/license/test-only-jwl2-fixture.js')

  return {
    ...productionTrust,
    lookupTrustedJWordLicensePublicKey: (issuer: string, keyId: string) => {
      if (issuer === fixture.TEST_ONLY_JWL2_ISSUER && keyId === fixture.TEST_ONLY_JWL2_KEY_ID) {
        return {
          ok: true as const,
          publicKey: Uint8Array.from(Buffer.from(fixture.TEST_ONLY_JWL2_PUBLIC_KEY, 'base64url'))
        }
      }

      return productionTrust.lookupTrustedJWordLicensePublicKey(issuer, keyId)
    }
  }
})

import {
  JWORD_FEATURES,
  activateJWordLicense,
  createJWordLicenseTransfer,
  isJWordFeatureLicensed
} from '../src/index.js'
import {
  TEST_ONLY_JWL2_KEY_ID,
  TEST_ONLY_JWL2_TOKEN,
  createInsecureTestOnlyJwl2Token
} from '../../../fixtures/license/test-only-jwl2-fixture.js'
import { createTestOnlyJWordLicenseEntitlement } from '../../../fixtures/license/test-only-entitlement-fixture.mjs'

const PRODUCTION_GOLDEN_TOKEN = 'JWL2.eyJzY2hlbWFWZXJzaW9uIjoyLCJsaWNlbnNlSWQiOiJsaWMtMTAzLWdvbGRlbi1leHBpcmVkIiwiaXNzdWVyIjoiandvcmQiLCJrZXlJZCI6Imp3b3JkLXByb2QtMjAyNi1rMSIsImxpY2Vuc2VD bGFzcyI6ImV2YWx1YXRpb24iLCJmZWF0dXJlcyI6WyJmb3JtYXRzIl0sImlzc3VlZEF0IjoiMjAyNi0wMS0wMVQwMDowMDowMC4wMDBaIiwiZXhwaXJlc0F0IjoiMjAyNi0wMS0zMVQwMDowMDowMC4wMDBaIn0.kV6uaOYbb40qoekidoGmab_FfhGPDS3AsrGKZr4l_m9PwyJ8rNIpf4xNHEO66onSFhA6_7YSvTm00R6EazkiAw'.replace(' ', '')

describe('LIC-110 test-only JWL2 trust replacement', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('activates the fixed test token and revalidates its transfer through the public API', () => {
    setLicenseTime()
    expect(createInsecureTestOnlyJwl2Token()).toBe(TEST_ONLY_JWL2_TOKEN)

    const license = activateJWordLicense(TEST_ONLY_JWL2_TOKEN)
    expect(isJWordFeatureLicensed(license, JWORD_FEATURES.formats)).toBe(true)

    const transfer = createJWordLicenseTransfer(license)
    expect(transfer).toEqual({ token: TEST_ONLY_JWL2_TOKEN })

    const workerLicense = activateJWordLicense(structuredClone(transfer).token)
    expect(workerLicense).not.toBe(license)
    expect(isJWordFeatureLicensed(workerLicense, JWORD_FEATURES.formats)).toBe(true)
  })

  it('keeps the production golden token valid in the mocked test process', () => {
    setLicenseTime()

    const license = activateJWordLicense(PRODUCTION_GOLDEN_TOKEN)
    expect(isJWordFeatureLicensed(license, JWORD_FEATURES.formats)).toBe(true)
  })

  it('delegates unknown key ids to the production trust lookup', () => {
    const token = replacePayloadText(
      TEST_ONLY_JWL2_TOKEN,
      TEST_ONLY_JWL2_KEY_ID,
      'jword-test-lic110-k2'
    )

    expect(() => activateJWordLicense(token)).toThrowError(expect.objectContaining({
      code: 'JWORD_LICENSE_KEY_UNKNOWN'
    }))
  })

  it('delegates unknown issuers to the production trust lookup', () => {
    const token = replacePayloadText(
      TEST_ONLY_JWL2_TOKEN,
      '"issuer":"jword"',
      '"issuer":"attacker"'
    )

    expect(() => activateJWordLicense(token)).toThrowError(expect.objectContaining({
      code: 'JWORD_LICENSE_ISSUER_INVALID'
    }))
  })

  it('rejects tampered payload and signature bytes', () => {
    const tamperedPayload = replacePayloadText(
      TEST_ONLY_JWL2_TOKEN,
      'lic-110-test-vector',
      'lic-110-test-altered'
    )
    const tamperedSignature = replaceSignatureByte(TEST_ONLY_JWL2_TOKEN)

    expect(() => activateJWordLicense(tamperedPayload)).toThrowError(expect.objectContaining({
      code: 'JWORD_LICENSE_SIGNATURE_INVALID'
    }))
    expect(() => activateJWordLicense(tamperedSignature)).toThrowError(expect.objectContaining({
      code: 'JWORD_LICENSE_SIGNATURE_INVALID'
    }))
  })

  it('rejects the test-only entitlement marker through the production public root', async () => {
    vi.doUnmock('@4xian/jword-license')
    vi.doUnmock('../src/trust-store.js')
    vi.resetModules()
    const productionLicense = await import('@4xian/jword-license')
    const entitlement = createTestOnlyJWordLicenseEntitlement(['docx.import'])

    expect(() => productionLicense.assertJWordFeatureEntitled(entitlement, 'docx.import'))
      .toThrowError(expect.objectContaining({
        code: 'JWORD_LICENSE_SIGNATURE_INVALID',
        feature: 'docx.import'
      }))
  })

  it('rejects the test token after restoring the default production trust module', async () => {
    vi.doUnmock('@4xian/jword-license')
    vi.doUnmock('../src/trust-store.js')
    vi.resetModules()
    const productionLicense = await import('../src/index.js')

    expect(() => productionLicense.activateJWordLicense(TEST_ONLY_JWL2_TOKEN))
      .toThrowError(expect.objectContaining({
        code: 'JWORD_LICENSE_KEY_UNKNOWN'
      }))
  })
})

/** 固定激活时钟到两个 golden token 的共同有效期。 */
function setLicenseTime(): void {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-01-15T00:00:00.000Z'))
}

/** 修改 payload 文本但保留原签名，构造 trust hint 或 payload 篡改。 */
function replacePayloadText(token: string, search: string, replacement: string): string {
  const parts = token.split('.')
  const payloadJson = Buffer.from(parts[1] ?? '', 'base64url').toString('utf8')
  const payloadSegment = Buffer.from(payloadJson.replace(search, replacement)).toString('base64url')

  return `${parts[0]}.${payloadSegment}.${parts[2]}`
}

/** 修改签名首字节，保持签名长度与 base64url 编码规范。 */
function replaceSignatureByte(token: string): string {
  const parts = token.split('.')
  const signature = Buffer.from(parts[2] ?? '', 'base64url')
  signature[0] = (signature[0] ?? 0) ^ 1

  return `${parts[0]}.${parts[1]}.${signature.toString('base64url')}`
}
