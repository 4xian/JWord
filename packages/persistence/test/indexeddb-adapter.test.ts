/**
 * @vitest-environment node
 *
 * 职责：验证 Gate 6 IndexedDB offline adapter 的公开契约和不可用环境降级。
 * 边界：Node 环境只覆盖无 IndexedDB 的 recoverable diagnostic，不伪装真实浏览器恢复。
 * 协作模块：packages/persistence/src/indexeddb-adapter.ts、y-indexeddb 和 examples/collab 浏览器验收。
 * 约束：真实 IndexedDB reload 恢复必须由 Playwright/Kimi 浏览器路径补证。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#iteration-4---offline-recovery-与-indexeddb-persistencestep-65--612。
 */

import * as Y from 'yjs'
import { describe, expect, expectTypeOf, it } from 'vitest'

import {
  createIndexedDbOfflineAdapter
} from '../src/index'
import type {
  JWordIndexedDbOfflineAdapter
} from '../src/index'

describe('@4xian/jword-persistence indexeddb adapter', () => {
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
})
