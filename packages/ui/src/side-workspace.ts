/**
 * 职责：为目录和修订记录解析 EditorShell 左右浮动工作区宿主。
 * 边界：只创建、标记和清理绝对定位宿主，不读取面板数据或控制面板可见性。
 * 协作模块：heading-outline-setup 与 ui-lifecycle 分别请求左、右工作区。
 * 性能/安全约束：显式外部宿主永不接管；默认宿主销毁后恢复 editorHost 的定位样式。
 * 实现说明：左右工作区覆盖正文但不参与正文布局，批注 page rail 不使用本模块。
 */
import { resolveEditorShell } from './toolbar-setup'
import { acquirePositionedUiHost } from './ui-positioning'

export type JWordSideWorkspacePosition = 'left' | 'right'
export type JWordSideWorkspaceFeature = 'heading-outline' | 'revisions'

export interface ResolveSideWorkspaceMountOptions {
  readonly side: JWordSideWorkspacePosition
  readonly feature: JWordSideWorkspaceFeature
  readonly explicitHost?: HTMLElement
  readonly editorHost?: HTMLElement
  readonly fallbackHost: HTMLElement
}

export interface ResolvedSideWorkspaceMount {
  readonly host: HTMLElement
  readonly defaultWorkspace: boolean
  cleanup(): void
}

/** 解析功能面板宿主，普通集成默认创建指定方向的浮动工作区。 */
export function resolveSideWorkspaceMount(
  options: ResolveSideWorkspaceMountOptions
): ResolvedSideWorkspaceMount {
  if (options.explicitHost !== undefined) {
    return createExternalMount(options.explicitHost)
  }

  if (options.editorHost === undefined || resolveEditorShell(options.editorHost) === null) {
    return createExternalMount(options.fallbackHost)
  }

  const host = options.editorHost.ownerDocument.createElement('div')
  const positionHandle = acquirePositionedUiHost(options.editorHost)

  host.className = `jw-side-workspace jw-side-workspace--${options.side}`
  host.setAttribute('data-jword-side-workspace', options.side)
  host.setAttribute(`data-jword-${options.feature}-host`, 'true')
  options.editorHost.append(host)

  return {
    host,
    defaultWorkspace: true,
    /** 移除默认宿主并在最后一个工作区销毁后恢复 editorHost 定位。 */
    cleanup(): void {
      host.remove()
      positionHandle.cleanup()
    }
  }
}

/** 创建不接管所有权的显式或降级宿主结果。 */
function createExternalMount(host: HTMLElement): ResolvedSideWorkspaceMount {
  return {
    host,
    defaultWorkspace: false,
    cleanup(): void {}
  }
}
