/**
 * 职责：集中维护 toolbar 使用的内联 SVG 图标。
 * 边界：只返回图标节点和路径，不关心按钮状态或命令逻辑。
 * 协作模块：toolbar dom 在创建按钮时调用这里生成统一图标。
 * 性能/安全约束：不引入外部资源请求，保证 UI 包可离线使用。
 * Specs：docs/superpowers/plans/2026-05-17-jword-ui-sdk-gate4-integration.md#43-这次不能直接平移的内容。
 */

/** 第一版 toolbar 使用的图标名。 */
export type ToolbarIconName =
  | 'undo'
  | 'redo'
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strike'
  | 'textColor'
  | 'backgroundColor'
  | 'alignLeft'
  | 'alignCenter'
  | 'alignRight'
  | 'alignJustify'
  | 'indentDecrease'
  | 'indentIncrease'

/** 创建一个工具栏图标节点。 */
export function createToolbarIcon(icon: ToolbarIconName): SVGElement {
  const svgNamespace = 'http://www.w3.org/2000/svg'
  const iconNode = document.createElementNS(svgNamespace, 'svg')

  iconNode.classList.add('jw-toolbar__button-icon')
  iconNode.setAttribute('aria-hidden', 'true')
  iconNode.setAttribute('viewBox', '0 0 20 20')
  iconNode.setAttribute('focusable', 'false')

  for (const path of readToolbarIconPaths(icon)) {
    const pathNode = document.createElementNS(svgNamespace, 'path')

    pathNode.setAttribute('d', path)
    pathNode.setAttribute('fill', 'currentColor')
    pathNode.setAttribute('stroke', 'currentColor')
    pathNode.setAttribute('stroke-width', '1.1')
    pathNode.setAttribute('stroke-linecap', 'round')
    pathNode.setAttribute('stroke-linejoin', 'round')
    iconNode.append(pathNode)
  }

  return iconNode
}

/** 读取单个图标对应的路径定义。 */
function readToolbarIconPaths(icon: ToolbarIconName): readonly string[] {
  switch (icon) {
    case 'undo':
      return ['M7.3 6L4 9.1l3.3 3v-2h3.8c2.3 0 3.9 1.1 4.8 3-.4-4.4-3.3-7-6.7-7H7.3V6z']
    case 'redo':
      return ['M12.7 6L16 9.1l-3.3 3v-2H8.9c-2.3 0-3.9 1.1-4.8 3 .4-4.4 3.3-7 6.7-7h1.9V6z']
    case 'bold':
      return ['M6 3.6h5.3c2.4 0 3.8 1.1 3.8 3 0 1.3-.7 2.3-1.9 2.8 1.7.4 2.7 1.7 2.7 3.5 0 2.5-1.8 4-4.8 4H6V3.6zm2.4 1.9v3.2H11c1.2 0 1.8-.6 1.8-1.6s-.6-1.6-1.8-1.6H8.4zm0 5v3.5h3c1.4 0 2.2-.7 2.2-1.8 0-1.2-.8-1.8-2.2-1.8h-3z']
    case 'italic':
      return ['M8.2 3.8H15v1.8h-2.2L10 14.4h2.2v1.8H5v-1.8h2.2L10 5.6H8.2V3.8z']
    case 'underline':
      return ['M6.2 4v5c0 2.3 1.5 3.8 3.8 3.8s3.8-1.5 3.8-3.8V4h-2v4.9c0 1.3-.7 2.1-1.8 2.1s-1.8-.8-1.8-2.1V4h-2zM4.2 15.8h11.6V17H4.2v-1.2z']
    case 'strike':
      return ['M10 3.8c2.8 0 4.6 1.1 5.1 3.2h-2.2c-.4-.8-1.3-1.2-2.7-1.2-1.4 0-2.2.4-2.2 1.3 0 .7.6 1.1 2 1.3l2 .3c2.7.4 4 1.5 4 3.5 0 2.4-2.2 4-5.4 4-3.1 0-5.2-1.4-5.6-3.7H7c.3 1 1.4 1.6 3.1 1.6 1.5 0 2.5-.5 2.5-1.4 0-.7-.5-1.1-1.9-1.3l-2-.3c-2.6-.4-4-1.6-4-3.6 0-2.2 2-3.7 5.3-3.7z', 'M3.8 9.4h12.4v1.2H3.8V9.4z']
    case 'textColor':
      return ['M10.1 3.6l4.8 12.7h-2.3l-1-3H7.5l-1 3H4.2l4.8-12.7h1.1zm.8 7.9-1.4-4.2-1.4 4.2h2.8z', 'M4.4 17.2h11.2v-1.6H4.4v1.6z']
    case 'backgroundColor':
      return ['M7.1 4.4l7.3 7.3-3.2 3.2-7.3-7.3 3.2-3.2zm1.1 1.4L5.4 8.6l4.9 4.9 2.8-2.8-4.9-4.9z', 'M4.2 16h11.6v1.4H4.2V16z']
    case 'alignLeft':
      return ['M4 5h12v1.2H4V5zm0 3.1h8.2v1.2H4V8.1zm0 3.1h12v1.2H4v-1.2zm0 3.1h8.2v1.2H4v-1.2z']
    case 'alignCenter':
      return ['M4.5 5h11v1.2h-11V5zm2.2 3.1h6.6v1.2H6.7V8.1zm-2.2 3.1h11v1.2h-11v-1.2zm2.2 3.1h6.6v1.2H6.7v-1.2z']
    case 'alignRight':
      return ['M5 5h11v1.2H5V5zm4.8 3.1H16v1.2H9.8V8.1zM5 11.2h11v1.2H5v-1.2zm4.8 3.1H16v1.2H9.8v-1.2z']
    case 'alignJustify':
      return ['M4 5h12v1.2H4V5zm0 3.1h12v1.2H4V8.1zm0 3.1h12v1.2H4v-1.2zm0 3.1h12v1.2H4v-1.2z']
    case 'indentDecrease':
      return ['M4 5h12v1.2H4V5zm4 3.1h8v1.2H8V8.1zm4 3.1h4v1.2h-4v-1.2zm-4 3.1h8v1.2H8v-1.2z', 'M4.2 9.8l2.8 1.9V7.9L4.2 9.8z']
    case 'indentIncrease':
      return ['M4 5h12v1.2H4V5zm8 3.1h4v1.2h-4V8.1zM8 11.2h8v1.2H8v-1.2zm8 3.1h-4v1.2h4v-1.2z', 'M6.8 9.8L4 7.9v3.8l2.8-1.9z']
  }
}
