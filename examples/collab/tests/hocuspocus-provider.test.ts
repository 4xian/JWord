/**
 * @vitest-environment node
 *
 * 职责：验证 Gate 6 collab demo 能通过真实 Hocuspocus provider 同步两个 Y.Doc。
 * 边界：只覆盖 Node 本地 WebSocket provider 收敛，不接浏览器 UI、IndexedDB 或 core 内部 store。
 * 协作：examples/collab/server/hocuspocus-service.ts、@4xian/jword-collab 和 Yjs。
 * 约束：测试使用随机端口和独立 room，不写入持久化存储，不复用内存 adapter。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import { afterEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'

import { createHocuspocusCollabProviderAdapter } from '@4xian/jword-collab/experimental'
import type { JWordAwarenessState } from '@4xian/jword-collab'

import { createCollabHocuspocusService } from '../server/hocuspocus-service'
import type { CollabHocuspocusService } from '../server/hocuspocus-service'

let service: CollabHocuspocusService | null = null

describe('collab Hocuspocus provider integration', () => {
  afterEach(async () => {
    await service?.stop()
    service = null
  })

  it('syncs two Y.Doc instances through the local Hocuspocus service', async () => {
    service = createCollabHocuspocusService({
      port: 0,
      address: '127.0.0.1',
      roomPrefix: 'jword-collab-provider-test'
    })
    const started = await service.start()
    const leftDoc = new Y.Doc()
    const rightDoc = new Y.Doc()
    const roomId = `${started.roomPrefix}-room`
    const left = createHocuspocusCollabProviderAdapter({
      document: leftDoc,
      documentId: 'doc-provider-integration',
      roomId,
      clientId: 'client-a',
      webSocketUrl: started.webSocketUrl
    })
    const right = createHocuspocusCollabProviderAdapter({
      document: rightDoc,
      documentId: 'doc-provider-integration',
      roomId,
      clientId: 'client-b',
      webSocketUrl: started.webSocketUrl
    })

    await Promise.all([
      waitForSynced(left),
      waitForSynced(right)
    ])

    leftDoc.getText('body').insert(0, 'Real Hocuspocus sync')

    await waitForText(rightDoc, 'Real Hocuspocus sync')

    expect(rightDoc.getText('body').toString()).toBe('Real Hocuspocus sync')
    expect(left.status).toBe('synced')
    expect(right.status).toBe('synced')
    expect(left.diagnostics).toEqual([])
    expect(right.diagnostics).toEqual([])

    await left.destroy()
    await right.destroy()
    leftDoc.destroy()
    rightDoc.destroy()
  }, 15000)

  it('shares awareness cursor states through the local Hocuspocus service', async () => {
    service = createCollabHocuspocusService({
      port: 0,
      address: '127.0.0.1',
      roomPrefix: 'jword-collab-awareness-test'
    })
    const started = await service.start()
    const leftDoc = new Y.Doc()
    const rightDoc = new Y.Doc()
    const roomId = `${started.roomPrefix}-room`
    const left = createHocuspocusCollabProviderAdapter({
      document: leftDoc,
      documentId: 'doc-awareness-integration',
      roomId,
      clientId: 'client-a',
      webSocketUrl: started.webSocketUrl
    })
    const right = createHocuspocusCollabProviderAdapter({
      document: rightDoc,
      documentId: 'doc-awareness-integration',
      roomId,
      clientId: 'client-b',
      webSocketUrl: started.webSocketUrl
    })

    await Promise.all([
      waitForSynced(left),
      waitForSynced(right)
    ])

    left.awareness.setLocalState({
      clientId: 'client-a',
      user: {
        id: 'client-a',
        name: 'Client A',
        color: '#286fd6'
      },
      cursor: {
        anchor: {
          blockId: 'body',
          offset: 3
        },
        focus: {
          blockId: 'body',
          offset: 9
        }
      },
      selectionLabel: '3-9',
      updatedAt: Date.now()
    })

    const remoteStates = await waitForAwarenessState(right, 'client-a')

    expect(remoteStates).toContainEqual(expect.objectContaining({
      clientId: 'client-a',
      selectionLabel: '3-9'
    }))
    expect(left.diagnostics).toEqual([])
    expect(right.diagnostics).toEqual([])

    await left.destroy()
    await right.destroy()
    leftDoc.destroy()
    rightDoc.destroy()
  }, 15000)

  it('downgrades invalid awareness range snapshots to presence through the local Hocuspocus service', async () => {
    service = createCollabHocuspocusService({
      port: 0,
      address: '127.0.0.1',
      roomPrefix: 'jword-collab-awareness-range-test'
    })
    const started = await service.start()
    const leftDoc = new Y.Doc()
    const rightDoc = new Y.Doc()
    const roomId = `${started.roomPrefix}-room`
    const left = createHocuspocusCollabProviderAdapter({
      document: leftDoc,
      documentId: 'doc-awareness-range-integration',
      roomId,
      clientId: 'client-a',
      webSocketUrl: started.webSocketUrl
    })
    const right = createHocuspocusCollabProviderAdapter({
      document: rightDoc,
      documentId: 'doc-awareness-range-integration',
      roomId,
      clientId: 'client-b',
      webSocketUrl: started.webSocketUrl
    })

    await Promise.all([
      waitForSynced(left),
      waitForSynced(right)
    ])

    left.awareness.setLocalState({
      clientId: 'client-a',
      user: {
        id: 'client-a',
        name: 'Client A'
      },
      rangeSnapshot: {
        id: 'range-client-a',
        anchor: {
          documentId: 'doc-awareness-range-integration',
          blockId: 'body',
          runId: 'run-1',
          graphemeIndex: 1,
          relativePosition: {
            tname: 'body'
          }
        },
        focus: {
          documentId: 'doc-awareness-range-integration',
          sectionId: 'section-1',
          blockId: 'body',
          runId: 'run-1',
          graphemeIndex: 3,
          relativePosition: {
            tname: 'body'
          }
        }
      },
      updatedAt: Date.now()
    } as unknown as JWordAwarenessState)
    await waitForAwarenessPropagation(right)

    const downgradedState = right.awareness.getStates().find((state) => state.clientId === 'client-a')

    expect(downgradedState).toMatchObject({
      clientId: 'client-a',
      user: {
        id: 'client-a',
        name: 'Client A'
      }
    })
    expect(downgradedState?.cursor).toBeUndefined()
    expect(downgradedState?.rangeSnapshot).toBeUndefined()
    expect(right.diagnostics).toContainEqual(expect.objectContaining({
      code: 'COLLAB_AWARENESS_ANCHOR_UNRESOLVED',
      severity: 'warning',
      recoverable: true,
      clientId: 'client-a'
    }))

    await left.destroy()
    await right.destroy()
    leftDoc.destroy()
    rightDoc.destroy()
  }, 15000)

  it('filters invalid awareness viewport snapshots through the local Hocuspocus service', async () => {
    service = createCollabHocuspocusService({
      port: 0,
      address: '127.0.0.1',
      roomPrefix: 'jword-collab-awareness-viewport-test'
    })
    const started = await service.start()
    const leftDoc = new Y.Doc()
    const rightDoc = new Y.Doc()
    const roomId = `${started.roomPrefix}-room`
    const left = createHocuspocusCollabProviderAdapter({
      document: leftDoc,
      documentId: 'doc-awareness-viewport-integration',
      roomId,
      clientId: 'client-a',
      webSocketUrl: started.webSocketUrl
    })
    const right = createHocuspocusCollabProviderAdapter({
      document: rightDoc,
      documentId: 'doc-awareness-viewport-integration',
      roomId,
      clientId: 'client-b',
      webSocketUrl: started.webSocketUrl
    })

    await Promise.all([
      waitForSynced(left),
      waitForSynced(right)
    ])

    left.awareness.setLocalState({
      clientId: 'client-a',
      user: {
        id: 'client-a',
        name: 'Client A'
      },
      viewport: {
        pageIndex: '1'
      },
      updatedAt: Date.now()
    } as unknown as JWordAwarenessState)
    await waitForAwarenessPropagation(right)

    expect(right.awareness.getStates()).not.toContainEqual(expect.objectContaining({
      clientId: 'client-a'
    }))

    await left.destroy()
    await right.destroy()
    leftDoc.destroy()
    rightDoc.destroy()
  }, 15000)

  it('reports update rejected diagnostics when the local Hocuspocus service rejects a local update', async () => {
    service = createCollabHocuspocusService({
      port: 0,
      address: '127.0.0.1',
      roomPrefix: 'jword-collab-update-rejected-test',
      rejectUpdates: true
    })
    const started = await service.start()
    const document = new Y.Doc()
    const adapter = createHocuspocusCollabProviderAdapter({
      document,
      documentId: 'doc-update-rejected-integration',
      roomId: `${started.roomPrefix}-room`,
      clientId: 'client-a',
      webSocketUrl: started.webSocketUrl
    })

    try {
      await waitForSynced(adapter)

      document.getText('body').insert(0, 'Rejected local update')

      const error = await waitForProviderError(
        adapter,
        'provider did not report an update rejected error'
      )

      expect(error).toMatchObject({
        code: 'COLLAB_UPDATE_REJECTED',
        recoverable: true
      })
      expect(adapter.status).toBe('error')
      expect(adapter.diagnostics).toContainEqual(expect.objectContaining({
        code: 'COLLAB_UPDATE_REJECTED',
        severity: 'error',
        recoverable: true,
        clientId: 'client-a'
      }))
    } finally {
      await adapter.destroy()
      document.destroy()
    }
  }, 15000)

  it('reports auth failed diagnostics when the local Hocuspocus service rejects a token', async () => {
    service = createCollabHocuspocusService({
      port: 0,
      address: '127.0.0.1',
      roomPrefix: 'jword-collab-auth-test',
      requiredToken: 'valid-token'
    })
    const started = await service.start()
    const document = new Y.Doc()
    const adapter = createHocuspocusCollabProviderAdapter({
      document,
      documentId: 'doc-auth-integration',
      roomId: `${started.roomPrefix}-room`,
      clientId: 'client-a',
      webSocketUrl: started.webSocketUrl,
      token: 'invalid-token'
    })

    const error = await waitForProviderError(adapter)

    expect(error).toMatchObject({
      code: 'COLLAB_PROVIDER_AUTH_FAILED',
      recoverable: false
    })
    expect(adapter.status).toBe('error')
    expect(adapter.diagnostics).toContainEqual(expect.objectContaining({
      code: 'COLLAB_PROVIDER_AUTH_FAILED',
      severity: 'error',
      recoverable: false,
      clientId: 'client-a'
    }))

    await adapter.destroy()
    document.destroy()
  }, 15000)
})

/** 等待 adapter 报告 synced 状态。 */
async function waitForSynced(adapter: {
  readonly status: string
  connect(): Promise<void>
  onSynced(listener: () => void): () => void
}): Promise<void> {
  if (adapter.status === 'synced') {
    return
  }

  let connectError: unknown
  const waitPromise = new Promise<void>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      unsubscribe()
      reject(new Error(`provider did not sync, current status: ${adapter.status}`))
    }, 5000)
    const unsubscribe = adapter.onSynced(() => {
      clearTimeout(timeoutId)
      unsubscribe()
      resolve()
    })
  })
  const connectPromise = adapter.status === 'idle'
    ? adapter.connect().catch((error: unknown) => {
      connectError = error
    })
    : Promise.resolve()

  await waitPromise
  await connectPromise

  if (connectError !== undefined) {
    throw connectError
  }
}

/** 等待指定 Y.Doc 文本收敛到预期值。 */
async function waitForText(doc: Y.Doc, expected: string): Promise<void> {
  const text = doc.getText('body')

  if (text.toString() === expected) {
    return
  }

  await new Promise<void>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      text.unobserve(observer)
      reject(new Error(`document text did not converge: ${text.toString()}`))
    }, 5000)
    const observer = () => {
      if (text.toString() !== expected) {
        return
      }
      clearTimeout(timeoutId)
      text.unobserve(observer)
      resolve()
    }

    text.observe(observer)
  })
}

/** 等待指定 adapter 读到远端 awareness state。 */
async function waitForAwarenessState(
  adapter: {
    readonly awareness: {
      getStates(): readonly {
        readonly clientId: string
      }[]
      onChange(listener: (states: readonly {
        readonly clientId: string
      }[]) => void): () => void
    }
  },
  clientId: string
): Promise<readonly {
  readonly clientId: string
}[]> {
  const initialStates = adapter.awareness.getStates()

  if (initialStates.some((state) => state.clientId === clientId)) {
    return initialStates
  }

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      unsubscribe()
      reject(new Error(`awareness state did not include ${clientId}`))
    }, 5000)
    const unsubscribe = adapter.awareness.onChange((states) => {
      if (!states.some((state) => state.clientId === clientId)) {
        return
      }
      clearTimeout(timeoutId)
      unsubscribe()
      resolve(states)
    })
  })
}

/** 等待 awareness 同步到远端 adapter。 */
async function waitForAwarenessPropagation(adapter: {
  readonly awareness: {
    onChange(listener: (states: readonly {
      readonly clientId: string
    }[]) => void): () => void
  }
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      unsubscribe()
      reject(new Error('awareness state did not propagate'))
    }, 5000)
    const unsubscribe = adapter.awareness.onChange(() => {
      clearTimeout(timeoutId)
      unsubscribe()
      resolve()
    })
  })
}

/** 等待 provider 报告错误。 */
async function waitForProviderError(adapter: {
  readonly status: string
  readonly error: {
    readonly code: string
    readonly recoverable: boolean
  } | undefined
  connect(): Promise<void>
  onError(listener: (error: {
    readonly code: string
    readonly recoverable: boolean
  }) => void): () => void
}, timeoutMessage = 'provider did not report an error'): Promise<{
  readonly code: string
  readonly recoverable: boolean
}> {
  if (adapter.error !== undefined) {
    return adapter.error
  }

  const waitPromise = new Promise<{
    readonly code: string
    readonly recoverable: boolean
  }>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      unsubscribe()
      reject(new Error(timeoutMessage))
    }, 5000)
    const unsubscribe = adapter.onError((error) => {
      clearTimeout(timeoutId)
      unsubscribe()
      resolve(error)
    })
  })
  const connectPromise = adapter.status === 'idle'
    ? adapter.connect().catch(() => {})
    : Promise.resolve()
  const error = await waitPromise

  await connectPromise

  return error
}
