/**
 * @vitest-environment node
 *
 * 职责：验证第三方只从 @4xian/jword-collab 包入口消费协作 client SDK。
 * 边界：不导入 experimental provider、demo runtime、Y.Doc 或 Hocuspocus 类型。
 * 协作模块：packages/collab/src/client-sdk.ts、内存 provider adapter 和 license feature matrix。
 * 约束：公开入口必须先返回诊断再阻止半连接，用户身份必须稳定派生 presence。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#step-625定义-connectjwordcollaborationeditor-options-公开入口。
 */

import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import { createServer, type IncomingMessage } from 'node:http'
import type { EditorEventListener } from '@4xian/jword-core'
import { createInsecureTestOnlyJWordLicenseSignature } from '@4xian/jword-license'
import { INSECURE_TEST_ONLY_LICENSE_PRIVATE_KEY_SEED } from '../../../fixtures/license/insecure-test-only-keys'

import {
  GATE6_COLLAB_FEATURES,
  JWORD_COLLAB_CLIENT_PACKAGE_VERSION,
  JWORD_COLLAB_CLIENT_PROTOCOL_VERSION,
  connectJWordCollaboration,
  createMemoryCollabProviderAdapter,
  type ConnectJWordCollaborationOptions,
  type JWordCollaborationConnection,
  type JWordCollaborationEditor
} from '@4xian/jword-collab'

describe('@4xian/jword-collab public client SDK', () => {
  it('connects through the stable package entry and exposes productized handles', async () => {
    const editor = createExternalEditor()
    const handshakeServer = await startHandshakeServer({
      protocolVersion: JWORD_COLLAB_CLIENT_PROTOCOL_VERSION,
      packageVersion: '0.0.0',
      featureFlags: Object.values(GATE6_COLLAB_FEATURES),
      minimumClientVersion: '0.0.0',
      minimumServerVersion: '0.0.0'
    })
    const provider = createMemoryCollabProviderAdapter({
      documentId: 'doc-public-client',
      roomId: 'room-public-client',
      clientId: 'user-a'
    })
    try {
      const connection = await connectJWordCollaboration(editor, {
        serverUrl: handshakeServer.url,
        documentId: 'doc-public-client',
        roomId: 'room-public-client',
        user: {
          id: 'user-a',
          name: 'Alice',
          avatarUrl: 'https://example.test/alice.png'
        },
        token: 'token-public-client',
        license: createGate6License(),
        features: [
          GATE6_COLLAB_FEATURES.multiplayer,
          GATE6_COLLAB_FEATURES.offline,
          GATE6_COLLAB_FEATURES.history,
          GATE6_COLLAB_FEATURES.autoInsert
        ],
        provider
      })

      expect(connection.status).toBe('synced')
      expect(connection.diagnostics).toEqual([])
      expect(connection.handshake).toMatchObject({
        protocolVersion: JWORD_COLLAB_CLIENT_PROTOCOL_VERSION,
        clientPackageVersion: JWORD_COLLAB_CLIENT_PACKAGE_VERSION,
        serverPackageVersion: '0.0.0',
        minimumClientVersion: '0.0.0',
        minimumServerVersion: '0.0.0'
      })
      expect(connection.awareness.localUser).toMatchObject({
        id: 'user-a',
        name: 'Alice',
        avatarUrl: 'https://example.test/alice.png'
      })
      expect(connection.awareness.localUser.color).toMatch(/^#[0-9a-f]{6}$/u)

      connection.awareness.setLocalPresence({
        typing: true,
        updatedAt: 100
      })
      expect(connection.awareness.localState).toMatchObject({
        clientId: 'user-a',
        user: connection.awareness.localUser,
        selectionLabel: 'Alice 正在输入',
        updatedAt: 100
      })

      await connection.history.recordVersion({
        label: 'initial',
        createdAt: 120
      })
      expect(await connection.history.listVersions()).toMatchObject([{
        documentId: 'doc-public-client',
        roomId: 'room-public-client',
        label: 'initial',
        author: connection.awareness.localUser,
        createdAt: 120
      }])
      expect(connection.offline.readState()).toMatchObject({
        status: 'synced',
        queuedOperations: 0
      })

      const session = connection.startAutoInsertSession({
        requestId: 'auto-public-client',
        position: {
          anchor: createTestAnchor('doc-public-client', 0)
        },
        actor: {
          id: 'assistant-a',
          name: 'AI Assistant',
          color: '#6f42c1',
          avatarUrl: 'https://example.test/assistant.png'
        }
      })
      expect(session.status).toBe('running')
      expect(session.actor).toEqual({
        id: 'assistant-a',
        name: 'AI Assistant',
        color: '#6f42c1',
        avatarUrl: 'https://example.test/assistant.png'
      })
      expect(session.progress).toMatchObject({
        requestId: 'auto-public-client',
        insertedChunks: 0,
        insertedTextLength: 0
      })
      expect(session.write('协同', {
        chunkId: 'chunk-1',
        index: 0
      })).toEqual({
        ok: true,
        requestId: 'auto-public-client',
        chunkId: 'chunk-1',
        insertedText: '协同'
      })
      expect(editor.appliedUpdates).toEqual([{
        text: '协同',
        requestId: 'auto-public-client',
        actorId: 'assistant-a',
        origin: 'auto-inserter',
        undoScope: 'auto-inserter'
      }])
      expect(session.progress).toMatchObject({
        insertedChunks: 1,
        insertedTextLength: 2
      })
      expect(session.retry({
        position: {
          anchor: createTestAnchor('doc-public-client', 2)
        },
        metadata: {
          chunkId: 'chunk-2',
          index: 1
        },
        text: '继续'
      })).toEqual({
        ok: true,
        requestId: 'auto-public-client',
        chunkId: 'chunk-2',
        insertedText: '继续'
      })
      expect(editor.appliedUpdates.at(-1)).toMatchObject({
        text: '继续',
        requestId: 'auto-public-client',
        actorId: 'assistant-a',
        origin: 'auto-inserter',
        undoScope: 'auto-inserter'
      })
      session.abort()
      expect(session.status).toBe('aborted')

      await connection.disconnect()
      expect(connection.status).toBe('disconnected')
      await connection.destroy()
      expect(connection.status).toBe('destroyed')
      expect(provider.awareness.getStates()).toEqual([])
    } finally {
      await handshakeServer.close()
    }
  })

  it.each([
    {
      name: 'protocol is incompatible',
      serverVersion: {
        protocolVersion: 'gate6-incompatible',
        packageVersion: '0.0.0',
        featureFlags: Object.values(GATE6_COLLAB_FEATURES),
        minimumClientVersion: '0.0.0',
        minimumServerVersion: '0.0.0'
      },
      options: {},
      diagnosticCode: 'COLLAB_PROTOCOL_MISMATCH'
    },
    {
      name: 'server package is too old',
      serverVersion: {
        protocolVersion: JWORD_COLLAB_CLIENT_PROTOCOL_VERSION,
        packageVersion: '0.0.0',
        featureFlags: Object.values(GATE6_COLLAB_FEATURES),
        minimumClientVersion: '0.0.0',
        minimumServerVersion: '0.0.0'
      },
      options: {
        minimumServerVersion: '1.0.0'
      },
      diagnosticCode: 'COLLAB_SERVER_TOO_OLD'
    },
    {
      name: 'client package is too old',
      serverVersion: {
        protocolVersion: JWORD_COLLAB_CLIENT_PROTOCOL_VERSION,
        packageVersion: '0.0.0',
        featureFlags: Object.values(GATE6_COLLAB_FEATURES),
        minimumClientVersion: '1.0.0',
        minimumServerVersion: '0.0.0'
      },
      options: {
        clientPackageVersion: '0.0.0'
      },
      diagnosticCode: 'COLLAB_CLIENT_TOO_OLD'
    },
    {
      name: 'server feature flags are missing',
      serverVersion: {
        protocolVersion: JWORD_COLLAB_CLIENT_PROTOCOL_VERSION,
        packageVersion: '0.0.0',
        featureFlags: [GATE6_COLLAB_FEATURES.server],
        minimumClientVersion: '0.0.0',
        minimumServerVersion: '0.0.0'
      },
      options: {},
      diagnosticCode: 'COLLAB_FEATURE_FLAGS_MISSING'
    }
  ])('fails fast before provider connect when $name', async ({ serverVersion, options, diagnosticCode }) => {
    const editor = createExternalEditor()
    const handshakeServer = await startHandshakeServer(serverVersion)
    const provider = createMemoryCollabProviderAdapter({
      documentId: 'doc-public-client-version',
      roomId: 'room-public-client-version',
      clientId: 'user-a'
    })

    try {
      const connection = await connectJWordCollaboration(editor, {
        serverUrl: handshakeServer.url,
        documentId: 'doc-public-client-version',
        roomId: 'room-public-client-version',
        user: {
          id: 'user-a',
          name: 'Alice'
        },
        token: 'token-public-client',
        license: createGate6License(),
        features: [GATE6_COLLAB_FEATURES.multiplayer],
        provider,
        ...options
      })

      expect(connection.status).toBe('error')
      expect(connection.diagnostics).toMatchObject([{
        code: diagnosticCode,
        severity: 'error',
        recoverable: true
      }])
      expect(provider.status).toBe('idle')
    } finally {
      await handshakeServer.close()
    }
  })

  it('requires explicit auto insert position or range and never reads live caret', async () => {
    const editor = createExternalEditor()
    const handshakeServer = await startHandshakeServer({
      protocolVersion: JWORD_COLLAB_CLIENT_PROTOCOL_VERSION,
      packageVersion: '0.0.0',
      featureFlags: Object.values(GATE6_COLLAB_FEATURES),
      minimumClientVersion: '0.0.0',
      minimumServerVersion: '0.0.0'
    })
    const provider = createMemoryCollabProviderAdapter({
      documentId: 'doc-public-client-auto',
      roomId: 'room-public-client-auto',
      clientId: 'user-a'
    })
    try {
      const connection = await connectJWordCollaboration(editor, {
        serverUrl: handshakeServer.url,
        documentId: 'doc-public-client-auto',
        roomId: 'room-public-client-auto',
        user: {
          id: 'user-a',
          name: 'Alice'
        },
        token: 'token-public-client',
        license: createGate6License(),
        features: [GATE6_COLLAB_FEATURES.autoInsert],
        provider
      })
      const session = connection.startAutoInsertSession({
        requestId: 'auto-missing-position'
      })

      expect(session.status).toBe('failed')
      expect(session.diagnostics).toMatchObject([{
        code: 'COLLAB_AUTO_INSERTER_POSITION_REQUIRED',
        severity: 'error',
        recoverable: true
      }])
      expect(editor.liveCaretReadCount).toBe(0)
      expect(editor.focusCallCount).toBe(0)
      expect(editor.selectionMutationCount).toBe(0)
      expect(editor.appliedUpdates).toEqual([])
    } finally {
      await handshakeServer.close()
    }
  })

  it('publishes local user transactions and applies remote updates without echo loops', async () => {
    const editor = createExternalEditor()
    const handshakeServer = await startHandshakeServer({
      protocolVersion: JWORD_COLLAB_CLIENT_PROTOCOL_VERSION,
      packageVersion: '0.0.0',
      featureFlags: Object.values(GATE6_COLLAB_FEATURES),
      minimumClientVersion: '0.0.0',
      minimumServerVersion: '0.0.0'
    })
    const provider = createMemoryCollabProviderAdapter({
      documentId: 'doc-public-client-flow',
      roomId: 'room-public-client-flow',
      clientId: 'user-a'
    })
    const sentUpdates: TestSentUpdate[] = []
    const originalSendUpdate = provider.sendUpdate

    provider.sendUpdate = vi.fn(async (update, metadata) => {
      sentUpdates.push({
        update: [...update],
        metadata
      })
      await originalSendUpdate(update, metadata)
    })

    try {
      const connection = await connectJWordCollaboration(editor, {
        serverUrl: handshakeServer.url,
        documentId: 'doc-public-client-flow',
        roomId: 'room-public-client-flow',
        user: {
          id: 'user-a',
          name: 'Alice'
        },
        token: 'token-public-client',
        license: createGate6License(),
        features: [GATE6_COLLAB_FEATURES.multiplayer],
        provider
      })

      editor.emitTransaction('local-user')
      editor.emitTransaction('user')
      editor.emitTransaction('remote-user')
      editor.emitTransaction('version-restore')
      editor.emitTransaction('auto-inserter')

      expect(provider.sendUpdate).toHaveBeenCalledTimes(2)
      expect(sentUpdates).toMatchObject([
        {
          update: [1, 2, 3, 1],
          metadata: {
            documentId: 'doc-public-client-flow',
            roomId: 'room-public-client-flow',
            clientId: 'user-a',
            origin: 'local'
          }
        },
        {
          update: [1, 2, 3, 2],
          metadata: {
            documentId: 'doc-public-client-flow',
            roomId: 'room-public-client-flow',
            clientId: 'user-a',
            origin: 'local'
          }
        }
      ])

      const remoteProvider = createMemoryCollabProviderAdapter({
        documentId: 'doc-public-client-flow',
        roomId: 'room-public-client-flow',
        clientId: 'user-b'
      })

      await remoteProvider.connect()
      await remoteProvider.sendUpdate(new Uint8Array([9, 8, 7]), {
        documentId: 'doc-public-client-flow',
        roomId: 'room-public-client-flow',
        clientId: 'user-b',
        updateId: 'remote-update-1',
        origin: 'remote'
      })

      expect(editor.appliedRemoteUpdates).toEqual([{
        update: [9, 8, 7],
        origin: 'remote-user',
        clientId: 'user-b',
        requestId: 'remote-update-1'
      }])
      expect(provider.sendUpdate).toHaveBeenCalledTimes(2)

      await remoteProvider.destroy()
      await connection.destroy()
    } finally {
      await handshakeServer.close()
    }
  })

  it('uses server-backed history HTTP APIs and exposes offline pending queues', async () => {
    const editor = createExternalEditor()
    const historyServer = await startHistoryServer()
    const provider = createMemoryCollabProviderAdapter({
      documentId: 'doc-public-client-history',
      roomId: 'room-public-client-history',
      clientId: 'user-a'
    })

    try {
      const connection = await connectJWordCollaboration(editor, {
        serverUrl: historyServer.url,
        documentId: 'doc-public-client-history',
        roomId: 'room-public-client-history',
        user: {
          id: 'user-a',
          name: 'Alice'
        },
        token: 'token-public-client',
        license: createGate6License(),
        features: [
          GATE6_COLLAB_FEATURES.multiplayer,
          GATE6_COLLAB_FEATURES.history,
          GATE6_COLLAB_FEATURES.offline
        ],
        provider
      })

      provider.disconnect()
      editor.emitTransaction('local-user')
      const pendingRecord = connection.history.recordVersion({
        label: 'offline version',
        createdAt: 120
      })

      expect(connection.offline.readState()).toMatchObject({
        status: 'pending',
        queuedOperations: 2
      })

      await provider.connect()
      const version = await pendingRecord
      const versions = await connection.history.listVersions()
      const preview = await connection.history.previewVersion(version.versionId)

      expect(historyServer.requests.map((request) => `${request.method} ${request.path}`)).toEqual([
        'GET /version',
        'POST /history/versions',
        'GET /history/versions',
        'POST /history/preview'
      ])
      expect(historyServer.requests[1]?.body).toMatchObject({
        documentId: 'doc-public-client-history',
        roomId: 'room-public-client-history',
        clientId: 'user-a',
        authorId: 'user-a',
        origin: 'local-user',
        label: 'offline version',
        updateBase64: 'AQIDAg=='
      })
      expect(version).toMatchObject({
        versionId: 'server-version-1',
        documentId: 'doc-public-client-history',
        roomId: 'room-public-client-history',
        label: 'offline version',
        author: connection.awareness.localUser,
        updateByteLength: 4
      })
      expect(versions).toEqual([version])
      expect(preview).toEqual({
        version
      })
      expect(connection.offline.readState()).toMatchObject({
        status: 'synced',
        queuedOperations: 0
      })

      await connection.destroy()
    } finally {
      await historyServer.close()
    }
  })

  it('returns diagnostics and does not connect provider when initialization fails', async () => {
    const editor = createExternalEditor()
    const provider = createMemoryCollabProviderAdapter({
      documentId: 'doc-public-client-missing-license',
      roomId: 'room-public-client-missing-license',
      clientId: 'user-a'
    })
    const statuses: string[] = []

    provider.onStatusChange((status) => {
      statuses.push(status)
    })

    const connection = await connectJWordCollaboration(editor, {
      serverUrl: 'ws://127.0.0.1:4010',
      documentId: 'doc-public-client-missing-license',
      roomId: 'room-public-client-missing-license',
      user: {
        id: 'user-a',
        name: 'Alice'
      },
      token: 'token-public-client',
      license: undefined,
      features: [GATE6_COLLAB_FEATURES.multiplayer],
      provider
    })

    expect(connection.status).toBe('error')
    expect(connection.diagnostics).toMatchObject([{
      code: 'COLLAB_LICENSE_MISSING',
      severity: 'error',
      recoverable: true
    }])
    expect(provider.status).toBe('idle')
    expect(statuses).toEqual([])

    await connection.destroy()
  })

  it('publishes external TypeScript shapes without experimental provider imports', () => {
    expectTypeOf<ConnectJWordCollaborationOptions>().toMatchTypeOf<{
      readonly serverUrl: string
      readonly documentId: string
      readonly roomId: string
      readonly user: {
        readonly id: string
        readonly name: string
        readonly color?: string
        readonly avatarUrl?: string
      }
      readonly token: string
      readonly license: unknown
      readonly features: readonly string[]
    }>()
    expectTypeOf<JWordCollaborationConnection>().toMatchTypeOf<{
      readonly status: string
      readonly diagnostics: readonly unknown[]
      readonly handshake: unknown
      readonly awareness: unknown
      readonly history: unknown
      readonly offline: unknown
      startAutoInsertSession(input?: unknown): unknown
      disconnect(): Promise<void>
      destroy(): Promise<void>
    }>()
  })
})

/** 创建只暴露协作 SDK 所需最小方法的外部 editor。 */
function createExternalEditor(): TestCollaborationEditor {
  const appliedUpdates: TestAutoInsertUpdate[] = []
  const appliedRemoteUpdates: TestRemoteUpdate[] = []
  const listeners = new Set<EditorEventListener>()
  let updateSequence = 0

  return {
    appliedUpdates,
    appliedRemoteUpdates,
    liveCaretReadCount: 0,
    focusCallCount: 0,
    selectionMutationCount: 0,

    /** 编码当前文档 update。 */
    encodeSyncUpdate() {
      updateSequence += 1

      return new Uint8Array([1, 2, 3, updateSequence])
    },

    /** 应用远端 update。 */
    applySyncUpdate(update, options) {
      if (options.origin === 'auto-inserter') {
        appliedUpdates.push({
          text: new TextDecoder().decode(update),
          requestId: options.requestId ?? '',
          actorId: options.clientId,
          origin: options.origin,
          undoScope: options.undoScope ?? null
        })
      }

      if (options.origin === 'remote-user') {
        appliedRemoteUpdates.push({
          update: [...update],
          origin: options.origin,
          clientId: options.clientId,
          requestId: options.requestId ?? ''
        })
      }

      return {
        ok: true
      }
    },

    /** 订阅测试 editor 事务。 */
    subscribe(listener) {
      listeners.add(listener)

      return () => {
        listeners.delete(listener)
      }
    },

    /** 派发测试事务事件。 */
    emitTransaction(origin) {
      for (const listener of listeners) {
        listener({
          kind: 'transaction',
          transaction: {
            commandName: 'test-transaction',
            origin,
            operationKinds: [],
            projection: {
              document: {
                kind: 'document',
                id: 'doc-public-client',
                sections: []
              }
            },
            dirty: true,
            diagnostic: {
              source: origin === 'remote-user'
                ? 'remote'
                : origin === 'version-restore'
                  ? 'version-restore'
                  : origin === 'auto-inserter'
                    ? 'auto-inserter'
                    : 'local',
              commandName: 'test-transaction',
              operationKinds: [],
              origin,
              updateByteLength: 0,
              local: origin === 'local-user' || origin === 'user',
              remote: origin === 'remote-user'
            }
          }
        })
      }
    }
  }
}

interface TestAutoInsertUpdate {
  readonly text: string
  readonly requestId: string
  readonly actorId: string
  readonly origin: string
  readonly undoScope: string | null
}

interface TestRemoteUpdate {
  readonly update: readonly number[]
  readonly origin: string
  readonly clientId: string
  readonly requestId: string
}

interface TestSentUpdate {
  readonly update: readonly number[]
  readonly metadata: {
    readonly documentId: string
    readonly roomId?: string
    readonly clientId: string
    readonly updateId: string
    readonly createdAt?: number
    readonly origin?: 'local' | 'remote' | 'replay'
  }
}

interface TestCollaborationEditor extends JWordCollaborationEditor {
  readonly appliedUpdates: TestAutoInsertUpdate[]
  readonly appliedRemoteUpdates: TestRemoteUpdate[]
  readonly liveCaretReadCount: number
  readonly focusCallCount: number
  readonly selectionMutationCount: number
  subscribe(listener: EditorEventListener): () => void
  emitTransaction(origin: string): void
}

interface TestHandshakeVersion {
  readonly protocolVersion: string
  readonly packageVersion: string
  readonly featureFlags: readonly string[]
  readonly minimumClientVersion: string
  readonly minimumServerVersion: string
}

interface TestHandshakeServer {
  readonly url: string
  close(): Promise<void>
}

interface TestHistoryRequest {
  readonly method: string
  readonly path: string
  readonly body?: unknown
}

interface TestHistoryServer extends TestHandshakeServer {
  readonly requests: TestHistoryRequest[]
}


/** 启动只返回 /version 的测试握手服务。 */
async function startHandshakeServer(version: TestHandshakeVersion): Promise<TestHandshakeServer> {
  const server = createServer((request, response) => {
    if (request.url !== '/version') {
      response.statusCode = 404
      response.end()
      return
    }

    response.setHeader('content-type', 'application/json; charset=utf-8')
    response.end(`${JSON.stringify({
      ...version,
      requestId: 'test-handshake-request'
    })}\n`)
  })

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })

  const address = server.address()

  if (typeof address !== 'object' || address === null) {
    throw new Error('Handshake test server did not expose an address.')
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    /** 关闭测试握手服务。 */
    close() {
      return new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error !== undefined) {
            reject(error)
            return
          }
          resolve()
        })
      })
    }
  }
}

/** 启动带 /version 和 history HTTP API 的测试服务。 */
async function startHistoryServer(): Promise<TestHistoryServer> {
  const requests: TestHistoryRequest[] = []
  const versions: unknown[] = []
  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      const body = request.method === 'POST'
        ? await readRequestJson(request)
        : undefined

      requests.push({
        method: request.method ?? 'GET',
        path: url.pathname,
        ...(body === undefined ? {} : { body })
      })

      response.setHeader('content-type', 'application/json; charset=utf-8')

      if (request.method === 'GET' && url.pathname === '/version') {
        response.end(`${JSON.stringify({
          protocolVersion: JWORD_COLLAB_CLIENT_PROTOCOL_VERSION,
          packageVersion: '0.0.0',
          featureFlags: Object.values(GATE6_COLLAB_FEATURES),
          minimumClientVersion: '0.0.0',
          minimumServerVersion: '0.0.0'
        })}\n`)
        return
      }

      if (request.method === 'POST' && url.pathname === '/history/versions') {
        const record = body as {
          readonly documentId: string
          readonly roomId: string
          readonly label: string
          readonly authorId: string
          readonly updateBase64: string
        }
        const version = {
          versionId: 'server-version-1',
          documentId: record.documentId,
          roomId: record.roomId,
          label: record.label,
          authorId: record.authorId,
          createdAt: '1970-01-01T00:00:00.120Z',
          byteLength: Buffer.from(record.updateBase64, 'base64').byteLength
        }

        versions.push(version)
        response.end(`${JSON.stringify({
          version,
          diagnostics: [],
          requestId: 'history-record-request'
        })}\n`)
        return
      }

      if (request.method === 'GET' && url.pathname === '/history/versions') {
        response.end(`${JSON.stringify({
          versions,
          requestId: 'history-list-request'
        })}\n`)
        return
      }

      if (request.method === 'POST' && url.pathname === '/history/preview') {
        response.end(`${JSON.stringify({
          version: versions[0],
          updateBase64: 'AQIDAg==',
          diagnostics: [],
          requestId: 'history-preview-request'
        })}\n`)
        return
      }

      response.statusCode = 404
      response.end()
    })()
  })

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })

  const address = server.address()

  if (typeof address !== 'object' || address === null) {
    throw new Error('History test server did not expose an address.')
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    /** 关闭测试 history 服务。 */
    close() {
      return new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error !== undefined) {
            reject(error)
            return
          }
          resolve()
        })
      })
    }
  }
}


/** 读取测试 HTTP JSON 请求体。 */
async function readRequestJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

/** 创建覆盖 Gate 6 所有高级协作能力的测试授权。 */
function createGate6License() {
  const entitlement = {
    customerId: 'customer-public-client',
    licenseToken: 'license-public-client',
    features: Object.values(GATE6_COLLAB_FEATURES),
    issuer: 'jword-test-issuer',
    issuedAt: '2026-05-01T00:00:00Z',
    expiresAt: '2099-06-01T00:00:00Z',
    status: 'valid' as const
  }

  return {
    ...entitlement,
    signature: createInsecureTestOnlyJWordLicenseSignature(entitlement, INSECURE_TEST_ONLY_LICENSE_PRIVATE_KEY_SEED)
  }
}

/** 创建测试用 stable anchor snapshot。 */
function createTestAnchor(documentId: string, graphemeIndex: number) {
  return {
    documentId,
    sectionId: 'body-section',
    blockId: 'body',
    runId: 'body',
    graphemeIndex,
    relativePosition: {
      tname: 'body',
      assoc: -1
    }
  }
}
