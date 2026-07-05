/**
 * @vitest-environment node
 *
 * 职责：提供 collab-server 单元测试共享的请求、响应、同步等待和 history storage helper。
 * 边界：只服务 packages/collab-server/test 下的测试，不进入正式包导出面。
 * 协作模块：server.test.ts 复用这些 helper 构造 HTTP 请求和可计数 history storage。
 * 约束：helper 必须保持无全局副作用，避免测试间共享可变状态。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md 第六阶段正式服务端包导出分级。
 */

import type {
  IncomingHttpHeaders,
  IncomingMessage,
  ServerResponse
} from 'node:http'
import { Readable } from 'node:stream'
import * as Y from 'yjs'
import type {
  JWordHistoryStorage,
  JWordHistoryStorageDocument
} from '@4xian/jword-persistence'

/** 构造一旦读取 body 就计数并报错的请求流。 */
export class BodyTrapRequest extends Readable {
  readonly method: string
  readonly url: string
  readonly headers: IncomingHttpHeaders
  private readCount = 0

  /** 初始化带方法、路径和 header 的请求流。 */
  constructor(method: string, url: string, headers: IncomingHttpHeaders) {
    super()
    this.method = method
    this.url = url
    this.headers = headers
  }

  /** 暴露 body 被消费次数。 */
  get bodyReadCount(): number {
    return this.readCount
  }

  /** 转成 handler 需要的 Node 请求类型。 */
  asIncomingMessage(): IncomingMessage {
    return this as unknown as IncomingMessage
  }

  /** 在 handler 尝试读取 body 时立即失败。 */
  override _read(): void {
    this.readCount += 1
    this.destroy(new Error('request body must not be consumed before authorization'))
  }
}

/** 收集 handler 写出的 JSON 响应。 */
export class CapturedJsonResponse {
  statusCode = 200
  private responseBody = ''

  /** 兼容 Node ServerResponse 的 header 写入接口。 */
  setHeader(_name: string, _value: number | string | readonly string[]): this {
    return this
  }

  /** 收集响应 body。 */
  end(chunk?: string | Uint8Array): this {
    if (chunk !== undefined) {
      this.responseBody += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8')
    }

    return this
  }

  /** 转成 handler 需要的 Node 响应类型。 */
  asServerResponse(): ServerResponse {
    return this as unknown as ServerResponse
  }

  /** 读取 JSON 响应。 */
  readJson(): unknown {
    return JSON.parse(this.responseBody) as unknown
  }
}

/** 请求 JSON 响应。 */
export async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  return fetch(url, init).then((response) => response.json() as Promise<unknown>)
}

/** 等待 provider 完成首次同步。 */
export async function waitForSynced(adapter: {
  readonly status: string
  connect(): Promise<void>
  onSynced(listener: () => void): () => void
}): Promise<void> {
  if (adapter.status === 'synced') {
    return
  }

  let connectError: unknown
  const waitPromise = new Promise<void>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      unsubscribe()
      reject(new Error(`provider did not sync, current status: ${adapter.status}`))
    }, 5000)
    const unsubscribe = adapter.onSynced(() => {
      clearTimeout(timeoutId)
      unsubscribe()
      resolve()
    })
  })
  const connectPromise = adapter.status === 'idle'
    ? adapter.connect().catch((error: unknown) => {
      connectError = error
    })
    : Promise.resolve()

  await waitPromise
  await connectPromise

  if (connectError !== undefined) {
    throw connectError
  }
}

/** 等待 provider 报告错误。 */
export async function waitForProviderError(adapter: {
  readonly status: string
  readonly error: {
    readonly code: string
    readonly recoverable: boolean
  } | undefined
  connect(): Promise<void>
  onError(listener: (error: {
    readonly code: string
    readonly recoverable: boolean
  }) => void): () => void
}): Promise<{
  readonly code: string
  readonly recoverable: boolean
}> {
  if (adapter.error !== undefined) {
    return adapter.error
  }

  const waitPromise = new Promise<{
    readonly code: string
    readonly recoverable: boolean
  }>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      unsubscribe()
      reject(new Error('provider did not report an error'))
    }, 5000)
    const unsubscribe = adapter.onError((error) => {
      clearTimeout(timeoutId)
      unsubscribe()
      resolve(error)
    })
  })
  const connectPromise = adapter.status === 'idle'
    ? adapter.connect().catch(() => {})
    : Promise.resolve()
  const error = await waitPromise

  await connectPromise

  return error
}

/** 生成合法的空 Y.Doc update。 */
export function encodeEmptyYDocUpdate(): string {
  const doc = new Y.Doc()
  const update = Y.encodeStateAsUpdate(doc)

  doc.destroy()

  return Buffer.from(update).toString('base64')
}

/** 创建带调用计数的 history storage。 */
export function createCountingStorage(): JWordHistoryStorage & {
  readonly loadCount: number
  readonly saveCount: number
} {
  const documents = new Map<string, JWordHistoryStorageDocument>()
  let loadCount = 0
  let saveCount = 0

  return {
    /** 读取文档历史并增加计数。 */
    get loadCount() {
      return loadCount
    },

    /** 保存文档历史并增加计数。 */
    get saveCount() {
      return saveCount
    },

    /** 读取指定文档历史。 */
    async loadDocument(documentId) {
      loadCount += 1

      return documents.get(documentId) ?? null
    },

    /** 保存指定文档历史。 */
    async saveDocument(documentId, document) {
      saveCount += 1
      documents.set(documentId, document)
    }
  }
}
