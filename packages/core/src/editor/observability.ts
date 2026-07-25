/**
 * 职责：定义 Gate 7 R3 observability/telemetry 的最小公开契约与隐私裁剪工具。
 * 边界：只处理事件 schema、diagnostics export 快照和 JSON 兼容 details 裁剪，不访问文档 store、DOM 或网络。
 * 协作模块：EditorOptions、PluginHost、插件诊断和 SDK public API catalog。
 * 性能/安全约束：默认不发送 telemetry；导出快照和 telemetry 会裁剪所有插件私有字符串，避免正文内容外泄。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import type { DocumentLayout } from '../layout/runtime'
import { readAnchorRefSnapshot } from '../model/position'
import type { SelectionState } from '../model/selection'
import type { TransactionEvent } from '../operations/transaction'
import type { PluginDiagnostic, PluginDiagnosticCode } from '../plugins/types'
import type { JWordErrorDetails } from '../shared/errors'
import { JWORD_DIAGNOSTICS_REGISTRY_SUMMARY } from './diagnostics-registry'

export type JWordTelemetryEvent = JWordPluginDiagnosticTelemetryEvent

export type JWordTelemetrySink = (event: JWordTelemetryEvent) => void

export interface JWordTelemetryOptions {
  /** 宿主显式 opt-in 的 telemetry sink；未提供时不会发送任何 telemetry。 */
  readonly sink?: JWordTelemetrySink
}

export interface JWordPluginDiagnosticTelemetryEvent {
  /** telemetry 事件类型。 */
  readonly kind: 'plugin.diagnostic'
  /** 事件生成时间。 */
  readonly timestamp: string
  /** 产生诊断的插件名称。 */
  readonly pluginName: string
  /** 稳定诊断码。 */
  readonly code: PluginDiagnosticCode
  /** 诊断关联的插件生命周期或回调名称。 */
  readonly lifecycle?: PluginDiagnostic['lifecycle']
  /** 诊断关联的命令名称。 */
  readonly commandName?: string
  /** 插件拒绝命令时给出的业务原因。 */
  readonly reasonCode?: string
  /** 当前诊断是否可恢复。 */
  readonly recoverable: boolean
  /** 已裁剪的 JSON 兼容详情。 */
  readonly details?: JWordErrorDetails
}

export interface JWordDiagnosticsPrivacySummary {
  /** diagnostics export 是否包含文档正文。 */
  readonly contentIncluded: false
  /** 字符串值裁剪策略。 */
  readonly stringValues: 'redacted'
  /** 插件 details 对象 key 裁剪策略。 */
  readonly detailKeys: 'redacted'
}

export interface JWordDiagnosticsPackageVersion {
  /** package 名称。 */
  readonly name: string
  /** package 版本。 */
  readonly version: string
}

/** JWord diagnostics export 中用于描述公开 feature key 启用状态的裁剪摘要。 */
export interface JWordDiagnosticsFeatureFlag {
  /** 公开 feature key。 */
  readonly key: string
  /** 当前 feature 是否启用。 */
  readonly enabled: boolean
  /** feature key 来源。 */
  readonly source: 'core' | 'ui' | 'license' | 'collaboration' | 'format' | 'devtools'
}

export interface JWordDiagnosticsLicenseState {
  /** 当前 editor 侧授权摘要；core 未接入授权时固定为 not-configured。 */
  readonly status: 'not-configured' | 'valid' | 'denied' | 'expired' | 'unknown'
  /** 已知 feature key；不能包含 license token。 */
  readonly featureKeys: readonly string[]
}

export interface JWordDiagnosticsTransactionSummary {
  /** 最近一次 transaction 的 commandName。 */
  readonly commandName: string
  /** 最近一次 transaction 的 origin。 */
  readonly origin: string
  /** 最近一次 transaction 的 operation 数量。 */
  readonly operationCount: number
  /** 最近一次 transaction 的 operation kind 列表，不包含 operation payload。 */
  readonly operationKinds: readonly string[]
  /** 最近一次 transaction 是否修改文档。 */
  readonly dirty: boolean
  /** 最近一次 transaction 摘要生成时间。 */
  readonly timestamp: string
}

/** JWord diagnostics export 中用于描述 editor operation / transaction 活动的裁剪摘要。 */
export interface JWordDiagnosticsOperationSummary {
  /** 当前 editor 生命周期内已观察到的 transaction 数量。 */
  readonly transactionCount: number
  /** 最近一次 transaction 的裁剪摘要。 */
  readonly lastTransaction?: JWordDiagnosticsTransactionSummary
}

export interface JWordDiagnosticsLayoutMetrics {
  /** 当前 layout 页数。 */
  readonly pageCount: number
  /** 当前 layout 行数。 */
  readonly lineCount: number
  /** 当前 layout 块数。 */
  readonly blockCount: number
  /** 当前 layout 段落数。 */
  readonly paragraphCount: number
  /** 当前 layout 表格数。 */
  readonly tableCount: number
  /** 当前 debug overlay box 数。 */
  readonly debugBoxCount: number
}

export interface JWordDiagnosticsSelectionSummary {
  /** selection 状态。 */
  readonly status: 'none' | 'collapsed' | 'range'
  /** anchor 公开位置；不包含正文。 */
  readonly anchor?: JWordDiagnosticsTextPositionSummary
  /** focus 公开位置；不包含正文。 */
  readonly focus?: JWordDiagnosticsTextPositionSummary
}

export interface JWordDiagnosticsTextPositionSummary {
  /** section id。 */
  readonly sectionId: string
  /** block id。 */
  readonly blockId: string
  /** run id。 */
  readonly runId: string
  /** grapheme 边界。 */
  readonly graphemeIndex: number
}

export interface JWordDiagnosticsCollaborationSummary {
  /** 当前协同连接摘要；core 单机 editor 固定为 not-connected。 */
  readonly status: 'not-connected' | 'connected' | 'unknown'
  /** 公开协议版本；未知时省略。 */
  readonly protocolVersion?: string
  /** 最近握手摘要；不得包含 token。 */
  readonly handshake?: Readonly<Record<string, string | number | boolean>>
}

export interface JWordDiagnosticsServerSummary {
  /** self-host server 摘要；浏览器 editor 未接入时固定为 not-configured。 */
  readonly status: 'not-configured' | 'configured' | 'unknown'
  /** server package 版本；未知时省略。 */
  readonly version?: string
  /** health endpoint 摘要；不得包含 secret。 */
  readonly health?: Readonly<Record<string, string | number | boolean>>
}

export interface CreateJWordDiagnosticsSnapshotOptions {
  /** package 版本摘要。 */
  readonly packageVersions?: readonly JWordDiagnosticsPackageVersion[]
  /** feature flag 摘要。 */
  readonly featureFlags?: readonly JWordDiagnosticsFeatureFlag[]
  /** 授权状态摘要。 */
  readonly license?: JWordDiagnosticsLicenseState
  /** transaction 摘要。 */
  readonly operations?: JWordDiagnosticsOperationSummary
  /** layout 指标摘要。 */
  readonly layout?: JWordDiagnosticsLayoutMetrics
  /** selection 摘要。 */
  readonly selection?: JWordDiagnosticsSelectionSummary
  /** collab handshake 摘要。 */
  readonly collaboration?: JWordDiagnosticsCollaborationSummary
  /** self-host server 摘要。 */
  readonly server?: JWordDiagnosticsServerSummary
}

/** 对外导出的诊断快照载荷，已裁剪插件 message、details 和正文内容。 */
export interface JWordDiagnosticsSnapshot {
  /** 快照生成时间。 */
  readonly generatedAt: string
  /** 生成本次快照时采用的统一诊断 registry 摘要。 */
  readonly registry: typeof JWORD_DIAGNOSTICS_REGISTRY_SUMMARY
  /** 当前隐私裁剪摘要。 */
  readonly privacy: JWordDiagnosticsPrivacySummary
  /** package 版本摘要。 */
  readonly packageVersions: readonly JWordDiagnosticsPackageVersion[]
  /** feature flag 摘要。 */
  readonly featureFlags: readonly JWordDiagnosticsFeatureFlag[]
  /** 授权状态摘要，不包含 token 或 private key。 */
  readonly license: JWordDiagnosticsLicenseState
  /** operation 摘要，不包含 operation payload 或正文。 */
  readonly operations: JWordDiagnosticsOperationSummary
  /** layout/perf 指标摘要，不包含页面正文。 */
  readonly layout: JWordDiagnosticsLayoutMetrics
  /** selection/anchor 摘要，不包含正文。 */
  readonly selection: JWordDiagnosticsSelectionSummary
  /** collab/server handshake 摘要，不包含 token。 */
  readonly collaboration: JWordDiagnosticsCollaborationSummary
  /** self-host server 摘要，不包含 secret。 */
  readonly server: JWordDiagnosticsServerSummary
  /** 已裁剪的插件诊断列表。 */
  readonly plugins: readonly JWordDiagnosticsPluginEntry[]
}

export interface JWordDiagnosticsPluginEntry {
  /** 产生诊断的插件名称。 */
  readonly pluginName: string
  /** 稳定诊断码。 */
  readonly code: PluginDiagnosticCode
  /** 诊断关联的插件生命周期或回调名称。 */
  readonly lifecycle?: PluginDiagnostic['lifecycle']
  /** 诊断关联的命令名称。 */
  readonly commandName?: string
  /** 插件拒绝命令时给出的业务原因。 */
  readonly reasonCode?: string
  /** 当前诊断是否可恢复。 */
  readonly recoverable: boolean
  /** 已裁剪的 JSON 兼容详情。 */
  readonly details?: JWordErrorDetails
}

const CORE_PACKAGE_VERSION = '0.0.0'

const DEFAULT_PACKAGE_VERSIONS: readonly JWordDiagnosticsPackageVersion[] = Object.freeze([
  Object.freeze({ name: '@4xian/jword-core', version: CORE_PACKAGE_VERSION })
])

const DEFAULT_FEATURE_FLAGS: readonly JWordDiagnosticsFeatureFlag[] = Object.freeze([
  Object.freeze({ key: 'core.editor', enabled: true, source: 'core' }),
  Object.freeze({ key: 'diagnostics.export', enabled: true, source: 'core' })
])

const DEFAULT_LICENSE_STATE: JWordDiagnosticsLicenseState = Object.freeze({
  status: 'not-configured',
  featureKeys: Object.freeze([])
})

const DEFAULT_LAYOUT_METRICS: JWordDiagnosticsLayoutMetrics = Object.freeze({
  pageCount: 0,
  lineCount: 0,
  blockCount: 0,
  paragraphCount: 0,
  tableCount: 0,
  debugBoxCount: 0
})

const DEFAULT_SELECTION_SUMMARY: JWordDiagnosticsSelectionSummary = Object.freeze({
  status: 'none'
})

const DEFAULT_COLLABORATION_SUMMARY: JWordDiagnosticsCollaborationSummary = Object.freeze({
  status: 'not-connected'
})

const DEFAULT_SERVER_SUMMARY: JWordDiagnosticsServerSummary = Object.freeze({
  status: 'not-configured'
})

/** 创建空 operation 摘要。 */
export function createEmptyJWordOperationSummary(): JWordDiagnosticsOperationSummary {
  return { transactionCount: 0 }
}

/** 从 transaction 事件更新可公开的 operation 摘要。 */
export function createJWordOperationSummary(
  previous: JWordDiagnosticsOperationSummary,
  event: TransactionEvent
): JWordDiagnosticsOperationSummary {
  return {
    transactionCount: previous.transactionCount + 1,
    lastTransaction: {
      commandName: event.commandName,
      origin: event.origin,
      operationCount: event.operationKinds.length,
      operationKinds: event.operationKinds,
      dirty: event.dirty,
      timestamp: new Date().toISOString()
    }
  }
}

/** 从 layout 读取不含正文的指标摘要。 */
export function createJWordLayoutMetricsSummary(layout: DocumentLayout): JWordDiagnosticsLayoutMetrics {
  const blocks = layout.pages.flatMap((page) => page.blocks)

  return {
    pageCount: layout.pages.length,
    lineCount: layout.pages.reduce((total, page) => total + page.lines.length, 0),
    blockCount: blocks.length,
    paragraphCount: blocks.filter((block) => block.kind === 'paragraph').length,
    tableCount: blocks.filter((block) => block.kind === 'table').length,
    debugBoxCount: layout.debugOverlay.boxes.length
  }
}

/** 从 selection 读取不含正文的 anchor/focus 摘要。 */
export function createJWordSelectionSummary(selection: SelectionState | null): JWordDiagnosticsSelectionSummary {
  if (selection === null) {
    return DEFAULT_SELECTION_SUMMARY
  }

  const anchor = createTextPositionSummary(selection.anchor)
  const focus = createTextPositionSummary(selection.focus)

  return {
    status: isSameTextPosition(anchor, focus) ? 'collapsed' : 'range',
    anchor,
    focus
  }
}

/** 从插件诊断创建 telemetry 事件。 */
export function createPluginDiagnosticTelemetryEvent(diagnostic: PluginDiagnostic): JWordTelemetryEvent {
  return {
    kind: 'plugin.diagnostic',
    timestamp: new Date().toISOString(),
    ...createSafePluginDiagnosticEntry(diagnostic)
  }
}

/** 创建不包含正文内容的 diagnostics export 快照。 */
export function createJWordDiagnosticsSnapshot(
  pluginDiagnostics: readonly PluginDiagnostic[],
  options: CreateJWordDiagnosticsSnapshotOptions = {}
): JWordDiagnosticsSnapshot {
  return {
    generatedAt: new Date().toISOString(),
    registry: JWORD_DIAGNOSTICS_REGISTRY_SUMMARY,
    privacy: {
      contentIncluded: false,
      stringValues: 'redacted',
      detailKeys: 'redacted'
    },
    packageVersions: options.packageVersions ?? DEFAULT_PACKAGE_VERSIONS,
    featureFlags: options.featureFlags ?? DEFAULT_FEATURE_FLAGS,
    license: options.license ?? DEFAULT_LICENSE_STATE,
    operations: options.operations ?? createEmptyJWordOperationSummary(),
    layout: options.layout ?? DEFAULT_LAYOUT_METRICS,
    selection: options.selection ?? DEFAULT_SELECTION_SUMMARY,
    collaboration: options.collaboration ?? DEFAULT_COLLABORATION_SUMMARY,
    server: options.server ?? DEFAULT_SERVER_SUMMARY,
    plugins: pluginDiagnostics.map(createSafePluginDiagnosticEntry)
  }
}

/** 创建隐私裁剪后的插件诊断条目。 */
function createSafePluginDiagnosticEntry(diagnostic: PluginDiagnostic): JWordDiagnosticsPluginEntry {
  return {
    pluginName: diagnostic.pluginName,
    code: diagnostic.code,
    ...(diagnostic.lifecycle === undefined ? {} : { lifecycle: diagnostic.lifecycle }),
    ...(diagnostic.commandName === undefined ? {} : { commandName: diagnostic.commandName }),
    ...(diagnostic.reasonCode === undefined ? {} : { reasonCode: diagnostic.reasonCode }),
    recoverable: diagnostic.recoverable,
    ...(diagnostic.details === undefined ? {} : { details: redactErrorDetails(diagnostic.details) })
  }
}

/** 创建裁剪后的文本位置摘要。 */
function createTextPositionSummary(position: SelectionState['anchor']): JWordDiagnosticsTextPositionSummary {
  const snapshot = readAnchorRefSnapshot(position)

  return {
    sectionId: String(snapshot.sectionId),
    blockId: String(snapshot.blockId),
    runId: String(snapshot.runId),
    graphemeIndex: Number(snapshot.graphemeIndex)
  }
}

/** 判断两个裁剪位置是否指向同一文本边界。 */
function isSameTextPosition(
  left: JWordDiagnosticsTextPositionSummary,
  right: JWordDiagnosticsTextPositionSummary
): boolean {
  return left.sectionId === right.sectionId &&
    left.blockId === right.blockId &&
    left.runId === right.runId &&
    left.graphemeIndex === right.graphemeIndex
}

/** 裁剪 JSON 兼容 details，避免字符串值或对象 key 泄露正文。 */
function redactErrorDetails(details: JWordErrorDetails): JWordErrorDetails {
  if (typeof details === 'string') {
    return '[redacted]'
  }

  if (typeof details === 'number' || typeof details === 'boolean' || details === null) {
    return details
  }

  if (Array.isArray(details)) {
    return details.map(redactErrorDetails)
  }

  return Object.fromEntries(
    Object.values(details).map((value, index) => [`field${index}`, redactErrorDetails(value)])
  )
}
