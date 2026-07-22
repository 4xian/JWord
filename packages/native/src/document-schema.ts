/**
 * 职责：按 native schema 版本严格解析不可信 document JSON，并生成安全结构路径。
 * 边界：不读取 ZIP、不执行 schema migration、不修改 core 公开 Document 类型。
 * 协作模块：package-readers.ts、schema-migrations.ts 和 package-codec.ts。
 * 性能/安全约束：结构节点、嵌套深度与标识符使用固定内部预算，不复制未知 key/value。
 * 实现说明：旧版本先返回内部版本化值，只有当前 schema 复验后才转换为 Document。
 */

import type { Document } from '@4xian/jword-core'

import { createPackageError } from './diagnostics.js'
import {
  validateJWordTextRange,
  validateJWordDocumentComments,
  type DocumentCommentValidation
} from './document-schema-comments.js'
import { JWORD_NATIVE_PACKAGE_LIMITS, assertNativePackageLimit } from './package-read-budget.js'
import { JWORD_NATIVE_SCHEMA_VERSION, JWordNativePackageError } from './types.js'
import { isRecord, type JsonRecord } from './utils.js'

export interface VersionedJWordDocument {
  readonly schemaVersion: number
  readonly value: unknown
}

interface DocumentSchemaContext {
  readonly requestId?: string
  readonly identifiers: Map<string, Set<string>>
  readonly sectionDocumentIds: Map<string, string>
  readonly blockSectionIds: Map<string, string>
  readonly runBlockIds: Map<string, string>
  readonly textAnchorReferences: DocumentSchemaTextAnchorReference[]
  readonly commentReferences: DocumentSchemaReference[]
  readonly revisionReferences: DocumentSchemaReference[]
  readonly runReferences: DocumentSchemaReference[]
  readonly resourceReferences: DocumentSchemaReference[]
  nodeCount: number
}

interface DocumentSchemaReference {
  readonly id: string
  readonly path: string
}

interface DocumentSchemaTextAnchorReference {
  readonly documentId: string
  readonly sectionId: string
  readonly blockId: string
  readonly runId: string
  readonly path: string
}

const textEncoder = new TextEncoder()

/** 保存 document schema 失败的规范化安全路径，供 diagnostic 层原样传递。 */
export class JWordDocumentSchemaError extends JWordNativePackageError {
  /** 创建不包含攻击者字段名或字段值的 document schema 错误。 */
  constructor(path: string, requestId?: string) {
    super({
      code: 'JWORD_NATIVE_DOCUMENT_INVALID',
      message: 'JWORD_NATIVE_DOCUMENT_INVALID',
      recoverable: false,
      entry: 'document.json',
      path,
      ...(requestId === undefined ? {} : { requestId })
    })
  }
}

/** 按 manifest 声明的 schema 版本校验原始 document JSON。 */
export function parseJWordDocumentVersion(
  input: unknown,
  schemaVersion: number,
  requestId?: string
): VersionedJWordDocument {
  if (schemaVersion > JWORD_NATIVE_SCHEMA_VERSION) {
    throw createPackageError(
      'JWORD_NATIVE_SCHEMA_FUTURE',
      'JWORD_NATIVE_SCHEMA_FUTURE',
      requestId,
      'manifest.json'
    )
  }
  if (schemaVersion !== 0 && schemaVersion !== 1 && schemaVersion !== JWORD_NATIVE_SCHEMA_VERSION) {
    throw createPackageError(
      'JWORD_NATIVE_SCHEMA_UNSUPPORTED',
      'JWORD_NATIVE_SCHEMA_UNSUPPORTED',
      requestId,
      'manifest.json'
    )
  }

  validateDocument(input, createDocumentSchemaContext(requestId))

  return { schemaVersion, value: input }
}

/** 使用当前 schema 完整复验并返回 canonical Document。 */
export function parseCurrentJWordDocument(input: unknown, requestId?: string): Document {
  validateDocument(input, createDocumentSchemaContext(requestId))

  return input as unknown as Document
}

/** 创建单次 document schema 遍历上下文。 */
function createDocumentSchemaContext(requestId?: string): DocumentSchemaContext {
  return {
    ...(requestId === undefined ? {} : { requestId }),
    identifiers: new Map(),
    sectionDocumentIds: new Map(),
    blockSectionIds: new Map(),
    runBlockIds: new Map(),
    textAnchorReferences: [],
    commentReferences: [],
    revisionReferences: [],
    runReferences: [],
    resourceReferences: [],
    nodeCount: 0
  }
}

/** 校验当前 document 根节点和 section 列表。 */
function validateDocument(input: unknown, context: DocumentSchemaContext): asserts input is JsonRecord {
  const document = readRecord(input, '', context)

  assertKnownKeys(document, [
    'kind',
    'id',
    'metadata',
    'styleIds',
    'resourceIds',
    'resources',
    'sections',
    'comments',
    'revisions'
  ], '', context)
  assertLiteral(document.kind, 'document', '/kind', context)
  assertIdentifier(document.id, 'document', '/id', context)
  const documentId = document.id as string

  validateDocumentMetadata(document.metadata, '/metadata', context)
  assertOptionalIdentifierArray(document.styleIds, '/styleIds', context)
  collectOptionalResourceReferences(document.resourceIds, '/resourceIds', context)
  validateResources(document.resources, '/resources', context)

  if (!Array.isArray(document.sections)) {
    fail('/sections', context)
  }

  document.sections.forEach((section, index) => {
    validateSection(section, `/sections/${index}`, documentId, context)
  })
  validateJWordDocumentComments(
    document.comments,
    '/comments',
    createDocumentCommentValidation(context)
  )
  validateRevisions(document.revisions, '/revisions', context)
  assertTextAnchorReferences(context)
  assertReferences('comment', context.commentReferences, context)
  assertReferences('revision', context.revisionReferences, context)
  assertReferences('run', context.runReferences, context)
  assertResourceReferences(context)
}

/** 为 comment schema 创建绑定当前遍历上下文的受限验证接口。 */
function createDocumentCommentValidation(context: DocumentSchemaContext): DocumentCommentValidation {
  return {
    /** 读取 comment schema 当前节点并复用 document 节点预算。 */
    readNode(input, path) {
      return readRecord(input, path, context)
    },
    /** 在 comment 域中登记并校验实体标识符。 */
    registerIdentifier(input, domain, path) {
      assertIdentifier(input, domain, path, context)
    },
    /** 记录 comment 文本锚点供遍历结束后统一校验引用。 */
    registerTextAnchor(documentId, sectionId, blockId, runId, path) {
      context.textAnchorReferences.push({ documentId, sectionId, blockId, runId, path })
    },
    /** 使用 document schema 的稳定错误路径终止 comment 校验。 */
    fail(path) {
      fail(path, context)
    }
  }
}

/** 校验 revision metadata 列表与全部格式快照。 */
function validateRevisions(input: unknown, path: string, context: DocumentSchemaContext): void {
  if (input === undefined) {
    return
  }
  if (!Array.isArray(input)) {
    fail(path, context)
  }

  input.forEach((revision, index) => {
    validateRevision(revision, `${path}/${index}`, context)
  })
}

/** 校验单个 revision metadata 与 range snapshot。 */
function validateRevision(input: unknown, path: string, context: DocumentSchemaContext): void {
  const revision = readRecord(input, path, context)

  assertKnownKeys(revision, [
    'kind',
    'id',
    'authorId',
    'createdAt',
    'type',
    'rangeId',
    'rangeSnapshot',
    'summary',
    'formatSnapshots'
  ], path, context)
  assertLiteral(revision.kind, 'revision', `${path}/kind`, context)
  assertIdentifier(revision.id, 'revision', `${path}/id`, context)
  assertIdentifierValue(revision.authorId, `${path}/authorId`, context)
  assertString(revision.createdAt, `${path}/createdAt`, context)
  assertEnum(revision.type, ['insert', 'delete', 'format'], `${path}/type`, context)
  const rangeId = validateJWordTextRange(
    revision.rangeSnapshot,
    'revision-range',
    `${path}/rangeSnapshot`,
    createDocumentCommentValidation(context)
  )

  if (revision.rangeId !== undefined) {
    assertLiteral(revision.rangeId, rangeId, `${path}/rangeId`, context)
  }
  assertString(revision.summary, `${path}/summary`, context)
  validateRevisionFormatSnapshots(revision.formatSnapshots, `${path}/formatSnapshots`, context)
}

/** 校验 revision format snapshot 列表。 */
function validateRevisionFormatSnapshots(
  input: unknown,
  path: string,
  context: DocumentSchemaContext
): void {
  if (input === undefined) {
    return
  }
  if (!Array.isArray(input)) {
    fail(path, context)
  }

  input.forEach((snapshot, index) => {
    const snapshotPath = `${path}/${index}`
    const record = readRecord(snapshot, snapshotPath, context)

    assertKnownKeys(record, ['runId', 'previousProperties'], snapshotPath, context)
    assertIdentifierValue(record.runId, `${snapshotPath}/runId`, context)
    context.runReferences.push({
      id: record.runId as string,
      path: `${snapshotPath}/runId`
    })
    assertOptionalOpenRecord(record.previousProperties, `${snapshotPath}/previousProperties`, context)
    if (record.previousProperties === undefined) {
      fail(`${snapshotPath}/previousProperties`, context)
    }
  })
}

/** 校验 document metadata 的字符串值 record。 */
function validateDocumentMetadata(input: unknown, path: string, context: DocumentSchemaContext): void {
  if (input === undefined) {
    return
  }
  if (!isRecord(input) || Object.values(input).some((value) => typeof value !== 'string')) {
    fail(path, context)
  }
}

/** 校验可选的标识符引用数组。 */
function assertOptionalIdentifierArray(input: unknown, path: string, context: DocumentSchemaContext): void {
  if (input === undefined) {
    return
  }
  if (!Array.isArray(input)) {
    fail(path, context)
  }

  const values = new Set<string>()

  input.forEach((value, index) => {
    assertIdentifierValue(value, `${path}/${index}`, context)
    if (values.has(value as string)) {
      fail(`${path}/${index}`, context)
    }
    values.add(value as string)
  })
}

/** 校验可选标识符数组并登记其类型域引用。 */
function collectOptionalResourceReferences(
  input: unknown,
  path: string,
  context: DocumentSchemaContext
): void {
  assertOptionalIdentifierArray(input, path, context)

  if (!Array.isArray(input)) {
    return
  }
  input.forEach((value, index) => {
    context.resourceReferences.push({
      id: value as string,
      path: `${path}/${index}`
    })
  })
}

/** 校验 document resource 列表。 */
function validateResources(input: unknown, path: string, context: DocumentSchemaContext): void {
  if (input === undefined) {
    return
  }
  if (!Array.isArray(input)) {
    fail(path, context)
  }

  input.forEach((resource, index) => {
    validateResource(resource, `${path}/${index}`, context)
  })
}

/** 校验单个 Resource 结构和 source discriminant。 */
function validateResource(input: unknown, path: string, context: DocumentSchemaContext): void {
  const resource = readRecord(input, path, context)

  assertKnownKeys(resource, [
    'kind',
    'id',
    'mime',
    'source',
    'status',
    'error',
    'retryToken',
    'metadata'
  ], path, context)
  assertLiteral(resource.kind, 'resource', `${path}/kind`, context)
  assertIdentifier(resource.id, 'resource', `${path}/id`, context)
  assertTrimmedNonEmptyString(resource.mime, `${path}/mime`, context)
  validateResourceSource(resource.source, `${path}/source`, context)
  assertEnum(resource.status, ['pending', 'success', 'failed'], `${path}/status`, context)
  validateResourceError(resource.error, `${path}/error`, context)
  assertOptionalString(resource.retryToken, `${path}/retryToken`, context)
  assertOptionalOpenRecord(resource.metadata, `${path}/metadata`, context)
}

/** 校验 ResourceSource 的已知 URL 与 package 逻辑引用变体。 */
function validateResourceSource(input: unknown, path: string, context: DocumentSchemaContext): void {
  const source = readPlainRecord(input, path, context)

  assertKnownKeys(source, ['kind', 'url'], path, context)
  assertEnum(source.kind, ['dataUrl', 'blobUrl', 'externalUrl', 'packedResource'], `${path}/kind`, context)
  assertString(source.url, `${path}/url`, context)
}

/** 校验可选 ResourceErrorState。 */
function validateResourceError(input: unknown, path: string, context: DocumentSchemaContext): void {
  if (input === undefined) {
    return
  }

  const error = readPlainRecord(input, path, context)

  assertKnownKeys(error, ['code', 'message'], path, context)
  assertString(error.code, `${path}/code`, context)
  assertString(error.message, `${path}/message`, context)
}

/** 校验 section 固定结构和 blocks 数组。 */
function validateSection(
  input: unknown,
  path: string,
  documentId: string,
  context: DocumentSchemaContext
): void {
  const section = readRecord(input, path, context)

  assertKnownKeys(section, [
    'kind',
    'id',
    'breakType',
    'page',
    'columns',
    'headerIds',
    'footerIds',
    'headerFooterSameAsPrevious',
    'pageNumbering',
    'blocks'
  ], path, context)
  assertLiteral(section.kind, 'section', `${path}/kind`, context)
  assertIdentifier(section.id, 'section', `${path}/id`, context)
  const sectionId = section.id as string

  context.sectionDocumentIds.set(sectionId, documentId)
  if (section.breakType !== undefined) {
    assertEnum(section.breakType, ['continuous', 'next-page'], `${path}/breakType`, context)
  }
  validateSectionPage(section.page, `${path}/page`, context)
  if (section.columns !== undefined) {
    assertPositiveInteger(section.columns, `${path}/columns`, context)
  }
  assertOptionalIdentifierArray(section.headerIds, `${path}/headerIds`, context)
  assertOptionalIdentifierArray(section.footerIds, `${path}/footerIds`, context)
  assertOptionalBoolean(
    section.headerFooterSameAsPrevious,
    `${path}/headerFooterSameAsPrevious`,
    context
  )
  validateSectionPageNumbering(section.pageNumbering, `${path}/pageNumbering`, context)

  if (!Array.isArray(section.blocks)) {
    fail(`${path}/blocks`, context)
  }

  section.blocks.forEach((block, index) => {
    validateBlock(block, `${path}/blocks/${index}`, sectionId, context)
  })
}

/** 校验 section page layout 与 margin 数值。 */
function validateSectionPage(input: unknown, path: string, context: DocumentSchemaContext): void {
  if (input === undefined) {
    return
  }

  const page = readPlainRecord(input, path, context)

  assertKnownKeys(page, ['widthTwips', 'heightTwips', 'marginTwips'], path, context)
  assertOptionalFiniteNumber(page.widthTwips, `${path}/widthTwips`, context)
  assertOptionalFiniteNumber(page.heightTwips, `${path}/heightTwips`, context)
  validatePageMargins(page.marginTwips, `${path}/marginTwips`, context)
}

/** 校验 section page margins。 */
function validatePageMargins(input: unknown, path: string, context: DocumentSchemaContext): void {
  if (input === undefined) {
    return
  }

  const margins = readPlainRecord(input, path, context)

  assertKnownKeys(margins, ['top', 'right', 'bottom', 'left'], path, context)
  assertOptionalFiniteNumber(margins.top, `${path}/top`, context)
  assertOptionalFiniteNumber(margins.right, `${path}/right`, context)
  assertOptionalFiniteNumber(margins.bottom, `${path}/bottom`, context)
  assertOptionalFiniteNumber(margins.left, `${path}/left`, context)
}

/** 校验 section page numbering。 */
function validateSectionPageNumbering(
  input: unknown,
  path: string,
  context: DocumentSchemaContext
): void {
  if (input === undefined) {
    return
  }

  const numbering = readPlainRecord(input, path, context)

  assertKnownKeys(numbering, ['mode', 'start'], path, context)
  assertEnum(numbering.mode, ['continue', 'restart'], `${path}/mode`, context)
  if (numbering.start !== undefined) {
    assertPositiveInteger(numbering.start, `${path}/start`, context)
  }
}

/** 按 discriminant 校验 paragraph 或 table block。 */
function validateBlock(
  input: unknown,
  path: string,
  sectionId: string,
  context: DocumentSchemaContext
): void {
  const block = readRecord(input, path, context)

  if (block.kind === 'paragraph') {
    validateParagraph(block, path, sectionId, context)
    return
  }
  if (block.kind === 'table') {
    validateTable(block, path, sectionId, context)
    return
  }

  fail(`${path}/kind`, context)
}

/** 校验 paragraph 字段并递归验证 run 列表。 */
function validateParagraph(
  paragraph: JsonRecord,
  path: string,
  sectionId: string,
  context: DocumentSchemaContext
): void {
  assertKnownKeys(paragraph, [
    'kind',
    'id',
    'properties',
    'styleId',
    'list',
    'tabs',
    'runs'
  ], path, context)
  assertIdentifier(paragraph.id, 'block', `${path}/id`, context)
  const blockId = paragraph.id as string

  context.blockSectionIds.set(blockId, sectionId)
  assertOptionalOpenRecord(paragraph.properties, `${path}/properties`, context)
  assertOptionalString(paragraph.styleId, `${path}/styleId`, context)
  validateParagraphList(paragraph.list, `${path}/list`, context)
  assertOptionalFiniteNumberArray(paragraph.tabs, `${path}/tabs`, context)

  if (!Array.isArray(paragraph.runs)) {
    fail(`${path}/runs`, context)
  }
  paragraph.runs.forEach((run, index) => {
    validateRun(run, `${path}/runs/${index}`, blockId, context)
  })
}

/** 校验 table 顶层字段和 rows 数组入口。 */
function validateTable(
  table: JsonRecord,
  path: string,
  sectionId: string,
  context: DocumentSchemaContext
): void {
  assertKnownKeys(table, ['kind', 'id', 'properties', 'grid', 'border', 'rows'], path, context)
  assertIdentifier(table.id, 'block', `${path}/id`, context)
  context.blockSectionIds.set(table.id as string, sectionId)
  assertOptionalOpenRecord(table.properties, `${path}/properties`, context)
  assertOptionalFiniteNumberArray(table.grid, `${path}/grid`, context)
  validateTableBorder(table.border, `${path}/border`, context)

  if (!Array.isArray(table.rows)) {
    fail(`${path}/rows`, context)
  }
  table.rows.forEach((row, index) => {
    validateTableRow(row, `${path}/rows/${index}`, sectionId, context)
  })
}

/** 校验 table row 的无 discriminant 固定结构。 */
function validateTableRow(
  input: unknown,
  path: string,
  sectionId: string,
  context: DocumentSchemaContext
): void {
  const row = readRecord(input, path, context)

  assertKnownKeys(row, ['id', 'properties', 'cells'], path, context)
  assertIdentifier(row.id, 'table-row', `${path}/id`, context)
  assertOptionalOpenRecord(row.properties, `${path}/properties`, context)

  if (!Array.isArray(row.cells)) {
    fail(`${path}/cells`, context)
  }
  row.cells.forEach((cell, index) => {
    validateTableCell(cell, `${path}/cells/${index}`, sectionId, context)
  })
}

/** 校验 table cell 并递归验证嵌套 block。 */
function validateTableCell(
  input: unknown,
  path: string,
  sectionId: string,
  context: DocumentSchemaContext
): void {
  const cell = readRecord(input, path, context)

  assertKnownKeys(cell, ['id', 'properties', 'border', 'gridSpan', 'blocks'], path, context)
  assertIdentifier(cell.id, 'table-cell', `${path}/id`, context)
  assertOptionalOpenRecord(cell.properties, `${path}/properties`, context)
  validateTableBorder(cell.border, `${path}/border`, context)
  if (cell.gridSpan !== undefined) {
    assertPositiveInteger(cell.gridSpan, `${path}/gridSpan`, context)
  }

  if (!Array.isArray(cell.blocks)) {
    fail(`${path}/blocks`, context)
  }
  cell.blocks.forEach((block, index) => {
    validateBlock(block, `${path}/blocks/${index}`, sectionId, context)
  })
}

/** 校验 table/cell 可选边框结构。 */
function validateTableBorder(input: unknown, path: string, context: DocumentSchemaContext): void {
  if (input === undefined) {
    return
  }

  const border = readPlainRecord(input, path, context)

  assertKnownKeys(border, ['color', 'widthTwips'], path, context)
  assertOptionalString(border.color, `${path}/color`, context)
  assertOptionalFiniteNumber(border.widthTwips, `${path}/widthTwips`, context)
}

/** 校验 paragraph list 可选结构。 */
function validateParagraphList(input: unknown, path: string, context: DocumentSchemaContext): void {
  if (input === undefined) {
    return
  }

  const list = readPlainRecord(input, path, context)

  assertKnownKeys(list, ['numberingId', 'level'], path, context)
  assertNonEmptyString(list.numberingId, `${path}/numberingId`, context)
  assertNonNegativeInteger(list.level, `${path}/level`, context)
}

/** 校验 run 固定结构并递归验证 inline 列表。 */
function validateRun(
  input: unknown,
  path: string,
  blockId: string,
  context: DocumentSchemaContext
): void {
  const run = readRecord(input, path, context)

  assertKnownKeys(run, ['kind', 'id', 'properties', 'field', 'link', 'revisionId', 'inlines'], path, context)
  assertLiteral(run.kind, 'run', `${path}/kind`, context)
  assertIdentifier(run.id, 'run', `${path}/id`, context)
  context.runBlockIds.set(run.id as string, blockId)
  assertOptionalOpenRecord(run.properties, `${path}/properties`, context)
  validateRunField(run.field, `${path}/field`, context)
  validateRunLink(run.link, `${path}/link`, context)
  if (run.revisionId !== undefined) {
    assertIdentifierValue(run.revisionId, `${path}/revisionId`, context)
    context.revisionReferences.push({
      id: run.revisionId as string,
      path: `${path}/revisionId`
    })
  }

  if (!Array.isArray(run.inlines)) {
    fail(`${path}/inlines`, context)
  }
  run.inlines.forEach((inline, index) => {
    validateInline(inline, `${path}/inlines/${index}`, context)
  })
}

/** 校验 run field 可选结构。 */
function validateRunField(input: unknown, path: string, context: DocumentSchemaContext): void {
  if (input === undefined) {
    return
  }

  const field = readPlainRecord(input, path, context)

  assertKnownKeys(field, ['code', 'result'], path, context)
  assertString(field.code, `${path}/code`, context)
  assertOptionalString(field.result, `${path}/result`, context)
}

/** 校验 run link 可选结构。 */
function validateRunLink(input: unknown, path: string, context: DocumentSchemaContext): void {
  if (input === undefined) {
    return
  }

  const link = readPlainRecord(input, path, context)

  assertKnownKeys(link, ['target', 'tooltip'], path, context)
  assertString(link.target, `${path}/target`, context)
  assertOptionalString(link.tooltip, `${path}/tooltip`, context)
}

/** 按 discriminant 校验全部 inline 变体。 */
function validateInline(input: unknown, path: string, context: DocumentSchemaContext): void {
  const inline = readRecord(input, path, context)

  if (inline.kind === 'text') {
    assertKnownKeys(inline, ['kind', 'text'], path, context)
    assertString(inline.text, `${path}/text`, context)
    return
  }
  if (inline.kind === 'image') {
    assertKnownKeys(inline, [
      'kind',
      'resourceId',
      'alt',
      'display',
      'widthTwips',
      'heightTwips',
      'rotationDegrees'
    ], path, context)
    assertIdentifierValue(inline.resourceId, `${path}/resourceId`, context)
    context.resourceReferences.push({
      id: inline.resourceId as string,
      path: `${path}/resourceId`
    })
    assertOptionalString(inline.alt, `${path}/alt`, context)
    if (inline.display !== undefined) {
      assertLiteral(inline.display, 'inline', `${path}/display`, context)
    }
    assertOptionalFiniteNumber(inline.widthTwips, `${path}/widthTwips`, context)
    assertOptionalFiniteNumber(inline.heightTwips, `${path}/heightTwips`, context)
    assertOptionalFiniteNumber(inline.rotationDegrees, `${path}/rotationDegrees`, context)
    return
  }
  if (inline.kind === 'break') {
    assertKnownKeys(inline, ['kind', 'breakType'], path, context)
    assertEnum(inline.breakType, ['line', 'page', 'column'], `${path}/breakType`, context)
    return
  }
  if (inline.kind === 'bookmark') {
    assertKnownKeys(inline, ['kind', 'id', 'name', 'edge'], path, context)
    assertIdentifierValue(inline.id, `${path}/id`, context)
    assertString(inline.name, `${path}/name`, context)
    assertEnum(inline.edge, ['start', 'end'], `${path}/edge`, context)
    return
  }
  if (inline.kind === 'commentRangeMarker') {
    assertKnownKeys(inline, ['kind', 'commentId', 'edge'], path, context)
    assertIdentifierValue(inline.commentId, `${path}/commentId`, context)
    context.commentReferences.push({
      id: inline.commentId as string,
      path: `${path}/commentId`
    })
    assertEnum(inline.edge, ['start', 'end'], `${path}/edge`, context)
    return
  }

  fail(`${path}/kind`, context)
}

/** 读取结构节点并累计固定节点与深度预算。 */
function readRecord(input: unknown, path: string, context: DocumentSchemaContext): JsonRecord {
  context.nodeCount += 1
  assertNativePackageLimit(
    context.nodeCount,
    JWORD_NATIVE_PACKAGE_LIMITS.documentNodeCount,
    context.requestId,
    'document.json'
  )
  assertNativePackageLimit(
    readPathDepth(path),
    JWORD_NATIVE_PACKAGE_LIMITS.jsonDepth,
    context.requestId,
    'document.json'
  )

  if (!isRecord(input)) {
    fail(path, context)
  }

  return input
}

/** 读取非结构节点的封闭对象，不计入 canonical document 节点预算。 */
function readPlainRecord(input: unknown, path: string, context: DocumentSchemaContext): JsonRecord {
  if (!isRecord(input)) {
    fail(path, context)
  }

  return input
}

/** 检查封闭结构只含已知字段；未知字段只定位到已知父路径。 */
function assertKnownKeys(
  record: JsonRecord,
  keys: readonly string[],
  path: string,
  context: DocumentSchemaContext
): void {
  const allowed = new Set(keys)

  if (Object.keys(record).some((key) => !allowed.has(key))) {
    fail(path, context)
  }
}

/** 校验固定字符串 discriminant。 */
function assertLiteral(
  input: unknown,
  expected: string,
  path: string,
  context: DocumentSchemaContext
): void {
  if (input !== expected) {
    fail(path, context)
  }
}

/** 校验非空、有长度预算且在类型域内唯一的标识符。 */
function assertIdentifier(
  input: unknown,
  domain: string,
  path: string,
  context: DocumentSchemaContext
): void {
  if (
    typeof input !== 'string' ||
    input.length === 0 ||
    textEncoder.encode(input).byteLength > JWORD_NATIVE_PACKAGE_LIMITS.identifierBytes
  ) {
    fail(path, context)
  }

  const identifiers = context.identifiers.get(domain) ?? new Set<string>()

  if (identifiers.has(input)) {
    fail(path, context)
  }
  identifiers.add(input)
  context.identifiers.set(domain, identifiers)
}

/** 校验非空且满足标识符字节预算的引用值。 */
function assertIdentifierValue(input: unknown, path: string, context: DocumentSchemaContext): void {
  if (
    typeof input !== 'string' ||
    input.length === 0 ||
    textEncoder.encode(input).byteLength > JWORD_NATIVE_PACKAGE_LIMITS.identifierBytes
  ) {
    fail(path, context)
  }
}

/** 核对指定类型域的全部引用均指向已登记实体。 */
function assertReferences(
  domain: string,
  references: readonly DocumentSchemaReference[],
  context: DocumentSchemaContext
): void {
  const identifiers = context.identifiers.get(domain) ?? new Set<string>()

  for (const reference of references) {
    if (!identifiers.has(reference.id)) {
      fail(reference.path, context)
    }
  }
}

/** 核对文本 anchor 的 document、section、block 与 run 归属链。 */
function assertTextAnchorReferences(context: DocumentSchemaContext): void {
  const documentIds = context.identifiers.get('document') ?? new Set<string>()

  for (const reference of context.textAnchorReferences) {
    if (!documentIds.has(reference.documentId)) {
      fail(`${reference.path}/documentId`, context)
    }
    if (context.sectionDocumentIds.get(reference.sectionId) !== reference.documentId) {
      fail(`${reference.path}/sectionId`, context)
    }
    if (context.blockSectionIds.get(reference.blockId) !== reference.sectionId) {
      fail(`${reference.path}/blockId`, context)
    }
    if (context.runBlockIds.get(reference.runId) !== reference.blockId) {
      fail(`${reference.path}/runId`, context)
    }
  }
}

/** 核对 document 内全部资源引用都指向自身资源表。 */
function assertResourceReferences(context: DocumentSchemaContext): void {
  const identifiers = context.identifiers.get('resource') ?? new Set<string>()

  if (context.resourceReferences.some((reference) => !identifiers.has(reference.id))) {
    throw createPackageError(
      'JWORD_NATIVE_RESOURCE_REFERENCE_MISSING',
      'JWORD_NATIVE_RESOURCE_REFERENCE_MISSING',
      context.requestId,
      'document.json'
    )
  }
}

/** 校验字符串字段。 */
function assertString(input: unknown, path: string, context: DocumentSchemaContext): void {
  if (typeof input !== 'string') {
    fail(path, context)
  }
}

/** 校验非空字符串字段。 */
function assertNonEmptyString(input: unknown, path: string, context: DocumentSchemaContext): void {
  if (typeof input !== 'string' || input.length === 0) {
    fail(path, context)
  }
}

/** 校验去除首尾空白后仍非空的字符串字段。 */
function assertTrimmedNonEmptyString(input: unknown, path: string, context: DocumentSchemaContext): void {
  if (typeof input !== 'string' || input.trim().length === 0) {
    fail(path, context)
  }
}

/** 校验可选字符串字段。 */
function assertOptionalString(input: unknown, path: string, context: DocumentSchemaContext): void {
  if (input !== undefined) {
    assertString(input, path, context)
  }
}

/** 校验可选 boolean 字段。 */
function assertOptionalBoolean(input: unknown, path: string, context: DocumentSchemaContext): void {
  if (input !== undefined && typeof input !== 'boolean') {
    fail(path, context)
  }
}

/** 校验固定字符串枚举。 */
function assertEnum(
  input: unknown,
  values: readonly string[],
  path: string,
  context: DocumentSchemaContext
): void {
  if (typeof input !== 'string' || !values.includes(input)) {
    fail(path, context)
  }
}

/** 校验非负整数字段。 */
function assertNonNegativeInteger(input: unknown, path: string, context: DocumentSchemaContext): void {
  if (!Number.isSafeInteger(input) || (input as number) < 0) {
    fail(path, context)
  }
}

/** 校验正整数字段。 */
function assertPositiveInteger(input: unknown, path: string, context: DocumentSchemaContext): void {
  if (!Number.isSafeInteger(input) || (input as number) <= 0) {
    fail(path, context)
  }
}

/** 校验可选有限数字字段。 */
function assertOptionalFiniteNumber(input: unknown, path: string, context: DocumentSchemaContext): void {
  if (input !== undefined && (typeof input !== 'number' || !Number.isFinite(input))) {
    fail(path, context)
  }
}

/** 校验可选有限数字数组。 */
function assertOptionalFiniteNumberArray(input: unknown, path: string, context: DocumentSchemaContext): void {
  if (input === undefined) {
    return
  }
  if (!Array.isArray(input)) {
    fail(path, context)
  }

  input.forEach((value, index) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      fail(`${path}/${index}`, context)
    }
  })
}

/** 校验可选开放 JSON record 字段。 */
function assertOptionalOpenRecord(input: unknown, path: string, context: DocumentSchemaContext): void {
  if (input !== undefined && !isRecord(input)) {
    fail(path, context)
  }
}

/** 计算规范化 JSON Pointer 的结构深度。 */
function readPathDepth(path: string): number {
  return path.length === 0 ? 0 : path.split('/').length - 1
}

/** 抛出稳定 document schema 错误。 */
function fail(path: string, context: DocumentSchemaContext): never {
  throw new JWordDocumentSchemaError(path, context.requestId)
}
