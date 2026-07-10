/**
 * 职责：提供 Gate 6 collab demo 的纯内存 runtime 和 debug API。
 * 边界：只模拟两端文档、awareness、offline、version history 和 auto insert 状态，不实现真实网络协同。
 * 协作：examples/collab/src/main.ts 和 Playwright smoke 测试。
 * 约束：所有状态留在 demo host，不写入 core，不声明 Hocuspocus、双窗口或真实离线同步完成。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import type { JWordAwarenessRangeSnapshot } from '@4xian/jword-collab'

export { createPresenceDisplayUsers, sortAwarenessUsers } from './awareness-order'
export type { CreatePresenceDisplayUsersOptions, PresenceDisplayUser } from './awareness-order'

export interface CollabClientSnapshot {
  readonly id: string
  readonly name: string
  readonly text: string
  readonly revision: number
}

export interface CollabStateSnapshot {
  readonly providerMode?: 'memory' | 'hocuspocus'
  readonly clients: readonly CollabClientSnapshot[]
  readonly autoInsert: AutoInsertSnapshot
}

export interface AwarenessUserSnapshot {
  readonly clientId: string
  readonly name: string
  readonly color: string
  readonly cursorOffset: number
  readonly selectionStart: number
  readonly selectionEnd: number
  readonly selectionText?: string
  readonly selectionLabel?: string
  readonly rangeSnapshot?: JWordAwarenessRangeSnapshot
  readonly viewport?: AwarenessViewportSnapshot
  readonly connected: boolean
  readonly updatedAt?: number
}

export interface AwarenessViewportSnapshot {
  readonly pageIndex: number
}

export interface AwarenessStateSnapshot {
  readonly users: readonly AwarenessUserSnapshot[]
}

export interface OfflineStateSnapshot {
  readonly connected: boolean
  readonly queuedOperations: number
  readonly lastEvent: string
  readonly databaseName?: string
  readonly updateByteLength?: number
  readonly diagnostics?: readonly OfflineDiagnosticSnapshot[]
}

export interface OfflineDiagnosticSnapshot {
  readonly code: string
  readonly severity: 'info' | 'warning' | 'error'
  readonly recoverable: boolean
  readonly message: string
}

export interface VersionHistoryEntry {
  readonly id: string
  readonly label: string
  readonly revision: number
  readonly text: string
}

export interface VersionPreviewSnapshot {
  readonly id: string
  readonly label: string
  readonly text: string
}

export interface DocxImportAcceptanceSnapshot {
  readonly text: string
  readonly warnings: readonly string[]
  readonly fileName?: string
}

export interface AutoInsertSnapshot {
  readonly running: boolean
  readonly insertedCount: number
  readonly lastToken: string | null
  readonly lastEvent: string
  readonly diagnostics: readonly AutoInsertDiagnosticSnapshot[]
}

export interface AutoInsertStartInput {
  readonly tokens?: readonly string[]
  readonly rangeStart?: number
  readonly rangeEnd?: number
}

export interface AutoInsertDiagnosticSnapshot {
  readonly code: string
  readonly severity: 'info' | 'warning' | 'error'
  readonly recoverable: boolean
  readonly message: string
}

export interface TextFormatRangeSnapshot {
  readonly text: string
  readonly start: number
  readonly end: number
  readonly bold: boolean
}

export interface CommentRangeCreateSnapshot {
  readonly threadId: string | null
}

export interface CommentRangeSnapshot {
  readonly threadId: string
  readonly text: string
  readonly start: number
  readonly end: number
  readonly resolved: boolean
}

export interface CollabDemoDebugApi {
  readonly focusEditor?: () => void
  readonly readCollabState: () => CollabStateSnapshot
  readonly readAwarenessState: () => AwarenessStateSnapshot
  readonly readOfflineState: () => OfflineStateSnapshot
  readonly readVersionHistory: () => readonly VersionHistoryEntry[]
  readonly readTextFormatRanges: () => readonly TextFormatRangeSnapshot[]
  readonly readCommentRanges: () => readonly CommentRangeSnapshot[]
  readonly startAutoInsert: (input?: AutoInsertStartInput) => AutoInsertSnapshot
  readonly abortAutoInsert: () => AutoInsertSnapshot
  readonly retryAutoInsert: (input?: AutoInsertStartInput) => AutoInsertSnapshot
  readonly simulateDisconnect: () => OfflineStateSnapshot
  readonly simulateReconnect: () => OfflineStateSnapshot
  readonly undoLocalUserEdit: () => CollabStateSnapshot
  readonly updateClientText: (clientId: string, text: string, previousText?: string) => CollabStateSnapshot
  readonly updateClientSelection: (clientId: string, selectionStart: number, selectionEnd: number) => AwarenessStateSnapshot
  readonly formatClientRange: (clientId: string, start: number, end: number) => CollabStateSnapshot
  readonly addCommentRange: (clientId: string, start: number, end: number, text: string) => CommentRangeCreateSnapshot
  readonly importDocxForCollabAcceptance: (
    bytes: readonly number[],
    fileName?: string
  ) => Promise<DocxImportAcceptanceSnapshot>
}

export interface CollabDemoRuntime extends CollabDemoDebugApi {
  readonly subscribe: (listener: CollabRuntimeListener) => () => void
  readonly updateClientText: (clientId: string, text: string, previousText?: string) => CollabStateSnapshot
  readonly updateClientSelection: (clientId: string, selectionStart: number, selectionEnd: number) => AwarenessStateSnapshot
  readonly previewVersion: (versionId: string) => VersionPreviewSnapshot | null | Promise<VersionPreviewSnapshot | null>
  readonly restoreVersion: (versionId: string) => CollabStateSnapshot | Promise<CollabStateSnapshot>
  readonly destroy: () => void
}

export type CollabRuntimeListener = () => void

export interface CollabDemoRuntimeProviderInput {
  readonly clients: readonly CollabClientSnapshot[]
  readonly awarenessUsers: readonly AwarenessUserSnapshot[]
  readonly autoInsertTokens?: readonly string[]
}

export interface CollabDemoRuntimeInput {
  readonly provider?: CollabDemoRuntimeProviderInput
  readonly offline?: OfflineStateSnapshot
  readonly versionHistory?: readonly VersionHistoryEntry[]
}

interface MutableCollabClient {
  id: string
  name: string
  text: string
  revision: number
}

interface MutableAwarenessUser {
  clientId: string
  name: string
  color: string
  cursorOffset: number
  selectionStart: number
  selectionEnd: number
  selectionLabel?: string
  updatedAt?: number
  connected: boolean
}

interface MutableOfflineState {
  connected: boolean
  queuedOperations: number
  lastEvent: string
}

interface MutableAutoInsertState {
  running: boolean
  insertedCount: number
  lastToken: string | null
  timerId: number | null
  lastEvent: string
  diagnostics: AutoInsertDiagnosticSnapshot[]
}

const defaultAutoInsertTokens = ['协同', '版本', '离线', '回放']
const demoAutoInsertIntervalMs = 1000
const defaultClients: readonly CollabClientSnapshot[] = [
  {
    id: 'client-a',
    name: 'Client A',
    text: 'Gate 6 memory collab draft',
    revision: 1
  },
  {
    id: 'client-b',
    name: 'Client B',
    text: 'Gate 6 memory collab draft',
    revision: 1
  }
]
const defaultAwarenessUsers: readonly AwarenessUserSnapshot[] = [
  {
    clientId: 'client-a',
    name: 'Alice',
    color: '#286fd6',
    cursorOffset: 8,
    selectionStart: 8,
    selectionEnd: 8,
    connected: true
  },
  {
    clientId: 'client-b',
    name: 'Bao',
    color: '#0f8f6a',
    cursorOffset: 16,
    selectionStart: 16,
    selectionEnd: 16,
    connected: true
  }
]

/** 创建协同 demo 的内存 runtime。 */
export function createCollabDemoRuntime(input: CollabDemoRuntimeInput = {}): CollabDemoRuntime {
  const providerInput = input.provider
  const clients: MutableCollabClient[] = (providerInput?.clients ?? defaultClients).map((client) => ({ ...client }))
  const awarenessUsers: MutableAwarenessUser[] = (providerInput?.awarenessUsers ?? defaultAwarenessUsers).map((user) => ({ ...user }))
  const offlineState: MutableOfflineState = input.offline === undefined
    ? {
        connected: true,
        queuedOperations: 0,
        lastEvent: 'connected'
      }
    : { ...input.offline }
  const autoInsert: MutableAutoInsertState = {
    running: false,
    insertedCount: 0,
    lastToken: null,
    timerId: null,
    lastEvent: 'idle',
    diagnostics: []
  }
  const versionHistory: VersionHistoryEntry[] = (input.versionHistory ?? [
    {
      id: 'v1',
      label: 'Initial memory snapshot',
      revision: 1,
      text: clients[0]?.text ?? ''
    }
  ]).map((entry) => ({ ...entry }))
  const autoInsertTokens = providerInput?.autoInsertTokens ?? defaultAutoInsertTokens
  const listeners = new Set<CollabRuntimeListener>()

  /** 通知订阅方刷新视图。 */
  function notify(): void {
    for (const listener of listeners) {
      listener()
    }
  }

  /** 记录当前文档快照到版本历史。 */
  function recordVersion(label: string): void {
    const primaryClient = clients[0]

    if (primaryClient === undefined) {
      return
    }

    versionHistory.push({
      id: `v${versionHistory.length + 1}`,
      label,
      revision: primaryClient.revision,
      text: primaryClient.text
    })
  }

  /** 把指定文本同步到两个内存客户端并记录一个历史版本。 */
  function updateClientText(clientId: string, text: string): CollabStateSnapshot {
    const sourceClient = clients.find((client) => client.id === clientId)

    if (sourceClient === undefined) {
      return readCollabState()
    }

    for (const client of clients) {
      client.text = text
      client.revision += 1
    }

    for (const user of awarenessUsers) {
      const nextOffset = Math.min(text.length, user.clientId === clientId ? text.length : user.cursorOffset)
      user.cursorOffset = nextOffset
      if (user.clientId === clientId) {
        user.selectionStart = nextOffset
        user.selectionEnd = nextOffset
        user.selectionLabel = `${user.name} 正在输入`
        user.updatedAt = Date.now()
      }
    }

    if (!offlineState.connected) {
      offlineState.queuedOperations += 1
    }

    recordVersion(`${sourceClient.name} edit`)
    notify()

    return readCollabState()
  }

  /** 更新指定客户端的远端光标和选区快照。 */
  function updateClientSelection(
    clientId: string,
    selectionStart: number,
    selectionEnd: number
  ): AwarenessStateSnapshot {
    const user = awarenessUsers.find((candidate) => candidate.clientId === clientId)

    if (user === undefined) {
      return readAwarenessState()
    }

    user.selectionStart = selectionStart
    user.selectionEnd = selectionEnd
    user.cursorOffset = selectionEnd
    user.selectionLabel = `${user.name} 正在输入`
    user.updatedAt = Date.now()
    notify()

    return readAwarenessState()
  }

  /** 把 token 插入两端内存文档。 */
  function insertToken(token: string): void {
    for (const client of clients) {
      client.text = `${client.text} ${token}`
      client.revision += 1
    }

    for (const user of awarenessUsers) {
      user.cursorOffset += token.length + 1
    }

    autoInsert.insertedCount += 1
    autoInsert.lastToken = token

    if (!offlineState.connected) {
      offlineState.queuedOperations += 1
    }

    recordVersion(`Auto insert ${autoInsert.insertedCount}`)
    notify()
  }

  /** 停止自动插入计时器。 */
  function clearAutoInsertTimer(): void {
    if (autoInsert.timerId !== null) {
      window.clearInterval(autoInsert.timerId)
      autoInsert.timerId = null
    }
  }

  /** 读取协同文档状态快照。 */
  function readCollabState(): CollabStateSnapshot {
    return {
      providerMode: 'memory',
      clients: clients.map((client) => ({
        id: client.id,
        name: client.name,
        text: client.text,
        revision: client.revision
      })),
      autoInsert: readAutoInsertSnapshot()
    }
  }

  /** 读取 awareness 状态快照。 */
  function readAwarenessState(): AwarenessStateSnapshot {
    return {
      users: awarenessUsers.map((user) => ({
        clientId: user.clientId,
        name: user.name,
        color: user.color,
        cursorOffset: user.cursorOffset,
        selectionStart: user.selectionStart,
        selectionEnd: user.selectionEnd,
        ...(user.selectionLabel === undefined ? {} : { selectionLabel: user.selectionLabel }),
        ...(user.updatedAt === undefined ? {} : { updatedAt: user.updatedAt }),
        connected: user.connected
      }))
    }
  }

  /** 读取离线状态快照。 */
  function readOfflineState(): OfflineStateSnapshot {
    return {
      connected: offlineState.connected,
      queuedOperations: offlineState.queuedOperations,
      lastEvent: offlineState.lastEvent
    }
  }

  /** 读取版本历史快照。 */
  function readVersionHistory(): readonly VersionHistoryEntry[] {
    return versionHistory.map((entry) => ({
      id: entry.id,
      label: entry.label,
      revision: entry.revision,
      text: entry.text
    }))
  }

  /** 内存 demo 不维护真实富文本格式，返回空格式快照。 */
  function readTextFormatRanges(): readonly TextFormatRangeSnapshot[] {
    return []
  }

  /** 内存 demo 不维护真实批注范围，返回空批注快照。 */
  function readCommentRanges(): readonly CommentRangeSnapshot[] {
    return []
  }

  /** 读取自动插入状态快照。 */
  function readAutoInsertSnapshot(): AutoInsertSnapshot {
    return {
      running: autoInsert.running,
      insertedCount: autoInsert.insertedCount,
      lastToken: autoInsert.lastToken,
      lastEvent: autoInsert.lastEvent,
      diagnostics: autoInsert.diagnostics.map((diagnostic) => ({ ...diagnostic }))
    }
  }

  /** 读取指定历史版本的只读预览。 */
  function previewVersion(versionId: string): VersionPreviewSnapshot | null {
    const entry = versionHistory.find((candidate) => candidate.id === versionId)

    if (entry === undefined) {
      return null
    }

    return {
      id: entry.id,
      label: entry.label,
      text: entry.text
    }
  }

  /** 将指定历史版本恢复为当前两端文档，并追加 restore 记录。 */
  function restoreVersion(versionId: string): CollabStateSnapshot {
    const entry = versionHistory.find((candidate) => candidate.id === versionId)

    if (entry === undefined) {
      return readCollabState()
    }

    for (const client of clients) {
      client.text = entry.text
      client.revision += 1
    }

    for (const user of awarenessUsers) {
      user.cursorOffset = Math.min(user.cursorOffset, entry.text.length)
    }

    recordVersion(`restore:${entry.id}`)
    notify()

    return readCollabState()
  }

  /** 启动自动插入模拟。 */
  function startAutoInsert(): AutoInsertSnapshot {
    if (!autoInsert.running) {
      autoInsert.running = true
      autoInsert.lastEvent = 'started'
      autoInsert.timerId = window.setInterval(() => {
        insertToken(autoInsertTokens[autoInsert.insertedCount % autoInsertTokens.length] ?? '协同')
      }, demoAutoInsertIntervalMs)
    }

    notify()

    return readAutoInsertSnapshot()
  }

  /** 中止自动插入模拟。 */
  function abortAutoInsert(): AutoInsertSnapshot {
    autoInsert.running = false
    autoInsert.lastEvent = 'aborted'
    autoInsert.diagnostics.push({
      code: 'COLLAB_AUTO_INSERTER_ABORTED',
      severity: 'info',
      recoverable: true,
      message: 'Auto inserter was aborted and pending AI text was discarded.'
    })
    clearAutoInsertTimer()
    notify()

    return readAutoInsertSnapshot()
  }

  /** 重试一次自动插入模拟，并导出可恢复 retry 诊断。 */
  function retryAutoInsert(): AutoInsertSnapshot {
    autoInsert.running = false
    autoInsert.lastEvent = 'retry-started'
    autoInsert.diagnostics.push({
      code: 'COLLAB_AUTO_INSERTER_RETRY_STARTED',
      severity: 'info',
      recoverable: true,
      message: 'Auto inserter retry started after a recoverable failure.'
    })
    clearAutoInsertTimer()
    insertToken(autoInsertTokens[autoInsert.insertedCount % autoInsertTokens.length] ?? '协同')
    notify()

    return readAutoInsertSnapshot()
  }

  /** 模拟网络断开并保留本地队列状态。 */
  function simulateDisconnect(): OfflineStateSnapshot {
    offlineState.connected = false
    offlineState.lastEvent = 'disconnected'

    for (const user of awarenessUsers) {
      user.connected = false
    }

    notify()

    return readOfflineState()
  }

  /** 模拟网络重连并清空 queued operation 计数。 */
  function simulateReconnect(): OfflineStateSnapshot {
    offlineState.connected = true
    offlineState.lastEvent = 'reconnected'
    offlineState.queuedOperations = 0

    for (const user of awarenessUsers) {
      user.connected = true
    }

    recordVersion('Reconnect flush')
    notify()

    return readOfflineState()
  }

  /** 内存 demo 暂不维护真实 undo 栈，debug API 保持当前状态。 */
  function undoLocalUserEdit(): CollabStateSnapshot {
    return readCollabState()
  }

  /** 内存 demo 不维护真实富文本格式，保持当前状态。 */
  function formatClientRange(): CollabStateSnapshot {
    return readCollabState()
  }

  /** 内存 demo 不维护真实批注范围，返回空创建结果。 */
  function addCommentRange(): CommentRangeCreateSnapshot {
    return {
      threadId: null
    }
  }

  /** 内存 demo 不执行 DOCX/provider 验收桥接，避免误报真实协同完成。 */
  async function importDocxForCollabAcceptance(): Promise<DocxImportAcceptanceSnapshot> {
    throw new Error('DOCX collab acceptance bridge requires Hocuspocus provider runtime.')
  }

  return {
    readCollabState,
    readAwarenessState,
    readOfflineState,
    readVersionHistory,
    readTextFormatRanges,
    readCommentRanges,
    startAutoInsert,
    abortAutoInsert,
    retryAutoInsert,
    simulateDisconnect,
    simulateReconnect,
    undoLocalUserEdit,
    formatClientRange,
    addCommentRange,
    importDocxForCollabAcceptance,
    updateClientText,
    updateClientSelection,
    previewVersion,
    restoreVersion,
    subscribe(listener) {
      listeners.add(listener)

      return () => {
        listeners.delete(listener)
      }
    },
    destroy() {
      clearAutoInsertTimer()
      listeners.clear()
    }
  }
}
