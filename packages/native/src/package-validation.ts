/**
 * 职责：提供 native package checksum 与资源摘要校验辅助函数。
 * 边界：不读取核心 JSON part，不执行 schema 迁移，不暴露新的公开 API。
 * 协作模块：打包编解码模块创建 checksums，包读取模块校验 checksums 并汇总资源状态。
 * 性能/安全约束：按需读取 zip entry 字节，不访问 DOM、网络或磁盘。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import JSZip from 'jszip'

import { sha256Hex } from './utils.js'
import { assertNotAborted } from './progress.js'
import { createDiagnostic, createWarning } from './diagnostics.js'
import type { PackedResource } from './package-codec.js'
import type {
  JWordPackageChecksumEntry as NativeChecksumEntry,
  JWordPackageChecksums,
  JWordPackageDiagnostic,
  JWordPackageManifest,
  JWordPackageResourceSummary,
  JWordPackageWarning,
  SaveJWordDocumentOptions,
  ValidateJWordPackageOptions
} from './types.js'

/** 创建 package checksums。 */
export async function createChecksums(
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

/** 校验 checksum 和资源 entry。 */
export async function inspectChecksums(
  zip: { readEntry(entry: string): Promise<Uint8Array | undefined> },
  checksums: JWordPackageChecksums,
  diagnostics: JWordPackageDiagnostic[],
  warnings: JWordPackageWarning[],
  options: ValidateJWordPackageOptions,
  retainedEntries: ReadonlySet<string>
): Promise<ReadonlyMap<string, Uint8Array>> {
  const verifiedEntries = new Map<string, Uint8Array>()

  assertNotAborted(options.signal, options.requestId)

  for (const [entry, checksum] of Object.entries(checksums.entries)) {
    assertNotAborted(options.signal, options.requestId)
    const bytes = await zip.readEntry(entry)
    assertNotAborted(options.signal, options.requestId)

    if (bytes === undefined) {
      const warning = createWarning(
        'JWORD_NATIVE_RESOURCE_MISSING',
        `${entry} 缺失，正文仍可恢复。`,
        options.requestId,
        entry
      )
      warnings.push(warning)
      diagnostics.push(warning)
      continue
    }

    const actualHash = await sha256Hex(bytes)
    assertNotAborted(options.signal, options.requestId)

    if (actualHash !== checksum.sha256 || bytes.byteLength !== checksum.byteLength) {
      diagnostics.push(createHashMismatchDiagnostic(entry, options.requestId))
      continue
    }

    if (retainedEntries.has(entry)) {
      verifiedEntries.set(entry, bytes)
    }
  }

  return verifiedEntries
}

/** 在解压 checksum 目标前对比中央目录声明长度。 */
export function inspectChecksumEntryMetadata(
  zip: {
    readonly entries: readonly {
      readonly name: string
      readonly directory: boolean
      readonly uncompressedSize: number
    }[]
  },
  checksums: JWordPackageChecksums,
  diagnostics: JWordPackageDiagnostic[],
  requestId?: string
): void {
  const metadataByName = new Map(zip.entries.map((entry) => [entry.name, entry]))

  for (const [entry, checksum] of Object.entries(checksums.entries)) {
    const metadata = metadataByName.get(entry)

    if (
      metadata !== undefined &&
      !metadata.directory &&
      metadata.uncompressedSize !== checksum.byteLength
    ) {
      diagnostics.push(createHashMismatchDiagnostic(entry, requestId))
      return
    }
  }
}

/** 汇总资源打包状态。 */
export function summarizeResources(
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

/** 读取 entry MIME。 */
function readEntryMime(entry: string, resources: readonly PackedResource[]): string {
  const resource = resources.find((item) => item.path === entry)

  if (resource !== undefined) {
    return resource.resource.mime
  }

  return 'application/json'
}

/** 创建不复制 checksum 输入内容的稳定 mismatch diagnostic。 */
function createHashMismatchDiagnostic(
  entry: string,
  requestId?: string
): JWordPackageDiagnostic {
  return createDiagnostic({
    code: 'JWORD_NATIVE_HASH_MISMATCH',
    severity: 'error',
    recoverable: false,
    message: 'JWORD_NATIVE_HASH_MISMATCH',
    entry,
    requestId
  })
}
