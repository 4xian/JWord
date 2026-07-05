/**
 * @vitest-environment node
 *
 * 职责：验证正式协同服务端 record、preview 与 relay 请求体 tenantId 必须匹配授权 metadata。
 * 边界：只覆盖 HTTP JSON 路由的 metadata mismatch 诊断，不测试 WebSocket 或浏览器 UI。
 * 协作模块：packages/collab-server/src/history-routes.ts、auto-insert-relay.ts 和 server-test-helpers。
 * 约束：body tenantId 与 URL/header tenantId 不一致时必须在业务写入前返回稳定诊断码。
 * Specs：docs/superpowers/reports/2026-07-02-gate6-review.md#recordpreviewrelay-未校验-bodytenantid-与授权-metadata-一致。
 */

import { afterEach, describe, expect, it } from 'vitest'
import { createVolatileHistoryStorage } from '@4xian/jword-persistence'

import {
  createJWordCollabServer,
  type JWordCollabServer
} from '../src/index'
import {
  encodeEmptyYDocUpdate,
  fetchJson
} from './server-test-helpers'

let server: JWordCollabServer | null = null

describe('collab-server tenant metadata mismatch', () => {
  afterEach(async () => {
    await server?.stop()
    server = null
  })

  it('rejects history record, history preview and relay when body tenantId differs from metadata', async () => {
    server = createJWordCollabServer({
      port: 0,
      address: '127.0.0.1',
      historyStorage: createVolatileHistoryStorage(),
      authHook: () => ({ ok: true }),
      licenseHook: () => ({ ok: true })
    })
    const state = await server.start()
    const seeded = await fetchJson(`${state.httpUrl}/history/versions?documentId=doc-tenant-mismatch&tenantId=tenant-a`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        documentId: 'doc-tenant-mismatch',
        roomId: 'room-tenant-mismatch',
        clientId: 'client-tenant-mismatch',
        authorId: 'author-tenant-mismatch',
        origin: 'local-user',
        label: 'seed',
        updateBase64: encodeEmptyYDocUpdate(),
        tenantId: 'tenant-a'
      })
    }) as { readonly version?: { readonly versionId?: string } }
    const versionId = seeded.version?.versionId ?? 'version-1'

    const record = await fetch(`${state.httpUrl}/history/versions?documentId=doc-tenant-mismatch&tenantId=tenant-a`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        documentId: 'doc-tenant-mismatch',
        roomId: 'room-tenant-mismatch',
        clientId: 'client-tenant-mismatch',
        authorId: 'author-tenant-mismatch',
        origin: 'local-user',
        label: 'blocked-record',
        updateBase64: encodeEmptyYDocUpdate(),
        tenantId: 'tenant-b'
      })
    })
    const preview = await fetch(`${state.httpUrl}/history/preview?documentId=doc-tenant-mismatch&versionId=${versionId}&tenantId=tenant-a`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        documentId: 'doc-tenant-mismatch',
        versionId,
        tenantId: 'tenant-b'
      })
    })
    const relay = await fetch(`${state.httpUrl}/auto-insert/relay?documentId=doc-tenant-mismatch&tenantId=tenant-a`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        documentId: 'doc-tenant-mismatch',
        requestId: 'relay-tenant-mismatch',
        actorId: 'assistant-a',
        chunkText: '协同',
        tenantId: 'tenant-b'
      })
    })

    await expectMismatch(record, 'JWORD_COLLAB_HISTORY_METADATA_MISMATCH')
    await expectMismatch(preview, 'JWORD_COLLAB_HISTORY_METADATA_MISMATCH')
    await expectMismatch(relay, 'JWORD_COLLAB_AUTO_INSERT_RELAY_METADATA_MISMATCH')
  })
})

/** 断言 metadata mismatch 响应使用稳定诊断码。 */
async function expectMismatch(response: Response, diagnosticCode: string): Promise<void> {
  const body = await response.json()

  expect(response.status).toBe(400)
  expect(body).toMatchObject({
    ok: false,
    diagnosticCode,
    requestId: expect.any(String)
  })
}
