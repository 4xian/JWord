/**
 * 职责：共享 createJWordUi 自动 toolbar/statusBar 三段式布局的 editorHost 样式接管。
 * 边界：只处理 editorHost 与 editor shell 的行内布局样式，不创建 toolbar/statusBar DOM 内容。
 * 协作模块：toolbar-setup、status-bar/mount 共同使用，避免重复保存/恢复同一批样式。
 * 性能/安全约束：使用 WeakMap 按宿主计数，无顶层 DOM 访问，cleanup 后恢复接管前状态。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

interface ShellLayoutRecord {
  readonly editorHost: HTMLElement
  readonly editorShell: HTMLElement
  readonly previousEditorDisplay: string
  readonly previousEditorFlexDirection: string
  readonly previousEditorMinWidth: string
  readonly previousShellFlex: string
  readonly previousShellHeight: string
  readonly previousShellMinHeight: string
  readonly previousShellMinWidth: string
  refs: number
}

export interface JWordUiShellLayoutHandle {
  readonly editorShell: HTMLElement
  cleanup(): void
}

const shellLayoutRecords = new WeakMap<HTMLElement, ShellLayoutRecord>()

/** 接管 editorHost 为纵向三段式 flex 布局，并返回引用计数 cleanup。 */
export function acquireJWordUiShellLayout(editorHost: HTMLElement): JWordUiShellLayoutHandle {
  const existing = shellLayoutRecords.get(editorHost)

  if (existing !== undefined) {
    existing.refs += 1
    return {
      editorShell: existing.editorShell,
      cleanup(): void {
        releaseJWordUiShellLayout(existing)
      }
    }
  }

  const editorShell = resolveJWordUiEditorShell(editorHost)

  if (editorShell === null) {
    throw new Error('createJWordUi 自动创建 UI 宿主需要已挂载的 editor。')
  }

  const record: ShellLayoutRecord = {
    editorHost,
    editorShell,
    previousEditorDisplay: editorHost.style.display,
    previousEditorFlexDirection: editorHost.style.flexDirection,
    previousEditorMinWidth: editorHost.style.minWidth,
    previousShellFlex: editorShell.style.flex,
    previousShellHeight: editorShell.style.height,
    previousShellMinHeight: editorShell.style.minHeight,
    previousShellMinWidth: editorShell.style.minWidth,
    refs: 1
  }

  editorHost.style.display = 'flex'
  editorHost.style.flexDirection = 'column'
  editorHost.style.minWidth = '0'
  editorShell.style.flex = '1 1 auto'
  editorShell.style.height = 'auto'
  editorShell.style.minHeight = '0'
  editorShell.style.minWidth = '0'
  shellLayoutRecords.set(editorHost, record)

  return {
    editorShell,
    cleanup(): void {
      releaseJWordUiShellLayout(record)
    }
  }
}

/** 读取 editor.mount 创建的 jw-editor 根节点。 */
export function resolveJWordUiEditorShell(editorHost: HTMLElement): HTMLElement | null {
  if (editorHost.matches('[data-jword-editor]')) {
    return editorHost
  }

  return editorHost.querySelector<HTMLElement>('[data-jword-editor]')
}

/** 释放一次三段式布局接管引用，最后一个引用负责恢复样式。 */
function releaseJWordUiShellLayout(record: ShellLayoutRecord): void {
  if (record.refs <= 0) {
    return
  }

  record.refs -= 1
  if (record.refs > 0) {
    return
  }

  record.editorHost.style.display = record.previousEditorDisplay
  record.editorHost.style.flexDirection = record.previousEditorFlexDirection
  record.editorHost.style.minWidth = record.previousEditorMinWidth
  record.editorShell.style.flex = record.previousShellFlex
  record.editorShell.style.height = record.previousShellHeight
  record.editorShell.style.minHeight = record.previousShellMinHeight
  record.editorShell.style.minWidth = record.previousShellMinWidth
  shellLayoutRecords.delete(record.editorHost)
}
