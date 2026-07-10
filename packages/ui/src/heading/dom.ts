/**
 * 职责：创建 Gate 4 基础目录面板的轻量 DOM。
 * 边界：只创建和刷新节点，不读取 editor、不执行跳转、不访问外部宿主状态。
 * 协作模块：heading controller 提供目录项和点击处理函数。
 * 性能/安全约束：使用普通按钮列表，不使用 grid / gap，不保存 projection 副本。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import type { HeadingOutlineItem } from '@4xian/jword-core'
import {
  readJWordUiText,
  resolveJWordUiI18n,
  type ResolvedJWordUiI18n
} from '../i18n'

const HEADING_OUTLINE_LEVEL_INDENT_PX = 14

export interface HeadingOutlineDom {
  readonly host: HTMLElement
  readonly list: HTMLElement
}

interface HeadingOutlineRenderItem {
  readonly item: HeadingOutlineItem
  readonly hidden: boolean
  readonly expanded: boolean
  readonly expandable: boolean
}

/**
 * 创建基础目录面板 DOM。
 */
export function createHeadingOutlineDom(
  host: HTMLElement,
  i18n: ResolvedJWordUiI18n = resolveJWordUiI18n()
): HeadingOutlineDom {
  const list = document.createElement('div')

  list.className = 'jw-heading-outline jw-heading-outline--sidebar'
  list.setAttribute('data-jword-heading-outline', 'true')
  list.setAttribute('data-jword-heading-outline-sidebar', 'true')
  list.setAttribute('role', 'tree')
  list.setAttribute('aria-label', readHeadingOutlineText(i18n, 'ariaLabel', '文档目录'))
  list.hidden = true
  host.append(list)

  return {
    host,
    list
  }
}

/** 动态刷新目录面板静态文案。 */
export function localizeHeadingOutlineDom(dom: HeadingOutlineDom, i18n: ResolvedJWordUiI18n): void {
  dom.list.setAttribute('aria-label', readHeadingOutlineText(i18n, 'ariaLabel', '文档目录'))
}

/**
 * 刷新目录项按钮列表。
 */
export function renderHeadingOutlineDom(
  dom: HeadingOutlineDom,
  items: readonly HeadingOutlineItem[],
  activeItemId: string | null,
  collapsedItemIds: ReadonlySet<string>,
  onActivate: (item: HeadingOutlineItem) => void,
  onToggle: (item: HeadingOutlineItem) => void,
  i18n: ResolvedJWordUiI18n = resolveJWordUiI18n()
): void {
  const renderItems = buildHeadingOutlineRenderItems(items, collapsedItemIds)

  dom.list.replaceChildren(...renderItems.map((item) => createHeadingOutlineRow(item, activeItemId, onActivate, onToggle, i18n)))
}

/**
 * 销毁目录面板 DOM。
 */
export function destroyHeadingOutlineDom(dom: HeadingOutlineDom): void {
  dom.list.remove()
}

/**
 * 创建单个目录树行。
 */
function createHeadingOutlineRow(
  renderItem: HeadingOutlineRenderItem,
  activeItemId: string | null,
  onActivate: (item: HeadingOutlineItem) => void,
  onToggle: (item: HeadingOutlineItem) => void,
  i18n: ResolvedJWordUiI18n
): HTMLElement {
  const row = document.createElement('div')
  const toggle = document.createElement('button')
  const button = document.createElement('button')
  const { item } = renderItem

  row.className = 'jw-heading-outline__row'
  row.hidden = renderItem.hidden
  row.setAttribute('role', 'treeitem')
  row.setAttribute('aria-level', String(item.level))
  row.setAttribute('data-jword-heading-outline-item', item.id)
  row.setAttribute('data-jword-heading-level', String(item.level))
  row.setAttribute('data-jword-heading-expanded', String(renderItem.expanded))
  row.style.paddingLeft = `${resolveHeadingOutlineIndent(item.level)}px`
  if (renderItem.expandable) {
    row.setAttribute('aria-expanded', String(renderItem.expanded))
  }
  if (item.id === activeItemId) {
    row.setAttribute('aria-current', 'true')
  }

  toggle.type = 'button'
  toggle.className = 'jw-heading-outline__toggle'
  toggle.disabled = !renderItem.expandable
  toggle.setAttribute('aria-label', renderItem.expanded
    ? readHeadingOutlineText(i18n, 'collapseItem', '折叠目录项')
    : readHeadingOutlineText(i18n, 'expandItem', '展开目录项'))
  toggle.setAttribute('data-jword-heading-outline-toggle', 'true')
  toggle.addEventListener('click', () => {
    onToggle(item)
  })
  button.type = 'button'
  button.className = 'jw-heading-outline__item'
  button.textContent = item.title
  button.setAttribute('data-jword-heading-outline-activate', 'true')
  button.addEventListener('click', () => {
    onActivate(item)
  })

  row.append(toggle, button)

  return row
}

/** 读取目录面板文案。 */
function readHeadingOutlineText(i18n: ResolvedJWordUiI18n, key: string, fallback: string): string {
  return readJWordUiText(i18n, `menu.headingOutline.${key}`, fallback)
}

/** 根据标题层级计算目录行缩进。 */
function resolveHeadingOutlineIndent(level: number): number {
  return Math.max(0, level - 1) * HEADING_OUTLINE_LEVEL_INDENT_PX
}

/** 构造带折叠可见性的目录渲染项。 */
function buildHeadingOutlineRenderItems(
  items: readonly HeadingOutlineItem[],
  collapsedItemIds: ReadonlySet<string>
): readonly HeadingOutlineRenderItem[] {
  const hiddenLevels: number[] = []

  return items.map((item, index) => {
    while (hiddenLevels.length > 0 && item.level <= (hiddenLevels.at(-1) ?? 0)) {
      hiddenLevels.pop()
    }

    const hidden = hiddenLevels.length > 0
    const expandable = hasNestedHeading(items, index)
    const expanded = expandable && !collapsedItemIds.has(item.id)

    if (expandable && !expanded) {
      hiddenLevels.push(item.level)
    }

    return {
      item,
      hidden,
      expanded,
      expandable
    }
  })
}

/** 判断当前目录项后续是否存在更深层级子项。 */
function hasNestedHeading(items: readonly HeadingOutlineItem[], index: number): boolean {
  const item = items[index]
  const nextItem = items[index + 1]

  return item !== undefined && nextItem !== undefined && nextItem.level > item.level
}
