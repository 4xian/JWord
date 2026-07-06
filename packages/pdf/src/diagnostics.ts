/**
 * 职责：集中维护 Gate 5 PDF warning/error code 的公开 schema。
 * 边界：只描述诊断 code 的稳定语义，不执行 PDF 绘制、字体加载、图片读取或 worker 逻辑。
 * 协作模块：index.ts、worker.ts、视觉报告和 fixture registry 复用这些 code。
 * 性能/安全约束：纯常量与类型定义，无副作用，避免把 PDF 运行时依赖拉入首屏。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#step-54建立统一-warningerror-schema。
 */

export type PdfDiagnosticSeverity = 'info' | 'warning' | 'error'

export interface PdfDiagnosticCodeMetadata {
  readonly severity: PdfDiagnosticSeverity
  readonly description: string
  readonly recoverable: boolean
  readonly fallback?: string
}

export const PDF_WARNING_CODE_METADATA = {
  PDF_FONT_MISSING: {
    severity: 'warning',
    description: '当前字体配置不能覆盖待导出的 PDF 文本。',
    recoverable: true,
    fallback: 'provide-compatible-font'
  }
} as const satisfies Record<string, PdfDiagnosticCodeMetadata>

export const PDF_ERROR_CODE_METADATA = {
  PDF_EXPORT_CANCELLED: {
    severity: 'error',
    description: '用户取消当前 PDF 导出任务。',
    recoverable: true
  },
  PDF_FONT_MISSING: {
    severity: 'error',
    description: '缺少可覆盖待导出文本的 PDF 字体。',
    recoverable: true
  },
  PDF_IMAGE_INVALID: {
    severity: 'error',
    description: 'PDF 图片输入不是可读取的 data URL、ArrayBuffer 或 Blob。',
    recoverable: true
  },
  PDF_IMAGE_UNSUPPORTED: {
    severity: 'error',
    description: 'PDF 图片 MIME 类型暂不支持。',
    recoverable: true
  },
  PDF_PAGE_SIZE_EXCEEDED: {
    severity: 'error',
    description: 'PDF 页面宽高超过 14400 points 的规范上限。',
    recoverable: true
  },
  PDF_WORKER_UNAVAILABLE: {
    severity: 'error',
    description: 'PDF worker 捕获未知异常或无法完成请求。',
    recoverable: false
  }
} as const satisfies Record<string, PdfDiagnosticCodeMetadata>

export type PdfWarningCode = keyof typeof PDF_WARNING_CODE_METADATA
export type PdfErrorCode = keyof typeof PDF_ERROR_CODE_METADATA
