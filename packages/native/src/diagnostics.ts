/**
 * 职责：集中创建 native package 的 warning、diagnostic 和稳定错误对象。
 * 边界：不读取 zip，不执行保存、打开、校验或迁移流程。
 * 协作模块：打包编解码、包读取、包校验和 schema 迁移模块共享这里的诊断构造规则。
 * 性能/安全约束：只构造普通对象，不访问 DOM、网络或磁盘。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#gate-45---jword-原生保存与打开。
 */

import { JWordNativePackageError } from './types.js'
import type {
  JWordPackageDiagnostic,
  JWordPackageDiagnosticCode,
  JWordPackageDiagnosticSeverity,
  JWordPackageErrorCode,
  JWordPackageWarning,
  JWordPackageWarningCode
} from './types.js'

/** 抛出首个不可恢复诊断。 */
export function throwFirstUnrecoverableDiagnostic(diagnostics: readonly JWordPackageDiagnostic[], requestId?: string): void {
  const diagnostic = diagnostics.find((item) => item.severity === 'error' && !item.recoverable)

  if (diagnostic === undefined) {
    return
  }

  throw createPackageError(
    diagnostic.code as JWordPackageErrorCode,
    diagnostic.message,
    requestId ?? diagnostic.requestId,
    diagnostic.entry
  )
}

/** 从错误读取诊断。 */
export function readErrorDiagnostic(
  error: unknown,
  fallbackCode: JWordPackageErrorCode,
  entry: string,
  requestId?: string
): JWordPackageDiagnostic {
  if (error instanceof JWordNativePackageError) {
    return createDiagnostic({
      code: error.code,
      severity: 'error',
      recoverable: error.recoverable,
      message: error.message,
      entry: error.entry ?? entry,
      requestId: error.requestId ?? requestId
    })
  }

  return createDiagnostic({
    code: fallbackCode,
    severity: 'error',
    recoverable: false,
    message: error instanceof Error ? error.message : String(error),
    entry,
    requestId
  })
}

/** 创建 warning。 */
export function createWarning(
  code: JWordPackageWarningCode,
  message: string,
  requestId?: string,
  entry?: string
): JWordPackageWarning {
  return {
    code,
    severity: 'warning',
    recoverable: true,
    message,
    ...(entry === undefined ? {} : { entry }),
    ...(requestId === undefined ? {} : { requestId })
  }
}

/** 创建 diagnostic。 */
export function createDiagnostic(input: {
  readonly code: JWordPackageDiagnosticCode
  readonly severity: JWordPackageDiagnosticSeverity
  readonly recoverable: boolean
  readonly message: string
  readonly entry?: string | undefined
  readonly requestId?: string | undefined
}): JWordPackageDiagnostic {
  return {
    code: input.code,
    severity: input.severity,
    recoverable: input.recoverable,
    message: input.message,
    ...(input.entry === undefined ? {} : { entry: input.entry }),
    ...(input.requestId === undefined ? {} : { requestId: input.requestId })
  }
}

/** 创建 package error。 */
export function createPackageError(
  code: JWordPackageErrorCode,
  message: string,
  requestId?: string,
  entry?: string
): JWordNativePackageError {
  return new JWordNativePackageError({
    code,
    message,
    recoverable: false,
    ...(entry === undefined ? {} : { entry }),
    ...(requestId === undefined ? {} : { requestId })
  })
}
