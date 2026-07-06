/**
 * 职责：定义 Gate 7 R3 observability/telemetry 的最小公开契约与隐私裁剪工具。
 * 边界：只处理事件 schema、diagnostics export 快照和 JSON 兼容 details 裁剪，不访问文档 store、DOM 或网络。
 * 协作模块：EditorOptions、PluginHost、插件诊断和 SDK public API catalog。
 * 性能/安全约束：默认不发送 telemetry；导出快照和 telemetry 会裁剪所有插件私有字符串，避免正文内容外泄。
 * Specs：docs/superpowers/plans/2026-07-06-gate7-observability-telemetry-design.md。
 */

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

/** 对外导出的诊断快照载荷，已裁剪插件 message、details 和正文内容。 */
export interface JWordDiagnosticsSnapshot {
  /** 快照生成时间。 */
  readonly generatedAt: string
  /** 生成本次快照时采用的统一诊断 registry 摘要。 */
  readonly registry: typeof JWORD_DIAGNOSTICS_REGISTRY_SUMMARY
  /** 当前隐私裁剪摘要。 */
  readonly privacy: JWordDiagnosticsPrivacySummary
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
  pluginDiagnostics: readonly PluginDiagnostic[]
): JWordDiagnosticsSnapshot {
  return {
    generatedAt: new Date().toISOString(),
    registry: JWORD_DIAGNOSTICS_REGISTRY_SUMMARY,
    privacy: {
      contentIncluded: false,
      stringValues: 'redacted',
      detailKeys: 'redacted'
    },
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
