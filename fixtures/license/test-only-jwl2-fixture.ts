/**
 * 职责：提供 LIC-110 专用的 JWL2 测试 key、固定 token 和 Node 签名 helper。
 * 边界：只允许 License focused test 通过 vi.mock 使用，不进入生产 License runtime。
 * 协作模块：packages/license/test/lic110-test-trust.test.ts 使用本文件验证隔离 trust replacement。
 * 性能/安全约束：seed 是公开测试材料，禁止进入 packages/license/src、dist、tarball 或正式 trust store。
 * 实现说明：签名输入固定为 UTF-8 的 `JWL2.<payloadSegment>`，不复用 JWL1 seed 或 signer。
 */

import { createPrivateKey, sign } from 'node:crypto'

export const TEST_ONLY_JWL2_ISSUER = 'jword'
export const TEST_ONLY_JWL2_KEY_ID = 'jword-test-lic110-k1'
export const TEST_ONLY_JWL2_PRIVATE_KEY_SEED = '1khcNK8g3qT9XGo1IyY3QENcs3Nxn_pYoS2jov2W4jQ'
export const TEST_ONLY_JWL2_PUBLIC_KEY = '39r2rT9kW8KQEHVnDf1axeGJEzDSeqznuq4k-EojyKc'
export const TEST_ONLY_JWL2_TOKEN = 'JWL2.eyJzY2hlbWFWZXJzaW9uIjoyLCJsaWNlbnNlSWQiOiJsaWMtMTEwLXRlc3QtdmVjdG9yIiwiaXNzdWVyIjoiandvcmQiLCJrZXlJZCI6Imp3b3JkLXRlc3QtbGljMTEwLWsxIiwibGljZW5zZUNsYXNzIjoiZXZhbHVhdGlvbiIsImZlYXR1cmVzIjpbImZvcm1hdHMiXSwiaXNzdWVkQXQiOiIyMDI2LTAxLTAxVDAwOjAwOjAwLjAwMFoiLCJleHBpcmVzQXQiOiIyMDI2LTAxLTMxVDAwOjAwOjAwLjAwMFoifQ.V7cKxIQLmwOHZuWGva1Vo0XWQ4AaYem1pHDgHG3vW_Jtgd1u505iGfGCngU7uIg9tnm0WP1YeInwVr5TQZoiCQ'

const ED25519_PKCS8_SEED_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex')

/** 生成固定 LIC-110 JWL2 token，锁定 canonical claims 和签名输入。 */
export function createInsecureTestOnlyJwl2Token(): string {
  const payloadJson = JSON.stringify({
    schemaVersion: 2,
    licenseId: 'lic-110-test-vector',
    issuer: TEST_ONLY_JWL2_ISSUER,
    keyId: TEST_ONLY_JWL2_KEY_ID,
    licenseClass: 'evaluation',
    features: ['formats'],
    issuedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2026-01-31T00:00:00.000Z'
  })
  const payloadSegment = Buffer.from(payloadJson, 'utf8').toString('base64url')
  const signingInput = Buffer.from(`JWL2.${payloadSegment}`, 'utf8')
  const privateKey = createPrivateKey({
    key: Buffer.concat([
      ED25519_PKCS8_SEED_PREFIX,
      Buffer.from(TEST_ONLY_JWL2_PRIVATE_KEY_SEED, 'base64url')
    ]),
    format: 'der',
    type: 'pkcs8'
  })
  const signature = sign(null, signingInput, privateKey)

  return `JWL2.${payloadSegment}.${signature.toString('base64url')}`
}
