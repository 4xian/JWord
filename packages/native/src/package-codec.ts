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
import { createChecksums, summarizeResources } from './package-validation.js'
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
