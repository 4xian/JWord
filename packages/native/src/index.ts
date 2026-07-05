/**
 * 职责：提供 Gate 4.5 JWord 原生 .jword zip package 保存、打开和校验公开 API。
 * 边界：只消费 core 公开 canonical document model 和 resource 类型，不读取 editor 内部 store。
 * 协作模块：@4xian/jword-core、worker.ts、fixtures/native 和后续 vanilla host。
 * 性能/安全约束：主格式是 document.json，不保存渲染缓存、画布位图、DOM 状态或协同 provider 状态。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#gate-45---jword-原生保存与打开。
 */
import JSZip from 'jszip'

import type {
  Document,
  DocumentProjection,
  Editor,
  Resource
} from '@4xian/jword-core'
import {
  JWORD_NATIVE_CREATED_BY,
  JWORD_NATIVE_FORMAT_VERSION,
  JWORD_NATIVE_SCHEMA_VERSION,
  JWordNativePackageError
} from './types.js'
import type {
  JWordBinaryInput,
  JWordNativeProgressEvent,
  JWordPackageChecksumEntry as NativeChecksumEntry,
  JWordPackageChecksums,
  JWordPackageDiagnostic,
  JWordPackageDiagnosticCode,
  JWordPackageDiagnosticSeverity,
  JWordPackageErrorCode,
  JWordPackageManifest,
  JWordPackageMetadata,
  JWordPackageMigrationReport,
  JWordPackageResourceEntry,
  JWordPackageResourceSummary,
  JWordPackageWarning,
  JWordPackageWarningCode,
  LoadJWordDocumentOptions,
  LoadJWordDocumentResult,
  SaveJWordDocumentOptions,
  SaveJWordDocumentResult,
  ValidateJWordPackageOptions,
  ValidateJWordPackageResult
} from './types.js'
import {
  copyBytesToArrayBuffer,
  isRecord,
  sha256Hex,
  stringifyJson,
  type JsonRecord
} from './utils.js'
import { inspectJWordPackageIntegrity } from './validation.js'
export {
  createCancelJWordNativeRequest,
  createJWordNativeErrorEvent,
  createJWordNativeTransferables,
  createLoadJWordNativeRequest,
  createSaveJWordNativeRequest,
  createValidateJWordNativeRequest,
  isJWordNativePackageError,
  serializeJWordNativePackageError
} from './messages.js'

export {
  JWORD_NATIVE_CREATED_BY,
  JWORD_NATIVE_FORMAT_VERSION,
  JWORD_NATIVE_SCHEMA_VERSION,
  JWordNativePackageError
} from './types.js'
export type {
  JWordBinaryInput,
  JWordNativeCancelRequest,
  JWordNativeLoadRequest,
  JWordNativePackageErrorInput,
  JWordNativePackageErrorShape,
  JWordNativeProgressEvent,
  JWordNativeSaveRequest,
  JWordNativeTransferable,
  JWordNativeValidateRequest,
  JWordNativeWorkerEvent,
  JWordNativeWorkerRequest,
  JWordPackageChecksumEntry,
  JWordPackageChecksums,
  JWordPackageDiagnostic,
  JWordPackageDiagnosticCode,
  JWordPackageDiagnosticSeverity,
  JWordPackageErrorCode,
  JWordPackageManifest,
  JWordPackageMetadata,
  JWordPackageMigrationReport,
  JWordPackageResourceEntry,
  JWordPackageResourceSummary,
  JWordPackageWarning,
  JWordPackageWarningCode,
  LoadJWordDocumentOptions,
  LoadJWordDocumentResult,
  SaveJWordDocumentOptions,
  SaveJWordDocumentResult,
  ValidateJWordPackageOptions,
  ValidateJWordPackageResult
} from './types.js'

interface LoadedJWordPackageParts {
  readonly zip: JSZip
  readonly manifest?: JWordPackageManifest
  readonly document?: Document
  readonly metadata?: JWordPackageMetadata
  readonly checksums?: JWordPackageChecksums
  readonly warnings: readonly JWordPackageWarning[]
  readonly diagnostics: readonly JWordPackageDiagnostic[]
  readonly resources: readonly JWordPackageResourceSummary[]
}

interface PackedResource {
  readonly resource: Resource
  readonly path?: string
  readonly bytes?: Uint8Array
  readonly warning?: JWordPackageWarning
}

interface SchemaMigrationStep {
  readonly id: string
  readonly from: number
  readonly to: number
  readonly migrate: (document: Document) => Document
}

const SCHEMA_MIGRATION_STEPS: readonly SchemaMigrationStep[] = [
  {
    id: 'schema-0-to-1',
    from: 0,
    to: 1,
    migrate: migrateSchema0To1
  }
]

/** 保存 Editor、projection 或 canonical document 为 .jword zip package。 */
export async function saveJWordDocument(
  editorOrModel: Editor | DocumentProjection | Document,
  options: SaveJWordDocumentOptions = {}
): Promise<SaveJWordDocumentResult> {
  assertNotAborted(options.signal, options.requestId)
  emitProgress('save', 0, options)

  const document = cloneDocument(readDocumentFromInput(editorOrModel), options.requestId)
  const metadata = createPackageMetadata(options.metadata)
  const resources = await collectPackedResources(document.resources ?? [], options)
  const warnings = resources.flatMap((item) => item.warning === undefined ? [] : [item.warning])
  const manifest = createManifest(document, resources, options.featureFlags ?? [])
  const zip = new JSZip()

  zip.file('manifest.json', stringifyJson(manifest))
  zip.file('document.json', stringifyJson(document))
  zip.file('metadata.json', stringifyJson(metadata))
  zip.folder('resources')

  for (const resource of resources) {
    assertNotAborted(options.signal, options.requestId)

    if (resource.path !== undefined && resource.bytes !== undefined) {
      zip.file(resource.path, resource.bytes)
    }
  }

  assertNotAborted(options.signal, options.requestId)

  const checksums = await createChecksums(zip, manifest.packageEntries, resources, options)

  assertNotAborted(options.signal, options.requestId)

  zip.file('checksums.json', stringifyJson(checksums))

  const bytes = await generateZipBytes(zip, options)

  assertNotAborted(options.signal, options.requestId)

  const summaries = summarizeResources(manifest, checksums)
  const diagnostics = warnings.map((warning): JWordPackageDiagnostic => warning)

  emitProgress('save', bytes.byteLength, {
    ...options,
    total: bytes.byteLength
  })

  return {
    bytes,
    blob: new Blob([copyBytesToArrayBuffer(bytes)], { type: 'application/vnd.jword.native+zip' }),
    manifest,
    metadata,
    checksums,
    warnings,
    diagnostics,
    resources: summaries
  }
}

/** 加载 .jword zip package 并返回 canonical document model。 */
export async function loadJWordDocument(
  input: JWordBinaryInput,
  options: LoadJWordDocumentOptions = {}
): Promise<LoadJWordDocumentResult> {
  assertNotAborted(options.signal, options.requestId)
  emitProgress('load', 0, options)

  const parts = await readPackageParts(input, 'load', options)
  const diagnostics = [...parts.diagnostics]
  const warnings = [...parts.warnings]

  throwFirstUnrecoverableDiagnostic(diagnostics, options.requestId)

  if (parts.manifest === undefined) {
    throw createPackageError('JWORD_NATIVE_MANIFEST_MISSING', 'manifest.json 缺失', options.requestId, 'manifest.json')
  }
  if (parts.document === undefined) {
    throw createPackageError('JWORD_NATIVE_DOCUMENT_MISSING', 'document.json 缺失', options.requestId, 'document.json')
  }
  if (parts.metadata === undefined) {
    throw createPackageError('JWORD_NATIVE_METADATA_MISSING', 'metadata.json 缺失', options.requestId, 'metadata.json')
  }
  if (parts.checksums === undefined) {
    throw createPackageError('JWORD_NATIVE_CHECKSUMS_MISSING', 'checksums.json 缺失', options.requestId, 'checksums.json')
  }

  const migrated = migrateDocument(parts.document, parts.manifest.schemaVersion, options.requestId)

  for (const warning of [...warnings, ...migrated.report.warnings]) {
    options.onWarning?.(warning)
  }

  emitProgress('load', 1, {
    ...options,
    total: 1
  })

  return {
    document: migrated.document,
    metadata: parts.metadata,
    manifest: parts.manifest,
    checksums: parts.checksums,
    warnings: [...warnings, ...migrated.report.warnings],
    diagnostics: [...diagnostics, ...migrated.report.warnings],
    migrationReport: migrated.report,
    resources: parts.resources
  }
}

/** 校验 .jword package 结构、schema 和 checksum。 */
export async function validateJWordPackage(
  input: JWordBinaryInput,
  options: ValidateJWordPackageOptions = {}
): Promise<ValidateJWordPackageResult> {
  assertNotAborted(options.signal, options.requestId)
  emitProgress('validate', 0, options)

  const parts = await readPackageParts(input, 'validate', options)
  const hasError = parts.diagnostics.some((diagnostic) => diagnostic.severity === 'error' && !diagnostic.recoverable)

  emitProgress('validate', 1, {
    ...options,
    total: 1
  })

  return {
    valid: !hasError,
    ...(parts.manifest === undefined ? {} : { manifest: parts.manifest }),
    ...(parts.metadata === undefined ? {} : { metadata: parts.metadata }),
    ...(parts.checksums === undefined ? {} : { checksums: parts.checksums }),
    warnings: parts.warnings,
    diagnostics: parts.diagnostics,
    resources: parts.resources
  }
}

/** 从 Editor、projection 或 document 读取 canonical document。 */
function readDocumentFromInput(input: Editor | DocumentProjection | Document): Document {
  if (isEditor(input)) {
    return input.getProjection().document
  }

  if (isDocumentProjection(input)) {
    return input.document
  }

  return input
}

/** 判断输入是否为 Editor facade。 */
function isEditor(input: Editor | DocumentProjection | Document): input is Editor {
  const record = input as unknown as Record<string, unknown>

  return typeof record.getProjection === 'function'
}

/** 判断输入是否为 DocumentProjection。 */
function isDocumentProjection(input: Editor | DocumentProjection | Document): input is DocumentProjection {
  const record = input as unknown as Record<string, unknown>
  const document = record.document

  return isRecord(document) && document.kind === 'document'
}

/** 深拷贝 document，避免保存流程持有调用方可变引用。 */
function cloneDocument(document: Document, requestId?: string): Document {
  try {
    return JSON.parse(JSON.stringify(document)) as Document
  } catch {
    throw createPackageError('JWORD_NATIVE_DOCUMENT_INVALID', 'document 无法序列化为 JSON', requestId, 'document.json')
  }
}

/** 创建 metadata 快照。 */
function createPackageMetadata(metadata: JWordPackageMetadata | undefined): JWordPackageMetadata {
  const now = new Date().toISOString()

  return {
    createdAt: now,
    modifiedAt: now,
    application: JWORD_NATIVE_CREATED_BY,
    ...(metadata ?? {})
  }
}

/** 创建 manifest。 */
function createManifest(
  document: Document,
  resources: readonly PackedResource[],
  featureFlags: readonly string[]
): JWordPackageManifest {
  const resourceEntries = resources.map((item): JWordPackageResourceEntry => ({
    id: item.resource.id,
    ...(item.path === undefined ? {} : { path: item.path }),
    mime: item.resource.mime,
    packed: item.path !== undefined
  }))

  return {
    formatVersion: JWORD_NATIVE_FORMAT_VERSION,
    schemaVersion: JWORD_NATIVE_SCHEMA_VERSION,
    createdBy: JWORD_NATIVE_CREATED_BY,
    minimumReaderVersion: 1,
    featureFlags,
    packageEntries: [
      'manifest.json',
      'document.json',
      'metadata.json',
      'checksums.json',
      'resources/',
      ...resourceEntries.flatMap((entry) => entry.path === undefined ? [] : [entry.path])
    ],
    resources: resourceEntries.length === 0
      ? (document.resources ?? []).map((resource) => ({
          id: resource.id,
          mime: resource.mime,
          packed: false
        }))
      : resourceEntries
  }
}

/** 收集可打包资源并对外部或未完成资源产生 warning。 */
async function collectPackedResources(
  resources: readonly Resource[],
  options: SaveJWordDocumentOptions
): Promise<readonly PackedResource[]> {
  const packed: PackedResource[] = []

  for (const resource of resources) {
    assertNotAborted(options.signal, options.requestId)

    const bytes = readPackableResourceBytes(resource, options.requestId)

    if (resource.status === 'success' && bytes !== undefined) {
      packed.push({
        resource,
        path: `resources/${encodeResourceId(resource.id)}`,
        bytes
      })
      continue
    }

    packed.push({
      resource,
      warning: createWarning(
        'JWORD_NATIVE_RESOURCE_UNPACKED',
        `资源 ${resource.id} 不是可打包 dataUrl，已保留资源引用。`,
        options.requestId
      )
    })
  }

  return packed
}

/** 读取可写入 native package 的资源字节。 */
function readPackableResourceBytes(resource: Resource, requestId?: string): Uint8Array | undefined {
  if (resource.source.kind === 'dataUrl') {
    return decodeDataUrl(resource.source.url, resource.id, requestId)
  }

  const fallback = resource.source.kind === 'blobUrl' ? resource.metadata?.nativeBytesBase64 : undefined

  if (typeof fallback === 'string' && fallback.length > 0) {
    return base64ToBytes(fallback)
  }

  return undefined
}

/** 编码资源 ID 为 zip entry 名称。 */
function encodeResourceId(id: string): string {
  return encodeURIComponent(id)
}

/** 解码 dataUrl 为字节。 */
function decodeDataUrl(url: string, resourceId: string, requestId?: string): Uint8Array {
  const commaIndex = url.indexOf(',')

  if (!url.startsWith('data:') || commaIndex < 0) {
    throw createPackageError(
      'JWORD_NATIVE_DOCUMENT_INVALID',
      `资源 ${resourceId} 的 dataUrl 无效`,
      requestId,
      `resources/${encodeResourceId(resourceId)}`
    )
  }

  const header = url.slice(0, commaIndex)
  const body = url.slice(commaIndex + 1)

  if (header.endsWith(';base64')) {
    return base64ToBytes(body)
  }

  return new TextEncoder().encode(decodeURIComponent(body))
}

/** 把 base64 字符串转换为字节。 */
function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  return bytes
}

/** 创建 package checksums。 */
async function createChecksums(
  zip: JSZip,
  packageEntries: readonly string[],
  resources: readonly PackedResource[],
  options?: SaveJWordDocumentOptions
): Promise<JWordPackageChecksums> {
  const entries: Record<string, NativeChecksumEntry> = {}
  const checksumEntries = [
    'document.json',
    'metadata.json',
    ...resources.flatMap((resource) => resource.path === undefined ? [] : [resource.path])
  ].filter((entry) => packageEntries.includes(entry))

  for (const entry of checksumEntries) {
    assertNotAborted(options?.signal, options?.requestId)

    const file = zip.file(entry)

    if (file === null) {
      continue
    }

    const bytes = await file.async('uint8array')

    assertNotAborted(options?.signal, options?.requestId)

    const sha256 = await sha256Hex(bytes)

    assertNotAborted(options?.signal, options?.requestId)

    entries[entry] = {
      sha256,
      byteLength: bytes.byteLength,
      mime: readEntryMime(entry, resources)
    }
  }

  return { entries }
}

/** 生成 zip 字节并在长任务进度回调中响应取消。 */
async function generateZipBytes(zip: JSZip, options: SaveJWordDocumentOptions): Promise<Uint8Array> {
  return zip.generateAsync({ type: 'uint8array' }, (metadata) => {
    assertNotAborted(options.signal, options.requestId)
    emitProgress('save', Math.floor(metadata.percent), {
      ...options,
      total: 100
    })
  })
}

/** 读取 entry MIME。 */
function readEntryMime(entry: string, resources: readonly PackedResource[]): string {
  const resource = resources.find((item) => item.path === entry)

  if (resource !== undefined) {
    return resource.resource.mime
  }

  return 'application/json'
}

/** 读取并校验 package 主要部分。 */
async function readPackageParts(
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

/** 校验 checksum 和资源 entry。 */
async function inspectChecksums(
  zip: JSZip,
  checksums: JWordPackageChecksums,
  diagnostics: JWordPackageDiagnostic[],
  warnings: JWordPackageWarning[],
  requestId?: string
): Promise<void> {
  for (const [entry, checksum] of Object.entries(checksums.entries)) {
    const file = zip.file(entry)

    if (file === null) {
      const warning = createWarning('JWORD_NATIVE_RESOURCE_MISSING', `${entry} 缺失，正文仍可恢复。`, requestId, entry)
      warnings.push(warning)
      diagnostics.push(warning)
      continue
    }

    const bytes = await file.async('uint8array')
    const actualHash = await sha256Hex(bytes)

    if (actualHash !== checksum.sha256 || bytes.byteLength !== checksum.byteLength) {
      diagnostics.push(createDiagnostic({
        code: 'JWORD_NATIVE_HASH_MISMATCH',
        severity: 'error',
        recoverable: false,
        message: `${entry} checksum 不匹配`,
        entry,
        requestId
      }))
    }
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

/** 执行 schema migration。 */
function migrateDocument(
  document: Document,
  sourceVersion: number,
  requestId?: string
): {
  readonly document: Document
  readonly report: JWordPackageMigrationReport
} {
  const appliedSteps: string[] = []
  let currentDocument = document
  let currentVersion = sourceVersion

  while (currentVersion !== JWORD_NATIVE_SCHEMA_VERSION) {
    const step = findSchemaMigrationStep(currentVersion)

    if (step === undefined) {
      throw createPackageError(
        currentVersion > JWORD_NATIVE_SCHEMA_VERSION ? 'JWORD_NATIVE_SCHEMA_FUTURE' : 'JWORD_NATIVE_SCHEMA_UNSUPPORTED',
        `schemaVersion ${sourceVersion} 无法迁移到当前 schema ${JWORD_NATIVE_SCHEMA_VERSION}`,
        requestId,
        'manifest.json'
      )
    }

    if (step.to <= currentVersion || step.to > JWORD_NATIVE_SCHEMA_VERSION) {
      throw createPackageError(
        'JWORD_NATIVE_SCHEMA_UNSUPPORTED',
        `schema migration ${step.id} 目标版本无效`,
        requestId,
        'manifest.json'
      )
    }

    currentDocument = step.migrate(currentDocument)
    currentVersion = step.to
    appliedSteps.push(step.id)
  }

  const warnings = appliedSteps.length === 0
    ? []
    : [
        createWarning(
          'JWORD_NATIVE_OLD_SCHEMA_MIGRATED',
          `旧 schemaVersion ${sourceVersion} 已迁移到当前 schema。`,
          requestId,
          'manifest.json'
        )
      ]

  return {
    document: currentDocument,
    report: {
      sourceVersion,
      targetVersion: JWORD_NATIVE_SCHEMA_VERSION,
      appliedSteps,
      warnings
    }
  }
}

/** 检查 schema migration 是否存在可达路径。 */
function inspectSchemaMigrationSupport(
  sourceVersion: number,
  diagnostics: JWordPackageDiagnostic[],
  requestId?: string
): void {
  if (sourceVersion >= JWORD_NATIVE_SCHEMA_VERSION || hasSchemaMigrationPath(sourceVersion)) {
    return
  }

  diagnostics.push(createDiagnostic({
    code: 'JWORD_NATIVE_SCHEMA_UNSUPPORTED',
    severity: 'error',
    recoverable: false,
    message: `schemaVersion ${sourceVersion} 无法迁移到当前 schema ${JWORD_NATIVE_SCHEMA_VERSION}`,
    entry: 'manifest.json',
    requestId
  }))
}

/** 判断 schema migration 是否可达当前版本。 */
function hasSchemaMigrationPath(sourceVersion: number): boolean {
  let currentVersion = sourceVersion

  while (currentVersion !== JWORD_NATIVE_SCHEMA_VERSION) {
    const step = findSchemaMigrationStep(currentVersion)

    if (step === undefined || step.to <= currentVersion || step.to > JWORD_NATIVE_SCHEMA_VERSION) {
      return false
    }

    currentVersion = step.to
  }

  return true
}

/** 查找从指定 schema 版本出发的迁移步骤。 */
function findSchemaMigrationStep(sourceVersion: number): SchemaMigrationStep | undefined {
  return SCHEMA_MIGRATION_STEPS.find((step) => step.from === sourceVersion)
}

/** 执行 schema 0 到 1 的显式空迁移。 */
function migrateSchema0To1(document: Document): Document {
  // schema 0 与 1 的 canonical document 结构一致，此步骤仅冻结迁移链语义。
  return document
}

/** 汇总资源打包状态。 */
function summarizeResources(
  manifest: JWordPackageManifest,
  checksums: JWordPackageChecksums
): readonly JWordPackageResourceSummary[] {
  return manifest.resources.map((resource) => {
    const checksum = resource.path === undefined ? undefined : checksums.entries[resource.path]

    return {
      id: resource.id,
      ...(resource.path === undefined ? {} : { path: resource.path }),
      mime: resource.mime,
      ...(checksum === undefined ? {} : { byteLength: checksum.byteLength }),
      packed: resource.packed
    }
  })
}

/** 抛出首个不可恢复诊断。 */
function throwFirstUnrecoverableDiagnostic(diagnostics: readonly JWordPackageDiagnostic[], requestId?: string): void {
  const diagnostic = diagnostics.find((item) => item.severity === 'error' && !item.recoverable)

  if (diagnostic === undefined) {
    return
  }

  throw createPackageError(
    diagnostic.code as JWordPackageErrorCode,
    diagnostic.message,
    requestId ?? diagnostic.requestId,
    diagnostic.entry
  )
}

/** 从错误读取诊断。 */
function readErrorDiagnostic(
  error: unknown,
  fallbackCode: JWordPackageErrorCode,
  entry: string,
  requestId?: string
): JWordPackageDiagnostic {
  if (error instanceof JWordNativePackageError) {
    return createDiagnostic({
      code: error.code,
      severity: 'error',
      recoverable: error.recoverable,
      message: error.message,
      entry: error.entry ?? entry,
      requestId: error.requestId ?? requestId
    })
  }

  return createDiagnostic({
    code: fallbackCode,
    severity: 'error',
    recoverable: false,
    message: error instanceof Error ? error.message : String(error),
    entry,
    requestId
  })
}

/** 创建 warning。 */
function createWarning(
  code: JWordPackageWarningCode,
  message: string,
  requestId?: string,
  entry?: string
): JWordPackageWarning {
  return {
    code,
    severity: 'warning',
    recoverable: true,
    message,
    ...(entry === undefined ? {} : { entry }),
    ...(requestId === undefined ? {} : { requestId })
  }
}

/** 创建 diagnostic。 */
function createDiagnostic(input: {
  readonly code: JWordPackageDiagnosticCode
  readonly severity: JWordPackageDiagnosticSeverity
  readonly recoverable: boolean
  readonly message: string
  readonly entry?: string | undefined
  readonly requestId?: string | undefined
}): JWordPackageDiagnostic {
  return {
    code: input.code,
    severity: input.severity,
    recoverable: input.recoverable,
    message: input.message,
    ...(input.entry === undefined ? {} : { entry: input.entry }),
    ...(input.requestId === undefined ? {} : { requestId: input.requestId })
  }
}

/** 创建 package error。 */
function createPackageError(
  code: JWordPackageErrorCode,
  message: string,
  requestId?: string,
  entry?: string
): JWordNativePackageError {
  return new JWordNativePackageError({
    code,
    message,
    recoverable: false,
    ...(entry === undefined ? {} : { entry }),
    ...(requestId === undefined ? {} : { requestId })
  })
}

/** 检查 AbortSignal。 */
function assertNotAborted(signal: AbortSignal | undefined, requestId?: string): void {
  if (signal?.aborted) {
    throw createPackageError('JWORD_NATIVE_USER_CANCELLED', '任务已取消', requestId)
  }
}

/** 发送进度事件。 */
function emitProgress(
  phase: JWordNativeProgressEvent['phase'],
  loaded: number,
  options: {
    readonly requestId?: string
    readonly total?: number
    readonly onProgress?: (event: JWordNativeProgressEvent) => void
  }
): void {
  options.onProgress?.({
    ...(options.requestId === undefined ? {} : { requestId: options.requestId }),
    phase,
    loaded,
    ...(options.total === undefined ? {} : { total: options.total })
  })
}
