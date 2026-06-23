/**
 * 职责：提供 storage-backed persistence history adapter，把 update log、snapshot 和版本元数据落到宿主存储。
 * 边界：只持久化 Yjs binary update/snapshot 的可序列化形态，不保存 projection JSON、不访问 IndexedDB 或 core 内部 store。
 * 协作模块：index.ts 导出公开入口，宿主可用任意 storage backend 持久化文档历史。
 * 性能/安全约束：每次公开操作按 documentId 懒加载并保存完整文档历史，适合作为生产后端 adapter 的最小契约样板。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md Gate 6 Step 6.13。
 */
import * as Y from 'yjs'

import {
  PERSISTENCE_DIAGNOSTIC_CODE_METADATA
} from './diagnostics.js'
import { hashSha256Bytes } from './sha256.js'
import type {
  JWordPersistenceDiagnosticCode
} from './diagnostics.js'
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
}

export interface JWordHistoryStorage {
  /** 读取指定文档已持久化的历史状态。 */
  loadDocument(documentId: string): Promise<JWordHistoryStorageDocument | null>

  /** 保存指定文档的完整历史状态。 */
  saveDocument(documentId: string, document: JWordHistoryStorageDocument): Promise<void>
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

interface MutableHistoryDocumentState {
  readonly documentId: string
  readonly updates: JWordUpdateLogRecord[]
  readonly versions: JWordVersionRecord[]
  readonly snapshots: JWordSnapshotRecord[]
}

type JWordYjsSharedType = Y.Doc['share'] extends Map<string, infer SharedType> ? SharedType : never

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

  /** 从易失 Map 中读取文档历史副本。 */
  async loadDocument(documentId: string): Promise<JWordHistoryStorageDocument | null> {
    const document = this.documents.get(documentId)

    return document === undefined ? null : cloneStorageDocument(document)
  }

  /** 把文档历史副本保存进易失 Map。 */
  async saveDocument(documentId: string, document: JWordHistoryStorageDocument): Promise<void> {
    this.documents.set(documentId, cloneStorageDocument(document))
  }
}

class StoragePersistenceAdapter implements JWordPersistenceSnapshotAdapter {
  /** 绑定宿主提供的持久化 storage。 */
  constructor(private readonly storage: JWordHistoryStorage) {}

  /** 追加一条 Yjs update 并持久化版本元数据。 */
  async appendUpdate(input: AppendJWordUpdateInput): Promise<AppendJWordUpdateResult> {
    const state = await this.loadState(input.documentId)
    const sequence = state.updates.length + 1
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
    const preview = await this.createPreview(input).catch(() => undefined)

    if (preview === undefined) {
      return {
        diagnostics: [createDiagnostic('PERSISTENCE_RESTORE_FAILED', input.documentId, input.versionId)]
      }
    }

    if (preview.version === undefined || preview.diagnostics.some((diagnostic) => !diagnostic.recoverable)) {
      return {
        diagnostics: preview.diagnostics
      }
    }

    try {
      replaceDocumentContent(input.targetDoc, preview.doc, input.origin ?? 'version-restore')
      const appended = await this.appendUpdate({
        documentId: input.documentId,
        update: Y.encodeStateAsUpdate(input.targetDoc),
        label: `restore:${preview.version.label ?? preview.version.versionId}`,
        origin: input.origin ?? 'version-restore',
        ...(preview.version.roomId === undefined ? {} : { roomId: preview.version.roomId }),
        ...(preview.version.clientId === undefined ? {} : { clientId: preview.version.clientId }),
        ...(preview.version.authorId === undefined ? {} : { authorId: preview.version.authorId })
      })
      const state = await this.loadState(input.documentId)
      const version = {
        ...appended.version,
        restoreSourceVersionId: preview.version.versionId
      }

      replaceVersion(state, version)
      await this.saveState(state)

      return {
        version,
        diagnostics: preview.diagnostics
      }
    } catch {
      return {
        diagnostics: [createDiagnostic('PERSISTENCE_RESTORE_FAILED', input.documentId, input.versionId)]
      }
    }
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
}

/** 克隆 storage 文档，避免调用方修改内部状态。 */
function cloneStorageDocument(document: JWordHistoryStorageDocument): JWordHistoryStorageDocument {
  return {
    documentId: document.documentId,
    updates: document.updates.map((update) => ({ ...update })),
    versions: document.versions.map(cloneVersion),
    snapshots: document.snapshots.map((snapshot) => ({ ...snapshot }))
  }
}

/** 把运行时状态编码为 storage 可保存格式。 */
function encodeStorageDocument(state: MutableHistoryDocumentState): JWordHistoryStorageDocument {
  return {
    documentId: state.documentId,
    updates: state.updates.map((update) => ({
      ...update,
      updateBase64: encodeBase64(update.update),
      stateVectorBase64: encodeBase64(update.stateVector),
      update: undefined,
      stateVector: undefined
    })).map(removeUndefinedUpdateFields),
    versions: state.versions.map(cloneVersion),
    snapshots: state.snapshots.map((snapshot) => ({
      ...snapshot,
      stateUpdateBase64: encodeBase64(snapshot.stateUpdate),
      stateVectorBase64: encodeBase64(snapshot.stateVector),
      stateUpdate: undefined,
      stateVector: undefined
    })).map(removeUndefinedSnapshotFields)
  }
}

/** 从 storage 格式解码为运行时状态。 */
function decodeStorageDocument(document: JWordHistoryStorageDocument): MutableHistoryDocumentState {
  return {
    documentId: document.documentId,
    updates: document.updates.map((update) => ({
      ...update,
      update: decodeBase64(update.updateBase64),
      stateVector: decodeBase64(update.stateVectorBase64)
    })),
    versions: document.versions.map(cloneVersion),
    snapshots: document.snapshots.map((snapshot) => ({
      ...snapshot,
      stateUpdate: decodeBase64(snapshot.stateUpdateBase64),
      stateVector: decodeBase64(snapshot.stateVectorBase64)
    }))
  }
}

/** 移除序列化 update record 中临时置空的二进制字段。 */
function removeUndefinedUpdateFields(
  update: Omit<JWordUpdateLogRecord, 'update' | 'stateVector'> & {
    readonly update?: undefined
    readonly stateVector?: undefined
    readonly updateBase64: string
    readonly stateVectorBase64: string
  }
): JWordSerializedUpdateLogRecord {
  const {
    update: _update,
    stateVector: _stateVector,
    ...serialized
  } = update

  return serialized
}

/** 移除序列化 snapshot record 中临时置空的二进制字段。 */
function removeUndefinedSnapshotFields(
  snapshot: Omit<JWordSnapshotRecord, 'stateUpdate' | 'stateVector'> & {
    readonly stateUpdate?: undefined
    readonly stateVector?: undefined
    readonly stateUpdateBase64: string
    readonly stateVectorBase64: string
  }
): JWordSerializedSnapshotRecord {
  const {
    stateUpdate: _stateUpdate,
    stateVector: _stateVector,
    ...serialized
  } = snapshot

  return serialized
}

/** 克隆版本元数据中的可变二进制字段。 */
function cloneVersion(version: JWordVersionRecord): JWordVersionRecord {
  return {
    ...version,
    ...(version.stateVector === undefined ? {} : { stateVector: copyBytes(version.stateVector) })
  }
}

/** 复制二进制 update，避免外部修改持久化记录。 */
function copyBytes(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(bytes)
}

/** 从 update 中提取 state vector，非法 update 返回空向量并交给恢复阶段诊断。 */
function encodeStateVectorFromUpdate(update: Uint8Array): Uint8Array {
  try {
    return Y.encodeStateVectorFromUpdate(update)
  } catch {
    return new Uint8Array()
  }
}

/** 用诊断 metadata 创建 persistence diagnostic。 */
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

/** 用 preview 文档替换目标文档的顶层共享类型内容。 */
function replaceDocumentContent(targetDoc: Y.Doc, previewDoc: Y.Doc, origin: string): void {
  targetDoc.transact(() => {
    for (const name of targetDoc.share.keys()) {
      const targetType = targetDoc.share.get(name)

      if (targetType !== undefined) {
        replaceSharedType(name, targetType, previewDoc)
      }
    }

    for (const [name, previewType] of previewDoc.share) {
      if (!targetDoc.share.has(name)) {
        createAndFillSharedType(targetDoc, name, previewType)
      }
    }
  }, origin)
}

/** 按 preview 顶层 shared type 替换目标 shared type。 */
function replaceSharedType(name: string, targetType: JWordYjsSharedType, previewDoc: Y.Doc): void {
  if (targetType instanceof Y.Text) {
    const previewType = previewDoc.share.has(name) ? previewDoc.getText(name) : undefined

    targetType.delete(0, targetType.length)
    if (previewType !== undefined) {
      targetType.insert(0, previewType.toString())
    }
    return
  }

  if (targetType instanceof Y.Array) {
    const previewType = previewDoc.share.has(name) ? previewDoc.getArray(name) : undefined

    targetType.delete(0, targetType.length)
    if (previewType !== undefined) {
      targetType.insert(0, previewType.toArray().map(cloneSharedValue))
    }
    return
  }

  if (targetType instanceof Y.Map) {
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

/** 创建目标文档缺失的顶层 shared type。 */
function createAndFillSharedType(targetDoc: Y.Doc, name: string, previewType: JWordYjsSharedType): void {
  if (previewType instanceof Y.Text) {
    targetDoc.getText(name).insert(0, previewType.toString())
    return
  }

  if (previewType instanceof Y.Array) {
    targetDoc.getArray(name).insert(0, previewType.toArray().map(cloneSharedValue))
    return
  }

  if (previewType instanceof Y.Map) {
    const target = targetDoc.getMap(name)

    for (const [key, value] of previewType) {
      target.set(key, cloneSharedValue(value))
    }
  }
}

/** 克隆嵌套 Yjs shared type，避免把 preview 中已挂载对象直接插入目标文档。 */
function cloneSharedValue(value: unknown): unknown {
  if (value instanceof Y.Text) {
    const text = new Y.Text()

    if (value.length > 0) {
      text.insert(0, value.toString())
    }
    return text
  }

  if (value instanceof Y.Array) {
    const array = new Y.Array<unknown>()
    const values = value.toArray().map(cloneSharedValue)

    if (values.length > 0) {
      array.insert(0, values)
    }
    return array
  }

  if (value instanceof Y.Map) {
    const map = new Y.Map<unknown>()

    for (const [key, child] of value) {
      map.set(key, cloneSharedValue(child))
    }
    return map
  }

  return value
}

/** 将二进制数据编码为 base64 字符串。 */
function encodeBase64(bytes: Uint8Array): string {
  let binary = ''

  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }

  return btoa(binary)
}

/** 将 base64 字符串解码为二进制数据。 */
function decodeBase64(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  return bytes
}
