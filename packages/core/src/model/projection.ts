/**
 * 职责：从 Gate 1 Y.Doc 权威状态派生只读 DocumentProjection。
 * 边界：只读取 document、section、paragraph、run、table 的最小结构，不写状态、不做布局、渲染、输入或导入导出。
 * 协作模块：layout、render、docx、pdf 后续只消费这里产出的只读快照，不直接读写 Y.Doc。
 * 性能/安全约束：当前实现是完整快照派生，不访问 DOM，不缓存可写 Yjs 容器引用。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/03-architecture.md#32-状态真源。
 */

import * as Y from 'yjs'

import { createJWordError } from '../shared/errors'
import {
  DOCUMENT_STORE_FIELDS,
  createDocumentStore,
  getParagraphRuns,
  projectCommentRecord,
  projectRevisionRecord,
  projectResourceRecord,
  readCommentRangeRecord,
  getRunField,
  getRunInlines,
  getRunLink,
  getRunRevisionId,
  getRunText,
  getSectionBlocks,
  getTableCellBlocks,
  getTableRowCells,
  getTableRows
} from './document-store'
import type {
  BlockRecord,
  DocumentStore,
  ResourceRecord,
  RunRecord,
  SectionRecord,
  TableCellRecord,
  TableRowRecord
} from './document-store'
import type {
  Block,
  Document,
  SectionPageLayout,
  ModelProperties,
  Paragraph,
  Run,
  Section,
  Table,
  TableBorder,
  TableCell,
  TableRow
} from './types'

/**
 * 只读文档投影。
 *
 * @remarks
 * 下游模块只能读取该快照，不能通过它反向修改 Y.Doc。
 */
export interface DocumentProjection {
  readonly document: Document
}

/**
 * 从 DocumentStore 或 Y.Doc 派生只读投影。
 *
 * @param input 文档状态壳或 Y.Doc。
 * @returns 冻结后的只读投影。
 */
export function createDocumentProjection(input: DocumentStore | Y.Doc): DocumentProjection {
  const store = input instanceof Y.Doc ? createDocumentStore(input) : input
  const documentId = readString(
    store.document.get(DOCUMENT_STORE_FIELDS.document.id),
    'document'
  )
  const styleIds = projectStringList(store.document.get(DOCUMENT_STORE_FIELDS.document.styleIds))
  const resourceIds = projectStringList(store.document.get(DOCUMENT_STORE_FIELDS.document.resourceIds))
  const commentIds = projectStringList(store.document.get(DOCUMENT_STORE_FIELDS.document.commentIds))
  const revisionIds = projectStringList(store.document.get(DOCUMENT_STORE_FIELDS.document.revisionIds))
  const resources = projectDocumentResources(store, resourceIds)
  const comments = projectDocumentComments(store, commentIds)
  const revisions = projectDocumentRevisions(store, revisionIds)
  const document: Document = {
    kind: 'document',
    id: documentId,
    ...(styleIds === undefined ? {} : { styleIds }),
    ...(resourceIds === undefined ? {} : { resourceIds }),
    ...(resources === undefined ? {} : { resources }),
    ...(comments === undefined ? {} : { comments }),
    ...(revisions === undefined ? {} : { revisions }),
    sections: deepFreezeArray(store.sections.toArray().map(projectSection))
  }

  return deepFreeze({
    document: deepFreeze(document)
  })
}

function projectSection(section: SectionRecord): Section {
  const properties = section.get(DOCUMENT_STORE_FIELDS.section.properties) as Y.Map<unknown> | undefined
  const page = projectSectionPage(properties?.get('page'))
  const columns = readOptionalNumber(properties?.get('columns'))
  const breakType = projectSectionBreakType(properties?.get('breakType'))
  const headerFooterSameAsPrevious = projectSectionSameAsPrevious(properties?.get('headerFooterSameAsPrevious'))
  const pageNumbering = projectSectionPageNumbering(properties?.get('pageNumbering'))
  const headerIds = projectStringList(section.get(DOCUMENT_STORE_FIELDS.section.headerIds))
  const footerIds = projectStringList(section.get(DOCUMENT_STORE_FIELDS.section.footerIds))

  return deepFreeze({
    kind: 'section',
    id: readString(section.get(DOCUMENT_STORE_FIELDS.section.id), 'section'),
    ...(breakType === undefined ? {} : { breakType }),
    ...(page === undefined ? {} : { page }),
    ...(columns === undefined ? {} : { columns }),
    ...(headerIds === undefined ? {} : { headerIds }),
    ...(footerIds === undefined ? {} : { footerIds }),
    ...(headerFooterSameAsPrevious === undefined ? {} : { headerFooterSameAsPrevious }),
    ...(pageNumbering === undefined ? {} : { pageNumbering }),
    blocks: deepFreezeArray(getSectionBlocks(section).toArray().map(projectBlock))
  })
}

function projectBlock(block: BlockRecord): Block {
  const kind = block.get(DOCUMENT_STORE_FIELDS.block.kind)

  if (kind === 'paragraph') {
    return projectParagraph(block)
  }

  if (kind === 'table') {
    return projectTable(block)
  }

  throw createJWordError('PROJECTION_INVALID_DOCUMENT', '未知块类型', {
    kind: String(kind)
  })
}

/**
 * 投影段落并补齐稳定的 style/list 语义。
 */
function projectParagraph(block: BlockRecord): Paragraph {
  const properties = projectProperties(block.get(DOCUMENT_STORE_FIELDS.block.properties))
  const styleId = readParagraphStyleId(properties)
  const list = readParagraphList(properties)

  return deepFreeze({
    kind: 'paragraph',
    id: readString(block.get(DOCUMENT_STORE_FIELDS.block.id), 'paragraph'),
    ...(properties === undefined ? {} : { properties }),
    ...(styleId === undefined ? {} : { styleId }),
    ...(list === undefined ? {} : { list }),
    runs: deepFreezeArray(getParagraphRuns(block).toArray().map(projectRun))
  })
}

function projectRun(run: RunRecord): Run {
  const properties = projectProperties(run.get(DOCUMENT_STORE_FIELDS.run.properties))
  const field = getRunField(run)
  const link = getRunLink(run)
  const revisionId = getRunRevisionId(run)
  const structuredInlines = getRunInlines(run)

  return deepFreeze({
    kind: 'run',
    id: readString(run.get(DOCUMENT_STORE_FIELDS.run.id), 'run'),
    ...(properties === undefined ? {} : { properties }),
    ...(field === undefined ? {} : { field }),
    ...(link === undefined ? {} : { link }),
    ...(revisionId === undefined ? {} : { revisionId }),
    inlines: deepFreezeArray(structuredInlines ?? [
      deepFreeze({
        kind: 'text',
        text: getRunText(run).toString()
      })
    ])
  })
}

function projectTable(block: BlockRecord): Table {
  const properties = projectProperties(block.get(DOCUMENT_STORE_FIELDS.block.properties))
  const grid = readTableGrid(properties)
  const border = readTableBorder(properties)

  return deepFreeze({
    kind: 'table',
    id: readString(block.get(DOCUMENT_STORE_FIELDS.block.id), 'table'),
    ...(properties === undefined ? {} : { properties }),
    ...(grid === undefined ? {} : { grid }),
    ...(border === undefined ? {} : { border }),
    rows: deepFreezeArray(getTableRows(block).toArray().map(projectTableRow))
  })
}

function projectTableRow(row: TableRowRecord): TableRow {
  const properties = projectProperties(row.get(DOCUMENT_STORE_FIELDS.tableRow.properties))

  return deepFreeze({
    id: readString(row.get(DOCUMENT_STORE_FIELDS.tableRow.id), 'table row'),
    ...(properties === undefined ? {} : { properties }),
    cells: deepFreezeArray(getTableRowCells(row).toArray().map(projectTableCell))
  })
}

function projectTableCell(cell: TableCellRecord): TableCell {
  const properties = projectProperties(cell.get(DOCUMENT_STORE_FIELDS.tableCell.properties))
  const gridSpan = readOptionalNumber(cell.get(DOCUMENT_STORE_FIELDS.tableCell.gridSpan))
  const border = readTableBorder(properties)

  return deepFreeze({
    id: readString(cell.get(DOCUMENT_STORE_FIELDS.tableCell.id), 'table cell'),
    ...(properties === undefined ? {} : { properties }),
    ...(border === undefined ? {} : { border }),
    ...(gridSpan === undefined ? {} : { gridSpan }),
    blocks: deepFreezeArray(getTableCellBlocks(cell).toArray().map(projectBlock))
  })
}

/** 从属性里读取表格边框快照。 */
function readTableBorder(properties: ModelProperties | undefined): TableBorder | undefined {
  const value = properties?.border

  if (!isRecord(value)) {
    return undefined
  }

  const color = typeof value.color === 'string' ? value.color : undefined
  const widthTwips = readOptionalNumber(value.widthTwips)

  if (color === undefined && widthTwips === undefined) {
    return undefined
  }

  return deepFreeze({
    ...(color === undefined ? {} : { color }),
    ...(widthTwips === undefined ? {} : { widthTwips })
  })
}

/** 从属性里读取表格网格列宽。 */
function readTableGrid(properties: ModelProperties | undefined): readonly number[] | undefined {
  const value = properties?.grid

  if (!Array.isArray(value)) {
    return undefined
  }

  const grid = value.filter((item): item is number => typeof item === 'number' && item > 0)

  return grid.length === 0 ? undefined : deepFreezeArray(grid)
}

function projectProperties(value: unknown): ModelProperties | undefined {
  if (!(value instanceof Y.Map) || value.size === 0) {
    return undefined
  }

  return deepFreeze(Object.fromEntries(value.entries()) as ModelProperties)
}

function projectDocumentComments(
  store: DocumentStore,
  commentIds: readonly string[] | undefined
): Document['comments'] | undefined {
  if (commentIds === undefined || commentIds.length === 0) {
    return undefined
  }

  const comments = commentIds.flatMap((commentId) => {
    const record = store.comments.get(commentId)
    const anchorRangeId = typeof record?.get(DOCUMENT_STORE_FIELDS.comment.anchorRangeId) === 'string'
      ? record.get(DOCUMENT_STORE_FIELDS.comment.anchorRangeId) as string
      : undefined
    const rangeRecord = anchorRangeId === undefined
      ? undefined
      : store.commentRanges.get(anchorRangeId)

    return record === undefined || rangeRecord === undefined
      ? []
      : [projectCommentRecord(record, readCommentRangeRecord(rangeRecord))]
  })

  return comments.length === 0 ? undefined : deepFreezeArray(comments)
}

function projectDocumentRevisions(
  store: DocumentStore,
  revisionIds: readonly string[] | undefined
): Document['revisions'] | undefined {
  const ids = revisionIds ?? Array.from(store.revisions.keys())

  if (ids.length === 0) {
    return undefined
  }

  const revisions = ids
    .map((revisionId) => store.revisions.get(revisionId))
    .filter((revision): revision is NonNullable<typeof revision> => revision !== undefined)
    .map(projectRevisionRecord)

  return revisions.length === 0 ? undefined : deepFreezeArray(revisions)
}

/**
 * 读取段落样式标识。
 */
function readParagraphStyleId(properties: ModelProperties | undefined): string | undefined {
  const value = properties?.styleId

  return typeof value === 'string' ? value : undefined
}

/**
 * 读取段落列表语义。
 */
function readParagraphList(properties: ModelProperties | undefined): Paragraph['list'] | undefined {
  const numberingId = properties?.listNumberingId
  const level = properties?.listLevel

  if (typeof numberingId !== 'string' || typeof level !== 'number') {
    return undefined
  }

  return deepFreeze({
    numberingId,
    level
  })
}

function projectSectionPage(value: unknown): SectionPageLayout | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  const widthTwips = readOptionalNumber(value.widthTwips)
  const heightTwips = readOptionalNumber(value.heightTwips)
  const marginTwips = projectPageMargins(value.marginTwips)

  if (widthTwips === undefined && heightTwips === undefined && marginTwips === undefined) {
    return undefined
  }

  return deepFreeze({
    ...(widthTwips === undefined ? {} : { widthTwips }),
    ...(heightTwips === undefined ? {} : { heightTwips }),
    ...(marginTwips === undefined ? {} : { marginTwips })
  })
}

function projectSectionBreakType(value: unknown): Section['breakType'] | undefined {
  return value === 'continuous' || value === 'next-page' ? value : undefined
}

function projectSectionSameAsPrevious(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function projectSectionPageNumbering(value: unknown): Section['pageNumbering'] | undefined {
  if (!isRecord(value) || (value.mode !== 'continue' && value.mode !== 'restart')) {
    return undefined
  }

  const start = readOptionalNumber(value.start)

  return deepFreeze({
    mode: value.mode,
    ...(start === undefined ? {} : { start })
  })
}

function projectPageMargins(value: unknown): SectionPageLayout['marginTwips'] | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  const top = readOptionalNumber(value.top)
  const right = readOptionalNumber(value.right)
  const bottom = readOptionalNumber(value.bottom)
  const left = readOptionalNumber(value.left)

  if (top === undefined && right === undefined && bottom === undefined && left === undefined) {
    return undefined
  }

  return deepFreeze({
    ...(top === undefined ? {} : { top }),
    ...(right === undefined ? {} : { right }),
    ...(bottom === undefined ? {} : { bottom }),
    ...(left === undefined ? {} : { left })
  })
}

function projectStringList(value: unknown): readonly string[] | undefined {
  if (!(value instanceof Y.Array)) {
    return undefined
  }

  const items = value.toArray().filter((item): item is string => typeof item === 'string')

  if (items.length === 0) {
    return undefined
  }

  return deepFreezeArray(items)
}

function projectDocumentResources(
  store: DocumentStore,
  resourceIds: readonly string[] | undefined
): Document['resources'] | undefined {
  const ids = resourceIds ?? Array.from(store.resources.keys())

  if (ids.length === 0) {
    return undefined
  }

  const resources = ids
    .map((resourceId) => store.resources.get(resourceId))
    .filter((resource): resource is ResourceRecord => resource !== undefined)
    .map(projectResourceRecord)

  if (resources.length === 0) {
    return undefined
  }

  return deepFreezeArray(resources)
}

function readString(value: unknown, label: string): string {
  if (typeof value === 'string') {
    return value
  }

  throw createJWordError('PROJECTION_INVALID_DOCUMENT', `${label} 缺少字符串 ID`, {
    label
  })
}

function readOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined
}

function isRecord(
  value: unknown
): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function deepFreezeArray<Item>(items: readonly Item[]): readonly Item[] {
  return Object.freeze([...items])
}

function deepFreeze<ObjectShape extends object>(value: ObjectShape): Readonly<ObjectShape> {
  for (const child of Object.values(value)) {
    if (child !== null && typeof child === 'object') {
      Object.freeze(child)
    }
  }

  return Object.freeze(value)
}
