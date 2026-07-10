/**
 * 职责：连接 Gate 4 查找替换基础 UI 与 core find/replace transaction helper。
 * 边界：不实现正则或跨 run 高级检索，高亮只走只读 overlay，不直接改 projection。
 * 协作模块：find-replace DOM、core findTextMatches/buildReplaceMatchCommand/replaceAllMatches 和 editor facade。
 * 性能/安全约束：每次查找按需读取 projection，不缓存 projection 副本；替换只走 editor.executeCommand。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import {
  buildReplaceMatchCommand,
  createSelectionState,
  findTextMatches,
  replaceAllMatches,
  twipsToCssPx,
  type Editor,
  type FindTextOptions,
  type FindTextMatch,
  type TextRange,
  type TextPosition
} from '@4xian/jword-core'
import { createFindReplaceDom, destroyFindReplaceDom, localizeFindReplaceDom } from './dom'
import {
  readJWordUiText,
  resolveJWordUiI18n,
  type ResolvedJWordUiI18n
} from '../i18n'
import type { JWordFindReplacePanelElements } from '../types'
import type { JWordReadonlyMode } from '../types'

const FIND_REPLACE_OVERLAY_MATCH_LIMIT = 24

export interface CreateFindReplaceControllerOptions {
  readonly editor: Editor
  readonly host: HTMLElement
  readonly editorHost?: HTMLElement
  readonly announce?: (message: string) => void
  readonly scrollToRange?: (range: TextRange) => void
  readonly readonly?: JWordReadonlyMode
  readonly i18n?: ResolvedJWordUiI18n
  readonly findOptions?: FindTextOptions
}

export interface FindReplaceControllerHandle {
  readonly elements: JWordFindReplacePanelElements
  setI18n(i18n: ResolvedJWordUiI18n): void
  open(): void
  close(): void
  toggleVisible(): void
  refresh(): void
  destroy(): void
}

/**
 * 创建查找替换基础 controller。
 */
export function createFindReplaceController(
  options: CreateFindReplaceControllerOptions
): FindReplaceControllerHandle {
  let i18n = options.i18n ?? resolveJWordUiI18n()
  const elements = createFindReplaceDom(options.host, i18n)
  const signalController = new AbortController()
  const readonlyMode = options.readonly === true || (typeof options.readonly === 'object' && options.readonly.enabled === true)
  let matches: readonly FindTextMatch[] = []
  let activeIndex = -1
  let lastMessage = ''
  let destroyed = false
  const overlayState = {
    overlay: null as HTMLElement | null
  }
  const hiddenObserver = new MutationObserver(() => {
    if (elements.root.hidden) {
      resetDraft()
    }
  })

  /** 执行查找并定位第一个结果。 */
  function runFind(): void {
    matches = findTextMatches(options.editor, elements.queryInput.value, options.findOptions)
    activeIndex = matches.length === 0 ? -1 : 0
    lastMessage = matches.length === 0
      ? readFindReplaceText(i18n, 'noResults', '未找到结果')
      : readFindReplaceText(i18n, 'resultCount', '{count} 个结果').replace('{count}', String(matches.length))
    focusActiveMatch()
    refresh()
    options.announce?.(lastMessage)
  }

  /** 定位上一个查找结果。 */
  function focusPrevious(): void {
    if (matches.length === 0) {
      runFind()
      return
    }

    activeIndex = activeIndex <= 0 ? matches.length - 1 : activeIndex - 1
    focusActiveMatch()
    refresh()
  }

  /** 定位下一个查找结果。 */
  function focusNext(): void {
    if (matches.length === 0) {
      runFind()
      return
    }

    activeIndex = activeIndex >= matches.length - 1 ? 0 : activeIndex + 1
    focusActiveMatch()
    refresh()
  }

  /** 替换当前定位的查找结果。 */
  function replaceCurrent(): void {
    if (matches.length === 0 || activeIndex < 0) {
      runFind()
      return
    }

    const match = matches[activeIndex]
    const command = match === undefined
      ? null
      : buildReplaceMatchCommand(options.editor, match, elements.replacementInput.value)

    if (command === null) {
      lastMessage = readFindReplaceText(i18n, 'replaceUnavailable', '当前结果无法替换')
      refresh()
      options.announce?.(lastMessage)
      return
    }

    options.editor.executeCommand(command)
    matches = findTextMatches(options.editor, elements.queryInput.value, options.findOptions)
    activeIndex = Math.min(activeIndex, matches.length - 1)
    lastMessage = matches.length === 0
      ? readFindReplaceText(i18n, 'replaceNoRemaining', '已替换，未剩余结果')
      : readFindReplaceText(i18n, 'replaceRemaining', '已替换，剩余 {count} 个结果')
        .replace('{count}', String(matches.length))
    focusActiveMatch()
    refresh()
    options.announce?.(lastMessage)
  }

  /** 替换全部当前查询结果。 */
  function replaceAll(): void {
    const result = replaceAllMatches(
      options.editor,
      elements.queryInput.value,
      elements.replacementInput.value,
      options.findOptions
    )

    matches = findTextMatches(options.editor, elements.queryInput.value, options.findOptions)
    activeIndex = matches.length === 0 ? -1 : 0
    lastMessage = readFindReplaceText(i18n, 'replaceAllResult', '已替换 {count} 个结果')
      .replace('{count}', String(result.replacedCount))
    focusActiveMatch()
    refresh()
    options.announce?.(lastMessage)
  }

  /** 把当前结果恢复为 editor selection。 */
  function focusActiveMatch(): void {
    const match = matches[activeIndex]

    if (match === undefined) {
      return
    }

    const range = options.editor.locateRangeSnapshot(match.rangeSnapshot)

    if (range === null) {
      return
    }

    options.editor.setSelection(createSelectionState(
      createAnchorFromPosition(options.editor, range.anchor),
      createAnchorFromPosition(options.editor, range.focus)
    ))
    options.scrollToRange?.(range)
  }

  /** 打开查找替换面板。 */
  function open(): void {
    elements.root.hidden = false
    refresh()
  }

  /** 关闭并清空查找替换面板。 */
  function close(): void {
    elements.root.hidden = true
    resetDraft()
  }

  /** 切换查找替换面板可见性。 */
  function toggleVisible(): void {
    if (elements.root.hidden) {
      open()
      return
    }

    close()
  }

  /** 清空表单草稿和当前查找记录。 */
  function resetDraft(): void {
    if (destroyed) {
      return
    }

    elements.queryInput.value = ''
    elements.replacementInput.value = ''
    matches = []
    activeIndex = -1
    lastMessage = ''
    refresh()
  }

  /** 同步外部逻辑直接隐藏面板后的草稿清理。 */
  function resetDraftAfterExternalHide(event: Event): void {
    const target = event.target

    if (target instanceof Node && elements.root.contains(target)) {
      return
    }

    if (elements.root.hidden) {
      resetDraft()
    }
  }

  /** 根据当前状态刷新按钮和状态文案。 */
  function refresh(): void {
    if (destroyed) {
      return
    }

    const hasQuery = elements.queryInput.value.trim().length > 0
    const hasMatches = matches.length > 0
    const canReplace = !readonlyMode

    elements.findButton.disabled = !hasQuery
    elements.previousButton.disabled = !hasMatches
    elements.nextButton.disabled = !hasMatches
    elements.replaceButton.disabled = !hasMatches || !canReplace
    elements.replaceAllButton.disabled = !hasQuery || !canReplace
    elements.status.hidden = !hasMatches
    elements.status.textContent = hasMatches ? readMatchIndexText(matches.length, activeIndex) : ''
    syncOverlay(options, overlayState, matches, activeIndex, destroyed)
  }

  /** 销毁 controller。 */
  function destroy(): void {
    if (destroyed) {
      return
    }

    destroyed = true
    hiddenObserver.disconnect()
    signalController.abort()
    destroyOverlay(overlayState)
    destroyFindReplaceDom(elements)
  }

  elements.queryInput.addEventListener('input', () => {
    matches = []
    activeIndex = -1
    lastMessage = ''
    refresh()
  }, { signal: signalController.signal })
  elements.findButton.addEventListener('click', runFind, { signal: signalController.signal })
  elements.previousButton.addEventListener('click', focusPrevious, { signal: signalController.signal })
  elements.nextButton.addEventListener('click', focusNext, { signal: signalController.signal })
  elements.replaceButton.addEventListener('click', replaceCurrent, { signal: signalController.signal })
  elements.replaceAllButton.addEventListener('click', replaceAll, { signal: signalController.signal })
  elements.closeButton.addEventListener('click', close, { signal: signalController.signal })
  elements.root.ownerDocument.addEventListener('click', resetDraftAfterExternalHide, { signal: signalController.signal })
  hiddenObserver.observe(elements.root, {
    attributes: true,
    attributeFilter: ['hidden']
  })
  refresh()

  return {
    elements,
    setI18n(nextI18n): void {
      i18n = nextI18n
      localizeFindReplaceDom(elements, i18n)
      refresh()
    },
    open,
    close,
    toggleVisible,
    refresh,
    destroy
  }
}

/** 同步查找命中 overlay。 */
function syncOverlay(
  options: CreateFindReplaceControllerOptions,
  overlayState: { overlay: HTMLElement | null },
  matches: readonly FindTextMatch[],
  activeIndex: number,
  destroyed: boolean
): void {
  if (destroyed) {
    return
  }

  const canvasContainer = resolveCanvasContainer(options)

  if (canvasContainer === null || matches.length === 0) {
    clearOverlay(overlayState)
    return
  }

  const activeOverlay = resolveOverlay(canvasContainer, overlayState)

  renderFindReplaceOverlay(options.editor, canvasContainer, activeOverlay, matches, activeIndex)
}

/** 解析或创建查找 overlay 根节点。 */
function resolveOverlay(
  canvasContainer: HTMLElement,
  overlayState: { overlay: HTMLElement | null }
): HTMLElement {
  if (overlayState.overlay !== null && overlayState.overlay.parentElement === canvasContainer) {
    return overlayState.overlay
  }

  overlayState.overlay?.remove()
  overlayState.overlay = document.createElement('div')
  overlayState.overlay.className = 'jw-find-replace-overlay'
  overlayState.overlay.setAttribute('data-jword-find-replace-overlay', 'true')
  canvasContainer.style.position = canvasContainer.style.position || 'relative'
  canvasContainer.append(overlayState.overlay)

  return overlayState.overlay
}

/** 解析当前 editor canvas 滚动容器。 */
function resolveCanvasContainer(options: CreateFindReplaceControllerOptions): HTMLElement | null {
  return options.editorHost?.querySelector<HTMLElement>('[data-jword-canvas-container]') ?? null
}

/** 清空查找 overlay 内容。 */
function clearOverlay(overlayState: { overlay: HTMLElement | null }): void {
  overlayState.overlay?.replaceChildren()
}

/** 销毁查找 overlay 根节点。 */
function destroyOverlay(overlayState: { overlay: HTMLElement | null }): void {
  overlayState.overlay?.remove()
  overlayState.overlay = null
}

/** 渲染当前查找窗口的只读高亮矩形。 */
function renderFindReplaceOverlay(
  editor: Editor,
  canvasContainer: HTMLElement,
  overlay: HTMLElement,
  matches: readonly FindTextMatch[],
  activeIndex: number
): void {
  const layout = editor.getLayout()
  const scale = editor.getPageConfig().scale
  const children: HTMLElement[] = []
  const resolvedActiveIndex = activeIndex >= 0 && activeIndex < matches.length ? activeIndex : 0
  const halfLimit = Math.floor(FIND_REPLACE_OVERLAY_MATCH_LIMIT / 2)
  const matchStart = matches.length <= FIND_REPLACE_OVERLAY_MATCH_LIMIT
    ? 0
    : Math.max(0, Math.min(matches.length - FIND_REPLACE_OVERLAY_MATCH_LIMIT, resolvedActiveIndex - halfLimit))
  const matchEnd = Math.min(matches.length, matchStart + FIND_REPLACE_OVERLAY_MATCH_LIMIT)

  for (let matchIndex = matchStart; matchIndex < matchEnd; matchIndex += 1) {
    const match = matches[matchIndex]

    if (match === undefined) {
      continue
    }

    const range = editor.locateRangeSnapshot(match.rangeSnapshot)

    if (range === null) {
      continue
    }

    const selection = createSelectionState(
      createAnchorFromPosition(editor, range.anchor),
      createAnchorFromPosition(editor, range.focus)
    )
    const rects = editor.getSelectionRects(selection.range)

    for (const rect of rects) {
      const page = layout.pages[rect.pageIndex]
      const pageElement = page === undefined
        ? null
        : canvasContainer.querySelector<HTMLElement>(`[data-jword-page="${page.pageIndex}"]`)

      if (page === undefined || pageElement === null) {
        continue
      }

      children.push(createFindReplaceOverlayRect(
        matchIndex,
        pageElement,
        page,
        rect,
        scale,
        matchIndex === activeIndex
      ))
    }
  }

  overlay.style.width = `${canvasContainer.scrollWidth}px`
  overlay.style.height = `${canvasContainer.scrollHeight}px`
  overlay.replaceChildren(...children)
}

/** 创建单个查找结果 overlay 矩形。 */
function createFindReplaceOverlayRect(
  matchIndex: number,
  pageElement: HTMLElement,
  page: NonNullable<ReturnType<Editor['getLayout']>['pages'][number]>,
  rect: ReturnType<Editor['getSelectionRects']>[number],
  scale: number,
  active: boolean
): HTMLElement {
  const highlight = document.createElement('div')

  highlight.className = active
    ? 'jw-find-replace-overlay__rect jw-find-replace-overlay__rect--active'
    : 'jw-find-replace-overlay__rect'
  highlight.style.left = `${pageElement.offsetLeft + twipsToCssPx(rect.x - page.x, scale)}px`
  highlight.style.top = `${pageElement.offsetTop + twipsToCssPx(rect.y - page.y, scale)}px`
  highlight.style.width = `${twipsToCssPx(rect.width, scale)}px`
  highlight.style.height = `${twipsToCssPx(rect.height, scale)}px`
  highlight.setAttribute('data-jword-find-match-index', String(matchIndex))
  highlight.setAttribute('data-jword-find-active', String(active))

  return highlight
}

/** 基于可序列化文本位置创建 editor anchor。 */
function createAnchorFromPosition(editor: Editor, position: TextPosition) {
  return editor.createTextAnchor({
    sectionId: position.sectionId,
    blockId: position.blockId,
    runId: position.runId,
    graphemeIndex: position.graphemeIndex,
    ...(position.assoc === undefined ? {} : { assoc: position.assoc })
  })
}

/** 读取当前查找结果索引提示。 */
function readMatchIndexText(matchCount: number, activeIndex: number): string {
  return `${activeIndex + 1} / ${matchCount}`
}

/** 读取查找替换动态文案。 */
function readFindReplaceText(i18n: ResolvedJWordUiI18n, key: string, fallback: string): string {
  return readJWordUiText(i18n, `menu.findReplace.${key}`, fallback)
}
