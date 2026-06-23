/**
 * 职责：锁定 Hocuspocus 服务历史只保存核心文档状态，不递归保存历史附属容器。
 * 边界：只验证 demo runtime 的 provider history 快照契约，不启动 WebSocket、IndexedDB 或浏览器页面。
 * 协作：examples/collab/src/runtime/hocuspocus-history.ts、@4xian/jword-core 和 Yjs state update。
 * 约束：历史版本更新必须可在隔离 Y.Doc 中预览，且不得包含服务历史共享类型。
 * 规格：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md Gate 6 Step 6.13。
 */
import { createEditor } from '@4xian/jword-core'
import type { JWordPersistenceSnapshotAdapter } from '@4xian/jword-persistence'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'

import {
  appendHocuspocusHistoryVersion,
  createHocuspocusHistoryPersistenceAdapter
} from '../src/runtime/hocuspocus-history'
import { readBodyTextFromUpdate } from '../src/runtime/hocuspocus-projection'

const historyVersionOrderName = 'jword:collab:history:version-order'
const historyVersionUpdatesName = 'jword:collab:history:version-updates'
const historySharedTypePrefix = 'jword:collab:history:'

describe('Hocuspocus provider history snapshots', () => {
  it('连续追加版本时保存的 update 不包含 history shared type', () => {
    const editor = createEditor({ initialText: 'Gate 6 history text' })
    const document = new Y.Doc()

    Y.applyUpdate(document, editor.encodeSyncUpdate())
    appendHistory(document, 'first')
    appendHistory(document, 'second')

    const storedUpdates = readStoredHistoryUpdates(document)

    expect(storedUpdates).toHaveLength(2)
    for (const update of storedUpdates) {
      expect(readSharedTypeNamesFromUpdate(update).filter((name) =>
        name.startsWith(historySharedTypePrefix)
      )).toEqual([])
    }
    expect(storedUpdates[1]?.byteLength).toBeLessThan((storedUpdates[0]?.byteLength ?? 0) * 2)

    editor.destroy()
    document.destroy()
  })

  it('通过 persistence adapter contract 共享 provider history、snapshot、preview 和 restore', async () => {
    const document = createProviderDocument('provider history v1')
    const writer = createHocuspocusHistoryPersistenceAdapter({
      document,
      documentId: 'history-document',
      roomId: 'history-room',
      clientId: 'client-a',
      authorId: 'author-a'
    })
    const reader = createHocuspocusHistoryPersistenceAdapter({
      document,
      documentId: 'history-document',
      roomId: 'history-room',
      clientId: 'client-b',
      authorId: 'author-b'
    })

    expectTypeContract(writer)

    const appended = await writer.appendUpdate({
      documentId: 'history-document',
      roomId: 'history-room',
      clientId: 'client-a',
      authorId: 'author-a',
      origin: 'local-user',
      label: 'provider-v1',
      update: Y.encodeStateAsUpdate(document),
      createdAt: '2026-05-26T03:00:00.000Z'
    })
    const snapshot = await writer.createSnapshot({
      documentId: 'history-document',
      versionId: appended.version.versionId,
      snapshotId: 'snapshot-provider-v1',
      label: 'snapshot-provider-v1',
      createdAt: '2026-05-26T03:00:01.000Z'
    })
    const versions = await reader.listVersions('history-document')
    const preview = await reader.createPreview({
      documentId: 'history-document',
      versionId: appended.version.versionId
    })
    const restored = await reader.restoreVersion({
      documentId: 'history-document',
      versionId: appended.version.versionId,
      targetDoc: document,
      origin: 'version-restore'
    })

    expect(versions).toHaveLength(1)
    expect(versions[0]).toMatchObject({
      versionId: appended.version.versionId,
      roomId: 'history-room',
      clientId: 'client-a',
      authorId: 'author-a',
      origin: 'local-user',
      snapshotId: 'snapshot-provider-v1'
    })
    expect(snapshot.snapshot).toMatchObject({
      snapshotId: 'snapshot-provider-v1',
      versionId: appended.version.versionId,
      roomId: 'history-room',
      clientId: 'client-a',
      authorId: 'author-a'
    })
    expect(readBodyTextFromUpdate(preview.update)).toBe('provider history v1')
    expect(restored.diagnostics).toEqual([])
    expect(readBodyTextFromUpdate(Y.encodeStateAsUpdate(document))).toBe('provider history v1')
    expect(restored.version).toMatchObject({
      restoreSourceVersionId: appended.version.versionId,
      label: 'restore:provider-v1',
      origin: 'version-restore'
    })
  })

  it('provider history update 缺失时 restore 不改当前文档并返回诊断', async () => {
    const document = createProviderDocument('provider history v1')
    const adapter = createHocuspocusHistoryPersistenceAdapter({
      document,
      documentId: 'history-missing-update',
      roomId: 'history-room',
      clientId: 'client-a',
      authorId: 'author-a'
    })
    const target = createProviderDocument('current text')
    const appended = await adapter.appendUpdate({
      documentId: 'history-missing-update',
      update: Y.encodeStateAsUpdate(document),
      label: 'provider-v1'
    })

    document.getMap(historyVersionUpdatesName).delete(appended.version.versionId)
    const restored = await adapter.restoreVersion({
      documentId: 'history-missing-update',
      versionId: appended.version.versionId,
      targetDoc: target,
      origin: 'version-restore'
    })

    expect(readBodyTextFromUpdate(Y.encodeStateAsUpdate(target))).toBe('current text')
    expect(restored.version).toBeUndefined()
    expect(restored.diagnostics).toEqual([
      expect.objectContaining({
        code: 'PERSISTENCE_RESTORE_FAILED',
        recoverable: false,
        versionId: appended.version.versionId
      })
    ])
  })
})

/** 创建带 core 文档容器的 provider Y.Doc。 */
function createProviderDocument(text: string): Y.Doc {
  const editor = createEditor({ initialText: text })
  const document = new Y.Doc()

  Y.applyUpdate(document, editor.encodeSyncUpdate())
  editor.destroy()

  return document
}

/** 在测试中锁定 provider history adapter 满足 persistence 公开契约。 */
function expectTypeContract(adapter: JWordPersistenceSnapshotAdapter): void {
  expect(typeof adapter.appendUpdate).toBe('function')
  expect(typeof adapter.createSnapshot).toBe('function')
  expect(typeof adapter.listVersions).toBe('function')
  expect(typeof adapter.loadVersion).toBe('function')
  expect(typeof adapter.createPreview).toBe('function')
  expect(typeof adapter.restoreVersion).toBe('function')
  expect(typeof adapter.compact).toBe('function')
}

/** 追加一条测试用 provider history 版本。 */
function appendHistory(document: Y.Doc, label: string): void {
  appendHocuspocusHistoryVersion({
    document,
    label,
    origin: 'local-user',
    roomId: 'history-room',
    documentId: 'history-document',
    clientId: 'client-a',
    authorId: 'client-a'
  })
}

/** 读取 history shared map 中真实保存的版本 update。 */
function readStoredHistoryUpdates(document: Y.Doc): readonly Uint8Array[] {
  const order = document.getArray<string>(historyVersionOrderName).toArray()
  const updates = document.getMap<unknown>(historyVersionUpdatesName)

  return order.map((id) => updates.get(id)).filter(isUint8Array).map((update) => new Uint8Array(update))
}

/** 读取 state update 在隔离 Y.Doc 中物化出的 shared type 名称。 */
function readSharedTypeNamesFromUpdate(update: Uint8Array): readonly string[] {
  const preview = new Y.Doc()

  try {
    Y.applyUpdate(preview, update)

    return Array.from(preview.share.keys())
  } finally {
    preview.destroy()
  }
}

/** 判断 history shared map value 是否是二进制 update。 */
function isUint8Array(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array
}
