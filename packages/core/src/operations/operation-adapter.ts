/**
 * 职责：把 Gate 1 第一批 Operation 应用到 Y.Doc 权威状态结构。
 * 边界：只做最小状态变更，不触发布局、渲染、输入、历史、协同或事件发布。
 * 协作模块：transaction pipeline 后续会在 ydoc.transact(origin) 内调用这里的 adapter。
 * 性能/安全约束：当前实现按容器扫描定位，适合 Gate 1 骨架验证，不访问 DOM，不保留外部可写状态。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/03-architecture.md#34-operation。
 */
import * as Y from 'yjs'

import {
  DOCUMENT_STORE_FIELDS,
  createCommentRangeRecord,
  createCommentRecord,
  createDocumentStore,
  createParagraphRecord,
  createResourceRecord,
  createRevisionRecord,
  createRunRecord,
  getRunField,
  getRunInlines,
  getRunLink,
  projectCommentRecord,
  readCommentRangeRecord,
  getRunRevisionId,
  getParagraphRuns,
  getRunText,
  getSectionBlocks,
  setRunLinkValue,
  setRunStructure,
  getTableCellBlocks,
  getTableRowCells,
  getTableRows
} from '../model/document-store'
import { isAllowedLinkUrl } from '../links/policy'
import { isAllowedResourceUrl } from '../resources/types'
import { createJWordError } from '../shared/errors'
import {
  countGraphemes,
  graphemeIndexToUtf16Index
} from '../shared/grapheme'
import type {
  BlockContainer,
  BlockRecord,
  BlockRecordValue,
  CommentRangeId,
  DocumentStore,
  DocumentStoreJson,
  ResourceId,
  RunContainer,
  RunRecord,
  RunRecordValue,
  SectionRecord,
  StyleId
} from '../model/document-store'
import type { Block, Run } from '../model/types'
import type { BlockInsertPlacement, Operation, TextPosition } from './transaction'
import {
  migrateTextAnchorsAfterSplit,
  migrateTextAnchorsToText,
  migrateTextRangeRecordAfterSplit,
  migrateTextRangeRecordToText
} from '../model/position'
import type { BlockId, CommentId, GraphemeIndex, RevisionId, RunId, SectionId } from '../model/position'
import { createGraphemeIndex } from '../model/position'
import type { ResourceUrlPolicy } from '../resources/types'
import {
  createBlockRecordFromModel,
  createImageRunRecord,
  createSplitRunRecord,
  createTrailingTextRunRecord,
  shouldInsertTrailingTextRun,
  syncRunResourceIds
} from './block-record-factory'
import { applyTableOperation } from './table-operation-adapter'

/**
 * Operation 到 Y.Doc 的最小 adapter。
 */
export interface OperationAdapter {
  readonly store: DocumentStore
  apply(operation: Operation): void
  applyAll(operations: readonly Operation[]): void
}

export interface OperationAdapterOptions {
  readonly resourceUrlPolicy?: ResourceUrlPolicy
}

/**
 * 创建 Operation adapter。
 *
 * @param input 文档状态壳或 Y.Doc。
 * @returns 可应用 operation 的 adapter。
 */
export function createOperationAdapter(
  input: DocumentStore | Y.Doc,
  options: OperationAdapterOptions = {}
): OperationAdapter {
  const store = input instanceof Y.Doc ? createDocumentStore(input) : input

  return {
    store,
    apply(operation) {
      applyOperation(store, operation, options)
    },
    applyAll(operations) {
      for (const operation of operations) {
        applyOperation(store, operation, options)
      }
    }
  }
}

/**
 * 应用单个 operation。
 *
 * @param store 文档状态壳。
 * @param operation 待应用操作。
 */
export function applyOperation(
  store: DocumentStore,
  operation: Operation,
  options: OperationAdapterOptions = {}
): void {
  switch (operation.kind) {
    case 'insertText':
      insertText(store, operation.at, operation.text)
      break
    case 'deleteRange':
      deleteRange(store, operation.range.anchor, operation.range.focus)
      break
    case 'setRunProperties':
      setRunProperties(store, operation)
      break
    case 'setParagraphProperties':
      setProperties(findBlockLocation(store, operation.paragraphId as BlockId).block, DOCUMENT_STORE_FIELDS.block.properties, operation.properties)
      break
    case 'setSectionProperties':
      setSectionProperties(store, operation)
      break
    case 'splitBlock':
      splitBlock(store, operation.at, operation.newBlockId, operation.newRunId)
      break
    case 'mergeBlock':
      mergeBlock(store, operation.targetBlockId, operation.sourceBlockId)
      break
    case 'insertBlock':
      insertBlock(store, operation.sectionId, operation.placement, operation.block)
      break
    case 'deleteBlock':
      deleteBlock(store, operation.blockId)
      break
    case 'upsertResource':
      upsertResource(store, operation.resource, options.resourceUrlPolicy)
      break
    case 'deleteResource':
      deleteResource(store, operation.resourceId)
      break
    case 'insertImage':
      insertImage(store, operation)
      break
    case 'replaceImageResource':
      replaceImageResource(store, operation.runId, operation.resourceId)
      break
    case 'deleteImage':
      deleteImage(store, operation.runId)
      break
    case 'resizeImage':
      resizeImage(store, operation.runId, operation.widthTwips, operation.heightTwips)
      break
    case 'setImageRotation':
      setImageRotation(store, operation.runId, operation.rotationDegrees)
      break
    case 'insertTable':
      insertBlock(store, operation.sectionId, operation.placement, operation.table)
      break
    case 'insertTableRow':
      applyTableOperation(store, operation)
      break
    case 'deleteTableRow':
      applyTableOperation(store, operation)
      break
    case 'insertTableColumn':
      applyTableOperation(store, operation)
      break
    case 'deleteTableColumn':
      applyTableOperation(store, operation)
      break
    case 'setTableColumnWidth':
      applyTableOperation(store, operation)
      break
    case 'setTableRowHeight':
      applyTableOperation(store, operation)
      break
    case 'mergeTableCells':
      applyTableOperation(store, operation)
      break
    case 'setTableBorder':
      applyTableOperation(store, operation)
      break
    case 'setTableCellText':
      applyTableOperation(store, operation)
      break
    case 'addCommentThread':
      addCommentThread(store, operation)
      break
    case 'replyCommentThread':
      replyCommentThread(store, operation)
      break
    case 'editCommentEntry':
      editCommentEntry(store, operation)
      break
    case 'resolveCommentThread':
      resolveCommentThread(store, operation)
      break
    case 'reopenCommentThread':
      reopenCommentThread(store, operation)
      break
    case 'deleteCommentThread':
      deleteCommentThread(store, operation.threadId)
      break
    case 'setRunLink':
      setRunLink(store, operation)
      break
    case 'addRevisionMetadata':
      addRevisionMetadata(store, operation)
      break
  }
}

function upsertResource(
  store: DocumentStore,
  resource: Extract<Operation, { kind: 'upsertResource' }>['resource'],
  resourceUrlPolicy?: ResourceUrlPolicy
): void {
  if (!isAllowedResourceUrl(resource.source.url, resourceUrlPolicy)) {
    throw createJWordError('OPERATION_RESOURCE_URL_DISALLOWED', '资源 URL 不在 allowlist 内', {
      resourceId: resource.id,
      url: resource.source.url
    })
  }

  store.resources.set(resource.id as ResourceId, createResourceRecord(resource))
  appendIdIfMissing(
    readRequiredArray<ResourceId>(store.document, DOCUMENT_STORE_FIELDS.document.resourceIds, 'document resourceIds'),
    resource.id as ResourceId
  )
}

function deleteResource(store: DocumentStore, resourceId: string): void {
  store.resources.delete(resourceId as ResourceId)
  removeId(
    readRequiredArray<ResourceId>(store.document, DOCUMENT_STORE_FIELDS.document.resourceIds, 'document resourceIds'),
    resourceId as ResourceId
  )
}

function addCommentThread(
  store: DocumentStore,
  operation: Extract<Operation, { kind: 'addCommentThread' }>
): void {
  store.comments.set(operation.thread.id as CommentId, createCommentRecord(operation.thread))
  store.commentRanges.set(operation.range.id as CommentRangeId, createCommentRangeRecord(operation.range))
  appendIdIfMissing(
    readRequiredArray<CommentId>(store.document, DOCUMENT_STORE_FIELDS.document.commentIds, 'document commentIds'),
    operation.thread.id as CommentId
  )
}

function replyCommentThread(
  store: DocumentStore,
  operation: Extract<Operation, { kind: 'replyCommentThread' }>
): void {
  replaceCommentThread(store, operation.threadId, (thread) => ({
    ...thread,
    messages: [...thread.messages, operation.message]
  }))
}

function editCommentEntry(
  store: DocumentStore,
  operation: Extract<Operation, { kind: 'editCommentEntry' }>
): void {
  replaceCommentThread(store, operation.threadId, (thread) => ({
    ...thread,
    messages: thread.messages.map((message) =>
      message.id !== operation.messageId
        ? message
        : {
            ...message,
            text: operation.text,
            editedAt: operation.editedAt
          }
    )
  }))
}

function resolveCommentThread(
  store: DocumentStore,
  operation: Extract<Operation, { kind: 'resolveCommentThread' }>
): void {
  replaceCommentThread(store, operation.threadId, (thread) => ({
    ...thread,
    resolved: true
  }))
}

function reopenCommentThread(
  store: DocumentStore,
  operation: Extract<Operation, { kind: 'reopenCommentThread' }>
): void {
  replaceCommentThread(store, operation.threadId, (thread) => ({
    ...thread,
    resolved: false
  }))
}

function deleteCommentThread(store: DocumentStore, threadId: string): void {
  const commentRecord = findCommentRecord(store, threadId)
  const rangeId = commentRecord.get(DOCUMENT_STORE_FIELDS.comment.anchorRangeId)

  store.comments.delete(threadId as CommentId)
  removeId(
    readRequiredArray<CommentId>(store.document, DOCUMENT_STORE_FIELDS.document.commentIds, 'document commentIds'),
    threadId as CommentId
  )

  if (typeof rangeId === 'string') {
    store.commentRanges.delete(rangeId as CommentRangeId)
  }
}

function setSectionProperties(
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

function setRunProperties(
  store: DocumentStore,
  operation: Extract<Operation, { kind: 'setRunProperties' }>
): void {
  const runLocation = findRunLocation(store, operation.runId as RunId)
  const range = operation.range

  if (range === undefined) {
    setProperties(runLocation.run, DOCUMENT_STORE_FIELDS.run.properties, operation.properties)
    return
  }

  const runText = getRunText(runLocation.run).toString()
  const graphemeLength = countGraphemes(runText)

  assertRunPropertyRange(range.startGraphemeIndex, range.endGraphemeIndex, graphemeLength)

  if (range.startGraphemeIndex === 0 && range.endGraphemeIndex === graphemeLength) {
    setProperties(runLocation.run, DOCUMENT_STORE_FIELDS.run.properties, operation.properties)
    return
  }

  let formattedRunLocation = runLocation

  if (range.startGraphemeIndex > 0) {
    if (range.formattedRunId === undefined) {
      throw createJWordError('OPERATION_RUN_FORMAT_RANGE_INVALID', '局部 run 格式缺少 formattedRunId', {
        runId: operation.runId
      })
    }

    assertRunIdUnused(store, range.formattedRunId as RunId)
    formattedRunLocation = splitRunAtGraphemeIndex(
      store,
      runLocation,
      range.startGraphemeIndex,
      range.formattedRunId as RunId
    )
  }

  if (range.endGraphemeIndex < graphemeLength) {
    if (range.trailingRunId === undefined) {
      throw createJWordError('OPERATION_RUN_FORMAT_RANGE_INVALID', '局部 run 格式缺少 trailingRunId', {
        runId: operation.runId
      })
    }

    assertRunIdUnused(store, range.trailingRunId as RunId)
    splitRunAtGraphemeIndex(
      store,
      formattedRunLocation,
      range.endGraphemeIndex - range.startGraphemeIndex,
      range.trailingRunId as RunId
    )
  }

  setProperties(formattedRunLocation.run, DOCUMENT_STORE_FIELDS.run.properties, operation.properties)
}

function setRunLink(
  store: DocumentStore,
  operation: Extract<Operation, { kind: 'setRunLink' }>
): void {
  if (operation.link !== null && !isAllowedLinkUrl(operation.link.target)) {
    throw createJWordError('OPERATION_LINK_URL_DISALLOWED', '链接 URL 不在 allowlist 内', {
      target: operation.link.target
    })
  }

  const runLocation = findRunLocation(store, operation.runId as RunId)
  const range = operation.range

  if (range === undefined) {
    setRunLinkValue(runLocation.run, operation.link)
    return
  }

  const runText = getRunText(runLocation.run).toString()
  const graphemeLength = countGraphemes(runText)

  assertRunPropertyRange(range.startGraphemeIndex, range.endGraphemeIndex, graphemeLength)

  if (range.startGraphemeIndex === 0 && range.endGraphemeIndex === graphemeLength) {
    setRunLinkValue(runLocation.run, operation.link)
    return
  }

  let linkedRunLocation = runLocation

  if (range.startGraphemeIndex > 0) {
    if (range.linkedRunId === undefined) {
      throw createJWordError('OPERATION_RUN_FORMAT_RANGE_INVALID', '局部 run 链接缺少 linkedRunId', {
        runId: operation.runId
      })
    }

    assertRunIdUnused(store, range.linkedRunId as RunId)
    linkedRunLocation = splitRunAtGraphemeIndex(
      store,
      runLocation,
      range.startGraphemeIndex,
      range.linkedRunId as RunId
    )
  }

  if (range.endGraphemeIndex < graphemeLength) {
    if (range.trailingRunId === undefined) {
      throw createJWordError('OPERATION_RUN_FORMAT_RANGE_INVALID', '局部 run 链接缺少 trailingRunId', {
        runId: operation.runId
      })
    }

    assertRunIdUnused(store, range.trailingRunId as RunId)
    splitRunAtGraphemeIndex(
      store,
      linkedRunLocation,
      range.endGraphemeIndex - range.startGraphemeIndex,
      range.trailingRunId as RunId
    )
  }

  setRunLinkValue(linkedRunLocation.run, operation.link)
}

function addRevisionMetadata(
  store: DocumentStore,
  operation: Extract<Operation, { kind: 'addRevisionMetadata' }>
): void {
  const revisionId = operation.revision.id as RevisionId
  const runLocation = findRunLocation(store, operation.runId as RunId)
  const blockLocation = findBlockLocation(store, runLocation.blockId)

  store.revisions.set(revisionId, createRevisionRecord(operation.revision))
  runLocation.run.set(DOCUMENT_STORE_FIELDS.run.revisionId, revisionId)
  appendIdIfMissing(
    readRequiredArray<RevisionId>(store.document, DOCUMENT_STORE_FIELDS.document.revisionIds, 'document revisionIds'),
    revisionId
  )
  appendIdIfMissing(
    readRequiredArray<RevisionId>(runLocation.run, DOCUMENT_STORE_FIELDS.run.revisionIds, 'run revisionIds'),
    revisionId
  )
  appendIdIfMissing(
    readRequiredArray<RevisionId>(blockLocation.block, DOCUMENT_STORE_FIELDS.block.revisionIds, 'block revisionIds'),
    revisionId
  )
}

function insertText(store: DocumentStore, position: TextPosition, text: string): void {
  const location = resolveOperationPosition(store, position)
  const sharedText = getRunText(location.runLocation.run)

  sharedText.insert(location.utf16Index, text)
}

function deleteRange(
  store: DocumentStore,
  anchor: TextPosition,
  focus: TextPosition
): void {
  const anchorSnapshot = resolveOperationPosition(store, anchor)
  const focusSnapshot = resolveOperationPosition(store, focus)
  const { start, end } = normalizeDeleteRange(store, anchorSnapshot, focusSnapshot)

  if (start.runId === end.runId) {
    deleteSameRunRange(start, end)
    return
  }

  if (start.blockId === end.blockId) {
    deleteSameBlockRange(start, end)
    return
  }

  deleteCrossBlockRange(store, start, end)
}

function normalizeDeleteRange(
  store: DocumentStore,
  anchor: ResolvedTextPosition,
  focus: ResolvedTextPosition
): Readonly<{
  start: ResolvedTextPosition
  end: ResolvedTextPosition
}> {
  if (anchor.sectionId !== focus.sectionId) {
    throw createJWordError('OPERATION_DELETE_RANGE_UNSUPPORTED_SECTION', 'deleteRange 暂不支持跨 section 删除', {
      anchorSectionId: String(anchor.sectionId),
      focusSectionId: String(focus.sectionId)
    })
  }

  return compareResolvedTextPositions(store, anchor, focus) <= 0
    ? { start: anchor, end: focus }
    : { start: focus, end: anchor }
}

function compareResolvedTextPositions(
  store: DocumentStore,
  left: ResolvedTextPosition,
  right: ResolvedTextPosition
): number {
  if (left.blockId === right.blockId) {
    if (left.runLocation.index !== right.runLocation.index) {
      return left.runLocation.index - right.runLocation.index
    }

    return left.utf16Index - right.utf16Index
  }

  const leftBlock = findBlockLocation(store, left.blockId)
  const rightBlock = findBlockLocation(store, right.blockId)

  if (leftBlock.container !== rightBlock.container) {
    throw createJWordError('OPERATION_DELETE_RANGE_UNSUPPORTED_CONTAINER', 'deleteRange 暂不支持跨容器删除', {
      anchorBlockId: String(left.blockId),
      focusBlockId: String(right.blockId)
    })
  }

  return leftBlock.index - rightBlock.index
}

function deleteSameRunRange(start: ResolvedTextPosition, end: ResolvedTextPosition): void {
  const sharedText = getRunText(start.runLocation.run)
  const from = Math.min(start.utf16Index, end.utf16Index)
  const length = Math.abs(end.utf16Index - start.utf16Index)

  if (length > 0) {
    sharedText.delete(from, length)
  }
}

function deleteSameBlockRange(start: ResolvedTextPosition, end: ResolvedTextPosition): void {
  const runs = start.runLocation.container
  const endText = getRunText(end.runLocation.run)
  const startText = getRunText(start.runLocation.run)

  if (end.utf16Index > 0) {
    endText.delete(0, end.utf16Index)
  }

  if (start.utf16Index < startText.length) {
    startText.delete(start.utf16Index, startText.length - start.utf16Index)
  }

  const middleRunCount = end.runLocation.index - start.runLocation.index - 1

  if (middleRunCount > 0) {
    runs.delete(start.runLocation.index + 1, middleRunCount)
  }
}

function deleteCrossBlockRange(store: DocumentStore, start: ResolvedTextPosition, end: ResolvedTextPosition): void {
  const startBlock = findBlockLocation(store, start.blockId)
  const endBlock = findBlockLocation(store, end.blockId)

  if (startBlock.container !== endBlock.container) {
    throw createJWordError('OPERATION_DELETE_RANGE_UNSUPPORTED_CONTAINER', 'deleteRange 暂不支持跨容器删除', {
      anchorBlockId: String(start.blockId),
      focusBlockId: String(end.blockId)
    })
  }

  assertBlockKind(startBlock.block, 'paragraph')
  assertBlockKind(endBlock.block, 'paragraph')

  const startRuns = getParagraphRuns(startBlock.block)
  const endRuns = getParagraphRuns(endBlock.block)
  const startText = getRunText(start.runLocation.run)
  const endText = getRunText(end.runLocation.run)

  if (start.utf16Index < startText.length) {
    startText.delete(start.utf16Index, startText.length - start.utf16Index)
  }

  if (startRuns.length > start.runLocation.index + 1) {
    startRuns.delete(start.runLocation.index + 1, startRuns.length - start.runLocation.index - 1)
  }

  if (end.utf16Index > 0) {
    endText.delete(0, end.utf16Index)
  }

  if (end.runLocation.index > 0) {
    endRuns.delete(0, end.runLocation.index)
  }

  const middleBlockCount = endBlock.index - startBlock.index - 1

  if (middleBlockCount > 0) {
    startBlock.container.delete(startBlock.index + 1, middleBlockCount)
  }

  mergeBlock(store, String(start.blockId), String(end.blockId))
}

function splitBlock(
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

function mergeBlock(store: DocumentStore, targetBlockId: string, sourceBlockId: string): void {
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

function insertBlock(
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

function deleteBlock(store: DocumentStore, blockId: string): void {
  const location = findBlockLocation(store, blockId as BlockId)

  location.container.delete(location.index, 1)
}

function insertImage(
  store: DocumentStore,
  operation: Extract<Operation, { kind: 'insertImage' }>
): void {
  assertRunIdUnused(store, operation.imageRunId as RunId)
  assertResourceExists(store, operation.image.resourceId)

  insertInlineImage(store, operation)
}

function insertInlineImage(
  store: DocumentStore,
  operation: Extract<Operation, { kind: 'insertImage' }>
): void {
  const snapshot = resolveOperationPosition(store, operation.at)
  const runText = getRunText(snapshot.runLocation.run).toString()
  const graphemeLength = countGraphemes(runText)
  let insertIndex = snapshot.runLocation.index

  if (snapshot.graphemeIndex > 0 && snapshot.graphemeIndex < graphemeLength) {
    if (operation.trailingRunId === undefined) {
      throw createJWordError('OPERATION_RUN_FORMAT_RANGE_INVALID', '行内图片插入缺少 trailingRunId', {
        runId: operation.at.runId
      })
    }

    assertRunIdUnused(store, operation.trailingRunId as RunId)
    const tailLocation = splitRunAtGraphemeIndex(
      store,
      snapshot.runLocation,
      Number(snapshot.graphemeIndex),
      operation.trailingRunId as RunId
    )

    insertIndex = tailLocation.index
  } else if (snapshot.graphemeIndex === graphemeLength) {
    insertIndex = snapshot.runLocation.index + 1
  }

  const trailingRun = operation.trailingRunId !== undefined
    && snapshot.graphemeIndex === graphemeLength
    && shouldInsertTrailingTextRun(snapshot.runLocation.container, insertIndex)
    ? createTrailingTextRunRecord(operation.trailingRunId as RunId, snapshot.runLocation.run)
    : undefined

  if (trailingRun !== undefined) {
    assertRunIdUnused(store, operation.trailingRunId as RunId)
  }

  snapshot.runLocation.container.insert(insertIndex, [
    createImageRunRecord(operation.imageRunId as RunId, {
      ...operation.image,
      ...(operation.image.display === undefined ? { display: 'inline' } : {})
    }),
    ...(trailingRun === undefined ? [] : [trailingRun])
  ])

  if (trailingRun !== undefined && snapshot.graphemeIndex === graphemeLength) {
    migrateTextAnchorsAfterSplit(getRunText(snapshot.runLocation.run), store.doc, snapshot.utf16Index, {
      sectionId: snapshot.sectionId,
      blockId: snapshot.blockId,
      runId: operation.trailingRunId as RunId,
      text: getRunText(trailingRun)
    })
  }
}

function replaceImageResource(store: DocumentStore, runId: string, resourceId: string): void {
  assertResourceExists(store, resourceId)

  updateImageRun(store, runId as RunId, (image) => ({
    ...image,
    resourceId
  }))
}

function resizeImage(store: DocumentStore, runId: string, widthTwips: number, heightTwips: number): void {
  if (!Number.isFinite(widthTwips) || !Number.isFinite(heightTwips) || widthTwips <= 0 || heightTwips <= 0) {
    throw createJWordError('OPERATION_IMAGE_DIMENSIONS_INVALID', '图片尺寸必须是正数', {
      runId,
      widthTwips,
      heightTwips
    })
  }

  updateImageRun(store, runId as RunId, (image) => ({
    ...image,
    widthTwips,
    heightTwips
  }))
}

function setImageRotation(store: DocumentStore, runId: string, rotationDegrees: number): void {
  if (!Number.isFinite(rotationDegrees)) {
    throw createJWordError('OPERATION_PROPERTY_VALUE_INVALID', '图片旋转角度必须是有限数字', {
      runId,
      rotationDegrees
    })
  }

  const normalizedRotationDegrees = normalizeImageRotationDegrees(rotationDegrees)

  updateImageRun(store, runId as RunId, (image) => ({
    ...omitImageRotation(image),
    ...(normalizedRotationDegrees === 0 ? {} : { rotationDegrees: normalizedRotationDegrees })
  }))
}

function deleteImage(store: DocumentStore, runId: string): void {
  const runLocation = findRunLocation(store, runId as RunId)
  const blockLocation = findBlockLocation(store, runLocation.blockId)

  assertBlockKind(blockLocation.block, 'paragraph')

  if (!runContainsSingleImage(runLocation.run)) {
    throw createJWordError('OPERATION_PROPERTY_VALUE_INVALID', 'deleteImage 目标 run 不是第一版 image run', {
      runId
    })
  }

  if (runLocation.container.length === 1) {
    blockLocation.container.delete(blockLocation.index, 1)
    return
  }

  runLocation.container.delete(runLocation.index, 1)
}

/** 统一把图片角度约束到 0-359。 */
function normalizeImageRotationDegrees(rotationDegrees: number): number {
  const normalized = Math.round(rotationDegrees) % 360

  return normalized < 0 ? normalized + 360 : normalized
}

/** 返回不包含旋转字段的图片快照，供 reset 复用。 */
function omitImageRotation(image: Extract<Run['inlines'][number], { kind: 'image' }>): Extract<Run['inlines'][number], { kind: 'image' }> {
  const { rotationDegrees: _rotationDegrees, ...rest } = image

  return rest
}

interface ResolvedTextPosition {
  readonly sectionId: SectionId
  readonly blockId: BlockId
  readonly runId: RunId
  readonly graphemeIndex: GraphemeIndex
  readonly utf16Index: number
  readonly runLocation: RunLocation
}

function resolveOperationPosition(store: DocumentStore, position: TextPosition): ResolvedTextPosition {
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

interface BlockLocation {
  readonly block: BlockRecord
  readonly container: BlockContainer
  readonly index: number
}

interface RunLocation {
  readonly run: RunRecord
  readonly container: RunContainer
  readonly index: number
  readonly blockId: BlockId
}

function findSection(store: DocumentStore, sectionId: SectionId): SectionRecord {
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

function findBlockLocation(store: DocumentStore, blockId: BlockId): BlockLocation {
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

function findBlockLocationInContainer(container: BlockContainer, blockId: BlockId): BlockLocation | undefined {
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

function findRunLocation(store: DocumentStore, runId: RunId): RunLocation {
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

function findRunLocationByPosition(store: DocumentStore, position: TextPosition): RunLocation {
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

function findRunLocationInBlocks(blocks: BlockContainer, runId: RunId): RunLocation | undefined {
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

function assertRunIdUnused(store: DocumentStore, runId: RunId): void {
  if (findRunLocationInStore(store, runId) !== undefined) {
    throw createJWordError('OPERATION_RUN_ID_DUPLICATE', 'run ID 已存在', {
      runId: String(runId)
    })
  }
}

function findRunLocationInStore(store: DocumentStore, runId: RunId): RunLocation | undefined {
  for (const section of store.sections.toArray()) {
    const run = findRunLocationInBlocks(getSectionBlocks(section), runId)

    if (run !== undefined) {
      return run
    }
  }

  return undefined
}

function findRunLocationInBlock(block: BlockRecord, runId: RunId): RunLocation {
  const run = findRunLocationInParagraph(block, runId)

  if (run !== undefined) {
    return run
  }

  throw createJWordError('OPERATION_RUN_NOT_IN_BLOCK', '段落中找不到 run', {
    runId: String(runId)
  })
}

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

function cloneRunRecord(run: RunRecord): RunRecord {
  const id = readRequiredString(run, DOCUMENT_STORE_FIELDS.run.id) as RunId
  const text = getRunText(run).toString()

  return createSplitRunRecord(id, text, run)
}

function splitRunAtGraphemeIndex(
  store: DocumentStore,
  runLocation: RunLocation,
  graphemeIndex: number,
  newRunId: RunId
): RunLocation {
  const sharedText = getRunText(runLocation.run)
  const utf16Index = graphemeIndexToUtf16Index(sharedText.toString(), graphemeIndex)
  const tailText = sharedText.toString().slice(utf16Index)
  const splitRun = createSplitRunRecord(newRunId, tailText, runLocation.run)

  runLocation.container.insert(runLocation.index + 1, [splitRun])
  migrateTextAnchorsAfterSplit(sharedText, store.doc, utf16Index, {
    blockId: runLocation.blockId,
    runId: newRunId,
    text: getRunText(splitRun)
  })
  migrateCommentRangesAfterSplit(store, sharedText, utf16Index, {
    blockId: runLocation.blockId,
    runId: newRunId,
    text: getRunText(splitRun)
  })

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

function findCommentRecord(store: DocumentStore, threadId: string) {
  const record = store.comments.get(threadId as CommentId)

  if (record === undefined) {
    throw createJWordError('OPERATION_COMMENT_NOT_FOUND', '找不到目标批注线程', {
      threadId
    })
  }

  return record
}

function findCommentRangeRecord(store: DocumentStore, rangeId: string) {
  const record = store.commentRanges.get(rangeId as CommentRangeId)

  if (record === undefined) {
    throw createJWordError('OPERATION_COMMENT_NOT_FOUND', '找不到目标批注范围', {
      rangeId
    })
  }

  return record
}

function replaceCommentThread(
  store: DocumentStore,
  threadId: string,
  updater: (thread: ReturnType<typeof projectCommentRecord>) => ReturnType<typeof projectCommentRecord>
): void {
  const record = findCommentRecord(store, threadId)
  const rangeId = readRequiredString(record, DOCUMENT_STORE_FIELDS.comment.anchorRangeId)
  const rangeRecord = findCommentRangeRecord(store, rangeId)
  const nextThread = updater(projectCommentRecord(record, readCommentRangeRecord(rangeRecord)))

  store.comments.set(threadId as CommentId, createCommentRecord(nextThread))
}

function migrateCommentRangesAfterSplit(
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

function migrateCommentRangesToText(
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

function updateImageRun(
  store: DocumentStore,
  runId: RunId,
  updater: (image: Extract<Run['inlines'][number], { kind: 'image' }>) => Extract<Run['inlines'][number], { kind: 'image' }>
): void {
  const runLocation = findRunLocation(store, runId)
  const inlines = getRunInlines(runLocation.run)

  if (inlines === undefined || inlines.length !== 1 || inlines[0]?.kind !== 'image') {
    throw createJWordError('OPERATION_PROPERTY_VALUE_INVALID', '目标 run 不是第一版 image run', {
      runId: String(runId)
    })
  }

  const field = getRunField(runLocation.run)
  const link = getRunLink(runLocation.run)
  const revisionId = getRunRevisionId(runLocation.run)
  const nextImage = updater(inlines[0])

  setRunStructure(runLocation.run, {
    ...(field === undefined ? {} : { field }),
    ...(link === undefined ? {} : { link }),
    ...(revisionId === undefined ? {} : { revisionId }),
    inlines: [nextImage]
  })
  syncRunResourceIds(runLocation.run, [nextImage])
}

function assertResourceExists(store: DocumentStore, resourceId: string): void {
  if (!store.resources.has(resourceId as ResourceId)) {
    throw createJWordError('OPERATION_RESOURCE_NOT_FOUND', '图片引用的资源不存在', {
      resourceId
    })
  }
}

function runContainsSingleImage(run: RunRecord): boolean {
  const inlines = getRunInlines(run)

  return inlines !== undefined
    && inlines.length === 1
    && inlines[0]?.kind === 'image'
}

interface SharedMapReader {
  get(fieldName: string): unknown
}

function setProperties(record: SharedMapReader, fieldName: string, properties: Readonly<Record<string, unknown>>): void {
  const target = readPropertyMap(record, fieldName)

  for (const [key, value] of Object.entries(properties)) {
    target.set(key, toDocumentStoreJson(value))
  }
}

function copyProperties(source: SharedMapReader, target: SharedMapReader, fieldName: string): void {
  const sourceProperties = readPropertyMap(source, fieldName)
  const targetProperties = readPropertyMap(target, fieldName)

  for (const [key, value] of sourceProperties.entries()) {
    targetProperties.set(key, value)
  }
}

function createPropertyMap(properties: Readonly<Record<string, unknown>>): Y.Map<DocumentStoreJson> {
  const map = new Y.Map<DocumentStoreJson>()

  for (const [key, value] of Object.entries(properties)) {
    map.set(key, toDocumentStoreJson(value))
  }

  return map
}

function readRequiredArray<Item>(record: SharedMapReader, fieldName: string, label: string): Y.Array<Item> {
  const value = record.get(fieldName)

  if (value instanceof Y.Array) {
    return value as Y.Array<Item>
  }

  throw createJWordError('DOCUMENT_STORE_ARRAY_CONTAINER_MISSING', `${label} 缺失`, {
    label
  })
}

function appendIdIfMissing<Id extends string>(array: Y.Array<Id>, id: Id): void {
  if (!array.toArray().includes(id)) {
    array.push([id])
  }
}

function removeId<Id extends string>(array: Y.Array<Id>, id: Id): void {
  const index = array.toArray().indexOf(id)

  if (index >= 0) {
    array.delete(index, 1)
  }
}

function replaceStringArray(array: Y.Array<string>, values: readonly string[]): void {
  if (array.length > 0) {
    array.delete(0, array.length)
  }

  if (values.length > 0) {
    array.push([...values])
  }
}

function clonePropertyMap(properties: Y.Map<DocumentStoreJson>): Y.Map<DocumentStoreJson> {
  const map = new Y.Map<DocumentStoreJson>()

  for (const [key, value] of properties.entries()) {
    map.set(key, value)
  }

  return map
}

function readPropertyMap(record: SharedMapReader, fieldName: string): Y.Map<DocumentStoreJson> {
  const value = record.get(fieldName)

  if (value instanceof Y.Map) {
    return value as Y.Map<DocumentStoreJson>
  }

  throw createJWordError('OPERATION_PROPERTY_CONTAINER_MISSING', '属性容器缺失')
}

function readRequiredString(record: SharedMapReader, fieldName: string): string {
  const value = record.get(fieldName)

  if (typeof value === 'string') {
    return value
  }

  throw createJWordError('OPERATION_STRING_FIELD_MISSING', '字符串字段缺失', {
    fieldName
  })
}

function assertBlockKind(block: BlockRecord, kind: 'paragraph' | 'table'): void {
  if (block.get(DOCUMENT_STORE_FIELDS.block.kind) !== kind) {
    throw createJWordError('OPERATION_BLOCK_KIND_MISMATCH', `块类型不是 ${kind}`, {
      expectedKind: kind
    })
  }
}

function toDocumentStoreJson(value: unknown): DocumentStoreJson {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value
  }

  if (Array.isArray(value)) {
    return value.map(toDocumentStoreJson)
  }

  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nestedValue]) => [
        key,
        toDocumentStoreJson(nestedValue)
      ])
    )
  }

  throw createJWordError('OPERATION_PROPERTY_VALUE_INVALID', '属性值必须是 JSON 兼容数据')
}

function assertRunPropertyRange(
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
