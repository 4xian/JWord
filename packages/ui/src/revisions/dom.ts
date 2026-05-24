/**
 * 职责：创建 Gate 4 修订 metadata 面板 DOM 并渲染只读列表。
 * 边界：只负责节点结构和列表渲染，不读取 editor、不创建 selection、不执行命令。
 * 协作模块：revisions controller 负责 projection 读取和点击定位。
 * 性能/安全约束：使用 flex 友好的线性 DOM，不使用 grid / gap，不保存文档状态。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md Step 4.14。
 */

import type { RevisionMetadata } from '@4xian/jword-core'
import type { JWordRevisionPanelElements } from '../types'

export interface RevisionPanelRenderState {
  readonly revisions: readonly RevisionMetadata[]
  readonly selectedId: string | null
}

/**
 * 创建修订面板 DOM。
 */
export function createRevisionPanelDom(host: HTMLElement): JWordRevisionPanelElements {
  const root = document.createElement('section')
  const title = document.createElement('h2')
  const list = document.createElement('div')
  const emptyState = document.createElement('p')

  root.className = 'jw-revisions-panel'
  root.setAttribute('data-jword-revisions-panel', 'true')
  root.hidden = true

  title.className = 'jw-revisions-panel__title'
  title.textContent = '修订记录'

  list.className = 'jw-revisions-panel__list'
  list.setAttribute('data-jword-revision-list', 'true')

  emptyState.className = 'jw-revisions-panel__empty'
  emptyState.textContent = '暂无修订记录'

  root.append(title, list, emptyState)
  host.append(root)

  return {
    host,
    root,
    list,
    emptyState
  }
}

/**
 * 渲染修订面板列表。
 */
export function renderRevisionPanel(
  elements: JWordRevisionPanelElements,
  state: RevisionPanelRenderState
): void {
  elements.list.replaceChildren(...state.revisions.map((revision) => createRevisionButton(revision, state.selectedId)))
  elements.emptyState.hidden = state.revisions.length > 0
}

/**
 * 销毁修订面板 DOM。
 */
export function destroyRevisionPanelDom(elements: JWordRevisionPanelElements): void {
  elements.root.remove()
}

/** 创建单条修订列表按钮。 */
function createRevisionButton(revision: RevisionMetadata, selectedId: string | null): HTMLButtonElement {
  const button = document.createElement('button')
  const type = document.createElement('span')
  const summary = document.createElement('span')
  const meta = document.createElement('span')

  button.type = 'button'
  button.className = 'jw-revisions-panel__item'
  button.setAttribute('data-jword-revision-item', 'true')
  button.setAttribute('data-jword-revision-id', revision.id)
  button.setAttribute('aria-pressed', revision.id === selectedId ? 'true' : 'false')

  type.className = 'jw-revisions-panel__type'
  type.textContent = readRevisionTypeLabel(revision.type)

  summary.className = 'jw-revisions-panel__summary'
  summary.textContent = revision.summary

  meta.className = 'jw-revisions-panel__meta'
  meta.textContent = `${revision.authorId} · ${revision.createdAt}`

  button.append(type, summary, meta)

  return button
}

/** 读取修订类型文案。 */
function readRevisionTypeLabel(type: RevisionMetadata['type']): string {
  switch (type) {
    case 'insert':
      return '插入'
    case 'delete':
      return '删除'
    case 'format':
      return '格式'
  }
}
