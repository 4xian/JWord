/**
 * 职责：严格校验 native document 的 comment thread、message 和共用 range snapshot。
 * 边界：不解析正文节点、不读取 ZIP、不创建公开 diagnostic DTO。
 * 协作模块：document-schema.ts 提供节点预算、ID 登记和安全失败回调。
 * 性能/安全约束：只使用已知字段名与数组索引生成路径，不复制未知 key/value。
 * 实现说明：comment/message 计入 canonical document 结构节点预算。
 */

import { JWORD_NATIVE_PACKAGE_LIMITS } from './package-read-budget.js'
import { isRecord, type JsonRecord } from './utils.js'

export interface DocumentCommentValidation {
  /** 读取并累计一个 canonical 结构节点。 */
  readonly readNode: (input: unknown, path: string) => JsonRecord
  /** 在指定类型域登记唯一实体 ID。 */
  readonly registerIdentifier: (input: unknown, domain: string, path: string) => void
  /** 登记一个已完成字段校验的文本 anchor 引用。 */
  readonly registerTextAnchor: (
    documentId: string,
    sectionId: string,
    blockId: string,
    runId: string,
    path: string
  ) => void
  /** 以规范化 JSON Pointer 抛出稳定 schema 错误。 */
  readonly fail: (path: string) => never
}

const textEncoder = new TextEncoder()

/** 校验 comment thread 列表与全部嵌套结构。 */
export function validateJWordDocumentComments(
  input: unknown,
  path: string,
  validation: DocumentCommentValidation
): void {
  if (input === undefined) {
    return
  }
  if (!Array.isArray(input)) {
    validation.fail(path)
  }

  input.forEach((comment, index) => {
    validateComment(comment, `${path}/${index}`, validation)
  })
}

/** 校验单个 comment thread。 */
function validateComment(input: unknown, path: string, validation: DocumentCommentValidation): void {
  const comment = validation.readNode(input, path)

  assertKnownKeys(comment, [
    'kind',
    'id',
    'authorId',
    'createdAt',
    'anchorRangeId',
    'resolved',
    'rangeSnapshot',
    'messages'
  ], path, validation)
  assertLiteral(comment.kind, 'commentThread', `${path}/kind`, validation)
  validation.registerIdentifier(comment.id, 'comment', `${path}/id`)
  assertNonEmptyString(comment.authorId, `${path}/authorId`, validation)
  assertString(comment.createdAt, `${path}/createdAt`, validation)
  assertIdentifierValue(comment.anchorRangeId, `${path}/anchorRangeId`, validation)
  assertBoolean(comment.resolved, `${path}/resolved`, validation)
  const rangeId = validateJWordTextRange(
    comment.rangeSnapshot,
    'comment-range',
    `${path}/rangeSnapshot`,
    validation
  )

  assertLiteral(comment.anchorRangeId, rangeId, `${path}/anchorRangeId`, validation)
  if (!Array.isArray(comment.messages)) {
    validation.fail(`${path}/messages`)
  }
  comment.messages.forEach((message, index) => {
    validateCommentMessage(message, rangeId, `${path}/messages/${index}`, validation)
  })
}

/** 校验 comment message 结构与所属 range。 */
function validateCommentMessage(
  input: unknown,
  rangeId: string,
  path: string,
  validation: DocumentCommentValidation
): void {
  const message = validation.readNode(input, path)

  assertKnownKeys(message, [
    'id',
    'authorId',
    'createdAt',
    'anchorRangeId',
    'text',
    'editedAt'
  ], path, validation)
  validation.registerIdentifier(message.id, 'comment-message', `${path}/id`)
  assertNonEmptyString(message.authorId, `${path}/authorId`, validation)
  assertString(message.createdAt, `${path}/createdAt`, validation)
  assertLiteral(message.anchorRangeId, rangeId, `${path}/anchorRangeId`, validation)
  assertString(message.text, `${path}/text`, validation)
  if (message.editedAt !== undefined) {
    assertString(message.editedAt, `${path}/editedAt`, validation)
  }
}

/** 校验 TextRangeRecord 并返回规范 range ID。 */
export function validateJWordTextRange(
  input: unknown,
  identifierDomain: string,
  path: string,
  validation: DocumentCommentValidation
): string {
  const range = readRecord(input, path, validation)

  assertKnownKeys(range, ['id', 'anchor', 'focus'], path, validation)
  validation.registerIdentifier(range.id, identifierDomain, `${path}/id`)
  validateTextAnchor(range.anchor, `${path}/anchor`, validation)
  validateTextAnchor(range.focus, `${path}/focus`, validation)

  return range.id as string
}

/** 校验 TextAnchorRecord 固定结构。 */
function validateTextAnchor(input: unknown, path: string, validation: DocumentCommentValidation): void {
  const anchor = readRecord(input, path, validation)

  assertKnownKeys(anchor, [
    'documentId',
    'sectionId',
    'blockId',
    'runId',
    'graphemeIndex',
    'assoc',
    'relativePosition'
  ], path, validation)
  assertIdentifierValue(anchor.documentId, `${path}/documentId`, validation)
  assertIdentifierValue(anchor.sectionId, `${path}/sectionId`, validation)
  assertIdentifierValue(anchor.blockId, `${path}/blockId`, validation)
  assertIdentifierValue(anchor.runId, `${path}/runId`, validation)
  validation.registerTextAnchor(
    anchor.documentId as string,
    anchor.sectionId as string,
    anchor.blockId as string,
    anchor.runId as string,
    path
  )
  assertNonNegativeInteger(anchor.graphemeIndex, `${path}/graphemeIndex`, validation)
  if (anchor.assoc !== undefined) {
    assertSafeInteger(anchor.assoc, `${path}/assoc`, validation)
  }
  validateRelativePosition(anchor.relativePosition, `${path}/relativePosition`, validation)
}

/** 校验 RelativePositionSnapshot 可选字段。 */
function validateRelativePosition(
  input: unknown,
  path: string,
  validation: DocumentCommentValidation
): void {
  const relative = readRecord(input, path, validation)

  assertKnownKeys(relative, ['type', 'tname', 'item', 'assoc'], path, validation)
  validateRelativePositionId(relative.type, `${path}/type`, validation)
  if (relative.tname !== undefined) {
    assertString(relative.tname, `${path}/tname`, validation)
  }
  validateRelativePositionId(relative.item, `${path}/item`, validation)
  if (relative.assoc !== undefined) {
    assertSafeInteger(relative.assoc, `${path}/assoc`, validation)
  }
}

/** 校验 RelativePositionSnapshot 内 client/clock 对。 */
function validateRelativePositionId(
  input: unknown,
  path: string,
  validation: DocumentCommentValidation
): void {
  if (input === undefined) {
    return
  }

  const id = readRecord(input, path, validation)

  assertKnownKeys(id, ['client', 'clock'], path, validation)
  assertNonNegativeInteger(id.client, `${path}/client`, validation)
  assertNonNegativeInteger(id.clock, `${path}/clock`, validation)
}

/** 读取不计入 canonical 节点预算的封闭对象。 */
function readRecord(input: unknown, path: string, validation: DocumentCommentValidation): JsonRecord {
  if (!isRecord(input)) {
    validation.fail(path)
  }

  return input
}

/** 检查封闭结构只含已知字段。 */
function assertKnownKeys(
  record: JsonRecord,
  keys: readonly string[],
  path: string,
  validation: DocumentCommentValidation
): void {
  const allowed = new Set(keys)

  if (Object.keys(record).some((key) => !allowed.has(key))) {
    validation.fail(path)
  }
}

/** 校验固定字符串。 */
function assertLiteral(
  input: unknown,
  expected: string,
  path: string,
  validation: DocumentCommentValidation
): void {
  if (input !== expected) {
    validation.fail(path)
  }
}

/** 校验普通字符串。 */
function assertString(input: unknown, path: string, validation: DocumentCommentValidation): void {
  if (typeof input !== 'string') {
    validation.fail(path)
  }
}

/** 校验非空字符串。 */
function assertNonEmptyString(
  input: unknown,
  path: string,
  validation: DocumentCommentValidation
): void {
  if (typeof input !== 'string' || input.length === 0) {
    validation.fail(path)
  }
}

/** 校验满足标识符字节预算的引用值。 */
function assertIdentifierValue(
  input: unknown,
  path: string,
  validation: DocumentCommentValidation
): void {
  if (
    typeof input !== 'string' ||
    input.length === 0 ||
    textEncoder.encode(input).byteLength > JWORD_NATIVE_PACKAGE_LIMITS.identifierBytes
  ) {
    validation.fail(path)
  }
}

/** 校验 boolean。 */
function assertBoolean(input: unknown, path: string, validation: DocumentCommentValidation): void {
  if (typeof input !== 'boolean') {
    validation.fail(path)
  }
}

/** 校验非负安全整数。 */
function assertNonNegativeInteger(
  input: unknown,
  path: string,
  validation: DocumentCommentValidation
): void {
  if (!Number.isSafeInteger(input) || (input as number) < 0) {
    validation.fail(path)
  }
}

/** 校验安全整数。 */
function assertSafeInteger(input: unknown, path: string, validation: DocumentCommentValidation): void {
  if (!Number.isSafeInteger(input)) {
    validation.fail(path)
  }
}
