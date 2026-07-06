/**
 * 职责：封装 UI 面板滚动到正文范围的共享几何换算。
 * 边界：只读取 editor layout、selection rect 和 canvas 宿主，不创建业务 UI。
 * 协作模块：heading-outline-setup、find-replace 装配与 comments-rail 共享正文定位逻辑。
 * 性能/安全约束：仅在用户导航或显式刷新时读取 layout，事务热路径避免无条件调用。
 * Specs：docs/superpowers/reports/2026-07-03-remediation-execution-supplement.md#310-phase-5-超大文件拆分目标结构。
 */
import {
  createSelectionState,
  twipsToCssPx,
  type Editor,
  type RangeRef,
  type TextRange
} from '@4xian/jword-core'

/** 滚动到指定文本范围所在页。 */
export function scrollTextRangeIntoView(
  editor: Editor,
  editorHost: HTMLElement | undefined,
  range: TextRange
): void {
  if (editorHost === undefined) {
    return
  }

  const canvasContainer = editorHost.querySelector<HTMLElement>('[data-jword-canvas-container]')

  if (canvasContainer === null) {
    return
  }

  const selection = createSelectionState(
    editor.createTextAnchor(range.anchor),
    editor.createTextAnchor(range.focus)
  )
  const geometry = resolveTextRangeGeometry(editor, canvasContainer, selection.range)

  if (geometry === null) {
    return
  }

  const top = Math.max(0, geometry.scrollTop - Math.round(canvasContainer.clientHeight * 0.32))

  if (typeof canvasContainer.scrollTo === 'function') {
    canvasContainer.scrollTo({
      top,
      behavior: 'smooth'
    })
    return
  }

  canvasContainer.scrollTop = top
}

/** 解析文本范围对应的页内和滚动内容几何。 */
export function resolveTextRangeGeometry(
  editor: Editor,
  canvasContainer: HTMLElement,
  range: RangeRef
): Readonly<{ pageIndex: number, pageTop: number, scrollTop: number }> | null {
  const rect = editor.getSelectionRects(range)[0] ?? editor.getCaretRect(range.anchor)

  if (rect === undefined) {
    return null
  }

  const layout = editor.getLayout()
  const page = layout.pages[rect.pageIndex]
  if (page === undefined) {
    return null
  }

  const pageElement = canvasContainer.querySelector<HTMLElement>(`[data-jword-page="${page.pageIndex}"]`)
  const pageTop = twipsToCssPx(rect.y - page.y, editor.getPageConfig().scale)
  const scrollTop = pageElement === null
    ? twipsToCssPx(rect.y, editor.getPageConfig().scale)
    : pageElement.offsetTop + pageTop

  return {
    pageIndex: page.pageIndex,
    pageTop,
    scrollTop
  }
}
