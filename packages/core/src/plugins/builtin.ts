/**
 * 职责：提供 core 内置插件命令，供 UI 包作为 Gate 7 Plugin API M5 内部消费者调用。
 * 边界：只注册基于现有 editor facade 的命令，不导入 UI 包，不增加新的文档 Operation。
 * 协作模块：PluginHost 负责 setup，editor facade 负责页面配置、事务与诊断边界。
 * 性能/安全约束：内置插件命令不访问 Y.Doc 或 document-store，仍通过公开 facade 修改 editor 状态。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import type { PagePreset } from '../layout/page-config'
import type { PluginCommandContext, PluginDefinition } from './types'

const PAGE_PRESETS = new Set<PagePreset>([
  'a3',
  'a4',
  'a5',
  'b5',
  'letter',
  'legal',
  'envelope3',
  'envelope5',
  'envelope6',
  'envelope7',
  'envelope9'
])

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
