/**
 * 职责：维护 Hocuspocus demo 中跟随 provider 同步的版本历史元数据和版本 update。
 * 边界：只把 history 附属数据写入同一 Y.Doc 的独立 shared type，不参与正文 projection、不保存 DOCX 或 projection JSON。
 * 协作：hocuspocus-runtime.ts 负责触发记录、预览和恢复，persistence 包负责更完整的 adapter 契约。
 * 约束：恢复只替换 core 文档容器，不能把 history shared type 回滚到旧版本。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import * as Y from 'yjs'
import {
  PERSISTENCE_DIAGNOSTIC_CODE_METADATA
} from '@4xian/jword-persistence'

import { readBodyTextFromUpdate } from './hocuspocus-projection'
import type {
  VersionHistoryEntry,
  VersionPreviewSnapshot
} from '../runtime'
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
  JWordPersistenceDiagnosticCode,
  JWordPersistenceSnapshotAdapter,
  JWordSnapshotDocumentSummary,
  JWordSnapshotRecord,
  JWordVersionRecord,
  LoadJWordVersionInput,
  LoadJWordVersionResult,
  RestoreJWordVersionInput,
  RestoreJWordVersionResult
} from '@4xian/jword-persistence'

export interface HocuspocusHistoryAppendInput {
  readonly document: Y.Doc
  readonly label: string
  readonly origin: string
  readonly roomId: string
  readonly documentId: string
  readonly clientId: string
  readonly authorId: string
  readonly update?: Uint8Array
}

export interface HocuspocusHistoryRestoreInput {
  readonly document: Y.Doc
  readonly versionId: string
  readonly roomId: string
  readonly documentId: string
  readonly clientId: string
  readonly authorId: string
}

export interface CreateHocuspocusHistoryPersistenceAdapterInput {
  readonly document: Y.Doc
  readonly documentId: string
  readonly roomId: string
  readonly clientId: string
  readonly authorId: string
}

interface StoredVersionRecord {
  readonly id: string
  readonly label: string
  readonly revision: number
  readonly text: string
  readonly createdAt: string
  readonly origin: string
  readonly roomId: string
  readonly documentId: string
  readonly clientId: string
  readonly authorId: string
  readonly byteLength?: number
  readonly sha256?: string
  readonly stateVector?: Uint8Array
  readonly snapshotId?: string
  readonly restoreSourceVersionId?: string
  readonly compacted?: boolean
}

type JWordYjsSharedType = Y.Doc['share'] extends Map<string, infer SharedType> ? SharedType : never

const historyVersionOrderName = 'jword:collab:history:version-order'
const historyVersionRecordsName = 'jword:collab:history:version-records'
const historyVersionUpdatesName = 'jword:collab:history:version-updates'
const historySnapshotsName = 'jword:collab:history:snapshots'
const historyTransactionOrigin = 'jword-history-index'
const coreSharedTypeNames = [
  'document',
  'sections',
  'resources',
  'styles',
  'comments',
  'commentRanges',
  'revisions'
] as const
const coreArraySharedTypeNames = new Set<string>(['sections'])

/** 创建基于 provider Y.Doc 共享类型的 persistence adapter。 */
export function createHocuspocusHistoryPersistenceAdapter(
  input: CreateHocuspocusHistoryPersistenceAdapterInput
): JWordPersistenceSnapshotAdapter {
  return new HocuspocusHistoryPersistenceAdapter(input)
}

class HocuspocusHistoryPersistenceAdapter implements JWordPersistenceSnapshotAdapter {
  /** 绑定共享 provider 文档和当前客户端默认元数据。 */
  constructor(private readonly input: CreateHocuspocusHistoryPersistenceAdapterInput) {}

  /** 追加一条 provider 共享 update log，并同步生成可列出的版本元数据。 */
  async appendUpdate(input: AppendJWordUpdateInput): Promise<AppendJWordUpdateResult> {
    const update = encodeCoreDocumentUpdateFromStateUpdate(input.update, this.input.document)
    const order = readVersionOrder(this.input.document)
    const records = readVersionRecords(this.input.document)
    const updates = readVersionUpdates(this.input.document)
    const sequence = order.length + 1
    const versionId = createVersionId(input.clientId ?? this.input.clientId, sequence)
    const stateVector = encodeStateVectorFromUpdate(update)
    const sha256 = await hashBytes(update)
    const record: StoredVersionRecord = {
      id: versionId,
      label: input.label ?? versionId,
      revision: sequence,
      text: readBodyTextFromUpdate(update),
      createdAt: input.createdAt ?? new Date().toISOString(),
      origin: input.origin ?? 'local-user',
      roomId: input.roomId ?? this.input.roomId,
      documentId: input.documentId,
      clientId: input.clientId ?? this.input.clientId,
      authorId: input.authorId ?? this.input.authorId,
      byteLength: update.byteLength,
      sha256,
      stateVector
    }

    this.input.document.transact(() => {
      order.push([versionId])
      records.set(versionId, record)
      updates.set(versionId, update)
    }, historyTransactionOrigin)

    const version = toJWordVersionRecord(record)

    return {
      update: {
        updateId: `update-${sequence}`,
        documentId: input.documentId,
        versionId,
        update,
        byteLength: update.byteLength,
        sha256,
        stateVector: new Uint8Array(stateVector),
        createdAt: record.createdAt,
        sequence,
        roomId: record.roomId,
        clientId: record.clientId,
        label: record.label,
        authorId: record.authorId,
        origin: record.origin
      },
      version,
      diagnostics: []
    }
  }

  /** 为指定版本创建 provider 共享 snapshot，并把 snapshotId 回写到版本元数据。 */
  async createSnapshot(input: CreateJWordSnapshotInput): Promise<CreateJWordSnapshotResult> {
    const loaded = await this.loadVersion(input)

    if (loaded.version === undefined || loaded.update.byteLength === 0) {
      return {
        snapshot: createEmptySnapshotRecord(input),
        version: createMissingVersion(input),
        diagnostics: loaded.diagnostics
      }
    }

    const snapshots = readVersionSnapshots(this.input.document)
    const stateUpdate = new Uint8Array(loaded.update)
    const snapshotId = input.snapshotId ?? `snapshot-${snapshots.size + 1}`
    const stateVector = encodeStateVectorFromUpdate(stateUpdate)
    const sha256 = await hashBytes(stateUpdate)
    const snapshot: JWordSnapshotRecord = {
      snapshotId,
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
      ...((input.label ?? loaded.version.label) === undefined ? {} : {
        label: input.label ?? loaded.version.label
      }),
      ...(loaded.version.roomId === undefined ? {} : { roomId: loaded.version.roomId }),
      ...(loaded.version.clientId === undefined ? {} : { clientId: loaded.version.clientId }),
      ...(loaded.version.authorId === undefined ? {} : { authorId: loaded.version.authorId }),
      ...(loaded.version.origin === undefined ? {} : { origin: loaded.version.origin })
    }
    const version = {
      ...loaded.version,
      snapshotId,
      byteLength: snapshot.byteLength,
      sha256,
      stateVector: new Uint8Array(stateVector)
    }

    this.input.document.transact(() => {
      snapshots.set(snapshotId, snapshot)
      replaceStoredVersionRecord(this.input.document, version)
    }, historyTransactionOrigin)

    return {
      snapshot,
      version,
      diagnostics: loaded.diagnostics
    }
  }

  /** 按 provider 共享顺序列出版本元数据。 */
  async listVersions(documentId: string): Promise<readonly JWordVersionRecord[]> {
    return readVersionOrder(this.input.document).toArray()
      .flatMap((id) => {
        const record = readStoredVersionRecord(readVersionRecords(this.input.document).get(id))

        return record === null || record.documentId !== documentId ? [] : [toJWordVersionRecord(record)]
      })
  }

  /** 从 provider 共享 update log 加载指定版本的 state update。 */
  async loadVersion(input: LoadJWordVersionInput): Promise<LoadJWordVersionResult> {
    const record = readStoredVersionRecord(readVersionRecords(this.input.document).get(input.versionId))

    if (record === null || record.documentId !== input.documentId) {
      return {
        update: new Uint8Array(),
        diagnostics: [createPersistenceDiagnostic('PERSISTENCE_VERSION_NOT_FOUND', input)]
      }
    }

    if (record.compacted === true) {
      return {
        version: toJWordVersionRecord(record),
        update: new Uint8Array(),
        diagnostics: [createPersistenceDiagnostic('PERSISTENCE_VERSION_COMPACTED', input)]
      }
    }

    const update = readStoredVersionUpdate(this.input.document, input.versionId)

    if (update === null) {
      return {
        version: toJWordVersionRecord(record),
        update: new Uint8Array(),
        diagnostics: [createPersistenceDiagnostic('PERSISTENCE_RESTORE_FAILED', input)]
      }
    }

    const snapshotMissing = record.snapshotId !== undefined &&
      readStoredSnapshot(this.input.document, record.snapshotId) === null

    return {
      version: toJWordVersionRecord(record),
      update,
      diagnostics: snapshotMissing
        ? [createPersistenceDiagnostic('PERSISTENCE_SNAPSHOT_NOT_FOUND', input, record.snapshotId)]
        : []
    }
  }

  /** 创建隔离 Y.Doc 预览，保证调用方修改 preview 不会影响 provider 文档。 */
  async createPreview(input: CreateJWordPreviewInput): Promise<CreateJWordPreviewResult> {
    const loaded = await this.loadVersion(input)
    const doc = new Y.Doc()

    if (
      loaded.version !== undefined &&
      loaded.update.byteLength > 0 &&
      loaded.diagnostics.every((diagnostic) => diagnostic.recoverable)
    ) {
      Y.applyUpdate(doc, loaded.update)
    }

    return {
      doc,
      update: loaded.update,
      diagnostics: loaded.diagnostics,
      ...(loaded.version === undefined ? {} : { version: loaded.version })
    }
  }

  /** 恢复指定版本；缺 update 或阻断诊断时不写当前 provider 文档。 */
  async restoreVersion(input: RestoreJWordVersionInput): Promise<RestoreJWordVersionResult> {
    const loaded = await this.loadVersion(input)

    if (
      loaded.version === undefined ||
      loaded.update.byteLength === 0 ||
      loaded.diagnostics.some((diagnostic) => !diagnostic.recoverable)
    ) {
      return {
        diagnostics: loaded.diagnostics.length > 0
          ? loaded.diagnostics
          : [createPersistenceDiagnostic('PERSISTENCE_RESTORE_FAILED', input)]
      }
    }

    try {
      restoreCoreDocumentFromUpdate(input.targetDoc, loaded.update, input.origin ?? 'version-restore')
      const restored = await this.appendUpdate({
        documentId: input.documentId,
        roomId: loaded.version.roomId ?? this.input.roomId,
        clientId: this.input.clientId,
        authorId: this.input.authorId,
        origin: input.origin ?? 'version-restore',
        label: `restore:${loaded.version.label ?? loaded.version.versionId}`,
        update: encodeCoreDocumentStateAsUpdate(input.targetDoc)
      })
      const version = {
        ...restored.version,
        restoreSourceVersionId: loaded.version.versionId
      }

      replaceStoredVersionRecord(this.input.document, version)

      return {
        version,
        diagnostics: loaded.diagnostics
      }
    } catch {
      return {
        diagnostics: [createPersistenceDiagnostic('PERSISTENCE_RESTORE_FAILED', input)]
      }
    }
  }

  /** 基于指定版本创建 snapshot，并把更早版本标记为 compacted。 */
  async compact(input: CompactJWordVersionInput): Promise<CompactJWordVersionResult> {
    const snapshot = await this.createSnapshot({
      documentId: input.documentId,
      versionId: input.beforeVersionId,
      ...(input.snapshotId === undefined ? {} : { snapshotId: input.snapshotId }),
      ...(input.createdAt === undefined ? {} : { createdAt: input.createdAt })
    })

    if (snapshot.diagnostics.some((diagnostic) => !diagnostic.recoverable)) {
      return {
        compactedVersions: [],
        diagnostics: snapshot.diagnostics
      }
    }

    const versions = await this.listVersions(input.documentId)
    const boundary = versions.find((version) => version.versionId === input.beforeVersionId)
    const compacted = boundary === undefined
      ? []
      : versions.filter((version) => version.updateCount < boundary.updateCount)
        .map((version) => ({ ...version, compacted: true }))

    for (const version of compacted) {
      replaceStoredVersionRecord(this.input.document, version)
    }

    return {
      snapshot: snapshot.snapshot,
      compactedVersions: compacted,
      diagnostics: snapshot.diagnostics
    }
  }
}

/** 从完整 state update 中只保留 core 容器，避免 provider history 递归保存自身索引。 */
function encodeCoreDocumentUpdateFromStateUpdate(update: Uint8Array, fallbackDocument: Y.Doc): Uint8Array {
  const sourceDoc = new Y.Doc()

  try {
    Y.applyUpdate(sourceDoc, update)

    return encodeCoreDocumentStateAsUpdate(sourceDoc)
  } catch {
    return encodeCoreDocumentStateAsUpdate(fallbackDocument)
  } finally {
    sourceDoc.destroy()
  }
}

/** 追加一个可被同 room 其他浏览器页面读取的历史版本。 */
export function appendHocuspocusHistoryVersion(input: HocuspocusHistoryAppendInput): VersionHistoryEntry {
  const update = input.update ?? encodeCoreDocumentStateAsUpdate(input.document)
  const order = readVersionOrder(input.document)
  const records = readVersionRecords(input.document)
  const updates = readVersionUpdates(input.document)
  const sequence = order.length + 1
  const id = createVersionId(input.clientId, sequence)
  const record: StoredVersionRecord = {
    id,
    label: input.label,
    revision: sequence,
    text: readBodyTextFromUpdate(update),
    createdAt: new Date().toISOString(),
    origin: input.origin,
    roomId: input.roomId,
    documentId: input.documentId,
    clientId: input.clientId,
    authorId: input.authorId
  }

  input.document.transact(() => {
    order.push([id])
    records.set(id, record)
    updates.set(id, new Uint8Array(update))
  }, historyTransactionOrigin)

  return toVersionHistoryEntry(record)
}

/** 从 provider 文档中编码 core 容器状态，避免把 history 索引递归写入版本 update。 */
function encodeCoreDocumentStateAsUpdate(sourceDoc: Y.Doc): Uint8Array {
  const snapshotDoc = new Y.Doc()

  try {
    for (const name of coreSharedTypeNames) {
      const sourceType = readCoreSharedType(sourceDoc, name)

      createAndFillSharedType(snapshotDoc, name, sourceType)
    }

    return Y.encodeStateAsUpdate(snapshotDoc)
  } finally {
    snapshotDoc.destroy()
  }
}

/** 读取 provider 同步后的历史版本列表。 */
export function readHocuspocusVersionHistory(
  document: Y.Doc,
  liveEntry: VersionHistoryEntry
): readonly VersionHistoryEntry[] {
  const entries = readVersionOrder(document).toArray()
    .flatMap((id) => {
      const record = readStoredVersionRecord(readVersionRecords(document).get(id))

      return record === null ? [] : [toVersionHistoryEntry(record)]
    })

  return entries.length === 0 ? [liveEntry] : entries
}

/** 创建指定历史版本的只读预览。 */
export function previewHocuspocusHistoryVersion(
  document: Y.Doc,
  versionId: string
): VersionPreviewSnapshot | null {
  const record = readStoredVersionRecord(readVersionRecords(document).get(versionId))
  const update = readStoredVersionUpdate(document, versionId)

  if (record === null || update === null) {
    return null
  }

  return {
    id: versionId,
    label: record.label,
    text: readBodyTextFromUpdate(update)
  }
}

/** 恢复指定历史版本，并追加 restore 版本记录。 */
export function restoreHocuspocusHistoryVersion(input: HocuspocusHistoryRestoreInput): VersionHistoryEntry | null {
  const record = readStoredVersionRecord(readVersionRecords(input.document).get(input.versionId))
  const update = readStoredVersionUpdate(input.document, input.versionId)

  if (record === null || update === null) {
    return null
  }

  restoreCoreDocumentFromUpdate(input.document, update, 'version-restore')

  return appendHocuspocusHistoryVersion({
    document: input.document,
    label: `restore:${record.label}`,
    origin: 'version-restore',
    roomId: input.roomId,
    documentId: input.documentId,
    clientId: input.clientId,
    authorId: input.authorId
  })
}

/** 读取版本顺序 shared array。 */
function readVersionOrder(document: Y.Doc): Y.Array<string> {
  return document.getArray(historyVersionOrderName)
}

/** 读取版本元数据 shared map。 */
function readVersionRecords(document: Y.Doc): Y.Map<unknown> {
  return document.getMap(historyVersionRecordsName)
}

/** 读取版本 update shared map。 */
function readVersionUpdates(document: Y.Doc): Y.Map<unknown> {
  return document.getMap(historyVersionUpdatesName)
}

/** 读取版本 snapshot shared map。 */
function readVersionSnapshots(document: Y.Doc): Y.Map<unknown> {
  return document.getMap(historySnapshotsName)
}

/** 创建跨浏览器冲突概率极低的版本 ID。 */
function createVersionId(clientId: string, sequence: number): string {
  return `version-${sequence}-${clientId}-${Date.now()}`
}

/** 将存储记录转换为 debug API 使用的历史项。 */
function toVersionHistoryEntry(record: StoredVersionRecord): VersionHistoryEntry {
  return {
    id: record.id,
    label: record.label,
    revision: record.revision,
    text: record.text
  }
}

/** 将 provider 共享记录转换为 persistence 版本元数据。 */
function toJWordVersionRecord(record: StoredVersionRecord): JWordVersionRecord {
  return {
    versionId: record.id,
    documentId: record.documentId,
    roomId: record.roomId,
    clientId: record.clientId,
    createdAt: record.createdAt,
    updateCount: record.revision,
    label: record.label,
    authorId: record.authorId,
    origin: record.origin,
    ...(record.byteLength === undefined ? {} : { byteLength: record.byteLength }),
    ...(record.sha256 === undefined ? {} : { sha256: record.sha256 }),
    ...(record.stateVector === undefined ? {} : { stateVector: new Uint8Array(record.stateVector) }),
    ...(record.snapshotId === undefined ? {} : { snapshotId: record.snapshotId }),
    ...(record.restoreSourceVersionId === undefined ? {} : {
      restoreSourceVersionId: record.restoreSourceVersionId
    }),
    ...(record.compacted === undefined ? {} : { compacted: record.compacted })
  }
}

/** 将 persistence 版本元数据回写为 provider 共享记录。 */
function replaceStoredVersionRecord(document: Y.Doc, version: JWordVersionRecord): void {
  const records = readVersionRecords(document)
  const existing = readStoredVersionRecord(records.get(version.versionId))
  const record: StoredVersionRecord = {
    id: version.versionId,
    label: version.label ?? existing?.label ?? version.versionId,
    revision: version.updateCount,
    text: existing?.text ?? '',
    createdAt: version.createdAt,
    origin: version.origin ?? existing?.origin ?? 'local-user',
    roomId: version.roomId ?? existing?.roomId ?? '',
    documentId: version.documentId,
    clientId: version.clientId ?? existing?.clientId ?? '',
    authorId: version.authorId ?? existing?.authorId ?? '',
    ...(version.byteLength === undefined ? {} : { byteLength: version.byteLength }),
    ...(version.sha256 === undefined ? {} : { sha256: version.sha256 }),
    ...(version.stateVector === undefined ? {} : { stateVector: new Uint8Array(version.stateVector) }),
    ...(version.snapshotId === undefined ? {} : { snapshotId: version.snapshotId }),
    ...(version.restoreSourceVersionId === undefined ? {} : {
      restoreSourceVersionId: version.restoreSourceVersionId
    }),
    ...(version.compacted === undefined ? {} : { compacted: version.compacted })
  }

  records.set(version.versionId, record)
}

/** 读取 provider 共享 snapshot 记录。 */
function readStoredSnapshot(document: Y.Doc, snapshotId: string): JWordSnapshotRecord | null {
  const value = readVersionSnapshots(document).get(snapshotId)

  if (typeof value !== 'object' || value === null) {
    return null
  }

  const snapshot = value as Partial<JWordSnapshotRecord>

  return typeof snapshot.snapshotId === 'string' &&
    typeof snapshot.documentId === 'string' &&
    typeof snapshot.versionId === 'string' &&
    snapshot.stateUpdate instanceof Uint8Array &&
    typeof snapshot.byteLength === 'number' &&
    typeof snapshot.updateByteLength === 'number' &&
    typeof snapshot.sha256 === 'string' &&
    snapshot.stateVector instanceof Uint8Array &&
    typeof snapshot.createdAt === 'string' &&
    typeof snapshot.updateCount === 'number' &&
    typeof snapshot.documentSummary === 'object' &&
    snapshot.documentSummary !== null
    ? snapshot as JWordSnapshotRecord
    : null
}

/** 创建 persistence 诊断对象。 */
function createPersistenceDiagnostic(
  code: JWordPersistenceDiagnosticCode,
  input: LoadJWordVersionInput | RestoreJWordVersionInput,
  snapshotId?: string
): JWordPersistenceDiagnostic {
  const metadata = PERSISTENCE_DIAGNOSTIC_CODE_METADATA[code]

  return {
    code,
    severity: metadata.severity,
    message: metadata.description,
    recoverable: metadata.recoverable,
    ...('fallback' in metadata ? { fallback: metadata.fallback } : {}),
    documentId: input.documentId,
    versionId: input.versionId,
    ...(snapshotId === undefined ? {} : { snapshotId })
  }
}

/** 生成空版本占位，用于 createSnapshot 失败时保持返回结构稳定。 */
function createMissingVersion(input: CreateJWordSnapshotInput): JWordVersionRecord {
  return {
    versionId: input.versionId,
    documentId: input.documentId,
    createdAt: input.createdAt ?? new Date().toISOString(),
    updateCount: 0
  }
}

/** 生成空 snapshot 占位，调用方必须以 diagnostics 判断真实状态。 */
function createEmptySnapshotRecord(input: CreateJWordSnapshotInput): JWordSnapshotRecord {
  return {
    snapshotId: input.snapshotId ?? 'snapshot-missing',
    documentId: input.documentId,
    versionId: input.versionId,
    stateUpdate: new Uint8Array(),
    byteLength: 0,
    updateByteLength: 0,
    sha256: '',
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

/** 从 state update 计算 snapshot 摘要。 */
function buildSnapshotDocumentSummary(
  update: Uint8Array,
  updateCount: number
): JWordSnapshotDocumentSummary {
  const doc = new Y.Doc()

  try {
    Y.applyUpdate(doc, update)
    return {
      sharedTypeNames: Array.from(doc.share.keys()).sort(),
      updateCount,
      updateByteLength: update.byteLength
    }
  } finally {
    doc.destroy()
  }
}

/** 从 Yjs update 中读取 state vector，异常时返回空向量并交给恢复诊断处理。 */
function encodeStateVectorFromUpdate(update: Uint8Array): Uint8Array {
  try {
    return Y.encodeStateVectorFromUpdate(update)
  } catch {
    return new Uint8Array()
  }
}

/** 计算 SHA-256 摘要，用于版本和 snapshot 元数据。 */
async function hashBytes(bytes: Uint8Array): Promise<string> {
  const copy = Uint8Array.from(bytes)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', copy.buffer)

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

/** 从 shared map value 中读取稳定版本元数据。 */
function readStoredVersionRecord(value: unknown): StoredVersionRecord | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }

  const record = value as Partial<StoredVersionRecord>

  return typeof record.id === 'string' &&
    typeof record.label === 'string' &&
    typeof record.revision === 'number' &&
    typeof record.text === 'string' &&
    typeof record.createdAt === 'string' &&
    typeof record.origin === 'string' &&
    typeof record.roomId === 'string' &&
    typeof record.documentId === 'string' &&
    typeof record.clientId === 'string' &&
    typeof record.authorId === 'string'
    ? record as StoredVersionRecord
    : null
}

/** 从 shared map 中读取指定版本的 state update。 */
function readStoredVersionUpdate(document: Y.Doc, versionId: string): Uint8Array | null {
  const value = readVersionUpdates(document).get(versionId)

  return value instanceof Uint8Array ? new Uint8Array(value) : null
}

/** 只恢复 core 文档容器，保留 provider 同步的 history 附属容器。 */
export function restoreCoreDocumentFromUpdate(targetDoc: Y.Doc, update: Uint8Array, origin: string): void {
  const previewDoc = new Y.Doc()

  try {
    Y.applyUpdate(previewDoc, update)
    targetDoc.transact(() => {
      for (const name of coreSharedTypeNames) {
        const previewType = readCoreSharedType(previewDoc, name)
        const targetType = targetDoc.share.get(name)

        if (targetType !== undefined) {
          replaceSharedType(targetType, previewType)
          continue
        }

        if (previewType !== undefined) {
          createAndFillSharedType(targetDoc, name, previewType)
        }
      }
    }, origin)
  } finally {
    previewDoc.destroy()
  }
}

/** 按 core 文档 wire-format 根名物化顶层 shared type。 */
function readCoreSharedType(document: Y.Doc, name: string): JWordYjsSharedType {
  if (coreArraySharedTypeNames.has(name)) {
    return document.getArray(name) as unknown as JWordYjsSharedType
  }

  return document.getMap(name) as unknown as JWordYjsSharedType
}

/** 按 preview 类型替换目标 shared type。 */
function replaceSharedType(targetType: JWordYjsSharedType, previewType: JWordYjsSharedType | undefined): void {
  if (isYText(targetType)) {
    targetType.delete(0, targetType.length)
    if (isYText(previewType)) {
      targetType.insert(0, previewType.toString())
    }
    return
  }

  if (isYArray(targetType)) {
    targetType.delete(0, targetType.length)
    if (isYArray(previewType)) {
      targetType.insert(0, cloneArrayValues(previewType))
    }
    return
  }

  if (isYMap(targetType)) {
    for (const key of Array.from(targetType.keys())) {
      targetType.delete(key)
    }
    if (isYMap(previewType)) {
      for (const [key, value] of previewType) {
        targetType.set(key, cloneSharedValue(value))
      }
    }
  }
}

/** 创建目标文档缺失的顶层 shared type 并填充内容。 */
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
  }
}

/** 克隆 Y.Array 值，避免把 preview 类型直接挂入目标文档。 */
function cloneArrayValues(array: Y.Array<unknown>): unknown[] {
  return array.toArray().map(cloneSharedValue)
}

/** 克隆可嵌套的 Yjs shared type。 */
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
    typeof value === 'object' &&
    value !== null &&
    'insert' in value &&
    'delete' in value &&
    'length' in value &&
    'toString' in value &&
    !('toArray' in value) &&
    !('keys' in value)
  )
}

/** 判断共享类型是否按 Y.Array API 工作。 */
function isYArray(value: unknown): value is Y.Array<unknown> {
  return value instanceof Y.Array || (
    typeof value === 'object' &&
    value !== null &&
    'insert' in value &&
    'delete' in value &&
    'length' in value &&
    'toArray' in value
  )
}

/** 判断共享类型是否按 Y.Map API 工作。 */
function isYMap(value: unknown): value is Y.Map<unknown> {
  return value instanceof Y.Map || (
    typeof value === 'object' &&
    value !== null &&
    'set' in value &&
    'delete' in value &&
    'keys' in value &&
    Symbol.iterator in value
  )
}
