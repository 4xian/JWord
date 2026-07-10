/**
 * 职责：连接 toolbar DOM、core editor facade 和 assistive 句柄，保持 Gate 3 命令语义不变。
 * 边界：保留生命周期编排与少量通用文档动作，具体控件组动作拆入 focused toolbar 子模块。
 * 协作模块：config 解析显隐，dom 管理节点，state-sync 管理渲染，format/paragraph/insert/panel 模块处理控件动作。
 * 性能/安全约束：所有格式命令继续走 facade/transaction pipeline，不生成第二套编辑状态。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import {
  type PageOrientation,
  type PagePreset,
  type SelectionState
} from '@4xian/jword-core'
import {
  readJWordUiText,
  resolveJWordUiI18n,
  type ResolvedJWordUiI18n
} from '../i18n'
import type {
  CreateJWordUiOptions,
  JWordStatusBarLocale,
  JWordUiI18nKey,
  JWordUiThemeName,
  JWordUiThemeOptions,
  JWordToolbarControlElement,
  JWordToolbarElements
} from '../types'
import type { SelectionActionsColorFormatController } from '../selection-actions/types'
import { resolveToolbarConfig } from './config'
import {
  createToolbarDom,
  destroyToolbarDom,
  localizeToolbarDom,
  syncToolbarSelectControlState
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
import { openCustomPageSizeDialog } from './page-size-dialog'
import {
  createToolbarPluginExtensions,
  type ToolbarPluginExtensionsHandle
} from './plugin-extensions'
import { createToolbarIcon, type ToolbarIconName } from './icons'
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
import { resolveStatusBarZoomOptions } from '../status-bar/state'
import {
  createJWordUiViewController,
  JWORD_UI_VIEW_STATE_CHANGE_EVENT,
  type JWordUiViewControllerHandle
} from '../view-state'
import {
  createToolbarWatermarkMenuController,
  type ToolbarWatermarkMenuControllerHandle,
  type WatermarkToolbarActions
} from './watermark-menu'

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

interface ToolbarViewControlOptions {
  readonly view: JWordUiViewControllerHandle
  readThemeName(): JWordUiThemeName
  writeThemeName(themeName: JWordUiThemeName): void
  readLocale(): JWordStatusBarLocale
  writeLocale(locale: JWordStatusBarLocale): void
  setTheme(theme: JWordUiThemeOptions): void
  setLocale(locale: JWordStatusBarLocale): void
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
  const mediaHost = toolbarHidden
    ? null
    : createToolbarExtensionHost(dom, 'media')
  const tableHost = toolbarHidden
    ? null
    : createToolbarExtensionHost(dom, 'table')
  const linkHost = options.link === undefined || toolbarHidden
    ? null
    : createToolbarExtensionHost(dom, 'link')
  const panelHost = toolbarHidden
    || (options.headerFooter === undefined
    && options.headingOutline === undefined
    && options.findReplace === undefined
    && options.revisions === undefined)
    ? null
    : createToolbarExtensionHost(dom, 'panel')
  const editor = options.editor
  const readonlyMode = normalizeReadonlyMode(options.readonly)
  const signalController = new AbortController()
  const zoomOptions = resolveStatusBarZoomOptions(readToolbarStatusBarZoomOptions(options.statusBar))
  const fullscreenHost = resolveToolbarFullscreenHost(options)
  const viewController = createJWordUiViewController({
    editor,
    ...(options.editorHost === undefined ? {} : { editorHost: options.editorHost }),
    fullscreenHost,
    zoomOptions,
    presentationHosts: [
      dom.host,
      fullscreenHost
    ],
    presentationHiddenHosts: [
      dom.host
    ]
  })
  const viewStateHost = viewController.stateHost
  let currentThemeName: JWordUiThemeName = options.theme?.name ?? 'light'
  let currentLocale: JWordStatusBarLocale = normalizeToolbarLocale(options.i18n?.locale)
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
  bindToolbarLayoutAnnouncements(dom.host, () => currentI18n, (message) => {
    stateSync.announce(message, true)
  }, signalController.signal)
  viewStateHost.addEventListener(JWORD_UI_VIEW_STATE_CHANGE_EVENT, () => {
    viewController.syncPresentationAttributes()
    renderToolbar()
  }, { signal: signalController.signal })
  dom.host.ownerDocument.addEventListener('fullscreenchange', () => {
    renderToolbar()
  }, { signal: signalController.signal })
  dom.host.ownerDocument.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !viewController.readPresentation()) {
      return
    }

    event.preventDefault()
    viewController.writePresentation(false)
    renderToolbar()
  }, {
    capture: true,
    signal: signalController.signal
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
    syncToolbarViewControls()
    pluginExtensions?.refresh()
  }

  /** 同步主题、语言、全屏和演示等非 editor formatting 状态。 */
  function syncToolbarViewControls(): void {
    syncToolbarSelectControlState(dom.controls['view.theme'], false, currentThemeName)
    syncToolbarSelectControlState(dom.controls['view.locale'], false, currentLocale)
    const fitMode = viewController.readFitMode()
    const fullscreenActive = viewController.readFullscreenActive()
    const presentation = viewController.readPresentation()

    viewController.syncPresentationAttributes(presentation)

    syncToolbarButtonLabel(
      dom.controls['view.fullscreen'],
      readJWordUiText(
        currentI18n,
        fullscreenActive ? 'statusBar.view.exitFullscreen' : 'statusBar.view.fullscreen',
        fullscreenActive ? '退出全屏' : '全屏'
      ),
      fullscreenActive ? 'exitFullscreen' : 'fullscreen'
    )
    syncToolbarButtonLabel(
      dom.controls['view.presentation'],
      readJWordUiText(
        currentI18n,
        presentation ? 'statusBar.view.exitPresentation' : 'statusBar.view.presentation',
        presentation ? '退出演示模式' : '演示模式'
      ),
      presentation ? 'exitPresentation' : 'presentation'
    )
    syncToolbarTogglePressed(dom.controls['view.fitWidth'], fitMode === 'width')
    syncToolbarTogglePressed(dom.controls['view.fitPage'], fitMode === 'page')
    syncToolbarTogglePressed(dom.controls['view.fullscreen'], fullscreenActive)
    syncToolbarTogglePressed(dom.controls['view.presentation'], presentation)
  }

  pluginExtensions = createToolbarPluginExtensions({
    bar: dom.extensionSlots.tools ?? dom.bar,
    editor,
    readonlyEnabled: readonlyMode.enabled,
    extensions: toolbarPluginExtensions,
    announce(message, refreshMirror) {
      stateSync.announce(message, refreshMirror)
    },
    markToolbarTransaction,
    readI18n() {
      return currentI18n
    },
    restoreEditorFocusSoon
  })

  bindLifecycleControls(actionContext, panelOptions, options.insertActions, () => currentI18n, {
    view: viewController,
    readThemeName() {
      return currentThemeName
    },
    writeThemeName(themeName) {
      currentThemeName = themeName
    },
    readLocale() {
      return currentLocale
    },
    writeLocale(locale) {
      currentLocale = locale
    },
    setTheme(theme) {
      options.uiActions?.setTheme(theme)
    },
    setLocale(locale) {
      options.uiActions?.setLocale(locale)
    }
  }, watermarkMenu)
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
    setI18n(nextI18n): void {
      currentI18n = nextI18n
      currentLocale = normalizeToolbarLocale(nextI18n.locale)
      localizeToolbarDom(dom, toolbarConfig, nextI18n)
      localizeInternalToolbarPluginControls(dom.bar, nextI18n)
      localizePageSizeDialog(dom.host, nextI18n)
      watermarkMenu?.setI18n(nextI18n)
      renderToolbar()
    },
    setThemeName(nextThemeName): void {
      currentThemeName = nextThemeName
      renderToolbar()
    },
    refresh,
    destroy(): void {
      signalController.abort()
      unsubscribeEditor()
      stateSync.destroyAssistive()
      watermarkMenu?.destroy()
      pluginExtensions?.destroy()
      options.toolbarHost.hidden = previousToolbarHidden
      options.toolbarHost.removeAttribute('data-jword-presentation')
      options.toolbarHost.removeAttribute('data-jword-presentation-hidden')
      fullscreenHost.removeAttribute('data-jword-presentation')
      destroyToolbarDom(dom)
    }
  }
}

/** 绑定 toolbar 模式和 Tab 切换后的辅助播报。 */
function bindToolbarLayoutAnnouncements(
  host: HTMLElement,
  readI18n: () => ResolvedJWordUiI18n,
  announce: (message: string) => void,
  signal: AbortSignal
): void {
  host.addEventListener('jword-toolbar-modechange', (event) => {
    const mode = readToolbarCustomEventDetail(event, 'mode')

    if (mode === null) {
      return
    }

    const i18n = readI18n()
    const modeLabel = readJWordUiText(
      i18n,
      mode === 'common' ? 'toolbar.mode.common' : 'toolbar.mode.professional',
      mode === 'common' ? '常用' : '专业'
    )
    const template = readJWordUiText(i18n, 'a11y.toolbar.modeChanged', '已切换为 {mode} 工具栏。')

    announce(template.replace('{mode}', modeLabel))
  }, { signal })

  host.addEventListener('jword-toolbar-tabchange', (event) => {
    const tab = readToolbarCustomEventDetail(event, 'tab')

    if (tab === null) {
      return
    }

    const i18n = readI18n()
    const tabLabel = readJWordUiText(i18n, `toolbar.tabs.${tab}` as JWordUiI18nKey, tab)
    const template = readJWordUiText(i18n, 'a11y.toolbar.tabChanged', '已切换到 {tab} 选项卡。')

    announce(template.replace('{tab}', tabLabel))
  }, { signal })
}

/** 读取 toolbar 自定义事件中的字符串 detail。 */
function readToolbarCustomEventDetail(event: Event, key: string): string | null {
  if (!('detail' in event) || typeof event.detail !== 'object' || event.detail === null) {
    return null
  }

  const value = (event.detail as Record<string, unknown>)[key]

  return typeof value === 'string' ? value : null
}

/** 刷新 toolbar 内部插件消费者文案。 */
function localizeInternalToolbarPluginControls(bar: HTMLElement, i18n: ResolvedJWordUiI18n): void {
  const pagePreset = bar.querySelector<HTMLElement>('[data-jword-plugin-menu-key="plugin:jword.ui:pagePreset"]')

  if (pagePreset === null) {
    return
  }

  const label = readJWordUiText(i18n, 'menu.pagePreset.label', '页面')
  const ariaLabel = readJWordUiText(i18n, 'menu.pagePreset.ariaLabel', '页面尺寸')
  const tooltip = readJWordUiText(i18n, 'menu.pagePreset.tooltip', '页面尺寸')
  const trigger = pagePreset.querySelector<HTMLButtonElement>('.jw-toolbar__select-trigger')
  const labelNode = pagePreset.querySelector<HTMLElement>('.jw-toolbar__select-label')
  const fieldLabelNode = pagePreset.querySelector<HTMLElement>('.jw-toolbar__select-field-label')
  const tooltipNode = pagePreset.closest<HTMLElement>('.jw-toolbar__tooltip-anchor')?.querySelector<HTMLElement>('[role="tooltip"]')

  pagePreset.setAttribute('data-jword-field-label', label)
  trigger?.setAttribute('aria-label', ariaLabel)
  if (labelNode !== null) {
    labelNode.textContent = label
  }
  if (fieldLabelNode !== null) {
    fieldLabelNode.textContent = label
  }
  if (tooltipNode !== null && tooltipNode !== undefined) {
    tooltipNode.textContent = tooltip
  }

  for (const option of pagePreset.querySelectorAll<HTMLButtonElement>('.jw-toolbar__select-option')) {
    localizeInternalPagePresetOption(option, i18n)
  }
}

/** 刷新默认页面尺寸菜单单个选项文案。 */
function localizeInternalPagePresetOption(option: HTMLButtonElement, i18n: ResolvedJWordUiI18n): void {
  const optionName = option.getAttribute('data-jword-plugin-menu-item')
  const labelNode = option.querySelector<HTMLElement>('.jw-toolbar__select-option-label')
  const descriptionNode = option.querySelector<HTMLElement>('.jw-toolbar__select-option-description')

  if (optionName === null || labelNode === null) {
    return
  }

  const label = readJWordUiText(i18n, readPagePresetOptionLabelKey(optionName), labelNode.textContent ?? '')
  const description = descriptionNode === null
    ? ''
    : readJWordUiText(i18n, `menu.pagePreset.option.${optionName}.size`, descriptionNode.textContent ?? '')

  labelNode.textContent = label
  if (descriptionNode !== null) {
    descriptionNode.textContent = description
  }
  option.setAttribute('aria-label', `${label} ${description}`.trim())
}

/** 读取页面尺寸菜单选项 label 的 i18n key。 */
function readPagePresetOptionLabelKey(optionName: string): JWordUiI18nKey {
  return optionName === 'custom'
    ? 'menu.pagePreset.option.custom.label'
    : `toolbar.document.pagePreset.option.${optionName}` as JWordUiI18nKey
}

/** 刷新已打开的自定义页面大小弹窗文案。 */
function localizePageSizeDialog(host: HTMLElement, i18n: ResolvedJWordUiI18n): void {
  const dialog = host.querySelector<HTMLElement>('[data-jword-page-size-dialog="true"]')

  if (dialog === null) {
    return
  }

  const title = dialog.querySelector<HTMLElement>('[data-jword-page-size-title="true"]')
  const description = dialog.querySelector<HTMLElement>('[data-jword-page-size-description="true"]')
  const cancel = dialog.querySelector<HTMLButtonElement>('[data-jword-page-size-cancel="true"]')
  const apply = dialog.querySelector<HTMLButtonElement>('[data-jword-page-size-apply="true"]')
  const error = dialog.querySelector<HTMLElement>('[data-jword-page-size-error="true"]')
  const unit = readJWordUiText(i18n, 'dialog.pageSize.unitCm', '厘米')

  if (title !== null) {
    title.textContent = readJWordUiText(i18n, 'dialog.pageSize.title', '自定义页面大小')
  }
  if (description !== null) {
    description.textContent = readJWordUiText(i18n, 'dialog.pageSize.description', '输入页面宽高和四边页边距，单位为厘米。')
  }
  if (cancel !== null) {
    cancel.textContent = readJWordUiText(i18n, 'dialog.pageSize.cancel', '取消')
  }
  if (apply !== null) {
    apply.textContent = readJWordUiText(i18n, 'dialog.pageSize.apply', '应用')
  }
  if (error !== null && error.textContent !== '') {
    const errorKey = error.getAttribute('data-jword-page-size-error-key')

    if (errorKey === 'dialog.pageSize.errorInvalid' || errorKey === 'dialog.pageSize.errorContent') {
      error.textContent = readJWordUiText(i18n, errorKey, readPageSizeErrorFallback(errorKey))
    }
  }

  for (const field of dialog.querySelectorAll<HTMLElement>('[data-jword-page-size-field]')) {
    localizePageSizeDialogField(field, i18n, unit)
  }
}

/** 刷新自定义页面大小弹窗单个字段文案。 */
function localizePageSizeDialogField(field: HTMLElement, i18n: ResolvedJWordUiI18n, unit: string): void {
  const fieldName = field.getAttribute('data-jword-page-size-field')
  const label = field.querySelector<HTMLElement>('.jw-page-size-dialog__field-label')
  const input = field.querySelector<HTMLInputElement>('.jw-page-size-dialog__input')
  const unitNode = field.querySelector<HTMLElement>('.jw-page-size-dialog__unit')

  if (fieldName === null || label === null) {
    return
  }

  const labelText = readJWordUiText(i18n, readPageSizeFieldLabelKey(fieldName), label.textContent ?? '')

  label.textContent = labelText
  input?.setAttribute('aria-label', labelText)
  if (unitNode !== null) {
    unitNode.textContent = unit
  }
}

/** 读取自定义页面大小字段 label 的 i18n key。 */
function readPageSizeFieldLabelKey(fieldName: string): JWordUiI18nKey {
  return `dialog.pageSize.${fieldName}` as JWordUiI18nKey
}

/** 读取自定义页面大小错误文案 fallback。 */
function readPageSizeErrorFallback(key: 'dialog.pageSize.errorInvalid' | 'dialog.pageSize.errorContent'): string {
  return key === 'dialog.pageSize.errorInvalid'
    ? '请输入有效的页面宽高和页边距。'
    : '页边距不能大于或等于页面宽高。'
}

/** 绑定历史、文档与插入/面板控件。 */
function bindLifecycleControls(
  context: ToolbarActionContext,
  panelOptions: Parameters<typeof toggleFindReplacePanel>[0],
  insertActions: CreateToolbarControllerOptions['insertActions'],
  readI18n: () => ResolvedJWordUiI18n,
  viewOptions: ToolbarViewControlOptions,
  watermarkMenu: ToolbarWatermarkMenuControllerHandle | null
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

    const nextValue = control.value

    if (nextValue === 'custom') {
      context.render()
      openCustomPageSizeDialog({
        ownerDocument: dom.host.ownerDocument,
        host: dom.host,
        editor,
        i18n: readI18n(),
        announce: context.announce,
        markToolbarTransaction: context.markToolbarTransaction,
        refresh: context.render,
        restoreEditorFocusSoon: context.restoreEditorFocusSoon
      })
      return
    }

    const nextPreset = nextValue as PagePreset
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
  bindToolbarSelect(context, dom.controls['document.pageOrientation'], () => {
    const control = readSelect(dom.controls['document.pageOrientation'])

    if (control === null) {
      return
    }

    const nextOrientation = control.value as PageOrientation
    const currentOrientation = editor.getPageConfig().orientation

    if (currentOrientation === nextOrientation) {
      context.render()
      return
    }

    context.markToolbarTransaction()
    editor.setPageConfig({ orientation: nextOrientation })
    context.render()
    context.announce(readPageOrientationAnnouncement(readI18n(), nextOrientation), true)
  })
  bindToolbarButton(context, dom.controls['document.customPageSize'], () => {
    if (readonlyMode.enabled) {
      context.announce(readJWordUiText(readI18n(), 'a11y.blockedReadonly', 'BLOCKED: 当前为只读模式。'))
      return
    }

    openCustomPageSizeDialog({
      ownerDocument: dom.host.ownerDocument,
      host: dom.host,
      editor,
      i18n: readI18n(),
      announce: context.announce,
      markToolbarTransaction: context.markToolbarTransaction,
      refresh: context.render,
      restoreEditorFocusSoon: context.restoreEditorFocusSoon
    })
  }, { restoreEditorFocus: false })
  bindToolbarButton(context, dom.controls['document.findReplace'], () => {
    toggleFindReplacePanel(panelOptions)
  }, { restoreEditorFocus: false })
  bindToolbarButton(context, dom.controls['document.watermark'], (control) => {
    watermarkMenu?.toggle(control)
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
  bindToolbarButton(context, dom.controls['view.fitWidth'], () => {
    applyToolbarFitScale(context, viewOptions, 'width', readI18n())
  })
  bindToolbarButton(context, dom.controls['view.fitPage'], () => {
    applyToolbarFitScale(context, viewOptions, 'page', readI18n())
  })
  bindToolbarButton(context, dom.controls['view.zoomReset'], () => {
    applyToolbarZoomPercent(context, viewOptions, 100, readI18n())
  })
  bindToolbarButton(context, dom.controls['view.fullscreen'], () => {
    void toggleToolbarFullscreen(context, viewOptions)
  }, { restoreEditorFocus: false })
  bindToolbarButton(context, dom.controls['view.presentation'], () => {
    viewOptions.view.togglePresentation()
    context.render()
  }, { restoreEditorFocus: false })
  bindToolbarSelect(context, dom.controls['view.theme'], () => {
    const control = readSelect(dom.controls['view.theme'])

    if (control === null) {
      return
    }

    const nextTheme = control.value as JWordUiThemeName

    viewOptions.writeThemeName(nextTheme)
    viewOptions.setTheme({ name: nextTheme })
    context.announce(readJWordUiText(readI18n(), 'a11y.statusBar.themeChanged', '主题已切换为 {theme}。')
      .replace('{theme}', readToolbarThemeAnnouncementName(nextTheme)))
    context.render()
  })
  bindToolbarSelect(context, dom.controls['view.locale'], () => {
    const control = readSelect(dom.controls['view.locale'])

    if (control === null) {
      return
    }

    const nextLocale = normalizeToolbarLocale(control.value)

    viewOptions.writeLocale(nextLocale)
    viewOptions.setLocale(nextLocale)
    context.render()
  })
  bindToolbarButton(context, dom.controls['export.native'], () => {
    dispatchNativeExportRequest(context, readI18n())
  }, { restoreEditorFocus: false })
}

/** 应用 toolbar 视图缩放百分比。 */
function applyToolbarZoomPercent(
  context: ToolbarActionContext,
  viewOptions: ToolbarViewControlOptions,
  percent: number,
  i18n: ResolvedJWordUiI18n
): void {
  const nextPercent = viewOptions.view.applyZoomPercent(percent)

  context.announce(readJWordUiText(i18n, 'a11y.statusBar.zoomChanged', '缩放已调整为 {percent}%。')
    .replace('{percent}', String(nextPercent)))
  context.render()
}

/** 应用 toolbar 视图适应宽度或整页。 */
function applyToolbarFitScale(
  context: ToolbarActionContext,
  viewOptions: ToolbarViewControlOptions,
  mode: 'width' | 'page',
  i18n: ResolvedJWordUiI18n
): void {
  const nextPercent = viewOptions.view.applyFitScale(mode)

  if (nextPercent === null) {
    return
  }

  context.announce(readJWordUiText(i18n, 'a11y.statusBar.zoomChanged', '缩放已调整为 {percent}%。')
    .replace('{percent}', String(nextPercent)))
  context.render()
}

/** 切换 toolbar 视图全屏状态。 */
async function toggleToolbarFullscreen(
  context: ToolbarActionContext,
  viewOptions: ToolbarViewControlOptions
): Promise<void> {
  await viewOptions.view.toggleFullscreen()

  if (context.signal.aborted) {
    return
  }

  context.render()
}

/** 派发原生格式导出请求，供宿主接管。 */
function dispatchNativeExportRequest(context: ToolbarActionContext, i18n: ResolvedJWordUiI18n): void {
  const CustomEventCtor = context.dom.host.ownerDocument.defaultView?.CustomEvent ?? CustomEvent
  const event = new CustomEventCtor('jword-toolbar-export-native', {
    bubbles: true,
    cancelable: true,
    detail: {
      editor: context.editor
    }
  })

  context.dom.host.dispatchEvent(event)
  if (!event.defaultPrevented) {
    context.announce(readJWordUiText(i18n, 'a11y.export.nativeUnavailable', '宿主未配置原生格式导出。'))
  }
}

/** 读取页面方向切换播报。 */
function readPageOrientationAnnouncement(i18n: ResolvedJWordUiI18n, orientation: PageOrientation): string {
  const label = readJWordUiText(
    i18n,
    orientation === 'landscape'
      ? 'toolbar.document.pageOrientation.option.landscape'
      : 'toolbar.document.pageOrientation.option.portrait',
    orientation === 'landscape' ? '横向' : '纵向'
  )

  return readJWordUiText(i18n, 'a11y.pageOrientationChanged', '页面方向已切换为 {orientation}。')
    .replace('{orientation}', label)
}

/** 读取 toolbar 复用的状态栏缩放配置。 */
function readToolbarStatusBarZoomOptions(statusBar: CreateJWordUiOptions['statusBar']) {
  return typeof statusBar === 'object' && statusBar !== null
    ? statusBar.zoom
    : undefined
}

/** 读取 toolbar 与状态栏共用的全屏/视图状态宿主。 */
function resolveToolbarFullscreenHost(options: CreateToolbarControllerOptions): HTMLElement {
  if (typeof options.statusBar === 'object' && options.statusBar !== null && options.statusBar.fullscreenHost !== undefined) {
    return options.statusBar.fullscreenHost
  }

  return options.editorHost ?? options.toolbarHost
}

/** 规范化 toolbar 语言选择。 */
function normalizeToolbarLocale(locale: string | undefined): JWordStatusBarLocale {
  return locale === 'en-US' ? 'en-US' : 'zh-CN'
}

/** 读取主题播报名。 */
function readToolbarThemeAnnouncementName(theme: JWordUiThemeName): string {
  return theme === 'dark' ? 'dark' : 'light'
}

/** 更新 toolbar 按钮的可见 label 与辅助文案。 */
function syncToolbarButtonLabel(
  control: JWordToolbarControlElement | undefined,
  label: string,
  icon?: ToolbarIconName
): void {
  if (!(control instanceof HTMLButtonElement)) {
    return
  }

  control.setAttribute('aria-label', label)
  control.title = label
  syncToolbarButtonTooltip(control, label)
  if (icon !== undefined) {
    syncToolbarButtonIcon(control, icon)
  }
  const labelNode = control.querySelector<HTMLElement>('.jw-toolbar__button-label')

  if (labelNode !== null) {
    labelNode.textContent = label
  }
}

/** 更新 toolbar 按钮的 tooltip 文案。 */
function syncToolbarButtonTooltip(control: HTMLButtonElement, label: string): void {
  const tooltip = control.closest<HTMLElement>('.jw-toolbar__tooltip-anchor')?.querySelector<HTMLElement>('[role="tooltip"]')

  if (tooltip !== null && tooltip !== undefined) {
    tooltip.textContent = label
  }
}

/** 更新 toolbar 按钮首个 SVG 图标。 */
function syncToolbarButtonIcon(control: HTMLButtonElement, icon: ToolbarIconName): void {
  const currentIcon = control.querySelector<SVGElement>('svg[data-jword-icon]')

  if (currentIcon?.getAttribute('data-jword-icon') === icon) {
    return
  }

  const nextIcon = createToolbarIcon(icon)

  if (currentIcon === null) {
    control.prepend(nextIcon)
    return
  }

  currentIcon.replaceWith(nextIcon)
}

/** 更新 toolbar toggle 按钮按下态。 */
function syncToolbarTogglePressed(control: JWordToolbarControlElement | undefined, active: boolean): void {
  if (!(control instanceof HTMLButtonElement)) {
    return
  }

  control.setAttribute('aria-pressed', active ? 'true' : 'false')
}
