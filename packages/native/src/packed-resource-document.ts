/**
 * 职责：在 package 逻辑资源引用与运行时 data URL 之间转换 document 快照。
 * 边界：只转换已校验的 canonical document，不读取 ZIP、不执行 checksum，也不创建公开 bytes DTO。
 * 协作模块：package-codec.ts 在保存前创建逻辑快照，package-readers.ts 在完整性校验后重建运行时 source。
 * 性能/安全约束：data URL 分配前按现有总解压预算计入 decoded bytes、UTF-16 字符串和分块临时区。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import type { Document, Resource } from '@4xian/jword-core'

import { createPackageError } from './diagnostics.js'
import { JWORD_NATIVE_PACKAGE_LIMITS, assertNativePackageLimit } from './package-read-budget.js'

interface PackedResourceDocumentEntry {
  readonly resource: Resource
  readonly path?: string
}

const BASE64_CHUNK_BYTES = 3 * 8192
const BASE64_CHUNK_TEMP_BYTES = BASE64_CHUNK_BYTES * 2 + Math.ceil(BASE64_CHUNK_BYTES / 3) * 4 * 2

/** 创建只含稳定 packed-resource 路径且不携带 fallback bytes 的 package document。 */
export function createPackedResourceDocument(
  document: Document,
  packedResources: readonly PackedResourceDocumentEntry[]
): Document {
  if (document.resources === undefined) {
    return document
  }

  const packedById = new Map(packedResources.map((entry) => [entry.resource.id, entry]))

  return {
    ...document,
    resources: document.resources.map((resource) => {
      const packed = packedById.get(resource.id)

      if (packed?.path === undefined) {
        return resource
      }

      const { metadata: originalMetadata, ...resourceWithoutMetadata } = resource
      const metadata = removeNativeBytesFallback(originalMetadata)

      return {
        ...resourceWithoutMetadata,
        source: {
          kind: 'packedResource',
          url: packed.path
        },
        ...(metadata === undefined ? {} : { metadata })
      }
    })
  }
}

/** 把已通过 checksum 与 manifest 校验的 packed resource 重建为运行时 data URL。 */
export function materializePackedResourceDocument(
  document: Document,
  verifiedResourceBytes: ReadonlyMap<string, Uint8Array>,
  requestId?: string
): Document {
  if (document.resources === undefined) {
    return document
  }

  const resources = document.resources
  let requiredBytes = BASE64_CHUNK_TEMP_BYTES

  for (const resource of resources) {
    if (resource.source.kind !== 'packedResource') {
      continue
    }

    const bytes = readVerifiedResourceBytes(resource, verifiedResourceBytes, requestId)
    const dataUrlChars = createDataUrlHeader(resource.mime).length + Math.ceil(bytes.byteLength / 3) * 4

    requiredBytes += bytes.byteLength + dataUrlChars * 2
  }

  assertNativePackageLimit(
    requiredBytes,
    JWORD_NATIVE_PACKAGE_LIMITS.totalUncompressedBytes,
    requestId
  )

  return {
    ...document,
    resources: resources.map((resource) => {
      if (resource.source.kind !== 'packedResource') {
        return resource
      }

      return {
        ...resource,
        source: {
          kind: 'dataUrl',
          url: encodeDataUrl(
            resource.mime,
            readVerifiedResourceBytes(resource, verifiedResourceBytes, requestId)
          )
        }
      }
    })
  }
}

/** 删除只供保存输入使用的 blob fallback，保留其余 metadata。 */
function removeNativeBytesFallback(metadata: Resource['metadata']): Resource['metadata'] | undefined {
  if (metadata === undefined || !Object.hasOwn(metadata, 'nativeBytesBase64')) {
    return metadata
  }

  const remainingEntries = Object.entries(metadata).filter(([key]) => key !== 'nativeBytesBase64')

  return remainingEntries.length === 0 ? undefined : Object.fromEntries(remainingEntries)
}

/** 读取已经通过 checksum 校验的资源字节。 */
function readVerifiedResourceBytes(
  resource: Resource,
  verifiedResourceBytes: ReadonlyMap<string, Uint8Array>,
  requestId?: string
): Uint8Array {
  const bytes = verifiedResourceBytes.get(resource.source.url)

  if (bytes === undefined) {
    throw createPackageError(
      'JWORD_NATIVE_RESOURCE_REFERENCE_MISSING',
      'JWORD_NATIVE_RESOURCE_REFERENCE_MISSING',
      requestId,
      'document.json'
    )
  }

  return bytes
}

/** 创建 data URL 的稳定 MIME/header。 */
function createDataUrlHeader(mime: string): string {
  return `data:${mime};base64,`
}

/** 使用可整除 3 的小块生成 base64，避免分配资源大小的 binary 临时字符串。 */
function encodeDataUrl(mime: string, bytes: Uint8Array): string {
  let dataUrl = createDataUrlHeader(mime)

  for (let offset = 0; offset < bytes.byteLength; offset += BASE64_CHUNK_BYTES) {
    const end = Math.min(offset + BASE64_CHUNK_BYTES, bytes.byteLength)
    let binary = ''

    for (let index = offset; index < end; index += 1) {
      binary += String.fromCharCode(bytes[index] ?? 0)
    }

    dataUrl += btoa(binary)
  }

  return dataUrl
}
