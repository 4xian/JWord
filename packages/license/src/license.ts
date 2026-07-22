/**
 * 职责：编排 JWL2 激活、opaque handle 和旧 entitlement 校验。
 * 边界：只组合既有 verifier、feature、诊断和旧 JWL1 校验，不实现 codec 或 trust lookup。
 * 协作模块：package 根入口转导出本模块，后续商业模块消费统一 JWL2 handle。
 * 性能/安全约束：JWL2 状态仅保存在模块私有 WeakMap，JWL1 生产 token 保持 fail closed。
 * 实现说明：LIC-104/105 增加激活、handle 与 identity-checked worker transfer。
 */

import { createJWordLicenseError } from './errors.js'
import type { JWordLicenseWarning } from './errors.js'
import type {
  JWordFeature,
  JWordLicenseFeatureKey
} from './features.js'
import type {
  JWordLicenseClaimsV2,
  JWordLicenseClass,
  JWordLicenseToken
} from './jwl2.js'
import {
  doesEntitlementMatchSignedPayload,
  readVerifiedLicensePayload
} from './legacy-jwl1.js'
import type { JWordLicenseEntitlement } from './legacy-jwl1.js'
import {
  JWordLicenseVerificationError,
  verifyJWordLicenseToken
} from './verify-jwl2.js'

interface InternalLicenseState {
  readonly token: JWordLicenseToken
  readonly licenseClass: JWordLicenseClass
  readonly features: readonly JWordFeature[]
  readonly issuedAt: string
  readonly subscriptionEndsAt?: string
  readonly expiresAt: string
}

const JWORD_LICENSE_STATES = new WeakMap<object, InternalLicenseState>()
const JWORD_LICENSE_DAY_MS = 24 * 60 * 60 * 1000
const JWORD_LICENSE_MAX_FUTURE_SKEW_MS = 5 * 60 * 1000
const JWORD_LICENSE_EVALUATION_DURATION_MS = 30 * JWORD_LICENSE_DAY_MS
const JWORD_LICENSE_SUBSCRIPTION_GRACE_MS = 15 * JWORD_LICENSE_DAY_MS

/** 当前 License runtime 通过 WeakMap 登记的公开 opaque handle。 */
export interface JWordLicense {
  readonly licenseId: string
  readonly expiresAt: string
}

/** Worker 间传递原始签名 token 的最小 DTO。 */
export interface JWordLicenseTransfer {
  readonly token: JWordLicenseToken
}

export interface JWordLicenseValidationOptions {
  readonly now?: Date | string | number
  readonly allowInsecureFixtureLicense?: boolean
  readonly onWarning?: (warning: JWordLicenseWarning) => void
}

export interface JWordLicenseValidationResult {
  readonly ok: true
  readonly feature: JWordLicenseFeatureKey
  readonly customerId: string
  readonly offlineGrace: boolean
}

/** 验证并激活 JWL2 token，返回由模块私有 WeakMap 标记的只读 handle。 */
export function activateJWordLicense(token: JWordLicenseToken): JWordLicense {
  let claims: JWordLicenseClaimsV2

  try {
    claims = verifyJWordLicenseToken(token)
  } catch (error) {
    throw createJWordLicenseError(
      error instanceof JWordLicenseVerificationError
        ? error.code
        : 'JWORD_LICENSE_TOKEN_INVALID'
    )
  }

  assertJWordLicenseTimeValid(claims)

  const license = Object.freeze({
    licenseId: claims.licenseId,
    expiresAt: claims.expiresAt
  })
  const state: InternalLicenseState = {
    token,
    licenseClass: claims.licenseClass,
    features: claims.features,
    issuedAt: claims.issuedAt,
    ...(claims.subscriptionEndsAt === undefined
      ? {}
      : { subscriptionEndsAt: claims.subscriptionEndsAt }),
    expiresAt: claims.expiresAt
  }

  JWORD_LICENSE_STATES.set(license, state)

  return license
}

/** 从可信 handle 创建只携带已验签原始 token 的 worker transfer。 */
export function createJWordLicenseTransfer(
  license: JWordLicense
): JWordLicenseTransfer {
  const state = JWORD_LICENSE_STATES.get(license)

  if (state === undefined) {
    throw createJWordLicenseError('JWORD_LICENSE_HANDLE_INVALID')
  }

  return { token: state.token }
}

/** 校验已验签 JWL2 claims 的生效时间、先后关系和当前到期状态。 */
export function assertJWordLicenseTimeValid(claims: JWordLicenseClaimsV2): void {
  const now = Date.now()
  const issuedAt = Date.parse(claims.issuedAt)
  const expiresAt = Date.parse(claims.expiresAt)

  if (Number.isNaN(issuedAt) || Number.isNaN(expiresAt)) {
    throw createJWordLicenseError('JWORD_LICENSE_TOKEN_INVALID')
  }

  if (issuedAt > now + JWORD_LICENSE_MAX_FUTURE_SKEW_MS) {
    throw createJWordLicenseError('JWORD_LICENSE_NOT_YET_VALID')
  }

  if (expiresAt <= issuedAt) {
    throw createJWordLicenseError('JWORD_LICENSE_TOKEN_INVALID')
  }

  if (claims.licenseClass === 'evaluation') {
    if (
      claims.subscriptionEndsAt !== undefined ||
      expiresAt - issuedAt !== JWORD_LICENSE_EVALUATION_DURATION_MS
    ) {
      throw createJWordLicenseError('JWORD_LICENSE_TOKEN_INVALID')
    }
  } else if (claims.subscriptionEndsAt === undefined) {
    throw createJWordLicenseError('JWORD_LICENSE_TOKEN_INVALID')
  }

  if (claims.subscriptionEndsAt !== undefined) {
    const subscriptionEndsAt = Date.parse(claims.subscriptionEndsAt)
    if (
      Number.isNaN(subscriptionEndsAt) ||
      subscriptionEndsAt <= issuedAt ||
      expiresAt <= subscriptionEndsAt ||
      expiresAt - subscriptionEndsAt !== JWORD_LICENSE_SUBSCRIPTION_GRACE_MS
    ) {
      throw createJWordLicenseError('JWORD_LICENSE_TOKEN_INVALID')
    }
  }

  if (expiresAt <= now) {
    throw createJWordLicenseError('JWORD_LICENSE_EXPIRED')
  }
}

/** 判断可信 handle 当前是否包含指定模块 feature 且仍在有效期内。 */
export function isJWordFeatureLicensed(
  license: JWordLicense | null | undefined,
  feature: JWordFeature
): boolean {
  if (license === null || license === undefined) {
    return false
  }

  const state = JWORD_LICENSE_STATES.get(license)

  return state !== undefined &&
    Date.parse(state.expiresAt) > Date.now() &&
    state.features.includes(feature)
}

/** 断言可信 handle 当前包含指定模块 feature 且仍在有效期内。 */
export function assertJWordFeatureLicensed(
  license: JWordLicense | null | undefined,
  feature: JWordFeature
): void {
  if (license === null || license === undefined) {
    throw createJWordLicenseError('JWORD_LICENSE_MISSING', feature)
  }

  const state = JWORD_LICENSE_STATES.get(license)
  if (state === undefined) {
    throw createJWordLicenseError('JWORD_LICENSE_HANDLE_INVALID', feature)
  }

  if (Date.parse(state.expiresAt) <= Date.now()) {
    throw createJWordLicenseError('JWORD_LICENSE_EXPIRED', feature)
  }

  if (!state.features.includes(feature)) {
    throw createJWordLicenseError('JWORD_FEATURE_NOT_ENTITLED', feature)
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
    throw createJWordLicenseError('JWORD_LICENSE_SIGNATURE_INVALID', feature)
  }

  if (!doesEntitlementMatchSignedPayload(entitlement, verification.payload)) {
    throw createJWordLicenseError('JWORD_LICENSE_SIGNATURE_INVALID', feature)
  }

  if (entitlement.status === 'server-unavailable') {
    throw createJWordLicenseError('JWORD_LICENSE_SIGNATURE_INVALID', feature)
  }

  if (!verification.payload.features.includes(feature)) {
    throw createJWordLicenseError('JWORD_FEATURE_NOT_ENTITLED', feature)
  }

  const now = readValidationTime(options.now)
  const expiresAt = readOptionalTime(verification.payload.expiresAt)
  const hasExpired = expiresAt !== undefined && expiresAt.getTime() <= now.getTime()

  if (hasExpired) {
    throw createJWordLicenseError('JWORD_LICENSE_EXPIRED', feature)
  }

  return {
    ok: true,
    feature,
    customerId: verification.payload.customerId,
    offlineGrace: false
  }
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
