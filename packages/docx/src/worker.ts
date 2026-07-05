/**
 * 职责：提供 Gate 5 DOCX worker 的最小消息入口。
 * 边界：只负责接收 worker 请求、调用公开 DOCX API 并回发响应，不直接访问 core store 或 Y.Doc。
 * 协作模块：index.ts 的 DocxWorkerRequest/DocxWorkerEvent、importDocx、exportDocx 和 inspectDocxPackage。
 * 性能/安全约束：成功导出时转移 ArrayBuffer；取消请求返回稳定错误事件。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#iteration-26---建立-benchmarkbundle-和回归门禁。
 */

import {
  assertJWordFeatureEntitled,
  isJWordLicenseDiagnosticCode,
  type JWordLicenseFeatureKey
} from '@4xian/jword-license'
import {
  createDocxErrorEvent,
  createDocxProgressEvent,
  createDocxTransferables,
  exportDocx,
  importDocx,
  inspectDocxPackage,
  isDocxErrorCode,
  type DocxError,
  type DocxTransferable,
  type DocxWorkerEvent,
  type DocxWorkerRequest
} from './index.js'
import type { DocxProgressStage } from './types.js'

export type DocxWorkerPostEvent = (
  event: DocxWorkerEvent,
  transferables: readonly DocxTransferable[]
) => void

interface DocxWorkerActiveTask {
  readonly controller: AbortController
  cancelledByWorker: boolean
}

interface DocxWorkerRuntimeScope {
  readonly addEventListener?: (
    type: 'message',
    listener: (event: MessageEvent<DocxWorkerRequest>) => void
  ) => void
  readonly postMessage?: (
    event: DocxWorkerEvent,
    transferables: readonly DocxTransferable[]
  ) => void
}

const activeDocxWorkerTasks = new Map<string, DocxWorkerActiveTask>()
const cancelledDocxWorkerRequestIds = new Set<string>()

/** 分发 DOCX worker 请求并回发稳定事件。 */
export async function dispatchDocxWorkerRequest(
  request: DocxWorkerRequest,
  postEvent: DocxWorkerPostEvent
): Promise<DocxWorkerEvent> {
  if (request.type === 'cancel') {
    const task = activeDocxWorkerTasks.get(request.requestId)

    task?.controller.abort()
    if (task !== undefined) {
      task.cancelledByWorker = true
    } else {
      cancelledDocxWorkerRequestIds.add(request.requestId)
    }

    const event = createDocxWorkerCancelledEvent(request.requestId)

    postEvent(event, [])

    return event
  }

  const task: DocxWorkerActiveTask = {
    controller: new AbortController(),
    cancelledByWorker: false
  }
  const releaseSignal = bindDocxAbortSignal(request.options?.signal, task.controller)

  activeDocxWorkerTasks.set(request.requestId, task)

  try {
    if (cancelledDocxWorkerRequestIds.delete(request.requestId)) {
      task.controller.abort()
      task.cancelledByWorker = true

      return createDocxWorkerCancelledEvent(request.requestId)
    }

    const event = await handleDocxWorkerRequest(request, task.controller.signal, postEvent)

    if (!task.cancelledByWorker) {
      postEvent(event, readDocxWorkerEventTransferables(event))
    }

    return event
  } finally {
    releaseSignal()

    if (activeDocxWorkerTasks.get(request.requestId) === task) {
      activeDocxWorkerTasks.delete(request.requestId)
    }
  }
}

/** 处理 DOCX worker 请求。 */
async function handleDocxWorkerRequest(
  request: DocxWorkerRequest,
  signal: AbortSignal,
  postEvent: DocxWorkerPostEvent
): Promise<DocxWorkerEvent> {
  if (request.type === 'cancel') {
    return createDocxWorkerCancelledEvent(request.requestId)
  }

  try {
    if (request.type === 'export') {
      assertDocxWorkerFeature(request, 'docx.export')
      postDocxWorkerProgress(request.requestId, 'queued', postEvent)
      postDocxWorkerProgress(request.requestId, 'writing', postEvent)
      const result = await exportDocx(request.document, {
        ...request.options,
        requestId: request.options?.requestId ?? request.requestId,
        signal
      })
      postDocxWorkerProgress(request.requestId, 'done', postEvent)

      return {
        type: 'export-result',
        requestId: request.requestId,
        result
      }
    }

    if (request.type === 'inspect') {
      assertDocxWorkerFeature(request, 'docx.import')
      postDocxWorkerProgress(request.requestId, 'queued', postEvent)
      postDocxWorkerProgress(request.requestId, 'reading', postEvent)
      const result = await inspectDocxPackage(request.input, {
        ...request.options,
        requestId: request.options?.requestId ?? request.requestId,
        signal
      })
      postDocxWorkerProgress(request.requestId, 'parsing', postEvent)
      postDocxWorkerProgress(request.requestId, 'done', postEvent)

      return {
        type: 'inspect-result',
        requestId: request.requestId,
        result
      }
    }

    assertDocxWorkerFeature(request, 'docx.import')
    postDocxWorkerProgress(request.requestId, 'queued', postEvent)
    postDocxWorkerProgress(request.requestId, 'reading', postEvent)
    const result = await importDocx(request.input, {
      ...request.options,
      requestId: request.options?.requestId ?? request.requestId,
      signal
    })
    postDocxWorkerProgress(request.requestId, 'parsing', postEvent)
    postDocxWorkerProgress(request.requestId, 'mapping', postEvent)
    postDocxWorkerProgress(request.requestId, 'done', postEvent)

    return {
      type: 'import-result',
      requestId: request.requestId,
      result
    }
  } catch (error) {
    return createDocxErrorEvent(request.requestId, readDocxWorkerError(error, request.requestId))
  }
}

/** 投递 DOCX worker 进度事件。 */
function postDocxWorkerProgress(
  requestId: string,
  stage: DocxProgressStage,
  postEvent: DocxWorkerPostEvent
): void {
  postEvent(createDocxProgressEvent(requestId, stage), [])
}

/** 在读取或输出用户文档内容前校验 DOCX worker 高级 feature。 */
function assertDocxWorkerFeature(
  request: DocxWorkerRequest,
  feature: JWordLicenseFeatureKey
): void {
  assertJWordFeatureEntitled(request.type === 'cancel' ? undefined : request.options?.license, feature)
}

/** 创建 worker cancel 消息对应的稳定事件。 */
function createDocxWorkerCancelledEvent(requestId: string): DocxWorkerEvent {
  return createDocxErrorEvent(requestId, {
    name: 'DocxUnsupportedError',
    code: 'DOCX_WORKER_CANCELLED',
    message: '任务已取消',
    requestId
  })
}

/** 把调用方 signal 接到 worker 内部 controller。 */
function bindDocxAbortSignal(
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

/** 读取 worker 事件里可以转移的二进制资源。 */
function readDocxWorkerEventTransferables(event: DocxWorkerEvent): readonly DocxTransferable[] {
  if (event.type !== 'export-result') {
    return []
  }

  return createDocxTransferables(event.result.bytes)
}

/** 把未知异常转换为稳定 DOCX worker 错误。 */
function readDocxWorkerError(error: unknown, requestId: string): DocxError {
  if (isDocxWorkerError(error)) {
    return {
      name: error.name,
      code: error.code,
      message: error.message,
      requestId: error.requestId ?? requestId,
      ...(error.feature === undefined ? {} : { feature: error.feature }),
      ...(error.customerId === undefined ? {} : { customerId: error.customerId })
    }
  }

  return {
    name: 'DocxUnsupportedError' as const,
    code: 'DOCX_WORKER_ERROR',
    message: error instanceof Error ? error.message : String(error),
    requestId
  }
}

/** 判断异常是否已经符合 DOCX worker 错误结构。 */
function isDocxWorkerError(error: unknown): error is Error & {
  readonly name: 'DocxUnsupportedError' | 'DocxPackageError' | 'JWordLicenseError'
  readonly code: DocxError['code']
  readonly requestId?: string
  readonly feature?: JWordLicenseFeatureKey
  readonly customerId?: string
} {
  const code = (error as { readonly code?: unknown }).code

  return error instanceof Error &&
    (
      error.name === 'DocxUnsupportedError' ||
      error.name === 'DocxPackageError' ||
      error.name === 'JWordLicenseError'
    ) &&
    typeof code === 'string' &&
    (isDocxErrorCode(code) || isJWordLicenseDiagnosticCode(code))
}

/** 在真实 worker 环境注册 message 监听。 */
function registerDocxWorkerRuntime(): void {
  const scope = globalThis as DocxWorkerRuntimeScope

  if (typeof scope.addEventListener !== 'function' || typeof scope.postMessage !== 'function') {
    return
  }

  scope.addEventListener('message', (event: MessageEvent<DocxWorkerRequest>) => {
    void dispatchDocxWorkerRequest(event.data, (response, transferables) => {
      scope.postMessage?.(response, transferables)
    })
  })
}

registerDocxWorkerRuntime()
