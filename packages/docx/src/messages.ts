/**
 * 职责：创建 Gate 5 DOCX worker 请求、事件和 transferables 的小型 helper。
 * 边界：只处理消息对象形状，不执行 import/export/inspect。
 * 协作模块：worker.ts 和 public API 测试复用这些稳定消息构造器。
 * 性能/安全约束：保持纯函数，避免引入 JSZip、core 或 DOM 依赖。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import type {
  CancelDocxRequest,
  DocxBinaryInput,
  DocxError,
  DocxErrorEvent,
  DocxProgressEvent,
  DocxProgressStage,
  DocxTransferable
} from './types.js'

/** 创建 DOCX worker 进度事件。 */
export function createDocxProgressEvent(
  requestId: string,
  stage: DocxProgressStage,
  detail: Omit<DocxProgressEvent, 'type' | 'requestId' | 'stage'> = {}
): DocxProgressEvent {
  return {
    type: 'progress',
    requestId,
    stage,
    ...detail
  }
}

/** 创建 DOCX worker 错误事件。 */
export function createDocxErrorEvent(requestId: string, error: DocxError): DocxErrorEvent {
  const serializedError: DocxError = {
    name: error.name,
    code: error.code,
    message: error.message,
    ...(error.requestId === undefined ? {} : { requestId: error.requestId }),
    ...(error.feature === undefined ? {} : { feature: error.feature })
  }

  return {
    type: 'error',
    requestId,
    error: serializedError
  }
}

/** 创建 DOCX worker 取消请求。 */
export function createCancelDocxRequest(requestId: string): CancelDocxRequest {
  return {
    type: 'cancel',
    requestId
  }
}

/** 提取 DOCX 二进制输入可转移的底层 ArrayBuffer。 */
export function createDocxTransferables(input: DocxBinaryInput): readonly DocxTransferable[] {
  if (input instanceof ArrayBuffer) {
    return [input]
  }

  if (ArrayBuffer.isView(input)) {
    return input.buffer instanceof ArrayBuffer ? [input.buffer] : []
  }

  return []
}
