/**
 * 职责：把表格 UI command adapter 桥接到 core 表格 command builders。
 * 边界：只做 projection 目标解析、参数映射和 editor.executeCommand，不创建 DOM。
 * 协作模块：table controller 通过该适配器写入 core，vanilla demo 可直接复用。
 * 性能/安全约束：所有表格写入继续走 editor facade 的 transaction pipeline。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md Step 4.4-4.7。
 */
import {
  buildDeleteTableColumnCommand,
  buildDeleteTableRowCommand,
  buildInsertTableColumnCommand,
  buildInsertTableCommand,
  buildInsertTableRowCommand,
  buildMergeTableCellsCommand,
  buildSetTableBorderCommand,
  createSelectionState,
  type Block,
  type Command,
  type DocumentProjection,
  type Editor,
  type SelectionState
} from '@4xian/jword-core'
import type {
  JWordTableBorderPreset,
  JWordTableCommandAdapter,
  JWordTableCommandResult,
  JWordTableSelectionScope,
  JWordTableSelectionTarget
} from '../types'

/** 创建 core 表格命令适配器。 */
export function createCoreTableCommandAdapter(): JWordTableCommandAdapter {
  return {
    resolveActiveTableTarget(input) {
      return resolveActiveTableTarget(input.editor, input.projection, input.selection)
    },
    insertTable(request) {
      const command = buildInsertTableCommand(request.projection, request.selection, {
          rows: request.rows,
          columns: request.columns
        })

      if (command === null) {
        return {
          kind: 'deferred',
          message: '当前文档无法插入表格。'
        }
      }

      request.editor.executeCommand(command)
      selectInsertedTableStart(request.editor, command)

      return {
        kind: 'applied',
        message: '已插入表格。'
      }
    },
    insertRow(request) {
      const rowIndex = request.placement === 'before'
        ? request.target.rowIndex
        : request.target.rowIndex + 1

      return executeTableCommand(
        buildInsertTableRowCommand(request.projection, request.target.tableId, rowIndex),
        request.editor,
        '当前表格无法插入行。',
        '已插入表格行。'
      )
    },
    deleteRow(request) {
      const command = buildDeleteTableRowCommand(request.projection, request.target.tableId, request.target.rowIndex)
      const result = executeTableCommand(
        command,
        request.editor,
        '当前表格至少需要保留一行。',
        '已删除表格行。'
      )

      if (result.kind === 'applied') {
        selectTableCell(request.editor, request.target.tableId, request.target.rowIndex, request.target.columnIndex)
      }

      return result
    },
    insertColumn(request) {
      const columnIndex = request.placement === 'before'
        ? request.target.columnIndex
        : request.target.columnIndex + 1

      return executeTableCommand(
        buildInsertTableColumnCommand(request.projection, request.target.tableId, columnIndex),
        request.editor,
        '当前表格无法插入列。',
        '已插入表格列。'
      )
    },
    deleteColumn(request) {
      const command = buildDeleteTableColumnCommand(request.projection, request.target.tableId, request.target.columnIndex)
      const result = executeTableCommand(
        command,
        request.editor,
        '当前表格至少需要保留一列。',
        '已删除表格列。'
      )

      if (result.kind === 'applied') {
        selectTableCell(request.editor, request.target.tableId, request.target.rowIndex, request.target.columnIndex)
      }

      return result
    },
    mergeCellWithRight(request) {
      return executeTableCommand(
        buildMergeTableCellsCommand(
          request.projection,
          request.target.tableId,
          request.target.rowIndex,
          request.target.cellIndex,
          request.target.cellIndex + 1
        ),
        request.editor,
        '当前单元格右侧没有可合并单元格。',
        '已合并单元格。'
      )
    },
    applyBorderPreset(request) {
      return executeTableCommand(
        buildSetTableBorderCommand(
          request.projection,
          request.target.tableId,
          readBorderPreset(request.preset),
          readBorderTargetCellId(request.scope, request.target)
        ),
        request.editor,
        '当前表格无法更新边框。',
        '已更新表格边框。'
      )
    }
  }
}

/** 插入表格后把光标放入首个单元格。 */
function selectInsertedTableStart(editor: Editor, command: Command): void {
  const insertion = command.operations.find((operation) => operation.kind === 'insertTable')

  if (insertion === undefined) {
    return
  }

  const firstCellBlock = insertion.table.rows[0]?.cells[0]?.blocks[0]

  if (firstCellBlock?.kind !== 'paragraph') {
    return
  }

  const firstRun = firstCellBlock.runs[0]

  if (firstRun === undefined) {
    return
  }

  const anchor = editor.createTextAnchor({
    sectionId: insertion.sectionId,
    blockId: firstCellBlock.id,
    runId: firstRun.id,
    graphemeIndex: 0
  })

  editor.setSelection(createSelectionState(anchor, anchor))
}

/** 执行表格命令。 */
function executeTableCommand(
  command: Command | null,
  editor: Editor,
  deferredMessage: string,
  appliedMessage: string
): JWordTableCommandResult {
  if (command === null) {
    return {
      kind: 'deferred',
      message: deferredMessage
    }
  }

  editor.executeCommand(command)

  return {
    kind: 'applied',
    message: appliedMessage
  }
}

/** 根据当前 selection 定位表格目标。 */
function resolveActiveTableTarget(
  editor: Editor,
  projection: DocumentProjection,
  selection: SelectionState | null
): JWordTableSelectionTarget | null {
  if (selection === null) {
    return null
  }

  const position = editor.resolveTextPosition(selection.focus)
  const resolved = findTableTargetByBlockId(projection, position.blockId)

  return resolved
}

/** 选择表格中最接近目标坐标的仍存活单元格。 */
function selectTableCell(editor: Editor, tableId: string, rowIndex: number, columnIndex: number): void {
  const projection = editor.getProjection()
  const location = findTableLocationById(projection, tableId)

  if (location === null || location.table.rows.length === 0) {
    return
  }

  const nextRowIndex = Math.min(rowIndex, location.table.rows.length - 1)
  const row = location.table.rows[nextRowIndex]

  if (row === undefined || row.cells.length === 0) {
    return
  }

  const nextCellIndex = resolveCellIndexByColumnIndex(row, columnIndex)
  const cell = row.cells[nextCellIndex]
  const paragraph = cell === undefined ? undefined : findFirstParagraphInBlocks(cell.blocks)
  const run = paragraph?.runs[0]

  if (paragraph === undefined || run === undefined) {
    return
  }

  const anchor = editor.createTextAnchor({
    sectionId: location.sectionId,
    blockId: paragraph.id,
    runId: run.id,
    graphemeIndex: 0
  })

  editor.setSelection(createSelectionState(anchor, anchor))
}

/** 根据 tableId 查找表格和所在 section。 */
function findTableLocationById(
  projection: DocumentProjection,
  tableId: string
): Readonly<{
  sectionId: string
  table: Extract<Block, { readonly kind: 'table' }>
}> | null {
  for (const section of projection.document.sections) {
    for (const block of section.blocks) {
      if (block.kind === 'table' && block.id === tableId) {
        return {
          sectionId: section.id,
          table: block
        }
      }
    }
  }

  return null
}

/** 读取一行中某个逻辑列对应的物理 cell 下标。 */
function resolveCellIndexByColumnIndex(
  row: Extract<Block, { readonly kind: 'table' }>['rows'][number],
  columnIndex: number
): number {
  let currentColumn = 0

  for (let cellIndex = 0; cellIndex < row.cells.length; cellIndex += 1) {
    const cell = row.cells[cellIndex]
    const span = cell?.gridSpan ?? 1

    if (columnIndex < currentColumn + span) {
      return cellIndex
    }

    currentColumn += span
  }

  return Math.max(0, row.cells.length - 1)
}

/** 在 block 树里找到第一个可编辑段落。 */
function findFirstParagraphInBlocks(
  blocks: readonly Block[]
): Extract<Block, { readonly kind: 'paragraph' }> | undefined {
  for (const block of blocks) {
    if (block.kind === 'paragraph') {
      return block
    }

    if (block.kind === 'table') {
      for (const row of block.rows) {
        for (const cell of row.cells) {
          const paragraph = findFirstParagraphInBlocks(cell.blocks)

          if (paragraph !== undefined) {
            return paragraph
          }
        }
      }
    }
  }

  return undefined
}

/** 在 projection 中查找包含 block 的表格单元格。 */
function findTableTargetByBlockId(projection: DocumentProjection, blockId: string): JWordTableSelectionTarget | null {
  for (const section of projection.document.sections) {
    const target = visitBlocks(section.blocks, section.id, blockId)

    if (target !== null) {
      return target
    }
  }

  return null
}

/** 递归查找表格目标。 */
function visitBlocks(
  blocks: readonly Block[],
  sectionId: string,
  blockId: string
): JWordTableSelectionTarget | null {
  for (const block of blocks) {
    if (block.kind !== 'table') {
      continue
    }

    for (let rowIndex = 0; rowIndex < block.rows.length; rowIndex += 1) {
      const row = block.rows[rowIndex]

      if (row === undefined) {
        continue
      }

      let columnIndex = 0
      for (let cellIndex = 0; cellIndex < row.cells.length; cellIndex += 1) {
        const cell = row.cells[cellIndex]

        if (cell === undefined) {
          continue
        }

        if (cell.blocks.some((candidate) => candidate.id === blockId)) {
          return {
            tableId: block.id,
            sectionId,
            rowIndex,
            columnIndex,
            cellIndex,
            rowCount: block.rows.length,
            columnCount: resolveTableColumnCount(block),
            rowCellCount: row.cells.length,
            cellId: cell.id,
            blockId,
            runId: readFirstRunId(cell.blocks) ?? '',
            cellGridSpan: cell.gridSpan ?? 1
          }
        }

        const nested = visitBlocks(cell.blocks, sectionId, blockId)

        if (nested !== null) {
          return nested
        }

        columnIndex += cell.gridSpan ?? 1
      }
    }
  }

  return null
}

/** 读取第一个 run ID。 */
function readFirstRunId(blocks: readonly Block[]): string | null {
  for (const block of blocks) {
    if (block.kind === 'paragraph') {
      return block.runs[0]?.id ?? null
    }
  }

  return null
}

/** 读取表格列数。 */
function resolveTableColumnCount(table: Extract<Block, { readonly kind: 'table' }>): number {
  return Math.max(1, table.rows[0]?.cells.reduce((count, cell) => count + (cell.gridSpan ?? 1), 0) ?? table.grid?.length ?? 1)
}

/** 把 UI 边框预设映射到第一版统一边框。 */
function readBorderPreset(preset: JWordTableBorderPreset) {
  if (preset === 'none') {
    return {
      color: '#ffffff',
      widthTwips: 0
    }
  }

  return {
    color: '#374151',
    widthTwips: 15
  }
}

/** 根据作用范围选择边框目标。 */
function readBorderTargetCellId(
  scope: JWordTableSelectionScope,
  target: JWordTableSelectionTarget
): string | undefined {
  return scope === 'cell' ? target.cellId : undefined
}
