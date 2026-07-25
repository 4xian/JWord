/**
 * 职责：为仓库测试创建确定性的 insecure-test-only JWL1 token 和 Ed25519 签名。
 * 边界：只允许 Node 测试、benchmark 和 smoke 使用，不进入任何可发布 package 或浏览器运行时。
 * 协作模块：license 单元测试和仍受 JWL1 调用方迁移阻断的仓库测试消费此 fixture support。
 * 性能/安全约束：只使用公开测试 seed；禁止用于真实授权、生产 trust replacement、错误或日志。
 * 实现说明：LIC-106 从正式 License 包移入此处，保持迁移前 JWL1 token 字节兼容。
 */

import {
  createPrivateKey,
  sign
} from 'node:crypto'

import type { JWordLicenseSignaturePayload } from '../../packages/license/src/index'

const JWL1_TOKEN_VERSION = 'JWL1'
const JWL1_TOKEN_SCHEMA_VERSION = 1
const ED25519_PKCS8_SEED_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex')

/** 使用仓库测试 seed 创建与迁移前一致的 JWL1 token。 */
export function createInsecureTestOnlyJWordLicenseSignature(
  entitlement: JWordLicenseSignaturePayload,
  privateKeySeedBase64Url: string
): string {
  const payloadJson = JSON.stringify({
    licenseId: entitlement.licenseId ?? entitlement.licenseToken,
    customerId: entitlement.customerId,
    issuer: entitlement.issuer,
    features: [...entitlement.features].sort(),
    issuedAt: entitlement.issuedAt,
    expiresAt: entitlement.expiresAt ?? null,
    offlineGraceDays: readOfflineGraceDays(entitlement),
    schemaVersion: entitlement.schemaVersion ?? JWL1_TOKEN_SCHEMA_VERSION
  })
  const payloadSegment = Buffer.from(payloadJson, 'utf8').toString('base64url')
  const signingInput = Buffer.from(`${JWL1_TOKEN_VERSION}.${payloadSegment}`, 'utf8')
  const signature = createInsecureTestOnlyEd25519Signature(signingInput, privateKeySeedBase64Url)

  return `${JWL1_TOKEN_VERSION}.${payloadSegment}.${Buffer.from(signature).toString('base64url')}`
}

/** 使用仓库测试 seed 创建仅供测试向量使用的 Ed25519 签名。 */
export function createInsecureTestOnlyEd25519Signature(
  message: Uint8Array,
  privateKeySeedBase64Url: string
): Uint8Array {
  const seed = Buffer.from(privateKeySeedBase64Url, 'base64url')
  const privateKey = createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_SEED_PREFIX, seed]),
    format: 'der',
    type: 'pkcs8'
  })

  return sign(null, message, privateKey)
}

/** 从兼容输入中读取离线宽限天数。 */
function readOfflineGraceDays(
  entitlement: Pick<JWordLicenseSignaturePayload, 'expiresAt' | 'offlineGraceUntil' | 'offlineGraceDays'>
): number {
  if (entitlement.offlineGraceDays !== undefined) {
    return Math.max(0, Math.floor(entitlement.offlineGraceDays))
  }

  if (entitlement.expiresAt === undefined || entitlement.offlineGraceUntil === undefined) {
    return 0
  }

  const expiresAt = new Date(entitlement.expiresAt).getTime()
  const graceUntil = new Date(entitlement.offlineGraceUntil).getTime()
  const duration = graceUntil - expiresAt

  return duration <= 0 ? 0 : Math.ceil(duration / (24 * 60 * 60 * 1000))
}
