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
  tooltip.className = 'jw-toolbar__tooltip'
  tooltip.setAttribute('role', 'tooltip')
  tooltip.textContent = text
  anchor.append(control, tooltip)

  return {
    anchor,
    tooltip
  }
}
