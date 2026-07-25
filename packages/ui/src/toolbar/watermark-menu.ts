/**
 * 职责：提供顶部工具栏页面水印下拉菜单。
 * 边界：只读写 UI 实例水印 controller，不修改 core 文档模型。
 * 协作模块：toolbar/controller 负责挂载按钮事件，watermark/controller 负责实际水印层。
 * 性能/安全约束：菜单仅在首次打开时创建，后续复用同一个 DOM。
 * 实现说明：字段、按钮和播报文案全部通过 JWord i18n 读取。
 */
import {
  readJWordUiText,
  type ResolvedJWordUiI18n
} from '../i18n'
import type { JWordWatermarkOptions } from '../types'

export interface WatermarkToolbarActions {
  getWatermark(): JWordWatermarkOptions | null
  setWatermark(options: JWordWatermarkOptions): void
  clearWatermark(): void
}

export interface ToolbarWatermarkMenuControllerHandle {
  toggle(anchor: HTMLElement): void
  setI18n(i18n: ResolvedJWordUiI18n): void
  destroy(): void
}

interface CreateToolbarWatermarkMenuControllerOptions {
  readonly host: HTMLElement
  readonly actions: WatermarkToolbarActions
  readonly signal: AbortSignal
  readI18n(): ResolvedJWordUiI18n
  announce(message: string, refreshMirror?: boolean): void
}

interface WatermarkMenuElements {
  readonly root: HTMLElement
  readonly contentLabel: HTMLElement
  readonly content: HTMLTextAreaElement
  readonly fontSizeLabel: HTMLElement
  readonly fontSize: HTMLInputElement
  readonly colorLabel: HTMLElement
  readonly color: HTMLInputElement
  readonly apply: HTMLButtonElement
  readonly clear: HTMLButtonElement
}

const DEFAULT_WATERMARK_FONT_SIZE = 28
const DEFAULT_WATERMARK_COLOR = '#9ca3af'

/** 创建 toolbar 水印菜单 controller。 */
export function createToolbarWatermarkMenuController(
  options: CreateToolbarWatermarkMenuControllerOptions
): ToolbarWatermarkMenuControllerHandle {
  let elements: WatermarkMenuElements | null = null
  let activeAnchor: HTMLElement | null = null
  let currentI18n = options.readI18n()

  options.host.ownerDocument.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') {
      return
    }

    closeMenu()
  }, { signal: options.signal })
  const closeOnOutsideEvent = (event: Event) => {
    const target = event.target

    if (
      !(target instanceof Node)
      || elements?.root.contains(target) === true
      || activeAnchor?.contains(target) === true
    ) {
      return
    }

    closeMenu()
  }

  options.host.ownerDocument.addEventListener('pointerdown', closeOnOutsideEvent, { signal: options.signal })
  options.host.ownerDocument.addEventListener('click', closeOnOutsideEvent, { signal: options.signal })

  return {
    toggle(anchor): void {
      const menu = ensureMenu()

      if (!menu.root.hidden && activeAnchor === anchor) {
        closeMenu()
        return
      }

      activeAnchor = anchor
      syncFormFromWatermark(menu)
      localizeMenu(menu, currentI18n)
      positionMenu(menu.root, anchor, options.host)
      menu.root.hidden = false
      activeAnchor.setAttribute('data-jword-open', 'true')
      menu.content.focus()
    },
    setI18n(i18n): void {
      currentI18n = i18n
      if (elements !== null) {
        localizeMenu(elements, currentI18n)
      }
    },
    destroy(): void {
      closeMenu()
      elements?.root.remove()
      elements = null
    }
  }

  /** 创建并复用菜单 DOM。 */
  function ensureMenu(): WatermarkMenuElements {
    if (elements !== null) {
      return elements
    }

    elements = createWatermarkMenuDom(options.host.ownerDocument)
    localizeMenu(elements, currentI18n)
    bindMenuEvents(elements)
    options.host.append(elements.root)

    return elements
  }

  /** 绑定菜单按钮事件。 */
  function bindMenuEvents(menu: WatermarkMenuElements): void {
    menu.apply.addEventListener('click', () => {
      const text = menu.content.value
      const fontSizePx = Number.parseInt(menu.fontSize.value, 10) || DEFAULT_WATERMARK_FONT_SIZE
      const color = menu.color.value || DEFAULT_WATERMARK_COLOR

      options.actions.setWatermark({
        text,
        fontSizePx,
        color
      })
      options.announce(readJWordUiText(currentI18n, 'a11y.watermark.applied'), true)
      closeMenu()
    }, { signal: options.signal })

    menu.clear.addEventListener('click', () => {
      options.actions.clearWatermark()
      syncFormFromWatermark(menu)
      options.announce(readJWordUiText(currentI18n, 'a11y.watermark.cleared'), true)
      closeMenu()
    }, { signal: options.signal })
  }

  /** 关闭菜单并同步按钮打开态。 */
  function closeMenu(): void {
    if (elements !== null) {
      elements.root.hidden = true
    }
    activeAnchor?.removeAttribute('data-jword-open')
    activeAnchor = null
  }

  /** 从当前实例水印同步表单。 */
  function syncFormFromWatermark(menu: WatermarkMenuElements): void {
    const watermark = options.actions.getWatermark()

    menu.content.value = watermark?.text ?? ''
    menu.fontSize.value = String(watermark?.fontSizePx ?? DEFAULT_WATERMARK_FONT_SIZE)
    menu.color.value = watermark?.color ?? DEFAULT_WATERMARK_COLOR
  }
}

/** 创建水印菜单 DOM。 */
function createWatermarkMenuDom(ownerDocument: Document): WatermarkMenuElements {
  const root = ownerDocument.createElement('div')
  const contentField = createField(ownerDocument)
  const contentLabel = ownerDocument.createElement('label')
  const content = ownerDocument.createElement('textarea')
  const row = ownerDocument.createElement('div')
  const fontSizeField = createField(ownerDocument)
  const fontSizeLabel = ownerDocument.createElement('label')
  const fontSize = ownerDocument.createElement('input')
  const colorField = createField(ownerDocument)
  const colorLabel = ownerDocument.createElement('label')
  const color = ownerDocument.createElement('input')
  const actions = ownerDocument.createElement('div')
  const clear = ownerDocument.createElement('button')
  const apply = ownerDocument.createElement('button')

  root.className = 'jw-watermark-menu'
  root.hidden = true
  root.setAttribute('data-jword-watermark-menu', 'true')
  root.setAttribute('role', 'dialog')
  contentLabel.className = 'jw-watermark-menu__label'
  contentLabel.setAttribute('data-jword-watermark-label', 'content')
  content.className = 'jw-watermark-menu__textarea'
  content.rows = 4
  content.setAttribute('data-jword-watermark-content', 'true')
  row.className = 'jw-watermark-menu__row'
  fontSizeLabel.className = 'jw-watermark-menu__label'
  fontSizeLabel.setAttribute('data-jword-watermark-label', 'fontSize')
  fontSize.className = 'jw-watermark-menu__input'
  fontSize.type = 'number'
  fontSize.min = '8'
  fontSize.max = '96'
  fontSize.step = '1'
  fontSize.setAttribute('data-jword-watermark-font-size', 'true')
  colorLabel.className = 'jw-watermark-menu__label'
  colorLabel.setAttribute('data-jword-watermark-label', 'color')
  color.className = 'jw-watermark-menu__color'
  color.type = 'color'
  color.setAttribute('data-jword-watermark-color', 'true')
  actions.className = 'jw-watermark-menu__actions'
  clear.type = 'button'
  clear.className = 'jw-watermark-menu__button jw-watermark-menu__button--secondary'
  clear.setAttribute('data-jword-watermark-clear', 'true')
  apply.type = 'button'
  apply.className = 'jw-watermark-menu__button jw-watermark-menu__button--primary'
  apply.setAttribute('data-jword-watermark-apply', 'true')
  contentField.append(contentLabel, content)
  fontSizeField.append(fontSizeLabel, fontSize)
  colorField.append(colorLabel, color)
  row.append(fontSizeField, colorField)
  actions.append(clear, apply)
  root.append(contentField, row, actions)

  return {
    root,
    contentLabel,
    content,
    fontSizeLabel,
    fontSize,
    colorLabel,
    color,
    apply,
    clear
  }
}

/** 创建菜单字段容器。 */
function createField(ownerDocument: Document): HTMLElement {
  const field = ownerDocument.createElement('div')

  field.className = 'jw-watermark-menu__field'

  return field
}

/** 刷新菜单文案。 */
function localizeMenu(menu: WatermarkMenuElements, i18n: ResolvedJWordUiI18n): void {
  const contentLabel = readJWordUiText(i18n, 'dialog.watermark.content')
  const fontSizeLabel = readJWordUiText(i18n, 'dialog.watermark.fontSize')
  const colorLabel = readJWordUiText(i18n, 'dialog.watermark.color')

  menu.root.setAttribute('aria-label', readJWordUiText(i18n, 'toolbar.document.watermark.label'))
  menu.contentLabel.textContent = contentLabel
  menu.content.setAttribute('aria-label', contentLabel)
  menu.content.placeholder = readJWordUiText(i18n, 'dialog.watermark.contentPlaceholder')
  menu.fontSizeLabel.textContent = fontSizeLabel
  menu.fontSize.setAttribute('aria-label', fontSizeLabel)
  menu.colorLabel.textContent = colorLabel
  menu.color.setAttribute('aria-label', colorLabel)
  menu.apply.textContent = readJWordUiText(i18n, 'dialog.watermark.apply')
  menu.clear.textContent = readJWordUiText(i18n, 'dialog.watermark.clear')
}

/** 按触发按钮定位菜单。 */
function positionMenu(menu: HTMLElement, anchor: HTMLElement, host: HTMLElement): void {
  const anchorRect = anchor.getBoundingClientRect()
  const hostRect = host.getBoundingClientRect()
  const left = Math.max(8, anchorRect.left - hostRect.left)
  const top = anchorRect.bottom - hostRect.top + 6

  menu.style.left = `${left}px`
  menu.style.top = `${top}px`
}
