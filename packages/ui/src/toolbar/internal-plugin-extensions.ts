/**
 * 职责：声明 UI 包内部消费的 Gate 7 插件扩展，用于验证插件 toolbar/menu API 形状。
 * 边界：只生成插件 UI 配置，不直接操作 DOM，不执行 editor 命令。
 * 协作模块：toolbar controller 合并内部/外部扩展，core 内置 `jword.ui` 插件执行实际命令。
 * 性能/安全约束：状态谓词只读取 PageConfig，不触发布局；内置工具保持独立插件运行时键。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import type { PagePreset } from '@4xian/jword-core'

import { readJWordUiText, type ResolvedJWordUiI18n } from '../i18n'
import type { JWordToolbarOptions, JWordUiPluginExtension } from '../types'
import type { ResolvedToolbarConfig } from './config'
import { CUSTOM_PAGE_SIZE_COMMAND } from './page-size-dialog'
import { readPagePresetAnnouncement } from './state'

interface ResolveToolbarPluginExtensionsOptions {
  readonly toolbar: false | JWordToolbarOptions | undefined
  readonly toolbarHidden: boolean
  readonly toolbarConfig: ResolvedToolbarConfig
  readonly externalExtensions: readonly JWordUiPluginExtension[] | undefined
  readonly i18n: ResolvedJWordUiI18n
}

interface PagePresetMenuItem {
  readonly preset: PagePreset
  readonly labelFallback: string
  readonly sizeFallback: string
}

const PAGE_PRESET_MENU_ITEMS: readonly PagePresetMenuItem[] = [
  { preset: 'a3', labelFallback: 'A3', sizeFallback: '29.7厘米 × 42厘米' },
  { preset: 'a4', labelFallback: 'A4', sizeFallback: '21厘米 × 29.7厘米' },
  { preset: 'a5', labelFallback: 'A5', sizeFallback: '14.8厘米 × 21厘米' },
  { preset: 'b5', labelFallback: 'B5', sizeFallback: '17.6厘米 × 25厘米' },
  { preset: 'letter', labelFallback: 'Letter', sizeFallback: '21.6厘米 × 27.9厘米' },
  { preset: 'legal', labelFallback: 'Legal', sizeFallback: '21.6厘米 × 35.6厘米' },
  { preset: 'envelope3', labelFallback: '3号信封', sizeFallback: '12.5厘米 × 17.6厘米' },
  { preset: 'envelope5', labelFallback: '5号信封', sizeFallback: '11厘米 × 22厘米' },
  { preset: 'envelope6', labelFallback: '6号信封', sizeFallback: '12厘米 × 23厘米' },
  { preset: 'envelope7', labelFallback: '7号信封', sizeFallback: '16.2厘米 × 22.9厘米' },
  { preset: 'envelope9', labelFallback: '9号信封', sizeFallback: '22.9厘米 × 32.4厘米' }
]

/** 合并内部插件扩展与宿主传入的插件扩展。 */
export function resolveToolbarPluginExtensions(
  options: ResolveToolbarPluginExtensionsOptions
): readonly JWordUiPluginExtension[] | undefined {
  const extensions = [
    ...resolveInternalToolbarPluginExtensions(options),
    ...(options.externalExtensions ?? [])
  ]

  return extensions.length === 0 ? undefined : extensions
}

/** 读取需要启用的内部插件扩展。 */
function resolveInternalToolbarPluginExtensions(
  options: ResolveToolbarPluginExtensionsOptions
): readonly JWordUiPluginExtension[] {
  return shouldRenderPagePresetPlugin(options)
    ? [createPagePresetPluginExtension(options.i18n)]
    : []
}

/** 创建默认页面尺寸插件菜单扩展。 */
function createPagePresetPluginExtension(i18n: ResolvedJWordUiI18n): JWordUiPluginExtension {
  return {
    pluginName: 'jword.ui',
    menus: [{
      name: 'pagePreset',
      label: readJWordUiText(i18n, 'menu.pagePreset.label'),
      ariaLabel: readJWordUiText(i18n, 'menu.pagePreset.ariaLabel'),
      tooltip: readJWordUiText(i18n, 'menu.pagePreset.tooltip'),
      items: [
        ...PAGE_PRESET_MENU_ITEMS.map((item) => createPagePresetAction(item, i18n)),
        createCustomPageSizeAction(i18n)
      ]
    }]
  }
}

/** 判断默认页面尺寸菜单是否应走插件内部消费者。 */
function shouldRenderPagePresetPlugin(options: ResolveToolbarPluginExtensionsOptions): boolean {
  if (options.toolbarHidden) {
    return false
  }

  if (options.toolbar !== undefined && options.toolbar !== false && 'visibleTools' in options.toolbar) {
    return false
  }

  if (options.toolbar !== undefined && options.toolbar !== false && options.toolbar.hiddenTools?.includes('document.pagePreset') === true) {
    return false
  }

  return !options.toolbarConfig.toolIds.includes('document.pagePreset')
}

/** 创建页面尺寸菜单动作。 */
function createPagePresetAction(item: PagePresetMenuItem, i18n: ResolvedJWordUiI18n) {
  const label = readJWordUiText(
    i18n,
    `toolbar.document.pagePreset.option.${item.preset}`
  )
  const description = readJWordUiText(
    i18n,
    `menu.pagePreset.option.${item.preset}.size`
  )

  return {
    name: item.preset,
    label,
    description,
    ariaLabel: `${label} ${description}`,
    commandName: 'jword.ui.setPagePreset',
    input: { preset: item.preset },
    active: (context) => context.editor.getPageConfig().preset === item.preset,
    announce: (context) => readPagePresetAnnouncement(item.preset, context.editor.getPageConfig())
  } satisfies NonNullable<JWordUiPluginExtension['menus']>[number]['items'][number]
}

/** 创建自定义页面尺寸菜单动作。 */
function createCustomPageSizeAction(i18n: ResolvedJWordUiI18n) {
  const label = readJWordUiText(i18n, 'menu.pagePreset.option.custom.label')
  const description = readJWordUiText(i18n, 'menu.pagePreset.option.custom.size')

  return {
    name: 'custom',
    label,
    description,
    ariaLabel: `${label} ${description}`,
    commandName: CUSTOM_PAGE_SIZE_COMMAND,
    active: (context) => context.editor.getPageConfig().preset === 'custom'
  } satisfies NonNullable<JWordUiPluginExtension['menus']>[number]['items'][number]
}
