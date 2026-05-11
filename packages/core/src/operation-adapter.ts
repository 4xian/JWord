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
  createRunRecord,
  getParagraphRuns,
  getRunText,
  getSectionBlocks,
  getTableCellBlocks,
  getTableRowCells,
  getTableRows
} from './document-store'
import type {
  BlockContainer,
  BlockRecord,
  BlockRecordValue,
  DocumentStore,
  DocumentStoreJson,
  ResourceId,
  RunContainer,
  RunRecord,
  RunRecordValue,
  SectionRecord,
  StyleId,
  TableCellRecord,
  TableCellRecordValue,
  TableRowRecord,
  TableRowRecordValue
} from './document-store'
import type { Block, Paragraph, Run, Table, TableCell, TableRow, TextInline } from './model'
import type { BlockInsertPlacement, Operation } from './transaction'
import { resolveAnchorRef } from './position'
import type { AnchorRef, AnchorRefSnapshot, BlockId, CommentId, RevisionId, RunId, SectionId } from './position'

/**
 * Operation 到 Y.Doc 的最小 adapter。
 */
export interface OperationAdapter {
  readonly store: DocumentStore
  apply(operation: Operation): void
  applyAll(operations: readonly Operation[]): void
}

/**
 * 创建 Operation adapter。
 *
 * @param input 文档状态壳或 Y.Doc。
 * @returns 可应用 operation 的 adapter。
 */
export function createOperationAdapter(input: DocumentStore | Y.Doc): OperationAdapter {
  const store = input instanceof Y.Doc ? createDocumentStore(input) : input

  return {
    store,
    apply(operation) {
      applyOperation(store, operation)
    },
    applyAll(operations) {
      for (const operation of operations) {
        applyOperation(store, operation)
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
export function applyOperation(store: DocumentStore, operation: Operation): void {
  switch (operation.kind) {
    case 'insertText':
      insertText(store, operation.at, operation.text)
      break
    case 'deleteRange':
      deleteRange(store, operation.range.anchor, operation.range.focus)
      break
    case 'setRunProperties':
      setProperties(findRunLocation(store, operation.runId).run, DOCUMENT_STORE_FIELDS.run.properties, operation.properties)
      break
    case 'setParagraphProperties':
      setProperties(findBlockLocation(store, operation.paragraphId).block, DOCUMENT_STORE_FIELDS.block.properties, operation.properties)
      break
    case 'splitBlock':
      splitBlock(store, operation.at, operation.newBlockId)
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
  }
}

function insertText(store: DocumentStore, anchor: AnchorRef, text: string): void {
  const snapshot = resolveOperationAnchor(store, anchor)
  const run = findRunLocation(store, snapshot.runId).run
  const sharedText = getRunText(run)
  const index = readTextIndex(Number(snapshot.graphemeIndex), sharedText)

  sharedText.insert(index, text)
}

function deleteRange(
  store: DocumentStore,
  anchor: AnchorRef,
  focus: AnchorRef
): void {
  const anchorSnapshot = resolveOperationAnchor(store, anchor)
  const focusSnapshot = resolveOperationAnchor(store, focus)

  if (anchorSnapshot.runId !== focusSnapshot.runId) {
    throw new Error('deleteRange 暂只支持同一 run')
  }

  const run = findRunLocation(store, anchorSnapshot.runId).run
  const sharedText = getRunText(run)
  const start = readTextIndex(Number(anchorSnapshot.graphemeIndex), sharedText)
  const end = readTextIndex(Number(focusSnapshot.graphemeIndex), sharedText)
  const from = Math.min(start, end)
  const length = Math.abs(end - start)

  if (length > 0) {
    sharedText.delete(from, length)
  }
}

function splitBlock(
  store: DocumentStore,
  anchor: AnchorRef,
  newBlockId: BlockId
): void {
  const snapshot = resolveOperationAnchor(store, anchor)
  const location = findBlockLocation(store, snapshot.blockId)

  assertBlockKind(location.block, 'paragraph')

  const runs = getParagraphRuns(location.block)
  const runLocation = findRunLocationInBlock(location.block, snapshot.runId)
  const sharedText = getRunText(runLocation.run)
  const index = readTextIndex(Number(snapshot.graphemeIndex), sharedText)
  const tailText = sharedText.toString().slice(index)
  const nextRuns = runs.toArray().slice(runLocation.index + 1).map(cloneRunRecord)
  const newParagraph = createParagraphRecord(newBlockId)

  if (tailText.length > 0) {
    sharedText.delete(index, tailText.length)
  }

  if (runs.length > runLocation.index + 1) {
    runs.delete(runLocation.index + 1, runs.length - runLocation.index - 1)
  }

  location.container.insert(location.index + 1, [newParagraph])
  copyProperties(location.block, newParagraph, DOCUMENT_STORE_FIELDS.block.properties)

  const newParagraphRuns = getParagraphRuns(newParagraph)

  newParagraphRuns.push([
    createRunRecord(`${String(snapshot.runId)}:split` as RunId, tailText),
    ...nextRuns
  ])
}

function mergeBlock(store: DocumentStore, targetBlockId: BlockId, sourceBlockId: BlockId): void {
  const target = findBlockLocation(store, targetBlockId)
  const source = findBlockLocation(store, sourceBlockId)

  assertBlockKind(target.block, 'paragraph')
  assertBlockKind(source.block, 'paragraph')

  if (target.container !== source.container || source.index !== target.index + 1) {
    throw new Error('mergeBlock 暂只支持同一容器中的相邻段落')
  }

  getParagraphRuns(target.block).push(getParagraphRuns(source.block).toArray().map(cloneRunRecord))
  source.container.delete(source.index, 1)
}

function insertBlock(
  store: DocumentStore,
  sectionId: SectionId,
  placement: BlockInsertPlacement,
  block: Block
): void {
  const section = findSection(store, sectionId)
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
    throw new Error('insertBlock 找不到参照块')
  }

  blocks.insert(placement.kind === 'before' ? index : index + 1, [blockRecord])
}

function deleteBlock(store: DocumentStore, blockId: BlockId): void {
  const location = findBlockLocation(store, blockId)

  location.container.delete(location.index, 1)
}

function resolveOperationAnchor(store: DocumentStore, anchor: AnchorRef): AnchorRefSnapshot {
  const snapshot = resolveAnchorRef(anchor, store.doc)

  if (snapshot === undefined) {
    throw new Error('锚点无法解析')
  }

  return snapshot
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
}

function findSection(store: DocumentStore, sectionId: SectionId): SectionRecord {
  const section = store.sections.toArray().find(
    (candidate) => candidate.get(DOCUMENT_STORE_FIELDS.section.id) === sectionId
  )

  if (section === undefined) {
    throw new Error('找不到节')
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

  throw new Error('找不到块')
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

  throw new Error('找不到 run')
}

function findRunLocationInBlocks(blocks: BlockContainer, runId: RunId): RunLocation | undefined {
  for (const block of blocks.toArray()) {
    if (block.get(DOCUMENT_STORE_FIELDS.block.kind) === 'paragraph') {
      const run = findRunLocationInBlock(block, runId)

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

function findRunLocationInBlock(block: BlockRecord, runId: RunId): RunLocation {
  const runs = getParagraphRuns(block)
  const runRecords = runs.toArray()

  for (let index = 0; index < runRecords.length; index += 1) {
    const run = runRecords[index]

    if (run !== undefined && run.get(DOCUMENT_STORE_FIELDS.run.id) === runId) {
      return { run, container: runs, index }
    }
  }

  throw new Error('段落中找不到 run')
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
  const record = new Y.Map<RunRecordValue>() as RunRecord
  const text = new Y.Text()

  text.insert(0, collectText(run))
  record.set(DOCUMENT_STORE_FIELDS.run.kind, 'run')
  record.set(DOCUMENT_STORE_FIELDS.run.id, run.id as RunId)
  record.set(DOCUMENT_STORE_FIELDS.run.properties, createPropertyMap(run.properties ?? {}))
  record.set(DOCUMENT_STORE_FIELDS.run.text, text)
  record.set(DOCUMENT_STORE_FIELDS.run.resourceIds, new Y.Array<ResourceId>())
  record.set(DOCUMENT_STORE_FIELDS.run.styleIds, new Y.Array<StyleId>())
  record.set(DOCUMENT_STORE_FIELDS.run.commentIds, new Y.Array<CommentId>())
  record.set(DOCUMENT_STORE_FIELDS.run.revisionIds, new Y.Array<RevisionId>())

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
  const clone = new Y.Map<RunRecordValue>() as RunRecord
  const properties = clonePropertyMap(readPropertyMap(run, DOCUMENT_STORE_FIELDS.run.properties))
  const text = new Y.Text()

  text.insert(0, getRunText(run).toString())
  clone.set(DOCUMENT_STORE_FIELDS.run.kind, 'run')
  clone.set(DOCUMENT_STORE_FIELDS.run.id, id)
  clone.set(DOCUMENT_STORE_FIELDS.run.properties, properties)
  clone.set(DOCUMENT_STORE_FIELDS.run.text, text)
  clone.set(DOCUMENT_STORE_FIELDS.run.resourceIds, new Y.Array<ResourceId>())
  clone.set(DOCUMENT_STORE_FIELDS.run.styleIds, new Y.Array<StyleId>())
  clone.set(DOCUMENT_STORE_FIELDS.run.commentIds, new Y.Array<CommentId>())
  clone.set(DOCUMENT_STORE_FIELDS.run.revisionIds, new Y.Array<RevisionId>())

  return clone
}

function collectText(run: Run): string {
  return run.inlines
    .filter((inline): inline is TextInline => inline.kind === 'text')
    .map((inline) => inline.text)
    .join('')
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

  throw new Error('属性容器缺失')
}

function readRequiredString(record: SharedMapReader, fieldName: string): string {
  const value = record.get(fieldName)

  if (typeof value === 'string') {
    return value
  }

  throw new Error('字符串字段缺失')
}

function assertBlockKind(block: BlockRecord, kind: 'paragraph' | 'table'): void {
  if (block.get(DOCUMENT_STORE_FIELDS.block.kind) !== kind) {
    throw new Error(`块类型不是 ${kind}`)
  }
}

function readTextIndex(index: number, text: Y.Text): number {
  if (!Number.isInteger(index) || index < 0 || index > text.length) {
    throw new Error('文本位置越界')
  }

  return index
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

  throw new Error('属性值必须是 JSON 兼容数据')
}
