/**
 * 职责：应用修订 metadata 类 operation 到 Y.Doc 修订索引和 run 标记。
 * 边界：只处理修订记录写入、接受/拒绝后的文本或格式回滚、修订引用清理。
 * 协作模块：operation-adapter 负责分发，text-adapter 负责接受/拒绝时的 deleteRange。
 * 性能/安全约束：不访问 DOM，不触发布局渲染；所有状态变更由外层 transaction pipeline 包裹。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/03-architecture.md#34-operation。
 */

import {
  DOCUMENT_STORE_FIELDS,
  createRevisionRecord,
  getParagraphRuns,
  getRunText,
  getSectionBlocks,
  getTableCellBlocks,
  getTableRowCells,
  getTableRows,
  projectRevisionRecord
} from '../model/document-store'
import * as Y from 'yjs'

import { createJWordError } from '../shared/errors'
import { countGraphemes } from '../shared/grapheme'
import type { BlockContainer, DocumentStore } from '../model/document-store'
import type { RevisionFormatSnapshot, RevisionMetadata } from '../model/types'
import type { RevisionId, RunId, TextAnchorMigrationTarget } from '../model/position'
import { migrateTextRangeRecordAfterSplit } from '../model/position'
import type { Operation } from './transaction'
import {
  assertRunIdUnused,
  assertRunPropertyRange,
  findBlockLocation,
  findRunLocation,
  splitRunAtGraphemeIndex
} from './adapter-location'
import { deleteRange } from './text-adapter'
import {
  appendIdIfMissing,
  readRequiredArray,
  removeId,
  replaceProperties
} from './operation-record-utils'

/** 写入修订 metadata，并把目标 run 和块索引标记为关联该修订。 */
export function addRevisionMetadata(
  store: DocumentStore,
  operation: Extract<Operation, { kind: 'addRevisionMetadata' }>
): void {
  const revisionId = operation.revision.id as RevisionId
  const runLocation = findRunLocation(store, operation.runId as RunId)
  const range = operation.range
  let revision = operation.revision
  let revisionRunLocation = runLocation

  if (range !== undefined) {
    const runText = getRunText(runLocation.run).toString()
    const graphemeLength = countGraphemes(runText)

    assertRunPropertyRange(range.startGraphemeIndex, range.endGraphemeIndex, graphemeLength)

    if (range.startGraphemeIndex > 0) {
      if (range.revisedRunId === undefined) {
        throw createJWordError('OPERATION_RUN_FORMAT_RANGE_INVALID', '局部 run 修订缺少 revisedRunId', {
          runId: operation.runId
        })
      }

      assertRunIdUnused(store, range.revisedRunId as RunId)
      revisionRunLocation = splitRunAtGraphemeIndex(
        store,
        runLocation,
        range.startGraphemeIndex,
        range.revisedRunId as RunId,
        (sourceText, boundaryUtf16Index, target) => {
          revision = migrateRevisionRangeAfterSplit(revision, store, sourceText, boundaryUtf16Index, target)
        }
      )
    }

    if (range.endGraphemeIndex < graphemeLength) {
      if (range.trailingRunId === undefined) {
        throw createJWordError('OPERATION_RUN_FORMAT_RANGE_INVALID', '局部 run 修订缺少 trailingRunId', {
          runId: operation.runId
        })
      }

      assertRunIdUnused(store, range.trailingRunId as RunId)
      splitRunAtGraphemeIndex(
        store,
        revisionRunLocation,
        range.endGraphemeIndex - range.startGraphemeIndex,
        range.trailingRunId as RunId,
        (sourceText, boundaryUtf16Index, target) => {
          revision = migrateRevisionRangeAfterSplit(revision, store, sourceText, boundaryUtf16Index, target)
        }
      )
    }
  }

  const blockLocation = findBlockLocation(store, revisionRunLocation.blockId)

  store.revisions.set(revisionId, createRevisionRecord(revision))
  revisionRunLocation.run.set(DOCUMENT_STORE_FIELDS.run.revisionId, revisionId)
  appendIdIfMissing(
    readRequiredArray<RevisionId>(store.document, DOCUMENT_STORE_FIELDS.document.revisionIds, 'document revisionIds'),
    revisionId
  )
  appendIdIfMissing(
    readRequiredArray<RevisionId>(revisionRunLocation.run, DOCUMENT_STORE_FIELDS.run.revisionIds, 'run revisionIds'),
    revisionId
  )
  appendIdIfMissing(
    readRequiredArray<RevisionId>(blockLocation.block, DOCUMENT_STORE_FIELDS.block.revisionIds, 'block revisionIds'),
    revisionId
  )
}

/** 接受或拒绝修订，并清理修订引用。 */
export function resolveRevision(
  store: DocumentStore,
  operation: Extract<Operation, { kind: 'acceptRevision' | 'rejectRevision' }>
): void {
  const revision = findRevisionMetadata(store, operation.revisionId)

  if (
    revision.type === 'delete' && operation.kind === 'acceptRevision'
    || revision.type === 'insert' && operation.kind === 'rejectRevision'
  ) {
    deleteRange(store, operation.range.anchor, operation.range.focus)
  }

  if (revision.type === 'format' && operation.kind === 'rejectRevision') {
    for (const target of operation.formatTargets) {
      restoreRevisionFormatTarget(store, target)
    }
  }

  clearRevisionMarkup(store, operation.revisionId as RevisionId)
}

/** 查找修订 metadata，供接受/拒绝流程使用。 */
function findRevisionMetadata(store: DocumentStore, revisionId: string): RevisionMetadata {
  const record = store.revisions.get(revisionId as RevisionId)

  if (record === undefined) {
    throw createJWordError('OPERATION_REVISION_NOT_FOUND', '找不到目标修订', {
      revisionId
    })
  }

  return projectRevisionRecord(record)
}

/** 恢复格式修订记录的原始 run 属性。 */
function restoreRevisionFormatTarget(store: DocumentStore, target: RevisionFormatSnapshot): void {
  const runLocation = findRunLocation(store, target.runId as RunId)

  replaceProperties(runLocation.run, DOCUMENT_STORE_FIELDS.run.properties, target.previousProperties)
}

/** 清除修订 metadata、run 标记和引用索引。 */
function clearRevisionMarkup(store: DocumentStore, revisionId: RevisionId): void {
  store.revisions.delete(revisionId)
  removeId(
    readRequiredArray<RevisionId>(store.document, DOCUMENT_STORE_FIELDS.document.revisionIds, 'document revisionIds'),
    revisionId
  )

  for (const section of store.sections.toArray()) {
    removeId(
      readRequiredArray<RevisionId>(section, DOCUMENT_STORE_FIELDS.section.revisionIds, 'section revisionIds'),
      revisionId
    )
    clearRevisionMarkupInBlocks(getSectionBlocks(section), revisionId)
  }
}

/** 清除块容器中的修订引用。 */
function clearRevisionMarkupInBlocks(blocks: BlockContainer, revisionId: RevisionId): void {
  for (const block of blocks.toArray()) {
    removeId(
      readRequiredArray<RevisionId>(block, DOCUMENT_STORE_FIELDS.block.revisionIds, 'block revisionIds'),
      revisionId
    )

    if (block.get(DOCUMENT_STORE_FIELDS.block.kind) === 'paragraph') {
      for (const run of getParagraphRuns(block).toArray()) {
        if (run.get(DOCUMENT_STORE_FIELDS.run.revisionId) === revisionId) {
          run.delete(DOCUMENT_STORE_FIELDS.run.revisionId)
        }
        removeId(
          readRequiredArray<RevisionId>(run, DOCUMENT_STORE_FIELDS.run.revisionIds, 'run revisionIds'),
          revisionId
        )
      }

      continue
    }

    for (const row of getTableRows(block).toArray()) {
      for (const cell of getTableRowCells(row).toArray()) {
        clearRevisionMarkupInBlocks(getTableCellBlocks(cell), revisionId)
      }
    }
  }
}

/** 同步迁移本次写入的修订范围快照，避免局部拆分后定位收缩。 */
function migrateRevisionRangeAfterSplit(
  revision: RevisionMetadata,
  store: DocumentStore,
  sourceText: Y.Text,
  boundaryUtf16Index: number,
  target: TextAnchorMigrationTarget
): RevisionMetadata {
  return {
    ...revision,
    rangeSnapshot: migrateTextRangeRecordAfterSplit(
      revision.rangeSnapshot,
      store.doc,
      sourceText,
      boundaryUtf16Index,
      target
    )
  }
}
