/**
 * 职责：提供 Hocuspocus demo provider 的自动插入流式状态机。
 * 边界：只通过 connectJWordCollaboration 返回的 session 写入正文，不访问 provider、DOM 或 Y.Doc 内部结构。
 * 协作：hocuspocus-runtime.ts 负责 provider 状态、离线持久化和历史记录回调。
 * 约束：自动插入默认进入独立 auto-inserter undo scope，不污染本地用户 undo。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md Gate 6 Step 6.11。
 */
import type {
  AnchorRef,
  Editor
} from '@4xian/jword-core'
import type {
  JWordCollaborationAutoInsertRange,
  JWordCollaborationAutoInsertSession,
  JWordCollaborationConnection
} from '@4xian/jword-collab'

import type {
  AutoInsertDiagnosticSnapshot,
  AutoInsertSnapshot
} from '../runtime'
import {
  countDemoGraphemes,
  findProjectionTextOffset,
  readFirstTextPosition,
  readProjectionText
} from './hocuspocus-projection'

interface MutableAutoInsertState {
  running: boolean
  insertedCount: number
  lastToken: string | null
  lastEvent: string
  diagnostics: AutoInsertDiagnosticSnapshot[]
}

export interface HocuspocusAutoInsertController {
  readonly readSnapshot: () => AutoInsertSnapshot
  readonly start: (input?: HocuspocusAutoInsertStartInput) => AutoInsertSnapshot
  readonly flushNext: () => AutoInsertSnapshot
  readonly abort: () => AutoInsertSnapshot
  readonly retry: (input?: HocuspocusAutoInsertStartInput) => AutoInsertSnapshot
  readonly deferNextFlushForUserEdit: () => void
  readonly destroy: () => void
}

export interface HocuspocusAutoInsertStartInput {
  readonly tokens?: readonly string[]
  readonly rangeStart?: number
  readonly rangeEnd?: number
}

export interface HocuspocusAutoInsertControllerInput {
  readonly tokens: readonly string[]
  /** 用户正在输入时下一段自动插入的延迟。 */
  readonly userEditIdleDelayMs?: number
  readonly ensureEditorForWrite: () => Editor
  readonly readConnection: () => JWordCollaborationConnection | null
  readonly isProviderConnected: () => boolean
  readonly markOfflinePending: () => void
  readonly storeCurrentUpdate: () => void
  readonly recordHistoryVersion: (label: string, origin: string) => void
  readonly notify: () => void
}

const defaultUserEditIdleDelayMs = 120
const retryEvent = 'retry-started'
const autoInsertActor = {
  id: 'jword-auto-inserter',
  name: 'AI Assistant',
  color: '#6f42c1'
} as const

/** 创建 provider 自动插入状态机。 */
export function createHocuspocusAutoInsertController(
  input: HocuspocusAutoInsertControllerInput
): HocuspocusAutoInsertController {
  const state: MutableAutoInsertState = {
    running: false,
    insertedCount: 0,
    lastToken: null,
    lastEvent: 'idle',
    diagnostics: []
  }
  let anchor: AnchorRef | null = null
  let range: JWordCollaborationAutoInsertRange | null = null
  let session: JWordCollaborationAutoInsertSession | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let userEditDeferred = false
  let activeTokens: readonly string[] = input.tokens
  let tokenIndex = 0
  const userEditIdleDelayMs = input.userEditIdleDelayMs ?? defaultUserEditIdleDelayMs

  /** 读取 auto insert 当前状态。 */
  function readSnapshot(): AutoInsertSnapshot {
    return {
      running: state.running,
      insertedCount: state.insertedCount,
      lastToken: state.lastToken,
      lastEvent: state.lastEvent,
      diagnostics: state.diagnostics.map((diagnostic) => ({ ...diagnostic }))
    }
  }

  /** 启动一次 provider auto insert 流式写入。 */
  function start(startInput: HocuspocusAutoInsertStartInput = {}): AutoInsertSnapshot {
    if (state.running) {
      return readSnapshot()
    }

    return startWithEvent('started', startInput)
  }

  /** 由 demo runtime 的轮询定时器触发下一段写入。 */
  function flushNext(): AutoInsertSnapshot {
    if (userEditDeferred) {
      state.lastEvent = 'deferred-for-user-edit'
      input.notify()

      return readSnapshot()
    }

    flushNextToken()

    return readSnapshot()
  }

  /** 中止 provider auto insert 后续 token。 */
  function abort(): AutoInsertSnapshot {
    clearTimer()
    state.running = false
    state.lastEvent = 'aborted'
    anchor = null
    range = null
    session?.abort()
    session = null
    recordDiagnostic({
      code: 'COLLAB_AUTO_INSERTER_ABORTED',
      severity: 'info',
      recoverable: true,
      message: 'Auto inserter was aborted in the provider runtime.'
    })
    input.notify()

    return readSnapshot()
  }

  /** 用新的尾部 anchor 重试 provider auto insert。 */
  function retry(startInput: HocuspocusAutoInsertStartInput = {}): AutoInsertSnapshot {
    clearTimer()
    state.running = false
    state.lastEvent = retryEvent
    recordDiagnostic({
      code: 'COLLAB_AUTO_INSERTER_RETRY_STARTED',
      severity: 'info',
      recoverable: true,
      message: 'Auto inserter retry started in the provider runtime.'
    })

    const snapshot = startWithEvent(retryEvent, startInput)

    input.notify()

    return snapshot
  }

  /** 销毁未完成的定时 flush。 */
  function destroy(): void {
    clearTimer()
    anchor = null
    range = null
    session = null
    state.running = false
  }

  /** 用户输入仍在进行时，延迟下一段 AI token，避免插入到用户输入批次中间。 */
  function deferNextFlushForUserEdit(): void {
    clearTimer()
    if (!state.running || tokenIndex >= activeTokens.length) {
      return
    }

    userEditDeferred = true
    timer = setTimeout(() => {
      timer = null
      userEditDeferred = false
    }, userEditIdleDelayMs)
  }

  /** 在当前文档尾部创建稳定 anchor。 */
  function createTailAnchor(): AnchorRef | null {
    const editor = input.ensureEditorForWrite()
    const projection = editor.getProjection()
    const currentText = readProjectionText(projection)
    const anchorPosition = readFirstTextPosition(projection, countDemoGraphemes(currentText))

    return anchorPosition === null
      ? null
      : editor.createTextAnchor({
          ...anchorPosition,
          assoc: 1
        })
  }

  /** 使用指定事件启动写入，供 retry 保持可诊断事件。 */
  function startWithEvent(
    lastEvent: string,
    startInput: HocuspocusAutoInsertStartInput
  ): AutoInsertSnapshot {
    const placement = createInitialPlacement(startInput)

    anchor = placement?.anchor ?? null
    range = placement?.range ?? null
    session = createAutoInsertSession(placement)
    activeTokens = startInput.tokens ?? input.tokens
    tokenIndex = 0
    if (placement === null || session === null) {
      state.running = false
      state.lastEvent = 'anchor-missing'
      recordDiagnostic({
        code: 'COLLAB_AUTO_INSERTER_ANCHOR_REBASED',
        severity: 'warning',
        recoverable: true,
        message: 'Auto inserter could not find a writable text anchor in provider runtime.'
      })
      input.notify()

      return readSnapshot()
    }

    state.running = true
    state.lastEvent = lastEvent
    input.notify()

    return readSnapshot()
  }

  /** 创建本轮 auto insert 的初始 anchor 或 range。 */
  function createInitialPlacement(
    startInput: HocuspocusAutoInsertStartInput
  ): { readonly anchor: AnchorRef, readonly range: JWordCollaborationAutoInsertRange | null } | null {
    if (startInput.rangeStart !== undefined && startInput.rangeEnd !== undefined) {
      return createRangePlacement(startInput.rangeStart, startInput.rangeEnd)
    }

    const tailAnchor = createTailAnchor()

    return tailAnchor === null
      ? null
      : {
          anchor: tailAnchor,
          range: null
        }
  }

  /** 创建 range 替换使用的稳定范围，后续 token 继续沿 range anchor 插入。 */
  function createRangePlacement(
    start: number,
    end: number
  ): { readonly anchor: AnchorRef, readonly range: JWordCollaborationAutoInsertRange } | null {
    if (start >= end) {
      return null
    }

    const editor = input.ensureEditorForWrite()
    const projection = editor.getProjection()
    const anchorPosition = readFirstTextPosition(projection, start)
    const focusPosition = readFirstTextPosition(projection, end)

    if (anchorPosition === null || focusPosition === null) {
      return null
    }

    const rangeAnchor = editor.createTextAnchor({
      ...anchorPosition,
      assoc: 1
    })
    const rangeFocus = editor.createTextAnchor(focusPosition)

    return {
      anchor: rangeAnchor,
      range: {
        anchor: rangeAnchor,
        focus: rangeFocus
      }
    }
  }

  /** 通过第三方协作 SDK 创建自动插入 session。 */
  function createAutoInsertSession(
    placement: { readonly anchor: AnchorRef, readonly range: JWordCollaborationAutoInsertRange | null } | null
  ): JWordCollaborationAutoInsertSession | null {
    const connection = input.readConnection()

    if (placement === null || connection === null) {
      return null
    }

    return connection.startAutoInsertSession({
      requestId: `provider-auto-insert-${Date.now().toString(36)}`,
      actor: autoInsertActor,
      ...(placement.range === null
        ? {
            position: {
              anchor: placement.anchor
            }
          }
        : {
            range: placement.range
          })
    })
  }

  /** 写入下一个 token，所有正文变化必须走协作 SDK 的 auto insert session。 */
  function flushNextToken(): void {
    if (!state.running || anchor === null || session === null || tokenIndex >= activeTokens.length) {
      finishIfDone()
      return
    }

    const token = activeTokens[tokenIndex] ?? ''
    const editor = input.ensureEditorForWrite()
    if (state.insertedCount > 0 && readProjectionText(editor.getProjection()).length === 0) {
      failWithAnchorUnresolved()
      input.notify()
      return
    }

    const insertionOffset = readCurrentAnchorOffset(editor, anchor)
    const result = session.write(token, {
      chunkId: `provider-auto-insert-${state.insertedCount + 1}`,
      index: state.insertedCount
    })

    if (result === null) {
      syncSessionDiagnostics()
      input.notify()
      return
    }

    tokenIndex += 1
    state.insertedCount += 1
    state.lastToken = token
    refreshAnchorAfterCommittedToken(editor, insertionOffset, token)
    if (range !== null) {
      range = null
      session = restartAutoInsertSessionAfterRangeReplace()
      if (session === null && tokenIndex < activeTokens.length) {
        failWithAnchorUnresolved()
        input.notify()
        return
      }
    }
    input.storeCurrentUpdate()
    if (!input.isProviderConnected()) {
      input.markOfflinePending()
    }
    input.recordHistoryVersion(`Auto insert ${state.insertedCount}`, 'auto-inserter')
    finishIfDone()
    input.notify()
  }

  /** range 替换后从最新尾部 anchor 继续创建插入 session。 */
  function restartAutoInsertSessionAfterRangeReplace(): JWordCollaborationAutoInsertSession | null {
    if (anchor === null) {
      return null
    }

    return createAutoInsertSession({
      anchor,
      range: null
    })
  }

  /** 用户删除当前 anchor 所在正文后，停止后续 flush 并返回可恢复诊断。 */
  function failWithAnchorUnresolved(): void {
    clearTimer()
    state.running = false
    state.lastEvent = 'failed'
    anchor = null
    range = null
    session = null
    recordDiagnostic({
      code: 'COLLAB_AUTO_INSERTER_ANCHOR_UNRESOLVED',
      severity: 'error',
      recoverable: true,
      message: 'auto inserter 的稳定锚点已无法解析'
    })
  }

  /** 读取当前 anchor 在 projection 中的全局正文 offset。 */
  function readCurrentAnchorOffset(editor: Editor, currentAnchor: AnchorRef): number | null {
    try {
      return findProjectionTextOffset(editor.getProjection(), editor.resolveTextPosition(currentAnchor))
    } catch {
      return null
    }
  }

  /** 每次 flush 后把 active anchor 移到刚写入 token 的尾部。 */
  function refreshAnchorAfterCommittedToken(
    editor: Editor,
    insertionOffset: number | null,
    token: string
  ): void {
    if (insertionOffset === null) {
      return
    }

    const nextPosition = readFirstTextPosition(
      editor.getProjection(),
      insertionOffset + countDemoGraphemes(token)
    )

    if (nextPosition === null) {
      return
    }

    anchor = editor.createTextAnchor({
      ...nextPosition,
      assoc: 1
    })
  }

  /** 完成所有 token 后停止 running 标记。 */
  function finishIfDone(): void {
    if (tokenIndex < activeTokens.length) {
      return
    }

    state.running = false
    anchor = null
    range = null
    session = null
  }

  /** 记录 auto insert 诊断，避免同一 code 重复刷屏。 */
  function recordDiagnostic(diagnostic: AutoInsertDiagnosticSnapshot): void {
    if (state.diagnostics.some((candidate) => candidate.code === diagnostic.code)) {
      return
    }

    state.diagnostics.push(diagnostic)
  }

  /** 同步 SDK session 诊断到 demo debug 面板。 */
  function syncSessionDiagnostics(): void {
    if (session === null) {
      return
    }

    for (const diagnostic of session.diagnostics) {
      recordDiagnostic({
        code: diagnostic.code,
        severity: diagnostic.severity,
        recoverable: diagnostic.recoverable,
        message: diagnostic.message
      })
    }
  }

  /** 清理已有定时器。 */
  function clearTimer(): void {
    if (timer === null) {
      return
    }

    clearTimeout(timer)
    timer = null
    userEditDeferred = false
  }

  return {
    readSnapshot,
    start,
    flushNext,
    abort,
    retry,
    deferNextFlushForUserEdit,
    destroy
  }
}
