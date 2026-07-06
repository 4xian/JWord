/**
 * 职责：集中提供 operation adapter 的文档定位、run 拆分和文本锚点迁移辅助能力。
 * 边界：只在 Y.Doc 状态结构内查找或移动既有记录，不解释具体 operation 的业务语义。
 * 协作模块：文本适配器、块适配器、图片适配器、修订适配器复用这里的定位结果。
 * 性能/安全约束：不访问 DOM，不触发布局渲染；所有写入由外层 transaction pipeline 包裹。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/03-architecture.md#34-operation。
 */
import * as Y from 'yjs'

import {
  DOCUMENT_STORE_FIELDS,
  createCommentRangeRecord,
  getParagraphRuns,
  getRunText,
  getSectionBlocks,
  getTableCellBlocks,
  getTableRowCells,
  getTableRows,
  readCommentRangeRecord
} from '../model/document-store'
import { createJWordError } from '../shared/errors'
import { graphemeIndexToUtf16Index } from '../shared/grapheme'
import type {
  BlockContainer,
  BlockRecord,
  CommentRangeId,
  DocumentStore,
  RunContainer,
  RunRecord,
  SectionRecord
} from '../model/document-store'
import type { TextPosition } from './transaction'
import type { BlockId, GraphemeIndex, RunId, SectionId, TextAnchorMigrationTarget } from '../model/position'
import {
  createGraphemeIndex,
  migrateTextAnchorsAfterSplit,
  migrateTextRangeRecordAfterSplit,
  migrateTextRangeRecordToText
} from '../model/position'
import { createSplitRunRecord } from './block-record-factory'
import { assertBlockKind, readRequiredString } from './operation-record-utils'

export interface ResolvedTextPosition {
  readonly sectionId: SectionId
  readonly blockId: BlockId
  readonly runId: RunId
  readonly graphemeIndex: GraphemeIndex
  readonly utf16Index: number
  readonly runLocation: RunLocation
}

export interface BlockLocation {
  readonly block: BlockRecord
  readonly container: BlockContainer
  readonly index: number
}

export interface RunLocation {
  readonly run: RunRecord
  readonly container: RunContainer
  readonly index: number
  readonly blockId: BlockId
}

/** 解析 operation 文本位置到具体 run 与 UTF-16 索引。 */
export function resolveOperationPosition(store: DocumentStore, position: TextPosition): ResolvedTextPosition {
  const runLocation = findRunLocationByPosition(store, position)
  const sharedText = getRunText(runLocation.run)
  const index = graphemeIndexToUtf16Index(sharedText.toString(), position.graphemeIndex)

  return {
    sectionId: position.sectionId as SectionId,
    blockId: position.blockId as BlockId,
    runId: position.runId as RunId,
    graphemeIndex: createGraphemeIndex(position.graphemeIndex),
    utf16Index: index,
    runLocation
  }
}

/** 按 ID 查找 section 记录。 */
export function findSection(store: DocumentStore, sectionId: SectionId): SectionRecord {
  const section = store.sections.toArray().find(
    (candidate) => candidate.get(DOCUMENT_STORE_FIELDS.section.id) === sectionId
  )

  if (section === undefined) {
    throw createJWordError('OPERATION_SECTION_NOT_FOUND', '找不到节', {
      sectionId: String(sectionId)
    })
  }

  return section
}

/** 按 ID 在文档内递归查找 block 位置。 */
export function findBlockLocation(store: DocumentStore, blockId: BlockId): BlockLocation {
  for (const section of store.sections.toArray()) {
    const location = findBlockLocationInContainer(getSectionBlocks(section), blockId)

    if (location !== undefined) {
      return location
    }
  }

  throw createJWordError('OPERATION_BLOCK_NOT_FOUND', '找不到块', {
    blockId: String(blockId)
  })
}

/** 按 ID 在块容器内递归查找 block 位置。 */
export function findBlockLocationInContainer(container: BlockContainer, blockId: BlockId): BlockLocation | undefined {
  const blocks = container.toArray()

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index]

    if (block === undefined) {
      continue
    }

    if (block.get(DOCUMENT_STORE_FIELDS.block.id) === blockId) {
      return { block, container, index }
    }

    if (block.get(DOCUMENT_STORE_FIELDS.block.kind) === 'table') {
      for (const row of getTableRows(block).toArray()) {
        for (const cell of getTableRowCells(row).toArray()) {
          const nested = findBlockLocationInContainer(getTableCellBlocks(cell), blockId)

          if (nested !== undefined) {
            return nested
          }
        }
      }
    }
  }

  return undefined
}

/** 按 run ID 在全文递归查找 run 位置。 */
export function findRunLocation(store: DocumentStore, runId: RunId): RunLocation {
  for (const section of store.sections.toArray()) {
    const run = findRunLocationInBlocks(getSectionBlocks(section), runId)

    if (run !== undefined) {
      return run
    }
  }

  throw createJWordError('OPERATION_RUN_NOT_FOUND', '找不到 run', {
    runId: String(runId)
  })
}

/** 按 TextPosition 在指定 section/block 中查找 run 位置。 */
export function findRunLocationByPosition(store: DocumentStore, position: TextPosition): RunLocation {
  const section = findSection(store, position.sectionId as SectionId)
  const blockLocation = findBlockLocationInContainer(getSectionBlocks(section), position.blockId as BlockId)

  if (blockLocation === undefined) {
    throw createJWordError('OPERATION_BLOCK_NOT_FOUND', '找不到块', {
      blockId: position.blockId
    })
  }

  assertBlockKind(blockLocation.block, 'paragraph')

  return findRunLocationInBlock(blockLocation.block, position.runId as RunId)
}

/** 按 run ID 在块容器内递归查找 run 位置。 */
export function findRunLocationInBlocks(blocks: BlockContainer, runId: RunId): RunLocation | undefined {
  for (const block of blocks.toArray()) {
    if (block.get(DOCUMENT_STORE_FIELDS.block.kind) === 'paragraph') {
      const run = findRunLocationInParagraph(block, runId)

      if (run !== undefined) {
        return run
      }
    }

    if (block.get(DOCUMENT_STORE_FIELDS.block.kind) === 'table') {
      for (const row of getTableRows(block).toArray()) {
        for (const cell of getTableRowCells(row).toArray()) {
          const run = findRunLocationInBlocks(getTableCellBlocks(cell), runId)

          if (run !== undefined) {
            return run
          }
        }
      }
    }
  }

  return undefined
}

/** 断言新的 run ID 尚未出现在当前文档中。 */
export function assertRunIdUnused(store: DocumentStore, runId: RunId): void {
  if (findRunLocationInStore(store, runId) !== undefined) {
    throw createJWordError('OPERATION_RUN_ID_DUPLICATE', 'run ID 已存在', {
      runId: String(runId)
    })
  }
}

/** 复制一个文本 run 记录并保留原 run ID。 */
export function cloneRunRecord(run: RunRecord): RunRecord {
  const id = readRequiredString(run, DOCUMENT_STORE_FIELDS.run.id) as RunId
  const text = getRunText(run).toString()

  return createSplitRunRecord(id, text, run)
}

/** 按 grapheme 下标拆分 run，并迁移文本锚点与批注范围。 */
export function splitRunAtGraphemeIndex(
  store: DocumentStore,
  runLocation: RunLocation,
  graphemeIndex: number,
  newRunId: RunId,
  beforeSourceTailDelete?: (
    sourceText: Y.Text,
    boundaryUtf16Index: number,
    target: TextAnchorMigrationTarget
  ) => void
): RunLocation {
  const sharedText = getRunText(runLocation.run)
  const utf16Index = graphemeIndexToUtf16Index(sharedText.toString(), graphemeIndex)
  const tailText = sharedText.toString().slice(utf16Index)
  const splitRun = createSplitRunRecord(newRunId, tailText, runLocation.run)

  runLocation.container.insert(runLocation.index + 1, [splitRun])

  const target = {
    blockId: runLocation.blockId,
    runId: newRunId,
    text: getRunText(splitRun)
  }

  migrateTextAnchorsAfterSplit(sharedText, store.doc, utf16Index, target)
  migrateCommentRangesAfterSplit(store, sharedText, utf16Index, target)
  beforeSourceTailDelete?.(sharedText, utf16Index, target)

  if (tailText.length > 0) {
    sharedText.delete(utf16Index, tailText.length)
  }

  return {
    run: splitRun,
    container: runLocation.container,
    index: runLocation.index + 1,
    blockId: runLocation.blockId
  }
}

/** 迁移所有批注范围到 run 拆分后的尾部文本。 */
export function migrateCommentRangesAfterSplit(
  store: DocumentStore,
  sourceText: Y.Text,
  boundaryUtf16Index: number,
  target: Readonly<{
    sectionId?: SectionId
    blockId: BlockId
    runId: RunId
    text: Y.Text
  }>
): void {
  for (const [rangeId, record] of store.commentRanges.entries()) {
    const snapshot = readCommentRangeRecord(record)
    const nextSnapshot = migrateTextRangeRecordAfterSplit(
      snapshot,
      store.doc,
      sourceText,
      boundaryUtf16Index,
      {
        ...(target.sectionId === undefined ? {} : { sectionId: target.sectionId }),
        blockId: target.blockId,
        runId: target.runId,
        text: target.text
      }
    )

    if (nextSnapshot !== snapshot) {
      store.commentRanges.set(rangeId as CommentRangeId, createCommentRangeRecord(nextSnapshot))
    }
  }
}

/** 迁移所有批注范围到指定目标文本。 */
export function migrateCommentRangesToText(
  store: DocumentStore,
  sourceText: Y.Text,
  target: Readonly<{
    sectionId?: SectionId
    blockId: BlockId
    runId: RunId
    text: Y.Text
  }>
): void {
  for (const [rangeId, record] of store.commentRanges.entries()) {
    const snapshot = readCommentRangeRecord(record)
    const nextSnapshot = migrateTextRangeRecordToText(
      snapshot,
      store.doc,
      sourceText,
      {
        ...(target.sectionId === undefined ? {} : { sectionId: target.sectionId }),
        blockId: target.blockId,
        runId: target.runId,
        text: target.text
      }
    )

    if (nextSnapshot !== snapshot) {
      store.commentRanges.set(rangeId as CommentRangeId, createCommentRangeRecord(nextSnapshot))
    }
  }
}

/** 校验局部 run 格式范围位于合法 grapheme 边界内。 */
export function assertRunPropertyRange(
  startGraphemeIndex: number,
  endGraphemeIndex: number,
  graphemeLength: number
): void {
  if (
    !Number.isInteger(startGraphemeIndex)
    || !Number.isInteger(endGraphemeIndex)
    || startGraphemeIndex < 0
    || endGraphemeIndex > graphemeLength
    || startGraphemeIndex >= endGraphemeIndex
  ) {
    throw createJWordError('OPERATION_RUN_FORMAT_RANGE_INVALID', '局部 run 格式范围非法', {
      startGraphemeIndex,
      endGraphemeIndex,
      graphemeLength
    })
  }
}

/** 在全文中查找 run 位置，不存在时返回 undefined。 */
function findRunLocationInStore(store: DocumentStore, runId: RunId): RunLocation | undefined {
  for (const section of store.sections.toArray()) {
    const run = findRunLocationInBlocks(getSectionBlocks(section), runId)

    if (run !== undefined) {
      return run
    }
  }

  return undefined
}

/** 按 run ID 在段落块中查找 run 位置。 */
function findRunLocationInBlock(block: BlockRecord, runId: RunId): RunLocation {
  const run = findRunLocationInParagraph(block, runId)

  if (run !== undefined) {
    return run
  }

  throw createJWordError('OPERATION_RUN_NOT_IN_BLOCK', '段落中找不到 run', {
    runId: String(runId)
  })
}

/** 按 run ID 在段落记录中查找 run 位置。 */
function findRunLocationInParagraph(block: BlockRecord, runId: RunId): RunLocation | undefined {
  const runs = getParagraphRuns(block)
  const runRecords = runs.toArray()
  const blockId = readRequiredString(block, DOCUMENT_STORE_FIELDS.block.id) as BlockId

  for (let index = 0; index < runRecords.length; index += 1) {
    const run = runRecords[index]

    if (run !== undefined && run.get(DOCUMENT_STORE_FIELDS.run.id) === runId) {
      return { run, container: runs, index, blockId }
    }
  }

  return undefined
}
