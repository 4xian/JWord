/**
 * 职责：封装 createJWordUi 的目录面板默认挂载点解析。
 * 边界：只管理 heading outline 宿主 DOM 的插入和还原，不读取目录数据。
 * 协作模块：ui-lifecycle 调用这里后再创建 heading/controller。
 * 性能/安全约束：无顶层 DOM 副作用，cleanup 负责还原宿主挂载关系。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import { resolveEditorShell } from './toolbar-setup'
import type { CreateJWordUiOptions } from './types'

export interface ResolvedHeadingOutlineMount {
  readonly host: HTMLElement
  cleanup(): void
}

/** 解析目录挂载点，默认放到已挂载的 jw-editor 内。 */
export function resolveHeadingOutlineMount(
  options: CreateJWordUiOptions['headingOutline'],
  editorHost: HTMLElement | undefined,
  toolbarHost: HTMLElement
): ResolvedHeadingOutlineMount | null {
  if (options === undefined) {
    return null
  }

  if (options.host !== undefined) {
    return {
      host: options.host,
      cleanup(): void {}
    }
  }

  const editorShell = editorHost === undefined
    ? null
    : resolveEditorShell(editorHost)

  const host = toolbarHost

  if (editorShell === null) {
    return {
      host,
      cleanup(): void {}
    }
  }

  if (host === toolbarHost) {
    const defaultHost = editorShell.ownerDocument.createElement('div')

    defaultHost.className = 'jw-heading-outline-host'
    defaultHost.setAttribute('data-jword-heading-outline-host', 'true')
    editorShell.append(defaultHost)

    return {
      host: defaultHost,
      cleanup(): void {
        defaultHost.remove()
      }
    }
  }

  return {
    host,
    cleanup(): void {}
  }
}
