/**
 * 职责：提供 @4xian/jword-pdf/worker 专属的 worker 消息 helper 与请求处理入口。
 * 边界：不作为 root stable API 导出；只编排 worker 请求、授权校验、取消响应与 transferables。
 * 协作模块：worker.ts、index.ts 的 exportPdfFromLayout、image-assets.ts 和 license 包。
 * 性能/安全约束：错误响应只携带稳定诊断元数据，不泄漏文档正文内容。
 * Specs：docs/superpowers/reports/2026-07-03-remediation-execution-supplement.md#313-发布no-alias-消费闭环phase-6m按-d2-执行。
 */

import {
  assertJWordFeatureEntitled
} from '@4xian/jword-license'

import { exportPdfFromLayout } from './index.js'
import type {
  CancelPdfWorkerRequest,
  PdfError,
  PdfProgressEvent,
  PdfProgressStage,
  PdfTransferable,
  PdfWorkerRequest,
  PdfWorkerResponse
} from './types.js'

export { readPdfImageAsset } from './image-assets.js'

/** 创建 PDF worker 进度响应。 */
export function createPdfProgressResponse(
  requestId: string,
  stage: PdfProgressStage,
  detail: Omit<PdfProgressEvent, 'requestId' | 'stage'> = {}
): PdfWorkerResponse {
  return {
    kind: 'progress',
    progress: {
      requestId,
      stage,
      ...detail
    }
  }
}

/** 创建 PDF worker 错误响应。 */
export function createPdfErrorResponse(error: PdfError): PdfWorkerResponse {
  return {
    kind: 'error',
    error
  }
}

/** 创建 PDF worker 取消请求。 */
export function createCancelPdfWorkerRequest(requestId: string): CancelPdfWorkerRequest {
  return {
    kind: 'cancel',
    requestId
  }
}

/** 提取 PDF 导出结果可转移的底层 ArrayBuffer。 */
export function createPdfTransferables(input: ArrayBuffer | ArrayBufferView): readonly PdfTransferable[] {
  if (input instanceof ArrayBuffer) {
    return [input]
  }

  return input.buffer instanceof ArrayBuffer ? [input.buffer] : []
}

/** 处理 PDF worker 请求，供真实 worker 入口复用同一消息边界。 */
export async function handlePdfWorkerRequest(
  request: PdfWorkerRequest,
  signal?: AbortSignal
): Promise<PdfWorkerResponse> {
  if (request.kind === 'cancel') {
    return createPdfErrorResponse({
      code: 'PDF_EXPORT_CANCELLED',
      message: '导出已取消',
      requestId: request.requestId,
      cancelled: true
    })
  }

  try {
    const requestId = request.options.requestId ?? request.requestId
    assertJWordFeatureEntitled(request.options.license, 'pdf.export')
    const result = await exportPdfFromLayout(request.layout, {
      ...request.options,
      ...(requestId === undefined ? {} : { requestId }),
      ...(signal === undefined ? {} : { signal })
    })

    return {
      kind: 'result',
      result
    }
  } catch (error) {
    return createPdfErrorResponse(readPdfWorkerError(error, request.requestId))
  }
}

/** 把未知异常规整为 worker error 响应。 */
function readPdfWorkerError(error: unknown, requestId: string | undefined): PdfError {
  if (isPdfError(error)) {
    const resolvedRequestId = error.requestId ?? requestId

    return {
      code: error.code,
      message: error.message,
      ...(resolvedRequestId === undefined ? {} : { requestId: resolvedRequestId }),
      ...(error.cancelled === undefined ? {} : { cancelled: error.cancelled }),
      ...(error.feature === undefined ? {} : { feature: error.feature }),
      ...(error.customerId === undefined ? {} : { customerId: error.customerId })
    }
  }

  return {
    code: 'PDF_WORKER_UNAVAILABLE',
    message: error instanceof Error ? error.message : 'PDF worker request failed.',
    ...(requestId === undefined ? {} : { requestId })
  }
}

/** 判断异常是否已经是稳定 PDF error。 */
function isPdfError(error: unknown): error is PdfError {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && typeof error.code === 'string'
    && 'message' in error
    && typeof error.message === 'string'
}
