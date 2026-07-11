/**
 * 职责：连接 core heading outline 与 UI 目录项点击跳转。
 * 边界：不实现滚动动画、不持有第二套文档状态、不改写 projection。
 * 协作模块：核心标题结构辅助函数、编辑器选区门面和目录节点。
 * 性能/安全约束：每次刷新重新读取 projection；点击后只设置稳定选区，后续滚动交给宿主或浏览器布局层。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import {
  buildHeadingOutline,
  createSelectionState,
  locateHeadingOutlineItem,
  twipsToCssPx,
  type Editor,
  type HeadingOutlineItem,
  type TextRange,
  type TextPosition
} from '@4xian/jword-core'
import {
  createHeadingOutlineDom,
  destroyHeadingOutlineDom,
  localizeHeadingOutlineDom,
  renderHeadingOutlineDom
} from './dom'
import { resolveJWordUiI18n, type ResolvedJWordUiI18n } from '../i18n'
import type { HeadingOutlineDom } from './dom'

export interface CreateHeadingOutlineControllerOptions {
  readonly editor: Editor
  readonly host: HTMLElement
  readonly editorHost?: HTMLElement
  readonly scrollToRange?: (range: TextRange) => void
  readonly i18n?: ResolvedJWordUiI18n
}

export interface HeadingOutlineControllerHandle {
  readonly elements: HeadingOutlineDom
  setI18n(i18n: ResolvedJWordUiI18n): void
  hasItems(): boolean
  isVisible(): boolean
  toggleVisible(): void
  refresh(): void
  destroy(): void
}

/**
 * 创建基础目录 controller。
 */
export function createHeadingOutlineController(
  options: CreateHeadingOutlineControllerOptions
): HeadingOutlineControllerHandle {
  let i18n = options.i18n ?? resolveJWordUiI18n()
  const dom = createHeadingOutlineDom(options.host, i18n)
  const signalController = new AbortController()
  let destroyed = false
  let visible = false
  let activeItemId: string | null = null
  const collapsedItemIds = new Set<string>()

  /** 让目录项点击后的稳定范围成为当前选区。 */
  function activateItem(item: HeadingOutlineItem): void {
    const range = locateHeadingOutlineItem(options.editor, item)

    if (range === null) {
      return
    }

    activeItemId = item.id
    visible = true
    options.editor.setSelection(createSelectionState(
      createAnchorFromPosition(options.editor, range.anchor),
      createAnchorFromPosition(options.editor, range.focus)
    ))
    options.scrollToRange?.(range)
    refresh()
  }

  /** 刷新目录项列表。 */
  function refresh(): void {
    if (destroyed) {
      return
    }

    const items = buildHeadingOutline(options.editor)

    if (items.length === 0) {
      visible = false
      activeItemId = null
      collapsedItemIds.clear()
    }

    dom.list.hidden = !visible
    renderHeadingOutlineDom(
      dom,
      items,
      activeItemId,
      collapsedItemIds,
      activateItem,
      toggleItemCollapsed,
      i18n
    )
  }

  /** 按正文滚动位置同步当前标题高亮。 */
  function syncActiveItemFromViewport(): void {
    if (destroyed) {
      return
    }

    const canvasContainer = resolveCanvasContainer(options.editorHost ?? dom.host)

    if (canvasContainer === null) {
      return
    }

    const items = buildHeadingOutline(options.editor)
    const nextActiveItemId = readActiveHeadingItemId(options.editor, canvasContainer, items)

    if (nextActiveItemId === activeItemId) {
      return
    }

    activeItemId = nextActiveItemId
    renderHeadingOutlineDom(dom, items, activeItemId, collapsedItemIds, activateItem, toggleItemCollapsed, i18n)
  }

  /** 切换目录项折叠状态。 */
  function toggleItemCollapsed(item: HeadingOutlineItem): void {
    if (collapsedItemIds.has(item.id)) {
      collapsedItemIds.delete(item.id)
    } else {
      collapsedItemIds.add(item.id)
    }

    refresh()
  }

  /** 切换目录可见性。 */
  function toggleVisible(): void {
    if (!hasItems()) {
      visible = false
      refresh()
      return
    }

    visible = !visible
    if (visible) {
      syncActiveItemFromViewport()
    }
    refresh()
  }

  /** 读取目录当前是否可见。 */
  function isVisible(): boolean {
    return visible
  }

  /** 读取当前文档是否存在可展示的目录项。 */
  function hasItems(): boolean {
    return buildHeadingOutline(options.editor).length > 0
  }

  /** 销毁目录 controller。 */
  function destroy(): void {
    if (destroyed) {
      return
    }

    destroyed = true
    signalController.abort()
    destroyHeadingOutlineDom(dom)
  }

  const canvasContainer = resolveCanvasContainer(options.editorHost ?? dom.host)

  canvasContainer?.addEventListener('scroll', syncActiveItemFromViewport, {
    signal: signalController.signal
  })
  refresh()

  return {
    elements: dom,
    setI18n(nextI18n): void {
      i18n = nextI18n
      localizeHeadingOutlineDom(dom, i18n)
      refresh()
    },
    isVisible,
    hasItems,
    toggleVisible,
    refresh,
    destroy
  }
}

/**
 * 把可序列化文本位置恢复为 editor 可设置的稳定锚点。
 */
function createAnchorFromPosition(editor: Editor, position: TextPosition) {
  return editor.createTextAnchor({
    sectionId: position.sectionId,
    blockId: position.blockId,
    runId: position.runId,
    graphemeIndex: position.graphemeIndex,
    ...(position.assoc === undefined ? {} : { assoc: position.assoc })
  })
}

/** 读取当前文档内已挂载的 canvas 滚动容器。 */
function resolveCanvasContainer(host: HTMLElement): HTMLElement | null {
  const editorShell = host.closest<HTMLElement>('[data-jword-editor]')

  return editorShell?.querySelector<HTMLElement>('[data-jword-canvas-container]')
    ?? host.querySelector<HTMLElement>('[data-jword-canvas-container]')
}

/** 按当前滚动顶边读取应该高亮的目录项。 */
function readActiveHeadingItemId(
  editor: Editor,
  canvasContainer: HTMLElement,
  items: readonly HeadingOutlineItem[]
): string | null {
  let activeItem: Readonly<{ id: string, top: number }> | null = null
  const viewportTop = canvasContainer.scrollTop + 12

  for (const item of items) {
    const top = readHeadingItemTop(editor, canvasContainer, item)

    if (top === null) {
      continue
    }

    if (top <= viewportTop) {
      activeItem = { id: item.id, top }
      continue
    }

    if (activeItem === null) {
      return item.id
    }

    return activeItem.id
  }

  return activeItem?.id ?? null
}

/** 读取目录项锚点在 canvas 滚动内容中的顶部坐标。 */
function readHeadingItemTop(
  editor: Editor,
  canvasContainer: HTMLElement,
  item: HeadingOutlineItem
): number | null {
  const range = locateHeadingOutlineItem(editor, item)

  if (range === null) {
    return null
  }

  const selection = createSelectionState(
    createAnchorFromPosition(editor, range.anchor),
    createAnchorFromPosition(editor, range.focus)
  )
  const rect = editor.getSelectionRects(selection.range)[0] ?? editor.getCaretRect(selection.anchor)

  if (rect === undefined) {
    return null
  }

  const layout = editor.getLayout()
  const page = layout.pages[rect.pageIndex]

  if (page === undefined) {
    return null
  }

  const pageElement = canvasContainer.querySelector<HTMLElement>(`[data-jword-page="${page.pageIndex}"]`)
  const pageOffsetTop = pageElement?.offsetTop ?? twipsToCssPx(page.y, editor.getPageConfig().scale)

  return pageOffsetTop + twipsToCssPx(rect.y - page.y, editor.getPageConfig().scale)
}
