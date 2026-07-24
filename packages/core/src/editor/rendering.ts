/**
 * 职责：封装页面 wrapper 同步、canvas 批量渲染和 dirty page 推导 helper。
 * 边界：不读取键盘/剪贴板事件，不修改文档模型。
 * 协作模块：canvas renderer、layout、transaction operation 和 mounted DOM。
 * 性能/安全约束：constructor/top-level 不访问 window/document/HTMLElement 实例，DOM 只在 mount 后创建，编辑命令统一进入 transaction pipeline。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import type { CanvasLike } from '../canvas/pool'
import { renderPageCanvas, syncPageCanvases } from '../canvas/renderer'
import type { Command, Operation, TextPosition } from '../operations/transaction'
import { hitTestDocumentLayout } from '../layout/runtime'
import type { DocumentLayout, LayoutBox, LayoutDirtyRange, LayoutRect, LineBox, PageBox } from '../layout/runtime'
import { cssPxToTwips, twipsToCssPx } from '../layout/page-config'
import type { PluginResolvedDecoration } from '../plugins/types'
import type { EditorPageElement, MountedEditorDom } from './types'

const LAYOUT_LINE_MATCH_TOLERANCE_TWIPS = 1

export function createPageElement(mountedDom: MountedEditorDom, layoutPage: LayoutBox, scale: number) {
  const page = mountedDom.canvasContainer.ownerDocument.createElement('div')
  updatePageElement(page, mountedDom.canvases.get(layoutPage.pageIndex), layoutPage, scale)

  return page
}

export function flattenLayoutLines(layout: DocumentLayout): readonly LineBox[] {
  return Object.freeze(layout.pages.flatMap((page) => page.lines))
}

/** 按页号和容差匹配当前 caret 所在 layout 行，避免浮点抖动导致键盘导航失效。 */
export function isLayoutLineMatchingCaret(line: LineBox, caretRect: LayoutRect): boolean {
  const caretCenterY = caretRect.y + (caretRect.height / 2)

  return line.pageIndex === caretRect.pageIndex
    && caretCenterY >= line.y - LAYOUT_LINE_MATCH_TOLERANCE_TWIPS
    && caretCenterY <= line.y + line.height + LAYOUT_LINE_MATCH_TOLERANCE_TWIPS
}

export function resolveLineBoundaryPosition(
  line: LineBox,
  boundary: 'start' | 'end'
): TextPosition | undefined {
  const firstFragment = line.fragments[0]
  const lastFragment = line.fragments[line.fragments.length - 1]

  if (firstFragment === undefined || lastFragment === undefined) {
    const firstInline = line.inlines[0]
    const lastInline = line.inlines[line.inlines.length - 1]

    if (firstInline === undefined || lastInline === undefined) {
      return undefined
    }

    return boundary === 'start'
      ? {
          sectionId: firstInline.at.sectionId,
          blockId: firstInline.at.blockId,
          runId: firstInline.at.runId,
          graphemeIndex: firstInline.at.graphemeIndex
        }
      : {
          sectionId: lastInline.at.sectionId,
          blockId: lastInline.at.blockId,
          runId: lastInline.at.runId,
          graphemeIndex: lastInline.at.graphemeIndex,
          assoc: -1
        }
  }

  return boundary === 'start'
    ? {
        sectionId: firstFragment.start.sectionId,
        blockId: firstFragment.start.blockId,
        runId: firstFragment.start.runId,
        graphemeIndex: firstFragment.start.graphemeIndex
      }
    : {
        sectionId: lastFragment.end.sectionId,
        blockId: lastFragment.end.blockId,
        runId: lastFragment.end.runId,
        graphemeIndex: lastFragment.end.graphemeIndex,
        assoc: -1
      }
}

export function hitTestLineAtAbsoluteX(
  layout: DocumentLayout,
  line: LineBox,
  absoluteX: number
): TextPosition | undefined {
  const page = layout.pages[line.pageIndex]

  if (page === undefined) {
    return undefined
  }

  const localY = line.y - page.y + Math.max(1, Math.floor(line.height / 2))

  return hitTestDocumentLayout(layout, {
    pageIndex: line.pageIndex,
    x: Math.max(0, absoluteX - page.x),
    y: Math.max(0, localY)
  })
}

export function syncPageWrappers(
  mountedDom: MountedEditorDom,
  pages: readonly LayoutBox[],
  scale: number
): void {
  const livePageIndexes = new Set(pages.map((page) => page.pageIndex))

  for (const [pageIndex, wrapper] of mountedDom.pageWrappers) {
    if (!livePageIndexes.has(pageIndex)) {
      wrapper.remove()
      mountedDom.pageWrappers.delete(pageIndex)
    }
  }

  for (const [index, layoutPage] of pages.entries()) {
    const wrapper = mountedDom.pageWrappers.get(layoutPage.pageIndex)
      ?? createPageElement(mountedDom, layoutPage, scale)

    mountedDom.pageWrappers.set(layoutPage.pageIndex, wrapper)
    updatePageElement(wrapper, mountedDom.canvases.get(layoutPage.pageIndex), layoutPage, scale)

    const currentChild = mountedDom.canvasContainer.children.item(index)

    if (currentChild !== wrapper) {
      mountedDom.canvasContainer.insertBefore(wrapper, currentChild)
    }
  }

  const containerWidth = mountedDom.canvasContainer.clientWidth
  const containerLeft = containerWidth > 0
    ? mountedDom.canvasContainer.getBoundingClientRect().left
    : 0

  for (const layoutPage of pages) {
    const wrapper = mountedDom.pageWrappers.get(layoutPage.pageIndex)!

    alignPageWrapperToDevicePixels(wrapper, layoutPage, scale, containerWidth, containerLeft)
  }
}

export function updatePageElement(
  page: EditorPageElement,
  canvas: CanvasLike | undefined,
  layoutPage: LayoutBox,
  scale: number
): void {
  page.className = 'jw-editor__page'
  page.setAttribute('data-jword-page', String(layoutPage.pageIndex))
  page.style.position = 'relative'
  page.style.width = `${twipsToCssPx(layoutPage.width, scale)}px`
  page.style.minWidth = page.style.width
  page.style.height = `${twipsToCssPx(layoutPage.height, scale)}px`
  page.style.margin = '0 auto 48px'
  page.style.background = '#ffffff'
  page.style.cursor = 'text'

  if (canvas !== undefined) {
    const styledCanvas = canvas as CanvasLike & { className?: string }
    const domCanvas = canvas as CanvasLike & { style?: CSSStyleDeclaration }
    const canvasNode = canvas as unknown as Node

    styledCanvas.className = 'jw-editor__page-canvas'
    if (domCanvas.style !== undefined) {
      domCanvas.style.cursor = 'text'
    }
    if (canvasNode.parentNode !== page) {
      page.append(canvasNode)
    }
  } else {
    const renderedCanvas = page.querySelector('canvas')

    renderedCanvas?.remove()
  }
}

/** 使用同一次容器几何读取把页面左边缘对齐到设备像素。 */
function alignPageWrapperToDevicePixels(
  page: EditorPageElement,
  layoutPage: LayoutBox,
  scale: number,
  containerWidth: number,
  containerLeft: number
): void {
  const pageWidth = twipsToCssPx(layoutPage.width, scale)

  if (containerWidth <= 0 || pageWidth <= 0) {
    page.style.margin = '0 auto 48px'
    return
  }

  const centeredLeft = Math.max(0, (containerWidth - pageWidth) / 2)
  const alignedLeft = Math.max(0, Math.round(containerLeft + centeredLeft) - containerLeft)

  page.style.margin = `0 0 48px ${alignedLeft}px`
}

export function createPageStartKeys(layout: DocumentLayout): readonly string[] {
  return Object.freeze(layout.pages.map(createPageStartKey))
}

export function createPageStartKey(page: PageBox): string {
  for (const line of page.lines) {
    const fragment = line.fragments[0]

    if (fragment !== undefined) {
      return [
        fragment.sectionId,
        fragment.blockId,
        fragment.runId,
        fragment.start.graphemeIndex
      ].join(':')
    }
  }

  return `${page.pageIndex}:empty`
}

export function mergePageIndexes(...sources: readonly (readonly number[])[]): readonly number[] {
  return Object.freeze([...new Set(sources.flat())].sort((left, right) => left - right))
}

export function renderPageBatch(input: Readonly<{
  mountedDom: MountedEditorDom
  pages: readonly LayoutBox[]
  retainedPageIndexes: readonly number[]
  rerenderPageIndexes: readonly number[]
  selectionRender: Readonly<{
    selectionRects?: readonly LayoutRect[]
    commentRects?: readonly LayoutRect[]
    caretRect?: LayoutRect
  }>
  experimentalDecorations?: readonly PluginResolvedDecoration[]
  scale: number
  pixelRatio: number
}>): Map<number, CanvasLike> {
  const nextCanvases = syncPageCanvases({
    pages: input.pages,
    retainedPageIndexes: input.retainedPageIndexes,
    rerenderPageIndexes: input.rerenderPageIndexes,
    canvases: input.mountedDom.canvases,
    pool: input.mountedDom.pool,
    ...(input.selectionRender.selectionRects === undefined
      ? {}
      : { selectionRects: input.selectionRender.selectionRects }),
    ...(input.selectionRender.commentRects === undefined
      ? {}
      : { commentRects: input.selectionRender.commentRects }),
    ...(input.experimentalDecorations === undefined
      ? {}
      : { experimentalDecorations: input.experimentalDecorations }),
    ...(input.selectionRender.caretRect === undefined
      ? {}
      : { caretRect: input.selectionRender.caretRect }),
    scale: input.scale,
    pixelRatio: input.pixelRatio,
    ...(input.mountedDom.imageResourceResolver === undefined
      ? {}
      : { imageResourceResolver: input.mountedDom.imageResourceResolver })
  })

  input.mountedDom.canvases = nextCanvases
  syncPageWrappers(input.mountedDom, input.pages, input.scale)

  return nextCanvases
}

export function renderPointerSelectionCanvas(input: Readonly<{
  canvas: HTMLCanvasElement
  baseCanvas: HTMLCanvasElement
  page: LayoutBox
  selectionRects?: readonly LayoutRect[]
  caretRect?: LayoutRect
  scale: number
}>): void {
  const context = input.canvas.getContext('2d')

  if (context === null) {
    return
  }

  context.setTransform(1, 0, 0, 1, 0, 0)
  context.clearRect(0, 0, input.canvas.width, input.canvas.height)
  context.drawImage(input.baseCanvas, 0, 0, input.canvas.width, input.canvas.height)

  const cssWidth = Math.max(1, Math.round(twipsToCssPx(input.page.width, input.scale)))
  const cssHeight = Math.max(1, Math.round(twipsToCssPx(input.page.height, input.scale)))

  context.setTransform(
    input.canvas.width / cssWidth,
    0,
    0,
    input.canvas.height / cssHeight,
    0,
    0
  )

  const pageSelectionRects = (input.selectionRects ?? []).filter((rect) => rect.pageIndex === input.page.pageIndex)

  if (pageSelectionRects.length > 0) {
    context.save()
    context.globalCompositeOperation = 'multiply'
    context.fillStyle = '#cfe3ff'

    for (const rect of pageSelectionRects) {
      context.fillRect(
        twipsToCssPx(rect.x - input.page.x, input.scale),
        twipsToCssPx(rect.y - input.page.y, input.scale),
        twipsToCssPx(rect.width, input.scale),
        twipsToCssPx(rect.height, input.scale)
      )
    }

    context.restore()
  }

  if (input.caretRect?.pageIndex === input.page.pageIndex) {
    context.fillStyle = '#111827'
    context.fillRect(
      twipsToCssPx(input.caretRect.x - input.page.x, input.scale),
      twipsToCssPx(input.caretRect.y - input.page.y, input.scale),
      Math.max(1, twipsToCssPx(input.caretRect.width, input.scale)),
      twipsToCssPx(input.caretRect.height, input.scale)
    )
  }

  context.setTransform(1, 0, 0, 1, 0, 0)
}

export function resolveCanvasPixelRatio(mountedDom: MountedEditorDom): number {
  return Math.max(1, mountedDom.canvasContainer.ownerDocument.defaultView?.devicePixelRatio ?? 1)
}

export function resolveCommandDirtyRange(command: Command): LayoutDirtyRange | undefined {
  const firstOperation = command.operations[0]

  if (firstOperation === undefined) {
    return undefined
  }

  switch (firstOperation.kind) {
    case 'insertText':
    case 'splitBlock':
      return {
        anchor: firstOperation.at,
        focus: firstOperation.at
      }
    case 'deleteRange':
      return {
        anchor: firstOperation.range.anchor,
        focus: firstOperation.range.focus
      }
    default:
      return undefined
  }
}

export function resolveOperationDirtyPageIndexes(layout: DocumentLayout, operation: Operation): readonly number[] {
  switch (operation.kind) {
    case 'insertText':
    case 'splitBlock':
      return findTextPositionPageIndexes(layout, operation.at)
    case 'deleteRange':
      return mergePageIndexes(
        findTextPositionPageIndexes(layout, operation.range.anchor),
        findTextPositionPageIndexes(layout, operation.range.focus)
      )
    case 'setRunProperties':
    case 'setRunLink':
    case 'addRevisionMetadata':
      return findRunPageIndexes(layout, operation.runId)
    case 'acceptRevision':
    case 'rejectRevision':
      return mergePageIndexes(
        findTextPositionPageIndexes(layout, operation.range.anchor),
        findTextPositionPageIndexes(layout, operation.range.focus),
        ...operation.formatTargets.map((target) => findRunPageIndexes(layout, target.runId))
      )
    case 'setParagraphProperties':
      return findParagraphPageIndexes(layout, operation.paragraphId)
    case 'setSectionProperties':
      return findSectionPageIndexes(layout, operation.sectionId)
    case 'mergeBlock':
      return mergePageIndexes(
        findBlockPageIndexes(layout, operation.targetBlockId),
        findBlockPageIndexes(layout, operation.sourceBlockId)
      )
    case 'insertBlock':
      if (operation.placement.kind === 'append') {
        const lastPage = layout.pages[layout.pages.length - 1]

        return lastPage === undefined ? [] : [lastPage.pageIndex]
      }

      return findBlockPageIndexes(layout, operation.placement.blockId)
    case 'deleteBlock':
      return findBlockPageIndexes(layout, operation.blockId)
    case 'insertImage':
      return findTextPositionPageIndexes(layout, operation.at)
    case 'replaceImageResource':
    case 'deleteImage':
    case 'resizeImage':
    case 'setImageRotation':
      return findRunPageIndexes(layout, operation.runId)
    case 'insertTable':
      return operation.placement.kind === 'append'
        ? [layout.pages[layout.pages.length - 1]?.pageIndex ?? 0]
        : findBlockPageIndexes(layout, operation.placement.blockId)
    case 'insertTableRow':
    case 'deleteTableRow':
    case 'insertTableColumn':
    case 'deleteTableColumn':
    case 'setTableColumnWidth':
    case 'setTableRowHeight':
    case 'mergeTableCells':
    case 'setTableBorder':
      return findBlockPageIndexes(layout, operation.tableId)
    case 'setTableCellText':
      return findBlockPageIndexes(layout, operation.tableId)
    case 'upsertResource':
    case 'deleteResource':
    case 'addCommentThread':
    case 'replyCommentThread':
    case 'editCommentEntry':
    case 'resolveCommentThread':
    case 'reopenCommentThread':
    case 'deleteCommentThread':
      return []
  }
}

export function findTextPositionPageIndexes(layout: DocumentLayout, position: TextPosition): readonly number[] {
  const pageIndexes: number[] = []
  let foundPosition = false

  for (const page of layout.pages) {
    if (pageContainsTextPosition(page, position)) {
      pageIndexes.push(page.pageIndex)
      foundPosition = true
      continue
    }

    if (foundPosition) {
      break
    }
  }

  return mergePageIndexes(pageIndexes)
}

export function isSameTextPosition(left: TextPosition, right: TextPosition): boolean {
  return left.sectionId === right.sectionId
    && left.blockId === right.blockId
    && left.runId === right.runId
    && left.graphemeIndex === right.graphemeIndex
}

/** 判断页面是否包含目标文本位置，避免 dirty page 推导构建全布局查询缓存。 */
function pageContainsTextPosition(page: PageBox, position: TextPosition): boolean {
  for (const line of page.lines) {
    if (
      line.fragments.some((fragment) => fragmentContainsTextPosition(fragment, position))
      || line.inlines.some((inline) => isSameTextPosition(inline.at, position))
    ) {
      return true
    }
  }

  for (const block of page.blocks) {
    if (block.kind !== 'table') {
      continue
    }

    for (const row of block.rows) {
      for (const cell of row.cells) {
        if (
          (cell.textPosition !== undefined && isSameTextPosition(cell.textPosition, position))
          || cell.fragments.some((fragment) => fragmentContainsTextPosition(fragment, position))
          || cell.inlines.some((inline) => isSameTextPosition(inline.at, position))
        ) {
          return true
        }
      }
    }
  }

  return false
}

/** 判断文本片段是否覆盖目标文本位置。 */
function fragmentContainsTextPosition(
  fragment: Readonly<{
    sectionId: string
    blockId: string
    runId: string
    start: TextPosition
    end: TextPosition
  }>,
  position: TextPosition
): boolean {
  return fragment.sectionId === position.sectionId
    && fragment.blockId === position.blockId
    && fragment.runId === position.runId
    && position.graphemeIndex >= fragment.start.graphemeIndex
    && position.graphemeIndex <= fragment.end.graphemeIndex
}

export function findRunPageIndexes(layout: DocumentLayout, runId: string): readonly number[] {
  return mergePageIndexes(
    layout.pages.flatMap((page) => page.lines.some((line) =>
      line.fragments.some((fragment) => fragment.runId === runId)
      || line.inlines.some((inline) => inline.runId === runId)
    ) ? [page.pageIndex] : [])
  )
}

export function findParagraphPageIndexes(layout: DocumentLayout, paragraphId: string): readonly number[] {
  return mergePageIndexes(
    layout.pages.flatMap((page) => page.paragraphs.some((paragraph) => paragraph.paragraphId === paragraphId) ? [page.pageIndex] : [])
  )
}

function findSectionPageIndexes(layout: DocumentLayout, sectionId: string): readonly number[] {
  return mergePageIndexes(
    layout.pages.flatMap((page) => page.sectionIds.includes(sectionId) ? [page.pageIndex] : [])
  )
}

export function findBlockPageIndexes(layout: DocumentLayout, blockId: string): readonly number[] {
  return mergePageIndexes(
    findParagraphPageIndexes(layout, blockId),
    layout.pages.flatMap((page) => page.blocks.some((block) =>
      block.kind === 'table' && block.tableId === blockId
      || block.kind === 'table' && block.rows.some((row) =>
        row.cells.some((cell) => cell.blockIds.includes(blockId))
      )
    ) ? [page.pageIndex] : []),
    layout.pages.flatMap((page) => page.lines.some((line) =>
      line.fragments.some((fragment) => fragment.blockId === blockId)
      || line.inlines.some((inline) => inline.blockId === blockId)
    ) ? [page.pageIndex] : [])
  )
}

export function createCanvasElement(ownerDocument: Document): HTMLCanvasElement {
  const canvas = ownerDocument.createElement('canvas')

  if (ownerDocument.defaultView?.navigator.userAgent.includes('jsdom') === true) {
    Object.defineProperty(canvas, 'getContext', {
      value: () => null
    })
  }

  return canvas
}
