/**
 * @vitest-environment node
 *
 * 职责：用小型算术测试锁定 Phase 2A 固定 native package 预算边界。
 * 边界：不构造大型 ZIP，不穿过公开 API，也不允许调用方修改预算。
 * 协作模块：packages/native/src/package-read-budget.ts。
 * 性能/安全约束：所有 exact / +1 断言只使用数字，不分配生产上限等量内存。
 * 实现说明：公开恶意输入行为继续由 public-api-security.test.ts 覆盖。
 */

import { describe, expect, it } from 'vitest'

import {
  JWORD_NATIVE_PACKAGE_LIMITS,
  assertNativePackageCompressionRatio,
  assertNativePackageLimit
} from '../src/package-read-budget'

describe('native package fixed budget arithmetic', () => {
  it.each(Object.entries(JWORD_NATIVE_PACKAGE_LIMITS))('accepts %s exact and rejects +1', (_name, limit) => {
    expect(() => assertNativePackageLimit(limit, limit)).not.toThrow()
    expect(() => assertNativePackageLimit(limit + 1, limit)).toThrowError(expect.objectContaining({
      code: 'JWORD_NATIVE_PACKAGE_RESOURCE_LIMIT_EXCEEDED'
    }))
  })

  it('enforces the 100:1 ratio only after the minimum output threshold', () => {
    const compressedBytes = 2 * 1024 * 1024 / JWORD_NATIVE_PACKAGE_LIMITS.compressionRatio

    expect(() => assertNativePackageCompressionRatio(2 * 1024 * 1024, compressedBytes)).not.toThrow()
    expect(() => assertNativePackageCompressionRatio(2 * 1024 * 1024 + 1, compressedBytes)).toThrowError(
      expect.objectContaining({ code: 'JWORD_NATIVE_PACKAGE_RESOURCE_LIMIT_EXCEEDED' })
    )
  })
})
