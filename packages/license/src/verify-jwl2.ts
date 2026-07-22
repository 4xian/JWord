/**
 * 职责：编排 JWL2 固定 trust lookup、Ed25519 验签和验签后 claims 解析。
 * 边界：只返回 License 内部未品牌化 claims，不创建 handle、不校验时间关系。
 * 协作模块：jwl2.ts 提供 envelope/claims parser，trust-store.ts 提供固定生产公钥。
 * 性能/安全约束：未验签字段只作 lookup hint，失败错误不包含 token、签名、公钥或 claims。
 * 实现说明：调用顺序固定为 envelope → trust lookup → Ed25519 →完整 claims，并保留内部失败分类。
 */

import { verifyEd25519 } from './crypto.js'
import {
  parseJWordLicenseClaims,
  parseJWordLicenseToken
} from './jwl2.js'
import type {
  JWordLicenseClaimsV2,
  JWordLicenseToken,
  JWordLicenseTokenEnvelope
} from './jwl2.js'
import { lookupTrustedJWordLicensePublicKey } from './trust-store.js'

export type JWordLicenseVerificationFailureCode =
  | 'JWORD_LICENSE_TOKEN_INVALID'
  | 'JWORD_LICENSE_ISSUER_INVALID'
  | 'JWORD_LICENSE_KEY_UNKNOWN'
  | 'JWORD_LICENSE_SIGNATURE_INVALID'

export class JWordLicenseVerificationError extends Error {
  override readonly name = 'JWordLicenseVerificationError'
  readonly code: JWordLicenseVerificationFailureCode

  /** 创建不携带验签材料或原始异常的内部失败。 */
  constructor(code: JWordLicenseVerificationFailureCode) {
    super(code)
    this.code = code
  }
}

/** 验证 JWL2 token，并仅在签名成功后返回完整 claims。 */
export function verifyJWordLicenseToken(token: JWordLicenseToken): JWordLicenseClaimsV2 {
  let envelope: JWordLicenseTokenEnvelope

  try {
    envelope = parseJWordLicenseToken(token)
  } catch {
    throw new JWordLicenseVerificationError('JWORD_LICENSE_TOKEN_INVALID')
  }

  const trust = lookupTrustedJWordLicensePublicKey(envelope.issuer, envelope.keyId)
  if (!trust.ok) {
    throw new JWordLicenseVerificationError(
      trust.reason === 'issuer-invalid'
        ? 'JWORD_LICENSE_ISSUER_INVALID'
        : 'JWORD_LICENSE_KEY_UNKNOWN'
    )
  }

  if (!verifyEd25519(envelope.signingInput, envelope.signature, trust.publicKey)) {
    throw new JWordLicenseVerificationError('JWORD_LICENSE_SIGNATURE_INVALID')
  }

  try {
    return parseJWordLicenseClaims(envelope)
  } catch {
    throw new JWordLicenseVerificationError('JWORD_LICENSE_TOKEN_INVALID')
  }
}
