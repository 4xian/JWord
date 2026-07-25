/**
 * 职责：提供 restoreVersion() 共享的 pending 状态和版本元数据构造。
 * 边界：只服务 persistence 包内部，不进入包根导出，不负责 storage 提交或 target 应用。
 * 协作模块：memory 与 storage-backed adapter 复用相同的 restore update/version 语义。
 * 性能/安全约束：pending 只携带完整 prepared update、hash 和版本 metadata，不暴露目标文档正文诊断。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import * as Y from 'yjs'

import { hashSha256Bytes } from './sha256.js'
import type {
  JWordUpdateLogRecord,
  JWordVersionRecord,
  RestoreJWordVersionInput
} from './index.js'

export interface JWordRestorePending {
  readonly operationId: string
  readonly phase: 'prepared' | 'target-applied'
  readonly sourceVersionId: string
  readonly targetBeforeHash: string
  readonly preparedHash: string
  readonly update: JWordUpdateLogRecord
  readonly version: JWordVersionRecord
}

export interface JWordRestoreCompletion {
  readonly operationId: string
  readonly sourceVersionId: string
  readonly preparedHash: string
  readonly version: JWordVersionRecord
}

interface CreateRestoreMetadataInput {
  readonly documentId: string
  readonly sequence: number
  readonly preparedDoc: Y.Doc
  readonly sourceVersion: JWordVersionRecord
  readonly input: RestoreJWordVersionInput
}

interface CreateRestorePendingInput {
  readonly sourceVersionId: string
  readonly targetBeforeHash: string
  readonly preparedHash: string
  readonly update: JWordUpdateLogRecord
  readonly version: JWordVersionRecord
}

let restoreOperationCounter = 0

/** 构造 memory 与 storage 共用的 restore update/version 元数据。 */
export function createRestoreMetadata(
  input: CreateRestoreMetadataInput
): { readonly update: JWordUpdateLogRecord, readonly version: JWordVersionRecord } {
  const updateBytes = Y.encodeStateAsUpdate(input.preparedDoc)
  const stateVector = encodeStateVectorFromUpdate(updateBytes)
  const createdAt = new Date().toISOString()
  const origin = input.input.origin ?? 'version-restore'
  const label = `restore:${input.sourceVersion.label ?? input.sourceVersion.versionId}`
  const update: JWordUpdateLogRecord = {
    updateId: `update-${input.sequence}`,
    documentId: input.documentId,
    versionId: `version-${input.sequence}`,
    update: updateBytes,
    byteLength: updateBytes.byteLength,
    sha256: hashSha256Bytes(updateBytes),
    stateVector,
    createdAt,
    sequence: input.sequence,
    label,
    origin,
    ...(input.sourceVersion.roomId === undefined ? {} : { roomId: input.sourceVersion.roomId }),
    ...(input.sourceVersion.clientId === undefined ? {} : { clientId: input.sourceVersion.clientId }),
    ...(input.sourceVersion.authorId === undefined ? {} : { authorId: input.sourceVersion.authorId })
  }
  const version: JWordVersionRecord = {
    versionId: update.versionId,
    documentId: input.documentId,
    createdAt,
    updateCount: input.sequence,
    label,
    origin,
    byteLength: update.byteLength,
    sha256: update.sha256,
    stateVector: copyBytes(stateVector),
    restoreSourceVersionId: input.sourceVersion.versionId,
    ...(update.roomId === undefined ? {} : { roomId: update.roomId }),
    ...(update.clientId === undefined ? {} : { clientId: update.clientId }),
    ...(update.authorId === undefined ? {} : { authorId: update.authorId })
  }

  return { update, version }
}

/** 为一次 prepared restore 创建持久化 pending operation marker。 */
export function createRestorePending(
  input: CreateRestorePendingInput
): JWordRestorePending {
  restoreOperationCounter += 1

  return {
    operationId: `restore-${input.version.versionId}-${restoreOperationCounter}`,
    phase: 'prepared',
    sourceVersionId: input.sourceVersionId,
    targetBeforeHash: input.targetBeforeHash,
    preparedHash: input.preparedHash,
    update: input.update,
    version: input.version
  }
}

/** 复制 update record，避免 pending 或提交状态被调用方修改。 */
export function cloneRestorePending(pending: JWordRestorePending): JWordRestorePending {
  return {
    ...pending,
    update: {
      ...pending.update,
      update: copyBytes(pending.update.update),
      stateVector: copyBytes(pending.update.stateVector)
    },
    version: cloneVersion(pending.version)
  }
}

/** 把 prepared pending 推进为 target 已应用阶段，并记录实际 target 的 state update。 */
export function markRestorePendingTargetApplied(
  pending: JWordRestorePending,
  targetUpdate: Uint8Array
): JWordRestorePending {
  const update = copyBytes(targetUpdate)
  const stateVector = encodeStateVectorFromUpdate(update)
  const sha256 = hashSha256Bytes(update)

  return cloneRestorePending({
    ...pending,
    phase: 'target-applied',
    update: {
      ...pending.update,
      update,
      byteLength: update.byteLength,
      sha256,
      stateVector
    },
    version: {
      ...pending.version,
      byteLength: update.byteLength,
      sha256,
      stateVector: copyBytes(stateVector)
    }
  })
}

/** 从 finalized pending 创建最近一次 restore 的持久化完成确认。 */
export function createRestoreCompletion(pending: JWordRestorePending): JWordRestoreCompletion {
  return {
    operationId: pending.operationId,
    sourceVersionId: pending.sourceVersionId,
    preparedHash: pending.preparedHash,
    version: cloneVersion(pending.version)
  }
}

/** 根据已提交 updates 生成下一个 history sequence。 */
export function getNextHistorySequence(updates: readonly JWordUpdateLogRecord[]): number {
  let current = 0

  for (const update of updates) {
    current = Math.max(current, update.sequence)
  }

  return current + 1
}

/** pending restore 收敛前阻止同 document 的普通 history append。 */
export function assertHistoryAppendAllowed(pending: JWordRestorePending | undefined): void {
  if (pending !== undefined) {
    throw new Error('PERSISTENCE_RESTORE_RECOVERY_REQUIRED')
  }
}

/** 复制 restore 完成确认中的版本二进制字段。 */
export function cloneRestoreCompletion(completion: JWordRestoreCompletion): JWordRestoreCompletion {
  return {
    ...completion,
    version: cloneVersion(completion.version)
  }
}

/** 从完整 update 计算 state vector，非法 update 交给 restore 失败路径处理。 */
function encodeStateVectorFromUpdate(update: Uint8Array): Uint8Array {
  try {
    return Y.encodeStateVectorFromUpdate(update)
  } catch {
    return new Uint8Array()
  }
}

/** 复制二进制字段，避免共享底层 ArrayBuffer。 */
function copyBytes(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(bytes)
}

/** 复制版本元数据中的可变 state vector。 */
function cloneVersion(version: JWordVersionRecord): JWordVersionRecord {
  return {
    ...version,
    ...(version.stateVector === undefined ? {} : { stateVector: copyBytes(version.stateVector) })
  }
}
