/**
 * 职责：承载 Gate 6 collaboration client 的 history、offline 和 pending 队列运行时。
 * 边界：只处理 SDK 侧 history HTTP/fallback 与离线状态快照，不连接 provider、不创建 awareness。
 * 协作模块：client-sdk.ts 注入 editor/options/localUser；client-types.ts 提供公开 handle 和版本类型。
 * 性能/安全约束：history 失败只记录诊断并降级到内存版本，不泄漏 update payload 给 preview 元数据。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import type {
  JWordAwarenessUser,
  JWordCollabDiagnostic
} from './index.js'
import {
  createCollabDiagnostic,
  readErrorMessage
} from './client-diagnostics.js'
import type {
  ConnectJWordCollaborationOptions,
  InternalHistoryVersion,
  JWordCollaborationEditor,
  JWordCollaborationHistoryHandle,
  JWordCollaborationHistoryPreview,
  JWordCollaborationHistoryRecordInput,
  JWordCollaborationHistoryVersion,
  JWordCollaborationOfflineHandle,
  JWordCollaborationOfflineState,
  JWordCollaborationStatus
} from './client-types.js'

export type PendingOperationKind = 'provider-send' | 'history-record'

export interface PendingOperationTracker {
  add(kind: PendingOperationKind): () => void
  readQueuedOperations(): number
}

interface HistoryRuntimeState {
  readonly fallbackVersions: InternalHistoryVersion[]
  readonly diagnostics: JWordCollabDiagnostic[]
  readonly pendingOperations: PendingOperationTracker
  readStatus(): JWordCollaborationStatus
}

interface RawHistoryVersion {
  readonly versionId?: unknown
  readonly documentId?: unknown
  readonly roomId?: unknown
  readonly label?: unknown
  readonly author?: unknown
  readonly authorId?: unknown
  readonly createdAt?: unknown
  readonly updateByteLength?: unknown
  readonly byteLength?: unknown
}

interface RawHistoryDiagnostic {
  readonly code?: unknown
  readonly diagnosticCode?: unknown
  readonly severity?: unknown
  readonly message?: unknown
  readonly recoverable?: unknown
}

interface RawHistoryResponse {
  readonly version?: unknown
  readonly versions?: unknown
  readonly diagnostics?: unknown
  readonly diagnostic?: unknown
  readonly diagnosticCode?: unknown
}

const BASE64_CHUNK_SIZE = 0x8000

/** 创建协作历史 handle。 */
export function createHistoryHandle(
  editor: JWordCollaborationEditor,
  options: ConnectJWordCollaborationOptions,
  localUser: JWordAwarenessUser,
  state: HistoryRuntimeState
): JWordCollaborationHistoryHandle {
  return {
    /** 列出当前连接可见的服务端版本，失败时带诊断降级到内存版本。 */
    async listVersions() {
      return withHistoryFallback(
        localUser,
        state,
        () => listServerHistoryVersions(options, localUser),
        () => state.fallbackVersions.map((item) => item.version)
      )
    },

    /** 记录当前 editor 协作 update 为一个服务端版本。 */
    async recordVersion(input) {
      const update = editor.encodeSyncUpdate()
      const releasePending = state.pendingOperations.add('history-record')

      try {
        return await withHistoryFallback(
          localUser,
          state,
          () => recordServerHistoryVersion(options, localUser, input, update),
          () => recordFallbackHistoryVersion(options, localUser, input, update, state.fallbackVersions)
        )
      } finally {
        releasePending()
      }
    },

    /** 创建不泄漏 update payload 的服务端版本预览结果。 */
    async previewVersion(versionId) {
      return withHistoryFallback(
        localUser,
        state,
        () => previewServerHistoryVersion(options, localUser, versionId),
        () => {
          const found = state.fallbackVersions.find((item) => item.version.versionId === versionId)

          return found === undefined ? null : { version: found.version }
        }
      )
    },

    /** 恢复已记录版本。 */
    async restoreVersion(versionId) {
      const preview = await withHistoryFallback(
        localUser,
        state,
        () => previewServerHistoryPayload(options, localUser, versionId),
        () => {
          const found = state.fallbackVersions.find((item) => item.version.versionId === versionId)

          return found === undefined ? null : { version: found.version, update: found.update }
        }
      )

      if (preview === null) {
        const diagnostic = createCollabDiagnostic(
          'COLLAB_SNAPSHOT_MISSING',
          'warning',
          'Collaboration history version was not found.',
          true,
          localUser.id
        )
        state.diagnostics.push(diagnostic)

        return {
          ok: false,
          diagnostic
        }
      }

      const restoreOptions = {
        origin: 'version-restore',
        documentId: options.documentId,
        roomId: options.roomId,
        clientId: localUser.id,
        requestId: preview.version.versionId,
        recoverable: true
      } as const

      if (editor.replaceSyncUpdate !== undefined) {
        editor.replaceSyncUpdate(preview.update, restoreOptions)
      } else {
        editor.applySyncUpdate(preview.update, restoreOptions)
      }

      return {
        ok: true,
        version: preview.version
      }
    }
  }
}

/** 创建离线状态 handle。 */
export function createOfflineHandle(
  diagnostics: readonly JWordCollabDiagnostic[],
  readStatus: () => JWordCollaborationStatus,
  pendingOperations: PendingOperationTracker
): JWordCollaborationOfflineHandle {
  return {
    /** 读取当前离线队列快照。 */
    readState() {
      const status = readStatus()
      const queuedOperations = pendingOperations.readQueuedOperations()

      return {
        status: readOfflineStatus(status, queuedOperations),
        queuedOperations,
        diagnostics
      }
    }
  }
}

/** 创建离线队列计数器。 */
export function createPendingOperationTracker(): PendingOperationTracker {
  const counts = new Map<PendingOperationKind, number>()

  return {
    /** 增加一个 pending 操作并返回释放函数。 */
    add(kind) {
      counts.set(kind, (counts.get(kind) ?? 0) + 1)
      let released = false

      return () => {
        if (released) {
          return
        }
        released = true
        counts.set(kind, Math.max(0, (counts.get(kind) ?? 0) - 1))
      }
    },

    /** 读取所有 pending 操作数量。 */
    readQueuedOperations() {
      let total = 0

      for (const count of counts.values()) {
        total += count
      }

      return total
    }
  }
}

/** 调用服务端 history API，失败时记录诊断并降级到内存历史。 */
async function withHistoryFallback<Result>(
  localUser: JWordAwarenessUser,
  state: HistoryRuntimeState,
  serverAction: () => Promise<Result>,
  fallbackAction: () => Result | Promise<Result>
): Promise<Result> {
  try {
    return await serverAction()
  } catch (error) {
    state.diagnostics.push(createCollabDiagnostic(
      'COLLAB_HISTORY_SERVER_FALLBACK',
      'warning',
      `Server-backed collaboration history failed and fell back to in-memory diagnostics: ${readErrorMessage(error)}`,
      true,
      localUser.id
    ))

    return fallbackAction()
  }
}

/** 读取服务端历史版本列表。 */
async function listServerHistoryVersions(
  options: ConnectJWordCollaborationOptions,
  localUser: JWordAwarenessUser
): Promise<readonly JWordCollaborationHistoryVersion[]> {
  const url = createHistoryEndpointUrl(options.serverUrl, '/history/versions')

  url.searchParams.set('documentId', options.documentId)
  const response = await fetch(url, {
    headers: createHistoryHeaders(options)
  })
  const body = await readHistoryJsonResponse(response)
  const rawVersions = Array.isArray(body.versions) ? body.versions : []

  return rawVersions.map((version) => readHistoryVersion(version, options, localUser))
}

/** 把当前 update 记录为服务端历史版本。 */
async function recordServerHistoryVersion(
  options: ConnectJWordCollaborationOptions,
  localUser: JWordAwarenessUser,
  input: JWordCollaborationHistoryRecordInput,
  update: Uint8Array
): Promise<JWordCollaborationHistoryVersion> {
  const response = await fetch(createHistoryEndpointUrl(options.serverUrl, '/history/versions'), {
    method: 'POST',
    headers: createHistoryHeaders(options),
    body: JSON.stringify({
      documentId: options.documentId,
      roomId: options.roomId,
      clientId: localUser.id,
      authorId: localUser.id,
      origin: 'local-user',
      label: input.label,
      updateBase64: encodeBase64(update),
      ...(input.createdAt === undefined ? {} : { createdAt: new Date(input.createdAt).toISOString() })
    })
  })
  const body = await readHistoryJsonResponse(response)

  return readHistoryVersion(body.version, options, localUser)
}

/** 读取服务端历史版本预览元数据。 */
async function previewServerHistoryVersion(
  options: ConnectJWordCollaborationOptions,
  localUser: JWordAwarenessUser,
  versionId: string
): Promise<JWordCollaborationHistoryPreview | null> {
  const preview = await previewServerHistoryPayload(options, localUser, versionId)

  return preview === null ? null : { version: preview.version }
}

/** 读取服务端历史版本预览 update。 */
async function previewServerHistoryPayload(
  options: ConnectJWordCollaborationOptions,
  localUser: JWordAwarenessUser,
  versionId: string
): Promise<{ readonly version: JWordCollaborationHistoryVersion, readonly update: Uint8Array } | null> {
  const url = createHistoryEndpointUrl(options.serverUrl, '/history/preview')

  url.searchParams.set('documentId', options.documentId)
  url.searchParams.set('versionId', versionId)
  const response = await fetch(url, {
    method: 'POST',
    headers: createHistoryHeaders(options),
    body: JSON.stringify({
      documentId: options.documentId,
      versionId
    })
  })
  const body = await readHistoryJsonResponse(response)

  if (body.version === undefined) {
    return null
  }

  const updateBase64 = typeof (body as { readonly updateBase64?: unknown }).updateBase64 === 'string'
    ? (body as { readonly updateBase64: string }).updateBase64
    : ''

  return {
    version: readHistoryVersion(body.version, options, localUser),
    update: decodeBase64(updateBase64)
  }
}

/** 记录内存 fallback 历史，并暴露为诊断降级。 */
function recordFallbackHistoryVersion(
  options: ConnectJWordCollaborationOptions,
  localUser: JWordAwarenessUser,
  input: JWordCollaborationHistoryRecordInput,
  update: Uint8Array,
  versions: InternalHistoryVersion[]
): JWordCollaborationHistoryVersion {
  const version: JWordCollaborationHistoryVersion = {
    versionId: `fallback-version-${versions.length + 1}`,
    documentId: options.documentId,
    roomId: options.roomId,
    label: input.label,
    author: localUser,
    createdAt: input.createdAt ?? Date.now(),
    updateByteLength: update.byteLength
  }

  versions.push({
    version,
    update
  })

  return version
}

/** 读取并校验 history JSON 响应。 */
async function readHistoryJsonResponse(response: Response): Promise<RawHistoryResponse> {
  const body = await response.json() as RawHistoryResponse

  if (!response.ok) {
    throw new Error(readHistoryDiagnosticMessage(body, response.status))
  }

  return body
}

/** 把服务端版本元数据归一为 SDK 版本结构。 */
function readHistoryVersion(
  value: unknown,
  options: ConnectJWordCollaborationOptions,
  localUser: JWordAwarenessUser
): JWordCollaborationHistoryVersion {
  const raw = isUnknownRecord(value) ? value as RawHistoryVersion : {}
  const createdAt = typeof raw.createdAt === 'number'
    ? raw.createdAt
    : Date.parse(typeof raw.createdAt === 'string' ? raw.createdAt : '')
  const updateByteLength = typeof raw.updateByteLength === 'number'
    ? raw.updateByteLength
    : typeof raw.byteLength === 'number' ? raw.byteLength : 0

  return {
    versionId: typeof raw.versionId === 'string' ? raw.versionId : `server-version-${Date.now()}`,
    documentId: typeof raw.documentId === 'string' ? raw.documentId : options.documentId,
    roomId: typeof raw.roomId === 'string' ? raw.roomId : options.roomId,
    label: typeof raw.label === 'string' ? raw.label : '',
    author: readHistoryAuthor(raw, localUser),
    createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
    updateByteLength
  }
}

/** 读取服务端版本作者。 */
function readHistoryAuthor(
  raw: RawHistoryVersion,
  localUser: JWordAwarenessUser
): JWordAwarenessUser {
  const author = raw.author

  if (isUnknownRecord(author) && typeof author.id === 'string' && typeof author.name === 'string') {
    return {
      id: author.id,
      name: author.name,
      ...(typeof author.color === 'string' ? { color: author.color } : {}),
      ...(typeof author.avatarUrl === 'string' ? { avatarUrl: author.avatarUrl } : {})
    }
  }

  if (typeof raw.authorId === 'string' && raw.authorId !== localUser.id) {
    return {
      id: raw.authorId,
      name: raw.authorId
    }
  }

  return localUser
}

/** 创建 history HTTP headers。 */
function createHistoryHeaders(options: ConnectJWordCollaborationOptions): HeadersInit {
  return {
    'authorization': `Bearer ${options.token}`,
    'content-type': 'application/json',
    'x-jword-document-id': options.documentId,
    'x-jword-entitlement': JSON.stringify(options.license ?? null)
  }
}

/** 把 serverUrl 转换为 history endpoint。 */
function createHistoryEndpointUrl(serverUrl: string, pathname: string): URL {
  const url = new URL(serverUrl)

  if (url.protocol === 'ws:') {
    url.protocol = 'http:'
  } else if (url.protocol === 'wss:') {
    url.protocol = 'https:'
  }
  url.pathname = pathname
  url.search = ''
  url.hash = ''

  return url
}

/** 读取服务端 history 诊断消息。 */
function readHistoryDiagnosticMessage(body: RawHistoryResponse, status: number): string {
  if (typeof body.diagnosticCode === 'string') {
    return body.diagnosticCode
  }

  if (isUnknownRecord(body.diagnostic)) {
    return readRawDiagnosticMessage(body.diagnostic as RawHistoryDiagnostic)
  }

  if (Array.isArray(body.diagnostics) && body.diagnostics.length > 0 && isUnknownRecord(body.diagnostics[0])) {
    return readRawDiagnosticMessage(body.diagnostics[0] as RawHistoryDiagnostic)
  }

  return `Collaboration history server returned HTTP ${status}.`
}

/** 读取原始诊断消息。 */
function readRawDiagnosticMessage(diagnostic: RawHistoryDiagnostic): string {
  if (typeof diagnostic.message === 'string') {
    return diagnostic.message
  }

  if (typeof diagnostic.code === 'string') {
    return diagnostic.code
  }

  return typeof diagnostic.diagnosticCode === 'string'
    ? diagnostic.diagnosticCode
    : 'Collaboration history server returned a diagnostic.'
}

/** 编码二进制 update。 */
function encodeBase64(update: Uint8Array): string {
  let binary = ''

  for (let offset = 0; offset < update.length; offset += BASE64_CHUNK_SIZE) {
    binary += String.fromCharCode(...update.subarray(offset, offset + BASE64_CHUNK_SIZE))
  }

  return btoa(binary)
}

/** 解码二进制 update。 */
function decodeBase64(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  return bytes
}

/** 判断未知输入是否是普通对象。 */
function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** 归一化离线状态。 */
function readOfflineStatus(
  status: JWordCollaborationStatus,
  queuedOperations: number
): JWordCollaborationOfflineState['status'] {
  if (status === 'offline' || status === 'reconnecting') {
    return 'offline'
  }

  if (status === 'disconnected' && queuedOperations > 0) {
    return 'offline'
  }

  return queuedOperations > 0 ? 'pending' : 'synced'
}
