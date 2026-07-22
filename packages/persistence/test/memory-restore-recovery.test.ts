/**
 * @vitest-environment node
 *
 * 职责：验证 Memory persistence 公开 restoreVersion() 的故障恢复与单次提交语义。
 * 边界：只通过公开 adapter 和共享 history service 注入故障，不访问 package-internal coordinator。
 * 协作模块：Memory adapter、Yjs observer 与 restore pending/finalize 状态共同组成反馈环。
 * 约束：pending 不进入普通版本列表，恢复重试只能产生一个已完成 restore。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import * as Y from 'yjs'
import { describe, expect, it } from 'vitest'

import {
  createMemoryPersistenceAdapter,
  createMemoryPersistenceHistoryService
} from '../src/index'

describe('@4xian/jword-persistence memory restore recovery', () => {
  /** 验证 observer 修改 target 后保留 pending，并由同一 operation 的重试修复。 */
  it('repairs a diverged target when the pending restore is retried', async () => {
    const historyService = createMemoryPersistenceHistoryService()
    const adapter = createMemoryPersistenceAdapter({ historyService })
    const current = new Y.Doc()
    const text = current.getText('body')

    text.insert(0, 'v1')
    const first = await adapter.appendUpdate({
      documentId: 'doc-memory-observer-diverged',
      update: Y.encodeStateAsUpdate(current),
      label: 'v1'
    })
    text.insert(text.length, '-v2')
    await adapter.appendUpdate({
      documentId: 'doc-memory-observer-diverged',
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
      documentId: 'doc-memory-observer-diverged',
      versionId: first.version.versionId,
      targetDoc: current
    })
    const state = historyService.documents.get('doc-memory-observer-diverged')

    expect(restored.version).toBeUndefined()
    expect(restored.diagnostics).toEqual([
      expect.objectContaining({ code: 'PERSISTENCE_RESTORE_RECOVERY_REQUIRED' })
    ])
    expect(current.getText('body').toString()).toBe('v1-observer')
    expect(state?.versions).toHaveLength(2)
    expect(state?.pendingRestore?.phase).toBe('prepared')
    await expect(adapter.listVersions('doc-memory-observer-diverged')).resolves.toHaveLength(2)

    const recovered = await adapter.restoreVersion({
      documentId: 'doc-memory-observer-diverged',
      versionId: first.version.versionId,
      targetDoc: current
    })
    const recoveredState = historyService.documents.get('doc-memory-observer-diverged')

    expect(recovered.diagnostics).toEqual([])
    expect(recovered.version).toMatchObject({
      restoreSourceVersionId: first.version.versionId,
      updateCount: 3
    })
    expect(current.getText('body').toString()).toBe('v1')
    expect(recoveredState?.pendingRestore).toBeUndefined()
    await expect(adapter.listVersions('doc-memory-observer-diverged')).resolves.toHaveLength(3)
  })

  /** 验证 finalize 已写入但确认抛错时，重试不会追加第二个 restore。 */
  it('recognizes a committed restore after the finalize acknowledgement is lost', async () => {
    const historyService = createMemoryPersistenceHistoryService()
    const adapter = createMemoryPersistenceAdapter({ historyService })
    const current = new Y.Doc()
    const text = current.getText('body')

    text.insert(0, 'v1')
    const first = await adapter.appendUpdate({
      documentId: 'doc-memory-finalize-ack-lost',
      update: Y.encodeStateAsUpdate(current),
      label: 'v1'
    })
    text.insert(text.length, '-v2')
    await adapter.appendUpdate({
      documentId: 'doc-memory-finalize-ack-lost',
      update: Y.encodeStateAsUpdate(current),
      label: 'v2'
    })
    const set = historyService.documents.set.bind(historyService.documents)
    let throwAfterFinalize = true

    /** 在完成状态已写入 Map 后模拟 finalize 确认丢失。 */
    historyService.documents.set = (documentId, state) => {
      const result = set(documentId, state)

      if (throwAfterFinalize && state.pendingRestore === undefined && state.versions.length === 3) {
        throwAfterFinalize = false
        throw new Error('memory finalize acknowledgement lost')
      }
      return result
    }

    const firstRestore = await adapter.restoreVersion({
      documentId: 'doc-memory-finalize-ack-lost',
      versionId: first.version.versionId,
      targetDoc: current
    })

    expect(firstRestore.version).toBeUndefined()
    expect(firstRestore.diagnostics).toEqual([
      expect.objectContaining({ code: 'PERSISTENCE_RESTORE_RECOVERY_REQUIRED' })
    ])
    expect(historyService.documents.get('doc-memory-finalize-ack-lost')?.completedRestore).toMatchObject({
      sourceVersionId: first.version.versionId
    })
    await expect(adapter.listVersions('doc-memory-finalize-ack-lost')).resolves.toHaveLength(3)

    historyService.documents.set = set
    const recoveryAdapter = createMemoryPersistenceAdapter({ historyService })
    const recoveryTarget = new Y.Doc()

    recoveryTarget.getText('body').insert(0, 'v1-v2')
    const recovered = await recoveryAdapter.restoreVersion({
      documentId: 'doc-memory-finalize-ack-lost',
      versionId: first.version.versionId,
      targetDoc: recoveryTarget
    })

    expect(recovered.diagnostics).toEqual([])
    expect(recovered.version).toMatchObject({
      restoreSourceVersionId: first.version.versionId,
      updateCount: 3
    })
    expect(recoveryTarget.getText('body').toString()).toBe('v1')
    await expect(recoveryAdapter.listVersions('doc-memory-finalize-ack-lost')).resolves.toHaveLength(3)
  })

  /** 验证 pending 期间阻止 append，finalize 后追加版本的顺序与内容保持稳定。 */
  it('keeps appended version order and content stable across restore finalization', async () => {
    const historyService = createMemoryPersistenceHistoryService()
    const adapter = createMemoryPersistenceAdapter({ historyService })
    const current = new Y.Doc()
    const text = current.getText('body')

    text.insert(0, 'v1')
    const first = await adapter.appendUpdate({
      documentId: 'doc-memory-pending-append',
      update: Y.encodeStateAsUpdate(current),
      label: 'v1'
    })
    text.insert(text.length, '-v2')
    await adapter.appendUpdate({
      documentId: 'doc-memory-pending-append',
      update: Y.encodeStateAsUpdate(current),
      label: 'v2'
    })
    const set = historyService.documents.set.bind(historyService.documents)
    let failFinalize = true

    /** 在 finalize 写入前失败，保留 target-applied pending。 */
    historyService.documents.set = (documentId, state) => {
      if (failFinalize && state.pendingRestore === undefined && state.versions.length === 3) {
        throw new Error('memory finalize failed before commit')
      }
      return set(documentId, state)
    }

    const firstRestore = await adapter.restoreVersion({
      documentId: 'doc-memory-pending-append',
      versionId: first.version.versionId,
      targetDoc: current
    })
    const blockedDoc = new Y.Doc()

    blockedDoc.getText('body').insert(0, 'blocked')
    expect(firstRestore.diagnostics).toEqual([
      expect.objectContaining({ code: 'PERSISTENCE_RESTORE_RECOVERY_REQUIRED' })
    ])
    await expect(adapter.appendUpdate({
      documentId: 'doc-memory-pending-append',
      update: Y.encodeStateAsUpdate(blockedDoc),
      label: 'later'
    })).rejects.toThrow('PERSISTENCE_RESTORE_RECOVERY_REQUIRED')
    await expect(adapter.listVersions('doc-memory-pending-append')).resolves.toMatchObject([
      { versionId: 'version-1' },
      { versionId: 'version-2' }
    ])

    failFinalize = false
    historyService.documents.set = set
    const recovered = await adapter.restoreVersion({
      documentId: 'doc-memory-pending-append',
      versionId: first.version.versionId,
      targetDoc: current
    })
    current.getText('body').insert(current.getText('body').length, '-later')
    const appended = await adapter.appendUpdate({
      documentId: 'doc-memory-pending-append',
      update: Y.encodeStateAsUpdate(current),
      label: 'later'
    })
    const versions = await adapter.listVersions('doc-memory-pending-append')
    const loaded = await adapter.loadVersion({
      documentId: 'doc-memory-pending-append',
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

  /** 验证 prepared pending 期间阻止 append，取消后新 restore 连续分配版本。 */
  it('allows the next restore sequence after a prepared pending blocks append and is cancelled', async () => {
    const historyService = createMemoryPersistenceHistoryService()
    const adapter = createMemoryPersistenceAdapter({ historyService })
    const current = new Y.Doc()
    const text = current.getText('body')

    text.insert(0, 'v1')
    const first = await adapter.appendUpdate({
      documentId: 'doc-memory-pending-cancel-append',
      update: Y.encodeStateAsUpdate(current),
      label: 'v1'
    })
    text.insert(text.length, '-v2')
    await adapter.appendUpdate({
      documentId: 'doc-memory-pending-cancel-append',
      update: Y.encodeStateAsUpdate(current),
      label: 'v2'
    })
    const set = historyService.documents.set.bind(historyService.documents)
    let failCancel = true

    /** 首次取消在写入前失败，保留 prepared pending。 */
    historyService.documents.set = (documentId, state) => {
      if (failCancel && state.pendingRestore === undefined && state.versions.length === 2) {
        failCancel = false
        throw new Error('memory pending cancel failed')
      }
      return set(documentId, state)
    }
    /** 模拟 target 应用前 observer 异常。 */
    const throwBeforeApply = () => {
      throw new Error('observer failed before apply')
    }

    current.on('beforeTransaction', throwBeforeApply)
    const firstRestore = await adapter.restoreVersion({
      documentId: 'doc-memory-pending-cancel-append',
      versionId: first.version.versionId,
      targetDoc: current
    })
    const appendedDoc = new Y.Doc()

    appendedDoc.getText('body').insert(0, 'v1-later')
    await expect(adapter.appendUpdate({
      documentId: 'doc-memory-pending-cancel-append',
      update: Y.encodeStateAsUpdate(appendedDoc),
      label: 'later'
    })).rejects.toThrow('PERSISTENCE_RESTORE_RECOVERY_REQUIRED')

    expect(firstRestore.diagnostics).toEqual([
      expect.objectContaining({ code: 'PERSISTENCE_RESTORE_RECOVERY_REQUIRED' })
    ])
    historyService.documents.set = set
    current.off('beforeTransaction', throwBeforeApply)
    const cancelled = await adapter.restoreVersion({
      documentId: 'doc-memory-pending-cancel-append',
      versionId: first.version.versionId,
      targetDoc: current
    })
    const restored = await adapter.restoreVersion({
      documentId: 'doc-memory-pending-cancel-append',
      versionId: first.version.versionId,
      targetDoc: current
    })
    const versions = await adapter.listVersions('doc-memory-pending-cancel-append')

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
})

/** 从 state update 中读取 body 文本，验证公开 loadVersion() 的实际内容。 */
function readBodyText(update: Uint8Array): string {
  const doc = new Y.Doc()

  Y.applyUpdate(doc, update)
  return doc.getText('body').toString()
}
