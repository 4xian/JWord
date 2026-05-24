/**
 * 职责：组合 editor runtime 分层并暴露 createEditor 工厂。
 * 边界：不放置大段输入、渲染、文档 helper 逻辑。
 * 协作模块：pointer/input/mounted/layout/facade runtime。
 * 性能/安全约束：constructor/top-level 不访问 window/document/HTMLElement 实例，DOM 只在 mount 后创建，编辑命令统一进入 transaction pipeline。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/03-architecture.md 与 04-engineering-standards.md#45-模块边界。
 */
import type { Editor, EditorOptions } from './types'
import { JWordEditorPointerRuntime } from './pointer-runtime'

class JWordEditor extends JWordEditorPointerRuntime implements Editor {}

export function createEditor(options?: EditorOptions): Editor {
  return new JWordEditor(options)
}

export type {
  Editor,
  EditorCommandOptions,
  EditorDocumentInput,
  EditorEvent,
  EditorEventListener,
  EditorFixture,
  EditorHitTestPoint,
  EditorOptions,
  EditorRichTextFragment,
  EditorRichTextParagraph,
  EditorRichTextRun,
  EditorTextAnchorInput,
  EditorUser,
  EditorUserInput,
  InitialFocusPosition
} from './types'
