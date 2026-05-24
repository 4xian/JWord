/**
 * 职责：提供 link protocol allowlist 校验。
 * 边界：只校验输入 URL 的协议，不访问 DOM、不调用 adapter、不依赖宿主。
 * 协作模块：link state 与 controller 在提交前调用这里判断是否允许。
 * 约束：默认只允许 http、https、mailto，拒绝 javascript、data、file。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md Iteration 3。
 */

import type { JWordLinkUrlPolicy } from './types'

/** 默认允许的 link 协议。 */
export const DEFAULT_JWORD_LINK_PROTOCOL_ALLOWLIST = Object.freeze({
  http: true,
  https: true,
  mailto: true
})

/** 判断当前 URL 是否允许进入 link 流程。 */
export function isAllowedJWordLinkUrl(url: string, policy: JWordLinkUrlPolicy = {}): boolean {
  let parsedUrl: URL

  try {
    parsedUrl = new URL(url)
  } catch {
    return false
  }

  const allowedProtocols = policy.allowedProtocols ?? Object.keys(DEFAULT_JWORD_LINK_PROTOCOL_ALLOWLIST)
  const normalizedProtocol = parsedUrl.protocol.endsWith(':')
    ? parsedUrl.protocol.slice(0, -1)
    : parsedUrl.protocol

  return allowedProtocols.includes(normalizedProtocol)
}
