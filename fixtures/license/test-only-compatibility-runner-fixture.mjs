/**
 * 职责：把兼容 runner 的旧 fixture import 映射为 test-only entitlement 标记。
 * 边界：只由 test-only loader 解析，不替换磁盘上的旧 JWL1 fixture 或生产行为。
 * 协作模块：test-only-license-loader.mjs 将 runner 的精确 fixture URL 重定向到本文件。
 * 性能/安全约束：只导出 runner 已消费的单一常量，不提供 signer 或 trust material。
 */

export {
  TEST_ONLY_ENTITLEMENT_MARKER as INSECURE_TEST_ONLY_JWL1_FIXTURE_TOKEN
} from './test-only-entitlement-fixture.mjs'
