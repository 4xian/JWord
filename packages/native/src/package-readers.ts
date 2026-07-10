/**
 * 职责：读取 native .jword zip package 的核心 JSON part 并生成校验诊断。
 * 边界：不执行保存编码，不执行 schema 迁移落地，不暴露新的公开 API。
 * 协作模块：index.ts 加载/校验入口、package-validation.ts、schema-migrations.ts 和 validation.ts。
 * 性能/安全约束：只按需读取 zip entry 字节，不访问 DOM、网络或磁盘。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import JSZip from 'jszip'

import type { Document } from '@4xian/jword-core'
import { JWordNativePackageError } from './types.js'
import { isRecord, type JsonRecord } from './utils.js'
import { createDiagnostic, createPackageError, readErrorDiagnostic } from './diagnostics.js'
import { emitProgress } from './progress.js'
import { inspectChecksums, summarizeResources } from './package-validation.js'
import { inspectSchemaMigrationSupport } from './schema-migrations.js'
import { inspectJWordPackageIntegrity } from './validation.js'
import type {
  JWordBinaryInput,
  JWordNativeProgressEvent,
  JWordPackageChecksumEntry as NativeChecksumEntry,
  JWordPackageChecksums,
  JWordPackageDiagnostic,
  JWordPackageErrorCode,
  JWordPackageManifest,
  JWordPackageMetadata,
  JWordPackageResourceEntry,
  JWordPackageResourceSummary,
  JWordPackageWarning,
  ValidateJWordPackageOptions
} from './types.js'

export interface LoadedJWordPackageParts {
  readonly zip: JSZip
  readonly manifest?: JWordPackageManifest
  readonly document?: Document
  readonly metadata?: JWordPackageMetadata
  readonly checksums?: JWordPackageChecksums
  readonly warnings: readonly JWordPackageWarning[]
  readonly diagnostics: readonly JWordPackageDiagnostic[]
  readonly resources: readonly JWordPackageResourceSummary[]
}

/** 读取并校验 package 主要部分。 */
export async function readPackageParts(
  input: JWordBinaryInput,
  phase: JWordNativeProgressEvent['phase'],
  options: ValidateJWordPackageOptions
): Promise<LoadedJWordPackageParts> {
  try {
    const zip = await JSZip.loadAsync(await normalizeBinaryInput(input))
    const diagnostics: JWordPackageDiagnostic[] = []
    const warnings: JWordPackageWarning[] = []
    const manifest = await readManifest(zip, diagnostics, options.requestId)
    const metadata = await readMetadata(zip, diagnostics, options.requestId)
    const checksums = await readChecksums(zip, diagnostics, options.requestId)
    const document = await readDocument(zip, diagnostics, options.requestId)

    if (checksums !== undefined) {
      await inspectChecksums(zip, checksums, diagnostics, warnings, options.requestId)
    }

    if (manifest !== undefined) {
      const integrity = inspectJWordPackageIntegrity({
        manifest,
        ...(document === undefined ? {} : { document }),
        ...(checksums === undefined ? {} : { checksums }),
        ...(options.requestId === undefined ? {} : { requestId: options.requestId })
      })

      diagnostics.push(...integrity.diagnostics)
      inspectSchemaMigrationSupport(manifest.schemaVersion, diagnostics, options.requestId)
    }

    const resources = manifest === undefined || checksums === undefined
      ? []
      : summarizeResources(manifest, checksums)

    emitProgress(phase, 1, {
      ...options,
      total: 1
    })

    return {
      zip,
      ...(manifest === undefined ? {} : { manifest }),
      ...(document === undefined ? {} : { document }),
      ...(metadata === undefined ? {} : { metadata }),
      ...(checksums === undefined ? {} : { checksums }),
      warnings,
      diagnostics,
      resources
    }
  } catch (error) {
    if (error instanceof JWordNativePackageError) {
      throw error
    }

    const diagnostic = createDiagnostic({
      code: 'JWORD_NATIVE_PACKAGE_INVALID',
      severity: 'error',
      recoverable: false,
      message: error instanceof Error ? error.message : String(error),
      requestId: options.requestId
    })

    return {
      zip: new JSZip(),
      warnings: [],
      diagnostics: [diagnostic],
      resources: []
    }
  }
}

/** 规范化二进制输入。 */
async function normalizeBinaryInput(input: JWordBinaryInput): Promise<ArrayBuffer | Uint8Array> {
  if (input instanceof Uint8Array || input instanceof ArrayBuffer) {
    return input
  }

  return input.arrayBuffer()
}

/** 读取 manifest。 */
async function readManifest(
  zip: JSZip,
  diagnostics: JWordPackageDiagnostic[],
  requestId?: string
): Promise<JWordPackageManifest | undefined> {
  const file = zip.file('manifest.json')

  if (file === null) {
    diagnostics.push(createDiagnostic({
      code: 'JWORD_NATIVE_MANIFEST_MISSING',
      severity: 'error',
      recoverable: false,
      message: 'manifest.json 缺失',
      entry: 'manifest.json',
      requestId
    }))

    return undefined
  }

  try {
    return parseManifest(await file.async('string'), requestId)
  } catch (error) {
    diagnostics.push(readErrorDiagnostic(error, 'JWORD_NATIVE_MANIFEST_INVALID', 'manifest.json', requestId))

    return undefined
  }
}

/** 读取 metadata。 */
async function readMetadata(
  zip: JSZip,
  diagnostics: JWordPackageDiagnostic[],
  requestId?: string
): Promise<JWordPackageMetadata | undefined> {
  const file = zip.file('metadata.json')

  if (file === null) {
    diagnostics.push(createDiagnostic({
      code: 'JWORD_NATIVE_METADATA_MISSING',
      severity: 'error',
      recoverable: false,
      message: 'metadata.json 缺失',
      entry: 'metadata.json',
      requestId
    }))

    return undefined
  }

  try {
    return parseJsonRecord(await file.async('string'), 'metadata.json', requestId, 'JWORD_NATIVE_METADATA_INVALID')
  } catch (error) {
    diagnostics.push(readErrorDiagnostic(error, 'JWORD_NATIVE_METADATA_INVALID', 'metadata.json', requestId))

    return undefined
  }
}

/** 读取 checksums。 */
async function readChecksums(
  zip: JSZip,
  diagnostics: JWordPackageDiagnostic[],
  requestId?: string
): Promise<JWordPackageChecksums | undefined> {
  const file = zip.file('checksums.json')

  if (file === null) {
    diagnostics.push(createDiagnostic({
      code: 'JWORD_NATIVE_CHECKSUMS_MISSING',
      severity: 'error',
      recoverable: false,
      message: 'checksums.json 缺失',
      entry: 'checksums.json',
      requestId
    }))

    return undefined
  }

  try {
    return parseChecksums(await file.async('string'), requestId)
  } catch (error) {
    diagnostics.push(readErrorDiagnostic(error, 'JWORD_NATIVE_CHECKSUMS_INVALID', 'checksums.json', requestId))

    return undefined
  }
}

/** 读取 document。 */
async function readDocument(
  zip: JSZip,
  diagnostics: JWordPackageDiagnostic[],
  requestId?: string
): Promise<Document | undefined> {
  const file = zip.file('document.json')

  if (file === null) {
    diagnostics.push(createDiagnostic({
      code: 'JWORD_NATIVE_DOCUMENT_MISSING',
      severity: 'error',
      recoverable: false,
      message: 'document.json 缺失',
      entry: 'document.json',
      requestId
    }))

    return undefined
  }

  try {
    const parsed = parseJsonRecord(await file.async('string'), 'document.json', requestId)

    if (parsed.kind !== 'document' || typeof parsed.id !== 'string' || !Array.isArray(parsed.sections)) {
      throw createPackageError('JWORD_NATIVE_DOCUMENT_INVALID', 'document.json 主结构无效', requestId, 'document.json')
    }

    return parsed as unknown as Document
  } catch (error) {
    diagnostics.push(readErrorDiagnostic(error, 'JWORD_NATIVE_DOCUMENT_INVALID', 'document.json', requestId))

    return undefined
  }
}

/** 解析 manifest JSON。 */
function parseManifest(text: string, requestId?: string): JWordPackageManifest {
  const record = parseJsonRecord(text, 'manifest.json', requestId)
  const formatVersion = readNumber(record, 'formatVersion', 'manifest.json', requestId)
  const schemaVersion = readNumber(record, 'schemaVersion', 'manifest.json', requestId)
  const createdBy = readString(record, 'createdBy', 'manifest.json', requestId)
  const minimumReaderVersion = readNumber(record, 'minimumReaderVersion', 'manifest.json', requestId)
  const featureFlags = readStringArray(record, 'featureFlags', 'manifest.json', requestId)
  const packageEntries = readStringArray(record, 'packageEntries', 'manifest.json', requestId)
  const resources = readResourceEntries(record.resources)

  return {
    formatVersion,
    schemaVersion,
    createdBy,
    minimumReaderVersion,
    featureFlags,
    packageEntries,
    resources
  }
}

/** 解析 checksums JSON。 */
function parseChecksums(text: string, requestId?: string): JWordPackageChecksums {
  const record = parseJsonRecord(text, 'checksums.json', requestId)

  if (!isRecord(record.entries)) {
    throw createPackageError('JWORD_NATIVE_CHECKSUMS_INVALID', 'checksums.entries 必须是对象', requestId, 'checksums.json')
  }

  const entries: Record<string, NativeChecksumEntry> = {}

  for (const [entry, value] of Object.entries(record.entries)) {
    if (!isRecord(value)) {
      throw createPackageError('JWORD_NATIVE_CHECKSUMS_INVALID', `${entry} checksum 无效`, requestId, 'checksums.json')
    }

    entries[entry] = {
      sha256: readString(value, 'sha256', 'checksums.json', requestId),
      byteLength: readNumber(value, 'byteLength', 'checksums.json', requestId),
      mime: readString(value, 'mime', 'checksums.json', requestId)
    }
  }

  return { entries }
}

/** 解析资源 entry 列表。 */
function readResourceEntries(input: unknown): readonly JWordPackageResourceEntry[] {
  if (!Array.isArray(input)) {
    return []
  }

  return input.flatMap((item) => {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.mime !== 'string' || typeof item.packed !== 'boolean') {
      return []
    }

    return [{
      id: item.id,
      ...(typeof item.path === 'string' ? { path: item.path } : {}),
      mime: item.mime,
      packed: item.packed
    }]
  })
}

/** 解析 JSON 对象。 */
function parseJsonRecord(
  text: string,
  entry: string,
  requestId?: string,
  invalidCode: JWordPackageErrorCode = 'JWORD_NATIVE_MANIFEST_INVALID'
): JsonRecord {
  const parsed = JSON.parse(text) as unknown

  if (!isRecord(parsed)) {
    throw createPackageError(invalidCode, `${entry} 必须是 JSON 对象`, requestId, entry)
  }

  return parsed
}

/** 读取字符串字段。 */
function readString(record: JsonRecord, key: string, entry: string, requestId?: string): string {
  const value = record[key]

  if (typeof value !== 'string') {
    throw createPackageError('JWORD_NATIVE_MANIFEST_INVALID', `${entry}.${key} 必须是字符串`, requestId, entry)
  }

  return value
}

/** 读取数字字段。 */
function readNumber(record: JsonRecord, key: string, entry: string, requestId?: string): number {
  const value = record[key]

  if (typeof value !== 'number') {
    throw createPackageError('JWORD_NATIVE_MANIFEST_INVALID', `${entry}.${key} 必须是数字`, requestId, entry)
  }

  return value
}

/** 读取字符串数组字段。 */
function readStringArray(record: JsonRecord, key: string, entry: string, requestId?: string): readonly string[] {
  const value = record[key]

  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw createPackageError('JWORD_NATIVE_MANIFEST_INVALID', `${entry}.${key} 必须是字符串数组`, requestId, entry)
  }

  return value
}
