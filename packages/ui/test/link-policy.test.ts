/**
 * @vitest-environment node
 *
 * 职责：锁定 link protocol allowlist 的纯函数契约。
 * 边界：只验证协议白名单，不碰 DOM、adapter 或 editor facade。
 * 协作模块：packages/ui/src/link/policy.ts。
 * 约束：默认只允许 http、https、mailto，拒绝危险或不受支持的协议。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import { describe, expect, test } from 'vitest'
import { isAllowedJWordLinkUrl } from '../src/link/policy'

describe('link policy', () => {
  test('只允许 http https mailto', () => {
    expect(isAllowedJWordLinkUrl('http://example.com')).toBe(true)
    expect(isAllowedJWordLinkUrl('https://example.com')).toBe(true)
    expect(isAllowedJWordLinkUrl('mailto:test@example.com')).toBe(true)
    expect(isAllowedJWordLinkUrl('javascript:alert(1)')).toBe(false)
    expect(isAllowedJWordLinkUrl('data:text/plain,hello')).toBe(false)
    expect(isAllowedJWordLinkUrl('file:///tmp/demo.txt')).toBe(false)
    expect(isAllowedJWordLinkUrl('not-a-url')).toBe(false)
  })
})
