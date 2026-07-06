/**
 * 职责：提供 Gate 4 第一版媒体 UI 的 URL allowlist 校验。
 * 边界：只校验 URL 输入，不访问 DOM、不发起网络请求，也不依赖 demo 宿主。
 * 协作模块：media controller 在 URL 提交前调用这里，浏览器测试与宿主策略通过公开类型对齐。
 * 性能/安全约束：默认不信任任意外部 URL，只在显式 allowlist 通过时接受 http/https。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#iteration-1---图片纵线step-41-43。
 */
import { DEFAULT_RESOURCE_URL_POLICY, isAllowedResourceUrl } from '@4xian/jword-core'

import type { JWordMediaUrlPolicy } from '../types'

/** 第一版图片 panel 的默认 URL 策略，兼容旧公开导出并复用 core 单一真源。 */
export const DEFAULT_JWORD_MEDIA_URL_POLICY = DEFAULT_RESOURCE_URL_POLICY

/** 按当前策略判断媒体 URL 是否允许进入上传/插入流程。 */
export function isAllowedJWordMediaUrl(url: string, policy: JWordMediaUrlPolicy = {}): boolean {
  return isAllowedResourceUrl(url, policy)
}
