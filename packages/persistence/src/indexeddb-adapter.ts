/**
 * 职责：提供基于 y-indexeddb 的 Gate 6 浏览器离线恢复 adapter。
 * 边界：只持久化和恢复 Yjs binary update，不保存 projection JSON，不访问 core 内部 store。
 * 协作模块：packages/persistence/src/index.ts、examples/collab 真实 provider runtime 和浏览器 IndexedDB。
 * 性能/安全约束：仅在存在 IndexedDB 的浏览器环境实例化 provider；Node 环境返回可恢复诊断。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#iteration-4---offline-recovery-与-indexeddb-persistencestep-65--612。
 */

import { IndexeddbPersistence } from 'y-indexeddb'
import * as Y from 'yjs'

import {
  PERSISTENCE_DIAGNOSTIC_CODE_METADATA
} from './diagnostics.js'
import type {
  JWordPersistenceDiagnosticCode
} from './diagnostics.js'
import type {
  JWordOfflineAdapter,
  JWordPersistenceDiagnostic,
  LoadOfflineUpdatesResult,
  StoreOfflineUpdateInput,
  StoreOfflineUpdateResult
} from './index.js'

export type JWordIndexedDbOfflineStatus =
  | 'unavailable'
  | 'restoring'
  | 'synced'
  | 'destroyed'
  | 'error'

export interface CreateIndexedDbOfflineAdapterOptions {
  readonly document: Y.Doc
  readonly documentId: string
  readonly roomId?: string
  readonly databaseName?: string
}

export interface JWordIndexedDbOfflineState {
  readonly documentId: string
  readonly databaseName: string
  readonly status: JWordIndexedDbOfflineStatus
  readonly updateByteLength: number
  readonly lastSyncedAt?: string
  readonly diagnostics: readonly JWordPersistenceDiagnostic[]
}

export interface ClearIndexedDbOfflineDataResult {
  readonly ok: boolean
  readonly diagnostics: readonly JWordPersistenceDiagnostic[]
}

export type JWordPersistenceDiagnosticListener = (
  diagnostic: JWordPersistenceDiagnostic
) => void

export interface JWordIndexedDbOfflineAdapter extends JWordOfflineAdapter {
  readonly whenSynced: Promise<void>
  readState(): JWordIndexedDbOfflineState
  clearLocalData(): Promise<ClearIndexedDbOfflineDataResult>
  destroy(): Promise<void>
  onDiagnostic(listener: JWordPersistenceDiagnosticListener): () => void
}

/** 创建浏览器 IndexedDB offline adapter，非浏览器环境降级为可恢复诊断。 */
export function createIndexedDbOfflineAdapter(
  options: CreateIndexedDbOfflineAdapterOptions
): JWordIndexedDbOfflineAdapter {
  const databaseName = options.databaseName ?? options.roomId ?? options.documentId

  if (!hasIndexedDb()) {
    return new UnavailableIndexedDbOfflineAdapter(options.documentId, databaseName)
  }

  try {
    return new BrowserIndexedDbOfflineAdapter(options, databaseName)
  } catch {
    return new UnavailableIndexedDbOfflineAdapter(options.documentId, databaseName)
  }
}

class BrowserIndexedDbOfflineAdapter implements JWordIndexedDbOfflineAdapter {
  private readonly document: Y.Doc
  private readonly documentId: string
  private readonly databaseName: string
  private readonly provider: IndexeddbPersistence
  private readonly diagnostics: JWordPersistenceDiagnostic[] = []
  private readonly diagnosticListeners = new Set<JWordPersistenceDiagnosticListener>()
  private readonly updateStateListener: () => void
  private status: JWordIndexedDbOfflineStatus = 'restoring'
  private updateByteLength = 0
  private lastSyncedAt: string | undefined
  private destroyed = false
  readonly whenSynced: Promise<void>

  /** 初始化 y-indexeddb provider 并等待本地 update 恢复完成。 */
  constructor(options: CreateIndexedDbOfflineAdapterOptions, databaseName: string) {
    this.document = options.document
    this.documentId = options.documentId
    this.databaseName = databaseName
    this.provider = new IndexeddbPersistence(databaseName, options.document)
    this.updateStateListener = () => {
      this.updateByteLength = Y.encodeStateAsUpdate(this.document).byteLength
    }
    this.document.on('update', this.updateStateListener)
    this.whenSynced = this.provider.whenSynced.then(() => {
      this.status = 'synced'
      this.lastSyncedAt = new Date().toISOString()
      this.updateByteLength = Y.encodeStateAsUpdate(this.document).byteLength
    }).catch(() => {
      this.status = 'error'
      this.emitDiagnostic(createDiagnostic('PERSISTENCE_INDEXEDDB_UNAVAILABLE', this.documentId))
    })
  }

  /** 显式保存一条 Yjs update，主要供 contract 和外部重放入口调用。 */
  async storeUpdate(input: StoreOfflineUpdateInput): Promise<StoreOfflineUpdateResult> {
    if (this.destroyed) {
      return this.createUnavailableResult(input.documentId)
    }

    await this.whenSynced
    await this.provider.set('jword-state-update', copyBytesToArrayBuffer(input.update))
    Y.applyUpdate(this.document, input.update, 'jword-indexeddb-offline-store')
    this.updateByteLength = Y.encodeStateAsUpdate(this.document).byteLength

    return {
      ok: true,
      diagnostics: []
    }
  }

  /** 从 IndexedDB 创建临时 Y.Doc，返回当前数据库里的 state update。 */
  async load(documentId: string): Promise<LoadOfflineUpdatesResult> {
    if (this.destroyed) {
      return {
        updates: [],
        diagnostics: [createDiagnostic('PERSISTENCE_INDEXEDDB_UNAVAILABLE', documentId)]
      }
    }

    const restored = await this.loadPersistedUpdate(documentId)

    return {
      updates: restored.update.byteLength === 0 ? [] : [restored.update],
      diagnostics: restored.diagnostics
    }
  }

  /** 读取 adapter 当前恢复状态，供 demo 面板和测试断言使用。 */
  readState(): JWordIndexedDbOfflineState {
    return {
      documentId: this.documentId,
      databaseName: this.databaseName,
      status: this.status,
      updateByteLength: this.updateByteLength,
      diagnostics: [...this.diagnostics],
      ...(this.lastSyncedAt === undefined ? {} : { lastSyncedAt: this.lastSyncedAt })
    }
  }

  /** 清空当前 IndexedDB 文档数据。 */
  async clearLocalData(): Promise<ClearIndexedDbOfflineDataResult> {
    if (this.destroyed) {
      return {
        ok: true,
        diagnostics: []
      }
    }

    try {
      await this.provider.clearData()
      this.destroyed = true
      this.status = 'destroyed'
      this.updateByteLength = 0
      this.document.off('update', this.updateStateListener)
      return {
        ok: true,
        diagnostics: []
      }
    } catch {
      const diagnostic = createDiagnostic('PERSISTENCE_INDEXEDDB_UNAVAILABLE', this.documentId)
      this.emitDiagnostic(diagnostic)
      return {
        ok: false,
        diagnostics: [diagnostic]
      }
    }
  }

  /** 销毁 provider 订阅但不删除 IndexedDB 数据。 */
  async destroy(): Promise<void> {
    if (this.destroyed) {
      return
    }

    this.destroyed = true
    this.status = 'destroyed'
    this.document.off('update', this.updateStateListener)
    await this.provider.destroy()
    this.diagnosticListeners.clear()
  }

  /** 订阅 IndexedDB adapter 诊断。 */
  onDiagnostic(listener: JWordPersistenceDiagnosticListener): () => void {
    this.diagnosticListeners.add(listener)
    return () => {
      this.diagnosticListeners.delete(listener)
    }
  }

  /** 用临时 provider 读取 IndexedDB 中的持久化 state update。 */
  private async loadPersistedUpdate(documentId: string): Promise<{
    readonly update: Uint8Array
    readonly diagnostics: readonly JWordPersistenceDiagnostic[]
  }> {
    const restoredDoc = new Y.Doc()
    const restoredProvider = new IndexeddbPersistence(this.databaseName, restoredDoc)

    try {
      await restoredProvider.whenSynced
      const checkpoint = await restoredProvider.get('jword-state-update')
      const checkpointUpdate = readCheckpointUpdate(checkpoint)

      if (checkpointUpdate !== undefined) {
        Y.applyUpdate(restoredDoc, checkpointUpdate, 'jword-indexeddb-offline-checkpoint')
      }

      return {
        update: Y.encodeStateAsUpdate(restoredDoc),
        diagnostics: []
      }
    } catch {
      const diagnostic = createDiagnostic('PERSISTENCE_INDEXEDDB_UNAVAILABLE', documentId)
      this.emitDiagnostic(diagnostic)
      return {
        update: new Uint8Array(),
        diagnostics: [diagnostic]
      }
    } finally {
      await restoredProvider.destroy()
    }
  }

  /** 生成销毁或不可用时的保存结果。 */
  private createUnavailableResult(documentId: string): StoreOfflineUpdateResult {
    const diagnostic = createDiagnostic('PERSISTENCE_INDEXEDDB_UNAVAILABLE', documentId)
    this.emitDiagnostic(diagnostic)

    return {
      ok: false,
      diagnostics: [diagnostic]
    }
  }

  /** 保存并派发一条 persistence 诊断。 */
  private emitDiagnostic(diagnostic: JWordPersistenceDiagnostic): void {
    this.diagnostics.push(diagnostic)
    for (const listener of this.diagnosticListeners) {
      listener(diagnostic)
    }
  }
}

class UnavailableIndexedDbOfflineAdapter implements JWordIndexedDbOfflineAdapter {
  private readonly documentId: string
  private readonly databaseName: string
  private readonly diagnostics: JWordPersistenceDiagnostic[]
  private readonly diagnosticListeners = new Set<JWordPersistenceDiagnosticListener>()
  readonly whenSynced: Promise<void> = Promise.resolve()

  /** 保存不可用环境的 adapter identity 和初始诊断。 */
  constructor(documentId: string, databaseName: string) {
    this.documentId = documentId
    this.databaseName = databaseName
    this.diagnostics = [createDiagnostic('PERSISTENCE_INDEXEDDB_UNAVAILABLE', documentId)]
  }

  /** 返回 recoverable diagnostic，表达当前环境不能写入 IndexedDB。 */
  async storeUpdate(input: StoreOfflineUpdateInput): Promise<StoreOfflineUpdateResult> {
    return {
      ok: false,
      diagnostics: [createDiagnostic('PERSISTENCE_INDEXEDDB_UNAVAILABLE', input.documentId)]
    }
  }

  /** 返回空 update 列表，表达当前环境不能从 IndexedDB 恢复。 */
  async load(documentId: string): Promise<LoadOfflineUpdatesResult> {
    return {
      updates: [],
      diagnostics: [createDiagnostic('PERSISTENCE_INDEXEDDB_UNAVAILABLE', documentId)]
    }
  }

  /** 读取不可用环境下的稳定状态快照。 */
  readState(): JWordIndexedDbOfflineState {
    return {
      documentId: this.documentId,
      databaseName: this.databaseName,
      status: 'unavailable',
      updateByteLength: 0,
      diagnostics: [...this.diagnostics]
    }
  }

  /** 不可用环境下清理本地数据保持可恢复 no-op。 */
  async clearLocalData(): Promise<ClearIndexedDbOfflineDataResult> {
    return {
      ok: false,
      diagnostics: [...this.diagnostics]
    }
  }

  /** 不可用环境下销毁为 no-op。 */
  async destroy(): Promise<void> {
    this.diagnosticListeners.clear()
  }

  /** 订阅不可用 adapter 的后续诊断。 */
  onDiagnostic(listener: JWordPersistenceDiagnosticListener): () => void {
    this.diagnosticListeners.add(listener)
    return () => {
      this.diagnosticListeners.delete(listener)
    }
  }
}

/** 判断当前运行环境是否提供 IndexedDB。 */
function hasIndexedDb(): boolean {
  return typeof globalThis.indexedDB !== 'undefined'
}

/** 把 Uint8Array 复制为独立 ArrayBuffer，避免 IndexedDB 保存共享底层切片。 */
function copyBytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)

  copy.set(bytes)
  return copy.buffer
}

/** 从 y-indexeddb custom store 中读取 checkpoint update。 */
function readCheckpointUpdate(value: unknown): Uint8Array | undefined {
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value)
  }

  if (value instanceof Uint8Array) {
    return new Uint8Array(value)
  }

  return undefined
}

/** 用诊断 metadata 生成 persistence diagnostic。 */
function createDiagnostic(
  code: JWordPersistenceDiagnosticCode,
  documentId: string
): JWordPersistenceDiagnostic {
  const metadata = PERSISTENCE_DIAGNOSTIC_CODE_METADATA[code]

  return {
    code,
    severity: metadata.severity,
    message: metadata.description,
    recoverable: metadata.recoverable,
    ...('fallback' in metadata ? { fallback: metadata.fallback } : {}),
    documentId
  }
}
