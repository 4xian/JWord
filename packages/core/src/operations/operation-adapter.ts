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
  createDocumentStore,
  createParagraphRecord,
  createResourceRecord,
  createRunRecord,
  getRunField,
  getRunInlines,
  getRunLink,
  getRunRevisionId,
  getParagraphRuns,
  getRunText,
  getSectionBlocks,
  setRunStructure,
  getTableCellBlocks,
  getTableRowCells,
  getTableRows
} from '../model/document-store'
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
  DocumentStore,
  DocumentStoreJson,
  ResourceId,
  RunContainer,
  RunRecord,
  RunRecordStructureInput,
  RunRecordValue,
  SectionRecord,
  StyleId,
  TableCellRecord,
  TableCellRecordValue,
  TableRowRecord,
  TableRowRecordValue
} from '../model/document-store'
import type { Block, Paragraph, Run, Table, TableCell, TableRow, TextInline } from '../model/types'
import type { BlockInsertPlacement, Operation, TextPosition } from './transaction'
import {
  migrateTextAnchorsAfterSplit,
  migrateTextAnchorsToText
} from '../model/position'
import type { BlockId, CommentId, GraphemeIndex, RevisionId, RunId, SectionId } from '../model/position'
import { createGraphemeIndex } from '../model/position'
import type { ResourceUrlPolicy } from '../resources/types'

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

  if (anchorSnapshot.runId !== focusSnapshot.runId) {
    throw createJWordError('OPERATION_DELETE_RANGE_CROSS_RUN', 'deleteRange 暂只支持同一 run', {
      anchorRunId: String(anchorSnapshot.runId),
      focusRunId: String(focusSnapshot.runId)
    })
  }

  const run = anchorSnapshot.runLocation.run
  const sharedText = getRunText(run)
  const start = anchorSnapshot.utf16Index
  const end = focusSnapshot.utf16Index
  const from = Math.min(start, end)
  const length = Math.abs(end - start)

  if (length > 0) {
    sharedText.delete(from, length)
  }
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

  if (operation.mode === 'block') {
    insertBlockImage(store, operation)
    return
  }

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

function insertBlockImage(
  store: DocumentStore,
  operation: Extract<Operation, { kind: 'insertImage' }>
): void {
  if (operation.blockId === undefined) {
    throw createJWordError('OPERATION_PROPERTY_VALUE_INVALID', '块级图片插入缺少 blockId')
  }

  const snapshot = resolveOperationPosition(store, operation.at)
  const location = findBlockLocation(store, snapshot.blockId)
  const paragraph = createParagraphRecord(operation.blockId as BlockId)

  location.container.insert(location.index + 1, [paragraph])
  getParagraphRuns(paragraph).push([
    createImageRunRecord(operation.imageRunId as RunId, {
      ...operation.image,
      display: 'block'
    })
  ])
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

function createBlockRecordFromModel(block: Block): BlockRecord {
  if (block.kind === 'paragraph') {
    return createParagraphRecordFromModel(block)
  }

  return createTableRecordFromModel(block)
}

function createParagraphRecordFromModel(paragraph: Paragraph): BlockRecord {
  const record = new Y.Map<BlockRecordValue>() as BlockRecord
  const properties = createPropertyMap(paragraph.properties ?? {})
  const runs = new Y.Array<RunRecord>()

  record.set(DOCUMENT_STORE_FIELDS.block.kind, 'paragraph')
  record.set(DOCUMENT_STORE_FIELDS.block.id, paragraph.id as BlockId)
  record.set(DOCUMENT_STORE_FIELDS.block.properties, properties)
  record.set(DOCUMENT_STORE_FIELDS.block.runs, runs)
  record.set(DOCUMENT_STORE_FIELDS.block.resourceIds, new Y.Array<ResourceId>())
  record.set(DOCUMENT_STORE_FIELDS.block.styleIds, new Y.Array<StyleId>())
  record.set(DOCUMENT_STORE_FIELDS.block.commentIds, new Y.Array<CommentId>())
  record.set(DOCUMENT_STORE_FIELDS.block.revisionIds, new Y.Array<RevisionId>())
  runs.push(paragraph.runs.map(createRunRecordFromModel))

  return record
}

function createRunRecordFromModel(run: Run): RunRecord {
  const structureInput: RunRecordStructureInput = {
    ...(run.properties === undefined ? {} : { properties: run.properties }),
    ...(run.field === undefined ? {} : { field: run.field }),
    ...(run.link === undefined ? {} : { link: run.link }),
    ...(run.revisionId === undefined ? {} : { revisionId: run.revisionId }),
    inlines: run.inlines
  }

  const record = createRunRecord(run.id as RunId, collectText(run), structureInput)

  return record
}

function createTableRecordFromModel(table: Table): BlockRecord {
  const record = new Y.Map<BlockRecordValue>() as BlockRecord
  const rows = new Y.Array<TableRowRecord>()

  record.set(DOCUMENT_STORE_FIELDS.block.kind, 'table')
  record.set(DOCUMENT_STORE_FIELDS.block.id, table.id as BlockId)
  record.set(DOCUMENT_STORE_FIELDS.block.properties, createPropertyMap(table.properties ?? {}))
  record.set(DOCUMENT_STORE_FIELDS.block.rows, rows)
  record.set(DOCUMENT_STORE_FIELDS.block.resourceIds, new Y.Array<ResourceId>())
  record.set(DOCUMENT_STORE_FIELDS.block.styleIds, new Y.Array<StyleId>())
  record.set(DOCUMENT_STORE_FIELDS.block.commentIds, new Y.Array<CommentId>())
  record.set(DOCUMENT_STORE_FIELDS.block.revisionIds, new Y.Array<RevisionId>())
  rows.push(table.rows.map(createTableRowRecordFromModel))

  return record
}

function createTableRowRecordFromModel(row: TableRow): TableRowRecord {
  const record = new Y.Map<TableRowRecordValue>() as TableRowRecord
  const cells = new Y.Array<TableCellRecord>()

  record.set(DOCUMENT_STORE_FIELDS.tableRow.id, row.id)
  record.set(DOCUMENT_STORE_FIELDS.tableRow.properties, createPropertyMap(row.properties ?? {}))
  record.set(DOCUMENT_STORE_FIELDS.tableRow.cells, cells)
  cells.push(row.cells.map(createTableCellRecordFromModel))

  return record
}

function createTableCellRecordFromModel(cell: TableCell): TableCellRecord {
  const record = new Y.Map<TableCellRecordValue>() as TableCellRecord
  const blocks = new Y.Array<BlockRecord>()

  record.set(DOCUMENT_STORE_FIELDS.tableCell.id, cell.id)
  record.set(DOCUMENT_STORE_FIELDS.tableCell.properties, createPropertyMap(cell.properties ?? {}))
  record.set(DOCUMENT_STORE_FIELDS.tableCell.gridSpan, cell.gridSpan ?? 1)
  record.set(DOCUMENT_STORE_FIELDS.tableCell.blocks, blocks)
  blocks.push(cell.blocks.map(createBlockRecordFromModel))

  return record
}

function cloneRunRecord(run: RunRecord): RunRecord {
  const id = readRequiredString(run, DOCUMENT_STORE_FIELDS.run.id) as RunId
  const text = getRunText(run).toString()

  return createSplitRunRecord(id, text, run)
}

function createImageRunRecord(runId: RunId, image: Extract<Run['inlines'][number], { kind: 'image' }>): RunRecord {
  const record = createRunRecord(runId, '', {
    inlines: [image]
  })

  syncRunResourceIds(record, [image])

  return record
}

/**
 * 图片尾侧缺少文本容器时，补一个最小空 run 作为后续输入落点。
 */
function createTrailingTextRunRecord(runId: RunId, source: RunRecord): RunRecord {
  return runSupportsTextContainer(source)
    ? createSplitRunRecord(runId, '', source)
    : createRunRecord(runId, '')
}

function shouldInsertTrailingTextRun(container: RunContainer, insertIndex: number): boolean {
  return !runSupportsTextContainer(container.get(insertIndex))
}

function runSupportsTextContainer(run: RunRecord | undefined): boolean {
  if (run === undefined) {
    return false
  }

  const inlines = getRunInlines(run)

  return inlines === undefined || inlines.some((inline) => inline.kind === 'text')
}

function createSplitRunRecord(runId: RunId, textValue: string, source: RunRecord): RunRecord {
  const field = getRunField(source)
  const link = getRunLink(source)
  const revisionId = getRunRevisionId(source)
  const inlines = getRunInlines(source)
  const structureInput: RunRecordStructureInput = {
    ...(field === undefined ? {} : { field }),
    ...(link === undefined ? {} : { link }),
    ...(revisionId === undefined ? {} : { revisionId }),
    ...(inlines === undefined ? {} : { inlines })
  }

  const clone = createRunRecord(runId, textValue, structureInput)
  const properties = clonePropertyMap(readPropertyMap(source, DOCUMENT_STORE_FIELDS.run.properties))

  clone.set(DOCUMENT_STORE_FIELDS.run.properties, properties)
  syncRunResourceIds(clone, inlines ?? [])

  return clone
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

function collectText(run: Run): string {
  return run.inlines
    .filter((inline): inline is TextInline => inline.kind === 'text')
    .map((inline) => inline.text)
    .join('')
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

function syncRunResourceIds(run: RunRecord, inlines: readonly Run['inlines'][number][]): void {
  const nextIds = inlines
    .filter((inline): inline is Extract<Run['inlines'][number], { kind: 'image' }> => inline.kind === 'image')
    .map((inline) => inline.resourceId as ResourceId)
  const resourceIds = new Y.Array<ResourceId>()

  if (nextIds.length > 0) {
    resourceIds.push(nextIds)
  }

  run.set(DOCUMENT_STORE_FIELDS.run.resourceIds, resourceIds)
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
