/**
 * 职责：从 Gate 1 Y.Doc 权威状态派生只读 DocumentProjection。
 * 边界：只读取 document、section、paragraph、run、table 的最小结构，不写状态、不做布局、渲染、输入或导入导出。
 * 协作模块：layout、render、docx、pdf 后续只消费这里产出的只读快照，不直接读写 Y.Doc。
 * 性能/安全约束：当前实现是完整快照派生，不访问 DOM，不缓存可写 Yjs 容器引用。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/03-architecture.md#32-状态真源。
 */

import * as Y from 'yjs'

import { createJWordError } from './errors'
import {
  DOCUMENT_STORE_FIELDS,
  createDocumentStore,
  getParagraphRuns,
  getRunText,
  getSectionBlocks,
  getTableCellBlocks,
  getTableRowCells,
  getTableRows
} from './document-store'
import type {
  BlockRecord,
  DocumentStore,
  RunRecord,
  SectionRecord,
  TableCellRecord,
  TableRowRecord
} from './document-store'
import type {
  Block,
  Document,
  ModelProperties,
  Paragraph,
  Run,
  Section,
  Table,
  TableCell,
  TableRow
} from './model'

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
  const document: Document = {
    kind: 'document',
    id: documentId,
    sections: deepFreezeArray(store.sections.toArray().map(projectSection))
  }

  return deepFreeze({
    document: deepFreeze(document)
  })
}

function projectSection(section: SectionRecord): Section {
  return deepFreeze({
    kind: 'section',
    id: readString(section.get(DOCUMENT_STORE_FIELDS.section.id), 'section'),
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

function projectParagraph(block: BlockRecord): Paragraph {
  const properties = projectProperties(block.get(DOCUMENT_STORE_FIELDS.block.properties))

  return deepFreeze({
    kind: 'paragraph',
    id: readString(block.get(DOCUMENT_STORE_FIELDS.block.id), 'paragraph'),
    ...(properties === undefined ? {} : { properties }),
    runs: deepFreezeArray(getParagraphRuns(block).toArray().map(projectRun))
  })
}

function projectRun(run: RunRecord): Run {
  const properties = projectProperties(run.get(DOCUMENT_STORE_FIELDS.run.properties))

  return deepFreeze({
    kind: 'run',
    id: readString(run.get(DOCUMENT_STORE_FIELDS.run.id), 'run'),
    ...(properties === undefined ? {} : { properties }),
    inlines: deepFreezeArray([
      deepFreeze({
        kind: 'text',
        text: getRunText(run).toString()
      })
    ])
  })
}

function projectTable(block: BlockRecord): Table {
  const properties = projectProperties(block.get(DOCUMENT_STORE_FIELDS.block.properties))

  return deepFreeze({
    kind: 'table',
    id: readString(block.get(DOCUMENT_STORE_FIELDS.block.id), 'table'),
    ...(properties === undefined ? {} : { properties }),
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

  return deepFreeze({
    id: readString(cell.get(DOCUMENT_STORE_FIELDS.tableCell.id), 'table cell'),
    ...(properties === undefined ? {} : { properties }),
    ...(gridSpan === undefined ? {} : { gridSpan }),
    blocks: deepFreezeArray(getTableCellBlocks(cell).toArray().map(projectBlock))
  })
}

function projectProperties(value: unknown): ModelProperties | undefined {
  if (!(value instanceof Y.Map) || value.size === 0) {
    return undefined
  }

  return deepFreeze(Object.fromEntries(value.entries()) as ModelProperties)
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
