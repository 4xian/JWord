/**
 * 职责：提供 Gate 6 正式协同服务端的共享 history service 和 document 级串行事务边界。
 * 边界：只封装 persistence storage adapter，不处理 HTTP、WebSocket、浏览器 runtime 或 demo 私有逻辑。
 * 协作模块：packages/persistence 提供 update log、snapshot、preview 和 restore adapter。
 * 性能/安全约束：同一 document 的读写按队列串行，避免并发 load/save 覆盖版本链。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md Gate 6 Step 6.29-6.34。
 */

import {
  createStoragePersistenceAdapter,
  createVolatileHistoryStorage
} from '@4xian/jword-persistence'
import type {
  AppendJWordUpdateInput,
  CreateJWordPreviewInput,
  JWordHistoryStorage,
  JWordPersistenceDiagnostic,
  JWordPersistenceSnapshotAdapter,
  JWordSnapshotRecord,
  JWordUpdateLogRecord,
  RestoreJWordVersionInput,
  JWordVersionRecord
} from '@4xian/jword-persistence'

export interface CreateJWordCollabHistoryServiceOptions {
  readonly storage?: JWordHistoryStorage
  readonly maxDocumentLockQueueDepth?: number
}

export interface RecordJWordCollabHistoryVersionInput extends AppendJWordUpdateInput {
  readonly snapshotId?: string
}

export interface RecordJWordCollabHistoryVersionResult {
  readonly update: JWordUpdateLogRecord
  readonly version: JWordVersionRecord
  readonly snapshot: JWordSnapshotRecord
  readonly diagnostics: readonly JWordPersistenceDiagnostic[]
}

export interface JWordCollabHistoryService {
  /** 记录一个共享历史版本，并同步创建 snapshot。 */
  recordVersion(input: RecordJWordCollabHistoryVersionInput): Promise<RecordJWordCollabHistoryVersionResult>

  /** 列出指定文档的共享历史版本。 */
  listVersions(documentId: string): Promise<readonly JWordVersionRecord[]>

  /** 创建指定版本的隔离只读预览。 */
  createPreview(input: CreateJWordPreviewInput): ReturnType<JWordPersistenceSnapshotAdapter['createPreview']>

  /** 将指定历史版本恢复到目标 Y.Doc。 */
  restoreVersion(input: RestoreJWordVersionInput): ReturnType<JWordPersistenceSnapshotAdapter['restoreVersion']>

  /** 创建绑定同一 storage backend 的底层 adapter。 */
  createAdapter(): JWordPersistenceSnapshotAdapter
}

export const JWORD_COLLAB_HISTORY_LOCK_QUEUE_EXCEEDED = 'JWORD_COLLAB_HISTORY_LOCK_QUEUE_EXCEEDED'

interface DocumentLockState {
  tail: Promise<void>
  depth: number
}

const defaultMaxDocumentLockQueueDepth = 64

export class JWordCollabHistoryLockQueueExceededError extends Error {
  readonly diagnosticCode = JWORD_COLLAB_HISTORY_LOCK_QUEUE_EXCEEDED
  readonly recoverable = true
  readonly documentId: string
  readonly maxDocumentLockQueueDepth: number

  /** 创建 history document lock 队列超限错误。 */
  constructor(documentId: string, maxDocumentLockQueueDepth: number) {
    super(`JWord collab history queue exceeded for document ${documentId}.`)
    this.name = 'JWordCollabHistoryLockQueueExceededError'
    this.documentId = documentId
    this.maxDocumentLockQueueDepth = maxDocumentLockQueueDepth
  }
}

/** 判断未知错误是否为 history document lock 队列超限。 */
export function isJWordCollabHistoryLockQueueExceededError(
  error: unknown
): error is JWordCollabHistoryLockQueueExceededError {
  return error instanceof JWordCollabHistoryLockQueueExceededError
}

/** 创建正式服务包内的共享 history service。 */
export function createJWordCollabHistoryService(
  options: CreateJWordCollabHistoryServiceOptions = {}
): JWordCollabHistoryService {
  return new StorageBackedJWordCollabHistoryService(
    options.storage ?? createVolatileHistoryStorage(),
    normalizeDocumentLockQueueDepth(options.maxDocumentLockQueueDepth)
  )
}

class StorageBackedJWordCollabHistoryService implements JWordCollabHistoryService {
  private readonly storage: JWordHistoryStorage
  private readonly documentLocks = new Map<string, DocumentLockState>()
  private readonly maxDocumentLockQueueDepth: number

  /** 绑定宿主注入的 history storage backend。 */
  constructor(storage: JWordHistoryStorage, maxDocumentLockQueueDepth: number) {
    this.storage = storage
    this.maxDocumentLockQueueDepth = maxDocumentLockQueueDepth
  }

  /** 创建绑定同一 storage backend 的底层 adapter。 */
  createAdapter(): JWordPersistenceSnapshotAdapter {
    return createStoragePersistenceAdapter({
      storage: this.storage
    })
  }

  /** 记录一个共享历史版本，并同步创建 snapshot。 */
  async recordVersion(input: RecordJWordCollabHistoryVersionInput): Promise<RecordJWordCollabHistoryVersionResult> {
    return this.runWithDocumentLock(input.documentId, async (adapter) => {
      const appended = await adapter.appendUpdate(input)
      const snapshot = await adapter.createSnapshot({
        documentId: input.documentId,
        versionId: appended.version.versionId,
        ...(input.snapshotId === undefined ? {} : { snapshotId: input.snapshotId }),
        ...(input.label === undefined ? {} : { label: input.label }),
        ...(input.createdAt === undefined ? {} : { createdAt: input.createdAt })
      })

      return {
        update: appended.update,
        version: snapshot.version,
        snapshot: snapshot.snapshot,
        diagnostics: [
          ...appended.diagnostics,
          ...snapshot.diagnostics
        ]
      }
    })
  }

  /** 列出指定文档的共享历史版本。 */
  async listVersions(documentId: string): Promise<readonly JWordVersionRecord[]> {
    return this.runWithDocumentLock(documentId, (adapter) => adapter.listVersions(documentId))
  }

  /** 创建指定版本的隔离只读预览。 */
  createPreview(input: CreateJWordPreviewInput): ReturnType<JWordPersistenceSnapshotAdapter['createPreview']> {
    return this.runWithDocumentLock(input.documentId, (adapter) => adapter.createPreview(input))
  }

  /** 将指定历史版本恢复到目标 Y.Doc。 */
  restoreVersion(input: RestoreJWordVersionInput): ReturnType<JWordPersistenceSnapshotAdapter['restoreVersion']> {
    return this.runWithDocumentLock(input.documentId, (adapter) => adapter.restoreVersion(input))
  }

  /** 串行化同一 document 的 history 读写，避免并发 load/save 覆盖版本链。 */
  private async runWithDocumentLock<Result>(
    documentId: string,
    task: (adapter: JWordPersistenceSnapshotAdapter) => Promise<Result>
  ): Promise<Result> {
    const lockState = this.documentLocks.get(documentId) ?? {
      tail: Promise.resolve(),
      depth: 0
    }

    if (lockState.depth >= this.maxDocumentLockQueueDepth) {
      throw new JWordCollabHistoryLockQueueExceededError(documentId, this.maxDocumentLockQueueDepth)
    }

    const previous = lockState.tail
    let releaseCurrentLock = (): void => {}
    const current = new Promise<void>((resolve) => {
      releaseCurrentLock = resolve
    })
    const queued = previous.catch(() => undefined).then(() => current)

    lockState.tail = queued
    lockState.depth += 1
    this.documentLocks.set(documentId, lockState)
    await previous.catch(() => undefined)

    try {
      return await task(this.createAdapter())
    } finally {
      releaseCurrentLock()
      lockState.depth -= 1
      if (lockState.depth === 0 && this.documentLocks.get(documentId) === lockState) {
        this.documentLocks.delete(documentId)
      }
    }
  }
}

/** 归一化 document lock 队列深度，至少允许当前执行中的一个任务。 */
function normalizeDocumentLockQueueDepth(value: number | undefined): number {
  return Math.max(1, Math.floor(value ?? defaultMaxDocumentLockQueueDepth))
}
