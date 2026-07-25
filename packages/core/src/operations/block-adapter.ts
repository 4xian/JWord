/**
 * 职责：应用 section 与 block 结构类 operation 到 Y.Doc 文档结构。
 * 边界：只处理段落属性、section 属性、split/merge/insert/delete block，不处理文本内容编辑和表格内部编辑。
 * 协作模块：operation-adapter 负责分发，adapter-location 负责递归定位与锚点迁移。
 * 性能/安全约束：不访问 DOM，不触发布局渲染；所有结构写入由外层 transaction pipeline 包裹。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import {
  DOCUMENT_STORE_FIELDS,
  createParagraphRecord,
  getParagraphRuns,
  getRunText,
  getSectionBlocks
} from '../model/document-store'
import { createJWordError } from '../shared/errors'
import type { DocumentStore } from '../model/document-store'
import type { Block } from '../model/types'
import type { BlockId, RunId, SectionId } from '../model/position'
import {
  migrateTextAnchorsAfterSplit,
  migrateTextAnchorsToText
} from '../model/position'
import type { BlockInsertPlacement, Operation, TextPosition } from './transaction'
import {
  assertRunIdUnused,
  cloneRunRecord,
  findBlockLocation,
  findSection,
  migrateCommentRangesAfterSplit,
  migrateCommentRangesToText,
  resolveOperationPosition
} from './adapter-location'
import {
  createBlockRecordFromModel,
  createSplitRunRecord
} from './block-record-factory'
import {
  assertBlockKind,
  copyProperties,
  readRequiredArray,
  readRequiredString,
  replaceStringArray,
  setProperties
} from './operation-record-utils'

/** 设置段落块属性。 */
export function setParagraphProperties(
  store: DocumentStore,
  operation: Extract<Operation, { kind: 'setParagraphProperties' }>
): void {
  setProperties(findBlockLocation(store, operation.paragraphId as BlockId).block, DOCUMENT_STORE_FIELDS.block.properties, operation.properties)
}

/** 设置 section 属性与页眉页脚引用。 */
export function setSectionProperties(
  store: DocumentStore,
  operation: Extract<Operation, { kind: 'setSectionProperties' }>
): void {
  const section = findSection(store, operation.sectionId as SectionId)

  setProperties(section, DOCUMENT_STORE_FIELDS.section.properties, operation.properties)

  if (operation.headerIds !== undefined) {
    replaceStringArray(
      readRequiredArray<string>(section, DOCUMENT_STORE_FIELDS.section.headerIds, 'section headerIds'),
      operation.headerIds
    )
  }

  if (operation.footerIds !== undefined) {
    replaceStringArray(
      readRequiredArray<string>(section, DOCUMENT_STORE_FIELDS.section.footerIds, 'section footerIds'),
      operation.footerIds
    )
  }
}

/** 在指定文本位置拆分段落块。 */
export function splitBlock(
  store: DocumentStore,
  position: TextPosition,
  newBlockId: string,
  newRunId: string
): void {
  const snapshot = resolveOperationPosition(store, position)
  const location = findBlockLocation(store, snapshot.blockId)

  assertBlockKind(location.block, 'paragraph')
  assertRunIdUnused(store, newRunId as RunId)

  const runs = getParagraphRuns(location.block)
  const runLocation = snapshot.runLocation
  const sharedText = getRunText(runLocation.run)
  const index = snapshot.utf16Index
  const tailText = sharedText.toString().slice(index)
  const followingRuns = runs.toArray().slice(runLocation.index + 1)
  const nextRuns = followingRuns.map(cloneRunRecord)
  const newParagraph = createParagraphRecord(newBlockId as BlockId)

  location.container.insert(location.index + 1, [newParagraph])
  copyProperties(location.block, newParagraph, DOCUMENT_STORE_FIELDS.block.properties)

  const newParagraphRuns = getParagraphRuns(newParagraph)

  const splitRunId = newRunId as RunId
  const splitRun = createSplitRunRecord(splitRunId, tailText, runLocation.run)

  newParagraphRuns.push([splitRun, ...nextRuns])
  migrateTextAnchorsAfterSplit(sharedText, store.doc, index, {
    sectionId: snapshot.sectionId,
    blockId: newBlockId as BlockId,
    runId: splitRunId,
    text: getRunText(splitRun)
  })
  migrateCommentRangesAfterSplit(store, sharedText, index, {
    sectionId: snapshot.sectionId,
    blockId: newBlockId as BlockId,
    runId: splitRunId,
    text: getRunText(splitRun)
  })
  for (let nextRunIndex = 0; nextRunIndex < followingRuns.length; nextRunIndex += 1) {
    const sourceRun = followingRuns[nextRunIndex]
    const clonedRun = nextRuns[nextRunIndex]

    if (sourceRun === undefined || clonedRun === undefined) {
      continue
    }

    migrateTextAnchorsToText(getRunText(sourceRun), store.doc, {
      sectionId: snapshot.sectionId,
      blockId: newBlockId as BlockId,
      runId: readRequiredString(clonedRun, DOCUMENT_STORE_FIELDS.run.id) as RunId,
      text: getRunText(clonedRun)
    })
    migrateCommentRangesToText(store, getRunText(sourceRun), {
      sectionId: snapshot.sectionId,
      blockId: newBlockId as BlockId,
      runId: readRequiredString(clonedRun, DOCUMENT_STORE_FIELDS.run.id) as RunId,
      text: getRunText(clonedRun)
    })
  }

  if (tailText.length > 0) {
    sharedText.delete(index, tailText.length)
  }

  if (runs.length > runLocation.index + 1) {
    runs.delete(runLocation.index + 1, runs.length - runLocation.index - 1)
  }
}

/** 合并同一容器中相邻段落块。 */
export function mergeBlock(store: DocumentStore, targetBlockId: string, sourceBlockId: string): void {
  const target = findBlockLocation(store, targetBlockId as BlockId)
  const source = findBlockLocation(store, sourceBlockId as BlockId)

  assertBlockKind(target.block, 'paragraph')
  assertBlockKind(source.block, 'paragraph')

  if (target.container !== source.container || source.index !== target.index + 1) {
    throw createJWordError('OPERATION_MERGE_BLOCK_NOT_ADJACENT', 'mergeBlock 暂只支持同一容器中的相邻段落', {
      targetBlockId: String(targetBlockId),
      sourceBlockId: String(sourceBlockId)
    })
  }

  const sourceRuns = getParagraphRuns(source.block).toArray()
  const clonedRuns = sourceRuns.map(cloneRunRecord)

  getParagraphRuns(target.block).push(clonedRuns)
  for (let index = 0; index < sourceRuns.length; index += 1) {
    const sourceRun = sourceRuns[index]
    const clonedRun = clonedRuns[index]

    if (sourceRun === undefined || clonedRun === undefined) {
      continue
    }

    migrateTextAnchorsToText(getRunText(sourceRun), store.doc, {
      blockId: targetBlockId as BlockId,
      runId: readRequiredString(clonedRun, DOCUMENT_STORE_FIELDS.run.id) as RunId,
      text: getRunText(clonedRun)
    })
    migrateCommentRangesToText(store, getRunText(sourceRun), {
      blockId: targetBlockId as BlockId,
      runId: readRequiredString(clonedRun, DOCUMENT_STORE_FIELDS.run.id) as RunId,
      text: getRunText(clonedRun)
    })
  }
  source.container.delete(source.index, 1)
}

/** 插入新的块记录到 section 块容器。 */
export function insertBlock(
  store: DocumentStore,
  sectionId: string,
  placement: BlockInsertPlacement,
  block: Block
): void {
  const section = findSection(store, sectionId as SectionId)
  const blocks = getSectionBlocks(section)
  const blockRecord = createBlockRecordFromModel(block)

  if (placement.kind === 'append') {
    blocks.push([blockRecord])
    return
  }

  const index = blocks.toArray().findIndex(
    (candidate) => candidate.get(DOCUMENT_STORE_FIELDS.block.id) === placement.blockId
  )

  if (index < 0) {
    throw createJWordError('OPERATION_INSERT_BLOCK_REFERENCE_NOT_FOUND', 'insertBlock 找不到参照块', {
      blockId: String(placement.blockId)
    })
  }

  blocks.insert(placement.kind === 'before' ? index : index + 1, [blockRecord])
}

/** 删除指定块记录。 */
export function deleteBlock(store: DocumentStore, blockId: string): void {
  const location = findBlockLocation(store, blockId as BlockId)

  location.container.delete(location.index, 1)
}
