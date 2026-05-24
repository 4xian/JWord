/**
 * 职责：构造 Gate 4 修订 metadata 的最小核心命令。
 * 边界：只生成 revision metadata 和目标 run 标记，不实现接受、拒绝或 diff 引擎。
 * 协作模块：selection targets、文本范围快照、事务流水线和投影共同提供修订闭环。
 * 性能/安全约束：builder 只读取当前 projection 与 selection，不访问 DOM、网络或磁盘。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md Step 4.14。
 */

import { createTextRangeRecord } from '../model/position'
import { collectSelectionTargets } from '../model/selection-targets'
import type { DocumentProjection } from '../model/projection'
import { isSelectionCollapsed } from '../model/selection'
import type { SelectionState } from '../model/selection'
import type { RevisionMetadata } from '../model/types'
import type { Command } from './transaction'

let revisionSequence = 0
let revisionRangeSequence = 0

export interface AddRevisionMetadataInput {
  readonly authorId: string
  readonly createdAt: string
  readonly type: RevisionMetadata['type']
  readonly summary: string
}

/**
 * 构造新增修订 metadata 命令。
 */
export function buildAddRevisionMetadataCommand(
  projection: DocumentProjection,
  selection: SelectionState | null,
  input: AddRevisionMetadataInput
): Command | null {
  if (selection === null || isSelectionCollapsed(selection)) {
    return null
  }

  const target = collectSelectionTargets(projection, selection).runs[0]

  if (target === undefined) {
    return null
  }

  const usedRevisionIds = collectRevisionIds(projection)
  const usedRangeIds = collectRevisionRangeIds(projection)
  const revisionId = allocateRevisionId(usedRevisionIds, 'revision', () => ++revisionSequence)
  const rangeId = allocateRevisionId(usedRangeIds, 'revision-range', () => ++revisionRangeSequence)
  const rangeSnapshot = createTextRangeRecord(rangeId, selection.range)
  const revision: RevisionMetadata = {
    kind: 'revision',
    id: revisionId,
    authorId: input.authorId,
    createdAt: input.createdAt,
    type: input.type,
    rangeId,
    rangeSnapshot,
    summary: input.summary
  }

  return {
    name: 'addRevisionMetadata',
    operations: [{
      kind: 'addRevisionMetadata',
      revision,
      runId: target.run.id
    }]
  }
}

/**
 * 收集当前 projection 内已使用的 revision ID。
 */
function collectRevisionIds(projection: DocumentProjection): Set<string> {
  return new Set((projection.document.revisions ?? []).map((revision) => revision.id))
}

/**
 * 收集当前 projection 内已使用的 revision range ID。
 */
function collectRevisionRangeIds(projection: DocumentProjection): Set<string> {
  return new Set((projection.document.revisions ?? []).map((revision) => revision.rangeSnapshot.id))
}

/**
 * 分配当前 projection 内唯一的 revision 相关 ID。
 */
function allocateRevisionId(
  usedIds: Set<string>,
  prefix: string,
  nextSequence: () => number
): string {
  let candidate = `${prefix}-${nextSequence()}`

  while (usedIds.has(candidate)) {
    candidate = `${prefix}-${nextSequence()}`
  }

  usedIds.add(candidate)

  return candidate
}
