/**
 * 职责：连接 toolbar DOM、core editor facade 和 assistive 句柄，保持 Gate 3 命令语义不变。
 * 边界：保留生命周期编排与少量通用文档动作，具体控件组动作拆入 focused toolbar 子模块。
 * 协作模块：config 解析显隐，dom 管理节点，state-sync 管理渲染，format/paragraph/insert/panel 模块处理控件动作。
 * 性能/安全约束：所有格式命令继续走 facade/transaction pipeline，不生成第二套编辑状态。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import {
  readJWordUiText,
  resolveJWordUiI18n,
  type ResolvedJWordUiI18n
} from '../i18n'
import type {
  CreateJWordUiOptions,
  JWordStatusBarLocale,
  JWordUiThemeName,
  JWordUiThemeOptions,
  JWordToolbarElements
} from '../types'
import type { SelectionActionsColorFormatController } from '../selection-actions/types'
import { resolveToolbarConfig } from './config'
import {
  createToolbarDom,
  destroyToolbarDom,
  localizeToolbarDom
} from './dom'
import {
  bindFormatControls,
  createToolbarColorSessionState,
  markActiveColorReturnedToEditor
} from './format-controls'
import type {
  ToolbarColorFormatHandle
} from './format-controls'
import { bindParagraphControls } from './paragraph-controls'
import { bindInsertControls, type ToolbarInsertActions } from './insert-controls'
import {
  bindPanelControls,
  bindToolbarPanelDismissal,
  createToolbarExtensionHosts,
  readHeadingOutlineActive,
  readHeadingOutlineAvailable
} from './panel-lifecycle'
import { resolveToolbarPluginExtensions } from './internal-plugin-extensions'
import {
  createToolbarPluginExtensions,
  type ToolbarPluginExtensionsHandle
} from './plugin-extensions'
import {
  createToolbarStateSync,
  normalizeReadonlyMode
} from './toolbar-state-sync'
import { bindToolbarHistoryControls } from './history-controls'
import type {
  ToolbarActionContext,
  ToolbarControllerAssistive
} from './toolbar-state-sync'
import {
  createToolbarWatermarkMenuController,
  type WatermarkToolbarActions
} from './watermark-menu'
import {
  bindToolbarLayoutAnnouncements,
  createToolbarEditorAnnouncements,
  localizeInternalToolbarPluginControls,
  localizePageSizeDialog
} from './localization'
import { bindPageControls } from './page-controls'
import {
  createToolbarViewControls,
  normalizeToolbarLocale
} from './view-controls'

interface CreateToolbarControllerOptions extends Omit<CreateJWordUiOptions, 'toolbarHost'> {
  readonly toolbarHost: HTMLElement
  readonly assistive: ToolbarControllerAssistive
  readonly insertActions?: ToolbarInsertActions
  readonly panelActions?: {
    readonly toggleFindReplace?: (anchor: HTMLElement) => void
    readonly toggleHeadingOutline?: () => void
    readonly toggleHeaderFooter?: (anchor: HTMLElement) => void
    readonly toggleFooter?: (anchor: HTMLElement) => void
    readonly togglePageNumber?: (anchor: HTMLElement) => void
    readonly toggleRevisions?: () => void
  }
  readonly panelState?: {
    readonly headingOutline?: () => boolean
    readonly headingOutlineAvailable?: () => boolean
    readonly revisions?: () => boolean
  }
  readonly uiActions?: {
    setTheme(theme: JWordUiThemeOptions): void
    setLocale(locale: JWordStatusBarLocale): void
  }
  readonly watermarkActions?: WatermarkToolbarActions
}

interface ToolbarControllerHandle {
  readonly elements: JWordToolbarElements
  readonly mediaHost: HTMLElement | null
  readonly tableHost: HTMLElement | null
  readonly linkHost: HTMLElement | null
  readonly panelHost: HTMLElement | null
  readonly colorFormat: SelectionActionsColorFormatController
  setI18n(i18n: ResolvedJWordUiI18n): void
  setThemeName(themeName: JWordUiThemeName): void
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
  const i18n = resolveJWordUiI18n(options.i18n)
  let currentI18n = i18n
  const toolbarPluginExtensions = resolveToolbarPluginExtensions({
    toolbar: options.toolbar,
    toolbarHidden,
    toolbarConfig,
    externalExtensions: options.pluginExtensions,
    i18n
  })
  const dom = createToolbarDom(options.toolbarHost, toolbarConfig, i18n)
  if (toolbarHidden) {
    options.toolbarHost.hidden = true
  }
  const { mediaHost, tableHost, linkHost, panelHost } = createToolbarExtensionHosts(dom, {
    toolbarHidden,
    linkEnabled: options.link !== undefined,
    panelEnabled: options.headerFooter !== undefined
      || options.headingOutline !== undefined
      || options.findReplace !== undefined
      || options.revisions !== undefined
  })
  const editor = options.editor
  const readonlyMode = normalizeReadonlyMode(options.readonly)
  const signalController = new AbortController()
  const viewControls = createToolbarViewControls({
    dom,
    editor,
    editorHost: options.editorHost,
    toolbarHost: options.toolbarHost,
    statusBar: options.statusBar,
    themeName: options.theme?.name ?? 'light',
    locale: normalizeToolbarLocale(options.i18n?.locale),
    uiActions: options.uiActions,
    signal: signalController.signal,
    readI18n() {
      return currentI18n
    },
    render() {
      renderToolbar()
    }
  })
  const fullscreenHost = viewControls.fullscreenHost
  let pluginExtensions: ToolbarPluginExtensionsHandle | null = null
  let destroyed = false
  const colorState = createToolbarColorSessionState()
  const panelOptions = {
    readonlyEnabled: readonlyMode.enabled,
    readonlyAllowNavigation: readonlyMode.allowNavigation,
    panelState: options.panelState,
    panelActions: options.panelActions,
    readI18n() {
      return currentI18n
    },
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
    readRevisionsActive() {
      return options.panelState?.revisions?.() === true
    },
    readActiveColorPicker() {
      return colorState.readOpenColorPicker()
    }
  })
  bindToolbarLayoutAnnouncements(dom.host, () => currentI18n, (message) => {
    stateSync.announce(message, true)
  }, signalController.signal)
  const actionContext: ToolbarActionContext = {
    dom,
    editor,
    readonlyMode,
    signal: signalController.signal,
    readI18n() {
      return currentI18n
    },
    announce: stateSync.announce,
    render() {
      renderToolbar()
    },
    markToolbarTransaction() {
      editorAnnouncements.markToolbarTransaction()
    },
    restoreEditorFocusSoon() {
      restoreEditorFocusSoon()
    },
    closeActiveColorPicker() {
      colorState.writeOpenColorPicker(null)
    }
  }
  const watermarkMenu = options.watermarkActions === undefined
    ? null
    : createToolbarWatermarkMenuController({
      host: dom.host,
      actions: options.watermarkActions,
      signal: signalController.signal,
      readI18n() {
        return currentI18n
      },
      announce(message, refreshMirror) {
        stateSync.announce(message, refreshMirror)
      }
    })
  const editorAnnouncements = createToolbarEditorAnnouncements({
    editor,
    stateSync,
    readI18n() {
      return currentI18n
    },
    render: renderToolbar,
    announceDestroyed() {
      options.assistive.liveRegion.announce(readJWordUiText(
        currentI18n,
        'a11y.editor.destroyed'
      ))
    }
  })

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
    viewControls.sync()
    pluginExtensions?.refresh()
  }

  /** 释放 toolbar 构造或正常运行期间创建的全部资源。 */
  function destroyToolbarController(): void {
    if (destroyed) {
      return
    }

    destroyed = true
    signalController.abort()
    editorAnnouncements.destroy()
    stateSync.destroyAssistive()
    watermarkMenu?.destroy()
    pluginExtensions?.destroy()
    options.toolbarHost.hidden = previousToolbarHidden
    options.toolbarHost.removeAttribute('data-jword-presentation')
    options.toolbarHost.removeAttribute('data-jword-presentation-hidden')
    fullscreenHost.removeAttribute('data-jword-presentation')
    destroyToolbarDom(dom)
  }

  let colorFormat: ToolbarColorFormatHandle

  try {
    pluginExtensions = createToolbarPluginExtensions({
      bar: dom.extensionSlots.tools ?? dom.bar,
      editor,
      readonlyEnabled: readonlyMode.enabled,
      extensions: toolbarPluginExtensions,
      announce(message, refreshMirror) {
        stateSync.announce(message, refreshMirror)
      },
      markToolbarTransaction: editorAnnouncements.markToolbarTransaction,
      readI18n() {
        return currentI18n
      },
      restoreEditorFocusSoon
    })

    bindToolbarHistoryControls(actionContext, () => currentI18n)
    bindPageControls(actionContext, () => currentI18n)
    bindPanelControls(actionContext, panelOptions, watermarkMenu)
    bindInsertControls(actionContext, options.insertActions)
    viewControls.bind(actionContext)
    colorFormat = bindFormatControls(actionContext, colorState)
    bindParagraphControls(actionContext)
    bindToolbarPanelDismissal(dom.host, [
      panelHost,
      options.editorHost,
      options.headerFooter?.host,
      options.findReplace?.host,
      options.revisions?.host
    ], signalController.signal)
    options.editorHost?.addEventListener('mousedown', () => {
      if (colorState.readOpenColorPicker() === null) {
        return
      }

      markActiveColorReturnedToEditor(colorState)
      stateSync.render()
    }, { signal: signalController.signal })

    refresh()
  } catch (error) {
    destroyToolbarController()
    throw error
  }

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
    setI18n(nextI18n): void {
      currentI18n = nextI18n
      viewControls.setLocale(normalizeToolbarLocale(nextI18n.locale))
      localizeToolbarDom(dom, toolbarConfig, nextI18n)
      localizeInternalToolbarPluginControls(dom.bar, nextI18n)
      localizePageSizeDialog(dom.host, nextI18n)
      watermarkMenu?.setI18n(nextI18n)
      renderToolbar()
    },
    setThemeName(nextThemeName): void {
      viewControls.setThemeName(nextThemeName)
      renderToolbar()
    },
    refresh,
    destroy: destroyToolbarController
  }
}
