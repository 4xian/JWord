/**
 * 职责：在 zip.js 解析前直接校验 native ZIP32 中央目录和全部本地记录区间。
 * 边界：不解压 entry、不解析业务 JSON，也不修改 formatVersion。
 * 协作模块：bounded-zip-reader.ts、package-entry-name.ts 和固定预算模块。
 * 性能/安全约束：拒绝 ZIP64、加密、重复/穿越名称、目录内容和任意记录 overlap。
 * 实现说明：只接受单磁盘 ZIP32，所有范围运算均先验证输入边界。
 */

import { createPackageError } from './diagnostics.js'
import { validateUniqueNativePackageEntryNames } from './package-entry-name.js'
import {
  JWORD_NATIVE_PACKAGE_LIMITS,
  assertNativePackageCompressionRatio,
  assertNativePackageLimit,
  readNativePackageEntryLimit
} from './package-read-budget.js'

export interface NativeZipPreflightEntry {
  readonly name: string
  readonly directory: boolean
  readonly flags: number
  readonly compressionMethod: number
  readonly compressedSize: number
  readonly uncompressedSize: number
  readonly localHeaderOffset: number
  readonly dataOffset: number
  readonly recordEnd: number
}

export interface NativeZipPreflightResult {
  readonly entries: readonly NativeZipPreflightEntry[]
  readonly centralDirectoryOffset: number
  readonly centralDirectorySize: number
}

const textDecoder = new TextDecoder('utf-8', { fatal: true })

/** 校验原始 ZIP32 结构并返回后续读取所需的可信元数据。 */
export function preflightNativeZip(
  bytes: Uint8Array,
  requestId?: string
): NativeZipPreflightResult {
  assertNativePackageLimit(bytes.byteLength, JWORD_NATIVE_PACKAGE_LIMITS.inputBytes, requestId)

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const eocdOffset = findEndOfCentralDirectory(view, requestId)
  const diskNumber = readUint16(view, eocdOffset + 4, requestId)
  const centralDisk = readUint16(view, eocdOffset + 6, requestId)
  const diskEntryCount = readUint16(view, eocdOffset + 8, requestId)
  const entryCount = readUint16(view, eocdOffset + 10, requestId)
  const centralDirectorySize = readUint32(view, eocdOffset + 12, requestId)
  const centralDirectoryOffset = readUint32(view, eocdOffset + 16, requestId)
  const commentLength = readUint16(view, eocdOffset + 20, requestId)

  if (
    diskNumber !== 0 ||
    centralDisk !== 0 ||
    diskEntryCount !== entryCount ||
    entryCount === 0xffff ||
    centralDirectorySize === 0xffffffff ||
    centralDirectoryOffset === 0xffffffff ||
    eocdOffset + 22 + commentLength !== bytes.byteLength
  ) {
    throwInvalidZip(requestId)
  }

  assertNativePackageLimit(entryCount, JWORD_NATIVE_PACKAGE_LIMITS.entryCount, requestId)
  assertRange(centralDirectoryOffset, centralDirectorySize, eocdOffset, requestId)
  rejectZip64Tail(view, centralDirectoryOffset + centralDirectorySize, eocdOffset, requestId)

  const entries = readCentralDirectoryEntries(
    bytes,
    view,
    centralDirectoryOffset,
    centralDirectorySize,
    entryCount,
    requestId
  )

  validateUniqueNativePackageEntryNames(entries, requestId)
  validateEntryRanges(entries, centralDirectoryOffset, requestId)
  validateDeclaredBudgets(entries, requestId)

  return {
    entries,
    centralDirectoryOffset,
    centralDirectorySize
  }
}

/** 查找位于输入末尾允许范围内的 EOCD。 */
function findEndOfCentralDirectory(view: DataView, requestId?: string): number {
  const minimumOffset = Math.max(0, view.byteLength - 22 - 0xffff)

  for (let offset = view.byteLength - 22; offset >= minimumOffset; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      return offset
    }
  }

  throwInvalidZip(requestId)
}

/** 读取并校验中央目录中的全部 entry。 */
function readCentralDirectoryEntries(
  bytes: Uint8Array,
  view: DataView,
  centralOffset: number,
  centralSize: number,
  entryCount: number,
  requestId?: string
): NativeZipPreflightEntry[] {
  const entries: NativeZipPreflightEntry[] = []
  let offset = centralOffset

  for (let index = 0; index < entryCount; index += 1) {
    assertSignature(view, offset, 0x02014b50, requestId)
    assertRange(offset, 46, view.byteLength, requestId)

    const flags = readUint16(view, offset + 8, requestId)
    const compressionMethod = readUint16(view, offset + 10, requestId)
    const compressedSize = readUint32(view, offset + 20, requestId)
    const uncompressedSize = readUint32(view, offset + 24, requestId)
    const nameLength = readUint16(view, offset + 28, requestId)
    const extraLength = readUint16(view, offset + 30, requestId)
    const commentLength = readUint16(view, offset + 32, requestId)
    const diskStart = readUint16(view, offset + 34, requestId)
    const localHeaderOffset = readUint32(view, offset + 42, requestId)
    const recordLength = 46 + nameLength + extraLength + commentLength

    assertRange(offset, recordLength, centralOffset + centralSize, requestId)

    if (
      flags & 0x0001 ||
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      localHeaderOffset === 0xffffffff ||
      diskStart === 0xffff ||
      diskStart !== 0 ||
      containsZip64Extra(view, offset + 46 + nameLength, extraLength, requestId)
    ) {
      throwInvalidZip(requestId)
    }

    const name = decodeEntryName(bytes.subarray(offset + 46, offset + 46 + nameLength), flags, requestId)
    const directory = name.endsWith('/')
    const local = readLocalEntry(
      bytes,
      view,
      name,
      flags,
      compressionMethod,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
      directory,
      requestId
    )

    entries.push(local)
    offset += recordLength
  }

  if (offset !== centralOffset + centralSize) {
    throwInvalidZip(requestId)
  }

  return entries
}

/** 校验中央目录对应的本地记录并计算完整数据区间。 */
function readLocalEntry(
  bytes: Uint8Array,
  view: DataView,
  centralName: string,
  centralFlags: number,
  centralCompressionMethod: number,
  compressedSize: number,
  uncompressedSize: number,
  localHeaderOffset: number,
  directory: boolean,
  requestId?: string
): NativeZipPreflightEntry {
  assertSignature(view, localHeaderOffset, 0x04034b50, requestId)
  assertRange(localHeaderOffset, 30, view.byteLength, requestId)

  const flags = readUint16(view, localHeaderOffset + 6, requestId)
  const compressionMethod = readUint16(view, localHeaderOffset + 8, requestId)
  const localCompressedSize = readUint32(view, localHeaderOffset + 18, requestId)
  const localUncompressedSize = readUint32(view, localHeaderOffset + 22, requestId)
  const nameLength = readUint16(view, localHeaderOffset + 26, requestId)
  const extraLength = readUint16(view, localHeaderOffset + 28, requestId)
  const headerLength = 30 + nameLength + extraLength

  assertRange(localHeaderOffset, headerLength, view.byteLength, requestId)

  const name = decodeEntryName(
    bytes.subarray(localHeaderOffset + 30, localHeaderOffset + 30 + nameLength),
    flags,
    requestId
  )

  if (
    name !== centralName ||
    flags !== centralFlags ||
    compressionMethod !== centralCompressionMethod ||
    localCompressedSize === 0xffffffff ||
    localUncompressedSize === 0xffffffff ||
    containsZip64Extra(view, localHeaderOffset + 30 + nameLength, extraLength, requestId)
  ) {
    throwInvalidZip(requestId)
  }

  if (!(flags & 0x0008) && (localCompressedSize !== compressedSize || localUncompressedSize !== uncompressedSize)) {
    throwInvalidZip(requestId)
  }

  if (directory && (compressedSize !== 0 || uncompressedSize !== 0)) {
    throwInvalidZip(requestId)
  }

  const dataOffset = localHeaderOffset + headerLength
  const dataEnd = dataOffset + compressedSize
  const descriptorLength = flags & 0x0008 ? readDataDescriptorLength(view, dataEnd, requestId) : 0

  assertRange(dataOffset, compressedSize + descriptorLength, view.byteLength, requestId)

  return {
    name,
    directory,
    flags,
    compressionMethod,
    compressedSize,
    uncompressedSize,
    localHeaderOffset,
    dataOffset,
    recordEnd: dataEnd + descriptorLength
  }
}

/** 读取 ZIP32 data descriptor 的长度。 */
function readDataDescriptorLength(view: DataView, offset: number, requestId?: string): number {
  assertRange(offset, 12, view.byteLength, requestId)

  return readUint32(view, offset, requestId) === 0x08074b50 ? 16 : 12
}

/** 校验本地记录互不 overlap 且全部位于中央目录之前。 */
function validateEntryRanges(
  entries: readonly NativeZipPreflightEntry[],
  centralDirectoryOffset: number,
  requestId?: string
): void {
  const sorted = [...entries].sort((left, right) => left.localHeaderOffset - right.localHeaderOffset)

  for (let index = 0; index < sorted.length; index += 1) {
    const entry = sorted[index]
    const next = sorted[index + 1]

    if (entry === undefined || entry.recordEnd > centralDirectoryOffset) {
      throwInvalidZip(requestId)
    }

    if (next !== undefined && entry.recordEnd > next.localHeaderOffset) {
      throwInvalidZip(requestId)
    }
  }
}

/** 校验中央目录声明的单项、总量和压缩比预算。 */
function validateDeclaredBudgets(entries: readonly NativeZipPreflightEntry[], requestId?: string): void {
  let totalUncompressedBytes = 0
  let totalCompressedBytes = 0

  for (const entry of entries) {
    assertNativePackageLimit(entry.uncompressedSize, readNativePackageEntryLimit(entry.name), requestId, entry.name)
    assertNativePackageCompressionRatio(entry.uncompressedSize, entry.compressedSize, requestId, entry.name)
    totalUncompressedBytes += entry.uncompressedSize
    totalCompressedBytes += entry.compressedSize
    assertNativePackageLimit(
      totalUncompressedBytes,
      JWORD_NATIVE_PACKAGE_LIMITS.totalUncompressedBytes,
      requestId
    )
  }

  assertNativePackageCompressionRatio(totalUncompressedBytes, totalCompressedBytes, requestId)
}

/** 拒绝中央目录尾部出现 ZIP64 EOCD 或 locator。 */
function rejectZip64Tail(view: DataView, start: number, end: number, requestId?: string): void {
  for (let offset = start; offset + 4 <= end; offset += 1) {
    const signature = view.getUint32(offset, true)

    if (signature === 0x06064b50 || signature === 0x07064b50) {
      throwInvalidZip(requestId)
    }
  }
}

/** 检查 extra fields 中是否声明 ZIP64。 */
function containsZip64Extra(
  view: DataView,
  offset: number,
  length: number,
  requestId?: string
): boolean {
  const end = offset + length

  assertRange(offset, length, view.byteLength, requestId)

  while (offset < end) {
    assertRange(offset, 4, end, requestId)
    const fieldId = readUint16(view, offset, requestId)
    const fieldLength = readUint16(view, offset + 2, requestId)

    assertRange(offset + 4, fieldLength, end, requestId)
    if (fieldId === 0x0001) {
      return true
    }
    offset += 4 + fieldLength
  }

  return false
}

/** 解码受支持的 ASCII 或 UTF-8 entry 名称。 */
function decodeEntryName(bytes: Uint8Array, flags: number, requestId?: string): string {
  if (!(flags & 0x0800) && bytes.some((byte) => byte > 0x7f)) {
    throwInvalidZip(requestId)
  }

  try {
    return textDecoder.decode(bytes)
  } catch {
    throwInvalidZip(requestId)
  }
}

/** 校验指定范围落在上界内。 */
function assertRange(offset: number, length: number, upperBound: number, requestId?: string): void {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    length < 0 ||
    offset > upperBound - length
  ) {
    throwInvalidZip(requestId)
  }
}

/** 校验 ZIP 记录签名。 */
function assertSignature(view: DataView, offset: number, expected: number, requestId?: string): void {
  assertRange(offset, 4, view.byteLength, requestId)
  if (view.getUint32(offset, true) !== expected) {
    throwInvalidZip(requestId)
  }
}

/** 安全读取小端 uint16。 */
function readUint16(view: DataView, offset: number, requestId?: string): number {
  assertRange(offset, 2, view.byteLength, requestId)

  return view.getUint16(offset, true)
}

/** 安全读取小端 uint32。 */
function readUint32(view: DataView, offset: number, requestId?: string): number {
  assertRange(offset, 4, view.byteLength, requestId)

  return view.getUint32(offset, true)
}

/** 抛出不传播原始 ZIP 内容的稳定错误。 */
function throwInvalidZip(requestId?: string): never {
  throw createPackageError('JWORD_NATIVE_PACKAGE_INVALID', 'JWORD_NATIVE_PACKAGE_INVALID', requestId)
}
