/**
 * 职责：提供 Gate 4.5 native worker 的纯函数消息运行时。
 * 边界：不直接创建 Web Worker，不读取 DOM，不访问 core 内部 store。
 * 协作模块：index.ts 的保存、打开、校验 API 和后续 vanilla 按需 worker host。
 * 性能/安全约束：取消请求通过 AbortController 传递，成功保存时允许转移 ArrayBuffer。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#iteration-1---4xianjword-native-公开-api-与-worker。
 */
import {
  createJWordNativeErrorEvent,
  createJWordNativeTransferables,
  loadJWordDocument,
  saveJWordDocument,
  serializeJWordNativePackageError,
  validateJWordPackage,
  type JWordNativeProgressEvent,
  type JWordNativeTransferable,
  type JWordNativeWorkerEvent,
  type JWordNativeWorkerRequest,
  type JWordPackageWarning
} from './index.js'

export type JWordNativeWorkerPostEvent = (
  event: JWordNativeWorkerEvent,
  transferables: readonly JWordNativeTransferable[]
) => void

interface JWordNativeWorkerActiveTask {
  readonly controller: AbortController
  cancelledByWorker: boolean
}

interface JWordNativeWorkerRuntimeScope {
  readonly addEventListener?: (
    type: 'message',
    listener: (event: MessageEvent<JWordNativeWorkerRequest>) => void
  ) => void
  readonly postMessage?: (
    event: JWordNativeWorkerEvent,
    transferables: readonly JWordNativeTransferable[]
  ) => void
}

const activeJWordNativeWorkerTasks = new Map<string, JWordNativeWorkerActiveTask>()

/** 分发 native worker 请求并回发稳定事件。 */
export async function dispatchJWordNativeWorkerRequest(
  request: JWordNativeWorkerRequest,
  postEvent: JWordNativeWorkerPostEvent
): Promise<JWordNativeWorkerEvent> {
  if (request.type === 'cancel') {
    const task = activeJWordNativeWorkerTasks.get(request.requestId)

    task?.controller.abort()
    if (task !== undefined) {
      task.cancelledByWorker = true
    }

    const event = createJWordNativeWorkerCancelledEvent(request.requestId)

    postEvent(event, [])

    return event
  }

  const task: JWordNativeWorkerActiveTask = {
    controller: new AbortController(),
    cancelledByWorker: false
  }
  const releaseSignal = bindJWordNativeAbortSignal(request.options?.signal, task.controller)

  activeJWordNativeWorkerTasks.set(request.requestId, task)

  try {
    const event = await handleJWordNativeWorkerRequest(request, task.controller.signal, postEvent)

    if (!task.cancelledByWorker) {
      postEvent(event, readJWordNativeWorkerEventTransferables(event))
    }

    return event
  } catch (error) {
    const event = createJWordNativeErrorEvent(
      request.requestId,
      serializeJWordNativePackageError(error, request.requestId)
    )

    if (!task.cancelledByWorker) {
      postEvent(event, [])
    }

    return event
  } finally {
    releaseSignal()

    if (activeJWordNativeWorkerTasks.get(request.requestId) === task) {
      activeJWordNativeWorkerTasks.delete(request.requestId)
    }
  }
}

/** 绑定真实 worker 全局 scope。 */
export function bindJWordNativeWorkerRuntime(scope: JWordNativeWorkerRuntimeScope): void {
  scope.addEventListener?.('message', (event) => {
    void dispatchJWordNativeWorkerRequest(event.data, (response, transferables) => {
      scope.postMessage?.(response, transferables)
    })
  })
}

/** 处理非取消 worker 请求。 */
async function handleJWordNativeWorkerRequest(
  request: Exclude<JWordNativeWorkerRequest, { readonly type: 'cancel' }>,
  signal: AbortSignal,
  postEvent: JWordNativeWorkerPostEvent
): Promise<JWordNativeWorkerEvent> {
  const onProgress = createProgressPoster(request.requestId, postEvent)
  const onWarning = createWarningPoster(request.requestId, postEvent)

  if (request.type === 'save') {
    const result = await saveJWordDocument(request.document, {
      ...request.options,
      requestId: request.options?.requestId ?? request.requestId,
      signal,
      onProgress
    })

    return {
      type: 'save-result',
      requestId: request.requestId,
      result
    }
  }

  if (request.type === 'validate') {
    const result = await validateJWordPackage(request.input, {
      ...request.options,
      requestId: request.options?.requestId ?? request.requestId,
      signal,
      onProgress
    })

    return {
      type: 'validate-result',
      requestId: request.requestId,
      result
    }
  }

  const result = await loadJWordDocument(request.input, {
    ...request.options,
    requestId: request.options?.requestId ?? request.requestId,
    signal,
    onProgress,
    onWarning
  })

  return {
    type: 'load-result',
    requestId: request.requestId,
    result
  }
}

/** 创建 worker cancel 消息对应的稳定事件。 */
function createJWordNativeWorkerCancelledEvent(requestId: string): JWordNativeWorkerEvent {
  return createJWordNativeErrorEvent(requestId, {
    name: 'JWordNativePackageError',
    code: 'JWORD_NATIVE_WORKER_CANCELLED',
    message: '任务已取消',
    recoverable: false,
    requestId
  })
}

/** 把调用方 signal 接到 worker 内部 controller。 */
function bindJWordNativeAbortSignal(
  source: AbortSignal | undefined,
  controller: AbortController
): () => void {
  if (source === undefined) {
    return noop
  }

  if (source.aborted) {
    controller.abort()

    return noop
  }

  const abort = (): void => {
    controller.abort()
  }

  source.addEventListener('abort', abort, { once: true })

  return () => {
    source.removeEventListener('abort', abort)
  }
}

/** 创建进度事件转发器。 */
function createProgressPoster(
  requestId: string,
  postEvent: JWordNativeWorkerPostEvent
): (event: JWordNativeProgressEvent) => void {
  return (progress) => {
    postEvent({
      type: 'progress',
      requestId,
      progress
    }, [])
  }
}

/** 创建 warning 事件转发器。 */
function createWarningPoster(
  requestId: string,
  postEvent: JWordNativeWorkerPostEvent
): (warning: JWordPackageWarning) => void {
  return (warning) => {
    postEvent({
      type: 'warning',
      requestId,
      warning
    }, [])
  }
}

/** 读取 worker 事件里可转移的二进制。 */
function readJWordNativeWorkerEventTransferables(event: JWordNativeWorkerEvent): readonly JWordNativeTransferable[] {
  if (event.type !== 'save-result') {
    return []
  }

  return createJWordNativeTransferables(event.result.bytes)
}

/** 空释放函数，减少调用方分支。 */
function noop(): void {}
