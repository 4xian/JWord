/**
 * 职责：为 toolbar 控件包装统一的 hover/focus tooltip 结构。
 * 边界：只创建 tooltip DOM，不处理按钮命令或 editor 状态同步。
 * 协作模块：toolbar dom 为每个可交互控件调用这里生成包裹层。
 * 性能/安全约束：tooltip 使用纯 DOM + CSS，可在不引入额外定时器的前提下工作。
 * Specs：docs/superpowers/plans/2026-05-17-jword-ui-sdk-gate4-integration.md#23-新增视觉与交互约束。
 */

/** tooltip 包裹层返回值。 */
export interface ToolbarTooltipParts {
  readonly anchor: HTMLSpanElement
  readonly tooltip: HTMLSpanElement
}

/** 把控件包装成自带 tooltip 的锚点。 */
export function wrapWithTooltip(control: HTMLElement, text: string): ToolbarTooltipParts {
  const anchor = document.createElement('span')
  const tooltip = document.createElement('span')

  anchor.className = 'jw-toolbar__tooltip-anchor'
  anchor.setAttribute('data-jword-tooltip-visible', 'false')
  tooltip.className = 'jw-toolbar__tooltip'
  tooltip.setAttribute('role', 'tooltip')
  tooltip.textContent = text
  anchor.append(control, tooltip)
  bindToolbarTooltipVisibility(anchor)

  return {
    anchor,
    tooltip
  }
}

/**
 * 只在鼠标/焦点停留在工具本体时显示 tooltip；点击后立即隐藏，直到指针离开当前工具。
 */
function bindToolbarTooltipVisibility(anchor: HTMLElement): void {
  const dismiss = () => {
    hideToolbarTooltip(anchor)
    anchor.setAttribute('data-jword-tooltip-dismissed', 'true')
  }
  const maybeShow = (target: EventTarget | null) => {
    if (!(target instanceof Element) || readTooltipDismissed(anchor)) {
      return
    }

    if (resolveTooltipClosest(anchor, target, '[data-jword-tooltip-skip=\"true\"]') !== null) {
      hideToolbarTooltip(anchor)
      return
    }

    if (resolveTooltipClosest(anchor, target, '[data-jword-tooltip-surface=\"true\"]') === null) {
      return
    }

    showToolbarTooltip(anchor)
  }
  const reset = (relatedTarget: EventTarget | null) => {
    if (relatedTarget instanceof Node && anchor.contains(relatedTarget)) {
      if (
        relatedTarget instanceof Element
        && resolveTooltipClosest(anchor, relatedTarget, '[data-jword-tooltip-skip=\"true\"]') !== null
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
  })
  anchor.addEventListener('focusin', (event) => {
    maybeShow(event.target)
  })
  anchor.addEventListener('mouseout', (event) => {
    reset(event.relatedTarget)
  })
  anchor.addEventListener('focusout', (event) => {
    reset(event.relatedTarget)
  })
  anchor.addEventListener('mousedown', dismiss)
  anchor.addEventListener('click', dismiss)
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
