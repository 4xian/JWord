/**
 * 职责：定义 Gate 7 Plugin adapter registry 的公开类型。
 * 边界：只描述插件 adapter 注册、解析和 descriptor 形状，不执行 adapter，不依赖付费包实现。
 * 协作模块：PluginContext、PluginHost、resources、后续 persistence/docx/pdf/collab package helper 通过这些类型对齐。
 * 性能/安全约束：descriptor 只保存结构化 metadata 和回调，不暴露 Y.Doc、provider、worker runtime 或 DOM 对象。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import type { AbortSignalLike, ResourceAdapter } from '../resources/types'
import type { PluginDiagnostic, PluginDisposable } from './types'

/** Plugin adapter registry 支持的 slot 类型。 */
export type PluginAdapterKind = 'resource' | 'persistence' | 'import' | 'export' | 'collabProvider'

/** Plugin adapter 执行时由宿主传入的通用选项。 */
export interface PluginAdapterExecuteOptions {
  /** 宿主取消信号；取消不应被记录为不可恢复错误。 */
  readonly signal?: AbortSignal | AbortSignalLike
  /** 宿主生成的请求 ID，用于 diagnostics 与日志关联。 */
  readonly requestId?: string
  /** package 专有进度事件透传。 */
  readonly onProgress?: (event: unknown) => void
  /** package 专有授权载荷；core 不解释该对象。 */
  readonly license?: unknown
  /** package 专有 metadata；core 不解释该对象。 */
  readonly metadata?: Readonly<Record<string, unknown>>
}

/** Plugin adapter descriptor 持有的惰性执行回调。 */
export type PluginAdapterExecute<Input = unknown, Result = unknown> = (
  input: Input,
  options?: PluginAdapterExecuteOptions
) => Result | undefined | Promise<Result | undefined>

/** 注册 adapter 时附带的公开 metadata。 */
export interface PluginAdapterRegisterOptions {
  /** 当前 slot 内稳定 adapter 名称。 */
  readonly name?: string
  /** adapter 对应的收费或能力 feature key。 */
  readonly featureKey?: string
  /** diagnostics 来源，例如 core、docx、pdf、persistence 或 collab。 */
  readonly diagnosticsSource?: string
}

/** 解析 adapter 时使用的过滤条件。 */
export interface PluginAdapterResolveOptions {
  /** 指定 adapter 名称；未指定时取当前 slot 的第一个候选。 */
  readonly name?: string
  /** 指定 feature key；未指定时不按 feature 过滤。 */
  readonly featureKey?: string
}

/** Plugin adapter registry 中的一条只读注册记录。 */
export interface PluginAdapterRegistration<Adapter> {
  /** 注册该 adapter 的插件名称。 */
  readonly pluginName: string
  /** adapter 类型。 */
  readonly kind: PluginAdapterKind
  /** 当前 slot 内稳定 adapter 名称。 */
  readonly name: string
  /** adapter 对应的收费或能力 feature key。 */
  readonly featureKey?: string
  /** diagnostics 来源，例如 core、docx、pdf、persistence 或 collab。 */
  readonly diagnosticsSource?: string
  /** 原始 adapter 或 descriptor。 */
  readonly adapter: Adapter
}

/** Plugin adapter 解析结果。 */
export type PluginAdapterResolution<Adapter> =
  | {
      readonly status: 'available'
      readonly registration: PluginAdapterRegistration<Adapter>
    }
  | {
      readonly status: 'unavailable'
      readonly diagnostic: PluginDiagnostic
    }

/** 单类 plugin adapter 的注册、解析和列表接口。 */
export interface PluginAdapterSlot<Adapter> {
  /** 注册一个候选 adapter，返回可撤销句柄。 */
  register(adapter: Adapter, options?: PluginAdapterRegisterOptions): PluginDisposable
  /** 按声明顺序解析一个候选 adapter。 */
  resolve(options?: PluginAdapterResolveOptions): PluginAdapterResolution<Adapter>
  /** 读取当前 slot 的只读注册快照。 */
  list(): readonly PluginAdapterRegistration<Adapter>[]
}

/** 按文件格式解析 adapter 的 slot 接口。 */
export interface PluginFormatAdapterSlot<Adapter> extends PluginAdapterSlot<Adapter> {
  /** 按 format 和声明顺序解析一个格式 adapter。 */
  resolveFormat(format: string, options?: PluginAdapterResolveOptions): PluginAdapterResolution<Adapter>
}

/** PluginContext 暴露给插件的 adapter registry。 */
export interface PluginAdapterRegistry {
  /** 资源上传 adapter slot。 */
  readonly resources: PluginAdapterSlot<ResourceAdapter>
  /** 版本历史、快照或离线 persistence adapter descriptor slot。 */
  readonly persistence: PluginAdapterSlot<PluginPersistenceAdapterDescriptor>
  /** 导入格式 adapter descriptor slot。 */
  readonly imports: PluginFormatAdapterSlot<PluginImportAdapterDescriptor>
  /** 导出格式 adapter descriptor slot。 */
  readonly exports: PluginFormatAdapterSlot<PluginExportAdapterDescriptor>
  /** 协同 provider adapter descriptor slot。 */
  readonly collabProviders: PluginAdapterSlot<PluginCollabProviderAdapterDescriptor>
}

/** Persistence package 可包装成 plugin adapter 的 descriptor。 */
export interface PluginPersistenceAdapterDescriptor<Input = unknown, Result = unknown> {
  /** descriptor 类型。 */
  readonly kind: 'persistence'
  /** 当前插件内稳定名称。 */
  readonly name: string
  /** persistence 能力对应的 feature key。 */
  readonly featureKey?: string
  /** diagnostics 来源，通常为 persistence。 */
  readonly diagnosticsSource?: string
  /** 执行 package-owned persistence 行为，core 不解释入参或结果。 */
  readonly execute: PluginAdapterExecute<Input, Result>
}

/** Import package 可包装成 plugin adapter 的 descriptor。 */
export interface PluginImportAdapterDescriptor<Input = unknown, Result = unknown> {
  /** descriptor 类型。 */
  readonly kind: 'import'
  /** 当前插件内稳定名称。 */
  readonly name: string
  /** 格式名称，例如 docx。 */
  readonly format: string
  /** 支持的 MIME 类型。 */
  readonly mimeTypes?: readonly string[]
  /** 支持的扩展名。 */
  readonly fileExtensions?: readonly string[]
  /** 导入能力对应的 feature key。 */
  readonly featureKey?: string
  /** diagnostics 来源，通常为 docx 或 native。 */
  readonly diagnosticsSource?: string
  /** 执行 package-owned 导入行为，core 不解释入参或结果。 */
  readonly importDocument: PluginAdapterExecute<Input, Result>
}

/** Export package 可包装成 plugin adapter 的 descriptor。 */
export interface PluginExportAdapterDescriptor<Input = unknown, Result = unknown> {
  /** descriptor 类型。 */
  readonly kind: 'export'
  /** 当前插件内稳定名称。 */
  readonly name: string
  /** 格式名称，例如 docx 或 pdf。 */
  readonly format: string
  /** 导出能力对应的 feature key。 */
  readonly featureKey?: string
  /** diagnostics 来源，通常为 docx 或 pdf。 */
  readonly diagnosticsSource?: string
  /** 执行 package-owned 导出行为，core 不解释入参或结果。 */
  readonly exportDocument: PluginAdapterExecute<Input, Result>
}

/** Collaboration provider 可包装成 plugin adapter 的 descriptor。 */
export interface PluginCollabProviderAdapterDescriptor<Input = unknown, Result = unknown> {
  /** descriptor 类型。 */
  readonly kind: 'collabProvider'
  /** 当前插件内稳定名称。 */
  readonly name: string
  /** provider 对应的协作 feature key。 */
  readonly featureKey?: string
  /** diagnostics 来源，通常为 collab。 */
  readonly diagnosticsSource?: string
  /** 创建 package-owned provider adapter，core 不解释 provider 具体类型。 */
  readonly createProvider: PluginAdapterExecute<Input, Result>
}
