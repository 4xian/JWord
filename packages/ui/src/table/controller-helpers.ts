/**
 * 职责：承载表格 controller 的 DOM 辅助、几何换算、右键菜单和剪贴板桥接函数。
 * 边界：不保存 controller 状态，不直接执行 editor 命令。
 * 协作模块：table controller 调用这些纯辅助函数，table state 提供按钮可用态判断。
 * 性能/安全约束：只做轻量 DOM 和布局读写，不引入框架依赖，不绕过 editor transaction。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import {
  cssPxToTwips,
  createSelectionState,
  twipsToCssPx,
  type DocumentLayout,
  type Editor,
  type LayoutBox,
  type SelectionState
} from '@4xian/jword-core'
import type { JWordTablePanelElements, JWordTableSelectionTarget } from '../types'
import {
  readJWordUiText,
  resolveJWordUiI18n,
  type ResolvedJWordUiI18n
} from '../i18n'
import {
  canDeleteTargetColumn,
  canDeleteTargetRow,
  canMergeCellWithRight,
  normalizeTableDimension
} from './state'

export type TableLayoutBox = Extract<DocumentLayout['pages'][number]['blocks'][number], { kind: 'table' }>

export interface TableContextMenuElements {
  readonly root: HTMLElement
  readonly copyButton: HTMLButtonElement
  readonly cutButton: HTMLButtonElement
  readonly pasteButton: HTMLButtonElement
  readonly insertRowBeforeButton: HTMLButtonElement
  readonly insertRowAfterButton: HTMLButtonElement
  readonly deleteRowButton: HTMLButtonElement
  readonly insertColumnBeforeButton: HTMLButtonElement
  readonly insertColumnAfterButton: HTMLButtonElement
  readonly deleteColumnButton: HTMLButtonElement
  readonly mergeRightButton: HTMLButtonElement
}

export interface TableResizePreviewGeometry {
  readonly axis: 'column' | 'row'
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

interface TablePointHit {
  readonly target: JWordTableSelectionTarget
  readonly selection: SelectionState
}

export interface ClipboardBuffer {
  plainText: string
  htmlText: string
}

/** 把表格辅助层定位到当前命中的表格附近。 */
export function syncOverlay(
  dom: JWordTablePanelElements,
  geometry: Readonly<{
    left: number
    top: number
    width: number
    height: number
  }> | null,
  targetAvailable: boolean
): void {
  dom.overlay.hidden = !targetAvailable || geometry === null

  if (!targetAvailable || geometry === null) {
    return
  }

  dom.overlay.style.left = `${geometry.left}px`
  dom.overlay.style.top = `${geometry.top}px`
  dom.overlay.style.width = `${geometry.width}px`
  dom.overlay.style.height = `${geometry.height}px`
}

/** 解析当前表格在 editorHost 里的几何。 */
export function resolveTableOverlayGeometry(
  layout: DocumentLayout,
  editorHost: HTMLElement,
  target: JWordTableSelectionTarget
): Readonly<{
  left: number
  top: number
  width: number
  height: number
}> | null {
  const canvasContainer = editorHost.querySelector<HTMLElement>('[data-jword-canvas-container]')
  if (canvasContainer === null) {
    return null
  }

  const tableBox = findTableBox(layout, target.tableId)
  if (tableBox === null) {
    return null
  }

  const pageElement = canvasContainer.querySelector<HTMLElement>(`[data-jword-page="${tableBox.pageIndex}"]`)
  const page = layout.pages[tableBox.pageIndex]
  if (pageElement === null || page === undefined) {
    return null
  }

  const scale = resolvePageScale(pageElement, page)
  const left = pageElement.offsetLeft + twipsToCssPx(tableBox.x - page.x, scale)
  const top = pageElement.offsetTop + twipsToCssPx(tableBox.y - page.y, scale)
  const width = twipsToCssPx(tableBox.width, scale)
  const height = twipsToCssPx(tableBox.height, scale)

  return {
    left,
    top,
    width,
    height
  }
}

/** 读取表格 box。 */
export function findTableBox(layout: DocumentLayout, tableId: string): TableLayoutBox | null {
  for (const page of layout.pages) {
    const table = page.blocks.find((block) => block.kind === 'table' && block.tableId === tableId)

    if (table !== undefined && table.kind === 'table') {
      return table
    }
  }

  return null
}

/** 读取预览网格上的行列值。 */
export function readPreviewDimension(value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback
  }

  return normalizeTableDimension(value, fallback)
}

/** 创建表格专用右键菜单。 */
export function createTableContextMenu(
  host: HTMLElement,
  i18n: ResolvedJWordUiI18n = resolveJWordUiI18n()
): TableContextMenuElements {
  const root = document.createElement('div')
  const group = document.createElement('div')
  const editGroup = document.createElement('div')
  const structureGroup = document.createElement('div')
  const copyButton = createContextMenuButton('clipboard.copy', readTableText(i18n, 'copy'))
  const cutButton = createContextMenuButton('clipboard.cut', readTableText(i18n, 'cut'))
  const pasteButton = createContextMenuButton('clipboard.paste', readTableText(i18n, 'paste'))
  const insertRowBeforeButton = createContextMenuButton('table.insert-row-before', readTableText(i18n, 'insertRowBefore'))
  const insertRowAfterButton = createContextMenuButton('table.insert-row-after', readTableText(i18n, 'insertRowAfter'))
  const deleteRowButton = createContextMenuButton('table.delete-row', readTableText(i18n, 'deleteRow'))
  const insertColumnBeforeButton = createContextMenuButton('table.insert-column-before', readTableText(i18n, 'insertColumnBefore'))
  const insertColumnAfterButton = createContextMenuButton('table.insert-column-after', readTableText(i18n, 'insertColumnAfter'))
  const deleteColumnButton = createContextMenuButton('table.delete-column', readTableText(i18n, 'deleteColumn'))
  const mergeRightButton = createContextMenuButton('table.merge-right', readTableText(i18n, 'mergeRight'))

  root.className = 'jw-context-menu'
  root.hidden = true
  root.style.zIndex = '120'
  group.className = 'jw-context-menu__group'
  editGroup.className = 'jw-context-menu__group'
  structureGroup.className = 'jw-context-menu__group'
  group.append(copyButton, cutButton, pasteButton)
  editGroup.append(insertRowBeforeButton, insertRowAfterButton, deleteRowButton)
  structureGroup.append(insertColumnBeforeButton, insertColumnAfterButton, deleteColumnButton, mergeRightButton)
  root.append(group, editGroup, structureGroup)
  host.append(root)

  return {
    root,
    copyButton,
    cutButton,
    pasteButton,
    insertRowBeforeButton,
    insertRowAfterButton,
    deleteRowButton,
    insertColumnBeforeButton,
    insertColumnAfterButton,
    deleteColumnButton,
    mergeRightButton
  }
}

/** 动态刷新表格右键菜单文案。 */
export function localizeTableContextMenu(menu: TableContextMenuElements, i18n: ResolvedJWordUiI18n): void {
  setContextMenuButtonText(menu.copyButton, readTableText(i18n, 'copy'))
  setContextMenuButtonText(menu.cutButton, readTableText(i18n, 'cut'))
  setContextMenuButtonText(menu.pasteButton, readTableText(i18n, 'paste'))
  setContextMenuButtonText(menu.insertRowBeforeButton, readTableText(i18n, 'insertRowBefore'))
  setContextMenuButtonText(menu.insertRowAfterButton, readTableText(i18n, 'insertRowAfter'))
  setContextMenuButtonText(menu.deleteRowButton, readTableText(i18n, 'deleteRow'))
  setContextMenuButtonText(menu.insertColumnBeforeButton, readTableText(i18n, 'insertColumnBefore'))
  setContextMenuButtonText(menu.insertColumnAfterButton, readTableText(i18n, 'insertColumnAfter'))
  setContextMenuButtonText(menu.deleteColumnButton, readTableText(i18n, 'deleteColumn'))
  setContextMenuButtonText(menu.mergeRightButton, readTableText(i18n, 'mergeRight'))
}

/** 创建表格行列尺寸拖拽 handle 容器。 */
export function createResizeHandlesLayer(host: HTMLElement): HTMLElement {
  const layer = document.createElement('div')
  const mountHost = host.querySelector<HTMLElement>('[data-jword-canvas-container]') ?? host

  layer.className = 'jw-table-panel__overlay'
  layer.setAttribute('data-jword-table-resize-layer', 'true')
  layer.hidden = true
  mountHost.append(layer)

  return layer
}

/** 创建拖拽时显示的蓝色预览线。 */
export function createResizePreviewLine(host: HTMLElement): HTMLElement {
  const preview = document.createElement('div')
  const mountHost = host.querySelector<HTMLElement>('[data-jword-canvas-container]') ?? host

  preview.className = 'jw-table-panel__resize-preview'
  preview.setAttribute('data-jword-table-resize-preview', 'true')
  preview.hidden = true
  mountHost.append(preview)

  return preview
}

/** 同步表格右键菜单按钮可用态。 */
export function syncTableContextMenu(
  menu: TableContextMenuElements,
  contextTarget: JWordTableSelectionTarget | null,
  liveTarget: JWordTableSelectionTarget | null,
  busy: boolean
): void {
  const target = contextTarget ?? liveTarget

  menu.copyButton.disabled = busy || target === null
  menu.cutButton.disabled = busy || target === null
  menu.pasteButton.disabled = busy
  menu.insertRowBeforeButton.disabled = busy || target === null
  menu.insertRowAfterButton.disabled = busy || target === null
  menu.deleteRowButton.disabled = busy || !canDeleteTargetRow(target)
  menu.insertColumnBeforeButton.disabled = busy || target === null
  menu.insertColumnAfterButton.disabled = busy || target === null
  menu.deleteColumnButton.disabled = busy || !canDeleteTargetColumn(target)
  menu.mergeRightButton.disabled = busy || !canMergeCellWithRight(target)
}

/** 同步表格 resize handles。 */
export function syncResizeHandles(
  layer: HTMLElement,
  geometry: Readonly<{
    left: number
    top: number
    width: number
    height: number
  }> | null,
  table: TableLayoutBox | null,
  targetAvailable: boolean,
  busy: boolean,
  onPointerDown: (event: PointerEvent) => void,
  i18n: ResolvedJWordUiI18n = resolveJWordUiI18n()
): void {
  layer.hidden = !targetAvailable || geometry === null || table === null
  layer.replaceChildren()

  if (!targetAvailable || geometry === null || table === null || busy) {
    return
  }

  const scaleX = table.width === 0 ? 1 : geometry.width / table.width
  const scaleY = table.height === 0 ? 1 : geometry.height / table.height

  let columnOffset = 0
  for (let columnIndex = 0; columnIndex < table.grid.length; columnIndex += 1) {
    const width = table.grid[columnIndex] ?? 0
    columnOffset += width

    if (columnIndex >= table.grid.length - 1) {
      continue
    }

    const handle = document.createElement('button')

    handle.type = 'button'
    handle.className = 'jw-table-panel__anchor jw-table-panel__anchor--resize-column'
    handle.style.left = `${geometry.left + Math.round(columnOffset * scaleX) - 1}px`
    handle.style.top = `${geometry.top}px`
    handle.style.width = '2px'
    handle.style.height = `${Math.max(6, Math.round(geometry.height))}px`
    handle.style.borderRadius = '0'
    handle.style.cursor = 'col-resize'
    handle.setAttribute('aria-label', readTableText(i18n, 'resizeColumn')
      .replace('{index}', String(columnIndex + 1)))
    handle.setAttribute('data-jword-table-resize-handle', `column-${columnIndex}`)
    handle.addEventListener('pointerdown', onPointerDown)
    layer.append(handle)
  }

  for (let rowIndex = 0; rowIndex < table.rows.length - 1; rowIndex += 1) {
    const row = table.rows[rowIndex]

    if (row === undefined) {
      continue
    }

    const nextTop = geometry.top + Math.round((row.y + row.height - table.y) * scaleY)
    const handle = document.createElement('button')
    handle.type = 'button'
    handle.className = 'jw-table-panel__anchor jw-table-panel__anchor--resize-row'
    handle.style.left = `${geometry.left}px`
    handle.style.top = `${nextTop - 1}px`
    handle.style.width = `${Math.max(6, Math.round(geometry.width))}px`
    handle.style.height = '2px'
    handle.style.borderRadius = '0'
    handle.style.cursor = 'row-resize'
    handle.setAttribute('aria-label', readTableText(i18n, 'resizeRow')
      .replace('{index}', String(rowIndex + 1)))
    handle.setAttribute('data-jword-table-resize-handle', `row-${rowIndex}`)
    handle.addEventListener('pointerdown', onPointerDown)
    layer.append(handle)
  }
}

/** 同步蓝色 resize 预览线。 */
export function syncResizePreview(
  preview: HTMLElement,
  geometry: TableResizePreviewGeometry | null
): void {
  preview.hidden = geometry === null

  if (geometry === null) {
    preview.removeAttribute('data-jword-table-resize-preview-axis')
    return
  }

  preview.setAttribute('data-jword-table-resize-preview-axis', geometry.axis)
  preview.style.left = `${geometry.left}px`
  preview.style.top = `${geometry.top}px`
  preview.style.width = `${geometry.width}px`
  preview.style.height = `${geometry.height}px`
}

/** 从鼠标事件命中表格单元格。 */
export function hitTestTablePoint(
  editor: Editor,
  event: MouseEvent
): TablePointHit | null {
  const pageMetrics = resolveMousePageMetrics(editor, event)

  if (pageMetrics === null) {
    return null
  }

  const anchor = editor.hitTest({
    pageIndex: pageMetrics.pageIndex,
    x: pageMetrics.xTwips,
    y: pageMetrics.yTwips
  })

  if (anchor === undefined) {
    return null
  }

  const position = editor.resolveTextPosition(anchor)
  const target = resolveTargetByPosition(editor.getProjection(), position.blockId, position.runId)

  if (target === null) {
    return null
  }

  const selection = createSelectionState(anchor, anchor)

  return {
    target,
    selection
  }
}

/** 读取 editor mount 后的 hidden textarea。 */
export function requireHiddenTextarea(editorHost: HTMLElement): HTMLTextAreaElement {
  const textarea = editorHost.querySelector('[data-jword-hidden-textarea]')

  if (!(textarea instanceof HTMLTextAreaElement)) {
    throw new Error('table controller 需要已挂载的 hidden textarea。')
  }

  return textarea
}

/** 创建最小 clipboardData 对象。 */
export function createClipboardData(buffer: ClipboardBuffer): Readonly<{
  getData(type: string): string
  setData(type: string, value: string): void
}> {
  return {
    getData(type: string): string {
      if (type === 'text/plain') {
        return buffer.plainText
      }

      if (type === 'text/html') {
        return buffer.htmlText
      }

      return ''
    },
    setData(type: string, value: string): void {
      if (type === 'text/plain') {
        buffer.plainText = value
      }

      if (type === 'text/html') {
        buffer.htmlText = value
      }
    }
  }
}

/** 收集 facade copy/cut 生成的剪贴板内容。 */
export function collectClipboardBuffer(
  hiddenTextarea: HTMLTextAreaElement,
  kind: 'copy' | 'cut'
): ClipboardBuffer {
  const buffer: ClipboardBuffer = {
    plainText: '',
    htmlText: ''
  }

  dispatchClipboardEvent(hiddenTextarea, kind, createClipboardData(buffer))

  return buffer
}

/** 分发一条带 clipboardData 的合成事件。 */
export function dispatchClipboardEvent(
  hiddenTextarea: HTMLTextAreaElement,
  kind: 'copy' | 'cut' | 'paste',
  clipboardData: ReturnType<typeof createClipboardData>
): void {
  const event = new Event(kind, {
    bubbles: true,
    cancelable: true
  })

  Object.defineProperty(event, 'clipboardData', {
    configurable: true,
    value: clipboardData
  })

  hiddenTextarea.dispatchEvent(event)
}

/** 尝试通过浏览器原生命令执行 copy/cut/paste。 */
export function runNativeExecCommand(command: 'copy' | 'cut' | 'paste'): boolean {
  const documentWithExec = document as Document & {
    execCommand?: (name: string) => boolean
  }

  return typeof documentWithExec.execCommand === 'function'
    && documentWithExec.execCommand(command) === true
}

/** 统一阻止按钮 pointerdown 抢走焦点。 */
export function preventDefaultEvent(event: Event): void {
  event.preventDefault()
}

/** 归一化 table controller 的异常消息。 */
export function readTableErrorMessage(error: unknown, i18n?: ResolvedJWordUiI18n): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message
  }

  return readJWordUiText(i18n ?? { messages: {} }, 'a11y.table.error')
}

/** 从 DOM 反推页面 scale。 */
function resolvePageScale(pageElement: HTMLElement, page: LayoutBox): number {
  const baseWidthPx = twipsToCssPx(page.width)

  if (baseWidthPx <= 0) {
    return 1
  }

  return pageElement.clientWidth / baseWidthPx
}

/** 把 viewport 鼠标坐标转换成 editor.hitTest 所需的 page twips。 */
function resolveMousePageMetrics(
  editor: Editor,
  event: MouseEvent
): Readonly<{
  pageIndex: number
  xTwips: number
  yTwips: number
}> | null {
  const target = event.target

  if (!(target instanceof Element)) {
    return null
  }

  const pageElement = target.closest<HTMLElement>('[data-jword-page]')

  if (pageElement === null) {
    return null
  }

  const pageIndex = Number.parseInt(pageElement.getAttribute('data-jword-page') ?? '-1', 10)
  const page = editor.getLayout().pages[pageIndex]

  if (!Number.isInteger(pageIndex) || pageIndex < 0 || page === undefined) {
    return null
  }

  const pageRect = pageElement.getBoundingClientRect()
  const scale = resolvePageScale(pageElement, page)

  return {
    pageIndex,
    xTwips: cssPxToTwips((event.clientX - pageRect.left) / Math.max(0.01, scale)),
    yTwips: cssPxToTwips((event.clientY - pageRect.top) / Math.max(0.01, scale))
  }
}

/** 通过 blockId/runId 找回当前表格目标。 */
function resolveTargetByPosition(
  projection: ReturnType<Editor['getProjection']>,
  blockId: string,
  runId: string
): JWordTableSelectionTarget | null {
  for (const section of projection.document.sections) {
    for (const block of section.blocks) {
      if (block.kind !== 'table') {
        continue
      }

      const columnCount = block.rows.reduce((count, row) => {
        return Math.max(count, row.cells.reduce((rowCount, cell) => rowCount + (cell.gridSpan ?? 1), 0))
      }, 0)

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

          const paragraph = cell.blocks.find((child) => child.kind === 'paragraph' && child.id === blockId)
          const run = paragraph?.kind === 'paragraph'
            ? paragraph.runs.find((candidate) => candidate.id === runId)
            : undefined

          if (paragraph?.kind === 'paragraph' && run !== undefined) {
            return {
              tableId: block.id,
              sectionId: section.id,
              rowIndex,
              columnIndex,
              cellIndex,
              rowCount: block.rows.length,
              columnCount,
              rowCellCount: row.cells.length,
              cellId: cell.id,
              blockId: paragraph.id,
              runId: run.id,
              cellGridSpan: cell.gridSpan ?? 1
            }
          }

          columnIndex += cell.gridSpan ?? 1
        }
      }
    }
  }

  return null
}

/** 创建右键菜单按钮。 */
function createContextMenuButton(actionId: string, text: string): HTMLButtonElement {
  const button = document.createElement('button')
  const label = document.createElement('span')

  button.type = 'button'
  button.className = 'jw-context-menu__button'
  button.setAttribute('data-jword-context-action', actionId)
  button.title = text
  button.setAttribute('aria-label', text)
  label.className = 'jw-context-menu__label'
  label.textContent = text
  button.append(label)

  return button
}

/** 更新右键菜单按钮文案。 */
function setContextMenuButtonText(button: HTMLButtonElement, text: string): void {
  const label = button.querySelector<HTMLElement>('.jw-context-menu__label')

  if (label !== null) {
    label.textContent = text
  }
  button.title = text
  button.setAttribute('aria-label', text)
}

/** 读取表格工具文案。 */
function readTableText(i18n: ResolvedJWordUiI18n, key: string): string {
  return readJWordUiText(i18n, `menu.table.${key}`)
}
