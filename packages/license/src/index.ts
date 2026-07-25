/**
 * 职责：提供 JWL2 激活、opaque handle、feature 检查和旧 entitlement 兼容契约。
 * 边界：只转导出公开表面，不暴露 claims、trust store 或内部状态。
 * 协作模块：宿主、后续商业模块和现有 JWL1 调用方只依赖此入口。
 * 性能/安全约束：入口无副作用，不注册默认 key，不读取环境或用户文档内容。
 * 实现说明：LIC-106 移除正式 signer，JWL1 类型与显式 insecure fixture 兼容入口暂时保留。
 */

export {
  GATE5_FORMAT_FEATURES,
  GATE6_COLLAB_FEATURES,
  JWORD_FEATURES
} from './features.js'
export type {
  JWordFeature,
  JWordLicenseFeatureKey
} from './features.js'

export {
  JWORD_LICENSE_DIAGNOSTIC_CODE_METADATA,
  JWordLicenseError,
  createJWordLicenseError,
  isJWordLicenseDiagnosticCode
} from './errors.js'
export type {
  JWordLicenseDiagnosticCode,
  JWordLicenseDiagnosticCodeMetadata,
  JWordLicenseWarning,
  JWordLicenseWarningCode
} from './errors.js'

export {
  activateJWordLicense,
  assertJWordFeatureEntitled,
  assertJWordFeatureLicensed,
  createJWordLicenseTransfer,
  isJWordFeatureLicensed
} from './license.js'
export type {
  JWordLicense,
  JWordLicenseTransfer,
  JWordLicenseValidationOptions,
  JWordLicenseValidationResult
} from './license.js'

export type { JWordLicenseToken } from './jwl2.js'

export type {
  JWordLicenseEntitlement,
  JWordLicenseSignaturePayload,
  JWordLicenseStatus,
  JWordLicenseTokenPayload
} from './legacy-jwl1.js'
