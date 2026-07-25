/**
 * 职责：定义 native package 读写两侧共享且不可由调用方放宽的固定预算。
 * 边界：只执行数值预算判断，不读取 ZIP、JSON 或 document schema。
 * 协作模块：zip-preflight.ts、bounded-zip-reader.ts 和 package-codec.ts。
 * 性能/安全约束：所有计算保持在 Number.MAX_SAFE_INTEGER 内并在分配前执行。
 * 实现说明：限额来自 Phase 2A 已批准的首批生产预算。
 */

import { createPackageError } from './diagnostics.js'

export const JWORD_NATIVE_PACKAGE_LIMITS = {
  inputBytes: 64 * 1024 * 1024,
  entryCount: 1024,
  entryNameBytes: 512,
  packedResourceBytes: 32 * 1024 * 1024,
  totalUncompressedBytes: 128 * 1024 * 1024,
  manifestBytes: 256 * 1024,
  metadataBytes: 1024 * 1024,
  checksumsBytes: 2 * 1024 * 1024,
  documentBytes: 16 * 1024 * 1024,
  totalJsonBytes: 20 * 1024 * 1024,
  itemCount: 1024,
  compressionRatio: 100,
  compressionRatioMinimumOutputBytes: 1024 * 1024,
  jsonDepth: 64,
  jsonValueCount: 500000,
  documentNodeCount: 200000,
  identifierBytes: 256
} as const

const coreEntryLimits: Readonly<Record<string, number>> = {
  'manifest.json': JWORD_NATIVE_PACKAGE_LIMITS.manifestBytes,
  'metadata.json': JWORD_NATIVE_PACKAGE_LIMITS.metadataBytes,
  'checksums.json': JWORD_NATIVE_PACKAGE_LIMITS.checksumsBytes,
  'document.json': JWORD_NATIVE_PACKAGE_LIMITS.documentBytes
}

/** 检查数值不超过指定固定预算。 */
export function assertNativePackageLimit(
  actual: number,
  limit: number,
  requestId?: string,
  entry?: string
): void {
  if (!Number.isSafeInteger(actual) || actual < 0 || actual > limit) {
    throw createPackageError(
      'JWORD_NATIVE_PACKAGE_RESOURCE_LIMIT_EXCEEDED',
      'JWORD_NATIVE_PACKAGE_RESOURCE_LIMIT_EXCEEDED',
      requestId,
      entry
    )
  }
}

/** 读取指定 entry 的实际输出上限。 */
export function readNativePackageEntryLimit(entry: string): number {
  return coreEntryLimits[entry] ?? JWORD_NATIVE_PACKAGE_LIMITS.packedResourceBytes
}

/** 判断 entry 是否属于四个核心 JSON。 */
export function isNativePackageJsonEntry(entry: string): boolean {
  return Object.hasOwn(coreEntryLimits, entry)
}

/** 检查实际输出压缩比不超过固定上限。 */
export function assertNativePackageCompressionRatio(
  outputBytes: number,
  compressedBytes: number,
  requestId?: string,
  entry?: string
): void {
  if (outputBytes <= JWORD_NATIVE_PACKAGE_LIMITS.compressionRatioMinimumOutputBytes) {
    return
  }

  if (compressedBytes === 0 || outputBytes > compressedBytes * JWORD_NATIVE_PACKAGE_LIMITS.compressionRatio) {
    throw createPackageError(
      'JWORD_NATIVE_PACKAGE_RESOURCE_LIMIT_EXCEEDED',
      'JWORD_NATIVE_PACKAGE_RESOURCE_LIMIT_EXCEEDED',
      requestId,
      entry
    )
  }
}
