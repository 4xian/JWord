/**
 * 职责：集中定义 Gate 6 协作 client SDK 的公开类型和内部轻量契约。
 * 边界：不连接 provider、不读取文档内容、不执行授权校验。
 * 协作模块：client-sdk.ts、第三方 package 入口和测试共享这些类型。
 * 性能/安全约束：类型模块无副作用，避免 SDK 入口继续膨胀。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import type {
  AnchorRef,
  Editor,
  EditorApplyUpdateOptions,
  EditorSyncUpdateInput,
  TextInserterRetryInput
} from '@4xian/jword-core'
import type {
  JWordLicenseEntitlement,
  JWordLicenseFeatureKey,
  JWordLicenseValidationOptions
} from '@4xian/jword-license'

import type {
  JWordAwarenessCursor,
  JWordAwarenessRangeSnapshot,
  JWordAwarenessState,
  JWordAwarenessTextAnchorRecord,
  JWordAwarenessUser,
  JWordAwarenessViewport,
  JWordCollabDiagnostic,
  JWordCollabProviderAdapter,
  JWordCollabProviderStatus
} from './index.js'

export type JWordCollaborationStatus = JWordCollabProviderStatus | 'destroyed'
export type JWordCollaborationAutoInsertStatus = 'running' | 'aborted' | 'failed'
export type JWordCollaborationOfflineStatus = 'synced' | 'offline' | 'pending' | 'unavailable'

export const JWORD_COLLAB_CLIENT_PROTOCOL_VERSION = 'gate6-collab-v1'
export const JWORD_COLLAB_CLIENT_PACKAGE_VERSION = '0.0.0'

export interface JWordCollaborationEditor {
  /** 编码当前文档的协作 update。 */
  encodeSyncUpdate(input?: EditorSyncUpdateInput): Uint8Array
  /** 应用远端、恢复或系统 update。 */
  applySyncUpdate(update: Uint8Array, options: JWordCollaborationRemoteUpdateOptions): unknown
  /** 用历史版本 update 替换当前文档状态。 */
  replaceSyncUpdate?(update: Uint8Array, options: JWordCollaborationRemoteUpdateOptions): unknown
  /** 订阅 core Editor 事件，用于发布本地协作事务。 */
  subscribe?(listener: Editor['subscribe'] extends (listener: infer Listener) => unknown ? Listener : never): () => void
  /** 创建稳定文本锚点，供自动插入消费显式 position。 */
  createTextAnchor?(input: JWordAwarenessTextAnchorRecord): AnchorRef
  /** 解析稳定锚点位置，供 core auto inserter 在 flush 时定位。 */
  resolveTextPosition?: Editor['resolveTextPosition']
  /** 执行命令，供 core auto inserter 进入同一 transaction pipeline。 */
  executeCommand?: Editor['executeCommand']
}

export interface JWordCollaborationRemoteUpdateOptions {
  readonly origin: Extract<EditorApplyUpdateOptions['origin'], 'remote-user' | 'version-restore' | 'auto-inserter'>
  readonly documentId: string
  readonly roomId: string
  readonly clientId: string
  readonly requestId?: string
  readonly recoverable?: boolean
  readonly undoScope?: 'auto-inserter'
}

export interface JWordCollaborationUser extends JWordAwarenessUser {
  readonly id: string
  readonly name: string
  readonly color?: string
  readonly avatarUrl?: string
}

/** 连接 JWord 协同 client 所需的公开握手、授权和 provider 配置。 */
export interface ConnectJWordCollaborationOptions {
  readonly serverUrl: string
  readonly documentId: string
  readonly roomId: string
  readonly user: JWordCollaborationUser
  readonly token: string
  readonly license: JWordLicenseEntitlement | null | undefined
  readonly features: readonly JWordLicenseFeatureKey[]
  readonly provider?: JWordCollabProviderAdapter
  readonly licenseValidation?: JWordLicenseValidationOptions
  readonly minimumServerVersion?: string
  readonly clientPackageVersion?: string
}

/** client 与 server 握手后冻结的版本、feature flag 和兼容窗口载荷。 */
export interface JWordCollaborationHandshake {
  readonly protocolVersion: string
  readonly clientPackageVersion: string
  readonly serverPackageVersion: string
  readonly featureFlags: readonly string[]
  readonly minimumClientVersion: string
  readonly minimumServerVersion: string
}

export interface JWordCollaborationPresenceInput {
  readonly cursor?: JWordAwarenessCursor
  readonly rangeSnapshot?: JWordAwarenessRangeSnapshot
  readonly viewport?: JWordAwarenessViewport
  readonly typing?: boolean
  readonly selectionLabel?: string
  readonly updatedAt?: number
}

export interface JWordCollaborationAwarenessHandle {
  readonly localUser: JWordAwarenessUser & { readonly color: string }
  readonly localState: JWordAwarenessState | undefined
  readonly remoteStates: readonly JWordAwarenessState[]
  /** 写入本地 presence、远端光标派生数据和输入状态。 */
  setLocalPresence(input?: JWordCollaborationPresenceInput): void
  /** 清理本地 presence，通常在断开或销毁连接时调用。 */
  clearLocalPresence(): void
}

export interface JWordCollaborationHistoryRecordInput {
  readonly label: string
  readonly createdAt?: number
}

export interface JWordCollaborationHistoryVersion {
  readonly versionId: string
  readonly documentId: string
  readonly roomId: string
  readonly label: string
  readonly author: JWordAwarenessUser
  readonly createdAt: number
  readonly updateByteLength: number
}

export interface JWordCollaborationHistoryPreview {
  readonly version: JWordCollaborationHistoryVersion
}

export interface JWordCollaborationHistoryRestoreResult {
  readonly ok: boolean
  readonly version?: JWordCollaborationHistoryVersion
  readonly diagnostic?: JWordCollabDiagnostic
}

export interface JWordCollaborationHistoryHandle {
  /** 列出当前连接可见的版本历史。 */
  listVersions(): Promise<readonly JWordCollaborationHistoryVersion[]>
  /** 把当前文档协作 update 记录为一个版本。 */
  recordVersion(input: JWordCollaborationHistoryRecordInput): Promise<JWordCollaborationHistoryVersion>
  /** 创建指定版本的只读预览元数据。 */
  previewVersion(versionId: string): Promise<JWordCollaborationHistoryPreview | null>
  /** 恢复指定版本，失败时返回结构化诊断。 */
  restoreVersion(versionId: string): Promise<JWordCollaborationHistoryRestoreResult>
}

export interface JWordCollaborationOfflineState {
  readonly status: JWordCollaborationOfflineStatus
  readonly queuedOperations: number
  readonly diagnostics: readonly JWordCollabDiagnostic[]
}

export interface JWordCollaborationOfflineHandle {
  /** 读取离线队列与诊断快照。 */
  readState(): JWordCollaborationOfflineState
}

export interface JWordCollaborationAutoInsertSessionInput {
  readonly requestId?: string
  readonly position?: JWordCollaborationAutoInsertPosition
  readonly range?: JWordCollaborationAutoInsertRange
  readonly actor?: JWordCollaborationAutoInsertActor
}

export interface JWordCollaborationAutoInsertRetryInput {
  readonly position?: JWordCollaborationAutoInsertPosition
  readonly range?: JWordCollaborationAutoInsertRange
  readonly text?: string
  readonly metadata?: JWordCollaborationAutoInsertChunkMetadata
}

export interface JWordCollaborationAutoInsertPosition {
  readonly anchor: JWordAwarenessTextAnchorRecord | AnchorRef
}

export interface JWordCollaborationAutoInsertRange {
  readonly anchor: JWordAwarenessTextAnchorRecord | AnchorRef
  readonly focus: JWordAwarenessTextAnchorRecord | AnchorRef
}

export interface JWordCollaborationAutoInsertActor extends JWordAwarenessUser {
  readonly id: string
  readonly name: string
  readonly color: string
  readonly avatarUrl?: string
}

export interface JWordCollaborationAutoInsertChunkMetadata {
  readonly chunkId?: string
  readonly index?: number
}

export interface JWordCollaborationAutoInsertWriteResult {
  readonly ok: boolean
  readonly requestId: string
  readonly chunkId?: string
  readonly insertedText: string
}

export interface JWordCollaborationAutoInsertProgress {
  readonly requestId: string
  readonly insertedChunks: number
  readonly insertedTextLength: number
  readonly phase: JWordCollaborationAutoInsertStatus
}

export interface JWordCollaborationAutoInsertSession {
  readonly requestId: string
  readonly status: JWordCollaborationAutoInsertStatus
  readonly actor: JWordCollaborationAutoInsertActor
  readonly progress: JWordCollaborationAutoInsertProgress
  readonly diagnostics: readonly JWordCollabDiagnostic[]
  /** 写入一段自动插入文本。 */
  write(text: string, metadata?: JWordCollaborationAutoInsertChunkMetadata): JWordCollaborationAutoInsertWriteResult | null
  /** 使用新的显式位置或范围重试最近一次可恢复写入。 */
  retry(input?: JWordCollaborationAutoInsertRetryInput): JWordCollaborationAutoInsertWriteResult | null
  /** 终止自动插入会话并释放待插入文本。 */
  abort(reason?: unknown): void
}

/** 协同连接对外暴露的 awareness、history、offline 和自动插入 handle。 */
export interface JWordCollaborationConnection {
  readonly status: JWordCollaborationStatus
  readonly diagnostics: readonly JWordCollabDiagnostic[]
  readonly handshake: JWordCollaborationHandshake | null
  readonly awareness: JWordCollaborationAwarenessHandle
  readonly history: JWordCollaborationHistoryHandle
  readonly offline: JWordCollaborationOfflineHandle
  /** 启动一次自动插入会话。 */
  startAutoInsertSession(input?: JWordCollaborationAutoInsertSessionInput): JWordCollaborationAutoInsertSession
  /** 断开协作连接但保留 handle 可销毁状态。 */
  disconnect(): Promise<void>
  /** 销毁连接、清理 presence 和所有订阅。 */
  destroy(): Promise<void>
}

export interface InternalHistoryVersion {
  readonly version: JWordCollaborationHistoryVersion
  readonly update: Uint8Array
}

export interface AutoInsertWriter {
  /** 写入自动插入文本，返回 null 表示本次没有提交。 */
  write(text: string): unknown | null
  /** 使用新的显式位置或范围重试最近一次可恢复写入。 */
  retry(input?: JWordCollaborationAutoInsertRetryInput): unknown | null
}

export type SdkAutoInsertRetryInput = TextInserterRetryInput
