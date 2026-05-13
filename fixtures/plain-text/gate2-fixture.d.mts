/**
 * 职责：为 Gate 2 纯文本 fixture 共享 helper 提供 TypeScript 类型声明。
 * 边界：只描述文本输入和输出，不引入 runtime 逻辑。
 * 协作模块：examples/vanilla、benchmarks、visual 工具和 Node 测试。
 * 约束：保持与 gate2-fixture.mjs 的最小 API 一致。
 */

export function splitGate2FixtureParagraphs(text: string): readonly string[]
export function createGate2FixtureEditorText(text: string): string
