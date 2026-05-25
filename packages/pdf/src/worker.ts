/**
 * 职责：提供 Gate 5 PDF worker 的最小消息入口。
 * 边界：只负责接收 worker 请求、调用公开请求处理器并回发响应，不实现 PDF 绘制。
 * 协作模块：index.ts 的 PdfWorkerRequest/PdfWorkerResponse 和 handlePdfWorkerRequest。
 * 性能/安全约束：成功导出时转移 ArrayBuffer；当前未实现导出时只返回稳定错误响应。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#iteration-21---建立-packagespdf-与-pdf-worker。
 */

import {
  createPdfTransferables,
  handlePdfWorkerRequest,
  type PdfTransferable,
  type PdfWorkerRequest,
  type PdfWorkerResponse
} from './index'

export type PdfWorkerPostResponse = (
  response: PdfWorkerResponse,
  transferables: readonly PdfTransferable[]
) => void

interface PdfWorkerActiveTask {
  readonly controller: AbortController
  cancelledByWorker: boolean
}

interface PdfWorkerRuntimeScope {
  readonly addEventListener?: (
    type: 'message',
    listener: (event: MessageEvent<PdfWorkerRequest>) => void
  ) => void
  readonly postMessage?: (
    response: PdfWorkerResponse,
    transferables: readonly PdfTransferable[]
  ) => void
}

const activePdfWorkerTasks = new Map<string, PdfWorkerActiveTask>()

/** 分发 PDF worker 请求并回发稳定响应。 */
export async function dispatchPdfWorkerRequest(
  request: PdfWorkerRequest,
  postResponse: PdfWorkerPostResponse
): Promise<PdfWorkerResponse> {
  if (request.kind === 'cancel') {
    const task = activePdfWorkerTasks.get(request.requestId)

    task?.controller.abort()
    if (task !== undefined) {
      task.cancelledByWorker = true
    }

    const response = await handlePdfWorkerRequest(request)

    postResponse(response, [])

    return response
  }

  const requestId = request.requestId ?? request.options.requestId
  const task: PdfWorkerActiveTask = {
    controller: new AbortController(),
    cancelledByWorker: false
  }
  const releaseSignal = bindPdfAbortSignal(request.options.signal, task.controller)

  if (requestId !== undefined) {
    activePdfWorkerTasks.set(requestId, task)
  }

  try {
    const response = await handlePdfWorkerRequest(request, task.controller.signal)

    if (!task.cancelledByWorker) {
      postResponse(response, readPdfWorkerResponseTransferables(response))
    }

    return response
  } finally {
    releaseSignal()

    if (requestId !== undefined && activePdfWorkerTasks.get(requestId) === task) {
      activePdfWorkerTasks.delete(requestId)
    }
  }
}

/** 读取 worker 响应里可以转移的二进制资源。 */
function readPdfWorkerResponseTransferables(response: PdfWorkerResponse): readonly PdfTransferable[] {
  if (response.kind !== 'result') {
    return []
  }

  return createPdfTransferables(response.result.bytes)
}

/** 把调用方 signal 接到 worker 内部 controller。 */
function bindPdfAbortSignal(
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

/** 空释放函数，减少调用方分支。 */
function noop(): void {}

/** 在真实 worker 环境注册 message 监听。 */
function registerPdfWorkerRuntime(): void {
  const scope = globalThis as PdfWorkerRuntimeScope

  if (typeof scope.addEventListener !== 'function' || typeof scope.postMessage !== 'function') {
    return
  }

  scope.addEventListener('message', (event: MessageEvent<PdfWorkerRequest>) => {
    void dispatchPdfWorkerRequest(event.data, (response, transferables) => {
      scope.postMessage?.(response, transferables)
    })
  })
}

registerPdfWorkerRuntime()
