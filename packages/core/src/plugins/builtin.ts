/**
 * 职责：提供 core 内置插件命令，供 UI 包作为 Gate 7 Plugin API M5 内部消费者调用。
 * 边界：只注册基于现有 editor facade 的命令，不导入 UI 包，不增加新的文档 Operation。
 * 协作模块：PluginHost 负责 setup，editor facade 负责页面配置、事务与诊断边界。
 * 性能/安全约束：内置插件命令不访问 Y.Doc 或 document-store，仍通过公开 facade 修改 editor 状态。
 * Specs：docs/superpowers/plans/2026-07-06-gate7-plugin-api-m1-design.md#8-m2-m6-交付切分。
 */

import type { PagePreset } from '../layout/page-config'
import type { PluginCommandContext, PluginDefinition } from './types'

const PAGE_PRESETS = new Set<PagePreset>(['a3', 'a4', 'a5', 'letter'])

export const BUILTIN_PLUGIN_DEFINITIONS: readonly PluginDefinition[] = [{
  name: 'jword.ui',
  version: '0.0.0-internal',
  setup(context) {
    context.registerCommand({
      name: 'jword.ui.setPagePreset',
      execute(input, commandContext) {
        return executeSetPagePreset(input, commandContext)
      }
    })
  }
}]

/** 执行页面尺寸切换内置插件命令。 */
function executeSetPagePreset(input: unknown, context: PluginCommandContext) {
  const preset = readPagePresetInput(input)

  if (preset === null) {
    return context.reject('INVALID_PAGE_PRESET', '页面尺寸插件命令缺少有效 preset')
  }

  context.editor.setPageConfig({ preset })
}

/** 从插件命令输入中读取页面尺寸。 */
function readPagePresetInput(input: unknown): PagePreset | null {
  if (typeof input !== 'object' || input === null || !('preset' in input)) {
    return null
  }

  const preset = input.preset

  return typeof preset === 'string' && PAGE_PRESETS.has(preset as PagePreset)
    ? preset as PagePreset
    : null
}
