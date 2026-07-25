/**
 * @vitest-environment node
 *
 * 职责：验证 Gate 6 collab demo 的 Hocuspocus 示例服务入口。
 * 边界：只覆盖本地 Node 服务启动、健康响应和关闭，不接入浏览器双窗口 provider。
 * 协作：examples/collab/server/hocuspocus-service.ts 和 @hocuspocus/server。
 * 约束：测试使用随机端口，不占用固定 demo 端口，不写入持久化存储。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import { afterEach, describe, expect, it } from 'vitest'

import { createCollabHocuspocusService } from '../server/hocuspocus-service'
import type { CollabHocuspocusService } from '../server/hocuspocus-service'

let service: CollabHocuspocusService | null = null

describe('collab Hocuspocus service', () => {
  afterEach(async () => {
    await service?.stop()
    service = null
  })

  it('starts a local Hocuspocus service with stable demo metadata', async () => {
    service = createCollabHocuspocusService({
      port: 0,
      address: '127.0.0.1',
      roomPrefix: 'jword-collab-test'
    })

    const started = await service.start()
    const response = await fetch(started.httpUrl)

    expect(started.roomPrefix).toBe('jword-collab-test')
    expect(started.port).toBeGreaterThan(0)
    expect(started.httpUrl).toBe(`http://127.0.0.1:${started.port}`)
    expect(started.webSocketUrl).toBe(`ws://127.0.0.1:${started.port}`)
    await expect(response.text()).resolves.toContain('Welcome to Hocuspocus')
  })
})
