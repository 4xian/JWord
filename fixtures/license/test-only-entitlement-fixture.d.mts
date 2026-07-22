/**
 * 职责：声明消费包 test-only entitlement fixture 的 TypeScript 表面。
 * 边界：只描述测试输入，不扩展 License 公开类型或生产运行时。
 * 协作模块：DOCX、PDF、Collab 与架构测试通过对应 .mjs fixture 创建测试替身。
 * 性能/安全约束：声明不得进入任何可发布 package。
 */

import type { JWordLicenseEntitlement } from '../../packages/license/src/index.js'

export const TEST_ONLY_ENTITLEMENT_MARKER: string

/** 创建只供消费包业务测试使用的 entitlement 替身。 */
export function createTestOnlyJWordLicenseEntitlement(
  features: readonly string[],
  options?: Readonly<{ customerId?: string }>
): JWordLicenseEntitlement

/** 判断输入是否由隔离的消费包测试 seam 创建。 */
export function isTestOnlyJWordLicenseEntitlement(
  value: unknown
): value is JWordLicenseEntitlement
