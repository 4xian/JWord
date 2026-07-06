/**
 * 职责：封装 toolbar 插入类控件动作。
 * 边界：只负责批注和链接入口的启用判断，不创建具体侧栏或弹窗。
 * 协作模块：controller 绑定 DOM 事件，create-ui 提供 insertActions 回调。
 * 性能/安全约束：不直接访问文档结构，不绕过宿主提供的 action。
 * Specs：docs/superpowers/reports/2026-07-03-remediation-execution-supplement.md#310-phase-5-超大文件拆分目标结构。
 */

export interface ToolbarInsertActions {
  readonly openComment?: () => void
  readonly openLink?: () => void
}

export interface ToolbarInsertActionContext {
  readonly readonlyEnabled: boolean
  readonly insertActions?: ToolbarInsertActions | undefined
  announce(message: string): void
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
