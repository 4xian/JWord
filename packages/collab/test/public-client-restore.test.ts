/**
 * @vitest-environment node
 *
 * 职责：验证第三方协作 client SDK 的历史版本恢复会替换当前文档状态。
 * 边界：只覆盖公开 connectJWordCollaboration、内存 provider 和 core editor，不导入协作内部实现。
 * 协作模块：packages/collab/src/client-history.ts、core replaceSyncUpdate 和测试 history HTTP 服务。
 * 约束：恢复必须保持 `version-restore` origin，不能把旧 update 直接叠加到当前文档。
 * Specs：docs/superpowers/reports/2026-07-02-gate6-review.md#g6-h4-restoreversion-真实回退语义。
 */

import { createServer, type IncomingMessage } from 'node:http'

import { createEditor } from '@4xian/jword-core'
import { createInsecureTestOnlyJWordLicenseSignature } from '@4xian/jword-license'
import {
  GATE6_COLLAB_FEATURES,
  JWORD_COLLAB_CLIENT_PROTOCOL_VERSION,
  connectJWordCollaboration,
  createMemoryCollabProviderAdapter
} from '@4xian/jword-collab'
import { describe, expect, it } from 'vitest'

import { INSECURE_TEST_ONLY_LICENSE_PRIVATE_KEY_SEED } from '../../../fixtures/license/insecure-test-only-keys'

interface TestHistoryRequest {
  readonly method: string
  readonly path: string
  readonly body?: unknown
}

interface TestRestoreHistoryServer {
  readonly url: string
  readonly requests: readonly TestHistoryRequest[]
  close(): Promise<void>
}

describe('@4xian/jword-collab history restore', () => {
  it('restores history versions by replacing the current document state', async () => {
    const editor = createEditor({
      initialText: 'v1'
    })
    const versionOneUpdate = editor.encodeSyncUpdate()
    const historyServer = await startRestoreHistoryServer(Buffer.from(versionOneUpdate).toString('base64'))
    const provider = createMemoryCollabProviderAdapter({
      documentId: 'doc-public-client-restore',
      roomId: 'room-public-client-restore',
      clientId: 'user-a'
    })
    const transactions: Array<{
      readonly origin: string
      readonly requestId?: string
      readonly source: string
    }> = []

    editor.createDocument({
      text: 'v1\n\nv2'
    })
    editor.subscribe((event) => {
      if (event.kind !== 'transaction') {
        return
      }

      transactions.push({
        origin: event.transaction.origin,
        ...(event.transaction.diagnostic.requestId === undefined ? {} : {
          requestId: event.transaction.diagnostic.requestId
        }),
        source: event.transaction.diagnostic.source
      })
    })

    try {
      const connection = await connectJWordCollaboration(editor, {
        serverUrl: historyServer.url,
        documentId: 'doc-public-client-restore',
        roomId: 'room-public-client-restore',
        user: {
          id: 'user-a',
          name: 'Alice'
        },
        token: 'token-public-client',
        license: createGate6License(),
        features: [
          GATE6_COLLAB_FEATURES.multiplayer,
          GATE6_COLLAB_FEATURES.history
        ],
        provider
      })
      const restored = await connection.history.restoreVersion('server-version-v1')

      expect(restored).toMatchObject({
        ok: true,
        version: {
          versionId: 'server-version-v1'
        }
      })
      expect(readEditorPlainText(editor)).toBe('v1')
      expect(transactions.at(-1)).toEqual({
        origin: 'version-restore',
        requestId: 'server-version-v1',
        source: 'version-restore'
      })

      await connection.destroy()
    } finally {
      await historyServer.close()
    }
  })
})

/** 启动只服务恢复预览的 history 测试服务。 */
async function startRestoreHistoryServer(updateBase64: string): Promise<TestRestoreHistoryServer> {
  const requests: TestHistoryRequest[] = []
  const version = {
    versionId: 'server-version-v1',
    documentId: 'doc-public-client-restore',
    roomId: 'room-public-client-restore',
    label: 'v1',
    authorId: 'user-a',
    createdAt: '1970-01-01T00:00:00.001Z',
    byteLength: Buffer.from(updateBase64, 'base64').byteLength
  }
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

      if (request.method === 'POST' && url.pathname === '/history/preview') {
        response.end(`${JSON.stringify({
          version,
          updateBase64,
          diagnostics: [],
          requestId: 'history-restore-preview-request'
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
    throw new Error('Restore history test server did not expose an address.')
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    /** 关闭测试 restore history 服务。 */
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

/** 读取测试 editor 当前投影中的纯文本。 */
function readEditorPlainText(editor: ReturnType<typeof createEditor>): string {
  const paragraphs: string[] = []

  for (const section of editor.getProjection().document.sections) {
    for (const block of section.blocks) {
      if (block.kind !== 'paragraph') {
        continue
      }

      paragraphs.push(block.runs.map((run) =>
        run.inlines.map((inline) => inline.kind === 'text' ? inline.text : '').join('')
      ).join(''))
    }
  }

  return paragraphs.join('\n\n')
}

/** 读取测试 HTTP JSON 请求体。 */
async function readRequestJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

/** 创建覆盖 Gate 6 history restore 路径的测试授权。 */
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
