/**
 * 职责：绑定并同步 toolbar 缩放、适配、全屏、演示、主题和语言控件。
 * 边界：只管理视图状态，不执行文档编辑命令或面板动作。
 * 协作模块：controller 持有 view controller 生命周期，本模块处理控件事件与状态渲染。
 * 性能/安全约束：复用统一 view-state，不保存第二套视图状态。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import {
  readJWordUiText,
  type ResolvedJWordUiI18n
} from '../i18n'
import { resolveStatusBarZoomOptions } from '../status-bar/state'
import type {
  CreateJWordUiOptions,
  JWordStatusBarLocale,
  JWordUiThemeName,
  JWordUiThemeOptions,
  JWordToolbarControlElement
} from '../types'
import {
  createJWordUiViewController,
  JWORD_UI_VIEW_STATE_CHANGE_EVENT,
  type JWordUiViewControllerHandle
} from '../view-state'
import { syncToolbarSelectControlState, type ToolbarDom } from './dom'
import { createToolbarIcon, type ToolbarIconName } from './icons'
import {
  bindToolbarButton,
  bindToolbarSelect,
  readSelect,
  type ToolbarActionContext
} from './toolbar-state-sync'

interface ToolbarViewControlOptions {
  readonly view: JWordUiViewControllerHandle
  writeThemeName(themeName: JWordUiThemeName): void
  writeLocale(locale: JWordStatusBarLocale): void
  setTheme(theme: JWordUiThemeOptions): void
  setLocale(locale: JWordStatusBarLocale): void
}

interface CreateToolbarViewControlsOptions {
  readonly dom: ToolbarDom
  readonly editor: CreateJWordUiOptions['editor']
  readonly editorHost: HTMLElement | undefined
  readonly toolbarHost: HTMLElement
  readonly statusBar: CreateJWordUiOptions['statusBar']
  readonly themeName: JWordUiThemeName
  readonly locale: JWordStatusBarLocale
  readonly uiActions: {
    setTheme(theme: JWordUiThemeOptions): void
    setLocale(locale: JWordStatusBarLocale): void
  } | undefined
  readonly signal: AbortSignal
  readI18n(): ResolvedJWordUiI18n
  render(): void
}

export interface ToolbarViewControlsHandle {
  readonly view: JWordUiViewControllerHandle
  readonly fullscreenHost: HTMLElement
  bind(context: ToolbarActionContext): void
  sync(): void
  setThemeName(themeName: JWordUiThemeName): void
  setLocale(locale: JWordStatusBarLocale): void
}

/** 创建并持有 toolbar 视图控件状态。 */
export function createToolbarViewControls(options: CreateToolbarViewControlsOptions): ToolbarViewControlsHandle {
  const fullscreenHost = resolveToolbarFullscreenHost(options.statusBar, options.editorHost, options.toolbarHost)
  const view = createJWordUiViewController({
    editor: options.editor,
    ...(options.editorHost === undefined ? {} : { editorHost: options.editorHost }),
    fullscreenHost,
    zoomOptions: readToolbarStatusBarZoomOptions(options.statusBar),
    presentationHosts: [
      options.dom.host,
      fullscreenHost
    ],
    presentationHiddenHosts: [
      options.dom.host
    ]
  })
  let currentThemeName = options.themeName
  let currentLocale = options.locale

  bindToolbarViewStateListeners(options.dom, view, options.render, options.signal)

  return {
    view,
    fullscreenHost,
    bind(context): void {
      bindToolbarViewControls(context, options.readI18n, {
        view,
        writeThemeName(themeName) {
          currentThemeName = themeName
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
      })
    },
    sync(): void {
      syncToolbarViewControls(options.dom, view, options.readI18n(), currentThemeName, currentLocale)
    },
    setThemeName(themeName): void {
      currentThemeName = themeName
    },
    setLocale(locale): void {
      currentLocale = locale
    }
  }
}

/** 绑定视图状态、全屏和演示模式的生命周期监听。 */
export function bindToolbarViewStateListeners(
  dom: ToolbarDom,
  view: JWordUiViewControllerHandle,
  render: () => void,
  signal: AbortSignal
): void {
  view.stateHost.addEventListener(JWORD_UI_VIEW_STATE_CHANGE_EVENT, () => {
    view.syncPresentationAttributes()
    render()
  }, { signal })
  dom.host.ownerDocument.addEventListener('fullscreenchange', render, { signal })
  dom.host.ownerDocument.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !view.readPresentation()) {
      return
    }

    event.preventDefault()
    view.writePresentation(false)
    render()
  }, {
    capture: true,
    signal
  })
}

/** 绑定 toolbar 视图控制按钮和选择器。 */
export function bindToolbarViewControls(
  context: ToolbarActionContext,
  readI18n: () => ResolvedJWordUiI18n,
  options: ToolbarViewControlOptions
): void {
  const { dom } = context

  bindToolbarButton(context, dom.controls['view.fitWidth'], () => {
    applyToolbarFitScale(context, options, 'width', readI18n())
  })
  bindToolbarButton(context, dom.controls['view.fitPage'], () => {
    applyToolbarFitScale(context, options, 'page', readI18n())
  })
  bindToolbarButton(context, dom.controls['view.zoomReset'], () => {
    applyToolbarZoomPercent(context, options, 100, readI18n())
  })
  bindToolbarButton(context, dom.controls['view.fullscreen'], () => {
    void toggleToolbarFullscreen(context, options)
  }, { restoreEditorFocus: false })
  bindToolbarButton(context, dom.controls['view.presentation'], () => {
    options.view.togglePresentation()
    context.render()
  }, { restoreEditorFocus: false })
  bindToolbarSelect(context, dom.controls['view.theme'], () => {
    const control = readSelect(dom.controls['view.theme'])

    if (control === null) {
      return
    }

    const nextTheme = control.value as JWordUiThemeName

    options.writeThemeName(nextTheme)
    options.setTheme({ name: nextTheme })
    context.announce(readJWordUiText(readI18n(), 'a11y.statusBar.themeChanged')
      .replace('{theme}', readToolbarThemeAnnouncementName(nextTheme)))
    context.render()
  })
  bindToolbarSelect(context, dom.controls['view.locale'], () => {
    const control = readSelect(dom.controls['view.locale'])

    if (control === null) {
      return
    }

    const nextLocale = normalizeToolbarLocale(control.value)

    options.writeLocale(nextLocale)
    options.setLocale(nextLocale)
    context.render()
  })
}

/** 同步主题、语言、全屏和演示等非 editor formatting 状态。 */
export function syncToolbarViewControls(
  dom: ToolbarDom,
  view: JWordUiViewControllerHandle,
  i18n: ResolvedJWordUiI18n,
  themeName: JWordUiThemeName,
  locale: JWordStatusBarLocale
): void {
  syncToolbarSelectControlState(dom.controls['view.theme'], false, themeName)
  syncToolbarSelectControlState(dom.controls['view.locale'], false, locale)
  const fitMode = view.readFitMode()
  const fullscreenActive = view.readFullscreenActive()
  const presentation = view.readPresentation()

  view.syncPresentationAttributes(presentation)

  syncToolbarButtonLabel(
    dom.controls['view.fullscreen'],
    readJWordUiText(
      i18n,
      fullscreenActive ? 'statusBar.view.exitFullscreen' : 'statusBar.view.fullscreen'
    ),
    fullscreenActive ? 'exitFullscreen' : 'fullscreen'
  )
  syncToolbarButtonLabel(
    dom.controls['view.presentation'],
    readJWordUiText(
      i18n,
      presentation ? 'statusBar.view.exitPresentation' : 'statusBar.view.presentation'
    ),
    presentation ? 'exitPresentation' : 'presentation'
  )
  syncToolbarTogglePressed(dom.controls['view.fitWidth'], fitMode === 'width')
  syncToolbarTogglePressed(dom.controls['view.fitPage'], fitMode === 'page')
  syncToolbarTogglePressed(dom.controls['view.fullscreen'], fullscreenActive)
  syncToolbarTogglePressed(dom.controls['view.presentation'], presentation)
}

/** 读取 toolbar 复用的状态栏缩放配置。 */
export function readToolbarStatusBarZoomOptions(statusBar: CreateJWordUiOptions['statusBar']) {
  return typeof statusBar === 'object' && statusBar !== null
    ? resolveStatusBarZoomOptions(statusBar.zoom)
    : resolveStatusBarZoomOptions(undefined)
}

/** 读取 toolbar 与状态栏共用的全屏/视图状态宿主。 */
export function resolveToolbarFullscreenHost(
  statusBar: CreateJWordUiOptions['statusBar'],
  editorHost: HTMLElement | undefined,
  toolbarHost: HTMLElement
): HTMLElement {
  if (typeof statusBar === 'object' && statusBar !== null && statusBar.fullscreenHost !== undefined) {
    return statusBar.fullscreenHost
  }

  return editorHost ?? toolbarHost
}

/** 规范化 toolbar 语言选择。 */
export function normalizeToolbarLocale(locale: string | undefined): JWordStatusBarLocale {
  return locale === 'en-US' ? 'en-US' : 'zh-CN'
}

/** 应用 toolbar 视图缩放百分比。 */
function applyToolbarZoomPercent(
  context: ToolbarActionContext,
  options: ToolbarViewControlOptions,
  percent: number,
  i18n: ResolvedJWordUiI18n
): void {
  const nextPercent = options.view.applyZoomPercent(percent)

  context.announce(readJWordUiText(i18n, 'a11y.statusBar.zoomChanged')
    .replace('{percent}', String(nextPercent)))
  context.render()
}

/** 应用 toolbar 视图适应宽度或整页。 */
function applyToolbarFitScale(
  context: ToolbarActionContext,
  options: ToolbarViewControlOptions,
  mode: 'width' | 'page',
  i18n: ResolvedJWordUiI18n
): void {
  const nextPercent = options.view.applyFitScale(mode)

  if (nextPercent === null) {
    return
  }

  context.announce(readJWordUiText(i18n, 'a11y.statusBar.zoomChanged')
    .replace('{percent}', String(nextPercent)))
  context.render()
}

/** 切换 toolbar 视图全屏状态。 */
async function toggleToolbarFullscreen(
  context: ToolbarActionContext,
  options: ToolbarViewControlOptions
): Promise<void> {
  await options.view.toggleFullscreen()

  if (context.signal.aborted) {
    return
  }

  context.render()
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
