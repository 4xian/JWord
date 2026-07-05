/**
 * @vitest-environment node
 *
 * 职责：验证 Gate 6 collab 包的最小公开契约和内存 adapter 行为。
 * 边界：不接入真实网络 provider、IndexedDB、DOM 或 core 内部 store。
 * 协作模块：后续 hocuspocus/y-websocket 适配器应复用同一 ProviderAdapter 契约。
 * 约束：测试先行，新增协同行为必须先观察红灯再实现。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#gate-6--collaborationauto-insert。
 */

import { describe, expect, expectTypeOf, it } from 'vitest'
import * as Y from 'yjs'
import {
  createInsecureTestOnlyJWordLicenseSignature,
  type JWordLicenseEntitlement,
  type JWordLicenseSignaturePayload
} from '@4xian/jword-license'

import {
  GATE6_COLLAB_FEATURES,
  createJWordCollabFeatureGate,
  cleanupStaleAwarenessStates,
  createMemoryCollabProviderAdapter,
  downgradeUnresolvedAnchorToPresence,
  parseAwarenessState,
  resetMemoryCollabRooms,
  serializeAwarenessState
} from '../src/index'
import {
  createHocuspocusCollabProviderAdapter
} from '../src/experimental'
import type {
  JWordAwarenessState,
  JWordCollabDiagnostic,
  JWordCollabProviderAdapter,
  JWordCollabProviderError,
  JWordCollabProviderStatus,
  JWordCollabUpdateMetadata
} from '../src/index'
import { INSECURE_TEST_ONLY_LICENSE_PRIVATE_KEY_SEED } from '../../../fixtures/license/insecure-test-only-keys'

describe('@4xian/jword-collab contract', () => {
  it('exposes provider adapter and diagnostic types', () => {
    expectTypeOf<JWordCollabProviderStatus>().toEqualTypeOf<
      'idle' | 'connecting' | 'connected' | 'synced' | 'disconnected' | 'reconnecting' | 'offline' | 'error'
    >()
    expectTypeOf<JWordCollabProviderError>().toMatchTypeOf<{
      readonly code: string
      readonly message: string
      readonly recoverable: boolean
    }>()
    expectTypeOf<JWordCollabUpdateMetadata>().toMatchTypeOf<{
      readonly documentId: string
      readonly clientId: string
      readonly updateId: string
    }>()
    expectTypeOf<JWordCollabDiagnostic>().toMatchTypeOf<{
      readonly code: string
      readonly severity: 'info' | 'warning' | 'error'
      readonly message: string
    }>()
    expectTypeOf<JWordCollabProviderAdapter>().toMatchTypeOf<{
      readonly status: JWordCollabProviderStatus
      connect(): Promise<void>
      disconnect(): Promise<void>
      destroy(): Promise<void>
      sendUpdate(update: Uint8Array, metadata: JWordCollabUpdateMetadata): Promise<void>
      onStatus(listener: (status: JWordCollabProviderStatus) => void): () => void
    }>()
  })

  it('returns stable collab diagnostics before paid features read document content', () => {
    const missing = createJWordCollabFeatureGate(undefined, GATE6_COLLAB_FEATURES.multiplayer)
    const expired = createJWordCollabFeatureGate(createGate6TestLicense({
      customerId: 'customer-gate6',
      licenseToken: 'token-gate6',
      features: [GATE6_COLLAB_FEATURES.multiplayer],
      expiresAt: '2026-05-01T00:00:00Z',
      status: 'valid'
    }), GATE6_COLLAB_FEATURES.multiplayer, {
      now: new Date('2026-05-27T00:00:00Z')
    })
    const mismatch = createJWordCollabFeatureGate(createGate6TestLicense({
      customerId: 'customer-gate6',
      licenseToken: 'token-gate6',
      features: [GATE6_COLLAB_FEATURES.multiplayer],
      expiresAt: '2099-06-01T00:00:00Z',
      status: 'valid'
    }), GATE6_COLLAB_FEATURES.autoInsert)
    const serverUnavailable = createJWordCollabFeatureGate(createGate6TestLicense({
      customerId: 'customer-gate6',
      licenseToken: 'token-gate6',
      features: [GATE6_COLLAB_FEATURES.history],
      expiresAt: '2099-06-01T00:00:00Z',
      status: 'server-unavailable'
    }), GATE6_COLLAB_FEATURES.history)

    expect(missing).toMatchObject({
      ok: false,
      feature: GATE6_COLLAB_FEATURES.multiplayer,
      diagnostic: {
        code: 'COLLAB_LICENSE_MISSING',
        severity: 'error',
        recoverable: true
      }
    })
    expect(expired.diagnostic?.code).toBe('COLLAB_LICENSE_EXPIRED')
    expect(mismatch.diagnostic?.code).toBe('COLLAB_FEATURE_NOT_ENTITLED')
    expect(serverUnavailable.diagnostic?.code).toBe('COLLAB_LICENSE_SERVER_UNAVAILABLE')
  })

  it('connects, emits updates, marks synced and disconnects through memory adapter', async () => {
    const adapter = createMemoryCollabProviderAdapter({
      documentId: 'doc-collab-1',
      clientId: 'client-a'
    })
    const statuses: JWordCollabProviderStatus[] = []
    const updates: Array<{
      readonly update: readonly number[]
      readonly metadata: JWordCollabUpdateMetadata
    }> = []
    const synced: boolean[] = []

    const disposeStatus = adapter.onStatusChange((status) => {
      statuses.push(status)
    })
    adapter.onUpdate((update, metadata) => {
      updates.push({
        update: [...update],
        metadata
      })
    })
    adapter.onSynced(() => {
      synced.push(true)
    })

    await adapter.connect()
    expect(adapter.status).toBe('synced')
    await adapter.sendUpdate(new Uint8Array([1, 2, 3]), {
      documentId: 'doc-collab-1',
      clientId: 'client-a',
      updateId: 'update-1',
      createdAt: 10
    })
    await adapter.disconnect()
    disposeStatus()

    expect(statuses).toEqual(['connecting', 'connected', 'synced', 'disconnected'])
    expect(synced).toEqual([true])
    expect(updates).toEqual([
      {
        update: [1, 2, 3],
        metadata: {
          documentId: 'doc-collab-1',
          clientId: 'client-a',
          updateId: 'update-1',
          createdAt: 10
        }
      }
    ])
    expect(adapter.status).toBe('disconnected')
    expect(adapter.diagnostics).toEqual([])
    await adapter.destroy()
  })

  it('resets global memory collaboration rooms for tests and host teardown', async () => {
    const stale = createMemoryCollabProviderAdapter({
      documentId: 'doc-memory-reset',
      roomId: 'room-memory-reset',
      clientId: 'client-a'
    })
    const fresh = createMemoryCollabProviderAdapter({
      documentId: 'doc-memory-reset',
      roomId: 'room-memory-reset',
      clientId: 'client-b'
    })
    const staleUpdates: JWordCollabUpdateMetadata[] = []

    stale.onUpdate((_update, metadata) => {
      staleUpdates.push(metadata)
    })
    await stale.connect()
    stale.awareness.setLocalState({
      clientId: 'client-a',
      user: {
        id: 'user-a',
        name: 'Alice'
      },
      updatedAt: 1
    })

    resetMemoryCollabRooms()
    await fresh.connect()
    await fresh.sendUpdate(new Uint8Array([4, 5, 6]), {
      documentId: 'doc-memory-reset',
      roomId: 'room-memory-reset',
      clientId: 'client-b',
      updateId: 'update-after-reset'
    })

    expect(staleUpdates).toEqual([])
    expect(fresh.awareness.getStates()).toEqual([])

    await stale.destroy()
    await fresh.destroy()
  })

  it('exposes a Hocuspocus provider adapter factory through the public contract', async () => {
    const document = new Y.Doc()
    const adapter = createHocuspocusCollabProviderAdapter({
      document,
      documentId: 'doc-hocuspocus-contract',
      roomId: 'jword-collab-contract',
      clientId: 'client-a',
      webSocketUrl: 'ws://127.0.0.1:1',
      autoConnect: false
    })

    expect(adapter.status).toBe('idle')
    expect(adapter.diagnostics).toEqual([])
    expect(adapter.awareness.getStates()).toEqual([])

    await adapter.destroy()
    document.destroy()
  })

  it('broadcasts updates and awareness between memory adapters in the same room', async () => {
    const leftDoc = new Y.Doc()
    const rightDoc = new Y.Doc()
    const left = createMemoryCollabProviderAdapter({
      documentId: 'doc-collab-room',
      roomId: 'room-memory',
      clientId: 'client-a'
    })
    const right = createMemoryCollabProviderAdapter({
      documentId: 'doc-collab-room',
      roomId: 'room-memory',
      clientId: 'client-b'
    })
    const rightAwareness: JWordAwarenessState[] = []

    left.onUpdate((update) => {
      Y.applyUpdate(leftDoc, update, 'remote-user')
    })
    right.onUpdate((update) => {
      Y.applyUpdate(rightDoc, update, 'remote-user')
    })
    right.awareness.onChange((states) => {
      rightAwareness.push(...states)
    })

    await left.connect()
    await right.connect()

    leftDoc.getText('body').insert(0, 'A')
    await left.sendUpdate(Y.encodeStateAsUpdate(leftDoc), {
      documentId: 'doc-collab-room',
      roomId: 'room-memory',
      clientId: 'client-a',
      updateId: 'update-a'
    })
    rightDoc.getText('body').insert(rightDoc.getText('body').length, 'B')
    const rightUpdate = Y.encodeStateAsUpdate(rightDoc)
    await right.sendUpdate(rightUpdate, {
      documentId: 'doc-collab-room',
      roomId: 'room-memory',
      clientId: 'client-b',
      updateId: 'update-b'
    })
    await right.sendUpdate(rightUpdate, {
      documentId: 'doc-collab-room',
      roomId: 'room-memory',
      clientId: 'client-b',
      updateId: 'update-b-replay',
      origin: 'replay'
    })
    left.awareness.setLocalState({
      clientId: 'client-a',
      user: {
        id: 'user-a',
        name: 'Alice'
      },
      updatedAt: 20
    })

    expect(leftDoc.getText('body').toString()).toBe(rightDoc.getText('body').toString())
    expect(leftDoc.getText('body').toString()).toContain('A')
    expect(leftDoc.getText('body').toString()).toContain('B')
    expect(rightAwareness).toContainEqual({
      clientId: 'client-a',
      user: {
        id: 'user-a',
        name: 'Alice'
      },
      updatedAt: 20
    })

    await left.destroy()
    await right.destroy()
  })

  it('converges when memory adapter receives dependent Yjs updates out of order', async () => {
    const leftDoc = new Y.Doc()
    const rightDoc = new Y.Doc()
    const left = createMemoryCollabProviderAdapter({
      documentId: 'doc-collab-out-of-order',
      roomId: 'room-out-of-order',
      clientId: 'client-a'
    })
    const right = createMemoryCollabProviderAdapter({
      documentId: 'doc-collab-out-of-order',
      roomId: 'room-out-of-order',
      clientId: 'client-b'
    })
    const body = leftDoc.getText('body')

    const initialVector = Y.encodeStateVector(leftDoc)
    body.insert(0, 'A')
    const firstUpdate = Y.encodeStateAsUpdate(leftDoc, initialVector)
    const afterFirstVector = Y.encodeStateVector(leftDoc)
    body.insert(1, 'B')
    const secondUpdate = Y.encodeStateAsUpdate(leftDoc, afterFirstVector)

    right.onUpdate((update) => {
      Y.applyUpdate(rightDoc, update, 'remote-user')
    })

    await left.connect()
    await right.connect()
    await left.sendUpdate(secondUpdate, {
      documentId: 'doc-collab-out-of-order',
      roomId: 'room-out-of-order',
      clientId: 'client-a',
      updateId: 'update-b',
      origin: 'local'
    })
    await left.sendUpdate(firstUpdate, {
      documentId: 'doc-collab-out-of-order',
      roomId: 'room-out-of-order',
      clientId: 'client-a',
      updateId: 'update-a',
      origin: 'local'
    })

    expect(rightDoc.getText('body').toString()).toBe('AB')
    expect(left.status).toBe('synced')
    expect(right.status).toBe('synced')
    expect(left.diagnostics).toEqual([])
    expect(right.diagnostics).toEqual([])

    await left.destroy()
    await right.destroy()
  })

  it('serializes, parses and cleans awareness states', () => {
    const awareness: JWordAwarenessState = {
      clientId: 'client-a',
      user: {
        id: 'user-a',
        name: 'Alice',
        color: '#3366ff'
      },
      cursor: {
        anchor: {
          blockId: 'block-1',
          offset: 3
        },
        focus: {
          blockId: 'block-1',
          offset: 6
        }
      },
      updatedAt: 100
    }

    const parsed = parseAwarenessState(serializeAwarenessState(awareness))
    const cleaned = cleanupStaleAwarenessStates([
      parsed.state,
      {
        clientId: 'client-b',
        user: {
          id: 'user-b',
          name: 'Bob'
        },
        updatedAt: 1
      }
    ], {
      now: 120,
      staleAfterMs: 50
    })

    expect(parsed.diagnostics).toEqual([])
    expect(cleaned).toEqual([awareness])
  })

  it('keeps valid range snapshots and downgrades invalid awareness range snapshots to presence', () => {
    const rangeSnapshot = {
      id: 'range-client-a',
      anchor: {
        documentId: 'doc-range',
        sectionId: 'section-1',
        blockId: 'block-1',
        runId: 'run-1',
        graphemeIndex: 3,
        relativePosition: {
          tname: 'body',
          assoc: -1
        }
      },
      focus: {
        documentId: 'doc-range',
        sectionId: 'section-1',
        blockId: 'block-1',
        runId: 'run-1',
        graphemeIndex: 8,
        relativePosition: {
          tname: 'body',
          assoc: 1
        }
      }
    } as const
    const valid = parseAwarenessState(serializeAwarenessState({
      clientId: 'client-a',
      user: {
        id: 'user-a',
        name: 'Alice'
      },
      cursor: {
        anchor: {
          blockId: 'block-1',
          offset: 3
        },
        focus: {
          blockId: 'block-1',
          offset: 8
        }
      },
      rangeSnapshot,
      viewport: {
        pageIndex: 2
      },
      updatedAt: 100
    }))
    const invalid = parseAwarenessState(JSON.stringify({
      clientId: 'client-a',
      user: {
        id: 'user-a',
        name: 'Alice'
      },
      rangeSnapshot: {
        id: 'range-client-a',
        anchor: {
          documentId: 'doc-range',
          blockId: 'block-1',
          runId: 'run-1',
          graphemeIndex: 3,
          relativePosition: {
            tname: 'body'
          }
        },
        focus: rangeSnapshot.focus
      },
      updatedAt: 100
    }))
    const invalidViewport = parseAwarenessState(JSON.stringify({
      clientId: 'client-a',
      user: {
        id: 'user-a',
        name: 'Alice'
      },
      viewport: {
        pageIndex: '2'
      },
      updatedAt: 100
    }))

    expect(valid.diagnostics).toEqual([])
    expect(valid.state.rangeSnapshot).toEqual(rangeSnapshot)
    expect(valid.state.viewport?.pageIndex).toBe(2)
    expect(invalid.state).toMatchObject({
      clientId: 'client-a',
      user: {
        id: 'user-a',
        name: 'Alice'
      },
      updatedAt: 100
    })
    expect(invalid.state.cursor).toBeUndefined()
    expect(invalid.state.rangeSnapshot).toBeUndefined()
    expect(invalid.diagnostics).toMatchObject([{
      code: 'COLLAB_AWARENESS_ANCHOR_UNRESOLVED',
      severity: 'warning',
      recoverable: true,
      clientId: 'client-a'
    }])
    expect(invalidViewport.state.viewport).toBeUndefined()
    expect(invalidViewport.diagnostics).toMatchObject([{
      code: 'COLLAB_AWARENESS_INVALID',
      severity: 'error',
      recoverable: false
    }])
  })

  it('downgrades unresolved anchor awareness to presence only', () => {
    const result = downgradeUnresolvedAnchorToPresence({
      clientId: 'client-a',
      user: {
        id: 'user-a',
        name: 'Alice'
      },
      cursor: {
        anchor: {
          blockId: 'missing-block',
          offset: 0
        },
        focus: {
          blockId: 'missing-block',
          offset: 0
        }
      },
      selectionLabel: 'Missing block',
      updatedAt: 20
    })

    expect(result.state).toEqual({
      clientId: 'client-a',
      user: {
        id: 'user-a',
        name: 'Alice'
      },
      updatedAt: 20
    })
    expect(result.diagnostic).toMatchObject({
      code: 'COLLAB_AWARENESS_ANCHOR_UNRESOLVED',
      severity: 'warning',
      recoverable: true
    })
  })
})

/** 创建 Gate 6 contract 测试使用的签名授权。 */
function createGate6TestLicense(
  input: Omit<JWordLicenseEntitlement, 'issuer' | 'issuedAt' | 'signature'>
): JWordLicenseEntitlement {
  const entitlement: JWordLicenseSignaturePayload = {
    ...input,
    issuer: 'jword-test-issuer',
    issuedAt: '2026-05-01T00:00:00Z'
  }

  return {
    ...entitlement,
    signature: createInsecureTestOnlyJWordLicenseSignature(entitlement, INSECURE_TEST_ONLY_LICENSE_PRIVATE_KEY_SEED)
  }
}
