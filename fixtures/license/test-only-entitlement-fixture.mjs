/**
 * 职责：为消费包业务测试提供不模拟签名或 trust root 的 test-only entitlement 标记。
 * 边界：只被 Vitest 模块替换和兼容 runner 测试 loader 消费，不进入生产包或公开接口。
 * 协作模块：test-only-license-vitest-setup.ts 与 test-only-license-loader.mjs 识别同一标记。
 * 性能/安全约束：该对象必须被真实 License 入口拒绝，不得作为 JWL1/JWL2 token 或签名使用。
 */

export const TEST_ONLY_ENTITLEMENT_MARKER = 'jword-test-only-entitlement-seam-v1'

/** 创建只供消费包业务测试使用的 entitlement 替身。 */
export function createTestOnlyJWordLicenseEntitlement(features, options = {}) {
  return {
    customerId: options.customerId ?? 'customer-test-only-entitlement',
    licenseToken: TEST_ONLY_ENTITLEMENT_MARKER,
    features: [...features],
    issuer: 'jword-test-only-entitlement-seam',
    issuedAt: '2026-05-01T00:00:00Z',
    expiresAt: '2099-06-01T00:00:00Z',
    status: 'valid'
  }
}

/** 判断输入是否由隔离的消费包测试 seam 创建。 */
export function isTestOnlyJWordLicenseEntitlement(value) {
  return typeof value === 'object' &&
    value !== null &&
    (
      (
        value.issuer === 'jword-test-only-entitlement-seam' &&
        value.licenseToken === TEST_ONLY_ENTITLEMENT_MARKER
      ) ||
      value.signature === TEST_ONLY_ENTITLEMENT_MARKER
    )
}
