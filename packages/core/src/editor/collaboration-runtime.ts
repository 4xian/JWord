/**
 * 职责：为 Gate 6 暴露受控协同 update 编解码入口。
 * 边界：不接 provider、WebSocket、IndexedDB、awareness UI 或版本历史存储。
 * 协作模块：collab provider、persistence update log 和 auto inserter 后续通过 Editor facade 消费这里。
 * 性能/安全约束：只处理 Yjs binary update，不暴露 Y.Doc/store/client clock/struct internals。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#iteration-1---core-协同-hookorigin-和-history-scope。
 */

import * as Y from 'yjs'

import { JWordEditorPointerRuntime } from './pointer-runtime'
import type { EditorSyncUpdateInput, EditorApplyUpdateOptions } from './types'
import type { TransactionResult } from '../operations/transaction'

export abstract class JWordEditorCollaborationRuntime extends JWordEditorPointerRuntime {
  /** 编码当前 Y.Doc 的 binary update。 */
  encodeSyncUpdate(input: EditorSyncUpdateInput = {}): Uint8Array {
    this.assertActive()

    return Y.encodeStateAsUpdate(this.pipeline.doc, input.stateVector)
  }

  /** 通过统一 transaction pipeline 应用远端或恢复 update。 */
  applySyncUpdate(update: Uint8Array, options: EditorApplyUpdateOptions): TransactionResult {
    this.assertActive()

    return this.pipeline.applyUpdate(update, options)
  }
}
