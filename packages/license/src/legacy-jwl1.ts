/**
 * 职责：保留 JWL1 token 识别与旧 fixture 兼容逻辑。
 * 边界：只处理旧 entitlement 和 token，不实现 JWL2、不读取生产 trust store。
 * 协作模块：license.ts 调用本模块完成旧授权校验；测试签发只存在于仓库 fixtures。
 * 性能/安全约束：JWL1 Ed25519 token 一律 fail closed；旧 FNV fixture 只能显式启用。
 * 实现说明：LIC-103 已删除调用方公钥注入，本模块在 Phase 4 完成 JWL1 迁移后删除。
 */

import type { JWordLicenseWarning } from './errors.js'

export type JWordLicenseStatus = 'valid' | 'server-unavailable'

/** 宿主传入的商业授权 entitlement，不包含用户文档内容。 */
export interface JWordLicenseEntitlement {
  readonly customerId: string
  readonly licenseToken: string
  readonly licenseId?: string
  readonly issuer?: string
  readonly issuedAt?: string
  readonly features: readonly string[]
  readonly expiresAt?: string
  readonly offlineGraceUntil?: string
  readonly offlineGraceDays?: number
  readonly schemaVersion?: 1
  readonly status?: JWordLicenseStatus
  readonly signature?: string
}

export interface JWordLicenseSignaturePayload {
  readonly customerId: string
  readonly licenseToken: string
  readonly licenseId?: string
  readonly issuer: string
  readonly issuedAt: string
  readonly features: readonly string[]
  readonly expiresAt?: string
  readonly offlineGraceUntil?: string
  readonly offlineGraceDays?: number
  readonly schemaVersion?: 1
  readonly status?: JWordLicenseStatus
}

export interface JWordLicenseTokenPayload {
  readonly licenseId: string
  readonly customerId: string
  readonly issuer: string
  readonly features: readonly string[]
  readonly issuedAt: string
  readonly expiresAt?: string
  readonly offlineGraceDays: number
  readonly schemaVersion: 1
}

export interface LegacyJWordLicenseValidationOptions {
  readonly allowInsecureFixtureLicense?: boolean
  readonly onWarning?: (warning: JWordLicenseWarning) => void
}

export interface VerifiedLicensePayloadResult {
  readonly ok: boolean
  readonly payload?: JWordLicenseTokenPayload
}

const JWORD_LICENSE_TOKEN_VERSION = 'JWL1'
const JWORD_LICENSE_TOKEN_SCHEMA_VERSION = 1
const LEGACY_INSECURE_LICENSE_PREFIX = 'jword-license-v1:'

/** 读取签名 token；JWL1 Ed25519 fail closed，仅保留显式旧 fixture 校验。 */
export function readVerifiedLicensePayload(
  entitlement: JWordLicenseEntitlement,
  options: LegacyJWordLicenseValidationOptions
): VerifiedLicensePayloadResult {
  const token = readLicenseToken(entitlement)

  if (token === undefined) {
    return { ok: false }
  }

  if (token.startsWith(`${JWORD_LICENSE_TOKEN_VERSION}.`)) {
    return { ok: false }
  }

  if (token.startsWith(LEGACY_INSECURE_LICENSE_PREFIX)) {
    return readVerifiedInsecureFixturePayload(entitlement, token, options)
  }

  return { ok: false }
}

/** 比对公开 entitlement 字段与签名 payload，避免宿主篡改未签字段绕过授权。 */
export function doesEntitlementMatchSignedPayload(
  entitlement: JWordLicenseEntitlement,
  payload: JWordLicenseTokenPayload
): boolean {
  const licenseId = entitlement.licenseId ?? (
    entitlement.licenseToken.startsWith(`${JWORD_LICENSE_TOKEN_VERSION}.`) ? payload.licenseId : entitlement.licenseToken
  )

  return licenseId === payload.licenseId &&
    entitlement.customerId === payload.customerId &&
    entitlement.issuer === payload.issuer &&
    entitlement.issuedAt === payload.issuedAt &&
    entitlement.expiresAt === payload.expiresAt &&
    areStringSetsEqual(entitlement.features, payload.features)
}

/** 读取当前 entitlement 中承载签名 token 的字段。 */
function readLicenseToken(entitlement: JWordLicenseEntitlement): string | undefined {
  if (entitlement.signature !== undefined && entitlement.signature.length > 0) {
    return entitlement.signature
  }

  if (entitlement.licenseToken.startsWith(`${JWORD_LICENSE_TOKEN_VERSION}.`)) {
    return entitlement.licenseToken
  }

  return undefined
}

/** 显式接受旧 FNV fixture，并通过 warning 暴露迁移风险。 */
function readVerifiedInsecureFixturePayload(
  entitlement: JWordLicenseEntitlement,
  token: string,
  options: LegacyJWordLicenseValidationOptions
): VerifiedLicensePayloadResult {
  if (options.allowInsecureFixtureLicense !== true) {
    return { ok: false }
  }

  const payload = createLicenseTokenPayloadFromEntitlement(entitlement)
  const expected = `${LEGACY_INSECURE_LICENSE_PREFIX}${createInsecureFixtureLicenseHash(
    `${createCanonicalInsecureFixturePayload(entitlement)}|jword-local-verifier:${entitlement.issuer ?? ''}`
  )}`

  if (token !== expected) {
    return { ok: false }
  }

  options.onWarning?.({
    code: 'JWORD_LICENSE_INSECURE_FIXTURE_ACCEPTED'
  })

  return {
    ok: true,
    payload
  }
}

/** 从旧 entitlement 对象创建可用于授权判断的签名 payload。 */
function createLicenseTokenPayloadFromEntitlement(entitlement: JWordLicenseEntitlement): JWordLicenseTokenPayload {
  const payload = {
    licenseId: entitlement.licenseId ?? entitlement.licenseToken,
    customerId: entitlement.customerId,
    issuer: entitlement.issuer ?? '',
    features: [...entitlement.features].sort(),
    issuedAt: entitlement.issuedAt ?? '',
    offlineGraceDays: readOfflineGraceDays(entitlement),
    schemaVersion: entitlement.schemaVersion ?? JWORD_LICENSE_TOKEN_SCHEMA_VERSION
  }

  if (entitlement.expiresAt === undefined) {
    return payload
  }

  return {
    ...payload,
    expiresAt: entitlement.expiresAt
  }
}

/** 读取旧 fixture payload 的稳定 JSON，供显式迁移兼容路径使用。 */
function createCanonicalInsecureFixturePayload(entitlement: JWordLicenseEntitlement): string {
  return JSON.stringify({
    customerId: entitlement.customerId,
    expiresAt: entitlement.expiresAt ?? null,
    features: [...entitlement.features].sort(),
    issuedAt: entitlement.issuedAt,
    issuer: entitlement.issuer,
    licenseToken: entitlement.licenseToken,
    offlineGraceUntil: entitlement.offlineGraceUntil ?? null,
    status: entitlement.status ?? 'valid'
  })
}

/** 旧 FNV fixture hash，只能在 allowInsecureFixtureLicense 分支使用。 */
function createInsecureFixtureLicenseHash(value: string): string {
  let hash = 0x811c9dc5

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }

  return hash.toString(16).padStart(8, '0')
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

/** 比对两个字符串集合是否只存在顺序差异。 */
function areStringSetsEqual(left: readonly string[], right: readonly string[]): boolean {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort())
}
