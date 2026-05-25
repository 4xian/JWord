/**
 * 职责：封装 editor 文档 bootstrap、Y.Doc 根替换和 run text 定位 helper。
 * 边界：不处理 DOM、布局和输入事件。
 * 协作模块：document-store、Yjs 容器和 editor facade。
 * 性能/安全约束：constructor/top-level 不访问 window/document/HTMLElement 实例，DOM 只在 mount 后创建，编辑命令统一进入 transaction pipeline。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/03-architecture.md 与 04-engineering-standards.md#45-模块边界。
 */
import * as Y from 'yjs'

import { DOCUMENT_STORE_FIELDS, DOCUMENT_STORE_SCHEMA_VERSION, createCommentRangeRecord, createCommentRecord, createParagraphRecord, createResourceRecord, createRevisionRecord, createRunRecord, createSectionRecord, getParagraphRuns, getRunText, getSectionBlocks, getTableCellBlocks, getTableRowCells, getTableRows, readCommentRangeRecord } from '../model/document-store'
import type { BlockRecord, CommentRangeId, DocumentStore, DocumentStoreJson, ResourceId, RunRecord, StyleId } from '../model/document-store'
import { createJWordError } from '../shared/errors'
import { utf16IndexToGraphemeIndex } from '../shared/grapheme'
import { createGraphemeIndex, createRelativePositionFromSnapshot, createRangeRef, createTextAnchorRef } from '../model/position'
import type { AnchorRef, BlockId, CommentId, DocumentId, RangeRef, RevisionId, RunId, SectionId, TextAnchorRecord, TextRangeRecord } from '../model/position'
import type { Document as CoreDocument, Section } from '../model/types'
import { createBlockRecordFromModel } from '../operations/block-record-factory'
import { DEFAULT_DOCUMENT_ID, DEFAULT_SECTION_ID } from './constants'
import type { EditorDocumentInput, EditorTextAnchorInput } from './types'

export function replaceStoreDocument(store: DocumentStore, input: EditorDocumentInput): void {
  const documentId = (input.documentId ?? DEFAULT_DOCUMENT_ID) as DocumentId
  const sectionId = (input.sectionId ?? DEFAULT_SECTION_ID) as SectionId
  const paragraphs = splitPlainTextIntoParagraphs(input.text ?? '')
  const section = createSectionRecord(sectionId)

  clearStore(store)
  initializeDocumentRoot(store, documentId, sectionId)
  store.sections.push([section])
  const sectionBlocks = getSectionBlocks(section)
  const resourceIds = (store.document.get(DOCUMENT_STORE_FIELDS.document.resourceIds) as Y.Array<ResourceId> | undefined)
    ?? createIdArray<ResourceId>([])

  for (const [index, text] of paragraphs.entries()) {
    const paragraph = createParagraphRecord(`paragraph-${index + 1}` as BlockId)

    sectionBlocks.push([paragraph])
    getParagraphRuns(paragraph).push([createRunRecord(`run-${index + 1}` as RunId, text)])
  }

  const blockIds = section.get(DOCUMENT_STORE_FIELDS.section.blockIds) as unknown

  if (blockIds instanceof Y.Array) {
    const typedBlockIds = blockIds as Y.Array<BlockId>

    typedBlockIds.push(paragraphs.map((_, index) => `paragraph-${index + 1}` as BlockId))
  }

  for (const resource of input.resources ?? []) {
    store.resources.set(resource.id as ResourceId, createResourceRecord(resource))
    resourceIds.push([resource.id as ResourceId])
  }
}

/** 用 canonical 文档模型替换当前 store 文档。 */
export function replaceStoreDocumentModel(store: DocumentStore, model: CoreDocument): void {
  const staged = createDocumentModelRecords(model)

  clearStore(store)
  initializeDocumentRoot(store, staged.documentId, staged.initialSectionId)
  writeStagedDocumentCollections(store, staged)

  for (const sectionStage of staged.sections) {
    const section = createSectionRecord(sectionStage.model.id as SectionId)

    store.sections.push([section])
    writeSectionStructure(section, sectionStage.model)
    getSectionBlocks(section).push([...sectionStage.blocks])
  }
}

interface StagedDocumentModelRecords {
  readonly documentId: DocumentId
  readonly initialSectionId?: SectionId
  readonly sectionIds: Y.Array<SectionId>
  readonly resourceIds: Y.Array<ResourceId>
  readonly styleIds: Y.Array<StyleId>
  readonly commentIds: Y.Array<CommentId>
  readonly revisionIds: Y.Array<RevisionId>
  readonly resources: readonly (readonly [ResourceId, ReturnType<typeof createResourceRecord>])[]
  readonly comments: readonly (readonly [CommentId, ReturnType<typeof createCommentRecord>])[]
  readonly commentRanges: readonly (readonly [CommentRangeId, ReturnType<typeof createCommentRangeRecord>])[]
  readonly revisions: readonly (readonly [RevisionId, ReturnType<typeof createRevisionRecord>])[]
  readonly sections: readonly StagedSectionModelRecords[]
}

interface StagedSectionModelRecords {
  readonly model: Section
  readonly blocks: readonly BlockRecord[]
}

/** 先构建未挂载记录，避免转换失败时污染当前文档。 */
function createDocumentModelRecords(model: CoreDocument): StagedDocumentModelRecords {
  return {
    documentId: model.id as DocumentId,
    ...(model.sections[0] === undefined ? {} : { initialSectionId: model.sections[0].id as SectionId }),
    sectionIds: createIdArray<SectionId>(model.sections.map((section) => section.id as SectionId)),
    resourceIds: createIdArray<ResourceId>((model.resourceIds ?? model.resources?.map((resource) => resource.id) ?? []) as readonly ResourceId[]),
    styleIds: createIdArray<StyleId>((model.styleIds ?? []) as readonly StyleId[]),
    commentIds: createIdArray<CommentId>((model.comments?.map((comment) => comment.id as CommentId) ?? [])),
    revisionIds: createIdArray<RevisionId>((model.revisions?.map((revision) => revision.id as RevisionId) ?? [])),
    resources: (model.resources ?? []).map((resource) => [resource.id as ResourceId, createResourceRecord(resource)] as const),
    comments: (model.comments ?? []).map((comment) => [comment.id as CommentId, createCommentRecord(comment)] as const),
    commentRanges: (model.comments ?? []).map((comment) => [comment.rangeSnapshot.id as CommentRangeId, createCommentRangeRecord(comment.rangeSnapshot)] as const),
    revisions: (model.revisions ?? []).map((revision) => [revision.id as RevisionId, createRevisionRecord(revision)] as const),
    sections: model.sections.map((section) => ({
      model: section,
      blocks: section.blocks.map(createBlockRecordFromModel)
    }))
  }
}

export function clearStore(store: DocumentStore): void {
  store.document.clear()
  clearArray(store.sections)
  store.resources.clear()
  store.styles.clear()
  store.comments.clear()
  store.commentRanges.clear()
  store.revisions.clear()
}

export function initializeDocumentRoot(
  store: DocumentStore,
  documentId: DocumentId,
  sectionId?: SectionId
): void {
  store.document.set(DOCUMENT_STORE_FIELDS.document.schemaVersion, DOCUMENT_STORE_SCHEMA_VERSION)
  store.document.set(DOCUMENT_STORE_FIELDS.document.id, documentId)
  store.document.set(DOCUMENT_STORE_FIELDS.document.metadata, new Y.Map<DocumentStoreJson>())
  store.document.set(DOCUMENT_STORE_FIELDS.document.sectionIds, createIdArray<SectionId>(sectionId === undefined ? [] : [sectionId]))
  store.document.set(DOCUMENT_STORE_FIELDS.document.resourceIds, createIdArray<ResourceId>([]))
  store.document.set(DOCUMENT_STORE_FIELDS.document.styleIds, createIdArray<StyleId>([]))
  store.document.set(DOCUMENT_STORE_FIELDS.document.commentIds, createIdArray<CommentId>([]))
  store.document.set(DOCUMENT_STORE_FIELDS.document.revisionIds, createIdArray<RevisionId>([]))
}

/** 写入已完成转换的文档级索引。 */
function writeStagedDocumentCollections(store: DocumentStore, staged: StagedDocumentModelRecords): void {
  store.document.set(DOCUMENT_STORE_FIELDS.document.sectionIds, staged.sectionIds)
  store.document.set(DOCUMENT_STORE_FIELDS.document.resourceIds, staged.resourceIds)
  store.document.set(DOCUMENT_STORE_FIELDS.document.styleIds, staged.styleIds)
  store.document.set(DOCUMENT_STORE_FIELDS.document.commentIds, staged.commentIds)
  store.document.set(DOCUMENT_STORE_FIELDS.document.revisionIds, staged.revisionIds)

  for (const [id, resource] of staged.resources) {
    store.resources.set(id, resource)
  }

  for (const [id, comment] of staged.comments) {
    store.comments.set(id, comment)
  }

  for (const [id, range] of staged.commentRanges) {
    store.commentRanges.set(id, range)
  }

  for (const [id, revision] of staged.revisions) {
    store.revisions.set(id, revision)
  }
}

/** 写入节级结构属性和子索引。 */
function writeSectionStructure(section: ReturnType<typeof createSectionRecord>, model: Section): void {
  const properties = section.get(DOCUMENT_STORE_FIELDS.section.properties) as Y.Map<DocumentStoreJson> | undefined
  const blockIds = section.get(DOCUMENT_STORE_FIELDS.section.blockIds) as Y.Array<BlockId> | undefined
  const headerIds = section.get(DOCUMENT_STORE_FIELDS.section.headerIds) as Y.Array<string> | undefined
  const footerIds = section.get(DOCUMENT_STORE_FIELDS.section.footerIds) as Y.Array<string> | undefined

  if (model.page !== undefined) {
    properties?.set('page', model.page as unknown as DocumentStoreJson)
  }
  if (model.columns !== undefined) {
    properties?.set('columns', model.columns)
  }
  if (model.breakType !== undefined) {
    properties?.set('breakType', model.breakType)
  }
  if (model.headerFooterSameAsPrevious !== undefined) {
    properties?.set('headerFooterSameAsPrevious', model.headerFooterSameAsPrevious)
  }
  if (model.pageNumbering !== undefined) {
    properties?.set('pageNumbering', model.pageNumbering as unknown as DocumentStoreJson)
  }
  blockIds?.push(model.blocks.map((block) => block.id as BlockId))
  headerIds?.push([...(model.headerIds ?? [])])
  footerIds?.push([...(model.footerIds ?? [])])
}

export function createIdArray<Id extends string>(ids: readonly Id[]): Y.Array<Id> {
  const array = new Y.Array<Id>()

  if (ids.length > 0) {
    array.push([...ids])
  }

  return array
}

export function clearArray<Item>(array: Y.Array<Item>): void {
  if (array.length > 0) {
    array.delete(0, array.length)
  }
}

export function splitPlainTextIntoParagraphs(text: string): readonly string[] {
  const normalized = text.replace(/\r\n?/gu, '\n').trim()

  if (normalized.length === 0) {
    return ['']
  }

  return normalized.split(/\n\s*\n/gu)
}

export function readCurrentDocumentId(store: DocumentStore): DocumentId {
  const documentId = store.document.get(DOCUMENT_STORE_FIELDS.document.id)

  if (typeof documentId !== 'string') {
    throw createJWordError('PROJECTION_INVALID_DOCUMENT', '当前文档缺少 ID')
  }

  return documentId as DocumentId
}

export function locateCommentThreadRange(store: DocumentStore, threadId: string): RangeRef | null {
  const commentRecord = store.comments.get(threadId as CommentId)

  if (commentRecord === undefined) {
    return null
  }

  const rangeId = commentRecord.get(DOCUMENT_STORE_FIELDS.comment.anchorRangeId)

  if (typeof rangeId !== 'string') {
    return null
  }

  const rangeRecord = store.commentRanges.get(rangeId as CommentRangeId)

  if (rangeRecord === undefined) {
    return null
  }

  return restoreTextRangeRecord(store, readCommentRangeRecord(rangeRecord))
}

export function findRunText(store: DocumentStore, input: EditorTextAnchorInput): Y.Text {
  for (const section of store.sections.toArray()) {
    if (section.get(DOCUMENT_STORE_FIELDS.section.id) !== input.sectionId) {
      continue
    }

    const text = findRunTextInBlocks(getSectionBlocks(section).toArray(), input)

    if (text !== undefined) {
      return text
    }
  }

  throw createJWordError('EDITOR_ANCHOR_TARGET_NOT_FOUND', '找不到文本锚点目标 run', {
    sectionId: input.sectionId,
    blockId: input.blockId,
    runId: input.runId
  })
}

/**
 * 通过共享文本句柄反查当前位置所属的 section/block/run。
 *
 * @param store 文档状态壳。
 * @param target 共享文本句柄。
 * @returns 当前文本位置上下文；找不到时返回 undefined。
 */
export function findTextLocationBySharedText(
  store: DocumentStore,
  target: Y.Text
): Readonly<{
  sectionId: string
  blockId: string
  runId: string
}> | undefined {
  for (const section of store.sections.toArray()) {
    const sectionId = String(section.get(DOCUMENT_STORE_FIELDS.section.id) ?? '')
    const located = findTextLocationInBlocks(sectionId, getSectionBlocks(section).toArray(), target)

    if (located !== undefined) {
      return located
    }
  }

  return undefined
}

export function restoreTextRangeRecord(store: DocumentStore, record: TextRangeRecord): RangeRef | null {
  const anchor = restoreTextAnchorRecord(store, record.anchor)
  const focus = restoreTextAnchorRecord(store, record.focus)

  if (anchor === null || focus === null) {
    return null
  }

  return createRangeRef(anchor, focus)
}

export function findRunTextInBlocks(
  blocks: readonly BlockRecord[],
  input: EditorTextAnchorInput
): Y.Text | undefined {
  for (const block of blocks) {
    if (block.get(DOCUMENT_STORE_FIELDS.block.id) === input.blockId) {
      const text = findRunTextInParagraph(block, input.runId)

      if (text !== undefined) {
        return text
      }
    }

    if (block.get(DOCUMENT_STORE_FIELDS.block.kind) === 'table') {
      const text = findRunTextInTable(block, input)

      if (text !== undefined) {
        return text
      }
    }
  }

  return undefined
}

function findTextLocationInBlocks(
  sectionId: string,
  blocks: readonly BlockRecord[],
  target: Y.Text
): Readonly<{
  sectionId: string
  blockId: string
  runId: string
}> | undefined {
  for (const block of blocks) {
    const blockId = String(block.get(DOCUMENT_STORE_FIELDS.block.id) ?? '')

    if (block.get(DOCUMENT_STORE_FIELDS.block.kind) === 'paragraph') {
      for (const run of getParagraphRuns(block).toArray()) {
        if (getRunText(run) === target) {
          return {
            sectionId,
            blockId,
            runId: String(run.get(DOCUMENT_STORE_FIELDS.run.id) ?? '')
          }
        }
      }
    }

    if (block.get(DOCUMENT_STORE_FIELDS.block.kind) === 'table') {
      const nested = findTextLocationInTable(sectionId, block, target)

      if (nested !== undefined) {
        return nested
      }
    }
  }

  return undefined
}

export function findRunTextInParagraph(block: BlockRecord, runId: string): Y.Text | undefined {
  if (block.get(DOCUMENT_STORE_FIELDS.block.kind) !== 'paragraph') {
    return undefined
  }

  for (const run of getParagraphRuns(block).toArray()) {
    if (run.get(DOCUMENT_STORE_FIELDS.run.id) === runId) {
      return getRunText(run)
    }
  }

  return undefined
}

export function findRunTextInTable(block: BlockRecord, input: EditorTextAnchorInput): Y.Text | undefined {
  for (const row of getTableRows(block).toArray()) {
    for (const cell of getTableRowCells(row).toArray()) {
      const text = findRunTextInBlocks(getTableCellBlocks(cell).toArray(), input)

      if (text !== undefined) {
        return text
      }
    }
  }

  return undefined
}

function findTextLocationInTable(
  sectionId: string,
  block: BlockRecord,
  target: Y.Text
): Readonly<{
  sectionId: string
  blockId: string
  runId: string
}> | undefined {
  for (const row of getTableRows(block).toArray()) {
    for (const cell of getTableRowCells(row).toArray()) {
      const nested = findTextLocationInBlocks(sectionId, getTableCellBlocks(cell).toArray(), target)

      if (nested !== undefined) {
        return nested
      }
    }
  }

  return undefined
}

function restoreTextAnchorRecord(store: DocumentStore, record: TextAnchorRecord): AnchorRef | null {
  const absolute = tryRestoreAbsolutePosition(store.doc, record)

  if (absolute !== null && absolute.type instanceof Y.Text) {
    const matched = findRunBySharedText(store, absolute.type)

    if (matched !== null) {
      return createTextAnchorRef({
        documentId: record.documentId as DocumentId,
        sectionId: matched.sectionId,
        blockId: matched.blockId,
        runId: matched.runId,
        graphemeIndex: createGraphemeIndex(utf16IndexToGraphemeIndex(
          matched.text.toString(),
          absolute.index
        )),
        text: matched.text,
        ...(absolute.assoc === 0 ? {} : { assoc: absolute.assoc })
      })
    }
  }

  const text = findRunTextInBlocks(
    findSectionBlocks(store, record.sectionId),
    {
      sectionId: record.sectionId,
      blockId: record.blockId,
      runId: record.runId,
      graphemeIndex: record.graphemeIndex,
      ...(record.assoc === undefined ? {} : { assoc: record.assoc })
    }
  )

  if (text === undefined) {
    return null
  }

  return createTextAnchorRef({
    documentId: record.documentId as DocumentId,
    sectionId: record.sectionId as SectionId,
    blockId: record.blockId as BlockId,
    runId: record.runId as RunId,
    graphemeIndex: createGraphemeIndex(record.graphemeIndex),
    text,
    ...(record.assoc === undefined ? {} : { assoc: record.assoc })
  })
}

/** 尝试用 Yjs relative position 恢复锚点，外部导入快照可回落到模型位置。 */
function tryRestoreAbsolutePosition(doc: Y.Doc, record: TextAnchorRecord): Y.AbsolutePosition | null {
  try {
    return Y.createAbsolutePositionFromRelativePosition(
      createRelativePositionFromSnapshot(record.relativePosition),
      doc
    )
  } catch {
    return null
  }
}

/** 按 section id 读取块容器，供导入快照回退定位使用。 */
function findSectionBlocks(store: DocumentStore, sectionId: string): readonly BlockRecord[] {
  const section = store.sections.toArray().find((candidate) =>
    candidate.get(DOCUMENT_STORE_FIELDS.section.id) === sectionId
  )

  return section === undefined ? [] : getSectionBlocks(section).toArray()
}

function findRunBySharedText(
  store: DocumentStore,
  text: Y.Text
): Readonly<{
  sectionId: SectionId
  blockId: BlockId
  runId: RunId
  text: Y.Text
}> | null {
  for (const section of store.sections.toArray()) {
    const sectionId = section.get(DOCUMENT_STORE_FIELDS.section.id)

    if (typeof sectionId !== 'string') {
      continue
    }

    const matched = findRunBySharedTextInBlocks(getSectionBlocks(section).toArray(), text, sectionId as SectionId)

    if (matched !== null) {
      return matched
    }
  }

  return null
}

function findRunBySharedTextInBlocks(
  blocks: readonly BlockRecord[],
  text: Y.Text,
  sectionId: SectionId
): Readonly<{
  sectionId: SectionId
  blockId: BlockId
  runId: RunId
  text: Y.Text
}> | null {
  for (const block of blocks) {
    if (block.get(DOCUMENT_STORE_FIELDS.block.kind) === 'paragraph') {
      const blockId = block.get(DOCUMENT_STORE_FIELDS.block.id)

      if (typeof blockId !== 'string') {
        continue
      }

      const matched = findRunBySharedTextInParagraph(block, text)

      if (matched !== null) {
        return {
          sectionId,
          blockId: blockId as BlockId,
          runId: matched.get(DOCUMENT_STORE_FIELDS.run.id) as RunId,
          text
        }
      }
    }

    if (block.get(DOCUMENT_STORE_FIELDS.block.kind) === 'table') {
      for (const row of getTableRows(block).toArray()) {
        for (const cell of getTableRowCells(row).toArray()) {
          const matched = findRunBySharedTextInBlocks(getTableCellBlocks(cell).toArray(), text, sectionId)

          if (matched !== null) {
            return matched
          }
        }
      }
    }
  }

  return null
}

function findRunBySharedTextInParagraph(block: BlockRecord, text: Y.Text): RunRecord | null {
  for (const run of getParagraphRuns(block).toArray()) {
    if (getRunText(run) === text) {
      return run
    }
  }

  return null
}
