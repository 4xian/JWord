/**
 * 职责：提供 storage-backed persistence history adapter，把 update log、snapshot 和版本元数据落到宿主存储。
 * 边界：只持久化 Yjs binary update/snapshot 的可序列化形态，不保存 projection JSON、不访问 IndexedDB 或 core 内部 store。
 * 协作模块：index.ts 导出公开入口，宿主可用任意 storage backend 持久化文档历史。
 * 性能/安全约束：每次公开操作按 documentId 懒加载并保存完整文档历史，适合作为生产后端 adapter 的最小契约样板。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import * as Y from 'yjs'

import { createDiagnostic } from './persistence-diagnostic.js'
import { getRestoreAppendBarrier, type RestoreAppendBarrier } from './restore-append-barrier.js'
import {
  completePreparedRestore,
  recoverCompletedRestore as recoverCompletedRestoreOperation,
  recoverPendingRestore as recoverPendingRestoreOperation
} from './restore-coordinator.js'
import { hashSha256Bytes } from './sha256.js'
import { hashYjsLogicalContent } from './yjs-logical-content.js'
import {
  createEmptyDocumentWithSharedTypes,
  prepareDocumentContent
} from './yjs-document-content.js'
import {
  assertHistoryAppendAllowed,
  createRestoreCompletion,
  createRestoreMetadata,
  createRestorePending,
  getNextHistorySequence
} from './restore-operation.js'
import {
  cloneStorageDocument,
  cloneVersion,
  copyBytes,
  decodeStorageDocument,
  encodeStorageDocument
} from './storage-history-document.js'
import type { JWordRestorePending } from './restore-operation.js'
import type { MutableHistoryDocumentState } from './storage-history-document.js'
import type {
  AppendJWordUpdateInput,
  AppendJWordUpdateResult,
  CompactJWordVersionInput,
  CompactJWordVersionResult,
  CreateJWordPreviewInput,
  CreateJWordPreviewResult,
  CreateJWordSnapshotInput,
  CreateJWordSnapshotResult,
  JWordPersistenceDiagnostic,
  JWordPersistenceSnapshotAdapter,
  JWordSnapshotDocumentSummary,
  JWordSnapshotRecord,
  JWordUpdateLogRecord,
  JWordVersionRecord,
  LoadJWordVersionInput,
  LoadJWordVersionResult,
  RestoreJWordVersionInput,
  RestoreJWordVersionResult
} from './index.js'

export interface JWordHistoryStorageDocument {
  readonly documentId: string
  readonly updates: readonly JWordSerializedUpdateLogRecord[]
  readonly versions: readonly JWordVersionRecord[]
  readonly snapshots: readonly JWordSerializedSnapshotRecord[]
  readonly pendingRestore?: JWordHistoryStoragePendingRestore
  readonly completedRestore?: JWordHistoryStorageCompletedRestore
  readonly revision?: string
}

export interface JWordHistoryStoragePendingRestore {
  readonly operationId: string
  readonly phase: 'prepared' | 'target-applied'
  readonly sourceVersionId: string
  readonly targetBeforeHash: string
  readonly preparedHash: string
  readonly update: JWordSerializedUpdateLogRecord
  readonly version: JWordVersionRecord
}

export interface JWordHistoryStorageCompletedRestore {
  readonly operationId: string
  readonly sourceVersionId: string
  readonly preparedHash: string
  readonly version: JWordVersionRecord
}

export interface JWordHistoryStorageCompareAndSwapResult {
  readonly committed: boolean
}

export interface JWordHistoryStorage {
  /** 读取指定文档已持久化的历史状态。 */
  loadDocument(documentId: string): Promise<JWordHistoryStorageDocument | null>

  /** 保存指定文档的完整历史状态。 */
  saveDocument(documentId: string, document: JWordHistoryStorageDocument): Promise<void>

  /** 仅在 revision 匹配时一次保存完整历史；backend 必须生成新的 opaque revision。 */
  compareAndSwapDocument?(
    documentId: string,
    expectedRevision: string | null,
    document: JWordHistoryStorageDocument
  ): Promise<JWordHistoryStorageCompareAndSwapResult>
}

export interface JWordSerializedUpdateLogRecord extends Omit<JWordUpdateLogRecord, 'update' | 'stateVector'> {
  readonly updateBase64: string
  readonly stateVectorBase64: string
}

export interface JWordSerializedSnapshotRecord extends Omit<JWordSnapshotRecord, 'stateUpdate' | 'stateVector'> {
  readonly stateUpdateBase64: string
  readonly stateVectorBase64: string
}

export interface CreateStoragePersistenceAdapterOptions {
  readonly storage: JWordHistoryStorage
}

/** 创建基于宿主 storage backend 的 persistence adapter。 */
export function createStoragePersistenceAdapter(
  options: CreateStoragePersistenceAdapterOptions
): JWordPersistenceSnapshotAdapter {
  return new StoragePersistenceAdapter(options.storage)
}

/** 创建测试和本地 demo 可用的易失 storage backend。 */
export function createVolatileHistoryStorage(): JWordHistoryStorage {
  return new VolatileHistoryStorage()
}

class VolatileHistoryStorage implements JWordHistoryStorage {
  private readonly documents = new Map<string, JWordHistoryStorageDocument>()
  private nextRevision = 1

  /** 从易失 Map 中读取文档历史副本。 */
  async loadDocument(documentId: string): Promise<JWordHistoryStorageDocument | null> {
    const document = this.documents.get(documentId)

    return document === undefined ? null : cloneStorageDocument(document)
  }

  /** 把文档历史副本保存进易失 Map。 */
  async saveDocument(documentId: string, document: JWordHistoryStorageDocument): Promise<void> {
    this.documents.set(documentId, {
      ...cloneStorageDocument(document),
      revision: this.createRevision()
    })
  }

  /** revision 匹配时一次替换易失历史文档。 */
  async compareAndSwapDocument(
    documentId: string,
    expectedRevision: string | null,
    document: JWordHistoryStorageDocument
  ): Promise<JWordHistoryStorageCompareAndSwapResult> {
    const currentRevision = this.documents.get(documentId)?.revision ?? null

    if (currentRevision !== expectedRevision) {
      return { committed: false }
    }

    const revision = this.createRevision()
    this.documents.set(documentId, {
      ...cloneStorageDocument(document),
      revision
    })
    return { committed: true }
  }

  /** 生成只对当前 backend 实例有意义的 opaque revision。 */
  private createRevision(): string {
    const revision = `revision-${this.nextRevision}`

    this.nextRevision += 1
    return revision
  }
}

class StoragePersistenceAdapter implements JWordPersistenceSnapshotAdapter {
  private readonly restoreAppendBarrier: RestoreAppendBarrier

  /** 绑定宿主提供的持久化 storage。 */
  constructor(private readonly storage: JWordHistoryStorage) {
    this.restoreAppendBarrier = getRestoreAppendBarrier(storage)
  }

  /** 追加一条 Yjs update 并持久化版本元数据。 */
  async appendUpdate(input: AppendJWordUpdateInput): Promise<AppendJWordUpdateResult> {
    return this.restoreAppendBarrier.runAppend(
      input.documentId,
      () => this.appendUpdateWithoutRestoreOverlap(input)
    )
  }

  /** 在 restore 屏障内追加 update 与版本。 */
  private async appendUpdateWithoutRestoreOverlap(input: AppendJWordUpdateInput): Promise<AppendJWordUpdateResult> {
    const state = await this.loadState(input.documentId)

    assertHistoryAppendAllowed(state.pendingRestore)
    const sequence = getNextHistorySequence(state.updates)
    const versionId = `version-${sequence}`
    const createdAt = input.createdAt ?? new Date().toISOString()
    const updateBytes = copyBytes(input.update)
    const stateVector = encodeStateVectorFromUpdate(updateBytes)
    const sha256 = hashSha256Bytes(updateBytes)
    const update: JWordUpdateLogRecord = {
      updateId: `update-${sequence}`,
      documentId: input.documentId,
      versionId,
      update: updateBytes,
      byteLength: updateBytes.byteLength,
      sha256,
      stateVector,
      createdAt,
      sequence,
      ...(input.roomId === undefined ? {} : { roomId: input.roomId }),
      ...(input.clientId === undefined ? {} : { clientId: input.clientId }),
      ...(input.label === undefined ? {} : { label: input.label }),
      ...(input.authorId === undefined ? {} : { authorId: input.authorId }),
      ...(input.origin === undefined ? {} : { origin: input.origin })
    }
    const version: JWordVersionRecord = {
      versionId,
      documentId: input.documentId,
      createdAt,
      updateCount: sequence,
      byteLength: update.byteLength,
      sha256,
      stateVector: copyBytes(stateVector),
      ...(input.roomId === undefined ? {} : { roomId: input.roomId }),
      ...(input.clientId === undefined ? {} : { clientId: input.clientId }),
      ...(input.label === undefined ? {} : { label: input.label }),
      ...(input.authorId === undefined ? {} : { authorId: input.authorId }),
      ...(input.origin === undefined ? {} : { origin: input.origin })
    }

    state.updates.push(update)
    state.versions.push(version)
    await this.saveState(state)

    return {
      update,
      version,
      diagnostics: []
    }
  }

  /** 为指定版本创建持久化 snapshot，并回写 version/update 元数据。 */
  async createSnapshot(input: CreateJWordSnapshotInput): Promise<CreateJWordSnapshotResult> {
    const loaded = await this.loadVersion(input)

    if (loaded.version === undefined) {
      return {
        snapshot: createEmptySnapshotRecord(input),
        version: createMissingVersion(input),
        diagnostics: loaded.diagnostics
      }
    }

    const state = await this.loadState(input.documentId)
    const stateUpdate = copyBytes(loaded.update)
    const stateVector = encodeStateVectorFromUpdate(stateUpdate)
    const sha256 = hashSha256Bytes(stateUpdate)
    const baseUpdate = state.updates.find((update) => update.sequence === loaded.version?.updateCount)
    const snapshot: JWordSnapshotRecord = {
      snapshotId: input.snapshotId ?? `snapshot-${state.snapshots.length + 1}`,
      documentId: input.documentId,
      versionId: input.versionId,
      stateUpdate,
      byteLength: stateUpdate.byteLength,
      updateByteLength: stateUpdate.byteLength,
      sha256,
      stateVector,
      createdAt: input.createdAt ?? new Date().toISOString(),
      updateCount: loaded.version.updateCount,
      documentSummary: buildDocumentSummary(stateUpdate, loaded.version.updateCount),
      ...(baseUpdate === undefined ? {} : { baseUpdateId: baseUpdate.updateId }),
      ...(loaded.version.roomId === undefined ? {} : { roomId: loaded.version.roomId }),
      ...(loaded.version.clientId === undefined ? {} : { clientId: loaded.version.clientId }),
      ...(input.label === undefined ? {} : { label: input.label }),
      ...(loaded.version.authorId === undefined ? {} : { authorId: loaded.version.authorId }),
      ...(loaded.version.origin === undefined ? {} : { origin: loaded.version.origin })
    }
    const version: JWordVersionRecord = {
      ...loaded.version,
      snapshotId: snapshot.snapshotId,
      byteLength: snapshot.byteLength,
      sha256,
      stateVector: copyBytes(stateVector)
    }

    state.snapshots.push(snapshot)
    replaceVersion(state, version)
    if (baseUpdate !== undefined) {
      linkUpdateToSnapshot(state, baseUpdate.updateId, snapshot.snapshotId)
    }
    await this.saveState(state)

    return {
      snapshot,
      version,
      diagnostics: loaded.diagnostics
    }
  }

  /** 按 documentId 列出持久化版本元数据。 */
  async listVersions(documentId: string): Promise<readonly JWordVersionRecord[]> {
    const state = await this.loadState(documentId)

    return state.versions.map(cloneVersion)
  }

  /** 从持久化 update log 和 snapshot 加载指定版本 state update。 */
  async loadVersion(input: LoadJWordVersionInput): Promise<LoadJWordVersionResult> {
    const state = await this.loadState(input.documentId)
    return loadVersionFromState(state, input)
  }

  /** 创建隔离 Y.Doc 只读预览。 */
  async createPreview(input: CreateJWordPreviewInput): Promise<CreateJWordPreviewResult> {
    const loaded = await this.loadVersion(input)
    const doc = new Y.Doc()

    if (loaded.version !== undefined && loaded.diagnostics.every((diagnostic) => diagnostic.recoverable)) {
      Y.applyUpdate(doc, loaded.update)
    }

    return {
      doc,
      update: loaded.update,
      diagnostics: loaded.diagnostics,
      ...(loaded.version === undefined ? {} : { version: loaded.version })
    }
  }

  /** 恢复指定历史版本，成功后追加 restore 版本记录并持久化。 */
  async restoreVersion(input: RestoreJWordVersionInput): Promise<RestoreJWordVersionResult> {
    return this.restoreAppendBarrier.runRestore<RestoreJWordVersionResult>(
      input.documentId,
      () => ({ diagnostics: [createDiagnostic('PERSISTENCE_RESTORE_FAILED', input.documentId, input.versionId)] }),
      () => this.restoreVersionWithoutAppendOverlap(input)
    )
  }

  /** 在 append 屏障内执行 restore pending/finalize/recovery。 */
  private async restoreVersionWithoutAppendOverlap(
    input: RestoreJWordVersionInput
  ): Promise<RestoreJWordVersionResult> {
    const compareAndSwap = this.storage.compareAndSwapDocument
    let state: MutableHistoryDocumentState
    let prepared: {
      readonly doc: Y.Doc
      readonly pending: JWordRestorePending
      readonly pendingState: MutableHistoryDocumentState
      readonly diagnostics: readonly JWordPersistenceDiagnostic[]
    }

    if (compareAndSwap === undefined) {
      return {
        diagnostics: [createDiagnostic('PERSISTENCE_RESTORE_FAILED', input.documentId, input.versionId)]
      }
    }

    try {
      state = await this.loadState(input.documentId)
    } catch {
      return {
        diagnostics: [createDiagnostic('PERSISTENCE_RESTORE_FAILED', input.documentId, input.versionId)]
      }
    }

    const recovered = await this.recoverPendingRestore(input, state)

    if (recovered !== undefined) {
      return recovered
    }

    const completed = recoverCompletedRestoreOperation({
      documentId: input.documentId,
      versionId: input.versionId,
      targetDoc: input.targetDoc,
      completion: state.completedRestore,
      latestUpdate: state.updates.at(-1),
      latestVersion: state.versions.at(-1),
      origin: input.origin ?? 'version-restore'
    })

    if (completed !== undefined) {
      return completed
    }

    try {
      const loaded = loadVersionFromState(state, input)

      if (loaded.version === undefined || loaded.diagnostics.some((diagnostic) => !diagnostic.recoverable)) {
        return {
          diagnostics: loaded.diagnostics
        }
      }
      if (state.revision === undefined) {
        return {
          diagnostics: [createDiagnostic('PERSISTENCE_RESTORE_FAILED', input.documentId, input.versionId)]
        }
      }

      const beforeTargetHash = hashYjsLogicalContent(input.targetDoc)
      const previewDoc = new Y.Doc()

      Y.applyUpdate(previewDoc, loaded.update)
      const doc = prepareDocumentContent(
        input.targetDoc,
        previewDoc,
        state.updates.map((update) => update.update),
        input.origin ?? 'version-restore'
      )
      const hash = hashYjsLogicalContent(doc)
      const restore = this.prepareRestoreState(input, state, doc, loaded.version)
      const pending = createRestorePending({
        sourceVersionId: loaded.version.versionId,
        targetBeforeHash: beforeTargetHash,
        preparedHash: hash,
        update: restore.update,
        version: restore.version
      })
      const committedDoc = createEmptyDocumentWithSharedTypes(doc)

      Y.applyUpdate(committedDoc, restore.update.update)
      if (hashYjsLogicalContent(committedDoc) !== hash) {
        throw new Error('prepared 与 committed storage history 的逻辑内容不一致')
      }

      prepared = {
        doc,
        pending,
        pendingState: {
          documentId: state.documentId,
          updates: [...state.updates],
          versions: [...state.versions],
          snapshots: [...state.snapshots],
          pendingRestore: pending,
          ...(state.revision === undefined ? {} : { revision: state.revision })
        },
        diagnostics: loaded.diagnostics
      }
    } catch {
      return {
        diagnostics: [createDiagnostic('PERSISTENCE_RESTORE_FAILED', input.documentId, input.versionId)]
      }
    }

    let committed: JWordHistoryStorageCompareAndSwapResult

    try {
      committed = await compareAndSwap.call(
        this.storage,
        input.documentId,
        state.revision ?? null,
        encodeStorageDocument(prepared.pendingState)
      )
    } catch {
      return {
        diagnostics: [createDiagnostic('PERSISTENCE_RESTORE_FAILED', input.documentId, input.versionId)]
      }
    }

    if (!committed.committed) {
      return {
        diagnostics: [createDiagnostic('PERSISTENCE_RESTORE_FAILED', input.documentId, input.versionId)]
      }
    }

    try {
      prepared = {
        ...prepared,
        pendingState: await this.loadState(input.documentId)
      }
    } catch {
      return {
        diagnostics: [createDiagnostic('PERSISTENCE_RESTORE_RECOVERY_REQUIRED', input.documentId, input.versionId)]
      }
    }

    if (
      prepared.pendingState.pendingRestore?.operationId !== prepared.pending.operationId
      || prepared.pendingState.pendingRestore.phase !== 'prepared'
      || prepared.pendingState.revision === undefined
    ) {
      return {
        diagnostics: [createDiagnostic('PERSISTENCE_RESTORE_RECOVERY_REQUIRED', input.documentId, input.versionId)]
      }
    }

    return completePreparedRestore({
      documentId: input.documentId,
      versionId: input.versionId,
      targetDoc: input.targetDoc,
      preparedDoc: prepared.doc,
      pending: prepared.pending,
      state: prepared.pendingState,
      origin: input.origin ?? 'version-restore',
      successDiagnostics: prepared.diagnostics,
      /** 取消 target 应用前失败的 storage pending。 */
      cancelPending: (currentState) => this.cancelPendingRestore(input.documentId, currentState),
      /** 通过 storage CAS 持久化 target-applied phase。 */
      markTargetApplied: (currentState, pending) => this.markPendingTargetApplied(
        input.documentId,
        currentState,
        pending
      ),
      /** finalize storage pending 到普通历史。 */
      finalizePending: (currentState, pending) => this.finalizePendingRestore(
        input.documentId,
        currentState,
        pending
      )
    })
  }

  /** 创建 compaction snapshot，并把边界前版本标记为 compacted。 */
  async compact(input: CompactJWordVersionInput): Promise<CompactJWordVersionResult> {
    const state = await this.loadState(input.documentId)
    const boundary = state.versions.find((version) => version.versionId === input.beforeVersionId)

    if (boundary === undefined) {
      return {
        compactedVersions: [],
        diagnostics: [createDiagnostic('PERSISTENCE_VERSION_NOT_FOUND', input.documentId, input.beforeVersionId)]
      }
    }

    const snapshot = await this.createSnapshot({
      documentId: input.documentId,
      versionId: input.beforeVersionId,
      ...(input.snapshotId === undefined ? {} : { snapshotId: input.snapshotId }),
      ...(input.createdAt === undefined ? {} : { createdAt: input.createdAt })
    })
    const nextState = await this.loadState(input.documentId)
    const compacted = nextState.versions
      .filter((version) => version.updateCount < boundary.updateCount && version.compacted !== true)
      .map((version) => ({
        ...version,
        compacted: true
      }))

    for (const version of compacted) {
      replaceVersion(nextState, version)
    }
    await this.saveState(nextState)

    return {
      snapshot: snapshot.snapshot,
      compactedVersions: compacted,
      diagnostics: snapshot.diagnostics
    }
  }

  /** 从 storage 读取并解码文档历史状态。 */
  private async loadState(documentId: string): Promise<MutableHistoryDocumentState> {
    const document = await this.storage.loadDocument(documentId)

    return document === null
      ? {
          documentId,
          updates: [],
          versions: [],
          snapshots: []
        }
      : decodeStorageDocument(document)
  }

  /** 编码并保存文档历史状态。 */
  private async saveState(state: MutableHistoryDocumentState): Promise<void> {
    await this.storage.saveDocument(state.documentId, encodeStorageDocument(state))
  }

  /** 在临时 state 中准备一次完整 restore update 与版本记录。 */
  private prepareRestoreState(
    input: RestoreJWordVersionInput,
    state: MutableHistoryDocumentState,
    preparedDoc: Y.Doc,
    sourceVersion: JWordVersionRecord
  ): { readonly update: JWordUpdateLogRecord, readonly version: JWordVersionRecord } {
    return createRestoreMetadata({
      documentId: input.documentId,
      sequence: getNextHistorySequence(state.updates),
      preparedDoc,
      sourceVersion,
      input
    })
  }

  /** 检查并完成上一次未 finalize 的 pending restore。 */
  private async recoverPendingRestore(
    input: RestoreJWordVersionInput,
    state: MutableHistoryDocumentState
  ): Promise<RestoreJWordVersionResult | undefined> {
    const pending = state.pendingRestore

    if (pending === undefined) {
      return undefined
    }

    return recoverPendingRestoreOperation({
      documentId: input.documentId,
      versionId: input.versionId,
      targetDoc: input.targetDoc,
      pending,
      state,
      origin: input.origin ?? 'version-restore',
      /** 取消 target 尚未应用的 storage pending。 */
      cancelPending: (currentState) => this.cancelPendingRestore(input.documentId, currentState),
      /** 通过 storage CAS 持久化 recovery 的 target-applied phase。 */
      markTargetApplied: (currentState, appliedPending) => this.markPendingTargetApplied(
        input.documentId,
        currentState,
        appliedPending
      ),
      /** finalize storage recovery pending 到普通历史。 */
      finalizePending: (currentState, appliedPending) => this.finalizePendingRestore(
        input.documentId,
        currentState,
        appliedPending
      )
    })
  }

  /** 用 restore 专用 CAS 持久化 target 已应用阶段，并 reload 新 revision。 */
  private async markPendingTargetApplied(
    documentId: string,
    state: MutableHistoryDocumentState,
    pending: JWordRestorePending
  ): Promise<MutableHistoryDocumentState | undefined> {
    const compareAndSwap = this.storage.compareAndSwapDocument

    if (compareAndSwap === undefined || state.revision === undefined) {
      return undefined
    }

    try {
      const result = await compareAndSwap.call(
        this.storage,
        documentId,
        state.revision,
        encodeStorageDocument({
          documentId: state.documentId,
          updates: [...state.updates],
          versions: [...state.versions],
          snapshots: [...state.snapshots],
          pendingRestore: pending,
          revision: state.revision
        })
      )

      if (!result.committed) {
        return undefined
      }

      const appliedState = await this.loadState(documentId)

      return appliedState.pendingRestore?.operationId === pending.operationId
        && appliedState.pendingRestore.phase === 'target-applied'
        && appliedState.revision !== undefined
        ? appliedState
        : undefined
    } catch {
      return undefined
    }
  }

  /** 取消 target 应用前失败的 pending restore。 */
  private async cancelPendingRestore(
    documentId: string,
    state: MutableHistoryDocumentState
  ): Promise<boolean> {
    const compareAndSwap = this.storage.compareAndSwapDocument

    if (compareAndSwap === undefined || state.revision === undefined) {
      return false
    }

    try {
      const result = await compareAndSwap.call(
        this.storage,
        documentId,
        state.revision,
        encodeStorageDocument({
          documentId: state.documentId,
          updates: [...state.updates],
          versions: [...state.versions],
          snapshots: [...state.snapshots],
          revision: state.revision
        })
      )

      return result.committed
    } catch {
      return false
    }
  }

  /** finalize pending restore，使其 update/version 进入普通历史列表。 */
  private async finalizePendingRestore(
    documentId: string,
    state: MutableHistoryDocumentState,
    pending: JWordRestorePending
  ): Promise<boolean> {
    const compareAndSwap = this.storage.compareAndSwapDocument

    if (compareAndSwap === undefined || state.revision === undefined) {
      return false
    }

    try {
      const result = await compareAndSwap.call(
        this.storage,
        documentId,
        state.revision,
        encodeStorageDocument({
          documentId: state.documentId,
          updates: [...state.updates, pending.update],
          versions: [...state.versions, pending.version],
          snapshots: [...state.snapshots],
          completedRestore: createRestoreCompletion(pending),
          revision: state.revision
        })
      )

      return result.committed
    } catch {
      return false
    }
  }
}

/** 从已加载 state 生成指定版本的 update 与诊断。 */
function loadVersionFromState(
  state: MutableHistoryDocumentState,
  input: LoadJWordVersionInput
): LoadJWordVersionResult {
  const version = state.versions.find((candidate) => candidate.versionId === input.versionId)

  if (version === undefined) {
    return {
      update: new Uint8Array(),
      diagnostics: [createDiagnostic('PERSISTENCE_VERSION_NOT_FOUND', input.documentId, input.versionId)]
    }
  }

  if (version.compacted === true) {
    return {
      version: cloneVersion(version),
      update: new Uint8Array(),
      diagnostics: [createDiagnostic('PERSISTENCE_VERSION_COMPACTED', input.documentId, input.versionId)]
    }
  }

  if (version.snapshotId !== undefined && !state.snapshots.some((snapshot) =>
    snapshot.snapshotId === version.snapshotId
  )) {
    return {
      version: cloneVersion(version),
      update: rebuildVersionUpdateFromLog(state, version),
      diagnostics: [
        createDiagnostic(
          'PERSISTENCE_SNAPSHOT_NOT_FOUND',
          input.documentId,
          input.versionId,
          version.snapshotId
        )
      ]
    }
  }

  return {
    version: cloneVersion(version),
    update: rebuildVersionUpdate(state, version),
    diagnostics: []
  }
}

/** 从 update 中提取 state vector，非法 update 返回空向量并交给恢复阶段诊断。 */
function encodeStateVectorFromUpdate(update: Uint8Array): Uint8Array {
  try {
    return Y.encodeStateVectorFromUpdate(update)
  } catch {
    return new Uint8Array()
  }
}

/** 为缺失版本创建空版本占位。 */
function createMissingVersion(input: CreateJWordSnapshotInput): JWordVersionRecord {
  return {
    versionId: input.versionId,
    documentId: input.documentId,
    createdAt: input.createdAt ?? new Date().toISOString(),
    updateCount: 0
  }
}

/** 为缺失版本创建空 snapshot 占位。 */
function createEmptySnapshotRecord(input: CreateJWordSnapshotInput): JWordSnapshotRecord {
  return {
    snapshotId: input.snapshotId ?? 'snapshot-missing',
    documentId: input.documentId,
    versionId: input.versionId,
    stateUpdate: new Uint8Array(),
    byteLength: 0,
    updateByteLength: 0,
    sha256: hashSha256Bytes(new Uint8Array()),
    stateVector: new Uint8Array(),
    createdAt: input.createdAt ?? new Date().toISOString(),
    updateCount: 0,
    documentSummary: {
      sharedTypeNames: [],
      updateCount: 0,
      updateByteLength: 0
    },
    ...(input.label === undefined ? {} : { label: input.label })
  }
}

/** 从 state update 构造最小文档摘要。 */
function buildDocumentSummary(update: Uint8Array, updateCount: number): JWordSnapshotDocumentSummary {
  const doc = new Y.Doc()

  try {
    Y.applyUpdate(doc, update)
    return {
      sharedTypeNames: Array.from(doc.share.keys()).sort(),
      updateCount,
      updateByteLength: update.byteLength
    }
  } catch {
    return {
      sharedTypeNames: [],
      updateCount,
      updateByteLength: update.byteLength
    }
  } finally {
    doc.destroy()
  }
}

/** 替换版本数组中的同 ID 元数据。 */
function replaceVersion(state: MutableHistoryDocumentState, version: JWordVersionRecord): void {
  const index = state.versions.findIndex((candidate) => candidate.versionId === version.versionId)

  if (index >= 0) {
    state.versions.splice(index, 1, version)
  }
}

/** 把 snapshotId 反向写入 update log 记录。 */
function linkUpdateToSnapshot(state: MutableHistoryDocumentState, updateId: string, snapshotId: string): void {
  const index = state.updates.findIndex((update) => update.updateId === updateId)
  const update = state.updates[index]

  if (index >= 0 && update !== undefined) {
    state.updates.splice(index, 1, {
      ...update,
      snapshotId
    })
  }
}

/** 从最近 snapshot 加 tail updates 重建指定版本。 */
function rebuildVersionUpdate(state: MutableHistoryDocumentState, version: JWordVersionRecord): Uint8Array {
  const nearestSnapshot = state.snapshots
    .filter((snapshot) => snapshot.updateCount <= version.updateCount)
    .sort((left, right) => right.updateCount - left.updateCount)[0]
  const doc = new Y.Doc()

  if (nearestSnapshot !== undefined) {
    Y.applyUpdate(doc, nearestSnapshot.stateUpdate)
  }

  for (const update of state.updates) {
    if (update.sequence > version.updateCount) {
      continue
    }
    if (nearestSnapshot !== undefined && update.sequence <= nearestSnapshot.updateCount) {
      continue
    }
    Y.applyUpdate(doc, update.update)
  }

  return Y.encodeStateAsUpdate(doc)
}

/** 只从 update log 重建版本，用于 snapshot 缺失降级路径。 */
function rebuildVersionUpdateFromLog(state: MutableHistoryDocumentState, version: JWordVersionRecord): Uint8Array {
  const doc = new Y.Doc()

  for (const update of state.updates) {
    if (update.sequence <= version.updateCount) {
      Y.applyUpdate(doc, update.update)
    }
  }

  return Y.encodeStateAsUpdate(doc)
}
