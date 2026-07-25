/**
 * 职责：复用 native 恶意 package 在公开 validate/load seam 上的稳定诊断断言。
 * 边界：只供测试导入，不进入 package exports、dist 或正式 tarball。
 * 协作模块：public-api-security.test.ts 与 zip-preflight-security.test.ts。
 * 性能/安全约束：不读取内部 reader/helper，也不保留输入引用。
 * 实现说明：每次断言同时覆盖 validate 返回与 load 抛错。
 */

import { expect } from 'vitest'

import {
  loadJWordDocument,
  validateJWordPackage,
  type JWordPackageErrorCode
} from '../src/index'

/** 断言恶意 package 在 validate/load 两个公开 seam 上返回同一稳定 code。 */
export async function expectPublicPackageCode(
  input: Uint8Array,
  code: JWordPackageErrorCode
): Promise<void> {
  const validation = await validateJWordPackage(input)

  expect(validation.valid).toBe(false)
  expect(validation.diagnostics).toHaveLength(1)
  expect(validation.diagnostics[0]?.code).toBe(code)
  await expect(loadJWordDocument(input)).rejects.toMatchObject({ code })
}
