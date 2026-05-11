/**
 * @vitest-environment node
 *
 * 职责：验证 Gate 1.7 只读 DocumentProjection 能从 Y.Doc 状态派生核心层级。
 * 边界：只测试 document、section、block、run、text 的只读快照，不覆盖编辑 adapter、布局或渲染。
 * 协作模块：后续 layout、render、docx 和 pdf 只能消费这里的只读投影。
 * 性能/安全约束：测试只使用内存中的 Y.Doc，不触发 DOM、网络或磁盘写入。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/03-architecture.md#32-状态真源。
 */

import { describe, expect, it } from 'vitest'

import {
  DOCUMENT_STORE_FIELDS,
  createDocumentStore,
  createParagraphRecord,
  createRunRecord,
  createSectionRecord,
  createTableCellRecord,
  createTableRecord,
  createTableRowRecord,
  getParagraphRuns,
  getRunText,
  getSectionBlocks,
  getTableCellBlocks,
  getTableRowCells,
  getTableRows
} from '../src/document-store'
import { createDocumentProjection } from '../src/projection'
import type { BlockId, DocumentId, RunId, SectionId } from '../src/position'
import type { Inline, Paragraph, Table } from '../src/model'

describe('createDocumentProjection', () => {
  it('从 DocumentStore 派生 document section block run text 只读快照', () => {
    const store = createDocumentStore()
    const section = createSectionRecord('section-1' as SectionId)
    const paragraph = createParagraphRecord('paragraph-1' as BlockId)
    const run = createRunRecord('run-1' as RunId, '你好，JWord')

    store.document.set(DOCUMENT_STORE_FIELDS.document.id, 'document-1' as DocumentId)
    store.sections.push([section])
    getSectionBlocks(section).push([paragraph])
    getParagraphRuns(paragraph).push([run])

    const projection = createDocumentProjection(store)
    const projectedParagraph = projection.document.sections[0]?.blocks[0] as Paragraph
    const projectedRun = projectedParagraph.runs[0]

    expect(projection.document.kind).toBe('document')
    expect(projection.document.id).toBe('document-1')
    expect(projection.document.sections[0]?.kind).toBe('section')
    expect(projection.document.sections[0]?.id).toBe('section-1')
    expect(projectedParagraph.kind).toBe('paragraph')
    expect(projectedParagraph.id).toBe('paragraph-1')
    expect(projectedRun?.kind).toBe('run')
    expect(projectedRun?.id).toBe('run-1')
    expect(projectedRun?.inlines).toEqual([
      {
        kind: 'text',
        text: '你好，JWord'
      }
    ])
  })

  it('从 Y.Doc 入口读取同一份状态', () => {
    const store = createDocumentStore()
    const section = createSectionRecord('section-from-doc' as SectionId)
    const paragraph = createParagraphRecord('paragraph-from-doc' as BlockId)
    const run = createRunRecord('run-from-doc' as RunId, '来自 Y.Doc')

    store.document.set(DOCUMENT_STORE_FIELDS.document.id, 'document-from-doc' as DocumentId)
    store.sections.push([section])
    getSectionBlocks(section).push([paragraph])
    getParagraphRuns(paragraph).push([run])

    const projection = createDocumentProjection(store.doc)
    const projectedParagraph = projection.document.sections[0]?.blocks[0] as Paragraph
    const projectedRun = projectedParagraph.runs[0]

    expect(projection.document.id).toBe('document-from-doc')
    expect(projectedRun?.inlines[0]).toEqual({
      kind: 'text',
      text: '来自 Y.Doc'
    })
  })

  it('读取表格块和单元格内的嵌套段落', () => {
    const store = createDocumentStore()
    const section = createSectionRecord('section-table' as SectionId)
    const table = createTableRecord('table-1' as BlockId)
    const row = createTableRowRecord('row-1')
    const cell = createTableCellRecord('cell-1')
    const paragraph = createParagraphRecord('cell-paragraph-1' as BlockId)
    const run = createRunRecord('cell-run-1' as RunId, '单元格文本')

    store.document.set(DOCUMENT_STORE_FIELDS.document.id, 'document-table' as DocumentId)
    store.sections.push([section])
    getSectionBlocks(section).push([table])
    getTableRows(table).push([row])
    getTableRowCells(row).push([cell])
    getTableCellBlocks(cell).push([paragraph])
    getParagraphRuns(paragraph).push([run])

    const projection = createDocumentProjection(store)
    const projectedTable = projection.document.sections[0]?.blocks[0] as Table
    const projectedParagraph = projectedTable.rows[0]?.cells[0]?.blocks[0] as Paragraph

    expect(projectedTable.kind).toBe('table')
    expect(projectedTable.id).toBe('table-1')
    expect(projectedTable.rows[0]?.id).toBe('row-1')
    expect(projectedTable.rows[0]?.cells[0]?.id).toBe('cell-1')
    expect(projectedParagraph.runs[0]?.inlines[0]).toEqual({
      kind: 'text',
      text: '单元格文本'
    })
  })

  it('投影对象冻结且不暴露可写 Yjs 容器', () => {
    const store = createDocumentStore()
    const section = createSectionRecord('section-readonly' as SectionId)
    const paragraph = createParagraphRecord('paragraph-readonly' as BlockId)
    const run = createRunRecord('run-readonly' as RunId, '只读文本')

    store.document.set(DOCUMENT_STORE_FIELDS.document.id, 'document-readonly' as DocumentId)
    store.sections.push([section])
    getSectionBlocks(section).push([paragraph])
    getParagraphRuns(paragraph).push([run])

    const projection = createDocumentProjection(store)
    const projectedParagraph = projection.document.sections[0]?.blocks[0] as Paragraph
    const projectedRun = projectedParagraph.runs[0]

    // 投影只给下游只读快照，不能把 push 反写回 Y.Doc。
    expect(Object.isFrozen(projection)).toBe(true)
    expect(Object.isFrozen(projection.document.sections)).toBe(true)
    expect(Object.isFrozen(projectedParagraph.runs)).toBe(true)
    expect(Object.isFrozen(projectedRun?.inlines)).toBe(true)
    expect(() => pushInline(projectedRun?.inlines ?? [])).toThrow(TypeError)
    expect(getRunText(run).toString()).toBe('只读文本')
  })
})

function pushInline(inlines: readonly Inline[]) {
  const writableInlines = inlines as Inline[]

  writableInlines.push({
    kind: 'text',
    text: '反写文本'
  })
}
