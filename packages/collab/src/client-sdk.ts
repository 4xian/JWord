/**
 * 职责：提供 Gate 6 第三方可消费的协作 client SDK 公开入口。
 * 边界：只消费稳定 ProviderAdapter、授权 entitlement 和结构化 Editor facade，不导出具体 provider 或示例运行时类型。
 * 协作模块：packages/collab/src/index.ts、packages/license 和 core 暴露的协作 update facade。
 * 性能/安全约束：初始化先完成授权和 provider 检查；失败只返回 diagnostic，不连接 provider、不读取文档内容。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#step-625定义-connectjwordcollaborationeditor-options-公开入口。
 */

import { assertJWordFeatureEntitled } from '@4xian/jword-license'
import {
  createTextInserter,
  createRangeRef,
  type AnchorRef,
  type Editor,
  type TextInserterErrorEvent,
  type TextInserterProgressPhase,
  type TextInserterRetryInput,
  type RangeRef
} from '@4xian/jword-core'

import type {
  JWordAwarenessState,
  JWordAwarenessTextAnchorRecord,
  JWordAwarenessUser,
  JWordCollabDiagnostic,
  JWordCollabUpdateMetadata,
  JWordCollabProviderStatus,
  JWordCollabUnsubscribe
} from './index.js'
import {
  createCollabDiagnostic,
  createLicenseDiagnostic,
  readErrorMessage
} from './client-diagnostics.js'
import {
  createHistoryHandle,
  createOfflineHandle,
  createPendingOperationTracker,
  type PendingOperationTracker
} from './client-history.js'
import {
  JWORD_COLLAB_CLIENT_PACKAGE_VERSION,
  JWORD_COLLAB_CLIENT_PROTOCOL_VERSION
} from './client-types.js'
import type {
  AutoInsertWriter,
  ConnectJWordCollaborationOptions,
  InternalHistoryVersion,
  JWordCollaborationAutoInsertActor,
  JWordCollaborationAutoInsertChunkMetadata,
  JWordCollaborationAutoInsertProgress,
  JWordCollaborationAutoInsertRange,
  JWordCollaborationAutoInsertRetryInput,
  JWordCollaborationAutoInsertSession,
  JWordCollaborationAutoInsertSessionInput,
  JWordCollaborationAutoInsertStatus,
  JWordCollaborationAutoInsertWriteResult,
  JWordCollaborationAwarenessHandle,
  JWordCollaborationConnection,
  JWordCollaborationEditor,
  JWordCollaborationHandshake,
  JWordCollaborationPresenceInput,
  JWordCollaborationStatus,
  JWordCollaborationUser
} from './client-types.js'

export {
  JWORD_COLLAB_CLIENT_PACKAGE_VERSION,
  JWORD_COLLAB_CLIENT_PROTOCOL_VERSION
} from './client-types.js'
export type {
  ConnectJWordCollaborationOptions,
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
  JWordCollaborationAwarenessHandle,
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
} from './client-types.js'

/** 连接 JWord 商业协作 client，并返回不会泄漏底层 provider 的 handle。 */
export async function connectJWordCollaboration(
  editor: JWordCollaborationEditor,
  options: ConnectJWordCollaborationOptions
): Promise<JWordCollaborationConnection> {
  const localUser = normalizeCollaborationUser(options.user)
  const diagnostics = validateConnectionOptions(options)

  if (diagnostics.length > 0 || options.provider === undefined) {
    const failedDiagnostics = options.provider === undefined
      ? [
        ...diagnostics,
        createCollabDiagnostic(
          'COLLAB_PROVIDER_UNAVAILABLE',
          'error',
          'Collaboration provider is unavailable; connection was not started.',
          true,
          options.user.id
        )
      ]
      : diagnostics

    return createCollaborationConnection(editor, options, localUser, failedDiagnostics, 'error', null)
  }

  const handshakeResult = await readCollaborationHandshake(options, localUser.id)

  if (!handshakeResult.ok) {
    return createCollaborationConnection(editor, options, localUser, [handshakeResult.diagnostic], 'error', null)
  }

  const connection = createCollaborationConnection(editor, options, localUser, [], 'connecting', handshakeResult.handshake)

  try {
    await options.provider.connect()
    connection.awareness.setLocalPresence()

    return connection
  } catch (error) {
    await options.provider.disconnect()
    const diagnostic = createCollabDiagnostic(
      'COLLAB_PROVIDER_UNAVAILABLE',
      'error',
      readErrorMessage(error),
      true,
      localUser.id
    )

    return createCollaborationConnection(editor, options, localUser, [diagnostic], 'error', handshakeResult.handshake)
  }
}

/** 创建协作连接 handle。 */
function createCollaborationConnection(
  editor: JWordCollaborationEditor,
  options: ConnectJWordCollaborationOptions,
  localUser: JWordAwarenessUser & { readonly color: string },
  initialDiagnostics: readonly JWordCollabDiagnostic[],
  initialStatus: JWordCollaborationStatus,
  handshake: JWordCollaborationHandshake | null
): JWordCollaborationConnection {
  const provider = options.provider
  const diagnostics: JWordCollabDiagnostic[] = [...initialDiagnostics]
  const unsubscribers: JWordCollabUnsubscribe[] = []
  const fallbackVersions: InternalHistoryVersion[] = []
  const pendingOperations = createPendingOperationTracker()
  let status = initialStatus

  const awareness = createAwarenessHandle(options, localUser)
  const history = createHistoryHandle(editor, options, localUser, {
    fallbackVersions,
    diagnostics,
    pendingOperations,
    readStatus: () => status
  })
  const offline = createOfflineHandle(diagnostics, () => status, pendingOperations)

  if (provider !== undefined && initialDiagnostics.length === 0) {
    unsubscribers.push(provider.onStatusChange((nextStatus) => {
      status = nextStatus
    }))
    unsubscribers.push(provider.onError((error) => {
      diagnostics.push(createCollabDiagnostic(
        error.code,
        'error',
        error.message,
        error.recoverable,
        localUser.id
      ))
      status = 'error'
    }))
    unsubscribers.push(provider.onUpdate((update, metadata) => {
      if (metadata.clientId === localUser.id) {
        return
      }

      editor.applySyncUpdate(update, {
        origin: 'remote-user',
        documentId: options.documentId,
        roomId: options.roomId,
        clientId: metadata.clientId,
        requestId: metadata.updateId,
        recoverable: true
      })
    }))
    const unsubscribeEditor = subscribeLocalTransactions(editor, options, localUser, diagnostics, pendingOperations)

    if (unsubscribeEditor !== null) {
      unsubscribers.push(unsubscribeEditor)
    }
  }

  return {
    /** 读取当前协作连接状态。 */
    get status() {
      return status
    },

    /** 读取初始化、provider、offline、history 和 auto insert 诊断。 */
    get diagnostics() {
      return diagnostics
    },

    /** 读取 client/server 版本握手结果。 */
    get handshake() {
      return handshake
    },

    /** 读取 presence 和 awareness 操作入口。 */
    get awareness() {
      return awareness
    },

    /** 读取协作历史操作入口。 */
    get history() {
      return history
    },

    /** 读取离线状态入口。 */
    get offline() {
      return offline
    },

    /** 启动一次程序化自动插入会话。 */
    startAutoInsertSession(input = {}) {
      return createAutoInsertSession(editor, options, localUser, input, diagnostics)
    },

    /** 断开 provider 并清理本地 presence。 */
    async disconnect() {
      if (status === 'destroyed') {
        return
      }
      provider?.awareness.clearLocalState()
      await provider?.disconnect()
      status = 'disconnected'
    },

    /** 销毁连接 handle、provider awareness 和所有订阅。 */
    async destroy() {
      if (status === 'destroyed') {
        return
      }
      provider?.awareness.clearLocalState()
      for (const unsubscribe of unsubscribers.splice(0)) {
        unsubscribe()
      }
      await provider?.destroy()
      status = 'destroyed'
    }
  }
}

/** 订阅本地事务并发布到 provider。 */
function subscribeLocalTransactions(
  editor: JWordCollaborationEditor,
  options: ConnectJWordCollaborationOptions,
  localUser: JWordAwarenessUser,
  diagnostics: JWordCollabDiagnostic[],
  pendingOperations: PendingOperationTracker
): JWordCollabUnsubscribe | null {
  const provider = options.provider

  if (editor.subscribe === undefined || provider === undefined) {
    return null
  }

  return editor.subscribe((event) => {
    if (event.kind !== 'transaction' || !shouldPublishTransactionOrigin(event.transaction.origin)) {
      return
    }

    const update = editor.encodeSyncUpdate()
    const metadata: JWordCollabUpdateMetadata = {
      documentId: options.documentId,
      roomId: options.roomId,
      clientId: localUser.id,
      updateId: createClientUpdateId('local'),
      origin: 'local'
    }
    const releasePending = pendingOperations.add('provider-send')

    void provider.sendUpdate(update, metadata)
      .catch((error) => {
        diagnostics.push(createCollabDiagnostic(
          'COLLAB_PROVIDER_SEND_FAILED',
          'warning',
          readErrorMessage(error),
          true,
          localUser.id
        ))
      })
      .finally(releasePending)
  })
}

/** 判断事务 origin 是否属于本地用户更新。 */
function shouldPublishTransactionOrigin(origin: string): boolean {
  return origin === 'local-user' || origin === 'user'
}

/** 创建本地 provider update id。 */
function createClientUpdateId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

/** 创建 awareness handle。 */
function createAwarenessHandle(
  options: ConnectJWordCollaborationOptions,
  localUser: JWordAwarenessUser & { readonly color: string }
): JWordCollaborationAwarenessHandle {
  const provider = options.provider

  return {
    /** 读取稳定本地用户。 */
    get localUser() {
      return localUser
    },

    /** 读取本地 awareness state。 */
    get localState() {
      return provider?.awareness.localState
    },

    /** 读取远端 awareness state。 */
    get remoteStates() {
      return provider?.awareness.getStates().filter((state) => state.clientId !== localUser.id) ?? []
    },

    /** 写入本地 presence、cursor、selection 和 typing 状态。 */
    setLocalPresence(input = {}) {
      provider?.awareness.setLocalState(createLocalAwarenessState(localUser, input))
    },

    /** 清理本地 presence。 */
    clearLocalPresence() {
      provider?.awareness.clearLocalState()
    }
  }
}

/** 创建自动插入会话 handle。 */
function createAutoInsertSession(
  editor: JWordCollaborationEditor,
  options: ConnectJWordCollaborationOptions,
  localUser: JWordAwarenessUser,
  input: JWordCollaborationAutoInsertSessionInput,
  connectionDiagnostics: JWordCollabDiagnostic[]
): JWordCollaborationAutoInsertSession {
  const diagnostics: JWordCollabDiagnostic[] = []
  const requestId = input.requestId ?? `auto-insert-${Date.now()}`
  const actor = normalizeAutoInsertActor(input.actor, localUser)
  let status: JWordCollaborationAutoInsertStatus = input.position === undefined && input.range === undefined
    ? 'failed'
    : 'running'
  let insertedChunks = 0
  let insertedTextLength = 0

  if (status === 'failed') {
    const diagnostic = createCollabDiagnostic(
      'COLLAB_AUTO_INSERTER_POSITION_REQUIRED',
      'error',
      'Collaboration auto insert session requires an explicit position or range.',
      true,
      actor.id
    )
    diagnostics.push(diagnostic)
    connectionDiagnostics.push(diagnostic)
  }
  const inserter = status === 'running'
    ? createSdkInserter(editor, options, input, actor, requestId, diagnostics, connectionDiagnostics)
    : null

  return {
    /** 读取自动插入 request id。 */
    get requestId() {
      return requestId
    },

    /** 读取自动插入状态。 */
    get status() {
      return status
    },

    /** 读取自动插入虚拟 actor。 */
    get actor() {
      return actor
    },

    /** 读取自动插入进度快照。 */
    get progress() {
      return {
        requestId,
        insertedChunks,
        insertedTextLength,
        phase: status
      }
    },

    /** 读取自动插入诊断。 */
    get diagnostics() {
      return diagnostics
    },

    /** 写入一段待插入文本，通过受控 auto-inserter origin 进入 editor。 */
    write(text, metadata = {}) {
      if (status !== 'running' || text.length === 0 || inserter === null) {
        return null
      }

      return commitAutoInsertText(text, metadata, () => inserter.write(text))
    },

    /** 使用新的显式位置或范围重试最近一次可恢复写入。 */
    retry(retryInput = {}) {
      if (status !== 'running' || inserter === null) {
        return null
      }

      const retryText = retryInput.text ?? ''

      return commitAutoInsertText(retryText, retryInput.metadata ?? {}, () => inserter.retry(retryInput))
    },

    /** 中止自动插入会话并记录公开诊断。 */
    abort() {
      if (status !== 'running') {
        return
      }

      status = 'aborted'
      const diagnostic = createCollabDiagnostic(
        'COLLAB_AUTO_INSERTER_ABORTED',
        'info',
        'Collaboration auto insert session was aborted.',
        true
      )
      diagnostics.push(diagnostic)
      connectionDiagnostics.push(diagnostic)
    }
  }

  /** 统一提交成功计数和失败状态切换。 */
  function commitAutoInsertText(
    text: string,
    metadata: JWordCollaborationAutoInsertChunkMetadata,
    commit: () => unknown | null
  ): JWordCollaborationAutoInsertWriteResult | null {
    const result = commit()

    if (result !== null) {
      insertedChunks += 1
      insertedTextLength += Array.from(text).length

      return {
        ok: true,
        requestId,
        ...(metadata.chunkId === undefined ? {} : { chunkId: metadata.chunkId }),
        insertedText: text
      }
    }

    if (diagnostics.some((diagnostic) => diagnostic.code === 'COLLAB_AUTO_INSERTER_FLUSH_FAILED')) {
      status = 'failed'
    }

    return null
  }
}

/** 创建 SDK 自动插入器，确保写入走 core transaction pipeline。 */
function createSdkInserter(
  editor: JWordCollaborationEditor,
  options: ConnectJWordCollaborationOptions,
  input: JWordCollaborationAutoInsertSessionInput,
  actor: JWordCollaborationAutoInsertActor,
  requestId: string,
  diagnostics: JWordCollabDiagnostic[],
  connectionDiagnostics: JWordCollabDiagnostic[]
): AutoInsertWriter {
  if (!isInserterCapableEditor(editor)) {
    return createFallbackAutoInsertWriter(editor, options, actor, requestId)
  }

  const capableEditor = editor
  const inserter = createTextInserter(capableEditor, {
    requestId,
    ...(input.range === undefined
      ? { anchor: resolveAutoInsertAnchor(capableEditor, input.position?.anchor) }
      : {
          range: resolveAutoInsertRange(capableEditor, input.range),
          mode: 'replace'
        }),
    undoScope: 'auto-inserter',
    onProgress: (event: { readonly phase: TextInserterProgressPhase }) => {
      void readAutoInsertProgressPhase(event.phase)
    },
    onError: (event: TextInserterErrorEvent) => {
      const diagnostic = createAutoInsertErrorDiagnostic(event)

      diagnostics.push(diagnostic)
      connectionDiagnostics.push(diagnostic)
    }
  })

  return {
    /** 写入自动插入文本。 */
    write(text) {
      return inserter.write(text)
    },

    /** 使用新的显式位置或范围重试最近一次可恢复写入。 */
    retry(retryInput = {}) {
      if (retryInput.text !== undefined && retryInput.text.length > 0) {
        inserter.queue(retryInput.text)
      }

      return inserter.retry(resolveAutoInsertRetryInput(capableEditor, retryInput))
    }
  }
}

/** 为只实现旧协作接口的外部测试 editor 保留受控 auto-inserter origin 写入。 */
function createFallbackAutoInsertWriter(
  editor: JWordCollaborationEditor,
  options: ConnectJWordCollaborationOptions,
  actor: JWordCollaborationAutoInsertActor,
  requestId: string
): AutoInsertWriter {
  /** 通过旧 editor 适配器写入 auto-inserter update。 */
  const writeFallbackText = (text: string): unknown | null =>
    editor.applySyncUpdate(new TextEncoder().encode(text), {
      origin: 'auto-inserter',
      documentId: options.documentId,
      roomId: options.roomId,
      clientId: actor.id,
      requestId,
      recoverable: true,
      undoScope: 'auto-inserter'
    }) === null ? null : {}

  return {
    /** 写入自动插入文本到旧 editor 适配器。 */
    write(text: string) {
      return writeFallbackText(text)
    },

    /** 旧 editor 适配器重试时仍然只走 auto-inserter origin。 */
    retry(retryInput = {}) {
      const text = retryInput.text ?? ''

      return text.length === 0 ? null : writeFallbackText(text)
    }
  }
}

/** 把公开 retry 输入解析为 core retry 输入。 */
function resolveAutoInsertRetryInput(
  editor: JWordCollaborationEditor & {
    readonly createTextAnchor: (input: JWordAwarenessTextAnchorRecord) => AnchorRef
  },
  input: JWordCollaborationAutoInsertRetryInput
): TextInserterRetryInput {
  if (input.range !== undefined) {
    return {
      range: resolveAutoInsertRange(editor, input.range),
      mode: 'replace'
    }
  }

  if (input.position !== undefined) {
    return {
      anchor: resolveAutoInsertAnchor(editor, input.position.anchor)
    }
  }

  return {}
}

/** 把公开 range 输入解析为 core opaque range。 */
function resolveAutoInsertRange(
  editor: JWordCollaborationEditor & {
    readonly createTextAnchor: (input: JWordAwarenessTextAnchorRecord) => AnchorRef
  },
  range: JWordCollaborationAutoInsertRange
): RangeRef {
  return createRangeRef(
    resolveAutoInsertAnchor(editor, range.anchor),
    resolveAutoInsertAnchor(editor, range.focus)
  )
}

/** 判断 editor 是否可直接接入 core createTextInserter。 */
function isInserterCapableEditor(editor: JWordCollaborationEditor): editor is JWordCollaborationEditor & Editor {
  return typeof editor.createTextAnchor === 'function' &&
    typeof editor.resolveTextPosition === 'function' &&
    typeof editor.executeCommand === 'function'
}

/** 把公开 position/range 输入解析为 core opaque anchor。 */
function resolveAutoInsertAnchor(
  editor: JWordCollaborationEditor & {
    readonly createTextAnchor: (input: JWordAwarenessTextAnchorRecord) => AnchorRef
  },
  anchor: JWordAwarenessTextAnchorRecord | AnchorRef | undefined
): AnchorRef {
  if (anchor === undefined) {
    throw new Error('Collaboration auto insert anchor is required.')
  }

  if (isAwarenessTextAnchorRecord(anchor)) {
    return editor.createTextAnchor(anchor)
  }

  return anchor
}

/** 判断输入是否是可序列化 awareness anchor snapshot。 */
function isAwarenessTextAnchorRecord(value: JWordAwarenessTextAnchorRecord | AnchorRef): value is JWordAwarenessTextAnchorRecord {
  return typeof (value as { readonly graphemeIndex?: unknown }).graphemeIndex === 'number'
}

/** 把 core auto insert error 转换为 collab 诊断。 */
function createAutoInsertErrorDiagnostic(event: TextInserterErrorEvent): JWordCollabDiagnostic {
  return createCollabDiagnostic(
    event.error.code.replace('AUTO_INSERTER_', 'COLLAB_AUTO_INSERTER_'),
    'error',
    event.error.message,
    event.error.recoverable
  )
}

/** 标记当前 SDK 已观察 core progress phase，避免未来误删 progress 事件接线。 */
function readAutoInsertProgressPhase(phase: TextInserterProgressPhase): TextInserterProgressPhase {
  return phase
}

/** 归一化自动插入虚拟 actor。 */
function normalizeAutoInsertActor(
  actor: JWordCollaborationAutoInsertActor | undefined,
  localUser: JWordAwarenessUser
): JWordCollaborationAutoInsertActor {
  if (actor !== undefined) {
    return actor
  }

  return {
    id: `${localUser.id}:auto-inserter`,
    name: 'AI Assistant',
    color: '#6f42c1'
  }
}

/** 校验初始化参数和授权，不读取 editor 文档内容。 */
function validateConnectionOptions(
  options: ConnectJWordCollaborationOptions
): readonly JWordCollabDiagnostic[] {
  const diagnostics: JWordCollabDiagnostic[] = []

  if (options.serverUrl.length === 0 || options.documentId.length === 0 || options.roomId.length === 0) {
    diagnostics.push(createCollabDiagnostic(
      'COLLAB_PROVIDER_UNAVAILABLE',
      'error',
      'Collaboration serverUrl, documentId and roomId are required.',
      true,
      options.user.id
    ))
  }

  if (options.user.id.length === 0 || options.user.name.length === 0) {
    diagnostics.push(createCollabDiagnostic(
      'COLLAB_AWARENESS_STALE',
      'warning',
      'Collaboration user id and name are required for presence.',
      true,
      options.user.id
    ))
  }

  for (const feature of options.features) {
    try {
      assertJWordFeatureEntitled(options.license, feature, options.licenseValidation)
    } catch (error) {
      diagnostics.push(createLicenseDiagnostic(error, options.user.id))
      break
    }
  }

  return diagnostics
}

interface RawCollaborationServerVersion {
  readonly protocolVersion?: unknown
  readonly packageVersion?: unknown
  readonly featureFlags?: unknown
  readonly minimumClientVersion?: unknown
  readonly minimumServerVersion?: unknown
}

/** 读取并校验服务端版本握手，失败时不连接 provider。 */
async function readCollaborationHandshake(
  options: ConnectJWordCollaborationOptions,
  clientId: string
): Promise<
  | { readonly ok: true, readonly handshake: JWordCollaborationHandshake }
  | { readonly ok: false, readonly diagnostic: JWordCollabDiagnostic }
> {
  try {
    const response = await fetch(createVersionEndpointUrl(options.serverUrl))
    const version = readServerVersion(await response.json() as RawCollaborationServerVersion)

    if (version === null) {
      return {
        ok: false,
        diagnostic: createVersionDiagnostic(
          'COLLAB_VERSION_MISMATCH',
          'Collaboration server returned an invalid version payload.',
          clientId
        )
      }
    }

    const clientPackageVersion = options.clientPackageVersion ?? JWORD_COLLAB_CLIENT_PACKAGE_VERSION
    const handshake: JWordCollaborationHandshake = {
      protocolVersion: version.protocolVersion,
      clientPackageVersion,
      serverPackageVersion: version.packageVersion,
      featureFlags: version.featureFlags,
      minimumClientVersion: version.minimumClientVersion,
      minimumServerVersion: version.minimumServerVersion
    }
    const diagnostic = validateHandshake(handshake, options, clientId)

    return diagnostic === null
      ? {
        ok: true,
        handshake
      }
      : {
        ok: false,
        diagnostic
      }
  } catch (error) {
    return {
      ok: false,
      diagnostic: createVersionDiagnostic(
        'COLLAB_SERVER_UNAVAILABLE',
        readErrorMessage(error),
        clientId
      )
    }
  }
}

/** 校验服务端版本、feature flags 和双方最低版本要求。 */
function validateHandshake(
  handshake: JWordCollaborationHandshake,
  options: ConnectJWordCollaborationOptions,
  clientId: string
): JWordCollabDiagnostic | null {
  if (handshake.protocolVersion !== JWORD_COLLAB_CLIENT_PROTOCOL_VERSION) {
    return createVersionDiagnostic(
      'COLLAB_PROTOCOL_MISMATCH',
      'Collaboration client and server protocol versions are incompatible.',
      clientId
    )
  }

  const minimumServerVersion = options.minimumServerVersion ?? '0.0.0'

  if (compareVersions(handshake.serverPackageVersion, minimumServerVersion) < 0) {
    return createVersionDiagnostic(
      'COLLAB_SERVER_TOO_OLD',
      'Collaboration server package version is below the client minimum.',
      clientId
    )
  }

  if (compareVersions(handshake.clientPackageVersion, handshake.minimumClientVersion) < 0) {
    return createVersionDiagnostic(
      'COLLAB_CLIENT_TOO_OLD',
      'Collaboration client package version is below the server minimum.',
      clientId
    )
  }

  const missingFeature = options.features.find((feature) => !handshake.featureFlags.includes(feature))

  if (missingFeature !== undefined) {
    return createVersionDiagnostic(
      'COLLAB_FEATURE_FLAGS_MISSING',
      `Collaboration server does not advertise required feature: ${missingFeature}.`,
      clientId
    )
  }

  return null
}

/** 把 HTTP 或 WebSocket 地址转换为 version endpoint。 */
function createVersionEndpointUrl(serverUrl: string): string {
  const url = new URL(serverUrl)

  if (url.protocol === 'ws:') {
    url.protocol = 'http:'
  } else if (url.protocol === 'wss:') {
    url.protocol = 'https:'
  }
  url.pathname = '/version'
  url.search = ''
  url.hash = ''

  return url.toString()
}

/** 读取服务端 version payload。 */
function readServerVersion(version: RawCollaborationServerVersion): {
  readonly protocolVersion: string
  readonly packageVersion: string
  readonly featureFlags: readonly string[]
  readonly minimumClientVersion: string
  readonly minimumServerVersion: string
} | null {
  if (
    typeof version.protocolVersion !== 'string' ||
    typeof version.packageVersion !== 'string' ||
    !Array.isArray(version.featureFlags) ||
    !version.featureFlags.every((feature) => typeof feature === 'string') ||
    typeof version.minimumClientVersion !== 'string' ||
    typeof version.minimumServerVersion !== 'string'
  ) {
    return null
  }

  return {
    protocolVersion: version.protocolVersion,
    packageVersion: version.packageVersion,
    featureFlags: version.featureFlags,
    minimumClientVersion: version.minimumClientVersion,
    minimumServerVersion: version.minimumServerVersion
  }
}

/** 比较简单 semver 数字版本，不支持预发布排序。 */
function compareVersions(left: string, right: string): number {
  const leftParts = readVersionParts(left)
  const rightParts = readVersionParts(right)
  const maxLength = Math.max(leftParts.length, rightParts.length)

  for (let index = 0; index < maxLength; index += 1) {
    const leftPart = leftParts[index] ?? 0
    const rightPart = rightParts[index] ?? 0

    if (leftPart !== rightPart) {
      return leftPart < rightPart ? -1 : 1
    }
  }

  return 0
}

/** 读取版本号数字段，非法段按 0 处理。 */
function readVersionParts(version: string): readonly number[] {
  return version.split('.').map((part) => {
    const value = Number.parseInt(part, 10)

    return Number.isFinite(value) ? value : 0
  })
}

/** 创建版本握手诊断。 */
function createVersionDiagnostic(
  code: string,
  message: string,
  clientId: string
): JWordCollabDiagnostic {
  return createCollabDiagnostic(
    code,
    'error',
    message,
    true,
    clientId
  )
}

/** 归一化公开用户，并为缺省 color 生成稳定值。 */
function normalizeCollaborationUser(
  user: JWordCollaborationUser
): JWordAwarenessUser & { readonly color: string } {
  return {
    id: user.id,
    name: user.name,
    color: user.color ?? createStableUserColor(user.id),
    ...(user.avatarUrl === undefined ? {} : { avatarUrl: user.avatarUrl })
  }
}

/** 创建本地 awareness state。 */
function createLocalAwarenessState(
  localUser: JWordAwarenessUser,
  input: JWordCollaborationPresenceInput
): JWordAwarenessState {
  const selectionLabel = readSelectionLabel(localUser, input)

  return {
    clientId: localUser.id,
    user: localUser,
    ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
    ...(input.rangeSnapshot === undefined ? {} : { rangeSnapshot: input.rangeSnapshot }),
    ...(input.viewport === undefined ? {} : { viewport: input.viewport }),
    ...(selectionLabel === undefined ? {} : { selectionLabel }),
    updatedAt: input.updatedAt ?? Date.now()
  }
}

/** 读取公开 selection 或 typing label。 */
function readSelectionLabel(
  localUser: JWordAwarenessUser,
  input: JWordCollaborationPresenceInput
): string | undefined {
  if (input.selectionLabel !== undefined) {
    return input.selectionLabel
  }

  return input.typing === true ? `${localUser.name} 正在输入` : undefined
}

/** 为未显式配置颜色的用户生成稳定颜色。 */
function createStableUserColor(userId: string): string {
  let hash = 0

  for (const character of userId) {
    hash = ((hash << 5) - hash + character.charCodeAt(0)) >>> 0
  }

  const color = hash & 0xffffff

  return `#${color.toString(16).padStart(6, '0')}`
}
