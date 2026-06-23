/**
 * @vitest-environment node
 *
 * 职责：覆盖 Gate 4.5 native worker 消息 helper 的可测试运行时。
 * 边界：不启动真实 Web Worker，只验证纯函数分发、进度、取消和响应结构。
 * 协作模块：packages/native/src/worker.ts、packages/native/src/index.ts。
 * 约束：worker contract 必须支持 requestId、progress、warning、cancel 和 AbortSignal 语义。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#iteration-1---4xianjword-native-公开-api-与-worker。
 */
import { describe, expect, it } from 'vitest'

import type { Document } from '@4xian/jword-core'

import {
  createCancelJWordNativeRequest,
  createSaveJWordNativeRequest,
  type JWordNativeWorkerEvent
} from '../src/index'
import { dispatchJWordNativeWorkerRequest } from '../src/worker'

describe('@4xian/jword-native worker runtime', () => {
  it('dispatches save requests with progress and result events', async () => {
    const posted: JWordNativeWorkerEvent[] = []
    const event = await dispatchJWordNativeWorkerRequest(
      createSaveJWordNativeRequest('native-worker-save-1', {
        kind: 'document',
        id: 'document-native-worker',
        sections: []
      }),
      (response) => {
        posted.push(response)
      }
    )

    expect(posted[0]).toMatchObject({
      type: 'progress',
      requestId: 'native-worker-save-1',
      progress: {
        phase: 'save',
        loaded: 0
      }
    })
    expect(posted.at(-1)).toMatchObject({
      type: 'save-result',
      requestId: 'native-worker-save-1'
    })
    expect(event).toMatchObject({
      type: 'save-result',
      requestId: 'native-worker-save-1'
    })
  })

  it('dispatches cancel requests with a stable response', async () => {
    const posted: JWordNativeWorkerEvent[] = []
    const event = await dispatchJWordNativeWorkerRequest(
      createCancelJWordNativeRequest('native-worker-cancel-1'),
      (response) => {
        posted.push(response)
      }
    )

    expect(event).toEqual({
      type: 'error',
      requestId: 'native-worker-cancel-1',
      error: {
        name: 'JWordNativePackageError',
        code: 'JWORD_NATIVE_WORKER_CANCELLED',
        message: '任务已取消',
        recoverable: false,
        requestId: 'native-worker-cancel-1'
      }
    })
    expect(posted).toEqual([event])
  })

  it('cancels a running save request before posting a stale success result', async () => {
    const posted: JWordNativeWorkerEvent[] = []
    const requestId = 'native-worker-running-cancel'
    const saveRequest = createSaveJWordNativeRequest(requestId, createLargeResourceDocument())
    const saveTask = dispatchJWordNativeWorkerRequest(saveRequest, (response) => {
      posted.push(response)

      if (response.type === 'progress' && response.progress.total === 100) {
        void dispatchJWordNativeWorkerRequest(createCancelJWordNativeRequest(requestId), (cancelResponse) => {
          posted.push(cancelResponse)
        })
      }
    })

    const event = await saveTask

    expect(event).toMatchObject({
      type: 'error',
      requestId,
      error: {
        code: 'JWORD_NATIVE_USER_CANCELLED'
      }
    })
    expect(posted).toContainEqual(expect.objectContaining({
      type: 'error',
      requestId,
      error: expect.objectContaining({
        code: 'JWORD_NATIVE_WORKER_CANCELLED'
      })
    }))
    expect(posted.some((item) => item.type === 'save-result')).toBe(false)
  })
})

/** 创建带大资源的文档，让取消覆盖 checksum/generation 运行区间。 */
function createLargeResourceDocument(): Document {
  const bytes = new Uint8Array(1024 * 1024)
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let base64 = ''

  for (const byte of bytes) {
    base64 += alphabet[byte % alphabet.length]
  }

  return {
    kind: 'document',
    id: 'document-native-worker-large-cancel',
    resourceIds: ['large-native-resource'],
    resources: [
      {
        kind: 'resource',
        id: 'large-native-resource',
        mime: 'image/png',
        source: {
          kind: 'dataUrl',
          url: `data:image/png;base64,${base64}`
        },
        status: 'success'
      }
    ],
    sections: []
  }
}
