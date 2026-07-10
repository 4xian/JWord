/**
 * 职责：封装 createJWordUi 的正文链接 overlay、链接命中读取和 toolbar 可用态同步。
 * 边界：只读 projection/layout 并调用 link controller 传入的激活回调，不直接打开外部链接。
 * 协作模块：ui-lifecycle、link/controller 与 selection-actions/controller 共同完成链接交互。
 * 性能/安全约束：空链接文档不读取 layout；链接写入仍由 ui-lifecycle 走 core command pipeline。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import {
  createSelectionState,
  twipsToCssPx,
  type Block,
  type Editor,
  type Paragraph,
  type Run,
  type SelectionState
} from '@4xian/jword-core'

import type { JWordLinkDraft, LinkControllerHandle } from './link/types'
import { findRunById, readRunPlainText } from './text-projection'
import type { JWordToolbarControlElement, JWordToolbarToolId } from './types'

export interface LinkAnchorOverlay {
  sync(): void
  destroy(): void
}

export interface LinkRunTarget {
  readonly selection: SelectionState
  readonly draft: JWordLinkDraft
}

/** 创建正文链接锚点 overlay。 */
export function createLinkAnchorOverlay(
  editor: Editor,
  editorHost: HTMLElement,
  onActivate: (target: LinkRunTarget, event: MouseEvent) => void
): LinkAnchorOverlay | null {
  const canvasContainer = editorHost.querySelector<HTMLElement>('[data-jword-canvas-container]')

  if (canvasContainer === null) {
    return null
  }

  const overlay = document.createElement('div')
  const signalController = new AbortController()

  overlay.className = 'jw-link-anchor-overlay'
  overlay.setAttribute('data-jword-link-anchor-overlay', 'true')
  canvasContainer.style.position = canvasContainer.style.position || 'relative'
  canvasContainer.append(overlay)
  overlay.addEventListener('click', (event) => {
    activateLinkOverlayTarget(editor, overlay, event, onActivate)
  }, { signal: signalController.signal })
  overlay.addEventListener('contextmenu', (event) => {
    event.preventDefault()
    activateLinkOverlayTarget(editor, overlay, event, onActivate)
  }, { signal: signalController.signal })

  return {
    sync(): void {
      renderLinkAnchorOverlay(editor, canvasContainer, overlay)
    },
    destroy(): void {
      signalController.abort()
      overlay.remove()
    }
  }
}

/** 激活点击命中的链接 overlay 目标。 */
function activateLinkOverlayTarget(
  editor: Editor,
  overlay: HTMLElement,
  event: MouseEvent,
  onActivate: (target: LinkRunTarget, event: MouseEvent) => void
): void {
  const targetElement = event.target instanceof HTMLElement
    ? event.target.closest<HTMLElement>('[data-jword-link-target-index]')
    : null

  if (targetElement === null || !overlay.contains(targetElement)) {
    return
  }

  const target = readLinkOverlayTarget(editor, targetElement)

  if (target !== null) {
    onActivate(target, event)
  }
}

/** 渲染正文链接锚点 overlay。 */
function renderLinkAnchorOverlay(
  editor: Editor,
  canvasContainer: HTMLElement,
  overlay: HTMLElement
): void {
  const targets = collectLinkOverlayTargets(editor)

  if (targets.length === 0) {
    overlay.replaceChildren()
    return
  }

  const layout = editor.getLayout()
  const scale = editor.getPageConfig().scale
  const children: HTMLElement[] = []

  for (const [targetIndex, target] of targets.entries()) {
    const rects = editor.getSelectionRects(target.selection.range)
    const markerIndex = Math.max(0, rects.length - 1)

    for (const [rectIndex, rect] of rects.entries()) {
      const page = layout.pages[rect.pageIndex]
      const pageElement = page === undefined
        ? null
        : canvasContainer.querySelector<HTMLElement>(`[data-jword-page="${page.pageIndex}"]`)

      if (page === undefined || pageElement === null) {
        continue
      }

      children.push(createLinkAnchorOverlayRect(
        targetIndex,
        pageElement,
        page,
        rect,
        scale,
        rectIndex === markerIndex
      ))
    }
  }

  overlay.style.width = `${canvasContainer.scrollWidth}px`
  overlay.style.height = `${canvasContainer.scrollHeight}px`
  overlay.replaceChildren(...children)
}

/** 创建单个链接锚点矩形。 */
export function createLinkAnchorOverlayRect(
  targetIndex: number,
  pageElement: HTMLElement,
  page: NonNullable<ReturnType<Editor['getLayout']>['pages'][number]>,
  rect: ReturnType<Editor['getSelectionRects']>[number],
  scale: number,
  withMarker: boolean
): HTMLElement {
  const target = document.createElement('button')

  target.type = 'button'
  target.className = 'jw-link-anchor-overlay__rect'
  target.style.left = `${pageElement.offsetLeft + twipsToCssPx(rect.x - page.x, scale)}px`
  target.style.top = `${pageElement.offsetTop + twipsToCssPx(rect.y - page.y, scale)}px`
  target.style.width = `${twipsToCssPx(rect.width, scale)}px`
  target.style.height = `${twipsToCssPx(rect.height, scale)}px`
  target.setAttribute('aria-label', '链接')
  target.setAttribute('data-jword-link-target-index', String(targetIndex))

  if (withMarker) {
    const marker = document.createElement('span')

    marker.className = 'jw-link-anchor-overlay__marker'
    marker.textContent = '链'
    target.append(marker)
  }

  return target
}

/** 从 overlay 索引还原链接目标。 */
export function readLinkOverlayTarget(editor: Editor, targetElement: HTMLElement): LinkRunTarget | null {
  const targetIndex = Number(targetElement.getAttribute('data-jword-link-target-index'))

  if (!Number.isInteger(targetIndex)) {
    return null
  }

  return collectLinkOverlayTargets(editor)[targetIndex] ?? null
}

/** 收集 projection 中连续链接 run 的 overlay 目标。 */
function collectLinkOverlayTargets(editor: Editor): readonly LinkRunTarget[] {
  const projection = editor.getProjection()
  const targets: LinkRunTarget[] = []

  for (const section of projection.document.sections) {
    collectLinkOverlayTargetsFromBlocks(editor, section.id, section.blocks, targets)
  }

  return Object.freeze(targets)
}

/** 递归收集块树内的链接 overlay 目标。 */
function collectLinkOverlayTargetsFromBlocks(
  editor: Editor,
  sectionId: string,
  blocks: readonly Block[],
  targets: LinkRunTarget[]
): void {
  for (const block of blocks) {
    if (block.kind === 'paragraph') {
      collectParagraphLinkOverlayTargets(editor, sectionId, block, targets)
      continue
    }

    for (const row of block.rows) {
      for (const cell of row.cells) {
        collectLinkOverlayTargetsFromBlocks(editor, sectionId, cell.blocks, targets)
      }
    }
  }
}

/** 把段落内连续的同链接 run 合并成一个可点击目标。 */
function collectParagraphLinkOverlayTargets(
  editor: Editor,
  sectionId: string,
  paragraph: Paragraph,
  targets: LinkRunTarget[]
): void {
  let group: Run[] = []

  for (const run of paragraph.runs) {
    if (run.link === undefined) {
      flushLinkGroup(editor, sectionId, paragraph.id, group, targets)
      group = []
      continue
    }

    const previous = group[group.length - 1]

    if (previous !== undefined && !areRunLinksEqual(previous, run)) {
      flushLinkGroup(editor, sectionId, paragraph.id, group, targets)
      group = []
    }

    group.push(run)
  }

  flushLinkGroup(editor, sectionId, paragraph.id, group, targets)
}

/** 把连续链接 run 组转成 overlay 目标。 */
function flushLinkGroup(
  editor: Editor,
  sectionId: string,
  blockId: string,
  group: readonly Run[],
  targets: LinkRunTarget[]
): void {
  const firstRun = group[0]
  const lastRun = group[group.length - 1]

  if (firstRun?.link === undefined || lastRun === undefined) {
    return
  }

  const visibleText = group.map(readRunPlainText).join('')

  if (visibleText.length === 0) {
    return
  }

  const selection = createSelectionState(
    editor.createTextAnchor({
      sectionId,
      blockId,
      runId: firstRun.id,
      graphemeIndex: 0
    }),
    editor.createTextAnchor({
      sectionId,
      blockId,
      runId: lastRun.id,
      graphemeIndex: countRunGraphemes(lastRun)
    })
  )

  targets.push({
    selection,
    draft: {
      visibleText,
      url: firstRun.link.target,
      tooltip: firstRun.link.tooltip ?? ''
    }
  })
}

/** 判断两个 run 的链接元数据是否相同。 */
function areRunLinksEqual(left: Run, right: Run): boolean {
  return left.link?.target === right.link?.target
    && (left.link?.tooltip ?? '') === (right.link?.tooltip ?? '')
}

/** 读取 run 的 grapheme 数。 */
function countRunGraphemes(run: Run): number {
  return Array.from(readRunPlainText(run)).length
}

/** 同步当前 selection 命中的链接给 link quick tools。 */
export function syncActiveLink(handle: LinkControllerHandle | null, editor: Editor): void {
  handle?.setActiveLink(readActiveLinkDraftFromSelection(editor, editor.getSelection()))
}

/** 根据当前链接命中态禁用顶部插入链接入口。 */
export function syncToolbarLinkInsertAvailability(
  toolbar: { readonly elements: { readonly controls: Partial<Record<JWordToolbarToolId, JWordToolbarControlElement>> } },
  editor: Editor,
  readonly: boolean
): void {
  const control = toolbar.elements.controls['insert.link']

  if (!(control instanceof HTMLButtonElement)) {
    return
  }

  const disabled = readonly || readActiveLinkDraftFromSelection(editor, editor.getSelection()) !== null

  control.disabled = disabled
  control.setAttribute('aria-disabled', String(disabled))
}

/** 从当前 selection 读取活动链接草稿。 */
export function readActiveLinkDraftFromSelection(editor: Editor, selection: SelectionState | null): JWordLinkDraft | null {
  if (selection === null) {
    return null
  }

  const position = editor.resolveTextPosition(selection.focus)
  const run = findRunById(editor.getProjection(), position.runId)

  if (run?.link === undefined) {
    return null
  }

  return {
    visibleText: readRunPlainText(run),
    url: run.link.target,
    tooltip: run.link.tooltip ?? ''
  }
}

