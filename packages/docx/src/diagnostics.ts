/**
 * 职责：集中维护 Gate 5 DOCX warning/error code 的公开 schema。
 * 边界：只描述诊断 code 的稳定语义，不执行 OPC、XML、mapping 或 worker 逻辑。
 * 协作模块：index.ts、export.ts、worker.ts 和 fixture/兼容矩阵复用这些 code。
 * 性能/安全约束：纯常量与类型定义，无副作用，避免把运行时依赖拉入首屏。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

export type DocxDiagnosticSeverity = 'info' | 'warning' | 'error'

export interface DocxDiagnosticCodeMetadata {
  readonly severity: DocxDiagnosticSeverity
  readonly description: string
  readonly recoverable: boolean
  readonly fallback?: string
}

export const DOCX_WARNING_CODE_METADATA = {
  DOCX_RELATIONSHIP_UNSUPPORTED: {
    severity: 'warning',
    description: '发现暂未映射的 OPC relationship。',
    recoverable: true,
    fallback: 'preserve-opaque-relationship'
  },
  DOCX_PART_UNSUPPORTED: {
    severity: 'warning',
    description: '发现暂未映射的 OPC part。',
    recoverable: true,
    fallback: 'preserve-opaque-part'
  },
  DOCX_ELEMENT_UNSUPPORTED: {
    severity: 'warning',
    description: '发现暂未映射的 OOXML element。',
    recoverable: true,
    fallback: 'preserve-opaque-element'
  },
  DOCX_SECTION_ORIENTATION_UNSUPPORTED: {
    severity: 'warning',
    description: '发现暂未完整支持的 section 页面方向。',
    recoverable: true,
    fallback: 'normalize-landscape-page-size'
  },
  DOCX_SECTION_BREAK_UNSUPPORTED: {
    severity: 'warning',
    description: '发现暂未完整支持的 section break 类型。',
    recoverable: true,
    fallback: 'treat-as-next-page'
  },
  DOCX_SECTION_COLUMNS_UNSUPPORTED: {
    severity: 'warning',
    description: '发现暂未完整支持的 section columns。',
    recoverable: true,
    fallback: 'ignore-columns'
  },
  DOCX_REVISION_METADATA_UNSUPPORTED: {
    severity: 'warning',
    description: '发现暂未完整支持的修订 metadata。',
    recoverable: true,
    fallback: 'preserve-opaque-revision'
  },
  DOCX_RUN_PROPERTY_UNSUPPORTED: {
    severity: 'warning',
    description: '发现暂未映射的 run 属性。',
    recoverable: true,
    fallback: 'preserve-run-text'
  },
  DOCX_COMMENT_ID_MISSING: {
    severity: 'warning',
    description: '发现缺少 w:id 的 DOCX 批注。',
    recoverable: true,
    fallback: 'skip-comment'
  },
  DOCX_PARAGRAPH_PROPERTY_UNSUPPORTED: {
    severity: 'warning',
    description: '发现暂未映射的段落属性。',
    recoverable: true,
    fallback: 'preserve-paragraph-content'
  },
  DOCX_NUMBERING_FORMAT_UNSUPPORTED: {
    severity: 'warning',
    description: '发现暂未完整支持的编号格式。',
    recoverable: true,
    fallback: 'preserve-numbering-metadata'
  },
  DOCX_HYPERLINK_RELATIONSHIP_MISSING: {
    severity: 'warning',
    description: '超链接引用的 relationship 不存在。',
    recoverable: true,
    fallback: 'preserve-hyperlink-text'
  },
  DOCX_HYPERLINK_UNSUPPORTED: {
    severity: 'warning',
    description: '发现暂未支持的超链接类型。',
    recoverable: true,
    fallback: 'preserve-hyperlink-text'
  },
  DOCX_TABLE_NESTED_UNSUPPORTED: {
    severity: 'warning',
    description: '发现暂未支持的嵌套表格。',
    recoverable: true,
    fallback: 'flatten-nested-table-text'
  },
  DOCX_DRAWING_FLOATING_UNSUPPORTED: {
    severity: 'warning',
    description: '发现暂未支持的浮动 drawing。',
    recoverable: true,
    fallback: 'preserve-empty-inline'
  },
  DOCX_IMAGE_RELATIONSHIP_MISSING: {
    severity: 'warning',
    description: '图片引用的 relationship 不存在。',
    recoverable: true,
    fallback: 'omit-image'
  },
  DOCX_IMAGE_EXTERNAL_UNSUPPORTED: {
    severity: 'warning',
    description: '发现暂未支持的外链图片。',
    recoverable: true,
    fallback: 'preserve-alt-text'
  },
  DOCX_IMAGE_RELATIONSHIP_UNSUPPORTED: {
    severity: 'warning',
    description: '发现暂未支持的图片 relationship 类型。',
    recoverable: true,
    fallback: 'omit-image'
  },
  DOCX_STYLE_UNKNOWN: {
    severity: 'warning',
    description: '引用了样式表中不存在的样式。',
    recoverable: true,
    fallback: 'preserve-style-id'
  },
  DOCX_TABLE_STYLE_UNSUPPORTED: {
    severity: 'warning',
    description: '发现暂未完整支持的表格样式。',
    recoverable: true,
    fallback: 'preserve-table-text'
  },
  DOCX_TABLE_COMPLEX_MERGE_UNSUPPORTED: {
    severity: 'warning',
    description: '发现暂未支持的复杂表格合并。',
    recoverable: true,
    fallback: 'preserve-cell-text'
  },
  DOCX_RELATIONSHIP_TARGET_MISSING: {
    severity: 'warning',
    description: 'relationship 指向的 target part 不存在。',
    recoverable: true,
    fallback: 'preserve-relationship-metadata'
  },
  DOCX_RELATIONSHIP_TARGET_TRAVERSAL_UNSUPPORTED: {
    severity: 'warning',
    description: 'relationship target 使用多余 .. 越过 OPC package 根。',
    recoverable: true,
    fallback: 'preserve-relationship-metadata'
  },
  DOCX_IMAGE_EXPORT_MIME_UNSUPPORTED: {
    severity: 'warning',
    description: 'DOCX 导出暂不支持该图片 MIME。',
    recoverable: true,
    fallback: 'omit-image'
  },
  DOCX_HEADER_FOOTER_EXPORT_UNSUPPORTED: {
    severity: 'warning',
    description: 'DOCX 导出暂不写入页眉页脚内容。',
    recoverable: true,
    fallback: 'omit-header-footer'
  },
  DOCX_PAGE_NUMBERING_EXPORT_UNSUPPORTED: {
    severity: 'warning',
    description: 'DOCX 导出暂不写入 section 页码设置。',
    recoverable: true,
    fallback: 'omit-page-numbering'
  },
  DOCX_COMMENTS_EXPORT_UNSUPPORTED: {
    severity: 'warning',
    description: 'DOCX 导出暂不写入批注内容。',
    recoverable: true,
    fallback: 'omit-comments'
  },
  DOCX_REVISIONS_EXPORT_UNSUPPORTED: {
    severity: 'warning',
    description: 'DOCX 导出暂不写入修订 metadata。',
    recoverable: true,
    fallback: 'omit-revisions'
  },
  DOCX_OPAQUE_PART_PRESERVE_SKIPPED: {
    severity: 'warning',
    description: '导出时跳过编辑后不安全的 opaque part。',
    recoverable: true,
    fallback: 'omit-unsafe-opaque-part'
  },
  DOCX_OPAQUE_RELATIONSHIP_PRESERVE_SKIPPED: {
    severity: 'warning',
    description: '导出时跳过编辑后不安全的 opaque relationship。',
    recoverable: true,
    fallback: 'omit-unsafe-opaque-relationship'
  }
} as const satisfies Record<string, DocxDiagnosticCodeMetadata>

export const DOCX_ERROR_CODE_METADATA = {
  DOCX_PACKAGE_INVALID: {
    severity: 'error',
    description: '输入不是可读取的 DOCX zip package。',
    recoverable: false
  },
  DOCX_PACKAGE_RESOURCE_LIMIT_EXCEEDED: {
    severity: 'error',
    description: 'DOCX package 超出资源安全上限。',
    recoverable: false
  },
  DOCX_CONTENT_TYPES_MISSING: {
    severity: 'error',
    description: 'DOCX package 缺少 [Content_Types].xml。',
    recoverable: false
  },
  DOCX_ROOT_RELS_MISSING: {
    severity: 'error',
    description: 'DOCX package 缺少 root relationships part。',
    recoverable: false
  },
  DOCX_MAIN_DOCUMENT_MISSING: {
    severity: 'error',
    description: 'DOCX package 缺少主文档 part。',
    recoverable: false
  },
  DOCX_USER_CANCELLED: {
    severity: 'error',
    description: '用户取消当前 DOCX 任务。',
    recoverable: true
  },
  DOCX_WORKER_CANCELLED: {
    severity: 'error',
    description: 'worker 收到取消当前 DOCX 任务的请求。',
    recoverable: true
  },
  DOCX_WORKER_UNAVAILABLE: {
    severity: 'error',
    description: '当前环境缺少 DOCX worker 运行所需基础能力。',
    recoverable: false
  },
  DOCX_WORKER_ERROR: {
    severity: 'error',
    description: 'DOCX worker 捕获未知异常。',
    recoverable: false
  }
} as const satisfies Record<string, DocxDiagnosticCodeMetadata>

export type DocxWarningCode = keyof typeof DOCX_WARNING_CODE_METADATA
export type DocxErrorCode = keyof typeof DOCX_ERROR_CODE_METADATA

/** 判断字符串是否是公开 DOCX error code。 */
export function isDocxErrorCode(code: string): code is DocxErrorCode {
  return code in DOCX_ERROR_CODE_METADATA
}
