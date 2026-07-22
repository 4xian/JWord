/**
 * 职责：在 persistence 运行时 history state 与宿主 storage 文档之间编解码。
 * 边界：只处理可序列化 history 文档、pending restore 和二进制字段，不执行公开 adapter 操作。
 * 协作模块：storage-history-adapter.ts 负责提交编排，本模块负责纯数据转换与防御性复制。
 * 性能/安全约束：所有 Uint8Array 与版本 metadata 都复制，避免宿主存储和 adapter 共享可变引用。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import type {
  JWordSnapshotRecord,
  JWordUpdateLogRecord,
  JWordVersionRecord
} from './index.js'
import { cloneRestoreCompletion } from './restore-operation.js'
import type {
  JWordRestoreCompletion,
  JWordRestorePending
} from './restore-operation.js'
import type {
  JWordHistoryStorageDocument,
  JWordHistoryStoragePendingRestore,
  JWordSerializedSnapshotRecord,
  JWordSerializedUpdateLogRecord
} from './storage-history-adapter.js'

export interface MutableHistoryDocumentState {
  readonly documentId: string
  readonly updates: JWordUpdateLogRecord[]
  readonly versions: JWordVersionRecord[]
  readonly snapshots: JWordSnapshotRecord[]
  readonly pendingRestore?: JWordRestorePending
  readonly completedRestore?: JWordRestoreCompletion
  readonly revision?: string
}

/** 克隆 storage 文档，避免调用方修改内部状态。 */
export function cloneStorageDocument(document: JWordHistoryStorageDocument): JWordHistoryStorageDocument {
  return {
    documentId: document.documentId,
    updates: document.updates.map((update) => ({ ...update })),
    versions: document.versions.map(cloneVersion),
    snapshots: document.snapshots.map((snapshot) => ({ ...snapshot })),
    ...(document.pendingRestore === undefined ? {} : {
      pendingRestore: {
        ...document.pendingRestore,
        update: { ...document.pendingRestore.update },
        version: cloneVersion(document.pendingRestore.version)
      }
    }),
    ...(document.completedRestore === undefined ? {} : {
      completedRestore: cloneRestoreCompletion(document.completedRestore)
    }),
    ...(document.revision === undefined ? {} : { revision: document.revision })
  }
}

/** 把运行时状态编码为 storage 可保存格式。 */
export function encodeStorageDocument(state: MutableHistoryDocumentState): JWordHistoryStorageDocument {
  return {
    documentId: state.documentId,
    updates: state.updates.map(encodeUpdateRecord),
    versions: state.versions.map(cloneVersion),
    snapshots: state.snapshots.map((snapshot) => removeUndefinedSnapshotFields({
      ...snapshot,
      stateUpdateBase64: encodeBase64(snapshot.stateUpdate),
      stateVectorBase64: encodeBase64(snapshot.stateVector),
      stateUpdate: undefined,
      stateVector: undefined
    })),
    ...(state.pendingRestore === undefined ? {} : {
      pendingRestore: encodePendingRestore(state.pendingRestore)
    }),
    ...(state.completedRestore === undefined ? {} : {
      completedRestore: cloneRestoreCompletion(state.completedRestore)
    }),
    ...(state.revision === undefined ? {} : { revision: state.revision })
  }
}

/** 从 storage 格式解码为运行时状态。 */
export function decodeStorageDocument(document: JWordHistoryStorageDocument): MutableHistoryDocumentState {
  return {
    documentId: document.documentId,
    updates: document.updates.map(decodeUpdateRecord),
    versions: document.versions.map(cloneVersion),
    snapshots: document.snapshots.map((snapshot) => ({
      ...snapshot,
      stateUpdate: decodeBase64(snapshot.stateUpdateBase64),
      stateVector: decodeBase64(snapshot.stateVectorBase64)
    })),
    ...(document.pendingRestore === undefined ? {} : {
      pendingRestore: decodePendingRestore(document.pendingRestore)
    }),
    ...(document.completedRestore === undefined ? {} : {
      completedRestore: cloneRestoreCompletion(document.completedRestore)
    }),
    ...(document.revision === undefined ? {} : { revision: document.revision })
  }
}

/** 克隆版本元数据中的可变二进制字段。 */
export function cloneVersion(version: JWordVersionRecord): JWordVersionRecord {
  return {
    ...version,
    ...(version.stateVector === undefined ? {} : { stateVector: copyBytes(version.stateVector) })
  }
}

/** 复制二进制字段，避免共享底层 ArrayBuffer。 */
export function copyBytes(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(bytes)
}

/** 将 pending restore 的运行时 update 编码为 storage 文档字段。 */
function encodePendingRestore(pending: JWordRestorePending): JWordHistoryStoragePendingRestore {
  return {
    operationId: pending.operationId,
    phase: pending.phase,
    sourceVersionId: pending.sourceVersionId,
    targetBeforeHash: pending.targetBeforeHash,
    preparedHash: pending.preparedHash,
    update: encodeUpdateRecord(pending.update),
    version: cloneVersion(pending.version)
  }
}

/** 将 storage 文档中的 pending restore 解码为运行时状态。 */
function decodePendingRestore(
  pending: JWordHistoryStoragePendingRestore
): JWordRestorePending {
  return {
    operationId: pending.operationId,
    phase: pending.phase,
    sourceVersionId: pending.sourceVersionId,
    targetBeforeHash: pending.targetBeforeHash,
    preparedHash: pending.preparedHash,
    update: decodeUpdateRecord(pending.update),
    version: cloneVersion(pending.version)
  }
}

/** 编码一个 update record，供普通 update log 与 pending 共用。 */
function encodeUpdateRecord(update: JWordUpdateLogRecord): JWordSerializedUpdateLogRecord {
  return removeUndefinedUpdateFields({
    ...update,
    updateBase64: encodeBase64(update.update),
    stateVectorBase64: encodeBase64(update.stateVector),
    update: undefined,
    stateVector: undefined
  })
}

/** 解码一个 update record，供普通 update log 与 pending 共用。 */
function decodeUpdateRecord(update: JWordSerializedUpdateLogRecord): JWordUpdateLogRecord {
  return {
    ...update,
    update: decodeBase64(update.updateBase64),
    stateVector: decodeBase64(update.stateVectorBase64)
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
