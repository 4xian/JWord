/**
 * @fileoverview 职责: 用真实浏览器冻结 Gate 4 表格 UI、demo adapter 与撤销重做的最小验收路径。
 * 边界: 只覆盖插入表格、单元格文本编辑、行列增删、合并与 undo/redo，不验证后续跨页布局或 cell hit-test。
 * 协作: examples/vanilla/src/main.ts、demo table support、packages/ui/src/table/* 与现有 toolbar history 控件。
 * 约束: 断言必须来自真实 DOM 或 editor.getProjection()，不读取 controller 私有状态。
 * Specs: docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md Step 4.7。
 */
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import type { Locator } from '@playwright/test'

test.describe.configure({ mode: 'serial' })

test('Gate 4 table toolbar inserts edits and supports undo redo', async ({ page }) => {
  await page.goto('/')
  await waitForTableDemoReady(page)

  const insertTrigger = page.locator('[data-jword-table-insert-trigger="true"]')
  const insertPreviewLabel = page.locator('[data-jword-table-insert-preview-label="true"]')
  const insertPreviewCell2x2 = page.locator('[data-jword-table-preview-cell="true"][data-jword-rows="2"][data-jword-columns="2"]')
  const customSizeButton = page.locator('[data-jword-table-custom-size="true"]')
  const customSizeDialog = page.locator('[data-jword-table-custom-size-dialog="true"]')
  const rowsInput = page.locator('[data-jword-table-insert-rows="true"]')
  const columnsInput = page.locator('[data-jword-table-insert-columns="true"]')
  const customSizeCancelButton = page.locator('[data-jword-table-custom-size-cancel="true"]')
  const topAnchor = page.locator('[data-jword-table-anchor="top"]')
  const insertRowAfterButton = page.locator('[data-jword-table-action="insert-row-after"]')
  const insertColumnAfterButton = page.locator('[data-jword-table-action="insert-column-after"]')
  const deleteRowButton = page.locator('[data-jword-table-action="delete-row"]')
  const deleteColumnButton = page.locator('[data-jword-table-action="delete-column"]')
  const mergeRightButton = page.locator('[data-jword-table-action="merge-right"]')
  const undoButton = page.getByRole('button', { name: '撤销' })
  const redoButton = page.getByRole('button', { name: '重做' })

  await clickToolbarAction(insertTrigger)
  await insertPreviewCell2x2.hover()
  await expect(insertPreviewLabel).toContainText('2 x 2')
  await clickToolbarAction(insertPreviewCell2x2)

  await expect.poll(() => readFirstTableState(page)).toMatchObject({
    rowCount: 2,
    columnCount: 2,
    firstRowCellCount: 2,
    firstCellGridSpan: 1,
    firstCellText: ''
  })

  await clickToolbarAction(insertTrigger)
  await clickToolbarAction(customSizeButton)
  await expect(customSizeDialog).toBeVisible()
  await expectTableDialogAnchoredToEditor(page, customSizeDialog)
  await rowsInput.fill('3')
  await columnsInput.fill('4')
  await clickToolbarAction(customSizeCancelButton)
  await expect(customSizeDialog).toBeHidden()

  await expect.poll(() => {
    return page.evaluate(() => window.__jwordDemo?.table.setCellText(0, 0, '单元格A1') ?? false)
  }).toBe(true)

  await expect.poll(() => readFirstTableState(page)).toMatchObject({
    firstCellText: '单元格A1'
  })

  await selectDemoTableCell(page, 0, 0)
  await clickToolbarAction(topAnchor)
  await expect(page.locator('[data-jword-table-summary="true"]')).toBeHidden()
  await clickToolbarAction(insertRowAfterButton)
  await expect.poll(() => readFirstTableState(page)).toMatchObject({
    rowCount: 3
  })

  await clickToolbarAction(topAnchor)
  await clickToolbarAction(insertColumnAfterButton)
  await expect.poll(() => readFirstTableState(page)).toMatchObject({
    columnCount: 3
  })

  await clickToolbarAction(topAnchor)
  await clickToolbarAction(deleteRowButton)
  await expect.poll(() => readFirstTableState(page)).toMatchObject({
    rowCount: 2
  })

  await selectDemoTableCell(page, 0, 0)
  await clickToolbarAction(topAnchor)
  await clickToolbarAction(deleteColumnButton)
  await expect.poll(() => readFirstTableState(page)).toMatchObject({
    columnCount: 2
  })

  await selectDemoTableCell(page, 0, 0)
  await clickToolbarAction(topAnchor)
  await expect(page.locator('[data-jword-table-scope]')).toHaveCount(0)
  await expect(page.locator('[data-jword-table-border-preset="true"]')).toHaveCount(0)
  await expect(page.locator('[data-jword-table-apply-border="true"]')).toHaveCount(0)
  await clickToolbarAction(mergeRightButton)
  await expect.poll(() => readFirstTableState(page)).toMatchObject({
    firstRowCellCount: 1,
    firstCellGridSpan: 2
  })

  await undoButton.click()
  await expect.poll(() => readFirstTableState(page)).toMatchObject({
    firstRowCellCount: 2,
    firstCellGridSpan: 1,
    firstCellBorderColor: null
  })

  await redoButton.click()
  await expect.poll(() => readFirstTableState(page)).toMatchObject({
    firstRowCellCount: 1,
    firstCellGridSpan: 2,
    firstCellBorderColor: null
  })
})

test('Gate 4 table click resize and context actions keep table editable', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/')
  await waitForTableDemoReady(page)

  const insertTrigger = page.locator('[data-jword-table-insert-trigger="true"]')
  const insertPreviewCell2x2 = page.locator('[data-jword-table-preview-cell="true"][data-jword-rows="2"][data-jword-columns="2"]')

  await clickToolbarAction(insertTrigger)
  await clickToolbarAction(insertPreviewCell2x2)

  const firstCellPoint = await readTableCellViewportPoint(page, 0, 0)

  await page.mouse.click(firstCellPoint.x, firstCellPoint.y)

  await expect.poll(() => readCurrentCaretSnapshot(page)).toMatchObject({
    caretHeight: expect.any(Number)
  })

  const beforeResize = await readFirstTableState(page)

  await expect(page.locator('[data-jword-table-resize-handle-segment]')).toHaveCount(0)
  await dragResizeHandleWithPreview(page, '[data-jword-table-resize-handle="column-0"]', 24, 0, 'column')
  await dragResizeHandleWithPreview(page, '[data-jword-table-resize-handle="row-0"]', 0, 16, 'row')
  await dragResizeHandle(page, '[data-jword-table-resize-handle="column-0"]', 24, 0)
  await dragResizeHandle(page, '[data-jword-table-resize-handle="row-0"]', 0, 16)

  await expect.poll(() => readFirstTableState(page)).toMatchObject({
    rowCount: 2,
    columnCount: 2
  })
  await expect.poll(async () => {
    const state = await readFirstTableState(page)

    return {
      widthGrew: state !== null
        && beforeResize !== null
        && (state.firstColumnWidthTwips ?? 0) > (beforeResize.firstColumnWidthTwips ?? 0),
      heightGrew: state !== null
        && beforeResize !== null
        && (state.firstRowHeightTwips ?? 0) > (beforeResize.firstRowHeightTwips ?? 0)
    }
  }).toMatchObject({
    widthGrew: true,
    heightGrew: true
  })

  await page.mouse.click(firstCellPoint.x, firstCellPoint.y, {
    button: 'right'
  })
  await expect(page.locator('.jw-context-menu:visible')).toHaveCount(1)
  await expect(page.locator('[data-jword-context-action="format.clear"]:visible')).toHaveCount(0)
  await clickToolbarAction(page.locator('[data-jword-context-action="table.insert-row-after"]'))
  await expect.poll(() => readFirstTableState(page)).toMatchObject({
    rowCount: 3
  })

  await page.mouse.click(firstCellPoint.x, firstCellPoint.y, {
    button: 'right'
  })
  await clickToolbarAction(page.locator('[data-jword-context-action="table.insert-column-after"]'))
  await expect.poll(() => readFirstTableState(page)).toMatchObject({
    columnCount: 3
  })

  await page.mouse.click(firstCellPoint.x, firstCellPoint.y, {
    button: 'right'
  })
  await clickToolbarAction(page.locator('[data-jword-context-action="table.merge-right"]'))
  await expect.poll(() => readFirstTableState(page)).toMatchObject({
    firstRowCellCount: 2,
    firstCellGridSpan: 2
  })
})

/** 等待 demo、toolbar 与 table UI 都完成挂载。 */
async function waitForTableDemoReady(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__jwordDemo !== undefined)
  await expect(page.locator('[data-jword-toolbar]')).toBeVisible()
  await expect(page.locator('[data-jword-table-toolbar="true"]')).toBeVisible()
}

/** 对当前 table toolbar 内的无导航按钮使用稳定点击。 */
async function clickToolbarAction(locator: Locator): Promise<void> {
  await locator.click({
    noWaitAfter: true
  })
}

/** 拖拽表格 resize handle。 */
async function dragResizeHandle(
  page: Page,
  selector: string,
  deltaX: number,
  deltaY: number
): Promise<void> {
  const handle = page.locator(selector)
  const box = await handle.boundingBox()

  if (box === null) {
    throw new Error(`Missing resize handle: ${selector}`)
  }

  const startPoint = readResizeHandleStartPoint(selector, box)

  await page.mouse.move(startPoint.x, startPoint.y)
  await page.mouse.down()
  await page.mouse.move(startPoint.x + deltaX, startPoint.y + deltaY, {
    steps: 8
  })
  await page.mouse.up()
}

/** 拖拽 resize handle 时检查蓝色预览线已出现。 */
async function dragResizeHandleWithPreview(
  page: Page,
  selector: string,
  deltaX: number,
  deltaY: number,
  axis: 'column' | 'row'
): Promise<void> {
  const handle = page.locator(selector)
  const preview = page.locator('[data-jword-table-resize-preview="true"]')
  const box = await handle.boundingBox()

  if (box === null) {
    throw new Error(`Missing resize handle: ${selector}`)
  }

  const startPoint = readResizeHandleStartPoint(selector, box, axis)

  await page.mouse.move(startPoint.x, startPoint.y)
  await page.mouse.down()
  await page.mouse.move(startPoint.x + deltaX, startPoint.y + deltaY, {
    steps: 6
  })
  await expect(preview).toBeVisible()
  await expect(preview).toHaveAttribute('data-jword-table-resize-preview-axis', axis)

  const previewBox = await preview.boundingBox()

  if (previewBox === null) {
    throw new Error('Missing resize preview line.')
  }

  if (axis === 'column') {
    expect(previewBox.width).toBeLessThanOrEqual(4)
    expect(previewBox.height).toBeGreaterThan(20)
  } else {
    expect(previewBox.height).toBeLessThanOrEqual(4)
    expect(previewBox.width).toBeGreaterThan(20)
  }

  await page.mouse.up()
  await expect(preview).toBeHidden()
}

/** 为行列 resize handle 选择一个尽量避开交叉区的拖拽起点。 */
function readResizeHandleStartPoint(
  selector: string,
  box: {
    x: number
    y: number
    width: number
    height: number
  },
  axis?: 'column' | 'row'
): {
  x: number
  y: number
} {
  const resolvedAxis = axis ?? (selector.includes('column-') ? 'column' : 'row')

  if (resolvedAxis === 'column') {
    return {
      x: box.x + box.width / 2,
      y: box.y + Math.min(4, box.height / 4)
    }
  }

  return {
    x: box.x + Math.min(4, box.width / 4),
    y: box.y + box.height / 2
  }
}

/** 通过 demo hook 把选区重新放回指定单元格。 */
async function selectDemoTableCell(page: Page, rowIndex: number, columnIndex: number): Promise<void> {
  await expect.poll(() => {
    return page.evaluate(({ nextRowIndex, nextColumnIndex }) => {
      return window.__jwordDemo?.table.selectCell(nextRowIndex, nextColumnIndex) ?? false
    }, {
      nextRowIndex: rowIndex,
      nextColumnIndex: columnIndex
    })
  }).toBe(true)

  await expect.poll(() => {
    return page.evaluate(() => window.__jwordDemo?.table.readActiveTarget())
  }).not.toBeNull()

  const point = await readTableCellViewportPoint(page, rowIndex, columnIndex)

  await page.mouse.click(point.x, point.y)
  await expect(page.locator('[data-jword-table-anchor="top"]')).toBeVisible()
  await expect(page.locator('[data-jword-table-quick-tools="true"]')).toBeHidden()
}

/** 确认自定义尺寸弹层以编辑器区域而不是全屏视口为定位基准。 */
async function expectTableDialogAnchoredToEditor(page: Page, dialog: Locator): Promise<void> {
  const editorBox = await page.locator('#jword-editor').boundingBox()
  const dialogBox = await dialog.boundingBox()
  const viewport = page.viewportSize()

  expect(editorBox).not.toBeNull()
  expect(dialogBox).not.toBeNull()
  expect(viewport).not.toBeNull()

  if (editorBox === null || dialogBox === null || viewport === null) {
    throw new Error('Missing editor or dialog geometry.')
  }

  expect(Math.abs(dialogBox.x - editorBox.x)).toBeLessThanOrEqual(2)
  expect(Math.abs(dialogBox.y - editorBox.y)).toBeLessThanOrEqual(2)
  expect(Math.abs(dialogBox.width - editorBox.width)).toBeLessThanOrEqual(2)
  expect(dialogBox.width).toBeLessThan(viewport.width)
  expect(dialogBox.height).toBeLessThan(viewport.height)
}

/** 读取指定单元格在视口内的点击点。 */
async function readTableCellViewportPoint(
  page: Page,
  rowIndex: number,
  columnIndex: number
): Promise<{
  x: number
  y: number
}> {
  return page.evaluate(({ nextRowIndex, nextColumnIndex }) => {
    const editor = window.__jwordDemo?.editor
    const editorHost = document.querySelector<HTMLElement>('#jword-editor')
    const canvasContainer = editorHost?.querySelector<HTMLElement>('[data-jword-canvas-container]')
    const layout = editor?.getLayout()
    const pageBox = layout?.pages[0]
    const table = pageBox?.blocks.find((block) => block.kind === 'table')
    const row = table?.kind === 'table' ? table.rows[nextRowIndex] : undefined
    const cell = row?.cells[nextColumnIndex]
    const pageElement = canvasContainer?.querySelector<HTMLElement>('[data-jword-page="0"]') ?? null

    if (editor === undefined || editorHost === null || canvasContainer === null || pageBox === undefined || table?.kind !== 'table' || cell === undefined || pageElement === null) {
      throw new Error('Unable to resolve table cell viewport point.')
    }

    const pageRect = pageElement.getBoundingClientRect()
    const scale = pageRect.width / (pageBox.width / 1440 * 96)
    const toPx = (twips: number) => twips / 1440 * 96 * scale

    return {
      x: pageRect.left + toPx(cell.x - pageBox.x + cell.width / 2),
      y: pageRect.top + toPx(cell.y - pageBox.y + cell.height / 2)
    }
  }, {
    nextRowIndex: rowIndex,
    nextColumnIndex: columnIndex
  })
}

/** 读取当前光标快照，确认表格点击后已有有效 caret。 */
async function readCurrentCaretSnapshot(page: Page): Promise<{
  blockId: string | null
  runId: string | null
  caretHeight: number | null
} | null> {
  return page.evaluate(() => {
    const editor = window.__jwordDemo?.editor
    const selection = editor?.getSelection()
    const focus = selection?.focus
    const position = focus === undefined ? undefined : editor?.resolveTextPosition(focus)
    const caretRect = focus === undefined ? undefined : editor?.getCaretRect(focus)

    if (editor === undefined || selection === null || focus === undefined || position === undefined || caretRect === undefined) {
      return null
    }

    return {
      blockId: position.blockId,
      runId: position.runId,
      caretHeight: caretRect.height
    }
  })
}

/** 读取当前首个表格的最小投影快照。 */
async function readFirstTableState(page: Page): Promise<{
  rowCount: number
  columnCount: number
  firstRowCellCount: number
  firstCellGridSpan: number
  firstCellText: string
  firstCellBorderColor: string | null
  firstColumnWidthTwips: number | null
  firstRowHeightTwips: number | null
} | null> {
  return page.evaluate(() => {
    const projection = window.__jwordDemo?.editor.getProjection()
    const firstSection = projection?.document.sections[0]
    const table = firstSection?.blocks.find((block) => block.kind === 'table')

    if (table === undefined || table?.kind !== 'table') {
      return null
    }

    const firstRow = table.rows[0]
    const firstCell = firstRow?.cells[0]
    const firstParagraph = firstCell?.blocks[0]
    const firstRun = firstParagraph?.kind === 'paragraph' ? firstParagraph.runs[0] : undefined
    const firstCellText = firstRun?.inlines
      .map((inline) => inline.kind === 'text' ? inline.text : '')
      .join('') ?? ''
    const firstCellBorderColor = typeof firstCell?.border?.color === 'string'
      ? firstCell.border.color
      : null
    const firstRowCellCount = firstRow?.cells.length ?? 0
    const firstCellGridSpan = firstCell?.gridSpan ?? 1
    const columnCount = table.rows.reduce((count, row) => {
      return Math.max(count, row.cells.reduce((rowCount, cell) => rowCount + (cell.gridSpan ?? 1), 0))
    }, 0)

    return {
      rowCount: table.rows.length,
      columnCount,
      firstRowCellCount,
      firstCellGridSpan,
      firstCellText,
      firstCellBorderColor,
      firstColumnWidthTwips: table.grid?.[0] ?? null,
      firstRowHeightTwips: typeof table.rows[0]?.properties?.heightTwips === 'number'
        ? table.rows[0].properties.heightTwips
        : null
    }
  })
}
