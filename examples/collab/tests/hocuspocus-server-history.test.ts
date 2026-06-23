/**
 * @vitest-environment node
 *
 * 职责：验证浏览器 Hocuspocus runtime 的服务端 history HTTP client 失败诊断。
 * 边界：只 mock fetch 与 Y.Doc，不启动浏览器、Vite、Hocuspocus 或 IndexedDB。
 * 协作：examples/collab/src/runtime/hocuspocus-server-history.ts 和 persistence diagnostic 契约。
 * 约束：API 失败时不得抛出未处理异常，也不得覆盖当前可写文档。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md Gate 6 Step 6.13。
 */
import type { JWordPersistenceDiagnostic } from '@4xian/jword-persistence'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'

import {
  createHocuspocusServerHistoryClient
} from '../src/runtime/hocuspocus-server-history'

describe('Hocuspocus server history browser client', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('服务端 history API 失败时记录诊断且不覆盖当前文档', async () => {
    const diagnostics: JWordPersistenceDiagnostic[] = []
    const document = new Y.Doc()
    const client = createHocuspocusServerHistoryClient({
      historyApiUrl: 'http://127.0.0.1:65535',
      documentId: 'history-api-failure-doc',
      roomId: 'history-api-failure-room',
      clientId: 'client-a',
      authorId: 'client-a',
      notify() {},
      recordDiagnostics(nextDiagnostics) {
        diagnostics.push(...nextDiagnostics)
      }
    })

    document.getText('body').insert(0, 'current document')
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('history api unavailable'))

    await expect(client.recordVersion('will-fail', 'local-user', Y.encodeStateAsUpdate(document))).resolves.toBeUndefined()
    await expect(client.previewVersion('missing-version')).resolves.toBeNull()
    await expect(client.restoreVersion('missing-version', document)).resolves.toBe(false)

    expect(document.getText('body').toString()).toBe('current document')
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'PERSISTENCE_RESTORE_FAILED',
      'PERSISTENCE_RESTORE_FAILED',
      'PERSISTENCE_RESTORE_FAILED'
    ])
  })
})
