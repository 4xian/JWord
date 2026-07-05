/**
 * 职责：提供 Gate 1 的历史元数据和 Y.UndoManager 接入层。
 * 边界：只负责 undo/redo、tracked origin 和 stack metadata，不处理 UI、快捷键、布局或持久化。
 * 协作模块：transaction pipeline 负责产生状态变更，selection 负责提供恢复快照，Editor Facade 后续负责串联调用。
 * 性能/安全约束：默认只跟踪本地用户 origin，不访问 DOM，不把远端或自动插入默认塞进用户 undo 栈。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/03-architecture.md#39-history。
 */

import * as Y from 'yjs'

import type { DocumentStore } from '../model/document-store'
import type { SelectionRestoreSnapshot } from '../model/selection'

type HistoryStackItem = NonNullable<ReturnType<Y.UndoManager['undo']>>

/** 本地用户操作默认进入用户 undo 栈。 */
export const DEFAULT_HISTORY_ORIGIN = 'local-user'

/** auto inserter 独立 undo scope 使用的内部 Yjs origin。 */
export const AUTO_INSERTER_HISTORY_ORIGIN = Symbol.for('jword.history.auto-inserter')

/** version restore 独立 undo scope 使用的内部 Yjs origin。 */
export const VERSION_RESTORE_HISTORY_ORIGIN = Symbol.for('jword.history.version-restore')

/** Y.StackItem.meta 中保存 JWord 历史元数据的键。 */
export const HISTORY_STACK_METADATA_KEY = 'jword-history-metadata'

/** Editor facade 支持的 history scope。 */
export type HistoryScope = 'user' | 'auto-inserter' | 'version-restore'

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
  captureNextTransaction(metadata: HistoryEntryMetadata, scope?: HistoryScope): void
  discardNextTransactionMetadata(scope?: HistoryScope): void
  undo(scope?: HistoryScope): HistoryOperationResult
  redo(scope?: HistoryScope): HistoryOperationResult
  canUndo(scope?: HistoryScope): boolean
  canRedo(scope?: HistoryScope): boolean
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
  const scopedHistories = new Map<HistoryScope, ScopedHistoryManager>()
  const undoManager = createScopedHistoryManager(doc, 'user', trackedOrigins, options.captureTimeout)

  scopedHistories.set('user', undoManager)
  scopedHistories.set(
    'auto-inserter',
    createScopedHistoryManager(doc, 'auto-inserter', new Set([AUTO_INSERTER_HISTORY_ORIGIN]), options.captureTimeout)
  )
  scopedHistories.set(
    'version-restore',
    createScopedHistoryManager(doc, 'version-restore', new Set([VERSION_RESTORE_HISTORY_ORIGIN]), options.captureTimeout)
  )

  return {
    undoManager: undoManager.undoManager,
    trackedOrigins,
    captureNextTransaction(metadata, scope = 'user') {
      readScopedHistoryManager(scopedHistories, scope).pendingMetadata.push(metadata)
    },
    discardNextTransactionMetadata(scope = 'user') {
      readScopedHistoryManager(scopedHistories, scope).pendingMetadata.shift()
    },
    undo(scope = 'user') {
      const scopedHistory = readScopedHistoryManager(scopedHistories, scope)
      const stackItem = scopedHistory.undoManager.undo()

      copyMetadataToLatestStackItem(stackItem, scopedHistory.undoManager.redoStack)

      return createHistoryOperationResult(stackItem)
    },
    redo(scope = 'user') {
      const scopedHistory = readScopedHistoryManager(scopedHistories, scope)
      const stackItem = scopedHistory.undoManager.redo()

      copyMetadataToLatestStackItem(stackItem, scopedHistory.undoManager.undoStack)

      return createHistoryOperationResult(stackItem)
    },
    canUndo(scope = 'user') {
      return readScopedHistoryManager(scopedHistories, scope).undoManager.canUndo()
    },
    canRedo(scope = 'user') {
      return readScopedHistoryManager(scopedHistories, scope).undoManager.canRedo()
    },
    stopCapturing() {
      for (const scopedHistory of scopedHistories.values()) {
        scopedHistory.undoManager.stopCapturing()
      }
    },
    clear() {
      for (const scopedHistory of scopedHistories.values()) {
        scopedHistory.undoManager.clear()
        scopedHistory.pendingMetadata.length = 0
      }
    },
    readMetadata(stackItem) {
      return readHistoryMetadata(stackItem)
    }
  }
}

/** 读取指定 history scope 应该使用的内部 Yjs transaction origin。 */
export function readHistoryScopeTransactionOrigin(scope: HistoryScope): unknown {
  if (scope === 'auto-inserter') {
    return AUTO_INSERTER_HISTORY_ORIGIN
  }

  if (scope === 'version-restore') {
    return VERSION_RESTORE_HISTORY_ORIGIN
  }

  return DEFAULT_HISTORY_ORIGIN
}

interface ScopedHistoryManager {
  readonly scope: HistoryScope
  readonly undoManager: Y.UndoManager
  readonly pendingMetadata: HistoryEntryMetadata[]
}

/** 创建指定 history scope 的 Y.UndoManager 和待写入 metadata 队列。 */
function createScopedHistoryManager(
  doc: Y.Doc,
  scope: HistoryScope,
  trackedOrigins: ReadonlySet<unknown>,
  captureTimeout: number | undefined
): ScopedHistoryManager {
  const pendingMetadata: HistoryEntryMetadata[] = []
  const undoManager = new Y.UndoManager(doc, {
    trackedOrigins: new Set(trackedOrigins),
    captureTimeout: captureTimeout ?? 500
  })

  undoManager.on('stack-item-added', (event) => {
    const metadata = pendingMetadata.shift()

    if (metadata !== undefined) {
      event.stackItem.meta.set(HISTORY_STACK_METADATA_KEY, metadata)
    }
  })

  return {
    scope,
    undoManager,
    pendingMetadata
  }
}

/** 从已登记的 scope map 中读取对应 history manager。 */
function readScopedHistoryManager(
  scopedHistories: ReadonlyMap<HistoryScope, ScopedHistoryManager>,
  scope: HistoryScope
): ScopedHistoryManager {
  const scopedHistory = scopedHistories.get(scope)

  if (scopedHistory === undefined) {
    throw new Error(`Unknown history scope: ${scope}`)
  }

  return scopedHistory
}

function copyMetadataToLatestStackItem(
  source: HistoryStackItem | null,
  targetStack: readonly HistoryStackItem[]
): void {
  if (source === null || targetStack.length === 0) {
    return
  }

  const metadata = readHistoryMetadata(source)
  const target = targetStack[targetStack.length - 1]

  if (metadata !== undefined && target !== undefined) {
    target.meta.set(HISTORY_STACK_METADATA_KEY, metadata)
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
