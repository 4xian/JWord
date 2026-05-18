/**
 * 职责：集中维护 toolbar 使用的内联 SVG 图标。
 * 边界：只返回图标节点和路径，不关心按钮状态或命令逻辑。
 * 协作模块：toolbar dom 在创建按钮时调用这里生成统一图标。
 * 性能/安全约束：不引入外部资源请求，保证 UI 包可离线使用。
 * Specs：docs/superpowers/plans/2026-05-17-jword-ui-sdk-gate4-integration.md#43-这次不能直接平移的内容。
 */

/** toolbar 使用的图标名。 */
export type ToolbarIconName =
  | 'undo'
  | 'redo'
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strike'
  | 'superscript'
  | 'subscript'
  | 'image'
  | 'textColor'
  | 'backgroundColor'
  | 'listBullet'
  | 'listOrdered'
  | 'alignLeft'
  | 'alignCenter'
  | 'alignRight'
  | 'alignJustify'
  | 'lineHeight'
  | 'indentDecrease'
  | 'indentIncrease'
  | 'spacingBefore'
  | 'spacingAfter'
  | 'firstLineIndent'
  | 'hangingIndent'
  | 'paragraphStyle'
  | 'fontSizeIncrease'
  | 'fontSizeDecrease'
  | 'caretDown'
  | 'check'

interface ToolbarIconPathDefinition {
  readonly d: string
  readonly fill?: string
  readonly fillRule?: 'evenodd' | 'nonzero'
  readonly clipRule?: 'evenodd' | 'nonzero'
  readonly stroke?: string
  readonly strokeWidth?: string
  readonly strokeLinecap?: 'round' | 'square' | 'butt'
  readonly strokeLinejoin?: 'round' | 'miter' | 'bevel'
}

interface ToolbarIconDefinition {
  readonly viewBox: string
  readonly paths: readonly ToolbarIconPathDefinition[]
}

const TOOLBAR_ICON_DEFINITIONS = Object.freeze<Record<ToolbarIconName, ToolbarIconDefinition>>({
  undo: {
    viewBox: '0 0 24 24',
    paths: [
      {
        d: 'M9 10.9a.2.2 0 0 1-.302.173L4.276 8.474a.2.2 0 0 1-.01-.339l4.423-2.93a.2.2 0 0 1 .31.167v2.252l5 .001c3.149 0 5.626 2.306 5.626 5.375 0 3.033-2.4 5.505-5.404 5.62l-.221.005H7v-1.25h7A4.375 4.375 0 0 0 18.375 13c0-2.289-1.788-4.02-4.158-4.12L14 8.875H9z'
      }
    ]
  },
  redo: {
    viewBox: '0 0 24 24',
    paths: [
      {
        d: 'M15 10.9a.2.2 0 0 0 .302.173l4.422-2.599a.2.2 0 0 0 .01-.339l-4.423-2.93a.2.2 0 0 0-.31.167v2.252l-5 .001c-3.149 0-5.626 2.306-5.626 5.375 0 3.033 2.4 5.505 5.404 5.62l.221.005h7v-1.25h-7A4.375 4.375 0 0 1 5.625 13c0-2.289 1.788-4.02 4.158-4.12L10 8.875h5z'
      }
    ]
  },
  bold: {
    viewBox: '0 0 25 25',
    paths: [
      {
        d: 'M8.71 7.503h4.095a2.134 2.134 0 1 1 0 4.268H8.71zm-1.3 4.342V6.203h5.395a3.434 3.434 0 0 1 2.296 5.988 3.68 3.68 0 0 1-1.56 7.012H7.41v-7.358m1.3 1.3h4.831a2.38 2.38 0 0 1 0 4.758H8.71z',
        fillRule: 'evenodd',
        clipRule: 'evenodd'
      }
    ]
  },
  italic: {
    viewBox: '0 0 25 25',
    paths: [
      {
        d: 'M10.595 5.908h6.5v1.25h-2.29l-3.471 10.367h2.76v1.25h-7v-1.25h2.658l3.472-10.367h-2.63z',
        fillRule: 'evenodd',
        clipRule: 'evenodd'
      }
    ]
  },
  underline: {
    viewBox: '0 0 25 25',
    paths: [
      {
        d: 'M18.856 18.573v1.25h-13v-1.25zM9.256 4.91v7.5a3.1 3.1 0 0 0 2.925 3.095l.175.005a3.1 3.1 0 0 0 3.095-2.924l.005-.176v-7.5h1.4v7.5a4.5 4.5 0 1 1-9 0v-7.5z',
        fillRule: 'evenodd',
        clipRule: 'evenodd'
      }
    ]
  },
  strike: {
    viewBox: '0 0 25 25',
    paths: [
      {
        d: 'M8.92 11.16a2.971 2.971 0 0 1-.886-2.273 3.3 3.3 0 0 1 .514-1.817c.38-.55.9-.982 1.505-1.249a4.6 4.6 0 0 1 2.019-.454 5.24 5.24 0 0 1 3.836 1.662L15.1 8a4.15 4.15 0 0 0-3.028-1.29 2.85 2.85 0 0 0-1.848.61c-.46.364-.722.932-.706 1.527-.007.371.107.734.323 1.032.2.278.455.51.747.682.274.18.633.34 1.096.548l.045.02.072.032H7.335v1.25h7.292q.31.255.566.568a3.28 3.28 0 0 1 .686 2.199 3.6 3.6 0 0 1-.545 1.94 3.7 3.7 0 0 1-1.545 1.353 5.26 5.26 0 0 1-2.342.496 6 6 0 0 1-2.544-.537 6.2 6.2 0 0 1-2.019-1.476l.909-1.033a5.4 5.4 0 0 0 1.676 1.27 4.6 4.6 0 0 0 2.019.465 3.3 3.3 0 0 0 2.13-.64 2.32 2.32 0 0 0 .505-2.84 2.13 2.13 0 0 0-.727-.722q-.61-.354-1.252-.64l-.889-.403H16.4v-1.25h-4.452z'
      }
    ]
  },
  superscript: {
    viewBox: '0 0 24 24',
    paths: [
      {
        d: 'M5.75 17.25 10 13m0 4.25L5.75 13M13.5 8.25c0-1.1.9-2 2-2s2 .9 2 2c0 .74-.4 1.31-1.2 1.86l-1.85 1.29h3.05',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: '1.6',
        strokeLinecap: 'round',
        strokeLinejoin: 'round'
      }
    ]
  },
  subscript: {
    viewBox: '0 0 24 24',
    paths: [
      {
        d: 'M5.75 14.25 10 10m0 4.25L5.75 10M13.5 15.25c0-1.1.9-2 2-2s2 .9 2 2c0 .74-.4 1.31-1.2 1.86l-1.85 1.29h3.05',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: '1.6',
        strokeLinecap: 'round',
        strokeLinejoin: 'round'
      }
    ]
  },
  image: {
    viewBox: '0 0 24 24',
    paths: [
      {
        d: 'M5 5.5A1.5 1.5 0 0 1 6.5 4h11A1.5 1.5 0 0 1 19 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 18.5zm1.25.25v12.5h11.5V5.75zm7.38 3.13a1.37 1.37 0 1 1-2.74 0 1.37 1.37 0 0 1 2.74 0m-6.38 7.87 2.45-3.13 2.2 2.11 2.97-4.04 2.88 5.06z',
        fillRule: 'evenodd',
        clipRule: 'evenodd'
      }
    ]
  },
  textColor: {
    viewBox: '0 0 24 24',
    paths: [
      {
        d: 'M11.106 4h1.789l5.107 14h-1.493l-1.46-4H8.953l-1.459 4H6zm.895 1.64 2.575 7.06h-5.15z',
        fillRule: 'evenodd',
        clipRule: 'evenodd'
      }
    ]
  },
  backgroundColor: {
    viewBox: '0 0 24 24',
    paths: [
      {
        d: 'M7.375 9.75h8.75V4h1.25v7h-1.85v1.625h.004v1.25h-.004v.002h-1.25v-.002H14.2v.63l.01-.004v1.498l-3.61 2h-.05V18H9.3v-4.124H8.065V11h-1.94V4h1.25zm3.175 6.849 2.4-1.376v-1.348h-2.4zM9.315 11v1.625h4.96V11z'
      }
    ]
  },
  listBullet: {
    viewBox: '0 0 24 24',
    paths: [
      {
        d: 'M6.25 5.75a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5m0 5a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5M5 17a1.25 1.25 0 1 1 2.5 0A1.25 1.25 0 0 1 5 17m15-9.6V6H9v1.4zm0 5.3v-1.4H9v1.4zm0 3.9V18H9v-1.4z',
        fillRule: 'evenodd',
        clipRule: 'evenodd'
      }
    ]
  },
  listOrdered: {
    viewBox: '0 0 24 24',
    paths: [
      {
        d: 'M7.74 8.28V9H5.39v-.72h.79V6.165h-.685v-.55c.4-.075.66-.175.92-.335h.655v3zm.05 4.97V14H5.21v-.51c.93-.845 1.555-1.52 1.555-2.06 0-.34-.19-.525-.485-.525-.255 0-.455.17-.63.36l-.485-.48c.365-.385.705-.575 1.235-.575.72 0 1.22.46 1.22 1.17 0 .64-.55 1.345-1.12 1.92.185-.025.44-.05.605-.05h.685v.62zm-1.395 5.82c.74 0 1.375-.39 1.375-1.085 0-.48-.305-.78-.72-.905v-.025c.4-.16.6-.45.6-.82 0-.665-.505-1.025-1.275-1.025-.44 0-.81.17-1.155.46l.45.545c.225-.195.415-.31.665-.31.275 0 .425.14.425.395 0 .295-.2.49-.835.49v.625c.78 0 .95.19.95.51 0 .28-.225.425-.57.425-.29 0-.55-.145-.775-.36l-.41.56c.27.315.685.52 1.275.52M20 7.4V6H9v1.4zm0 5.3v-1.4H9v1.4zm0 3.9V18H9v-1.4z',
        fillRule: 'evenodd',
        clipRule: 'evenodd'
      }
    ]
  },
  alignLeft: {
    viewBox: '0 0 24 24',
    paths: [
      {
        d: 'M5 6h14v1.25H5zm0 4.25h9v1.25H5zm0 4.25h14v1.25H5zm0 4.25h9V20H5z'
      }
    ]
  },
  alignCenter: {
    viewBox: '0 0 24 24',
    paths: [
      {
        d: 'M5 6h14v1.25H5zm3 4.25h8v1.25H8zm-3 4.25h14v1.25H5zm3 4.25h8V20H8z'
      }
    ]
  },
  alignRight: {
    viewBox: '0 0 24 24',
    paths: [
      {
        d: 'M5 6h14v1.25H5zm10 4.25h4v1.25h-4zM5 14.5h14v1.25H5zm10 4.25h4V20h-4z'
      }
    ]
  },
  alignJustify: {
    viewBox: '0 0 24 24',
    paths: [
      {
        d: 'M5 6h14v1.25H5zm0 4.25h14v1.25H5zm0 4.25h14v1.25H5zm0 4.25h14V20H5z'
      }
    ]
  },
  lineHeight: {
    viewBox: '0 0 24 24',
    paths: [
      {
        d: 'M7.6 8H9L7 5 5 8h1.4v8H5l2 3 2-3H7.6zM20 6.25h-9.5V7.5H20zM10.5 11.38H20v1.25h-9.5zM20 16.5h-9.5v1.25H20z'
      }
    ]
  },
  indentDecrease: {
    viewBox: '0 0 24 24',
    paths: [
      {
        d: 'M5 5.75h14V7H5zM8 15l-3-3 3-3zM10 9.5h9v1.25h-9zM10 13.25h9v1.25h-9zM19 17H5v1.25h14z'
      }
    ]
  },
  indentIncrease: {
    viewBox: '0 0 24 24',
    paths: [
      {
        d: 'M19 5.75H5V7h14zM5 15l3-3-3-3zm14-5.5h-9v1.25h9zm0 3.75h-9v1.25h9zM5 17h14v1.25H5z',
        fillRule: 'evenodd',
        clipRule: 'evenodd'
      }
    ]
  },
  spacingBefore: {
    viewBox: '0 0 24 24',
    paths: [
      {
        d: 'M5 6.25h14V7.5H5zm2.4 4.2h9.2v1.25H7.4zm4.57 8.3v-5.2l-1.78 1.78-.88-.88L12 11.76l2.69 2.69-.88.88-1.59-1.59v5.01z'
      }
    ]
  },
  spacingAfter: {
    viewBox: '0 0 24 24',
    paths: [
      {
        d: 'M5 6.25h14V7.5H5zm2.4 4.2h9.2v1.25H7.4zm0 4.34.88-.88 1.78 1.78V10.5h1.25v5.2l1.59-1.59.88.88L12 17.68z'
      }
    ]
  },
  firstLineIndent: {
    viewBox: '0 0 24 24',
    paths: [
      {
        d: 'M5 6.25h14V7.5H5zm0 4.15h8.8v1.25H5zm3.55 4.2H19v1.25H8.55zm0 4.15H19V20H8.55zM5.3 10.15 8.4 12 5.3 13.85z'
      }
    ]
  },
  hangingIndent: {
    viewBox: '0 0 24 24',
    paths: [
      {
        d: 'M5 6.25h14V7.5H5zm7.85 4.15H19v1.25h-6.15zM5 14.6h14v1.25H5zm4.8 4.15H19V20H9.8zM8.7 10.15 5.6 12l3.1 1.85z'
      }
    ]
  },
  paragraphStyle: {
    viewBox: '0 0 24 25',
    paths: [
      {
        d: 'M21 6.29H5v1.5h16zM5 13.04h6v-1.5H5zm0 5.25h6v-1.5H5zm12.5-6.42-3 1.717V17l3 1.717 3-1.717v-3.413zm.497-1.444a1 1 0 0 0-.994 0l-3.5 2.003a1 1 0 0 0-.503.868v3.993a1 1 0 0 0 .503.867l3.5 2.004a1 1 0 0 0 .994 0l3.5-2.004A1 1 0 0 0 22 17.29v-3.993a1 1 0 0 0-.503-.868zM19 15.29a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0',
        fillRule: 'evenodd',
        clipRule: 'evenodd'
      }
    ]
  },
  fontSizeIncrease: {
    viewBox: '0 0 25 24',
    paths: [
      {
        d: 'M19.027 7.251v-2.25h-1.5v2.25h-2.25v1.5h2.25v2.25h1.5v-2.25h2.25v-1.5zm-8.645-2.249h1.788l5.107 14h-1.615L14.22 15.06H8.304l-1.446 3.942H5.276zm.883 1.984 2.405 6.574H8.854z',
        fillRule: 'evenodd',
        clipRule: 'evenodd'
      }
    ]
  },
  fontSizeDecrease: {
    viewBox: '0 0 25 24',
    paths: [
      {
        d: 'M12.17 5.002h-1.788l-3.12 8.558h-.019v.049l-1.967 5.393h1.582l1.446-3.942h5.915l1.443 3.942h1.615zm1.5 8.558-2.405-6.574-2.411 6.574zm7.606-5.708h-6v1.5h6z',
        fillRule: 'evenodd',
        clipRule: 'evenodd'
      }
    ]
  },
  caretDown: {
    viewBox: '0 0 6 5',
    paths: [
      {
        d: 'M2.65006 4.80116C2.81654 5.06628 3.18346 5.06628 3.34994 4.80116L5.92866 0.694234C6.11499 0.397484 5.91463 0 5.57872 0H0.421278C0.0853699 0 -0.114986 0.397485 0.0713419 0.694234L2.65006 4.80116Z',
        fillRule: 'evenodd',
        clipRule: 'evenodd'
      }
    ]
  },
  check: {
    viewBox: '0 0 20 20',
    paths: [
      {
        d: 'M4.5 10.1 8 13.5l7.5-7.6 1 .9L8 15.5 3.5 11z'
      }
    ]
  }
})

/** 创建一个工具栏图标节点。 */
export function createToolbarIcon(icon: ToolbarIconName): SVGElement {
  const svgNamespace = 'http://www.w3.org/2000/svg'
  const definition = readToolbarIconDefinition(icon)
  const iconNode = document.createElementNS(svgNamespace, 'svg')

  iconNode.classList.add('jw-toolbar__button-icon')
  iconNode.setAttribute('aria-hidden', 'true')
  iconNode.setAttribute('viewBox', definition.viewBox)
  iconNode.setAttribute('focusable', 'false')

  for (const path of definition.paths) {
    const pathNode = document.createElementNS(svgNamespace, 'path')

    pathNode.setAttribute('d', path.d)
    pathNode.setAttribute('fill', path.fill ?? 'currentColor')

    if (path.fillRule !== undefined) {
      pathNode.setAttribute('fill-rule', path.fillRule)
    }

    if (path.clipRule !== undefined) {
      pathNode.setAttribute('clip-rule', path.clipRule)
    }

    if (path.stroke !== undefined) {
      pathNode.setAttribute('stroke', path.stroke)
    }

    if (path.strokeWidth !== undefined) {
      pathNode.setAttribute('stroke-width', path.strokeWidth)
    }

    if (path.strokeLinecap !== undefined) {
      pathNode.setAttribute('stroke-linecap', path.strokeLinecap)
    }

    if (path.strokeLinejoin !== undefined) {
      pathNode.setAttribute('stroke-linejoin', path.strokeLinejoin)
    }

    iconNode.append(pathNode)
  }

  return iconNode
}

/** 读取单个图标的结构定义。 */
function readToolbarIconDefinition(icon: ToolbarIconName): ToolbarIconDefinition {
  return TOOLBAR_ICON_DEFINITIONS[icon]
}
