/**
 * 职责：把 Hocuspocus provider runtime 接到 persistence snapshot adapter 契约。
 * 边界：只处理版本记录、只读预览、恢复和 persistence 诊断转发，不连接 DOM、provider 或 IndexedDB。
 * 协作：hocuspocus-runtime.ts 提供当前 Y.Doc、离线保存回调和页面刷新回调。
 * 约束：历史保存必须基于 update log / snapshot，恢复失败不得修改当前可写文档。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md Gate 6 Step 6.13。
 */
import type { JWordPersistenceDiagnostic } from '@4xian/jword-persistence'
import * as Y from 'yjs'

import { readBodyTextFromUpdate } from './hocuspocus-projection'
import { createHocuspocusHistoryPersistenceAdapter } from './hocuspocus-history'
import type {
  CollabStateSnapshot,
  VersionPreviewSnapshot
} from '../runtime'

export interface HocuspocusHistoryRuntimeBridge {
  readonly recordVersion: (label: string, origin: string) => void
  readonly previewVersion: (versionId: string) => VersionPreviewSnapshot | null | Promise<VersionPreviewSnapshot | null>
  readonly restoreVersion: (versionId: string) => Promise<CollabStateSnapshot>
}

export interface CreateHocuspocusHistoryRuntimeBridgeInput {
  readonly document: Y.Doc
  readonly documentId: string
  readonly roomId: string
  readonly clientId: string
  readonly authorId: string
  readonly readLiveText: () => string
  readonly readCollabState: () => CollabStateSnapshot
  readonly storeCurrentUpdate: () => void
  readonly recordDiagnostics: (diagnostics: readonly JWordPersistenceDiagnostic[]) => void
  readonly notify: () => void
}

/** 创建 runtime 可复用的 provider history bridge。 */
export function createHocuspocusHistoryRuntimeBridge(
  input: CreateHocuspocusHistoryRuntimeBridgeInput
): HocuspocusHistoryRuntimeBridge {
  const adapter = createHocuspocusHistoryPersistenceAdapter({
    document: input.document,
    documentId: input.documentId,
    roomId: input.roomId,
    clientId: input.clientId,
    authorId: input.authorId
  })

  /** 将当前 provider 文档记录为共享历史版本，并创建对应 snapshot。 */
  function recordVersion(label: string, origin: string): void {
    void adapter.appendUpdate({
      documentId: input.documentId,
      roomId: input.roomId,
      clientId: input.clientId,
      authorId: input.authorId,
      label,
      origin,
      update: Y.encodeStateAsUpdate(input.document)
    }).then(async (result) => {
      input.recordDiagnostics(result.diagnostics)
      const snapshot = await adapter.createSnapshot({
        documentId: input.documentId,
        versionId: result.version.versionId
      })

      input.recordDiagnostics(snapshot.diagnostics)
      input.notify()
    }).catch(() => {
      input.recordDiagnostics([{
        code: 'PERSISTENCE_RESTORE_FAILED',
        severity: 'error',
        recoverable: false,
        message: 'Provider history append failed; current document was not changed.'
      }])
      input.notify()
    })
  }

  /** 基于隔离 Y.Doc 创建指定历史版本的只读预览。 */
  function previewVersion(versionId: string): VersionPreviewSnapshot | null | Promise<VersionPreviewSnapshot | null> {
    if (versionId === 'provider-live') {
      return {
        id: 'provider-live',
        label: 'Hocuspocus live document',
        text: input.readLiveText()
      }
    }

    return adapter.createPreview({
      documentId: input.documentId,
      versionId
    }).then((preview) => {
      input.recordDiagnostics(preview.diagnostics)
      input.notify()
      if (
        preview.version === undefined ||
        preview.update.byteLength === 0 ||
        preview.diagnostics.some((diagnostic) => !diagnostic.recoverable)
      ) {
        return null
      }

      return {
        id: preview.version.versionId,
        label: preview.version.label ?? preview.version.versionId,
        text: readBodyTextFromUpdate(preview.update)
      }
    })
  }

  /** 恢复指定历史版本并保存恢复后的离线状态。 */
  async function restoreVersion(versionId: string): Promise<CollabStateSnapshot> {
    if (versionId === 'provider-live') {
      return input.readCollabState()
    }

    const restored = await adapter.restoreVersion({
      documentId: input.documentId,
      versionId,
      targetDoc: input.document,
      origin: 'version-restore'
    })

    input.recordDiagnostics(restored.diagnostics)
    if (restored.version !== undefined) {
      input.storeCurrentUpdate()
    }
    input.notify()

    return input.readCollabState()
  }

  return {
    recordVersion,
    previewVersion,
    restoreVersion
  }
}
