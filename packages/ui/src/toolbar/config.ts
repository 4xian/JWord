/**
 * 职责：把宿主传入的 toolbar 配置规范化为稳定的显示顺序和 summary 开关。
 * 边界：不创建 DOM，不读写 editor，也不做命令分发。
 * 协作模块：create-ui/controller 先解析配置，再把结果交给 dom 和 state 层消费。
 * 性能/安全约束：只做小规模数组归一化，避免引入动态注册或复杂配置系统。
 * Specs：docs/superpowers/plans/2026-05-17-jword-ui-sdk-gate4-integration.md#62-建议的最小配置形状。
 */
import type { JWordToolbarOptions, JWordToolbarToolId } from '../types'
import { DEFAULT_VISIBLE_TOOL_IDS, isBuiltinToolId } from './builtin-tools'

/** 供内部消费的 toolbar 规范化结果。 */
export interface ResolvedToolbarConfig {
  readonly toolIds: readonly JWordToolbarToolId[]
  readonly showSummaries: boolean
}

/** 规范化宿主传入的 toolbar 配置。 */
export function resolveToolbarConfig(input?: JWordToolbarOptions): ResolvedToolbarConfig {
  const visibleTools = normalizeToolIds(input?.visibleTools)
  const hiddenTools = new Set(normalizeToolIds(input?.hiddenTools))
  const baseTools = visibleTools.length === 0 ? DEFAULT_VISIBLE_TOOL_IDS : visibleTools

  return {
    toolIds: baseTools.filter((toolId) => !hiddenTools.has(toolId)),
    showSummaries: input?.showSummaries !== false
  }
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
