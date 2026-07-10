/**
 * 职责：提供 Gate 4.5 JWord 原生 .jword zip package 保存、打开和校验公开 API。
 * 边界：只消费 core 公开 canonical document model 和 resource 类型，不读取 editor 内部 store。
 * 协作模块：package-codec.ts、package-readers.ts、schema-migrations.ts、worker.ts、fixtures/native 和后续 vanilla host。
 * 性能/安全约束：主格式是 document.json，不保存渲染缓存、画布位图、DOM 状态或协同 provider 状态。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import { createPackageError, throwFirstUnrecoverableDiagnostic } from './diagnostics.js'
import { readPackageParts } from './package-readers.js'
import { assertNotAborted, emitProgress } from './progress.js'
import { migrateDocument } from './schema-migrations.js'
import type {
  JWordBinaryInput,
  LoadJWordDocumentOptions,
  LoadJWordDocumentResult,
  ValidateJWordPackageOptions,
  ValidateJWordPackageResult
} from './types.js'

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
export { saveJWordDocument } from './package-codec.js'
export {
  JWORD_NATIVE_CREATED_BY,
  JWORD_NATIVE_FORMAT_VERSION,
  JWORD_NATIVE_SCHEMA_VERSION,
  JWordNativePackageError
} from './types.js'
export {
  JWORD_NATIVE_WORKER_CSP_DIRECTIVES,
  detectJWordNativeWorkerCapability
} from './worker-capability.js'
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
export type {
  DetectJWordNativeWorkerCapabilityOptions,
  JWordNativeWorkerCapability,
  JWordNativeWorkerCapabilityRequirement,
  JWordNativeWorkerCapabilityStatus
} from './worker-capability.js'

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
