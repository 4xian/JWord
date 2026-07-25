/**
 * 职责：用 zip.js strict reader 和有界 WritableStream 单次读取 native ZIP entry。
 * 边界：不解析业务 JSON，不执行 checksum/schema 校验，也不提供公开预算选项。
 * 协作模块：package-readers.ts、zip-preflight.ts、package-read-budget.ts 和 progress.ts。
 * 性能/安全约束：实际输出在缓存前检查单项、总量、压缩比、JSON 总量和 AbortSignal。
 * 实现说明：读取固定关闭嵌套 Worker 和原生 CompressionStream，统一走已审计 WASM fallback。
 */

import {
  Uint8ArrayReader,
  ZipReader,
  type Entry,
  type FileEntry
} from '@zip.js/zip.js'

import { createPackageError } from './diagnostics.js'
import {
  JWORD_NATIVE_PACKAGE_LIMITS,
  isNativePackageJsonEntry,
  readNativePackageEntryLimit
} from './package-read-budget.js'
import { assertNotAborted, emitProgress } from './progress.js'
import { JWordNativePackageError } from './types.js'
import { preflightNativeZip, type NativeZipPreflightEntry } from './zip-preflight.js'
import type {
  JWordBinaryInput,
  JWordNativeProgressEvent,
  ValidateJWordPackageOptions
} from './types.js'

type ZipReadTerminalReason = 'abort' | 'entry-limit' | 'total-limit' | 'ratio-limit'

interface NativeZipReadContext {
  readonly phase: JWordNativeProgressEvent['phase']
  readonly options: ValidateJWordPackageOptions
  totalOutputBytes: number
  totalCompressedBytes: number
  totalJsonBytes: number
}

export interface NativeZipEntryMetadata {
  readonly name: string
  readonly directory: boolean
  readonly compressedSize: number
  readonly uncompressedSize: number
}

/** 持有已完成原始 preflight 的 zip.js reader 与单次读取缓存。 */
export class BoundedNativeZipReader {
  readonly entries: readonly NativeZipEntryMetadata[]
  private readonly zipReader: ZipReader<unknown>
  private readonly fileEntries: ReadonlyMap<string, FileEntry>
  private readonly preflightEntries: ReadonlyMap<string, NativeZipPreflightEntry>
  private readonly cache = new Map<string, Uint8Array>()
  private readonly context: NativeZipReadContext

  /** 创建内部 reader；调用方应使用 openBoundedNativeZip 完成全部校验。 */
  constructor(
    zipReader: ZipReader<unknown>,
    entries: readonly Entry[],
    preflightEntries: readonly NativeZipPreflightEntry[],
    phase: JWordNativeProgressEvent['phase'],
    options: ValidateJWordPackageOptions
  ) {
    this.zipReader = zipReader
    this.fileEntries = new Map(
      entries.flatMap((entry) => entry.directory ? [] : [[entry.filename, entry]])
    )
    this.preflightEntries = new Map(preflightEntries.map((entry) => [entry.name, entry]))
    this.entries = preflightEntries.map((entry) => ({
      name: entry.name,
      directory: entry.directory,
      compressedSize: entry.compressedSize,
      uncompressedSize: entry.uncompressedSize
    }))
    this.context = {
      phase,
      options,
      totalOutputBytes: 0,
      totalCompressedBytes: 0,
      totalJsonBytes: 0
    }
  }

  /** 读取并缓存一个 entry；缺失时返回 undefined。 */
  async readEntry(name: string): Promise<Uint8Array | undefined> {
    assertNotAborted(this.context.options.signal, this.context.options.requestId)
    const cached = this.cache.get(name)

    if (cached !== undefined) {
      return cached
    }

    const entry = this.fileEntries.get(name)
    const metadata = this.preflightEntries.get(name)

    if (entry === undefined || metadata === undefined || metadata.directory) {
      return undefined
    }

    const bytes = await readBoundedEntry(entry, metadata, this.context)

    assertNotAborted(this.context.options.signal, this.context.options.requestId)
    this.cache.set(name, bytes)

    return bytes
  }

  /** 关闭 zip.js reader 并释放其读取资源。 */
  async close(): Promise<void> {
    await this.zipReader.close()
  }
}

/** 规范化输入、执行原始 preflight 和 zip.js 全目录 overlap 检查。 */
export async function openBoundedNativeZip(
  input: JWordBinaryInput,
  phase: JWordNativeProgressEvent['phase'],
  options: ValidateJWordPackageOptions
): Promise<BoundedNativeZipReader> {
  assertNotAborted(options.signal, options.requestId)
  const bytes = await normalizeNativeZipInput(input, options)
  assertNotAborted(options.signal, options.requestId)
  const preflight = preflightNativeZip(bytes, options.requestId)
  assertNotAborted(options.signal, options.requestId)
  const zipReader = new ZipReader(new Uint8ArrayReader(bytes), {
    strictness: 'strict',
    useWebWorkers: false,
    useCompressionStream: false
  })

  try {
    assertNotAborted(options.signal, options.requestId)
    const entries = await zipReader.getEntries({ strictness: 'strict' })
    assertNotAborted(options.signal, options.requestId)
    validateParsedEntries(entries, preflight.entries, options.requestId)
    await validateZipJsEntryOverlaps(entries, options)
    assertNotAborted(options.signal, options.requestId)

    return new BoundedNativeZipReader(zipReader, entries, preflight.entries, phase, options)
  } catch (error) {
    await closeAfterFailure(zipReader)
    throw normalizeZipReadError(error, options.requestId)
  }
}

/** 在分配 Blob/File ArrayBuffer 前检查压缩输入预算。 */
async function normalizeNativeZipInput(
  input: JWordBinaryInput,
  options: ValidateJWordPackageOptions
): Promise<Uint8Array> {
  const byteLength = input instanceof Uint8Array || input instanceof ArrayBuffer
    ? input.byteLength
    : input.size

  if (byteLength > JWORD_NATIVE_PACKAGE_LIMITS.inputBytes) {
    throw createLimitError(options.requestId)
  }

  assertNotAborted(options.signal, options.requestId)

  if (input instanceof Uint8Array) {
    return input
  }
  if (input instanceof ArrayBuffer) {
    return new Uint8Array(input)
  }

  const buffer = await input.arrayBuffer()

  assertNotAborted(options.signal, options.requestId)
  if (buffer.byteLength > JWORD_NATIVE_PACKAGE_LIMITS.inputBytes) {
    throw createLimitError(options.requestId)
  }

  return new Uint8Array(buffer)
}

/** 对比 zip.js 解析结果与原始中央目录可信元数据。 */
function validateParsedEntries(
  entries: readonly Entry[],
  preflightEntries: readonly NativeZipPreflightEntry[],
  requestId?: string
): void {
  if (entries.length !== preflightEntries.length) {
    throw createInvalidPackageError(requestId)
  }

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]
    const expected = preflightEntries[index]

    if (
      entry === undefined ||
      expected === undefined ||
      entry.filename !== expected.name ||
      entry.directory !== expected.directory ||
      entry.compressedSize !== expected.compressedSize ||
      entry.uncompressedSize !== expected.uncompressedSize ||
      entry.compressionMethod !== expected.compressionMethod ||
      entry.encrypted === true ||
      entry.zip64 === true
    ) {
      throw createInvalidPackageError(requestId)
    }
  }
}

/** 要求 zip.js 对全部文件 entry 只执行 overlap 检查而不输出内容。 */
async function validateZipJsEntryOverlaps(
  entries: readonly Entry[],
  options: ValidateJWordPackageOptions
): Promise<void> {
  for (const entry of entries) {
    assertNotAborted(options.signal, options.requestId)
    if (entry.directory) {
      continue
    }

    try {
      await entry.getData(new WritableStream<Uint8Array>({
        /** 拒绝 overlap 预检阶段出现任何实际输出。 */
        write() {
          throw createInvalidPackageError(options.requestId)
        }
      }), {
        ...(options.signal === undefined ? {} : { signal: options.signal }),
        strictness: 'strict',
        checkOverlappingEntryOnly: true,
        useWebWorkers: false,
        useCompressionStream: false
      })
    } catch (error) {
      assertNotAborted(options.signal, options.requestId)
      throw error
    }

    assertNotAborted(options.signal, options.requestId)
  }
}

/** 通过有界 writer 解压一个 entry 并缓存已接受 chunk。 */
async function readBoundedEntry(
  entry: FileEntry,
  metadata: NativeZipPreflightEntry,
  context: NativeZipReadContext
): Promise<Uint8Array> {
  const { options } = context
  const chunks: Uint8Array[] = []
  let entryOutputBytes = 0
  let terminalReason: ZipReadTerminalReason | undefined
  let caught: unknown

  context.totalCompressedBytes += metadata.compressedSize

  /** 只记录首次终止原因。 */
  const setTerminalReason = (reason: ZipReadTerminalReason): void => {
    terminalReason ??= reason
  }
  /** 在依赖开始读取前记录调用方取消。 */
  const abort = (): void => {
    setTerminalReason('abort')
  }

  options.signal?.addEventListener('abort', abort, { once: true })
  if (options.signal?.aborted) {
    setTerminalReason('abort')
  }

  const writer = new WritableStream<Uint8Array>({
    /** 在缓存 chunk 前检查全部实际输出预算。 */
    write(chunk) {
      if (options.signal?.aborted) {
        setTerminalReason('abort')
        throw createCancelledError(options.requestId)
      }

      const nextEntryBytes = entryOutputBytes + chunk.byteLength
      const nextTotalBytes = context.totalOutputBytes + chunk.byteLength
      const nextJsonBytes = context.totalJsonBytes + (isNativePackageJsonEntry(metadata.name) ? chunk.byteLength : 0)

      if (
        nextEntryBytes > metadata.uncompressedSize ||
        nextEntryBytes > readNativePackageEntryLimit(metadata.name)
      ) {
        setTerminalReason('entry-limit')
        throw createLimitError(options.requestId, metadata.name)
      }
      if (
        nextTotalBytes > JWORD_NATIVE_PACKAGE_LIMITS.totalUncompressedBytes ||
        nextJsonBytes > JWORD_NATIVE_PACKAGE_LIMITS.totalJsonBytes
      ) {
        setTerminalReason('total-limit')
        throw createLimitError(options.requestId, metadata.name)
      }
      if (
        nextEntryBytes > JWORD_NATIVE_PACKAGE_LIMITS.compressionRatioMinimumOutputBytes &&
        (metadata.compressedSize === 0 || nextEntryBytes > metadata.compressedSize * JWORD_NATIVE_PACKAGE_LIMITS.compressionRatio)
      ) {
        setTerminalReason('ratio-limit')
        throw createLimitError(options.requestId, metadata.name)
      }
      if (
        nextTotalBytes > JWORD_NATIVE_PACKAGE_LIMITS.compressionRatioMinimumOutputBytes &&
        (
          context.totalCompressedBytes === 0 ||
          nextTotalBytes > context.totalCompressedBytes * JWORD_NATIVE_PACKAGE_LIMITS.compressionRatio
        )
      ) {
        setTerminalReason('ratio-limit')
        throw createLimitError(options.requestId, metadata.name)
      }

      entryOutputBytes = nextEntryBytes
      context.totalOutputBytes = nextTotalBytes
      context.totalJsonBytes = nextJsonBytes
      chunks.push(chunk.slice())
      emitProgress(context.phase, context.totalOutputBytes, options)
    }
  })

  try {
    await entry.getData(writer, {
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      strictness: 'strict',
      checkOverlappingEntry: true,
      useWebWorkers: false,
      useCompressionStream: false
    })
  } catch (error) {
    caught = error
  } finally {
    options.signal?.removeEventListener('abort', abort)
  }

  if (terminalReason === 'abort') {
    throw createCancelledError(options.requestId)
  }
  if (terminalReason !== undefined) {
    throw createLimitError(options.requestId, metadata.name)
  }
  if (caught !== undefined) {
    throw normalizeZipReadError(caught, options.requestId)
  }

  assertNotAborted(options.signal, options.requestId)

  return concatenateChunks(chunks, entryOutputBytes)
}

/** 拼接已经通过预算检查的输出 chunk。 */
function concatenateChunks(chunks: readonly Uint8Array[], byteLength: number): Uint8Array {
  const output = new Uint8Array(byteLength)
  let offset = 0

  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }

  return output
}

/** 关闭失败路径上的 zip.js reader，保留原始失败分类。 */
async function closeAfterFailure(zipReader: ZipReader<unknown>): Promise<void> {
  try {
    await zipReader.close()
  } catch {
    // 原始读取失败优先，关闭异常不进入公开 diagnostic。
  }
}

/** 把未知 zip.js 异常收口为不含依赖文本的稳定错误。 */
function normalizeZipReadError(error: unknown, requestId?: string): JWordNativePackageError {
  if (error instanceof JWordNativePackageError) {
    return error
  }

  return createInvalidPackageError(requestId)
}

/** 创建稳定 package invalid 错误。 */
function createInvalidPackageError(requestId?: string): JWordNativePackageError {
  return createPackageError('JWORD_NATIVE_PACKAGE_INVALID', 'JWORD_NATIVE_PACKAGE_INVALID', requestId)
}

/** 创建稳定资源预算错误。 */
function createLimitError(requestId?: string, entry?: string): JWordNativePackageError {
  return createPackageError(
    'JWORD_NATIVE_PACKAGE_RESOURCE_LIMIT_EXCEEDED',
    'JWORD_NATIVE_PACKAGE_RESOURCE_LIMIT_EXCEEDED',
    requestId,
    entry
  )
}

/** 创建稳定调用方取消错误。 */
function createCancelledError(requestId?: string): JWordNativePackageError {
  return createPackageError('JWORD_NATIVE_USER_CANCELLED', 'JWORD_NATIVE_USER_CANCELLED', requestId)
}
