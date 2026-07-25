/**
 * 职责：封装 toolbar 扩展宿主与面板关闭生命周期。
 * 边界：只管理 toolbar 面板 DOM 显隐与宿主容器，不执行任何编辑命令。
 * 协作模块：controller 负责生命周期编排，insert/panel 控件动作复用这里的面板关闭规则。
 * 性能/安全约束：不读取文档正文，不访问 core 状态。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import { readJWordUiText, type ResolvedJWordUiI18n } from '../i18n'
import type { JWordToolbarTabId } from '../types'
import type { ToolbarDom } from './dom'
import {
  bindToolbarButton,
  type ToolbarActionContext
} from './toolbar-state-sync'
import type { ToolbarWatermarkMenuControllerHandle } from './watermark-menu'

export interface ToolbarPanelActionOptions {
  readonly readonlyEnabled: boolean
  readonly readonlyAllowNavigation: boolean
  readonly panelState?: {
    readonly headingOutline?: () => boolean
    readonly headingOutlineAvailable?: () => boolean
    readonly revisions?: () => boolean
  } | undefined
  readonly panelActions?: {
    readonly toggleFindReplace?: (anchor: HTMLElement) => void
    readonly toggleHeadingOutline?: () => void
    readonly toggleHeaderFooter?: (anchor: HTMLElement) => void
    readonly toggleFooter?: (anchor: HTMLElement) => void
    readonly togglePageNumber?: (anchor: HTMLElement) => void
    readonly toggleRevisions?: () => void
  } | undefined
  readI18n(): ResolvedJWordUiI18n
  announce(message: string): void
  render(): void
}

type ToolbarExtensionHostKind = 'media' | 'table' | 'link' | 'panel' | 'plugin'

interface CreateToolbarExtensionHostsOptions {
  readonly toolbarHidden: boolean
  readonly linkEnabled: boolean
  readonly panelEnabled: boolean
}

export interface ToolbarExtensionHosts {
  readonly mediaHost: HTMLElement | null
  readonly tableHost: HTMLElement | null
  readonly linkHost: HTMLElement | null
  readonly panelHost: HTMLElement | null
}

/** 创建 toolbar 内建扩展入口宿主。 */
export function createToolbarExtensionHosts(
  dom: ToolbarDom,
  options: CreateToolbarExtensionHostsOptions
): ToolbarExtensionHosts {
  return {
    mediaHost: options.toolbarHidden ? null : createToolbarExtensionHost(dom, 'media'),
    tableHost: options.toolbarHidden ? null : createToolbarExtensionHost(dom, 'table'),
    linkHost: options.toolbarHidden || !options.linkEnabled ? null : createToolbarExtensionHost(dom, 'link'),
    panelHost: options.toolbarHidden || !options.panelEnabled ? null : createToolbarExtensionHost(dom, 'panel')
  }
}

/** 绑定文档面板和水印菜单入口。 */
export function bindPanelControls(
  context: ToolbarActionContext,
  options: ToolbarPanelActionOptions,
  watermarkMenu: ToolbarWatermarkMenuControllerHandle | null
): void {
  const { dom } = context

  bindToolbarButton(context, dom.controls['document.findReplace'], (control) => {
    toggleFindReplacePanel(options, control)
  }, { restoreEditorFocus: false })
  bindToolbarButton(context, dom.controls['document.watermark'], (control) => {
    watermarkMenu?.toggle(control)
  }, { restoreEditorFocus: false })
  bindToolbarButton(context, dom.controls['document.headingOutline'], () => {
    toggleHeadingOutlinePanel(options)
  }, { restoreEditorFocus: false })
  bindToolbarButton(context, dom.controls['document.headerFooter'], (control) => {
    toggleHeaderFooterPanel(options, control)
  }, { restoreEditorFocus: false })
  bindToolbarButton(context, dom.controls['document.footer'], (control) => {
    toggleFooterPanel(options, control)
  }, { restoreEditorFocus: false })
  bindToolbarButton(context, dom.controls['document.pageNumber'], (control) => {
    togglePageNumberPanel(options, control)
  }, { restoreEditorFocus: false })
  bindToolbarButton(context, dom.controls['document.revisions'], () => {
    toggleRevisionsPanel(options)
  }, { restoreEditorFocus: false })
}

/** 为 Gate 4 扩展入口创建归属 Tab 的稳定宿主。 */
export function createToolbarExtensionHost(dom: ToolbarDom, kind: ToolbarExtensionHostKind): HTMLElement {
  const group = dom.host.ownerDocument.createElement('div')
  const slot = readToolbarExtensionSlot(dom, kind)

  group.className = kind === 'panel'
    ? 'jw-toolbar__group jw-toolbar__group--overlay'
    : 'jw-toolbar__group'
  group.setAttribute(`data-jword-${kind}-host`, 'true')
  if (kind !== 'panel') {
    const tab = readToolbarExtensionTab(kind)

    group.setAttribute('data-jword-toolbar-extension-kind', kind)
    group.setAttribute('data-jword-toolbar-extension-tab', tab)
    if (shouldShowExtensionInCommonMode(kind)) {
      group.setAttribute('data-jword-toolbar-extension-common', 'true')
    }
  }
  slot.append(group)

  return group
}

/** 读取扩展入口所属的专业模式 Tab 槽位。 */
function readToolbarExtensionSlot(dom: ToolbarDom, kind: ToolbarExtensionHostKind): HTMLElement {
  if (kind === 'panel') {
    return dom.bar
  }

  const tabId = readToolbarExtensionTab(kind)

  if (
    dom.host.getAttribute('data-jword-toolbar-mode') === 'common'
    && dom.host.getAttribute('data-jword-toolbar-common-extensions') === 'true'
    && shouldShowExtensionInCommonMode(kind)
  ) {
    return dom.extensionSlots.common ?? dom.bar
  }

  return dom.extensionSlots[tabId] ?? dom.bar
}

/** 将扩展入口归类到专业模式 Tab。 */
function readToolbarExtensionTab(kind: Exclude<ToolbarExtensionHostKind, 'panel'>): JWordToolbarTabId {
  switch (kind) {
    case 'media':
    case 'link':
      return 'insert'
    case 'table':
      return 'table'
    case 'plugin':
      return 'tools'
  }
}

/** 判断扩展入口切到常用模式后是否仍作为默认常用入口显示。 */
function shouldShowExtensionInCommonMode(kind: Exclude<ToolbarExtensionHostKind, 'panel'>): boolean {
  return kind === 'media' || kind === 'table'
}

/** 绑定点击其他 toolbar 工具或浮层外部时关闭当前打开面板的监听。 */
export function bindToolbarPanelDismissal(
  host: HTMLElement,
  panelHosts: readonly (HTMLElement | null | undefined)[],
  signal: AbortSignal
): void {
  const closeToolbarPanelsOnOutsideEvent = (event: Event) => {
    const target = event.target

    if (!(target instanceof Node) || isToolbarPanelTarget(target)) {
      return
    }

    closeVisibleToolbarPanels(panelHosts, readPreservedPanelToolId(host, target))
  }

  host.ownerDocument.addEventListener('pointerdown', closeToolbarPanelsOnOutsideEvent, {
    capture: true,
    signal
  })
  host.ownerDocument.addEventListener('click', closeToolbarPanelsOnOutsideEvent, {
    capture: true,
    signal
  })
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
export function toggleFindReplacePanel(options: ToolbarPanelActionOptions, control: HTMLElement): void {
  if (options.readonlyEnabled && !options.readonlyAllowNavigation) {
    announceReadonlyBlocked(options)
    return
  }

  options.panelActions?.toggleFindReplace?.(control)
  options.render()
}

/** 切换目录面板。 */
export function toggleHeadingOutlinePanel(options: ToolbarPanelActionOptions): void {
  if (options.readonlyEnabled && !options.readonlyAllowNavigation) {
    announceReadonlyBlocked(options)
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
    announceReadonlyBlocked(options)
    return
  }

  options.panelActions?.toggleHeaderFooter?.(control)
  options.render()
}

/** 切换页脚面板。 */
export function toggleFooterPanel(options: ToolbarPanelActionOptions, control: HTMLElement): void {
  if (options.readonlyEnabled) {
    announceReadonlyBlocked(options)
    return
  }

  options.panelActions?.toggleFooter?.(control)
  options.render()
}

/** 切换页码面板。 */
export function togglePageNumberPanel(options: ToolbarPanelActionOptions, control: HTMLElement): void {
  if (options.readonlyEnabled) {
    announceReadonlyBlocked(options)
    return
  }

  options.panelActions?.togglePageNumber?.(control)
  options.render()
}

/** 切换修订面板。 */
export function toggleRevisionsPanel(options: ToolbarPanelActionOptions): void {
  if (options.readonlyEnabled) {
    announceReadonlyBlocked(options)
    return
  }

  options.panelActions?.toggleRevisions?.()
  options.render()
}

/** 使用当前语言播报只读阻断消息。 */
function announceReadonlyBlocked(options: ToolbarPanelActionOptions): void {
  options.announce(readJWordUiText(options.readI18n(), 'a11y.blockedReadonly'))
}

/** 判断事件目标是否落在 toolbar 管理的面板内部。 */
function isToolbarPanelTarget(target: Node): boolean {
  return target instanceof Element && target.closest(readToolbarPanelSelector()) !== null
}

/** 关闭当前 toolbar 相关的可见面板。 */
function closeVisibleToolbarPanels(
  panelHosts: readonly (HTMLElement | null | undefined)[],
  preservedToolId: string | null
): void {
  for (const panelHost of new Set(panelHosts)) {
    closeToolbarPanelHostChildren(panelHost ?? null, preservedToolId)
  }
}

/** 关闭挂在 toolbar overlay host 里的面板。 */
function closeToolbarPanelHostChildren(panelHost: HTMLElement | null, preservedToolId: string | null): void {
  if (panelHost === null) {
    return
  }

  const panels = panelHost.querySelectorAll<HTMLElement>(
    '[data-jword-find-replace], [data-jword-header-footer], [data-jword-revisions-panel]'
  )

  for (const panel of panels) {
    if (shouldPreserveToolbarPanel(panel, preservedToolId)) {
      continue
    }

    panel.hidden = true
  }

  for (const menu of panelHost.querySelectorAll<HTMLElement>(
    '[data-jword-header-menu], [data-jword-footer-menu], [data-jword-header-footer-menu], [data-jword-page-number-menu]'
  )) {
    menu.hidden = true
  }
}

/** 读取当前点击工具对应的面板标识，保证点击同一触发器仍由原 controller 切换。 */
function readPreservedPanelToolId(host: HTMLElement, target: Node): string | null {
  if (!host.contains(target) || !(target instanceof Element)) {
    return null
  }

  return target.closest<HTMLElement>('[data-jword-tool-id]')?.getAttribute('data-jword-tool-id') ?? null
}

/** 判断面板是否属于本次点击的同一工具入口。 */
function shouldPreserveToolbarPanel(panel: HTMLElement, toolId: string | null): boolean {
  if (panel.hasAttribute('data-jword-find-replace')) {
    return toolId === 'document.findReplace'
  }

  if (panel.hasAttribute('data-jword-header-footer')) {
    return toolId === 'document.headerFooter'
      || toolId === 'document.footer'
      || toolId === 'document.pageNumber'
  }

  return panel.hasAttribute('data-jword-revisions-panel') && toolId === 'document.revisions'
}

/** 读取所有 toolbar 弹出面板选择器。 */
function readToolbarPanelSelector(): string {
  return [
    '[data-jword-find-replace]',
    '[data-jword-header-footer]',
    '[data-jword-revisions-panel]'
  ].join(', ')
}
