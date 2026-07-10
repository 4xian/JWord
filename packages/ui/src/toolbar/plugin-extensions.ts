/**
 * 职责：渲染 Gate 7 Plugin API M4 的 toolbar / menu 插件扩展入口。
 * 边界：只负责 UI 包 DOM 注册和 core 插件命令触发，不保存第二套编辑状态。
 * 协作模块：toolbar controller 提供生命周期，core editor facade 执行插件命令，types 定义公开插件 UI 契约。
 * 性能/安全约束：状态刷新只读取 projection/selection，不触发布局；插件工具 ID 不并入内建 union。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import type { Editor } from '@4xian/jword-core'

import type {
  JWordMenuPluginAction,
  JWordMenuPluginItem,
  JWordToolbarPluginItem,
  JWordUiPluginExtension,
  JWordUiPluginRenderContext
} from '../types'
import type { ResolvedJWordUiI18n } from '../i18n'
import { createToolbarIcon } from './icons'
import { CUSTOM_PAGE_SIZE_COMMAND, openCustomPageSizeDialog } from './page-size-dialog'
import { wrapWithTooltip } from './tooltip'

interface CreateToolbarPluginExtensionsOptions {
  readonly bar: HTMLElement
  readonly editor: Editor
  readonly readonlyEnabled: boolean
  readonly extensions: readonly JWordUiPluginExtension[] | undefined
  announce(message: string, refreshMirror?: boolean): void
  markToolbarTransaction(): void
  readI18n(): ResolvedJWordUiI18n
  restoreEditorFocusSoon(): void
}

interface RegisteredPluginButton {
  readonly button: HTMLButtonElement
  readonly extension: JWordUiPluginExtension
  readonly item: JWordToolbarPluginItem
}

interface RegisteredPluginMenuAction {
  readonly button: HTMLButtonElement
  readonly extension: JWordUiPluginExtension
  readonly action: JWordMenuPluginAction
}

interface RegisteredPluginMenu {
  readonly wrapper: HTMLElement
  readonly trigger: HTMLButtonElement
  readonly menu: HTMLElement
}

export interface ToolbarPluginExtensionsHandle {
  readonly pluginControls: Readonly<Record<string, HTMLButtonElement>>
  refresh(): void
  destroy(): void
}

/** 创建插件 UI 扩展宿主。 */
export function createToolbarPluginExtensions(
  options: CreateToolbarPluginExtensionsOptions
): ToolbarPluginExtensionsHandle {
  const extensions = options.extensions ?? []
  const pluginControls: Record<string, HTMLButtonElement> = {}

  if (extensions.length === 0) {
    return {
      pluginControls,
      refresh(): void {},
      destroy(): void {}
    }
  }

  const ownerDocument = options.bar.ownerDocument
  const signalController = new (ownerDocument.defaultView?.AbortController ?? AbortController)()
  const group = ownerDocument.createElement('div')
  const tooltipDestroyers: Array<() => void> = []
  const buttons: RegisteredPluginButton[] = []
  const menuActions: RegisteredPluginMenuAction[] = []
  const menus: RegisteredPluginMenu[] = []

  group.className = 'jw-toolbar__group jw-toolbar__group--separated'
  group.setAttribute('data-jword-plugin-toolbar-host', 'true')
  options.bar.append(group)

  for (const extension of extensions) {
    for (const item of extension.toolbarItems ?? []) {
      const button = createPluginToolbarButton(ownerDocument, extension, item)
      const { anchor, destroy } = wrapWithTooltip(button, item.tooltip ?? item.label)
      const key = createPluginToolKey(extension.pluginName, item.name)

      pluginControls[key] = button
      tooltipDestroyers.push(destroy)
      group.append(anchor)
      buttons.push({ button, extension, item })
      button.addEventListener('click', () => {
        if (button.disabled) {
          return
        }

        executePluginCommand(options, item.commandName, item.input)
        refresh()
        announcePluginControlResult(options, item)
      }, { signal: signalController.signal })
    }

    for (const menu of extension.menus ?? []) {
      const renderedMenu = createPluginMenu(ownerDocument, extension, menu)
      const { anchor, destroy } = wrapWithTooltip(renderedMenu.wrapper, menu.tooltip ?? menu.label)

      tooltipDestroyers.push(destroy)
      group.append(anchor)
      menus.push(renderedMenu)
      renderedMenu.trigger.addEventListener('click', () => {
        if (renderedMenu.trigger.disabled) {
          return
        }

        const nextOpen = renderedMenu.menu.hidden === true

        closePluginMenus(menus)
        setPluginMenuOpen(renderedMenu, nextOpen)
      }, { signal: signalController.signal })

      for (const action of menu.items) {
        const actionButton = renderedMenu.menu.querySelector<HTMLButtonElement>(
          `[data-jword-plugin-menu-item-key="${createPluginMenuActionKey(extension.pluginName, menu.name, action.name)}"]`
        )

        if (actionButton === null) {
          continue
        }

        menuActions.push({ button: actionButton, extension, action })
        actionButton.addEventListener('click', () => {
          if (actionButton.disabled) {
            return
          }

          closePluginMenus(menus)
          if (action.commandName === CUSTOM_PAGE_SIZE_COMMAND) {
            openCustomPageSizeDialog({
              ownerDocument,
              host: options.bar.closest<HTMLElement>('.jw-root') ?? options.bar,
              editor: options.editor,
              i18n: options.readI18n(),
              announce: options.announce,
              markToolbarTransaction: options.markToolbarTransaction,
              refresh,
              restoreEditorFocusSoon: options.restoreEditorFocusSoon
            })
            return
          }

          executePluginCommand(options, action.commandName, action.input)
          refresh()
          announcePluginControlResult(options, action)
        }, { signal: signalController.signal })
      }
    }
  }

  ownerDocument.addEventListener('click', (event) => {
    const target = event.target

    if (target instanceof Node && group.contains(target)) {
      return
    }

    closePluginMenus(menus)
  }, { signal: signalController.signal })

  refresh()

  return {
    pluginControls,
    refresh,
    destroy(): void {
      signalController.abort()
      closePluginMenus(menus)
      for (const destroyTooltip of tooltipDestroyers) {
        destroyTooltip()
      }
      group.remove()
    }
  }

  /** 刷新所有插件按钮和菜单动作状态。 */
  function refresh(): void {
    const context = createRenderContext(options)

    for (const registered of buttons) {
      const enabled = readPluginControlEnabled(registered.item, context)
      const active = registered.item.active?.(context) === true

      registered.button.disabled = !enabled
      if (registered.item.active === undefined) {
        registered.button.removeAttribute('aria-pressed')
      } else {
        registered.button.setAttribute('aria-pressed', active ? 'true' : 'false')
      }
    }

    for (const registered of menuActions) {
      const active = registered.action.active?.(context) === true

      registered.button.disabled = !readPluginControlEnabled(registered.action, context)
      if (registered.action.active === undefined) {
        registered.button.removeAttribute('data-jword-selected')
        registered.button.removeAttribute('aria-checked')
      } else {
        registered.button.setAttribute('data-jword-selected', active ? 'true' : 'false')
        registered.button.setAttribute('aria-checked', active ? 'true' : 'false')
      }
    }

    for (const menu of menus) {
      syncPluginMenuTriggerState(menu)
    }
  }
}

/** 创建插件 toolbar 按钮。 */
function createPluginToolbarButton(
  ownerDocument: Document,
  extension: JWordUiPluginExtension,
  item: JWordToolbarPluginItem
): HTMLButtonElement {
  const button = ownerDocument.createElement('button')

  button.type = 'button'
  button.className = 'jw-toolbar__button jw-toolbar__plugin-button'
  button.textContent = item.label
  button.setAttribute('data-jword-tooltip-surface', 'true')
  button.setAttribute('data-jword-plugin-tool-key', createPluginToolKey(extension.pluginName, item.name))
  button.setAttribute('data-jword-plugin-name', extension.pluginName)
  button.setAttribute('data-jword-plugin-toolbar-item', item.name)
  button.setAttribute('aria-label', item.ariaLabel ?? item.label)
  bindPluginPointerFocusGuard(button)

  return button
}

/** 创建插件菜单触发器和菜单项。 */
function createPluginMenu(
  ownerDocument: Document,
  extension: JWordUiPluginExtension,
  menu: JWordMenuPluginItem
): RegisteredPluginMenu {
  const wrapper = ownerDocument.createElement('span')
  const trigger = ownerDocument.createElement('button')
  const triggerRow = ownerDocument.createElement('span')
  const label = ownerDocument.createElement('span')
  const fieldLabel = ownerDocument.createElement('span')
  const arrow = ownerDocument.createElement('span')
  const menuElement = ownerDocument.createElement('div')

  wrapper.className = 'jw-toolbar__select-wrap jw-toolbar__plugin-menu'
  wrapper.setAttribute('data-jword-plugin-menu-key', createPluginToolKey(extension.pluginName, menu.name))
  wrapper.setAttribute('data-jword-plugin-name', extension.pluginName)
  wrapper.setAttribute('data-jword-plugin-menu', menu.name)
  wrapper.setAttribute('data-jword-open', 'false')
  wrapper.setAttribute('data-jword-field-label', menu.label)
  trigger.type = 'button'
  trigger.className = 'jw-toolbar__select-trigger'
  trigger.setAttribute('data-jword-tooltip-surface', 'true')
  trigger.setAttribute('aria-label', menu.ariaLabel ?? menu.label)
  trigger.setAttribute('aria-haspopup', 'menu')
  trigger.setAttribute('aria-expanded', 'false')
  triggerRow.className = 'jw-toolbar__select-trigger-row'
  label.className = 'jw-toolbar__select-label'
  label.textContent = menu.label
  fieldLabel.className = 'jw-toolbar__select-field-label'
  fieldLabel.textContent = menu.label
  arrow.className = 'jw-toolbar__select-arrow'
  arrow.append(createToolbarIcon('caretDown'))
  menuElement.className = 'jw-toolbar__select-menu'
  menuElement.setAttribute('role', 'menu')
  menuElement.hidden = true

  for (const action of menu.items) {
    menuElement.append(createPluginMenuAction(ownerDocument, extension, menu, action))
  }

  triggerRow.append(label, arrow)
  trigger.append(triggerRow, fieldLabel)
  wrapper.append(trigger, menuElement)
  bindPluginPointerFocusGuard(trigger)

  return {
    wrapper,
    trigger,
    menu: menuElement
  }
}

/** 创建插件菜单动作按钮。 */
function createPluginMenuAction(
  ownerDocument: Document,
  extension: JWordUiPluginExtension,
  menu: JWordMenuPluginItem,
  action: JWordMenuPluginAction
): HTMLButtonElement {
  const button = ownerDocument.createElement('button')
  const label = ownerDocument.createElement('span')
  const description = action.description === undefined
    ? null
    : ownerDocument.createElement('span')

  button.type = 'button'
  button.className = 'jw-toolbar__select-option'
  button.setAttribute('role', action.active === undefined ? 'menuitem' : 'menuitemradio')
  button.setAttribute('data-jword-plugin-menu-item-key', createPluginMenuActionKey(extension.pluginName, menu.name, action.name))
  button.setAttribute('data-jword-plugin-name', extension.pluginName)
  button.setAttribute('data-jword-plugin-menu-item', action.name)
  button.setAttribute('aria-label', action.ariaLabel ?? readPluginMenuActionAriaLabel(action))
  label.className = 'jw-toolbar__select-option-label'
  label.textContent = action.label
  if (description !== null) {
    description.className = 'jw-toolbar__select-option-description'
    description.textContent = action.description ?? ''
  }
  button.append(label)
  if (description !== null) {
    button.append(description)
  }
  bindPluginPointerFocusGuard(button)

  return button
}

/** 读取插件菜单动作的无障碍标签。 */
function readPluginMenuActionAriaLabel(action: JWordMenuPluginAction): string {
  return action.description === undefined
    ? action.label
    : `${action.label} ${action.description}`
}

/** 执行 core 插件命令并把焦点还给 editor。 */
function executePluginCommand(
  options: CreateToolbarPluginExtensionsOptions,
  commandName: string,
  input: unknown
): void {
  options.markToolbarTransaction()
  options.editor.executePluginCommand(commandName, input)
  options.restoreEditorFocusSoon()
}

/** 创建插件 UI 渲染上下文。 */
function createRenderContext(options: CreateToolbarPluginExtensionsOptions): JWordUiPluginRenderContext {
  return {
    editor: options.editor,
    projection: options.editor.getProjection(),
    selection: options.editor.getSelection(),
    readonly: options.readonlyEnabled
  }
}

/** 判断插件按钮或菜单动作是否可用。 */
function readPluginControlEnabled(
  control: JWordToolbarPluginItem | JWordMenuPluginAction,
  context: JWordUiPluginRenderContext
): boolean {
  if (context.readonly && control.allowReadonly !== true) {
    return false
  }

  return control.enabled?.(context) ?? true
}

/** 播报插件控件执行结果。 */
function announcePluginControlResult(
  options: CreateToolbarPluginExtensionsOptions,
  control: JWordToolbarPluginItem | JWordMenuPluginAction
): void {
  const message = control.announce?.(createRenderContext(options))

  if (message === undefined || message.length === 0) {
    return
  }

  queueMicrotask(() => {
    options.announce(message, true)
  })
}

/** 关闭全部插件菜单。 */
function closePluginMenus(menus: readonly RegisteredPluginMenu[]): void {
  for (const menu of menus) {
    setPluginMenuOpen(menu, false)
  }
}

/** 切换单个插件菜单打开状态。 */
function setPluginMenuOpen(menu: RegisteredPluginMenu, open: boolean): void {
  menu.wrapper.setAttribute('data-jword-open', open ? 'true' : 'false')
  menu.trigger.setAttribute('aria-expanded', open ? 'true' : 'false')
  menu.menu.hidden = !open
}

/** 根据菜单动作状态同步触发按钮可用性。 */
function syncPluginMenuTriggerState(menu: RegisteredPluginMenu): void {
  const actions = [...menu.menu.querySelectorAll<HTMLButtonElement>('button')]
  const hasEnabledAction = actions.some((action) => !action.disabled)

  menu.trigger.disabled = !hasEnabledAction
  if (!hasEnabledAction) {
    setPluginMenuOpen(menu, false)
  }
}

/** 阻止插件 toolbar 控件鼠标按下抢走 editor hidden textarea 焦点。 */
function bindPluginPointerFocusGuard(target: HTMLElement): void {
  target.addEventListener('pointerdown', preventDefault)
  target.addEventListener('mousedown', preventDefault)
}

/** 阻止默认鼠标聚焦行为。 */
function preventDefault(event: Event): void {
  event.preventDefault()
}

/** 生成插件 toolbar 运行时 key。 */
function createPluginToolKey(pluginName: string, itemName: string): string {
  return `plugin:${pluginName}:${itemName}`
}

/** 生成插件菜单动作运行时 key。 */
function createPluginMenuActionKey(pluginName: string, menuName: string, actionName: string): string {
  return `plugin:${pluginName}:${menuName}:${actionName}`
}
