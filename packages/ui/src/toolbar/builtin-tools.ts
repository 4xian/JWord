/**
 * 职责：集中定义 UI 包第一版内建工具、分组、字段标签和固定选项。
 * 边界：只提供静态配置，不读取 editor 状态，也不创建 DOM 节点。
 * 协作模块：toolbar config/dom/controller 依赖这里的工具元数据完成显隐、渲染和事件绑定。
 * 性能/安全约束：模块初始化只创建常量映射，无浏览器副作用。
 * Specs：docs/superpowers/plans/2026-05-17-jword-ui-sdk-gate4-integration.md#64-第一阶段内建工具-id。
 */
import type { JWordToolbarToolId } from '../types'
import type { ToolbarIconName } from './icons'

/** toolbar 中的字段选项。 */
export interface ToolbarOption {
  readonly value: string
  readonly label: string
}

/** toolbar 内建分组。 */
export type ToolbarGroupId = 'history' | 'document' | 'format' | 'paragraph'

/** toolbar 内建控件种类。 */
export type ToolbarControlKind = 'button' | 'select' | 'color'

/** 单个内建工具的静态定义。 */
export interface BuiltinToolDefinition {
  readonly id: JWordToolbarToolId
  readonly group: ToolbarGroupId
  readonly kind: ToolbarControlKind
  readonly label: string
  readonly tooltip: string
  readonly dataAttribute: string
  readonly icon?: ToolbarIconName
  readonly fieldLabel?: string
  readonly options?: readonly ToolbarOption[]
}

/** 字体字段的空态占位值。 */
export const FONT_FAMILY_EMPTY_VALUE = ''

/** 字体字段的 mixed 占位值。 */
export const FONT_FAMILY_MIXED_VALUE = '__mixed__'

/** 字号字段的空态占位值。 */
export const FONT_SIZE_EMPTY_VALUE = ''

/** 字号字段的 mixed 占位值。 */
export const FONT_SIZE_MIXED_VALUE = '__mixed__'

/** 颜色字段的默认字色。 */
export const DEFAULT_TEXT_COLOR = '#111111'

/** 颜色字段的默认底色。 */
export const DEFAULT_BACKGROUND_COLOR = '#fff59d'

/** 缩进按钮沿用 Gate 3 的 twips 步进。 */
export const INDENT_STEP_TWIPS = 720

/** 所有内建工具 ID。 */
export const BUILTIN_TOOL_IDS = [
  'history.undo',
  'history.redo',
  'document.pagePreset',
  'format.bold',
  'format.italic',
  'format.underline',
  'format.strike',
  'format.fontFamily',
  'format.fontSize',
  'format.textColor',
  'format.backgroundColor',
  'paragraph.alignLeft',
  'paragraph.alignCenter',
  'paragraph.alignRight',
  'paragraph.alignJustify',
  'paragraph.indentDecrease',
  'paragraph.indentIncrease'
] as const satisfies readonly JWordToolbarToolId[]

/** 默认显示顺序直接沿用全部内建工具顺序。 */
export const DEFAULT_VISIBLE_TOOL_IDS = [...BUILTIN_TOOL_IDS]

const PAGE_PRESET_OPTIONS: readonly ToolbarOption[] = [
  { value: 'a3', label: 'A3' },
  { value: 'a4', label: 'A4' },
  { value: 'a5', label: 'A5' },
  { value: 'letter', label: 'Letter' }
] as const

const FONT_FAMILY_OPTIONS: readonly ToolbarOption[] = [
  { value: FONT_FAMILY_EMPTY_VALUE, label: '字体' },
  { value: FONT_FAMILY_MIXED_VALUE, label: '混合' },
  { value: 'Inter', label: 'Inter' },
  { value: 'Arial', label: 'Arial' },
  { value: 'SimSun', label: '宋体' },
  { value: 'KaiTi', label: '楷体' },
  { value: 'SimHei', label: '黑体' },
  { value: 'FangSong', label: '仿宋' }
] as const

const FONT_SIZE_OPTIONS: readonly ToolbarOption[] = [
  { value: FONT_SIZE_EMPTY_VALUE, label: '字号' },
  { value: FONT_SIZE_MIXED_VALUE, label: '混合' },
  { value: '180', label: '9 pt' },
  { value: '200', label: '10 pt' },
  { value: '220', label: '11 pt' },
  { value: '240', label: '12 pt' },
  { value: '280', label: '14 pt' },
  { value: '320', label: '16 pt' },
  { value: '360', label: '18 pt' },
  { value: '420', label: '21 pt' }
] as const

const BUILTIN_TOOL_DEFINITIONS = [
  {
    id: 'history.undo',
    group: 'history',
    kind: 'button',
    label: '撤销',
    tooltip: '撤销',
    dataAttribute: 'data-jword-history-undo',
    icon: 'undo'
  },
  {
    id: 'history.redo',
    group: 'history',
    kind: 'button',
    label: '重做',
    tooltip: '重做',
    dataAttribute: 'data-jword-history-redo',
    icon: 'redo'
  },
  {
    id: 'document.pagePreset',
    group: 'document',
    kind: 'select',
    label: '纸张',
    tooltip: '纸张大小',
    dataAttribute: 'data-jword-page-preset',
    options: PAGE_PRESET_OPTIONS
  },
  {
    id: 'format.bold',
    group: 'format',
    kind: 'button',
    label: '加粗',
    tooltip: '加粗',
    dataAttribute: 'data-jword-format-bold',
    icon: 'bold'
  },
  {
    id: 'format.italic',
    group: 'format',
    kind: 'button',
    label: '斜体',
    tooltip: '斜体',
    dataAttribute: 'data-jword-format-italic',
    icon: 'italic'
  },
  {
    id: 'format.underline',
    group: 'format',
    kind: 'button',
    label: '下划线',
    tooltip: '下划线',
    dataAttribute: 'data-jword-format-underline',
    icon: 'underline'
  },
  {
    id: 'format.strike',
    group: 'format',
    kind: 'button',
    label: '删除线',
    tooltip: '删除线',
    dataAttribute: 'data-jword-format-strike',
    icon: 'strike'
  },
  {
    id: 'format.fontFamily',
    group: 'format',
    kind: 'select',
    label: '字体',
    tooltip: '字体',
    dataAttribute: 'data-jword-format-font-family',
    options: FONT_FAMILY_OPTIONS
  },
  {
    id: 'format.fontSize',
    group: 'format',
    kind: 'select',
    label: '字号',
    tooltip: '字号',
    dataAttribute: 'data-jword-format-font-size',
    options: FONT_SIZE_OPTIONS
  },
  {
    id: 'format.textColor',
    group: 'format',
    kind: 'color',
    label: '文字颜色',
    tooltip: '文字颜色',
    icon: 'textColor',
    dataAttribute: 'data-jword-format-text-color'
  },
  {
    id: 'format.backgroundColor',
    group: 'format',
    kind: 'color',
    label: '背景色',
    tooltip: '背景色',
    icon: 'backgroundColor',
    dataAttribute: 'data-jword-format-background-color'
  },
  {
    id: 'paragraph.alignLeft',
    group: 'paragraph',
    kind: 'button',
    label: '左对齐',
    tooltip: '左对齐',
    dataAttribute: 'data-jword-format-align-left',
    icon: 'alignLeft'
  },
  {
    id: 'paragraph.alignCenter',
    group: 'paragraph',
    kind: 'button',
    label: '居中对齐',
    tooltip: '居中对齐',
    dataAttribute: 'data-jword-format-align-center',
    icon: 'alignCenter'
  },
  {
    id: 'paragraph.alignRight',
    group: 'paragraph',
    kind: 'button',
    label: '右对齐',
    tooltip: '右对齐',
    dataAttribute: 'data-jword-format-align-right',
    icon: 'alignRight'
  },
  {
    id: 'paragraph.alignJustify',
    group: 'paragraph',
    kind: 'button',
    label: '两端对齐',
    tooltip: '两端对齐',
    dataAttribute: 'data-jword-format-align-justify',
    icon: 'alignJustify'
  },
  {
    id: 'paragraph.indentDecrease',
    group: 'paragraph',
    kind: 'button',
    label: '减少缩进',
    tooltip: '减少缩进',
    dataAttribute: 'data-jword-format-indent-decrease',
    icon: 'indentDecrease'
  },
  {
    id: 'paragraph.indentIncrease',
    group: 'paragraph',
    kind: 'button',
    label: '增加缩进',
    tooltip: '增加缩进',
    dataAttribute: 'data-jword-format-indent-increase',
    icon: 'indentIncrease'
  }
] as const satisfies readonly BuiltinToolDefinition[]

const BUILTIN_TOOL_MAP = new Map<JWordToolbarToolId, BuiltinToolDefinition>(
  BUILTIN_TOOL_DEFINITIONS.map((tool) => [tool.id, tool])
)

/** 判断运行时字符串是否属于内建工具。 */
export function isBuiltinToolId(value: string): value is JWordToolbarToolId {
  return BUILTIN_TOOL_MAP.has(value as JWordToolbarToolId)
}

/** 读取单个内建工具定义。 */
export function getBuiltinToolDefinition(id: JWordToolbarToolId): BuiltinToolDefinition {
  const definition = BUILTIN_TOOL_MAP.get(id)

  if (definition === undefined) {
    throw new Error(`未知的 JWord toolbar tool: ${id}`)
  }

  return definition
}
