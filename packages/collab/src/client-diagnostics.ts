/**
 * 职责：为 Gate 6 协作 client SDK 创建稳定诊断对象。
 * 边界：只做错误码和诊断结构转换，不连接 provider、不读取文档内容。
 * 协作模块：client-sdk.ts、license 包和 diagnostics registry 复用这里的 code 形态。
 * 性能/安全约束：授权错误只转成结构化 diagnostic，不泄露 token 或文档内容。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import {
  JWORD_LICENSE_DIAGNOSTIC_CODE_METADATA,
  isJWordLicenseDiagnosticCode
} from '@4xian/jword-license'

import type {
  JWordCollabDiagnostic,
  JWordCollabDiagnosticSeverity
} from './index.js'

/** 把授权错误转换为协作诊断。 */
export function createLicenseDiagnostic(error: unknown, clientId: string): JWordCollabDiagnostic {
  const licenseCode = readLicenseDiagnosticCode(error)
  const metadata = JWORD_LICENSE_DIAGNOSTIC_CODE_METADATA[licenseCode]

  return createCollabDiagnostic(
    licenseCode.replace('JWORD_', 'COLLAB_'),
    metadata.severity,
    metadata.description,
    metadata.recoverable,
    clientId
  )
}

/** 创建协作诊断对象。 */
export function createCollabDiagnostic(
  code: string,
  severity: JWordCollabDiagnosticSeverity,
  message: string,
  recoverable: boolean,
  clientId?: string
): JWordCollabDiagnostic {
  return clientId === undefined
    ? {
      code,
      severity,
      message,
      recoverable
    }
    : {
      code,
      severity,
      message,
      recoverable,
      clientId
    }
}

/** 读取未知错误消息。 */
export function readErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return 'Collaboration provider is unavailable; connection was not started.'
}

/** 读取授权错误码，未知错误按缺少授权处理。 */
function readLicenseDiagnosticCode(error: unknown) {
  if (
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string' &&
    isJWordLicenseDiagnosticCode(error.code)
  ) {
    return error.code
  }

  return 'JWORD_LICENSE_MISSING'
}
