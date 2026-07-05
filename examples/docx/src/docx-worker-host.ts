/**
 * 职责：为 examples/docx 提供真实 DOCX module worker 的请求/响应封装。
 * 边界：只处理浏览器 Worker 生命周期、消息协议、progress/warning/error 转换，不实现 DOCX 导入导出语义。
 * 协作模块：examples/docx/src/main.ts、@4xian/jword-docx/worker 和 DOCX worker message contract。
 * 性能/安全约束：按需创建 worker，取消时发送稳定 cancel 消息，销毁时终止 worker。
 * Specs：docs/superpowers/reports/2026-07-02-gate45-gate5-review.md#八横切问题跨包。
 */

import type {
  DocxBinaryInput,
  DocxError,
  DocxProgressEvent,
  DocxTransferable,
  DocxWarning,
  DocxWorkerEvent,
  DocxWorkerRequest,
  ExportDocxResult,
  ExportDocxResultEvent,
  ImportDocxResult,
  ImportDocxResultEvent
} from '@4xian/jword-docx'
import type { DocumentProjection } from '@4xian/jword-core'
import type { JWordLicenseEntitlement } from '@4xian/jword-license'

type DocxWorkerTaskKind = 'import' | 'export'

export interface DocxWorkerHostTaskOptions {
  readonly requestId: string
  readonly signal?: AbortSignal
  readonly license: JWordLicenseEntitlement | null
  readonly onProgress?: (event: DocxProgressEvent) => void
  readonly onWarning?: (warning: DocxWarning) => void
}

export interface DocxWorkerHost {
  importDocx(input: DocxBinaryInput, options: DocxWorkerHostTaskOptions): Promise<ImportDocxResult>
  exportDocx(document: DocumentProjection, options: DocxWorkerHostTaskOptions): Promise<ExportDocxResult>
  cancelProbe(requestId: string): Promise<DocxWorkerEvent>
  readEvents(): readonly string[]
  destroy(): void
}

interface DocxPendingWorkerTask {
  readonly kind: DocxWorkerTaskKind
  readonly requestId: string
  readonly resolve: (event: DocxWorkerEvent) => void
  readonly reject: (error: Error) => void
  readonly onProgress?: (event: DocxProgressEvent) => void
  readonly onWarning?: (warning: DocxWarning) => void
  readonly releaseAbortSignal: () => void
}

/** 创建按需复用的 DOCX Worker host。 */
export function createDocxWorkerHost(): DocxWorkerHost {
  let worker: Worker | null = null
  const events: string[] = []
  const pendingTasks = new Map<string, DocxPendingWorkerTask>()

  /** 确保真实 worker 已创建并绑定消息监听。 */
  function ensureWorker(): Worker {
    if (worker !== null) {
      return worker
    }

    worker = new Worker(new URL('@4xian/jword-docx/worker', import.meta.url), {
      type: 'module'
    })
    worker.addEventListener('message', (event: MessageEvent<DocxWorkerEvent>) => {
      handleWorkerEvent(event.data)
    })
    worker.addEventListener('error', (event) => {
      rejectAllPendingTasks(new Error(event.message))
    })

    return worker
  }

  /** 通过真实 worker 导入 DOCX。 */
  function importDocx(input: DocxBinaryInput, options: DocxWorkerHostTaskOptions): Promise<ImportDocxResult> {
    return postWorkerRequest<ImportDocxResult, ImportDocxResultEvent>({
      type: 'import',
      requestId: options.requestId,
      input,
      options: {
        requestId: options.requestId,
        license: options.license
      }
    }, 'import', options, isImportResultEvent)
  }

  /** 通过真实 worker 导出 DOCX。 */
  function exportDocx(document: DocumentProjection, options: DocxWorkerHostTaskOptions): Promise<ExportDocxResult> {
    return postWorkerRequest<ExportDocxResult, ExportDocxResultEvent>({
      type: 'export',
      requestId: options.requestId,
      document,
      options: {
        requestId: options.requestId,
        license: options.license
      }
    }, 'export', options, isExportResultEvent)
  }

  /** 发送取消探针，供 e2e 验证真实 worker cancel 协议。 */
  function cancelProbe(requestId: string): Promise<DocxWorkerEvent> {
    return new Promise((resolve) => {
      pendingTasks.set(requestId, {
        kind: 'import',
        requestId,
        resolve,
        reject: () => resolve({
          type: 'error',
          requestId,
          error: {
            name: 'DocxUnsupportedError',
            code: 'DOCX_WORKER_ERROR',
            message: 'cancel probe rejected',
            requestId
          }
        }),
        releaseAbortSignal: noop
      })
      postWorkerMessage(createDocxDemoCancelRequest(requestId), [])
    })
  }

  /** 读取 worker 协议事件摘要。 */
  function readEvents(): readonly string[] {
    return [...events]
  }

  /** 销毁 worker host 并拒绝全部待处理任务。 */
  function destroy(): void {
    rejectAllPendingTasks(new Error('DOCX worker host destroyed'))
    worker?.terminate()
    worker = null
  }

  /** 投递 worker 请求并等待指定结果事件。 */
  function postWorkerRequest<Result, ResultEvent extends DocxWorkerEvent>(
    request: DocxWorkerRequest,
    kind: DocxWorkerTaskKind,
    options: DocxWorkerHostTaskOptions,
    isResultEvent: (event: DocxWorkerEvent) => event is ResultEvent & { readonly result: Result }
  ): Promise<Result> {
    return new Promise((resolve, reject) => {
      const releaseAbortSignal = bindAbortSignal(options, () => {
        postWorkerMessage(createDocxDemoCancelRequest(options.requestId), [])
      })
      const task: DocxPendingWorkerTask = removeUndefinedWorkerTaskHandlers({
        kind,
        requestId: options.requestId,
        resolve(event) {
          if (isResultEvent(event)) {
            resolve(event.result)
            return
          }

          reject(createUnexpectedDocxWorkerEventError(event))
        },
        reject,
        onProgress: options.onProgress,
        onWarning: options.onWarning,
        releaseAbortSignal
      })

      pendingTasks.set(options.requestId, task)
      postWorkerMessage(request, readWorkerTransferables(request))
    })
  }

  /** 发送 worker 消息。 */
  function postWorkerMessage(request: DocxWorkerRequest, transferables: readonly DocxTransferable[]): void {
    ensureWorker().postMessage(request, [...transferables])
  }

  /** 处理 worker 回包事件。 */
  function handleWorkerEvent(event: DocxWorkerEvent): void {
    events.push(formatDocxWorkerEvent(event))

    const task = pendingTasks.get(event.requestId)

    if (task === undefined) {
      return
    }

    if (event.type === 'progress') {
      task.onProgress?.(event)
      return
    }

    if (event.type === 'warning') {
      task.onWarning?.(event.warning)
      return
    }

    pendingTasks.delete(event.requestId)
    task.releaseAbortSignal()

    if (event.type === 'error') {
      task.reject(createDocxWorkerEventError(event.error))
      return
    }

    task.resolve(event)
  }

  /** 拒绝全部待处理任务。 */
  function rejectAllPendingTasks(error: Error): void {
    for (const task of pendingTasks.values()) {
      task.releaseAbortSignal()
      task.reject(error)
    }

    pendingTasks.clear()
  }

  return {
    importDocx,
    exportDocx,
    cancelProbe,
    readEvents,
    destroy
  }
}

/** 把 request 上的 transferables 归一化为浏览器 postMessage 参数。 */
function readWorkerTransferables(request: DocxWorkerRequest): readonly DocxTransferable[] {
  if (request.type !== 'import') {
    return []
  }

  return readDocxDemoTransferables(request.input)
}

/** 把 AbortSignal 转发为 worker cancel 请求。 */
function bindAbortSignal(options: DocxWorkerHostTaskOptions, onAbort: () => void): () => void {
  if (options.signal === undefined) {
    return noop
  }

  if (options.signal.aborted) {
    onAbort()
    return noop
  }

  options.signal.addEventListener('abort', onAbort, { once: true })

  return () => {
    options.signal?.removeEventListener('abort', onAbort)
  }
}

/** 移除 undefined 可选回调，满足 exactOptionalPropertyTypes。 */
function removeUndefinedWorkerTaskHandlers(
  task: Omit<DocxPendingWorkerTask, 'onProgress' | 'onWarning'> & {
    readonly onProgress: ((event: DocxProgressEvent) => void) | undefined
    readonly onWarning: ((warning: DocxWarning) => void) | undefined
  }
): DocxPendingWorkerTask {
  return {
    kind: task.kind,
    requestId: task.requestId,
    resolve: task.resolve,
    reject: task.reject,
    releaseAbortSignal: task.releaseAbortSignal,
    ...(task.onProgress === undefined ? {} : { onProgress: task.onProgress }),
    ...(task.onWarning === undefined ? {} : { onWarning: task.onWarning })
  }
}

/** 创建 demo 侧 cancel 请求，避免首屏静态导入 DOCX 根入口。 */
function createDocxDemoCancelRequest(requestId: string): DocxWorkerRequest {
  return {
    type: 'cancel',
    requestId
  }
}

/** 提取 DOCX 二进制输入可转移的底层 ArrayBuffer。 */
function readDocxDemoTransferables(input: DocxBinaryInput): readonly DocxTransferable[] {
  if (input instanceof ArrayBuffer) {
    return [input]
  }

  if (ArrayBuffer.isView(input) && input.buffer instanceof ArrayBuffer) {
    return [input.buffer]
  }

  return []
}

/** 判断事件是否是 DOCX import 结果。 */
function isImportResultEvent(event: DocxWorkerEvent): event is ImportDocxResultEvent {
  return event.type === 'import-result'
}

/** 判断事件是否是 DOCX export 结果。 */
function isExportResultEvent(event: DocxWorkerEvent): event is ExportDocxResultEvent {
  return event.type === 'export-result'
}

/** 创建非预期 worker 事件错误。 */
function createUnexpectedDocxWorkerEventError(event: DocxWorkerEvent): Error {
  return new Error(`Unexpected DOCX worker event: ${event.type}`)
}

/** 把 worker error event 转换成可被 demo 统一展示的 Error。 */
function createDocxWorkerEventError(error: DocxError): Error & DocxError {
  const wrapped = new Error(error.message) as Error & DocxError

  wrapped.name = error.name
  Object.assign(wrapped, error)

  return wrapped
}

/** 格式化 worker 事件摘要供 e2e 断言。 */
function formatDocxWorkerEvent(event: DocxWorkerEvent): string {
  if (event.type === 'progress') {
    return `${event.type}:${event.requestId}:${event.stage}`
  }

  if (event.type === 'error') {
    return `${event.type}:${event.requestId}:${event.error.code}`
  }

  return `${event.type}:${event.requestId}`
}

/** 空释放函数。 */
function noop(): void {}
