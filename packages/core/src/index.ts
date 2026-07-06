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
  EditorSyncUpdateInput,
  EditorDocumentInput,
  EditorEvent,
  EditorEventListener,
  EditorFixture,
  EditorHitTestPoint,
  EditorAnchorSnapshot,
  EditorLocationQuery,
  EditorLocationTarget,
  EditorOptions,
  EditorRangeSnapshot,
  EditorRangeSnapshotInput,
  EditorResolvedLocation,
  EditorScrollToLocationOptions,
  JWordDiagnosticsPluginEntry,
  JWordDiagnosticsPrivacySummary,
  JWordDiagnosticsSnapshot,
  JWordPluginDiagnosticTelemetryEvent,
  JWordTelemetryEvent,
  JWordTelemetryOptions,
  JWordTelemetrySink,
  EditorApplyUpdateOptions,
  EditorRichTextFragment,
  EditorRichTextParagraph,
  EditorRichTextRun,
  EditorSelectionSnapshot,
  EditorTextAnchorInput,
  EditorTextLocation,
  EditorTextQueryResult,
  EditorUser,
  EditorUserInput,
  HistoryScope,
  InitialFocusPosition,
  PluginCommandContext,
  PluginCommandDefinition,
  PluginCommandMiddleware,
  PluginCommandMiddlewareInput,
  PluginCommandNext,
  PluginContext,
  PluginDecoration,
  PluginDecorationReadInput,
  PluginDecorationReadReason,
  PluginDefinition,
  PluginDiagnostic,
  PluginDiagnosticCode,
  PluginDiagnosticInput,
  PluginDiagnosticsReporter,
  PluginDisposable,
  PluginPageOverlayDecoration,
  PluginResolvedDecoration,
  PluginResolvedPageOverlayDecoration,
  PluginResolvedTextHighlightDecoration,
  PluginTextHighlightDecoration,
  ExperimentalDecorationProvider,
  PluginKeyBindingContext,
  PluginKeyBindingDefinition,
  PluginKeyBindingPredicate,
  PluginLifecycleEventMap,
  PluginLifecycleEventName,
  PluginLifecycleListener
} from './editor/runtime'
export { createEditor } from './editor/runtime'
export { createTextInserter } from './collaboration/inserter'
export type {
  TextInserter,
  TextInserterError,
  TextInserterErrorCode,
  TextInserterErrorEvent,
  TextInserterFlushPolicy,
  TextInserterMode,
  TextInserterOptions,
  TextInserterProgressEvent,
  TextInserterProgressPhase,
  TextInserterRetryInput,
  TextInserterUndoScope
} from './collaboration/inserter'
export {
  createEditorSharedDocument,
  createEditorWithSharedDocument,
  readEditorSharedDocument,
  refreshEditorSharedDocument
} from './editor/collaboration-document'
export type {
  EditorSharedDocument,
  EditorSharedDocumentRefreshInput
} from './editor/collaboration-document'
export { JWordError } from './shared/errors'
export type { JWordErrorCode, JWordErrorDetails } from './shared/errors'
export { countGraphemes, splitGraphemes } from './shared/grapheme'
export {
  buildDeleteResourceCommand,
  buildDeleteSelectedImageCommand,
  buildDeleteTableColumnCommand,
  buildDeleteTableRowCommand,
  buildInsertInlineImageCommand,
  buildInsertTableColumnCommand,
  buildInsertTableCommand,
  buildInsertTableRowCommand,
  buildMergeTableCellsCommand,
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
  buildSetTableBorderCommand,
  buildSetTableColumnWidthCommand,
  buildSetTableCellBorderCommand,
  buildSetTableCellTextCommand,
  buildSetTableRowHeightCommand,
  buildSetTextColorCommand,
  buildSetUnderlineCommand,
  buildUpsertResourceCommand,
  buildUpsertResourceCommandWithPolicy
} from './operations/command-builders'
export {
  buildAddCommentThreadCommand,
  buildDeleteCommentThreadCommand,
  buildEditCommentMessageCommand,
  buildReopenCommentThreadCommand,
  buildReplyCommentThreadCommand,
  buildResolveCommentThreadCommand
} from './operations/comment-command-builders'
export {
  buildDeleteLinkCommand,
  buildEditLinkCommand,
  buildInsertLinkCommand,
  buildSetLinkCommand
} from './operations/link-command-builders'
export {
  buildAcceptRevisionCommand,
  buildAddRevisionMetadataCommand,
  buildRejectRevisionCommand
} from './operations/revision-command-builders'
export type { AddRevisionMetadataInput } from './operations/revision-command-builders'
export { buildSetSectionPropertiesCommand } from './operations/section-command-builders'
export type { SectionPropertiesInput } from './operations/section-command-builders'
export {
  buildHeadingOutline,
  locateHeadingOutlineItem
} from './heading/outline'
export type { HeadingOutlineItem } from './heading/outline'
export {
  buildReplaceMatchCommand,
  findTextMatches,
  replaceAllMatches
} from './find-replace/find-replace'
export type {
  FindTextOptions,
  FindTextMatch,
  ReplaceAllMatchesResult
} from './find-replace/find-replace'
export { isAllowedLinkUrl } from './link/policy'
export {
  SCRIPT_FONT_SCALE,
  SUBSCRIPT_BASELINE_SHIFT_RATIO,
  SUPERSCRIPT_BASELINE_SHIFT_RATIO,
  createCanvasTextMeasurer,
  createFontManager
} from './layout/font-manager'
export type {
  CanvasTextMeasurerContext,
  CanvasTextMetricsLike,
  FontAvailabilityStatus,
  FontCacheStats,
  FontManager,
  FontManagerOptions,
  ResolvedFontStyle,
  RunTextStyle,
  TextMeasurement,
  TextMeasurementMetrics,
  TextMeasurer
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
export type {
  Block,
  Comment,
  CommentMessage,
  CommentThread,
  Document,
  Paragraph,
  ParagraphList,
  RevisionMetadata,
  Run,
  Section,
  Table,
  TableBorder,
  TableCell,
  TableRow
} from './model/types'
export type { ImageInline } from './model/types'
export {
  CSS_PX_PER_INCH,
  TWIPS_PER_INCH,
  createPageConfig,
  cssPxToTwips,
  twipsToCssPx
} from './layout/page-config'
export type { PageConfig, PageConfigInput, PageMargins, PageOrientation, PagePreset } from './layout/page-config'
export { createRangeRef } from './model/position'
export type { AnchorRef, RangeRef } from './model/position'
export { createDocumentProjection } from './model/projection'
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
  TransactionDiagnostic,
  TransactionDiagnosticSource,
  TransactionMetadata,
  TransactionPipelineOptions,
  TransactionResult
} from './operations/transaction'
export { computeViewportPages } from './canvas/viewport-virtualizer'
export type { ViewportPages, ViewportPagesInput, VirtualizerPageBox } from './canvas/viewport-virtualizer'
