/**
 * 职责：阻止同 document 的普通 append 与 restoreVersion() 在单进程内交错。
 * 边界：只协调共享同一 Memory history service 或 Storage 对象的 adapter，不提供通用 append CAS 或多实例锁。
 * 协作模块：Memory 与 Storage adapter 在公开 append/restore seam 进入本屏障。
 * 性能/安全约束：不同 document 不互相阻塞，append 之间不串行，完成后及时释放 document 状态。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

interface RestoreAppendBarrierState {
  appendCount: number
  restoring: boolean
}

const barriers = new WeakMap<object, RestoreAppendBarrier>()

/** 返回某个 backing history owner 共用的 restore/append 屏障。 */
export function getRestoreAppendBarrier(owner: object): RestoreAppendBarrier {
  const existing = barriers.get(owner)

  if (existing !== undefined) {
    return existing
  }

  const created = new RestoreAppendBarrier()

  barriers.set(owner, created)
  return created
}

export class RestoreAppendBarrier {
  private readonly documents = new Map<string, RestoreAppendBarrierState>()

  /** 在没有 restore 执行时运行 append，并在完成后释放计数。 */
  async runAppend<Result>(documentId: string, append: () => Promise<Result>): Promise<Result> {
    const state = this.ensureState(documentId)

    if (state.restoring) {
      throw new Error('PERSISTENCE_RESTORE_RECOVERY_REQUIRED')
    }

    state.appendCount += 1
    try {
      return await append()
    } finally {
      state.appendCount -= 1
      this.deleteIdleState(documentId, state)
    }
  }

  /** 仅在没有 append 或 restore 执行时运行 restore，否则在改写前 fail closed。 */
  async runRestore<Result>(
    documentId: string,
    blocked: () => Result,
    restore: () => Promise<Result>
  ): Promise<Result> {
    const state = this.ensureState(documentId)

    if (state.restoring || state.appendCount > 0) {
      return blocked()
    }

    state.restoring = true
    try {
      return await restore()
    } finally {
      state.restoring = false
      this.deleteIdleState(documentId, state)
    }
  }

  /** 读取或初始化单个 document 的活动操作状态。 */
  private ensureState(documentId: string): RestoreAppendBarrierState {
    const existing = this.documents.get(documentId)

    if (existing !== undefined) {
      return existing
    }

    const created: RestoreAppendBarrierState = {
      appendCount: 0,
      restoring: false
    }

    this.documents.set(documentId, created)
    return created
  }

  /** 移除没有活动操作的 document 状态。 */
  private deleteIdleState(documentId: string, state: RestoreAppendBarrierState): void {
    if (!state.restoring && state.appendCount === 0 && this.documents.get(documentId) === state) {
      this.documents.delete(documentId)
    }
  }
}
