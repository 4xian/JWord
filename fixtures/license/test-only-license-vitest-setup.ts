/**
 * 职责：在 Vitest 消费包测试中以模块替换隔离授权依赖。
 * 边界：只识别显式 test-only entitlement；其他输入完整委托真实 License 公开实现。
 * 协作模块：vitest.config.ts 注册本文件，消费包 fixture 创建隔离 entitlement。
 * 性能/安全约束：不得注入公钥、signer、trust replacement 或 allowInsecureFixtureLicense。
 */

import { vi } from 'vitest'

import { isTestOnlyJWordLicenseEntitlement } from './test-only-entitlement-fixture.mjs'

vi.mock('@4xian/jword-license', async (importOriginal) => {
  const productionLicense = await importOriginal<typeof import('../../packages/license/src/index.js')>()
  const assertTestEntitlement: typeof productionLicense.assertJWordFeatureEntitled = (
    entitlement,
    feature,
    options
  ) => {
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

  return {
    ...productionLicense,
    assertJWordFeatureEntitled: assertTestEntitlement
  }
})
