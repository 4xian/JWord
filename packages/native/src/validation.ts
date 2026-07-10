/**
 * 职责：校验 Gate 4.5 .jword 清单、包条目、资源校验和与文档引用一致性。
 * 边界：不读取 zip entry 字节、不执行 schema migration，也不修改 document model。
 * 协作模块：index.ts 的 load/validate 流程、types.ts 稳定诊断类型和 core Document 公开模型。
 * 性能/安全约束：只遍历已解析 JSON，资源缺失的字节级诊断继续由 checksum 校验负责。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import type { Document } from '@4xian/jword-core'

import {
  JWORD_NATIVE_FORMAT_VERSION,
  JWORD_NATIVE_SCHEMA_VERSION,
  type JWordPackageChecksums,
  type JWordPackageDiagnostic,
  type JWordPackageDiagnosticCode,
  type JWordPackageErrorCode,
  type JWordPackageManifest
} from './types.js'
import { isRecord } from './utils.js'

interface JWordPackageIntegrityInput {
  readonly manifest: JWordPackageManifest
  readonly document?: Document
  readonly checksums?: JWordPackageChecksums
  readonly requestId?: string
}

interface JWordPackageIntegrityResult {
  readonly diagnostics: readonly JWordPackageDiagnostic[]
}

const requiredPackageEntries = [
  'manifest.json',
  'document.json',
  'metadata.json',
  'checksums.json',
  'resources/'
]

/** 校验 manifest 和 document/resource 引用的一致性。 */
export function inspectJWordPackageIntegrity(input: JWordPackageIntegrityInput): JWordPackageIntegrityResult {
  const diagnostics: JWordPackageDiagnostic[] = []

  inspectManifestVersions(input.manifest, diagnostics, input.requestId)
  inspectPackageEntries(input.manifest, diagnostics, input.requestId)

  if (input.checksums !== undefined) {
    inspectResourceChecksums(input.manifest, input.checksums, diagnostics, input.requestId)
  }

  if (input.document !== undefined) {
    inspectDocumentResourceReferences(input.document, input.manifest, diagnostics, input.requestId)
  }

  return { diagnostics }
}

/** 校验 format/schema/reader 版本边界。 */
function inspectManifestVersions(
  manifest: JWordPackageManifest,
  diagnostics: JWordPackageDiagnostic[],
  requestId?: string
): void {
  if (manifest.formatVersion !== JWORD_NATIVE_FORMAT_VERSION) {
    diagnostics.push(createErrorDiagnostic(
      'JWORD_NATIVE_FORMAT_UNSUPPORTED',
      `formatVersion ${manifest.formatVersion} 不受当前 reader 支持`,
      'manifest.json',
      requestId
    ))
  }

  if (manifest.schemaVersion > JWORD_NATIVE_SCHEMA_VERSION) {
    diagnostics.push(createErrorDiagnostic(
      'JWORD_NATIVE_SCHEMA_FUTURE',
      `schemaVersion ${manifest.schemaVersion} 高于当前 reader ${JWORD_NATIVE_SCHEMA_VERSION}`,
      'manifest.json',
      requestId
    ))
  }

  if (manifest.minimumReaderVersion > JWORD_NATIVE_FORMAT_VERSION) {
    diagnostics.push(createErrorDiagnostic(
      'JWORD_NATIVE_READER_UNSUPPORTED',
      `minimumReaderVersion ${manifest.minimumReaderVersion} 高于当前 reader ${JWORD_NATIVE_FORMAT_VERSION}`,
      'manifest.json',
      requestId
    ))
  }
}

/** 校验 manifest.packageEntries 覆盖固定 entry 和打包资源。 */
function inspectPackageEntries(
  manifest: JWordPackageManifest,
  diagnostics: JWordPackageDiagnostic[],
  requestId?: string
): void {
  const declared = new Set(manifest.packageEntries)
  const expected = [
    ...requiredPackageEntries,
    ...manifest.resources.flatMap((resource) => resource.path === undefined ? [] : [resource.path])
  ]

  for (const entry of expected) {
    if (!declared.has(entry)) {
      diagnostics.push(createErrorDiagnostic(
        'JWORD_NATIVE_PACKAGE_ENTRY_MISSING',
        `manifest.packageEntries 缺少 ${entry}`,
        entry,
        requestId
      ))
    }
  }
}

/** 校验 manifest.resources 与 checksums 的资源元数据一致。 */
function inspectResourceChecksums(
  manifest: JWordPackageManifest,
  checksums: JWordPackageChecksums,
  diagnostics: JWordPackageDiagnostic[],
  requestId?: string
): void {
  for (const resource of manifest.resources) {
    if (!resource.packed || resource.path === undefined) {
      continue
    }

    const checksum = checksums.entries[resource.path]

    if (checksum === undefined) {
      diagnostics.push(createErrorDiagnostic(
        'JWORD_NATIVE_RESOURCE_CHECKSUM_MISSING',
        `${resource.path} 缺少 checksum 记录`,
        resource.path,
        requestId
      ))
      continue
    }

    if (checksum.mime !== resource.mime) {
      diagnostics.push(createErrorDiagnostic(
        'JWORD_NATIVE_RESOURCE_MIME_MISMATCH',
        `${resource.path} manifest MIME 与 checksum MIME 不一致`,
        resource.path,
        requestId
      ))
    }
  }
}

/** 校验 document 中声明或引用的 resourceId 都存在于 manifest.resources。 */
function inspectDocumentResourceReferences(
  document: Document,
  manifest: JWordPackageManifest,
  diagnostics: JWordPackageDiagnostic[],
  requestId?: string
): void {
  const declared = new Set(manifest.resources.map((resource) => resource.id))
  const references = collectDocumentResourceReferences(document)

  for (const resourceId of references) {
    if (!declared.has(resourceId)) {
      diagnostics.push(createErrorDiagnostic(
        'JWORD_NATIVE_RESOURCE_REFERENCE_MISSING',
        `document 引用了未在 manifest.resources 声明的资源 ${resourceId}`,
        resourceId,
        requestId
      ))
    }
  }
}

/** 收集 document.resourceIds 和 inline resourceId 引用。 */
function collectDocumentResourceReferences(document: Document): Set<string> {
  const references = new Set<string>()
  const documentRecord = document as unknown as Record<string, unknown>
  const resourceIds = documentRecord.resourceIds

  if (Array.isArray(resourceIds)) {
    for (const resourceId of resourceIds) {
      if (typeof resourceId === 'string') {
        references.add(resourceId)
      }
    }
  }

  collectNestedResourceIds(document, references)

  return references
}

/** 递归收集 JSON 结构中的 resourceId 字段。 */
function collectNestedResourceIds(input: unknown, references: Set<string>): void {
  if (Array.isArray(input)) {
    for (const item of input) {
      collectNestedResourceIds(item, references)
    }
    return
  }

  if (!isRecord(input)) {
    return
  }

  if (typeof input.resourceId === 'string') {
    references.add(input.resourceId)
  }

  for (const value of Object.values(input)) {
    collectNestedResourceIds(value, references)
  }
}

/** 创建不可恢复错误诊断。 */
function createErrorDiagnostic(
  code: JWordPackageErrorCode,
  message: string,
  entry: string,
  requestId?: string
): JWordPackageDiagnostic {
  return {
    code: code as JWordPackageDiagnosticCode,
    severity: 'error',
    recoverable: false,
    message,
    entry,
    ...(requestId === undefined ? {} : { requestId })
  }
}
