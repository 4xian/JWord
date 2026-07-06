/**
 * 职责：封装 createJWordUi 的 toolbar 宿主创建和查找替换快捷键接线。
 * 边界：只处理装配期 DOM 宿主与键盘监听，不创建业务 controller 状态。
 * 协作模块：ui-lifecycle 调用这里获得 toolbarHost，heading-outline-setup 复用 editor shell 解析。
 * 性能/安全约束：无顶层 DOM 访问，所有监听都通过 AbortController 可销毁。
 * Specs：docs/superpowers/reports/2026-07-03-remediation-execution-supplement.md#310-phase-5-超大文件拆分目标结构。
 */
import type { CreateJWordUiOptions } from './types'

export interface ResolvedToolbarMount {
  readonly host: HTMLElement
  cleanup(): void
}

/** 解析 toolbar 挂载点，未显式传入时自动放进已挂载的 editor 容器。 */
export function resolveToolbarMount(options: CreateJWordUiOptions): ResolvedToolbarMount {
  if (options.toolbarHost !== undefined) {
    return {
      host: options.toolbarHost,
      cleanup(): void {}
    }
  }

  if (options.editorHost === undefined) {
    throw new Error('createJWordUi 需要 toolbarHost，或先挂载 editorHost 后交给 SDK 自动创建。')
  }

  const editorHost = options.editorHost
  const editorShell = resolveEditorShell(editorHost)

  if (editorShell === null) {
    throw new Error('createJWordUi 自动创建 toolbarHost 需要已挂载的 editor。')
  }

  const ownerDocument = editorHost.ownerDocument
  const host = ownerDocument.createElement('div')
  const previousEditorDisplay = editorHost.style.display
  const previousEditorFlexDirection = editorHost.style.flexDirection
  const previousShellFlex = editorShell.style.flex
  const previousShellHeight = editorShell.style.height
  const previousShellMinHeight = editorShell.style.minHeight

  host.setAttribute('data-jword-toolbar-host', 'true')
  host.style.flex = '0 0 auto'
  host.style.width = '100%'
  host.style.marginBottom = '8px'
  editorHost.style.display = 'flex'
  editorHost.style.flexDirection = 'column'
  editorShell.style.flex = '1 1 auto'
  editorShell.style.height = 'auto'
  editorShell.style.minHeight = '0'
  editorHost.insertBefore(host, editorShell)

  return {
    host,
    cleanup(): void {
      host.remove()
      editorHost.style.display = previousEditorDisplay
      editorHost.style.flexDirection = previousEditorFlexDirection
      editorShell.style.flex = previousShellFlex
      editorShell.style.height = previousShellHeight
      editorShell.style.minHeight = previousShellMinHeight
    }
  }
}

/** 绑定查找替换编辑区快捷键。 */
export function bindFindReplaceKeyboardShortcuts(
  shortcutHosts: readonly HTMLElement[],
  findReplace: { open(): void, elements: { readonly queryInput: HTMLInputElement, readonly replacementInput: HTMLInputElement } }
): () => void {
  const signalController = new AbortController()
  const ownerDocument = shortcutHosts[0]?.ownerDocument

  if (ownerDocument === undefined) {
    return (): void => {}
  }

  ownerDocument.addEventListener('keydown', (event) => {
    const lowerKey = event.key.toLowerCase()

    if (
      !event.altKey
      && !event.shiftKey
      && (event.ctrlKey || event.metaKey)
      && (lowerKey === 'f' || lowerKey === 'h')
      && isFindReplaceShortcutTarget(event.target, shortcutHosts)
    ) {
      event.preventDefault()
      findReplace.open()
      if (lowerKey === 'h') {
        findReplace.elements.replacementInput.focus()
        return
      }

      findReplace.elements.queryInput.focus()
    }
  }, {
    capture: true,
    signal: signalController.signal
  })

  return () => {
    signalController.abort()
  }
}

/** 判断快捷键是否来自当前 UI 接管范围。 */
function isFindReplaceShortcutTarget(target: EventTarget | null, shortcutHosts: readonly HTMLElement[]): boolean {
  return target instanceof Node && shortcutHosts.some((host) => host.contains(target))
}

/** 读取 editor.mount 创建的 jw-editor 根节点。 */
export function resolveEditorShell(editorHost: HTMLElement): HTMLElement | null {
  if (editorHost.matches('[data-jword-editor]')) {
    return editorHost
  }

  return editorHost.querySelector<HTMLElement>('[data-jword-editor]')
}
