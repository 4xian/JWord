/**
 * 职责：导出 Gate 6 persistence 包的 update log、snapshot、preview、restore 和离线 adapter 契约。
 * 边界：只保存 Yjs binary update/snapshot，IndexedDB 仅通过独立 adapter 接入，不保存 projection JSON、不访问 core 内部 store。
 * 协作模块：Yjs update API、后续 collab provider、offline recovery 和 editor restore transaction 通过此入口协作。
 * 性能/安全约束：内存实现仅用于 contract tests 和后续 adapter 对齐，preview 与 restore 构建必须使用隔离 Y.Doc。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#iteration-5---update-logsnapshot-和版本历史step-66--613。
 */

import * as Y from 'yjs'
import {
  PERSISTENCE_DIAGNOSTIC_CODE_METADATA
} from './diagnostics.js'
import { hashSha256Bytes } from './sha256.js'
import type {
  JWordPersistenceDiagnosticCode,
  JWordPersistenceDiagnosticSeverity
} from './diagnostics.js'

export {
  PERSISTENCE_DIAGNOSTIC_CODE_METADATA
} from './diagnostics.js'
export {
  createIndexedDbOfflineAdapter
} from './indexeddb-adapter.js'
export {
  createStoragePersistenceAdapter,
  createVolatileHistoryStorage
} from './storage-history-adapter.js'
export type {
  JWordPersistenceDiagnosticCode,
  JWordPersistenceDiagnosticCodeMetadata,
  JWordPersistenceDiagnosticSeverity
} from './diagnostics.js'
export type {
  ClearIndexedDbOfflineDataResult,
  CreateIndexedDbOfflineAdapterOptions,
  JWordIndexedDbOfflineAdapter,
  JWordIndexedDbOfflineState,
  JWordIndexedDbOfflineStatus,
  JWordPersistenceDiagnosticListener
} from './indexeddb-adapter.js'
export type {
  CreateStoragePersistenceAdapterOptions,
  JWordHistoryStorage,
  JWordHistoryStorageDocument,
  JWordSerializedSnapshotRecord,
  JWordSerializedUpdateLogRecord
} from './storage-history-adapter.js'

/** persistence 与版本历史公开诊断载荷。 */
export interface JWordPersistenceDiagnostic {
  readonly code: JWordPersistenceDiagnosticCode
  readonly severity: JWordPersistenceDiagnosticSeverity
  readonly message: string
  readonly recoverable: boolean
  readonly fallback?: string
  readonly documentId?: string
  readonly versionId?: string
  readonly snapshotId?: string
}

export interface JWordUpdateLogRecord {
  readonly updateId: string
  readonly documentId: string
  readonly versionId: string
  readonly roomId?: string
  readonly clientId?: string
  readonly update: Uint8Array
  readonly byteLength: number
  readonly sha256: string
  readonly stateVector: Uint8Array
  readonly createdAt: string
  readonly label?: string
  readonly authorId?: string
  readonly origin?: string
  readonly sequence: number
  readonly snapshotId?: string
}

export interface JWordSnapshotDocumentSummary {
  readonly sharedTypeNames: readonly string[]
  readonly updateCount: number
  readonly updateByteLength: number
}

export interface JWordSnapshotRecord {
  readonly snapshotId: string
  readonly documentId: string
  readonly versionId: string
  readonly roomId?: string
  readonly clientId?: string
  readonly stateUpdate: Uint8Array
  readonly byteLength: number
  readonly updateByteLength: number
  readonly sha256: string
  readonly stateVector: Uint8Array
  readonly createdAt: string
  readonly label?: string
  readonly authorId?: string
  readonly origin?: string
  readonly updateCount: number
  readonly baseUpdateId?: string
  readonly documentSummary: JWordSnapshotDocumentSummary
}

/** 对外展示的版本历史记录元数据，不携带完整 update 内容。 */
export interface JWordVersionRecord {
  readonly versionId: string
  readonly documentId: string
  readonly roomId?: string
  readonly clientId?: string
  readonly createdAt: string
  readonly updateCount: number
  readonly label?: string
  readonly authorId?: string
  readonly origin?: string
  readonly byteLength?: number
  readonly sha256?: string
  readonly stateVector?: Uint8Array
  readonly snapshotId?: string
  readonly restoreSourceVersionId?: string
  readonly compacted?: boolean
}

export interface AppendJWordUpdateInput {
  readonly documentId: string
  readonly roomId?: string
  readonly clientId?: string
  readonly update: Uint8Array
  readonly label?: string
  readonly authorId?: string
  readonly origin?: string
  readonly createdAt?: string
}

export interface AppendJWordUpdateResult {
  readonly update: JWordUpdateLogRecord
  readonly version: JWordVersionRecord
  readonly diagnostics: readonly JWordPersistenceDiagnostic[]
}

export interface CreateJWordSnapshotInput {
  readonly documentId: string
  readonly versionId: string
  readonly snapshotId?: string
  readonly label?: string
  readonly createdAt?: string
}

export interface CreateJWordSnapshotResult {
  readonly snapshot: JWordSnapshotRecord
  readonly version: JWordVersionRecord
  readonly diagnostics: readonly JWordPersistenceDiagnostic[]
}

export interface LoadJWordVersionInput {
  readonly documentId: string
  readonly versionId: string
}

export interface LoadJWordVersionResult {
  readonly version?: JWordVersionRecord
  readonly update: Uint8Array
  readonly diagnostics: readonly JWordPersistenceDiagnostic[]
}

export interface CreateJWordPreviewInput {
  readonly documentId: string
  readonly versionId: string
}

export interface CreateJWordPreviewResult {
  readonly version?: JWordVersionRecord
  readonly doc: Y.Doc
  readonly update: Uint8Array
  readonly diagnostics: readonly JWordPersistenceDiagnostic[]
}

export interface RestoreJWordVersionInput {
  readonly documentId: string
  readonly versionId: string
  readonly targetDoc: Y.Doc
  readonly origin?: string
}

export interface RestoreJWordVersionResult {
  readonly version?: JWordVersionRecord
  readonly diagnostics: readonly JWordPersistenceDiagnostic[]
}

export interface CompactJWordVersionInput {
  readonly documentId: string
  readonly beforeVersionId: string
  readonly snapshotId?: string
  readonly createdAt?: string
}

export interface CompactJWordVersionResult {
  readonly snapshot?: JWordSnapshotRecord
  readonly compactedVersions: readonly JWordVersionRecord[]
  readonly diagnostics: readonly JWordPersistenceDiagnostic[]
}

/** 宿主侧版本历史、预览、恢复和压缩的公开 adapter contract。 */
export interface JWordPersistenceSnapshotAdapter {
  /** 追加一条 Yjs update 并生成版本记录。 */
  appendUpdate(input: AppendJWordUpdateInput): Promise<AppendJWordUpdateResult>

  /** 为指定版本创建可复用 snapshot。 */
  createSnapshot(input: CreateJWordSnapshotInput): Promise<CreateJWordSnapshotResult>

  /** 列出指定文档的版本元数据。 */
  listVersions(documentId: string): Promise<readonly JWordVersionRecord[]>

  /** 加载指定版本的 state update。 */
  loadVersion(input: LoadJWordVersionInput): Promise<LoadJWordVersionResult>

  /** 创建隔离 Y.Doc 预览。 */
  createPreview(input: CreateJWordPreviewInput): Promise<CreateJWordPreviewResult>

  /** 将指定版本恢复到目标 Y.Doc。 */
  restoreVersion(input: RestoreJWordVersionInput): Promise<RestoreJWordVersionResult>

  /** 压缩历史版本并保留可恢复 snapshot。 */
  compact(input: CompactJWordVersionInput): Promise<CompactJWordVersionResult>
}

export interface StoreOfflineUpdateInput {
  readonly documentId: string
  readonly update: Uint8Array
  readonly createdAt?: string
}

export interface StoreOfflineUpdateResult {
  readonly ok: boolean
  readonly diagnostics: readonly JWordPersistenceDiagnostic[]
}

export interface LoadOfflineUpdatesResult {
  readonly updates: readonly Uint8Array[]
  readonly diagnostics: readonly JWordPersistenceDiagnostic[]
}

export interface JWordOfflineAdapter {
  /** 保存离线 update 或返回可恢复诊断。 */
  storeUpdate(input: StoreOfflineUpdateInput): Promise<StoreOfflineUpdateResult>

  /** 加载离线 update 或返回可恢复诊断。 */
  load(documentId: string): Promise<LoadOfflineUpdatesResult>
}

export interface JWordMemoryPersistenceDocumentState {
  readonly updates: JWordUpdateLogRecord[]
  readonly versions: JWordVersionRecord[]
  readonly snapshots: JWordSnapshotRecord[]
}

export interface JWordMemoryPersistenceHistoryService {
  readonly documents: Map<string, JWordMemoryPersistenceDocumentState>

  /** 读取或初始化某个 document 的共享历史状态。 */
  ensureDocumentState(documentId: string): JWordMemoryPersistenceDocumentState
}

export interface CreateMemoryPersistenceAdapterOptions {
  readonly historyService?: JWordMemoryPersistenceHistoryService
}

interface MemoryDocumentState extends JWordMemoryPersistenceDocumentState {
  readonly updates: JWordUpdateLogRecord[]
  readonly versions: JWordVersionRecord[]
  readonly snapshots: JWordSnapshotRecord[]
}

type JWordYjsSharedType = Y.Doc['share'] extends Map<string, infer SharedType> ? SharedType : never

/** 创建可被多个 adapter 共享的内存 document history service。 */
export function createMemoryPersistenceHistoryService(): JWordMemoryPersistenceHistoryService {
  return new MemoryPersistenceHistoryService()
}

/** 创建只用于契约测试的内存版 persistence adapter。 */
export function createMemoryPersistenceAdapter(
  options: CreateMemoryPersistenceAdapterOptions = {}
): JWordPersistenceSnapshotAdapter {
  return new MemoryPersistenceAdapter(options.historyService ?? createMemoryPersistenceHistoryService())
}

/** 创建 IndexedDB 不可用的等价 offline adapter，用于恢复型诊断契约。 */
export function createUnavailableIndexedDbOfflineAdapter(): JWordOfflineAdapter {
  return new UnavailableIndexedDbOfflineAdapter()
}

class MemoryPersistenceHistoryService implements JWordMemoryPersistenceHistoryService {
  readonly documents = new Map<string, MemoryDocumentState>()

  /** 读取或初始化某个 document 的内存状态。 */
  ensureDocumentState(documentId: string): MemoryDocumentState {
    const existing = this.documents.get(documentId)

    if (existing !== undefined) {
      return existing
    }

    const created: MemoryDocumentState = {
      updates: [],
      versions: [],
      snapshots: []
    }
    this.documents.set(documentId, created)
    return created
  }
}

class MemoryPersistenceAdapter implements JWordPersistenceSnapshotAdapter {
  private readonly documents: Map<string, JWordMemoryPersistenceDocumentState>

  /** 绑定内存 history service，默认保持单 adapter 独立状态。 */
  constructor(private readonly historyService: JWordMemoryPersistenceHistoryService) {
    this.documents = historyService.documents
  }

  /** 追加一条 Yjs binary update 并生成一个可列出的历史版本。 */
  async appendUpdate(input: AppendJWordUpdateInput): Promise<AppendJWordUpdateResult> {
    const state = this.ensureDocumentState(input.documentId)
    const sequence = state.updates.length + 1
    const versionId = `version-${sequence}`
    const createdAt = input.createdAt ?? new Date().toISOString()
    const updateBytes = copyBytes(input.update)
    const stateVector = encodeStateVectorFromUpdate(updateBytes)
    const sha256 = hashBytes(updateBytes)
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
      sha256: update.sha256,
      stateVector: copyBytes(update.stateVector),
      ...(input.roomId === undefined ? {} : { roomId: input.roomId }),
      ...(input.clientId === undefined ? {} : { clientId: input.clientId }),
      ...(input.label === undefined ? {} : { label: input.label }),
      ...(input.authorId === undefined ? {} : { authorId: input.authorId }),
      ...(input.origin === undefined ? {} : { origin: input.origin })
    }

    state.updates.push(update)
    state.versions.push(version)

    return {
      update,
      version,
      diagnostics: []
    }
  }

  /** 将指定版本重建成 state update，并记录为 snapshot。 */
  async createSnapshot(input: CreateJWordSnapshotInput): Promise<CreateJWordSnapshotResult> {
    const loaded = await this.loadVersion(input)

    if (loaded.version === undefined) {
      return {
        snapshot: createEmptySnapshotRecord(input),
        version: createMissingVersion(input),
        diagnostics: loaded.diagnostics
      }
    }

    const state = this.ensureDocumentState(input.documentId)
    const stateUpdate = copyBytes(loaded.update)
    const stateVector = encodeStateVectorFromUpdate(stateUpdate)
    const sha256 = hashBytes(stateUpdate)
    const baseUpdate = findUpdateBySequence(state, loaded.version.updateCount)
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
      documentSummary: buildSnapshotDocumentSummary(stateUpdate, loaded.version.updateCount),
      ...(baseUpdate === undefined ? {} : { baseUpdateId: baseUpdate.updateId }),
      ...(loaded.version.roomId === undefined ? {} : { roomId: loaded.version.roomId }),
      ...(loaded.version.clientId === undefined ? {} : { clientId: loaded.version.clientId }),
      ...(input.label === undefined ? {} : { label: input.label }),
      ...(loaded.version.authorId === undefined ? {} : { authorId: loaded.version.authorId }),
      ...(loaded.version.origin === undefined ? {} : { origin: loaded.version.origin })
    }
    const version = {
      ...loaded.version,
      snapshotId: snapshot.snapshotId,
      byteLength: snapshot.byteLength,
      sha256: snapshot.sha256,
      stateVector: copyBytes(snapshot.stateVector)
    }

    state.snapshots.push(snapshot)
    replaceVersion(state, version)
    if (baseUpdate !== undefined) {
      linkUpdateToSnapshot(state, baseUpdate.updateId, snapshot.snapshotId)
    }

    return {
      snapshot,
      version,
      diagnostics: []
    }
  }

  /** 按创建顺序列出未被清理或已标记 compacted 的版本元数据。 */
  async listVersions(documentId: string): Promise<readonly JWordVersionRecord[]> {
    return this.ensureDocumentState(documentId).versions.map((version) => ({ ...version }))
  }

  /** 从 snapshot 加 tail update 或从 update log 重建指定版本的 state update。 */
  async loadVersion(input: LoadJWordVersionInput): Promise<LoadJWordVersionResult> {
    const state = this.ensureDocumentState(input.documentId)
    const version = state.versions.find((candidate) => candidate.versionId === input.versionId)

    if (version === undefined) {
      return {
        update: new Uint8Array(),
        diagnostics: [createDiagnostic('PERSISTENCE_VERSION_NOT_FOUND', input.documentId, input.versionId)]
      }
    }

    if (version.compacted === true) {
      return {
        version,
        update: new Uint8Array(),
        diagnostics: [createDiagnostic('PERSISTENCE_VERSION_COMPACTED', input.documentId, input.versionId)]
      }
    }

    if (version.snapshotId !== undefined && findSnapshotById(state, version.snapshotId) === undefined) {
      return {
        version,
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
      version,
      update: rebuildVersionUpdate(state, version),
      diagnostics: []
    }
  }

  /** 在隔离 Y.Doc 中创建只读预览数据，调用方修改 preview 不会影响当前文档。 */
  async createPreview(input: CreateJWordPreviewInput): Promise<CreateJWordPreviewResult> {
    const loaded = await this.loadVersion(input)
    const doc = new Y.Doc()

    if (loaded.version !== undefined && loaded.diagnostics.every(isRecoverableDiagnostic)) {
      Y.applyUpdate(doc, loaded.update)
    }

    return {
      doc,
      update: loaded.update,
      diagnostics: loaded.diagnostics,
      ...(loaded.version === undefined ? {} : { version: loaded.version })
    }
  }

  /** 先构建隔离预览，成功后再用单次事务替换目标文档可见内容。 */
  async restoreVersion(input: RestoreJWordVersionInput): Promise<RestoreJWordVersionResult> {
    const preview = await this.createPreview(input).catch(() => undefined)

    if (preview === undefined) {
      return {
        diagnostics: [createDiagnostic('PERSISTENCE_RESTORE_FAILED', input.documentId, input.versionId)]
      }
    }

    if (preview.version === undefined || preview.diagnostics.some(isBlockingDiagnostic)) {
      return {
        diagnostics: preview.diagnostics
      }
    }

    try {
      replaceDocumentContent(input.targetDoc, preview.doc, input.origin ?? 'jword-persistence-restore')
      const restored = await this.appendRestoreVersion(input, input.targetDoc, preview.version)
      return {
        version: restored,
        diagnostics: preview.diagnostics
      }
    } catch {
      return {
        version: preview.version,
        diagnostics: [createDiagnostic('PERSISTENCE_RESTORE_FAILED', input.documentId, input.versionId)]
      }
    }
  }

  /** 将 compaction 边界版本保存为 snapshot，并把更早版本标记为不可恢复。 */
  async compact(input: CompactJWordVersionInput): Promise<CompactJWordVersionResult> {
    const state = this.ensureDocumentState(input.documentId)
    const boundaryVersion = state.versions.find((version) => version.versionId === input.beforeVersionId)

    if (boundaryVersion === undefined || boundaryVersion.compacted === true) {
      return {
        compactedVersions: [],
        diagnostics: [createDiagnostic('PERSISTENCE_VERSION_NOT_FOUND', input.documentId, input.beforeVersionId)]
      }
    }

    const snapshotInput: CreateJWordSnapshotInput = {
      documentId: input.documentId,
      versionId: input.beforeVersionId,
      label: `compact-${input.beforeVersionId}`,
      ...(input.snapshotId === undefined ? {} : { snapshotId: input.snapshotId }),
      ...(input.createdAt === undefined ? {} : { createdAt: input.createdAt })
    }
    const snapshotResult = await this.createSnapshot(snapshotInput)
    const compacted = state.versions
      .filter((version) => version.updateCount < boundaryVersion.updateCount && version.compacted !== true)
      .map((version) => ({
        ...version,
        compacted: true
      }))

    for (const version of compacted) {
      replaceVersion(state, version)
    }

    return {
      snapshot: snapshotResult.snapshot,
      compactedVersions: compacted,
      diagnostics: snapshotResult.diagnostics
    }
  }

  /** 记录一次成功恢复产生的新版本。 */
  private appendRestoreVersion(
    input: RestoreJWordVersionInput,
    targetDoc: Y.Doc,
    sourceVersion: JWordVersionRecord
  ): JWordVersionRecord {
    const state = this.ensureDocumentState(input.documentId)
    const sequence = state.updates.length + 1
    const versionId = `version-${sequence}`
    const updateBytes = Y.encodeStateAsUpdate(targetDoc)
    const stateVector = encodeStateVectorFromUpdate(updateBytes)
    const sha256 = hashBytes(updateBytes)
    const createdAt = new Date().toISOString()
    const origin = input.origin ?? 'version-restore'
    const label = `restore:${sourceVersion.label ?? sourceVersion.versionId}`
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
      label,
      origin,
      ...(sourceVersion.roomId === undefined ? {} : { roomId: sourceVersion.roomId }),
      ...(sourceVersion.clientId === undefined ? {} : { clientId: sourceVersion.clientId }),
      ...(sourceVersion.authorId === undefined ? {} : { authorId: sourceVersion.authorId })
    }
    const version: JWordVersionRecord = {
      versionId,
      documentId: input.documentId,
      createdAt,
      updateCount: sequence,
      label,
      origin,
      byteLength: update.byteLength,
      sha256,
      stateVector: copyBytes(stateVector),
      restoreSourceVersionId: sourceVersion.versionId,
      ...(update.roomId === undefined ? {} : { roomId: update.roomId }),
      ...(update.clientId === undefined ? {} : { clientId: update.clientId }),
      ...(update.authorId === undefined ? {} : { authorId: update.authorId })
    }

    state.updates.push(update)
    state.versions.push(version)
    return version
  }

  /** 读取或初始化某个 document 的内存状态。 */
  private ensureDocumentState(documentId: string): JWordMemoryPersistenceDocumentState {
    return this.historyService.ensureDocumentState(documentId)
  }
}

class UnavailableIndexedDbOfflineAdapter implements JWordOfflineAdapter {
  /** 返回 recoverable diagnostic，模拟 IndexedDB 不可用但不阻断在线协同。 */
  async storeUpdate(input: StoreOfflineUpdateInput): Promise<StoreOfflineUpdateResult> {
    return {
      ok: false,
      diagnostics: [createDiagnostic('PERSISTENCE_INDEXEDDB_UNAVAILABLE', input.documentId)]
    }
  }

  /** 返回空 update 列表和 recoverable diagnostic，表达离线缓存不可恢复。 */
  async load(documentId: string): Promise<LoadOfflineUpdatesResult> {
    return {
      updates: [],
      diagnostics: [createDiagnostic('PERSISTENCE_INDEXEDDB_UNAVAILABLE', documentId)]
    }
  }
}

/** 判断诊断是否允许调用方使用降级结果继续预览。 */
function isRecoverableDiagnostic(diagnostic: JWordPersistenceDiagnostic): boolean {
  return diagnostic.recoverable
}

/** 判断诊断是否必须阻断 restore 写入当前文档。 */
function isBlockingDiagnostic(diagnostic: JWordPersistenceDiagnostic): boolean {
  return !diagnostic.recoverable
}

/** 复制二进制 update，避免外部继续修改已保存记录。 */
function copyBytes(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(bytes)
}

/** 从 Yjs update 中读取 state vector，非法 update 返回空向量并交给恢复阶段诊断。 */
function encodeStateVectorFromUpdate(update: Uint8Array): Uint8Array {
  try {
    return Y.encodeStateVectorFromUpdate(update)
  } catch {
    return new Uint8Array()
  }
}

/** 生成标准 SHA-256 十六进制摘要。 */
function hashBytes(bytes: Uint8Array): string {
  return hashSha256Bytes(bytes)
}

/** 用诊断 metadata 生成运行时 diagnostic。 */
function createDiagnostic(
  code: JWordPersistenceDiagnosticCode,
  documentId?: string,
  versionId?: string,
  snapshotId?: string
): JWordPersistenceDiagnostic {
  const metadata = PERSISTENCE_DIAGNOSTIC_CODE_METADATA[code]

  return {
    code,
    severity: metadata.severity,
    message: metadata.description,
    recoverable: metadata.recoverable,
    ...('fallback' in metadata ? { fallback: metadata.fallback } : {}),
    ...(documentId === undefined ? {} : { documentId }),
    ...(versionId === undefined ? {} : { versionId }),
    ...(snapshotId === undefined ? {} : { snapshotId })
  }
}

/** 为不存在的版本返回占位版本，保持 createSnapshot 失败结果结构稳定。 */
function createMissingVersion(input: CreateJWordSnapshotInput): JWordVersionRecord {
  return {
    versionId: input.versionId,
    documentId: input.documentId,
    createdAt: input.createdAt ?? new Date().toISOString(),
    updateCount: 0
  }
}

/** 为不存在的版本返回空快照占位，调用方应以 diagnostics 为准。 */
function createEmptySnapshotRecord(input: CreateJWordSnapshotInput): JWordSnapshotRecord {
  return {
    snapshotId: input.snapshotId ?? 'snapshot-missing',
    documentId: input.documentId,
    versionId: input.versionId,
    stateUpdate: new Uint8Array(),
    byteLength: 0,
    updateByteLength: 0,
    sha256: hashBytes(new Uint8Array()),
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

/** 查找指定版本边界对应的 update log 记录。 */
function findUpdateBySequence(
  state: MemoryDocumentState,
  sequence: number
): JWordUpdateLogRecord | undefined {
  return state.updates.find((update) => update.sequence === sequence)
}

/** 将 snapshot 反向挂到对应 update record，方便审计版本链路。 */
function linkUpdateToSnapshot(state: MemoryDocumentState, updateId: string, snapshotId: string): void {
  const index = state.updates.findIndex((update) => update.updateId === updateId)
  const update = state.updates[index]

  if (index >= 0 && update !== undefined) {
    state.updates.splice(index, 1, {
      ...update,
      snapshotId
    })
  }
}

/** 替换版本数组中的同 ID 版本元数据。 */
function replaceVersion(state: MemoryDocumentState, version: JWordVersionRecord): void {
  const index = state.versions.findIndex((candidate) => candidate.versionId === version.versionId)

  if (index >= 0) {
    state.versions.splice(index, 1, version)
  }
}

/** 从隔离 Y.Doc 提取 snapshot 的最小文档摘要，不把 projection JSON 作为真源保存。 */
function buildSnapshotDocumentSummary(
  stateUpdate: Uint8Array,
  updateCount: number
): JWordSnapshotDocumentSummary {
  const doc = new Y.Doc()

  try {
    Y.applyUpdate(doc, stateUpdate)
    return {
      sharedTypeNames: Array.from(doc.share.keys()).sort(),
      updateCount,
      updateByteLength: stateUpdate.byteLength
    }
  } catch {
    return {
      sharedTypeNames: [],
      updateCount,
      updateByteLength: stateUpdate.byteLength
    }
  } finally {
    doc.destroy()
  }
}

/** 根据已有 snapshot 和后续 update 重建指定版本的 state update。 */
function rebuildVersionUpdate(state: MemoryDocumentState, version: JWordVersionRecord): Uint8Array {
  const nearestSnapshot = findNearestSnapshot(state, version)
  const doc = new Y.Doc()

  if (nearestSnapshot !== undefined) {
    Y.applyUpdate(doc, nearestSnapshot.stateUpdate)
  }

  for (const record of state.updates) {
    if (record.sequence > version.updateCount) {
      continue
    }
    if (nearestSnapshot !== undefined && record.sequence <= nearestSnapshot.updateCount) {
      continue
    }
    Y.applyUpdate(doc, record.update)
  }

  return Y.encodeStateAsUpdate(doc)
}

/** 仅用 update log 重建指定版本，用于 snapshot 索引损坏时的降级恢复。 */
function rebuildVersionUpdateFromLog(state: MemoryDocumentState, version: JWordVersionRecord): Uint8Array {
  const doc = new Y.Doc()

  for (const record of state.updates) {
    if (record.sequence > version.updateCount) {
      continue
    }
    Y.applyUpdate(doc, record.update)
  }

  return Y.encodeStateAsUpdate(doc)
}

/** 按 snapshotId 查找快照记录。 */
function findSnapshotById(state: MemoryDocumentState, snapshotId: string): JWordSnapshotRecord | undefined {
  return state.snapshots.find((snapshot) => snapshot.snapshotId === snapshotId)
}

/** 找到不晚于目标版本的最近 snapshot。 */
function findNearestSnapshot(
  state: MemoryDocumentState,
  version: JWordVersionRecord
): JWordSnapshotRecord | undefined {
  return state.snapshots
    .filter((snapshot) => snapshot.updateCount <= version.updateCount)
    .sort((left, right) => right.updateCount - left.updateCount)[0]
}

/** 用 preview 文档的顶层共享类型替换目标文档的可见内容。 */
function replaceDocumentContent(targetDoc: Y.Doc, previewDoc: Y.Doc, origin: string): void {
  targetDoc.transact(() => {
    for (const name of targetDoc.share.keys()) {
      const targetType = targetDoc.share.get(name)

      if (targetType !== undefined) {
        replaceSharedType(name, targetType, previewDoc)
      }
    }

    for (const [name, previewType] of previewDoc.share) {
      if (targetDoc.share.has(name)) {
        continue
      }
      createAndFillSharedType(targetDoc, name, previewType)
    }
  }, origin)
}

/** 按 Yjs 顶层共享类型替换内容。 */
function replaceSharedType(name: string, targetType: JWordYjsSharedType, previewDoc: Y.Doc): void {
  if (isYText(targetType)) {
    const previewType = previewDoc.share.has(name) ? previewDoc.getText(name) : undefined
    targetType.delete(0, targetType.length)
    if (previewType !== undefined) {
      targetType.insert(0, previewType.toString())
    }
    return
  }

  if (isYArray(targetType)) {
    const previewType = previewDoc.share.has(name) ? previewDoc.getArray(name) : undefined
    targetType.delete(0, targetType.length)
    if (previewType !== undefined) {
      targetType.insert(0, cloneArrayValues(previewType))
    }
    return
  }

  if (isYMap(targetType)) {
    const previewType = previewDoc.share.has(name) ? previewDoc.getMap(name) : undefined
    for (const key of Array.from(targetType.keys())) {
      targetType.delete(key)
    }
    if (previewType !== undefined) {
      for (const [key, value] of previewType) {
        targetType.set(key, cloneSharedValue(value))
      }
    }
  }
}

/** 创建目标文档缺失的顶层共享类型并填充 preview 内容。 */
function createAndFillSharedType(targetDoc: Y.Doc, name: string, previewType: JWordYjsSharedType): void {
  if (isYText(previewType)) {
    targetDoc.getText(name).insert(0, previewType.toString())
    return
  }

  if (isYArray(previewType)) {
    targetDoc.getArray(name).insert(0, cloneArrayValues(previewType))
    return
  }

  if (isYMap(previewType)) {
    const target = targetDoc.getMap(name)
    for (const [key, value] of previewType) {
      target.set(key, cloneSharedValue(value))
    }
    return
  }

  const previewText = targetDoc.share.has(name) ? undefined : targetDoc.getText(name)
  if (previewText !== undefined) {
    previewText.insert(0, previewType.toString())
  }
}

/** 递归克隆 Y.Array 内容，避免把已挂载的 preview 类型插入目标文档。 */
function cloneArrayValues(array: Y.Array<unknown>): unknown[] {
  return array.toArray().map(cloneSharedValue)
}

/** 递归克隆可嵌套的 Yjs 共享类型或普通 JSON 值。 */
function cloneSharedValue(value: unknown): unknown {
  if (isYText(value)) {
    const cloned = new Y.Text()

    if (value.length > 0) {
      cloned.insert(0, value.toString())
    }

    return cloned
  }

  if (isYArray(value)) {
    const cloned = new Y.Array<unknown>()
    const values = cloneArrayValues(value)

    if (values.length > 0) {
      cloned.insert(0, values)
    }

    return cloned
  }

  if (isYMap(value)) {
    const cloned = new Y.Map<unknown>()

    for (const [key, child] of value) {
      cloned.set(key, cloneSharedValue(child))
    }

    return cloned
  }

  return value
}

/** 判断共享类型是否按 Y.Text API 工作。 */
function isYText(value: unknown): value is Y.Text {
  return value instanceof Y.Text || (
    typeof value === 'object'
    && value !== null
    && 'insert' in value
    && 'delete' in value
    && 'length' in value
    && 'toString' in value
    && !('toArray' in value)
    && !('keys' in value)
  )
}

/** 判断共享类型是否按 Y.Array API 工作。 */
function isYArray(value: unknown): value is Y.Array<unknown> {
  return value instanceof Y.Array || (
    typeof value === 'object'
    && value !== null
    && 'insert' in value
    && 'delete' in value
    && 'length' in value
    && 'toArray' in value
  )
}

/** 判断共享类型是否按 Y.Map API 工作。 */
function isYMap(value: unknown): value is Y.Map<unknown> {
  return value instanceof Y.Map || (
    typeof value === 'object'
    && value !== null
    && 'set' in value
    && 'delete' in value
    && 'keys' in value
    && Symbol.iterator in value
  )
}
