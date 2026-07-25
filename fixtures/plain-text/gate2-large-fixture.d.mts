/**
 * 职责：为 Phase 4 大文档 fixture helper 提供 TypeScript 类型声明。
 * 边界：只描述生成函数和稳定基线常量，不引入 runtime 逻辑。
 * 协作模块：benchmarks、Node 测试和后续浏览器 perf e2e。
 * 约束：保持与 gate2-large-fixture.mjs 的最小 API 一致。
 */

export const GATE2_LARGE_PARAGRAPH_COUNT: 4600
export const GATE2_LARGE_EXPECTED_PAGE_COUNT: 200
export const GATE2_LARGE_MIN_CHARACTER_COUNT: 100000

export function createGate2LargeFixtureParagraphs(): readonly string[]
export function createGate2LargeFixtureEditorText(): string
