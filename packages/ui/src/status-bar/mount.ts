/**
 * 职责：解析底部状态栏挂载点，支持宿主传入 host 或 SDK 自动放入 editorHost 底部。
 * 边界：只处理挂载宿主和三段式布局，不创建状态栏控件 DOM。
 * 协作模块：ui-lifecycle 调用本模块后再创建 status-bar controller。
 * 性能/安全约束：自动宿主 cleanup 只移除 SDK 创建的节点，并释放共享 shell 布局引用。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import type { CreateJWordUiOptions, JWordStatusBarOptions } from '../types'
import { acquireJWordUiShellLayout } from '../ui-shell-layout'

export interface ResolvedStatusBarMount {
  readonly host: HTMLElement
  readonly options: JWordStatusBarOptions
  cleanup(): void
}

/** 解析状态栏挂载点；未显式禁用时默认启用。 */
export function resolveStatusBarMount(options: CreateJWordUiOptions): ResolvedStatusBarMount | null {
  if (options.statusBar === false) {
    return null
  }

  const statusBarOptions = options.statusBar === undefined || options.statusBar === true
    ? {}
    : options.statusBar

  if (statusBarOptions.host !== undefined) {
    return {
      host: statusBarOptions.host,
      options: statusBarOptions,
      cleanup(): void {}
    }
  }

  if (options.editorHost === undefined) {
    if (options.statusBar === undefined) {
      return null
    }

    throw new Error('createJWordUi 自动创建 statusBar.host 需要 editorHost。')
  }

  const ownerDocument = options.editorHost.ownerDocument
  const shellLayout = acquireJWordUiShellLayout(options.editorHost)
  const host = ownerDocument.createElement('div')

  host.setAttribute('data-jword-status-bar-host', 'true')
  host.style.flex = '0 0 auto'
  host.style.width = '100%'
  shellLayout.editorShell.after(host)

  return {
    host,
    options: statusBarOptions,
    cleanup(): void {
      host.remove()
      shellLayout.cleanup()
    }
  }
}
