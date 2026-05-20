/**
 * 职责：汇总选区浮动工具栏与右键菜单的显示条件、定位和只读状态计算。
 * 边界：不创建 DOM，不绑定事件，只读取公开 editor facade 与宿主几何信息。
 * 协作模块：selection-actions/controller 调度这里构建状态，dom 只消费结果。
 * 性能/安全约束：所有判断都基于公开 facade，不引入第二套 selection 或 layout 状态。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md Gate 4 选区浮层收尾项。
 */
import type { FormattingStateValue, Editor, SelectionState } from '@4xian/jword-core'
import { isSelectionCollapsed, twipsToCssPx } from '@4xian/jword-core'
import { DEFAULT_BACKGROUND_COLOR, DEFAULT_TEXT_COLOR } from '../toolbar/builtin-tools'
import { normalizeHexColor, readSelectionFormattingState } from '../toolbar/state'
import type { ToolbarPressedState } from '../toolbar/state'
import type { SelectionActionPosition, SelectionActionsViewState, StickyFloatingToolbarState } from './types'

/** 判断当前选区是否为可格式化的有效非折叠文本选区。 */
export function hasActiveTextSelection(selection: SelectionState | null): selection is SelectionState {
  return selection !== null && !isSelectionCollapsed(selection)
}

/** 把当前选区归一化成稳定 key，供 Escape 抑制和右键菜单绑定复用。 */
export function readSelectionKey(editor: Editor, selection: SelectionState | null): string {
  if (selection === null) {
    return ''
  }

  const anchor = editor.resolveTextPosition(selection.anchor)
  const focus = editor.resolveTextPosition(selection.focus)

  return [
    anchor.blockId,
    anchor.runId,
    anchor.graphemeIndex,
    focus.blockId,
    focus.runId,
    focus.graphemeIndex
  ].join(':')
}

/** 计算浮动工具栏的锚点位置。 */
export function readFloatingToolbarPosition(
  editor: Editor,
  editorHost: HTMLElement,
  selection: SelectionState
): SelectionActionPosition | null {
  const rects = editor.getSelectionRects(selection.range)
  const topRect = rects[0]

  if (topRect === undefined) {
    return readFallbackFloatingToolbarPosition(editorHost)
  }

  const pageElement = editorHost.querySelector<HTMLElement>(`[data-jword-page="${topRect.pageIndex}"]`)

  if (pageElement === null) {
    return readFallbackFloatingToolbarPosition(editorHost)
  }

  const hostRect = editorHost.getBoundingClientRect()
  const pageRect = pageElement.getBoundingClientRect()
  const scale = editor.getPageConfig().scale
  const left = pageRect.left - hostRect.left + twipsToCssPx(topRect.x + topRect.width / 2, scale)
  const top = pageRect.top - hostRect.top + twipsToCssPx(topRect.y, scale)

  return {
    left: clampPosition(left, 16, Math.max(16, editorHost.clientWidth - 16)),
    top: Math.max(12, top)
  }
}

/** 在测试环境或首次布局前无法读取选区矩形时，回退到 editor 顶部居中。 */
function readFallbackFloatingToolbarPosition(editorHost: HTMLElement): SelectionActionPosition {
  return {
    left: Math.max(16, editorHost.clientWidth / 2),
    top: 12
  }
}

/** 计算右键菜单在 editorHost 内的绝对定位。 */
export function readContextMenuPosition(
  editorHost: HTMLElement,
  point: SelectionActionPosition | null
): SelectionActionPosition | null {
  if (point === null) {
    return null
  }

  const hostRect = editorHost.getBoundingClientRect()
  const localLeft = point.left - hostRect.left
  const localTop = point.top - hostRect.top

  return {
    left: clampPosition(localLeft, 12, Math.max(12, editorHost.clientWidth - 236)),
    top: clampPosition(localTop, 12, Math.max(12, editorHost.clientHeight - 280))
  }
}

/** 组装 selection-actions 的最小渲染状态。 */
export function buildSelectionActionsViewState(input: Readonly<{
  editor: Editor
  editorHost: HTMLElement
  interactiveFocus: boolean
  dismissedSelectionKey: string | null
  contextSelection: SelectionState | null
  contextPoint: SelectionActionPosition | null
  stickyFloatingToolbar: StickyFloatingToolbarState
}>): SelectionActionsViewState {
  const currentSelection = input.editor.getSelection()
  const currentSelectionKey = readSelectionKey(input.editor, currentSelection)
  const usesStickyFloatingPosition =
    currentSelectionKey.length > 0
    && currentSelectionKey === input.stickyFloatingToolbar.selectionKey
    && input.stickyFloatingToolbar.position !== null
  const floatingVisible =
    input.interactiveFocus
    && input.contextPoint === null
    && hasActiveTextSelection(currentSelection)
    && currentSelectionKey.length > 0
    && currentSelectionKey !== input.dismissedSelectionKey
  const floatingFormatting = floatingVisible && currentSelection !== null
    ? readSelectionFormattingState(input.editor, currentSelection)
    : null
  const floatingPosition = !floatingVisible || currentSelection === null
    ? null
    : usesStickyFloatingPosition
      ? input.stickyFloatingToolbar.position
      : readFloatingToolbarPosition(input.editor, input.editorHost, currentSelection)
  const contextFormatting = input.contextSelection === null
    ? null
    : readSelectionFormattingState(input.editor, input.contextSelection)

  return {
    floatingVisible: floatingVisible && floatingPosition !== null,
    floatingPosition,
    contextMenuVisible: input.interactiveFocus && input.contextPoint !== null,
    contextMenuPosition: readContextMenuPosition(input.editorHost, input.contextPoint),
    contextSelectionKey: readSelectionKey(input.editor, input.contextSelection),
    formatEnabled: floatingFormatting?.run !== null,
    boldPressed: readPressedState(floatingFormatting?.run?.bold),
    italicPressed: readPressedState(floatingFormatting?.run?.italic),
    underlinePressed: readPressedState(floatingFormatting?.run?.underline),
    strikePressed: readPressedState(floatingFormatting?.run?.strike),
    textColorValue: normalizeHexColor(floatingFormatting?.run?.color.value ?? '') ?? DEFAULT_TEXT_COLOR,
    backgroundColorValue: normalizeHexColor(floatingFormatting?.run?.backgroundColor.value ?? '') ?? DEFAULT_BACKGROUND_COLOR,
    cutDisabled: contextFormatting?.run === null,
    copyDisabled: contextFormatting?.run === null,
    clearDisabled: contextFormatting?.run === null
  }
}

/** 判断 document.activeElement 是否仍在 editor 或 selection-actions 交互区内。 */
export function readInteractiveFocus(
  editorHost: HTMLElement,
  selectionActionsHost: HTMLElement,
  activeElement: Element | null
): boolean {
  return activeElement !== null
    && (editorHost.contains(activeElement) || selectionActionsHost.contains(activeElement))
}

/** 把 formatting state 的 run 聚合值映射成按钮按压态。 */
function readPressedState(value: FormattingStateValue<boolean> | undefined): ToolbarPressedState {
  if (value === undefined) {
    return 'false'
  }

  if (value.mixed) {
    return 'mixed'
  }

  return value.value === true ? 'true' : 'false'
}

/** 钳制弹层位置，避免越过 editorHost 可视边界。 */
function clampPosition(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
