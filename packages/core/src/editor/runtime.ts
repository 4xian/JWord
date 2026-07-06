/**
 * 职责：组合 editor runtime 分层并暴露 createEditor 工厂。
 * 边界：不放置大段输入、渲染、文档 helper 逻辑。
 * 协作模块：pointer/input/mounted/layout/facade runtime。
 * 性能/安全约束：constructor/top-level 不访问 window/document/HTMLElement 实例，DOM 只在 mount 后创建，编辑命令统一进入 transaction pipeline。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/03-architecture.md 与 04-engineering-standards.md#45-模块边界。
 */
import type { Editor, EditorOptions } from './types'
import { JWordEditorCollaborationRuntime } from './collaboration-runtime'
import type { EditorInternalRuntimeOptions } from './state'

export class JWordEditor extends JWordEditorCollaborationRuntime implements Editor {
  /** 创建 Editor runtime，可由内部协同入口绑定共享文档。 */
  constructor(options?: EditorOptions, internalOptions?: EditorInternalRuntimeOptions) {
    super(options, internalOptions)
    this.initializePluginHost(this)
  }
}

/** 创建无框架依赖的 JWord editor facade。 */
export function createEditor(options?: EditorOptions): Editor {
  return new JWordEditor(options)
}

export type {
  Editor,
  EditorCommandOptions,
  EditorSyncUpdateInput,
  EditorDocumentInput,
  EditorDocumentModelInput,
  EditorEvent,
  EditorEventListener,
  EditorFixture,
  EditorHitTestPoint,
  EditorOptions,
  EditorApplyUpdateOptions,
  EditorRichTextFragment,
  EditorRichTextParagraph,
  EditorRichTextRun,
  EditorTextAnchorInput,
  EditorUser,
  EditorUserInput,
  HistoryScope,
  InitialFocusPosition
} from './types'
export type {
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
} from '../plugins/types'
export type {
  EditorAnchorSnapshot,
  EditorLocationQuery,
  EditorLocationTarget,
  EditorRangeSnapshot,
  EditorRangeSnapshotInput,
  EditorResolvedLocation,
  EditorScrollToLocationOptions,
  EditorSelectionSnapshot,
  EditorTextLocation,
  EditorTextQueryResult
} from './location-types'
export type {
  JWordDiagnosticsPluginEntry,
  JWordDiagnosticsPrivacySummary,
  JWordDiagnosticsSnapshot,
  JWordPluginDiagnosticTelemetryEvent,
  JWordTelemetryEvent,
  JWordTelemetryOptions,
  JWordTelemetrySink
} from './observability'
