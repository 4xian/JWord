/**
 * 职责：封装 editor 挂载后使用的 DOM helper 和纯文本镜像读取。
 * 边界：不持有 editor 状态，不执行编辑 command。
 * 协作模块：layout rect、projection 和 mounted editor DOM。
 * 性能/安全约束：constructor/top-level 不访问 window/document/HTMLElement 实例，DOM 只在 mount 后创建，编辑命令统一进入 transaction pipeline。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import { splitGraphemes } from '../shared/grapheme'
import type { LayoutRect } from '../layout/runtime'
import { twipsToCssPx } from '../layout/page-config'
import type { DocumentProjection } from '../model/projection'
import type { MountedEditorDom } from './types'

export function createHiddenTextareaElement(ownerDocument: Document): HTMLTextAreaElement {
  const textarea = ownerDocument.createElement('textarea')

  textarea.setAttribute('data-jword-hidden-textarea', '')
  textarea.setAttribute('aria-label', 'JWord hidden input')
  textarea.setAttribute('autocapitalize', 'off')
  textarea.setAttribute('autocomplete', 'off')
  textarea.spellcheck = false
  textarea.style.position = 'absolute'
  textarea.style.left = '0px'
  textarea.style.top = '0px'
  textarea.style.width = '1px'
  textarea.style.height = '1px'
  textarea.style.padding = '0'
  textarea.style.border = '0'
  textarea.style.margin = '0'
  textarea.style.opacity = '0'
  textarea.style.pointerEvents = 'none'
  textarea.style.resize = 'none'
  textarea.style.overflow = 'hidden'
  textarea.style.whiteSpace = 'pre'

  return textarea
}

export function createLiveRegionElement(ownerDocument: Document): HTMLDivElement {
  const element = ownerDocument.createElement('div')

  element.setAttribute('data-jword-aria-live', '')
  element.setAttribute('aria-live', 'polite')
  element.setAttribute('role', 'status')
  applyVisuallyHiddenStyle(element)

  return element
}

export function createTextMirrorElement(ownerDocument: Document): HTMLDivElement {
  const element = ownerDocument.createElement('div')

  element.setAttribute('data-jword-text-mirror', '')
  element.style.whiteSpace = 'pre-wrap'
  applyVisuallyHiddenStyle(element)

  return element
}

export function applyVisuallyHiddenStyle(element: HTMLDivElement): void {
  element.style.position = 'absolute'
  element.style.left = '0'
  element.style.top = '0'
  element.style.width = '1px'
  element.style.height = '1px'
  element.style.padding = '0'
  element.style.border = '0'
  element.style.margin = '-1px'
  element.style.overflow = 'hidden'
  element.style.clipPath = 'inset(50%)'
}

export function syncHiddenTextareaPosition(input: Readonly<{
  mountedDom: MountedEditorDom
  caretRect: LayoutRect | undefined
  scale: number
}>): void {
  const left = input.caretRect === undefined
    ? 0
    : twipsToCssPx(input.caretRect.x, input.scale)
  const top = input.caretRect === undefined
    ? 0
    : twipsToCssPx(input.caretRect.y, input.scale) - input.mountedDom.canvasContainer.scrollTop

  input.mountedDom.hiddenTextarea.style.left = `${Math.max(0, left)}px`
  input.mountedDom.hiddenTextarea.style.top = `${Math.max(0, top)}px`
}

export function focusHiddenTextarea(mountedDom: MountedEditorDom): void {
  try {
    mountedDom.hiddenTextarea.focus({
      preventScroll: true
    })
  } catch {
    mountedDom.hiddenTextarea.focus()
  }
}
