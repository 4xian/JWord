/**
 * @vitest-environment node
 *
 * 职责：验证正式协同服务端 history document lock 具备背压限制和稳定诊断响应。
 * 边界：只覆盖 history HTTP record 路由的同文档并发排队，不测试 Hocuspocus WebSocket 或浏览器 UI。
 * 协作模块：packages/collab-server/src/index.ts 提供 HTTP 服务，packages/persistence 提供 storage 契约。
 * 约束：超出同文档队列深度时必须快速失败，不能把请求无限挂在 promise 链上。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import { afterEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import type {
  JWordHistoryStorage,
  JWordHistoryStorageDocument
} from '@4xian/jword-persistence'

import {
  createJWordCollabServer,
  createJWordCollabHistoryService,
  type JWordCollabServer
} from '../src/index'

let server: JWordCollabServer | null = null

describe('collab-server history document lock queue', () => {
  afterEach(async () => {
    await server?.stop()
    server = null
  })

  it('rejects history writes beyond the document lock queue depth with a stable diagnostic code', async () => {
    const storage = new BlockingHistoryStorage()

    server = createJWordCollabServer({
      port: 0,
      address: '127.0.0.1',
      historyStorage: storage,
      maxHistoryDocumentLockQueueDepth: 1,
      authHook: () => ({ ok: true }),
      licenseHook: () => ({ ok: true })
    })
    const state = await server.start()
    const firstRequest = fetch(`${state.httpUrl}/history/versions?documentId=doc-history-queue`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify(createRecordBody('first'))
    })

    await storage.waitForFirstLoad()

    const secondRequest = fetch(`${state.httpUrl}/history/versions?documentId=doc-history-queue`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify(createRecordBody('second'))
    })

    try {
      const response = await expectFastResponse(secondRequest)
      const body = await response.json()

      expect(response.status).toBe(429)
      expect(body).toMatchObject({
        ok: false,
        diagnosticCode: 'JWORD_COLLAB_HISTORY_LOCK_QUEUE_EXCEEDED',
        requestId: expect.any(String)
      })
    } finally {
      storage.releaseFirstLoad()
      await Promise.allSettled([firstRequest, secondRequest])
    }
  })

  it('reuses one persistence adapter for repeated history service operations', () => {
    const service = createJWordCollabHistoryService({
      storage: new BlockingHistoryStorage()
    })

    expect(service.createAdapter()).toBe(service.createAdapter())
  })
})

interface Deferred<T> {
  readonly promise: Promise<T>
  resolve(value: T): void
}

/** 创建测试可控的 Promise。 */
function createDeferred<T>(): Deferred<T> {
  let resolveValue: (value: T) => void = () => {}
  const promise = new Promise<T>((resolve) => {
    resolveValue = resolve
  })

  return {
    promise,
    resolve: resolveValue
  }
}

/** 构造合法的 history record 请求体。 */
function createRecordBody(label: string): object {
  return {
    documentId: 'doc-history-queue',
    roomId: 'room-history-queue',
    clientId: `client-${label}`,
    authorId: `author-${label}`,
    origin: 'local-user',
    label,
    updateBase64: encodeEmptyYDocUpdate()
  }
}

/** 生成合法的空 Y.Doc update。 */
function encodeEmptyYDocUpdate(): string {
  const doc = new Y.Doc()
  const update = Y.encodeStateAsUpdate(doc)

  doc.destroy()

  return Buffer.from(update).toString('base64')
}

/** 等待请求快速返回，避免把缺失背压误判成通过。 */
async function expectFastResponse(response: Promise<Response>): Promise<Response> {
  return Promise.race([
    response,
    new Promise<Response>((_resolve, reject) => {
      setTimeout(() => {
        reject(new Error('history queue overflow request did not fail fast'))
      }, 250)
    })
  ])
}

class BlockingHistoryStorage implements JWordHistoryStorage {
  private readonly firstLoadStarted = createDeferred<void>()
  private readonly firstLoadReleased = createDeferred<void>()
  private loadCount = 0

  /** 等待首个 history 操作进入 storage load。 */
  async waitForFirstLoad(): Promise<void> {
    await this.firstLoadStarted.promise
  }

  /** 释放被阻塞的首个 history 操作。 */
  releaseFirstLoad(): void {
    this.firstLoadReleased.resolve()
  }

  /** 阻塞首次读取，制造同一 document 的活跃 lock。 */
  async loadDocument(_documentId: string): Promise<JWordHistoryStorageDocument | null> {
    this.loadCount += 1

    if (this.loadCount === 1) {
      this.firstLoadStarted.resolve()
      await this.firstLoadReleased.promise
    }

    return null
  }

  /** 测试不关心持久化结果，只需要满足 storage 契约。 */
  async saveDocument(_documentId: string, _document: JWordHistoryStorageDocument): Promise<void> {}
}
