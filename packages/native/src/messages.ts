/**
 * 职责：提供 native worker request/event 创建和错误序列化 helper。
 * 边界：不执行 zip 保存、打开或校验，只组装可跨线程传输的纯数据。
 * 协作模块：index.ts 公开入口、worker.ts runtime 和外部 worker host。
 * 性能/安全约束：二进制传输使用标准 ArrayBuffer，避免共享调用方可变视图。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import type { Document } from '@4xian/jword-core'

import { JWordNativePackageError } from './types.js'
import type {
  JWordBinaryInput,
  JWordNativeLoadRequest,
  JWordNativePackageErrorShape,
  JWordNativeSaveRequest,
  JWordNativeTransferable,
  JWordNativeValidateRequest,
  JWordNativeWorkerEvent,
  LoadJWordDocumentOptions,
  SaveJWordDocumentOptions,
  ValidateJWordPackageOptions
} from './types.js'
import { copyBytesToArrayBuffer } from './utils.js'

/** 创建保存请求消息。 */
export function createSaveJWordNativeRequest(
  requestId: string,
  document: Document,
  options?: SaveJWordDocumentOptions
): JWordNativeSaveRequest {
  return {
    type: 'save',
    requestId,
    document,
    ...(options === undefined ? {} : { options })
  }
}

/** 创建加载请求消息。 */
export function createLoadJWordNativeRequest(
  requestId: string,
  input: JWordBinaryInput,
  options?: LoadJWordDocumentOptions
): JWordNativeLoadRequest {
  return {
    type: 'load',
    requestId,
    input,
    ...(options === undefined ? {} : { options })
  }
}

/** 创建校验请求消息。 */
export function createValidateJWordNativeRequest(
  requestId: string,
  input: JWordBinaryInput,
  options?: ValidateJWordPackageOptions
): JWordNativeValidateRequest {
  return {
    type: 'validate',
    requestId,
    input,
    ...(options === undefined ? {} : { options })
  }
}

/** 创建取消请求消息。 */
export function createCancelJWordNativeRequest(requestId: string): {
  readonly type: 'cancel'
  readonly requestId: string
} {
  return {
    type: 'cancel',
    requestId
  }
}

/** 创建 worker 可传输二进制列表。 */
export function createJWordNativeTransferables(bytes: Uint8Array): readonly JWordNativeTransferable[] {
  return [copyBytesToArrayBuffer(bytes)]
}

/** 创建 worker error 事件。 */
export function createJWordNativeErrorEvent(
  requestId: string,
  error: JWordNativePackageErrorShape
): JWordNativeWorkerEvent {
  return {
    type: 'error',
    requestId,
    error
  }
}

/** 判断未知异常是否为 native package 错误。 */
export function isJWordNativePackageError(error: unknown): error is JWordNativePackageError {
  return error instanceof JWordNativePackageError
}

/** 把错误对象转换为可跨 worker 传输的纯数据。 */
export function serializeJWordNativePackageError(
  error: unknown,
  requestId: string
): JWordNativePackageErrorShape {
  if (error instanceof JWordNativePackageError) {
    return {
      name: error.name,
      code: error.code,
      message: error.message,
      recoverable: error.recoverable,
      ...(error.entry === undefined ? {} : { entry: error.entry }),
      requestId: error.requestId ?? requestId
    }
  }

  return {
    name: 'JWordNativePackageError',
    code: 'JWORD_NATIVE_WORKER_ERROR',
    message: error instanceof Error ? error.message : String(error),
    recoverable: false,
    requestId
  }
}
