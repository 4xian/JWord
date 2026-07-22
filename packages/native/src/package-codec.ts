/**
 * 职责：实现 native package 保存流程和 zip 编码辅助函数。
 * 边界：只负责把 canonical document 写入 .jword zip，不读取外部 package，不执行 schema 迁移。
 * 协作模块：index.ts 公开入口 re-export，本模块复用诊断、进度与 checksum 校验模块。
 * 性能/安全约束：不保存渲染缓存、画布位图、DOM 状态或协同 provider 状态。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
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
  JWORD_NATIVE_SCHEMA_VERSION
} from './types.js'
import { copyBytesToArrayBuffer, isRecord, stringifyJson } from './utils.js'
import { assertNotAborted, emitProgress } from './progress.js'
import { createPackageError, createWarning } from './diagnostics.js'
import { parseCurrentJWordDocument } from './document-schema.js'
import { validateUniqueNativePackageEntryNames } from './package-entry-name.js'
import {
  JWORD_NATIVE_PACKAGE_LIMITS,
  assertNativePackageLimit,
  readNativePackageEntryLimit
} from './package-read-budget.js'
import { createChecksums, summarizeResources } from './package-validation.js'
import { parseStrictJsonRecord } from './strict-json.js'
import { preflightNativeZip } from './zip-preflight.js'
import { createPackedResourceDocument } from './packed-resource-document.js'
import type {
  JWordPackageDiagnostic,
  JWordPackageManifest,
  JWordPackageMetadata,
  JWordPackageResourceEntry,
  JWordPackageWarning,
  SaveJWordDocumentOptions,
  SaveJWordDocumentResult
} from './types.js'

export interface PackedResource {
  readonly resource: Resource
  readonly path?: string
  readonly bytes?: Uint8Array
  readonly warning?: JWordPackageWarning
}

const textEncoder = new TextEncoder()

/** 保存 Editor、projection 或 canonical document 为 .jword zip package。 */
export async function saveJWordDocument(
  editorOrModel: Editor | DocumentProjection | Document,
  options: SaveJWordDocumentOptions = {}
): Promise<SaveJWordDocumentResult> {
  assertNotAborted(options.signal, options.requestId)
  emitProgress('save', 0, options)

  const sourceDocument = parseCurrentJWordDocument(readDocumentFromInput(editorOrModel), options.requestId)
  const metadataSnapshot = createMetadataSnapshot(options.metadata, options.requestId)
  const metadata = metadataSnapshot.metadata
  const resources = await collectPackedResources(sourceDocument.resources ?? [], options)
  const snapshot = createDocumentSnapshot(
    createPackedResourceDocument(sourceDocument, resources),
    options.requestId
  )
  const document = snapshot.document
  const warnings = resources.flatMap((item) => item.warning === undefined ? [] : [item.warning])
  const manifest = createManifest(document, resources, options.featureFlags ?? [])
  assertSavePackageEntries(manifest, options.requestId)
  const manifestJson = stringifyJson(manifest)
  const documentJson = snapshot.json
  const metadataJson = metadataSnapshot.json
  const zip = new JSZip()

  zip.file('manifest.json', manifestJson)
  zip.file('document.json', documentJson)
  zip.file('metadata.json', metadataJson)
  zip.folder('resources')

  for (const resource of resources) {
    assertNotAborted(options.signal, options.requestId)

    if (resource.path !== undefined && resource.bytes !== undefined) {
      zip.file(resource.path, resource.bytes)
    }
  }

  assertNotAborted(options.signal, options.requestId)

  const checksums = await createChecksums(zip, manifest.packageEntries, resources, options)
  assertNativePackageLimit(
    Object.keys(checksums.entries).length,
    JWORD_NATIVE_PACKAGE_LIMITS.itemCount,
    options.requestId,
    'checksums.json'
  )
  const checksumsJson = stringifyJson(checksums)

  assertSavePackageBytes({
    manifestJson,
    documentJson,
    metadataJson,
    checksumsJson,
    resources,
    ...(options.requestId === undefined ? {} : { requestId: options.requestId })
  })

  assertNotAborted(options.signal, options.requestId)

  zip.file('checksums.json', checksumsJson)

  const bytes = await generateZipBytes(zip, options)

  assertNotAborted(options.signal, options.requestId)
  assertNativePackageLimit(bytes.byteLength, JWORD_NATIVE_PACKAGE_LIMITS.inputBytes, options.requestId)
  preflightNativeZip(bytes, options.requestId)

  const summaries = summarizeResources(manifest, checksums)
  const diagnostics = warnings.map((warning): JWordPackageDiagnostic => warning)

  emitProgress('save', bytes.byteLength, {
    ...options,
    total: bytes.byteLength
  })
  assertNotAborted(options.signal, options.requestId)

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

/** 创建受共享 JSON 预算和 current schema 约束的 document 快照。 */
function createDocumentSnapshot(
  document: Document,
  requestId?: string
): { readonly document: Document, readonly json: string } {
  let json: string

  try {
    json = stringifyJson(document)
  } catch {
    throw createPackageError('JWORD_NATIVE_DOCUMENT_INVALID', 'document 无法序列化为 JSON', requestId, 'document.json')
  }

  assertNativePackageLimit(
    textEncoder.encode(json).byteLength,
    JWORD_NATIVE_PACKAGE_LIMITS.documentBytes,
    requestId,
    'document.json'
  )
  const snapshot = parseStrictJsonRecord(json, {
    entry: 'document.json',
    invalidCode: 'JWORD_NATIVE_DOCUMENT_INVALID',
    ...(requestId === undefined ? {} : { requestId })
  })

  return {
    document: parseCurrentJWordDocument(snapshot, requestId),
    json
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

/** 创建受共享 JSON 深度、value 数和字节预算约束的 metadata 快照。 */
function createMetadataSnapshot(
  metadata: JWordPackageMetadata | undefined,
  requestId?: string
): { readonly metadata: JWordPackageMetadata, readonly json: string } {
  let json: string

  try {
    json = stringifyJson(createPackageMetadata(metadata))
  } catch {
    throw createPackageError('JWORD_NATIVE_METADATA_INVALID', 'JWORD_NATIVE_METADATA_INVALID', requestId, 'metadata.json')
  }

  assertNativePackageLimit(
    textEncoder.encode(json).byteLength,
    JWORD_NATIVE_PACKAGE_LIMITS.metadataBytes,
    requestId,
    'metadata.json'
  )

  return {
    metadata: parseStrictJsonRecord(json, {
      entry: 'metadata.json',
      invalidCode: 'JWORD_NATIVE_METADATA_INVALID',
      ...(requestId === undefined ? {} : { requestId })
    }),
    json
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
    minimumReaderVersion: JWORD_NATIVE_FORMAT_VERSION,
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
  let packedBytes = 0

  assertNativePackageLimit(resources.length, JWORD_NATIVE_PACKAGE_LIMITS.itemCount, options.requestId)

  for (const resource of resources) {
    assertNotAborted(options.signal, options.requestId)

    const bytes = readPackableResourceBytes(resource, options.requestId)

    if (resource.status === 'success' && bytes !== undefined) {
      assertNativePackageLimit(
        bytes.byteLength,
        JWORD_NATIVE_PACKAGE_LIMITS.packedResourceBytes,
        options.requestId
      )
      packedBytes += bytes.byteLength
      assertNativePackageLimit(
        packedBytes,
        JWORD_NATIVE_PACKAGE_LIMITS.totalUncompressedBytes,
        options.requestId
      )
      packed.push({
        resource,
        path: createPackedResourcePath(resource.id, options.requestId),
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

  if (resource.source.kind === 'packedResource') {
    throw createPackageError(
      'JWORD_NATIVE_DOCUMENT_INVALID',
      'JWORD_NATIVE_DOCUMENT_INVALID',
      requestId,
      'document.json'
    )
  }

  const fallback = resource.source.kind === 'blobUrl' ? resource.metadata?.nativeBytesBase64 : undefined

  if (typeof fallback === 'string' && fallback.length > 0) {
    return base64ToBytes(fallback)
  }

  if (resource.source.kind === 'blobUrl') {
    throw createPackageError(
      'JWORD_NATIVE_DOCUMENT_INVALID',
      'JWORD_NATIVE_DOCUMENT_INVALID',
      requestId,
      'document.json'
    )
  }

  return undefined
}

/** 创建经过共用名称规则校验的 packed resource 路径。 */
function createPackedResourcePath(id: string, requestId?: string): string {
  try {
    const encoded = encodeURIComponent(id)
    const safeEncoded = encoded === '.' ? '%2E' : encoded === '..' ? '%2E%2E' : encoded
    const path = `resources/${safeEncoded}`

    validateUniqueNativePackageEntryNames([{ name: path, directory: false }], requestId)

    return path
  } catch {
    throw createPackageError(
      'JWORD_NATIVE_DOCUMENT_INVALID',
      'JWORD_NATIVE_DOCUMENT_INVALID',
      requestId,
      'document.json'
    )
  }
}

/** 解码 dataUrl 为字节。 */
function decodeDataUrl(url: string, resourceId: string, requestId?: string): Uint8Array {
  const commaIndex = url.indexOf(',')

  if (!url.startsWith('data:') || commaIndex < 0) {
    throw createPackageError(
      'JWORD_NATIVE_DOCUMENT_INVALID',
      `资源 ${resourceId} 的 dataUrl 无效`,
      requestId,
      'document.json'
    )
  }

  const header = url.slice(0, commaIndex)
  const body = url.slice(commaIndex + 1)

  try {
    if (header.endsWith(';base64')) {
      return base64ToBytes(body)
    }

    return new TextEncoder().encode(decodeURIComponent(body))
  } catch {
    throw createPackageError(
      'JWORD_NATIVE_DOCUMENT_INVALID',
      'JWORD_NATIVE_DOCUMENT_INVALID',
      requestId,
      'document.json'
    )
  }
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

/** 生成 zip 字节并在长任务进度回调中响应取消。 */
function generateZipBytes(zip: JSZip, options: SaveJWordDocumentOptions): Promise<Uint8Array> {
  return zip.generateAsync({ type: 'uint8array' }, (metadata) => {
    assertNotAborted(options.signal, options.requestId)
    emitProgress('save', Math.floor(metadata.percent), {
      ...options,
      total: 100
    })
  })
}

/** 校验保存器将生成的 entry 数量、名称和规范化唯一性。 */
function assertSavePackageEntries(manifest: JWordPackageManifest, requestId?: string): void {
  assertNativePackageLimit(manifest.resources.length, JWORD_NATIVE_PACKAGE_LIMITS.itemCount, requestId, 'manifest.json')
  assertNativePackageLimit(manifest.packageEntries.length, JWORD_NATIVE_PACKAGE_LIMITS.itemCount, requestId, 'manifest.json')
  assertNativePackageLimit(manifest.packageEntries.length, JWORD_NATIVE_PACKAGE_LIMITS.entryCount, requestId)

  try {
    validateUniqueNativePackageEntryNames(
      manifest.packageEntries.map((name) => ({ name, directory: name.endsWith('/') })),
      requestId
    )
  } catch {
    throw createPackageError(
      'JWORD_NATIVE_DOCUMENT_INVALID',
      'JWORD_NATIVE_DOCUMENT_INVALID',
      requestId,
      'document.json'
    )
  }
}

/** 校验四个 JSON 与 packed resource 的保存侧实际字节预算。 */
function assertSavePackageBytes(input: {
  readonly manifestJson: string
  readonly documentJson: string
  readonly metadataJson: string
  readonly checksumsJson: string
  readonly resources: readonly PackedResource[]
  readonly requestId?: string
}): void {
  const jsonEntries = [
    ['manifest.json', input.manifestJson],
    ['document.json', input.documentJson],
    ['metadata.json', input.metadataJson],
    ['checksums.json', input.checksumsJson]
  ] as const
  let totalJsonBytes = 0

  for (const [entry, text] of jsonEntries) {
    const byteLength = textEncoder.encode(text).byteLength

    assertNativePackageLimit(byteLength, readNativePackageEntryLimit(entry), input.requestId, entry)
    totalJsonBytes += byteLength
  }

  assertNativePackageLimit(totalJsonBytes, JWORD_NATIVE_PACKAGE_LIMITS.totalJsonBytes, input.requestId)

  const totalResourceBytes = input.resources.reduce(
    (total, resource) => total + (resource.bytes?.byteLength ?? 0),
    0
  )

  assertNativePackageLimit(
    totalJsonBytes + totalResourceBytes,
    JWORD_NATIVE_PACKAGE_LIMITS.totalUncompressedBytes,
    input.requestId
  )
}
