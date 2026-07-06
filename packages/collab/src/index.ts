/**
 * 职责：导出 Gate 6 协作包的最小 ProviderAdapter、awareness 和诊断契约。
 * 边界：只提供内存 adapter 与纯数据 helper，不访问 DOM、IndexedDB、WebSocket 或 core 内部实现。
 * 协作模块：真实 provider、editor facade 和 presence UI 通过这些稳定类型接入。
 * 性能/安全约束：入口无副作用，所有 helper 使用结构化数据和同步内存事件。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#gate-6--collaborationauto-insert。
 */

import {
  GATE6_COLLAB_FEATURES,
  JWORD_LICENSE_DIAGNOSTIC_CODE_METADATA,
  assertJWordFeatureEntitled,
  isJWordLicenseDiagnosticCode,
  type JWordLicenseEntitlement,
  type JWordLicenseFeatureKey,
  type JWordLicenseValidationOptions
} from '@4xian/jword-license'
import {
  isAwarenessPresenceState,
  isAwarenessRangeSnapshot,
  isAwarenessState,
  isRecord
} from './awareness-validation.js'

export {
  GATE6_COLLAB_FEATURES
}
export type {
  JWordLicenseEntitlement,
  JWordLicenseFeatureKey,
  JWordLicenseValidationOptions
}
export {
  JWORD_COLLAB_CLIENT_PACKAGE_VERSION,
  JWORD_COLLAB_CLIENT_PROTOCOL_VERSION,
  connectJWordCollaboration
} from './client-sdk.js'
export type {
  ConnectJWordCollaborationOptions,
  JWordCollaborationAwarenessHandle,
  JWordCollaborationAutoInsertActor,
  JWordCollaborationAutoInsertChunkMetadata,
  JWordCollaborationAutoInsertPosition,
  JWordCollaborationAutoInsertProgress,
  JWordCollaborationAutoInsertRange,
  JWordCollaborationAutoInsertRetryInput,
  JWordCollaborationAutoInsertSession,
  JWordCollaborationAutoInsertSessionInput,
  JWordCollaborationAutoInsertStatus,
  JWordCollaborationAutoInsertWriteResult,
  JWordCollaborationConnection,
  JWordCollaborationEditor,
  JWordCollaborationHandshake,
  JWordCollaborationHistoryHandle,
  JWordCollaborationHistoryPreview,
  JWordCollaborationHistoryRecordInput,
  JWordCollaborationHistoryRestoreResult,
  JWordCollaborationHistoryVersion,
  JWordCollaborationOfflineHandle,
  JWordCollaborationOfflineState,
  JWordCollaborationOfflineStatus,
  JWordCollaborationPresenceInput,
  JWordCollaborationRemoteUpdateOptions,
  JWordCollaborationStatus,
  JWordCollaborationUser
} from './client-sdk.js'

export type JWordCollabProviderStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'synced'
  | 'disconnected'
  | 'reconnecting'
  | 'offline'
  | 'error'

export type JWordCollabDiagnosticSeverity = 'info' | 'warning' | 'error'

export interface JWordCollabProviderError {
  readonly code: string
  readonly message: string
  readonly recoverable: boolean
  readonly cause?: unknown
}

export interface JWordCollabUpdateMetadata {
  readonly documentId: string
  readonly roomId?: string
  readonly clientId: string
  readonly updateId: string
  readonly createdAt?: number
  readonly origin?: 'local' | 'remote' | 'replay'
}

export interface JWordCollabDiagnostic {
  readonly code: string
  readonly severity: JWordCollabDiagnosticSeverity
  readonly message: string
  readonly recoverable: boolean
  readonly clientId?: string
  readonly path?: string
}

export type JWordCollabUnsubscribe = () => void
export type JWordCollabStatusListener = (status: JWordCollabProviderStatus) => void
export type JWordCollabErrorListener = (error: JWordCollabProviderError) => void
export type JWordCollabUpdateListener = (
  update: Uint8Array,
  metadata: JWordCollabUpdateMetadata
) => void
export type JWordCollabSyncedListener = () => void
export type JWordAwarenessChangeListener = (states: readonly JWordAwarenessState[]) => void

export interface JWordCollabAwarenessAdapter {
  readonly localState: JWordAwarenessState | undefined
  setLocalState(state: JWordAwarenessState): void
  clearLocalState(): void
  getStates(): readonly JWordAwarenessState[]
  onChange(listener: JWordAwarenessChangeListener): JWordCollabUnsubscribe
}

/** JWord 协同 client 接入任意 provider 的公开 adapter contract。 */
export interface JWordCollabProviderAdapter {
  readonly status: JWordCollabProviderStatus
  readonly error: JWordCollabProviderError | undefined
  readonly diagnostics: readonly JWordCollabDiagnostic[]
  readonly awareness: JWordCollabAwarenessAdapter
  connect(): Promise<void>
  disconnect(): Promise<void>
  destroy(): Promise<void>
  /** 将外部 Yjs update 写入目标 Y.Doc；调用方必须保证 update 与目标文档匹配。 */
  sendUpdate(update: Uint8Array, metadata: JWordCollabUpdateMetadata): Promise<void>
  onStatus(listener: JWordCollabStatusListener): JWordCollabUnsubscribe
  onStatusChange(listener: JWordCollabStatusListener): JWordCollabUnsubscribe
  onError(listener: JWordCollabErrorListener): JWordCollabUnsubscribe
  onUpdate(listener: JWordCollabUpdateListener): JWordCollabUnsubscribe
  onSynced(listener: JWordCollabSyncedListener): JWordCollabUnsubscribe
}

export interface CreateMemoryCollabProviderAdapterOptions {
  readonly documentId: string
  readonly roomId?: string
  readonly clientId: string
}

export interface JWordAwarenessUser {
  readonly id: string
  readonly name: string
  readonly color?: string
  readonly avatarUrl?: string
}

export interface JWordAwarenessAnchor {
  readonly blockId: string
  readonly offset: number
}

export interface JWordAwarenessCursor {
  readonly anchor: JWordAwarenessAnchor
  readonly focus: JWordAwarenessAnchor
}

export interface JWordAwarenessRelativePositionSnapshot {
  readonly type?: {
    readonly client: number
    readonly clock: number
  }
  readonly tname?: string
  readonly item?: {
    readonly client: number
    readonly clock: number
  }
  readonly assoc?: number
}

export interface JWordAwarenessTextAnchorRecord {
  readonly documentId: string
  readonly sectionId: string
  readonly blockId: string
  readonly runId: string
  readonly graphemeIndex: number
  readonly assoc?: number
  readonly relativePosition: JWordAwarenessRelativePositionSnapshot
}

export interface JWordAwarenessRangeSnapshot {
  readonly id: string
  readonly anchor: JWordAwarenessTextAnchorRecord
  readonly focus: JWordAwarenessTextAnchorRecord
}

export interface JWordAwarenessViewport {
  readonly pageIndex: number
}

export interface JWordAwarenessState {
  readonly clientId: string
  readonly user: JWordAwarenessUser
  readonly cursor?: JWordAwarenessCursor
  readonly rangeSnapshot?: JWordAwarenessRangeSnapshot
  readonly viewport?: JWordAwarenessViewport
  readonly selectionLabel?: string
  readonly updatedAt: number
}

export interface ParseAwarenessStateResult {
  readonly state: JWordAwarenessState
  readonly diagnostics: readonly JWordCollabDiagnostic[]
}

export interface CleanupStaleAwarenessStatesOptions {
  readonly now: number
  readonly staleAfterMs: number
}

export interface DowngradeUnresolvedAnchorResult {
  readonly state: JWordAwarenessState
  readonly diagnostic: JWordCollabDiagnostic
}

export interface JWordCollabFeatureGateResult {
  readonly ok: boolean
  readonly feature: JWordLicenseFeatureKey
  readonly diagnostic?: JWordCollabDiagnostic
}

interface MemoryCollabProviderAdapterState {
  readonly documentId: string
  readonly roomId: string
  readonly clientId: string
  status: JWordCollabProviderStatus
  error?: JWordCollabProviderError
  diagnostics: JWordCollabDiagnostic[]
  statusListeners: Set<JWordCollabStatusListener>
  errorListeners: Set<JWordCollabErrorListener>
  updateListeners: Set<JWordCollabUpdateListener>
  syncedListeners: Set<JWordCollabSyncedListener>
  awarenessListeners: Set<JWordAwarenessChangeListener>
  destroyed: boolean
}

interface MemoryCollabRoom {
  readonly adapters: Set<MemoryCollabProviderAdapterState>
  readonly awarenessStates: Map<string, JWordAwarenessState>
}

const memoryCollabRooms = new Map<string, MemoryCollabRoom>()

/** 清空内存协作 room，供测试隔离与宿主销毁内存 demo 时释放全局状态。 */
export function resetMemoryCollabRooms(): void {
  memoryCollabRooms.clear()
}

/** 在连接、离线、历史或自动插入读取文档内容前执行 Gate 6 授权检查。 */
export function createJWordCollabFeatureGate(
  entitlement: JWordLicenseEntitlement | null | undefined,
  feature: JWordLicenseFeatureKey,
  options: JWordLicenseValidationOptions = {}
): JWordCollabFeatureGateResult {
  try {
    assertJWordFeatureEntitled(entitlement, feature, options)

    return {
      ok: true,
      feature
    }
  } catch (error) {
    const code = readCollabLicenseDiagnosticCode(error)
    const metadata = JWORD_LICENSE_DIAGNOSTIC_CODE_METADATA[readLicenseDiagnosticCode(error)]

    return {
      ok: false,
      feature,
      diagnostic: createDiagnostic(
        code,
        metadata.severity,
        metadata.description,
        metadata.recoverable
      )
    }
  }
}

/** 创建一个只在内存中派发协作事件的轻量 provider adapter。 */
export function createMemoryCollabProviderAdapter(
  options: CreateMemoryCollabProviderAdapterOptions
): JWordCollabProviderAdapter {
  const roomId = options.roomId ?? options.documentId
  const state: MemoryCollabProviderAdapterState = {
    documentId: options.documentId,
    roomId,
    clientId: options.clientId,
    status: 'idle',
    diagnostics: [],
    statusListeners: new Set(),
    errorListeners: new Set(),
    updateListeners: new Set(),
    syncedListeners: new Set(),
    awarenessListeners: new Set(),
    destroyed: false
  }
  const awareness = createMemoryAwarenessAdapter(state)

  return {
    // 读取当前 provider 状态。
    get status() {
      return state.status
    },

    // 读取最近一次 provider 错误。
    get error() {
      return state.error
    },

    // 读取当前 adapter 诊断列表。
    get diagnostics() {
      return state.diagnostics
    },

    // 读取内存 awareness adapter。
    get awareness() {
      return awareness
    },

    // 将 adapter 状态推进到 connected，并通知已同步。
    async connect() {
      assertMemoryAdapterActive(state)
      registerMemoryAdapter(state)
      setMemoryAdapterStatus(state, 'connecting')
      setMemoryAdapterStatus(state, 'connected')
      setMemoryAdapterStatus(state, 'synced')
      emitMemoryAdapterSynced(state)
    },

    // 将 adapter 状态推进到 disconnected。
    async disconnect() {
      if (state.destroyed) {
        return
      }
      unregisterMemoryAdapter(state)
      setMemoryAdapterStatus(state, 'disconnected')
    },

    // 销毁 adapter 并清空本地订阅。
    async destroy() {
      if (state.destroyed) {
        return
      }
      unregisterMemoryAdapter(state)
      state.destroyed = true
      state.statusListeners.clear()
      state.errorListeners.clear()
      state.updateListeners.clear()
      state.syncedListeners.clear()
      state.awarenessListeners.clear()
    },

    // 向订阅方派发一次协作 update。
    async sendUpdate(update, metadata) {
      assertMemoryAdapterActive(state)
      if (state.status !== 'connected' && state.status !== 'synced') {
        const error = createProviderError(
          'COLLAB_PROVIDER_NOT_CONNECTED',
          'Collab provider must be connected before sending updates',
          true
        )
        emitMemoryAdapterError(state, error)
        throw error
      }
      if (!matchesMemoryAdapterMetadata(state, metadata)) {
        const error = createProviderError(
          'COLLAB_UPDATE_METADATA_MISMATCH',
          'Collab update metadata does not match the memory adapter identity',
          false
        )
        emitMemoryAdapterError(state, error)
        throw error
      }
      broadcastMemoryAdapterUpdate(state, new Uint8Array(update), metadata)
    },

    // 订阅 provider 状态变化。
    onStatus(listener) {
      return addMemoryAdapterListener(state.statusListeners, listener)
    },

    // 订阅 provider 状态变化。
    onStatusChange(listener) {
      return addMemoryAdapterListener(state.statusListeners, listener)
    },

    // 订阅 provider 错误。
    onError(listener) {
      return addMemoryAdapterListener(state.errorListeners, listener)
    },

    // 订阅协作 update。
    onUpdate(listener) {
      return addMemoryAdapterListener(state.updateListeners, listener)
    },

    // 订阅首次同步完成事件。
    onSynced(listener) {
      return addMemoryAdapterListener(state.syncedListeners, listener)
    }
  }
}

// 创建内存 awareness adapter。
function createMemoryAwarenessAdapter(
  state: MemoryCollabProviderAdapterState
): JWordCollabAwarenessAdapter {
  return {
    // 读取本 client 的 awareness state。
    get localState() {
      return readMemoryRoom(state).awarenessStates.get(state.clientId)
    },

    // 写入本 client 的 awareness state 并广播。
    setLocalState(awarenessState) {
      assertMemoryAdapterActive(state)
      readMemoryRoom(state).awarenessStates.set(state.clientId, awarenessState)
      broadcastMemoryAwareness(state)
    },

    // 清理本 client 的 awareness state 并广播。
    clearLocalState() {
      if (state.destroyed) {
        return
      }
      readMemoryRoom(state).awarenessStates.delete(state.clientId)
      broadcastMemoryAwareness(state)
    },

    // 读取当前 room 的 awareness state 快照。
    getStates() {
      return [...readMemoryRoom(state).awarenessStates.values()]
    },

    // 订阅 awareness state 变化。
    onChange(listener) {
      return addMemoryAdapterListener(state.awarenessListeners, listener)
    }
  }
}

// 将 awareness state 序列化成稳定 JSON 字符串。
export function serializeAwarenessState(state: JWordAwarenessState): string {
  return JSON.stringify(state)
}

// 从 JSON 字符串解析 awareness state，并返回结构化诊断。
export function parseAwarenessState(input: string): ParseAwarenessStateResult {
  try {
    const value = JSON.parse(input) as unknown
    const downgraded = maybeDowngradeInvalidRangeAwareness(value)

    if (downgraded !== null) {
      return downgraded
    }

    if (!isAwarenessState(value)) {
      return {
        state: createEmptyAwarenessState(),
        diagnostics: [createDiagnostic(
          'COLLAB_AWARENESS_INVALID',
          'error',
          'Awareness state payload is invalid',
          false
        )]
      }
    }

    return {
      state: value,
      diagnostics: []
    }
  } catch {
    return {
      state: createEmptyAwarenessState(),
      diagnostics: [createDiagnostic(
        'COLLAB_AWARENESS_PARSE_FAILED',
        'error',
        'Awareness state payload is not valid JSON',
        false
      )]
    }
  }
}

// 清理超过 staleAfterMs 的 awareness state。
export function cleanupStaleAwarenessStates(
  states: readonly JWordAwarenessState[],
  options: CleanupStaleAwarenessStatesOptions
): readonly JWordAwarenessState[] {
  return states.filter((state) => options.now - state.updatedAt <= options.staleAfterMs)
}

// 将无法解析锚点的 awareness 降级为只包含 presence 的状态。
export function downgradeUnresolvedAnchorToPresence(
  state: JWordAwarenessState
): DowngradeUnresolvedAnchorResult {
  return {
    state: {
      clientId: state.clientId,
      user: state.user,
      updatedAt: state.updatedAt
    },
    diagnostic: createDiagnostic(
      'COLLAB_AWARENESS_ANCHOR_UNRESOLVED',
      'warning',
      'Awareness anchor could not be resolved and was downgraded to presence only',
      true,
      state.clientId
    )
  }
}

// 注册内存 adapter listener，并返回取消订阅函数。
function addMemoryAdapterListener<TListener>(
  listeners: Set<TListener>,
  listener: TListener
): JWordCollabUnsubscribe {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

// 校验内存 adapter 尚未销毁。
function assertMemoryAdapterActive(state: MemoryCollabProviderAdapterState): void {
  if (state.destroyed) {
    throw createProviderError(
      'COLLAB_PROVIDER_DESTROYED',
      'Collab provider has already been destroyed',
      false
    )
  }
}

// 读取或创建当前内存 room。
function readMemoryRoom(state: MemoryCollabProviderAdapterState): MemoryCollabRoom {
  const key = createMemoryRoomKey(state)
  const existing = memoryCollabRooms.get(key)

  if (existing !== undefined) {
    return existing
  }

  const created: MemoryCollabRoom = {
    adapters: new Set(),
    awarenessStates: new Map()
  }

  memoryCollabRooms.set(key, created)

  return created
}

// 将 adapter 注册到内存 room。
function registerMemoryAdapter(state: MemoryCollabProviderAdapterState): void {
  readMemoryRoom(state).adapters.add(state)
}

// 从内存 room 移除 adapter 并清理本 client awareness。
function unregisterMemoryAdapter(state: MemoryCollabProviderAdapterState): void {
  const key = createMemoryRoomKey(state)
  const room = memoryCollabRooms.get(key)

  if (room === undefined) {
    return
  }

  room.adapters.delete(state)
  room.awarenessStates.delete(state.clientId)
  broadcastMemoryAwareness(state)

  if (room.adapters.size === 0 && room.awarenessStates.size === 0) {
    memoryCollabRooms.delete(key)
  }
}

// 判断 update metadata 是否属于当前 adapter。
function matchesMemoryAdapterMetadata(
  state: MemoryCollabProviderAdapterState,
  metadata: JWordCollabUpdateMetadata
): boolean {
  return metadata.documentId === state.documentId &&
    metadata.clientId === state.clientId &&
    (metadata.roomId === undefined || metadata.roomId === state.roomId)
}

// 向同一 room 的所有 adapter 广播 update。
function broadcastMemoryAdapterUpdate(
  state: MemoryCollabProviderAdapterState,
  update: Uint8Array,
  metadata: JWordCollabUpdateMetadata
): void {
  const room = readMemoryRoom(state)

  for (const adapterState of room.adapters) {
    emitMemoryAdapterUpdate(adapterState, new Uint8Array(update), metadata)
  }
}

// 向同一 room 的所有 adapter 广播 awareness 快照。
function broadcastMemoryAwareness(state: MemoryCollabProviderAdapterState): void {
  const room = readMemoryRoom(state)
  const states = [...room.awarenessStates.values()]

  for (const adapterState of room.adapters) {
    for (const listener of adapterState.awarenessListeners) {
      listener(states)
    }
  }
}

// 生成内存 room key，避免同名 room 跨文档串线。
function createMemoryRoomKey(state: MemoryCollabProviderAdapterState): string {
  return `${state.documentId}:${state.roomId}`
}

// 更新内存 adapter 状态并通知订阅者。
function setMemoryAdapterStatus(
  state: MemoryCollabProviderAdapterState,
  status: JWordCollabProviderStatus
): void {
  state.status = status
  for (const listener of state.statusListeners) {
    listener(status)
  }
}

// 派发内存 adapter 错误。
function emitMemoryAdapterError(
  state: MemoryCollabProviderAdapterState,
  error: JWordCollabProviderError
): void {
  state.error = error
  state.diagnostics.push(createDiagnostic(error.code, 'error', error.message, error.recoverable))
  setMemoryAdapterStatus(state, 'error')
  for (const listener of state.errorListeners) {
    listener(error)
  }
}

// 派发内存 adapter update。
function emitMemoryAdapterUpdate(
  state: MemoryCollabProviderAdapterState,
  update: Uint8Array,
  metadata: JWordCollabUpdateMetadata
): void {
  for (const listener of state.updateListeners) {
    listener(update, metadata)
  }
}

// 派发内存 adapter 同步完成事件。
function emitMemoryAdapterSynced(state: MemoryCollabProviderAdapterState): void {
  for (const listener of state.syncedListeners) {
    listener()
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

// 读取授权错误对应的协作诊断码。
function readCollabLicenseDiagnosticCode(error: unknown): string {
  return readLicenseDiagnosticCode(error).replace('JWORD_', 'COLLAB_')
}

// 读取公开授权错误码，未知错误统一按缺少授权处理。
function readLicenseDiagnosticCode(error: unknown) {
  if (
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string' &&
    isJWordLicenseDiagnosticCode(error.code)
  ) {
    return error.code
  }

  return 'JWORD_LICENSE_MISSING'
}

// 创建解析失败时使用的空 presence 状态。
function createEmptyAwarenessState(): JWordAwarenessState {
  return {
    clientId: '',
    user: {
      id: '',
      name: ''
    },
    updatedAt: 0
  }
}

// 如果 presence 基础字段有效但 range snapshot 无法解析，则降级为只展示在线用户。
function maybeDowngradeInvalidRangeAwareness(value: unknown): ParseAwarenessStateResult | null {
  if (!isRecord(value) || value.rangeSnapshot === undefined || isAwarenessRangeSnapshot(value.rangeSnapshot)) {
    return null
  }
  if (!isAwarenessPresenceState(value)) {
    return null
  }

  const result = downgradeUnresolvedAnchorToPresence({
    clientId: value.clientId,
    user: value.user,
    updatedAt: value.updatedAt
  })

  return {
    state: result.state,
    diagnostics: [result.diagnostic]
  }
}
