/**
 * 职责：根据 persistence 诊断注册表构造统一的运行时诊断载荷。
 * 边界：只服务 persistence 包内部，不注册 code，不读取文档内容或持久化状态。
 * 协作模块：memory 与 storage-backed adapter 复用相同的诊断字段语义。
 * 性能/安全约束：诊断只携带标识符，不包含文档正文、update 或 storage 数据。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import { PERSISTENCE_DIAGNOSTIC_CODE_METADATA } from './diagnostics.js'
import type { JWordPersistenceDiagnosticCode } from './diagnostics.js'
import type { JWordPersistenceDiagnostic } from './index.js'

/** 用诊断 metadata 生成统一的 persistence diagnostic。 */
export function createDiagnostic(
  code: JWordPersistenceDiagnosticCode,
  documentId?: string,
  versionId?: string,
  snapshotId?: string
): JWordPersistenceDiagnostic {
  const metadata = PERSISTENCE_DIAGNOSTIC_CODE_METADATA[code]

  return {
    code,
    severity: metadata.severity,
    message: metadata.description,
    recoverable: metadata.recoverable,
    ...('fallback' in metadata ? { fallback: metadata.fallback } : {}),
    ...(documentId === undefined ? {} : { documentId }),
    ...(versionId === undefined ? {} : { versionId }),
    ...(snapshotId === undefined ? {} : { snapshotId })
  }
}

/** 判断诊断是否允许调用方使用降级结果继续预览。 */
export function isRecoverableDiagnostic(diagnostic: JWordPersistenceDiagnostic): boolean {
  return diagnostic.recoverable
}
