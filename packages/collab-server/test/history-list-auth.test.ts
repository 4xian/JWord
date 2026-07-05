/**
 * @vitest-environment node
 *
 * 职责：验证正式协同服务端 history list 路由读取 header/query 授权 metadata。
 * 边界：只覆盖 HTTP history list 的 licenseHook 入参与响应，不测试 WebSocket 或浏览器 UI。
 * 协作模块：packages/collab-server/src/index.ts 提供服务入口，server-test-helpers 提供测试请求工具。
 * 约束：GET list 必须与 record/preview 一样传递 entitlement，避免版本元数据枚举风险。
 * Specs：docs/superpowers/reports/2026-07-02-gate6-review.md#history-list-授权-metadata-与-recordpreview-不一致。
 */

import { afterEach, describe, expect, it } from 'vitest'
import { createVolatileHistoryStorage } from '@4xian/jword-persistence'

import {
  GATE6_COLLAB_FEATURES,
  createJWordCollabServer,
  type JWordCollabServer
} from '../src/index'
import {
  encodeEmptyYDocUpdate,
  fetchJson
} from './server-test-helpers'

let server: JWordCollabServer | null = null

describe('collab-server history list authorization metadata', () => {
  afterEach(async () => {
    await server?.stop()
    server = null
  })

  it('requires entitlement for history list and forwards header metadata to license hook', async () => {
    const entitlement = {
      customerId: 'customer-history-list',
      licenseToken: 'token-history-list',
      features: [GATE6_COLLAB_FEATURES.history]
    }
    const licenseCalls: Array<{
      readonly documentId: string
      readonly feature: string
      readonly entitlement?: unknown
    }> = []

    server = createJWordCollabServer({
      port: 0,
      address: '127.0.0.1',
      historyStorage: createVolatileHistoryStorage(),
      authHook: () => ({ ok: true }),
      licenseHook: (input) => {
        licenseCalls.push({
          documentId: input.documentId,
          feature: input.feature,
          ...(input.entitlement === undefined ? {} : { entitlement: input.entitlement })
        })

        return input.entitlement === undefined
          ? {
              ok: false,
              diagnosticCode: 'JWORD_COLLAB_LICENSE_METADATA_REQUIRED'
            }
          : { ok: true }
      }
    })
    const state = await server.start()

    await fetchJson(`${state.httpUrl}/history/versions?documentId=doc-history-list&entitlement=${encodeURIComponent(JSON.stringify(entitlement))}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        documentId: 'doc-history-list',
        roomId: 'room-history-list',
        clientId: 'client-history-list',
        authorId: 'author-history-list',
        origin: 'local-user',
        label: 'history list seed',
        updateBase64: encodeEmptyYDocUpdate()
      })
    })

    const denied = await fetch(`${state.httpUrl}/history/versions?documentId=doc-history-list`)
    const deniedBody = await denied.json()
    const allowed = await fetchJson(`${state.httpUrl}/history/versions?documentId=doc-history-list`, {
      headers: {
        'x-jword-entitlement': JSON.stringify(entitlement)
      }
    })

    expect(denied.status).toBe(403)
    expect(deniedBody).toMatchObject({
      ok: false,
      diagnosticCode: 'JWORD_COLLAB_LICENSE_METADATA_REQUIRED',
      requestId: expect.any(String)
    })
    expect(allowed).toMatchObject({
      versions: [{
        documentId: 'doc-history-list',
        label: 'history list seed'
      }],
      requestId: expect.any(String)
    })
    expect(licenseCalls).toEqual([
      {
        documentId: 'doc-history-list',
        feature: GATE6_COLLAB_FEATURES.history,
        entitlement
      },
      {
        documentId: 'doc-history-list',
        feature: GATE6_COLLAB_FEATURES.history
      },
      {
        documentId: 'doc-history-list',
        feature: GATE6_COLLAB_FEATURES.history,
        entitlement
      }
    ])
  })
})
