/**
 * @vitest-environment node
 *
 * 职责：验证 Gate 4 表格 command builder 会生成最小可执行的表格 command。
 * 边界：只覆盖 command 形状与默认表格模型，不测试 Y.Doc 写入、布局、渲染或浏览器交互。
 * 协作模块：transaction pipeline 与 operation adapter 会消费这些 builder 产出的 operation。
 * 性能/安全约束：测试只依赖内存 projection，不访问 DOM、网络或磁盘。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import { describe, expect, it } from 'vitest'

import {
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
  buildSetTableRowHeightCommand
} from '../../src/index'
import type { DocumentProjection } from '../../src/model/projection'

describe('table command builders', () => {
  it('builds insertTable command with default empty text cells', () => {
    const command = buildInsertTableCommand(createParagraphProjection(), null, {
      rows: 2,
      columns: 2
    })

    expect(command).toMatchObject({
      name: 'insertTable',
      operations: [{
        kind: 'insertTable',
        sectionId: 'section-builder',
        placement: {
          kind: 'append'
        },
        table: {
          kind: 'table',
          grid: [1500, 1500],
          rows: [
            {
              properties: {
                heightTwips: 600
              },
              id: expect.any(String),
              cells: [
                {
                  id: expect.any(String),
                  blocks: [
                    {
                      kind: 'paragraph',
                      id: expect.any(String),
                      runs: [
                        {
                          kind: 'run',
                          id: expect.any(String),
                          inlines: [{ kind: 'text', text: '' }]
                        }
                      ]
                    }
                  ]
                },
                {
                  id: expect.any(String),
                  blocks: [
                    {
                      kind: 'paragraph',
                      id: expect.any(String),
                      runs: [
                        {
                          kind: 'run',
                          id: expect.any(String),
                          inlines: [{ kind: 'text', text: '' }]
                        }
                      ]
                    }
                  ]
                }
              ]
            },
            {
              properties: {
                heightTwips: 600
              },
              id: expect.any(String),
              cells: [
                {
                  id: expect.any(String),
                  blocks: [
                    {
                      kind: 'paragraph',
                      id: expect.any(String),
                      runs: [
                        {
                          kind: 'run',
                          id: expect.any(String),
                          inlines: [{ kind: 'text', text: '' }]
                        }
                      ]
                    }
                  ]
                },
                {
                  id: expect.any(String),
                  blocks: [
                    {
                      kind: 'paragraph',
                      id: expect.any(String),
                      runs: [
                        {
                          kind: 'run',
                          id: expect.any(String),
                          inlines: [{ kind: 'text', text: '' }]
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        }
      }]
    })
  })

  it('builds row and column commands against the projected table shape', () => {
    const projection = createTableProjection()

    const insertRow = buildInsertTableRowCommand(projection, 'table-builder', 1)
    const deleteRow = buildDeleteTableRowCommand(projection, 'table-builder', 0)
    const insertColumn = buildInsertTableColumnCommand(projection, 'table-builder', 1)
    const deleteColumn = buildDeleteTableColumnCommand(projection, 'table-builder', 0)
    const setColumnWidth = buildSetTableColumnWidthCommand(projection, 'table-builder', 1, 2600)
    const setRowHeight = buildSetTableRowHeightCommand(projection, 'table-builder', 0, 600)

    expect(insertRow?.operations[0]).toMatchObject({
      kind: 'insertTableRow',
      tableId: 'table-builder',
      rowIndex: 1,
      rowHeightTwips: 480,
      rowId: expect.any(String),
      cellIds: expect.arrayContaining([expect.any(String), expect.any(String)]),
      paragraphIds: expect.arrayContaining([expect.any(String), expect.any(String)]),
      runIds: expect.arrayContaining([expect.any(String), expect.any(String)])
    })
    expect(deleteRow).toEqual({
      name: 'deleteTableRow',
      operations: [{
        kind: 'deleteTableRow',
        tableId: 'table-builder',
        rowIndex: 0
      }]
    })
    expect(insertColumn?.operations[0]).toMatchObject({
      kind: 'insertTableColumn',
      tableId: 'table-builder',
      columnIndex: 1,
      columnWidthTwips: 1800,
      cellIds: expect.arrayContaining([expect.any(String)]),
      paragraphIds: expect.arrayContaining([expect.any(String)]),
      runIds: expect.arrayContaining([expect.any(String)])
    })
    expect(deleteColumn).toEqual({
      name: 'deleteTableColumn',
      operations: [{
        kind: 'deleteTableColumn',
        tableId: 'table-builder',
        columnIndex: 0
      }]
    })
    expect(setColumnWidth).toEqual({
      name: 'setTableColumnWidth',
      operations: [{
        kind: 'setTableColumnWidth',
        tableId: 'table-builder',
        columnIndex: 1,
        widthTwips: 2600
      }]
    })
    expect(setRowHeight).toEqual({
      name: 'setTableRowHeight',
      operations: [{
        kind: 'setTableRowHeight',
        tableId: 'table-builder',
        rowIndex: 0,
        heightTwips: 600
      }]
    })
  })

  it('builds merge、border and cell text commands', () => {
    const projection = createTableProjection()

    expect(buildMergeTableCellsCommand(projection, 'table-builder', 0, 0, 1)).toEqual({
      name: 'mergeTableCells',
      operations: [{
        kind: 'mergeTableCells',
        tableId: 'table-builder',
        rowIndex: 0,
        startColumnIndex: 0,
        endColumnIndex: 1
      }]
    })
    expect(buildSetTableBorderCommand(
      projection,
      'table-builder',
      {
        color: '#0f172a',
        widthTwips: 18
      }
    )).toEqual({
      name: 'setTableBorder',
      operations: [{
        kind: 'setTableBorder',
        tableId: 'table-builder',
        border: {
          color: '#0f172a',
          widthTwips: 18
        }
      }]
    })
    expect(buildSetTableCellBorderCommand(
      projection,
      'table-builder',
      'table-builder-cell-1-1',
      {
        color: '#2563eb',
        widthTwips: 24
      }
    )).toEqual({
      name: 'setTableCellBorder',
      operations: [{
        kind: 'setTableBorder',
        tableId: 'table-builder',
        cellId: 'table-builder-cell-1-1',
        border: {
          color: '#2563eb',
          widthTwips: 24
        }
      }]
    })
    expect(buildSetTableCellTextCommand(
      projection,
      'table-builder',
      'table-builder-cell-1-1',
      '单元格文本'
    )).toEqual({
      name: 'setTableCellText',
      operations: [{
        kind: 'setTableCellText',
        tableId: 'table-builder',
        cellId: 'table-builder-cell-1-1',
        text: '单元格文本'
      }]
    })
  })
})

/**
 * 创建只含一个正文段落的 projection，供 insertTable builder 计算 placement。
 */
function createParagraphProjection(): DocumentProjection {
  return {
    document: {
      kind: 'document',
      id: 'document-builder',
      sections: [
        {
          kind: 'section',
          id: 'section-builder',
          blocks: [
            {
              kind: 'paragraph',
              id: 'paragraph-builder',
              runs: [
                {
                  kind: 'run',
                  id: 'run-builder',
                  inlines: [{ kind: 'text', text: 'anchor' }]
                }
              ]
            }
          ]
        }
      ]
    }
  }
}

/**
 * 创建一个 2x2 简单表格 projection，供行列与边框命令测试复用。
 */
function createTableProjection(): DocumentProjection {
  return {
    document: {
      kind: 'document',
      id: 'document-table-builder',
      sections: [
        {
          kind: 'section',
          id: 'section-builder',
          blocks: [
            {
              kind: 'table',
              id: 'table-builder',
              grid: [1800, 1800],
              rows: [
                {
                  id: 'table-builder-row-1',
                  properties: {
                    heightTwips: 480
                  },
                  cells: [
                    {
                      id: 'table-builder-cell-1-1',
                      blocks: [
                        {
                          kind: 'paragraph',
                          id: 'table-builder-paragraph-1-1',
                          runs: [
                            {
                              kind: 'run',
                              id: 'table-builder-run-1-1',
                              inlines: [{ kind: 'text', text: '' }]
                            }
                          ]
                        }
                      ]
                    },
                    {
                      id: 'table-builder-cell-1-2',
                      blocks: [
                        {
                          kind: 'paragraph',
                          id: 'table-builder-paragraph-1-2',
                          runs: [
                            {
                              kind: 'run',
                              id: 'table-builder-run-1-2',
                              inlines: [{ kind: 'text', text: '' }]
                            }
                          ]
                        }
                      ]
                    }
                  ]
                },
                {
                  id: 'table-builder-row-2',
                  properties: {
                    heightTwips: 480
                  },
                  cells: [
                    {
                      id: 'table-builder-cell-2-1',
                      blocks: [
                        {
                          kind: 'paragraph',
                          id: 'table-builder-paragraph-2-1',
                          runs: [
                            {
                              kind: 'run',
                              id: 'table-builder-run-2-1',
                              inlines: [{ kind: 'text', text: '' }]
                            }
                          ]
                        }
                      ]
                    },
                    {
                      id: 'table-builder-cell-2-2',
                      blocks: [
                        {
                          kind: 'paragraph',
                          id: 'table-builder-paragraph-2-2',
                          runs: [
                            {
                              kind: 'run',
                              id: 'table-builder-run-2-2',
                              inlines: [{ kind: 'text', text: '' }]
                            }
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    }
  }
}
