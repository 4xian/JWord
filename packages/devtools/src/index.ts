/**
 * 职责：提供 Gate 7 Devtools 浮动面板的最小公开入口。
 * 边界：只消费 @4xian/jword-core 的 Editor facade 和 diagnostics snapshot，不读取 editor 内部 src 或 DOM 实现。
 * 协作模块：Editor.exportDiagnostics、宿主 DOM、示例 opt-in devtools 加载路径。
 * 性能/安全约束：devtools 只有显式 import 才进入宿主 bundle；面板只渲染隐私裁剪后的 plain JSON 摘要。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import type { Editor, JWordDiagnosticsSnapshot } from '@4xian/jword-core'

/** attachJWordDevtools 的公开配置，控制面板挂载宿主和外层 className。 */
export interface AttachJWordDevtoolsOptions {
  /** Devtools 面板挂载宿主；为空时挂到 document.body。 */
  readonly host?: HTMLElement
  /** 面板 className，供宿主接入自己的 z-index 或主题。 */
  readonly className?: string
}

/** Devtools 浮动面板返回给宿主的刷新与销毁句柄。 */
export interface JWordDevtoolsHandle {
  /** Devtools 根面板 DOM。 */
  readonly panel: HTMLElement
  /** 重新读取 editor diagnostics 并刷新面板。 */
  refresh(): JWordDiagnosticsSnapshot | null
  /** 幂等销毁面板和事件监听。 */
  destroy(): void
}

/** 挂载 Gate 7 Devtools 浮动面板。 */
export function attachJWordDevtools(editor: Editor, options: AttachJWordDevtoolsOptions = {}): JWordDevtoolsHandle {
  const host = resolveDevtoolsHost(options.host)
  const panel = host.ownerDocument.createElement('aside')
  let destroyed = false

  panel.className = options.className === undefined || options.className.length === 0
    ? 'jw-devtools'
    : `jw-devtools ${options.className}`
  panel.setAttribute('data-jword-devtools-panel', 'true')
  panel.setAttribute('role', 'complementary')
  panel.setAttribute('aria-label', 'JWord Devtools')
  applyPanelStyle(panel)
  host.append(panel)

  /** 刷新当前面板内容。 */
  function refresh(): JWordDiagnosticsSnapshot | null {
    if (destroyed) {
      return null
    }

    try {
      const snapshot = editor.exportDiagnostics()

      renderSnapshot(panel, snapshot)

      return snapshot
    } catch (error) {
      renderDevtoolsError(panel, error)
      return null
    }
  }

  /** 销毁面板。 */
  function destroy(): void {
    if (destroyed) {
      return
    }

    destroyed = true
    panel.remove()
  }

  refresh()

  return {
    panel,
    refresh,
    destroy
  }
}

/** 解析 Devtools 宿主。 */
function resolveDevtoolsHost(host: HTMLElement | undefined): HTMLElement {
  if (host !== undefined) {
    return host
  }

  return document.body
}

/** 应用无 grid/gap 的内联基础样式。 */
function applyPanelStyle(panel: HTMLElement): void {
  panel.style.position = 'fixed'
  panel.style.right = '16px'
  panel.style.bottom = '16px'
  panel.style.zIndex = '2147483647'
  panel.style.display = 'flex'
  panel.style.flexDirection = 'column'
  panel.style.width = '360px'
  panel.style.maxHeight = '60vh'
  panel.style.overflow = 'auto'
  panel.style.padding = '12px'
  panel.style.border = '1px solid var(--jw-color-border, #cbd5e1)'
  panel.style.borderRadius = '8px'
  panel.style.background = 'var(--jw-color-surface, #ffffff)'
  panel.style.color = 'var(--jw-color-text, #111827)'
  panel.style.boxShadow = '0 12px 28px rgb(25 35 52 / 12%)'
  panel.style.font = '12px/1.45 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'
}

/** 渲染 diagnostics snapshot。 */
function renderSnapshot(panel: HTMLElement, snapshot: JWordDiagnosticsSnapshot): void {
  panel.replaceChildren(
    createHeading(panel.ownerDocument, 'JWord Devtools'),
    createSection(panel.ownerDocument, 'packageVersions', snapshot.packageVersions),
    createSection(panel.ownerDocument, 'featureFlags', snapshot.featureFlags),
    createSection(panel.ownerDocument, 'license', snapshot.license),
    createSection(panel.ownerDocument, 'operations', snapshot.operations),
    createSection(panel.ownerDocument, 'layout', snapshot.layout),
    createSection(panel.ownerDocument, 'selection', snapshot.selection),
    createSection(panel.ownerDocument, 'collaboration', snapshot.collaboration),
    createSection(panel.ownerDocument, 'server', snapshot.server),
    createSection(panel.ownerDocument, 'plugins', snapshot.plugins)
  )
}

/** 渲染 devtools 自身错误，不向 editor 写入状态。 */
function renderDevtoolsError(panel: HTMLElement, error: unknown): void {
  panel.replaceChildren(
    createHeading(panel.ownerDocument, 'JWord Devtools'),
    createSection(panel.ownerDocument, 'devtoolsError', {
      message: error instanceof Error ? error.message : 'unknown'
    })
  )
}

/** 创建面板标题。 */
function createHeading(ownerDocument: Document, text: string): HTMLElement {
  const heading = ownerDocument.createElement('strong')

  heading.textContent = text
  heading.style.marginBottom = '8px'

  return heading
}

/** 创建 JSON 摘要区块。 */
function createSection(ownerDocument: Document, title: string, value: unknown): HTMLElement {
  const section = ownerDocument.createElement('section')
  const heading = ownerDocument.createElement('div')
  const pre = ownerDocument.createElement('pre')

  section.setAttribute('data-jword-devtools-section', title)
  section.style.marginTop = '8px'
  heading.textContent = title
  heading.style.fontWeight = '600'
  pre.textContent = JSON.stringify(value, null, 2)
  pre.style.margin = '4px 0 0'
  pre.style.whiteSpace = 'pre-wrap'
  pre.style.overflowWrap = 'anywhere'
  section.append(heading, pre)

  return section
}
