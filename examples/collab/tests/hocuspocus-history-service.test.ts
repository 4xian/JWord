/**
 * @vitest-environment node
 *
 * 职责：验证 Gate 6 Hocuspocus 服务侧 history service 使用 storage-backed persistence contract。
 * 边界：只覆盖服务端 history backend、document 级串行事务和跨服务实例共享 storage，不启动浏览器 UI。
 * 协作：examples/collab/server/hocuspocus-history-service.ts、hocuspocus-service.ts 和 @4xian/jword-persistence。
 * 约束：测试使用易失 storage 模拟宿主生产后端；版本内容仍来自 Yjs binary update，不保存 projection JSON。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md Gate 6 Step 6.13。
 */
import {
  createVolatileHistoryStorage
} from '@4xian/jword-persistence'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'

import {
  createCollabHocuspocusHistoryService
} from '../server/hocuspocus-history-service'
import { createCollabHocuspocusService } from '../server/hocuspocus-service'

describe('collab Hocuspocus service history backend', () => {
  it('跨服务实例复用 storage-backed history backend 完成 list、preview 和 restore', async () => {
    const storage = createVolatileHistoryStorage()
    const service = createCollabHocuspocusService({
      port: 0,
      address: '127.0.0.1',
      roomPrefix: 'jword-collab-history-service',
      historyStorage: storage
    })
    const started = await service.start()
    const source = createTextDocument('server-history-v1')
    const recorded = await service.readHistoryService().recordVersion({
      documentId: 'server-history-doc',
      roomId: 'server-history-room',
      clientId: 'server-client-a',
      authorId: 'server-author-a',
      origin: 'local-user',
      label: 'server-history-v1',
      update: Y.encodeStateAsUpdate(source),
      snapshotId: 'server-history-snapshot-v1',
      createdAt: '2026-05-26T07:00:00.000Z'
    })

    expect(started.webSocketUrl).toBe(`ws://127.0.0.1:${started.port}`)

    await service.stop()

    const restarted = createCollabHocuspocusService({
      port: 0,
      address: '127.0.0.1',
      roomPrefix: 'jword-collab-history-service',
      historyStorage: storage
    })
    await restarted.start()
    const versions = await restarted.readHistoryService().listVersions('server-history-doc')
    const preview = await restarted.readHistoryService().createPreview({
      documentId: 'server-history-doc',
      versionId: recorded.version.versionId
    })
    const target = createTextDocument('current')
    const restored = await restarted.readHistoryService().restoreVersion({
      documentId: 'server-history-doc',
      versionId: recorded.version.versionId,
      targetDoc: target,
      origin: 'version-restore'
    })

    expect(recorded.version).toMatchObject({
      label: 'server-history-v1',
      snapshotId: 'server-history-snapshot-v1',
      roomId: 'server-history-room'
    })
    expect(versions.map((version) => version.label)).toEqual(['server-history-v1'])
    expect(preview.doc.getText('body').toString()).toBe('server-history-v1')
    expect(target.getText('body').toString()).toBe('server-history-v1')
    expect(restored.version).toMatchObject({
      label: 'restore:server-history-v1',
      restoreSourceVersionId: recorded.version.versionId
    })

    await restarted.stop()
  })

  it('同一 document 的并发写入通过服务端事务边界串行保存', async () => {
    const history = createCollabHocuspocusHistoryService({
      storage: createVolatileHistoryStorage()
    })
    const first = createTextDocument('first')
    const second = createTextDocument('second')

    await Promise.all([
      history.recordVersion({
        documentId: 'concurrent-history-doc',
        roomId: 'concurrent-history-room',
        clientId: 'server-client-a',
        authorId: 'server-author-a',
        origin: 'local-user',
        label: 'first',
        update: Y.encodeStateAsUpdate(first)
      }),
      history.recordVersion({
        documentId: 'concurrent-history-doc',
        roomId: 'concurrent-history-room',
        clientId: 'server-client-b',
        authorId: 'server-author-b',
        origin: 'remote-user',
        label: 'second',
        update: Y.encodeStateAsUpdate(second)
      })
    ])

    const versions = await history.listVersions('concurrent-history-doc')

    expect(versions).toHaveLength(2)
    expect(versions.map((version) => version.updateCount)).toEqual([1, 2])
    expect(new Set(versions.map((version) => version.label))).toEqual(new Set(['first', 'second']))
  })

  it('通过服务 HTTP API 记录、列出和预览 storage-backed 历史版本', async () => {
    const service = createCollabHocuspocusService({
      port: 0,
      address: '127.0.0.1',
      roomPrefix: 'jword-collab-history-http',
      historyStorage: createVolatileHistoryStorage()
    })
    const started = await service.start()
    const source = createTextDocument('http-history-v1')
    const recordResponse = await fetch(`${started.historyHttpUrl}/jword-history/versions?documentId=http-history-doc`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        documentId: 'http-history-doc',
        roomId: 'http-history-room',
        clientId: 'server-client-a',
        authorId: 'server-author-a',
        origin: 'local-user',
        label: 'http-history-v1',
        updateBase64: encodeBase64(Y.encodeStateAsUpdate(source)),
        snapshotId: 'http-history-snapshot-v1',
        createdAt: '2026-05-26T08:00:00.000Z'
      })
    })
    const recordJson = await recordResponse.json() as {
      readonly version: { readonly versionId: string, readonly label: string, readonly snapshotId: string }
    }
    const listResponse = await fetch(`${started.historyHttpUrl}/jword-history/versions?documentId=http-history-doc`)
    const listJson = await listResponse.json() as {
      readonly versions: readonly { readonly versionId: string, readonly label: string }[]
    }
    const previewResponse = await fetch(`${started.historyHttpUrl}/jword-history/preview?documentId=http-history-doc&versionId=${recordJson.version.versionId}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        documentId: 'http-history-doc',
        versionId: recordJson.version.versionId
      })
    })
    const previewJson = await previewResponse.json() as {
      readonly updateBase64: string
      readonly version: { readonly label: string }
    }
    const previewDoc = new Y.Doc()

    Y.applyUpdate(previewDoc, decodeBase64(previewJson.updateBase64))

    expect(recordResponse.status).toBe(200)
    expect(recordJson.version).toMatchObject({
      label: 'http-history-v1',
      snapshotId: 'http-history-snapshot-v1'
    })
    expect(listResponse.status).toBe(200)
    expect(listJson.versions.map((version) => version.label)).toEqual(['http-history-v1'])
    expect(previewResponse.status).toBe(200)
    expect(previewJson.version.label).toBe('http-history-v1')
    expect(previewDoc.getText('body').toString()).toBe('http-history-v1')

    await service.stop()
  })
})

/** 创建只含 body 文本的 Y.Doc 测试文档。 */
function createTextDocument(text: string): Y.Doc {
  const doc = new Y.Doc()

  doc.getText('body').insert(0, text)

  return doc
}

/** 编码 HTTP API 使用的 base64 update。 */
function encodeBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}

/** 解码 HTTP API 返回的 base64 update。 */
function decodeBase64(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, 'base64'))
}
