/**
 * 职责：提供 examples/collab 的真实 Hocuspocus 浏览器 runtime。
 * 边界：只连接 @4xian/jword-collab provider、IndexedDB offline adapter 与页面 debug 契约，不实现生产鉴权或 core 内部 store。
 * 协作：main.ts 根据 URL query 选择本 runtime，examples/collab/server 提供本地 Hocuspocus 服务。
 * 约束：所有协同正文来自同一个 Y.Doc；未实现能力用显式 no-op 状态暴露，不伪装离线或历史闭环完成。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import { connectJWordCollaboration } from '@4xian/jword-collab'
import { createHocuspocusCollabProviderAdapter } from '@4xian/jword-collab/experimental'
import type {
  JWordAwarenessRangeSnapshot,
  JWordCollabProviderAdapter,
  JWordCollabProviderError
} from '@4xian/jword-collab'
import { createIndexedDbOfflineAdapter } from '@4xian/jword-persistence'
import type { JWordPersistenceDiagnostic } from '@4xian/jword-persistence'
import {
  createDocumentProjection,
  readEditorSharedDocument,
  refreshEditorSharedDocument
} from '@4xian/jword-core'
import type { DocumentProjection, Editor, EditorSharedDocument } from '@4xian/jword-core'
import type { JWordCollaborationConnection } from '@4xian/jword-collab'
import * as Y from 'yjs'

import {
  createHocuspocusAwarenessRangeSnapshot,
  mapHocuspocusAwarenessUserSnapshot,
  syncHocuspocusAwarenessText
} from './hocuspocus-awareness'
import {
  applyHocuspocusCommentRange,
  readHocuspocusCommentRanges
} from './hocuspocus-comments'
import {
  applyHocuspocusBoldRange,
  readHocuspocusTextFormatRanges
} from './hocuspocus-format'
import {
  readFirstTextPosition,
  readProjectionText
} from './hocuspocus-projection'
import {
  readHocuspocusVersionHistory
} from './hocuspocus-history'
import { createHocuspocusHistoryRuntimeBridge } from './hocuspocus-history-bridge'
import { createHocuspocusServerHistoryClient } from './hocuspocus-server-history'
import { createHocuspocusAutoInsertController } from './hocuspocus-auto-insert'
import { mapPersistenceDiagnostic } from './hocuspocus-offline-diagnostics'
import { buildHocuspocusTextCommand } from './hocuspocus-text-command'
import {
  isEditorManagedTransactionOrigin,
  readExternalTransactionOrigin,
  readExternalTransactionSource
} from './hocuspocus-transaction-origin'
import { buildReconnectConflictText } from './hocuspocus-reconnect-merge'
import {
  createHocuspocusClientSnapshots,
  createHocuspocusCurrentUser,
  createHocuspocusOfflineStateSnapshot,
  defaultDocumentId,
  demoAutoInsertIntervalMs,
  providerAutoInsertTokens,
  readHocuspocusClientColor,
  readHocuspocusClientName,
  readSdkCollaborationFeatures,
  reconnectFailureTimeoutMs,
  shouldDeferAutoInsertForTransaction,
  type HocuspocusDemoClientId,
  type HocuspocusDemoRuntimeOptions,
  type MutableProviderState
} from './hocuspocus-runtime-helpers'
import type {
  AwarenessStateSnapshot,
  CollabDemoRuntime,
  CollabRuntimeListener,
  CollabStateSnapshot,
  DocxImportAcceptanceSnapshot,
  OfflineDiagnosticSnapshot,
  OfflineStateSnapshot,
  VersionHistoryEntry,
  VersionPreviewSnapshot
} from '../runtime'

export type { HocuspocusDemoClientId, HocuspocusDemoRuntimeOptions } from './hocuspocus-runtime-helpers'

/** 创建真实 Hocuspocus 浏览器 runtime。 */
export function createHocuspocusDemoRuntime(
  options: HocuspocusDemoRuntimeOptions
): CollabDemoRuntime {
  const documentId = options.documentId ?? defaultDocumentId
  const currentUser = createHocuspocusCurrentUser(options)
  const sharedDocument = options.sharedDocument
  const document = readEditorSharedDocument(sharedDocument)
  const editor = options.editor
  const awarenessText = document.getText('body')
  const listeners = new Set<CollabRuntimeListener>()
  let reconnectBaselineClearTimer: ReturnType<typeof setTimeout> | null = null
  let reconnectFailureTimer: ReturnType<typeof setTimeout> | null = null
  let autoInsertPollTimer: ReturnType<typeof setInterval> | null = null
  let connection: JWordCollaborationConnection | null = null
  const providerState: MutableProviderState = {
    status: 'connecting',
    connected: false,
    revision: 1,
    queuedOperations: 0,
    offlineLastEvent: null,
    reconnectBaselineText: null,
    offlineBaseText: null,
    pendingLocalText: null,
    offlineDiagnostics: []
  }
  const adapter = createHocuspocusCollabProviderAdapter({
    document,
    documentId,
    roomId: options.roomId,
    clientId: options.clientId,
    webSocketUrl: options.webSocketUrl,
    autoConnect: false,
    ...(options.token === undefined ? {} : { token: options.token })
  })
  const offlineAdapter = options.offline === 'indexeddb'
    ? createIndexedDbOfflineAdapter({
        document,
        documentId,
        roomId: options.roomId
      })
    : undefined
  const historyRuntime = createHocuspocusHistoryRuntimeBridge({
    document,
    documentId,
    roomId: options.roomId,
    clientId: options.clientId,
    authorId: options.clientId,
    readLiveText: readEditorText,
    readCollabState,
    storeCurrentUpdate,
    recordDiagnostics: recordPersistenceDiagnostics,
    notify
  })
  const serverHistory = options.historyApiUrl === undefined
    ? null
    : createHocuspocusServerHistoryClient({
        historyApiUrl: options.historyApiUrl,
        documentId,
        roomId: options.roomId,
        clientId: options.clientId,
        authorId: options.clientId,
        notify,
        recordDiagnostics: recordPersistenceDiagnostics
      })
  const autoInsertController = createHocuspocusAutoInsertController({
    tokens: providerAutoInsertTokens,
    userEditIdleDelayMs: demoAutoInsertIntervalMs,
    ensureEditorForWrite,
    readConnection: () => connection,
    isProviderConnected: () => providerState.connected,
    markOfflinePending() {
      providerState.queuedOperations += 1
      providerState.offlineLastEvent = 'offline-local-pending'
    },
    storeCurrentUpdate,
    recordHistoryVersion,
    notify
  })

  void connectThroughJWordCollaborationSdk(adapter).then((sdkConnection) => {
    connection = sdkConnection
    applySdkConnectionState()
    notify()
  }).catch((error: unknown) => {
    recordProviderError({
      code: 'COLLAB_PROVIDER_UNAVAILABLE',
      message: error instanceof Error ? error.message : String(error),
      recoverable: true
    })
  })

  if (offlineAdapter !== undefined) {
    void offlineAdapter.whenSynced.then(() => {
      recordOfflineDiagnostic({
        code: 'OFFLINE_CACHE_SYNCED',
        severity: 'info',
        recoverable: true,
        message: 'IndexedDB offline cache is synced with the local Y.Doc.'
      })
      providerState.revision += 1
      notify()
    })
  }

  /** 按第三方集成口径连接 JWord 协作 SDK。 */
  async function connectThroughJWordCollaborationSdk(
    provider: JWordCollabProviderAdapter
  ): Promise<JWordCollaborationConnection> {
    return connectJWordCollaboration(editor, {
      serverUrl: options.serverUrl ?? options.webSocketUrl,
      documentId,
      roomId: options.roomId,
      user: currentUser,
      token: options.token ?? 'collab-demo-token',
      license: options.license ?? null,
      features: readSdkCollaborationFeatures(options.features),
      provider
    })
  }

  /** 将公开 SDK connection 状态归并到 demo debug 面板。 */
  function applySdkConnectionState(): void {
    if (connection === null) {
      return
    }

    providerState.status = connection.status
    providerState.connected = connection.status === 'connected' || connection.status === 'synced'
    for (const diagnostic of connection.diagnostics) {
      recordOfflineDiagnostic({
        code: diagnostic.code,
        severity: diagnostic.severity,
        recoverable: diagnostic.recoverable,
        message: diagnostic.message
      })
    }
  }

  adapter.onStatusChange((status) => {
    providerState.status = status
    providerState.connected = status === 'connected' || status === 'synced'
    if (status === 'synced' && (
      providerState.queuedOperations > 0 ||
      providerState.offlineLastEvent === 'offline-reconnect-started'
    )) {
      markReconnectSynced()
      return
    }
    notify()
  })
  adapter.onSynced(() => {
    providerState.status = 'synced'
    providerState.connected = true
    if (providerState.queuedOperations > 0 || providerState.offlineLastEvent === 'offline-reconnect-started') {
      markReconnectSynced()
      return
    }
    notify()
  })
  adapter.onError((error) => {
    recordProviderError(error)
  })
  document.on('afterTransaction', handleDocumentTransaction)
  /** 响应共享 Y.Doc 事务，刷新 demo revision 和重连诊断。 */
  function handleDocumentTransaction(transaction: Y.Transaction): void {
    providerState.revision += 1
    if (shouldDeferAutoInsertForTransaction(transaction)) {
      autoInsertController.deferNextFlushForUserEdit()
    }
    refreshEditorAfterExternalTransaction(transaction)
    syncHocuspocusAwarenessText(awarenessText, readEditorText())
    recordReconnectConflictIfNeeded(transaction.local)
    notify()
  }
  const unsubscribeAwareness = adapter.awareness.onChange(() => {
    notify()
  })

  /** 通知页面刷新。 */
  function notify(): void {
    for (const listener of listeners) {
      listener()
    }
  }

  /** 清理 demo 层自动插入轮询定时器。 */
  function clearAutoInsertPollTimer(): void {
    if (autoInsertPollTimer === null) {
      return
    }

    clearInterval(autoInsertPollTimer)
    autoInsertPollTimer = null
  }

  /** 启动 demo 层 1s 轮询，每次轮询只触发一段自动插入。 */
  function startAutoInsertPolling(input?: import('../runtime').AutoInsertStartInput) {
    const snapshot = autoInsertController.start(input)

    if (autoInsertPollTimer === null && snapshot.running) {
      autoInsertPollTimer = setInterval(() => {
        const nextSnapshot = autoInsertController.flushNext()

        if (!nextSnapshot.running) {
          clearAutoInsertPollTimer()
        }
      }, demoAutoInsertIntervalMs)
    }

    return snapshot
  }

  /** 中止自动插入并停止 demo 层轮询。 */
  function abortAutoInsertPolling() {
    clearAutoInsertPollTimer()

    return autoInsertController.abort()
  }

  /** 重试自动插入并重新启动 demo 层轮询。 */
  function retryAutoInsertPolling(input?: import('../runtime').AutoInsertStartInput) {
    clearAutoInsertPollTimer()
    const snapshot = autoInsertController.retry(input)

    if (snapshot.running) {
      autoInsertPollTimer = setInterval(() => {
        const nextSnapshot = autoInsertController.flushNext()

        if (!nextSnapshot.running) {
          clearAutoInsertPollTimer()
        }
      }, demoAutoInsertIntervalMs)
    }

    return snapshot
  }

  /** 读取协同文档状态快照。 */
  function readCollabState(): CollabStateSnapshot {
    return {
      providerMode: 'hocuspocus',
      clients: createHocuspocusClientSnapshots(readEditorText(), providerState.revision),
      autoInsert: autoInsertController.readSnapshot()
    }
  }

  /** 读取真实 provider awareness 的 debug 快照。 */
  function readAwarenessState(): AwarenessStateSnapshot {
    if (providerState.status === 'error') {
      return {
        users: []
      }
    }

    const now = Date.now()
    const currentText = readEditorText()

    return {
      users: readSdkAwarenessStates().map((state) => mapHocuspocusAwarenessUserSnapshot({
        state,
        document,
        currentText,
        now
      }))
    }
  }

  /** 从 SDK connection 优先读取 awareness，连接前回退到底层 provider。 */
  function readSdkAwarenessStates() {
    return connection === null
      ? adapter.awareness.getStates()
      : [
          ...(connection.awareness.localState === undefined ? [] : [connection.awareness.localState]),
          ...connection.awareness.remoteStates
        ]
  }

  /** 读取在线状态快照。 */
  function readOfflineState(): OfflineStateSnapshot {
    if (offlineAdapter !== undefined) {
      const offlineState = offlineAdapter.readState()

      return createHocuspocusOfflineStateSnapshot({
        providerState,
        offlineState,
        offlineDiagnostics: offlineState.diagnostics.map(mapPersistenceDiagnostic)
      })
    }

    return createHocuspocusOfflineStateSnapshot({ providerState })
  }

  /** 读取真实 provider 模式下跟随 Y.Doc 同步的版本历史索引。 */
  function readVersionHistory(): readonly VersionHistoryEntry[] {
    if (serverHistory !== null) {
      return serverHistory.readVersionHistory(createLiveVersionHistoryEntry())
    }

    return readHocuspocusVersionHistory(document, createLiveVersionHistoryEntry())
  }

  /** 创建没有本地历史记录前的 live 占位版本。 */
  function createLiveVersionHistoryEntry(): VersionHistoryEntry {
    return {
      id: 'provider-live',
      label: 'Hocuspocus live document',
      revision: providerState.revision,
      text: readEditorText()
    }
  }

  /** 写入当前页面对应 client 的正文，必须走 Editor transaction pipeline。 */
  function updateClientText(clientId: string, nextText: string, previousText?: string): CollabStateSnapshot {
    if (clientId !== options.clientId) {
      return readCollabState()
    }

    replaceEditorText(nextText, previousText)
    if (!providerState.connected) {
      providerState.queuedOperations += 1
      providerState.offlineLastEvent = 'offline-local-pending'
      providerState.offlineBaseText ??= previousText ?? ''
      providerState.pendingLocalText = nextText
      recordOfflineDiagnostic({
        code: 'OFFLINE_LOCAL_UPDATE_QUEUED',
        severity: 'info',
        recoverable: true,
        message: 'Local update is queued while the provider is disconnected.'
      })
    }
    void offlineAdapter?.storeUpdate({
      documentId,
      update: Y.encodeStateAsUpdate(document)
    }).then(() => {
      notify()
    })
    recordHistoryVersion(`${readHocuspocusClientName(clientId, currentUser)} edit`, 'local-user')

    return readCollabState()
  }

  /** 记录一条离线诊断，避免同一 code 重复刷屏。 */
  function recordOfflineDiagnostic(diagnostic: OfflineDiagnosticSnapshot): void {
    if (providerState.offlineDiagnostics.some((candidate) => candidate.code === diagnostic.code)) {
      return
    }

    providerState.offlineDiagnostics.push(diagnostic)
  }

  /** 记录 provider 错误并暴露给 demo debug 离线面板。 */
  function recordProviderError(providerError: JWordCollabProviderError): void {
    providerState.status = 'error'
    providerState.connected = false
    providerState.offlineLastEvent = 'provider-error'
    recordOfflineDiagnostic({
      code: providerError.code,
      severity: 'error',
      recoverable: providerError.recoverable,
      message: providerError.message
    })
    notify()
  }

  /** 完成一次重连 flush 状态。 */
  function markReconnectSynced(): void {
    clearReconnectFailureTimer()
    providerState.queuedOperations = 0
    providerState.offlineLastEvent = 'offline-reconnect-synced'
    recordOfflineDiagnostic({
      code: 'OFFLINE_RECONNECT_SYNCED',
      severity: 'info',
      recoverable: true,
      message: 'Queued local updates were synced after provider reconnect.'
    })
    scheduleReconnectBaselineClear()
    notify()
  }

  /** 如果重连期间合入了远端更新，记录一次合并诊断。 */
  function recordReconnectConflictIfNeeded(isLocalTransaction: boolean): void {
    if (isLocalTransaction || providerState.reconnectBaselineText === null) {
      return
    }

    const baselineText = providerState.reconnectBaselineText
    const offlineBaseText = providerState.offlineBaseText
    const pendingLocalText = providerState.pendingLocalText

    clearReconnectBaseline()
    if (readEditorText() === baselineText) {
      return
    }

    if (offlineBaseText !== null && pendingLocalText !== null) {
      scheduleReconnectConflictResolution(offlineBaseText, pendingLocalText)
    }

    recordOfflineDiagnostic({
      code: 'OFFLINE_RECONNECT_CONFLICT_MERGED',
      severity: 'warning',
      recoverable: true,
      message: 'Local offline updates and remote provider updates were merged during reconnect.'
    })
  }

  /** 设置重连前本地正文基线，供后续远端 transaction 判断是否发生合并。 */
  function setReconnectBaseline(nextBaselineText: string | null): void {
    clearReconnectBaselineTimer()
    providerState.reconnectBaselineText = nextBaselineText
  }

  /** 清理重连基线和延迟清理任务。 */
  function clearReconnectBaseline(): void {
    clearReconnectBaselineTimer()
    providerState.reconnectBaselineText = null
  }

  /** 清理已有的重连基线延迟任务。 */
  function clearReconnectBaselineTimer(): void {
    if (reconnectBaselineClearTimer === null) {
      return
    }

    clearTimeout(reconnectBaselineClearTimer)
    reconnectBaselineClearTimer = null
  }

  /** 重连完成后保留短暂窗口，等待 provider 后续远端 transaction。 */
  function scheduleReconnectBaselineClear(): void {
    if (providerState.reconnectBaselineText === null) {
      return
    }

    clearReconnectBaselineTimer()
    reconnectBaselineClearTimer = setTimeout(() => {
      reconnectBaselineClearTimer = null
      providerState.reconnectBaselineText = null
      clearPendingLocalMergeState()
    }, 3000)
  }

  /** 启动重连失败兜底，防止 WebSocket connect 长时间悬挂。 */
  function scheduleReconnectFailureTimer(): void {
    clearReconnectFailureTimer()
    reconnectFailureTimer = setTimeout(() => {
      reconnectFailureTimer = null
      if (providerState.connected || providerState.offlineLastEvent !== 'offline-reconnect-started') {
        return
      }

      markReconnectFailed()
    }, reconnectFailureTimeoutMs)
  }

  /** 清理已有的重连失败兜底任务。 */
  function clearReconnectFailureTimer(): void {
    if (reconnectFailureTimer === null) {
      return
    }

    clearTimeout(reconnectFailureTimer)
    reconnectFailureTimer = null
  }

  /** 标记重连失败并保留本地待同步更新。 */
  function markReconnectFailed(): void {
    clearReconnectBaseline()
    providerState.status = 'disconnected'
    providerState.connected = false
    providerState.offlineLastEvent = 'offline-reconnect-failed'
    recordOfflineDiagnostic({
      code: 'OFFLINE_RECONNECT_FAILED',
      severity: 'error',
      recoverable: true,
      message: 'Provider reconnect failed and local updates remain queued.'
    })
    notify()
  }

  /** 将当前 Y.Doc state update 保存到 provider 同步的历史索引。 */
  function recordHistoryVersion(label: string, origin: string): void {
    if (serverHistory !== null) {
      void serverHistory.recordVersion(label, origin, Y.encodeStateAsUpdate(document)).then(() => {
        notify()
      })
      return
    }

    historyRuntime.recordVersion(label, origin)
  }

  /** 将当前 provider 文档写入离线缓存。 */
  function storeCurrentUpdate(): void {
    void offlineAdapter?.storeUpdate({
      documentId,
      update: Y.encodeStateAsUpdate(document)
    }).then(() => {
      notify()
    })
  }

  /** 把 provider history adapter 诊断暴露到 demo offline diagnostics。 */
  function recordPersistenceDiagnostics(diagnostics: readonly JWordPersistenceDiagnostic[]): void {
    for (const diagnostic of diagnostics) {
      recordOfflineDiagnostic(mapPersistenceDiagnostic(diagnostic))
    }
  }

  /** 判断当前页面是否还有未同步的本地离线更新。 */
  function hasPendingLocalUpdates(): boolean {
    return providerState.queuedOperations > 0 ||
      providerState.offlineLastEvent === 'offline-local-pending' ||
      providerState.offlineLastEvent === 'offline-reconnect-started'
  }

  /** 阻止版本恢复覆盖未同步的本地更新。 */
  function blockRestoreWithPendingLocalUpdates(): void {
    providerState.offlineLastEvent = 'restore-conflict-local-pending'
    recordOfflineDiagnostic({
      code: 'COLLAB_RESTORE_CONFLICT_RESOLVED',
      severity: 'warning',
      recoverable: true,
      message: 'Version restore was blocked because local offline updates are still pending.'
    })
    notify()
  }

  /** 更新当前 client 的 awareness 光标。 */
  function updateClientSelection(
    clientId: string,
    selectionStart: number,
    selectionEnd: number
  ): AwarenessStateSnapshot {
    if (clientId !== options.clientId) {
      return readAwarenessState()
    }
    if (providerState.status === 'error') {
      return readAwarenessState()
    }

    const presenceInput = {
      cursor: {
        anchor: {
          blockId: 'body',
          offset: selectionStart
        },
        focus: {
          blockId: 'body',
          offset: selectionEnd
        }
      },
      rangeSnapshot: createHocuspocusAwarenessRangeSnapshot({
        awarenessText,
        documentId,
        clientId,
        selectionStart,
        selectionEnd
      }),
      viewport: {
        pageIndex: 0
      },
      selectionLabel: `${readHocuspocusClientName(clientId, currentUser)} 正在输入`,
      updatedAt: Date.now()
    }

    if (connection === null) {
      adapter.awareness.setLocalState({
        clientId,
        user: {
          id: currentUser.id,
          name: readHocuspocusClientName(clientId, currentUser),
          color: readHocuspocusClientColor(clientId, currentUser)
        },
        ...presenceInput
      })
    } else {
      connection.awareness.setLocalPresence(presenceInput)
    }
    notify()

    return readAwarenessState()
  }

  return {
    readCollabState,
    readAwarenessState,
    readOfflineState,
    readVersionHistory,
    readTextFormatRanges() {
      return readHocuspocusTextFormatRanges(readCurrentProjection())
    },
    readCommentRanges() {
      return readHocuspocusCommentRanges(ensureEditorForWrite(), readCurrentProjection())
    },
    startAutoInsert: startAutoInsertPolling,
    abortAutoInsert: abortAutoInsertPolling,
    retryAutoInsert: retryAutoInsertPolling,
    simulateDisconnect() {
      void connection?.disconnect()
      clearReconnectFailureTimer()
      providerState.status = 'disconnected'
      providerState.connected = false
      providerState.offlineLastEvent = 'offline-disconnected'
      providerState.offlineBaseText = readEditorText()
      providerState.pendingLocalText = null
      notify()
      return readOfflineState()
    },
    simulateReconnect() {
      providerState.status = 'connecting'
      providerState.offlineLastEvent = 'offline-reconnect-started'
      setReconnectBaseline(providerState.queuedOperations > 0 ? readEditorText() : null)
      recordOfflineDiagnostic({
        code: 'OFFLINE_RECONNECT_STARTED',
        severity: 'info',
        recoverable: true,
        message: 'Provider reconnect started with local offline updates preserved.'
      })
      scheduleReconnectFailureTimer()
      void connectThroughJWordCollaborationSdk(adapter).then((sdkConnection) => {
        connection = sdkConnection
        applySdkConnectionState()
        if (providerState.connected) {
          markReconnectSynced()
          return
        }
        notify()
      }).catch(() => {
        markReconnectFailed()
      })
      notify()
      return readOfflineState()
    },
    undoLocalUserEdit,
    formatClientRange,
    addCommentRange,
    importDocxForCollabAcceptance,
    updateClientText,
    updateClientSelection,
    previewVersion(versionId: string) {
      return serverHistory === null
        ? historyRuntime.previewVersion(versionId)
        : serverHistory.previewVersion(versionId)
    },
    async restoreVersion(versionId: string): Promise<CollabStateSnapshot> {
      if (versionId !== 'provider-live') {
        if (hasPendingLocalUpdates()) {
          blockRestoreWithPendingLocalUpdates()
          return readCollabState()
        }
      }

      if (serverHistory !== null) {
        const restored = await serverHistory.restoreVersion(versionId, document)

        if (restored) {
          storeCurrentUpdate()
          syncHocuspocusAwarenessText(awarenessText, readEditorText())
          notify()
        }

        return readCollabState()
      }

      return historyRuntime.restoreVersion(versionId)
    },
    subscribe(listener) {
      listeners.add(listener)

      return () => {
        listeners.delete(listener)
      }
    },
    destroy() {
      listeners.clear()
      clearReconnectBaselineTimer()
      clearReconnectFailureTimer()
      clearAutoInsertPollTimer()
      autoInsertController.destroy()
      unsubscribeAwareness()
      void offlineAdapter?.destroy()
      void connection?.destroy()
      document.off('afterTransaction', handleDocumentTransaction)
    }
  }

  /** 读取当前共享 Y.Doc 派生出的正文文本。 */
  function readEditorText(): string {
    const projection = readCurrentProjection()

    return projection === null ? '' : readProjectionText(projection)
  }

  /** 读取当前共享 Y.Doc projection；无 schema 时返回 null。 */
  function readCurrentProjection(): DocumentProjection | null {
    try {
      return createDocumentProjection(document)
    } catch {
      return null
    }
  }

  /** 复用当前内部 Editor，保留本地用户 undo 栈。 */
  function ensureEditorForWrite(): Editor {
    return editor
  }

  /** 撤销当前页面的本地用户输入，远端事务默认不在用户 undo 栈中。 */
  function undoLocalUserEdit(): CollabStateSnapshot {
    const activeEditor = ensureEditorForWrite()
    const result = activeEditor.undo()

    if (result.stackItem !== null) {
      if (!providerState.connected) {
        providerState.queuedOperations += 1
        providerState.offlineLastEvent = 'offline-local-pending'
      }
      void offlineAdapter?.storeUpdate({
        documentId,
        update: Y.encodeStateAsUpdate(document)
      }).then(() => {
        notify()
      })
      recordHistoryVersion(`${readHocuspocusClientName(options.clientId, currentUser)} undo`, 'local-user')
    }
    notify()

    return readCollabState()
  }

  /** 对当前页面对应 client 的正文范围应用加粗格式。 */
  function formatClientRange(clientId: string, start: number, end: number): CollabStateSnapshot {
    if (clientId !== options.clientId) {
      return readCollabState()
    }

    const activeEditor = ensureEditorForWrite()

    if (!applyHocuspocusBoldRange(activeEditor, start, end, {
      roomId: options.roomId,
      clientId: options.clientId,
      authorId: options.clientId
    })) {
      return readCollabState()
    }

    if (!providerState.connected) {
      providerState.queuedOperations += 1
      providerState.offlineLastEvent = 'offline-local-pending'
    }
    void offlineAdapter?.storeUpdate({
      documentId,
      update: Y.encodeStateAsUpdate(document)
    }).then(() => {
      notify()
    })
    recordHistoryVersion(`${readHocuspocusClientName(clientId, currentUser)} format`, 'local-user')
    notify()

    return readCollabState()
  }

  /** 对当前页面对应 client 的正文范围创建批注。 */
  function addCommentRange(
    clientId: string,
    start: number,
    end: number,
    text: string
  ) {
    if (clientId !== options.clientId) {
      return {
        threadId: null
      }
    }

    const result = applyHocuspocusCommentRange(
      ensureEditorForWrite(),
      start,
      end,
      text,
      clientId
    )

    if (result.threadId === null) {
      return result
    }

    if (!providerState.connected) {
      providerState.queuedOperations += 1
      providerState.offlineLastEvent = 'offline-local-pending'
    }
    void offlineAdapter?.storeUpdate({
      documentId,
      update: Y.encodeStateAsUpdate(document)
    }).then(() => {
      notify()
    })
    recordHistoryVersion(`${readHocuspocusClientName(clientId, currentUser)} comment`, 'local-user')
    notify()

    return result
  }

  /** 将 DOCX fixture 导入同一 provider Y.Doc，供 Gate 6 真实协同验收使用。 */
  async function importDocxForCollabAcceptance(
    bytes: readonly number[],
    fileName?: string
  ): Promise<DocxImportAcceptanceSnapshot> {
    const {
      convertDocxImportDocumentToCoreDocument,
      importDocx
    } = await import('@4xian/jword-docx')
    const result = await importDocx(new Uint8Array(bytes), {
      requestId: `${documentId}-docx-collab-acceptance`,
      ...(options.license === undefined ? {} : { license: options.license })
    })
    const activeEditor = ensureEditorForWrite()
    const importedDocument = convertDocxImportDocumentToCoreDocument(result.document)

    activeEditor.loadDocumentModel({ document: importedDocument })
    syncHocuspocusAwarenessText(awarenessText, readEditorText())
    void offlineAdapter?.storeUpdate({
      documentId,
      update: Y.encodeStateAsUpdate(document)
    }).then(() => {
      notify()
    })
    recordHistoryVersion(`DOCX import ${fileName ?? 'fixture.docx'}`, 'docx-import')

    return {
      text: readEditorText(),
      warnings: result.warnings.map((warning) => warning.code),
      ...(fileName === undefined ? {} : { fileName })
    }
  }

  /** 使用 Editor.executeCommand 更新 demo 正文。 */
  function replaceEditorText(nextText: string, previousText: string | undefined, origin = 'local-user'): void {
    const activeEditor = ensureEditorForWrite()
    const projection = activeEditor.getProjection()
    const currentText = readProjectionText(projection)
    const baselineText = previousText ?? currentText

    if (baselineText === nextText) {
      return
    }

    activeEditor.executeCommand(buildHocuspocusTextCommand({
      projection,
      currentText,
      previousText: baselineText,
      nextText,
      readPosition: readFirstTextPosition
    }), {
      origin,
      roomId: options.roomId,
      clientId: options.clientId,
      authorId: options.clientId
    })
  }

  /** 延迟应用重连冲突修复，避免在 Yjs afterTransaction 回调内嵌套写入。 */
  function scheduleReconnectConflictResolution(offlineBaseText: string, pendingLocalText: string): void {
    queueMicrotask(() => {
      const currentText = readEditorText()
      const resolvedText = buildReconnectConflictText(offlineBaseText, pendingLocalText, currentText)

      if (resolvedText === null || resolvedText === currentText) {
        clearPendingLocalMergeState()
        return
      }

      replaceEditorText(resolvedText, currentText, 'system-recovery')
      void offlineAdapter?.storeUpdate({
        documentId,
        update: Y.encodeStateAsUpdate(document)
      }).then(() => {
        notify()
      })
      recordHistoryVersion('Reconnect conflict merge', 'system-recovery')
      clearPendingLocalMergeState()
      notify()
    })
  }

  /** 清理已完成同步窗口中的 pending 本地合并状态。 */
  function clearPendingLocalMergeState(): void {
    providerState.offlineBaseText = null
    providerState.pendingLocalText = null
  }

  /** 外部 provider/offline/version 事务到来时刷新现有 Editor 投影，不重建 history。 */
  function refreshEditorAfterExternalTransaction(transaction: Y.Transaction): void {
    if (isEditorManagedTransactionOrigin(transaction.origin)) {
      return
    }

    const origin = readExternalTransactionOrigin(transaction)

    refreshEditorSharedDocument(sharedDocument, {
      origin,
      source: readExternalTransactionSource(transaction, origin)
    })
  }
}
