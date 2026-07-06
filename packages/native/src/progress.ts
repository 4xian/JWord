/**
 * 职责：处理 native package 长任务取消检查与进度事件发送。
 * 边界：不读取 zip，不创建诊断，不执行保存、打开、校验或迁移流程。
 * 协作模块：打包编解码、包读取和 worker runtime 通过公开选项消费进度事件。
 * 性能/安全约束：只读取 AbortSignal 状态并同步调用回调，不访问 DOM、网络或磁盘。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#gate-45---jword-原生保存与打开。
 */

import { createPackageError } from './diagnostics.js'
import type { JWordNativeProgressEvent } from './types.js'

/** 检查 AbortSignal。 */
export function assertNotAborted(signal: AbortSignal | undefined, requestId?: string): void {
  if (signal?.aborted) {
    throw createPackageError('JWORD_NATIVE_USER_CANCELLED', '任务已取消', requestId)
  }
}

/** 发送进度事件。 */
export function emitProgress(
  phase: JWordNativeProgressEvent['phase'],
  loaded: number,
  options: {
    readonly requestId?: string
    readonly total?: number
    readonly onProgress?: (event: JWordNativeProgressEvent) => void
  }
): void {
  options.onProgress?.({
    ...(options.requestId === undefined ? {} : { requestId: options.requestId }),
    phase,
    loaded,
    ...(options.total === undefined ? {} : { total: options.total })
  })
}
