/**
 * 职责：提供 native package checksum 与资源摘要校验辅助函数。
 * 边界：不读取核心 JSON part，不执行 schema 迁移，不暴露新的公开 API。
 * 协作模块：打包编解码模块创建 checksums，包读取模块校验 checksums 并汇总资源状态。
 * 性能/安全约束：按需读取 zip entry 字节，不访问 DOM、网络或磁盘。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#gate-45---jword-原生保存与打开。
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
  SaveJWordDocumentOptions
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
