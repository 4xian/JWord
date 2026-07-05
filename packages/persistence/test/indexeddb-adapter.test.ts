/**
 * @vitest-environment node
 *
 * 职责：验证 Gate 6 IndexedDB offline adapter 的公开契约和不可用环境降级。
 * 边界：Node 环境只用模拟 IndexedDB provider 验证 adapter 契约，真实恢复仍走浏览器验收。
 * 协作模块：packages/persistence/src/indexeddb-adapter.ts、y-indexeddb 和 examples/collab 浏览器验收。
 * 约束：真实 IndexedDB reload 恢复必须由 Playwright/Kimi 浏览器路径补证。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#iteration-4---offline-recovery-与-indexeddb-persistencestep-65--612。
 */

import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest'

const indexedDbMock = vi.hoisted(() => {
  const instances: MockIndexeddbPersistence[] = []

  class MockIndexeddbPersistence {
    readonly whenSynced = Promise.resolve()
    private readonly entries = new Map<string, unknown>()

    /** 记录模拟 provider 实例，方便测试断言生命周期。 */
    constructor(
      readonly databaseName: string,
      readonly document: unknown
    ) {
      instances.push(this)
    }

    /** 模拟 y-indexeddb 自定义键值写入。 */
    async set(key: string, value: unknown): Promise<void> {
      this.entries.set(key, value)
    }

    /** 模拟 y-indexeddb 自定义键值读取。 */
    async get(key: string): Promise<unknown> {
      return this.entries.get(key)
    }

    /** 模拟清空 IndexedDB 文档数据。 */
    async clearData(): Promise<void> {
      this.entries.clear()
    }

    /** 模拟销毁 provider 订阅。 */
    async destroy(): Promise<void> {}
  }

  return {
    instances,
    MockIndexeddbPersistence
  }
})

vi.mock('y-indexeddb', () => ({
  IndexeddbPersistence: indexedDbMock.MockIndexeddbPersistence
}))

vi.mock('yjs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('yjs')>()

  return {
    ...actual,
    encodeStateAsUpdate: vi.fn(actual.encodeStateAsUpdate)
  }
})

import * as Y from 'yjs'

import {
  createIndexedDbOfflineAdapter
} from '../src/index'
import type {
  JWordIndexedDbOfflineAdapter
} from '../src/index'

describe('@4xian/jword-persistence indexeddb adapter', () => {
  afterEach(() => {
    delete (globalThis as { indexedDB?: IDBFactory }).indexedDB
    indexedDbMock.instances.length = 0
    vi.clearAllMocks()
  })

  it('exports a real IndexedDB offline adapter contract', () => {
    const document = new Y.Doc()
    const adapter = createIndexedDbOfflineAdapter({
      document,
      documentId: 'doc-indexeddb-contract',
      roomId: 'room-indexeddb-contract'
    })

    expectTypeOf(adapter).toMatchTypeOf<JWordIndexedDbOfflineAdapter>()
    expect(adapter.readState()).toMatchObject({
      documentId: 'doc-indexeddb-contract',
      databaseName: 'room-indexeddb-contract'
    })
  })

  it('returns recoverable diagnostics when IndexedDB is unavailable', async () => {
    const document = new Y.Doc()
    const adapter = createIndexedDbOfflineAdapter({
      document,
      documentId: 'doc-indexeddb-unavailable'
    })

    const stored = await adapter.storeUpdate({
      documentId: 'doc-indexeddb-unavailable',
      update: Y.encodeStateAsUpdate(document)
    })
    const loaded = await adapter.load('doc-indexeddb-unavailable')

    expect(stored).toEqual({
      ok: false,
      diagnostics: [
        expect.objectContaining({
          code: 'PERSISTENCE_INDEXEDDB_UNAVAILABLE',
          recoverable: true,
          documentId: 'doc-indexeddb-unavailable'
        })
      ]
    })
    expect(loaded).toEqual({
      updates: [],
      diagnostics: [
        expect.objectContaining({
          code: 'PERSISTENCE_INDEXEDDB_UNAVAILABLE',
          recoverable: true,
          documentId: 'doc-indexeddb-unavailable'
        })
      ]
    })
  })

  it('tracks update bytes without full state encoding for each update', async () => {
    ;(globalThis as { indexedDB?: IDBFactory }).indexedDB = {} as IDBFactory
    const document = new Y.Doc()
    const adapter = createIndexedDbOfflineAdapter({
      document,
      documentId: 'doc-indexeddb-incremental'
    })
    const encodeStateAsUpdate = vi.mocked(Y.encodeStateAsUpdate)

    await adapter.whenSynced
    const text = document.getText('body')

    for (let index = 0; index < 1000; index += 1) {
      text.insert(text.length, '字')
    }

    expect(encodeStateAsUpdate).not.toHaveBeenCalled()
    expect(adapter.readState().updateByteLength).toBeGreaterThan(0)

    await adapter.destroy()
  })

  it('destroys temporary restored documents after loading persisted updates', async () => {
    ;(globalThis as { indexedDB?: IDBFactory }).indexedDB = {} as IDBFactory
    const document = new Y.Doc()
    const adapter = createIndexedDbOfflineAdapter({
      document,
      documentId: 'doc-indexeddb-restored-destroy'
    })
    const destroySpy = vi.spyOn(Y.Doc.prototype, 'destroy')

    await adapter.whenSynced
    await adapter.load('doc-indexeddb-restored-destroy')

    expect(destroySpy).toHaveBeenCalledTimes(1)

    destroySpy.mockRestore()
    await adapter.destroy()
  })
})
