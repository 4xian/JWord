/**
 * 职责：声明 UI 包内部消费的 Gate 7 插件扩展，用于验证插件 toolbar/menu API 形状。
 * 边界：只生成插件 UI 配置，不直接操作 DOM，不执行 editor 命令。
 * 协作模块：toolbar controller 合并内部/外部扩展，core 内置 `jword.ui` 插件执行实际命令。
 * 性能/安全约束：状态谓词只读取 PageConfig，不触发布局；内置工具保持独立插件运行时键。
 * Specs：docs/superpowers/plans/2026-07-06-gate7-plugin-api-m1-design.md#8-m2-m6-交付切分。
 */

import type { PagePreset } from '@4xian/jword-core'

import type { JWordToolbarOptions, JWordUiPluginExtension } from '../types'
import type { ResolvedToolbarConfig } from './config'
import { readPagePresetAnnouncement } from './state'

interface ResolveToolbarPluginExtensionsOptions {
  readonly toolbar: false | JWordToolbarOptions | undefined
  readonly toolbarHidden: boolean
  readonly toolbarConfig: ResolvedToolbarConfig
  readonly externalExtensions: readonly JWordUiPluginExtension[] | undefined
}

const PAGE_PRESET_PLUGIN_EXTENSION: JWordUiPluginExtension = {
  pluginName: 'jword.ui',
  menus: [{
    name: 'pagePreset',
    label: '页面',
    ariaLabel: '页面尺寸',
    tooltip: '页面尺寸',
    items: [
      createPagePresetAction('a3', 'A3'),
      createPagePresetAction('a4', 'A4'),
      createPagePresetAction('a5', 'A5'),
      createPagePresetAction('letter', 'Letter')
    ]
  }]
}

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
    ? [PAGE_PRESET_PLUGIN_EXTENSION]
    : []
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
function createPagePresetAction(preset: PagePreset, label: string) {
  return {
    name: preset,
    label,
    commandName: 'jword.ui.setPagePreset',
    input: { preset },
    active: (context) => context.editor.getPageConfig().preset === preset,
    announce: (context) => readPagePresetAnnouncement(preset, context.editor.getPageConfig())
  } satisfies NonNullable<JWordUiPluginExtension['menus']>[number]['items'][number]
}
