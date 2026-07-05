/**
 * @vitest-environment node
 *
 * 职责：验证 Hocuspocus provider adapter 的显式连接生命周期。
 * 边界：通过 experimental factory 与模拟 @hocuspocus/provider 观察构造、attach、connect 调用，不触发真实 WebSocket。
 * 协作模块：packages/collab/src/hocuspocus-adapter.ts、@hocuspocus/provider 和 Gate 6 public client 授权前置链路。
 * 约束：adapter 构造阶段不得发起网络连接，真实连接只能在 connect() 中显式发生。
 * Specs：docs/superpowers/reports/2026-07-02-gate6-review.md#22-packagescollab--hocuspocus-adapter。
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'

const hocuspocusMock = vi.hoisted(() => {
  interface MockWebsocketConfiguration {
    readonly url: string
    readonly autoConnect?: boolean
    readonly WebSocketPolyfill?: unknown
  }

  interface MockProviderConfiguration {
    readonly websocketProvider: MockHocuspocusProviderWebsocket
    readonly name: string
    readonly document: unknown
    readonly token?: unknown
  }

  const websocketInstances: MockHocuspocusProviderWebsocket[] = []
  const providerInstances: MockHocuspocusProvider[] = []

  class MockAwareness {
    private localState: unknown
    private readonly states = new Map<number, unknown>()

    /** 读取本地 awareness state。 */
    getLocalState(): unknown {
      return this.localState
    }

    /** 写入本地 awareness state。 */
    setLocalState(state: unknown): void {
      this.localState = state
    }

    /** 读取全部 awareness state。 */
    getStates(): Map<number, unknown> {
      return this.states
    }
  }

  class MockHocuspocusProviderWebsocket {
    readonly configuration: MockWebsocketConfiguration
    connectCalls = 0
    disconnectCalls = 0
    destroyCalls = 0

    /** 记录 WebSocket provider 构造参数并模拟 autoConnect 副作用。 */
    constructor(configuration: MockWebsocketConfiguration) {
      this.configuration = configuration
      websocketInstances.push(this)

      if (configuration.autoConnect !== false) {
        void this.connect()
      }
    }

    /** 模拟显式 WebSocket 连接。 */
    async connect(): Promise<void> {
      this.connectCalls += 1
    }

    /** 模拟显式断开 WebSocket。 */
    disconnect(): void {
      this.disconnectCalls += 1
    }

    /** 模拟销毁 WebSocket provider。 */
    destroy(): void {
      this.destroyCalls += 1
    }
  }

  class MockHocuspocusProvider {
    readonly awareness = new MockAwareness()
    readonly configuration: MockProviderConfiguration
    synced = false
    attachCalls = 0
    detachCalls = 0
    destroyCalls = 0

    /** 记录 Hocuspocus provider 构造参数。 */
    constructor(configuration: MockProviderConfiguration) {
      this.configuration = configuration
      providerInstances.push(this)
    }

    /** 模拟 provider 绑定到 websocket。 */
    attach(): void {
      this.attachCalls += 1
    }

    /** 模拟 provider 从 websocket 解绑。 */
    detach(): void {
      this.detachCalls += 1
    }

    /** 模拟 provider 销毁。 */
    destroy(): void {
      this.destroyCalls += 1
    }
  }

  return {
    websocketInstances,
    providerInstances,
    MockHocuspocusProviderWebsocket,
    MockHocuspocusProvider,
    /** 重置模拟 provider 实例记录。 */
    reset() {
      websocketInstances.length = 0
      providerInstances.length = 0
    }
  }
})

vi.mock('@hocuspocus/provider', () => ({
  HocuspocusProvider: hocuspocusMock.MockHocuspocusProvider,
  HocuspocusProviderWebsocket: hocuspocusMock.MockHocuspocusProviderWebsocket
}))

import {
  createHocuspocusCollabProviderAdapter
} from '../src/experimental'

describe('@4xian/jword-collab hocuspocus adapter', () => {
  afterEach(() => {
    hocuspocusMock.reset()
  })

  it('does not attach or connect during construction', async () => {
    const document = new Y.Doc()
    const adapter = createHocuspocusCollabProviderAdapter({
      document,
      documentId: 'doc-hocuspocus-race',
      roomId: 'room-hocuspocus-race',
      clientId: 'client-a',
      webSocketUrl: 'ws://127.0.0.1:1',
      autoConnect: true
    })
    const { provider, websocketProvider } = readMockInstances()

    expect(websocketProvider.configuration.autoConnect).toBe(false)
    expect(websocketProvider.connectCalls).toBe(0)
    expect(provider.attachCalls).toBe(0)
    expect(adapter.status).toBe('idle')

    await adapter.destroy()
    document.destroy()
  })

  it('attaches and connects only after explicit connect', async () => {
    const document = new Y.Doc()
    const adapter = createHocuspocusCollabProviderAdapter({
      document,
      documentId: 'doc-hocuspocus-connect',
      roomId: 'room-hocuspocus-connect',
      clientId: 'client-a',
      webSocketUrl: 'ws://127.0.0.1:1'
    })
    const { provider, websocketProvider } = readMockInstances()

    await adapter.connect()

    expect(provider.attachCalls).toBe(1)
    expect(websocketProvider.connectCalls).toBe(1)
    expect(adapter.status).toBe('connected')

    await adapter.disconnect()
    expect(provider.detachCalls).toBe(1)
    expect(websocketProvider.disconnectCalls).toBe(1)

    await adapter.destroy()
    document.destroy()
  })
})

/** 读取本测试创建的唯一模拟 provider 实例。 */
function readMockInstances(): {
  readonly provider: (typeof hocuspocusMock.providerInstances)[number]
  readonly websocketProvider: (typeof hocuspocusMock.websocketInstances)[number]
} {
  const provider = hocuspocusMock.providerInstances[0]
  const websocketProvider = hocuspocusMock.websocketInstances[0]

  if (provider === undefined || websocketProvider === undefined) {
    throw new Error('Expected hocuspocus provider mock instances to be created.')
  }

  return {
    provider,
    websocketProvider
  }
}
