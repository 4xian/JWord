/**
 * 职责：提供只接收一个根元素的 JWord EditorShell 默认装配入口。
 * 边界：只编排 core editor、官方 UI、内部宿主和统一生命周期，不实现具体控件行为。
 * 协作模块：@4xian/jword-core、createJWordUi 与 UI 各 controller 共同完成默认编辑器集成。
 * 性能/安全约束：根元素必须为空，构造失败反序清理，销毁只移除 SDK 创建的资源。
 * 实现说明：本文件按当前单 Host 产品决策实现，不依赖旧多 Host 示例。
 */
import {
  createEditor,
  type Editor,
  type EditorOptions
} from '@4xian/jword-core'

import { createJWordUi } from './ui-lifecycle'
import { resolveToolbarConfig } from './toolbar/config'
import type {
  CreateJWordUiOptions,
  JWordCommentsOptions,
  JWordFindReplaceOptions,
  JWordHeaderFooterOptions,
  JWordHeadingOutlineOptions,
  JWordLinkOptions,
  JWordRevisionsOptions,
  JWordStatusBarOptions,
  JWordToolbarToolId,
  JWordUiInstance
} from './types'

/** EditorShell 可透传给官方 UI 的配置，不暴露内部宿主。 */
export type JWordEditorShellUiOptions = Omit<
  CreateJWordUiOptions,
  | 'editor'
  | 'editorHost'
  | 'toolbarHost'
  | 'liveRegionHost'
  | 'assistiveMirrorHost'
  | 'comments'
  | 'headingOutline'
  | 'statusBar'
  | 'link'
  | 'headerFooter'
  | 'findReplace'
  | 'revisions'
> & {
  readonly comments?: true | Omit<JWordCommentsOptions, 'host'>
  readonly headingOutline?: Omit<JWordHeadingOutlineOptions, 'host'>
  readonly statusBar?: true | false | Omit<JWordStatusBarOptions, 'host' | 'fullscreenHost'>
  readonly link?: Omit<JWordLinkOptions, 'host'>
  readonly headerFooter?: Omit<JWordHeaderFooterOptions, 'host'>
  readonly findReplace?: Omit<JWordFindReplaceOptions, 'host'>
  readonly revisions?: Omit<JWordRevisionsOptions, 'host'>
}

/** EditorShell 允许高级宿主接管的真实外置位置。 */
export interface JWordEditorShellSlots {
  readonly comments?: HTMLElement
  readonly outline?: HTMLElement
  readonly fullscreen?: HTMLElement
}

/** 单 Host JWord 默认入口参数。 */
export interface CreateJWordOptions {
  readonly host: HTMLElement
  readonly editor?: EditorOptions
  readonly ui?: JWordEditorShellUiOptions
  readonly slots?: JWordEditorShellSlots
}

/** 单 Host JWord 实例。 */
export interface JWordEditorShell {
  readonly editor: Editor
  readonly ui: JWordUiInstance
  destroy(): void
}

interface EditorShellDom {
  readonly toolbarHost: HTMLElement
  readonly editorHost: HTMLElement
  readonly statusBarHost: HTMLElement
}

interface HostSnapshot {
  readonly display: string
  readonly flexDirection: string
  readonly minHeight: string
  readonly minWidth: string
}

/** 创建只需要一个专用空根元素的默认 JWord EditorShell。 */
export function createJWord(options: CreateJWordOptions): JWordEditorShell {
  assertEmptyEditorShellHost(options.host)

  const snapshot = readHostSnapshot(options.host)
  const mounted = createMountedEditorShell(options, snapshot)
  const { editor, ui } = mounted

  let destroyed = false

  return {
    editor,
    ui,
    /** 统一销毁 UI、editor 与 EditorShell 创建的宿主，重复调用不产生副作用。 */
    destroy(): void {
      if (destroyed) {
        return
      }

      destroyed = true
      ui.destroy()
      editor.destroy()
      cleanupEditorShellHost(options.host, snapshot)
    }
  }
}

/** 创建 EditorShell 持有的 DOM、editor 与 UI，并在任一步失败时反序回滚。 */
function createMountedEditorShell(options: CreateJWordOptions, snapshot: HostSnapshot): {
  readonly editor: Editor
  readonly ui: JWordUiInstance
} {
  let editor: Editor | null = null
  let ui: JWordUiInstance | null = null

  try {
    const dom = createEditorShellDom(options.host)

    editor = createEditor(options.editor)
    editor.mount(dom.editorHost)
    ui = createJWordUi(createEditorShellUiOptions(options, editor, dom))
    editor.focus()

    return { editor, ui }
  } catch (error) {
    ui?.destroy()
    editor?.destroy()
    cleanupEditorShellHost(options.host, snapshot)
    throw error
  }
}

/** 断言普通集成提供专用空根元素。 */
function assertEmptyEditorShellHost(host: HTMLElement): void {
  if (host.childNodes.length > 0) {
    throw new Error('createJWord 需要专用空根元素。')
  }
}

/** 创建 EditorShell 固定的 toolbar、editor、status bar 三段结构和内部辅助宿主。 */
function createEditorShellDom(host: HTMLElement): EditorShellDom {
  const ownerDocument = host.ownerDocument
  const toolbarHost = createShellRegion(ownerDocument, 'toolbar')
  const editorHost = createShellRegion(ownerDocument, 'editor')
  const statusBarHost = createShellRegion(ownerDocument, 'status-bar')

  host.setAttribute('data-jword-editor-shell', 'true')
  host.style.display = 'flex'
  host.style.flexDirection = 'column'
  host.style.minHeight = '0'
  host.style.minWidth = '0'
  toolbarHost.style.flex = '0 0 auto'
  editorHost.style.flex = '1 1 auto'
  editorHost.style.minHeight = '0'
  editorHost.style.minWidth = '0'
  statusBarHost.style.flex = '0 0 auto'
  host.append(toolbarHost, editorHost, statusBarHost)

  return {
    toolbarHost,
    editorHost,
    statusBarHost
  }
}

/** 创建带稳定区域标记的 EditorShell 直属宿主。 */
function createShellRegion(ownerDocument: Document, region: 'toolbar' | 'editor' | 'status-bar'): HTMLElement {
  const host = ownerDocument.createElement('div')

  host.setAttribute('data-jword-shell-region', region)

  return host
}

/** 把基础 UI 配置映射到 EditorShell 内部宿主，并让显式外置 slot 优先。 */
function createEditorShellUiOptions(
  options: CreateJWordOptions,
  editor: Editor,
  dom: EditorShellDom
): CreateJWordUiOptions {
  const ui = options.ui ?? {}
  const liveRegionHost = dom.editorHost.querySelector<HTMLElement>('[data-jword-aria-live]')
  const statusBar = resolveEditorShellStatusBar(ui.statusBar, options.slots?.fullscreen ?? options.host, dom.statusBarHost)
  const toolbarToolIds = resolveEditorShellToolbarToolIds(ui.toolbar)
  const comments = ui.comments ?? (toolbarToolIds.has('insert.comment') ? true : undefined)
  const link = ui.link ?? (toolbarToolIds.has('insert.link') ? {} : undefined)
  const headerFooter = ui.headerFooter ?? (
    toolbarToolIds.has('document.headerFooter')
      || toolbarToolIds.has('document.footer')
      || toolbarToolIds.has('document.pageNumber')
      ? {}
      : undefined
  )
  const headingOutline = ui.headingOutline ?? (toolbarToolIds.has('document.headingOutline') ? {} : undefined)
  const findReplace = ui.findReplace ?? (toolbarToolIds.has('document.findReplace') ? {} : undefined)
  const revisions = ui.revisions ?? (toolbarToolIds.has('document.revisions') ? {} : undefined)

  return {
    ...ui,
    editor,
    editorHost: dom.editorHost,
    toolbarHost: dom.toolbarHost,
    ...(liveRegionHost === null ? {} : { liveRegionHost }),
    statusBar,
    ...(comments === undefined
      ? {}
      : {
          comments: comments === true
            ? options.slots?.comments === undefined ? true : { host: options.slots.comments }
            : {
                ...comments,
                ...(options.slots?.comments === undefined ? {} : { host: options.slots.comments })
              }
        }),
    ...(headingOutline === undefined
      ? {}
      : {
          headingOutline: {
            ...headingOutline,
            ...(options.slots?.outline === undefined ? {} : { host: options.slots.outline })
          }
        }),
    ...(link === undefined ? {} : { link: { ...link, host: dom.editorHost } }),
    ...(headerFooter === undefined ? {} : { headerFooter: { ...headerFooter, host: dom.editorHost } }),
    ...(findReplace === undefined ? {} : { findReplace: { ...findReplace, host: dom.editorHost } }),
    ...(revisions === undefined ? {} : { revisions: { ...revisions } })
  }
}

/** 解析 EditorShell 当前会渲染的工具，用于自动装配其依赖的内建面板能力。 */
function resolveEditorShellToolbarToolIds(
  toolbar: JWordEditorShellUiOptions['toolbar']
): ReadonlySet<JWordToolbarToolId> {
  if (toolbar === false) {
    return new Set()
  }

  return new Set(resolveToolbarConfig(toolbar).toolIds)
}

/** 解析状态栏配置，并固定使用 EditorShell 的底部区域和全屏宿主。 */
function resolveEditorShellStatusBar(
  statusBar: JWordEditorShellUiOptions['statusBar'],
  fullscreenHost: HTMLElement,
  host: HTMLElement
): false | JWordStatusBarOptions {
  if (statusBar === false) {
    return false
  }

  return {
    ...(statusBar === undefined || statusBar === true ? {} : statusBar),
    host,
    fullscreenHost
  }
}

/** 保存调用方根元素中会被 EditorShell 接管的行内布局值。 */
function readHostSnapshot(host: HTMLElement): HostSnapshot {
  return {
    display: host.style.display,
    flexDirection: host.style.flexDirection,
    minHeight: host.style.minHeight,
    minWidth: host.style.minWidth
  }
}

/** 移除 EditorShell 创建内容，并恢复调用方根元素原有布局值。 */
function cleanupEditorShellHost(host: HTMLElement, snapshot: HostSnapshot): void {
  host.replaceChildren()
  host.removeAttribute('data-jword-editor-shell')
  host.style.display = snapshot.display
  host.style.flexDirection = snapshot.flexDirection
  host.style.minHeight = snapshot.minHeight
  host.style.minWidth = snapshot.minWidth
}
