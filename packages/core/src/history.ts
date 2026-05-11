/**
 * 职责：提供 Gate 1 的历史元数据和 Y.UndoManager 接入层。
 * 边界：只负责 undo/redo、tracked origin 和 stack metadata，不处理 UI、快捷键、布局或持久化。
 * 协作模块：transaction pipeline 负责产生状态变更，selection 负责提供恢复快照，Editor Facade 后续负责串联调用。
 * 性能/安全约束：默认只跟踪本地用户 origin，不访问 DOM，不把远端或自动插入默认塞进用户 undo 栈。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/03-architecture.md#39-history。
 */

import * as Y from 'yjs'

import type { DocumentStore } from './document-store'
import type { SelectionRestoreSnapshot } from './selection'

type HistoryStackItem = NonNullable<ReturnType<Y.UndoManager['undo']>>

/** 本地用户操作默认进入用户 undo 栈。 */
export const DEFAULT_HISTORY_ORIGIN = 'local-user'

/** Y.StackItem.meta 中保存 JWord 历史元数据的键。 */
export const HISTORY_STACK_METADATA_KEY = 'jword-history-metadata'

/**
 * 创建 history manager 的选项。
 */
export interface HistoryManagerOptions {
  readonly trackedOrigins?: ReadonlySet<unknown>
  readonly captureTimeout?: number
}

/**
 * 单条历史记录的 JWord 元数据。
 */
export interface HistoryEntryMetadata {
  readonly commandName: string
  readonly origin: string
  readonly description?: string
  readonly selectionBefore?: SelectionRestoreSnapshot
  readonly selectionAfter?: SelectionRestoreSnapshot
}

/**
 * undo/redo 调用结果。
 */
export interface HistoryOperationResult {
  readonly stackItem: HistoryStackItem | null
  readonly metadata?: HistoryEntryMetadata
}

/**
 * Gate 1 第一版 history manager。
 */
export interface HistoryManager {
  readonly undoManager: Y.UndoManager
  readonly trackedOrigins: ReadonlySet<unknown>
  captureNextTransaction(metadata: HistoryEntryMetadata): void
  discardNextTransactionMetadata(): void
  undo(): HistoryOperationResult
  redo(): HistoryOperationResult
  canUndo(): boolean
  canRedo(): boolean
  stopCapturing(): void
  clear(): void
  readMetadata(stackItem: HistoryStackItem): HistoryEntryMetadata | undefined
}

/**
 * 创建 history manager。
 *
 * @param input 文档状态壳或 Y.Doc。
 * @param options tracked origin 和聚合时间配置。
 * @returns 基于 Y.UndoManager 的 history manager。
 */
export function createHistoryManager(
  input: DocumentStore | Y.Doc,
  options: HistoryManagerOptions = {}
): HistoryManager {
  const doc = input instanceof Y.Doc ? input : input.doc
  const trackedOrigins = new Set<unknown>(
    options.trackedOrigins ?? new Set([DEFAULT_HISTORY_ORIGIN])
  )
  const pendingMetadata: HistoryEntryMetadata[] = []
  const undoManager = new Y.UndoManager(doc, {
    trackedOrigins,
    captureTimeout: options.captureTimeout ?? 500
  })

  undoManager.on('stack-item-added', (event) => {
    const metadata = pendingMetadata.shift()

    if (metadata !== undefined) {
      event.stackItem.meta.set(HISTORY_STACK_METADATA_KEY, metadata)
    }
  })

  return {
    undoManager,
    trackedOrigins,
    captureNextTransaction(metadata) {
      pendingMetadata.push(metadata)
    },
    discardNextTransactionMetadata() {
      pendingMetadata.pop()
    },
    undo() {
      return createHistoryOperationResult(undoManager.undo())
    },
    redo() {
      return createHistoryOperationResult(undoManager.redo())
    },
    canUndo() {
      return undoManager.canUndo()
    },
    canRedo() {
      return undoManager.canRedo()
    },
    stopCapturing() {
      undoManager.stopCapturing()
    },
    clear() {
      undoManager.clear()
      pendingMetadata.length = 0
    },
    readMetadata(stackItem) {
      return readHistoryMetadata(stackItem)
    }
  }
}

function createHistoryOperationResult(stackItem: HistoryStackItem | null): HistoryOperationResult {
  const metadata = stackItem === null ? undefined : readHistoryMetadata(stackItem)

  if (metadata === undefined) {
    return { stackItem }
  }

  return {
    stackItem,
    metadata
  }
}

function readHistoryMetadata(stackItem: HistoryStackItem): HistoryEntryMetadata | undefined {
  const metadata = stackItem.meta.get(HISTORY_STACK_METADATA_KEY)

  return isHistoryEntryMetadata(metadata) ? metadata : undefined
}

function isHistoryEntryMetadata(value: unknown): value is HistoryEntryMetadata {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const candidate = value as Partial<HistoryEntryMetadata>

  return typeof candidate.commandName === 'string' && typeof candidate.origin === 'string'
}
