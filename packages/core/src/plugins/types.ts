/**
 * 职责：定义 Gate 7 Plugin API M2 的 core 插件公开类型。
 * 边界：只声明插件契约，不保存插件状态，不触发 editor 事务。
 * 协作模块：编辑器门面、事务流水线、只读投影、选择区和布局运行时。
 * 性能/安全约束：插件只能通过公开 facade 与只读快照交互，不暴露 Y.Doc、document-store 或 DOM Range。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import type { DocumentLayout, LayoutRect } from '../layout/runtime'
import type { DocumentProjection } from '../model/projection'
import type { SelectionState } from '../model/selection'
import type { Command, TextRange, TransactionEvent, TransactionResult } from '../operations/transaction'
import type { JWordErrorDetails } from '../shared/errors'
import type { Editor, EditorCommandOptions } from '../editor/types'
import type { PluginAdapterRegistry } from './adapter-types'

export type PluginDiagnosticCode =
  | 'PLUGIN_CALLBACK_FAILED'
  | 'PLUGIN_ADAPTER_DUPLICATE'
  | 'PLUGIN_ADAPTER_FAILED'
  | 'PLUGIN_ADAPTER_UNAVAILABLE'
  | 'PLUGIN_COLLAB_PROVIDER_REJECTED'
  | 'PLUGIN_COMMAND_REJECTED'
  | 'PLUGIN_COMMAND_NOT_FOUND'
  | 'PLUGIN_COMMAND_DUPLICATE'
  | 'PLUGIN_EXPORT_REJECTED'
  | 'PLUGIN_IMPORT_REJECTED'

export interface PluginDiagnostic {
  /** 产生诊断的插件名称。 */
  readonly pluginName: string
  /** 稳定诊断码。 */
  readonly code: PluginDiagnosticCode
  /** 中文可读说明。 */
  readonly message: string
  /** 诊断关联的插件生命周期或回调名称。 */
  readonly lifecycle?: PluginLifecycleEventName | 'setup' | 'dispose' | 'command' | 'middleware' | 'keybinding' | 'decoration' | 'adapter' | undefined
  /** 诊断关联的命令名称。 */
  readonly commandName?: string | undefined
  /** 插件拒绝命令时给出的业务原因。 */
  readonly reasonCode?: string | undefined
  /** 当前诊断是否可恢复。 */
  readonly recoverable: boolean
  /** JSON 兼容诊断详情。 */
  readonly details?: JWordErrorDetails | undefined
}

export interface PluginDiagnosticInput {
  /** 稳定诊断码；未指定时使用 PLUGIN_CALLBACK_FAILED。 */
  readonly code?: PluginDiagnosticCode | undefined
  /** 中文可读说明。 */
  readonly message: string
  /** 诊断关联的插件生命周期或回调名称。 */
  readonly lifecycle?: PluginDiagnostic['lifecycle'] | undefined
  /** 诊断关联的命令名称。 */
  readonly commandName?: string | undefined
  /** 插件拒绝命令时给出的业务原因。 */
  readonly reasonCode?: string | undefined
  /** 当前诊断是否可恢复。 */
  readonly recoverable?: boolean | undefined
  /** JSON 兼容诊断详情。 */
  readonly details?: JWordErrorDetails | undefined
}

export interface PluginDiagnosticsReporter {
  /** 上报插件诊断并转发到 editor error 事件。 */
  report(input: PluginDiagnosticInput): void
}

export interface PluginDisposable {
  /** 释放插件注册的外部资源。 */
  dispose(): void
}

/** 单个 JWord 插件的公开注册声明。 */
export interface PluginDefinition {
  /** 稳定唯一插件名，建议使用 vendor.feature 形式。 */
  readonly name: string
  /** 插件版本，仅用于诊断与后续兼容策略。 */
  readonly version: string
  /** 注册插件命令、中间件、快捷键和生命周期监听器。 */
  readonly setup: (context: PluginContext) => void | PluginDisposable | readonly PluginDisposable[]
}

export interface PluginCommandDefinition<Input = unknown> {
  /** 插件命令名称，在当前 editor 实例内必须唯一。 */
  readonly name: string
  /** 执行插件命令，可返回现有 Command 或完整 TransactionResult。 */
  readonly execute: (input: Input, context: PluginCommandContext) => Command | TransactionResult | void
}

export interface PluginCommandContext {
  /** 当前 editor facade。 */
  readonly editor: Editor
  /** 当前插件名称。 */
  readonly pluginName: string
  /** 当前插件命令名称。 */
  readonly commandName: string
  /** 生成不会进入 transaction pipeline 的拒绝结果。 */
  reject(reasonCode: string, message: string, details?: JWordErrorDetails): TransactionResult
}

export interface PluginCommandMiddlewareInput {
  /** 本次将进入 transaction pipeline 的命令。 */
  readonly command: Command
  /** 本次命令的 facade 选项。 */
  readonly options: EditorCommandOptions
  /** 生成不会进入 transaction pipeline 的拒绝结果。 */
  readonly reject: (reasonCode: string, message: string, details?: JWordErrorDetails) => TransactionResult
}

export type PluginCommandNext = (input: PluginCommandMiddlewareInput) => TransactionResult
export type PluginCommandMiddleware = (input: PluginCommandMiddlewareInput, next: PluginCommandNext) => TransactionResult

export interface PluginKeyBindingDefinition {
  /** 平台无关快捷键字符串，例如 Mod-K 或 Shift-Mod-K。 */
  readonly key: string
  /** 命中的插件命令名称。 */
  readonly command: string
  /** 命令输入，会原样传给插件命令。 */
  readonly input?: unknown
  /** 只读上下文谓词；返回 false 时不触发命令。 */
  readonly when?: PluginKeyBindingPredicate
  /** 是否阻止浏览器默认行为，默认 true。 */
  readonly preventDefault?: boolean
}

export type PluginKeyBindingPredicate = (input: PluginKeyBindingContext) => boolean

export interface PluginKeyBindingContext {
  /** 归一化后的快捷键字符串。 */
  readonly key: string
  /** 原始 KeyboardEvent.key。 */
  readonly rawKey: string
  /** 是否按下 Shift。 */
  readonly shiftKey: boolean
  /** 是否按下 Alt。 */
  readonly altKey: boolean
  /** 是否按下 Ctrl。 */
  readonly ctrlKey: boolean
  /** 是否按下 Meta。 */
  readonly metaKey: boolean
  /** 当前只读 projection。 */
  readonly projection: DocumentProjection
  /** 当前选择区快照。 */
  readonly selection: SelectionState | null
  /** 当前 editor 是否已挂载。 */
  readonly mounted: boolean
}

export type PluginDecorationReadReason = 'mount' | 'document' | 'selection' | 'viewport' | 'resource'

export interface PluginDecorationReadInput {
  /** 当前只读 projection。 */
  readonly projection: DocumentProjection
  /** 当前只读 layout 快照。 */
  readonly layout: DocumentLayout
  /** 当前选择区快照。 */
  readonly selection: SelectionState | null
  /** 触发读取的渲染原因。 */
  readonly reason: PluginDecorationReadReason
}

export interface ExperimentalDecorationProvider {
  /** 当前插件内唯一的 provider 名称。 */
  readonly name: string
  /** 从只读快照读取 experimental decoration。 */
  readonly read: (input: PluginDecorationReadInput) => readonly PluginDecoration[]
}

export type PluginDecoration = PluginTextHighlightDecoration | PluginPageOverlayDecoration

export interface PluginTextHighlightDecoration {
  /** 文本范围高亮。 */
  readonly kind: 'textHighlight'
  /** 当前 provider 返回列表中的稳定 ID。 */
  readonly id: string
  /** 需要高亮的文本范围。 */
  readonly range: TextRange
  /** CSS 颜色；未指定时由 renderer 使用默认 experimental 高亮色。 */
  readonly color?: string
}

export interface PluginPageOverlayDecoration {
  /** 页面级 overlay marker。 */
  readonly kind: 'pageOverlay'
  /** 当前 provider 返回列表中的稳定 ID。 */
  readonly id: string
  /** 目标页号。 */
  readonly pageIndex: number
  /** 目标页内绝对 layout 矩形。 */
  readonly rect: LayoutRect
  /** CSS 颜色；未指定时由 renderer 使用默认 experimental marker 色。 */
  readonly color?: string
  /** 可选短标签。 */
  readonly label?: string
}

export type PluginResolvedDecoration = PluginResolvedTextHighlightDecoration | PluginResolvedPageOverlayDecoration

export interface PluginResolvedDecorationBase {
  /** 产生 decoration 的插件名。 */
  readonly pluginName: string
  /** 产生 decoration 的 provider 名。 */
  readonly providerName: string
  /** provider 返回的稳定 ID。 */
  readonly id: string
}

export interface PluginResolvedTextHighlightDecoration extends PluginResolvedDecorationBase {
  /** 已归一化的文本高亮矩形。 */
  readonly kind: 'textHighlight'
  /** 目标页号。 */
  readonly pageIndex: number
  /** 当前页内需要绘制的高亮矩形。 */
  readonly rects: readonly LayoutRect[]
  /** CSS 颜色；未指定时由 renderer 使用默认 experimental 高亮色。 */
  readonly color?: string
}

export interface PluginResolvedPageOverlayDecoration extends PluginResolvedDecorationBase {
  /** 已归一化的页面 overlay marker。 */
  readonly kind: 'pageOverlay'
  /** 目标页号。 */
  readonly pageIndex: number
  /** 目标页内绝对 layout 矩形。 */
  readonly rect: LayoutRect
  /** CSS 颜色；未指定时由 renderer 使用默认 experimental marker 色。 */
  readonly color?: string
  /** 可选短标签。 */
  readonly label?: string
}

export type PluginLifecycleEventName = 'mount' | 'destroy' | 'afterTransaction' | 'error'

export interface PluginLifecycleEventMap {
  readonly mount: PluginMountEvent
  readonly destroy: PluginDestroyEvent
  readonly afterTransaction: PluginAfterTransactionEvent
  readonly error: PluginErrorEvent
}

export type PluginLifecycleListener<EventName extends PluginLifecycleEventName> = (
  event: PluginLifecycleEventMap[EventName]
) => void

export interface PluginMountEvent {
  /** editor 挂载的宿主元素。 */
  readonly host: HTMLElement
  /** mount 完成后的只读 projection。 */
  readonly projection: DocumentProjection
  /** mount 完成后的只读布局快照。 */
  readonly layout: DocumentLayout
}

export interface PluginDestroyEvent {
  /** 销毁原因。 */
  readonly reason: 'editor.destroy'
  /** 销毁前已收集的插件诊断。 */
  readonly diagnostics: readonly PluginDiagnostic[]
}

export interface PluginAfterTransactionEvent {
  /** 已完成事务的公开事件载荷。 */
  readonly transaction: TransactionEvent
}

export interface PluginErrorEvent {
  /** 已被隔离的插件诊断。 */
  readonly diagnostic: PluginDiagnostic
}

export interface PluginContext {
  /** 当前插件名称。 */
  readonly name: string
  /** 当前插件版本。 */
  readonly version: string
  /** 当前 editor facade。 */
  readonly editor: Editor
  /** 注册和解析插件提供的外部 adapter。 */
  readonly adapters: PluginAdapterRegistry
  /** 注册可由快捷键或后续 UI 扩展调用的插件命令。 */
  registerCommand(command: PluginCommandDefinition): PluginDisposable
  /** 注册命令中间件。 */
  interceptCommand(middleware: PluginCommandMiddleware): PluginDisposable
  /** 注册插件快捷键。 */
  registerKeyBinding(binding: PluginKeyBindingDefinition): PluginDisposable
  /** 注册 experimental 只读装饰 provider。 */
  registerDecorationProvider(provider: ExperimentalDecorationProvider): PluginDisposable
  /** 监听插件生命周期事件。 */
  on<EventName extends PluginLifecycleEventName>(
    eventName: EventName,
    listener: PluginLifecycleListener<EventName>
  ): PluginDisposable
  /** 上报插件诊断。 */
  readonly diagnostics: PluginDiagnosticsReporter
}
