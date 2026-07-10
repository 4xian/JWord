/**
 * @vitest-environment node
 *
 * 职责：验证正式协同服务端公开 rateLimit 选项会限制高频业务请求。
 * 边界：只覆盖 self-host HTTP JSON 路由的最小滑窗限流，不测试 WebSocket 或浏览器 UI。
 * 协作模块：packages/collab-server/src/index.ts 提供 server 入口与稳定诊断响应。
 * 约束：超过配置窗口请求数时必须返回稳定 429 诊断，不能继续执行业务 handler。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import { afterEach, describe, expect, it } from 'vitest'

import {
  GATE6_COLLAB_FEATURES,
  createJWordCollabServer,
  type JWordCollabServer
} from '../src/index'

let server: JWordCollabServer | null = null

describe('collab-server rate limit option', () => {
  afterEach(async () => {
    await server?.stop()
    server = null
  })

  it('rejects requests above the configured sliding window limit', async () => {
    server = createJWordCollabServer({
      port: 0,
      address: '127.0.0.1',
      rateLimit: {
        windowMs: 60_000,
        maxRequests: 1
      },
      authHook: () => ({ ok: true }),
      licenseHook: () => ({ ok: true })
    })
    const state = await server.start()
    const body = JSON.stringify({
      documentId: 'doc-rate-limit',
      feature: GATE6_COLLAB_FEATURES.server
    })

    const first = await fetch(`${state.httpUrl}/license/status`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body
    })
    const second = await fetch(`${state.httpUrl}/license/status`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body
    })
    const secondBody = await second.json()

    expect(first.status).toBe(200)
    expect(second.status).toBe(429)
    expect(secondBody).toMatchObject({
      ok: false,
      diagnosticCode: 'JWORD_COLLAB_SERVER_RATE_LIMITED',
      requestId: expect.any(String),
      retryAfterMs: expect.any(Number)
    })
  })
})
