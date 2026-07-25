/**
 * 职责：把宿主传入的 toolbar 配置规范化为稳定的显示顺序。
 * 边界：不创建 DOM，不读写 editor，也不做命令分发。
 * 协作模块：create-ui/controller 先解析配置，再把结果交给 dom 和 state 层消费。
 * 性能/安全约束：只做小规模数组归一化，避免引入动态注册或复杂配置系统。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import type {
  JWordToolbarMode,
  JWordToolbarOptions,
  JWordToolbarTabId,
  JWordToolbarToolId
} from '../types'
import { isBuiltinToolId } from './builtin-tools'

/** 供内部消费的 toolbar 规范化结果。 */
export interface ResolvedToolbarConfig {
  readonly mode: JWordToolbarMode
  readonly modeSwitcher: boolean
  readonly commonExtensions: boolean
  readonly activeTab: JWordToolbarTabId
  readonly tabs: readonly ResolvedToolbarTabConfig[]
  readonly commonToolIds: readonly JWordToolbarToolId[]
  readonly toolIds: readonly JWordToolbarToolId[]
}

/** 供 DOM 层消费的专业模式 Tab 配置。 */
export interface ResolvedToolbarTabConfig {
  readonly id: JWordToolbarTabId
  readonly toolIds: readonly JWordToolbarToolId[]
}

const TOOLBAR_TAB_IDS = [
  'home',
  'insert',
  'table',
  'page',
  'tools',
  'view',
  'export'
] as const satisfies readonly JWordToolbarTabId[]

const PROFESSIONAL_TOOLBAR_TABS: Readonly<Record<JWordToolbarTabId, readonly JWordToolbarToolId[]>> = Object.freeze({
  home: [
    'history.undo',
    'history.redo',
    'paragraph.style',
    'format.fontFamily',
    'format.fontSize',
    'format.fontSizeDecrease',
    'format.fontSizeIncrease',
    'format.bold',
    'format.italic',
    'format.underline',
    'format.strike',
    'format.superscript',
    'format.subscript',
    'format.textColor',
    'format.backgroundColor',
    'paragraph.alignment',
    'paragraph.list',
    'paragraph.indentDecrease',
    'paragraph.indentIncrease',
    'paragraph.lineHeight',
    'paragraph.spacingBefore',
    'paragraph.spacingAfter',
    'paragraph.firstLineIndent',
    'paragraph.hangingIndent'
  ],
  insert: [
    'insert.link',
    'insert.comment'
  ],
  table: [],
  page: [
    'document.pagePreset',
    'document.pageOrientation',
    'document.customPageSize',
    'document.headerFooter',
    'document.footer',
    'document.pageNumber'
  ],
  tools: [
    'document.findReplace',
    'document.watermark',
    'document.headingOutline',
    'document.revisions'
  ],
  view: [
    'view.fitWidth',
    'view.fitPage',
    'view.fullscreen',
    'view.presentation',
    'view.zoomReset',
    'view.theme',
    'view.locale'
  ],
  export: [
    'export.native'
  ]
})

const DEFAULT_COMMON_TOOL_IDS = [
  'history.undo',
  'history.redo',
  'paragraph.style',
  'format.fontFamily',
  'format.fontSize',
  'format.bold',
  'format.italic',
  'format.underline',
  'format.textColor',
  'format.backgroundColor',
  'paragraph.alignment',
  'paragraph.list',
  'insert.link',
  'insert.comment',
  'document.findReplace'
] as const satisfies readonly JWordToolbarToolId[]

/** 规范化宿主传入的 toolbar 配置。 */
export function resolveToolbarConfig(input?: JWordToolbarOptions): ResolvedToolbarConfig {
  const mode = resolveToolbarMode(input)
  const modeSwitcher = input?.modeSwitcher ?? mode === 'professional'
  const commonExtensions = resolveCommonExtensionVisibility(input)
  const commonToolIds = resolveCommonToolIds(input)
  const tabs = resolveProfessionalTabs(input)
  const activeTab = resolveActiveTab(input, tabs)
  const professionalToolIds = tabs.flatMap((tab) => tab.toolIds)
  const visibleToolIds = mode === 'professional'
    ? professionalToolIds
    : commonToolIds
  const toolIds = modeSwitcher
    ? uniqueToolIds([
        ...professionalToolIds,
        ...commonToolIds
      ])
    : uniqueToolIds(visibleToolIds)

  return {
    mode,
    modeSwitcher,
    commonExtensions,
    activeTab,
    tabs,
    commonToolIds,
    toolIds
  }
}

/** 判断常用模式是否应显示官方扩展入口，显式 visibleTools 仍保持旧的严格声明语义。 */
function resolveCommonExtensionVisibility(input: JWordToolbarOptions | undefined): boolean {
  if (input !== undefined && 'visibleTools' in input) {
    return false
  }

  return !(input?.common !== undefined && 'visibleTools' in input.common)
}

/** 解析 toolbar 展示模式，兼容旧 visibleTools 配置。 */
function resolveToolbarMode(input: JWordToolbarOptions | undefined): JWordToolbarMode {
  if (input?.mode !== undefined) {
    return input.mode
  }

  return input !== undefined && 'visibleTools' in input ? 'common' : 'professional'
}

/** 解析常用工具顺序。 */
function resolveCommonToolIds(input: JWordToolbarOptions | undefined): readonly JWordToolbarToolId[] {
  const hasVisibleTools = input !== undefined && 'visibleTools' in input
  const hasCommonVisibleTools = input?.common !== undefined && 'visibleTools' in input.common
  const visibleTools = hasCommonVisibleTools
    ? normalizeToolIds(input?.common?.visibleTools)
    : normalizeToolIds(input?.visibleTools)
  const hiddenTools = new Set([
    ...normalizeToolIds(input?.hiddenTools),
    ...normalizeToolIds(input?.common?.hiddenTools)
  ])
  const baseTools = hasVisibleTools
    ? visibleTools
    : hasCommonVisibleTools
      ? visibleTools
      : DEFAULT_COMMON_TOOL_IDS

  return baseTools.filter((toolId) => !hiddenTools.has(toolId))
}

/** 解析专业模式所有 Tab。 */
function resolveProfessionalTabs(input: JWordToolbarOptions | undefined): readonly ResolvedToolbarTabConfig[] {
  const hiddenTabs = new Set(input?.professional?.hiddenTabs ?? [])
  const hiddenTools = new Set(normalizeToolIds(input?.hiddenTools))

  return TOOLBAR_TAB_IDS
    .filter((tabId) => !hiddenTabs.has(tabId))
    .map((tabId) => ({
      id: tabId,
      toolIds: normalizeToolIds(input?.professional?.tabTools?.[tabId] ?? PROFESSIONAL_TOOLBAR_TABS[tabId])
        .filter((toolId) => !hiddenTools.has(toolId))
    }))
}

/** 解析当前激活 Tab，配置缺失或被隐藏时回退第一个可见 Tab。 */
function resolveActiveTab(
  input: JWordToolbarOptions | undefined,
  tabs: readonly ResolvedToolbarTabConfig[]
): JWordToolbarTabId {
  const configuredTab = input?.professional?.defaultTab

  if (configuredTab !== undefined && tabs.some((tab) => tab.id === configuredTab)) {
    return configuredTab
  }

  return tabs[0]?.id ?? 'home'
}

/** 对 tool id 去重，并过滤运行时混入的未知值。 */
function uniqueToolIds(toolIds: readonly JWordToolbarToolId[]): readonly JWordToolbarToolId[] {
  const seen = new Set<JWordToolbarToolId>()
  const normalized: JWordToolbarToolId[] = []

  for (const toolId of toolIds) {
    if (!isBuiltinToolId(toolId) || seen.has(toolId)) {
      continue
    }

    seen.add(toolId)
    normalized.push(toolId)
  }

  return normalized
}

/** 去重并过滤掉运行时可能混入的未知工具 ID。 */
function normalizeToolIds(toolIds: readonly JWordToolbarToolId[] | undefined): readonly JWordToolbarToolId[] {
  if (toolIds === undefined || toolIds.length === 0) {
    return []
  }

  const seen = new Set<JWordToolbarToolId>()
  const normalized: JWordToolbarToolId[] = []

  for (const toolId of toolIds) {
    if (!isBuiltinToolId(toolId) || seen.has(toolId)) {
      continue
    }

    seen.add(toolId)
    normalized.push(toolId)
  }

  return normalized
}
