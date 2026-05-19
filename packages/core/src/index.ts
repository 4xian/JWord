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
} from './canvas/pool'
export { createCanvasPool } from './canvas/pool'
export {
  renderPageCanvas,
  syncPageCanvases
} from './canvas/renderer'
export type {
  RenderPageInput,
  SyncPageCanvasesInput
} from './canvas/renderer'
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
} from './editor/runtime'
export { createEditor } from './editor/runtime'
export { JWordError } from './shared/errors'
export type { JWordErrorCode, JWordErrorDetails } from './shared/errors'
export {
  buildDeleteResourceCommand,
  buildDeleteSelectedImageCommand,
  buildInsertInlineImageCommand,
  buildMoveSelectedImageCommand,
  buildReplaceSelectedImageResourceCommand,
  buildResizeSelectedImageCommand,
  buildSetSelectedImageRotationCommand,
  buildSetBackgroundColorCommand,
  buildSetBoldCommand,
  buildSetFontFamilyCommand,
  buildSetFontSizeCommand,
  buildSetItalicCommand,
  buildSetParagraphAlignmentCommand,
  buildSetParagraphFirstLineIndentCommand,
  buildSetParagraphHangingIndentCommand,
  buildSetParagraphIndentCommand,
  buildSetParagraphLineHeightCommand,
  buildSetParagraphListCommand,
  buildSetParagraphSpacingAfterCommand,
  buildSetParagraphSpacingBeforeCommand,
  buildSetParagraphStyleCommand,
  buildSetStrikeCommand,
  buildSetSubscriptCommand,
  buildSetSuperscriptCommand,
  buildSetTextColorCommand,
  buildSetUnderlineCommand,
  buildUpsertResourceCommand,
  buildUpsertResourceCommandWithPolicy
} from './operations/command-builders'
export { createFontManager } from './layout/font-manager'
export type {
  FontAvailabilityStatus,
  FontCacheStats,
  FontManager,
  FontManagerOptions,
  ResolvedFontStyle,
  RunTextStyle,
  TextMeasurement
} from './layout/font-manager'
export type {
  HistoryEntryMetadata,
  HistoryOperationResult
} from './operations/history'
export { createSelectionFormattingState } from './model/formatting-state'
export { resolveSelectedImageTarget } from './model/image-target'
export type {
  FormattingStateValue,
  ParagraphAlignment,
  ParagraphFormattingState,
  RunFormattingState,
  SelectionFormattingState
} from './model/formatting-types'
export type { SelectedImageTarget } from './model/image-target'
export {
  getCaretRect,
  getSelectionRects,
  hitTestDocumentLayout,
  layoutDocument
} from './layout/runtime'
export type {
  DocumentLayout,
  InlineBox,
  LayoutBox,
  LayoutDebugBox,
  LayoutDebugOverlay,
  LayoutDirtyRange,
  LayoutInput,
  LayoutOptions,
  LayoutRect,
  LayoutViewport,
  LineBox,
  PageBox,
  ParagraphBox,
  TextFragment
} from './layout/runtime'
export { createLayoutSchedule } from './layout/scheduler'
export type { LayoutSchedule, LayoutScheduleInput } from './layout/scheduler'
export type { Block, Document, Paragraph, ParagraphList, Run, Section } from './model/types'
export type { ImageInline } from './model/types'
export {
  CSS_PX_PER_INCH,
  TWIPS_PER_INCH,
  createPageConfig,
  cssPxToTwips,
  twipsToCssPx
} from './layout/page-config'
export type { PageConfig, PageConfigInput, PageMargins, PageOrientation, PagePreset } from './layout/page-config'
export type { AnchorRef, RangeRef } from './model/position'
export type { DocumentProjection } from './model/projection'
export type {
  AbortSignalLike,
  Resource,
  ResourceAdapter,
  ResourceAdapterUploadOptions,
  ResourceAdapterUploadRequest,
  ResourceAdapterUploadResult,
  ResourceErrorState,
  ResourceMetadata,
  ResourceSource,
  ResourceStatus,
  ResourceUploadFile,
  ResourceUploadProgressEvent,
  ResourceUploadSource,
  ResourceUrlPolicy
} from './resources/types'
export {
  DEFAULT_RESOURCE_URL_POLICY,
  isAllowedResourceUrl
} from './resources/types'
export type { SelectionState } from './model/selection'
export { createSelectionState, isSelectionCollapsed } from './model/selection'
export type {
  Command,
  Operation,
  TextPosition,
  TextRange,
  TransactionEvent,
  TransactionMetadata,
  TransactionPipelineOptions,
  TransactionResult
} from './operations/transaction'
export { computeViewportPages } from './canvas/viewport-virtualizer'
export type { ViewportPages, ViewportPagesInput, VirtualizerPageBox } from './canvas/viewport-virtualizer'
