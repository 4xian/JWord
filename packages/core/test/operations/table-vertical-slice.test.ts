/**
 * @vitest-environment node
 *
 * 职责：验证 Gate 4 表格纵线的 transaction pipeline 能把 command 真正写回 Y.Doc 并投影出结构。
 * 边界：只覆盖 core model/operation/projection 闭环，不测试布局、渲染或浏览器 UI。
 * 协作模块：builder 负责构造 command，transaction pipeline 与 operation adapter 负责状态写入。
 * 性能/安全约束：测试仅使用内存中的 Y.Doc，不访问 DOM、网络或磁盘。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#step-44-step-46。
 */

import { describe, expect, it } from 'vitest'

import {
  buildSetUnderlineCommand,
  buildDeleteTableColumnCommand,
  buildDeleteTableRowCommand,
  buildInsertTableColumnCommand,
  buildInsertTableCommand,
  buildInsertTableRowCommand,
  buildMergeTableCellsCommand,
  buildSetTableBorderCommand,
  buildSetTableColumnWidthCommand,
  buildSetTableCellBorderCommand,
  buildSetTableCellTextCommand,
  buildSetTableRowHeightCommand,
  createEditor,
  createSelectionState
} from '../../src/index'
import {
  DOCUMENT_STORE_FIELDS,
  createDocumentStore,
  createParagraphRecord,
  createRunRecord,
  createSectionRecord,
  getParagraphRuns,
  getSectionBlocks
} from '../../src/model/document-store'
import type { BlockId, DocumentId, RunId, SectionId } from '../../src/model/position'
import type { Table } from '../../src/model/types'
import { createDocumentProjection } from '../../src/model/projection'
import { createTransactionPipeline } from '../../src/operations/transaction'

describe('table vertical slice transaction pipeline', () => {
  it('applies insert table, row/column changes, merge, border update and cell text edit', () => {
    const store = createDocumentStore()
    const section = createSectionRecord('section-table-slice' as SectionId)
    const anchorParagraph = createParagraphRecord('paragraph-table-slice' as BlockId)
    const anchorRun = createRunRecord('run-table-slice' as RunId, 'before table')
    const pipeline = createTransactionPipeline(store.doc)

    store.document.set(DOCUMENT_STORE_FIELDS.document.id, 'document-table-slice' as DocumentId)
    store.sections.push([section])
    getSectionBlocks(section).push([anchorParagraph])
    getParagraphRuns(anchorParagraph).push([anchorRun])

    const insertResult = pipeline.run(
      buildInsertTableCommand(createDocumentProjection(store), null, {
        rows: 2,
        columns: 2
      })!,
      { origin: 'test-table-slice' }
    )

    const insertedTable = insertResult.projection.document.sections[0]?.blocks[1] as Table

    expect(insertedTable.id).toBeDefined()
    expect(insertedTable.grid).toEqual([1500, 1500])
    expect(insertedTable.rows).toHaveLength(2)
    expect(insertedTable.rows[0]?.cells).toHaveLength(2)
    expect(insertedTable.rows[0]?.properties).toEqual({
      heightTwips: 600
    })

    const tableId = insertedTable.id
    const cellId = insertedTable.rows[0]?.cells[0]?.id ?? ''
    const cellParagraph = insertedTable.rows[0]?.cells[0]?.blocks[0]
    const cellRun = cellParagraph?.kind === 'paragraph' ? cellParagraph.runs[0] : undefined

    const keyboardTextResult = pipeline.run(
      {
        name: 'insertText',
        operations: [{
          kind: 'insertText',
          at: {
            sectionId: 'section-table-slice',
            blockId: cellParagraph?.id ?? '',
            runId: cellRun?.id ?? '',
            graphemeIndex: 0
          },
          text: '键盘输入'
        }]
      },
      { origin: 'test-table-slice' }
    )

    expect(
      ((keyboardTextResult.projection.document.sections[0]?.blocks[1] as Table)
        .rows[0]?.cells[0]?.blocks[0] as Table['rows'][number]['cells'][number]['blocks'][number])
    ).toMatchObject({
      kind: 'paragraph',
      runs: [
        {
          kind: 'run',
          inlines: [{ kind: 'text', text: '键盘输入' }]
        }
      ]
    })

    const insertRowResult = pipeline.run(
      buildInsertTableRowCommand(keyboardTextResult.projection, tableId, 1)!,
      { origin: 'test-table-slice' }
    )
    const insertedRowTable = insertRowResult.projection.document.sections[0]?.blocks[1] as Table

    expect(insertedRowTable.rows[1]?.properties).toEqual({
      heightTwips: 600
    })

    const insertColumnResult = pipeline.run(
      buildInsertTableColumnCommand(insertRowResult.projection, tableId, 1)!,
      { origin: 'test-table-slice' }
    )
    const resizedColumnResult = pipeline.run(
      buildSetTableColumnWidthCommand(insertColumnResult.projection, tableId, 0, 2100)!,
      { origin: 'test-table-slice' }
    )
    const resizedRowResult = pipeline.run(
      buildSetTableRowHeightCommand(resizedColumnResult.projection, tableId, 0, 720)!,
      { origin: 'test-table-slice' }
    )
    const mergeResult = pipeline.run(
      buildMergeTableCellsCommand(resizedRowResult.projection, tableId, 0, 0, 1)!,
      { origin: 'test-table-slice' }
    )
    const borderResult = pipeline.run(
      {
        name: 'setTableBorders',
        operations: [
          ...buildSetTableBorderCommand(
            mergeResult.projection,
            tableId,
            {
              color: '#0f172a',
              widthTwips: 18
            }
          )!.operations,
          ...buildSetTableCellBorderCommand(
            mergeResult.projection,
            tableId,
            cellId,
            {
              color: '#2563eb',
              widthTwips: 30
            }
          )!.operations
        ]
      },
      { origin: 'test-table-slice' }
    )
    const textResult = pipeline.run(
      buildSetTableCellTextCommand(
        borderResult.projection,
        tableId,
        cellId,
        'A1'
      )!,
      { origin: 'test-table-slice' }
    )
    const deleteRowResult = pipeline.run(
      buildDeleteTableRowCommand(textResult.projection, tableId, 1)!,
      { origin: 'test-table-slice' }
    )
    const deleteColumnResult = pipeline.run(
      buildDeleteTableColumnCommand(deleteRowResult.projection, tableId, 2)!,
      { origin: 'test-table-slice' }
    )

    const projectedTable = deleteColumnResult.projection.document.sections[0]?.blocks[1] as Table
    const firstRow = projectedTable.rows[0]
    const firstCell = firstRow?.cells[0]
    const firstParagraph = firstCell?.blocks[0]

    expect(projectedTable.border).toEqual({
      color: '#0f172a',
      widthTwips: 18
    })
    expect(projectedTable.grid).toEqual([2100, 1500])
    expect(projectedTable.rows).toHaveLength(2)
    expect(firstRow?.properties).toEqual({
      heightTwips: 720
    })
    expect(firstRow?.cells).toHaveLength(1)
    expect(firstCell?.gridSpan).toBe(2)
    expect(firstCell?.border).toEqual({
      color: '#2563eb',
      widthTwips: 30
    })
    expect(firstParagraph).toMatchObject({
      kind: 'paragraph',
      runs: [
        {
          kind: 'run',
          inlines: [{ kind: 'text', text: 'A1' }]
        }
      ]
    })
  })

  it('splits table cell plain text runs correctly after partial formatting', () => {
    const editor = createEditor({ initialText: 'before table' })

    try {
      const insertCommand = buildInsertTableCommand(editor.getProjection(), null, {
        rows: 1,
        columns: 1
      })

      if (insertCommand === null) {
        throw new Error('无法插入测试表格')
      }

      editor.executeCommand(insertCommand)

      const insertedTable = editor.getProjection().document.sections[0]?.blocks[1]

      if (insertedTable?.kind !== 'table') {
        throw new Error('缺少测试表格')
      }

      const cell = insertedTable.rows[0]?.cells[0]

      if (cell === undefined) {
        throw new Error('缺少测试单元格')
      }

      const setTextCommand = buildSetTableCellTextCommand(editor.getProjection(), insertedTable.id, cell.id, 'abcdef')

      if (setTextCommand === null) {
        throw new Error('无法写入测试单元格文本')
      }

      editor.executeCommand(setTextCommand)

      const tableAfterText = editor.getProjection().document.sections[0]?.blocks[1]

      if (tableAfterText?.kind !== 'table') {
        throw new Error('缺少写字后的测试表格')
      }

      const paragraph = tableAfterText.rows[0]?.cells[0]?.blocks[0]

      if (paragraph?.kind !== 'paragraph') {
        throw new Error('缺少测试段落')
      }

      const anchor = editor.createTextAnchor({
        sectionId: 'section-1',
        blockId: paragraph.id,
        runId: paragraph.runs[0]?.id ?? '',
        graphemeIndex: 1
      })
      const focus = editor.createTextAnchor({
        sectionId: 'section-1',
        blockId: paragraph.id,
        runId: paragraph.runs[0]?.id ?? '',
        graphemeIndex: 4
      })
      const selection = createSelectionState(anchor, focus)
      const underlineCommand = buildSetUnderlineCommand(editor.getProjection(), selection, true)

      if (underlineCommand === null) {
        throw new Error('无法生成表格格式命令')
      }

      editor.executeCommand(underlineCommand, {
        selectionAfter: selection
      })

      const formattedTable = editor.getProjection().document.sections[0]?.blocks[1]

      if (formattedTable?.kind !== 'table') {
        throw new Error('缺少格式化后的测试表格')
      }

      const formattedParagraph = formattedTable.rows[0]?.cells[0]?.blocks[0]

      expect(formattedParagraph).toMatchObject({
        kind: 'paragraph',
        runs: [
          {
            kind: 'run',
            inlines: [{ kind: 'text', text: 'a' }]
          },
          {
            kind: 'run',
            properties: {
              underline: true
            },
            inlines: [{ kind: 'text', text: 'bcd' }]
          },
          {
            kind: 'run',
            inlines: [{ kind: 'text', text: 'ef' }]
          }
        ]
      })
    } finally {
      editor.destroy()
    }
  })
})
