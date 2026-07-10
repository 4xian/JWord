/**
 * 职责：定义 Gate 4.10 link UI 内部使用的最小类型边界，不承载 DOM 构造或宿主业务逻辑。
 * 边界：只描述 state、dom、controller 与宿主 adapter 的协作形状，不访问 editor 或 window。
 * 协作模块：link/state、link/dom、link/controller 通过这里对齐输入输出。
 * 性能/安全约束：纯类型模块，无副作用，可在非浏览器环境安全导入。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import type { ResolvedJWordUiI18n } from '../i18n'
import type { JWordReadonlyMode } from '../types'

/** link dialog 的工作模式。 */
export type JWordLinkDialogMode = 'insert' | 'edit'

/** link 草稿。 */
export interface JWordLinkDraft {
  readonly visibleText: string
  readonly url: string
  readonly tooltip: string
}

/** link dialog 的内部状态。 */
export interface JWordLinkDialogState {
  readonly mode: JWordLinkDialogMode
  readonly draft: JWordLinkDraft
  readonly error: string
  readonly busy: boolean
}

/** link panel 的当前渲染状态。 */
export interface JWordLinkPanelState {
  readonly activeLink: JWordLinkDraft | null
  readonly quickToolsVisible: boolean
  readonly dialog: JWordLinkDialogState | null
  readonly readonly?: boolean
}

/** link URL allowlist。 */
export interface JWordLinkUrlPolicy {
  readonly allowedProtocols?: readonly string[] | undefined
}

/** 当前链接的最小提交请求。 */
export interface JWordLinkSubmitRequest {
  readonly mode: JWordLinkDialogMode
  readonly draft: JWordLinkDraft
}

/** 宿主注入的 link adapter。 */
export interface JWordLinkAdapter {
  openLink(link: JWordLinkDraft): Promise<void> | void
  submitLink(request: JWordLinkSubmitRequest): Promise<void> | void
  removeLink(link: JWordLinkDraft): Promise<void> | void
}

/** link controller 的宿主输入。 */
export interface CreateLinkControllerOptions {
  readonly host: HTMLElement
  readonly viewportHost?: HTMLElement | undefined
  readonly readonly?: JWordReadonlyMode
  readonly adapter?: JWordLinkAdapter | undefined
  readonly actions?: {
    readonly submit: (request: JWordLinkSubmitRequest) => Promise<void> | void
    readonly openLink?: (link: JWordLinkDraft) => Promise<void> | void
    readonly removeLink?: (link: JWordLinkDraft) => Promise<void> | void
  } | undefined
  readonly policy?: JWordLinkUrlPolicy | undefined
  readonly i18n?: ResolvedJWordUiI18n
}

/** link panel DOM 句柄。 */
export interface JWordLinkPanelDom {
  readonly host: HTMLElement
  readonly quickTools: HTMLElement
  readonly dialog: HTMLElement
  readonly visibleTextInput: HTMLInputElement
  readonly urlInput: HTMLInputElement
  readonly errorText: HTMLElement
  readonly confirmButton: HTMLButtonElement
  readonly cancelButton: HTMLButtonElement
  readonly openLinkButton: HTMLButtonElement
  readonly editLinkButton: HTMLButtonElement
  readonly removeLinkButton: HTMLButtonElement
}

/** link controller 对外暴露的最小句柄。 */
export interface LinkControllerHandle {
  readonly elements: JWordLinkPanelDom
  openInsertDialog(selectionText?: string): void
  openEditDialog(): void
  toggleQuickTools(link: JWordLinkDraft): void
  setActiveLink(link: JWordLinkDraft | null): void
  setI18n(i18n: ResolvedJWordUiI18n): void
  destroy(): void
}
