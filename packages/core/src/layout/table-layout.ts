/**
 * 职责：封装表格分页盒和单元格内容布局的纯数据辅助逻辑。
 * 边界：只读取表格模型、section 与 layout input，不访问 DOM、不绘制 Canvas。
 * 协作模块：engine 负责块级调度，本模块负责表格网格、行高和单元格内容盒生成。
 * 性能/安全约束：所有输出冻结为 layout runtime 结构，不持有跨次布局状态。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/03-architecture.md#36-layout-engine。
 */

import { cssPxToTwips } from './page-config'
import { measureTextSegmentForLayout, segmentTextForLayout } from './text-segments'
import { assignPageSectionBoundary, createInlineObjectPayload, readRunStyle } from './internal'
import { flushLine, resolveInlineObjectGeometry, startNewPage } from './paragraph-flow'
import type { Inline, Paragraph, Section, Table, TableCell } from '../model/types'
import type { PageConfig } from './page-config'
import type { TextPosition } from '../operations/transaction'
import type { LayoutCursor, LayoutInput, MutablePageBox, NonTextInlineBox, TableBox, TextFragment } from './types'

const DEFAULT_TABLE_COLUMN_WIDTH_TWIPS = 1500
const DEFAULT_TABLE_ROW_HEIGHT_TWIPS = 600
const TABLE_CELL_PADDING_X_TWIPS = 120
const TABLE_CELL_PADDING_Y_TWIPS = 90

/** 创建当前页可见的表格盒。 */
export function createTableBox(input: Readonly<{
  table: Table
  section: Section
  grid: readonly number[]
  rowPlans: readonly ReturnType<typeof createTableRowLayoutPlan>[]
  rowHeights: readonly number[]
  tableX: number
  tableY: number
  tableWidth: number
  startRowIndex: number
  endRowIndex: number
  pageIndex: number
}>): TableBox {
  const visibleRows = input.table.rows.slice(input.startRowIndex, input.endRowIndex)
  const tableHeight = sumRowHeightsInRange(input.rowHeights, input.startRowIndex, input.endRowIndex)

  return Object.freeze({
    kind: 'table',
    pageIndex: input.pageIndex,
    sectionId: input.section.id,
    tableId: input.table.id,
    grid: Object.freeze(input.grid),
    ...(input.table.border === undefined ? {} : { border: input.table.border }),
    startRowIndex: input.startRowIndex,
    continuesFromPreviousPage: input.startRowIndex > 0,
    continuesOnNextPage: input.endRowIndex < input.table.rows.length,
    rowCount: visibleRows.length,
    cellCount: visibleRows.reduce((count, row) => count + row.cells.length, 0),
    rows: Object.freeze(visibleRows.map((row, visibleIndex) => {
      const rowIndex = input.startRowIndex + visibleIndex
      let cellX = input.tableX
      let gridIndex = 0
      const rowY = input.tableY + sumRowHeightsInRange(input.rowHeights, input.startRowIndex, rowIndex)
      const rowHeight = input.rowHeights[rowIndex] ?? resolveTableRowHeight(row)

      return Object.freeze({
        rowId: row.id,
        pageIndex: input.pageIndex,
        x: input.tableX,
        y: rowY,
        width: input.tableWidth,
        height: rowHeight,
        cells: Object.freeze(row.cells.map((cell, cellIndex) => {
          const gridSpan = cell.gridSpan ?? 1
          const width = sumGridWidth(input.grid, gridIndex, gridSpan)
          const text = readTableCellText(cell)
          const textPosition = readTableCellTextPosition(input.section.id, cell)
          const relativeFragments = input.rowPlans[rowIndex]?.cells[cellIndex]?.fragments ?? []
          const relativeInlines = input.rowPlans[rowIndex]?.cells[cellIndex]?.inlines ?? []
          const verticalOffset = resolveTableCellContentVerticalOffset(relativeFragments, relativeInlines, rowHeight)
          const fragments = createPositionedTableCellFragments(
            relativeFragments,
            input.pageIndex,
            cellX,
            rowY,
            verticalOffset
          )
          const inlines = createPositionedTableCellInlines(
            relativeInlines,
            input.pageIndex,
            cellX,
            rowY,
            verticalOffset
          )
          const cellBox = Object.freeze({
            cellId: cell.id,
            pageIndex: input.pageIndex,
            x: cellX,
            y: rowY,
            width,
            height: rowHeight,
            gridSpan,
            ...(cell.border === undefined ? {} : { border: cell.border }),
            blockIds: Object.freeze(cell.blocks.map((block) => block.id)),
            text,
            fragments,
            inlines,
            ...(textPosition === undefined ? {} : { textPosition })
          })

          cellX += width
          gridIndex += gridSpan

          return cellBox
        }))
      })
    })),
    x: input.tableX,
    y: input.tableY,
    width: input.tableWidth,
    height: tableHeight
  })
}

/** 创建单行表格的单元格文本布局计划。 */
export function createTableRowLayoutPlan(
  row: Table['rows'][number],
  section: Section,
  grid: readonly number[],
  input: LayoutInput
): Readonly<{
  height: number
  cells: readonly Readonly<{
    fragments: readonly TextFragment[]
    inlines: readonly NonTextInlineBox[]
  }>[]
}> {
  let gridIndex = 0
  const cells = row.cells.map((cell) => {
    const gridSpan = cell.gridSpan ?? 1
    const width = sumGridWidth(grid, gridIndex, gridSpan)
    const cellContent = layoutTableCellContent(cell, section, input, width)

    gridIndex += gridSpan

    return Object.freeze({
      fragments: cellContent.fragments,
      inlines: cellContent.inlines
    })
  })
  const height = cells.reduce((value, cell) => {
    const lastFragment = cell.fragments[cell.fragments.length - 1]
    const lastInline = cell.inlines[cell.inlines.length - 1]
    const contentBottom = Math.max(
      lastFragment === undefined ? 0 : lastFragment.y + lastFragment.height + TABLE_CELL_PADDING_Y_TWIPS,
      lastInline === undefined ? 0 : lastInline.y + lastInline.height + TABLE_CELL_PADDING_Y_TWIPS
    )

    return Math.max(value, contentBottom)
  }, DEFAULT_TABLE_ROW_HEIGHT_TWIPS)

  return Object.freeze({
    height,
    cells: Object.freeze(cells)
  })
}

/** 生成单元格内相对坐标的内容盒，宽度按单元格内容区约束换行。 */
function layoutTableCellContent(
  cell: TableCell,
  section: Section,
  input: LayoutInput,
  cellWidth: number
): Readonly<{
  fragments: readonly TextFragment[]
  inlines: readonly NonTextInlineBox[]
}> {
  const maxTextWidth = Math.max(1, cellWidth - (TABLE_CELL_PADDING_X_TWIPS * 2))
  const fragments: TextFragment[] = []
  const inlines: NonTextInlineBox[] = []
  const resourceById = new Map((input.projection.document.resources ?? []).map((resource) => [resource.id, resource] as const))
  let lineY = TABLE_CELL_PADDING_Y_TWIPS
  let lineX = TABLE_CELL_PADDING_X_TWIPS
  let lineHeight = 0

  for (const block of cell.blocks) {
    if (block.kind !== 'paragraph') {
      continue
    }

    const blockFragmentStartIndex = fragments.length

    for (const run of block.runs) {
      const style = readRunStyle(block, run.properties)
      let runGraphemeIndex = 0

      for (const inline of run.inlines) {
        if (inline.kind === 'break') {
          if (inline.breakType === 'line') {
            lineY += Math.max(lineHeight, cssPxToTwips(16))
            lineX = TABLE_CELL_PADDING_X_TWIPS
            lineHeight = 0
          }
          continue
        }

        if (inline.kind !== 'text') {
          const geometry = resolveInlineObjectGeometry(inline, input.pageConfig, Math.max(lineHeight, cssPxToTwips(16)))

          if (lineX > TABLE_CELL_PADDING_X_TWIPS && lineX + geometry.width > TABLE_CELL_PADDING_X_TWIPS + maxTextWidth) {
            lineY += Math.max(lineHeight, geometry.height, 1)
            lineX = TABLE_CELL_PADDING_X_TWIPS
            lineHeight = 0
          }

          const inlineBox: NonTextInlineBox = Object.freeze({
            kind: 'inlineObject',
            inlineKind: inline.kind,
            payload: createInlineObjectPayload(inline, resourceById),
            pageIndex: 0,
            sectionId: section.id,
            blockId: block.id,
            runId: run.id,
            at: {
              sectionId: section.id,
              blockId: block.id,
              runId: run.id,
              graphemeIndex: runGraphemeIndex
            },
            x: lineX,
            y: lineY,
            width: geometry.width,
            height: geometry.height
          })

          inlines.push(inlineBox)
          lineX += inlineBox.width
          lineHeight = Math.max(lineHeight, inlineBox.height)
          continue
        }

        for (const segment of segmentTextForLayout(inline.text, runGraphemeIndex)) {
          const measuredSegments = measureTextSegmentForLayout({
            fontManager: input.fontManager,
            segment,
            style,
            maxWidth: maxTextWidth
          })

          for (const measured of measuredSegments) {
            if (lineX > TABLE_CELL_PADDING_X_TWIPS && lineX + measured.width > TABLE_CELL_PADDING_X_TWIPS + maxTextWidth) {
              lineY += Math.max(lineHeight, measured.height, 1)
              lineX = TABLE_CELL_PADDING_X_TWIPS
              lineHeight = 0
            }

            const fragment: TextFragment = Object.freeze({
              kind: 'textFragment',
              pageIndex: 0,
              sectionId: section.id,
              blockId: block.id,
              runId: run.id,
              text: measured.text,
              start: {
                sectionId: section.id,
                blockId: block.id,
                runId: run.id,
                graphemeIndex: measured.startGraphemeIndex
              },
              end: {
                sectionId: section.id,
                blockId: block.id,
                runId: run.id,
                graphemeIndex: measured.endGraphemeIndex
              },
              style: measured.style,
              x: lineX,
              y: lineY,
              width: measured.width,
              height: measured.height,
              baseline: lineY + measured.baseline,
              advanceTwips: measured.advanceTwips
            })

            fragments.push(fragment)
            lineX += measured.width
            lineHeight = Math.max(lineHeight, measured.height)
          }

          runGraphemeIndex = segment.endGraphemeIndex
        }
      }
    }

    if (fragments.length === blockFragmentStartIndex) {
      const emptyFragment = createEmptyTableCellFragment(block, section, input, lineX, lineY)

      if (emptyFragment !== undefined) {
        fragments.push(emptyFragment)
        lineHeight = Math.max(lineHeight, emptyFragment.height)
      }
    }

    if (fragments.length > blockFragmentStartIndex || inlines.some((inline) => inline.blockId === block.id)) {
      lineY += Math.max(lineHeight, cssPxToTwips(16))
      lineX = TABLE_CELL_PADDING_X_TWIPS
      lineHeight = 0
    }
  }

  return Object.freeze({
    fragments: Object.freeze(fragments),
    inlines: Object.freeze(inlines)
  })
}

/** 把单元格相对内容盒平移到页面绝对坐标。 */
function createPositionedTableCellContent<T extends TextFragment | NonTextInlineBox>(
  boxes: readonly T[],
  pageIndex: number,
  cellX: number,
  cellY: number,
  verticalOffset: number
): readonly T[] {
  return Object.freeze(boxes.map((box) => Object.freeze({
    ...box,
    pageIndex,
    x: cellX + box.x,
    y: cellY + box.y + verticalOffset,
    ...('baseline' in box ? { baseline: cellY + box.baseline + verticalOffset } : {})
  }) as unknown as T))
}

/** 把单元格相对文本片段平移到页面绝对坐标。 */
function createPositionedTableCellFragments(
  fragments: readonly TextFragment[],
  pageIndex: number,
  cellX: number,
  cellY: number,
  verticalOffset: number
): readonly TextFragment[] {
  return createPositionedTableCellContent(fragments, pageIndex, cellX, cellY, verticalOffset)
}

/** 把单元格相对行内对象平移到页面绝对坐标。 */
function createPositionedTableCellInlines(
  inlines: readonly NonTextInlineBox[],
  pageIndex: number,
  cellX: number,
  cellY: number,
  verticalOffset: number
): readonly NonTextInlineBox[] {
  return createPositionedTableCellContent(inlines, pageIndex, cellX, cellY, verticalOffset)
}

/** 为纯空表格段落补一个零宽文本锚点，保证 Enter 后空行可见且可定位。 */
function createEmptyTableCellFragment(
  paragraph: Paragraph,
  section: Section,
  input: LayoutInput,
  x: number,
  y: number
): TextFragment | undefined {
  if (!isVisuallyEmptyParagraph(paragraph)) {
    return undefined
  }

  const firstRun = paragraph.runs[0]

  if (firstRun === undefined) {
    return undefined
  }

  const measured = input.fontManager.measureText('', readRunStyle(paragraph, firstRun.properties))
  const height = cssPxToTwips(measured.heightCssPx)
  const baseline = cssPxToTwips(measured.baselineCssPx)

  return Object.freeze({
    kind: 'textFragment',
    pageIndex: 0,
    sectionId: section.id,
    blockId: paragraph.id,
    runId: firstRun.id,
    text: '',
    start: {
      sectionId: section.id,
      blockId: paragraph.id,
      runId: firstRun.id,
      graphemeIndex: 0
    },
    end: {
      sectionId: section.id,
      blockId: paragraph.id,
      runId: firstRun.id,
      graphemeIndex: 0
    },
    style: measured.resolvedFont,
    x,
    y,
    width: 0,
    height,
    baseline: y + baseline,
    advanceTwips: Object.freeze([0])
  })
}

/** 计算单元格内容块的竖向居中偏移；自适应高度时保持原有 padding 语义。 */
function resolveTableCellContentVerticalOffset(
  fragments: readonly TextFragment[],
  inlines: readonly NonTextInlineBox[],
  cellHeight: number
): number {
  const boxes = [...fragments, ...inlines]
  const firstBox = boxes[0]
  const lastBox = boxes[boxes.length - 1]

  if (firstBox === undefined || lastBox === undefined) {
    return 0
  }

  const contentTop = Math.min(...boxes.map((box) => box.y))
  const contentBottom = Math.max(...boxes.map((box) => box.y + box.height))
  const contentHeight = contentBottom - contentTop
  const centeredTop = Math.max(0, Math.round((cellHeight - contentHeight) / 2))

  return centeredTop - contentTop
}

/** 读取表格列宽，未声明时平均分配正文宽度。 */
export function resolveTableGrid(table: Table, pageConfig: PageConfig): readonly number[] {
  if (table.grid !== undefined && table.grid.length > 0) {
    return table.grid
  }

  const columnCount = Math.max(1, table.rows[0]?.cells.reduce((count, cell) => count + (cell.gridSpan ?? 1), 0) ?? 1)
  const columnWidth = Math.min(DEFAULT_TABLE_COLUMN_WIDTH_TWIPS, Math.floor(pageConfig.contentWidthTwips / columnCount))

  return Array.from({ length: columnCount }, () => columnWidth)
}

/** 按列索引和 span 计算单元格宽度。 */
function sumGridWidth(grid: readonly number[], startIndex: number, gridSpan: number): number {
  return grid.slice(startIndex, startIndex + gridSpan).reduce((sum, width) => sum + width, 0)
    || grid[startIndex]
    || cssPxToTwips(96)
}

/** 读取表格行高，缺失时回退到更高的默认行高。 */
export function resolveTableRowHeight(row: Table['rows'][number]): number {
  const value = row.properties?.heightTwips

  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : DEFAULT_TABLE_ROW_HEIGHT_TWIPS
}

function sumRowHeightsInRange(
  rowHeights: readonly number[],
  startInclusive: number,
  endExclusive: number
): number {
  return rowHeights.slice(startInclusive, endExclusive).reduce((sum, height) => sum + height, 0)
}

/** 读取单元格纯文本。 */
function readTableCellText(cell: TableCell): string {
  return cell.blocks
    .flatMap((block) => block.kind === 'paragraph' ? block.runs : [])
    .flatMap((run) => run.inlines)
    .filter((inline): inline is Extract<Inline, { kind: 'text' }> => inline.kind === 'text')
    .map((inline) => inline.text)
    .join('')
}

/** 读取单元格首个可编辑文本位置。 */
function readTableCellTextPosition(sectionId: string, cell: TableCell): TextPosition | undefined {
  for (const block of cell.blocks) {
    if (block.kind !== 'paragraph') {
      continue
    }

    for (const run of block.runs) {
      if (run.inlines.some((inline) => inline.kind === 'text')) {
        return {
          sectionId,
          blockId: block.id,
          runId: run.id,
          graphemeIndex: 0
        }
      }

      return {
        sectionId,
        blockId: block.id,
        runId: run.id,
        graphemeIndex: 0
      }
    }
  }

  return undefined
}

/** 只有所有 inline 都是空文本时，才把段落视为需要补可见空行的“纯空段落”。 */
function isVisuallyEmptyParagraph(paragraph: Paragraph): boolean {
  for (const run of paragraph.runs) {
    for (const inline of run.inlines) {
      if (inline.kind !== 'text' || inline.text.length > 0) {
        return false
      }
    }
  }

  return true
}


/** 按整行分页排布表格块并写入当前页 blocks。 */
export function layoutTable(
  table: Table,
  section: Section,
  cursor: LayoutCursor,
  pages: MutablePageBox[],
  pageConfig: PageConfig,
  input: LayoutInput
): void {
  flushLine(cursor)

  const grid = resolveTableGrid(table, pageConfig)
  const rowPlans = table.rows.map((row) => createTableRowLayoutPlan(row, section, grid, input))
  const rowHeights = table.rows.map((row, rowIndex) =>
    Math.max(resolveTableRowHeight(row), rowPlans[rowIndex]?.height ?? 0)
  )
  const tableWidth = grid.reduce((sum, width) => sum + width, 0)

  if (table.rows.length === 0) {
    cursor.page.blocks.push(createTableBox({
      table,
      section,
      grid,
      rowPlans,
      rowHeights,
      tableX: cursor.page.contentRect.x,
      tableY: cursor.y,
      tableWidth,
      startRowIndex: 0,
      endRowIndex: 0,
      pageIndex: cursor.page.pageIndex
    }))
    cursor.x = cursor.page.contentRect.x
    return
  }

  let rowIndex = 0

  while (rowIndex < table.rows.length) {
    const pageBottom = cursor.page.contentRect.y + cursor.page.contentRect.height
    const firstRowHeight = rowHeights[rowIndex] ?? resolveTableRowHeight(table.rows[rowIndex]!)

    if (cursor.y + firstRowHeight > pageBottom && cursor.y > cursor.page.contentRect.y) {
      startNewPage(cursor, pages, pageConfig)
      assignPageSectionBoundary(cursor.page, section, cursor.sectionContext)
      continue
    }

    const startRowIndex = rowIndex
    const tableY = cursor.y
    let tableHeight = 0

    while (rowIndex < table.rows.length) {
      const rowHeight = rowHeights[rowIndex] ?? resolveTableRowHeight(table.rows[rowIndex]!)
      const nextHeight = tableHeight + rowHeight
      const rowFitsCurrentPage = tableY + nextHeight <= pageBottom

      if (!rowFitsCurrentPage && rowIndex > startRowIndex) {
        break
      }

      tableHeight = nextHeight
      rowIndex += 1

      if (!rowFitsCurrentPage) {
        break
      }
    }

    cursor.page.blocks.push(createTableBox({
      table,
      section,
      grid,
      rowPlans,
      rowHeights,
      tableX: cursor.page.contentRect.x,
      tableY,
      tableWidth,
      startRowIndex,
      endRowIndex: rowIndex,
      pageIndex: cursor.page.pageIndex
    }))
    cursor.y = tableY + tableHeight
    cursor.x = cursor.page.contentRect.x

    if (rowIndex < table.rows.length) {
      startNewPage(cursor, pages, pageConfig)
      assignPageSectionBoundary(cursor.page, section, cursor.sectionContext)
    }
  }
}
