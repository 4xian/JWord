/**
 * @vitest-environment node
 *
 * 职责：通过 native 公开 API 与 Worker contract 锁定 AbortSignal 终止语义。
 * 边界：不调用内部 ZIP reader，不暴露测试专用生产入口。
 * 协作模块：packages/native/src/index.ts、worker.ts 和安全 ZIP fixture。
 * 性能/安全约束：取消必须在 5 秒内拒绝，拒绝后观察 100 ms 不再接受输出。
 * 实现说明：大文档使用预算内确定性字节生成，不提交大型二进制 fixture。
 */

import { Buffer } from 'node:buffer'

import { describe, expect, it } from 'vitest'

import {
  createCancelJWordNativeRequest,
  createLoadJWordNativeRequest,
  loadJWordDocument,
  saveJWordDocument,
  validateJWordPackage,
  type JWordNativeProgressEvent,
  type JWordNativeWorkerEvent
} from '../src/index'
import { dispatchJWordNativeWorkerRequest } from '../src/worker'
import { createStoredJWordPackage } from './native-package-security-fixtures'

/** 锁定 native 公开 API 与 Worker contract 的取消语义。 */
describe('@4xian/jword-native AbortSignal security seam', () => {
  /** 验证 load 与 validate 在最终进度回调取消时拒绝返回结果。 */
  it.each([
    ['load', loadJWordDocument],
    ['validate', validateJWordPackage]
  ] as const)('rejects %s when the final progress callback aborts before return', async (_label, run) => {
    const controller = new AbortController()
    let finalProgressCount = 0

    const promise = run(createStoredJWordPackage(), {
      signal: controller.signal,
      requestId: `native-final-${_label}-abort`,
      /** 在最终读取进度回调中同步触发取消。 */
      onProgress(event) {
        if (event.loaded === 1 && event.total === 1) {
          finalProgressCount += 1
          controller.abort()
        }
      }
    })

    await expect(promise).rejects.toMatchObject({
      code: 'JWORD_NATIVE_USER_CANCELLED',
      requestId: `native-final-${_label}-abort`
    })
    expect(finalProgressCount).toBe(1)
  })

  /** 验证 save 在最终进度回调取消时拒绝返回结果。 */
  it('rejects save when the final progress callback aborts before return', async () => {
    const controller = new AbortController()
    const requestId = 'native-final-save-abort'
    let finalProgressCount = 0
    const promise = saveJWordDocument({
      kind: 'document',
      id: 'document-native-final-save-abort',
      sections: []
    }, {
      signal: controller.signal,
      requestId,
      /** 在最终保存进度回调中同步触发取消。 */
      onProgress: (event) => {
        if (event.total !== undefined && event.total !== 100 && event.loaded === event.total && event.loaded > 0) {
          finalProgressCount += 1
          controller.abort()
        }
      }
    })

    await expect(promise).rejects.toMatchObject({
      code: 'JWORD_NATIVE_USER_CANCELLED',
      requestId
    })
    expect(finalProgressCount).toBe(1)
  })

  /** 验证 Blob 规范化期间取消时不会产生正数输出。 */
  it('cancels during Blob normalization before any positive output', async () => {
    const controller = new AbortController()
    const progress: number[] = []
    const input = {
      size: 0,
      /** 在 Blob 物化阶段同步触发取消。 */
      async arrayBuffer() {
        controller.abort()

        return new ArrayBuffer(0)
      }
    } as Blob

    await expect(loadJWordDocument(input, {
      signal: controller.signal,
      requestId: 'native-input-normalization-abort',
      /** 记录输入规范化取消前发出的全部进度。 */
      onProgress(event) {
        progress.push(event.loaded)
      }
    })).rejects.toMatchObject({
      code: 'JWORD_NATIVE_USER_CANCELLED',
      requestId: 'native-input-normalization-abort'
    })
    expect(progress.every(
      /** 检查取消前的每个进度值都保持为零。 */
      (loaded) => loaded === 0
    )).toBe(true)
  })

  /** 验证 reader 注册取消监听时可在首次 writer 调用前终止。 */
  it.each([
    ['load', loadJWordDocument],
    ['validate', validateJWordPackage]
  ] as const)('maps a zip.js abort before the first writer call for %s', async (_label, run) => {
    const controller = new AbortController()
    const writer = installWriterProbe()
    const signal = abortWhenReaderRegistersSignal(controller)

    try {
      await expect(run(createStoredJWordPackage(), {
        signal,
        requestId: `native-zero-write-${_label}-abort`
      })).rejects.toMatchObject({
        code: 'JWORD_NATIVE_USER_CANCELLED',
        requestId: `native-zero-write-${_label}-abort`
      })
      expect(writer.snapshot()).toEqual({
        invocationCount: 0,
        acceptedChunkCount: 0,
        outputBytes: 0
      })

      await waitForOutputStopObservation()
      expect(writer.snapshot()).toEqual({
        invocationCount: 0,
        acceptedChunkCount: 0,
        outputBytes: 0
      })
    } finally {
      writer.restore()
    }
  })

  /** 验证已经接受 chunk 的 direct API 取消后不再继续输出。 */
  it.each([
    ['load', loadJWordDocument],
    ['validate', validateJWordPackage]
  ] as const)('interrupts an accepted %s chunk and stops output after rejection', async (_label, run) => {
    const controller = new AbortController()
    const writer = installWriterProbe()
    const progress = createAbortProgressProbe(controller, writer)
    const promise = run(createLargeBudgetedPackage(), {
      signal: controller.signal,
      requestId: `native-midstream-${_label}-abort`,
      onProgress: progress.onProgress
    })

    try {
      await expectCancellationWithin(promise, `native-midstream-${_label}-abort`)
      expect(progress.abortedAt()).toBeGreaterThan(0)
      expect(writer.snapshot().invocationCount).toBeGreaterThan(0)
      expect(progress.acceptedChunkCount()).toBeGreaterThan(0)
      expect(progress.outputBytes()).toBeGreaterThan(0)
      const settledProgressSnapshot = progress.snapshot()
      const settledWriterSnapshot = writer.snapshot()

      await waitForOutputStopObservation()
      expect(progress.snapshot()).toEqual(settledProgressSnapshot)
      expect(writer.snapshot()).toEqual(settledWriterSnapshot)
    } finally {
      writer.restore()
    }
  })

  /** 验证 load 与 validate 在首个 entry 完成后取消时不会读取后续 entry。 */
  it.each([
    ['load', loadJWordDocument],
    ['validate', validateJWordPackage]
  ] as const)('stops %s before reading a second entry when cancellation follows the first completed entry', async (_label, run) => {
    const controller = new AbortController()
    const writer = installWriterProbe()
    const manifestText = JSON.stringify({
      formatVersion: 1,
      schemaVersion: 1,
      createdBy: '@4xian/jword-native',
      minimumReaderVersion: 1,
      featureFlags: [],
      packageEntries: ['manifest.json', 'document.json', 'metadata.json', 'checksums.json', 'resources/'],
      resources: []
    })
    const firstEntryBytes = new TextEncoder().encode(manifestText).byteLength
    let cancelledAtLoaded = 0
    const promise = run(createStoredJWordPackage({ manifestText }), {
      signal: controller.signal,
      requestId: `native-first-entry-${_label}-abort`,
      /** 在首个 entry 的全部字节输出后同步触发取消。 */
      onProgress(event) {
        if (event.total === undefined && event.loaded === firstEntryBytes) {
          cancelledAtLoaded = event.loaded
          controller.abort()
        }
      }
    })

    try {
      await expectCancellationWithin(promise, `native-first-entry-${_label}-abort`)
      expect(cancelledAtLoaded).toBe(firstEntryBytes)
      expect(writer.snapshot().invocationCount).toBe(1)
      const settledWriterSnapshot = writer.snapshot()

      await waitForOutputStopObservation()
      expect(writer.snapshot()).toEqual(settledWriterSnapshot)
    } finally {
      writer.restore()
    }
  })

  /** 验证 Worker 中途取消当前读取且不发送结果或部分文档。 */
  it('cancels an in-flight Worker read without posting a result or partial document', async () => {
    const requestId = 'native-worker-midstream-load-cancel'
    const posted: JWordNativeWorkerEvent[] = []
    const writer = installWriterProbe()
    let cancelledAtLoaded = 0
    let cancelTask: Promise<JWordNativeWorkerEvent> | undefined
    const task = dispatchJWordNativeWorkerRequest(
      createLoadJWordNativeRequest(requestId, createLargeBudgetedPackage()),
      /** 记录 Worker 事件并在当前 entry 读取中段派发取消。 */
      (event) => {
        posted.push(event)

        if (
          event.type === 'progress' &&
          event.progress.total === undefined &&
          event.progress.loaded > 512 * 1024 &&
          cancelTask === undefined
        ) {
          cancelledAtLoaded = event.progress.loaded
          cancelTask = dispatchJWordNativeWorkerRequest(createCancelJWordNativeRequest(requestId),
            /** 记录 Worker cancel contract 返回的稳定事件。 */
            (cancelEvent) => {
              posted.push(cancelEvent)
            })
        }
      }
    )

    try {
      const event = await task
      await cancelTask

      expect(cancelledAtLoaded).toBeGreaterThan(512 * 1024)
      expect(cancelledAtLoaded).toBeLessThan(2 * 1024 * 1024)
      expect(event).toMatchObject({
        type: 'error',
        requestId,
        error: {
          code: 'JWORD_NATIVE_USER_CANCELLED'
        }
      })
      expect(posted.some(
        /** 检查取消后的事件流没有任何结果载荷。 */
        (item) => 'result' in item
      )).toBe(false)
      expect(posted).toContainEqual(expect.objectContaining({
        type: 'error',
        requestId,
        error: expect.objectContaining({
          code: 'JWORD_NATIVE_WORKER_CANCELLED'
        })
      }))
      const settledPosted = [...posted]
      const settledWriterSnapshot = writer.snapshot()

      await waitForOutputStopObservation()
      expect(posted).toEqual(settledPosted)
      expect(writer.snapshot()).toEqual(settledWriterSnapshot)
    } finally {
      writer.restore()
    }
  })
})

interface AbortProgressProbe {
  /** 处理 direct API 发出的读取进度并在阈值处取消。 */
  readonly onProgress: (event: JWordNativeProgressEvent) => void
  /** 返回实际触发取消的时间戳。 */
  readonly abortedAt: () => number
  /** 返回取消前已经接受的 chunk 数量。 */
  readonly acceptedChunkCount: () => number
  /** 返回取消前已经接受的输出字节数。 */
  readonly outputBytes: () => number
  /** 返回当前进度与 writer 计数快照。 */
  readonly snapshot: () => Readonly<{
    invocationCount: number
    acceptedChunkCount: number
    outputBytes: number
  }>
}

interface WriterProbe {
  /** 返回当前 writer 调用与接受量快照。 */
  readonly snapshot: () => Readonly<{
    invocationCount: number
    acceptedChunkCount: number
    outputBytes: number
  }>
  /** 记录已经通过预算 writer 接受的 chunk 字节数。 */
  readonly recordAcceptedChunk: (byteLength: number) => void
  /** 恢复测试前的原生 WritableStream。 */
  readonly restore: () => void
}

/** 在测试范围内记录 native bounded writer 的真实 sink 调用。 */
function installWriterProbe(): WriterProbe {
  const nativeWritableStream = globalThis.WritableStream
  let invocationCount = 0
  let acceptedChunkCount = 0
  let outputBytes = 0

  class ProbedWritableStream<T> extends nativeWritableStream<T> {
    /** 包装 sink writer 并统计真实调用次数。 */
    constructor(underlyingSink?: UnderlyingSink<T>, strategy?: QueuingStrategy<T>) {
      if (underlyingSink !== undefined && typeof underlyingSink.write === 'function') {
        const originalWrite = underlyingSink.write
        underlyingSink = {
          ...underlyingSink,
          /** 转发 chunk 前记录 writer 调用。 */
          write(chunk, controller) {
            invocationCount += 1
            return originalWrite.call(this, chunk, controller)
          }
        }
      }
      super(underlyingSink, strategy)
    }
  }

  globalThis.WritableStream = ProbedWritableStream as typeof WritableStream

  return {
    /** 返回当前 writer 调用与接受量快照。 */
    snapshot: () => ({ invocationCount, acceptedChunkCount, outputBytes }),
    /** 记录 bounded writer 已接受的 chunk 字节数。 */
    recordAcceptedChunk(byteLength) {
      acceptedChunkCount += 1
      outputBytes += byteLength
    },
    /** 恢复测试前的原生 WritableStream。 */
    restore() {
      globalThis.WritableStream = nativeWritableStream
    }
  }
}

/** 在 native reader 注册 abort listener 时触发 zip.js 的零写入取消。 */
function abortWhenReaderRegistersSignal(controller: AbortController): AbortSignal {
  const signal = controller.signal
  const addEventListener = signal.addEventListener.bind(signal) as (
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions
  ) => void
  let readerListenerRegistered = false

  /** 转发 listener 注册，并在 reader 首次订阅 abort 时同步取消。 */
  signal.addEventListener = ((type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) => {
    addEventListener(type, listener, options)
    if (type === 'abort' && !readerListenerRegistered) {
      readerListenerRegistered = true
      controller.abort()
    }
  }) as AbortSignal['addEventListener']

  return signal
}

/** 创建在大 document 已接受正数输出后同步取消的进度探针。 */
function createAbortProgressProbe(controller: AbortController, writer: WriterProbe): AbortProgressProbe {
  let abortedAt = 0
  let acceptedChunkCount = 0
  let outputBytes = 0

  return {
    /** 在收到足够正数输出后同步取消并记录接受量。 */
    onProgress(event) {
      if (event.loaded <= outputBytes || event.total !== undefined) {
        return
      }

      const previousOutputBytes = outputBytes
      acceptedChunkCount += 1
      outputBytes = event.loaded
      writer.recordAcceptedChunk(outputBytes - previousOutputBytes)
      if (outputBytes > 512 * 1024 && abortedAt === 0) {
        abortedAt = Date.now()
        controller.abort()
      }
    },
    /** 返回实际触发取消的时间戳。 */
    abortedAt: () => abortedAt,
    /** 返回取消前已经接受的 chunk 数量。 */
    acceptedChunkCount: () => acceptedChunkCount,
    /** 返回取消前已经接受的输出字节数。 */
    outputBytes: () => outputBytes,
    /** 返回当前进度与 writer 计数快照。 */
    snapshot: () => ({
      invocationCount: writer.snapshot().invocationCount,
      acceptedChunkCount,
      outputBytes
    })
  }
}

/** 创建包含约 2 MiB 高熵开放属性的预算内有效 package。 */
function createLargeBudgetedPackage(): Uint8Array {
  const bytes = new Uint8Array(2 * 1024 * 1024)
  let state = 0x6d2b79f5

  for (let index = 0; index < bytes.length; index += 1) {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    bytes[index] = state & 0xff
  }

  return createStoredJWordPackage({
    documentText: JSON.stringify({
      kind: 'document',
      id: 'document-native-midstream-abort',
      sections: [{
        kind: 'section',
        id: 'section-native-midstream-abort',
        blocks: [{
          kind: 'paragraph',
          id: 'paragraph-native-midstream-abort',
          properties: {
            payload: Buffer.from(bytes).toString('base64')
          },
          runs: []
        }]
      }]
    })
  })
}

/** 断言 direct API 在固定上限内以稳定取消错误拒绝。 */
async function expectCancellationWithin(
  promise: Promise<unknown>,
  requestId: string
): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  const startedAt = Date.now()
  const timeoutPromise = new Promise<never>(
    /** 创建固定时限内必须拒绝的超时分支。 */
    (_resolve, reject) => {
      timeout = setTimeout(
        /** 在超时后以明确错误拒绝等待。 */
        () => {
          reject(new Error('native AbortSignal rejection exceeded 5 seconds'))
        },
        5000
      )
    }
  )

  try {
    await expect(Promise.race([promise, timeoutPromise])).rejects.toMatchObject({
      code: 'JWORD_NATIVE_USER_CANCELLED',
      requestId
    })
    expect(Date.now() - startedAt).toBeLessThan(5000)
  } finally {
    clearTimeout(timeout)
  }
}

/** 等待固定窗口以确认拒绝后没有继续接受输出。 */
function waitForOutputStopObservation(): Promise<void> {
  return new Promise(
    /** 创建拒绝后的固定输出观察窗口。 */
    (resolve) => {
      setTimeout(resolve, 100)
    }
  )
}
