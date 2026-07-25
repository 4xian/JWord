/**
 * 职责：动态生成 native package 安全测试所需的小型 ZIP fixture。
 * 边界：只供测试使用，不进入 package exports、dist 或正式 tarball。
 * 协作模块：public-api-security.test.ts、zip-preflight-security.test.ts 和 Gate 4.5 native 公开 seam。
 * 性能/安全约束：fixture 在内存中生成，不提交大型二进制文件。
 * 实现说明：本文件按 Phase 2A 安全回归需要构造最少 ZIP32 记录。
 */

import { createHash } from 'node:crypto'
import { deflateRawSync } from 'node:zlib'

interface StoredZipEntry {
  readonly name: string
  readonly bytes: Uint8Array
  readonly directory?: boolean
  readonly flags?: number
  readonly declaredSizeDelta?: number
  readonly centralCompressedSize?: number
  readonly centralUncompressedSize?: number
  readonly centralLocalHeaderOffset?: number
  readonly centralDiskStart?: number
  readonly centralExtra?: Uint8Array
  readonly localCompressedSize?: number
  readonly localUncompressedSize?: number
  readonly localExtra?: Uint8Array
  readonly compressionMethod?: number
  readonly crcBytes?: Uint8Array
  readonly declaredUncompressedSize?: number
}

export interface StoredJWordPackageOptions {
  readonly checksumEntries?: Readonly<Record<string, unknown>>
  readonly checksumsText?: string
  readonly documentChecksumByteLengthDelta?: number
  readonly documentPaddingBytes?: number
  readonly documentText?: string
  readonly duplicateDocument?: boolean
  readonly manifestOverrides?: Readonly<Record<string, unknown>>
  readonly manifestText?: string
  readonly metadataText?: string
  readonly malformed?:
    | 'archive-zip64-eocd'
    | 'archive-zip64-locator'
    | 'archive-zip64-entry-count'
    | 'archive-zip64-central-size'
    | 'archive-zip64-central-offset'
    | 'directory-content'
    | 'document-output-limit'
    | 'drive-absolute-path'
    | 'encrypted-entry'
    | 'entry-zip64-central-compressed-size'
    | 'entry-zip64-central-uncompressed-size'
    | 'entry-zip64-central-offset'
    | 'entry-zip64-central-disk-start'
    | 'entry-zip64-central-extra'
    | 'entry-zip64-local-compressed-size'
    | 'entry-zip64-local-uncompressed-size'
    | 'entry-zip64-local-extra'
    | 'forged-document-output'
    | 'overlapping-entry'
    | 'oversized-metadata'
    | 'path-traversal'
}

const textEncoder = new TextEncoder()
const zip64Extra = new Uint8Array([0x01, 0x00, 0x00, 0x00])

/** 创建包含核心 JSON entry 的小型 stored `.jword` package。 */
export function createStoredJWordPackage(
  options: StoredJWordPackageOptions = {}
): Uint8Array {
  const documentText = options.documentText ?? JSON.stringify({
      kind: 'document',
      id: 'document-native-security-fixture',
      sections: [],
      ...(options.documentPaddingBytes === undefined
        ? {}
        : { padding: 'x'.repeat(options.documentPaddingBytes) })
    })
  const metadataText = options.metadataText ?? '{}'
  const documentBytes = textEncoder.encode(documentText)
  const metadataBytes = options.malformed === 'oversized-metadata'
    ? new Uint8Array(1024 * 1024 + 1)
    : textEncoder.encode(metadataText)
  const forgedDocumentBytes = options.malformed === 'forged-document-output'
    ? textEncoder.encode(`{"kind":"document","id":"forged-output","sections":[],"padding":"${'x'.repeat(2 * 1024 * 1024)}"}`)
    : options.malformed === 'document-output-limit'
      ? createDeterministicBytes(16 * 1024 * 1024 + 1)
    : undefined
  const declaredDocumentChecksumByteLength = options.malformed === 'forged-document-output'
    ? 1
    : options.malformed === 'document-output-limit'
      ? 16 * 1024 * 1024
      : documentBytes.byteLength + (options.documentChecksumByteLengthDelta ?? 0)
  const checksumEntries = options.checksumEntries ?? {
      'document.json': {
        sha256: sha256Hex(documentBytes),
        byteLength: declaredDocumentChecksumByteLength,
        mime: 'application/json'
      },
      'metadata.json': {
        sha256: sha256Hex(metadataBytes),
        byteLength: metadataBytes.byteLength,
        mime: 'application/json'
      }
    }
  const checksumsText = options.checksumsText ?? JSON.stringify({ entries: checksumEntries })
  const manifestText = options.manifestText ?? JSON.stringify({
    formatVersion: 1,
    schemaVersion: 1,
    createdBy: '@4xian/jword-native',
    minimumReaderVersion: 1,
    featureFlags: [],
    packageEntries: [
      'manifest.json',
      'document.json',
      'metadata.json',
      'checksums.json',
      'resources/'
    ],
    resources: [],
    ...options.manifestOverrides
  })
  const entries: StoredZipEntry[] = [
    ...(options.malformed === 'overlapping-entry'
      ? [{ name: 'hidden.bin', bytes: new Uint8Array([1]), declaredSizeDelta: 1 }]
      : []),
    { name: 'manifest.json', bytes: textEncoder.encode(manifestText) },
    {
      name: 'document.json',
      bytes: forgedDocumentBytes === undefined
        ? documentBytes
        : new Uint8Array(deflateRawSync(forgedDocumentBytes)),
      ...(options.malformed === 'encrypted-entry' ? { flags: 0x0801 } : {}),
      ...(options.malformed === 'entry-zip64-central-compressed-size'
        ? { centralCompressedSize: 0xffffffff }
        : {}),
      ...(options.malformed === 'entry-zip64-central-uncompressed-size'
        ? { centralUncompressedSize: 0xffffffff }
        : {}),
      ...(options.malformed === 'entry-zip64-central-offset'
        ? { centralLocalHeaderOffset: 0xffffffff }
        : {}),
      ...(options.malformed === 'entry-zip64-central-disk-start'
        ? { centralDiskStart: 0xffff }
        : {}),
      ...(options.malformed === 'entry-zip64-central-extra'
        ? { centralExtra: zip64Extra }
        : {}),
      ...(options.malformed === 'entry-zip64-local-compressed-size'
        ? { localCompressedSize: 0xffffffff }
        : {}),
      ...(options.malformed === 'entry-zip64-local-uncompressed-size'
        ? { localUncompressedSize: 0xffffffff }
        : {}),
      ...(options.malformed === 'entry-zip64-local-extra'
        ? { localExtra: zip64Extra }
        : {}),
      ...(forgedDocumentBytes === undefined
        ? {}
        : {
            compressionMethod: 8,
            crcBytes: forgedDocumentBytes,
            declaredUncompressedSize: options.malformed === 'document-output-limit'
              ? 16 * 1024 * 1024
              : 1
          })
    },
    ...(options.duplicateDocument ? [{ name: 'document.json', bytes: documentBytes }] : []),
    ...(options.malformed === 'path-traversal' ? [{ name: '../document.json', bytes: documentBytes }] : []),
    ...(options.malformed === 'drive-absolute-path' ? [{ name: 'C:/payload', bytes: documentBytes }] : []),
    { name: 'metadata.json', bytes: metadataBytes },
    { name: 'checksums.json', bytes: textEncoder.encode(checksumsText) },
    {
      name: 'resources/',
      bytes: options.malformed === 'directory-content' ? new Uint8Array([1]) : new Uint8Array(),
      directory: true
    }
  ]

  return createStoredZip(entries, options.malformed)
}

/** 创建只使用 ZIP32 stored entry 的归档。 */
function createStoredZip(
  entries: readonly StoredZipEntry[],
  malformed: StoredJWordPackageOptions['malformed']
): Uint8Array {
  const localParts: Uint8Array[] = []
  const centralParts: Uint8Array[] = []
  let localOffset = 0

  for (const entry of entries) {
    const nameBytes = textEncoder.encode(entry.name)
    const checksum = crc32(entry.crcBytes ?? entry.bytes)
    const flags = entry.flags ?? 0x0800
    const declaredSize = entry.bytes.byteLength + (entry.declaredSizeDelta ?? 0)
    const declaredUncompressedSize = entry.declaredUncompressedSize ?? declaredSize
    const compressionMethod = entry.compressionMethod ?? 0
    const localExtra = entry.localExtra ?? new Uint8Array()
    const local = new Uint8Array(30 + nameBytes.byteLength + localExtra.byteLength + entry.bytes.byteLength)
    const localView = new DataView(local.buffer)

    localView.setUint32(0, 0x04034b50, true)
    localView.setUint16(4, 20, true)
    localView.setUint16(6, flags, true)
    localView.setUint16(8, compressionMethod, true)
    localView.setUint32(14, checksum, true)
    localView.setUint32(18, entry.localCompressedSize ?? declaredSize, true)
    localView.setUint32(22, entry.localUncompressedSize ?? declaredUncompressedSize, true)
    localView.setUint16(26, nameBytes.byteLength, true)
    localView.setUint16(28, localExtra.byteLength, true)
    local.set(nameBytes, 30)
    local.set(localExtra, 30 + nameBytes.byteLength)
    local.set(entry.bytes, 30 + nameBytes.byteLength + localExtra.byteLength)
    localParts.push(local)

    const centralExtra = entry.centralExtra ?? new Uint8Array()
    const central = new Uint8Array(46 + nameBytes.byteLength + centralExtra.byteLength)
    const centralView = new DataView(central.buffer)

    centralView.setUint32(0, 0x02014b50, true)
    centralView.setUint16(4, 20, true)
    centralView.setUint16(6, 20, true)
    centralView.setUint16(8, flags, true)
    centralView.setUint16(10, compressionMethod, true)
    centralView.setUint32(16, checksum, true)
    centralView.setUint32(20, entry.centralCompressedSize ?? declaredSize, true)
    centralView.setUint32(24, entry.centralUncompressedSize ?? declaredUncompressedSize, true)
    centralView.setUint16(28, nameBytes.byteLength, true)
    centralView.setUint16(30, centralExtra.byteLength, true)
    centralView.setUint16(34, entry.centralDiskStart ?? 0, true)
    centralView.setUint32(38, entry.directory ? 0x10 : 0, true)
    centralView.setUint32(42, entry.centralLocalHeaderOffset ?? localOffset, true)
    central.set(nameBytes, 46)
    central.set(centralExtra, 46 + nameBytes.byteLength)
    centralParts.push(central)
    localOffset += local.byteLength
  }

  const centralOffset = localOffset
  const centralSize = centralParts.reduce((total, part) => total + part.byteLength, 0)
  const eocd = new Uint8Array(22)
  const eocdView = new DataView(eocd.buffer)
  const eocdEntryCount = malformed === 'archive-zip64-entry-count' ? 0xffff : entries.length

  eocdView.setUint32(0, 0x06054b50, true)
  eocdView.setUint16(8, eocdEntryCount, true)
  eocdView.setUint16(10, eocdEntryCount, true)
  eocdView.setUint32(12, malformed === 'archive-zip64-central-size' ? 0xffffffff : centralSize, true)
  eocdView.setUint32(16, malformed === 'archive-zip64-central-offset' ? 0xffffffff : centralOffset, true)

  const zip64TailSignature = malformed === 'archive-zip64-eocd'
    ? 0x06064b50
    : malformed === 'archive-zip64-locator'
      ? 0x07064b50
      : undefined
  const zip64Tail = new Uint8Array(zip64TailSignature === undefined ? 0 : 20)

  if (zip64TailSignature !== undefined) {
    new DataView(zip64Tail.buffer).setUint32(0, zip64TailSignature, true)
  }

  return concatenateBytes([...localParts, ...centralParts, zip64Tail, eocd])
}

/** 计算测试 entry 的 CRC-32。 */
function crc32(bytes: Uint8Array): number {
  let checksum = 0xffffffff

  for (const byte of bytes) {
    checksum = (crc32Table[(checksum ^ byte) & 0xff] ?? 0) ^ (checksum >>> 8)
  }

  return (checksum ^ 0xffffffff) >>> 0
}

const crc32Table = createCrc32Table()

/** 创建测试 fixture 共用的 CRC-32 查找表。 */
function createCrc32Table(): Uint32Array {
  const table = new Uint32Array(256)

  for (let index = 0; index < table.length; index += 1) {
    let value = index

    for (let bit = 0; bit < 8; bit += 1) {
      value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0)
    }

    table[index] = value >>> 0
  }

  return table
}

/** 创建可压缩但不会触发 100:1 preflight 的确定性测试字节。 */
function createDeterministicBytes(byteLength: number): Uint8Array {
  const bytes = new Uint8Array(byteLength)
  let state = 0x6d2b79f5

  for (let index = 0; index < bytes.length; index += 1) {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    bytes[index] = state & 0xff
  }

  return bytes
}

/** 计算 fixture checksum 使用的 SHA-256。 */
function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** 按顺序拼接 ZIP 记录。 */
function concatenateBytes(parts: readonly Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0))
  let offset = 0

  for (const part of parts) {
    output.set(part, offset)
    offset += part.byteLength
  }

  return output
}
