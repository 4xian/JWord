/**
 * 职责：提供 vanilla demo 的 Gate 4 Iteration 2 table support，只做 core table adapter 装配和浏览器测试钩子。
 * 边界：不实现 table UI，也不复制 core table command builder；这些逻辑分别交给 `@4xian/jword-ui` 和 core 公开 API。
 * 协作模块：main.ts 把这里的 table options 传给 `createJWordUi(...)`，浏览器测试通过 `window.__jwordTestFixture.table` 读取钩子。
 * 性能/安全约束：所有表格写入继续走 `createCoreTableCommandAdapter()` + `editor.executeCommand(...)`，不允许直接修改 projection。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import {
  buildSetTableCellTextCommand,
  createSelectionState,
  type Block,
  type DocumentProjection,
  type Editor
} from '@4xian/jword-core'
import {
  createCoreTableCommandAdapter,
  type JWordTableOptions,
  type JWordTableSelectionTarget
} from '@4xian/jword-ui'

type TableBlock = Extract<Block, { readonly kind: 'table' }>
type ParagraphBlock = Extract<Block, { readonly kind: 'paragraph' }>

export interface DemoTableSnapshot {
  readonly tableId: string
  readonly rowCount: number
  readonly columnCount: number
  readonly firstRowCellCount: number
  readonly firstCellGridSpan: number
  readonly firstCellText: string
  readonly firstCellBorderColor: string | null
  readonly firstCellBorderWidthTwips: number | null
}

export interface DemoTableHooks {
  readSnapshot(): DemoTableSnapshot | null
  readActiveTarget(): JWordTableSelectionTarget | null
  selectCell(rowIndex: number, columnIndex: number): boolean
  setCellText(rowIndex: number, columnIndex: number, text: string): boolean
}

interface DemoTableSupport {
  readonly table: JWordTableOptions
  readonly hooks: DemoTableHooks
  destroy(): void
}

/** 创建 vanilla demo 的 Gate 4 表格支持。 */
export function createDemoTableSupport(editor: Editor): DemoTableSupport {
  const commands = createCoreTableCommandAdapter()

  /** 暴露给 UI 的 table options。 */
  const table = Object.freeze({
    description: 'Gate 4 Iteration 2：验证官方 table toolbar、core table command adapter 与 vanilla demo 的最小闭环。',
    commands
  } satisfies JWordTableOptions)

  /** 暴露给浏览器测试的最小钩子。 */
  const hooks = Object.freeze({
    readSnapshot() {
      return readFirstTableSnapshot(editor.getProjection())
    },
    readActiveTarget() {
      return commands.resolveActiveTableTarget?.({
        editor,
        projection: editor.getProjection(),
        selection: editor.getSelection()
      }) ?? null
    },
    selectCell(rowIndex: number, columnIndex: number) {
      const snapshot = readFirstTableSnapshot(editor.getProjection())

      if (snapshot === null) {
        return false
      }

      return selectTableCell(editor, snapshot.tableId, rowIndex, columnIndex)
    },
    setCellText(rowIndex: number, columnIndex: number, text: string) {
      const snapshot = readFirstTableSnapshot(editor.getProjection())

      if (snapshot === null) {
        return false
      }

      const cell = findTableCellByColumnIndex(editor.getProjection(), snapshot.tableId, rowIndex, columnIndex)

      if (cell === null) {
        return false
      }

      const command = buildSetTableCellTextCommand(editor.getProjection(), snapshot.tableId, cell.id, text)

      if (command === null) {
        return false
      }

      editor.executeCommand(command)

      return true
    }
  } satisfies DemoTableHooks)

  return {
    table,
    hooks,
    destroy(): void {}
  }
}

/** 读取当前 projection 中首个表格的摘要。 */
function readFirstTableSnapshot(projection: DocumentProjection): DemoTableSnapshot | null {
  for (const section of projection.document.sections) {
    const table = section.blocks.find((block): block is TableBlock => block.kind === 'table')

    if (table === undefined) {
      continue
    }

    const firstRow = table.rows[0]
    const firstCell = firstRow?.cells[0]

    return {
      tableId: table.id,
      rowCount: table.rows.length,
      columnCount: readTableColumnCount(table),
      firstRowCellCount: firstRow?.cells.length ?? 0,
      firstCellGridSpan: firstCell?.gridSpan ?? 1,
      firstCellText: readCellText(firstCell),
      firstCellBorderColor: firstCell?.border?.color ?? null,
      firstCellBorderWidthTwips: firstCell?.border?.widthTwips ?? null
    }
  }

  return null
}

/** 选择指定表格的目标单元格。 */
function selectTableCell(editor: Editor, tableId: string, rowIndex: number, columnIndex: number): boolean {
  const location = findTableLocationById(editor.getProjection(), tableId)

  if (location === null) {
    return false
  }

  const row = location.table.rows[rowIndex]

  if (row === undefined) {
    return false
  }

  const cellIndex = resolveCellIndexByColumnIndex(row, columnIndex)
  const cell = row.cells[cellIndex]
  const paragraph = cell === undefined ? undefined : findFirstParagraphInBlocks(cell.blocks)
  const run = paragraph?.runs[0]

  if (cell === undefined || paragraph === undefined || run === undefined) {
    return false
  }

  const anchor = editor.createTextAnchor({
    sectionId: location.sectionId,
    blockId: paragraph.id,
    runId: run.id,
    graphemeIndex: readRunGraphemeLength(run)
  })

  editor.setSelection(createSelectionState(anchor, anchor))
  editor.focus()

  return true
}

/** 根据逻辑列位置查找一个单元格。 */
function findTableCellByColumnIndex(
  projection: DocumentProjection,
  tableId: string,
  rowIndex: number,
  columnIndex: number
): TableBlock['rows'][number]['cells'][number] | null {
  const location = findTableLocationById(projection, tableId)

  if (location === null) {
    return null
  }

  const row = location.table.rows[rowIndex]

  if (row === undefined) {
    return null
  }

  return row.cells[resolveCellIndexByColumnIndex(row, columnIndex)] ?? null
}

/** 根据 tableId 查找顶层表格位置。 */
function findTableLocationById(
  projection: DocumentProjection,
  tableId: string
): Readonly<{
  sectionId: string
  table: TableBlock
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
  row: TableBlock['rows'][number],
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

/** 读取表格总列数。 */
function readTableColumnCount(table: TableBlock): number {
  return table.rows.reduce((count, row) => {
    return Math.max(count, row.cells.reduce((rowCount, cell) => rowCount + (cell.gridSpan ?? 1), 0))
  }, 0)
}

/** 读取单元格文本内容。 */
function readCellText(cell: TableBlock['rows'][number]['cells'][number] | undefined): string {
  if (cell === undefined) {
    return ''
  }

  return cell.blocks.map((block) => {
    if (block.kind !== 'paragraph') {
      return ''
    }

    return block.runs.map((run) => {
      return run.inlines.map((inline) => inline.kind === 'text' ? inline.text : '').join('')
    }).join('')
  }).join('\n')
}

/** 在 block 树里找到第一个可编辑段落。 */
function findFirstParagraphInBlocks(blocks: readonly Block[]): ParagraphBlock | undefined {
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

/** 读取 run 的 grapheme 长度。 */
function readRunGraphemeLength(run: ParagraphBlock['runs'][number]): number {
  return run.inlines.reduce((count, inline) => {
    if (inline.kind !== 'text') {
      return count
    }

    return count + Array.from(inline.text).length
  }, 0)
}
