/**
 * 职责：为 Gate 6 暴露受控协同 update 编解码入口。
 * 边界：不接 provider、WebSocket、IndexedDB、awareness UI 或版本历史存储。
 * 协作模块：collab provider、persistence update log 和 auto inserter 后续通过 Editor facade 消费这里。
 * 性能/安全约束：只处理 Yjs binary update，不暴露 Y.Doc/store/client clock/struct internals。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import * as Y from 'yjs'

import { JWordEditorPointerRuntime } from './pointer-runtime'
import { replaceStoreDocumentModel } from './document'
import { createDocumentProjection } from '../model/projection'
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

  /** 用隔离 Y.Doc 的投影替换当前文档，避免旧版本 update 与当前状态合并。 */
  replaceSyncUpdate(update: Uint8Array, options: EditorApplyUpdateOptions): TransactionResult {
    this.assertActive()

    const previewDoc = new Y.Doc()

    try {
      Y.applyUpdate(previewDoc, update)
      const previewProjection = createDocumentProjection(previewDoc)
      const previousSelection = this.currentSelection

      this.commitSelection(null, {
        source: 'document',
        render: false,
        emit: false
      })

      this.dirtyPageIndex = 0
      this.dirtyPageEndIndex = 0
      this.layoutDirtyRange = undefined
      const result = this.pipeline.runMutation('replaceSyncUpdate', options, () => {
        replaceStoreDocumentModel(this.store, previewProjection.document)
      })

      this.currentProjection = result.projection
      this.commitSelection(null, {
        source: 'document',
        previousSelection,
        render: true
      })

      return result
    } finally {
      previewDoc.destroy()
    }
  }
}
