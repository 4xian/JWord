/**
 * 职责：集中定义 Gate 5 DOCX 公开 API、导入导出结果、索引和 worker 消息类型。
 * 边界：只放类型契约，不读取 ZIP、XML、worker 或 core store。
 * 协作模块：index.ts、package.ts、import.ts、export.ts、worker.ts 和兼容报告复用这些公开类型。
 * 性能/安全约束：类型模块无运行时副作用，避免把 JSZip 或 worker 逻辑拉入首屏。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#gate-5docx-导入导出与-pdf-导出。
 */

import type { DocumentProjection } from '@4xian/jword-core'
import type {
  JWordLicenseDiagnosticCode,
  JWordLicenseEntitlement,
  JWordLicenseFeatureKey
} from '@4xian/jword-license'

import type {
  DocxDiagnosticSeverity,
  DocxErrorCode,
  DocxWarningCode
} from './diagnostics.js'

export type DocxBinaryInput = ArrayBuffer | Uint8Array | Blob | File

export type DocxProgressStage =
  | 'queued'
  | 'reading'
  | 'parsing'
  | 'mapping'
  | 'writing'
  | 'validating'
  | 'done'

export type DocxWarningSeverity = DocxDiagnosticSeverity

export interface DocxWarning {
  readonly code: DocxWarningCode
  readonly severity: DocxWarningSeverity
  readonly part?: string
  readonly path?: string
  readonly message: string
  readonly fallback?: string
  readonly recoverable: boolean
}

export interface DocxDiagnostics {
  readonly requestId?: string
  readonly progress?: readonly DocxProgressStage[]
  readonly mainDocumentPart?: string
}

export type DocxPackageErrorCode =
  Extract<
    DocxErrorCode,
    | 'DOCX_PACKAGE_INVALID'
    | 'DOCX_PACKAGE_RESOURCE_LIMIT_EXCEEDED'
    | 'DOCX_CONTENT_TYPES_MISSING'
    | 'DOCX_ROOT_RELS_MISSING'
    | 'DOCX_MAIN_DOCUMENT_MISSING'
  >

export interface DocxError {
  readonly name: 'DocxUnsupportedError' | 'DocxPackageError' | 'JWordLicenseError'
  readonly code: DocxErrorCode | JWordLicenseDiagnosticCode
  readonly message: string
  readonly requestId?: string
  readonly feature?: JWordLicenseFeatureKey
  readonly customerId?: string
}

export interface DocxOpaquePreservation {
  readonly unsupportedParts: readonly DocxOpaqueUnsupportedPart[]
  readonly unsupportedRelationships: readonly DocxOpaqueUnsupportedRelationship[]
  readonly unsupportedElementFragments: readonly DocxOpaqueUnsupportedElementFragment[]
  readonly originalStyleIds: readonly string[]
  readonly originalNumberingIds: readonly string[]
}

export interface DocxOpaqueUnsupportedPart {
  readonly part: string
  readonly contentType?: string
  readonly text?: string
  readonly bytes?: readonly number[]
  readonly unsafeToPreserveAfterEdit: boolean
}

export interface DocxOpaqueUnsupportedRelationship {
  readonly id: string
  readonly kind: string
  readonly type?: string
  readonly target: string
  readonly targetMode?: string
  readonly sourcePart: string
  readonly unsafeToPreserveAfterEdit: boolean
}

export interface DocxOpaqueUnsupportedElementFragment {
  readonly part: string
  readonly path: string
  readonly xml: string
  readonly unsafeToPreserveAfterEdit: boolean
}

export interface DocxImportDocument {
  readonly kind: 'docx-import-document'
  readonly metadata: DocxImportMetadata
  readonly sections: readonly DocxImportSection[]
  readonly resources: readonly DocxImportResource[]
  readonly comments: readonly DocxImportComment[]
  readonly opaque: DocxOpaquePreservation
}

export interface DocxImportMetadata {
  readonly mainDocumentPart: string
  readonly styleIds: readonly string[]
  readonly numberingIds: readonly string[]
}

export interface DocxImportSection {
  readonly kind: 'section'
  readonly id: string
  readonly breakType?: 'continuous' | 'next-page'
  readonly page?: DocxImportSectionPage
  readonly columns?: number
  readonly headerIds: readonly string[]
  readonly footerIds: readonly string[]
  readonly headerFooterSameAsPrevious?: boolean
  readonly pageNumbering?: DocxImportSectionPageNumbering
  readonly blocks: readonly DocxImportBlock[]
}

export interface DocxImportSectionPage {
  readonly widthTwips?: number
  readonly heightTwips?: number
  readonly marginTwips?: DocxImportSectionMargins
  readonly columns?: number
}

export interface DocxImportSectionMargins {
  readonly top?: number
  readonly right?: number
  readonly bottom?: number
  readonly left?: number
}

export interface DocxImportSectionPageNumbering {
  readonly mode: 'continue' | 'restart'
  readonly start?: number
}

export type DocxImportBlock = DocxImportParagraph | DocxImportTable

export interface DocxImportParagraph {
  readonly kind: 'paragraph'
  readonly id: string
  readonly styleId?: string
  readonly properties?: Readonly<Record<string, unknown>>
  readonly tabs?: readonly number[]
  readonly runs: readonly DocxImportRun[]
}

export interface DocxImportRun {
  readonly kind: 'run'
  readonly id: string
  readonly properties?: Readonly<Record<string, unknown>>
  readonly field?: DocxImportRunField
  readonly link?: DocxImportRunLink
  readonly revisionId?: string
  readonly inlines: readonly DocxImportInline[]
}

export interface DocxImportRunField {
  readonly code: string
  readonly result?: string
}

export interface DocxImportRunLink {
  readonly target: string
  readonly tooltip?: string
}

export type DocxImportInline =
  | DocxImportTextInline
  | DocxImportBreakInline
  | DocxImportTabInline
  | DocxImportCommentRangeMarkerInline
  | DocxImportBookmarkInline
  | DocxImportImageInline

export interface DocxImportTextInline {
  readonly kind: 'text'
  readonly text: string
}

export interface DocxImportBreakInline {
  readonly kind: 'break'
  readonly breakType: 'line' | 'page' | 'column'
}

export interface DocxImportTabInline {
  readonly kind: 'text'
  readonly text: '\t'
}

export interface DocxImportImageInline {
  readonly kind: 'image'
  readonly resourceId: string
  readonly alt?: string
  readonly display?: 'inline'
  readonly widthTwips?: number
  readonly heightTwips?: number
  readonly rotationDegrees?: number
}

export interface DocxImportCommentRangeMarkerInline {
  readonly kind: 'commentRangeMarker'
  readonly commentId: string
  readonly edge: 'start' | 'end'
}

export interface DocxImportBookmarkInline {
  readonly kind: 'bookmark'
  readonly id: string
  readonly name: string
  readonly edge: 'start' | 'end'
}

export interface DocxImportTable {
  readonly kind: 'table'
  readonly id: string
  readonly properties?: Readonly<Record<string, unknown>>
  readonly grid?: readonly number[]
  readonly border?: DocxImportTableBorder
  readonly rows: readonly DocxImportTableRow[]
}

export interface DocxImportTableRow {
  readonly id: string
  readonly properties?: Readonly<Record<string, unknown>>
  readonly cells: readonly DocxImportTableCell[]
}

export interface DocxImportTableCell {
  readonly id: string
  readonly properties?: Readonly<Record<string, unknown>>
  readonly border?: DocxImportTableBorder
  readonly gridSpan?: number
  readonly blocks: readonly DocxImportBlock[]
}

export interface DocxImportTableBorder {
  readonly color?: string
  readonly widthTwips?: number
}

export interface DocxImportResource {
  readonly kind: 'resource'
  readonly resourceId: string
  readonly mimeType: string
  readonly extension: string
  readonly targetPart: string
  readonly bytes: Uint8Array
}

export interface DocxImportComment {
  readonly id: string
  readonly commentId: string
  readonly author: string
  readonly date?: string
  readonly text: string
}

export interface ImportDocxOptions {
  readonly requestId?: string
  readonly signal?: AbortSignal
  readonly license?: JWordLicenseEntitlement | null
}

/** DOCX 导入结果，包含中间文档模型、warning 和稳定 diagnostics。 */
export interface ImportDocxResult {
  readonly document: DocxImportDocument
  readonly warnings: readonly DocxWarning[]
  readonly diagnostics: DocxDiagnostics
}

export interface ExportDocxOptions {
  readonly requestId?: string
  readonly signal?: AbortSignal
  readonly opaque?: DocxOpaquePreservation
  readonly license?: JWordLicenseEntitlement | null
}

/** DOCX 导出结果，包含二进制 package、warning 和稳定 diagnostics。 */
export interface ExportDocxResult {
  readonly bytes: ArrayBuffer
  readonly warnings: readonly DocxWarning[]
  readonly diagnostics: DocxDiagnostics
}

export interface InspectDocxPackageResult {
  readonly parts: readonly string[]
  readonly relationships: readonly string[]
  readonly partGraph: DocxPartGraph
  readonly warnings: readonly DocxWarning[]
  readonly diagnostics: DocxDiagnostics
}

export interface DocxPartGraph {
  readonly document: string
  readonly styles?: string
  readonly numbering?: string
  readonly settings?: string
  readonly theme?: string
  readonly headers: readonly string[]
  readonly footers: readonly string[]
  readonly comments: readonly string[]
  readonly media: readonly string[]
}

export interface DocxXmlDocument {
  readonly root: unknown
}

export interface DocxIndexes {
  readonly styles: DocxStyleIndex
  readonly numbering: DocxNumberingIndex
  readonly relationships: DocxRelationshipIndex
  readonly media: DocxMediaIndex
  readonly comments: DocxCommentsIndex
  readonly headerFooter: DocxHeaderFooterIndex
  readonly diagnostics: DocxDiagnostics
}

export interface DocxStyleIndex {
  readonly paragraphStyles: readonly DocxStyleRecord[]
  readonly characterStyles: readonly DocxStyleRecord[]
  readonly linkedStyles: readonly DocxLinkedStyleRecord[]
  readonly tableStyleWarnings: readonly DocxWarning[]
  readonly defaultParagraphStyleId: string | undefined
  readonly defaultRunStyleId: string | undefined
}

export interface DocxStyleRecord {
  readonly styleId: string
  readonly kind: 'paragraph' | 'character'
  readonly name?: string
  readonly basedOn?: string
}

export interface DocxLinkedStyleRecord {
  readonly styleId: string
  readonly linkedStyleId: string
}

export interface DocxNumberingIndex {
  readonly abstractNumberings: readonly DocxAbstractNumbering[]
  readonly numberingInstances: readonly DocxNumberingInstance[]
}

export interface DocxAbstractNumbering {
  readonly abstractNumberingId: string
  readonly levels: readonly DocxNumberingLevel[]
}

export interface DocxNumberingLevel {
  readonly level: number
  readonly format: string
  readonly text: string
  readonly start: number
}

export interface DocxNumberingInstance {
  readonly numberingId: string
  readonly abstractNumberingId: string
}

export interface DocxRelationshipIndex {
  readonly internal: readonly DocxRelationshipRecord[]
  readonly external: readonly DocxRelationshipRecord[]
  readonly images: readonly DocxImageRelationshipRecord[]
  readonly hyperlinks: readonly DocxRelationshipRecord[]
  readonly headerFooters: readonly DocxRelationshipRecord[]
}

export interface DocxRelationshipRecord {
  readonly id: string
  readonly kind: string
  readonly type: string
  readonly target: string
  readonly targetMode?: string
  readonly sourcePart: string
}

export interface DocxImageRelationshipRecord extends DocxRelationshipRecord {
  readonly targetPart: string
  readonly mimeType: string
  readonly extension: string
}

export interface DocxMediaIndex {
  readonly items: readonly DocxMediaItem[]
}

export interface DocxMediaItem {
  readonly targetPart: string
  readonly mimeType: string
  readonly extension: string
  readonly bytes: Uint8Array
}

export interface DocxCommentsIndex {
  readonly comments: readonly DocxImportComment[]
  readonly warnings: readonly DocxWarning[]
}

export interface DocxHeaderFooterIndex {
  readonly headers: readonly string[]
  readonly footers: readonly string[]
}

export type DocxTransferable = ArrayBuffer | MessagePort

export interface ImportDocxRequest {
  readonly type: 'import'
  readonly requestId: string
  readonly input: DocxBinaryInput
  readonly options?: ImportDocxOptions
  readonly transferables?: readonly DocxTransferable[]
}

export interface ExportDocxRequest {
  readonly type: 'export'
  readonly requestId: string
  readonly document: DocumentProjection
  readonly options?: ExportDocxOptions
  readonly transferables?: readonly DocxTransferable[]
}

export interface InspectDocxPackageRequest {
  readonly type: 'inspect'
  readonly requestId: string
  readonly input: DocxBinaryInput
  readonly options?: ImportDocxOptions
  readonly transferables?: readonly DocxTransferable[]
}

export interface CancelDocxRequest {
  readonly type: 'cancel'
  readonly requestId: string
}

export interface DocxProgressEvent {
  readonly type: 'progress'
  readonly requestId: string
  readonly stage: DocxProgressStage
  readonly completed?: number
  readonly total?: number
  readonly message?: string
}

export interface DocxWarningEvent {
  readonly type: 'warning'
  readonly requestId: string
  readonly warning: DocxWarning
}

export interface DocxErrorEvent {
  readonly type: 'error'
  readonly requestId: string
  readonly error: DocxError
}

export interface ImportDocxResultEvent {
  readonly type: 'import-result'
  readonly requestId: string
  readonly result: ImportDocxResult
}

export interface ExportDocxResultEvent {
  readonly type: 'export-result'
  readonly requestId: string
  readonly result: ExportDocxResult
}

export interface InspectDocxPackageResultEvent {
  readonly type: 'inspect-result'
  readonly requestId: string
  readonly result: InspectDocxPackageResult
}

export type DocxWorkerRequest =
  | ImportDocxRequest
  | ExportDocxRequest
  | InspectDocxPackageRequest
  | CancelDocxRequest

export type DocxWorkerEvent =
  | DocxProgressEvent
  | DocxWarningEvent
  | DocxErrorEvent
  | ImportDocxResultEvent
  | ExportDocxResultEvent
  | InspectDocxPackageResultEvent
