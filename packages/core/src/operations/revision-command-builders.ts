/**
 * 职责：构造 Gate 4 修订 metadata 与单条接受/拒绝的核心命令。
 * 边界：只生成 revision metadata、目标 run 标记和单条接受/拒绝命令，不实现全部处理或嵌套修订 diff 引擎。
 * 协作模块：selection targets、文本范围快照、事务流水线和投影共同提供修订闭环。
 * 性能/安全约束：builder 只读取当前 projection 与 selection，不访问 DOM、网络或磁盘。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import { createTextRangeRecord } from '../model/position'
import { collectSelectionTargets } from '../model/selection-targets'
import type { DocumentProjection } from '../model/projection'
import { isSelectionCollapsed } from '../model/selection'
import type { SelectionState } from '../model/selection'
import type { Block, RevisionFormatSnapshot, RevisionMetadata, Run } from '../model/types'
import type { Command, Operation } from './transaction'

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

  const targets = collectSelectionTargets(projection, selection).runs

  if (targets.length === 0) {
    return null
  }

  const usedRevisionIds = collectRevisionIds(projection)
  const usedRangeIds = collectRevisionRangeIds(projection)
  const usedRunIds = collectRunIds(projection)
  const revisionId = allocateRevisionId(usedRevisionIds, 'revision')
  const rangeId = allocateRevisionId(usedRangeIds, 'revision-range')
  const rangeSnapshot = createTextRangeRecord(rangeId, selection.range)
  const formatSnapshots: RevisionFormatSnapshot[] = []
  const revision: RevisionMetadata = {
    kind: 'revision',
    id: revisionId,
    authorId: input.authorId,
    createdAt: input.createdAt,
    type: input.type,
    rangeId,
    rangeSnapshot,
    summary: input.summary,
    ...(input.type === 'format' ? { formatSnapshots } : {})
  }
  const operations: Operation[] = targets.map((target) => {
    const isWholeRunSelection =
      target.selectedStartGraphemeIndex === 0
      && target.selectedEndGraphemeIndex === target.graphemeLength

    if (isWholeRunSelection) {
      appendRevisionFormatSnapshot(formatSnapshots, target.run.id, target.run)

      return {
        kind: 'addRevisionMetadata',
        revision,
        runId: target.run.id
      }
    }

    const revisedRunId = target.selectedStartGraphemeIndex > 0
      ? allocateGeneratedRunId(usedRunIds, target.run.id, 'revision')
      : undefined
    const trailingRunId = target.selectedEndGraphemeIndex < target.graphemeLength
      ? allocateGeneratedRunId(usedRunIds, target.run.id, 'tail')
      : undefined

    appendRevisionFormatSnapshot(formatSnapshots, revisedRunId ?? target.run.id, target.run)

    return {
      kind: 'addRevisionMetadata',
      revision,
      runId: target.run.id,
      range: {
        startGraphemeIndex: target.selectedStartGraphemeIndex,
        endGraphemeIndex: target.selectedEndGraphemeIndex,
        ...(revisedRunId === undefined ? {} : { revisedRunId }),
        ...(trailingRunId === undefined ? {} : { trailingRunId })
      }
    }
  })

  return {
    name: 'addRevisionMetadata',
    operations
  }
}


/** 构造接受单条修订命令。 */
export function buildAcceptRevisionCommand(
  projection: DocumentProjection,
  revisionId: string
): Command | null {
  return buildResolveRevisionCommand(projection, revisionId, 'acceptRevision')
}

/** 构造拒绝单条修订命令。 */
export function buildRejectRevisionCommand(
  projection: DocumentProjection,
  revisionId: string
): Command | null {
  return buildResolveRevisionCommand(projection, revisionId, 'rejectRevision')
}


/** 构造接受或拒绝修订命令。 */
function buildResolveRevisionCommand(
  projection: DocumentProjection,
  revisionId: string,
  name: 'acceptRevision' | 'rejectRevision'
): Command | null {
  const revision = projection.document.revisions?.find((candidate) => candidate.id === revisionId)

  if (revision === undefined) {
    return null
  }

  return {
    name,
    operations: [{
      kind: name,
      revisionId,
      range: {
        anchor: revision.rangeSnapshot.anchor,
        focus: revision.rangeSnapshot.focus
      },
      formatTargets: revision.formatSnapshots ?? []
    }]
  }
}

/** 记录格式修订拒绝时需要恢复的 run 属性快照。 */
function appendRevisionFormatSnapshot(
  snapshots: RevisionFormatSnapshot[],
  runId: string,
  run: Run
): void {
  snapshots.push({
    runId,
    previousProperties: run.properties ?? {}
  })
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

/** 收集当前 projection 内已使用的 run ID。 */
function collectRunIds(projection: DocumentProjection): Set<string> {
  const runIds = new Set<string>()

  for (const section of projection.document.sections) {
    visitBlocks(section.blocks)
  }

  return runIds

  function visitBlocks(blocks: readonly Block[]) {
    for (const block of blocks) {
      if (block.kind === 'paragraph') {
        for (const run of block.runs) {
          runIds.add(run.id)
        }

        continue
      }

      for (const row of block.rows) {
        for (const cell of row.cells) {
          visitBlocks(cell.blocks)
        }
      }
    }
  }
}

/**
 * 分配当前 projection 内唯一的 revision 相关 ID。
 */
function allocateRevisionId(usedIds: Set<string>, prefix: string): string {
  let sequence = 1
  let candidate = `${prefix}-${sequence}`

  while (usedIds.has(candidate)) {
    sequence += 1
    candidate = `${prefix}-${sequence}`
  }

  usedIds.add(candidate)

  return candidate
}

/** 分配用于局部修订拆分的 run ID。 */
function allocateGeneratedRunId(
  usedRunIds: Set<string>,
  runId: string,
  suffix: 'revision' | 'tail'
): string {
  let sequence = 1
  let candidate = `${runId}__${suffix}-${sequence}`

  while (usedRunIds.has(candidate)) {
    sequence += 1
    candidate = `${runId}__${suffix}-${sequence}`
  }

  usedRunIds.add(candidate)

  return candidate
}
