/**
 * 职责：统一编排 restoreVersion() 的 target 应用、pending phase、finalize、取消与恢复。
 * 边界：只服务 persistence 包内部，通过回调提交 Memory 或 Storage 状态，不实现通用 append CAS。
 * 协作模块：两个正式 adapter 提供各自状态写入，restore-operation 提供 pending metadata。
 * 性能/安全约束：只比较 canonical logical-content hash 与 operation marker，不输出文档正文或 update。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import * as Y from 'yjs'

import { createDiagnostic } from './persistence-diagnostic.js'
import { markRestorePendingTargetApplied } from './restore-operation.js'
import {
  clearRestoreTargetMarker,
  createEmptyDocumentWithSharedTypes,
  readRestoreTargetMarker
} from './yjs-document-content.js'
import {
  applyPreparedDocumentContent,
  hashYjsLogicalContent
} from './yjs-logical-content.js'
import type {
  JWordRestoreCompletion,
  JWordRestorePending
} from './restore-operation.js'
import type {
  JWordPersistenceDiagnostic,
  JWordUpdateLogRecord,
  RestoreJWordVersionResult
} from './index.js'

interface RestoreStateCallbacks<State> {
  /** 取消尚未应用 target 的 pending。 */
  readonly cancelPending: (state: State) => boolean | Promise<boolean>
  /** 把 pending 推进到 target-applied，并返回带新 revision 的状态。 */
  readonly markTargetApplied: (
    state: State,
    pending: JWordRestorePending
  ) => State | undefined | Promise<State | undefined>
  /** 把 target-applied pending 提交到普通历史。 */
  readonly finalizePending: (
    state: State,
    pending: JWordRestorePending
  ) => boolean | Promise<boolean>
}

interface CompletePreparedRestoreInput<State> extends RestoreStateCallbacks<State> {
  readonly documentId: string
  readonly versionId: string
  readonly targetDoc: Y.Doc
  readonly preparedDoc: Y.Doc
  readonly pending: JWordRestorePending
  readonly state: State
  readonly origin: string
  readonly successDiagnostics: readonly JWordPersistenceDiagnostic[]
}

interface RecoverPendingRestoreInput<State> extends RestoreStateCallbacks<State> {
  readonly documentId: string
  readonly versionId: string
  readonly targetDoc: Y.Doc
  readonly pending: JWordRestorePending
  readonly state: State
  readonly origin: string
}

interface RecoverCompletedRestoreInput {
  readonly documentId: string
  readonly versionId: string
  readonly targetDoc: Y.Doc
  readonly completion: JWordRestoreCompletion | undefined
  readonly latestUpdate: JWordUpdateLogRecord | undefined
  readonly latestVersion: JWordRestoreCompletion['version'] | undefined
  readonly origin: string
}

/** 应用 prepared target，推进 pending phase，并在 finalize 后返回成功版本。 */
export async function completePreparedRestore<State>(
  input: CompletePreparedRestoreInput<State>
): Promise<RestoreJWordVersionResult> {
  try {
    applyPreparedDocumentContent(
      input.targetDoc,
      input.preparedDoc,
      input.pending.preparedHash,
      input.origin,
      input.pending.operationId
    )
  } catch (error) {
    if (readTargetHash(input.targetDoc) !== input.pending.targetBeforeHash) {
      return createRecoveryRequiredResult(input.documentId, input.versionId)
    }
    if (!await input.cancelPending(input.state)) {
      return createRecoveryRequiredResult(input.documentId, input.versionId)
    }

    clearRestoreTargetMarker(input.targetDoc, input.pending.operationId)
    throw error
  }

  const finalized = await finalizeAppliedTarget(input)

  return finalized
    ? {
        version: finalized.version,
        diagnostics: input.successDiagnostics
      }
    : createRecoveryRequiredResult(input.documentId, input.versionId)
}

/** 根据 durable pending phase、target marker 与 hash 恢复或取消上一次 restore。 */
export async function recoverPendingRestore<State>(
  input: RecoverPendingRestoreInput<State>
): Promise<RestoreJWordVersionResult> {
  if (input.pending.sourceVersionId !== input.versionId) {
    return createRecoveryRequiredResult(input.documentId, input.versionId)
  }

  const targetHash = readTargetHash(input.targetDoc)
  const marker = readRestoreTargetMarker(input.targetDoc)

  if (targetHash === undefined || (marker !== undefined && marker !== input.pending.operationId)) {
    return createRecoveryRequiredResult(input.documentId, input.versionId)
  }

  if (input.pending.phase === 'target-applied') {
    if (marker === input.pending.operationId && targetHash === input.pending.preparedHash) {
      return await input.finalizePending(input.state, input.pending)
        ? createRecoveredResult(input.targetDoc, input.pending)
        : createRecoveryRequiredResult(input.documentId, input.versionId)
    }

    if (!repairTargetFromUpdate(
        input.targetDoc,
        input.pending.update.update,
        input.pending.preparedHash,
        input.origin,
        input.pending.operationId
    )) {
      return createRecoveryRequiredResult(input.documentId, input.versionId)
    }

    const finalized = await finalizeAppliedTarget(input)

    return finalized === undefined
      ? createRecoveryRequiredResult(input.documentId, input.versionId)
      : createRecoveredResult(input.targetDoc, finalized)
  }

  if (marker === input.pending.operationId && targetHash === input.pending.preparedHash) {
    const finalized = await finalizeAppliedTarget(input)

    return finalized === undefined
      ? createRecoveryRequiredResult(input.documentId, input.versionId)
      : createRecoveredResult(input.targetDoc, finalized)
  }

  if (marker === input.pending.operationId || targetHash === input.pending.preparedHash) {
    const preparedDoc = rebuildPreparedDocument(
      input.targetDoc,
      input.pending.update.update,
      input.pending.preparedHash
    )

    if (preparedDoc === undefined) {
      return createRecoveryRequiredResult(input.documentId, input.versionId)
    }
    return completePreparedRestore({
      ...input,
      preparedDoc,
      successDiagnostics: []
    })
  }

  if (targetHash === input.pending.targetBeforeHash) {
    if (!await input.cancelPending(input.state)) {
      return createRecoveryRequiredResult(input.documentId, input.versionId)
    }

    clearRestoreTargetMarker(input.targetDoc, input.pending.operationId)
    return {
      diagnostics: [createDiagnostic('PERSISTENCE_RESTORE_FAILED', input.documentId, input.versionId)]
    }
  }

  return createRecoveryRequiredResult(input.documentId, input.versionId)
}

/** 在 finalize 确认丢失后识别已提交的最近一次 restore。 */
export function recoverCompletedRestore(
  input: RecoverCompletedRestoreInput
): RestoreJWordVersionResult | undefined {
  const completion = input.completion

  if (completion === undefined || completion.sourceVersionId !== input.versionId) {
    return undefined
  }

  if (
    input.latestVersion?.versionId !== completion.version.versionId
    || input.latestVersion.updateCount !== completion.version.updateCount
  ) {
    return undefined
  }

  const marker = readRestoreTargetMarker(input.targetDoc)
  const targetHash = readTargetHash(input.targetDoc)

  if (
    targetHash === completion.preparedHash
    && (marker === undefined || marker === completion.operationId)
  ) {
    return createRecoveredResult(input.targetDoc, completion)
  }

  if (
    marker !== undefined && marker !== completion.operationId
    || input.latestUpdate?.versionId !== completion.version.versionId
    || input.latestUpdate.sequence !== completion.version.updateCount
    || !repairTargetFromUpdate(
      input.targetDoc,
      input.latestUpdate.update,
      completion.preparedHash,
      input.origin,
      completion.operationId
    )
  ) {
    return createRecoveryRequiredResult(input.documentId, input.versionId)
  }

  return createRecoveredResult(input.targetDoc, completion)
}

/** 持久化 target-applied phase，并使用推进后的 state finalize。 */
async function finalizeAppliedTarget<State>(
  input: CompletePreparedRestoreInput<State> | RecoverPendingRestoreInput<State>
): Promise<JWordRestorePending | undefined> {
  let appliedPending: JWordRestorePending

  try {
    appliedPending = markRestorePendingTargetApplied(
      input.pending,
      Y.encodeStateAsUpdate(input.targetDoc)
    )
  } catch {
    return undefined
  }
  const appliedState = await input.markTargetApplied(input.state, appliedPending)

  if (appliedState === undefined || !await input.finalizePending(appliedState, appliedPending)) {
    return undefined
  }

  clearRestoreTargetMarker(input.targetDoc, input.pending.operationId)
  return appliedPending
}

/** 从 pending update 重建可重新应用的 prepared 文档。 */
function rebuildPreparedDocument(
  targetDoc: Y.Doc,
  update: Uint8Array,
  preparedHash: string
): Y.Doc | undefined {
  try {
    const preparedDoc = createEmptyDocumentWithSharedTypes(targetDoc)

    Y.applyUpdate(preparedDoc, update)
    return hashYjsLogicalContent(preparedDoc) === preparedHash ? preparedDoc : undefined
  } catch {
    return undefined
  }
}

/** 从 durable restore update 修复重建或偏离的 target。 */
function repairTargetFromUpdate(
  targetDoc: Y.Doc,
  update: Uint8Array,
  preparedHash: string,
  origin: string,
  operationId: string
): boolean {
  const preparedDoc = rebuildPreparedDocument(targetDoc, update, preparedHash)

  if (preparedDoc === undefined) {
    return false
  }

  try {
    applyPreparedDocumentContent(targetDoc, preparedDoc, preparedHash, origin, operationId)
    return true
  } catch {
    return false
  }
}

/** 安全读取 target canonical hash，非法值交给 recovery-required。 */
function readTargetHash(targetDoc: Y.Doc): string | undefined {
  try {
    return hashYjsLogicalContent(targetDoc)
  } catch {
    return undefined
  }
}

/** 构造不泄漏文档内容的 recovery-required 结果。 */
function createRecoveryRequiredResult(
  documentId: string,
  versionId: string
): RestoreJWordVersionResult {
  return {
    diagnostics: [createDiagnostic('PERSISTENCE_RESTORE_RECOVERY_REQUIRED', documentId, versionId)]
  }
}

/** 清理 marker 并返回 pending 或 completion 中的已恢复版本。 */
function createRecoveredResult(
  targetDoc: Y.Doc,
  restore: Pick<JWordRestorePending, 'operationId' | 'version'>
): RestoreJWordVersionResult {
  clearRestoreTargetMarker(targetDoc, restore.operationId)
  return {
    version: restore.version,
    diagnostics: []
  }
}
