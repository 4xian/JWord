/**
 * @vitest-environment node
 *
 * 职责：验证 Gate 6 persistence 包的内存 update log、snapshot、preview、restore 和 offline diagnostic 契约。
 * 边界：不接真实 IndexedDB、不访问 core、不把 projection JSON 当成持久化真源。
 * 协作模块：Yjs update API、后续 collab provider 和 editor restore transaction 会复用这些公开类型。
 * 约束：测试先行，先观察缺包红灯，再实现最小闭环。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import * as Y from 'yjs'
import { describe, expect, expectTypeOf, it } from 'vitest'

import {
  PERSISTENCE_DIAGNOSTIC_CODE_METADATA,
  createMemoryPersistenceHistoryService,
  createMemoryPersistenceAdapter,
  createUnavailableIndexedDbOfflineAdapter
} from '../src/index'
import { hashYjsLogicalContent } from '../src/yjs-logical-content'
import {
  createNestedFormattedRun,
  readNestedFormattedRun
} from './yjs-document-test-fixtures'
import type {
  JWordMemoryPersistenceHistoryService,
  JWordOfflineAdapter,
  JWordPersistenceDiagnosticCode,
  JWordPersistenceDiagnosticCodeMetadata,
  JWordPersistenceSnapshotAdapter,
  JWordSnapshotRecord,
  JWordUpdateLogRecord,
  JWordVersionRecord
} from '../src/index'

describe('@4xian/jword-persistence memory adapter', () => {
  it('exports offline, update log, snapshot and diagnostic contracts', () => {
    const adapter = createMemoryPersistenceAdapter()
    const offline = createUnavailableIndexedDbOfflineAdapter()

    expectTypeOf(adapter).toMatchTypeOf<JWordPersistenceSnapshotAdapter>()
    expectTypeOf(offline).toMatchTypeOf<JWordOfflineAdapter>()
    expectTypeOf(createMemoryPersistenceHistoryService()).toMatchTypeOf<JWordMemoryPersistenceHistoryService>()
    expectTypeOf<JWordUpdateLogRecord>().toHaveProperty('update')
    expectTypeOf<JWordSnapshotRecord>().toHaveProperty('stateUpdate')
    expectTypeOf<JWordVersionRecord>().toHaveProperty('versionId')
    expectTypeOf<JWordUpdateLogRecord>().toHaveProperty('byteLength')
    expectTypeOf<JWordUpdateLogRecord>().toHaveProperty('snapshotId')
    expectTypeOf<JWordSnapshotRecord>().toHaveProperty('stateVector')
    expectTypeOf<JWordSnapshotRecord>().toHaveProperty('baseUpdateId')
    expectTypeOf<JWordSnapshotRecord>().toHaveProperty('updateByteLength')
    expectTypeOf<JWordSnapshotRecord>().toHaveProperty('documentSummary')
    expectTypeOf<JWordVersionRecord>().toHaveProperty('sha256')
    expectTypeOf<JWordPersistenceDiagnosticCode>().toEqualTypeOf<
      keyof typeof PERSISTENCE_DIAGNOSTIC_CODE_METADATA
    >()
    expectTypeOf<JWordPersistenceDiagnosticCodeMetadata>().toHaveProperty('recoverable')
    expect(PERSISTENCE_DIAGNOSTIC_CODE_METADATA.PERSISTENCE_INDEXEDDB_UNAVAILABLE).toMatchObject({
      severity: 'warning',
      recoverable: true
    })
  })

  it('rebuilds versions from update log and snapshot records', async () => {
    const adapter = createMemoryPersistenceAdapter()
    const source = new Y.Doc()
    const text = source.getText('body')

    text.insert(0, 'A')
    const first = await adapter.appendUpdate({
      documentId: 'doc-versions',
      update: Y.encodeStateAsUpdate(source),
      label: 'first'
    })

    text.insert(1, 'B')
    const second = await adapter.appendUpdate({
      documentId: 'doc-versions',
      update: Y.encodeStateAsUpdate(source),
      label: 'second'
    })
    const snapshot = await adapter.createSnapshot({
      documentId: 'doc-versions',
      versionId: second.version.versionId,
      label: 'snapshot-second'
    })

    text.insert(2, 'C')
    const third = await adapter.appendUpdate({
      documentId: 'doc-versions',
      update: Y.encodeStateAsUpdate(source),
      label: 'third'
    })
    const versions = await adapter.listVersions('doc-versions')
    const firstLoaded = await adapter.loadVersion({
      documentId: 'doc-versions',
      versionId: first.version.versionId
    })
    const secondLoaded = await adapter.loadVersion({
      documentId: 'doc-versions',
      versionId: second.version.versionId
    })
    const thirdLoaded = await adapter.loadVersion({
      documentId: 'doc-versions',
      versionId: third.version.versionId
    })

    expect(versions.map((version) => version.label)).toEqual(['first', 'second', 'third'])
    expect(snapshot.snapshot.versionId).toBe(second.version.versionId)
    expect(readBodyText(firstLoaded.update)).toBe('A')
    expect(readBodyText(secondLoaded.update)).toBe('AB')
    expect(readBodyText(thirdLoaded.update)).toBe('ABC')
  })

  it('reports missing snapshot diagnostics and rebuilds the version from update log', async () => {
    const adapter = createMemoryPersistenceAdapter()
    const source = new Y.Doc()
    const text = source.getText('body')

    text.insert(0, 'one')
    await adapter.appendUpdate({
      documentId: 'doc-snapshot-missing',
      update: Y.encodeStateAsUpdate(source),
      label: 'one'
    })
    text.insert(text.length, '-two')
    const version = await adapter.appendUpdate({
      documentId: 'doc-snapshot-missing',
      update: Y.encodeStateAsUpdate(source),
      label: 'two'
    })
    const snapshot = await adapter.createSnapshot({
      documentId: 'doc-snapshot-missing',
      versionId: version.version.versionId,
      snapshotId: 'snapshot-corrupt'
    })
    const stateProbe = adapter as unknown as MemoryPersistenceAdapterStateProbe
    const state = stateProbe.documents.get('doc-snapshot-missing')

    if (state === undefined) {
      throw new Error('内存 persistence 状态应已创建')
    }

    state.snapshots.splice(0, state.snapshots.length)
    const loaded = await adapter.loadVersion({
      documentId: 'doc-snapshot-missing',
      versionId: version.version.versionId
    })
    const preview = await adapter.createPreview({
      documentId: 'doc-snapshot-missing',
      versionId: version.version.versionId
    })
    const current = new Y.Doc()
    current.getText('body').insert(0, 'current')
    const restored = await adapter.restoreVersion({
      documentId: 'doc-snapshot-missing',
      versionId: version.version.versionId,
      targetDoc: current
    })

    expect(snapshot.version.snapshotId).toBe('snapshot-corrupt')
    expect(readBodyText(loaded.update)).toBe('one-two')
    expect(loaded.diagnostics).toEqual([
      expect.objectContaining({
        code: 'PERSISTENCE_SNAPSHOT_NOT_FOUND',
        recoverable: true,
        fallback: 'rebuild-from-update-log',
        snapshotId: 'snapshot-corrupt'
      })
    ])
    expect(preview.doc.getText('body').toString()).toBe('one-two')
    expect(preview.diagnostics).toEqual(loaded.diagnostics)
    expect(current.getText('body').toString()).toBe('one-two')
    expect(restored.version).toMatchObject({
      restoreSourceVersionId: version.version.versionId
    })
    expect(restored.diagnostics).toEqual(loaded.diagnostics)
  })

  it('shares room document history across adapters through an explicit service', async () => {
    const historyService = createMemoryPersistenceHistoryService()
    const writer = createMemoryPersistenceAdapter({ historyService })
    const reader = createMemoryPersistenceAdapter({ historyService })
    const source = new Y.Doc()

    source.getText('body').insert(0, 'shared-history')
    const appended = await writer.appendUpdate({
      documentId: 'doc-shared-history',
      roomId: 'room-shared-history',
      clientId: 'client-a',
      update: Y.encodeStateAsUpdate(source),
      label: 'shared-v1',
      authorId: 'author-a',
      origin: 'provider-a',
      createdAt: '2026-05-26T02:00:00.000Z'
    })
    const snapshot = await reader.createSnapshot({
      documentId: 'doc-shared-history',
      versionId: appended.version.versionId,
      snapshotId: 'snapshot-shared-v1'
    })
    const versions = await reader.listVersions('doc-shared-history')
    const loaded = await reader.loadVersion({
      documentId: 'doc-shared-history',
      versionId: appended.version.versionId
    })
    const preview = await reader.createPreview({
      documentId: 'doc-shared-history',
      versionId: appended.version.versionId
    })
    const target = new Y.Doc()

    target.getText('body').insert(0, 'reader-current')
    const restored = await reader.restoreVersion({
      documentId: 'doc-shared-history',
      versionId: appended.version.versionId,
      targetDoc: target,
      origin: 'reader-restore'
    })

    expect(versions).toHaveLength(1)
    expect(versions[0]).toMatchObject({
      versionId: appended.version.versionId,
      roomId: 'room-shared-history',
      clientId: 'client-a',
      authorId: 'author-a',
      origin: 'provider-a'
    })
    expect(readBodyText(loaded.update)).toBe('shared-history')
    expect(preview.doc.getText('body').toString()).toBe('shared-history')
    expect(target.getText('body').toString()).toBe('shared-history')
    expect(restored.version).toMatchObject({
      restoreSourceVersionId: appended.version.versionId,
      roomId: 'room-shared-history',
      clientId: 'client-a',
      authorId: 'author-a',
      origin: 'reader-restore'
    })
    expect(snapshot.snapshot).toMatchObject({
      snapshotId: 'snapshot-shared-v1',
      roomId: 'room-shared-history',
      clientId: 'client-a',
      authorId: 'author-a',
      origin: 'provider-a'
    })
  })

  it('stores update, snapshot and version metadata for room, client, checksum and state vector', async () => {
    const adapter = createMemoryPersistenceAdapter()
    const source = new Y.Doc()

    source.getText('body').insert(0, 'metadata')
    const updateBytes = Y.encodeStateAsUpdate(source)
    const appended = await adapter.appendUpdate({
      documentId: 'doc-metadata',
      roomId: 'room-metadata',
      clientId: 'client-a',
      update: updateBytes,
      label: 'metadata',
      authorId: 'author-a',
      origin: 'local-user',
      createdAt: '2026-05-26T01:00:00.000Z'
    })
    const snapshot = await adapter.createSnapshot({
      documentId: 'doc-metadata',
      versionId: appended.version.versionId,
      snapshotId: 'snapshot-metadata',
      label: 'snapshot metadata',
      createdAt: '2026-05-26T01:01:00.000Z'
    })

    expect(appended.update).toMatchObject({
      documentId: 'doc-metadata',
      roomId: 'room-metadata',
      clientId: 'client-a',
      authorId: 'author-a',
      origin: 'local-user',
      byteLength: updateBytes.byteLength
    })
    expect(appended.update.sha256).toMatch(/^[a-f0-9]{64}$/u)
    expect(appended.update.stateVector.byteLength).toBeGreaterThan(0)
    expect(appended.version).toMatchObject({
      documentId: 'doc-metadata',
      roomId: 'room-metadata',
      clientId: 'client-a',
      authorId: 'author-a',
      origin: 'local-user',
      byteLength: updateBytes.byteLength,
      sha256: appended.update.sha256
    })
    expect(snapshot.snapshot).toMatchObject({
      snapshotId: 'snapshot-metadata',
      documentId: 'doc-metadata',
      versionId: appended.version.versionId,
      baseUpdateId: appended.update.updateId,
      byteLength: snapshot.snapshot.stateUpdate.byteLength,
      updateByteLength: snapshot.snapshot.stateUpdate.byteLength,
      documentSummary: {
        sharedTypeNames: ['body'],
        updateCount: appended.version.updateCount,
        updateByteLength: snapshot.snapshot.stateUpdate.byteLength
      }
    })
    expect(snapshot.snapshot.sha256).toMatch(/^[a-f0-9]{64}$/u)
    expect(snapshot.snapshot.stateVector.byteLength).toBeGreaterThan(0)
    expect(snapshot.version).toMatchObject({
      snapshotId: 'snapshot-metadata',
      sha256: snapshot.snapshot.sha256,
      byteLength: snapshot.snapshot.byteLength
    })

    const stateProbe = adapter as unknown as MemoryPersistenceAdapterStateProbe
    const state = stateProbe.documents.get('doc-metadata')

    if (state === undefined) {
      throw new Error('内存 persistence 状态应已创建')
    }

    expect(state.updates[0]).toMatchObject({
      updateId: appended.update.updateId,
      snapshotId: 'snapshot-metadata'
    })
  })

  it('uses canonical SHA-256 digest for empty placeholder snapshots', async () => {
    const adapter = createMemoryPersistenceAdapter()
    const snapshot = await adapter.createSnapshot({
      documentId: 'doc-missing-snapshot',
      versionId: 'missing-version'
    })

    expect(snapshot.snapshot.sha256).toBe('e3b0c44298fc1c149afbf4c8996fb924' +
      '27ae41e4649b934ca495991b7852b855')
  })

  it('creates isolated previews without mutating the current document', async () => {
    const adapter = createMemoryPersistenceAdapter()
    const current = new Y.Doc()
    const text = current.getText('body')

    text.insert(0, 'original')
    const version = await adapter.appendUpdate({
      documentId: 'doc-preview',
      update: Y.encodeStateAsUpdate(current),
      label: 'original'
    })
    text.insert(text.length, '-current')

    const preview = await adapter.createPreview({
      documentId: 'doc-preview',
      versionId: version.version.versionId
    })
    preview.doc.getText('body').insert(0, 'preview-')

    expect(current.getText('body').toString()).toBe('original-current')
    expect(preview.doc.getText('body').toString()).toBe('preview-original')
  })

  it('restores an older version atomically after building it in an isolated document', async () => {
    const adapter = createMemoryPersistenceAdapter()
    const current = new Y.Doc()
    const text = current.getText('body')

    text.insert(0, 'v1')
    const first = await adapter.appendUpdate({
      documentId: 'doc-restore',
      update: Y.encodeStateAsUpdate(current),
      label: 'v1'
    })
    text.insert(2, '-v2')
    await adapter.appendUpdate({
      documentId: 'doc-restore',
      update: Y.encodeStateAsUpdate(current),
      label: 'v2'
    })

    const missing = await adapter.restoreVersion({
      documentId: 'doc-restore',
      versionId: 'missing-version',
      targetDoc: current
    })
    expect(missing.diagnostics).toEqual([
      expect.objectContaining({
        code: 'PERSISTENCE_VERSION_NOT_FOUND',
        recoverable: true
      })
    ])
    expect(current.getText('body').toString()).toBe('v1-v2')

    const restored = await adapter.restoreVersion({
      documentId: 'doc-restore',
      versionId: first.version.versionId,
      targetDoc: current,
      origin: 'version-restore'
    })

    const restoredVersion = restored.version
    expect(restored.diagnostics).toEqual([])
    if (restoredVersion === undefined) {
      throw new Error('恢复版本应返回版本元数据')
    }
    expect(restoredVersion).toMatchObject({
      label: 'restore:v1',
      origin: 'version-restore',
      restoreSourceVersionId: first.version.versionId,
      updateCount: 3
    })
    expect(current.getText('body').toString()).toBe('v1')

    const versions = await adapter.listVersions('doc-restore')
    expect(versions.map((version) => version.label)).toEqual(['v1', 'v2', 'restore:v1'])
    expect(versions.at(-1)).toMatchObject({
      origin: 'version-restore',
      restoreSourceVersionId: first.version.versionId,
      updateCount: 3
    })
  })

  it('restores nested shared types used by core document stores', async () => {
    const adapter = createMemoryPersistenceAdapter()
    const current = new Y.Doc()
    const firstText = createNestedBodyText(current)

    firstText.insert(0, 'nested-v1')
    const first = await adapter.appendUpdate({
      documentId: 'doc-nested-restore',
      update: Y.encodeStateAsUpdate(current),
      label: 'nested-v1'
    })
    firstText.delete(0, firstText.length)
    firstText.insert(0, 'nested-v2')
    await adapter.appendUpdate({
      documentId: 'doc-nested-restore',
      update: Y.encodeStateAsUpdate(current),
      label: 'nested-v2'
    })

    const restored = await adapter.restoreVersion({
      documentId: 'doc-nested-restore',
      versionId: first.version.versionId,
      targetDoc: current,
      origin: 'version-restore'
    })

    expect(restored.diagnostics).toEqual([])
    expect(readNestedBodyText(current)).toBe('nested-v1')
  })

  /** 验证公开恢复入口同时保留 Y.Text delta attributes 与 canonical run properties。 */
  it('preserves Y.Text attributes without regressing canonical run properties', async () => {
    const adapter = createMemoryPersistenceAdapter()
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
      documentId: 'doc-formatted-restore',
      update: Y.encodeStateAsUpdate(source),
      label: 'formatted-v1'
    })
    original.text.delete(0, original.text.length)
    original.text.insert(0, 'v2')
    topLevelText.delete(0, topLevelText.length)
    topLevelText.insert(0, 'top-v2')
    original.properties.set('bold', false)
    await adapter.appendUpdate({
      documentId: 'doc-formatted-restore',
      update: Y.encodeStateAsUpdate(source),
      label: 'formatted-v2'
    })

    const preview = await adapter.createPreview({
      documentId: 'doc-formatted-restore',
      versionId: first.version.versionId
    })
    const previewRun = readNestedFormattedRun(preview.doc)
    const target = new Y.Doc()

    target.getArray<Y.Map<unknown>>('sections')
    const restored = await adapter.restoreVersion({
      documentId: 'doc-formatted-restore',
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

  it('returns restore diagnostics without mutating the target when saved updates are invalid', async () => {
    const adapter = createMemoryPersistenceAdapter()
    const current = new Y.Doc()

    current.getText('body').insert(0, 'safe-current')
    const version = await adapter.appendUpdate({
      documentId: 'doc-restore-invalid',
      update: new Uint8Array([1, 2, 3]),
      label: 'invalid'
    })

    await expect(adapter.restoreVersion({
      documentId: 'doc-restore-invalid',
      versionId: version.version.versionId,
      targetDoc: current
    })).resolves.toMatchObject({
      diagnostics: [
        {
          code: 'PERSISTENCE_RESTORE_FAILED',
          recoverable: false
        }
      ]
    })
    expect(current.getText('body').toString()).toBe('safe-current')
  })

  /** 验证 memory commit 失败时目标文档和历史状态保持不变。 */
  it('keeps target and history unchanged when the prepared memory commit fails', async () => {
    const historyService = createMemoryPersistenceHistoryService()
    const adapter = createMemoryPersistenceAdapter({ historyService })
    const current = new Y.Doc()
    const text = current.getText('body')

    text.insert(0, 'v1')
    const first = await adapter.appendUpdate({
      documentId: 'doc-memory-commit-failure',
      update: Y.encodeStateAsUpdate(current),
      label: 'v1'
    })
    text.insert(text.length, '-v2')
    await adapter.appendUpdate({
      documentId: 'doc-memory-commit-failure',
      update: Y.encodeStateAsUpdate(current),
      label: 'v2'
    })
    /** 模拟 memory history state 提交失败。 */
    historyService.documents.set = () => {
      throw new Error('memory commit failed')
    }

    const restored = await adapter.restoreVersion({
      documentId: 'doc-memory-commit-failure',
      versionId: first.version.versionId,
      targetDoc: current
    })
    const state = historyService.documents.get('doc-memory-commit-failure')

    expect(restored.version).toBeUndefined()
    expect(restored.diagnostics).toEqual([
      expect.objectContaining({ code: 'PERSISTENCE_RESTORE_FAILED' })
    ])
    expect(current.getText('body').toString()).toBe('v1-v2')
    expect(state?.updates).toHaveLength(2)
    expect(state?.versions).toHaveLength(2)
  })

  /** 验证 target 应用前 observer 抛错时不会提前提交 restore history。 */
  it('keeps target and history unchanged when a target observer throws before apply', async () => {
    const historyService = createMemoryPersistenceHistoryService()
    const adapter = createMemoryPersistenceAdapter({ historyService })
    const current = new Y.Doc()
    const text = current.getText('body')

    text.insert(0, 'v1')
    const first = await adapter.appendUpdate({
      documentId: 'doc-observer-before-restore',
      update: Y.encodeStateAsUpdate(current),
      label: 'v1'
    })
    text.insert(text.length, '-v2')
    await adapter.appendUpdate({
      documentId: 'doc-observer-before-restore',
      update: Y.encodeStateAsUpdate(current),
      label: 'v2'
    })
    /** 模拟 target 事务开始前的 observer 异常。 */
    current.on('beforeTransaction', () => {
      throw new Error('observer failed before apply')
    })

    await expect(adapter.restoreVersion({
      documentId: 'doc-observer-before-restore',
      versionId: first.version.versionId,
      targetDoc: current
    })).rejects.toThrow('observer failed before apply')

    const state = historyService.documents.get('doc-observer-before-restore')

    expect(current.getText('body').toString()).toBe('v1-v2')
    expect(state?.updates).toHaveLength(2)
    expect(state?.versions).toHaveLength(2)
    expect(state?.snapshots).toHaveLength(0)
    expect(state?.pendingRestore).toBeUndefined()
  })

  /** 验证 memory finalize 失败时 pending 不进入版本列表，并可由下一次 restore 完成。 */
  it('recovers a pending memory restore after finalize fails', async () => {
    const historyService = createMemoryPersistenceHistoryService()
    const adapter = createMemoryPersistenceAdapter({ historyService })
    const current = new Y.Doc()
    const text = current.getText('body')

    text.insert(0, 'v1')
    const first = await adapter.appendUpdate({
      documentId: 'doc-memory-recovery',
      update: Y.encodeStateAsUpdate(current),
      label: 'v1'
    })
    text.insert(text.length, '-v2')
    await adapter.appendUpdate({
      documentId: 'doc-memory-recovery',
      update: Y.encodeStateAsUpdate(current),
      label: 'v2'
    })
    const target = new Y.Doc()

    target.getText('body').insert(0, 'v1')

    const set = historyService.documents.set.bind(historyService.documents)
    let setCalls = 0
    /** 在第三次 state 写入时模拟 finalize 失败。 */
    historyService.documents.set = (documentId, state) => {
      setCalls += 1
      if (setCalls === 3) {
        throw new Error('memory finalize failed')
      }
      return set(documentId, state)
    }

    const firstRestore = await adapter.restoreVersion({
      documentId: 'doc-memory-recovery',
      versionId: first.version.versionId,
      targetDoc: target
    })
    const pending = historyService.documents.get('doc-memory-recovery')

    expect(firstRestore.version).toBeUndefined()
    expect(firstRestore.diagnostics).toEqual([
      expect.objectContaining({
        code: 'PERSISTENCE_RESTORE_RECOVERY_REQUIRED',
        recoverable: true
      })
    ])
    expect(pending?.pendingRestore?.phase).toBe('target-applied')
    await expect(adapter.listVersions('doc-memory-recovery')).resolves.toHaveLength(2)

    historyService.documents.set = set
    const recoveryAdapter = createMemoryPersistenceAdapter({ historyService })
    const recoveryTarget = new Y.Doc()

    recoveryTarget.getText('body').insert(0, 'v1-v2')
    const recovered = await recoveryAdapter.restoreVersion({
      documentId: 'doc-memory-recovery',
      versionId: first.version.versionId,
      targetDoc: recoveryTarget
    })
    const committed = historyService.documents.get('doc-memory-recovery')

    expect(recovered.diagnostics).toEqual([])
    expect(recovered.version).toMatchObject({
      restoreSourceVersionId: first.version.versionId,
      updateCount: 3
    })
    expect(committed?.pendingRestore).toBeUndefined()
    await expect(recoveryAdapter.listVersions('doc-memory-recovery')).resolves.toHaveLength(3)
    expect(recoveryTarget.getText('body').toString()).toBe('v1')
  })

  /** 验证 memory 无法取消 pending 时返回 recovery-required，而不是普通 restore failure。 */
  it('reports recovery-required when memory pending cancellation fails', async () => {
    const historyService = createMemoryPersistenceHistoryService()
    const adapter = createMemoryPersistenceAdapter({ historyService })
    const current = new Y.Doc()
    const text = current.getText('body')

    text.insert(0, 'v1')
    const first = await adapter.appendUpdate({
      documentId: 'doc-memory-cancel-failure',
      update: Y.encodeStateAsUpdate(current),
      label: 'v1'
    })
    text.insert(text.length, '-v2')
    await adapter.appendUpdate({
      documentId: 'doc-memory-cancel-failure',
      update: Y.encodeStateAsUpdate(current),
      label: 'v2'
    })

    const set = historyService.documents.set.bind(historyService.documents)
    let setCalls = 0
    /** 在第二次 state 写入时模拟 pending 取消失败。 */
    historyService.documents.set = (documentId, state) => {
      setCalls += 1
      if (setCalls === 2) {
        throw new Error('memory pending cancellation failed')
      }
      return set(documentId, state)
    }
    /** 模拟 target 事务开始前的 observer 异常。 */
    current.on('beforeTransaction', () => {
      throw new Error('observer failed before apply')
    })

    const restored = await adapter.restoreVersion({
      documentId: 'doc-memory-cancel-failure',
      versionId: first.version.versionId,
      targetDoc: current
    })
    const pending = historyService.documents.get('doc-memory-cancel-failure')

    expect(restored.version).toBeUndefined()
    expect(restored.diagnostics).toEqual([
      expect.objectContaining({
        code: 'PERSISTENCE_RESTORE_RECOVERY_REQUIRED',
        recoverable: true
      })
    ])
    expect(pending?.pendingRestore?.phase).toBe('prepared')
    expect(current.getText('body').toString()).toBe('v1-v2')

    historyService.documents.set = set
    const recovered = await adapter.restoreVersion({
      documentId: 'doc-memory-cancel-failure',
      versionId: first.version.versionId,
      targetDoc: current
    })

    expect(recovered.version).toBeUndefined()
    expect(recovered.diagnostics).toEqual([
      expect.objectContaining({ code: 'PERSISTENCE_RESTORE_FAILED' })
    ])
    expect(historyService.documents.get('doc-memory-cancel-failure')?.pendingRestore).toBeUndefined()
  })

  /** 验证 target observer 在应用后抛错时已提交恢复仍返回成功。 */
  it('returns success when a target observer throws after the prepared content was applied', async () => {
    const adapter = createMemoryPersistenceAdapter()
    const current = new Y.Doc()
    const text = current.getText('body')

    text.insert(0, 'v1')
    const first = await adapter.appendUpdate({
      documentId: 'doc-observer-restore',
      update: Y.encodeStateAsUpdate(current),
      label: 'v1'
    })
    text.insert(text.length, '-v2')
    await adapter.appendUpdate({
      documentId: 'doc-observer-restore',
      update: Y.encodeStateAsUpdate(current),
      label: 'v2'
    })
    /** 模拟 target 应用完成后的 observer 异常。 */
    current.on('afterTransaction', () => {
      throw new Error('observer failed after apply')
    })

    const restored = await adapter.restoreVersion({
      documentId: 'doc-observer-restore',
      versionId: first.version.versionId,
      targetDoc: current
    })

    expect(restored.diagnostics).toEqual([])
    expect(restored.version).toMatchObject({
      restoreSourceVersionId: first.version.versionId,
      updateCount: 3
    })
    expect(current.getText('body').toString()).toBe('v1')
    await expect(adapter.listVersions('doc-observer-restore')).resolves.toHaveLength(3)
  })

  /** 验证 logical-content hash 忽略 Yjs 编辑历史并保留文本 attributes。 */
  it('hashes logical Yjs content independently from client history and includes text attributes', () => {
    const first = new Y.Doc()
    const second = new Y.Doc()
    const withDifferentAttributes = new Y.Doc()

    first.getText('body').applyDelta([{
      insert: 'same',
      attributes: { bold: true, color: '#123456' }
    }])
    second.getText('body').applyDelta([{
      insert: 'sa',
      attributes: { color: '#123456', bold: true }
    }, {
      insert: 'me',
      attributes: { bold: true, color: '#123456' }
    }])
    withDifferentAttributes.getText('body').applyDelta([{
      insert: 'same',
      attributes: { bold: false, color: '#123456' }
    }])
    const firstMetadata = first.getMap<unknown>('metadata')
    const secondMetadata = second.getMap<unknown>('metadata')
    const differentAttributesMetadata = withDifferentAttributes.getMap<unknown>('metadata')

    firstMetadata.set('object', { z: 2, a: true })
    firstMetadata.set('binary', new Uint8Array([0, 127, 255]))
    secondMetadata.set('binary', new Uint8Array([0, 127, 255]))
    secondMetadata.set('object', { a: true, z: 2 })
    differentAttributesMetadata.set('object', { z: 2, a: true })
    differentAttributesMetadata.set('binary', new Uint8Array([0, 127, 255]))

    expect(Array.from(Y.encodeStateAsUpdate(first))).not.toEqual(Array.from(Y.encodeStateAsUpdate(second)))
    expect(hashYjsLogicalContent(first)).toBe(hashYjsLogicalContent(second))
    expect(hashYjsLogicalContent(withDifferentAttributes)).not.toBe(hashYjsLogicalContent(first))
  })

  it('keeps the latest version restorable after compaction', async () => {
    const adapter = createMemoryPersistenceAdapter()
    const source = new Y.Doc()
    const text = source.getText('body')

    text.insert(0, 'one')
    const first = await adapter.appendUpdate({
      documentId: 'doc-compact',
      update: Y.encodeStateAsUpdate(source),
      label: 'one'
    })
    text.insert(text.length, '-two')
    const second = await adapter.appendUpdate({
      documentId: 'doc-compact',
      update: Y.encodeStateAsUpdate(source),
      label: 'two'
    })
    await adapter.compact({
      documentId: 'doc-compact',
      beforeVersionId: second.version.versionId
    })

    const compacted = await adapter.loadVersion({
      documentId: 'doc-compact',
      versionId: first.version.versionId
    })
    const latest = await adapter.createPreview({
      documentId: 'doc-compact',
      versionId: second.version.versionId
    })

    expect(compacted.diagnostics).toEqual([
      expect.objectContaining({
        code: 'PERSISTENCE_VERSION_COMPACTED',
        recoverable: false
      })
    ])
    expect(latest.doc.getText('body').toString()).toBe('one-two')
  })
})

describe('@4xian/jword-persistence offline diagnostics', () => {
  it('reports IndexedDB unavailable as recoverable and never blocks callers', async () => {
    const offline = createUnavailableIndexedDbOfflineAdapter()
    const update = Y.encodeStateAsUpdate(new Y.Doc())

    await expect(offline.storeUpdate({
      documentId: 'doc-offline',
      update
    })).resolves.toMatchObject({
      ok: false,
      diagnostics: [
        {
          code: 'PERSISTENCE_INDEXEDDB_UNAVAILABLE',
          recoverable: true
        }
      ]
    })
    await expect(offline.load('doc-offline')).resolves.toMatchObject({
      updates: [],
      diagnostics: [
        {
          code: 'PERSISTENCE_INDEXEDDB_UNAVAILABLE',
          recoverable: true
        }
      ]
    })
  })
})

/** 从 state update 中读取 body 文本，避免把 projection JSON 当成真源。 */
function readBodyText(update: Uint8Array): string {
  const doc = new Y.Doc()
  Y.applyUpdate(doc, update)
  return doc.getText('body').toString()
}

/** 创建模拟 core document-store 的嵌套正文 Y.Text。 */
function createNestedBodyText(doc: Y.Doc): Y.Text {
  return createNestedFormattedRun(doc).text
}

/** 读取模拟 core document-store 的嵌套正文。 */
function readNestedBodyText(doc: Y.Doc): string {
  return readNestedFormattedRun(doc).text.toString()
}

interface MemoryPersistenceAdapterStateProbe {
  readonly documents: Map<string, MemoryPersistenceDocumentStateProbe>
}

interface MemoryPersistenceDocumentStateProbe {
  readonly updates: JWordUpdateLogRecord[]
  readonly snapshots: JWordSnapshotRecord[]
}
