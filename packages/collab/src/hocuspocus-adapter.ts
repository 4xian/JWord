/**
 * 职责：将 @hocuspocus/provider 4.x 包装为 JWord Gate 6 的 ProviderAdapter 契约。
 * 边界：只接入 Y.Doc、WebSocket provider、awareness 和诊断事件，不访问 core 内部 store、DOM 节点或 IndexedDB。
 * 协作模块：packages/collab/src/index.ts 负责稳定公共类型，examples/collab/server 提供本地 Hocuspocus 服务。
 * 性能/安全约束：构造阶段不得自动连接；room、token、client metadata 均由宿主传入并在显式 connect 前完成授权。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md Gate 6 Step 6.2。
 */
import {
  HocuspocusProvider,
  HocuspocusProviderWebsocket
} from '@hocuspocus/provider'
import * as Y from 'yjs'

import {
  isAwarenessPresenceState,
  isAwarenessRangeSnapshot,
  isAwarenessState,
  isRecord
} from './awareness-validation.js'

import type {
  JWordAwarenessState,
  JWordAwarenessChangeListener,
  JWordCollabAwarenessAdapter,
  JWordCollabDiagnostic,
  JWordCollabDiagnosticSeverity,
  JWordCollabErrorListener,
  JWordCollabProviderAdapter,
  JWordCollabProviderError,
  JWordCollabProviderStatus,
  JWordCollabStatusListener,
  JWordCollabSyncedListener,
  JWordCollabUnsubscribe,
  JWordCollabUpdateListener,
  JWordCollabUpdateMetadata
} from './index.js'

type HocuspocusCoreUpdateOrigin =
  | 'local-user'
  | 'remote-user'
  | 'auto-inserter'
  | 'version-restore'
  | 'system-recovery'

const FROZEN_HOCUSPOCUS_UPDATE_ORIGINS = new Set<HocuspocusCoreUpdateOrigin>([
  'local-user',
  'remote-user',
  'auto-inserter',
  'version-restore',
  'system-recovery'
])

export interface CreateHocuspocusCollabProviderAdapterOptions {
  readonly document: Y.Doc
  readonly documentId: string
  readonly roomId: string
  readonly clientId: string
  readonly webSocketUrl: string
  /** 兼容旧调用参数；为保证授权前置，真实连接始终由 connect() 显式触发。 */
  readonly autoConnect?: boolean
  readonly token?: string | (() => string) | (() => Promise<string>)
  readonly webSocketPolyfill?: unknown
}

// 创建基于 Hocuspocus client provider 的真实 WebSocket adapter。
export function createHocuspocusCollabProviderAdapter(
  options: CreateHocuspocusCollabProviderAdapterOptions
): JWordCollabProviderAdapter {
  let status: JWordCollabProviderStatus = 'idle'
  let error: JWordCollabProviderError | undefined
  let destroyed = false
  const diagnostics: JWordCollabDiagnostic[] = []
  const statusListeners = new Set<JWordCollabStatusListener>()
  const errorListeners = new Set<JWordCollabErrorListener>()
  const updateListeners = new Set<JWordCollabUpdateListener>()
  const syncedListeners = new Set<JWordCollabSyncedListener>()
  const awarenessListeners = new Set<JWordAwarenessChangeListener>()
  const websocketProvider = new HocuspocusProviderWebsocket({
    url: options.webSocketUrl,
    autoConnect: false,
    WebSocketPolyfill: options.webSocketPolyfill
  })
  const provider = new HocuspocusProvider({
    websocketProvider,
    name: options.roomId,
    document: options.document,
    token: options.token ?? null,
    onStatus({ status: providerStatus }) {
      setHocuspocusAdapterStatus(
        providerStatus === 'connecting' && status === 'disconnected'
          ? 'reconnecting'
          : mapHocuspocusProviderStatus(providerStatus)
      )
    },
    onSynced({ state }) {
      if (!state) {
        return
      }
      setHocuspocusAdapterStatus('synced')
      emitHocuspocusAdapterSynced()
    },
    onAuthenticationFailed({ reason }) {
      emitHocuspocusAdapterError(createProviderError(
        'COLLAB_PROVIDER_AUTH_FAILED',
        reason,
        false
      ))
    },
    onClose({ event }) {
      const reason = readHocuspocusCloseReason(event)

      if (reason !== 'COLLAB_UPDATE_REJECTED' && reason !== 'COLLAB_PERMISSION_DENIED') {
        return
      }

      emitHocuspocusAdapterError(createProviderError(
        reason,
        reason === 'COLLAB_PERMISSION_DENIED'
          ? 'Collab provider denied write permission for the local update'
          : 'Collab provider rejected a local update',
        true
      ))
    },
    onAwarenessChange() {
      emitHocuspocusAwarenessChange()
    }
  })
  const awareness = createHocuspocusAwarenessAdapter(
    provider,
    awarenessListeners,
    () => destroyed,
    () => {
      assertHocuspocusAdapterActive(destroyed)
    }
  )

  return {
    // 读取当前 provider 状态。
    get status() {
      return status
    },

    // 读取最近一次 provider 错误。
    get error() {
      return error
    },

    // 读取当前 adapter 诊断列表。
    get diagnostics() {
      return diagnostics
    },

    // 读取 Hocuspocus awareness adapter。
    get awareness() {
      return awareness
    },

    // 连接 Hocuspocus WebSocket provider。
    async connect() {
      assertHocuspocusAdapterActive(destroyed)
      provider.attach()
      setHocuspocusAdapterStatus(status === 'disconnected' ? 'reconnecting' : 'connecting')
      await websocketProvider.connect()
      if (provider.synced) {
        setHocuspocusAdapterStatus('synced')
        return
      }
      if (status === 'connecting' || status === 'reconnecting') {
        setHocuspocusAdapterStatus('connected')
      }
    },

    // 断开 Hocuspocus WebSocket provider。
    async disconnect() {
      if (destroyed) {
        return
      }
      provider.detach()
      websocketProvider.disconnect()
      setHocuspocusAdapterStatus('disconnected')
    },

    // 销毁 Hocuspocus provider 并清空本地订阅。
    async destroy() {
      if (destroyed) {
        return
      }
      destroyed = true
      statusListeners.clear()
      errorListeners.clear()
      updateListeners.clear()
      syncedListeners.clear()
      awarenessListeners.clear()
      provider.destroy()
      websocketProvider.destroy()
    },

    // 将外部 Yjs update 写入同一 Y.Doc；调用方必须保证 update 与目标文档匹配。
    async sendUpdate(update, metadata) {
      assertHocuspocusAdapterActive(destroyed)
      if (status !== 'connected' && status !== 'synced') {
        const notConnectedError = createProviderError(
          'COLLAB_PROVIDER_NOT_CONNECTED',
          'Collab provider must be connected before sending updates',
          true
        )
        emitHocuspocusAdapterError(notConnectedError)
        throw notConnectedError
      }
      if (!matchesHocuspocusAdapterMetadata(options, metadata)) {
        const metadataError = createProviderError(
          'COLLAB_UPDATE_METADATA_MISMATCH',
          'Collab update metadata does not match the Hocuspocus adapter identity',
          false
        )
        emitHocuspocusAdapterError(metadataError)
        throw metadataError
      }

      Y.applyUpdate(options.document, update, normalizeHocuspocusUpdateOrigin(metadata.origin))
      emitHocuspocusAdapterUpdate(new Uint8Array(update), metadata)
    },

    // 订阅 provider 状态变化。
    onStatus(listener) {
      return addHocuspocusAdapterListener(statusListeners, listener)
    },

    // 订阅 provider 状态变化。
    onStatusChange(listener) {
      return addHocuspocusAdapterListener(statusListeners, listener)
    },

    // 订阅 provider 错误。
    onError(listener) {
      return addHocuspocusAdapterListener(errorListeners, listener)
    },

    // 订阅本地显式 sendUpdate 事件。
    onUpdate(listener) {
      return addHocuspocusAdapterListener(updateListeners, listener)
    },

    // 订阅首次同步完成事件。
    onSynced(listener) {
      return addHocuspocusAdapterListener(syncedListeners, listener)
    }
  }

  // 更新 Hocuspocus adapter 状态并通知订阅者。
  function setHocuspocusAdapterStatus(nextStatus: JWordCollabProviderStatus): void {
    if (destroyed) {
      return
    }
    status = nextStatus
    for (const listener of statusListeners) {
      listener(nextStatus)
    }
  }

  // 派发 Hocuspocus adapter 错误。
  function emitHocuspocusAdapterError(nextError: JWordCollabProviderError): void {
    if (destroyed) {
      return
    }
    error = nextError
    diagnostics.push(createDiagnostic(
      nextError.code,
      'error',
      nextError.message,
      nextError.recoverable,
      options.clientId
    ))
    setHocuspocusAdapterStatus('error')
    for (const listener of errorListeners) {
      listener(nextError)
    }
  }

  // 派发 Hocuspocus adapter 显式 update 事件。
  function emitHocuspocusAdapterUpdate(
    update: Uint8Array,
    metadata: JWordCollabUpdateMetadata
  ): void {
    if (destroyed) {
      return
    }
    for (const listener of updateListeners) {
      listener(update, metadata)
    }
  }

  // 派发 Hocuspocus adapter 同步完成事件。
  function emitHocuspocusAdapterSynced(): void {
    if (destroyed) {
      return
    }
    for (const listener of syncedListeners) {
      listener()
    }
  }

  // 派发 Hocuspocus awareness 快照。
  function emitHocuspocusAwarenessChange(): void {
    if (destroyed) {
      return
    }
    const states = readHocuspocusAwarenessStates(provider, diagnostics)
    for (const listener of awarenessListeners) {
      listener(states)
    }
  }
}

/** 将 provider metadata origin 归一到 core 已冻结的事务 origin 矩阵。 */
function normalizeHocuspocusUpdateOrigin(
  origin: JWordCollabUpdateMetadata['origin']
): HocuspocusCoreUpdateOrigin {
  if (origin === 'remote') {
    return assertHocuspocusCoreUpdateOrigin('remote-user')
  }

  if (origin === 'replay') {
    return assertHocuspocusCoreUpdateOrigin('version-restore')
  }

  return assertHocuspocusCoreUpdateOrigin('local-user')
}

/** 约束 Hocuspocus fallback 不再写入 core origin 矩阵外的裸字符串。 */
function assertHocuspocusCoreUpdateOrigin(origin: HocuspocusCoreUpdateOrigin): HocuspocusCoreUpdateOrigin {
  if (!FROZEN_HOCUSPOCUS_UPDATE_ORIGINS.has(origin)) {
    throw new Error(`Unknown Hocuspocus update origin: ${origin}`)
  }

  return origin
}

// 创建 Hocuspocus awareness adapter。
function createHocuspocusAwarenessAdapter(
  provider: HocuspocusProvider,
  listeners: Set<JWordAwarenessChangeListener>,
  isDestroyed: () => boolean,
  assertActive: () => void
): JWordCollabAwarenessAdapter {
  return {
    // 读取本 client 的 awareness state。
    get localState() {
      if (isDestroyed() || provider.awareness === null) {
        return undefined
      }
      const localState = provider.awareness.getLocalState()
      return isAwarenessState(localState) ? localState : undefined
    },

    // 写入本 client 的 awareness state。
    setLocalState(state) {
      assertActive()
      provider.awareness?.setLocalState(state)
    },

    // 清理本 client 的 awareness state。
    clearLocalState() {
      if (isDestroyed()) {
        return
      }
      provider.awareness?.setLocalState(null)
    },

    // 读取当前 provider awareness 快照。
    getStates() {
      if (isDestroyed()) {
        return []
      }
      return readHocuspocusAwarenessStates(provider)
    },

    // 订阅 awareness state 变化。
    onChange(listener) {
      return addHocuspocusAdapterListener(listeners, listener)
    }
  }
}

// 校验 Hocuspocus adapter 尚未销毁。
function assertHocuspocusAdapterActive(destroyed: boolean): void {
  if (destroyed) {
    throw createProviderError(
      'COLLAB_PROVIDER_DESTROYED',
      'Collab provider has already been destroyed',
      false
    )
  }
}

// 判断 update metadata 是否属于当前 Hocuspocus adapter。
function matchesHocuspocusAdapterMetadata(
  options: CreateHocuspocusCollabProviderAdapterOptions,
  metadata: JWordCollabUpdateMetadata
): boolean {
  return metadata.documentId === options.documentId &&
    metadata.clientId === options.clientId &&
    (metadata.roomId === undefined || metadata.roomId === options.roomId)
}

// 映射 Hocuspocus WebSocket 状态到 JWord provider 状态。
function mapHocuspocusProviderStatus(status: string): JWordCollabProviderStatus {
  if (status === 'connecting') {
    return 'connecting'
  }
  if (status === 'connected') {
    return 'connected'
  }
  if (status === 'disconnected') {
    return 'disconnected'
  }

  return 'error'
}

// 读取 Hocuspocus awareness 中符合 JWord schema 的状态。
function readHocuspocusAwarenessStates(
  provider: HocuspocusProvider,
  diagnostics?: JWordCollabDiagnostic[]
): readonly JWordAwarenessState[] {
  if (provider.awareness === null) {
    return []
  }

  return [...provider.awareness.getStates().values()].flatMap((state) =>
    readHocuspocusAwarenessState(state, diagnostics)
  )
}

// 读取单条 Hocuspocus awareness，非法 range 降级为 presence。
function readHocuspocusAwarenessState(
  value: unknown,
  diagnostics: JWordCollabDiagnostic[] | undefined
): readonly JWordAwarenessState[] {
  if (isAwarenessState(value)) {
    return [value]
  }
  if (!isRecord(value) || value.rangeSnapshot === undefined || isAwarenessRangeSnapshot(value.rangeSnapshot)) {
    return []
  }
  if (!isAwarenessPresenceState(value)) {
    return []
  }

  const result = createUnresolvedAwarenessDowngrade(value)

  appendHocuspocusAwarenessDiagnostic(diagnostics, result.diagnostic)

  return [result.state]
}

// 将非法 range awareness 转成 presence-only 状态和 warning 诊断。
function createUnresolvedAwarenessDowngrade(value: Pick<
  JWordAwarenessState,
  'clientId' | 'user' | 'updatedAt'
>): {
  readonly state: JWordAwarenessState
  readonly diagnostic: JWordCollabDiagnostic
} {
  return {
    state: {
      clientId: value.clientId,
      user: value.user,
      updatedAt: value.updatedAt
    },
    diagnostic: createDiagnostic(
      'COLLAB_AWARENESS_ANCHOR_UNRESOLVED',
      'warning',
      'Awareness anchor could not be resolved and was downgraded to presence only',
      true,
      value.clientId
    )
  }
}

// 记录 awareness 降级诊断，避免同一 client/code 重复刷屏。
function appendHocuspocusAwarenessDiagnostic(
  diagnostics: JWordCollabDiagnostic[] | undefined,
  diagnostic: JWordCollabDiagnostic
): void {
  if (diagnostics === undefined) {
    return
  }
  if (diagnostics.some((candidate) =>
    candidate.code === diagnostic.code && candidate.clientId === diagnostic.clientId
  )) {
    return
  }

  diagnostics.push(diagnostic)
}

// 注册 Hocuspocus adapter listener，并返回取消订阅函数。
function addHocuspocusAdapterListener<TListener>(
  listeners: Set<TListener>,
  listener: TListener
): JWordCollabUnsubscribe {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

// 创建 provider 错误对象。
function createProviderError(
  code: string,
  message: string,
  recoverable: boolean
): JWordCollabProviderError {
  return {
    code,
    message,
    recoverable
  }
}

// 创建协作诊断对象。
function createDiagnostic(
  code: string,
  severity: JWordCollabDiagnosticSeverity,
  message: string,
  recoverable: boolean,
  clientId?: string
): JWordCollabDiagnostic {
  return clientId === undefined
    ? {
      code,
      severity,
      message,
      recoverable
    }
    : {
      code,
      severity,
      message,
      recoverable,
      clientId
    }
}

// 读取 Hocuspocus close event 中的稳定拒绝原因。
function readHocuspocusCloseReason(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  return typeof value.reason === 'string' ? value.reason : undefined
}
