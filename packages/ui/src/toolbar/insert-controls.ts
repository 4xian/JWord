/**
 * 职责：封装 toolbar 插入类控件动作。
 * 边界：只负责批注和链接入口的启用判断，不创建具体侧栏或弹窗。
 * 协作模块：controller 绑定 DOM 事件，create-ui 提供 insertActions 回调。
 * 性能/安全约束：不直接访问文档结构，不绕过宿主提供的 action。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import {
  bindToolbarButton,
  type ToolbarActionContext
} from './toolbar-state-sync'

export interface ToolbarInsertActions {
  readonly openComment?: () => void
  readonly openLink?: () => void
}

export interface ToolbarInsertActionContext {
  readonly readonlyEnabled: boolean
  readonly insertActions?: ToolbarInsertActions | undefined
  announce(message: string): void
}

/** 绑定批注和链接插入入口。 */
export function bindInsertControls(
  context: ToolbarActionContext,
  insertActions: ToolbarInsertActions | undefined
): void {
  const { dom, readonlyMode } = context

  bindToolbarButton(context, dom.controls['insert.comment'], () => {
    openCommentFromToolbar({
      readonlyEnabled: readonlyMode.enabled,
      insertActions,
      announce: context.announce
    })
  }, { restoreEditorFocus: false })
  bindToolbarButton(context, dom.controls['insert.link'], () => {
    openLinkFromToolbar({
      readonlyEnabled: readonlyMode.enabled,
      insertActions,
      announce: context.announce
    })
  }, { restoreEditorFocus: false })
}

/** 打开批注侧栏入口。 */
export function openCommentFromToolbar(context: ToolbarInsertActionContext): void {
  if (context.readonlyEnabled) {
    context.announce('当前为只读模式。')
    return
  }

  if (context.insertActions?.openComment === undefined) {
    context.announce('BLOCKED: 当前宿主未启用批注侧栏。')
    return
  }

  context.insertActions.openComment()
}

/** 打开链接弹窗入口。 */
export function openLinkFromToolbar(context: ToolbarInsertActionContext): void {
  if (context.readonlyEnabled) {
    context.announce('当前为只读模式。')
    return
  }

  if (context.insertActions?.openLink === undefined) {
    context.announce('BLOCKED: 当前宿主未启用链接弹窗。')
    return
  }

  context.insertActions.openLink()
}
