/**
 * 职责：创建 Gate 4 修订 metadata 面板 DOM 并渲染列表与单条接受/拒绝按钮。
 * 边界：只负责节点结构和列表渲染，不读取 editor、不创建 selection、不执行命令。
 * 协作模块：revisions controller 负责 projection 读取和点击定位。
 * 性能/安全约束：使用 flex 友好的线性 DOM，不使用 grid / gap，不保存文档状态。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import type { RevisionMetadata } from '@4xian/jword-core'
import {
  readJWordUiText,
  resolveJWordUiI18n,
  type ResolvedJWordUiI18n
} from '../i18n'
import type { JWordRevisionPanelElements } from '../types'

export interface RevisionPanelRenderState {
  readonly revisions: readonly RevisionMetadata[]
  readonly selectedId: string | null
}

/**
 * 创建修订面板 DOM。
 */
export function createRevisionPanelDom(
  host: HTMLElement,
  i18n: ResolvedJWordUiI18n = resolveJWordUiI18n()
): JWordRevisionPanelElements {
  const root = document.createElement('section')
  const header = document.createElement('div')
  const title = document.createElement('h2')
  const closeButton = document.createElement('button')
  const list = document.createElement('div')
  const emptyState = document.createElement('p')

  root.className = 'jw-revisions-panel'
  root.setAttribute('data-jword-revisions-panel', 'true')
  root.hidden = true

  header.className = 'jw-revisions-panel__header'
  title.className = 'jw-revisions-panel__title'
  title.textContent = readRevisionsText(i18n, 'title')
  closeButton.type = 'button'
  closeButton.className = 'jw-revisions-panel__close'
  closeButton.textContent = '×'
  setButtonLabel(closeButton, readRevisionsText(i18n, 'close'))

  list.className = 'jw-revisions-panel__list'
  list.setAttribute('data-jword-revision-list', 'true')

  emptyState.className = 'jw-revisions-panel__empty'
  emptyState.textContent = readRevisionsText(i18n, 'empty')

  header.append(title, closeButton)
  root.append(header, list, emptyState)
  host.append(root)

  return {
    host,
    root,
    title,
    closeButton,
    list,
    emptyState
  }
}

/**
 * 渲染修订面板列表。
 */
export function renderRevisionPanel(
  elements: JWordRevisionPanelElements,
  state: RevisionPanelRenderState,
  i18n: ResolvedJWordUiI18n = resolveJWordUiI18n()
): void {
  elements.list.replaceChildren(...state.revisions.map((revision) => createRevisionItem(revision, state.selectedId, i18n)))
  elements.emptyState.hidden = state.revisions.length > 0
}

/** 动态刷新修订面板静态文案。 */
export function localizeRevisionPanelDom(
  elements: JWordRevisionPanelElements,
  i18n: ResolvedJWordUiI18n
): void {
  elements.title.textContent = readRevisionsText(i18n, 'title')
  setButtonLabel(elements.closeButton, readRevisionsText(i18n, 'close'))
  elements.emptyState.textContent = readRevisionsText(i18n, 'empty')
}

/**
 * 销毁修订面板 DOM。
 */
export function destroyRevisionPanelDom(elements: JWordRevisionPanelElements): void {
  elements.root.remove()
}

/** 创建单条修订列表项。 */
function createRevisionItem(
  revision: RevisionMetadata,
  selectedId: string | null,
  i18n: ResolvedJWordUiI18n
): HTMLElement {
  const item = document.createElement('article')
  const button = document.createElement('button')
  const type = document.createElement('span')
  const summary = document.createElement('span')
  const meta = document.createElement('span')
  const actions = document.createElement('span')
  const acceptButton = document.createElement('button')
  const rejectButton = document.createElement('button')

  item.className = 'jw-revisions-panel__item'
  item.setAttribute('data-jword-revision-row', 'true')

  button.type = 'button'
  button.className = 'jw-revisions-panel__summary-button'
  button.setAttribute('data-jword-revision-item', 'true')
  button.setAttribute('data-jword-revision-id', revision.id)
  button.setAttribute('aria-pressed', revision.id === selectedId ? 'true' : 'false')

  type.className = 'jw-revisions-panel__type'
  type.textContent = readRevisionTypeLabel(i18n, revision.type)

  summary.className = 'jw-revisions-panel__summary'
  summary.textContent = revision.summary

  meta.className = 'jw-revisions-panel__meta'
  meta.textContent = `${revision.authorId} · ${revision.createdAt}`

  actions.className = 'jw-revisions-panel__actions'

  acceptButton.type = 'button'
  acceptButton.className = 'jw-revisions-panel__action'
  acceptButton.setAttribute('data-jword-revision-accept', 'true')
  acceptButton.setAttribute('data-jword-revision-id', revision.id)
  acceptButton.textContent = readRevisionsText(i18n, 'accept')

  rejectButton.type = 'button'
  rejectButton.className = 'jw-revisions-panel__action'
  rejectButton.setAttribute('data-jword-revision-reject', 'true')
  rejectButton.setAttribute('data-jword-revision-id', revision.id)
  rejectButton.textContent = readRevisionsText(i18n, 'reject')

  button.append(type, summary, meta)
  actions.append(acceptButton, rejectButton)
  item.append(button, actions)

  return item
}

/** 读取修订类型文案。 */
function readRevisionTypeLabel(i18n: ResolvedJWordUiI18n, type: RevisionMetadata['type']): string {
  switch (type) {
    case 'insert':
      return readRevisionsText(i18n, 'typeInsert')
    case 'delete':
      return readRevisionsText(i18n, 'typeDelete')
    case 'format':
      return readRevisionsText(i18n, 'typeFormat')
  }
}

/** 读取修订面板文案。 */
function readRevisionsText(i18n: ResolvedJWordUiI18n, key: string): string {
  return readJWordUiText(i18n, `menu.revisions.${key}`)
}

/** 同步图标按钮的可访问名称和悬浮提示。 */
function setButtonLabel(button: HTMLButtonElement, label: string): void {
  button.title = label
  button.setAttribute('aria-label', label)
}
