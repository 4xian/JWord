/**
 * 职责：管理 Gate 5 DOCX demo 导入导出异步任务的取消会话。
 * 边界：只提供 request id、AbortSignal 和提交权限判断，不执行 DOCX/PDF 互通。
 * 协作模块：examples/docx/src/main.ts、DOCX/PDF runtime 的 signal 选项和真实浏览器验收脚本。
 * 性能/安全约束：新任务开始时取消旧任务，旧任务完成后不得再写入 editor 或输出面板。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#iteration-26---建立-benchmarkbundle-和回归门禁。
 */

export type DocxDemoTaskKind = 'import' | 'export-docx' | 'export-pdf'

export interface DocxDemoTaskSnapshot {
  readonly kind: DocxDemoTaskKind
  readonly requestId: string
}

export interface DocxDemoTaskSession extends DocxDemoTaskSnapshot {
  readonly signal: AbortSignal
  canCommit(): boolean
}

export interface DocxDemoTaskController {
  start(kind: DocxDemoTaskKind): DocxDemoTaskSession
  cancelActiveTask(): boolean
  finishTask(requestId: string): boolean
  readActiveTask(): DocxDemoTaskSnapshot | null
}

interface MutableDocxDemoTaskRecord extends DocxDemoTaskSnapshot {
  readonly controller: AbortController
}

/** 创建 DOCX demo 异步任务会话控制器。 */
export function createDocxDemoTaskController(): DocxDemoTaskController {
  let activeTask: MutableDocxDemoTaskRecord | null = null
  let taskSequence = 0

  /** 判断给定 request id 是否仍是当前可提交任务。 */
  function canCommit(requestId: string): boolean {
    return activeTask?.requestId === requestId && activeTask.controller.signal.aborted !== true
  }

  /** 开始一个新任务，并取消旧任务。 */
  function start(kind: DocxDemoTaskKind): DocxDemoTaskSession {
    if (activeTask !== null) {
      activeTask.controller.abort()
    }

    const controller = new AbortController()
    const requestId = `examples-${kind}-${taskSequence + 1}`

    taskSequence += 1
    activeTask = {
      kind,
      requestId,
      controller
    }

    return {
      kind,
      requestId,
      signal: controller.signal,
      canCommit() {
        return canCommit(requestId)
      }
    }
  }

  /** 取消当前任务。 */
  function cancelActiveTask(): boolean {
    if (activeTask === null) {
      return false
    }

    activeTask.controller.abort()
    activeTask = null

    return true
  }

  /** 完成当前任务并清理 active 状态。 */
  function finishTask(requestId: string): boolean {
    if (activeTask?.requestId !== requestId) {
      return false
    }

    activeTask = null

    return true
  }

  /** 读取当前任务快照。 */
  function readActiveTask(): DocxDemoTaskSnapshot | null {
    if (activeTask === null) {
      return null
    }

    return {
      kind: activeTask.kind,
      requestId: activeTask.requestId
    }
  }

  return {
    start,
    cancelActiveTask,
    finishTask,
    readActiveTask
  }
}

/** 判断异常是否是当前 session 触发的已知取消错误。 */
export function isDocxDemoTaskCancelled(session: DocxDemoTaskSession, error: unknown): boolean {
  if (session.signal.aborted !== true) {
    return false
  }

  if (error instanceof DOMException && error.name === 'AbortError') {
    return true
  }

  if (error instanceof Error && error.name === 'AbortError') {
    return true
  }

  if (isObjectRecord(error)) {
    return error.cancelled === true ||
      error.code === 'PDF_EXPORT_CANCELLED' ||
      error.code === 'DOCX_WORKER_CANCELLED'
  }

  return false
}

/** 判断未知值是否是对象记录。 */
function isObjectRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null
}
