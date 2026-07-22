/**
 * 职责：把兼容 runner 架构测试的 License 包与旧 fixture token 重定向到 test-only seam。
 * 边界：只通过测试进程 NODE_OPTIONS 注册，不影响普通 runner、构建或发布包解析。
 * 协作模块：gate5-compatibility-runner-helpers.ts 配置本 loader。
 * 性能/安全约束：只匹配两个精确模块，不修改其他解析结果或生产 trust。
 */

const testLicenseModuleUrl = new URL('./test-only-license-node-module.mjs', import.meta.url).href
const legacyFixtureUrl = new URL('./insecure-test-only-jwl1-fixture.mjs', import.meta.url).href
const testFixtureModuleUrl = new URL('./test-only-compatibility-runner-fixture.mjs', import.meta.url).href

/** 重定向兼容 runner 测试依赖的 License 与旧 fixture 模块。 */
export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@4xian/jword-license') {
    return {
      url: testLicenseModuleUrl,
      shortCircuit: true
    }
  }

  const resolved = await nextResolve(specifier, context)

  if (resolved.url === legacyFixtureUrl) {
    return {
      url: testFixtureModuleUrl,
      shortCircuit: true
    }
  }

  return resolved
}
