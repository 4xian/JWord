/**
 * @vitest-environment node
 *
 * 职责：覆盖 Gate 4.5 native worker 消息 helper 的可测试运行时。
 * 边界：不启动真实 Web Worker，只验证纯函数分发、进度、取消和响应结构。
 * 协作模块：packages/native/src/worker.ts、packages/native/src/index.ts。
 * 约束：worker contract 必须支持 requestId、progress、warning、cancel 和 AbortSignal 语义。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'

import type { Document } from '@4xian/jword-core'

import {
  createCancelJWordNativeRequest,
  createLoadJWordNativeRequest,
  createSaveJWordNativeRequest,
  createValidateJWordNativeRequest,
  JWordNativePackageError,
  serializeJWordNativePackageError,
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

  /** 验证 Worker load-result 只返回已 materialize 的运行时 data URL。 */
  it('materializes packed resources through the worker load-result contract', async () => {
    /** 丢弃本测试不关心的中间 progress event。 */
    const ignorePostedEvent = (): void => {}
    const saveEvent = await dispatchJWordNativeWorkerRequest(
      createSaveJWordNativeRequest('native-worker-resource-save', {
        kind: 'document',
        id: 'document-native-worker-resource',
        resourceIds: ['native-worker-image'],
        resources: [{
          kind: 'resource',
          id: 'native-worker-image',
          mime: 'image/png',
          source: {
            kind: 'dataUrl',
            url: 'data:image/png;base64,QUJDRA=='
          },
          status: 'success'
        }],
        sections: []
      }),
      ignorePostedEvent
    )

    expect(saveEvent.type).toBe('save-result')
    if (saveEvent.type !== 'save-result') {
      throw new Error('expected native worker save result')
    }

    const loadEvent = await dispatchJWordNativeWorkerRequest(
      createLoadJWordNativeRequest('native-worker-resource-load', saveEvent.result.bytes),
      ignorePostedEvent
    )

    expect(loadEvent).toMatchObject({
      type: 'load-result',
      requestId: 'native-worker-resource-load',
      result: {
        document: {
          resources: [{
            source: {
              kind: 'dataUrl',
              url: 'data:image/png;base64,QUJDRA=='
            }
          }]
        }
      }
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
        message: 'JWORD_NATIVE_WORKER_CANCELLED',
        recoverable: false,
        requestId: 'native-worker-cancel-1'
      }
    })
    expect(posted).toEqual([event])
  })

  it('serializes the normalized schema path and stable message code', () => {
    const shape = serializeJWordNativePackageError(new JWordNativePackageError({
      code: 'JWORD_NATIVE_DOCUMENT_INVALID',
      message: '不要跨层传播的本地化文本',
      entry: 'document.json',
      path: '/sections/0/blocks'
    }), 'native-worker-path-1')

    expect(shape).toMatchObject({
      code: 'JWORD_NATIVE_DOCUMENT_INVALID',
      message: 'JWORD_NATIVE_DOCUMENT_INVALID',
      entry: 'document.json',
      path: '/sections/0/blocks',
      requestId: 'native-worker-path-1'
    })
  })

  it('returns stable diagnostic codes in validate-result messages', async () => {
    const zip = new JSZip()

    zip.file('document.json', '{}')

    const input = await zip.generateAsync({ type: 'uint8array' })
    const event = await dispatchJWordNativeWorkerRequest(
      createValidateJWordNativeRequest('native-worker-stable-message-1', input),
      () => {}
    )

    expect(event).toMatchObject({
      type: 'validate-result',
      result: {
        valid: false,
        diagnostics: [
          {
            code: 'JWORD_NATIVE_MANIFEST_MISSING',
            message: 'JWORD_NATIVE_MANIFEST_MISSING'
          }
        ]
      }
    })
  })

  it('keeps a cancel that arrives before the matching save is registered', async () => {
    const posted: JWordNativeWorkerEvent[] = []
    const requestId = 'native-worker-cancel-before-save-1'
    const cancelEvent = await dispatchJWordNativeWorkerRequest(
      createCancelJWordNativeRequest(requestId),
      (response) => {
        posted.push(response)
      }
    )
    const saveEvent = await dispatchJWordNativeWorkerRequest(
      createSaveJWordNativeRequest(requestId, {
        kind: 'document',
        id: 'document-native-cancel-before-save',
        sections: []
      }),
      (response) => {
        posted.push(response)
      }
    )

    expect(saveEvent).toMatchObject({
      type: 'error',
      requestId,
      error: {
        code: 'JWORD_NATIVE_WORKER_CANCELLED',
        requestId
      }
    })
    expect(posted).toEqual([cancelEvent])
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
