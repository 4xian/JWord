/**
 * 职责：声明固定 insecure-test-only JWL1 fixture token 的 TypeScript 类型。
 * 边界：只描述 fixture 常量，不引入运行时逻辑或签名能力。
 * 协作模块：browser examples 和 TypeScript 测试按 `.mjs` runtime 引用该声明。
 * 性能/安全约束：声明不得进入任何可发布 package。
 */

export const INSECURE_TEST_ONLY_JWL1_FIXTURE_TOKEN: string
