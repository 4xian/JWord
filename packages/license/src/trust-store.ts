/**
 * 职责：保存生产 License trust root，并按固定 issuer 与 keyId 查找公钥。
 * 边界：只包含获批生产公钥，不接受调用方注入，也不提供替换入口。
 * 协作模块：verify-jwl2.ts 使用本模块返回的 32-byte 公钥执行 Ed25519 验签。
 * 性能/安全约束：测试、临时或调用方提供的 key 不得写入生产 trust store。
 * 实现说明：LIC-109A 在内部区分不受信 issuer 与未知 key，公开入口仍 fail closed。
 */

import {
  decodeBase64Url,
  encodeBase64Url
} from './crypto.js'

interface TrustedJWordLicenseKey {
  readonly issuer: string
  readonly keyId: string
  readonly publicKeyBase64Url: string
}

export type JWordLicenseTrustLookupResult =
  | { readonly ok: true, readonly publicKey: Uint8Array }
  | { readonly ok: false, readonly reason: 'issuer-invalid' | 'key-unknown' }

const PRODUCTION_JWORD_LICENSE_KEY: TrustedJWordLicenseKey = Object.freeze({
  issuer: 'jword',
  keyId: 'jword-prod-2026-k1',
  publicKeyBase64Url: 'Y5x05lXUVsNO4nVtxHk65IVSMQz-_gMAGw-C48EFlhg'
})

/** 按固定 issuer 与 keyId 读取规范的 32-byte 生产公钥。 */
export function readTrustedJWordLicensePublicKey(
  issuer: string,
  keyId: string
): Uint8Array | undefined {
  const result = lookupTrustedJWordLicensePublicKey(issuer, keyId)

  return result.ok ? result.publicKey : undefined
}

/** 在 License 内部区分 issuer 与 key lookup 失败。 */
export function lookupTrustedJWordLicensePublicKey(
  issuer: string,
  keyId: string
): JWordLicenseTrustLookupResult {
  if (issuer !== PRODUCTION_JWORD_LICENSE_KEY.issuer) {
    return { ok: false, reason: 'issuer-invalid' }
  }

  if (keyId !== PRODUCTION_JWORD_LICENSE_KEY.keyId) {
    return { ok: false, reason: 'key-unknown' }
  }

  try {
    const encodedKey = PRODUCTION_JWORD_LICENSE_KEY.publicKeyBase64Url
    if (!/^[A-Za-z0-9_-]+$/u.test(encodedKey)) {
      return { ok: false, reason: 'key-unknown' }
    }

    const publicKey = decodeBase64Url(encodedKey)
    if (publicKey.length !== 32 || encodeBase64Url(publicKey) !== encodedKey) {
      return { ok: false, reason: 'key-unknown' }
    }

    return { ok: true, publicKey }
  } catch {
    return { ok: false, reason: 'key-unknown' }
  }
}
