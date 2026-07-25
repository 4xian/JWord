/**
 * 职责：实现 Gate 7 Plugin adapter registry 的注册、解析和错误隔离运行时。
 * 边界：只管理 plugin adapter descriptor，不执行 editor transaction，不读取 Y.Doc 或 DOM。
 * 协作模块：PluginHost、ResourceAdapter、adapter-types 和插件 diagnostics。
 * 性能/安全约束：按插件声明顺序解析 adapter，所有 adapter 回调异常都转为可恢复 diagnostics。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import type {
  ResourceAdapter,
  ResourceAdapterUploadRequest,
  ResourceAdapterUploadResult
} from '../resources/types'
import type {
  PluginAdapterExecute,
  PluginAdapterExecuteOptions,
  PluginAdapterKind,
  PluginAdapterRegisterOptions,
  PluginAdapterRegistration,
  PluginAdapterRegistry,
  PluginAdapterResolution,
  PluginAdapterResolveOptions,
  PluginAdapterSlot,
  PluginFormatAdapterSlot
} from './adapter-types'
import type { PluginDiagnostic, PluginDisposable } from './types'

interface PluginAdapterRuntimeOptions {
  readonly resourceAdapter?: ResourceAdapter | undefined
  readonly reportDiagnostic: (diagnostic: PluginDiagnostic) => void
}

type RuntimePluginAdapterRegistration<Adapter> = PluginAdapterRegistration<Adapter>

/** 管理插件 adapter 注册表并隔离 adapter 回调异常。 */
export class PluginAdapterRuntime {
  private readonly reportDiagnostic: (diagnostic: PluginDiagnostic) => void
  private readonly resourceAdapters: Array<RuntimePluginAdapterRegistration<ResourceAdapter>> = []
  private readonly persistenceAdapters: Array<RuntimePluginAdapterRegistration<unknown>> = []
  private readonly importAdapters: Array<RuntimePluginAdapterRegistration<unknown>> = []
  private readonly exportAdapters: Array<RuntimePluginAdapterRegistration<unknown>> = []
  private readonly collabProviderAdapters: Array<RuntimePluginAdapterRegistration<unknown>> = []

  /** 创建 adapter runtime 并预注册 editor options resource adapter。 */
  constructor(options: PluginAdapterRuntimeOptions) {
    this.reportDiagnostic = options.reportDiagnostic

    if (options.resourceAdapter !== undefined) {
      const adapterName = 'editor.resourceAdapter'

      this.resourceAdapters.push(Object.freeze({
        pluginName: 'editor.options',
        kind: 'resource',
        name: adapterName,
        featureKey: 'resource.upload',
        diagnosticsSource: 'core',
        adapter: this.createIsolatedAdapter('resource', 'editor.options', adapterName, options.resourceAdapter)
      }))
    }
  }

  /** 创建绑定当前插件名的 adapter registry facade。 */
  createRegistry(pluginName: string): PluginAdapterRegistry {
    return {
      resources: this.createAdapterSlot('resource', pluginName, this.resourceAdapters),
      persistence: this.createAdapterSlot('persistence', pluginName, this.persistenceAdapters),
      imports: this.createFormatAdapterSlot('import', pluginName, this.importAdapters),
      exports: this.createFormatAdapterSlot('export', pluginName, this.exportAdapters),
      collabProviders: this.createAdapterSlot('collabProvider', pluginName, this.collabProviderAdapters)
    } as PluginAdapterRegistry
  }

  /** 清空全部 adapter 注册。 */
  dispose(): void {
    this.resourceAdapters.length = 0
    this.persistenceAdapters.length = 0
    this.importAdapters.length = 0
    this.exportAdapters.length = 0
    this.collabProviderAdapters.length = 0
  }

  /** 创建普通 adapter slot facade。 */
  private createAdapterSlot<Adapter>(
    kind: PluginAdapterKind,
    pluginName: string,
    entries: Array<RuntimePluginAdapterRegistration<Adapter>>
  ): PluginAdapterSlot<Adapter> {
    return {
      register: (adapter, options) => this.registerAdapter(kind, pluginName, entries, adapter, options),
      resolve: (options) => this.resolveAdapter(kind, pluginName, entries, options),
      list: () => Object.freeze([...entries])
    }
  }

  /** 创建带 format 查询能力的 adapter slot facade。 */
  private createFormatAdapterSlot<Adapter>(
    kind: PluginAdapterKind,
    pluginName: string,
    entries: Array<RuntimePluginAdapterRegistration<Adapter>>
  ): PluginFormatAdapterSlot<Adapter> {
    return {
      ...this.createAdapterSlot(kind, pluginName, entries),
      resolveFormat: (format, options) => this.resolveAdapter(kind, pluginName, entries, options, format)
    }
  }

  /** 注册 adapter 并在重复候选出现时记录诊断。 */
  private registerAdapter<Adapter>(
    kind: PluginAdapterKind,
    pluginName: string,
    entries: Array<RuntimePluginAdapterRegistration<Adapter>>,
    adapter: Adapter,
    options: PluginAdapterRegisterOptions = {}
  ): PluginDisposable {
    const name = readAdapterRegistrationName(adapter, options)
    const duplicate = hasDuplicateAdapter(kind, entries, adapter)
    const isolatedAdapter = this.createIsolatedAdapter(kind, pluginName, name, adapter)
    const entry: RuntimePluginAdapterRegistration<Adapter> = Object.freeze({
      pluginName,
      kind,
      name,
      ...(options.featureKey === undefined ? {} : { featureKey: options.featureKey }),
      ...(options.diagnosticsSource === undefined ? {} : { diagnosticsSource: options.diagnosticsSource }),
      adapter: isolatedAdapter
    })

    entries.push(entry)

    if (duplicate) {
      this.reportDiagnostic({
        pluginName,
        code: 'PLUGIN_ADAPTER_DUPLICATE',
        message: `插件 adapter 重复注册：${name}`,
        lifecycle: 'adapter',
        commandName: name,
        recoverable: true
      })
    }

    return createDisposable(() => {
      removeEntry(entries, entry)
    })
  }

  /** 为 adapter 回调加错误隔离包装。 */
  private createIsolatedAdapter<Adapter>(
    kind: PluginAdapterKind,
    pluginName: string,
    adapterName: string,
    adapter: Adapter
  ): Adapter {
    if (kind === 'resource' && isResourceAdapter(adapter)) {
      return this.createIsolatedResourceAdapter(pluginName, adapterName, adapter) as Adapter
    }

    const executeKey = readAdapterExecuteKey(kind)

    if (executeKey !== undefined && readAdapterKind(adapter) === kind && hasFunctionProperty(adapter, executeKey)) {
      const execute = (adapter as Readonly<Record<string, unknown>>)[executeKey] as PluginAdapterExecute

      return Object.freeze({
        ...(adapter as object),
        [executeKey]: (input: unknown, options?: PluginAdapterExecuteOptions) => this.runAdapterExecute(
          pluginName,
          kind,
          adapterName,
          () => execute(input, options)
        )
      }) as Adapter
    }

    return adapter
  }

  /** 包装 resource adapter，失败时返回 failed resource 而不是让异常逃出宿主。 */
  private createIsolatedResourceAdapter(
    pluginName: string,
    adapterName: string,
    adapter: ResourceAdapter
  ): ResourceAdapter {
    return {
      upload: async (request, options) => {
        try {
          return await adapter.upload(request, options)
        } catch (error) {
          this.reportAdapterError(pluginName, 'resource', adapterName, error)

          return createFailedResourceUploadResult(request, error)
        }
      },
      ...(adapter.delete === undefined
        ? {}
        : {
            delete: async (resource) => {
              try {
                await adapter.delete?.(resource)
              } catch (error) {
                this.reportAdapterError(pluginName, 'resource', adapterName, error)
              }
            }
          })
    }
  }

  /** 运行非 resource adapter 回调，失败时返回 undefined 并记录诊断。 */
  private runAdapterExecute<Result>(
    pluginName: string,
    kind: PluginAdapterKind,
    adapterName: string,
    execute: () => Result | undefined | Promise<Result | undefined>
  ): Result | undefined | Promise<Result | undefined> {
    try {
      const result = execute()

      if (isPromiseLike(result)) {
        return Promise.resolve(result).catch((error) => {
          this.reportAdapterError(pluginName, kind, adapterName, error)

          return undefined
        })
      }

      return result
    } catch (error) {
      this.reportAdapterError(pluginName, kind, adapterName, error)

      return undefined
    }
  }

  /** 把 adapter 失败统一转为插件诊断。 */
  private reportAdapterError(
    pluginName: string,
    kind: PluginAdapterKind,
    adapterName: string,
    error: unknown
  ): void {
    this.reportDiagnostic({
      pluginName,
      code: resolveAdapterDiagnosticCode(kind, error),
      message: readErrorMessage(error),
      lifecycle: 'adapter',
      commandName: adapterName,
      reasonCode: readErrorCode(error),
      recoverable: true
    })
  }

  /** 按声明顺序解析 adapter。 */
  private resolveAdapter<Adapter>(
    kind: PluginAdapterKind,
    pluginName: string,
    entries: readonly RuntimePluginAdapterRegistration<Adapter>[],
    options: PluginAdapterResolveOptions = {},
    format?: string
  ): PluginAdapterResolution<Adapter> {
    const registration = entries.find((entry) => matchesAdapterResolution(entry, options, format))

    if (registration !== undefined) {
      return {
        status: 'available',
        registration
      }
    }

    return {
      status: 'unavailable',
      diagnostic: {
        pluginName,
        code: 'PLUGIN_ADAPTER_UNAVAILABLE',
        message: `插件 adapter 不可用：${format ?? options.name ?? kind}`,
        lifecycle: 'adapter',
        commandName: format ?? options.name ?? kind,
        recoverable: true
      }
    }
  }
}

/** 创建简单 disposable。 */
function createDisposable(dispose: () => void): PluginDisposable {
  return { dispose }
}

/** 从数组中按引用删除单个条目。 */
function removeEntry<T>(entries: T[], entry: T): void {
  const index = entries.indexOf(entry)

  if (index >= 0) {
    entries.splice(index, 1)
  }
}

/** 判断未知值是否是 resource adapter。 */
function isResourceAdapter(value: unknown): value is ResourceAdapter {
  return hasFunctionProperty(value, 'upload')
}

/** 读取 descriptor 对应的执行回调字段。 */
function readAdapterExecuteKey(kind: PluginAdapterKind): string | undefined {
  if (kind === 'persistence') {
    return 'execute'
  }
  if (kind === 'import') {
    return 'importDocument'
  }
  if (kind === 'export') {
    return 'exportDocument'
  }
  if (kind === 'collabProvider') {
    return 'createProvider'
  }

  return undefined
}

/** 从 adapter descriptor 读取 kind。 */
function readAdapterKind(value: unknown): string | undefined {
  return readStringProperty(value, 'kind')
}

/** 判断对象是否包含函数属性。 */
function hasFunctionProperty(value: unknown, key: string): boolean {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  return typeof (value as Readonly<Record<string, unknown>>)[key] === 'function'
}

/** 判断值是否是 Promise-like。 */
function isPromiseLike<Result>(value: Result | undefined | Promise<Result | undefined>): value is Promise<Result | undefined> {
  return typeof value === 'object' && value !== null && typeof (value as Promise<Result | undefined>).then === 'function'
}

/** 创建 resource adapter 失败后的占位结果。 */
function createFailedResourceUploadResult(
  request: ResourceAdapterUploadRequest,
  error: unknown
): ResourceAdapterUploadResult {
  const mime = readUploadMime(request)

  return {
    resource: {
      kind: 'resource',
      id: request.resourceId,
      mime,
      source: request.previousResource?.source ?? {
        kind: 'dataUrl',
        url: `data:${mime};base64,`
      },
      status: 'failed',
      error: {
        code: 'PLUGIN_ADAPTER_FAILED',
        message: readErrorMessage(error)
      },
      ...(request.retryToken === undefined ? {} : { retryToken: request.retryToken })
    }
  }
}

/** 从上传请求读取最小 MIME。 */
function readUploadMime(request: ResourceAdapterUploadRequest): string {
  if (request.source.kind === 'file' && request.source.file.type.length > 0) {
    return request.source.file.type
  }

  return request.previousResource?.mime ?? 'application/octet-stream'
}

/** 选择 adapter 失败诊断码。 */
function resolveAdapterDiagnosticCode(kind: PluginAdapterKind, error: unknown): PluginDiagnostic['code'] {
  if (readErrorCode(error) !== undefined) {
    if (kind === 'import') {
      return 'PLUGIN_IMPORT_REJECTED'
    }
    if (kind === 'export') {
      return 'PLUGIN_EXPORT_REJECTED'
    }
    if (kind === 'collabProvider') {
      return 'PLUGIN_COLLAB_PROVIDER_REJECTED'
    }
  }

  return 'PLUGIN_ADAPTER_FAILED'
}

/** 读取 adapter 注册名称。 */
function readAdapterRegistrationName(adapter: unknown, options: PluginAdapterRegisterOptions): string {
  return options.name ?? readStringProperty(adapter, 'name') ?? 'anonymous-adapter'
}

/** 判断注册是否会产生重复候选。 */
function hasDuplicateAdapter<Adapter>(
  kind: PluginAdapterKind,
  entries: readonly RuntimePluginAdapterRegistration<Adapter>[],
  adapter: Adapter
): boolean {
  if (kind === 'import' || kind === 'export') {
    const format = readAdapterFormat(adapter)

    return entries.some((entry) => readAdapterFormat(entry.adapter) === format)
  }

  return entries.length > 0
}

/** 判断 adapter registration 是否满足解析条件。 */
function matchesAdapterResolution<Adapter>(
  entry: RuntimePluginAdapterRegistration<Adapter>,
  options: PluginAdapterResolveOptions,
  format?: string
): boolean {
  if (options.name !== undefined && entry.name !== options.name) {
    return false
  }

  if (options.featureKey !== undefined && entry.featureKey !== options.featureKey) {
    return false
  }

  if (format !== undefined && readAdapterFormat(entry.adapter) !== format) {
    return false
  }

  return true
}

/** 从格式 adapter descriptor 读取 format。 */
function readAdapterFormat(adapter: unknown): string | undefined {
  return readStringProperty(adapter, 'format')
}

/** 从未知对象读取字符串字段。 */
function readStringProperty(value: unknown, key: string): string | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined
  }

  const property = (value as Readonly<Record<string, unknown>>)[key]

  return typeof property === 'string' ? property : undefined
}

/** 读取未知错误的中文诊断消息。 */
function readErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return readStringProperty(error, 'message') ?? '插件 adapter 执行失败'
}

/** 读取未知错误的稳定错误码。 */
function readErrorCode(error: unknown): string | undefined {
  return readStringProperty(error, 'code')
}
