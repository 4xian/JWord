/**
 * 职责：承接 vanilla demo 的 Gate 4.5 原生 `.jword` 保存/打开宿主接线。
 * 边界：只通过 `@4xian/jword-native` 公开 API 调用，不读取 native/core 内部源码或 store。
 * 协作模块：`@4xian/jword-core` Editor facade、`@4xian/jword-native` lazy runtime 与 demo 状态 DOM。
 * 性能/安全约束：native runtime 只在保存/打开触发时按需加载，长任务期间不锁定编辑器输入。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import type { Document, Editor } from '@4xian/jword-core'

interface CreateNativeDemoPersistenceOptions {
  readonly editor: Editor
  readonly host: HTMLElement
  readonly refreshUi: () => void
}

interface NativeDemoElements {
  readonly saveButton: HTMLButtonElement
  readonly openButton: HTMLButtonElement
  readonly fileInput: HTMLInputElement
  readonly statusHost: HTMLElement
  readonly warningsHost: HTMLElement
}

interface NativeDemoPersistenceHandle {
  readonly destroy: () => void
  readonly save: () => Promise<Blob | null>
  readonly openSelectedFile: () => Promise<boolean>
  readonly readStatus: () => string
  readonly readWarnings: () => readonly NativeWarning[]
  readonly readLastSavedByteLength: () => number | null
  readonly readRuntimeLoaded: () => boolean
}

interface NativeProgressEvent {
  readonly stage?: string
  readonly message?: string
  readonly loaded?: number
  readonly total?: number
}

interface NativeWarning {
  readonly code?: string
  readonly message?: string
  readonly path?: string
}

interface NativeSaveResult {
  readonly blob?: Blob
  readonly bytes?: ArrayBuffer | Uint8Array
  readonly warnings?: readonly NativeWarning[]
}

interface NativeLoadResult {
  readonly document: Document
  readonly warnings?: readonly NativeWarning[]
  readonly migration?: unknown
}

interface NativeRuntime {
  readonly saveJWordDocument: (
    document: Document,
    options?: NativeTaskOptions
  ) => Promise<NativeSaveResult | Blob | ArrayBuffer | Uint8Array>
  readonly loadJWordDocument: (input: Blob | ArrayBuffer | Uint8Array, options?: NativeTaskOptions) => Promise<NativeLoadResult>
  readonly validateJWordPackage?: (input: Blob | ArrayBuffer | Uint8Array, options?: NativeTaskOptions) => Promise<unknown>
}

interface NativeWorkerRuntime extends NativeRuntime {
  readonly destroy: () => void
}

interface NativeTaskOptions {
  readonly requestId: string
  readonly signal?: AbortSignal
  readonly onProgress?: (event: NativeProgressEvent) => void
  readonly onWarning?: (warning: NativeWarning) => void
}

interface NativeWorkerPendingTask {
  readonly options: NativeTaskOptions | undefined
  readonly resolve: (result: unknown) => void
  readonly reject: (error: Error) => void
  readonly releaseAbort: () => void
}

type NativeWorkerRequest =
  | {
      readonly type: 'save'
      readonly requestId: string
      readonly document: Document
      readonly options: { readonly requestId: string }
    }
  | {
      readonly type: 'load' | 'validate'
      readonly requestId: string
      readonly input: Blob | ArrayBuffer | Uint8Array
      readonly options: { readonly requestId: string }
    }
  | {
      readonly type: 'cancel'
      readonly requestId: string
    }

type NativeWorkerEvent =
  | {
      readonly type: 'progress'
      readonly requestId: string
      readonly progress: NativeProgressEvent
    }
  | {
      readonly type: 'warning'
      readonly requestId: string
      readonly warning: NativeWarning
    }
  | {
      readonly type: 'save-result' | 'load-result' | 'validate-result'
      readonly requestId: string
      readonly result: unknown
    }
  | {
      readonly type: 'error'
      readonly requestId: string
      readonly error: NativeWorkerErrorShape
    }

interface NativeWorkerErrorShape {
  readonly name: string
  readonly code?: string
  readonly message: string
  readonly recoverable?: boolean
  readonly entry?: string
  readonly requestId?: string
}

let nativeRuntimePromise: Promise<NativeWorkerRuntime> | null = null
let nativeRuntimeHandle: NativeWorkerRuntime | null = null

/** 创建 vanilla demo 原生保存/打开控制器。 */
export function createNativeDemoPersistence(input: CreateNativeDemoPersistenceOptions): NativeDemoPersistenceHandle {
  const elements = queryNativeDemoElements(input.host)
  const signalController = new AbortController()
  let currentDownloadUrl: string | null = null
  let isBusy = false
  let lastSavedByteLength: number | null = null
  let lastWarnings: readonly NativeWarning[] = []

  /** 写入 warning 面板并缓存测试可读状态。 */
  function setWarnings(warnings: readonly NativeWarning[]): void {
    lastWarnings = warnings
    elements.warningsHost.textContent = warnings.length === 0 ? '' : formatWarnings(warnings)
  }

  /** 写入原生任务状态。 */
  function setStatus(message: string): void {
    elements.statusHost.textContent = message
  }

  /** 切换保存/打开按钮忙碌状态，但不影响 editor 继续输入。 */
  function setBusy(nextBusy: boolean): void {
    isBusy = nextBusy
    elements.saveButton.disabled = nextBusy
    elements.openButton.disabled = nextBusy
  }

  /** 从当前 editor 保存 `.jword` 并生成下载链接。 */
  async function save(): Promise<Blob | null> {
    if (isBusy) {
      return null
    }

    return runNativeTask('save', '正在保存 .jword...', async (runtime, options) => {
      const result = await runtime.saveJWordDocument(input.editor.getProjection().document, options)
      const blob = normalizeSaveBlob(result)
      const warnings = mergeWarnings(lastWarnings, collectResultWarnings(result))

      lastSavedByteLength = blob.size
      setWarnings(warnings)
      replaceCurrentDownload(currentDownloadUrl, blob)
      currentDownloadUrl = createDownload(blob)
      setStatus(`.jword 保存完成：${blob.size} bytes`)

      return blob
    })
  }

  /** 打开当前文件输入选择的 `.jword` 并加载回 editor。 */
  async function openSelectedFile(): Promise<boolean> {
    if (isBusy) {
      return false
    }

    const file = elements.fileInput.files?.[0]

    if (file === undefined) {
      setStatus('请选择 .jword 文件后再打开。')
      return false
    }

    await runNativeTask('open', `正在打开 ${file.name}...`, async (runtime, options) => {
      const result = await runtime.loadJWordDocument(file, options)

      input.editor.loadDocumentModel({ document: result.document })
      input.refreshUi()
      setWarnings(mergeWarnings(lastWarnings, result.warnings ?? []))
      setStatus(`.jword 打开完成：${file.name}`)

      return result
    })

    return true
  }

  elements.saveButton.addEventListener(
    'click',
    () => {
      void save()
    },
    { signal: signalController.signal }
  )
  elements.openButton.addEventListener(
    'click',
    () => {
      elements.fileInput.click()
    },
    { signal: signalController.signal }
  )
  elements.fileInput.addEventListener(
    'change',
    () => {
      void openSelectedFile()
    },
    { signal: signalController.signal }
  )

  setWarnings([])
  setStatus('原生保存/打开就绪。')

  return {
    destroy: () => {
      signalController.abort()
      if (currentDownloadUrl !== null) {
        URL.revokeObjectURL(currentDownloadUrl)
      }
      nativeRuntimeHandle?.destroy()
      nativeRuntimeHandle = null
      nativeRuntimePromise = null
    },
    save,
    openSelectedFile,
    readStatus: () => elements.statusHost.textContent ?? '',
    readWarnings: () => lastWarnings,
    readLastSavedByteLength: () => lastSavedByteLength,
    readRuntimeLoaded: () => nativeRuntimeHandle !== null
  }

  /** 运行 native 异步任务并统一处理 progress/error。 */
  async function runNativeTask<T>(
    kind: 'save' | 'open',
    startMessage: string,
    task: (runtime: NativeRuntime, options: NativeTaskOptions) => Promise<T>
  ): Promise<T> {
    setBusy(true)
    setStatus(startMessage)
    setWarnings([])

    const warnings: NativeWarning[] = []
    const requestId = `examples-vanilla-native-${kind}-${Date.now()}`

    try {
      const runtime = await loadNativeRuntime()
      const result = await task(runtime, {
        requestId,
        onProgress(event) {
          setStatus(formatProgress(kind, event))
        },
        onWarning(warning) {
          warnings.push(warning)
          setWarnings(warnings)
        }
      })

      return result
    } catch (error) {
      setStatus(`.jword ${kind === 'save' ? '保存' : '打开'}失败：${readErrorMessage(error)}`)
      throw error
    } finally {
      setBusy(false)
    }
  }
}

/** 读取 demo 原生保存/打开所需 DOM 节点。 */
function queryNativeDemoElements(host: HTMLElement): NativeDemoElements {
  return {
    saveButton: requireElement(host, '[data-jword-native-save="true"]', 'JWord vanilla demo requires native save button.'),
    openButton: requireElement(
      host,
      '[data-jword-native-open-button="true"]',
      'JWord vanilla demo requires native open button.'
    ),
    fileInput: requireElement(host, '[data-jword-native-file="true"]', 'JWord vanilla demo requires native file input.'),
    statusHost: requireElement(host, '[data-jword-native-status="true"]', 'JWord vanilla demo requires native status.'),
    warningsHost: requireElement(host, '[data-jword-native-warnings="true"]', 'JWord vanilla demo requires native warnings.')
  }
}

/** 按选择器读取必需元素。 */
function requireElement<ElementType extends HTMLElement>(host: HTMLElement, selector: string, message: string): ElementType {
  const element = host.querySelector<ElementType>(selector)

  if (element === null) {
    throw new Error(message)
  }

  return element
}

/** 按需创建 native worker runtime，避免进入 vanilla 首屏静态依赖。 */
function loadNativeRuntime(): Promise<NativeWorkerRuntime> {
  nativeRuntimePromise ??= Promise.resolve(createNativeWorkerRuntime())

  return nativeRuntimePromise
}

/** 创建主线程到 native worker 的最小 RPC runtime。 */
function createNativeWorkerRuntime(): NativeWorkerRuntime {
  const worker = new Worker(new URL('./native-worker.ts', import.meta.url), {
    type: 'module',
    name: 'jword-native-worker'
  })
  const pendingTasks = new Map<string, NativeWorkerPendingTask>()

  worker.addEventListener('message', (event: MessageEvent<NativeWorkerEvent>) => {
    handleNativeWorkerEvent(event.data, pendingTasks)
  })
  worker.addEventListener('error', (event) => {
    rejectAllNativeWorkerTasks(pendingTasks, new Error(event.message))
  })

  const runtime: NativeWorkerRuntime = {
    saveJWordDocument(document, options) {
      const requestId = options?.requestId ?? createNativeRequestId('save')

      return runNativeWorkerRequest<NativeSaveResult | Blob | ArrayBuffer | Uint8Array>(worker, pendingTasks, {
        type: 'save',
        requestId,
        document,
        options: { requestId }
      }, options)
    },
    loadJWordDocument(input, options) {
      const requestId = options?.requestId ?? createNativeRequestId('open')

      return runNativeWorkerRequest<NativeLoadResult>(worker, pendingTasks, {
        type: 'load',
        requestId,
        input,
        options: { requestId }
      }, options)
    },
    validateJWordPackage(input, options) {
      const requestId = options?.requestId ?? createNativeRequestId('validate')

      return runNativeWorkerRequest<unknown>(worker, pendingTasks, {
        type: 'validate',
        requestId,
        input,
        options: { requestId }
      }, options)
    },
    destroy() {
      worker.terminate()
      rejectAllNativeWorkerTasks(pendingTasks, new Error('native worker destroyed.'))
    }
  }

  nativeRuntimeHandle = runtime

  return runtime
}

/** 向 native worker 发送请求并等待对应 requestId 的结果。 */
function runNativeWorkerRequest<Result>(
  worker: Worker,
  pendingTasks: Map<string, NativeWorkerPendingTask>,
  request: NativeWorkerRequest,
  options: NativeTaskOptions | undefined
): Promise<Result> {
  return new Promise((resolve, reject) => {
    const releaseAbort = bindNativeWorkerAbort(worker, request.requestId, options?.signal)

    pendingTasks.set(request.requestId, {
      options,
      resolve: (result) => {
        resolve(result as Result)
      },
      reject,
      releaseAbort
    })
    worker.postMessage(request)
  })
}

/** 根据 AbortSignal 转发 native worker cancel 请求。 */
function bindNativeWorkerAbort(
  worker: Worker,
  requestId: string,
  signal: AbortSignal | undefined
): () => void {
  if (signal === undefined) {
    return () => {}
  }

  const abort = (): void => {
    worker.postMessage({
      type: 'cancel',
      requestId
    } satisfies NativeWorkerRequest)
  }

  if (signal.aborted) {
    abort()

    return () => {}
  }

  signal.addEventListener('abort', abort, { once: true })

  return () => {
    signal.removeEventListener('abort', abort)
  }
}

/** 处理 native worker 返回的 progress、warning、result 和 error。 */
function handleNativeWorkerEvent(
  event: NativeWorkerEvent,
  pendingTasks: Map<string, NativeWorkerPendingTask>
): void {
  const task = pendingTasks.get(event.requestId)

  if (task === undefined) {
    return
  }

  if (event.type === 'progress') {
    task.options?.onProgress?.(event.progress)
    return
  }

  if (event.type === 'warning') {
    task.options?.onWarning?.(event.warning)
    return
  }

  pendingTasks.delete(event.requestId)
  task.releaseAbort()

  if (event.type === 'error') {
    task.reject(createNativeWorkerError(event.error))
    return
  }

  task.resolve(event.result)
}

/** 把 worker error 事件转换为普通 Error，并保留诊断字段。 */
function createNativeWorkerError(shape: NativeWorkerErrorShape): Error {
  const error = new Error(shape.message)

  error.name = shape.name
  Object.assign(error, {
    ...(shape.code === undefined ? {} : { code: shape.code }),
    ...(shape.recoverable === undefined ? {} : { recoverable: shape.recoverable }),
    ...(shape.entry === undefined ? {} : { entry: shape.entry }),
    ...(shape.requestId === undefined ? {} : { requestId: shape.requestId })
  })

  return error
}

/** 拒绝所有等待中的 native worker 请求。 */
function rejectAllNativeWorkerTasks(
  pendingTasks: Map<string, NativeWorkerPendingTask>,
  error: Error
): void {
  for (const [requestId, task] of pendingTasks) {
    pendingTasks.delete(requestId)
    task.releaseAbort()
    task.reject(error)
  }
}

/** 创建 demo worker 请求 ID。 */
function createNativeRequestId(kind: string): string {
  return `examples-vanilla-native-${kind}-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/** 把 native 保存结果统一转成 Blob。 */
function normalizeSaveBlob(result: NativeSaveResult | Blob | ArrayBuffer | Uint8Array): Blob {
  if (result instanceof Blob) {
    return result
  }

  if (result instanceof ArrayBuffer || result instanceof Uint8Array) {
    return createJWordBlob(result)
  }

  if (result.blob instanceof Blob) {
    return result.blob
  }

  if (result.bytes instanceof ArrayBuffer || result.bytes instanceof Uint8Array) {
    return createJWordBlob(result.bytes)
  }

  throw new Error('native save result missing blob or bytes.')
}

/** 从保存结果中读取 warning。 */
function collectResultWarnings(result: NativeSaveResult | Blob | ArrayBuffer | Uint8Array): readonly NativeWarning[] {
  if (result instanceof Blob || result instanceof ArrayBuffer || result instanceof Uint8Array) {
    return []
  }

  return result.warnings ?? []
}

/** 合并 progress 回调与最终结果里的 warning。 */
function mergeWarnings(first: readonly NativeWarning[], second: readonly NativeWarning[]): readonly NativeWarning[] {
  if (first.length === 0) {
    return second
  }

  if (second.length === 0) {
    return first
  }

  return [...first, ...second]
}

/** 创建 JWord 原生格式 Blob。 */
function createJWordBlob(bytes: ArrayBuffer | Uint8Array): Blob {
  return new Blob([normalizeBlobBytes(bytes)], { type: 'application/vnd.jword' })
}

/** 把 Uint8Array 复制成 Blob 可接受的 ArrayBuffer。 */
function normalizeBlobBytes(bytes: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (bytes instanceof ArrayBuffer) {
    return bytes
  }

  const copy = new Uint8Array(bytes.byteLength)

  copy.set(bytes)

  return copy.buffer
}

/** 替换现有下载 URL 前释放旧 URL。 */
function replaceCurrentDownload(currentDownloadUrl: string | null, blob: Blob): void {
  if (currentDownloadUrl !== null) {
    URL.revokeObjectURL(currentDownloadUrl)
  }

  if (blob.size === 0) {
    throw new Error('native save result is empty.')
  }
}

/** 创建下载锚点并触发浏览器下载。 */
function createDownload(blob: Blob): string {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')

  link.href = url
  link.download = 'jword-demo.jword'
  link.rel = 'noopener'
  link.style.display = 'none'
  document.body.append(link)
  link.click()
  link.remove()

  return url
}

/** 格式化 native progress。 */
function formatProgress(kind: 'save' | 'open', event: NativeProgressEvent): string {
  const action = kind === 'save' ? '保存' : '打开'
  const stage = event.message ?? event.stage ?? 'processing'
  const amount = event.loaded === undefined || event.total === undefined ? '' : ` ${event.loaded}/${event.total}`

  return `.jword ${action}进度：${stage}${amount}`
}

/** 格式化 warning 列表。 */
function formatWarnings(warnings: readonly NativeWarning[]): string {
  return warnings
    .map((warning) => {
      const code = warning.code ?? 'JWORD_NATIVE_WARNING'
      const message = warning.message ?? '未提供详情'
      const path = warning.path === undefined ? '' : ` @ ${warning.path}`

      return `${code}: ${message}${path}`
    })
    .join('\n')
}

/** 读取异常消息。 */
function readErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}
