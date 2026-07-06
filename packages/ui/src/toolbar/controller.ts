/**
 * 职责：连接 toolbar DOM、core editor facade 和 assistive 句柄，保持 Gate 3 命令语义不变。
 * 边界：保留生命周期编排与少量通用文档动作，具体控件组动作拆入 focused toolbar 子模块。
 * 协作模块：config 解析显隐，dom 管理节点，state-sync 管理渲染，format/paragraph/insert/panel 模块处理控件动作。
 * 性能/安全约束：所有格式命令继续走 facade/transaction pipeline，不生成第二套编辑状态。
 * Specs：docs/superpowers/plans/2026-05-17-jword-ui-sdk-gate4-integration.md#41-必须迁入-packagesui-的内容。
 */
import type {
  PagePreset,
  SelectionState
} from '@4xian/jword-core'
import type {
  CreateJWordUiOptions,
  JWordToolbarElements
} from '../types'
import type { SelectionActionsColorFormatController } from '../selection-actions/types'
import { resolveToolbarConfig } from './config'
import {
  createToolbarDom,
  destroyToolbarDom
} from './dom'
import {
  readPagePresetAnnouncement,
  readSelectionAnnouncement,
  readTransactionAnnouncement,
  shouldAnnounceTransaction
} from './state'
import {
  bindFormatControls,
  createToolbarColorSessionState,
  markActiveColorReturnedToEditor
} from './format-controls'
import type {
  ToolbarColorFormatHandle
} from './format-controls'
import { bindParagraphControls } from './paragraph-controls'
import {
  openCommentFromToolbar,
  openLinkFromToolbar
} from './insert-controls'
import {
  bindToolbarPanelDismissal,
  createToolbarExtensionHost,
  readHeadingOutlineActive,
  readHeadingOutlineAvailable,
  toggleFindReplacePanel,
  toggleFooterPanel,
  toggleHeaderFooterPanel,
  toggleHeadingOutlinePanel,
  togglePageNumberPanel,
  toggleRevisionsPanel
} from './panel-lifecycle'
import { resolveToolbarPluginExtensions } from './internal-plugin-extensions'
import {
  createToolbarPluginExtensions,
  type ToolbarPluginExtensionsHandle
} from './plugin-extensions'
import {
  bindToolbarButton,
  bindToolbarSelect,
  createToolbarStateSync,
  normalizeReadonlyMode,
  readSelect
} from './toolbar-state-sync'
import type {
  ToolbarActionContext,
  ToolbarControllerAssistive
} from './toolbar-state-sync'

interface CreateToolbarControllerOptions extends Omit<CreateJWordUiOptions, 'toolbarHost'> {
  readonly toolbarHost: HTMLElement
  readonly assistive: ToolbarControllerAssistive
  readonly insertActions?: {
    readonly openComment?: () => void
    readonly openLink?: () => void
  }
  readonly panelActions?: {
    readonly toggleFindReplace?: () => void
    readonly toggleHeadingOutline?: () => void
    readonly toggleHeaderFooter?: (anchor: HTMLElement) => void
    readonly toggleFooter?: (anchor: HTMLElement) => void
    readonly togglePageNumber?: (anchor: HTMLElement) => void
    readonly toggleRevisions?: () => void
  }
  readonly panelState?: {
    readonly headingOutline?: () => boolean
    readonly headingOutlineAvailable?: () => boolean
  }
}

interface ToolbarControllerHandle {
  readonly elements: JWordToolbarElements
  readonly mediaHost: HTMLElement | null
  readonly tableHost: HTMLElement | null
  readonly linkHost: HTMLElement | null
  readonly panelHost: HTMLElement | null
  readonly colorFormat: SelectionActionsColorFormatController
  refresh(): void
  destroy(): void
}

/** 创建并接管官方 toolbar。 */
export function createToolbarController(options: CreateToolbarControllerOptions): ToolbarControllerHandle {
  const toolbarHidden = options.toolbar === false
  const previousToolbarHidden = options.toolbarHost.hidden
  const toolbarConfig = resolveToolbarConfig(toolbarHidden
    ? {
        visibleTools: []
      }
    : options.toolbar)
  const toolbarPluginExtensions = resolveToolbarPluginExtensions({
    toolbar: options.toolbar,
    toolbarHidden,
    toolbarConfig,
    externalExtensions: options.pluginExtensions
  })
  const dom = createToolbarDom(options.toolbarHost, toolbarConfig)
  if (toolbarHidden) {
    options.toolbarHost.hidden = true
  }
  const mediaHost = toolbarHidden
    ? null
    : createToolbarExtensionHost(dom.bar, 'media')
  const tableHost = toolbarHidden
    ? null
    : createToolbarExtensionHost(dom.bar, 'table')
  const linkHost = options.link === undefined || toolbarHidden
    ? null
    : createToolbarExtensionHost(dom.bar, 'link')
  const panelHost = toolbarHidden
    || (options.headerFooter === undefined
    && options.headingOutline === undefined
    && options.findReplace === undefined
    && options.revisions === undefined)
    ? null
    : createToolbarExtensionHost(dom.bar, 'panel')
  const editor = options.editor
  const readonlyMode = normalizeReadonlyMode(options.readonly)
  const signalController = new AbortController()
  let pluginExtensions: ToolbarPluginExtensionsHandle | null = null
  let suppressSelectionAnnouncementsUntil = 0
  let suppressAfterToolbarTransaction = false
  const colorState = createToolbarColorSessionState()
  const panelOptions = {
    readonlyEnabled: readonlyMode.enabled,
    readonlyAllowNavigation: readonlyMode.allowNavigation,
    panelState: options.panelState,
    panelActions: options.panelActions,
    announce(message: string) {
      stateSync.announce(message)
    },
    render() {
      renderToolbar()
    }
  }
  const stateSync = createToolbarStateSync({
    dom,
    editor,
    assistive: options.assistive,
    readonlyMode,
    readHeadingOutlineAvailable() {
      return readHeadingOutlineAvailable(panelOptions)
    },
    readHeadingOutlineActive() {
      return readHeadingOutlineActive(panelOptions)
    },
    readActiveColorPicker() {
      return colorState.readOpenColorPicker()
    }
  })
  const actionContext: ToolbarActionContext = {
    dom,
    editor,
    readonlyMode,
    signal: signalController.signal,
    announce: stateSync.announce,
    render() {
      renderToolbar()
    },
    markToolbarTransaction() {
      markToolbarTransaction()
    },
    restoreEditorFocusSoon() {
      restoreEditorFocusSoon()
    },
    closeActiveColorPicker() {
      colorState.writeOpenColorPicker(null)
    }
  }
  const unsubscribeEditor = editor.subscribe((event) => {
    if (event.kind === 'selectionChange') {
      renderToolbar()
      stateSync.syncTextMirror()

      if (performance.now() >= suppressSelectionAnnouncementsUntil) {
        stateSync.announce(readSelectionAnnouncement(editor, event.selection))
      }

      return
    }

    if (event.kind === 'transaction') {
      renderToolbar()

      if (shouldAnnounceTransaction(event.transaction.commandName)) {
        if (suppressAfterToolbarTransaction) {
          suppressSelectionAnnouncementsUntil = performance.now() + 160
        }

        suppressAfterToolbarTransaction = false
        stateSync.announce(readTransactionAnnouncement(editor, event.transaction.commandName), true)
      }

      return
    }

    if (event.kind === 'destroyed') {
      options.assistive.liveRegion.announce('JWord editor 已销毁。')
    }
  })

  /** 标记下一次 toolbar 触发的事务应当压住紧随其后的选区播报。 */
  function markToolbarTransaction(): void {
    suppressAfterToolbarTransaction = true

    queueMicrotask(() => {
      suppressAfterToolbarTransaction = false
    })
  }

  /** 在 toolbar 动作结束后把输入焦点还给 editor hidden textarea。 */
  function restoreEditorFocusSoon(): void {
    queueMicrotask(() => {
      editor.focus()
    })
  }

  /** 对宿主暴露的手动刷新入口，同时同步隐藏 mirror。 */
  function refresh(): void {
    renderToolbar()
    stateSync.syncTextMirror()
  }

  /** 同步内建 toolbar 与插件 toolbar 状态。 */
  function renderToolbar(): void {
    stateSync.render()
    pluginExtensions?.refresh()
  }

  pluginExtensions = createToolbarPluginExtensions({
    bar: dom.bar,
    editor,
    readonlyEnabled: readonlyMode.enabled,
    extensions: toolbarPluginExtensions,
    announce(message, refreshMirror) {
      stateSync.announce(message, refreshMirror)
    },
    markToolbarTransaction,
    restoreEditorFocusSoon
  })

  bindLifecycleControls(actionContext, panelOptions, options.insertActions)
  const colorFormat: ToolbarColorFormatHandle = bindFormatControls(actionContext, colorState)
  bindParagraphControls(actionContext)
  bindToolbarPanelDismissal(dom.host, panelHost, signalController.signal)
  options.editorHost?.addEventListener('mousedown', () => {
    if (colorState.readOpenColorPicker() === null) {
      return
    }

    markActiveColorReturnedToEditor(colorState)
    stateSync.render()
  }, { signal: signalController.signal })

  refresh()

  return {
    elements: {
      ...dom,
      pluginControls: pluginExtensions.pluginControls
    },
    mediaHost,
    tableHost,
    linkHost,
    panelHost,
    colorFormat,
    refresh,
    destroy(): void {
      signalController.abort()
      unsubscribeEditor()
      stateSync.destroyAssistive()
      pluginExtensions?.destroy()
      options.toolbarHost.hidden = previousToolbarHidden
      destroyToolbarDom(dom)
    }
  }
}

/** 绑定历史、文档与插入/面板控件。 */
function bindLifecycleControls(
  context: ToolbarActionContext,
  panelOptions: Parameters<typeof toggleFindReplacePanel>[0],
  insertActions: CreateToolbarControllerOptions['insertActions']
): void {
  const { dom, editor, readonlyMode } = context

  bindToolbarButton(context, dom.controls['history.undo'], () => {
    context.markToolbarTransaction()
    const result = editor.undo()

    context.render()
    context.announce(result.stackItem === null ? '没有可撤销的本地操作。' : '已撤销最近一次本地操作。', result.stackItem !== null)
  })
  bindToolbarButton(context, dom.controls['history.redo'], () => {
    context.markToolbarTransaction()
    const result = editor.redo()

    context.render()
    context.announce(result.stackItem === null ? '没有可重做的本地操作。' : '已重做最近一次本地操作。', result.stackItem !== null)
  })
  bindToolbarSelect(context, dom.controls['document.pagePreset'], () => {
    const control = readSelect(dom.controls['document.pagePreset'])

    if (control === null) {
      return
    }

    const nextPreset = control.value as PagePreset
    const currentPreset = editor.getPageConfig().preset

    if (currentPreset === nextPreset) {
      context.render()
      return
    }

    context.markToolbarTransaction()
    const nextPageConfig = editor.setPageConfig({ preset: nextPreset })

    context.render()
    context.announce(readPagePresetAnnouncement(nextPreset, nextPageConfig), true)
  })
  bindToolbarButton(context, dom.controls['document.findReplace'], () => {
    toggleFindReplacePanel(panelOptions)
  }, { restoreEditorFocus: false })
  bindToolbarButton(context, dom.controls['document.headingOutline'], () => {
    toggleHeadingOutlinePanel(panelOptions)
  }, { restoreEditorFocus: false })
  bindToolbarButton(context, dom.controls['document.headerFooter'], (control) => {
    toggleHeaderFooterPanel(panelOptions, control)
  }, { restoreEditorFocus: false })
  bindToolbarButton(context, dom.controls['document.footer'], (control) => {
    toggleFooterPanel(panelOptions, control)
  }, { restoreEditorFocus: false })
  bindToolbarButton(context, dom.controls['document.pageNumber'], (control) => {
    togglePageNumberPanel(panelOptions, control)
  }, { restoreEditorFocus: false })
  bindToolbarButton(context, dom.controls['document.revisions'], () => {
    toggleRevisionsPanel(panelOptions)
  }, { restoreEditorFocus: false })
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
