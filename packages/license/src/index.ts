/**
 * 职责：提供商业授权 entitlement、feature key 和稳定诊断的公开契约。
 * 边界：只做本地 entitlement 判定与错误归一，不联网、不读取文档内容、不绑定 DOCX/PDF 运行时。
 * 协作模块：packages/docx、packages/pdf、packages/collab、后续协作服务端和商业发布检查复用这里的 feature matrix。
 * 性能/安全约束：纯函数无副作用；未授权时只返回诊断元数据，不携带用户文档内容。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#step-619冻结-gate-6-商业-edition-matrix。
 */

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

export type JWordLicenseFeatureKey =
  | typeof GATE5_FORMAT_FEATURES[keyof typeof GATE5_FORMAT_FEATURES]
  | typeof GATE6_COLLAB_FEATURES[keyof typeof GATE6_COLLAB_FEATURES]

export type JWordLicenseDiagnosticCode =
  | 'JWORD_LICENSE_MISSING'
  | 'JWORD_LICENSE_EXPIRED'
  | 'JWORD_FEATURE_NOT_ENTITLED'
  | 'JWORD_LICENSE_SERVER_UNAVAILABLE'
  | 'JWORD_LICENSE_SIGNATURE_INVALID'

export type JWordLicenseStatus = 'valid' | 'server-unavailable'

export interface JWordLicenseDiagnosticCodeMetadata {
  readonly severity: 'error'
  readonly description: string
  readonly recoverable: boolean
}

export interface JWordLicenseEntitlement {
  readonly customerId: string
  readonly licenseToken: string
  readonly issuer?: string
  readonly issuedAt?: string
  readonly features: readonly string[]
  readonly expiresAt?: string
  readonly offlineGraceUntil?: string
  readonly status?: JWordLicenseStatus
  readonly signature?: string
}

export type JWordLicenseSignaturePayload = Omit<JWordLicenseEntitlement, 'signature'> & {
  readonly issuer: string
  readonly issuedAt: string
}

export interface JWordLicenseValidationOptions {
  readonly now?: Date | string | number
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

  if (!isJWordLicenseSignatureValid(entitlement)) {
    throw createJWordLicenseError('JWORD_LICENSE_SIGNATURE_INVALID', feature, entitlement.customerId)
  }

  if (entitlement.status === 'server-unavailable') {
    throw createJWordLicenseError('JWORD_LICENSE_SERVER_UNAVAILABLE', feature, entitlement.customerId)
  }

  if (!entitlement.features.includes(feature)) {
    throw createJWordLicenseError('JWORD_FEATURE_NOT_ENTITLED', feature, entitlement.customerId)
  }

  const now = readValidationTime(options.now)
  const expiresAt = readOptionalTime(entitlement.expiresAt)
  const offlineGraceUntil = readOptionalTime(entitlement.offlineGraceUntil)
  const hasExpired = expiresAt !== undefined && expiresAt.getTime() < now.getTime()
  const offlineGrace = hasExpired &&
    offlineGraceUntil !== undefined &&
    offlineGraceUntil.getTime() >= now.getTime()

  if (hasExpired && !offlineGrace) {
    throw createJWordLicenseError('JWORD_LICENSE_EXPIRED', feature, entitlement.customerId)
  }

  return {
    ok: true,
    feature,
    customerId: entitlement.customerId,
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

/** 创建仓库内测试与本地离线校验共享的确定性授权签名。 */
export function createJWordLicenseSignature(
  entitlement: JWordLicenseSignaturePayload
): string {
  return `jword-license-v1:${createStableLicenseHash(
    `${createCanonicalLicensePayload(entitlement)}|${readJWordLicenseVerifierMaterial(entitlement.issuer)}`
  )}`
}

/** 判断字符串是否是公开授权诊断 code。 */
export function isJWordLicenseDiagnosticCode(code: string): code is JWordLicenseDiagnosticCode {
  return code in JWORD_LICENSE_DIAGNOSTIC_CODE_METADATA
}

/** 判断 entitlement 签名是否匹配本地 deterministic payload。 */
function isJWordLicenseSignatureValid(entitlement: JWordLicenseEntitlement): boolean {
  if (
    entitlement.signature === undefined ||
    entitlement.signature.length === 0 ||
    entitlement.issuer === undefined ||
    entitlement.issuedAt === undefined
  ) {
    return false
  }

  const { signature: _signature, ...payload } = entitlement
  const signedPayload: JWordLicenseSignaturePayload = {
    ...payload,
    issuer: entitlement.issuer,
    issuedAt: entitlement.issuedAt
  }

  return entitlement.signature === createJWordLicenseSignature(signedPayload)
}

/** 创建稳定 JSON payload，避免字段顺序影响签名。 */
function createCanonicalLicensePayload(entitlement: JWordLicenseSignaturePayload): string {
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

/** 读取离线 verifier material；当前 Gate 5 只提供仓库内稳定测试 material。 */
function readJWordLicenseVerifierMaterial(issuer: string): string {
  return `jword-local-verifier:${issuer}`
}

/** 创建仓库内稳定 hash；用于离线测试签名契约，不声明为密码学签名。 */
function createStableLicenseHash(value: string): string {
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

/** 读取授权错误的人类可读消息。 */
function readJWordLicenseMessage(
  code: JWordLicenseDiagnosticCode,
  feature: JWordLicenseFeatureKey
): string {
  return `${code}: ${feature}`
}
