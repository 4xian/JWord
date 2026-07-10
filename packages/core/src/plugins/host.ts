/**
 * 职责：实现 Gate 7 Plugin API M2 的 core 插件宿主、命令中间件、生命周期和快捷键调度。
 * 边界：不直接修改 Y.Doc，不访问 document-store，不绘制 DOM 或 canvas。
 * 协作模块：编辑器门面、事务流水线、只读投影、选择区和插件公开类型。
 * 性能/安全约束：所有插件回调均进入错误隔离；插件命令最终仍通过既有 transaction pipeline。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import { DEFAULT_HISTORY_ORIGIN } from '../operations/history'
import { getSelectionRects } from '../layout/runtime'
import { createJWordDiagnosticsSnapshot, createPluginDiagnosticTelemetryEvent } from '../editor/observability'
import type { DocumentLayout, LayoutRect } from '../layout/runtime'
import type { DocumentProjection } from '../model/projection'
import type { SelectionState } from '../model/selection'
import type { Command, OperationKind, TransactionDiagnosticSource, TransactionEvent, TransactionResult } from '../operations/transaction'
import type { ResourceAdapter } from '../resources/types'
import type { JWordErrorDetails } from '../shared/errors'
import type { Editor, EditorCommandOptions } from '../editor/types'
import type { JWordDiagnosticsSnapshot, JWordTelemetrySink } from '../editor/observability'
import type {
  PluginAfterTransactionEvent,
  PluginCommandDefinition,
  PluginCommandMiddleware,
  PluginCommandMiddlewareInput,
  PluginContext,
  PluginDecoration,
  PluginDecorationReadReason,
  PluginDefinition,
  PluginDiagnostic,
  PluginDiagnosticInput,
  PluginDisposable,
  PluginErrorEvent,
  ExperimentalDecorationProvider,
  PluginResolvedDecoration,
  PluginKeyBindingContext,
  PluginKeyBindingDefinition,
  PluginLifecycleEventMap,
  PluginLifecycleEventName,
  PluginLifecycleListener,
  PluginMountEvent
} from './types'
import { BUILTIN_PLUGIN_DEFINITIONS } from './builtin'
import { PluginAdapterRuntime } from './adapter-registry'

interface PluginHostOptions {
  readonly plugins?: readonly PluginDefinition[] | undefined
  readonly resourceAdapter?: ResourceAdapter | undefined
  readonly readProjection: () => DocumentProjection
  readonly emitDiagnostic: (diagnostic: PluginDiagnostic) => void
  readonly emitTelemetry?: JWordTelemetrySink | undefined
}

interface RegisteredPluginCommand {
  readonly pluginName: string
  readonly definition: PluginCommandDefinition
}

interface RegisteredCommandMiddleware {
  readonly pluginName: string
  readonly middleware: PluginCommandMiddleware
}

interface RegisteredKeyBinding {
  readonly pluginName: string
  readonly binding: PluginKeyBindingDefinition
  readonly normalizedKey: string
}

interface RegisteredDecorationProvider {
  readonly pluginName: string
  readonly providerName: string
  readonly read: (input: RuntimeDecorationInput) => readonly PluginDecoration[]
}


interface RegisteredLifecycleListener {
  readonly pluginName: string
  readonly eventName: PluginLifecycleEventName
  readonly listener: (event: PluginLifecycleEventMap[PluginLifecycleEventName]) => void
}

interface RuntimeKeyBindingInput {
  readonly rawKey: string
  readonly shiftKey: boolean
  readonly altKey: boolean
  readonly ctrlKey: boolean
  readonly metaKey: boolean
  readonly projection: DocumentProjection
  readonly selection: SelectionState | null
  readonly mounted: boolean
}

interface RuntimeKeyBindingResult {
  readonly handled: boolean
  readonly preventDefault: boolean
}

interface RuntimeDecorationInput {
  readonly projection: DocumentProjection
  readonly layout: DocumentLayout
  readonly selection: SelectionState | null
  readonly reason: PluginDecorationReadReason
}

interface CommandExecutor {
  (command: Command, options: EditorCommandOptions): TransactionResult
}

export class PluginHost {
  private readonly plugins: readonly PluginDefinition[]
  private readonly readProjection: () => DocumentProjection
  private readonly emitDiagnostic: (diagnostic: PluginDiagnostic) => void
  private readonly emitTelemetry: JWordTelemetrySink | undefined
  private readonly commands = new Map<string, RegisteredPluginCommand>()
  private readonly middlewares: RegisteredCommandMiddleware[] = []
  private readonly keyBindings: RegisteredKeyBinding[] = []
  private readonly decorationProviders: RegisteredDecorationProvider[] = []
  private readonly adapterRuntime: PluginAdapterRuntime
  private readonly listeners: RegisteredLifecycleListener[] = []
  private readonly disposables: Array<Readonly<{ pluginName: string, disposable: PluginDisposable }>> = []
  private readonly diagnostics: PluginDiagnostic[] = []
  private editor: Editor | undefined
  private initialized = false

  /** 创建插件宿主但不立即执行插件 setup。 */
  constructor(options: PluginHostOptions) {
    this.plugins = [
      ...BUILTIN_PLUGIN_DEFINITIONS,
      ...(options.plugins ?? [])
    ]
    this.readProjection = options.readProjection
    this.emitDiagnostic = options.emitDiagnostic
    this.emitTelemetry = options.emitTelemetry
    this.adapterRuntime = new PluginAdapterRuntime({
      resourceAdapter: options.resourceAdapter,
      reportDiagnostic: (diagnostic) => this.reportDiagnostic(diagnostic)
    })
  }

  /** 读取当前插件诊断快照。 */
  getDiagnostics(): readonly PluginDiagnostic[] {
    return [...this.diagnostics]
  }

  /** 导出经过隐私裁剪的插件诊断快照。 */
  exportDiagnostics(): JWordDiagnosticsSnapshot {
    return createJWordDiagnosticsSnapshot(this.diagnostics)
  }

  /** 在 editor 完成构造后按声明顺序执行插件 setup。 */
  initialize(editor: Editor): void {
    if (this.initialized) {
      return
    }

    this.initialized = true
    this.editor = editor

    for (const plugin of this.plugins) {
      this.setupPlugin(plugin, editor)
    }
  }

  /** 通过已注册插件命令名称执行插件命令。 */
  executePluginCommand(commandName: string, input?: unknown): TransactionResult | undefined {
    const registered = this.commands.get(commandName)
    const editor = this.editor

    if (registered === undefined || editor === undefined) {
      this.reportDiagnostic({
        pluginName: registered?.pluginName ?? 'plugin-host',
        code: 'PLUGIN_COMMAND_NOT_FOUND',
        message: `未找到插件命令：${commandName}`,
        lifecycle: 'command',
        commandName,
        recoverable: true
      })
      return undefined
    }

    try {
      const result = registered.definition.execute(input, {
        editor,
        pluginName: registered.pluginName,
        commandName,
        reject: (reasonCode, message, details) => this.createRejectedCommandResult({
          pluginName: registered.pluginName,
          commandName,
          reasonCode,
          message,
          details,
          options: {}
        })
      })

      if (result === undefined) {
        return undefined
      }

      if (isTransactionResult(result)) {
        return result
      }

      return editor.executeCommand(result)
    } catch (error) {
      this.reportCallbackError(registered.pluginName, 'command', commandName, error)
      return undefined
    }
  }

  /** 按注册顺序运行命令中间件链，最后进入原始 transaction pipeline。 */
  runCommandMiddleware(
    input: Readonly<{ command: Command, options: EditorCommandOptions }>,
    execute: CommandExecutor
  ): TransactionResult {
    const runAt = (index: number, current: PluginCommandMiddlewareInput): TransactionResult => {
      const registered = this.middlewares[index]

      if (registered === undefined) {
        return execute(current.command, current.options)
      }

      const nextInput = {
        ...current,
        reject: (reasonCode: string, message: string, details?: JWordErrorDetails) => this.createRejectedCommandResult({
          pluginName: registered.pluginName,
          commandName: current.command.name,
          reasonCode,
          message,
          details,
          options: current.options
        })
      }

      try {
        return registered.middleware(nextInput, (candidate) => runAt(index + 1, {
          ...candidate,
          reject: (reasonCode, message, details) => this.createRejectedCommandResult({
            pluginName: registered.pluginName,
            commandName: candidate.command.name,
            reasonCode,
            message,
            details,
            options: candidate.options
          })
        }))
      } catch (error) {
        return this.createRejectedCommandResult({
          pluginName: registered.pluginName,
          commandName: current.command.name,
          reasonCode: 'PLUGIN_MIDDLEWARE_FAILED',
          message: '插件命令中间件执行失败',
          details: normalizeErrorDetails(error),
          options: current.options
        })
      }
    }

    return runAt(0, {
      command: input.command,
      options: input.options,
      reject: (reasonCode, message, details) => this.createRejectedCommandResult({
        pluginName: 'plugin-host',
        commandName: input.command.name,
        reasonCode,
        message,
        details,
        options: input.options
      })
    })
  }

  /** 处理 runtime 传入的键盘事件快照。 */
  handleKeyBinding(input: RuntimeKeyBindingInput): RuntimeKeyBindingResult {
    const normalizedKey = normalizeKeyBindingInput(input)
    const context: PluginKeyBindingContext = {
      key: normalizedKey,
      rawKey: input.rawKey,
      shiftKey: input.shiftKey,
      altKey: input.altKey,
      ctrlKey: input.ctrlKey,
      metaKey: input.metaKey,
      projection: input.projection,
      selection: input.selection,
      mounted: input.mounted
    }

    for (const registered of this.keyBindings) {
      if (registered.normalizedKey !== normalizedKey) {
        continue
      }

      if (!this.shouldRunKeyBinding(registered, context)) {
        continue
      }

      this.executePluginCommand(registered.binding.command, registered.binding.input)
      return {
        handled: true,
        preventDefault: registered.binding.preventDefault !== false
      }
    }

    return {
      handled: false,
      preventDefault: false
    }
  }

  /** 读取并归一化 experimental decoration，provider 异常不会中断渲染。 */
  readDecorations(input: RuntimeDecorationInput): readonly PluginResolvedDecoration[] {
    if (this.decorationProviders.length === 0) {
      return []
    }

    const decorations: PluginResolvedDecoration[] = []
    const readonlyInput = createDecorationReadInput(input)

    for (const provider of this.decorationProviders) {
      try {
        for (const decoration of provider.read(readonlyInput)) {
          decorations.push(...resolvePluginDecoration(provider, decoration, input.layout))
        }
      } catch (error) {
        this.reportCallbackError(provider.pluginName, 'decoration', provider.providerName, error)
      }
    }

    return decorations
  }

  /** 发布 mount 生命周期事件。 */
  dispatchMount(event: PluginMountEvent): void {
    this.dispatchLifecycle('mount', event)
  }

  /** 发布 afterTransaction 生命周期事件。 */
  dispatchAfterTransaction(transaction: TransactionEvent): void {
    const event: PluginAfterTransactionEvent = { transaction }

    this.dispatchLifecycle('afterTransaction', event)
  }

  /** 发布 destroy 生命周期事件。 */
  dispatchDestroy(): void {
    this.dispatchLifecycle('destroy', {
      reason: 'editor.destroy',
      diagnostics: this.getDiagnostics()
    })
  }

  /** 反序释放插件 setup 返回的 disposable。 */
  dispose(): void {
    for (const registered of [...this.disposables].reverse()) {
      try {
        registered.disposable.dispose()
      } catch (error) {
        this.reportCallbackError(registered.pluginName, 'dispose', 'dispose', error)
      }
    }

    this.disposables.length = 0
    this.commands.clear()
    this.middlewares.length = 0
    this.keyBindings.length = 0
    this.decorationProviders.length = 0
    this.adapterRuntime.dispose()
    this.listeners.length = 0
  }

  /** 执行单个插件 setup 并登记返回的 disposable。 */
  private setupPlugin(plugin: PluginDefinition, editor: Editor): void {
    try {
      const result = plugin.setup(this.createContext(plugin, editor))

      if (result === undefined) {
        return
      }

      const disposables = Array.isArray(result) ? result : [result]

      for (const disposable of disposables) {
        this.disposables.push({ pluginName: plugin.name, disposable })
      }
    } catch (error) {
      this.reportCallbackError(plugin.name, 'setup', 'setup', error)
    }
  }

  /** 创建绑定到指定插件的上下文对象。 */
  private createContext(plugin: PluginDefinition, editor: Editor): PluginContext {
    return {
      name: plugin.name,
      version: plugin.version,
      editor,
      adapters: this.adapterRuntime.createRegistry(plugin.name),
      registerCommand: (command) => this.registerCommand(plugin.name, command),
      interceptCommand: (middleware) => this.interceptCommand(plugin.name, middleware),
      registerKeyBinding: (binding) => this.registerKeyBinding(plugin.name, binding),
      registerDecorationProvider: (provider) => this.registerDecorationProvider(plugin.name, provider),
      on: (eventName, listener) => this.registerLifecycleListener(plugin.name, eventName, listener),
      diagnostics: {
        report: (input) => this.reportDiagnostic({
          pluginName: plugin.name,
          code: input.code ?? 'PLUGIN_CALLBACK_FAILED',
          message: input.message,
          lifecycle: input.lifecycle,
          commandName: input.commandName,
          reasonCode: input.reasonCode,
          recoverable: input.recoverable ?? true,
          details: input.details
        })
      }
    }
  }

  /** 注册插件命令并返回可撤销句柄。 */
  private registerCommand(pluginName: string, command: PluginCommandDefinition): PluginDisposable {
    if (this.commands.has(command.name)) {
      this.reportDiagnostic({
        pluginName,
        code: 'PLUGIN_COMMAND_DUPLICATE',
        message: `插件命令重复注册：${command.name}`,
        lifecycle: 'command',
        commandName: command.name,
        recoverable: true
      })
      return createDisposable(() => undefined)
    }

    this.commands.set(command.name, { pluginName, definition: command })

    return createDisposable(() => {
      const current = this.commands.get(command.name)

      if (current?.pluginName === pluginName) {
        this.commands.delete(command.name)
      }
    })
  }

  /** 注册命令中间件并返回可撤销句柄。 */
  private interceptCommand(pluginName: string, middleware: PluginCommandMiddleware): PluginDisposable {
    const entry = { pluginName, middleware }

    this.middlewares.push(entry)

    return createDisposable(() => {
      removeEntry(this.middlewares, entry)
    })
  }

  /** 注册快捷键并返回可撤销句柄。 */
  private registerKeyBinding(pluginName: string, binding: PluginKeyBindingDefinition): PluginDisposable {
    const entry = {
      pluginName,
      binding,
      normalizedKey: normalizeKeyBinding(binding.key)
    }

    this.keyBindings.push(entry)

    return createDisposable(() => {
      removeEntry(this.keyBindings, entry)
    })
  }

  /** 注册 experimental decoration provider 并返回可撤销句柄。 */
  private registerDecorationProvider(
    pluginName: string,
    provider: ExperimentalDecorationProvider
  ): PluginDisposable {
    const entry = {
      pluginName,
      providerName: provider.name,
      read: provider.read
    }

    this.decorationProviders.push(entry)

    return createDisposable(() => {
      removeEntry(this.decorationProviders, entry)
    })
  }

  /** 注册生命周期监听器并返回可撤销句柄。 */
  private registerLifecycleListener<EventName extends PluginLifecycleEventName>(
    pluginName: string,
    eventName: EventName,
    listener: PluginLifecycleListener<EventName>
  ): PluginDisposable {
    const entry: RegisteredLifecycleListener = {
      pluginName,
      eventName,
      listener: listener as (event: PluginLifecycleEventMap[PluginLifecycleEventName]) => void
    }

    this.listeners.push(entry)

    return createDisposable(() => {
      removeEntry(this.listeners, entry)
    })
  }

  /** 判断快捷键谓词是否允许执行。 */
  private shouldRunKeyBinding(registered: RegisteredKeyBinding, context: PluginKeyBindingContext): boolean {
    if (registered.binding.when === undefined) {
      return true
    }

    try {
      return registered.binding.when(context)
    } catch (error) {
      this.reportCallbackError(registered.pluginName, 'keybinding', registered.binding.command, error)
      return false
    }
  }

  /** 分发指定生命周期事件并隔离监听器异常。 */
  private dispatchLifecycle<EventName extends PluginLifecycleEventName>(
    eventName: EventName,
    event: PluginLifecycleEventMap[EventName]
  ): void {
    for (const registered of this.listeners) {
      if (registered.eventName !== eventName) {
        continue
      }

      this.runLifecycleListener(registered, eventName, event)
    }
  }

  /** 执行单个生命周期监听器。 */
  private runLifecycleListener<EventName extends PluginLifecycleEventName>(
    registered: RegisteredLifecycleListener,
    eventName: EventName,
    event: PluginLifecycleEventMap[EventName]
  ): void {
    try {
      registered.listener(event)
    } catch (error) {
      this.reportCallbackError(registered.pluginName, eventName, eventName, error)
    }
  }

  /** 创建拒绝结果并发布 error 事件。 */
  private createRejectedCommandResult(input: Readonly<{
    pluginName: string
    commandName: string
    reasonCode: string
    message: string
    details?: JWordErrorDetails | undefined
    options: EditorCommandOptions
  }>): TransactionResult {
    const origin = input.options.origin ?? DEFAULT_HISTORY_ORIGIN
    const metadata = createRejectedMetadata(origin, input.options)
    const diagnostic = createRejectedDiagnostic(input.commandName, origin, input.reasonCode)
    const result = {
      commandName: input.commandName,
      origin,
      metadata,
      operations: [],
      operationKinds: [] as readonly OperationKind[],
      projection: this.readProjection(),
      dirty: false,
      diagnostic
    }

    this.reportDiagnostic({
      pluginName: input.pluginName,
      code: 'PLUGIN_COMMAND_REJECTED',
      message: input.message,
      lifecycle: 'middleware',
      commandName: input.commandName,
      reasonCode: input.reasonCode,
      recoverable: true,
      details: input.details
    })

    return result
  }

  /** 把插件异常归一为诊断。 */
  private reportCallbackError(
    pluginName: string,
    lifecycle: PluginDiagnosticInput['lifecycle'],
    commandName: string,
    error: unknown
  ): void {
    this.reportDiagnostic({
      pluginName,
      code: 'PLUGIN_CALLBACK_FAILED',
      message: readErrorMessage(error),
      lifecycle,
      commandName,
      recoverable: true,
      details: normalizeErrorDetails(error)
    })
  }

  /** 记录诊断并同步通知 editor 与插件 error 监听器。 */
  private reportDiagnostic(diagnostic: PluginDiagnostic): void {
    this.diagnostics.push(diagnostic)
    this.emitDiagnostic(diagnostic)
    this.reportTelemetry(diagnostic)

    const event: PluginErrorEvent = { diagnostic }

    for (const registered of this.listeners) {
      if (registered.eventName !== 'error') {
        continue
      }

      try {
        const listener = registered.listener as PluginLifecycleListener<'error'>

        listener(event)
      } catch {
        // error 监听器自身失败时不再递归上报，避免插件错误风暴。
      }
    }
  }

  /** 在宿主 opt-in 后发送插件诊断 telemetry，sink 异常不会影响编辑器。 */
  private reportTelemetry(diagnostic: PluginDiagnostic): void {
    if (this.emitTelemetry === undefined) {
      return
    }

    try {
      this.emitTelemetry(createPluginDiagnosticTelemetryEvent(diagnostic))
    } catch {
      // telemetry sink 由宿主提供，失败时不能反向破坏编辑器或递归产生诊断。
    }
  }
}

/** 创建插件宿主。 */
export function createPluginHost(options: PluginHostOptions): PluginHost {
  return new PluginHost(options)
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

/** 从未知对象读取字符串字段。 */
function readStringProperty(value: unknown, key: string): string | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined
  }

  const property = (value as Readonly<Record<string, unknown>>)[key]

  return typeof property === 'string' ? property : undefined
}

/** 判断插件命令返回值是否已经是事务结果。 */
function isTransactionResult(value: Command | TransactionResult): value is TransactionResult {
  return 'diagnostic' in value && 'projection' in value && 'dirty' in value
}

/** 创建只读 decoration 输入快照，避免插件替换 layout 顶层集合。 */
function createDecorationReadInput(input: RuntimeDecorationInput): RuntimeDecorationInput {
  return Object.freeze({
    projection: input.projection,
    layout: createReadonlyLayoutSnapshot(input.layout),
    selection: input.selection,
    reason: input.reason
  })
}

/** 为插件 provider 创建浅只读 layout 快照。 */
function createReadonlyLayoutSnapshot(layout: DocumentLayout): DocumentLayout {
  return Object.freeze({
    ...layout,
    pages: Object.freeze(layout.pages.map((page) => Object.freeze({
      ...page,
      lines: Object.freeze([...page.lines]),
      paragraphs: Object.freeze([...page.paragraphs]),
      blocks: Object.freeze([...page.blocks]),
      headerFooterBoxes: Object.freeze([...page.headerFooterBoxes])
    })))
  }) as DocumentLayout
}

/** 把 provider 返回的 decoration 归一化为 renderer 只消费的形状。 */
function resolvePluginDecoration(
  provider: RegisteredDecorationProvider,
  decoration: PluginDecoration,
  layout: DocumentLayout
): readonly PluginResolvedDecoration[] {
  if (decoration.kind === 'pageOverlay') {
    return [Object.freeze({
      pluginName: provider.pluginName,
      providerName: provider.providerName,
      id: decoration.id,
      kind: decoration.kind,
      pageIndex: decoration.pageIndex,
      rect: freezeLayoutRect(decoration.rect),
      ...(decoration.color === undefined ? {} : { color: decoration.color }),
      ...(decoration.label === undefined ? {} : { label: decoration.label })
    })]
  }

  const rectsByPage = new Map<number, LayoutRect[]>()

  for (const rect of getSelectionRects(layout, decoration.range)) {
    const pageRects = rectsByPage.get(rect.pageIndex) ?? []

    pageRects.push(freezeLayoutRect(rect))
    rectsByPage.set(rect.pageIndex, pageRects)
  }

  return [...rectsByPage.entries()].map(([pageIndex, rects]) => Object.freeze({
    pluginName: provider.pluginName,
    providerName: provider.providerName,
    id: decoration.id,
    kind: decoration.kind,
    pageIndex,
    rects: Object.freeze(rects),
    ...(decoration.color === undefined ? {} : { color: decoration.color })
  }))
}

/** 冻结 layout rect，避免 renderer 后续读到被插件复用对象修改后的值。 */
function freezeLayoutRect(rect: LayoutRect): LayoutRect {
  return Object.freeze({
    pageIndex: rect.pageIndex,
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height
  })
}

/** 为被拒绝命令创建 metadata。 */
function createRejectedMetadata(origin: string, options: EditorCommandOptions) {
  return {
    origin,
    ...(options.label === undefined ? {} : { label: options.label }),
    ...(options.requestId === undefined ? {} : { requestId: options.requestId }),
    ...(options.roomId === undefined ? {} : { roomId: options.roomId }),
    ...(options.clientId === undefined ? {} : { clientId: options.clientId }),
    ...(options.authorId === undefined ? {} : { authorId: options.authorId }),
    ...(options.snapshotId === undefined ? {} : { snapshotId: options.snapshotId }),
    ...(options.versionId === undefined ? {} : { versionId: options.versionId }),
    recoverable: true
  }
}

/** 为被拒绝命令创建事务诊断。 */
function createRejectedDiagnostic(commandName: string, origin: string, reasonCode: string) {
  const source = resolveDiagnosticSource(origin)

  return {
    commandName,
    origin,
    operationKinds: [] as readonly OperationKind[],
    updateByteLength: 0,
    source,
    local: source === 'local',
    remote: source === 'remote',
    recoverable: true,
    reasonCode
  }
}

/** 按现有事务 origin 规则推断诊断来源。 */
function resolveDiagnosticSource(origin: string): TransactionDiagnosticSource {
  if (origin === 'remote-user') {
    return 'remote'
  }
  if (origin === 'system-recovery') {
    return 'system-recovery'
  }
  if (origin === 'version-restore') {
    return 'version-restore'
  }
  if (origin === 'auto-inserter') {
    return 'auto-inserter'
  }

  return 'local'
}

/** 归一化声明式快捷键字符串。 */
function normalizeKeyBinding(key: string): string {
  return key
    .split('-')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => part.length === 1 ? part.toUpperCase() : normalizeKeyPart(part))
    .join('-')
}

/** 归一化单个快捷键片段。 */
function normalizeKeyPart(part: string): string {
  const lower = part.toLowerCase()

  if (lower === 'cmd' || lower === 'command' || lower === 'ctrl' || lower === 'control' || lower === 'mod') {
    return 'Mod'
  }
  if (lower === 'shift') {
    return 'Shift'
  }
  if (lower === 'alt' || lower === 'option') {
    return 'Alt'
  }

  return part.length === 1 ? part.toUpperCase() : part
}

/** 从键盘事件快照生成声明式快捷键字符串。 */
function normalizeKeyBindingInput(input: RuntimeKeyBindingInput): string {
  const parts: string[] = []

  if (input.shiftKey) {
    parts.push('Shift')
  }
  if (input.altKey) {
    parts.push('Alt')
  }
  if (input.metaKey || input.ctrlKey) {
    parts.push('Mod')
  }

  parts.push(input.rawKey.length === 1 ? input.rawKey.toUpperCase() : input.rawKey)

  return parts.join('-')
}

/** 读取未知错误的中文诊断消息。 */
function readErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return readStringProperty(error, 'message') ?? '插件回调执行失败'
}

/** 读取未知错误的稳定错误码。 */
function readErrorCode(error: unknown): string | undefined {
  return readStringProperty(error, 'code')
}

/** 将未知错误转换为 JSON 兼容诊断详情。 */
function normalizeErrorDetails(error: unknown): JWordErrorDetails {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message
    }
  }

  if (typeof error === 'string' || typeof error === 'number' || typeof error === 'boolean' || error === null) {
    return error
  }

  return '插件回调执行失败'
}
