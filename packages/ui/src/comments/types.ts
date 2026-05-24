/**
 * 职责：定义 comments UI 模块的最小类型边界，不承载 DOM 构造或 core 依赖。
 * 边界：只描述用户、批注 thread、reply、anchor、权限和 controller adapter 的协作形状。
 * 协作模块：comments/state 负责纯状态转换，comments/dom 负责渲染，comments/controller 负责事件调度。
 * 性能/安全约束：纯类型模块，无副作用，可在非浏览器环境安全导入。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md Gate 4.8-4.10。
 */

import type { JWordReadonlyMode } from '../types'

/** 批注作者的最小身份快照。 */
export interface JWordCommentUser {
  /** 稳定用户 ID。 */
  readonly id: string
  /** 可选显示名。 */
  readonly name?: string
  /** 可选头像色值。 */
  readonly color?: string
}

/** 解析后的作者身份，供 UI 展示时使用。 */
export interface JWordResolvedCommentUser {
  /** 稳定用户 ID。 */
  readonly id: string
  /** 展示名称。 */
  readonly name: string
  /** 展示颜色。 */
  readonly color: string
  /** 是否由回退逻辑生成。 */
  readonly fallback: boolean
}

/** 批注锚点的 UI 状态。 */
export interface JWordCommentAnchorState {
  /** 所属 thread ID。 */
  readonly threadId: string
  /** 锚点摘要或正文摘录。 */
  readonly quote: string
  /** 是否被 sidebar 选中。 */
  readonly selected: boolean
  /** 是否应在正文中高亮。 */
  readonly highlighted: boolean
  /** 是否对应已解决线程。 */
  readonly resolved: boolean
}

/** 批注消息。 */
export interface JWordCommentReply {
  /** 消息 ID。 */
  readonly id: string
  /** 作者 ID。 */
  readonly authorId: string
  /** 正文。 */
  readonly body: string
  /** 创建时间。 */
  readonly createdAt: string
  /** 修改时间。 */
  readonly editedAt?: string
}

/** 批注 thread。 */
export interface JWordCommentThread {
  /** thread ID。 */
  readonly id: string
  /** 根消息作者 ID。 */
  readonly authorId: string
  /** 创建时间。 */
  readonly createdAt: string
  /** 是否已解决。 */
  readonly resolved: boolean
  /** 正文锚点状态。 */
  readonly anchor: JWordCommentAnchorState
  /** thread 下的消息列表，第一条是根批注。 */
  readonly messages: readonly JWordCommentReply[]
}

/** thread 的权限状态。 */
export interface JWordCommentThreadPermissions {
  /** 是否可回复。 */
  readonly canReply: boolean
  /** 是否可编辑 thread 根消息。 */
  readonly canEdit: boolean
  /** 是否可删除 thread。 */
  readonly canDelete: boolean
  /** 是否可解决 thread。 */
  readonly canResolve: boolean
  /** 是否可重新打开 thread。 */
  readonly canReopen: boolean
}

/** reply 的权限状态。 */
export interface JWordCommentReplyPermissions {
  /** 是否可编辑消息。 */
  readonly canEdit: boolean
  /** 是否可删除消息。 */
  readonly canDelete: boolean
}

/** 新建批注的草稿。 */
export interface JWordCommentDraftState {
  /** 锚点。 */
  readonly anchor: JWordCommentAnchorState
  /** 草稿正文。 */
  readonly body: string
  /** 校验错误。 */
  readonly error: string
}

/** 回复草稿。 */
export interface JWordCommentReplyDraftState {
  /** 目标 thread ID。 */
  readonly threadId: string
  /** 草稿正文。 */
  readonly body: string
  /** 校验错误。 */
  readonly error: string
}

/** 编辑草稿。 */
export interface JWordCommentEditDraftState {
  /** 目标 thread ID。 */
  readonly threadId: string
  /** 目标消息 ID。 */
  readonly messageId: string
  /** 草稿正文。 */
  readonly body: string
  /** 校验错误。 */
  readonly error: string
}

/** comments 模块的纯状态。 */
export interface JWordCommentsState {
  /** 当前 thread 列表。 */
  readonly threads: readonly JWordCommentThread[]
  /** 当前选中的 thread。 */
  readonly selectedThreadId: string | null
  /** 新建批注草稿。 */
  readonly draft: JWordCommentDraftState | null
  /** 回复草稿。 */
  readonly replyDraft: JWordCommentReplyDraftState | null
  /** 编辑草稿。 */
  readonly editDraft: JWordCommentEditDraftState | null
}

/** 用户解析器。 */
export type JWordCommentUserResolver = (authorId: string) => JWordCommentUser | null | undefined

/** 创建时间格式化函数。 */
export type JWordCommentTimeFormatter = (value: string) => string

/** 权限选项。 */
export interface JWordCommentPermissionOptions {
  /** 是否允许非作者解决/重新打开 thread。 */
  readonly allowResolveByNonAuthor?: boolean
}

/** comments UI 的视图上下文。 */
export interface JWordCommentsViewContext {
  /** 当前用户。 */
  readonly currentUser: JWordCommentUser
  /** 作者解析器。 */
  readonly resolveUser?: JWordCommentUserResolver | undefined
  /** 权限选项。 */
  readonly permissions: JWordCommentPermissionOptions
  /** 创建时间格式化函数。 */
  readonly formatCreatedAt?: JWordCommentTimeFormatter | undefined
  /** 是否处于全局只读模式。 */
  readonly readonly?: boolean | undefined
}

/** 已解析的消息视图。 */
export interface JWordCommentReplyView extends JWordCommentReply {
  /** 作者展示信息。 */
  readonly author: JWordResolvedCommentUser
  /** 格式化后的创建时间。 */
  readonly createdAtLabel: string
  /** 是否为根批注。 */
  readonly root: boolean
  /** 权限状态。 */
  readonly permissions: JWordCommentReplyPermissions
}

/** 已解析的 thread 视图。 */
export interface JWordCommentThreadView extends JWordCommentThread {
  /** 作者展示信息。 */
  readonly author: JWordResolvedCommentUser
  /** 格式化后的创建时间。 */
  readonly createdAtLabel: string
  /** 权限状态。 */
  readonly permissions: JWordCommentThreadPermissions
  /** 已解析的消息。 */
  readonly messages: readonly JWordCommentReplyView[]
}

/** comments UI 的完整视图状态。 */
export interface JWordCommentsViewState {
  /** 当前用户展示信息。 */
  readonly currentUser: JWordResolvedCommentUser
  /** thread 列表视图。 */
  readonly threads: readonly JWordCommentThreadView[]
  /** 当前选中的 thread。 */
  readonly selectedThread: JWordCommentThreadView | null
  /** 新建批注草稿。 */
  readonly draft: JWordCommentDraftState | null
  /** 回复草稿。 */
  readonly replyDraft: JWordCommentReplyDraftState | null
  /** 编辑草稿。 */
  readonly editDraft: JWordCommentEditDraftState | null
}

/** 新建批注提交载荷。 */
export interface JWordCommentCreateSubmission {
  /** 锚点。 */
  readonly anchor: JWordCommentAnchorState
  /** 正文。 */
  readonly body: string
}

/** 回复提交载荷。 */
export interface JWordCommentReplySubmission {
  /** 目标 thread ID。 */
  readonly threadId: string
  /** 正文。 */
  readonly body: string
}

/** 编辑提交载荷。 */
export interface JWordCommentEditSubmission {
  /** 目标 thread ID。 */
  readonly threadId: string
  /** 目标消息 ID。 */
  readonly messageId: string
  /** 正文。 */
  readonly body: string
}

/** 创建 thread 的宿主请求。 */
export interface JWordCommentCreateThreadRequest extends JWordCommentCreateSubmission {
  /** 作者 ID。 */
  readonly authorId: string
  /** 创建时间。 */
  readonly createdAt: string
}

/** 回复 thread 的宿主请求。 */
export interface JWordCommentReplyThreadRequest extends JWordCommentReplySubmission {
  /** 作者 ID。 */
  readonly authorId: string
  /** 创建时间。 */
  readonly createdAt: string
}

/** 编辑消息的宿主请求。 */
export interface JWordCommentEditMessageRequest extends JWordCommentEditSubmission {
  /** 作者 ID。 */
  readonly authorId: string
  /** 修改时间。 */
  readonly editedAt: string
}

/** 删除消息的宿主请求。 */
export interface JWordCommentDeleteMessageRequest {
  /** 目标 thread ID。 */
  readonly threadId: string
  /** 目标消息 ID。 */
  readonly messageId: string
}

/** 线程更新请求。 */
export type JWordCommentUpdateThreadRequest =
  | {
      /** 追加回复。 */
      readonly kind: 'reply'
      readonly request: JWordCommentReplyThreadRequest
    }
  | {
      /** 编辑消息。 */
      readonly kind: 'edit'
      readonly request: JWordCommentEditMessageRequest
    }
  | {
      /** 解决 thread。 */
      readonly kind: 'resolve'
      readonly threadId: string
    }
  | {
      /** 删除某条消息。 */
      readonly kind: 'deleteMessage'
      readonly request: JWordCommentDeleteMessageRequest
    }
  | {
      /** 重新打开 thread。 */
      readonly kind: 'reopen'
      readonly threadId: string
    }

/** comments controller 的宿主 adapter。 */
export interface JWordCommentsAdapter {
  /** 创建 thread。 */
  createThread(request: JWordCommentCreateThreadRequest): Promise<void> | void
  /** 更新 thread。 */
  updateThread(request: JWordCommentUpdateThreadRequest): Promise<void> | void
  /** 删除 thread。 */
  deleteThread(threadId: string): Promise<void> | void
  /** 选择 thread。 */
  selectThread(threadId: string | null): Promise<void> | void
  /** 聚焦正文锚点。 */
  focusAnchor(anchor: JWordCommentAnchorState): Promise<void> | void
}

/** comments controller 创建参数。 */
export interface CreateCommentsControllerOptions {
  /** sidebar 宿主。 */
  readonly host: HTMLElement
  /** 当前用户。 */
  readonly currentUser: JWordCommentUser
  /** 作者解析器。 */
  readonly resolveUser?: JWordCommentUserResolver | undefined
  /** 权限选项。 */
  readonly permissions?: JWordCommentPermissionOptions | undefined
  /** 创建时间格式化函数。 */
  readonly formatCreatedAt?: JWordCommentTimeFormatter | undefined
  /** 初始 thread 列表。 */
  readonly threads?: readonly JWordCommentThread[]
  /** 全局只读配置。 */
  readonly readonly?: JWordReadonlyMode
  /** 宿主 adapter。 */
  readonly adapter: JWordCommentsAdapter
}

/** comments sidebar DOM 句柄。 */
export interface JWordCommentsSidebarDom {
  /** 根节点。 */
  readonly host: HTMLElement
  /** sidebar 根容器。 */
  readonly root: HTMLElement
  /** 顶部栏。 */
  readonly header: HTMLElement
  /** 标题。 */
  readonly title: HTMLElement
  /** 新建批注按钮。 */
  readonly createButton: HTMLButtonElement
  /** 新建批注面板。 */
  readonly composer: HTMLElement
  /** 新建批注锚点信息。 */
  readonly composerAnchor: HTMLElement
  /** 新建批注正文输入。 */
  readonly composerInput: HTMLTextAreaElement
  /** 新建批注错误提示。 */
  readonly composerError: HTMLElement
  /** 新建批注确认按钮。 */
  readonly composerConfirmButton: HTMLButtonElement
  /** 新建批注取消按钮。 */
  readonly composerCancelButton: HTMLButtonElement
  /** thread 列表容器。 */
  readonly threadList: HTMLElement
  /** thread 列表为空提示。 */
  readonly threadEmpty: HTMLElement
  /** 当前 thread 详情容器。 */
  readonly detail: HTMLElement
  /** 详情占位提示。 */
  readonly detailEmpty: HTMLElement
  /** 详情头部。 */
  readonly detailHeader: HTMLElement
  /** 详情状态。 */
  readonly detailStatus: HTMLElement
  /** 详情作者。 */
  readonly detailAuthor: HTMLElement
  /** 详情时间。 */
  readonly detailTime: HTMLElement
  /** 详情锚点摘要。 */
  readonly detailQuote: HTMLButtonElement
  /** 详情操作区。 */
  readonly detailActions: HTMLElement
  /** 消息列表。 */
  readonly detailMessages: HTMLElement
  /** 回复按钮。 */
  readonly detailReplyButton: HTMLButtonElement
  /** 解决/重新打开按钮。 */
  readonly detailResolveButton: HTMLButtonElement
  /** 删除按钮。 */
  readonly detailDeleteButton: HTMLButtonElement
  /** 回复面板。 */
  readonly replyComposer: HTMLElement
  /** 回复输入。 */
  readonly replyInput: HTMLTextAreaElement
  /** 回复错误提示。 */
  readonly replyError: HTMLElement
  /** 回复确认按钮。 */
  readonly replyConfirmButton: HTMLButtonElement
  /** 回复取消按钮。 */
  readonly replyCancelButton: HTMLButtonElement
  /** 编辑面板。 */
  readonly editComposer: HTMLElement
  /** 编辑输入。 */
  readonly editInput: HTMLTextAreaElement
  /** 编辑错误提示。 */
  readonly editError: HTMLElement
  /** 编辑确认按钮。 */
  readonly editConfirmButton: HTMLButtonElement
  /** 编辑取消按钮。 */
  readonly editCancelButton: HTMLButtonElement
}

/** comments controller 对外暴露的句柄。 */
export interface CommentsControllerHandle {
  /** DOM 句柄。 */
  readonly elements: JWordCommentsSidebarDom
  /** 替换 thread 列表。 */
  setThreads(threads: readonly JWordCommentThread[]): void
  /** 选择 thread。 */
  selectThread(threadId: string | null): void
  /** 从正文锚点打开新建批注草稿。 */
  openCreateDraft(anchor: JWordCommentAnchorState): void
  /** 打开回复草稿。 */
  openReplyDraft(threadId: string): void
  /** 打开编辑草稿。 */
  openEditDraft(threadId: string, messageId: string): void
  /** 聚焦当前草稿输入。 */
  focusDraft(): void
  /** 销毁 controller。 */
  destroy(): void
}
