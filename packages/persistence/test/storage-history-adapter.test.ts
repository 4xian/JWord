/**
 * @vitest-environment node
 *
 * 职责：验证 Gate 6 persistence 的 storage-backed history adapter 可跨 adapter 生命周期保存 update log 和 snapshot。
 * 边界：只使用 Yjs binary update 与持久化 storage 契约，不访问 core、IndexedDB 或 projection JSON。
 * 协作模块：packages/persistence/src/storage-history-adapter.ts 和内存 adapter 共享同一 snapshot adapter contract。
 * 约束：测试先行证明重建 adapter 后仍可 list/preview/restore，避免把 demo runtime 内存状态误当生产持久化。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import * as Y from 'yjs'
import { describe, expect, it } from 'vitest'

import {
  createStoragePersistenceAdapter,
  createVolatileHistoryStorage
} from '../src/index'

describe('@4xian/jword-persistence storage history adapter', () => {
  it('跨 adapter 重建后仍保留 update log、snapshot、preview 和 restore', async () => {
    const storage = createVolatileHistoryStorage()
    const writer = createStoragePersistenceAdapter({ storage })
    const source = new Y.Doc()

    source.getText('body').insert(0, 'persistent-v1')
    const appended = await writer.appendUpdate({
      documentId: 'doc-persistent-history',
      roomId: 'room-persistent-history',
      clientId: 'client-a',
      authorId: 'author-a',
      origin: 'local-user',
      label: 'persistent-v1',
      update: Y.encodeStateAsUpdate(source),
      createdAt: '2026-05-26T06:00:00.000Z'
    })
    const snapshot = await writer.createSnapshot({
      documentId: 'doc-persistent-history',
      versionId: appended.version.versionId,
      snapshotId: 'snapshot-persistent-v1',
      createdAt: '2026-05-26T06:00:01.000Z'
    })
    const reader = createStoragePersistenceAdapter({ storage })
    const versions = await reader.listVersions('doc-persistent-history')
    const preview = await reader.createPreview({
      documentId: 'doc-persistent-history',
      versionId: appended.version.versionId
    })
    const target = new Y.Doc()

    target.getText('body').insert(0, 'current')
    const restored = await reader.restoreVersion({
      documentId: 'doc-persistent-history',
      versionId: appended.version.versionId,
      targetDoc: target,
      origin: 'version-restore'
    })
    const auditor = createStoragePersistenceAdapter({ storage })
    const auditedVersions = await auditor.listVersions('doc-persistent-history')

    expect(snapshot.version).toMatchObject({
      snapshotId: 'snapshot-persistent-v1',
      roomId: 'room-persistent-history',
      clientId: 'client-a',
      authorId: 'author-a'
    })
    expect(versions).toHaveLength(1)
    expect(versions[0]).toMatchObject({
      versionId: appended.version.versionId,
      label: 'persistent-v1',
      snapshotId: 'snapshot-persistent-v1'
    })
    expect(preview.doc.getText('body').toString()).toBe('persistent-v1')
    expect(target.getText('body').toString()).toBe('persistent-v1')
    expect(restored.version).toMatchObject({
      restoreSourceVersionId: appended.version.versionId,
      label: 'restore:persistent-v1'
    })
    expect(auditedVersions.map((version) => version.label)).toEqual([
      'persistent-v1',
      'restore:persistent-v1'
    ])
  })
})
