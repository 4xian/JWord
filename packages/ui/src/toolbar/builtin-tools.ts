/**
 * 职责：集中定义 UI 包第一版内建工具、分组、字段标签和固定选项。
 * 边界：只提供静态配置，不读取 editor 状态，也不创建 DOM 节点。
 * 协作模块：toolbar config/dom/controller 依赖这里的工具元数据完成显隐、渲染和事件绑定。
 * 性能/安全约束：模块初始化只创建常量映射，无浏览器副作用。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import type { ParagraphAlignment, ParagraphList } from '@4xian/jword-core'
import type { JWordToolbarToolId } from '../types'
import type { ToolbarIconName } from './icons'

/** toolbar 中的字段选项。 */
export interface ToolbarOption {
  readonly value: string
  readonly label: string
  readonly icon?: ToolbarIconName
}

/** toolbar 内建分组。 */
export type ToolbarGroupId = 'history' | 'document' | 'insert' | 'format' | 'paragraph' | 'view' | 'export'

/** toolbar 内建控件种类。 */
export type ToolbarControlKind = 'button' | 'select' | 'color'

/** toolbar select / trigger 的视觉变体。 */
export type ToolbarTriggerVariant = 'plain' | 'icon' | 'boxed'

/** toolbar select 菜单项的视觉布局。 */
export type ToolbarMenuLayout = 'text' | 'icon'

/** toolbar 纯文本菜单项的对齐方式。 */
export type ToolbarMenuTextAlign = 'start' | 'center'

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
  readonly triggerVariant?: ToolbarTriggerVariant
  readonly triggerIcon?: ToolbarIconName
  readonly menuLayout?: ToolbarMenuLayout
  readonly menuTextAlign?: ToolbarMenuTextAlign
  readonly triggerMinWidthPx?: number
  readonly menuMinWidthPx?: number
  readonly menuMaxWidthPx?: number
  readonly options?: readonly ToolbarOption[]
}

/** 字体字段的空态占位值。 */
export const TOOLBAR_SELECT_EMPTY_VALUE = ''

/** 字体字段的 mixed 占位值。 */
export const TOOLBAR_SELECT_MIXED_VALUE = '__mixed__'

/** 字体字段的空态占位值。 */
export const FONT_FAMILY_EMPTY_VALUE = TOOLBAR_SELECT_EMPTY_VALUE

/** 字体字段的 mixed 占位值。 */
export const FONT_FAMILY_MIXED_VALUE = TOOLBAR_SELECT_MIXED_VALUE

/** 字号字段的空态占位值。 */
export const FONT_SIZE_EMPTY_VALUE = TOOLBAR_SELECT_EMPTY_VALUE

/** 字号字段的 mixed 占位值。 */
export const FONT_SIZE_MIXED_VALUE = TOOLBAR_SELECT_MIXED_VALUE

/** 字号步进按钮沿用的固定档位。 */
export const FONT_SIZE_TWIPS_STEPS = [180, 200, 220, 240, 280, 300, 320, 360, 420, 480] as const

/** 颜色字段的默认字色。 */
export const DEFAULT_TEXT_COLOR = '#111111'

/** 颜色字段的默认底色。 */
export const DEFAULT_BACKGROUND_COLOR = '#fff59d'

/** 列表字段中“无列表”的稳定值。 */
export const PARAGRAPH_LIST_NONE_VALUE = 'none'

interface ParagraphListOptionDefinition extends ToolbarOption {
  readonly list: ParagraphList | null
}

/** 所有内建工具 ID。 */
export const BUILTIN_TOOL_IDS = [
  'history.undo',
  'history.redo',
  'document.pagePreset',
  'document.pageOrientation',
  'document.customPageSize',
  'document.findReplace',
  'document.watermark',
  'document.headingOutline',
  'document.headerFooter',
  'document.footer',
  'document.pageNumber',
  'document.revisions',
  'insert.comment',
  'insert.link',
  'format.bold',
  'format.italic',
  'format.underline',
  'format.strike',
  'format.superscript',
  'format.subscript',
  'format.fontFamily',
  'format.fontSize',
  'format.fontSizeDecrease',
  'format.fontSizeIncrease',
  'format.textColor',
  'format.backgroundColor',
  'paragraph.alignment',
  'paragraph.indentDecrease',
  'paragraph.indentIncrease',
  'paragraph.indentLeft',
  'paragraph.lineHeight',
  'paragraph.spacingBefore',
  'paragraph.spacingAfter',
  'paragraph.firstLineIndent',
  'paragraph.hangingIndent',
  'paragraph.style',
  'paragraph.list',
  'view.fitWidth',
  'view.fitPage',
  'view.fullscreen',
  'view.presentation',
  'view.zoomReset',
  'view.theme',
  'view.locale',
  'export.native'
] as const satisfies readonly JWordToolbarToolId[]

/** 默认显示顺序采用新的 icon toolbar 布局，并隐藏旧的左缩进下拉。 */
export const DEFAULT_VISIBLE_TOOL_IDS = [
  'history.undo',
  'history.redo',
  'document.findReplace',
  'document.watermark',
  'document.headingOutline',
  'document.headerFooter',
  'document.footer',
  'document.pageNumber',
  'insert.comment',
  'insert.link',
  'format.fontFamily',
  'format.fontSize',
  'paragraph.style',
  'format.fontSizeIncrease',
  'format.fontSizeDecrease',
  'format.bold',
  'format.italic',
  'format.underline',
  'format.strike',
  'format.superscript',
  'format.subscript',
  'format.textColor',
  'format.backgroundColor',
  'paragraph.list',
  'paragraph.alignment',
  'paragraph.indentDecrease',
  'paragraph.indentIncrease',
  'paragraph.lineHeight',
  'paragraph.spacingBefore',
  'paragraph.spacingAfter',
  'paragraph.firstLineIndent',
  'paragraph.hangingIndent'
] as const satisfies readonly JWordToolbarToolId[]

const PAGE_PRESET_OPTIONS: readonly ToolbarOption[] = [
  { value: 'a3', label: 'A3' },
  { value: 'a4', label: 'A4' },
  { value: 'a5', label: 'A5' },
  { value: 'b5', label: 'B5' },
  { value: 'letter', label: 'Letter' },
  { value: 'legal', label: 'Legal' },
  { value: 'envelope3', label: '3号信封' },
  { value: 'envelope5', label: '5号信封' },
  { value: 'envelope6', label: '6号信封' },
  { value: 'envelope7', label: '7号信封' },
  { value: 'envelope9', label: '9号信封' },
  { value: 'custom', label: '自定义大小' }
] as const

const PAGE_ORIENTATION_OPTIONS: readonly ToolbarOption[] = [
  { value: 'portrait', label: '纵向', icon: 'fitPage' },
  { value: 'landscape', label: '横向', icon: 'fitWidth' }
] as const

const VIEW_THEME_OPTIONS: readonly ToolbarOption[] = [
  { value: 'light', label: '浅色', icon: 'themeLight' },
  { value: 'dark', label: '深色', icon: 'themeDark' }
] as const

const VIEW_LOCALE_OPTIONS: readonly ToolbarOption[] = [
  { value: 'zh-CN', label: '中文', icon: 'language' },
  { value: 'en-US', label: 'English', icon: 'language' }
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
  { value: '300', label: '15 pt' },
  { value: '320', label: '16 pt' },
  { value: '360', label: '18 pt' },
  { value: '420', label: '21 pt' },
  { value: '480', label: '24 pt' }
] as const

const PARAGRAPH_ALIGNMENT_LABEL_MAP = Object.freeze<Record<ParagraphAlignment, string>>({
  left: '左对齐',
  center: '居中对齐',
  right: '右对齐',
  justify: '两端对齐'
})

const PARAGRAPH_STYLE_LABEL_MAP = Object.freeze({
  Normal: '正文',
  Heading1: '标题 1',
  Heading2: '标题 2',
  Heading3: '标题 3'
} as const)

const PARAGRAPH_LIST_KIND_LABEL_MAP = Object.freeze<Record<string, string>>({
  'jword-list-bullet': '项目符号列表',
  'jword-list-ordered': '编号列表'
})

const PARAGRAPH_ALIGNMENT_OPTIONS = createToolbarSelectOptions('对齐', [
  { value: 'left', label: PARAGRAPH_ALIGNMENT_LABEL_MAP.left, icon: 'alignLeft' },
  { value: 'center', label: PARAGRAPH_ALIGNMENT_LABEL_MAP.center, icon: 'alignCenter' },
  { value: 'right', label: PARAGRAPH_ALIGNMENT_LABEL_MAP.right, icon: 'alignRight' },
  { value: 'justify', label: PARAGRAPH_ALIGNMENT_LABEL_MAP.justify, icon: 'alignJustify' }
])

const PARAGRAPH_INDENT_LEFT_OPTIONS = createToolbarSelectOptions('左缩进', [
  { value: '0', label: formatTwipsOptionLabel(0) },
  { value: '360', label: formatTwipsOptionLabel(360) },
  { value: '720', label: formatTwipsOptionLabel(720) },
  { value: '1080', label: formatTwipsOptionLabel(1080) },
  { value: '1440', label: formatTwipsOptionLabel(1440) },
  { value: '1800', label: formatTwipsOptionLabel(1800) },
  { value: '2160', label: formatTwipsOptionLabel(2160) },
  { value: '2880', label: formatTwipsOptionLabel(2880) }
])

const PARAGRAPH_LINE_HEIGHT_OPTIONS = createToolbarSelectOptions('行距', [
  { value: '1', label: '1' },
  { value: '1.15', label: '1.15' },
  { value: '1.25', label: '1.25' },
  { value: '1.5', label: '1.5' },
  { value: '1.75', label: '1.75' },
  { value: '1.8', label: '1.8' },
  { value: '2', label: '2' },
  { value: '2.5', label: '2.5' },
  { value: '3', label: '3' }
])

const PARAGRAPH_SPACING_OPTIONS = createToolbarSelectOptions('段前', [
  { value: '0', label: formatTwipsOptionLabel(0) },
  { value: '120', label: formatTwipsOptionLabel(120) },
  { value: '240', label: formatTwipsOptionLabel(240) },
  { value: '360', label: formatTwipsOptionLabel(360) },
  { value: '480', label: formatTwipsOptionLabel(480) },
  { value: '600', label: formatTwipsOptionLabel(600) },
  { value: '720', label: formatTwipsOptionLabel(720) }
])

const PARAGRAPH_SPACING_AFTER_OPTIONS = createToolbarSelectOptions('段后', [
  { value: '0', label: formatTwipsOptionLabel(0) },
  { value: '120', label: formatTwipsOptionLabel(120) },
  { value: '240', label: formatTwipsOptionLabel(240) },
  { value: '360', label: formatTwipsOptionLabel(360) },
  { value: '480', label: formatTwipsOptionLabel(480) },
  { value: '600', label: formatTwipsOptionLabel(600) },
  { value: '720', label: formatTwipsOptionLabel(720) }
])

const PARAGRAPH_FIRST_LINE_INDENT_OPTIONS = createToolbarSelectOptions('首行', [
  { value: '0', label: formatTwipsOptionLabel(0) },
  { value: '240', label: formatTwipsOptionLabel(240) },
  { value: '360', label: formatTwipsOptionLabel(360) },
  { value: '480', label: formatTwipsOptionLabel(480) },
  { value: '720', label: formatTwipsOptionLabel(720) },
  { value: '960', label: formatTwipsOptionLabel(960) }
])

const PARAGRAPH_HANGING_INDENT_OPTIONS = createToolbarSelectOptions('悬挂', [
  { value: '0', label: formatTwipsOptionLabel(0) },
  { value: '240', label: formatTwipsOptionLabel(240) },
  { value: '360', label: formatTwipsOptionLabel(360) },
  { value: '480', label: formatTwipsOptionLabel(480) },
  { value: '720', label: formatTwipsOptionLabel(720) },
  { value: '960', label: formatTwipsOptionLabel(960) }
])

const PARAGRAPH_STYLE_OPTIONS = createToolbarSelectOptions('样式', [
  { value: 'Normal', label: PARAGRAPH_STYLE_LABEL_MAP.Normal },
  { value: 'Heading1', label: PARAGRAPH_STYLE_LABEL_MAP.Heading1 },
  { value: 'Heading2', label: PARAGRAPH_STYLE_LABEL_MAP.Heading2 },
  { value: 'Heading3', label: PARAGRAPH_STYLE_LABEL_MAP.Heading3 }
])

const PARAGRAPH_LIST_OPTIONS = createToolbarSelectOptions('列表', [
  { value: PARAGRAPH_LIST_NONE_VALUE, label: '无列表', icon: 'listBullet' },
  { value: 'bullet-l1', label: '项目符号列表 1 级', icon: 'listBullet' },
  { value: 'bullet-l2', label: '项目符号列表 2 级', icon: 'listBullet' },
  { value: 'bullet-l3', label: '项目符号列表 3 级', icon: 'listBullet' },
  { value: 'ordered-l1', label: '编号列表 1 级', icon: 'listOrdered' },
  { value: 'ordered-l2', label: '编号列表 2 级', icon: 'listOrdered' },
  { value: 'ordered-l3', label: '编号列表 3 级', icon: 'listOrdered' }
])

const PARAGRAPH_LIST_OPTION_DEFINITIONS = [
  {
    value: PARAGRAPH_LIST_NONE_VALUE,
    label: '无列表',
    list: null
  },
  {
    value: 'bullet-l1',
    label: '项目符号列表 1 级',
    list: {
      numberingId: 'jword-list-bullet',
      level: 1
    }
  },
  {
    value: 'bullet-l2',
    label: '项目符号列表 2 级',
    list: {
      numberingId: 'jword-list-bullet',
      level: 2
    }
  },
  {
    value: 'bullet-l3',
    label: '项目符号列表 3 级',
    list: {
      numberingId: 'jword-list-bullet',
      level: 3
    }
  },
  {
    value: 'ordered-l1',
    label: '编号列表 1 级',
    list: {
      numberingId: 'jword-list-ordered',
      level: 1
    }
  },
  {
    value: 'ordered-l2',
    label: '编号列表 2 级',
    list: {
      numberingId: 'jword-list-ordered',
      level: 2
    }
  },
  {
    value: 'ordered-l3',
    label: '编号列表 3 级',
    list: {
      numberingId: 'jword-list-ordered',
      level: 3
    }
  }
] as const satisfies readonly ParagraphListOptionDefinition[]

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
    label: '页面大小',
    tooltip: '页面大小',
    dataAttribute: 'data-jword-page-preset',
    fieldLabel: '页面大小',
    triggerVariant: 'icon',
    triggerIcon: 'layout',
    menuLayout: 'text',
    triggerMinWidthPx: 70,
    menuMinWidthPx: 96,
    menuMaxWidthPx: 124,
    options: PAGE_PRESET_OPTIONS
  },
  {
    id: 'document.pageOrientation',
    group: 'document',
    kind: 'select',
    label: '页面方向',
    tooltip: '页面方向',
    dataAttribute: 'data-jword-page-orientation',
    fieldLabel: '页面方向',
    triggerVariant: 'icon',
    triggerIcon: 'fitPage',
    menuLayout: 'icon',
    menuMinWidthPx: 112,
    menuMaxWidthPx: 144,
    options: PAGE_ORIENTATION_OPTIONS
  },
  {
    id: 'document.customPageSize',
    group: 'document',
    kind: 'button',
    label: '自定义页面',
    tooltip: '自定义页面大小',
    dataAttribute: 'data-jword-custom-page-size',
    icon: 'layout'
  },
  {
    id: 'document.findReplace',
    group: 'document',
    kind: 'button',
    label: '查找替换',
    tooltip: '查找替换',
    dataAttribute: 'data-jword-open-find-replace',
    icon: 'search'
  },
  {
    id: 'document.watermark',
    group: 'document',
    kind: 'button',
    label: '页面水印',
    tooltip: '设置页面水印',
    dataAttribute: 'data-jword-open-watermark',
    icon: 'watermark'
  },
  {
    id: 'document.headingOutline',
    group: 'document',
    kind: 'button',
    label: '目录',
    tooltip: '目录',
    dataAttribute: 'data-jword-toggle-heading-outline',
    icon: 'outline'
  },
  {
    id: 'document.headerFooter',
    group: 'document',
    kind: 'button',
    label: '页眉',
    tooltip: '页眉',
    dataAttribute: 'data-jword-toggle-header-footer',
    icon: 'headerFooter'
  },
  {
    id: 'document.footer',
    group: 'document',
    kind: 'button',
    label: '页脚',
    tooltip: '页脚',
    dataAttribute: 'data-jword-toggle-footer',
    icon: 'footer'
  },
  {
    id: 'document.pageNumber',
    group: 'document',
    kind: 'button',
    label: '页码',
    tooltip: '页码',
    dataAttribute: 'data-jword-toggle-page-number',
    icon: 'pageNumber'
  },
  {
    id: 'document.revisions',
    group: 'document',
    kind: 'button',
    label: '修订记录',
    tooltip: '修订记录',
    dataAttribute: 'data-jword-toggle-revisions',
    icon: 'revisions'
  },
  {
    id: 'insert.comment',
    group: 'insert',
    kind: 'button',
    label: '批注',
    tooltip: '插入批注',
    dataAttribute: 'data-jword-insert-comment',
    icon: 'comment'
  },
  {
    id: 'insert.link',
    group: 'insert',
    kind: 'button',
    label: '链接',
    tooltip: '插入链接',
    dataAttribute: 'data-jword-insert-link',
    icon: 'link'
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
    id: 'format.superscript',
    group: 'format',
    kind: 'button',
    label: '上标',
    tooltip: '上标',
    dataAttribute: 'data-jword-format-superscript',
    icon: 'superscript'
  },
  {
    id: 'format.subscript',
    group: 'format',
    kind: 'button',
    label: '下标',
    tooltip: '下标',
    dataAttribute: 'data-jword-format-subscript',
    icon: 'subscript'
  },
  {
    id: 'format.fontFamily',
    group: 'format',
    kind: 'select',
    label: '字体',
    tooltip: '字体',
    dataAttribute: 'data-jword-format-font-family',
    fieldLabel: '字体',
    triggerVariant: 'boxed',
    menuLayout: 'text',
    triggerMinWidthPx: 92,
    menuMinWidthPx: 116,
    menuMaxWidthPx: 148,
    options: FONT_FAMILY_OPTIONS
  },
  {
    id: 'format.fontSize',
    group: 'format',
    kind: 'select',
    label: '字号',
    tooltip: '字号',
    dataAttribute: 'data-jword-format-font-size',
    fieldLabel: '字号',
    triggerVariant: 'boxed',
    menuLayout: 'text',
    triggerMinWidthPx: 54,
    menuMinWidthPx: 76,
    menuMaxWidthPx: 104,
    options: FONT_SIZE_OPTIONS
  },
  {
    id: 'format.fontSizeDecrease',
    group: 'format',
    kind: 'button',
    label: '减小字号',
    tooltip: '减小字号',
    dataAttribute: 'data-jword-format-font-size-decrease',
    icon: 'fontSizeDecrease'
  },
  {
    id: 'format.fontSizeIncrease',
    group: 'format',
    kind: 'button',
    label: '增大字号',
    tooltip: '增大字号',
    dataAttribute: 'data-jword-format-font-size-increase',
    icon: 'fontSizeIncrease'
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
    id: 'paragraph.alignment',
    group: 'paragraph',
    kind: 'select',
    label: '段落对齐',
    tooltip: '段落对齐',
    dataAttribute: 'data-jword-paragraph-alignment',
    fieldLabel: '对齐',
    triggerVariant: 'icon',
    triggerIcon: 'alignLeft',
    menuLayout: 'icon',
    menuMinWidthPx: 124,
    menuMaxWidthPx: 156,
    options: PARAGRAPH_ALIGNMENT_OPTIONS
  },
  {
    id: 'paragraph.indentDecrease',
    group: 'paragraph',
    kind: 'button',
    label: '减少缩进',
    tooltip: '减少缩进',
    dataAttribute: 'data-jword-paragraph-indent-decrease',
    icon: 'indentDecrease'
  },
  {
    id: 'paragraph.indentIncrease',
    group: 'paragraph',
    kind: 'button',
    label: '增加缩进',
    tooltip: '增加缩进',
    dataAttribute: 'data-jword-paragraph-indent-increase',
    icon: 'indentIncrease'
  },
  {
    id: 'paragraph.indentLeft',
    group: 'paragraph',
    kind: 'select',
    label: '左缩进',
    tooltip: '左缩进',
    dataAttribute: 'data-jword-paragraph-indent-left',
    fieldLabel: '左缩进',
    menuLayout: 'text',
    triggerMinWidthPx: 78,
    menuMinWidthPx: 92,
    menuMaxWidthPx: 112,
    options: PARAGRAPH_INDENT_LEFT_OPTIONS
  },
  {
    id: 'paragraph.lineHeight',
    group: 'paragraph',
    kind: 'select',
    label: '行距',
    tooltip: '行距',
    dataAttribute: 'data-jword-paragraph-line-height',
    fieldLabel: '行距',
    triggerVariant: 'icon',
    triggerIcon: 'lineHeight',
    menuLayout: 'text',
    menuMinWidthPx: 72,
    menuMaxWidthPx: 96,
    options: PARAGRAPH_LINE_HEIGHT_OPTIONS
  },
  {
    id: 'paragraph.spacingBefore',
    group: 'paragraph',
    kind: 'select',
    label: '段前间距',
    tooltip: '段前间距',
    dataAttribute: 'data-jword-paragraph-spacing-before',
    fieldLabel: '段前',
    triggerVariant: 'icon',
    triggerIcon: 'spacingBefore',
    menuLayout: 'text',
    menuMinWidthPx: 84,
    menuMaxWidthPx: 108,
    options: PARAGRAPH_SPACING_OPTIONS
  },
  {
    id: 'paragraph.spacingAfter',
    group: 'paragraph',
    kind: 'select',
    label: '段后间距',
    tooltip: '段后间距',
    dataAttribute: 'data-jword-paragraph-spacing-after',
    fieldLabel: '段后',
    triggerVariant: 'icon',
    triggerIcon: 'spacingAfter',
    menuLayout: 'text',
    menuMinWidthPx: 84,
    menuMaxWidthPx: 108,
    options: PARAGRAPH_SPACING_AFTER_OPTIONS
  },
  {
    id: 'paragraph.firstLineIndent',
    group: 'paragraph',
    kind: 'select',
    label: '首行缩进',
    tooltip: '首行缩进',
    dataAttribute: 'data-jword-paragraph-first-line-indent',
    fieldLabel: '首行',
    triggerVariant: 'icon',
    triggerIcon: 'firstLineIndent',
    menuLayout: 'text',
    menuMinWidthPx: 84,
    menuMaxWidthPx: 108,
    options: PARAGRAPH_FIRST_LINE_INDENT_OPTIONS
  },
  {
    id: 'paragraph.hangingIndent',
    group: 'paragraph',
    kind: 'select',
    label: '悬挂缩进',
    tooltip: '悬挂缩进',
    dataAttribute: 'data-jword-paragraph-hanging-indent',
    fieldLabel: '悬挂',
    triggerVariant: 'icon',
    triggerIcon: 'hangingIndent',
    menuLayout: 'text',
    menuMinWidthPx: 84,
    menuMaxWidthPx: 108,
    options: PARAGRAPH_HANGING_INDENT_OPTIONS
  },
  {
    id: 'paragraph.style',
    group: 'format',
    kind: 'select',
    label: '段落样式',
    tooltip: '段落样式',
    dataAttribute: 'data-jword-paragraph-style',
    fieldLabel: '样式',
    triggerVariant: 'boxed',
    menuLayout: 'text',
    triggerMinWidthPx: 74,
    menuMinWidthPx: 94,
    menuMaxWidthPx: 118,
    options: PARAGRAPH_STYLE_OPTIONS
  },
  {
    id: 'paragraph.list',
    group: 'paragraph',
    kind: 'select',
    label: '列表样式',
    tooltip: '段落列表',
    dataAttribute: 'data-jword-paragraph-list',
    fieldLabel: '列表',
    triggerVariant: 'icon',
    triggerIcon: 'listBullet',
    menuLayout: 'icon',
    menuMinWidthPx: 160,
    menuMaxWidthPx: 192,
    options: PARAGRAPH_LIST_OPTIONS
  },
  {
    id: 'view.fitWidth',
    group: 'view',
    kind: 'button',
    label: '适应宽度',
    tooltip: '适应宽度',
    dataAttribute: 'data-jword-view-fit-width',
    icon: 'fitWidth'
  },
  {
    id: 'view.fitPage',
    group: 'view',
    kind: 'button',
    label: '适应整页',
    tooltip: '适应整页',
    dataAttribute: 'data-jword-view-fit-page',
    icon: 'fitPage'
  },
  {
    id: 'view.fullscreen',
    group: 'view',
    kind: 'button',
    label: '全屏模式',
    tooltip: '全屏模式',
    dataAttribute: 'data-jword-view-fullscreen',
    icon: 'fullscreen'
  },
  {
    id: 'view.presentation',
    group: 'view',
    kind: 'button',
    label: '演示模式',
    tooltip: '演示模式',
    dataAttribute: 'data-jword-view-presentation',
    icon: 'presentation'
  },
  {
    id: 'view.zoomReset',
    group: 'view',
    kind: 'button',
    label: '还原视图',
    tooltip: '还原为 100%',
    dataAttribute: 'data-jword-view-zoom-reset',
    icon: 'reset'
  },
  {
    id: 'view.theme',
    group: 'view',
    kind: 'select',
    label: '主题设置',
    tooltip: '主题设置',
    dataAttribute: 'data-jword-view-theme',
    fieldLabel: '主题设置',
    triggerVariant: 'icon',
    triggerIcon: 'themeLight',
    menuLayout: 'icon',
    menuMinWidthPx: 112,
    menuMaxWidthPx: 144,
    options: VIEW_THEME_OPTIONS
  },
  {
    id: 'view.locale',
    group: 'view',
    kind: 'select',
    label: '语言设置',
    tooltip: '语言设置',
    dataAttribute: 'data-jword-view-locale',
    fieldLabel: '语言设置',
    triggerVariant: 'icon',
    triggerIcon: 'language',
    menuLayout: 'icon',
    menuMinWidthPx: 128,
    menuMaxWidthPx: 160,
    options: VIEW_LOCALE_OPTIONS
  },
  {
    id: 'export.native',
    group: 'export',
    kind: 'button',
    label: '原生格式',
    tooltip: '导出原生 JWord 格式',
    dataAttribute: 'data-jword-export-native',
    icon: 'download'
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

/** 判断当前选项值是否只是 toolbar 的空态占位。 */
export function isToolbarPlaceholderSelectValue(value: string): boolean {
  return value === TOOLBAR_SELECT_EMPTY_VALUE || value === TOOLBAR_SELECT_MIXED_VALUE
}

/** 把列表 select 值解析成稳定列表语义。 */
export function parseParagraphListSelectValue(value: string): ParagraphList | null | undefined {
  const option = PARAGRAPH_LIST_OPTION_DEFINITIONS.find((item) => item.value === value)

  return option?.list
}

/** 把稳定列表语义映射回 select 值。 */
export function stringifyParagraphListSelectValue(value: ParagraphList | null | undefined): string {
  if (value === undefined) {
    return PARAGRAPH_LIST_NONE_VALUE
  }

  if (value === null) {
    return PARAGRAPH_LIST_NONE_VALUE
  }

  const option = PARAGRAPH_LIST_OPTION_DEFINITIONS.find((item) => (
    item.list !== null
      && item.list.numberingId === value.numberingId
      && item.list.level === value.level
  ))

  return option?.value ?? TOOLBAR_SELECT_EMPTY_VALUE
}

/** 为自绘 select 生成统一的空态与 mixed 占位。 */
function createToolbarSelectOptions(
  emptyLabel: string,
  options: readonly ToolbarOption[]
): readonly ToolbarOption[] {
  return [
    { value: TOOLBAR_SELECT_EMPTY_VALUE, label: emptyLabel },
    { value: TOOLBAR_SELECT_MIXED_VALUE, label: '混合' },
    ...options
  ]
}

/** 把 twips 选项文案稳定转换成 pt。 */
function formatTwipsOptionLabel(value: number): string {
  return `${value / 20} pt`
}

/** 读取段落对齐的中文文案。 */
export function readParagraphAlignmentLabel(value: ParagraphAlignment | undefined): string | undefined {
  return value === undefined ? undefined : PARAGRAPH_ALIGNMENT_LABEL_MAP[value]
}

/** 读取段落样式的中文文案。 */
export function readParagraphStyleLabel(value: string | null | undefined): string | undefined {
  if (value === undefined || value === null) {
    return undefined
  }

  return value in PARAGRAPH_STYLE_LABEL_MAP
    ? PARAGRAPH_STYLE_LABEL_MAP[value as keyof typeof PARAGRAPH_STYLE_LABEL_MAP]
    : value
}

/** 读取列表 numbering id 对应的中文种类文案。 */
export function readParagraphListKindLabel(value: string): string {
  return PARAGRAPH_LIST_KIND_LABEL_MAP[value] ?? value
}
