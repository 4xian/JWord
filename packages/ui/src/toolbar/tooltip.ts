/**
 * 职责：为 toolbar 控件包装统一的 hover/focus tooltip 结构。
 * 边界：只创建 tooltip DOM，不处理按钮命令或 editor 状态同步。
 * 协作模块：toolbar dom 为每个可交互控件调用这里生成包裹层。
 * 性能/安全约束：tooltip 使用纯 DOM + CSS，可在不引入额外定时器的前提下工作。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

/** tooltip 包裹层返回值。 */
export interface ToolbarTooltipParts {
  readonly anchor: HTMLSpanElement
  readonly tooltip: HTMLSpanElement
  readonly destroy: () => void
}

let toolbarTooltipIdSeed = 0

/** 把控件包装成自带 tooltip 的锚点。 */
export function wrapWithTooltip(control: HTMLElement, text: string): ToolbarTooltipParts {
  const ownerDocument = control.ownerDocument
  const anchor = ownerDocument.createElement('span')
  const tooltip = ownerDocument.createElement('span')
  const signalController = new (ownerDocument.defaultView?.AbortController ?? AbortController)()
  const tooltipId = `jw-toolbar-tooltip-${toolbarTooltipIdSeed}`

  toolbarTooltipIdSeed += 1

  anchor.className = 'jw-toolbar__tooltip-anchor'
  anchor.setAttribute('data-jword-tooltip-visible', 'false')
  tooltip.id = tooltipId
  tooltip.className = 'jw-toolbar__tooltip'
  tooltip.setAttribute('role', 'tooltip')
  tooltip.textContent = text
  control.setAttribute('aria-describedby', tooltipId)
  for (const surface of control.querySelectorAll<HTMLElement>('[data-jword-tooltip-surface="true"]')) {
    surface.setAttribute('aria-describedby', tooltipId)
  }
  for (const focusable of control.querySelectorAll<HTMLElement>('button, select, input, textarea, [tabindex]')) {
    focusable.setAttribute('aria-describedby', tooltipId)
  }
  anchor.append(control, tooltip)
  bindToolbarTooltipVisibility(anchor, signalController.signal)

  return {
    anchor,
    tooltip,
    destroy: () => {
      signalController.abort()
      control.removeAttribute('aria-describedby')
      for (const surface of control.querySelectorAll<HTMLElement>('[data-jword-tooltip-surface="true"]')) {
        surface.removeAttribute('aria-describedby')
      }
      for (const focusable of control.querySelectorAll<HTMLElement>('button, select, input, textarea, [tabindex]')) {
        focusable.removeAttribute('aria-describedby')
      }
    }
  }
}

/**
 * 只在鼠标/焦点停留在工具本体时显示 tooltip；点击后立即隐藏，直到指针离开当前工具。
 */
function bindToolbarTooltipVisibility(anchor: HTMLElement, signal: AbortSignal): void {
  const dismiss = () => {
    hideToolbarTooltip(anchor)
    anchor.setAttribute('data-jword-tooltip-dismissed', 'true')
  }
  const maybeShow = (target: EventTarget | null) => {
    if (!(target instanceof Element) || readTooltipDismissed(anchor)) {
      return
    }

    if (resolveTooltipClosest(anchor, target, '[data-jword-tooltip-skip="true"]') !== null) {
      hideToolbarTooltip(anchor)
      return
    }

    if (resolveTooltipClosest(anchor, target, '[data-jword-tooltip-surface="true"]') === null) {
      return
    }

    showToolbarTooltip(anchor)
  }
  const reset = (relatedTarget: EventTarget | null) => {
    if (relatedTarget instanceof Node && anchor.contains(relatedTarget)) {
      if (
        relatedTarget instanceof Element
        && resolveTooltipClosest(anchor, relatedTarget, '[data-jword-tooltip-skip="true"]') !== null
      ) {
        hideToolbarTooltip(anchor)
      }

      return
    }

    hideToolbarTooltip(anchor)
    anchor.removeAttribute('data-jword-tooltip-dismissed')
  }

  anchor.addEventListener('mouseover', (event) => {
    maybeShow(event.target)
  }, { signal })
  anchor.addEventListener('focusin', (event) => {
    maybeShow(event.target)
  }, { signal })
  anchor.addEventListener('mouseout', (event) => {
    reset(event.relatedTarget)
  }, { signal })
  anchor.addEventListener('focusout', (event) => {
    reset(event.relatedTarget)
  }, { signal })
  anchor.addEventListener('mousedown', dismiss, { signal })
  anchor.addEventListener('click', dismiss, { signal })
}

/**
 * 标记 tooltip 可见。
 */
function showToolbarTooltip(anchor: HTMLElement): void {
  anchor.setAttribute('data-jword-tooltip-visible', 'true')
}

/**
 * 标记 tooltip 隐藏。
 */
function hideToolbarTooltip(anchor: HTMLElement): void {
  anchor.setAttribute('data-jword-tooltip-visible', 'false')
}

/**
 * 判断当前 tooltip 是否处于点击后的暂时抑制态。
 */
function readTooltipDismissed(anchor: HTMLElement): boolean {
  return anchor.getAttribute('data-jword-tooltip-dismissed') === 'true'
}

/**
 * 在当前 tooltip 锚点范围内查找目标最近的命中节点。
 */
function resolveTooltipClosest(
  anchor: HTMLElement,
  target: Element,
  selector: string
): Element | null {
  const matched = target.closest(selector)

  return matched !== null && anchor.contains(matched) ? matched : null
}
