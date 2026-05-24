/**
 * 职责：定义 Gate 4.10 link panel 的内部状态与纯函数校验 helper。
 * 边界：只处理 draft、错误和确认按钮禁用规则，不访问 DOM，也不直接调用宿主 adapter。
 * 协作模块：link/controller 维护状态，link/dom 通过这些 helper 渲染 dialog。
 * 性能/安全约束：状态保持最小可序列化，不在 UI 层复制 editor 或 selection 对象。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md Step 4.10。
 */

import { isAllowedJWordLinkUrl } from './policy'
import type {
  JWordLinkDialogMode,
  JWordLinkDialogState,
  JWordLinkDraft,
  JWordLinkUrlPolicy
} from './types'

/** 把草稿字段裁剪为稳定的提交形状。 */
export function normalizeLinkDraft(draft: Partial<JWordLinkDraft>): JWordLinkDraft {
  return {
    visibleText: draft.visibleText?.trim() ?? '',
    url: draft.url?.trim() ?? '',
    tooltip: draft.tooltip?.trim() ?? ''
  }
}

/** 创建一份新的 dialog state。 */
export function createLinkDialogState(
  mode: JWordLinkDialogMode,
  draft: Partial<JWordLinkDraft> = {}
): JWordLinkDialogState {
  return {
    mode,
    draft: normalizeLinkDraft(draft),
    error: '',
    busy: false
  }
}

/** 读取当前草稿的纯校验错误。 */
export function readLinkValidationError(draft: JWordLinkDraft, policy: JWordLinkUrlPolicy = {}): string {
  if (draft.visibleText.length === 0) {
    return '请输入显示文本。'
  }

  if (draft.url.length === 0) {
    return '请输入链接地址。'
  }

  if (!isAllowedJWordLinkUrl(draft.url, policy)) {
    return '链接地址协议不受支持。'
  }

  return ''
}

/** 判断当前 dialog 是否应禁用确认按钮。 */
export function readLinkConfirmDisabled(state: JWordLinkDialogState, policy: JWordLinkUrlPolicy = {}): boolean {
  return state.busy || readLinkValidationError(state.draft, policy).length > 0
}
