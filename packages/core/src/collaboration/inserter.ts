/**
 * 职责：提供 Gate 6 auto inserter 的最小主通道。
 * 边界：只依赖公开 Editor facade，不访问 Y.Doc、store internals、provider 或 DOM。
 * 协作模块：Editor facade、transaction pipeline、history 和后续 packages/collab provider adapter。
 * 性能/安全约束：默认使用 auto-inserter origin，不进入用户 undo；flush 时才解析稳定 AnchorRef/RangeRef。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import type { Editor, EditorCommandOptions } from '../editor/runtime'
import type { AnchorRef, RangeRef } from '../model/position'
import type { Command, TransactionResult } from '../operations/transaction'

export type InserterMode = 'insert' | 'replace' | 'append'
export type InserterFlushPolicy = 'manual' | 'immediate'
export type InserterUndoScope = 'none' | 'user' | 'auto-inserter'
export type InserterErrorCode =
  | 'AUTO_INSERTER_ANCHOR_UNRESOLVED'
  | 'AUTO_INSERTER_RANGE_REQUIRED'
  | 'AUTO_INSERTER_ANCHOR_REQUIRED'
  | 'AUTO_INSERTER_FLUSH_FAILED'
export type InserterProgressPhase =
  | 'queued'
  | 'anchored'
  | 'streaming'
  | 'flushing'
  | 'committed'
  | 'aborted'
  | 'failed'
  | 'retrying'

export interface InserterProgressEvent {
  readonly requestId: string
  readonly phase: InserterProgressPhase
}

export interface InserterErrorEvent {
  readonly requestId: string
  readonly error: InserterError
}

export interface InserterError {
  readonly code: InserterErrorCode
  readonly message: string
  readonly recoverable: boolean
  readonly requestId: string
  readonly cause?: unknown
}

export interface InserterOptions {
  readonly requestId: string
  readonly anchor?: AnchorRef
  readonly range?: RangeRef
  readonly mode?: InserterMode
  readonly flushPolicy?: InserterFlushPolicy
  readonly undoScope?: InserterUndoScope
  readonly signal?: AbortSignal
  readonly onProgress?: (event: InserterProgressEvent) => void
  readonly onError?: (event: InserterErrorEvent) => void
}

export interface InserterRetryInput {
  readonly anchor?: AnchorRef
  readonly range?: RangeRef
  readonly mode?: InserterMode
}

export interface Inserter {
  /** 将文本加入待 flush 队列。 */
  queue(text: string): void
  /** 写入文本并按当前策略立即 flush。 */
  write(text: string): TransactionResult | null
  /** 将已排队文本通过 Editor facade 写入文档。 */
  flush(): TransactionResult | null
  /** 使用新的稳定锚点或范围重试最近一次可恢复 flush。 */
  retry(input?: InserterRetryInput): TransactionResult | null
  /** 终止当前插入器并丢弃尚未 flush 的文本。 */
  abort(reason?: unknown): void
}

export type TextInserterMode = InserterMode
export type TextInserterFlushPolicy = InserterFlushPolicy
export type TextInserterUndoScope = InserterUndoScope
export type TextInserterErrorCode = InserterErrorCode
export type TextInserterProgressPhase = InserterProgressPhase
export type TextInserterProgressEvent = InserterProgressEvent
export type TextInserterErrorEvent = InserterErrorEvent
export type TextInserterError = InserterError
export type TextInserterOptions = InserterOptions
export type TextInserterRetryInput = InserterRetryInput
export type TextInserter = Inserter

const AUTO_INSERTER_ORIGIN = 'auto-inserter'

/**
 * 创建自动插入器。
 */
export function createInserter(editor: Editor, options: InserterOptions): Inserter {
  let pendingText = ''
  let aborted = false
  let retryInput: InserterRetryInput | undefined

  const emitProgress = (phase: InserterProgressPhase): void => {
    options.onProgress?.({
      requestId: options.requestId,
      phase
    })
  }

  const emitFailed = (error: InserterError): void => {
    emitProgress('failed')
    options.onError?.({
      requestId: options.requestId,
      error
    })
  }

  const markAborted = (reason?: unknown): void => {
    if (aborted) {
      return
    }

    aborted = true
    void reason
    pendingText = ''
    emitProgress('aborted')
  }

  if (options.signal?.aborted === true) {
    markAborted(options.signal.reason)
  } else {
    options.signal?.addEventListener('abort', () => markAborted(options.signal?.reason), { once: true })
  }

  return {
    /** 将文本加入待 flush 队列。 */
    queue(text: string): void {
      if (aborted || text.length === 0) {
        return
      }

      pendingText += text
      emitProgress('queued')

      if (options.flushPolicy === 'immediate') {
        this.flush()
      }
    },

    /** 写入文本并按当前策略立即 flush。 */
    write(text: string): TransactionResult | null {
      this.queue(text)

      return this.flush()
    },

    /** 将已排队文本通过 Editor facade 写入文档。 */
    flush(): TransactionResult | null {
      if (aborted || pendingText.length === 0) {
        return null
      }

      const text = pendingText

      try {
        const command = createFlushCommand(editor, createActiveOptions(options, retryInput), text)

        pendingText = ''
        emitProgress('anchored')
        emitProgress('streaming')

        if (aborted) {
          return null
        }

        emitProgress('flushing')

        const result = editor.executeCommand(command, createCommandOptions(options))

        retryInput = undefined
        emitProgress('committed')

        return result
      } catch (error) {
        const inserterError = normalizeInserterError(options.requestId, error)

        if (inserterError.recoverable) {
          pendingText = text
        }

        emitFailed(inserterError)

        return null
      }
    },

    /** 使用新的稳定锚点或范围重试最近一次可恢复 flush。 */
    retry(input: InserterRetryInput = {}): TransactionResult | null {
      if (aborted || pendingText.length === 0) {
        return null
      }

      retryInput = input
      emitProgress('retrying')

      return this.flush()
    },

    /** 终止当前插入器并丢弃尚未 flush 的文本。 */
    abort(reason?: unknown): void {
      markAborted(reason)
    }
  }
}

/**
 * 创建中立文本插入器，供高级包基于位置或范围接入事务管线。
 */
export function createTextInserter(editor: Editor, options: TextInserterOptions): TextInserter {
  return createInserter(editor, options)
}

/**
 * 合并 retry 覆盖项，保持 requestId、undo scope 和 listener 不变。
 */
function createActiveOptions(options: InserterOptions, retryInput: InserterRetryInput | undefined): InserterOptions {
  if (retryInput === undefined) {
    return options
  }

  return {
    ...options,
    ...(retryInput.anchor === undefined ? {} : { anchor: retryInput.anchor }),
    ...(retryInput.range === undefined ? {} : { range: retryInput.range }),
    ...(retryInput.mode === undefined ? {} : { mode: retryInput.mode })
  }
}

/**
 * 按插入模式构造最小 command。
 */
function createFlushCommand(editor: Editor, options: InserterOptions, text: string): Command {
  const mode = options.mode ?? 'insert'

  if (mode === 'replace') {
    const range = options.range

    if (range === undefined) {
      throw createInserterError(
        'AUTO_INSERTER_RANGE_REQUIRED',
        'replace 模式需要稳定 range',
        false,
        options.requestId
      )
    }

    return {
      name: 'autoInsertReplace',
      operations: [
        {
          kind: 'deleteRange',
          range: {
            anchor: editor.resolveTextPosition(range.anchor),
            focus: editor.resolveTextPosition(range.focus)
          }
        },
        {
          kind: 'insertText',
          at: editor.resolveTextPosition(range.anchor),
          text
        }
      ]
    }
  }

  const anchor = options.anchor ?? options.range?.focus

  if (anchor === undefined) {
    throw createInserterError(
      'AUTO_INSERTER_ANCHOR_REQUIRED',
      `${mode} 模式需要稳定 anchor`,
      false,
      options.requestId
    )
  }

  return {
    name: mode === 'append' ? 'autoInsertAppend' : 'autoInsert',
    operations: [{
      kind: 'insertText',
      at: editor.resolveTextPosition(anchor),
      text
    }]
  }
}

/**
 * 构造 executeCommand 使用的事务选项。
 */
function createCommandOptions(options: InserterOptions): EditorCommandOptions {
  return {
    origin: options.undoScope === 'user' ? 'local-user' : AUTO_INSERTER_ORIGIN,
    ...(options.undoScope === 'auto-inserter' ? { historyScope: 'auto-inserter' as const } : {}),
    requestId: options.requestId
  }
}

/**
 * 把底层 Editor 错误归一化为 auto inserter 公开错误。
 */
function normalizeInserterError(requestId: string, error: unknown): InserterError {
  if (isInserterError(error)) {
    return error
  }

  if (readErrorCode(error) === 'OPERATION_ANCHOR_UNRESOLVED') {
    return createInserterError(
      'AUTO_INSERTER_ANCHOR_UNRESOLVED',
      'auto inserter 的稳定锚点已无法解析',
      true,
      requestId,
      error
    )
  }

  return createInserterError(
    'AUTO_INSERTER_FLUSH_FAILED',
    readErrorMessage(error),
    false,
    requestId,
    error
  )
}

/**
 * 创建 auto inserter 结构化错误。
 */
function createInserterError(
  code: InserterErrorCode,
  message: string,
  recoverable: boolean,
  requestId: string,
  cause?: unknown
): InserterError {
  return cause === undefined
    ? {
      code,
      message,
      recoverable,
      requestId
    }
    : {
      code,
      message,
      recoverable,
      requestId,
      cause
    }
}

/**
 * 判断未知错误是否已经是 auto inserter 结构化错误。
 */
function isInserterError(error: unknown): error is InserterError {
  return typeof error === 'object' &&
    error !== null &&
    readErrorCode(error) !== undefined &&
    typeof (error as { readonly recoverable?: unknown }).recoverable === 'boolean' &&
    typeof (error as { readonly requestId?: unknown }).requestId === 'string'
}

/**
 * 读取未知错误上的稳定 code 字段。
 */
function readErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined
  }

  const code = (error as { readonly code?: unknown }).code

  return typeof code === 'string' ? code : undefined
}

/**
 * 读取未知错误上的 message 字段。
 */
function readErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return 'auto inserter flush failed'
}
