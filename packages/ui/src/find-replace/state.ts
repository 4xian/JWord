/**
 * 职责：定义 Gate 4 查找替换 UI 的最小纯状态。
 * 边界：只处理草稿归一化和按钮可用态，不访问 DOM、不保存 projection、不执行 editor 命令。
 * 协作模块：后续 find-replace controller 可消费这里的轻量状态。
 * 性能/安全约束：状态对象冻结后只读，避免 UI 层长期缓存查找结果详情。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md Step 4.12。
 */

export interface FindReplaceDraft {
  readonly query: string
  readonly replacement: string
}

export interface FindReplaceState extends FindReplaceDraft {
  readonly matchCount: number
  readonly activeIndex: number
}

/**
 * 创建查找替换 UI 纯状态。
 */
export function createFindReplaceState(input: FindReplaceState): FindReplaceState {
  const draft = normalizeFindReplaceDraft(input)

  return Object.freeze({
    query: draft.query,
    replacement: draft.replacement,
    matchCount: Math.max(0, input.matchCount),
    activeIndex: normalizeActiveIndex(input.activeIndex, input.matchCount)
  })
}

/**
 * 归一化查找替换草稿文本。
 */
export function normalizeFindReplaceDraft(input: FindReplaceDraft): FindReplaceDraft {
  return Object.freeze({
    query: input.query.trim(),
    replacement: input.replacement.trim()
  })
}

/**
 * 判断查找按钮是否应禁用。
 */
export function readFindDisabled(state: FindReplaceState): boolean {
  return state.query.length === 0
}

/**
 * 判断替换按钮是否应禁用。
 */
export function readReplaceDisabled(state: FindReplaceState): boolean {
  return readFindDisabled(state) || state.matchCount === 0 || state.activeIndex < 0
}

/**
 * 归一化当前激活结果下标。
 */
function normalizeActiveIndex(activeIndex: number, matchCount: number): number {
  if (matchCount <= 0) {
    return -1
  }

  return Math.min(Math.max(0, activeIndex), matchCount - 1)
}
