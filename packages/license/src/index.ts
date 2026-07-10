/**
 * 职责：提供商业授权 entitlement、feature key 和稳定诊断的公开契约。
 * 边界：只做本地 entitlement 判定与错误归一，不联网、不读取文档内容、不绑定 DOCX/PDF 运行时。
 * 协作模块：packages/docx、packages/pdf、packages/collab、后续协作服务端和商业发布检查复用这里的 feature matrix。
 * 性能/安全约束：纯函数无副作用；未授权时只返回诊断元数据，不携带用户文档内容。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import {
  decodeBase64Url,
  decodeUtf8,
  encodeBase64Url,
  encodeUtf8,
  signEd25519,
  verifyEd25519
} from './crypto.js'

/** Gate 5 高级格式互通 feature matrix。 */
export const GATE5_FORMAT_FEATURES = {
  docxImport: 'docx.import',
  docxExport: 'docx.export',
  pdfExport: 'pdf.export'
} as const

/** Gate 6 高级协作、离线、历史、服务端和自动插入 feature matrix。 */
export const GATE6_COLLAB_FEATURES = {
  multiplayer: 'collaboration.multiplayer',
  offline: 'collaboration.offline',
  history: 'collaboration.history',
  server: 'collaboration.server',
  autoInsert: 'automation.autoInsert'
} as const

/** 所有商业高级能力使用的稳定 feature key union。 */
export type JWordLicenseFeatureKey =
  | typeof GATE5_FORMAT_FEATURES[keyof typeof GATE5_FORMAT_FEATURES]
  | typeof GATE6_COLLAB_FEATURES[keyof typeof GATE6_COLLAB_FEATURES]

/** 授权模块对外返回的稳定诊断码。 */
export type JWordLicenseDiagnosticCode =
  | 'JWORD_LICENSE_MISSING'
  | 'JWORD_LICENSE_EXPIRED'
  | 'JWORD_FEATURE_NOT_ENTITLED'
  | 'JWORD_LICENSE_SERVER_UNAVAILABLE'
  | 'JWORD_LICENSE_SIGNATURE_INVALID'

export type JWordLicenseWarningCode = 'JWORD_LICENSE_INSECURE_FIXTURE_ACCEPTED'

export type JWordLicenseStatus = 'valid' | 'server-unavailable'

export interface JWordLicenseDiagnosticCodeMetadata {
  readonly severity: 'error'
  readonly description: string
  readonly recoverable: boolean
}

export interface JWordLicenseWarning {
  readonly code: JWordLicenseWarningCode
  readonly message: string
}

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

export interface JWordLicenseValidationOptions {
  readonly now?: Date | string | number
  readonly publicKeyBase64Url?: string
  readonly allowInsecureFixtureLicense?: boolean
  readonly onWarning?: (warning: JWordLicenseWarning) => void
}

export interface JWordLicenseValidationResult {
  readonly ok: true
  readonly feature: JWordLicenseFeatureKey
  readonly customerId: string
  readonly offlineGrace: boolean
}

export const JWORD_LICENSE_DIAGNOSTIC_CODE_METADATA = {
  JWORD_LICENSE_MISSING: {
    severity: 'error',
    description: '缺少商业授权 entitlement。',
    recoverable: true
  },
  JWORD_LICENSE_EXPIRED: {
    severity: 'error',
    description: '商业授权已过期且不在离线宽限期内。',
    recoverable: true
  },
  JWORD_FEATURE_NOT_ENTITLED: {
    severity: 'error',
    description: '当前授权未包含请求的高级 feature。',
    recoverable: true
  },
  JWORD_LICENSE_SERVER_UNAVAILABLE: {
    severity: 'error',
    description: '授权服务不可用，无法确认当前高级 feature。',
    recoverable: true
  },
  JWORD_LICENSE_SIGNATURE_INVALID: {
    severity: 'error',
    description: '商业授权签名缺失或校验失败。',
    recoverable: true
  }
} as const satisfies Record<JWordLicenseDiagnosticCode, JWordLicenseDiagnosticCodeMetadata>

const JWORD_LICENSE_TOKEN_VERSION = 'JWL1'
const JWORD_LICENSE_TOKEN_SCHEMA_VERSION = 1
const JWORD_LICENSE_DEFAULT_PUBLIC_KEY_BASE64URL = '11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo'
const LEGACY_INSECURE_LICENSE_PREFIX = 'jword-license-v1:'
interface VerifiedLicensePayloadResult {
  readonly ok: boolean
  readonly payload?: JWordLicenseTokenPayload
}


export class JWordLicenseError extends Error {
  override readonly name = 'JWordLicenseError'
  readonly code: JWordLicenseDiagnosticCode
  readonly feature: JWordLicenseFeatureKey
  readonly customerId?: string

  /** 创建不携带用户文档内容的授权诊断错误。 */
  constructor(
    code: JWordLicenseDiagnosticCode,
    feature: JWordLicenseFeatureKey,
    customerId?: string
  ) {
    super(readJWordLicenseMessage(code, feature))
    this.code = code
    this.feature = feature
    if (customerId !== undefined) {
      this.customerId = customerId
    }
  }
}

/** 断言 entitlement 可使用指定高级 feature。 */
export function assertJWordFeatureEntitled(
  entitlement: JWordLicenseEntitlement | null | undefined,
  feature: JWordLicenseFeatureKey,
  options: JWordLicenseValidationOptions = {}
): JWordLicenseValidationResult {
  if (entitlement === null || entitlement === undefined || entitlement.licenseToken.length === 0) {
    throw createJWordLicenseError('JWORD_LICENSE_MISSING', feature)
  }

  const verification = readVerifiedLicensePayload(entitlement, options)

  if (!verification.ok || verification.payload === undefined) {
    throw createJWordLicenseError('JWORD_LICENSE_SIGNATURE_INVALID', feature, entitlement.customerId)
  }

  if (!doesEntitlementMatchSignedPayload(entitlement, verification.payload)) {
    throw createJWordLicenseError('JWORD_LICENSE_SIGNATURE_INVALID', feature, entitlement.customerId)
  }

  if (entitlement.status === 'server-unavailable') {
    throw createJWordLicenseError('JWORD_LICENSE_SERVER_UNAVAILABLE', feature, entitlement.customerId)
  }

  if (!verification.payload.features.includes(feature)) {
    throw createJWordLicenseError('JWORD_FEATURE_NOT_ENTITLED', feature, verification.payload.customerId)
  }

  const now = readValidationTime(options.now)
  const expiresAt = readOptionalTime(verification.payload.expiresAt)
  const offlineGraceUntil = readOfflineGraceUntil(expiresAt, verification.payload.offlineGraceDays)
  const hasExpired = expiresAt !== undefined && expiresAt.getTime() < now.getTime()
  const offlineGrace = hasExpired &&
    offlineGraceUntil !== undefined &&
    offlineGraceUntil.getTime() >= now.getTime()

  if (hasExpired && !offlineGrace) {
    throw createJWordLicenseError('JWORD_LICENSE_EXPIRED', feature, verification.payload.customerId)
  }

  return {
    ok: true,
    feature,
    customerId: verification.payload.customerId,
    offlineGrace
  }
}

/** 创建授权错误，供 worker 和示例复用同一诊断结构。 */
export function createJWordLicenseError(
  code: JWordLicenseDiagnosticCode,
  feature: JWordLicenseFeatureKey,
  customerId?: string
): JWordLicenseError {
  return new JWordLicenseError(code, feature, customerId)
}

/** 使用仓库测试私钥签发非生产授权 token；调用方必须显式传入 insecure-test-only seed。 */
export function createInsecureTestOnlyJWordLicenseSignature(
  entitlement: JWordLicenseSignaturePayload,
  privateKeySeedBase64Url: string
): string {
  const tokenPayload = createLicenseTokenPayload(entitlement)
  const payloadJson = createCanonicalLicenseTokenPayload(tokenPayload)
  const payloadSegment = encodeBase64Url(encodeUtf8(payloadJson))
  const signingInput = encodeUtf8(`${JWORD_LICENSE_TOKEN_VERSION}.${payloadSegment}`)
  const signature = signEd25519(signingInput, decodeBase64Url(privateKeySeedBase64Url))

  return `${JWORD_LICENSE_TOKEN_VERSION}.${payloadSegment}.${encodeBase64Url(signature)}`
}

/** 判断字符串是否是公开授权诊断 code。 */
export function isJWordLicenseDiagnosticCode(code: string): code is JWordLicenseDiagnosticCode {
  return code in JWORD_LICENSE_DIAGNOSTIC_CODE_METADATA
}

/** 读取签名 token 并执行 Ed25519 或显式旧 fixture 校验。 */
function readVerifiedLicensePayload(
  entitlement: JWordLicenseEntitlement,
  options: JWordLicenseValidationOptions
): VerifiedLicensePayloadResult {
  const token = readLicenseToken(entitlement)

  if (token === undefined) {
    return { ok: false }
  }

  if (token.startsWith(`${JWORD_LICENSE_TOKEN_VERSION}.`)) {
    return readVerifiedEd25519LicensePayload(token, options.publicKeyBase64Url)
  }

  if (token.startsWith(LEGACY_INSECURE_LICENSE_PREFIX)) {
    return readVerifiedInsecureFixturePayload(entitlement, token, options)
  }

  return { ok: false }
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

/** 验证 JWL1 Ed25519 token 并读取签名 payload。 */
function readVerifiedEd25519LicensePayload(
  token: string,
  publicKeyBase64Url: string | undefined
): VerifiedLicensePayloadResult {
  const parts = token.split('.')

  if (parts.length !== 3 || parts[0] !== JWORD_LICENSE_TOKEN_VERSION) {
    return { ok: false }
  }

  const payloadSegment = parts[1]
  const signatureSegment = parts[2]

  if (payloadSegment === undefined || signatureSegment === undefined) {
    return { ok: false }
  }

  try {
    const payloadBytes = decodeBase64Url(payloadSegment)
    const signature = decodeBase64Url(signatureSegment)
    const publicKey = decodeBase64Url(publicKeyBase64Url ?? JWORD_LICENSE_DEFAULT_PUBLIC_KEY_BASE64URL)
    const signingInput = encodeUtf8(`${JWORD_LICENSE_TOKEN_VERSION}.${payloadSegment}`)

    if (!verifyEd25519(signingInput, signature, publicKey)) {
      return { ok: false }
    }

    return {
      ok: true,
      payload: readLicenseTokenPayload(decodeUtf8(payloadBytes))
    }
  } catch {
    return { ok: false }
  }
}

/** 显式接受旧 FNV fixture，并通过 warning 暴露迁移风险。 */
function readVerifiedInsecureFixturePayload(
  entitlement: JWordLicenseEntitlement,
  token: string,
  options: JWordLicenseValidationOptions
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
    code: 'JWORD_LICENSE_INSECURE_FIXTURE_ACCEPTED',
    message: '已显式接受旧 FNV fixture 授权；该格式只能用于仓库测试。'
  })

  return {
    ok: true,
    payload
  }
}

/** 比对公开 entitlement 字段与签名 payload，避免宿主篡改未签字段绕过授权。 */
function doesEntitlementMatchSignedPayload(
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

/** 创建供 JWL1 token 签名使用的稳定 payload。 */
function createLicenseTokenPayload(entitlement: JWordLicenseSignaturePayload): JWordLicenseTokenPayload {
  const payload = {
    licenseId: entitlement.licenseId ?? entitlement.licenseToken,
    customerId: entitlement.customerId,
    issuer: entitlement.issuer,
    features: [...entitlement.features].sort(),
    issuedAt: entitlement.issuedAt,
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

/** 创建 JWL1 payload 的稳定 JSON。 */
function createCanonicalLicenseTokenPayload(payload: JWordLicenseTokenPayload): string {
  return JSON.stringify({
    licenseId: payload.licenseId,
    customerId: payload.customerId,
    issuer: payload.issuer,
    features: [...payload.features].sort(),
    issuedAt: payload.issuedAt,
    expiresAt: payload.expiresAt ?? null,
    offlineGraceDays: payload.offlineGraceDays,
    schemaVersion: payload.schemaVersion
  })
}

/** 解析并校验 JWL1 payload JSON。 */
function readLicenseTokenPayload(payloadJson: string): JWordLicenseTokenPayload {
  const value: unknown = JSON.parse(payloadJson)

  if (!isRecord(value)) {
    throw new Error('Invalid license payload')
  }

  const expiresAt = value.expiresAt
  const payload = {
    licenseId: readRequiredString(value.licenseId),
    customerId: readRequiredString(value.customerId),
    issuer: readRequiredString(value.issuer),
    features: readStringArray(value.features),
    issuedAt: readRequiredString(value.issuedAt),
    offlineGraceDays: readNonNegativeInteger(value.offlineGraceDays),
    schemaVersion: readSchemaVersion(value.schemaVersion)
  }

  if (expiresAt === null || expiresAt === undefined) {
    return payload
  }

  return {
    ...payload,
    expiresAt: readRequiredString(expiresAt)
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

/** 读取授权判断使用的当前时间。 */
function readValidationTime(value: Date | string | number | undefined): Date {
  if (value === undefined) {
    return new Date()
  }

  return value instanceof Date ? value : new Date(value)
}

/** 读取可选时间字段。 */
function readOptionalTime(value: string | undefined): Date | undefined {
  return value === undefined ? undefined : new Date(value)
}

/** 根据过期时间和离线宽限天数计算宽限截止时间。 */
function readOfflineGraceUntil(expiresAt: Date | undefined, offlineGraceDays: number): Date | undefined {
  if (expiresAt === undefined || offlineGraceDays <= 0) {
    return undefined
  }

  return new Date(expiresAt.getTime() + offlineGraceDays * 24 * 60 * 60 * 1000)
}

/** 从兼容输入中读取离线宽限天数。 */
function readOfflineGraceDays(entitlement: Pick<JWordLicenseSignaturePayload, 'expiresAt' | 'offlineGraceUntil' | 'offlineGraceDays'>): number {
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

/** 读取授权错误的人类可读消息。 */
function readJWordLicenseMessage(
  code: JWordLicenseDiagnosticCode,
  feature: JWordLicenseFeatureKey
): string {
  return `${code}: ${feature}`
}

/** 判断值是否是普通对象记录。 */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 读取必填字符串字段。 */
function readRequiredString(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('Invalid license string field')
  }

  return value
}

/** 读取字符串数组字段。 */
function readStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.length === 0)) {
    throw new Error('Invalid license features field')
  }

  return [...value].sort()
}

/** 读取非负整数。 */
function readNonNegativeInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error('Invalid license number field')
  }

  return value
}

/** 读取 token schema version。 */
function readSchemaVersion(value: unknown): 1 {
  if (value !== JWORD_LICENSE_TOKEN_SCHEMA_VERSION) {
    throw new Error('Unsupported license schema version')
  }

  return JWORD_LICENSE_TOKEN_SCHEMA_VERSION
}
