/**
 * 职责：读取 native .jword zip package 的核心 JSON part 并生成校验诊断。
 * 边界：不执行保存编码，不执行 schema 迁移落地，不暴露新的公开 API。
 * 协作模块：index.ts 加载/校验入口、package-validation.ts、schema-migrations.ts 和 validation.ts。
 * 性能/安全约束：只按需读取 zip entry 字节，不访问 DOM、网络或磁盘。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import type { Document } from '@4xian/jword-core'

import { BoundedNativeZipReader, openBoundedNativeZip } from './bounded-zip-reader.js'
import { JWordNativePackageError } from './types.js'
import { isRecord, type JsonRecord } from './utils.js'
import { createDiagnostic, createPackageError, readErrorDiagnostic } from './diagnostics.js'
import { assertNotAborted } from './progress.js'
import {
  parseCurrentJWordDocument,
  parseJWordDocumentVersion,
  type VersionedJWordDocument
} from './document-schema.js'
import { emitProgress } from './progress.js'
import {
  validateNativePackageEntryName,
  validateUniqueNativePackageEntryNames
} from './package-entry-name.js'
import { JWORD_NATIVE_PACKAGE_LIMITS, assertNativePackageLimit } from './package-read-budget.js'
import {
  inspectChecksumEntryMetadata,
  inspectChecksums,
  summarizeResources
} from './package-validation.js'
import { migrateJWordDocument } from './schema-migrations.js'
import { parseStrictJsonRecord } from './strict-json.js'
import { inspectJWordPackageIntegrity } from './validation.js'
import { materializePackedResourceDocument } from './packed-resource-document.js'
import type {
  JWordBinaryInput,
  JWordNativeProgressEvent,
  JWordPackageChecksumEntry as NativeChecksumEntry,
  JWordPackageChecksums,
  JWordPackageDiagnostic,
  JWordPackageErrorCode,
  JWordPackageManifest,
  JWordPackageMetadata,
  JWordPackageMigrationReport,
  JWordPackageResourceEntry,
  JWordPackageResourceSummary,
  JWordPackageWarning,
  ValidateJWordPackageOptions
} from './types.js'

export interface LoadedJWordPackageParts {
  readonly manifest?: JWordPackageManifest
  readonly document?: Document
  readonly metadata?: JWordPackageMetadata
  readonly checksums?: JWordPackageChecksums
  readonly migrationReport?: JWordPackageMigrationReport
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
  let zip: BoundedNativeZipReader | undefined

  try {
    zip = await openBoundedNativeZip(input, phase, options)
    assertNotAborted(options.signal, options.requestId)
    const diagnostics: JWordPackageDiagnostic[] = []
    const warnings: JWordPackageWarning[] = []
    const manifest = await readManifest(zip, diagnostics, options.requestId)
    assertNotAborted(options.signal, options.requestId)

    if (manifest === undefined) {
      return { warnings, diagnostics, resources: [] }
    }

    const checksums = await readChecksums(zip, manifest, diagnostics, options.requestId)
    assertNotAborted(options.signal, options.requestId)

    if (checksums === undefined) {
      return { manifest, warnings, diagnostics, resources: [] }
    }

    inspectChecksumEntryMetadata(zip, checksums, diagnostics, options.requestId)
    assertNotAborted(options.signal, options.requestId)

    if (hasUnrecoverableDiagnostic(diagnostics)) {
      return { manifest, checksums, warnings, diagnostics, resources: [] }
    }

    const metadata = await readMetadata(zip, diagnostics, options.requestId)
    assertNotAborted(options.signal, options.requestId)

    if (metadata === undefined) {
      return { manifest, checksums, warnings, diagnostics, resources: [] }
    }

    const versionedDocument = await readDocument(
      zip,
      manifest.schemaVersion,
      diagnostics,
      options.requestId
    )
    assertNotAborted(options.signal, options.requestId)

    if (versionedDocument === undefined) {
      return { manifest, metadata, checksums, warnings, diagnostics, resources: [] }
    }

    const packedResourceEntries = new Set(
      manifest.resources.flatMap((resource) => resource.packed && resource.path !== undefined ? [resource.path] : [])
    )
    const verifiedResourceBytes = await inspectChecksums(
      zip,
      checksums,
      diagnostics,
      warnings,
      options,
      packedResourceEntries
    )
    assertNotAborted(options.signal, options.requestId)

    if (hasUnrecoverableDiagnostic(diagnostics)) {
      return { manifest, metadata, checksums, warnings, diagnostics, resources: [] }
    }

    assertNotAborted(options.signal, options.requestId)
    const migrated = migrateJWordDocument(
      versionedDocument,
      manifest.schemaVersion,
      options.requestId
    )
    assertNotAborted(options.signal, options.requestId)
    const document = parseCurrentJWordDocument(migrated.document.value, options.requestId)
    assertNotAborted(options.signal, options.requestId)

    warnings.push(...migrated.report.warnings)
    diagnostics.push(...migrated.report.warnings)

    const integrity = inspectJWordPackageIntegrity({
      manifest,
      document,
      checksums,
      verifiedResourceEntries: new Set(verifiedResourceBytes.keys()),
      ...(options.requestId === undefined ? {} : { requestId: options.requestId })
    })
    assertNotAborted(options.signal, options.requestId)
    const integrityDiagnostic = integrity.diagnostics[0]

    if (integrityDiagnostic !== undefined) {
      diagnostics.push(integrityDiagnostic)

      return {
        manifest,
        document,
        metadata,
        checksums,
        migrationReport: migrated.report,
        warnings,
        diagnostics,
        resources: []
      }
    }

    const loadedDocument = phase === 'load' && manifest.formatVersion === 2
      ? parseCurrentJWordDocument(
          materializePackedResourceDocument(document, verifiedResourceBytes, options.requestId),
          options.requestId
        )
      : document

    const resources = summarizeResources(manifest, checksums)

    emitProgress(phase, 1, {
      ...options,
      total: 1
    })
    assertNotAborted(options.signal, options.requestId)

    return {
      manifest,
      document: loadedDocument,
      metadata,
      checksums,
      migrationReport: migrated.report,
      warnings,
      diagnostics,
      resources
    }
  } catch (error) {
    if (isCancellationError(error)) {
      throw error
    }

    return {
      warnings: [],
      diagnostics: [createPackageReadDiagnostic(error, options.requestId)],
      resources: []
    }
  } finally {
    if (zip !== undefined) {
      try {
        await zip.close()
      } catch {
        // 读取结果或原始错误优先，关闭异常不进入公开 diagnostic。
      }
    }
  }
}

/** 判断读取编排是否已经产生不可恢复错误。 */
function hasUnrecoverableDiagnostic(diagnostics: readonly JWordPackageDiagnostic[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === 'error' && !diagnostic.recoverable)
}

/** 读取 manifest。 */
async function readManifest(
  zip: BoundedNativeZipReader,
  diagnostics: JWordPackageDiagnostic[],
  requestId?: string
): Promise<JWordPackageManifest | undefined> {
  const bytes = await zip.readEntry('manifest.json')

  if (bytes === undefined) {
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
    return parseManifest(decodeJsonBytes(bytes, 'manifest.json', requestId), requestId)
  } catch (error) {
    diagnostics.push(readErrorDiagnostic(error, 'JWORD_NATIVE_MANIFEST_INVALID', 'manifest.json', requestId))

    return undefined
  }
}

/** 读取 metadata。 */
async function readMetadata(
  zip: BoundedNativeZipReader,
  diagnostics: JWordPackageDiagnostic[],
  requestId?: string
): Promise<JWordPackageMetadata | undefined> {
  const bytes = await zip.readEntry('metadata.json')

  if (bytes === undefined) {
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
    return parseStrictJsonRecord(
      decodeJsonBytes(bytes, 'metadata.json', requestId, 'JWORD_NATIVE_METADATA_INVALID'),
      {
        entry: 'metadata.json',
        invalidCode: 'JWORD_NATIVE_METADATA_INVALID',
        ...(requestId === undefined ? {} : { requestId })
      }
    )
  } catch (error) {
    diagnostics.push(readErrorDiagnostic(error, 'JWORD_NATIVE_METADATA_INVALID', 'metadata.json', requestId))

    return undefined
  }
}

/** 读取 checksums。 */
async function readChecksums(
  zip: BoundedNativeZipReader,
  manifest: JWordPackageManifest | undefined,
  diagnostics: JWordPackageDiagnostic[],
  requestId?: string
): Promise<JWordPackageChecksums | undefined> {
  const bytes = await zip.readEntry('checksums.json')

  if (bytes === undefined) {
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
    return parseChecksums(
      decodeJsonBytes(bytes, 'checksums.json', requestId, 'JWORD_NATIVE_CHECKSUMS_INVALID'),
      manifest,
      requestId
    )
  } catch (error) {
    diagnostics.push(readErrorDiagnostic(error, 'JWORD_NATIVE_CHECKSUMS_INVALID', 'checksums.json', requestId))

    return undefined
  }
}

/** 读取 document。 */
async function readDocument(
  zip: BoundedNativeZipReader,
  schemaVersion: number,
  diagnostics: JWordPackageDiagnostic[],
  requestId?: string
): Promise<VersionedJWordDocument | undefined> {
  const bytes = await zip.readEntry('document.json')

  if (bytes === undefined) {
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
    const parsed = parseStrictJsonRecord(
      decodeJsonBytes(bytes, 'document.json', requestId, 'JWORD_NATIVE_DOCUMENT_INVALID'),
      {
        entry: 'document.json',
        invalidCode: 'JWORD_NATIVE_DOCUMENT_INVALID',
        ...(requestId === undefined ? {} : { requestId })
      }
    )
    return parseJWordDocumentVersion(parsed, schemaVersion, requestId)
  } catch (error) {
    diagnostics.push(readErrorDiagnostic(error, 'JWORD_NATIVE_DOCUMENT_INVALID', 'document.json', requestId))

    return undefined
  }
}

/** 严格解码 UTF-8 JSON entry，不在错误中复制输入字节。 */
function decodeJsonBytes(
  bytes: Uint8Array,
  entry: string,
  requestId?: string,
  invalidCode: JWordPackageErrorCode = 'JWORD_NATIVE_MANIFEST_INVALID'
): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw createPackageError(invalidCode, `${entry} UTF-8 无效`, requestId, entry)
  }
}

/** 判断读取错误是否必须保持取消拒绝语义。 */
function isCancellationError(error: unknown): error is JWordNativePackageError {
  return error instanceof JWordNativePackageError && (
    error.code === 'JWORD_NATIVE_USER_CANCELLED' ||
    error.code === 'JWORD_NATIVE_WORKER_CANCELLED'
  )
}

/** 将共享读取 seam 的失败收口为稳定不可恢复 diagnostic。 */
function createPackageReadDiagnostic(error: unknown, requestId?: string): JWordPackageDiagnostic {
  if (error instanceof JWordNativePackageError) {
    return createDiagnostic({
      code: error.code,
      severity: 'error',
      recoverable: false,
      message: error.message,
      entry: error.entry,
      ...(error.path === undefined ? {} : { path: error.path }),
      requestId: error.requestId ?? requestId
    })
  }

  return createDiagnostic({
    code: 'JWORD_NATIVE_PACKAGE_INVALID',
    severity: 'error',
    recoverable: false,
    message: 'JWORD_NATIVE_PACKAGE_INVALID',
    requestId
  })
}

/** 解析 manifest JSON。 */
function parseManifest(text: string, requestId?: string): JWordPackageManifest {
  const record = parseStrictJsonRecord(text, {
    entry: 'manifest.json',
    invalidCode: 'JWORD_NATIVE_MANIFEST_INVALID',
    ...(requestId === undefined ? {} : { requestId })
  })
  const formatVersion = readSafeNonNegativeInteger(
    record,
    'formatVersion',
    'manifest.json',
    requestId,
    'JWORD_NATIVE_MANIFEST_INVALID'
  )
  const schemaVersion = readSafeNonNegativeInteger(
    record,
    'schemaVersion',
    'manifest.json',
    requestId,
    'JWORD_NATIVE_MANIFEST_INVALID'
  )
  const createdBy = readString(record, 'createdBy', 'manifest.json', requestId)
  const minimumReaderVersion = readSafeNonNegativeInteger(
    record,
    'minimumReaderVersion',
    'manifest.json',
    requestId,
    'JWORD_NATIVE_MANIFEST_INVALID'
  )
  const featureFlags = readStringArray(record, 'featureFlags', 'manifest.json', requestId)
  const packageEntries = readStringArray(record, 'packageEntries', 'manifest.json', requestId)
  assertNativePackageLimit(
    packageEntries.length,
    JWORD_NATIVE_PACKAGE_LIMITS.itemCount,
    requestId,
    'manifest.json'
  )
  validateUniqueNativePackageEntryNames(
    packageEntries.map((name) => ({ name, directory: name.endsWith('/') })),
    requestId,
    'JWORD_NATIVE_MANIFEST_INVALID'
  )
  const resources = readResourceEntries(record.resources, requestId)
  assertUniqueManifestResources(resources, packageEntries, requestId)

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

/** 校验 manifest 资源 ID、packed path 唯一且 path 已在 packageEntries 声明。 */
function assertUniqueManifestResources(
  resources: readonly JWordPackageResourceEntry[],
  packageEntries: readonly string[],
  requestId?: string
): void {
  const ids = new Set<string>()
  const paths = new Set<string>()
  const declaredEntries = new Set(packageEntries)

  for (const resource of resources) {
    if (ids.has(resource.id)) {
      throw createPackageError(
        'JWORD_NATIVE_MANIFEST_INVALID',
        'JWORD_NATIVE_MANIFEST_INVALID',
        requestId,
        'manifest.json'
      )
    }
    ids.add(resource.id)

    if (resource.path === undefined) {
      continue
    }
    if (paths.has(resource.path) || !declaredEntries.has(resource.path)) {
      throw createPackageError(
        'JWORD_NATIVE_MANIFEST_INVALID',
        'JWORD_NATIVE_MANIFEST_INVALID',
        requestId,
        'manifest.json'
      )
    }
    paths.add(resource.path)
  }
}

/** 解析 checksums JSON。 */
function parseChecksums(
  text: string,
  manifest: JWordPackageManifest | undefined,
  requestId?: string
): JWordPackageChecksums {
  const record = parseStrictJsonRecord(text, {
    entry: 'checksums.json',
    invalidCode: 'JWORD_NATIVE_CHECKSUMS_INVALID',
    ...(requestId === undefined ? {} : { requestId })
  })

  if (!isRecord(record.entries)) {
    throw createPackageError('JWORD_NATIVE_CHECKSUMS_INVALID', 'checksums.entries 必须是对象', requestId, 'checksums.json')
  }

  assertNativePackageLimit(
    Object.keys(record.entries).length,
    JWORD_NATIVE_PACKAGE_LIMITS.itemCount,
    requestId,
    'checksums.json'
  )
  const entries: Record<string, NativeChecksumEntry> = {}
  const allowedEntries = new Set([
    'document.json',
    'metadata.json',
    ...(manifest?.resources.flatMap((resource) => (
      resource.packed && resource.path !== undefined ? [resource.path] : []
    )) ?? [])
  ])

  for (const [entry, value] of Object.entries(record.entries)) {
    if (!allowedEntries.has(entry)) {
      throw createPackageError(
        'JWORD_NATIVE_CHECKSUMS_INVALID',
        'JWORD_NATIVE_CHECKSUMS_INVALID',
        requestId,
        'checksums.json'
      )
    }
    if (!isRecord(value)) {
      throw createPackageError('JWORD_NATIVE_CHECKSUMS_INVALID', `${entry} checksum 无效`, requestId, 'checksums.json')
    }

    entries[entry] = {
      sha256: readChecksumSha256(value, requestId),
      byteLength: readSafeNonNegativeInteger(
        value,
        'byteLength',
        'checksums.json',
        requestId,
        'JWORD_NATIVE_CHECKSUMS_INVALID'
      ),
      mime: readNonBlankString(
        value,
        'mime',
        'checksums.json',
        requestId,
        'JWORD_NATIVE_CHECKSUMS_INVALID'
      )
    }
  }

  return { entries }
}

/** 解析资源 entry 列表。 */
function readResourceEntries(
  input: unknown,
  requestId?: string
): readonly JWordPackageResourceEntry[] {
  if (!Array.isArray(input)) {
    throw createPackageError(
      'JWORD_NATIVE_MANIFEST_INVALID',
      'JWORD_NATIVE_MANIFEST_INVALID',
      requestId,
      'manifest.json'
    )
  }

  assertNativePackageLimit(
    input.length,
    JWORD_NATIVE_PACKAGE_LIMITS.itemCount,
    requestId,
    'manifest.json'
  )

  return input.map((item) => {
    const hasPath = isRecord(item) && Object.hasOwn(item, 'path')

    if (
      !isRecord(item) ||
      typeof item.id !== 'string' ||
      typeof item.mime !== 'string' ||
      item.mime.trim().length === 0 ||
      typeof item.packed !== 'boolean' ||
      (hasPath && typeof item.path !== 'string') ||
      item.packed !== hasPath
    ) {
      throw createPackageError(
        'JWORD_NATIVE_MANIFEST_INVALID',
        'JWORD_NATIVE_MANIFEST_INVALID',
        requestId,
        'manifest.json'
      )
    }

    if (item.packed) {
      const path = item.path as string
      const fileName = path.slice('resources/'.length)

      if (!path.startsWith('resources/') || fileName.length === 0 || fileName.includes('/')) {
        throw createPackageError(
          'JWORD_NATIVE_MANIFEST_INVALID',
          'JWORD_NATIVE_MANIFEST_INVALID',
          requestId,
          'manifest.json'
        )
      }

      validateNativePackageEntryName(
        path,
        false,
        requestId,
        'JWORD_NATIVE_MANIFEST_INVALID'
      )
    }

    return {
      id: item.id,
      ...(typeof item.path === 'string' ? { path: item.path } : {}),
      mime: item.mime,
      packed: item.packed
    }
  })
}

/** 读取字符串字段。 */
function readString(
  record: JsonRecord,
  key: string,
  entry: string,
  requestId?: string,
  invalidCode: JWordPackageErrorCode = 'JWORD_NATIVE_MANIFEST_INVALID'
): string {
  const value = record[key]

  if (typeof value !== 'string') {
    throw createPackageError(invalidCode, invalidCode, requestId, entry)
  }

  return value
}

/** 读取去除首尾空白后仍非空的字符串字段。 */
function readNonBlankString(
  record: JsonRecord,
  key: string,
  entry: string,
  requestId: string | undefined,
  invalidCode: JWordPackageErrorCode
): string {
  const value = readString(record, key, entry, requestId, invalidCode)

  if (value.trim().length === 0) {
    throw createPackageError(invalidCode, invalidCode, requestId, entry)
  }

  return value
}

/** 读取严格的 SHA-256 小写十六进制 checksum。 */
function readChecksumSha256(record: JsonRecord, requestId?: string): string {
  const value = readString(
    record,
    'sha256',
    'checksums.json',
    requestId,
    'JWORD_NATIVE_CHECKSUMS_INVALID'
  )

  if (!/^[0-9a-f]{64}$/u.test(value)) {
    throw createPackageError(
      'JWORD_NATIVE_CHECKSUMS_INVALID',
      'JWORD_NATIVE_CHECKSUMS_INVALID',
      requestId,
      'checksums.json'
    )
  }

  return value
}

/** 读取非负安全整数字段并保留调用方指定的稳定错误分类。 */
function readSafeNonNegativeInteger(
  record: JsonRecord,
  key: string,
  entry: string,
  requestId: string | undefined,
  invalidCode: JWordPackageErrorCode
): number {
  const value = record[key]

  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw createPackageError(invalidCode, invalidCode, requestId, entry)
  }

  return value as number
}

/** 读取字符串数组字段。 */
function readStringArray(record: JsonRecord, key: string, entry: string, requestId?: string): readonly string[] {
  const value = record[key]

  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw createPackageError('JWORD_NATIVE_MANIFEST_INVALID', `${entry}.${key} 必须是字符串数组`, requestId, entry)
  }

  return value
}
