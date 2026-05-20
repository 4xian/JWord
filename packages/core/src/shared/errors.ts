/**
 * 职责：定义 Gate 1 core 可诊断错误类型和稳定错误码。
 * 边界：只提供 error class、code 和 helper，不实现 diagnostics export、UI 文案或插件错误隔离。
 * 协作模块：事务管线、操作适配器、编辑器门面后续统一抛出该错误类型。
 * 性能/安全约束：错误 details 只保存 JSON 兼容诊断数据，不持有 Yjs 或 DOM 可写对象。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/03-architecture.md#34-operation。
 */

export type JWordErrorCode =
  | 'TRANSACTION_COMMAND_EMPTY'
  | 'TRANSACTION_ORIGIN_EMPTY'
  | 'OPERATION_KIND_UNKNOWN'
  | 'OPERATION_FIXTURE_SCHEMA_UNSUPPORTED'
  | 'OPERATION_ANCHOR_UNRESOLVED'
  | 'OPERATION_SECTION_NOT_FOUND'
  | 'OPERATION_BLOCK_NOT_FOUND'
  | 'OPERATION_RUN_NOT_FOUND'
  | 'OPERATION_RUN_NOT_IN_BLOCK'
  | 'OPERATION_RUN_ID_DUPLICATE'
  | 'OPERATION_RUN_FORMAT_RANGE_INVALID'
  | 'OPERATION_DELETE_RANGE_CROSS_RUN'
  | 'OPERATION_TEXT_INDEX_OUT_OF_BOUNDS'
  | 'OPERATION_MERGE_BLOCK_NOT_ADJACENT'
  | 'OPERATION_INSERT_BLOCK_REFERENCE_NOT_FOUND'
  | 'OPERATION_BLOCK_KIND_MISMATCH'
  | 'OPERATION_PROPERTY_CONTAINER_MISSING'
  | 'OPERATION_PROPERTY_VALUE_INVALID'
  | 'OPERATION_STRING_FIELD_MISSING'
  | 'OPERATION_RESOURCE_NOT_FOUND'
  | 'OPERATION_RESOURCE_URL_DISALLOWED'
  | 'OPERATION_IMAGE_TARGET_INVALID'
  | 'OPERATION_IMAGE_DIMENSIONS_INVALID'
  | 'OPERATION_TABLE_CELL_NOT_FOUND'
  | 'PROJECTION_INVALID_DOCUMENT'
  | 'DOCUMENT_STORE_TEXT_CONTAINER_MISSING'
  | 'DOCUMENT_STORE_ARRAY_CONTAINER_MISSING'
  | 'EDITOR_DESTROYED'
  | 'EDITOR_ALREADY_MOUNTED'
  | 'EDITOR_ANCHOR_TARGET_NOT_FOUND'
  | 'EDITOR_POINTER_PAGE_MISSING'

export type JWordErrorDetails =
  | string
  | number
  | boolean
  | null
  | readonly JWordErrorDetails[]
  | { readonly [key: string]: JWordErrorDetails }

/**
 * JWord core 的可诊断错误。
 */
export class JWordError extends Error {
  readonly code: JWordErrorCode
  readonly details?: JWordErrorDetails

  constructor(code: JWordErrorCode, message: string, details?: JWordErrorDetails) {
    super(message)
    this.name = 'JWordError'
    this.code = code

    if (details !== undefined) {
      this.details = details
    }
  }
}

/**
 * 创建可诊断错误。
 *
 * @param code 稳定错误码。
 * @param message 中文错误说明。
 * @param details JSON 兼容诊断数据。
 * @returns JWordError 实例。
 */
export function createJWordError(
  code: JWordErrorCode,
  message: string,
  details?: JWordErrorDetails
): JWordError {
  return new JWordError(code, message, details)
}
