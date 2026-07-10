/**
 * 职责：承载 Hocuspocus demo runtime 的纯配置、用户身份与快照辅助函数。
 * 边界：不连接 provider、不读写 Y.Doc、不操作 DOM，只服务 hocuspocus-runtime.ts 装配。
 * 协作：hocuspocus-runtime.ts、@4xian/jword-collab feature matrix 和 demo debug snapshot 类型。
 * 约束：保持纯函数，避免把 runtime 生命周期状态拆散到多个可写模块。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import { GATE6_COLLAB_FEATURES } from '@4xian/jword-collab'
import type {
  JWordCollaborationUser,
  JWordLicenseEntitlement,
  JWordLicenseFeatureKey
} from '@4xian/jword-collab'
import type { Editor, EditorSharedDocument } from '@4xian/jword-core'
import type * as Y from 'yjs'

import type {
  CollabClientSnapshot,
  OfflineDiagnosticSnapshot,
  OfflineStateSnapshot
} from '../runtime'

export interface HocuspocusDemoRuntimeOptions {
  readonly webSocketUrl: string
  readonly roomId: string
  readonly clientId: HocuspocusDemoClientId
  readonly documentId?: string
  readonly offline?: 'none' | 'indexeddb'
  readonly token?: string
  readonly historyApiUrl?: string
  readonly serverUrl?: string
  readonly editor: Editor
  readonly sharedDocument: EditorSharedDocument
  readonly user?: JWordCollaborationUser
  readonly license?: JWordLicenseEntitlement | null
  readonly features?: readonly JWordLicenseFeatureKey[]
}

export type HocuspocusDemoClientId = 'client-a' | 'client-b' | 'client-c' | 'client-d' | 'client-e'

export interface MutableProviderState {
  status: string
  connected: boolean
  revision: number
  queuedOperations: number
  offlineLastEvent: string | null
  reconnectBaselineText: string | null
  offlineBaseText: string | null
  pendingLocalText: string | null
  offlineDiagnostics: OfflineDiagnosticSnapshot[]
}

interface HocuspocusOfflineState {
  readonly status: string
  readonly databaseName: string
  readonly updateByteLength: number
}

interface HocuspocusOfflineStateInput {
  readonly providerState: MutableProviderState
  readonly offlineState?: HocuspocusOfflineState
  readonly offlineDiagnostics?: readonly OfflineDiagnosticSnapshot[]
}

export const defaultDocumentId = 'jword-collab-browser-doc'
export const reconnectFailureTimeoutMs = 3000
export const demoAutoInsertIntervalMs = 1000
export const providerAutoInsertTokens = ['协同', '版本', '离线', '回放']

const clientNames: Readonly<Record<string, string>> = {
  'client-a': 'Client A',
  'client-b': 'Client B',
  'client-c': 'Client C',
  'client-d': 'Client D',
  'client-e': 'Client E'
}
const clientColors: Readonly<Record<string, string>> = {
  'client-a': '#286fd6',
  'client-b': '#0f8f6a',
  'client-c': '#a33b8f',
  'client-d': '#c47a1b',
  'client-e': '#5f6f2a'
}

/** 解析当前页面传入的第三方协作用户，缺省时回退到 demo client 身份。 */
export function createHocuspocusCurrentUser(options: HocuspocusDemoRuntimeOptions): JWordCollaborationUser {
  const fallbackName = clientNames[options.clientId] ?? options.clientId
  const fallbackColor = clientColors[options.clientId] ?? '#286fd6'

  return {
    id: options.user?.id ?? options.clientId,
    name: options.user?.name ?? fallbackName,
    color: options.user?.color ?? fallbackColor,
    ...(options.user?.avatarUrl === undefined ? {} : { avatarUrl: options.user.avatarUrl })
  }
}

/** 读取当前页面 client 对应的协作用户名。 */
export function readHocuspocusClientName(_clientId: string, currentUser: JWordCollaborationUser): string {
  return currentUser.name
}

/** 读取当前页面 client 对应的协作用户颜色。 */
export function readHocuspocusClientColor(clientId: string, currentUser: JWordCollaborationUser): string {
  return currentUser.color ?? clientColors[clientId] ?? '#286fd6'
}

/** 只把协作 server 会声明的 Gate 6 feature 传给协作 SDK 握手。 */
export function readSdkCollaborationFeatures(
  features: readonly JWordLicenseFeatureKey[] | undefined
): readonly JWordLicenseFeatureKey[] {
  const requestedFeatures = features ?? Object.values(GATE6_COLLAB_FEATURES)
  const collaborationFeatures = Object.values(GATE6_COLLAB_FEATURES)

  return requestedFeatures.filter((feature) => collaborationFeatures.includes(feature as typeof collaborationFeatures[number]))
}

/** 判断事务是否代表用户正文输入，auto/history 自身事务不触发 AI flush 延迟。 */
export function shouldDeferAutoInsertForTransaction(transaction: Y.Transaction): boolean {
  if (transaction.origin === 'local-user') {
    return true
  }

  if (transaction.local) {
    return false
  }

  return transaction.origin !== 'auto-inserter' &&
    transaction.origin !== 'jword-history-index'
}

/** 创建两个浏览器 client 的可见状态快照。 */
export function createHocuspocusClientSnapshots(currentText: string, revision: number): readonly CollabClientSnapshot[] {
  return [
    {
      id: 'client-a',
      name: 'Client A',
      text: currentText,
      revision
    },
    {
      id: 'client-b',
      name: 'Client B',
      text: currentText,
      revision
    }
  ]
}

/** 创建 provider 与可选 IndexedDB adapter 的在线状态快照。 */
export function createHocuspocusOfflineStateSnapshot(input: HocuspocusOfflineStateInput): OfflineStateSnapshot {
  const { providerState, offlineState } = input

  if (offlineState !== undefined) {
    const diagnostics = [
      ...providerState.offlineDiagnostics,
      ...(input.offlineDiagnostics ?? [])
    ]

    return {
      connected: providerState.connected,
      queuedOperations: providerState.queuedOperations,
      lastEvent: providerState.offlineLastEvent ??
        (offlineState.status === 'synced' ? 'indexeddb-synced' : `indexeddb-${offlineState.status}`),
      databaseName: offlineState.databaseName,
      updateByteLength: offlineState.updateByteLength,
      diagnostics
    }
  }

  return {
    connected: providerState.connected,
    queuedOperations: providerState.queuedOperations,
    lastEvent: providerState.offlineLastEvent ?? providerState.status,
    diagnostics: [...providerState.offlineDiagnostics]
  }
}
