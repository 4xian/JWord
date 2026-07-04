/**
 * @vitest-environment node
 *
 * 职责：验证正式 @4xian/jword-collab-server 包的最小 self-host 入口。
 * 边界：覆盖 health/version、Hocuspocus lifecycle 和 history storage，不接浏览器 UI。
 * 协作模块：packages/collab-server/src/index.ts、packages/collab experimental provider 和 packages/license 的 Gate 6 feature key。
 * 约束：服务端版本接口不能读取用户文档内容，测试使用随机端口并在结束后关闭。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md 第六阶段正式服务端包导出分级。
 */

import { afterEach, describe, expect, it } from 'vitest'
import { createServer } from 'node:http'
import type {
  IncomingHttpHeaders,
  IncomingMessage,
  ServerResponse
} from 'node:http'
import { Readable } from 'node:stream'
import * as Y from 'yjs'
import {
  createVolatileHistoryStorage,
  type JWordHistoryStorage,
  type JWordHistoryStorageDocument
} from '@4xian/jword-persistence'
import {
  createHocuspocusCollabProviderAdapter
} from '@4xian/jword-collab/experimental'

import {
  GATE6_COLLAB_FEATURES,
  JWORD_COLLAB_SERVER_PROTOCOL_VERSION,
  createJWordCollabHocuspocusServer,
  createJWordCollabServer,
  createJWordCollabRequestHandler,
  startJWordCollabServer,
  type JWordCollabHocuspocusServer,
  type JWordCollabServer
} from '../src/index'

let server: JWordCollabServer | null = null
let hocuspocusServer: JWordCollabHocuspocusServer | null = null

describe('@4xian/jword-collab-server', () => {
  afterEach(async () => {
    await server?.stop()
    await hocuspocusServer?.stop()
    server = null
    hocuspocusServer = null
  })

  it('starts a self-host server with health and version endpoints', async () => {
    server = createJWordCollabServer({
      port: 0,
      address: '127.0.0.1',
      featureFlags: [
        GATE6_COLLAB_FEATURES.multiplayer,
        GATE6_COLLAB_FEATURES.server
      ],
      minimumClientVersion: '0.0.0'
    })

    const state = await server.start()
    const health = await fetchJson(`${state.httpUrl}/health`)
    const version = await fetchJson(`${state.httpUrl}/version`)

    expect(state.protocolVersion).toBe(JWORD_COLLAB_SERVER_PROTOCOL_VERSION)
    expect(health).toMatchObject({
      status: 'ok',
      protocolVersion: JWORD_COLLAB_SERVER_PROTOCOL_VERSION
    })
    expect(version).toMatchObject({
      protocolVersion: JWORD_COLLAB_SERVER_PROTOCOL_VERSION,
      featureFlags: [
        GATE6_COLLAB_FEATURES.multiplayer,
        GATE6_COLLAB_FEATURES.server
      ],
      minimumClientVersion: '0.0.0',
      minimumServerVersion: '0.0.0'
    })
    expect(version).toHaveProperty('requestId')
  })

  it('provides a start helper that returns a stoppable server handle', async () => {
    server = await startJWordCollabServer({
      port: 0,
      address: '127.0.0.1'
    })

    expect(server.readState()?.httpUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/u)
  })

  it('provides an embeddable Node request handler for third-party hosts', async () => {
    const handler = createJWordCollabRequestHandler({
      minimumServerVersion: '0.0.0'
    })
    const embeddedServer = createServer((request, response) => {
      void handler(request, response)
    })

    await new Promise<void>((resolve) => {
      embeddedServer.listen(0, '127.0.0.1', resolve)
    })
    try {
      const address = embeddedServer.address()

      if (typeof address !== 'object' || address === null) {
        throw new Error('Embedded test server did not expose an address.')
      }

      const version = await fetchJson(`http://127.0.0.1:${address.port}/version`)

      expect(version).toMatchObject({
        protocolVersion: JWORD_COLLAB_SERVER_PROTOCOL_VERSION,
        minimumServerVersion: '0.0.0',
        requestId: expect.any(String)
      })
    } finally {
      await new Promise<void>((resolve, reject) => {
        embeddedServer.close((error) => {
          if (error !== undefined) {
            reject(error)
            return
          }
          resolve()
        })
      })
    }
  })

  it('starts a formal Hocuspocus WebSocket server and checks license before sync', async () => {
    const licenseCalls: {
      readonly documentId: string
      readonly feature: string
    }[] = []

    hocuspocusServer = createJWordCollabHocuspocusServer({
      port: 0,
      address: '127.0.0.1',
      roomPrefix: 'jword-collab-server-test',
      requiredToken: 'valid-token',
      authHook: () => ({
        allow: true,
        role: 'write'
      }),
      licenseHook: (input) => {
        licenseCalls.push({
          documentId: input.documentId,
          feature: input.feature
        })

        return { ok: true }
      }
    })
    const state = await hocuspocusServer.start()
    const document = new Y.Doc()
    const adapter = createHocuspocusCollabProviderAdapter({
      document,
      documentId: 'doc-formal-hocuspocus',
      roomId: `${state.roomPrefix}-room`,
      clientId: 'client-a',
      webSocketUrl: state.webSocketUrl,
      token: 'valid-token'
    })

    try {
      await waitForSynced(adapter)

      expect(state.webSocketUrl).toBe(`ws://127.0.0.1:${state.port}`)
      expect(licenseCalls).toContainEqual({
        documentId: `${state.roomPrefix}-room`,
        feature: GATE6_COLLAB_FEATURES.server
      })
    } finally {
      await adapter.destroy()
      document.destroy()
    }
  }, 15000)

  it('rejects formal Hocuspocus connections before sync when license denies server use', async () => {
    const licenseCalls: string[] = []

    hocuspocusServer = createJWordCollabHocuspocusServer({
      port: 0,
      address: '127.0.0.1',
      roomPrefix: 'jword-collab-server-denied',
      requiredToken: 'valid-token',
      authHook: () => ({
        allow: true,
        role: 'write'
      }),
      licenseHook: ({ documentId }) => {
        licenseCalls.push(documentId)

        return {
          ok: false,
          diagnosticCode: 'COLLAB_FEATURE_NOT_ENTITLED'
        }
      }
    })
    const state = await hocuspocusServer.start()
    const document = new Y.Doc()
    const adapter = createHocuspocusCollabProviderAdapter({
      document,
      documentId: 'doc-formal-hocuspocus-denied',
      roomId: `${state.roomPrefix}-room`,
      clientId: 'client-a',
      webSocketUrl: state.webSocketUrl,
      token: 'valid-token'
    })

    try {
      const error = await waitForProviderError(adapter)

      expect(error).toMatchObject({
        code: 'COLLAB_PROVIDER_AUTH_FAILED',
        recoverable: false
      })
      expect(adapter.status).toBe('error')
      expect(licenseCalls).toEqual([`${state.roomPrefix}-room`])
    } finally {
      await adapter.destroy()
      document.destroy()
    }
  }, 15000)

  it('rejects formal Hocuspocus connections when auth hook is missing', async () => {
    let licenseCalls = 0

    hocuspocusServer = createJWordCollabHocuspocusServer({
      port: 0,
      address: '127.0.0.1',
      roomPrefix: 'jword-collab-server-auth-required',
      licenseHook: () => {
        licenseCalls += 1

        return { ok: true }
      }
    })
    const state = await hocuspocusServer.start()
    const document = new Y.Doc()
    const adapter = createHocuspocusCollabProviderAdapter({
      document,
      documentId: 'doc-formal-hocuspocus-auth-required',
      roomId: `${state.roomPrefix}-room`,
      clientId: 'client-a',
      webSocketUrl: state.webSocketUrl
    })

    try {
      const error = await waitForProviderError(adapter)

      expect(error).toMatchObject({
        code: 'COLLAB_PROVIDER_AUTH_FAILED',
        recoverable: false
      })
      expect(licenseCalls).toBe(0)
    } finally {
      await adapter.destroy()
      document.destroy()
    }
  }, 15000)

  it('rejects read-only Hocuspocus clients when they send updates', async () => {
    const authCalls: Array<{
      readonly tenantId: string
      readonly documentId: string
      readonly userId?: string
      readonly token?: string
    }> = []

    hocuspocusServer = createJWordCollabHocuspocusServer({
      port: 0,
      address: '127.0.0.1',
      roomPrefix: 'tenant-a',
      requiredToken: 'read-token',
      authHook: (input) => {
        authCalls.push({
          tenantId: input.tenantId,
          documentId: input.documentId,
          ...(input.userId === undefined ? {} : { userId: input.userId }),
          ...(input.token === undefined ? {} : { token: input.token })
        })

        return {
          allow: true,
          role: 'read'
        }
      },
      licenseHook: () => ({ ok: true })
    })
    const state = await hocuspocusServer.start()
    const document = new Y.Doc()
    const adapter = createHocuspocusCollabProviderAdapter({
      document,
      documentId: 'doc-read-only',
      roomId: 'tenant-a/doc-read-only',
      clientId: 'client-read',
      webSocketUrl: `${state.webSocketUrl}?userId=client-read`,
      token: 'read-token'
    })
    const updateDoc = new Y.Doc()

    try {
      await waitForSynced(adapter)
      updateDoc.getText('content').insert(0, 'blocked')
      const errorPromise = waitForProviderError(adapter)

      await adapter.sendUpdate(Y.encodeStateAsUpdate(updateDoc), {
        documentId: 'doc-read-only',
        roomId: 'tenant-a/doc-read-only',
        clientId: 'client-read',
        updateId: 'read-update-1',
        origin: 'local'
      })

      await expect(errorPromise).resolves.toMatchObject({
        code: 'COLLAB_PERMISSION_DENIED',
        recoverable: true
      })
      expect(authCalls[0]).toEqual({
        tenantId: 'tenant-a',
        documentId: 'doc-read-only',
        userId: 'client-read',
        token: 'read-token'
      })
    } finally {
      await adapter.destroy()
      document.destroy()
      updateDoc.destroy()
    }
  }, 15000)

  it('serves history API through formal package storage and public JSON endpoints', async () => {
    server = createJWordCollabServer({
      port: 0,
      address: '127.0.0.1',
      historyStorage: createVolatileHistoryStorage(),
      licenseHook: () => ({ ok: true }),
      allowedOrigins: ['https://app.example.test']
    })

    const state = await server.start()
    const recorded = await fetchJson(`${state.httpUrl}/history/versions?documentId=doc-server-history`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://app.example.test'
      },
      body: JSON.stringify({
        documentId: 'doc-server-history',
        roomId: 'room-server-history',
        clientId: 'client-a',
        authorId: 'author-a',
        origin: 'local-user',
        label: 'server history v1',
        updateBase64: encodeEmptyYDocUpdate()
      })
    })
    const listed = await fetchJson(`${state.httpUrl}/history/versions?documentId=doc-server-history`, {
      headers: {
        origin: 'https://app.example.test'
      }
    })

    expect(recorded).toMatchObject({
      version: {
        documentId: 'doc-server-history',
        roomId: 'room-server-history',
        label: 'server history v1'
      },
      diagnostics: [],
      requestId: expect.any(String)
    })
    expect(listed).toMatchObject({
      versions: [{
        documentId: 'doc-server-history',
        label: 'server history v1'
      }],
      requestId: expect.any(String)
    })
  })

  it('blocks unlicensed history writes before storage is touched', async () => {
    const storage = createCountingStorage()

    server = createJWordCollabServer({
      port: 0,
      address: '127.0.0.1',
      historyStorage: storage,
      licenseHook: () => ({
        ok: false,
        diagnosticCode: 'COLLAB_FEATURE_NOT_ENTITLED'
      })
    })

    const state = await server.start()
    const response = await fetch(`${state.httpUrl}/history/versions?documentId=doc-denied`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        documentId: 'doc-denied',
        roomId: 'room-denied',
        clientId: 'client-a',
        authorId: 'author-a',
        origin: 'local-user',
        label: 'denied',
        updateBase64: encodeEmptyYDocUpdate()
      })
    })
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body).toMatchObject({
      ok: false,
      diagnosticCode: 'COLLAB_FEATURE_NOT_ENTITLED',
      requestId: expect.any(String)
    })
    expect(storage.saveCount).toBe(0)
    expect(storage.loadCount).toBe(0)
  })

  it('blocks history writes through auth hook before license or storage is touched', async () => {
    const storage = createCountingStorage()
    let licenseCalls = 0

    server = createJWordCollabServer({
      port: 0,
      address: '127.0.0.1',
      historyStorage: storage,
      authHook: () => ({
        ok: false,
        diagnosticCode: 'COLLAB_AUTH_DENIED'
      }),
      licenseHook: () => {
        licenseCalls += 1

        return { ok: true }
      }
    })

    const state = await server.start()
    const response = await fetch(`${state.httpUrl}/history/versions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        documentId: 'doc-auth-denied',
        roomId: 'room-auth-denied',
        clientId: 'client-a',
        authorId: 'author-a',
        origin: 'local-user',
        label: 'auth denied',
        updateBase64: encodeEmptyYDocUpdate()
      })
    })
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body).toMatchObject({
      ok: false,
      diagnosticCode: 'COLLAB_AUTH_DENIED',
      requestId: expect.any(String)
    })
    expect(licenseCalls).toBe(0)
    expect(storage.saveCount).toBe(0)
    expect(storage.loadCount).toBe(0)
  })

  it('denies paid body endpoints without license hook before reading request body', async () => {
    const handler = createJWordCollabRequestHandler({
      historyStorage: createCountingStorage()
    })
    const cases = [
      {
        url: '/history/versions?documentId=doc-history-license-missing',
        diagnosticCode: 'JWORD_COLLAB_LICENSE_HOOK_REQUIRED'
      },
      {
        url: '/history/preview?documentId=doc-history-license-missing&versionId=version-a',
        diagnosticCode: 'JWORD_COLLAB_LICENSE_HOOK_REQUIRED'
      },
      {
        url: '/auto-insert/relay?documentId=doc-auto-license-missing',
        diagnosticCode: 'JWORD_COLLAB_LICENSE_HOOK_REQUIRED'
      }
    ] as const

    for (const entry of cases) {
      const request = new BodyTrapRequest('POST', entry.url, {
        'content-type': 'application/json'
      })
      const response = new CapturedJsonResponse()

      await handler(request.asIncomingMessage(), response.asServerResponse())

      expect(response.statusCode).toBe(403)
      expect(response.readJson()).toMatchObject({
        ok: false,
        diagnosticCode: entry.diagnosticCode,
        requestId: expect.any(String)
      })
      expect(request.bodyReadCount).toBe(0)
    }
  })

  it('does not consume request body when license hook denies paid endpoints', async () => {
    const handler = createJWordCollabRequestHandler({
      historyStorage: createCountingStorage(),
      licenseHook: () => ({
        ok: false,
        diagnosticCode: 'COLLAB_FEATURE_NOT_ENTITLED'
      })
    })
    const cases = [
      '/history/versions?documentId=doc-license-denied',
      '/history/preview?documentId=doc-license-denied&versionId=version-denied',
      '/auto-insert/relay?documentId=doc-license-denied'
    ] as const

    for (const url of cases) {
      const request = new BodyTrapRequest('POST', url, {
        'content-type': 'application/json'
      })
      const response = new CapturedJsonResponse()

      await handler(request.asIncomingMessage(), response.asServerResponse())

      expect(response.statusCode).toBe(403)
      expect(response.readJson()).toMatchObject({
        ok: false,
        diagnosticCode: 'COLLAB_FEATURE_NOT_ENTITLED',
        requestId: expect.any(String)
      })
      expect(request.bodyReadCount).toBe(0)
    }
  })

  it('rejects body-only paid endpoint metadata before reading request body', async () => {
    const handler = createJWordCollabRequestHandler({
      historyStorage: createCountingStorage(),
      licenseHook: () => ({ ok: true })
    })
    const cases = [
      '/history/versions',
      '/history/preview',
      '/auto-insert/relay'
    ] as const

    for (const url of cases) {
      const request = new BodyTrapRequest('POST', url, {
        'content-type': 'application/json'
      })
      const response = new CapturedJsonResponse()

      await handler(request.asIncomingMessage(), response.asServerResponse())

      expect(response.statusCode).toBe(400)
      expect(response.readJson()).toMatchObject({
        ok: false,
        diagnosticCode: 'JWORD_COLLAB_LICENSE_METADATA_REQUIRED',
        requestId: expect.any(String)
      })
      expect(request.bodyReadCount).toBe(0)
    }
  })

  it('authorizes auto-insert relay requests before accepting chunks', async () => {
    const licenseCalls: {
      readonly documentId: string
      readonly feature: string
      readonly tenantId?: string
    }[] = []

    server = createJWordCollabServer({
      port: 0,
      address: '127.0.0.1',
      licenseHook: (input) => {
        licenseCalls.push({
          documentId: input.documentId,
          feature: input.feature,
          ...(input.tenantId === undefined ? {} : { tenantId: input.tenantId })
        })

        return { ok: true }
      }
    })

    const state = await server.start()
    const relay = await fetchJson(`${state.httpUrl}/auto-insert/relay?documentId=doc-auto-relay&tenantId=tenant-a`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        documentId: 'doc-auto-relay',
        requestId: 'auto-relay-1',
        actorId: 'assistant-a',
        chunkText: '协同',
        tenantId: 'tenant-a'
      })
    })

    expect(relay).toMatchObject({
      ok: true,
      documentId: 'doc-auto-relay',
      requestId: 'auto-relay-1',
      actorId: 'assistant-a',
      chunkLength: 2
    })
    expect(licenseCalls).toEqual([{
      documentId: 'doc-auto-relay',
      feature: GATE6_COLLAB_FEATURES.autoInsert,
      tenantId: 'tenant-a'
    }])
  })

  it('blocks unlicensed auto-insert relay before accepting chunks', async () => {
    server = createJWordCollabServer({
      port: 0,
      address: '127.0.0.1',
      licenseHook: () => ({
        ok: false,
        diagnosticCode: 'COLLAB_FEATURE_NOT_ENTITLED'
      })
    })

    const state = await server.start()
    const response = await fetch(`${state.httpUrl}/auto-insert/relay?documentId=doc-auto-relay-denied`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        documentId: 'doc-auto-relay-denied',
        requestId: 'auto-relay-denied',
        actorId: 'assistant-a',
        chunkText: '协同'
      })
    })
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body).toMatchObject({
      ok: false,
      diagnosticCode: 'COLLAB_FEATURE_NOT_ENTITLED',
      requestId: expect.any(String)
    })
    expect(body).not.toHaveProperty('chunkLength')
  })

  it('blocks auto-insert relay through tenant hook before license is touched', async () => {
    let licenseCalls = 0

    server = createJWordCollabServer({
      port: 0,
      address: '127.0.0.1',
      tenantHook: () => ({
        ok: false,
        diagnosticCode: 'COLLAB_TENANT_DENIED'
      }),
      licenseHook: () => {
        licenseCalls += 1

        return { ok: true }
      }
    })

    const state = await server.start()
    const response = await fetch(`${state.httpUrl}/auto-insert/relay?documentId=doc-auto-relay-tenant-denied&tenantId=tenant-denied`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        documentId: 'doc-auto-relay-tenant-denied',
        requestId: 'auto-relay-tenant-denied',
        actorId: 'assistant-a',
        chunkText: '协同',
        tenantId: 'tenant-denied'
      })
    })
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body).toMatchObject({
      ok: false,
      diagnosticCode: 'COLLAB_TENANT_DENIED',
      requestId: expect.any(String)
    })
    expect(licenseCalls).toBe(0)
  })

  it('exposes license status endpoint and deploy metadata without reading document content', async () => {
    server = createJWordCollabServer({
      port: 0,
      address: '127.0.0.1',
      minimumServerVersion: '0.0.0',
      licenseHook: ({ feature }) => {
        if (feature === GATE6_COLLAB_FEATURES.server) {
          return { ok: true }
        }

        return {
          ok: false,
          diagnosticCode: 'COLLAB_FEATURE_NOT_ENTITLED'
        }
      },
      logger: {
        info() {},
        warn() {},
        error() {}
      }
    })

    const state = await server.start()
    const allowed = await fetchJson(`${state.httpUrl}/license/status`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        documentId: 'doc-license',
        feature: GATE6_COLLAB_FEATURES.server
      })
    })
    const denied = await fetchJson(`${state.httpUrl}/license/status`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        documentId: 'doc-license',
        feature: GATE6_COLLAB_FEATURES.history
      })
    })

    expect(allowed).toMatchObject({
      ok: true,
      feature: GATE6_COLLAB_FEATURES.server,
      requestId: expect.any(String)
    })
    expect(denied).toMatchObject({
      ok: false,
      diagnosticCode: 'COLLAB_FEATURE_NOT_ENTITLED',
      requestId: expect.any(String)
    })
  })

  it('rejects formal Hocuspocus sync when license hook is missing', async () => {
    hocuspocusServer = createJWordCollabHocuspocusServer({
      port: 0,
      address: '127.0.0.1',
      roomPrefix: 'jword-collab-server-missing-license',
      authHook: () => ({
        allow: true,
        role: 'write'
      })
    })
    const state = await hocuspocusServer.start()
    const document = new Y.Doc()
    const adapter = createHocuspocusCollabProviderAdapter({
      document,
      documentId: 'doc-formal-hocuspocus-missing-license',
      roomId: `${state.roomPrefix}-room`,
      clientId: 'client-a',
      webSocketUrl: state.webSocketUrl
    })

    try {
      const error = await waitForProviderError(adapter)

      expect(error).toMatchObject({
        code: 'COLLAB_PROVIDER_AUTH_FAILED',
        recoverable: false
      })
      expect(adapter.status).toBe('error')
    } finally {
      await adapter.destroy()
      document.destroy()
    }
  }, 15000)
})

/** 构造一旦读取 body 就计数并报错的请求流。 */
class BodyTrapRequest extends Readable {
  readonly method: string
  readonly url: string
  readonly headers: IncomingHttpHeaders
  private readCount = 0

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
class CapturedJsonResponse {
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
async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  return fetch(url, init).then((response) => response.json() as Promise<unknown>)
}

/** 等待 provider 完成首次同步。 */
async function waitForSynced(adapter: {
  readonly status: string
  onSynced(listener: () => void): () => void
}): Promise<void> {
  if (adapter.status === 'synced') {
    return
  }

  await new Promise<void>((resolve, reject) => {
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
}

/** 等待 provider 报告错误。 */
async function waitForProviderError(adapter: {
  readonly error: {
    readonly code: string
    readonly recoverable: boolean
  } | undefined
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

  return new Promise((resolve, reject) => {
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
}

/** 生成合法的空 Y.Doc update。 */
function encodeEmptyYDocUpdate(): string {
  const doc = new Y.Doc()
  const update = Y.encodeStateAsUpdate(doc)

  doc.destroy()

  return Buffer.from(update).toString('base64')
}

/** 创建带调用计数的 history storage。 */
function createCountingStorage(): JWordHistoryStorage & {
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
