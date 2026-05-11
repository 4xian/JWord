/**
 * 职责：导出 @4xian/jword-core Gate 1 第一版公开 API。
 * 边界：只暴露 Editor facade、命令、投影和 opaque 位置类型，不导出内部 DOM 或可写 Yjs 容器。
 * 协作模块：examples、UI package、React/Vue wrapper 通过此入口消费 core。
 * 性能/安全约束：入口文件不访问 DOM，不产生副作用，保证 SSR/Node 可导入。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/04-engineering-standards.md#46-api-稳定性。
 */

export type {
  Editor,
  EditorCommandOptions,
  EditorDocumentInput,
  EditorEvent,
  EditorEventListener,
  EditorFixture,
  EditorOptions,
  EditorTextAnchorInput
} from './editor'
export { createEditor } from './editor'
export type { Document, Paragraph, Run, Section } from './model'
export type { AnchorRef, RangeRef } from './position'
export type { DocumentProjection } from './projection'
export type {
  Command,
  Operation,
  TransactionEvent,
  TransactionMetadata,
  TransactionResult
} from './transaction'
