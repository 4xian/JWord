/**
 * 职责：归一化 Hocuspocus runtime 里外部 Y.Doc 事务的 origin 与诊断来源。
 * 边界：只判断 transaction origin，不接 Editor、provider、DOM 或持久化。
 * 协作：hocuspocus-runtime.ts 在外部 provider/offline/version 事务后刷新内部 Editor 投影。
 * 约束：只识别 demo 所需 origin，不暴露 Yjs store 或 client clock。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md Gate 6 Step 6.10。
 */
import type * as Y from 'yjs'

export type HocuspocusTransactionSource =
  | 'local'
  | 'remote'
  | 'system-recovery'
  | 'version-restore'
  | 'auto-inserter'

/** 判断事务是否由当前内部 Editor 已经处理过。 */
export function isEditorManagedTransactionOrigin(origin: unknown): boolean {
  return origin === 'local-user' ||
    origin === 'auto-inserter' ||
    origin === Symbol.for('jword.history.auto-inserter') ||
    origin === Symbol.for('jword.history.version-restore')
}

/** 读取外部 Y.Doc 事务在 demo 诊断里的稳定 origin。 */
export function readExternalTransactionOrigin(transaction: Y.Transaction): string {
  if (typeof transaction.origin === 'string' && transaction.origin.length > 0) {
    return transaction.origin
  }

  return transaction.local ? 'system-recovery' : 'remote-user'
}

/** 读取外部 Y.Doc 事务在 demo 诊断里的稳定 source。 */
export function readExternalTransactionSource(
  transaction: Y.Transaction,
  origin: string
): HocuspocusTransactionSource {
  if (!transaction.local) {
    return 'remote'
  }

  if (origin === 'version-restore') {
    return 'version-restore'
  }

  if (origin === 'auto-inserter') {
    return 'auto-inserter'
  }

  return 'system-recovery'
}
