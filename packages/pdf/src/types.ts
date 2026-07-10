/**
 * 职责：集中定义 Gate 5 PDF 包公开类型，避免渲染实现入口继续膨胀。
 * 边界：只声明 PDF 导出、worker、字体、图片和诊断契约，不承载运行时代码。
 * 协作模块：packages/pdf/src/index.ts、worker 入口和第三方调用方复用这些类型。
 * 性能/安全约束：类型模块无副作用，不引入 pdf-lib 运行时代码。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import type { DocumentLayout } from '@4xian/jword-core'
import type {
  JWordLicenseDiagnosticCode,
  JWordLicenseEntitlement,
  JWordLicenseFeatureKey
} from '@4xian/jword-license'

import type {
  PdfDiagnosticSeverity,
  PdfErrorCode,
  PdfWarningCode
} from './diagnostics.js'

export type PdfProgressStage =
  | 'queued'
  | 'font-loading'
  | 'reading'
  | 'mapping'
  | 'writing'
  | 'validating'
  | 'done'
  | 'cancelled'

export type PdfWarningSeverity = PdfDiagnosticSeverity

export type PdfFontSource =
  | { readonly kind: 'url', readonly url: string }
  | { readonly kind: 'file', readonly file: File }
  | { readonly kind: 'arrayBuffer', readonly data: ArrayBuffer }

export interface PdfFontConfig {
  readonly family: string
  readonly source: PdfFontSource
  readonly weight?: number
  readonly style?: 'normal' | 'italic'
  readonly fallback?: boolean
  readonly subset?: boolean
}

export interface PdfProgressEvent {
  readonly stage: PdfProgressStage
  readonly loaded?: number
  readonly total?: number
  readonly requestId?: string
}

/** PDF 导出过程中可恢复的公开 warning 载荷。 */
export interface PdfWarning {
  readonly code: PdfWarningCode
  readonly severity: PdfWarningSeverity
  readonly path?: string
  readonly message: string
  readonly fontFamily?: string
  readonly fallback?: string
  readonly recoverable: boolean
}

export interface PdfError {
  readonly code: PdfErrorCode | JWordLicenseDiagnosticCode
  readonly message: string
  readonly requestId?: string
  readonly cancelled?: boolean
  readonly fontFamily?: string
  readonly missingTextSample?: string
  readonly widthTwips?: number
  readonly heightTwips?: number
  readonly recoverable?: boolean
  readonly feature?: JWordLicenseFeatureKey
  readonly customerId?: string
}

export interface ExportPdfOptions {
  readonly requestId?: string
  readonly signal?: AbortSignal
  readonly license?: JWordLicenseEntitlement | null
  readonly fonts?: readonly PdfFontConfig[]
  readonly images?: readonly PdfExportImageInput[]
  readonly onProgress?: (event: PdfProgressEvent) => void
  readonly onWarning?: (warning: PdfWarning) => void
  readonly onError?: (error: PdfError) => void
}

/** PDF 导出结果，包含二进制、warning、progress 和页面几何摘要。 */
export interface ExportPdfResult {
  readonly bytes: ArrayBuffer
  readonly warnings: readonly PdfWarning[]
  readonly progress: readonly PdfProgressEvent[]
  readonly pageGeometry: readonly PdfPageGeometry[]
}

export interface PdfPageGeometry {
  readonly pageIndex: number
  readonly pageSizePoints: PdfSizePoints
  readonly marginPoints: PdfMarginPoints
  readonly contentRectPoints: PdfRectPoints
}

export interface PdfSizePoints {
  readonly width: number
  readonly height: number
}

export interface PdfMarginPoints {
  readonly top: number
  readonly right: number
  readonly bottom: number
  readonly left: number
}

export interface PdfRectPoints {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export type PdfWorkerRequest = ExportPdfWorkerRequest | CancelPdfWorkerRequest

export interface ExportPdfWorkerRequest {
  readonly kind: 'export-layout'
  readonly requestId?: string
  readonly layout: DocumentLayout
  readonly options: ExportPdfOptions
}

export type PdfWorkerResponse =
  | { readonly kind: 'result', readonly result: ExportPdfResult }
  | { readonly kind: 'progress', readonly progress: PdfProgressEvent }
  | { readonly kind: 'warning', readonly warning: PdfWarning }
  | { readonly kind: 'error', readonly error: PdfError }

export type PdfTransferable = ArrayBuffer | MessagePort

export interface CancelPdfWorkerRequest {
  readonly kind: 'cancel'
  readonly requestId: string
}

export type PdfExportImageInput =
  | PdfDataUrlImageInput
  | PdfArrayBufferImageInput
  | PdfBlobImageInput

export interface PdfDataUrlImageInput {
  readonly kind: 'dataUrl'
  readonly id: string
  readonly dataUrl: string
  readonly alt?: string
}

export interface PdfArrayBufferImageInput {
  readonly kind: 'arrayBuffer'
  readonly id: string
  readonly data: ArrayBuffer | ArrayBufferView
  readonly mimeType: string
  readonly alt?: string
}

export interface PdfBlobImageInput {
  readonly kind: 'blob'
  readonly id: string
  readonly blob: Blob
  readonly alt?: string
}

export interface PdfImageAsset {
  readonly id: string
  readonly mimeType: string
  readonly bytes: Uint8Array
  readonly alt?: string
}
