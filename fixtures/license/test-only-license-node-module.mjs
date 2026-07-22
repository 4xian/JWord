/**
 * 职责：为兼容 runner 子进程提供与 Vitest 相同的 test-only License 模块替身。
 * 边界：只由 test-only loader 重定向，不修改生产 dist、package export 或 runner 源码。
 * 协作模块：test-only-license-loader.mjs 与兼容 runner 架构测试共同使用。
 * 性能/安全约束：未命中显式标记的输入必须委托真实 License dist 实现。
 */

import * as productionLicense from '../../packages/license/dist/index.js'
import { isTestOnlyJWordLicenseEntitlement } from './test-only-entitlement-fixture.mjs'

export * from '../../packages/license/dist/index.js'

/** 在兼容 runner 测试进程中断言显式 test-only entitlement。 */
export function assertJWordFeatureEntitled(entitlement, feature, options) {
  if (!isTestOnlyJWordLicenseEntitlement(entitlement)) {
    return productionLicense.assertJWordFeatureEntitled(entitlement, feature, options)
  }

  if (!entitlement.features.includes(feature)) {
    throw productionLicense.createJWordLicenseError('JWORD_FEATURE_NOT_ENTITLED', feature)
  }

  return {
    ok: true,
    feature,
    customerId: entitlement.customerId,
    offlineGrace: false
  }
}
