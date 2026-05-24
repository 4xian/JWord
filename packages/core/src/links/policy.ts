/**
 * 职责：定义超链接 target 的最小 protocol allowlist。
 * 边界：只做纯字符串校验，不打开链接、不依赖浏览器宿主，也不处理 UI 文案。
 * 协作模块：command builder、operation adapter 和后续 UI 链接弹窗复用同一安全判断。
 * 性能/安全约束：默认只允许显式安全协议；拒绝 javascript/data/file 等危险协议。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#iteration-3---批注与超链接step-48-410。
 */

const DEFAULT_ALLOWED_LINK_PROTOCOLS = new Set([
  'http:',
  'https:',
  'mailto:'
])

/**
 * 判断超链接 target 是否在默认 allowlist 内。
 */
export function isAllowedLinkUrl(url: string): boolean {
  const normalized = url.trim()

  if (normalized.length === 0) {
    return false
  }

  let parsedUrl: URL

  try {
    parsedUrl = new URL(normalized)
  } catch {
    return false
  }

  return DEFAULT_ALLOWED_LINK_PROTOCOLS.has(parsedUrl.protocol)
}
