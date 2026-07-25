/**
 * 职责：集中维护 Gate 6 persistence 包的公开诊断 code schema。
 * 边界：只定义离线、版本历史和快照诊断元数据，不访问 IndexedDB、Y.Doc 或 provider。
 * 协作模块：index.ts、后续 IndexedDB adapter、collab provider 和 diagnostics registry 复用这些 code。
 * 性能/安全约束：纯类型与常量，无副作用，避免把浏览器运行时依赖拉入包入口。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

export type JWordPersistenceDiagnosticSeverity = 'info' | 'warning' | 'error'

export interface JWordPersistenceDiagnosticCodeMetadata {
  readonly severity: JWordPersistenceDiagnosticSeverity
  readonly description: string
  readonly recoverable: boolean
  readonly fallback?: string
}

export const PERSISTENCE_DIAGNOSTIC_CODE_METADATA = {
  PERSISTENCE_INDEXEDDB_UNAVAILABLE: {
    severity: 'warning',
    description: '当前运行环境不可用 IndexedDB，离线缓存降级为不可用。',
    recoverable: true,
    fallback: 'continue-online-without-offline-cache'
  },
  PERSISTENCE_VERSION_NOT_FOUND: {
    severity: 'warning',
    description: '请求的历史版本不存在或已被清理。',
    recoverable: true,
    fallback: 'keep-current-document'
  },
  PERSISTENCE_SNAPSHOT_NOT_FOUND: {
    severity: 'warning',
    description: '请求的快照不存在或快照索引损坏。',
    recoverable: true,
    fallback: 'rebuild-from-update-log'
  },
  PERSISTENCE_VERSION_COMPACTED: {
    severity: 'error',
    description: '请求的历史版本早于 compaction 边界，不能再恢复。',
    recoverable: false
  },
  PERSISTENCE_RESTORE_FAILED: {
    severity: 'error',
    description: '版本恢复在隔离文档构建阶段失败，当前文档未写入。',
    recoverable: false
  },
  PERSISTENCE_RESTORE_RECOVERY_REQUIRED: {
    severity: 'error',
    description: '版本恢复已留下待恢复操作，需要重试以完成或修复恢复。',
    recoverable: true,
    fallback: 'retry-restore-recovery'
  }
} as const satisfies Record<string, JWordPersistenceDiagnosticCodeMetadata>

export type JWordPersistenceDiagnosticCode = keyof typeof PERSISTENCE_DIAGNOSTIC_CODE_METADATA
