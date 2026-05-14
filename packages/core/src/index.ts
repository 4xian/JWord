/**
 * 职责：导出 @4xian/jword-core Gate 1/2 第一版公开 API。
 * 边界：暴露 Editor facade、命令、投影、opaque 位置、分页 layout 和 canvas render 入口，不导出可写 Yjs 容器。
 * 协作模块：examples、UI package、React/Vue wrapper 通过此入口消费 core。
 * 性能/安全约束：入口文件不访问 DOM，不产生副作用，保证 SSR/Node 可导入。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/04-engineering-standards.md#46-api-稳定性。
 */

export type {
  CanvasLike,
  CanvasPool,
  CanvasPoolOptions,
  CanvasRenderingContextLike
} from './canvas-pool'
export { createCanvasPool } from './canvas-pool'
export {
  renderPageCanvas,
  syncPageCanvases
} from './canvas-renderer'
export type {
  RenderPageInput,
  SyncPageCanvasesInput
} from './canvas-renderer'
export type {
  Editor,
  EditorCommandOptions,
  EditorDocumentInput,
  EditorEvent,
  EditorEventListener,
  EditorFixture,
  EditorHitTestPoint,
  EditorOptions,
  EditorTextAnchorInput
} from './editor'
export { createEditor } from './editor'
export { JWordError } from './errors'
export type { JWordErrorCode, JWordErrorDetails } from './errors'
export {
  buildSetBackgroundColorCommand,
  buildSetBoldCommand,
  buildSetFontFamilyCommand,
  buildSetFontSizeCommand,
  buildSetItalicCommand,
  buildSetParagraphAlignmentCommand,
  buildSetParagraphIndentCommand,
  buildSetStrikeCommand,
  buildSetTextColorCommand,
  buildSetUnderlineCommand
} from './command-builders'
export { createFontManager } from './font-manager'
export type {
  FontAvailabilityStatus,
  FontCacheStats,
  FontManager,
  FontManagerOptions,
  ResolvedFontStyle,
  RunTextStyle,
  TextMeasurement
} from './font-manager'
export type {
  HistoryEntryMetadata,
  HistoryOperationResult
} from './history'
export { createSelectionFormattingState } from './formatting-state'
export type {
  FormattingStateValue,
  ParagraphAlignment,
  ParagraphFormattingState,
  RunFormattingState,
  SelectionFormattingState
} from './formatting-types'
export {
  getCaretRect,
  getSelectionRects,
  hitTestDocumentLayout,
  layoutDocument
} from './layout'
export type {
  DocumentLayout,
  InlineBox,
  LayoutBox,
  LayoutDebugBox,
  LayoutDebugOverlay,
  LayoutDirtyRange,
  LayoutInput,
  LayoutRect,
  LayoutViewport,
  LineBox,
  PageBox,
  ParagraphBox,
  TextFragment
} from './layout'
export { createLayoutSchedule } from './layout-scheduler'
export type { LayoutSchedule, LayoutScheduleInput } from './layout-scheduler'
export type { Block, Document, Paragraph, Run, Section } from './model'
export {
  CSS_PX_PER_INCH,
  TWIPS_PER_INCH,
  createPageConfig,
  cssPxToTwips,
  twipsToCssPx
} from './page-config'
export type { PageConfig, PageConfigInput, PageMargins, PageOrientation, PagePreset } from './page-config'
export type { AnchorRef, RangeRef } from './position'
export type { DocumentProjection } from './projection'
export type { SelectionState } from './selection'
export type {
  Command,
  Operation,
  TextPosition,
  TextRange,
  TransactionEvent,
  TransactionMetadata,
  TransactionResult
} from './transaction'
export { computeViewportPages } from './viewport-virtualizer'
export type { ViewportPages, ViewportPagesInput, VirtualizerPageBox } from './viewport-virtualizer'
