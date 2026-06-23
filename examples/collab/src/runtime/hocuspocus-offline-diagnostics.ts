/**
 * 职责：把 persistence 包诊断映射为 collab demo 对外的 offline 诊断。
 * 边界：只处理诊断 code/severity/recoverable/message 的稳定转换，不读取 provider、IndexedDB 或 Y.Doc。
 * 协作：hocuspocus-runtime.ts 在 readOfflineState 中复用这里的映射。
 * 约束：保持 demo 对外诊断命名稳定，不把 persistence 内部 code 泄漏成 UI 契约。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md Gate 6 Step 6.12。
 */
import type { OfflineDiagnosticSnapshot } from '../runtime'

/** 将 persistence 包诊断映射为 demo 对外的 offline 诊断。 */
export function mapPersistenceDiagnostic(diagnostic: {
  readonly code: string
  readonly severity: OfflineDiagnosticSnapshot['severity']
  readonly recoverable: boolean
  readonly message: string
}): OfflineDiagnosticSnapshot {
  if (diagnostic.code === 'PERSISTENCE_INDEXEDDB_UNAVAILABLE') {
    return {
      code: 'OFFLINE_CACHE_UNAVAILABLE',
      severity: diagnostic.severity,
      recoverable: diagnostic.recoverable,
      message: diagnostic.message
    }
  }

  return {
    code: diagnostic.code,
    severity: diagnostic.severity,
    recoverable: diagnostic.recoverable,
    message: diagnostic.message
  }
}
