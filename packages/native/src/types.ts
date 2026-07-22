/**
 * 职责：集中定义 Gate 4.5 native package 的公开常量、类型和稳定错误。
 * 边界：只包含类型与错误对象，不执行 zip 读写、资源转换或 schema migration。
 * 协作模块：index.ts、worker.ts、外部宿主和测试 fixture。
 * 性能/安全约束：公开类型保持 JSON-compatible，不暴露内部可写状态。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import type { Document } from '@4xian/jword-core'

/** 当前 `.jword` package manifest 的公开格式版本。 */
export const JWORD_NATIVE_FORMAT_VERSION = 2
export const JWORD_NATIVE_SCHEMA_VERSION = 2
export const JWORD_NATIVE_CREATED_BY = '@4xian/jword-native'

export type JWordBinaryInput = ArrayBuffer | Uint8Array | Blob | File

export type JWordPackageDiagnosticSeverity = 'warning' | 'error'

export type JWordPackageWarningCode =
  | 'JWORD_NATIVE_RESOURCE_UNPACKED'
  | 'JWORD_NATIVE_RESOURCE_MISSING'
  | 'JWORD_NATIVE_OLD_SCHEMA_MIGRATED'

export type JWordPackageErrorCode =
  | 'JWORD_NATIVE_MANIFEST_MISSING'
  | 'JWORD_NATIVE_DOCUMENT_MISSING'
  | 'JWORD_NATIVE_METADATA_MISSING'
  | 'JWORD_NATIVE_CHECKSUMS_MISSING'
  | 'JWORD_NATIVE_MANIFEST_INVALID'
  | 'JWORD_NATIVE_METADATA_INVALID'
  | 'JWORD_NATIVE_DOCUMENT_INVALID'
  | 'JWORD_NATIVE_CHECKSUMS_INVALID'
  | 'JWORD_NATIVE_FORMAT_UNSUPPORTED'
  | 'JWORD_NATIVE_READER_UNSUPPORTED'
  | 'JWORD_NATIVE_PACKAGE_ENTRY_MISSING'
  | 'JWORD_NATIVE_RESOURCE_CHECKSUM_MISSING'
  | 'JWORD_NATIVE_RESOURCE_MIME_MISMATCH'
  | 'JWORD_NATIVE_RESOURCE_REFERENCE_MISSING'
  | 'JWORD_NATIVE_SCHEMA_FUTURE'
  | 'JWORD_NATIVE_SCHEMA_UNSUPPORTED'
  | 'JWORD_NATIVE_HASH_MISMATCH'
  | 'JWORD_NATIVE_PACKAGE_INVALID'
  | 'JWORD_NATIVE_PACKAGE_RESOURCE_LIMIT_EXCEEDED'
  | 'JWORD_NATIVE_USER_CANCELLED'
  | 'JWORD_NATIVE_WORKER_CANCELLED'
  | 'JWORD_NATIVE_WORKER_UNAVAILABLE'
  | 'JWORD_NATIVE_WORKER_ERROR'

export type JWordPackageDiagnosticCode = JWordPackageWarningCode | JWordPackageErrorCode

export interface JWordPackageDiagnostic {
  readonly code: JWordPackageDiagnosticCode
  readonly severity: JWordPackageDiagnosticSeverity
  readonly recoverable: boolean
  readonly message: string
  readonly entry?: string
  readonly path?: string
  readonly requestId?: string
}

export interface JWordPackageWarning extends JWordPackageDiagnostic {
  readonly code: JWordPackageWarningCode
  readonly severity: 'warning'
  readonly recoverable: true
}

export type JWordPackageMetadata = Readonly<Record<string, unknown>>

export interface JWordPackageManifest {
  readonly formatVersion: number
  readonly schemaVersion: number
  readonly createdBy: string
  readonly minimumReaderVersion: number
  readonly featureFlags: readonly string[]
  readonly packageEntries: readonly string[]
  readonly resources: readonly JWordPackageResourceEntry[]
}

export interface JWordPackageResourceEntry {
  readonly id: string
  readonly path?: string
  readonly mime: string
  readonly packed: boolean
}

export interface JWordPackageChecksumEntry {
  readonly sha256: string
  readonly byteLength: number
  readonly mime: string
}

export interface JWordPackageChecksums {
  readonly entries: Readonly<Record<string, JWordPackageChecksumEntry>>
}

export interface JWordPackageResourceSummary {
  readonly id: string
  readonly path?: string
  readonly mime: string
  readonly byteLength?: number
  readonly packed: boolean
}

export interface JWordPackageMigrationReport {
  readonly sourceVersion: number
  readonly targetVersion: number
  readonly appliedSteps: readonly string[]
  readonly warnings: readonly JWordPackageWarning[]
}

export interface JWordNativeProgressEvent {
  readonly requestId?: string
  readonly phase: 'save' | 'load' | 'validate'
  readonly loaded: number
  readonly total?: number
}

export interface SaveJWordDocumentOptions {
  readonly requestId?: string
  readonly signal?: AbortSignal
  readonly metadata?: JWordPackageMetadata
  readonly featureFlags?: readonly string[]
  readonly onProgress?: (event: JWordNativeProgressEvent) => void
}

export interface LoadJWordDocumentOptions {
  readonly requestId?: string
  readonly signal?: AbortSignal
  readonly onProgress?: (event: JWordNativeProgressEvent) => void
  readonly onWarning?: (warning: JWordPackageWarning) => void
}

export interface ValidateJWordPackageOptions {
  readonly requestId?: string
  readonly signal?: AbortSignal
  readonly onProgress?: (event: JWordNativeProgressEvent) => void
}

/** 保存 `.jword` package 后返回的二进制、manifest、checksum 和诊断摘要。 */
export interface SaveJWordDocumentResult {
  readonly bytes: Uint8Array
  readonly blob: Blob
  readonly manifest: JWordPackageManifest
  readonly metadata: JWordPackageMetadata
  readonly checksums: JWordPackageChecksums
  readonly warnings: readonly JWordPackageWarning[]
  readonly diagnostics: readonly JWordPackageDiagnostic[]
  readonly resources: readonly JWordPackageResourceSummary[]
}

/** 加载 `.jword` package 后返回的 canonical 文档、metadata、迁移报告和诊断摘要。 */
export interface LoadJWordDocumentResult {
  readonly document: Document
  readonly metadata: JWordPackageMetadata
  readonly manifest: JWordPackageManifest
  readonly checksums: JWordPackageChecksums
  readonly warnings: readonly JWordPackageWarning[]
  readonly diagnostics: readonly JWordPackageDiagnostic[]
  readonly migrationReport: JWordPackageMigrationReport
  readonly resources: readonly JWordPackageResourceSummary[]
}

export interface ValidateJWordPackageResult {
  readonly valid: boolean
  readonly manifest?: JWordPackageManifest
  readonly metadata?: JWordPackageMetadata
  readonly checksums?: JWordPackageChecksums
  readonly warnings: readonly JWordPackageWarning[]
  readonly diagnostics: readonly JWordPackageDiagnostic[]
  readonly resources: readonly JWordPackageResourceSummary[]
}

export interface JWordNativePackageErrorInput {
  readonly code: JWordPackageErrorCode
  readonly message: string
  readonly recoverable?: boolean
  readonly entry?: string | undefined
  readonly path?: string | undefined
  readonly requestId?: string | undefined
}

export interface JWordNativeSaveRequest {
  readonly type: 'save'
  readonly requestId: string
  readonly document: Document
  readonly options?: SaveJWordDocumentOptions
}

export interface JWordNativeLoadRequest {
  readonly type: 'load'
  readonly requestId: string
  readonly input: JWordBinaryInput
  readonly options?: LoadJWordDocumentOptions
}

export interface JWordNativeValidateRequest {
  readonly type: 'validate'
  readonly requestId: string
  readonly input: JWordBinaryInput
  readonly options?: ValidateJWordPackageOptions
}

export interface JWordNativeCancelRequest {
  readonly type: 'cancel'
  readonly requestId: string
}

export type JWordNativeWorkerRequest =
  | JWordNativeSaveRequest
  | JWordNativeLoadRequest
  | JWordNativeValidateRequest
  | JWordNativeCancelRequest

export type JWordNativeTransferable = ArrayBuffer

export type JWordNativeWorkerEvent =
  | {
      readonly type: 'progress'
      readonly requestId: string
      readonly progress: JWordNativeProgressEvent
    }
  | {
      readonly type: 'warning'
      readonly requestId: string
      readonly warning: JWordPackageWarning
    }
  | {
      readonly type: 'save-result'
      readonly requestId: string
      readonly result: SaveJWordDocumentResult
    }
  | {
      readonly type: 'load-result'
      readonly requestId: string
      readonly result: LoadJWordDocumentResult
    }
  | {
      readonly type: 'validate-result'
      readonly requestId: string
      readonly result: ValidateJWordPackageResult
    }
  | {
      readonly type: 'error'
      readonly requestId: string
      readonly error: JWordNativePackageErrorShape
    }

export interface JWordNativePackageErrorShape {
  readonly name: 'JWordNativePackageError'
  readonly code: JWordPackageErrorCode
  readonly message: string
  readonly recoverable: boolean
  readonly entry?: string
  readonly path?: string
  readonly requestId?: string
}

export class JWordNativePackageError extends Error {
  override readonly name = 'JWordNativePackageError'
  readonly code: JWordPackageErrorCode
  readonly recoverable: boolean
  readonly entry?: string
  readonly path?: string
  readonly requestId?: string

  /** 创建 native package 稳定错误对象。 */
  constructor(input: JWordNativePackageErrorInput) {
    super(input.message)
    this.code = input.code
    this.recoverable = input.recoverable ?? false
    if (input.entry !== undefined) {
      this.entry = input.entry
    }
    if (input.path !== undefined) {
      this.path = input.path
    }
    if (input.requestId !== undefined) {
      this.requestId = input.requestId
    }
  }
}
