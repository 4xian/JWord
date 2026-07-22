/**
 * 职责：集中定义 License 稳定诊断、错误类型与无敏感信息的错误工厂。
 * 边界：只归一诊断结构，不解析 token、不记录 claims 或签名材料。
 * 协作模块：license.ts、DOCX、PDF 和 Collaboration 复用公开诊断契约。
 * 性能/安全约束：错误仅包含 code 与 feature，不附带客户标识、token 或原始异常。
 * 实现说明：LIC-109B1 删除旧在线状态诊断和自然语言 warning message。
 */

import type {
  JWordFeature,
  JWordLicenseFeatureKey
} from './features.js'

type JWordLicenseErrorFeature = JWordLicenseFeatureKey | JWordFeature

/** 授权模块对外返回的稳定诊断码。 */
export type JWordLicenseDiagnosticCode =
  | 'JWORD_LICENSE_MISSING'
  | 'JWORD_LICENSE_HANDLE_INVALID'
  | 'JWORD_LICENSE_NOT_YET_VALID'
  | 'JWORD_LICENSE_EXPIRED'
  | 'JWORD_LICENSE_TOKEN_INVALID'
  | 'JWORD_LICENSE_ISSUER_INVALID'
  | 'JWORD_LICENSE_KEY_UNKNOWN'
  | 'JWORD_FEATURE_NOT_ENTITLED'
  | 'JWORD_LICENSE_SIGNATURE_INVALID'

export type JWordLicenseWarningCode = 'JWORD_LICENSE_INSECURE_FIXTURE_ACCEPTED'

export interface JWordLicenseDiagnosticCodeMetadata {
  readonly severity: 'error'
  readonly recoverable: boolean
}

export interface JWordLicenseWarning {
  readonly code: JWordLicenseWarningCode
}

export const JWORD_LICENSE_DIAGNOSTIC_CODE_METADATA = {
  JWORD_LICENSE_MISSING: {
    severity: 'error',
    recoverable: true
  },
  JWORD_LICENSE_HANDLE_INVALID: {
    severity: 'error',
    recoverable: true
  },
  JWORD_LICENSE_NOT_YET_VALID: {
    severity: 'error',
    recoverable: true
  },
  JWORD_LICENSE_EXPIRED: {
    severity: 'error',
    recoverable: true
  },
  JWORD_LICENSE_TOKEN_INVALID: {
    severity: 'error',
    recoverable: true
  },
  JWORD_LICENSE_ISSUER_INVALID: {
    severity: 'error',
    recoverable: true
  },
  JWORD_LICENSE_KEY_UNKNOWN: {
    severity: 'error',
    recoverable: true
  },
  JWORD_FEATURE_NOT_ENTITLED: {
    severity: 'error',
    recoverable: true
  },
  JWORD_LICENSE_SIGNATURE_INVALID: {
    severity: 'error',
    recoverable: true
  }
} as const satisfies Record<JWordLicenseDiagnosticCode, JWordLicenseDiagnosticCodeMetadata>

export class JWordLicenseError extends Error {
  override readonly name = 'JWordLicenseError'
  readonly code: JWordLicenseDiagnosticCode
  readonly feature?: JWordLicenseErrorFeature

  /** 创建不携带用户文档内容的授权诊断错误。 */
  constructor(
    code: JWordLicenseDiagnosticCode,
    feature?: JWordLicenseErrorFeature
  ) {
    super(readJWordLicenseMessage(code, feature))
    this.code = code
    if (feature !== undefined) {
      this.feature = feature
    }
  }
}

/** 创建授权错误，供 worker 和示例复用同一诊断结构。 */
export function createJWordLicenseError(
  code: JWordLicenseDiagnosticCode,
  feature?: JWordLicenseErrorFeature
): JWordLicenseError {
  return new JWordLicenseError(code, feature)
}

/** 判断字符串是否是公开授权诊断 code。 */
export function isJWordLicenseDiagnosticCode(code: string): code is JWordLicenseDiagnosticCode {
  return code in JWORD_LICENSE_DIAGNOSTIC_CODE_METADATA
}

/** 读取授权错误的人类可读消息。 */
function readJWordLicenseMessage(
  code: JWordLicenseDiagnosticCode,
  feature: JWordLicenseErrorFeature | undefined
): string {
  return feature === undefined ? code : `${code}: ${feature}`
}
