/**
 * 职责：导出 @4xian/jword-core Gate 0 公开 API。
 * 边界：只暴露最小 Editor facade，不导出内部 DOM 实现或未来 Gate 1 类型。
 * 协作模块：examples、UI package、React/Vue wrapper 通过此入口消费 core。
 * 性能/安全约束：入口文件不访问 DOM，不产生副作用，保证 SSR/Node 可导入。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/04-engineering-standards.md#46-api-稳定性。
 */

export type { Editor, EditorOptions } from './editor'
export { createEditor } from './editor'
