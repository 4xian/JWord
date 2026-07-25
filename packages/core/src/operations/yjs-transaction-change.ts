/**
 * 职责：判断单次 Yjs transaction 是否产生可编码的 struct 或 delete set 变化。
 * 边界：只读取 Y.Transaction 的公开状态，不访问 Y.Doc private store，不编码完整文档。
 * 协作模块：transaction pipeline 和 history manager 复用同一 dirty 判定。
 * 性能/安全约束：判定只读取 delete set 和 transaction state vector，不复制正文或持有可写 Yjs 容器。
 * 实现说明：与 Yjs writeUpdateMessageFromTransaction 的公开变化条件保持一致。
 */

import type * as Y from 'yjs'

/** 判断 transaction 是否新增 struct 或 delete set。 */
export function hasYjsTransactionChanged(transaction: Y.Transaction): boolean {
  if (transaction.deleteSet.clients.size > 0) {
    return true
  }

  for (const [clientId, afterClock] of transaction.afterState) {
    if ((transaction.beforeState.get(clientId) ?? 0) !== afterClock) {
      return true
    }
  }

  return false
}
