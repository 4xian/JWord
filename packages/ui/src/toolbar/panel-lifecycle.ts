/**
 * 职责：封装 toolbar 扩展宿主与面板关闭生命周期。
 * 边界：只管理 toolbar 面板 DOM 显隐与宿主容器，不执行任何编辑命令。
 * 协作模块：controller 负责生命周期编排，insert/panel 控件动作复用这里的面板关闭规则。
 * 性能/安全约束：不读取文档正文，不访问 core 状态。
 * Specs：docs/superpowers/reports/2026-07-03-remediation-execution-supplement.md#310-phase-5-超大文件拆分目标结构。
 */

export interface ToolbarPanelActionOptions {
  readonly readonlyEnabled: boolean
  readonly readonlyAllowNavigation: boolean
  readonly panelState?: {
    readonly headingOutline?: () => boolean
    readonly headingOutlineAvailable?: () => boolean
  } | undefined
  readonly panelActions?: {
    readonly toggleFindReplace?: () => void
    readonly toggleHeadingOutline?: () => void
    readonly toggleHeaderFooter?: (anchor: HTMLElement) => void
    readonly toggleFooter?: (anchor: HTMLElement) => void
    readonly togglePageNumber?: (anchor: HTMLElement) => void
    readonly toggleRevisions?: () => void
  } | undefined
  announce(message: string): void
  render(): void
}

/** 为 Gate 4 扩展入口补一个挂到 toolbar bar 末尾的独立分组。 */
export function createToolbarExtensionHost(bar: HTMLElement, kind: 'media' | 'table' | 'link' | 'panel'): HTMLElement {
  const group = document.createElement('div')

  group.className = kind === 'panel'
    ? 'jw-toolbar__group jw-toolbar__group--overlay'
    : 'jw-toolbar__group'
  group.setAttribute(`data-jword-${kind}-host`, 'true')
  bar.append(group)

  return group
}

/** 绑定点击 toolbar 与浮层外部时关闭当前打开面板的监听。 */
export function bindToolbarPanelDismissal(
  host: HTMLElement,
  panelHost: HTMLElement | null,
  signal: AbortSignal
): void {
  const closeToolbarPanelsOnOutsideEvent = (event: Event) => {
    const target = event.target

    if (!(target instanceof Node) || host.contains(target) || isToolbarPanelTarget(target)) {
      return
    }

    closeVisibleToolbarPanels(panelHost)
  }

  host.ownerDocument.addEventListener('pointerdown', closeToolbarPanelsOnOutsideEvent, { signal })
  host.ownerDocument.addEventListener('click', closeToolbarPanelsOnOutsideEvent, { signal })
}

/** 读取目录按钮当前是否有可打开的目录项。 */
export function readHeadingOutlineAvailable(options: ToolbarPanelActionOptions): boolean {
  return options.panelState?.headingOutlineAvailable?.() === true
}

/** 读取目录面板当前是否处于打开状态。 */
export function readHeadingOutlineActive(options: ToolbarPanelActionOptions): boolean {
  return options.panelState?.headingOutline?.() === true
}

/** 切换查找替换面板。 */
export function toggleFindReplacePanel(options: ToolbarPanelActionOptions): void {
  if (options.readonlyEnabled && !options.readonlyAllowNavigation) {
    options.announce('当前为只读模式。')
    return
  }

  options.panelActions?.toggleFindReplace?.()
  options.render()
}

/** 切换目录面板。 */
export function toggleHeadingOutlinePanel(options: ToolbarPanelActionOptions): void {
  if (options.readonlyEnabled && !options.readonlyAllowNavigation) {
    options.announce('当前为只读模式。')
    return
  }

  if (!readHeadingOutlineAvailable(options)) {
    options.render()
    return
  }

  options.panelActions?.toggleHeadingOutline?.()
  options.render()
}

/** 切换页眉页脚面板。 */
export function toggleHeaderFooterPanel(options: ToolbarPanelActionOptions, control: HTMLElement): void {
  if (options.readonlyEnabled) {
    options.announce('当前为只读模式。')
    return
  }

  options.panelActions?.toggleHeaderFooter?.(control)
  options.render()
}

/** 切换页脚面板。 */
export function toggleFooterPanel(options: ToolbarPanelActionOptions, control: HTMLElement): void {
  if (options.readonlyEnabled) {
    options.announce('当前为只读模式。')
    return
  }

  options.panelActions?.toggleFooter?.(control)
  options.render()
}

/** 切换页码面板。 */
export function togglePageNumberPanel(options: ToolbarPanelActionOptions, control: HTMLElement): void {
  if (options.readonlyEnabled) {
    options.announce('当前为只读模式。')
    return
  }

  options.panelActions?.togglePageNumber?.(control)
  options.render()
}

/** 切换修订面板。 */
export function toggleRevisionsPanel(options: ToolbarPanelActionOptions): void {
  if (options.readonlyEnabled) {
    options.announce('当前为只读模式。')
    return
  }

  options.panelActions?.toggleRevisions?.()
  options.render()
}

/** 判断事件目标是否落在 toolbar 管理的面板内部。 */
function isToolbarPanelTarget(target: Node): boolean {
  return target instanceof Element && target.closest(readToolbarPanelSelector()) !== null
}

/** 关闭当前 toolbar 相关的可见面板。 */
function closeVisibleToolbarPanels(panelHost: HTMLElement | null): void {
  closeToolbarPanelHostChildren(panelHost)
}

/** 关闭挂在 toolbar overlay host 里的面板。 */
function closeToolbarPanelHostChildren(panelHost: HTMLElement | null): void {
  if (panelHost === null) {
    return
  }

  const panels = panelHost.querySelectorAll<HTMLElement>(
    '[data-jword-find-replace], [data-jword-header-footer], [data-jword-revisions-panel]'
  )

  for (const panel of panels) {
    panel.hidden = true
  }

  for (const menu of panelHost.querySelectorAll<HTMLElement>(
    '[data-jword-header-menu], [data-jword-footer-menu], [data-jword-header-footer-menu], [data-jword-page-number-menu]'
  )) {
    menu.hidden = true
  }
}

/** 读取所有 toolbar 弹出面板选择器。 */
function readToolbarPanelSelector(): string {
  return [
    '[data-jword-find-replace]',
    '[data-jword-header-footer]',
    '[data-jword-revisions-panel]'
  ].join(', ')
}
