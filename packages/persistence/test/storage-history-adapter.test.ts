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
import { describe, expect, expectTypeOf, it } from 'vitest'

import {
  createStoragePersistenceAdapter,
  createVolatileHistoryStorage
} from '../src/index'
import {
  createNestedFormattedRun,
  readNestedFormattedRun
} from './yjs-document-test-fixtures'
import type {
  JWordHistoryStorage,
  JWordHistoryStorageCompareAndSwapResult,
  JWordHistoryStorageDocument
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

  /** 验证 storage-backed 公开恢复入口保留 delta attributes 与 canonical run properties。 */
  it('preserves Y.Text attributes without regressing canonical run properties', async () => {
    const storage = createVolatileHistoryStorage()
    const adapter = createStoragePersistenceAdapter({ storage })
    const source = new Y.Doc()
    const original = createNestedFormattedRun(source)
    const topLevelText = source.getText('body')

    original.text.applyDelta([{
      insert: 'v1',
      attributes: {
        bold: true,
        color: '#123456'
      }
    }])
    topLevelText.applyDelta([{
      insert: 'top-v1',
      attributes: {
        italic: true
      }
    }])
    original.properties.set('bold', true)
    const first = await adapter.appendUpdate({
      documentId: 'doc-storage-formatted-restore',
      update: Y.encodeStateAsUpdate(source),
      label: 'formatted-v1'
    })
    original.text.delete(0, original.text.length)
    original.text.insert(0, 'v2')
    topLevelText.delete(0, topLevelText.length)
    topLevelText.insert(0, 'top-v2')
    original.properties.set('bold', false)
    await adapter.appendUpdate({
      documentId: 'doc-storage-formatted-restore',
      update: Y.encodeStateAsUpdate(source),
      label: 'formatted-v2'
    })

    const preview = await adapter.createPreview({
      documentId: 'doc-storage-formatted-restore',
      versionId: first.version.versionId
    })
    const previewRun = readNestedFormattedRun(preview.doc)
    const target = new Y.Doc()

    target.getArray<Y.Map<unknown>>('sections')
    const restored = await adapter.restoreVersion({
      documentId: 'doc-storage-formatted-restore',
      versionId: first.version.versionId,
      targetDoc: target
    })
    expect(restored.diagnostics).toEqual([])
    const formattedRun = readNestedFormattedRun(target)

    expect(previewRun.text.toDelta()).toEqual([{
      insert: 'v1',
      attributes: {
        bold: true,
        color: '#123456'
      }
    }])
    expect(preview.doc.getText('body').toDelta()).toEqual([{
      insert: 'top-v1',
      attributes: {
        italic: true
      }
    }])
    expect(formattedRun.text.toDelta()).toEqual([{
      insert: 'v1',
      attributes: {
        bold: true,
        color: '#123456'
      }
    }])
    expect(target.getText('body').toDelta()).toEqual([{
      insert: 'top-v1',
      attributes: {
        italic: true
      }
    }])
    expect(formattedRun.properties.get('bold')).toBe(true)
  })

  /** 验证 legacy storage 保持类型兼容，但缺少 CAS 时 restore fail closed。 */
  it('keeps legacy storage type-compatible but fails restore closed without CAS', async () => {
    const documents = new Map<string, JWordHistoryStorageDocument>()
    const legacyStorage = {
      /** 读取 legacy storage 中的完整历史文档。 */
      async loadDocument(documentId: string): Promise<JWordHistoryStorageDocument | null> {
        return documents.get(documentId) ?? null
      },
      /** 保存 legacy storage 中的完整历史文档。 */
      async saveDocument(documentId: string, document: JWordHistoryStorageDocument): Promise<void> {
        documents.set(documentId, document)
      }
    }
    const adapter = createStoragePersistenceAdapter({ storage: legacyStorage })
    const source = new Y.Doc()

    expectTypeOf(legacyStorage).toMatchTypeOf<JWordHistoryStorage>()
    expectTypeOf<JWordHistoryStorageCompareAndSwapResult>().toEqualTypeOf<{ readonly committed: boolean }>()
    source.getText('body').insert(0, 'saved')
    const first = await adapter.appendUpdate({
      documentId: 'doc-legacy-storage',
      update: Y.encodeStateAsUpdate(source),
      label: 'saved'
    })
    const target = new Y.Doc()

    target.getText('body').insert(0, 'current')
    const restored = await adapter.restoreVersion({
      documentId: 'doc-legacy-storage',
      versionId: first.version.versionId,
      targetDoc: target
    })

    expect(restored.version).toBeUndefined()
    expect(restored.diagnostics).toEqual([
      expect.objectContaining({ code: 'PERSISTENCE_RESTORE_FAILED' })
    ])
    expect(target.getText('body').toString()).toBe('current')
    expect(documents.get('doc-legacy-storage')?.versions).toHaveLength(1)
  })

  /** 验证 restore CAS 抛错时 target 与 storage history 保持不变。 */
  it('keeps target and stored history unchanged when restore CAS throws', async () => {
    const baseStorage = createVolatileHistoryStorage()
    let failCompareAndSwap = false
    const storage: JWordHistoryStorage = {
      loadDocument: baseStorage.loadDocument.bind(baseStorage),
      saveDocument: baseStorage.saveDocument.bind(baseStorage),
      /** 转发 CAS，并在故障注入开启时模拟 backend 写失败。 */
      async compareAndSwapDocument(documentId, expectedRevision, document) {
        if (failCompareAndSwap) {
          throw new Error('storage CAS failed')
        }

        const compareAndSwap = baseStorage.compareAndSwapDocument
        if (compareAndSwap === undefined) {
          throw new Error('volatile storage 应实现 CAS')
        }
        return compareAndSwap.call(baseStorage, documentId, expectedRevision, document)
      }
    }
    const adapter = createStoragePersistenceAdapter({ storage })
    const source = new Y.Doc()
    const text = source.getText('body')

    text.insert(0, 'v1')
    const first = await adapter.appendUpdate({
      documentId: 'doc-storage-cas-failure',
      update: Y.encodeStateAsUpdate(source),
      label: 'v1'
    })
    text.insert(text.length, '-v2')
    await adapter.appendUpdate({
      documentId: 'doc-storage-cas-failure',
      update: Y.encodeStateAsUpdate(source),
      label: 'v2'
    })
    const before = await baseStorage.loadDocument('doc-storage-cas-failure')
    const target = new Y.Doc()

    target.getText('body').insert(0, 'current')
    failCompareAndSwap = true
    const restored = await adapter.restoreVersion({
      documentId: 'doc-storage-cas-failure',
      versionId: first.version.versionId,
      targetDoc: target
    })
    const after = await baseStorage.loadDocument('doc-storage-cas-failure')

    expect(restored.version).toBeUndefined()
    expect(restored.diagnostics).toEqual([
      expect.objectContaining({ code: 'PERSISTENCE_RESTORE_FAILED' })
    ])
    expect(target.getText('body').toString()).toBe('current')
    expect(after).toEqual(before)
  })

  /** 验证 reload 到的 pending 不属于本次 restore 时，target 与完成历史均保持不变。 */
  it('rejects a mismatched pending operation before applying the restore target', async () => {
    const baseStorage = createVolatileHistoryStorage()
    const storage: JWordHistoryStorage = {
      loadDocument: baseStorage.loadDocument.bind(baseStorage),
      saveDocument: baseStorage.saveDocument.bind(baseStorage),
      /** 模拟 pending CAS 后 reload 到另一个 operation。 */
      async compareAndSwapDocument(documentId, expectedRevision, document) {
        const compareAndSwap = baseStorage.compareAndSwapDocument

        if (compareAndSwap === undefined) {
          throw new Error('volatile storage 应实现 CAS')
        }
        return compareAndSwap.call(baseStorage, documentId, expectedRevision, {
          ...document,
          ...(document.pendingRestore === undefined ? {} : {
            pendingRestore: {
              ...document.pendingRestore,
              operationId: 'restore-from-another-operation'
            }
          })
        })
      }
    }
    const adapter = createStoragePersistenceAdapter({ storage })
    const source = new Y.Doc()
    const text = source.getText('body')

    text.insert(0, 'v1')
    const first = await adapter.appendUpdate({
      documentId: 'doc-storage-pending-operation',
      update: Y.encodeStateAsUpdate(source),
      label: 'v1'
    })
    text.insert(text.length, '-v2')
    await adapter.appendUpdate({
      documentId: 'doc-storage-pending-operation',
      update: Y.encodeStateAsUpdate(source),
      label: 'v2'
    })
    const target = new Y.Doc()

    target.getText('body').insert(0, 'current')
    const restored = await adapter.restoreVersion({
      documentId: 'doc-storage-pending-operation',
      versionId: first.version.versionId,
      targetDoc: target
    })
    const stored = await baseStorage.loadDocument('doc-storage-pending-operation')

    expect(restored.version).toBeUndefined()
    expect(restored.diagnostics).toEqual([
      expect.objectContaining({ code: 'PERSISTENCE_RESTORE_RECOVERY_REQUIRED' })
    ])
    expect(target.getText('body').toString()).toBe('current')
    expect(stored?.versions).toHaveLength(2)
    expect(stored?.pendingRestore?.operationId).toBe('restore-from-another-operation')
  })

  /** 验证 target 应用前 observer 抛错时不会提前提交 storage restore。 */
  it('cancels pending without completing history when a target observer throws before apply', async () => {
    const storage = createVolatileHistoryStorage()
    const adapter = createStoragePersistenceAdapter({ storage })
    const current = new Y.Doc()
    const text = current.getText('body')

    text.insert(0, 'v1')
    const first = await adapter.appendUpdate({
      documentId: 'doc-storage-observer-before-restore',
      update: Y.encodeStateAsUpdate(current),
      label: 'v1'
    })
    text.insert(text.length, '-v2')
    await adapter.appendUpdate({
      documentId: 'doc-storage-observer-before-restore',
      update: Y.encodeStateAsUpdate(current),
      label: 'v2'
    })
    const before = await storage.loadDocument('doc-storage-observer-before-restore')

    /** 模拟 target 事务开始前的 observer 异常。 */
    current.on('beforeTransaction', () => {
      throw new Error('observer failed before apply')
    })

    await expect(adapter.restoreVersion({
      documentId: 'doc-storage-observer-before-restore',
      versionId: first.version.versionId,
      targetDoc: current
    })).rejects.toThrow('observer failed before apply')

    const after = await storage.loadDocument('doc-storage-observer-before-restore')

    expect(current.getText('body').toString()).toBe('v1-v2')
    expect(after?.updates).toEqual(before?.updates)
    expect(after?.versions).toEqual(before?.versions)
    expect(after?.snapshots).toEqual(before?.snapshots)
    expect(after?.pendingRestore).toBeUndefined()
    expect(after?.revision).not.toBe(before?.revision)
  })

  /** 验证 storage finalize 失败时 pending 不进入版本列表，并可由下一次 restore 完成。 */
  it('recovers a pending storage restore after finalize fails', async () => {
    const baseStorage = createVolatileHistoryStorage()
    let compareAndSwapCalls = 0
    let failFinalize = true
    const storage: JWordHistoryStorage = {
      loadDocument: baseStorage.loadDocument.bind(baseStorage),
      saveDocument: baseStorage.saveDocument.bind(baseStorage),
      /** 在第三次 restore CAS 时模拟 finalize 暂时失败。 */
      async compareAndSwapDocument(documentId, expectedRevision, document) {
        compareAndSwapCalls += 1
        if (failFinalize && compareAndSwapCalls === 3) {
          return { committed: false }
        }
        const compareAndSwap = baseStorage.compareAndSwapDocument
        if (compareAndSwap === undefined) {
          throw new Error('volatile storage 应实现 CAS')
        }
        return compareAndSwap.call(baseStorage, documentId, expectedRevision, document)
      }
    }
    const adapter = createStoragePersistenceAdapter({ storage })
    const current = new Y.Doc()
    const text = current.getText('body')

    text.insert(0, 'v1')
    const first = await adapter.appendUpdate({
      documentId: 'doc-storage-recovery',
      update: Y.encodeStateAsUpdate(current),
      label: 'v1'
    })
    text.insert(text.length, '-v2')
    await adapter.appendUpdate({
      documentId: 'doc-storage-recovery',
      update: Y.encodeStateAsUpdate(current),
      label: 'v2'
    })
    const target = new Y.Doc()

    target.getText('body').insert(0, 'v1')
    /** 模拟 target 应用完成后的 observer 异常。 */
    target.on('afterTransaction', () => {
      throw new Error('observer failed after apply')
    })

    const firstRestore = await adapter.restoreVersion({
      documentId: 'doc-storage-recovery',
      versionId: first.version.versionId,
      targetDoc: target
    })
    const pending = await storage.loadDocument('doc-storage-recovery')

    expect(firstRestore.version).toBeUndefined()
    expect(firstRestore.diagnostics).toEqual([
      expect.objectContaining({
        code: 'PERSISTENCE_RESTORE_RECOVERY_REQUIRED',
        recoverable: true
      })
    ])
    expect(pending?.pendingRestore?.phase).toBe('target-applied')
    await expect(adapter.listVersions('doc-storage-recovery')).resolves.toHaveLength(2)

    failFinalize = false
    const recoveryAdapter = createStoragePersistenceAdapter({ storage })
    const recoveryTarget = new Y.Doc()

    recoveryTarget.getText('body').insert(0, 'v1-v2')
    const recovered = await recoveryAdapter.restoreVersion({
      documentId: 'doc-storage-recovery',
      versionId: first.version.versionId,
      targetDoc: recoveryTarget
    })
    const committed = await storage.loadDocument('doc-storage-recovery')

    expect(recovered.diagnostics).toEqual([])
    expect(recovered.version).toMatchObject({
      restoreSourceVersionId: first.version.versionId,
      updateCount: 3
    })
    expect(committed?.pendingRestore).toBeUndefined()
    await expect(recoveryAdapter.listVersions('doc-storage-recovery')).resolves.toHaveLength(3)
    expect(recoveryTarget.getText('body').toString()).toBe('v1')
  })

  /** 验证 storage pending 期间阻止 append，finalize 后版本顺序与内容保持稳定。 */
  it('keeps storage appended version order and content stable across restore finalization', async () => {
    const baseStorage = createVolatileHistoryStorage()
    let compareAndSwapCalls = 0
    let failFinalize = true
    const storage: JWordHistoryStorage = {
      loadDocument: baseStorage.loadDocument.bind(baseStorage),
      saveDocument: baseStorage.saveDocument.bind(baseStorage),
      /** 在首次 finalize CAS 时保留 target-applied pending。 */
      async compareAndSwapDocument(documentId, expectedRevision, document) {
        compareAndSwapCalls += 1
        if (failFinalize && compareAndSwapCalls === 3) {
          return { committed: false }
        }
        const compareAndSwap = baseStorage.compareAndSwapDocument

        if (compareAndSwap === undefined) {
          throw new Error('volatile storage 应实现 CAS')
        }
        return compareAndSwap.call(baseStorage, documentId, expectedRevision, document)
      }
    }
    const adapter = createStoragePersistenceAdapter({ storage })
    const current = new Y.Doc()
    const text = current.getText('body')

    text.insert(0, 'v1')
    const first = await adapter.appendUpdate({
      documentId: 'doc-storage-pending-append',
      update: Y.encodeStateAsUpdate(current),
      label: 'v1'
    })
    text.insert(text.length, '-v2')
    await adapter.appendUpdate({
      documentId: 'doc-storage-pending-append',
      update: Y.encodeStateAsUpdate(current),
      label: 'v2'
    })
    const firstRestore = await adapter.restoreVersion({
      documentId: 'doc-storage-pending-append',
      versionId: first.version.versionId,
      targetDoc: current
    })
    const blockedDoc = new Y.Doc()

    blockedDoc.getText('body').insert(0, 'blocked')

    expect(firstRestore.diagnostics).toEqual([
      expect.objectContaining({ code: 'PERSISTENCE_RESTORE_RECOVERY_REQUIRED' })
    ])
    await expect(adapter.appendUpdate({
      documentId: 'doc-storage-pending-append',
      update: Y.encodeStateAsUpdate(blockedDoc),
      label: 'later'
    })).rejects.toThrow('PERSISTENCE_RESTORE_RECOVERY_REQUIRED')
    await expect(adapter.listVersions('doc-storage-pending-append')).resolves.toMatchObject([
      { versionId: 'version-1' },
      { versionId: 'version-2' }
    ])

    failFinalize = false
    const recoveryAdapter = createStoragePersistenceAdapter({ storage })
    const recovered = await recoveryAdapter.restoreVersion({
      documentId: 'doc-storage-pending-append',
      versionId: first.version.versionId,
      targetDoc: current
    })
    current.getText('body').insert(current.getText('body').length, '-later')
    const appended = await recoveryAdapter.appendUpdate({
      documentId: 'doc-storage-pending-append',
      update: Y.encodeStateAsUpdate(current),
      label: 'later'
    })
    const versions = await recoveryAdapter.listVersions('doc-storage-pending-append')
    const loaded = await recoveryAdapter.loadVersion({
      documentId: 'doc-storage-pending-append',
      versionId: appended.version.versionId
    })

    expect(recovered.version?.versionId).toBe('version-3')
    expect(versions.map((version) => version.versionId)).toEqual([
      'version-1',
      'version-2',
      'version-3',
      'version-4'
    ])
    expect(readBodyText(loaded.update)).toBe('v1-later')
  })

  /** 验证已加载旧 state 的 append 不会与同 document restore 交错并覆盖其提交。 */
  it('fails restore closed while a storage append is in flight', async () => {
    const baseStorage = createVolatileHistoryStorage()
    let pauseNextLoad = false
    /** 通知测试主体 append 已读取旧 storage state。 */
    let notifyAppendLoaded = () => {}
    /** 释放已暂停的 append storage load。 */
    let releaseAppendLoad = () => {}
    /** 捕获 append 进入确定性竞争窗口的时刻。 */
    const appendLoaded = new Promise<void>((resolve) => {
      notifyAppendLoaded = resolve
    })
    /** 等待测试主体完成 restore fail-closed 断言后释放 append。 */
    const appendRelease = new Promise<void>((resolve) => {
      releaseAppendLoad = resolve
    })
    const storage: JWordHistoryStorage = {
      /** 在 append 捕获旧 state 后暂停，使 restore 进入同一 document 的竞争窗口。 */
      async loadDocument(documentId) {
        const document = await baseStorage.loadDocument(documentId)

        if (pauseNextLoad) {
          pauseNextLoad = false
          notifyAppendLoaded()
          await appendRelease
        }
        return document
      },
      saveDocument: baseStorage.saveDocument.bind(baseStorage),
      ...(baseStorage.compareAndSwapDocument === undefined
        ? {}
        : { compareAndSwapDocument: baseStorage.compareAndSwapDocument.bind(baseStorage) })
    }
    const adapter = createStoragePersistenceAdapter({ storage })
    const current = new Y.Doc()
    const text = current.getText('body')

    text.insert(0, 'v1')
    const first = await adapter.appendUpdate({
      documentId: 'doc-storage-append-restore-overlap',
      update: Y.encodeStateAsUpdate(current),
      label: 'v1'
    })
    text.insert(text.length, '-v2')
    await adapter.appendUpdate({
      documentId: 'doc-storage-append-restore-overlap',
      update: Y.encodeStateAsUpdate(current),
      label: 'v2'
    })
    text.insert(text.length, '-later')
    pauseNextLoad = true
    const appendPromise = adapter.appendUpdate({
      documentId: 'doc-storage-append-restore-overlap',
      update: Y.encodeStateAsUpdate(current),
      label: 'later'
    })

    await appendLoaded
    const restored = await adapter.restoreVersion({
      documentId: 'doc-storage-append-restore-overlap',
      versionId: first.version.versionId,
      targetDoc: current
    })

    releaseAppendLoad()
    const appended = await appendPromise
    const versions = await adapter.listVersions('doc-storage-append-restore-overlap')
    const loaded = await adapter.loadVersion({
      documentId: 'doc-storage-append-restore-overlap',
      versionId: appended.version.versionId
    })

    expect(restored.version).toBeUndefined()
    expect(restored.diagnostics).toEqual([
      expect.objectContaining({ code: 'PERSISTENCE_RESTORE_FAILED' })
    ])
    expect(current.getText('body').toString()).toBe('v1-v2-later')
    expect(versions.map((version) => version.versionId)).toEqual([
      'version-1',
      'version-2',
      'version-3'
    ])
    expect(readBodyText(loaded.update)).toBe('v1-v2-later')
  })

  /** 验证 storage prepared pending 阻止 append，取消后新 restore 连续分配版本。 */
  it('allows the next storage restore sequence after pending blocks append and is cancelled', async () => {
    const baseStorage = createVolatileHistoryStorage()
    let compareAndSwapCalls = 0
    const storage: JWordHistoryStorage = {
      loadDocument: baseStorage.loadDocument.bind(baseStorage),
      saveDocument: baseStorage.saveDocument.bind(baseStorage),
      /** 在首次取消 pending 的 CAS 时模拟冲突，随后允许恢复重试。 */
      async compareAndSwapDocument(documentId, expectedRevision, document) {
        compareAndSwapCalls += 1
        if (compareAndSwapCalls === 2) {
          return { committed: false }
        }
        const compareAndSwap = baseStorage.compareAndSwapDocument

        if (compareAndSwap === undefined) {
          throw new Error('volatile storage 应实现 CAS')
        }
        return compareAndSwap.call(baseStorage, documentId, expectedRevision, document)
      }
    }
    const adapter = createStoragePersistenceAdapter({ storage })
    const current = new Y.Doc()
    const text = current.getText('body')

    text.insert(0, 'v1')
    const first = await adapter.appendUpdate({
      documentId: 'doc-storage-pending-cancel-append',
      update: Y.encodeStateAsUpdate(current),
      label: 'v1'
    })
    text.insert(text.length, '-v2')
    await adapter.appendUpdate({
      documentId: 'doc-storage-pending-cancel-append',
      update: Y.encodeStateAsUpdate(current),
      label: 'v2'
    })
    /** 模拟 target 应用前 observer 异常。 */
    const throwBeforeApply = () => {
      throw new Error('observer failed before apply')
    }

    current.on('beforeTransaction', throwBeforeApply)
    const firstRestore = await adapter.restoreVersion({
      documentId: 'doc-storage-pending-cancel-append',
      versionId: first.version.versionId,
      targetDoc: current
    })
    const appendedDoc = new Y.Doc()

    appendedDoc.getText('body').insert(0, 'v1-later')
    await expect(adapter.appendUpdate({
      documentId: 'doc-storage-pending-cancel-append',
      update: Y.encodeStateAsUpdate(appendedDoc),
      label: 'later'
    })).rejects.toThrow('PERSISTENCE_RESTORE_RECOVERY_REQUIRED')

    expect(firstRestore.diagnostics).toEqual([
      expect.objectContaining({ code: 'PERSISTENCE_RESTORE_RECOVERY_REQUIRED' })
    ])
    current.off('beforeTransaction', throwBeforeApply)
    const cancelled = await adapter.restoreVersion({
      documentId: 'doc-storage-pending-cancel-append',
      versionId: first.version.versionId,
      targetDoc: current
    })
    const restored = await adapter.restoreVersion({
      documentId: 'doc-storage-pending-cancel-append',
      versionId: first.version.versionId,
      targetDoc: current
    })
    const versions = await adapter.listVersions('doc-storage-pending-cancel-append')

    expect(cancelled.version).toBeUndefined()
    expect(cancelled.diagnostics).toEqual([
      expect.objectContaining({ code: 'PERSISTENCE_RESTORE_FAILED' })
    ])
    expect(restored.version?.versionId).toBe('version-3')
    expect(versions.map((version) => version.versionId)).toEqual([
      'version-1',
      'version-2',
      'version-3'
    ])
  })

  /** 验证 finalize 已提交但 CAS 确认抛错时，重试不会追加第二个 restore。 */
  it('recognizes a committed storage restore after the finalize acknowledgement is lost', async () => {
    const baseStorage = createVolatileHistoryStorage()
    let compareAndSwapCalls = 0
    const storage: JWordHistoryStorage = {
      loadDocument: baseStorage.loadDocument.bind(baseStorage),
      saveDocument: baseStorage.saveDocument.bind(baseStorage),
      /** 在 finalize 文档已提交后模拟 CAS 确认丢失。 */
      async compareAndSwapDocument(documentId, expectedRevision, document) {
        compareAndSwapCalls += 1
        const compareAndSwap = baseStorage.compareAndSwapDocument

        if (compareAndSwap === undefined) {
          throw new Error('volatile storage 应实现 CAS')
        }

        const result = await compareAndSwap.call(baseStorage, documentId, expectedRevision, document)

        if (compareAndSwapCalls === 3) {
          throw new Error('storage finalize acknowledgement lost')
        }
        return result
      }
    }
    const adapter = createStoragePersistenceAdapter({ storage })
    const current = new Y.Doc()
    const text = current.getText('body')

    text.insert(0, 'v1')
    const first = await adapter.appendUpdate({
      documentId: 'doc-storage-finalize-ack-lost',
      update: Y.encodeStateAsUpdate(current),
      label: 'v1'
    })
    text.insert(text.length, '-v2')
    await adapter.appendUpdate({
      documentId: 'doc-storage-finalize-ack-lost',
      update: Y.encodeStateAsUpdate(current),
      label: 'v2'
    })

    const firstRestore = await adapter.restoreVersion({
      documentId: 'doc-storage-finalize-ack-lost',
      versionId: first.version.versionId,
      targetDoc: current
    })
    const committed = await storage.loadDocument('doc-storage-finalize-ack-lost')

    expect(firstRestore.version).toBeUndefined()
    expect(firstRestore.diagnostics).toEqual([
      expect.objectContaining({ code: 'PERSISTENCE_RESTORE_RECOVERY_REQUIRED' })
    ])
    expect(committed?.pendingRestore).toBeUndefined()
    expect(committed?.completedRestore).toMatchObject({
      sourceVersionId: first.version.versionId
    })
    expect(committed?.versions).toHaveLength(3)

    const recoveryAdapter = createStoragePersistenceAdapter({ storage })
    const recoveryTarget = new Y.Doc()

    recoveryTarget.getText('body').insert(0, 'v1-v2')
    const recovered = await recoveryAdapter.restoreVersion({
      documentId: 'doc-storage-finalize-ack-lost',
      versionId: first.version.versionId,
      targetDoc: recoveryTarget
    })
    const recoveredStorage = await storage.loadDocument('doc-storage-finalize-ack-lost')

    expect(recovered.diagnostics).toEqual([])
    expect(recovered.version).toMatchObject({
      restoreSourceVersionId: first.version.versionId,
      updateCount: 3
    })
    expect(recoveryTarget.getText('body').toString()).toBe('v1')
    expect(recoveredStorage?.versions).toHaveLength(3)
  })

  /** 验证 storage 无法取消 pending 时返回 recovery-required，而不是普通 restore failure。 */
  it('reports recovery-required when storage pending cancellation conflicts', async () => {
    const baseStorage = createVolatileHistoryStorage()
    let compareAndSwapCalls = 0
    const storage: JWordHistoryStorage = {
      loadDocument: baseStorage.loadDocument.bind(baseStorage),
      saveDocument: baseStorage.saveDocument.bind(baseStorage),
      /** 在取消 pending 的 CAS 时模拟 stale writer 冲突。 */
      async compareAndSwapDocument(documentId, expectedRevision, document) {
        compareAndSwapCalls += 1
        const compareAndSwap = baseStorage.compareAndSwapDocument
        if (compareAndSwap === undefined) {
          throw new Error('volatile storage 应实现 CAS')
        }
        if (compareAndSwapCalls === 2) {
          return { committed: false }
        }
        return compareAndSwap.call(baseStorage, documentId, expectedRevision, document)
      }
    }
    const adapter = createStoragePersistenceAdapter({ storage })
    const current = new Y.Doc()
    const text = current.getText('body')

    text.insert(0, 'v1')
    const first = await adapter.appendUpdate({
      documentId: 'doc-storage-cancel-failure',
      update: Y.encodeStateAsUpdate(current),
      label: 'v1'
    })
    text.insert(text.length, '-v2')
    await adapter.appendUpdate({
      documentId: 'doc-storage-cancel-failure',
      update: Y.encodeStateAsUpdate(current),
      label: 'v2'
    })
    /** 模拟 target 事务开始前的 observer 异常。 */
    current.on('beforeTransaction', () => {
      throw new Error('observer failed before apply')
    })

    const restored = await adapter.restoreVersion({
      documentId: 'doc-storage-cancel-failure',
      versionId: first.version.versionId,
      targetDoc: current
    })
    const pending = await storage.loadDocument('doc-storage-cancel-failure')

    expect(restored.version).toBeUndefined()
    expect(restored.diagnostics).toEqual([
      expect.objectContaining({
        code: 'PERSISTENCE_RESTORE_RECOVERY_REQUIRED',
        recoverable: true
      })
    ])
    expect(pending?.pendingRestore?.phase).toBe('prepared')
    expect(current.getText('body').toString()).toBe('v1-v2')

    const recovered = await adapter.restoreVersion({
      documentId: 'doc-storage-cancel-failure',
      versionId: first.version.versionId,
      targetDoc: current
    })
    const afterRecovery = await storage.loadDocument('doc-storage-cancel-failure')

    expect(recovered.version).toBeUndefined()
    expect(recovered.diagnostics).toEqual([
      expect.objectContaining({ code: 'PERSISTENCE_RESTORE_FAILED' })
    ])
    expect(afterRecovery?.pendingRestore).toBeUndefined()
  })

  /** 验证 observer 修改 target 后保留 storage pending，并由同一 operation 的重试修复。 */
  it('repairs a diverged storage target when the pending restore is retried', async () => {
    const storage = createVolatileHistoryStorage()
    const adapter = createStoragePersistenceAdapter({ storage })
    const current = new Y.Doc()
    const text = current.getText('body')

    text.insert(0, 'v1')
    const first = await adapter.appendUpdate({
      documentId: 'doc-storage-observer-diverged',
      update: Y.encodeStateAsUpdate(current),
      label: 'v1'
    })
    text.insert(text.length, '-v2')
    await adapter.appendUpdate({
      documentId: 'doc-storage-observer-diverged',
      update: Y.encodeStateAsUpdate(current),
      label: 'v2'
    })
    let changed = false

    /** 模拟 observer 在 target 应用后继续修改并抛错。 */
    current.on('afterTransaction', () => {
      if (!changed) {
        changed = true
        current.getText('body').insert(current.getText('body').length, '-observer')
      }
      throw new Error('observer changed target after apply')
    })

    const restored = await adapter.restoreVersion({
      documentId: 'doc-storage-observer-diverged',
      versionId: first.version.versionId,
      targetDoc: current
    })
    const stored = await storage.loadDocument('doc-storage-observer-diverged')

    expect(restored.version).toBeUndefined()
    expect(restored.diagnostics).toEqual([
      expect.objectContaining({ code: 'PERSISTENCE_RESTORE_RECOVERY_REQUIRED' })
    ])
    expect(current.getText('body').toString()).toBe('v1-observer')
    expect(stored?.versions).toHaveLength(2)
    expect(stored?.pendingRestore?.phase).toBe('prepared')
    await expect(adapter.listVersions('doc-storage-observer-diverged')).resolves.toHaveLength(2)

    const recoveryAdapter = createStoragePersistenceAdapter({ storage })
    const recovered = await recoveryAdapter.restoreVersion({
      documentId: 'doc-storage-observer-diverged',
      versionId: first.version.versionId,
      targetDoc: current
    })
    const recoveredStorage = await storage.loadDocument('doc-storage-observer-diverged')

    expect(recovered.diagnostics).toEqual([])
    expect(recovered.version).toMatchObject({
      restoreSourceVersionId: first.version.versionId,
      updateCount: 3
    })
    expect(current.getText('body').toString()).toBe('v1')
    expect(recoveredStorage?.pendingRestore).toBeUndefined()
    await expect(recoveryAdapter.listVersions('doc-storage-observer-diverged')).resolves.toHaveLength(3)
  })

  /** 验证 stale restore revision 不会改变 target 或 storage history。 */
  it('rejects a stale restore revision without changing target or stored history', async () => {
    const baseStorage = createVolatileHistoryStorage()
    let injectStaleWrite = false
    const storage: JWordHistoryStorage = {
      loadDocument: baseStorage.loadDocument.bind(baseStorage),
      saveDocument: baseStorage.saveDocument.bind(baseStorage),
      /** 在 restore CAS 前推进 backend revision，模拟 stale writer。 */
      async compareAndSwapDocument(documentId, expectedRevision, document) {
        const current = await baseStorage.loadDocument(documentId)
        const compareAndSwap = baseStorage.compareAndSwapDocument

        if (current === null || compareAndSwap === undefined) {
          throw new Error('stale revision 测试需要已有 CAS 文档')
        }
        if (injectStaleWrite) {
          await baseStorage.saveDocument(documentId, current)
        }
        return compareAndSwap.call(baseStorage, documentId, expectedRevision, document)
      }
    }
    const adapter = createStoragePersistenceAdapter({ storage })
    const source = new Y.Doc()
    const text = source.getText('body')

    text.insert(0, 'v1')
    const first = await adapter.appendUpdate({
      documentId: 'doc-stale-restore',
      update: Y.encodeStateAsUpdate(source),
      label: 'v1'
    })
    text.insert(text.length, '-v2')
    await adapter.appendUpdate({
      documentId: 'doc-stale-restore',
      update: Y.encodeStateAsUpdate(source),
      label: 'v2'
    })
    const before = await baseStorage.loadDocument('doc-stale-restore')
    const target = new Y.Doc()

    target.getText('body').insert(0, 'current')
    injectStaleWrite = true
    const restored = await adapter.restoreVersion({
      documentId: 'doc-stale-restore',
      versionId: first.version.versionId,
      targetDoc: target
    })
    const after = await baseStorage.loadDocument('doc-stale-restore')

    expect(restored.version).toBeUndefined()
    expect(restored.diagnostics).toEqual([
      expect.objectContaining({ code: 'PERSISTENCE_RESTORE_FAILED' })
    ])
    expect(target.getText('body').toString()).toBe('current')
    expect(after?.updates).toEqual(before?.updates)
    expect(after?.versions).toEqual(before?.versions)
    expect(after?.snapshots).toEqual(before?.snapshots)
    expect(after?.revision).not.toBe(before?.revision)
  })
})

/** 从 state update 中读取 body 文本，验证公开 loadVersion() 的实际内容。 */
function readBodyText(update: Uint8Array): string {
  const doc = new Y.Doc()

  Y.applyUpdate(doc, update)
  return doc.getText('body').toString()
}
