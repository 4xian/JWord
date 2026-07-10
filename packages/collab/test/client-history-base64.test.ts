/**
 * @vitest-environment node
 *
 * 职责：验证协作 history HTTP payload 的大二进制 base64 编解码。
 * 边界：只通过公开 connectJWordCollaboration API 驱动 history，不导入内部实现。
 * 协作模块：client-history.ts、client-sdk.ts 和内存 provider adapter。
 * 约束：大 update 编解码不得展开整段 Uint8Array 到调用栈。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import { createServer, type IncomingMessage } from 'node:http'

import type { EditorEventListener } from '@4xian/jword-core'
import {
  createInsecureTestOnlyJWordLicenseSignature,
  type JWordLicenseEntitlement,
  type JWordLicenseSignaturePayload
} from '@4xian/jword-license'
import {
  GATE6_COLLAB_FEATURES,
  JWORD_COLLAB_CLIENT_PROTOCOL_VERSION,
  connectJWordCollaboration,
  createMemoryCollabProviderAdapter,
  type JWordCollaborationEditor,
  type JWordCollaborationRemoteUpdateOptions
} from '@4xian/jword-collab'
import { describe, expect, it } from 'vitest'
import { INSECURE_TEST_ONLY_LICENSE_PRIVATE_KEY_SEED } from '../../../fixtures/license/insecure-test-only-keys'

describe('collaboration history base64 codec', () => {
  it('records and restores a 1MB update without stack overflow', async () => {
    const update = createLargeUpdate(1024 * 1024)
    const editor = createHistoryEditor(update)
    const server = await startHistoryServer()
    const provider = createMemoryCollabProviderAdapter({
      documentId: 'doc-history-base64',
      roomId: 'room-history-base64',
      clientId: 'user-a'
    })

    try {
      const connection = await connectJWordCollaboration(editor, {
        serverUrl: server.url,
        documentId: 'doc-history-base64',
        roomId: 'room-history-base64',
        user: {
          id: 'user-a',
          name: 'Alice'
        },
        token: 'token-history-base64',
        license: createGate6License(),
        features: [
          GATE6_COLLAB_FEATURES.multiplayer,
          GATE6_COLLAB_FEATURES.history
        ],
        provider
      })
      const version = await connection.history.recordVersion({
        label: 'large update',
        createdAt: 120
      })
      const restore = await connection.history.restoreVersion(version.versionId)

      expect(Buffer.compare(Buffer.from(server.recordedUpdate), Buffer.from(update))).toBe(0)
      expect(restore.ok).toBe(true)
      expect(editor.restoredUpdates).toHaveLength(1)
      expect(Buffer.compare(Buffer.from(editor.restoredUpdates[0] ?? []), Buffer.from(update))).toBe(0)

      await connection.destroy()
    } finally {
      await server.close()
    }
  })
})

interface TestHistoryServer {
  readonly url: string
  readonly recordedUpdate: Uint8Array
  close(): Promise<void>
}

interface HistoryEditor extends JWordCollaborationEditor {
  readonly restoredUpdates: Uint8Array[]
}

/** 创建确定性大 update，覆盖所有字节值。 */
function createLargeUpdate(length: number): Uint8Array {
  return Uint8Array.from({ length }, (_value, index) => index % 256)
}

/** 创建只暴露 history 所需能力的测试 editor。 */
function createHistoryEditor(update: Uint8Array): HistoryEditor {
  const restoredUpdates: Uint8Array[] = []

  return {
    restoredUpdates,
    /** 编码当前测试文档 update。 */
    encodeSyncUpdate() {
      return update
    },
    /** 捕获版本恢复路径解码出的 update。 */
    applySyncUpdate(nextUpdate: Uint8Array, options: JWordCollaborationRemoteUpdateOptions) {
      if (options.origin === 'version-restore') {
        restoredUpdates.push(nextUpdate)
      }

      return { ok: true }
    },
    /** history 测试不需要订阅事务，保留公开契约形状。 */
    subscribe(_listener: EditorEventListener) {
      return () => {}
    }
  }
}

/** 启动最小 history HTTP 服务，并回显记录过的 update。 */
async function startHistoryServer(): Promise<TestHistoryServer> {
  let recordedUpdate = new Uint8Array()
  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      const body = request.method === 'POST'
        ? await readRequestJson(request)
        : undefined

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
        const record = readHistoryRecordBody(body)
        recordedUpdate = new Uint8Array(Buffer.from(record.updateBase64, 'base64'))
        response.end(`${JSON.stringify({
          version: {
            versionId: 'large-version-1',
            documentId: record.documentId,
            roomId: record.roomId,
            label: record.label,
            authorId: record.authorId,
            createdAt: '1970-01-01T00:00:00.120Z',
            byteLength: recordedUpdate.byteLength
          },
          diagnostics: []
        })}\n`)
        return
      }

      if (request.method === 'POST' && url.pathname === '/history/preview') {
        response.end(`${JSON.stringify({
          version: {
            versionId: 'large-version-1',
            documentId: 'doc-history-base64',
            roomId: 'room-history-base64',
            label: 'large update',
            authorId: 'user-a',
            createdAt: '1970-01-01T00:00:00.120Z',
            byteLength: recordedUpdate.byteLength
          },
          updateBase64: Buffer.from(recordedUpdate).toString('base64'),
          diagnostics: []
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
    get recordedUpdate() {
      return recordedUpdate
    },
    /** 关闭测试 HTTP 服务。 */
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

interface HistoryRecordBody {
  readonly documentId: string
  readonly roomId: string
  readonly label: string
  readonly authorId: string
  readonly updateBase64: string
}

/** 读取并校验 history record 请求体。 */
function readHistoryRecordBody(body: unknown): HistoryRecordBody {
  if (!isRecord(body)) {
    throw new Error('History record body is not an object.')
  }

  return {
    documentId: readStringField(body, 'documentId'),
    roomId: readStringField(body, 'roomId'),
    label: readStringField(body, 'label'),
    authorId: readStringField(body, 'authorId'),
    updateBase64: readStringField(body, 'updateBase64')
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

/** 创建覆盖 Gate 6 history 能力的测试授权。 */
function createGate6License(): JWordLicenseEntitlement {
  return createSignedGate6License({
    customerId: 'customer-history-base64',
    licenseToken: 'license-history-base64',
    features: Object.values(GATE6_COLLAB_FEATURES),
    issuer: 'jword-test-issuer',
    issuedAt: '2026-05-01T00:00:00Z',
    expiresAt: '2099-06-01T00:00:00Z',
    status: 'valid'
  })
}

/** 创建测试 license 签名。 */
function createSignedGate6License(payload: JWordLicenseSignaturePayload): JWordLicenseEntitlement {
  return {
    ...payload,
    signature: createInsecureTestOnlyJWordLicenseSignature(payload, INSECURE_TEST_ONLY_LICENSE_PRIVATE_KEY_SEED)
  }
}

/** 判断未知值是否为普通对象。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** 读取必需字符串字段。 */
function readStringField(record: Record<string, unknown>, key: string): string {
  const value = record[key]

  if (typeof value !== 'string') {
    throw new Error(`Missing string field: ${key}`)
  }

  return value
}
