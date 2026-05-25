/**
 * 职责：导出 Gate 5 DOCX 导入导出包的第一版公开契约。
 * 边界：只暴露 import/export/inspect 入口和结构化结果类型，不访问 core 内部 store 或 Y.Doc。
 * 协作模块：core projection、后续 OPC reader、OOXML mapping、worker 和 fixture diff 通过此入口协作。
 * 性能/安全约束：入口无副作用，不把 JSZip 或 worker 代码强制拉入 core 或 vanilla 首屏。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#iteration-3---建立-packagesdocx-最小包与公开-api。
 */

import type { DocumentProjection } from '@4xian/jword-core'
import JSZip from 'jszip'
import {
  type XmlElementNode,
  parseXml,
  readXmlAttribute,
  readXmlChildren,
  readXmlElementsByLocalName,
  serializeXml
} from './xml'
import { buildExportDocxPackage } from './export'
import type {
  DocxDiagnosticSeverity,
  DocxErrorCode,
  DocxWarningCode
} from './diagnostics'
export { createDocxCompatibilityReport } from './compatibility'
export {
  DOCX_ERROR_CODE_METADATA,
  DOCX_WARNING_CODE_METADATA,
  isDocxErrorCode
} from './diagnostics'
export { convertDocxImportDocumentToCoreDocument } from './model'
export type {
  CreateDocxCompatibilityReportOptions,
  DocxCompatibilityAppName,
  DocxCompatibilityAppResult,
  DocxCompatibilityAutomatedCheck,
  DocxCompatibilityAutomatedCheckKind,
  DocxCompatibilityDiagnostics,
  DocxCompatibilityReport,
  DocxCompatibilityResult,
  DocxOpenXmlValidationDiagnostic,
  DocxOpenXmlValidationResult,
  DocxOpenXmlValidationSeverity
} from './compatibility'
export type {
  DocxDiagnosticCodeMetadata,
  DocxDiagnosticSeverity,
  DocxErrorCode,
  DocxWarningCode
} from './diagnostics'
export { diffDocxRoundtrip } from './roundtrip'
export type {
  DocxRoundtripDiffOptions,
  DocxRoundtripDiffResult,
  DocxRoundtripDifference,
  DocxRoundtripImageSnapshot,
  DocxRoundtripParagraphSnapshot,
  DocxRoundtripSnapshot,
  DocxRoundtripTableCellSnapshot,
  DocxRoundtripTableRowSnapshot,
  DocxRoundtripTableSnapshot
} from './roundtrip'

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
    | 'DOCX_CONTENT_TYPES_MISSING'
    | 'DOCX_ROOT_RELS_MISSING'
    | 'DOCX_MAIN_DOCUMENT_MISSING'
  >

export interface DocxError {
  readonly name: 'DocxUnsupportedError' | 'DocxPackageError'
  readonly code: DocxErrorCode
  readonly message: string
  readonly requestId?: string
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
  readonly bytes: readonly number[]
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
}

export interface ImportDocxResult {
  readonly document: DocxImportDocument
  readonly warnings: readonly DocxWarning[]
  readonly diagnostics: DocxDiagnostics
}

export interface ExportDocxOptions {
  readonly requestId?: string
  readonly signal?: AbortSignal
  readonly opaque?: DocxOpaquePreservation
}

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
  readonly bytes: readonly number[]
}

export interface DocxCommentsIndex {
  readonly comments: readonly DocxImportComment[]
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

/** 创建 DOCX worker 进度事件。 */
export function createDocxProgressEvent(
  requestId: string,
  stage: DocxProgressStage,
  detail: Omit<DocxProgressEvent, 'type' | 'requestId' | 'stage'> = {}
): DocxProgressEvent {
  return {
    type: 'progress',
    requestId,
    stage,
    ...detail
  }
}

/** 创建 DOCX worker 错误事件。 */
export function createDocxErrorEvent(requestId: string, error: DocxError): DocxErrorEvent {
  return {
    type: 'error',
    requestId,
    error
  }
}

/** 创建 DOCX worker 取消请求。 */
export function createCancelDocxRequest(requestId: string): CancelDocxRequest {
  return {
    type: 'cancel',
    requestId
  }
}

/** 提取 DOCX 二进制输入可转移的底层 ArrayBuffer。 */
export function createDocxTransferables(input: DocxBinaryInput): readonly DocxTransferable[] {
  if (input instanceof ArrayBuffer) {
    return [input]
  }

  if (ArrayBuffer.isView(input)) {
    return input.buffer instanceof ArrayBuffer ? [input.buffer] : []
  }

  return []
}

/** 导入 DOCX 二进制并返回 JWord 可控结构化中间模型。 */
export async function importDocx(
  input: DocxBinaryInput,
  options: ImportDocxOptions = {}
): Promise<ImportDocxResult> {
  assertDocxNotCancelled(options)

  const context = await readDocxPackageContext(input, options)

  assertDocxNotCancelled(options)

  const indexes = await createDocxIndexesFromContext(context, options.requestId)

  assertDocxNotCancelled(options)

  const documentResult = await readImportDocument(context, indexes)

  assertDocxNotCancelled(options)

  return {
    document: documentResult.document,
    warnings: [
      ...context.warnings,
      ...indexes.styles.tableStyleWarnings,
      ...readUnsupportedNumberingFormatWarnings(indexes.numbering),
      ...documentResult.warnings
    ],
    diagnostics: {
      ...(options.requestId === undefined ? {} : { requestId: options.requestId }),
      mainDocumentPart: context.mainDocumentPart
    }
  }
}

/** 从 JWord projection/canonical model 导出 DOCX 二进制。 */
export async function exportDocx(
  document: DocumentProjection,
  options: ExportDocxOptions = {}
): Promise<ExportDocxResult> {
  assertDocxNotCancelled(options)

  return buildExportDocxPackage(document, options)
}

/** 只检查 DOCX package graph，不写入 JWord 文档。 */
export async function inspectDocxPackage(
  input: DocxBinaryInput,
  options: ImportDocxOptions = {}
): Promise<InspectDocxPackageResult> {
  assertDocxNotCancelled(options)

  const context = await readDocxPackageContext(input, options)

  assertDocxNotCancelled(options)

  const relationships = [
    ...context.rootRelationships,
    ...context.documentRelationships.map((relationship) => ({
      ...relationship,
      target: relationship.targetMode === 'External'
        ? relationship.target
        : resolvePartTarget(context.mainDocumentPart, relationship.target)
    }))
  ]

  return {
    parts: context.parts,
    relationships: relationships.map((relationship) => `${relationship.kind}:${relationship.target}`),
    partGraph: createDocxPartGraph(context.mainDocumentPart, context.documentRelationships),
    warnings: context.warnings,
    diagnostics: {
      ...(options.requestId === undefined ? {} : { requestId: options.requestId }),
      mainDocumentPart: context.mainDocumentPart
    }
  }
}

/** 建立 OOXML indexes，供后续 mapping 入口只消费索引。 */
export async function createDocxIndexes(
  input: DocxBinaryInput,
  options: ImportDocxOptions = {}
): Promise<DocxIndexes> {
  assertDocxNotCancelled(options)

  const context = await readDocxPackageContext(input, options)

  assertDocxNotCancelled(options)

  return createDocxIndexesFromContext(context, options.requestId)
}

class DocxUnsupportedError extends Error implements DocxError {
  override readonly name = 'DocxUnsupportedError'
  readonly code: DocxErrorCode
  readonly requestId?: string

  /** 创建 DOCX 未支持或取消场景使用的稳定错误对象。 */
  constructor(code: DocxErrorCode, message: string, requestId?: string) {
    super(message)
    this.code = code
    if (requestId !== undefined) {
      this.requestId = requestId
    }
  }
}

/** 检查 DOCX 任务是否已被取消。 */
function assertDocxNotCancelled(options: ImportDocxOptions | ExportDocxOptions): void {
  if (options.signal?.aborted !== true) {
    return
  }

  throw new DocxUnsupportedError('DOCX_USER_CANCELLED', '用户取消', options.requestId)
}

class DocxPackageError extends Error implements DocxError {
  override readonly name = 'DocxPackageError'
  readonly code: DocxPackageErrorCode
  readonly requestId?: string

  /** 创建 DOCX package inspect 阶段使用的稳定错误对象。 */
  constructor(code: DocxPackageErrorCode, requestId?: string) {
    super(requestId === undefined ? code : `${code}: ${requestId}`)
    this.code = code
    if (requestId !== undefined) {
      this.requestId = requestId
    }
  }
}

interface DocxRelationship {
  readonly id: string
  readonly kind: string
  readonly type: string
  readonly target: string
  readonly targetMode?: string
}

interface DocxPackageContext {
  readonly zip: JSZip
  readonly parts: readonly string[]
  readonly contentTypes: ReadonlyMap<string, string>
  readonly rootRelationships: readonly DocxRelationship[]
  readonly documentRelationships: readonly DocxRelationship[]
  readonly mainDocumentPart: string
  readonly documentRelsPart: string
  readonly opaque: DocxPackageOpaquePreservation
  readonly warnings: readonly DocxWarning[]
}

interface DocxPackageOpaquePreservation {
  readonly unsupportedParts: readonly DocxOpaqueUnsupportedPart[]
  readonly unsupportedRelationships: readonly DocxOpaqueUnsupportedRelationship[]
}

/** 读取 DOCX package 公共上下文，避免 inspect/import/indexes 重复拆包。 */
async function readDocxPackageContext(
  input: DocxBinaryInput,
  options: ImportDocxOptions
): Promise<DocxPackageContext> {
  const requestId = options.requestId
  const zip = await readDocxZip(input, requestId)

  assertDocxNotCancelled(options)

  const parts = Object.keys(zip.files)
    .filter((name) => !zip.files[name]?.dir)
    .sort()

  assertDocxNotCancelled(options)

  assertRequiredPart(parts, '[Content_Types].xml', 'DOCX_CONTENT_TYPES_MISSING', requestId)
  assertRequiredPart(parts, '_rels/.rels', 'DOCX_ROOT_RELS_MISSING', requestId)

  const contentTypes = readContentTypes(await readPartText(zip, '[Content_Types].xml'), parts)
  assertDocxNotCancelled(options)

  const rootRelationships = await readRelationships(zip, '_rels/.rels')
  assertDocxNotCancelled(options)

  const mainDocumentPart = rootRelationships.find((relationship) =>
    relationship.type.endsWith('/officeDocument')
  )?.target

  if (mainDocumentPart === undefined || !parts.includes(mainDocumentPart)) {
    throw new DocxPackageError('DOCX_MAIN_DOCUMENT_MISSING', requestId)
  }

  const documentRelsPart = readRelationshipPartPath(mainDocumentPart)
  const documentRelationships = parts.includes(documentRelsPart)
    ? await readRelationships(zip, documentRelsPart)
    : []
  assertDocxNotCancelled(options)

  const missingRelationshipWarnings = readMissingRelationshipWarnings(
    documentRelsPart,
    documentRelationships,
    parts,
    mainDocumentPart
  )
  const opaque = await readPackageOpaquePreservation(
    zip,
    parts,
    contentTypes,
    rootRelationships,
    mainDocumentPart,
    documentRelsPart,
    documentRelationships
  )
  assertDocxNotCancelled(options)

  const warnings = [
    ...missingRelationshipWarnings,
    ...readUnsupportedRelationshipWarnings(documentRelsPart, opaque.unsupportedRelationships),
    ...readUnsupportedPartWarnings(opaque.unsupportedParts)
  ]

  return {
    zip,
    parts,
    contentTypes,
    rootRelationships,
    documentRelationships,
    mainDocumentPart,
    documentRelsPart,
    opaque,
    warnings
  }
}

/** 读取 DOCX zip，失败时返回稳定 package 错误。 */
async function readDocxZip(input: DocxBinaryInput, requestId?: string): Promise<JSZip> {
  try {
    return await JSZip.loadAsync(input)
  } catch {
    throw new DocxPackageError('DOCX_PACKAGE_INVALID', requestId)
  }
}

/** 校验必需 part 是否存在。 */
function assertRequiredPart(
  parts: readonly string[],
  part: string,
  code: DocxPackageErrorCode,
  requestId?: string
): void {
  if (!parts.includes(part)) {
    throw new DocxPackageError(code, requestId)
  }
}

/** 读取 OPC relationships part 中的关系。 */
async function readRelationships(zip: JSZip, part: string): Promise<readonly DocxRelationship[]> {
  const document = parseXml(await readPartText(zip, part))

  return readXmlElementsByLocalName(document.root, 'Relationship').map((element) => {
    const type = readXmlAttribute(element, 'Type') ?? ''
    const targetMode = readXmlAttribute(element, 'TargetMode')

    return {
      id: readXmlAttribute(element, 'Id') ?? '',
      kind: readRelationshipKind(type),
      type,
      target: readXmlAttribute(element, 'Target') ?? '',
      ...(targetMode === undefined ? {} : { targetMode })
    }
  })
}

/** 读取 package 中当前 mapper 不理解但需要保留的 part 和 relationship。 */
async function readPackageOpaquePreservation(
  zip: JSZip,
  parts: readonly string[],
  contentTypes: ReadonlyMap<string, string>,
  rootRelationships: readonly DocxRelationship[],
  mainDocumentPart: string,
  documentRelsPart: string,
  documentRelationships: readonly DocxRelationship[]
): Promise<DocxPackageOpaquePreservation> {
  const mappedParts = readMappedPartSet(rootRelationships, mainDocumentPart, documentRelsPart, documentRelationships)
  const existingParts = new Set(parts)
  const unsupportedRelationships = documentRelationships.flatMap((relationship) =>
    readOpaqueRelationship(relationship, mainDocumentPart, existingParts)
  )
  const unsupportedPartNames = parts
    .filter((part) => !mappedParts.has(part) && !isRelationshipPart(part))
    .sort(compareOpaquePartPath)
  const unsupportedParts = await Promise.all(unsupportedPartNames.map((part) =>
    readOpaquePart(zip, part, contentTypes.get(part))
  ))

  return {
    unsupportedParts,
    unsupportedRelationships
  }
}

/** 建立当前 import/index 实现已消费的 part 集。 */
function readMappedPartSet(
  rootRelationships: readonly DocxRelationship[],
  mainDocumentPart: string,
  documentRelsPart: string,
  documentRelationships: readonly DocxRelationship[]
): ReadonlySet<string> {
  const mappedParts = new Set([
    '[Content_Types].xml',
    '_rels/.rels',
    mainDocumentPart,
    documentRelsPart
  ])

  for (const relationship of rootRelationships) {
    if (relationship.targetMode === 'External' || !isMappedRootRelationshipKind(relationship.kind)) {
      continue
    }

    mappedParts.add(normalizePartPath(relationship.target.startsWith('/') ? relationship.target.slice(1) : relationship.target))
  }

  for (const relationship of documentRelationships) {
    if (relationship.targetMode === 'External' || !isMappedRelationshipKind(relationship.kind)) {
      continue
    }

    mappedParts.add(resolvePartTarget(mainDocumentPart, relationship.target))
  }

  return mappedParts
}

/** 判断根 relationships 是否已被当前 Gate 5 import/index 消费。 */
function isMappedRootRelationshipKind(kind: string): boolean {
  return [
    'core-properties',
    'extended-properties',
    'officeDocument'
  ].includes(kind)
}

/** 读取单个 unsupported relationship 的 opaque 记录。 */
function readOpaqueRelationship(
  relationship: DocxRelationship,
  sourcePart: string,
  existingParts: ReadonlySet<string>
): readonly DocxOpaqueUnsupportedRelationship[] {
  if (isMappedRelationshipKind(relationship.kind)) {
    return []
  }

  const target = relationship.targetMode === 'External'
    ? relationship.target
    : resolvePartTarget(sourcePart, relationship.target)

  if (relationship.targetMode !== 'External' && !existingParts.has(target)) {
    return []
  }

  return [
    {
      id: relationship.id,
      kind: relationship.kind,
      type: relationship.type,
      target,
      ...(relationship.targetMode === undefined ? {} : { targetMode: relationship.targetMode }),
      sourcePart,
      unsafeToPreserveAfterEdit: true
    }
  ]
}

/** 读取单个 unsupported part 的 opaque 记录。 */
async function readOpaquePart(
  zip: JSZip,
  part: string,
  contentType: string | undefined
): Promise<DocxOpaqueUnsupportedPart> {
  const base = {
    part,
    ...(contentType === undefined ? {} : { contentType }),
    unsafeToPreserveAfterEdit: true
  }

  return isTextOpaquePart(part, contentType)
    ? {
      ...base,
      text: await readPartText(zip, part)
    }
    : {
      ...base,
      bytes: Array.from(await readPartBytes(zip, part))
    }
}

/** 判断 relationship 是否已被当前 Gate 5 import/index 消费。 */
function isMappedRelationshipKind(kind: string): boolean {
  return [
    'comments',
    'footer',
    'header',
    'hyperlink',
    'image',
    'numbering',
    'settings',
    'styles',
    'theme'
  ].includes(kind)
}

/** relationship part 只作为关系元数据处理，不重复当成 unsupported part。 */
function isRelationshipPart(part: string): boolean {
  return part.endsWith('.rels') && (part === '_rels/.rels' || part.includes('/_rels/'))
}

/** 当前 preservation 对 XML/text 类 part 保留文本，其余保留 byte array。 */
function isTextOpaquePart(part: string, contentType: string | undefined): boolean {
  return part.endsWith('.xml') ||
    part.endsWith('.txt') ||
    contentType === 'application/xml' ||
    contentType?.startsWith('text/') === true
}

/** 让 word/ 内部二进制优先出现在诊断里，再列 customXml 等外围 part。 */
function compareOpaquePartPath(left: string, right: string): number {
  const leftWord = left.startsWith('word/')
  const rightWord = right.startsWith('word/')

  if (leftWord !== rightWord) {
    return leftWord ? -1 : 1
  }

  return left.localeCompare(right)
}

/** 为 unsupported relationship 生成可恢复 warning。 */
function readUnsupportedRelationshipWarnings(
  relationshipsPart: string,
  relationships: readonly DocxOpaqueUnsupportedRelationship[]
): readonly DocxWarning[] {
  return relationships.map((relationship) => ({
    code: 'DOCX_RELATIONSHIP_UNSUPPORTED',
    severity: 'warning',
    part: relationshipsPart,
    path: relationship.id,
    message: `DOCX relationship is not mapped yet: ${relationship.kind}`,
    fallback: 'preserve-opaque-relationship',
    recoverable: true
  }))
}

/** 为 unsupported part 生成可恢复 warning。 */
function readUnsupportedPartWarnings(parts: readonly DocxOpaqueUnsupportedPart[]): readonly DocxWarning[] {
  return parts.map((part) => ({
    code: 'DOCX_PART_UNSUPPORTED',
    severity: 'warning',
    part: part.part,
    message: `DOCX part is not mapped yet: ${part.part}`,
    fallback: 'preserve-opaque-part',
    recoverable: true
  }))
}

/** 读取 content type，Default 按 package part 扩展，Override 优先覆盖。 */
function readContentTypes(xml: string, parts: readonly string[]): ReadonlyMap<string, string> {
  const document = parseXml(xml)
  const defaults = new Map(readXmlElementsByLocalName(document.root, 'Default').map((element) => [
    readXmlAttribute(element, 'Extension') ?? '',
    readXmlAttribute(element, 'ContentType') ?? ''
  ] as const))
  const entries = parts.flatMap((part) => {
    const extension = readExtension(part)
    const contentType = defaults.get(extension)

    return contentType === undefined ? [] : [[part, contentType] as const]
  })

  for (const element of readXmlElementsByLocalName(document.root, 'Override')) {
    const partName = readXmlAttribute(element, 'PartName') ?? ''
    const contentType = readXmlAttribute(element, 'ContentType') ?? ''

    entries.push([partName.startsWith('/') ? partName.slice(1) : partName, contentType])
  }

  return new Map(entries)
}

/** 从 relationship type 推导诊断用短类型。 */
function readRelationshipKind(type: string): string {
  const index = type.lastIndexOf('/')

  return index === -1 ? type : type.slice(index + 1)
}

/** 从 package context 建立第一版 OOXML indexes。 */
async function createDocxIndexesFromContext(
  context: DocxPackageContext,
  requestId?: string
): Promise<DocxIndexes> {
  const relationshipIndex = buildRelationshipIndex(context)
  const media = await buildMediaIndex(context, relationshipIndex.images)

  return {
    styles: await buildStyleIndex(context),
    numbering: await buildNumberingIndex(context),
    relationships: relationshipIndex,
    media,
    comments: await buildCommentsIndex(context),
    headerFooter: {
      headers: context.documentRelationships
        .filter((relationship) => relationship.kind === 'header')
        .map((relationship) => resolvePartTarget(context.mainDocumentPart, relationship.target)),
      footers: context.documentRelationships
        .filter((relationship) => relationship.kind === 'footer')
        .map((relationship) => resolvePartTarget(context.mainDocumentPart, relationship.target))
    },
    diagnostics: {
      ...(requestId === undefined ? {} : { requestId }),
      mainDocumentPart: context.mainDocumentPart
    }
  }
}

/** 建立 style index 的最小可消费结构。 */
async function buildStyleIndex(context: DocxPackageContext): Promise<DocxStyleIndex> {
  const stylesPart = createDocxPartGraph(context.mainDocumentPart, context.documentRelationships).styles
  if (stylesPart === undefined || !context.parts.includes(stylesPart)) {
    return {
      paragraphStyles: [],
      characterStyles: [],
      linkedStyles: [],
      tableStyleWarnings: [],
      defaultParagraphStyleId: undefined,
      defaultRunStyleId: undefined
    }
  }

  const document = parseXml(await readPartText(context.zip, stylesPart))
  const styleElements = readXmlElementsByLocalName(document.root, 'style')
  const styleRecords = styleElements.flatMap((element) => {
    const type = readXmlAttribute(element, 'w:type')
    if (type !== 'paragraph' && type !== 'character') {
      return []
    }

    return [{
      styleId: readXmlAttribute(element, 'w:styleId') ?? '',
      kind: type,
      ...readChildValue(element, 'name', 'name'),
      ...readChildValue(element, 'basedOn', 'basedOn')
    }]
  })

  return {
    paragraphStyles: styleRecords.filter((style): style is DocxStyleRecord => style.kind === 'paragraph'),
    characterStyles: styleRecords.filter((style): style is DocxStyleRecord => style.kind === 'character'),
    linkedStyles: readLinkedStyles(styleElements),
    tableStyleWarnings: readTableStyleWarnings(styleElements, stylesPart),
    defaultParagraphStyleId: readDefaultStyleId(styleElements, 'paragraph'),
    defaultRunStyleId: readDefaultStyleId(styleElements, 'character')
  }
}

/** 建立 numbering index 的最小可消费结构。 */
async function buildNumberingIndex(context: DocxPackageContext): Promise<DocxNumberingIndex> {
  const numberingPart = createDocxPartGraph(context.mainDocumentPart, context.documentRelationships).numbering
  if (numberingPart === undefined || !context.parts.includes(numberingPart)) {
    return {
      abstractNumberings: [],
      numberingInstances: []
    }
  }

  const document = parseXml(await readPartText(context.zip, numberingPart))
  const abstractNumberings = readXmlElementsByLocalName(document.root, 'abstractNum').map((element) => ({
    abstractNumberingId: readXmlAttribute(element, 'w:abstractNumId') ?? '',
    levels: readXmlChildren(element)
      .filter((child) => child.localName === 'lvl')
      .map(readNumberingLevel)
  }))
  const numberingInstances = readXmlElementsByLocalName(document.root, 'num').map((element) => ({
    numberingId: readXmlAttribute(element, 'w:numId') ?? '',
    abstractNumberingId: readChildVal(element, 'abstractNumId') ?? ''
  }))

  return {
    abstractNumberings,
    numberingInstances
  }
}

/** 建立 relationship index，区分内外链和常用关系。 */
function buildRelationshipIndex(context: DocxPackageContext): DocxRelationshipIndex {
  const records = context.documentRelationships.map((relationship) => {
    const external = relationship.targetMode === 'External'
    const target = external
      ? relationship.target
      : resolvePartTarget(context.mainDocumentPart, relationship.target)

    return {
      id: relationship.id,
      kind: relationship.kind,
      type: relationship.type,
      target,
      ...(relationship.targetMode === undefined ? {} : { targetMode: relationship.targetMode }),
      sourcePart: context.mainDocumentPart
    }
  })
  const internal = records.filter((relationship) => relationship.targetMode !== 'External')
  const external = records.filter((relationship) => relationship.targetMode === 'External')
  const images = internal
    .filter((relationship) => relationship.kind === 'image')
    .map((relationship) => ({
      ...relationship,
      targetPart: relationship.target,
      mimeType: readMimeType(context, relationship.target),
      extension: readExtension(relationship.target)
    }))

  return {
    internal,
    external,
    images,
    hyperlinks: records.filter((relationship) => relationship.kind === 'hyperlink'),
    headerFooters: records.filter((relationship) => relationship.kind === 'header' || relationship.kind === 'footer')
  }
}

/** 建立 media index，把二进制转换为 JSON-friendly byte array。 */
async function buildMediaIndex(
  context: DocxPackageContext,
  images: readonly DocxImageRelationshipRecord[]
): Promise<DocxMediaIndex> {
  const items = await Promise.all(images.map(async (image) => ({
    targetPart: image.targetPart,
    mimeType: image.mimeType,
    extension: image.extension,
    bytes: Array.from(await readPartBytes(context.zip, image.targetPart))
  })))

  return { items }
}

/** 建立 comments index 的最小可消费结构。 */
async function buildCommentsIndex(context: DocxPackageContext): Promise<DocxCommentsIndex> {
  const commentsPart = createDocxPartGraph(context.mainDocumentPart, context.documentRelationships).comments[0]
  if (commentsPart === undefined || !context.parts.includes(commentsPart)) {
    return { comments: [] }
  }

  const document = parseXml(await readPartText(context.zip, commentsPart))

  return {
    comments: readXmlElementsByLocalName(document.root, 'comment').map((comment) => ({
      ...createDocxImportCommentId(readXmlAttribute(comment, 'w:id') ?? ''),
      author: readXmlAttribute(comment, 'w:author') ?? '',
      ...readOptionalAttribute(comment, 'w:date', 'date'),
      text: readXmlElementsByLocalName(comment, 't')
        .map((text) => readXmlChildren(text).length === 0 ? readElementText(text) : '')
        .join('')
    }))
  }
}

/** 建立页眉页脚 part 到 core source id 的最小映射。 */
async function buildHeaderFooterSourceIdIndex(
  context: DocxPackageContext,
  headerFooter: DocxHeaderFooterIndex
): Promise<DocxHeaderFooterSourceIdIndex> {
  const [headers, footers] = await Promise.all([
    buildHeaderFooterSourceIdMap(context, headerFooter.headers, 'header'),
    buildHeaderFooterSourceIdMap(context, headerFooter.footers, 'footer')
  ])

  return { headers, footers }
}

/** 读取一组页眉页脚 part 的 source id。 */
async function buildHeaderFooterSourceIdMap(
  context: DocxPackageContext,
  parts: readonly string[],
  role: 'header' | 'footer'
): Promise<ReadonlyMap<string, readonly string[]>> {
  const entries = await Promise.all(parts.map(async (part) => {
    if (!context.parts.includes(part)) {
      return [part, []] as const
    }

    return [
      part,
      readHeaderFooterSourceIdsFromRoot(parseXml(await readPartText(context.zip, part)).root, role)
    ] as const
  }))

  return new Map(entries)
}

/** 按当前 core source id 语义读取页眉页脚文本和页码。 */
function readHeaderFooterSourceIdsFromRoot(
  root: XmlElementNode,
  role: 'header' | 'footer'
): readonly string[] {
  const text = readXmlElementsByLocalName(root, 't')
    .map(readElementText)
    .join('')
    .trim()
  const pageNumberId = readHeaderFooterHasPageField(root)
    ? role === 'header' ? 'page-number-top-center' : 'page-number-bottom-center'
    : undefined

  return [
    ...(text === '' ? [] : [text]),
    ...(pageNumberId === undefined ? [] : [pageNumberId])
  ]
}

/** 判断页眉页脚 part 是否包含基础 PAGE 字段。 */
function readHeaderFooterHasPageField(root: XmlElementNode): boolean {
  return readXmlElementsByLocalName(root, 'instrText')
    .some((element) => /\bPAGE\b/u.test(readElementText(element))) ||
    readXmlElementsByLocalName(root, 'fldSimple')
      .some((element) => /\bPAGE\b/u.test(readXmlAttribute(element, 'w:instr') ?? ''))
}

/** 将空页眉页脚 part 回退为 part id，保持既有空 part 可观察。 */
function readHeaderFooterSourceIds(
  parts: readonly string[],
  sourceIdsByPart: ReadonlyMap<string, readonly string[]>
): readonly string[] {
  return parts.flatMap((part) => {
    const sourceIds = sourceIdsByPart.get(part)

    return sourceIds === undefined || sourceIds.length === 0 ? [part] : [...sourceIds]
  })
}

/** 创建稳定批注 thread id，同时保留 OOXML comment id。 */
function createDocxImportCommentId(commentId: string): Pick<DocxImportComment, 'id' | 'commentId'> {
  return {
    id: `comment-thread-docx-${commentId}`,
    commentId
  }
}

/** 读取最小 DOCX 导入中间模型。 */
interface DocxImportDocumentResult {
  readonly document: DocxImportDocument
  readonly warnings: readonly DocxWarning[]
}

interface DocxImportSectionProperties {
  readonly breakType?: 'continuous' | 'next-page'
  readonly page?: DocxImportSectionPage
  readonly headerIds?: readonly string[]
  readonly footerIds?: readonly string[]
  readonly pageNumbering?: DocxImportSectionPageNumbering
}

interface DocxImportStyleContext {
  readonly paragraphStyleIds: ReadonlySet<string>
  readonly characterStyleIds: ReadonlySet<string>
  readonly defaultParagraphStyleId?: string
  readonly defaultRunStyleId?: string
}

interface DocxHeaderFooterSourceIdIndex {
  readonly headers: ReadonlyMap<string, readonly string[]>
  readonly footers: ReadonlyMap<string, readonly string[]>
}

/** 读取 DOCX 主文档到 JSON-compatible 中间模型。 */
async function readImportDocument(
  context: DocxPackageContext,
  indexes: DocxIndexes
): Promise<DocxImportDocumentResult> {
  const document = parseXml(await readPartText(context.zip, context.mainDocumentPart))
  const body = readXmlChildren(document.root).find((child) => child.localName === 'body')
  const warnings: DocxWarning[] = []
  const unsupportedElementFragments: DocxOpaqueUnsupportedElementFragment[] = []
  const relationshipsById = new Map(context.documentRelationships.map((relationship) => [relationship.id, relationship] as const))
  const defaultParagraphStyleId = indexes.styles.defaultParagraphStyleId
  const defaultRunStyleId = indexes.styles.defaultRunStyleId
  const styleContext = {
    paragraphStyleIds: new Set(indexes.styles.paragraphStyles.map((style) => style.styleId)),
    characterStyleIds: new Set(indexes.styles.characterStyles.map((style) => style.styleId)),
    ...(defaultRunStyleId === undefined ? {} : { defaultRunStyleId }),
    ...(defaultParagraphStyleId === undefined ? {} : { defaultParagraphStyleId })
  }
  const headerFooterSourceIds = await buildHeaderFooterSourceIdIndex(context, indexes.headerFooter)

  return {
    document: {
      kind: 'docx-import-document',
      metadata: {
        mainDocumentPart: context.mainDocumentPart,
        styleIds: [
          ...indexes.styles.paragraphStyles.map((style) => style.styleId),
          ...indexes.styles.characterStyles.map((style) => style.styleId)
        ],
        numberingIds: [
          ...indexes.numbering.abstractNumberings.map((numbering) => numbering.abstractNumberingId),
          ...indexes.numbering.numberingInstances.map((numbering) => numbering.numberingId)
        ]
      },
      sections: readImportSections(
        body,
        warnings,
        context.mainDocumentPart,
        context.documentRelsPart,
        relationshipsById,
        readHeaderFooterSourceIds(indexes.headerFooter.headers, headerFooterSourceIds.headers),
        readHeaderFooterSourceIds(indexes.headerFooter.footers, headerFooterSourceIds.footers),
        styleContext,
        unsupportedElementFragments,
        headerFooterSourceIds
      ),
      resources: indexes.media.items.map((item) => ({
        kind: 'resource',
        resourceId: item.targetPart,
        mimeType: item.mimeType,
        extension: item.extension,
        targetPart: item.targetPart,
        bytes: item.bytes
      })),
      comments: indexes.comments.comments,
      opaque: {
        unsupportedParts: context.opaque.unsupportedParts,
        unsupportedRelationships: context.opaque.unsupportedRelationships,
        unsupportedElementFragments,
        originalStyleIds: [
          ...indexes.styles.paragraphStyles.map((style) => style.styleId),
          ...indexes.styles.characterStyles.map((style) => style.styleId)
        ],
        originalNumberingIds: [
          ...indexes.numbering.abstractNumberings.map((numbering) => numbering.abstractNumberingId),
          ...indexes.numbering.numberingInstances.map((numbering) => numbering.numberingId)
        ]
      }
    },
    warnings
  }
}

/** 按 body 直接子节点顺序读取 section，并在段落级 sectPr 处截断当前 section。 */
function readImportSections(
  body: XmlElementNode | undefined,
  warnings: DocxWarning[],
  part: string,
  relationshipsPart: string,
  relationshipsById: ReadonlyMap<string, DocxRelationship>,
  defaultHeaderIds: readonly string[],
  defaultFooterIds: readonly string[],
  styleContext: DocxImportStyleContext,
  unsupportedElementFragments: DocxOpaqueUnsupportedElementFragment[],
  headerFooterSourceIds: DocxHeaderFooterSourceIdIndex
): readonly DocxImportSection[] {
  if (body === undefined) {
    return [
      createImportSection(1, [], {}, defaultHeaderIds, defaultFooterIds)
    ]
  }

  const sections: DocxImportSection[] = []
  const blocks: DocxImportBlock[] = []
  let paragraphIndex = 0
  let tableIndex = 0
  let bodySectionProperties: XmlElementNode | undefined

  for (const child of readXmlChildren(body)) {
    if (child.localName === 'p') {
      paragraphIndex += 1
      const paragraphId = readScopedDocxId('', 'paragraph', paragraphIndex)
      blocks.push(readImportParagraph(
        child,
        paragraphId,
        '',
        warnings,
        part,
        relationshipsPart,
        relationshipsById,
        styleContext,
        unsupportedElementFragments
      ))

      const paragraphSectionProperties = readParagraphSectionProperties(child)
      if (paragraphSectionProperties !== undefined) {
        sections.push(createImportSection(
          sections.length + 1,
          blocks.splice(0),
          readSectionProperties(paragraphSectionProperties, warnings, part, relationshipsById, headerFooterSourceIds),
          defaultHeaderIds,
          defaultFooterIds
        ))
      }
      continue
    }

    if (child.localName === 'tbl') {
      tableIndex += 1
      blocks.push(readImportTable(
        child,
        readScopedDocxId('', 'table', tableIndex),
        warnings,
        part,
        relationshipsPart,
        '',
        false,
        relationshipsById,
        styleContext,
        unsupportedElementFragments
      ))
      continue
    }

    if (child.localName === 'sectPr') {
      bodySectionProperties = child
      continue
    }

    if (isRevisionMetadataElement(child)) {
      preserveUnsupportedRevisionElement(
        child,
        warnings,
        part,
        `body/${child.localName}`,
        unsupportedElementFragments
      )
      continue
    }

    warnings.push({
      code: 'DOCX_ELEMENT_UNSUPPORTED',
      severity: 'warning',
      part,
      path: `body/${child.localName}`,
      message: `DOCX element is not mapped yet: ${child.localName}`,
      fallback: 'preserve-opaque-element',
      recoverable: true
    })
    unsupportedElementFragments.push({
      part,
      path: `body/${child.localName}`,
      xml: serializeXml({ root: child }),
      unsafeToPreserveAfterEdit: true
    })
  }

  if (blocks.length > 0 || sections.length === 0 || bodySectionProperties !== undefined) {
    sections.push(createImportSection(
      sections.length + 1,
      blocks,
      readSectionProperties(bodySectionProperties, warnings, part, relationshipsById, headerFooterSourceIds),
      defaultHeaderIds,
      defaultFooterIds
    ))
  }

  return sections
}

/** 创建导入 section，中间模型显式保留默认 header/footer fallback。 */
function createImportSection(
  index: number,
  blocks: readonly DocxImportBlock[],
  properties: DocxImportSectionProperties,
  defaultHeaderIds: readonly string[],
  defaultFooterIds: readonly string[]
): DocxImportSection {
  return {
    kind: 'section',
    id: `section-${index}`,
    ...(properties.breakType === undefined ? {} : { breakType: properties.breakType }),
    ...(properties.page === undefined ? {} : { page: properties.page }),
    ...(properties.pageNumbering === undefined ? {} : { pageNumbering: properties.pageNumbering }),
    headerIds: properties.headerIds ?? defaultHeaderIds,
    footerIds: properties.footerIds ?? defaultFooterIds,
    blocks
  }
}

/** 读取段落属性里的 section properties。 */
function readParagraphSectionProperties(element: XmlElementNode): XmlElementNode | undefined {
  const paragraphProperties = readXmlChildren(element).find((child) => child.localName === 'pPr')

  return paragraphProperties === undefined
    ? undefined
    : readXmlChildren(paragraphProperties).find((child) => child.localName === 'sectPr')
}

/** 读取 block 容器的顺序块列表。 */
function readImportBlocks(
  element: XmlElementNode,
  warnings: DocxWarning[],
  part: string,
  relationshipsPart: string,
  containerPath: string,
  insideTableCell: boolean,
  relationshipsById: ReadonlyMap<string, DocxRelationship>,
  styleContext: DocxImportStyleContext,
  unsupportedElementFragments: DocxOpaqueUnsupportedElementFragment[]
): readonly DocxImportBlock[] {
  const blocks: DocxImportBlock[] = []
  let paragraphIndex = 0
  let tableIndex = 0

  for (const child of readXmlChildren(element)) {
    if (child.localName === 'p') {
      paragraphIndex += 1
      const paragraphId = readScopedDocxId(containerPath, 'paragraph', paragraphIndex)
      blocks.push(readImportParagraph(
        child,
        paragraphId,
        insideTableCell ? paragraphId : '',
        warnings,
        part,
        relationshipsPart,
        relationshipsById,
        styleContext,
        unsupportedElementFragments
      ))
      continue
    }

    if (child.localName === 'tbl') {
      tableIndex += 1
      blocks.push(readImportTable(
        child,
        readScopedDocxId(containerPath, 'table', tableIndex),
        warnings,
        part,
        relationshipsPart,
        containerPath,
        insideTableCell,
        relationshipsById,
        styleContext,
        unsupportedElementFragments
      ))
      continue
    }

    if (child.localName === 'sectPr') {
      continue
    }

    if (isRevisionMetadataElement(child)) {
      preserveUnsupportedRevisionElement(
        child,
        warnings,
        part,
        containerPath === '' ? child.localName : `${containerPath}/${child.localName}`,
        unsupportedElementFragments
      )
    }
  }

  return blocks
}

/** 读取 section properties，保留最小 page setup 与 section break 信息。 */
function readSectionProperties(
  element: XmlElementNode | undefined,
  warnings: DocxWarning[],
  part: string,
  relationshipsById: ReadonlyMap<string, DocxRelationship>,
  headerFooterSourceIds: DocxHeaderFooterSourceIdIndex
): DocxImportSectionProperties {
  if (element === undefined) {
    return {}
  }

  const pageSize = readSectionPageSize(element, warnings, part)
  const pageMargins = readSectionPageMargins(element)
  const breakType = readSectionBreakType(element, warnings, part)
  const columns = readSectionColumns(element, warnings, part)
  const headerIds = readSectionReferenceTargets(
    element,
    'headerReference',
    relationshipsById,
    part,
    headerFooterSourceIds.headers
  )
  const footerIds = readSectionReferenceTargets(
    element,
    'footerReference',
    relationshipsById,
    part,
    headerFooterSourceIds.footers
  )
  const pageNumbering = readSectionPageNumbering(element)
  const page = pageSize === undefined && pageMargins === undefined && columns === undefined
    ? undefined
    : {
      ...(pageSize === undefined ? {} : pageSize),
      ...(pageMargins === undefined ? {} : { marginTwips: pageMargins }),
      ...(columns === undefined ? {} : { columns })
    }

  return {
    ...(breakType === undefined ? {} : { breakType }),
    ...(page === undefined ? {} : { page }),
    ...(headerIds.length === 0 ? {} : { headerIds }),
    ...(footerIds.length === 0 ? {} : { footerIds }),
    ...(pageNumbering === undefined ? {} : { pageNumbering })
  }
}

/** 读取 section 的 page size。 */
function readSectionPageSize(
  element: XmlElementNode,
  warnings: DocxWarning[],
  part: string
): Pick<DocxImportSectionPage, 'widthTwips' | 'heightTwips'> | undefined {
  const pageSize = readXmlChildren(element).find((child) => child.localName === 'pgSz')

  if (pageSize === undefined) {
    return undefined
  }

  const widthTwips = readPositiveNumber(readXmlAttribute(pageSize, 'w:w'))
  const heightTwips = readPositiveNumber(readXmlAttribute(pageSize, 'w:h'))
  const orient = readXmlAttribute(pageSize, 'w:orient')

  if (orient === 'landscape') {
    if (widthTwips !== undefined && heightTwips !== undefined && widthTwips < heightTwips) {
      warnings.push({
        code: 'DOCX_SECTION_ORIENTATION_UNSUPPORTED',
        severity: 'warning',
        part,
        path: 'sectPr',
        message: 'DOCX section page orientation does not match page size: landscape',
        fallback: 'normalize-landscape-page-size',
        recoverable: true
      })
      return {
        widthTwips: heightTwips,
        heightTwips: widthTwips
      }
    }

    if (widthTwips !== undefined || heightTwips !== undefined) {
      return {
        ...(widthTwips === undefined ? {} : { widthTwips }),
        ...(heightTwips === undefined ? {} : { heightTwips })
      }
    }
  }

  if (orient !== undefined && orient !== 'portrait' && orient !== 'landscape') {
    warnings.push({
      code: 'DOCX_SECTION_ORIENTATION_UNSUPPORTED',
      severity: 'warning',
      part,
      path: 'sectPr',
      message: `DOCX section page orientation is not supported: ${orient}`,
      fallback: 'ignore-section-orientation',
      recoverable: true
    })
  }

  return {
    ...(widthTwips === undefined ? {} : { widthTwips }),
    ...(heightTwips === undefined ? {} : { heightTwips })
  }
}

/** 读取 section 的页边距。 */
function readSectionPageMargins(element: XmlElementNode): DocxImportSectionMargins | undefined {
  const pageMargins = readXmlChildren(element).find((child) => child.localName === 'pgMar')

  if (pageMargins === undefined) {
    return undefined
  }

  const top = readPositiveNumber(readXmlAttribute(pageMargins, 'w:top'))
  const right = readPositiveNumber(readXmlAttribute(pageMargins, 'w:right'))
  const bottom = readPositiveNumber(readXmlAttribute(pageMargins, 'w:bottom'))
  const left = readPositiveNumber(readXmlAttribute(pageMargins, 'w:left'))

  if (top === undefined && right === undefined && bottom === undefined && left === undefined) {
    return undefined
  }

  return {
    ...(top === undefined ? {} : { top }),
    ...(right === undefined ? {} : { right }),
    ...(bottom === undefined ? {} : { bottom }),
    ...(left === undefined ? {} : { left })
  }
}

/** 读取 section 的 type，默认 next-page。 */
function readSectionBreakType(
  element: XmlElementNode,
  warnings: DocxWarning[],
  part: string
): 'continuous' | 'next-page' | undefined {
  const sectionType = readXmlChildren(element).find((child) => child.localName === 'type')

  if (sectionType === undefined) {
    return 'next-page'
  }

  const value = readXmlAttribute(sectionType, 'w:val')

  if (value === 'continuous') {
    return 'continuous'
  }

  if (value === 'nextPage' || value === 'next-page' || value === undefined) {
    return 'next-page'
  }

  warnings.push({
    code: 'DOCX_SECTION_BREAK_UNSUPPORTED',
    severity: 'warning',
    part,
    path: 'sectPr',
    message: `DOCX section break type is not fully supported: ${value}`,
    fallback: 'treat-as-next-page',
    recoverable: true
  })

  return 'next-page'
}

/** 读取 section columns。 */
function readSectionColumns(
  element: XmlElementNode,
  warnings: DocxWarning[],
  part: string
): number | undefined {
  const columns = readXmlChildren(element).find((child) => child.localName === 'cols')

  if (columns === undefined) {
    return undefined
  }

  const num = readPositiveNumber(readXmlAttribute(columns, 'w:num'))
  const hasExplicitColumns = readXmlChildren(columns).some((child) => child.localName === 'col')

  if (hasExplicitColumns || (num !== undefined && num > 1)) {
    warnings.push({
      code: 'DOCX_SECTION_COLUMNS_UNSUPPORTED',
      severity: 'warning',
      part,
      path: 'sectPr',
      message: `DOCX section columns are not fully supported: ${num ?? 'custom'}`,
      fallback: 'ignore-columns',
      recoverable: true
    })
  }

  return undefined
}

/** 读取 section header/footer 引用。 */
function readSectionReferenceTargets(
  element: XmlElementNode,
  localName: 'headerReference' | 'footerReference',
  relationshipsById: ReadonlyMap<string, DocxRelationship>,
  part: string,
  sourceIdsByPart: ReadonlyMap<string, readonly string[]>
): readonly string[] {
  return readXmlChildren(element)
    .filter((child) => child.localName === localName)
    .map((child) => readXmlAttribute(child, 'r:id'))
    .flatMap((relationshipId) => {
      if (relationshipId === undefined) {
        return []
      }

      const relationship = relationshipsById.get(relationshipId)

      if (relationship === undefined || relationship.targetMode === 'External') {
        return []
      }

      const targetPart = resolvePartTarget(part, relationship.target)
      const sourceIds = sourceIdsByPart.get(targetPart)

      return sourceIds === undefined || sourceIds.length === 0 ? [targetPart] : [...sourceIds]
    })
}

/** 读取 section page numbering。 */
function readSectionPageNumbering(
  element: XmlElementNode
): DocxImportSectionPageNumbering | undefined {
  const pageNumbering = readXmlChildren(element).find((child) => child.localName === 'pgNumType')

  if (pageNumbering === undefined) {
    return undefined
  }

  const start = readPositiveNumber(readXmlAttribute(pageNumbering, 'w:start'))
  const mode = start === undefined ? 'continue' : 'restart'

  return {
    mode,
    ...(start === undefined ? {} : { start })
  }
}

/** 读取段落中间模型。 */
function readImportParagraph(
  element: XmlElementNode,
  id: string,
  runScope: string = '',
  warnings: DocxWarning[] = [],
  part = '',
  relationshipsPart = '',
  relationshipsById: ReadonlyMap<string, DocxRelationship> = new Map(),
  styleContext?: DocxImportStyleContext,
  unsupportedElementFragments: DocxOpaqueUnsupportedElementFragment[] = []
): DocxImportParagraph {
  let runIndex = 0
  const runs: DocxImportRun[] = []
  const pendingMarkers: DocxImportCommentRangeMarkerInline[] = []
  const paragraphLineHeight = readParagraphLineHeight(element)
  const readNextRunId = (): string => {
    runIndex += 1

    return readScopedDocxId(runScope, 'run', runIndex)
  }

  for (const child of readXmlChildren(element)) {
    if (child.localName === 'commentRangeStart') {
      const marker = readImportCommentRangeMarker(child, 'start')

      if (marker !== undefined) {
        pendingMarkers.push(marker)
      }
      continue
    }

    if (child.localName === 'commentRangeEnd') {
      const marker = readImportCommentRangeMarker(child, 'end')

      if (marker !== undefined && runs.length > 0) {
        const lastRun = runs[runs.length - 1]

        runs[runs.length - 1] = {
          ...lastRun!,
          inlines: [...lastRun!.inlines, marker]
        }
      }
      continue
    }

    if (isRevisionMetadataElement(child)) {
      preserveUnsupportedRevisionElement(
        child,
        warnings,
        part,
        `${id}/${child.localName}`,
        unsupportedElementFragments
      )
      continue
    }

    if (child.localName === 'r') {
      if (isCommentReferenceOnlyRun(child)) {
        continue
      }

      const run = readImportRun(
        child,
        readNextRunId(),
        warnings,
        part,
        relationshipsPart,
        relationshipsById,
        styleContext
      )

      runs.push(applyParagraphLineHeight(attachPendingCommentMarkers(run, pendingMarkers), paragraphLineHeight))
      continue
    }

    if (child.localName === 'hyperlink') {
      const hyperlinkRuns = readImportHyperlinkRuns(
        child,
        readNextRunId,
        warnings,
        part,
        relationshipsPart,
        relationshipsById,
        styleContext
      )

      for (const run of hyperlinkRuns) {
        runs.push(applyParagraphLineHeight(attachPendingCommentMarkers(run, pendingMarkers), paragraphLineHeight))
      }
    }
  }
  const styleId = resolveImportParagraphStyleId(readParagraphStyleId(element), id, warnings, part, styleContext)
  const properties = readParagraphProperties(element, id, warnings, part)

  return {
    kind: 'paragraph',
    id,
    ...(styleId === undefined ? {} : { styleId }),
    ...(properties === undefined ? {} : { properties }),
    runs
  }
}

/** 把段落行距应用到段内 run，匹配 core 当前 lineHeight 的 run 级语义。 */
function applyParagraphLineHeight(run: DocxImportRun, lineHeight: number | undefined): DocxImportRun {
  if (lineHeight === undefined) {
    return run
  }

  return {
    ...run,
    properties: {
      ...(run.properties ?? {}),
      lineHeight
    }
  }
}

/** 判断元素是否是当前只保留不导入的修订 metadata。 */
function isRevisionMetadataElement(element: XmlElementNode): boolean {
  return element.localName === 'ins' ||
    element.localName === 'del' ||
    element.localName === 'moveFrom' ||
    element.localName === 'moveTo'
}

/** 保留尚未支持的修订 metadata 原始 XML，并产生明确 warning。 */
function preserveUnsupportedRevisionElement(
  element: XmlElementNode,
  warnings: DocxWarning[],
  part: string,
  path: string,
  unsupportedElementFragments: DocxOpaqueUnsupportedElementFragment[]
): void {
  warnings.push({
    code: 'DOCX_REVISION_METADATA_UNSUPPORTED',
    severity: 'warning',
    part,
    path,
    message: `DOCX revision metadata is preserved but not imported yet: ${element.localName}`,
    fallback: 'preserve-opaque-revision',
    recoverable: true
  })
  unsupportedElementFragments.push({
    part,
    path,
    xml: serializeXml({ root: element }),
    unsafeToPreserveAfterEdit: true
  })
}

/** 判断 run 是否只承载批注引用符号。 */
function isCommentReferenceOnlyRun(element: XmlElementNode): boolean {
  const children = readXmlChildren(element).filter((child) => child.localName !== 'rPr')

  return children.length > 0 && children.every((child) => child.localName === 'commentReference')
}

/** 把段落级 commentRangeStart 附着到下一个有内容的 run。 */
function attachPendingCommentMarkers(
  run: DocxImportRun,
  pendingMarkers: DocxImportCommentRangeMarkerInline[]
): DocxImportRun {
  if (pendingMarkers.length === 0) {
    return run
  }

  const markers = pendingMarkers.splice(0)

  return {
    ...run,
    inlines: [...markers, ...run.inlines]
  }
}

/** 读取段落级批注范围 marker。 */
function readImportCommentRangeMarker(
  element: XmlElementNode,
  edge: 'start' | 'end'
): DocxImportCommentRangeMarkerInline | undefined {
  const commentId = readXmlAttribute(element, 'w:id')

  if (commentId === undefined) {
    return undefined
  }

  return {
    kind: 'commentRangeMarker',
    commentId: `comment-thread-docx-${commentId}`,
    edge
  }
}

/** 读取 external hyperlink 内部 run，无法解析链接时保留内部文本。 */
function readImportHyperlinkRuns(
  element: XmlElementNode,
  readNextRunId: () => string,
  warnings: DocxWarning[],
  part: string,
  relationshipsPart: string,
  relationshipsById: ReadonlyMap<string, DocxRelationship>,
  styleContext: DocxImportStyleContext | undefined
): readonly DocxImportRun[] {
  const link = readImportHyperlinkLink(element, warnings, relationshipsPart, relationshipsById)

  return readXmlChildren(element)
    .filter((child) => child.localName === 'r')
    .map((child) => {
      const run = readImportRun(
        child,
        readNextRunId(),
        warnings,
        part,
        relationshipsPart,
        relationshipsById,
        styleContext
      )

      return link === undefined ? run : { ...run, link }
    })
}

/** 从 hyperlink 节点读取 external relationship 对应的链接目标。 */
function readImportHyperlinkLink(
  element: XmlElementNode,
  warnings: DocxWarning[],
  relationshipsPart: string,
  relationshipsById: ReadonlyMap<string, DocxRelationship>
): DocxImportRunLink | undefined {
  const relationshipId = readXmlAttribute(element, 'r:id')

  if (relationshipId === undefined) {
    warnings.push({
      code: 'DOCX_HYPERLINK_RELATIONSHIP_MISSING',
      severity: 'warning',
      part: relationshipsPart,
      path: 'hyperlink',
      message: 'DOCX hyperlink relationship id is missing',
      fallback: 'preserve-hyperlink-text',
      recoverable: true
    })
    return undefined
  }

  const relationship = relationshipsById.get(relationshipId)

  if (relationship === undefined) {
    warnings.push({
      code: 'DOCX_HYPERLINK_RELATIONSHIP_MISSING',
      severity: 'warning',
      part: relationshipsPart,
      path: relationshipId,
      message: `DOCX hyperlink relationship target is missing: ${relationshipId}`,
      fallback: 'preserve-hyperlink-text',
      recoverable: true
    })
    return undefined
  }

  if (relationship.kind !== 'hyperlink' || relationship.targetMode !== 'External') {
    warnings.push({
      code: 'DOCX_HYPERLINK_UNSUPPORTED',
      severity: 'warning',
      part: relationshipsPart,
      path: relationshipId,
      message: `DOCX hyperlink relationship is not supported: ${relationship.kind}`,
      fallback: 'preserve-hyperlink-text',
      recoverable: true
    })
    return undefined
  }

  const tooltip = readXmlAttribute(element, 'w:tooltip')

  return {
    target: relationship.target,
    ...(tooltip === undefined ? {} : { tooltip })
  }
}

/** 读取 run 中间模型。 */
function readImportRun(
  element: XmlElementNode,
  id: string,
  warnings: DocxWarning[],
  part: string,
  relationshipsPart: string,
  relationshipsById: ReadonlyMap<string, DocxRelationship>,
  styleContext: DocxImportStyleContext | undefined
): DocxImportRun {
  const properties = readRunProperties(element, id, warnings, part, styleContext)

  return {
    kind: 'run',
    id,
    ...(properties === undefined ? {} : { properties }),
    inlines: readRunInlines(element, warnings, part, relationshipsPart, id, relationshipsById)
  }
}

/** 读取表格中间模型。 */
function readImportTable(
  element: XmlElementNode,
  id: string,
  warnings: DocxWarning[],
  part: string,
  relationshipsPart: string,
  containerPath: string,
  insideTableCell: boolean,
  relationshipsById: ReadonlyMap<string, DocxRelationship>,
  styleContext: DocxImportStyleContext,
  unsupportedElementFragments: DocxOpaqueUnsupportedElementFragment[]
): DocxImportTable {
  const properties = readTableProperties(element, warnings, part, id)
  const grid = readTableGrid(element)
  const rows = readXmlChildren(element)
    .filter((child) => child.localName === 'tr')
    .map((child, index) => readImportTableRow(
      child,
      readScopedDocxId(id, 'row', index + 1),
      warnings,
      part,
      relationshipsPart,
      relationshipsById,
      styleContext,
      unsupportedElementFragments
    ))

  if (insideTableCell) {
    warnings.push({
      code: 'DOCX_TABLE_NESTED_UNSUPPORTED',
      severity: 'warning',
      part,
      ...(containerPath === '' ? {} : { path: containerPath }),
      message: `DOCX nested table is preserved as structure but not fully supported: ${id}`,
      fallback: 'flatten-nested-table-text',
      recoverable: true
    })
  }

  return {
    kind: 'table',
    id,
    ...(properties === undefined ? {} : { properties }),
    ...(grid === undefined ? {} : { grid }),
    rows
  }
}

/** 读取表格行中间模型。 */
function readImportTableRow(
  element: XmlElementNode,
  id: string,
  warnings: DocxWarning[],
  part: string,
  relationshipsPart: string,
  relationshipsById: ReadonlyMap<string, DocxRelationship>,
  styleContext: DocxImportStyleContext,
  unsupportedElementFragments: DocxOpaqueUnsupportedElementFragment[]
): DocxImportTableRow {
  const cells = readXmlChildren(element)
    .filter((child) => child.localName === 'tc')
    .map((child, index) => readImportTableCell(
      child,
      readScopedDocxId(id, 'cell', index + 1),
      warnings,
      part,
      relationshipsPart,
      relationshipsById,
      styleContext,
      unsupportedElementFragments
    ))

  return {
    id,
    cells
  }
}

/** 读取表格单元格中间模型。 */
function readImportTableCell(
  element: XmlElementNode,
  id: string,
  warnings: DocxWarning[],
  part: string,
  relationshipsPart: string,
  relationshipsById: ReadonlyMap<string, DocxRelationship>,
  styleContext: DocxImportStyleContext,
  unsupportedElementFragments: DocxOpaqueUnsupportedElementFragment[]
): DocxImportTableCell {
  const properties = readTableCellProperties(element, warnings, part, id)
  const gridSpan = readTableCellGridSpan(element)
  const blocks = readImportBlocks(
    element,
    warnings,
    part,
    relationshipsPart,
    id,
    true,
    relationshipsById,
    styleContext,
    unsupportedElementFragments
  )

  return {
    id,
    ...(properties === undefined ? {} : { properties }),
    ...(gridSpan === undefined ? {} : { gridSpan }),
    blocks
  }
}

/** 读取 run 的最小格式属性。 */
function readRunProperties(
  element: XmlElementNode,
  runId: string,
  warnings: DocxWarning[],
  part: string,
  styleContext: DocxImportStyleContext | undefined
): Readonly<Record<string, unknown>> | undefined {
  const runProperties = readXmlChildren(element).find((child) => child.localName === 'rPr')

  if (runProperties === undefined) {
    return undefined
  }

  const properties: Record<string, unknown> = {}
  const children = readXmlChildren(runProperties)
  const styleId = resolveImportRunStyleId(readChildVal(runProperties, 'rStyle'), runId, warnings, part, styleContext)

  appendUnsupportedRunPropertyWarnings(children, runId, warnings, part)

  if (styleId !== undefined) {
    properties.styleId = styleId
  }

  if (children.some((child) => child.localName === 'b')) {
    properties.bold = true
  }
  if (children.some((child) => child.localName === 'i')) {
    properties.italic = true
  }
  if (children.some((child) => child.localName === 'u')) {
    properties.underline = true
  }
  if (children.some((child) => child.localName === 'strike')) {
    properties.strike = true
  }
  const fontFamily = children.find((child) => child.localName === 'rFonts')
  const fontSize = children.find((child) => child.localName === 'sz')
  const shading = children.find((child) => child.localName === 'shd')
  const verticalAlign = children.find((child) => child.localName === 'vertAlign')
  const color = children.find((child) => child.localName === 'color')
    ? readXmlAttribute(children.find((child) => child.localName === 'color')!, 'w:val')
    : undefined

  if (color !== undefined) {
    properties.color = `#${color.toLowerCase()}`
  }
  if (fontFamily !== undefined) {
    const value = readXmlAttribute(fontFamily, 'w:ascii') ??
      readXmlAttribute(fontFamily, 'w:hAnsi') ??
      readXmlAttribute(fontFamily, 'w:eastAsia') ??
      readXmlAttribute(fontFamily, 'w:cs')

    if (value !== undefined) {
      properties.fontFamily = value
    }
  }
  if (fontSize !== undefined) {
    const value = readPositiveNumber(readXmlAttribute(fontSize, 'w:val'))

    if (value !== undefined) {
      properties.fontSizeTwips = value * 10
    }
  }
  if (shading !== undefined) {
    const fill = readXmlAttribute(shading, 'w:fill')

    if (fill !== undefined && fill !== 'auto') {
      properties.backgroundColor = `#${fill.toLowerCase()}`
    }
  }
  if (verticalAlign !== undefined) {
    const value = readXmlAttribute(verticalAlign, 'w:val')

    if (value === 'superscript') {
      properties.superscript = true
    }
    if (value === 'subscript') {
      properties.subscript = true
    }
  }

  return Object.freeze(properties)
}

/** 对当前未映射的 run 属性输出稳定 warning。 */
function appendUnsupportedRunPropertyWarnings(
  children: readonly XmlElementNode[],
  runId: string,
  warnings: DocxWarning[],
  part: string
): void {
  const supported = new Set([
    'b',
    'color',
    'i',
    'rFonts',
    'rStyle',
    'shd',
    'strike',
    'sz',
    'u',
    'vertAlign'
  ])

  for (const child of children) {
    if (supported.has(child.localName)) {
      continue
    }

    warnings.push({
      code: 'DOCX_RUN_PROPERTY_UNSUPPORTED',
      severity: 'warning',
      part,
      path: `${runId}/${child.localName}`,
      message: `DOCX run property is not mapped yet: ${child.localName}`,
      fallback: 'preserve-run-text',
      recoverable: true
    })
  }
}

/** 读取 run 中最小 inline 序列。 */
function readRunInlines(
  element: XmlElementNode,
  warnings: DocxWarning[],
  part: string,
  relationshipsPart: string,
  runId: string,
  relationshipsById: ReadonlyMap<string, DocxRelationship>
): readonly DocxImportInline[] {
  const inlines: DocxImportInline[] = []

  for (const child of readXmlChildren(element)) {
    if (child.localName === 'commentReference') {
      continue
    }

    if (child.localName === 't') {
      inlines.push({
        kind: 'text',
        text: readElementText(child)
      })
      continue
    }

    if (child.localName === 'tab') {
      inlines.push({
        kind: 'text',
        text: '\t'
      })
      continue
    }

    if (child.localName === 'commentRangeStart' || child.localName === 'commentRangeEnd') {
      const marker = readImportCommentRangeMarker(
        child,
        child.localName === 'commentRangeStart' ? 'start' : 'end'
      )

      if (marker !== undefined) {
        inlines.push(marker)
      }
      continue
    }

    if (child.localName === 'br') {
      inlines.push({
        kind: 'break',
        breakType: readBreakType(child)
      })
      continue
    }

    if (child.localName === 'drawing') {
      inlines.push(
        ...readDrawingInlines(child, warnings, part, relationshipsPart, runId, relationshipsById)
      )
    }
  }

  return inlines
}

/** 读取 DrawingML inline 图片，浮动图片先降级警告。 */
function readDrawingInlines(
  element: XmlElementNode,
  warnings: DocxWarning[],
  part: string,
  relationshipsPart: string,
  runId: string,
  relationshipsById: ReadonlyMap<string, DocxRelationship>
): readonly DocxImportInline[] {
  if (readXmlChildren(element).some((child) => child.localName === 'anchor')) {
    warnings.push({
      code: 'DOCX_DRAWING_FLOATING_UNSUPPORTED',
      severity: 'warning',
      part,
      path: runId,
      message: `DOCX floating image is not supported yet: ${runId}`,
      fallback: 'preserve-empty-inline',
      recoverable: true
    })
    return []
  }

  const inline = readXmlChildren(element).find((child) => child.localName === 'inline')
  if (inline === undefined) {
    return []
  }

  const image = readDrawingInlineImage(inline, warnings, part, relationshipsPart, runId, relationshipsById)

  return image === undefined ? [] : [image]
}

/** 读取 wp:inline 的图片引用。 */
function readDrawingInlineImage(
  element: XmlElementNode,
  warnings: DocxWarning[],
  part: string,
  relationshipsPart: string,
  runId: string,
  relationshipsById: ReadonlyMap<string, DocxRelationship>
): DocxImportImageInline | undefined {
  const blip = readXmlElementsByLocalName(element, 'blip')[0]
  const extent = readXmlChildren(element).find((child) => child.localName === 'extent')
  const docPr = readXmlChildren(element).find((child) => child.localName === 'docPr')
  const relationshipId = blip === undefined
    ? undefined
    : readXmlAttribute(blip, 'r:embed') ?? readXmlAttribute(blip, 'r:link')

  const alt = docPr === undefined ? undefined : readXmlAttribute(docPr, 'descr')
  const widthTwips = extent === undefined ? undefined : readTwipsFromEmu(readXmlAttribute(extent, 'cx'))
  const heightTwips = extent === undefined ? undefined : readTwipsFromEmu(readXmlAttribute(extent, 'cy'))

  if (relationshipId === undefined) {
    warnings.push({
      code: 'DOCX_IMAGE_RELATIONSHIP_MISSING',
      severity: 'warning',
      part: relationshipsPart,
      path: runId,
      message: `DOCX image relationship is missing from wp:inline: ${runId}`,
      fallback: 'omit-image',
      recoverable: true
    })
    return undefined
  }

  const relationship = relationshipsById.get(relationshipId)

  if (relationship === undefined) {
    warnings.push({
      code: 'DOCX_IMAGE_RELATIONSHIP_MISSING',
      severity: 'warning',
      part: relationshipsPart,
      path: relationshipId,
      message: `DOCX image relationship target is missing: ${relationshipId}`,
      fallback: 'omit-image',
      recoverable: true
    })
    return createDocxImportImageInline(relationshipId, alt, widthTwips, heightTwips)
  }

  if (relationship.targetMode === 'External') {
    warnings.push({
      code: 'DOCX_IMAGE_EXTERNAL_UNSUPPORTED',
      severity: 'warning',
      part: relationshipsPart,
      path: relationshipId,
      message: `DOCX external image is not fetched: ${relationship.target}`,
      fallback: 'preserve-alt-text',
      recoverable: true
    })
    return createDocxImportImageInline(relationshipId, alt, widthTwips, heightTwips)
  }

  if (relationship.kind !== 'image') {
    warnings.push({
      code: 'DOCX_IMAGE_RELATIONSHIP_UNSUPPORTED',
      severity: 'warning',
      part: relationshipsPart,
      path: relationshipId,
      message: `DOCX image relationship kind is not supported: ${relationship.kind}`,
      fallback: 'omit-image',
      recoverable: true
    })
    return createDocxImportImageInline(relationshipId, alt, widthTwips, heightTwips)
  }

  return createDocxImportImageInline(
    resolvePartTarget(part, relationship.target),
    alt,
    widthTwips,
    heightTwips
  )
}

/** 创建行内图片中间模型。 */
function createDocxImportImageInline(
  resourceId: string,
  alt: string | undefined,
  widthTwips: number | undefined,
  heightTwips: number | undefined
): DocxImportImageInline {
  return {
    kind: 'image',
    resourceId,
    display: 'inline',
    ...(alt === undefined ? {} : { alt }),
    ...(widthTwips === undefined ? {} : { widthTwips }),
    ...(heightTwips === undefined ? {} : { heightTwips })
  }
}

/** 把 DrawingML 的 EMU 尺寸换算成 twips。 */
function readTwipsFromEmu(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined
  }

  const emu = Number(value)

  if (!Number.isFinite(emu) || emu <= 0) {
    return undefined
  }

  return Math.max(1, Math.round(emu / 635))
}

/** 读取 DOCX line/page/column break 类型。 */
function readBreakType(element: XmlElementNode): 'line' | 'page' | 'column' {
  const type = readXmlAttribute(element, 'w:type')

  if (type === 'page' || type === 'column') {
    return type
  }

  return 'line'
}

/** 读取段落样式 ID。 */
function readParagraphStyleId(element: XmlElementNode): string | undefined {
  const paragraphProperties = readXmlChildren(element).find((child) => child.localName === 'pPr')
  if (paragraphProperties === undefined) {
    return undefined
  }

  return readChildVal(paragraphProperties, 'pStyle')
}

/** 读取 OOXML on/off 属性，缺省和空元素都按启用处理。 */
function readOnOffValue(element: XmlElementNode): boolean {
  const value = readXmlAttribute(element, 'w:val')

  return value !== '0' && value !== 'false' && value !== 'off'
}

/** 校验段落样式是否在 style index 中，缺失时尽量回落到默认段落样式。 */
function resolveImportParagraphStyleId(
  styleId: string | undefined,
  paragraphId: string,
  warnings: DocxWarning[],
  part: string,
  styleContext: DocxImportStyleContext | undefined
): string | undefined {
  if (styleId === undefined || styleContext === undefined) {
    return styleId
  }

  if (styleContext.paragraphStyleIds.has(styleId)) {
    return styleId
  }

  warnings.push({
    code: 'DOCX_STYLE_UNKNOWN',
    severity: 'warning',
    part,
    path: paragraphId,
    message: `DOCX paragraph style is missing from styles index: ${styleId}`,
    fallback: 'preserve-style-id',
    recoverable: true
  })

  return styleId
}

/** 校验 run 字符样式是否在 style index 中，缺失时尽量回落到默认字符样式。 */
function resolveImportRunStyleId(
  styleId: string | undefined,
  runId: string,
  warnings: DocxWarning[],
  part: string,
  styleContext: DocxImportStyleContext | undefined
): string | undefined {
  if (styleId === undefined) {
    return undefined
  }

  if (styleContext === undefined) {
    return styleId
  }

  if (styleContext.characterStyleIds.has(styleId)) {
    return styleId
  }

  warnings.push({
    code: 'DOCX_STYLE_UNKNOWN',
    severity: 'warning',
    part,
    path: runId,
    message: `DOCX run style is missing from styles index: ${styleId}`,
    fallback: 'preserve-style-id',
    recoverable: true
  })

  return styleId
}

/** 读取段落格式属性。 */
function readParagraphProperties(
  element: XmlElementNode,
  paragraphId: string,
  warnings: DocxWarning[],
  part: string
): Readonly<Record<string, unknown>> | undefined {
  const paragraphProperties = readXmlChildren(element).find((child) => child.localName === 'pPr')

  if (paragraphProperties === undefined) {
    return undefined
  }

  const properties: Record<string, unknown> = {}
  const children = readXmlChildren(paragraphProperties)
  const alignment = readChildVal(paragraphProperties, 'jc')
  const spacing = children.find((child) => child.localName === 'spacing')
  const indentation = children.find((child) => child.localName === 'ind')
  const numbering = children.find((child) => child.localName === 'numPr')
  const keepNext = children.find((child) => child.localName === 'keepNext')
  const keepLines = children.find((child) => child.localName === 'keepLines')
  const widowControl = children.find((child) => child.localName === 'widowControl')

  appendUnsupportedParagraphPropertyWarnings(children, paragraphId, warnings, part)

  if (alignment !== undefined) {
    properties.alignment = alignment === 'center' ? 'center' : alignment
  }
  if (spacing !== undefined) {
    const before = readXmlAttribute(spacing, 'w:before')
    const after = readXmlAttribute(spacing, 'w:after')

    if (before !== undefined) {
      properties.spacingBeforeTwips = Number(before)
    }
    if (after !== undefined) {
      properties.spacingAfterTwips = Number(after)
    }
  }
  if (indentation !== undefined) {
    const left = readXmlAttribute(indentation, 'w:left')
    const firstLine = readXmlAttribute(indentation, 'w:firstLine')
    const hanging = readXmlAttribute(indentation, 'w:hanging')

    if (left !== undefined) {
      properties.indentLeftTwips = Number(left)
    }
    if (firstLine !== undefined) {
      properties.firstLineIndentTwips = Number(firstLine)
    }
    if (hanging !== undefined) {
      properties.hangingIndentTwips = Number(hanging)
    }
  }
  if (numbering !== undefined) {
    const numberingId = readChildVal(numbering, 'numId')
    const level = readChildVal(numbering, 'ilvl')

    if (numberingId !== undefined) {
      properties.listNumberingId = numberingId
    }
    if (level !== undefined) {
      properties.listLevel = Number(level)
    }
  }
  if (keepNext !== undefined) {
    properties.keepWithNext = readOnOffValue(keepNext)
  }
  if (keepLines !== undefined) {
    properties.keepLines = readOnOffValue(keepLines)
  }
  if (widowControl !== undefined) {
    properties.widowControl = readOnOffValue(widowControl)
  }

  return Object.keys(properties).length === 0 ? undefined : Object.freeze(properties)
}

/** 对当前未映射的段落属性输出稳定 warning。 */
function appendUnsupportedParagraphPropertyWarnings(
  children: readonly XmlElementNode[],
  paragraphId: string,
  warnings: DocxWarning[],
  part: string
): void {
  const supported = new Set([
    'ind',
    'jc',
    'keepLines',
    'keepNext',
    'numPr',
    'pStyle',
    'sectPr',
    'spacing',
    'widowControl'
  ])

  for (const child of children) {
    if (supported.has(child.localName)) {
      continue
    }

    warnings.push({
      code: 'DOCX_PARAGRAPH_PROPERTY_UNSUPPORTED',
      severity: 'warning',
      part,
      path: `${paragraphId}/${child.localName}`,
      message: `DOCX paragraph property is not mapped yet: ${child.localName}`,
      fallback: 'preserve-paragraph-content',
      recoverable: true
    })
  }
}

/** 读取段落基础自动行距，OOXML auto line 以 240 分之一行为单位。 */
function readParagraphLineHeight(element: XmlElementNode): number | undefined {
  const paragraphProperties = readXmlChildren(element).find((child) => child.localName === 'pPr')
  const spacing = paragraphProperties === undefined
    ? undefined
    : readXmlChildren(paragraphProperties).find((child) => child.localName === 'spacing')
  const line = spacing === undefined ? undefined : readPositiveNumber(readXmlAttribute(spacing, 'w:line'))
  const lineRule = spacing === undefined ? undefined : readXmlAttribute(spacing, 'w:lineRule')

  if (line === undefined || (lineRule !== undefined && lineRule !== 'auto')) {
    return undefined
  }

  return Number((line / 240).toFixed(4))
}

/** 读取表格属性。 */
function readTableProperties(
  element: XmlElementNode,
  warnings: DocxWarning[],
  part: string,
  id: string
): Readonly<Record<string, unknown>> | undefined {
  const tableProperties = readXmlChildren(element).find((child) => child.localName === 'tblPr')

  if (tableProperties === undefined) {
    return undefined
  }

  const properties: Record<string, unknown> = {}
  const styleId = readChildVal(tableProperties, 'tblStyle')
  const border = readTableBorder(tableProperties, ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'])

  if (styleId !== undefined) {
    properties.styleId = styleId
    warnings.push({
      code: 'DOCX_TABLE_STYLE_UNSUPPORTED',
      severity: 'warning',
      part,
      ...(id === '' ? {} : { path: id }),
      message: `DOCX table style is not mapped yet: ${styleId}`,
      fallback: 'preserve-style-id',
      recoverable: true
    })
  }
  if (border !== undefined) {
    properties.border = border
  }

  return Object.keys(properties).length === 0 ? undefined : Object.freeze(properties)
}

/** 读取表格单元格属性。 */
function readTableCellProperties(
  element: XmlElementNode,
  warnings: DocxWarning[],
  part: string,
  id: string
): Readonly<Record<string, unknown>> | undefined {
  const cellProperties = readXmlChildren(element).find((child) => child.localName === 'tcPr')

  if (cellProperties === undefined) {
    return undefined
  }

  const properties: Record<string, unknown> = {}
  const border = readTableBorder(cellProperties, ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'])
  const hasComplexMerge = readXmlChildren(cellProperties).some((child) => child.localName === 'vMerge' || child.localName === 'hMerge')

  if (border !== undefined) {
    properties.border = border
  }
  if (hasComplexMerge) {
    warnings.push({
      code: 'DOCX_TABLE_COMPLEX_MERGE_UNSUPPORTED',
      severity: 'warning',
      part,
      ...(id === '' ? {} : { path: id }),
      message: `DOCX complex merge is not fully supported yet: ${id}`,
      fallback: 'preserve-grid-span-only',
      recoverable: true
    })
  }

  return Object.keys(properties).length === 0 ? undefined : Object.freeze(properties)
}

/** 读取表格列宽网格。 */
function readTableGrid(element: XmlElementNode): readonly number[] | undefined {
  const tableGrid = readXmlChildren(element).find((child) => child.localName === 'tblGrid')

  if (tableGrid === undefined) {
    return undefined
  }

  const grid = readXmlChildren(tableGrid)
    .filter((child) => child.localName === 'gridCol')
    .map((gridColumn) => readPositiveNumber(readXmlAttribute(gridColumn, 'w:w')))
    .filter((value): value is number => value !== undefined)

  return grid.length === 0 ? undefined : Object.freeze(grid)
}

/** 读取表格单元格 gridSpan。 */
function readTableCellGridSpan(element: XmlElementNode): number | undefined {
  const cellProperties = readXmlChildren(element).find((child) => child.localName === 'tcPr')
  const gridSpan = cellProperties === undefined ? undefined : readChildVal(cellProperties, 'gridSpan')

  return gridSpan === undefined ? undefined : readPositiveNumber(gridSpan)
}

/** 读取表格边框。 */
function readTableBorder(
  element: XmlElementNode,
  borderNames: readonly string[]
): Readonly<{ color?: string, widthTwips?: number }> | undefined {
  const borderContainer = readXmlChildren(element).find((child) => child.localName === 'tblBorders' || child.localName === 'tcBorders')

  if (borderContainer === undefined) {
    return undefined
  }

  const borderElement = readXmlChildren(borderContainer).find((child) => borderNames.includes(child.localName))

  if (borderElement === undefined) {
    return undefined
  }

  const properties: Record<string, unknown> = {}
  const color = readXmlAttribute(borderElement, 'w:color')
  const size = readXmlAttribute(borderElement, 'w:sz')

  if (color !== undefined) {
    properties.color = color
  }
  if (size !== undefined) {
    const widthTwips = readPositiveNumber(size)

    if (widthTwips !== undefined) {
      properties.widthTwips = Math.round(widthTwips * 5 / 2)
    }
  }

  return Object.keys(properties).length === 0 ? undefined : Object.freeze(properties)
}

/** 读取编号层级。 */
function readNumberingLevel(element: XmlElementNode): DocxNumberingLevel {
  return {
    level: Number(readXmlAttribute(element, 'w:ilvl') ?? '0'),
    format: readChildVal(element, 'numFmt') ?? '',
    text: readChildVal(element, 'lvlText') ?? '',
    start: Number(readChildVal(element, 'start') ?? '1')
  }
}

/** 对当前未完整支持的编号格式输出稳定 warning。 */
function readUnsupportedNumberingFormatWarnings(numbering: DocxNumberingIndex): readonly DocxWarning[] {
  return numbering.abstractNumberings.flatMap((abstractNumbering) =>
    abstractNumbering.levels.flatMap((level) => {
      if (level.format === 'bullet' || level.format === 'decimal') {
        return []
      }

      return [{
        code: 'DOCX_NUMBERING_FORMAT_UNSUPPORTED',
        severity: 'warning' as const,
        part: 'word/numbering.xml',
        path: `abstractNum-${abstractNumbering.abstractNumberingId}/level-${level.level}`,
        message: `DOCX numbering format is not fully supported yet: ${level.format}`,
        fallback: 'preserve-numbering-metadata',
        recoverable: true
      }]
    })
  )
}

/** 读取直接子元素的 w:val。 */
function readChildVal(element: XmlElementNode, localName: string): string | undefined {
  return readXmlChildren(element)
    .find((child) => child.localName === localName)
    ?.[
      'attributes'
    ].find((attribute) => attribute.name === 'w:val')?.value
}

/** 将直接子元素 w:val 映射到对象字段。 */
function readChildValue<Key extends string>(
  element: XmlElementNode,
  localName: string,
  key: Key
): Partial<Record<Key, string>> {
  const value = readChildVal(element, localName)

  return value === undefined ? {} : { [key]: value } as Partial<Record<Key, string>>
}

/** 读取可选属性并映射为对象字段。 */
function readOptionalAttribute<Key extends string>(
  element: XmlElementNode,
  attributeName: string,
  key: Key
): Partial<Record<Key, string>> {
  const value = readXmlAttribute(element, attributeName)

  return value === undefined ? {} : { [key]: value } as Partial<Record<Key, string>>
}

/** 读取 linked style 对。 */
function readLinkedStyles(styleElements: readonly XmlElementNode[]): readonly DocxLinkedStyleRecord[] {
  return styleElements.flatMap((element) => {
    const linkedStyleId = readChildVal(element, 'link')
    const styleId = readXmlAttribute(element, 'w:styleId')

    return linkedStyleId === undefined || styleId === undefined
      ? []
      : [{ styleId, linkedStyleId }]
  })
}

/** 表格 style 暂只输出 warning，不伪装为完整支持。 */
function readTableStyleWarnings(
  styleElements: readonly XmlElementNode[],
  part: string
): readonly DocxWarning[] {
  return styleElements.flatMap((element) => {
    const styleId = readXmlAttribute(element, 'w:styleId')

    return readXmlAttribute(element, 'w:type') === 'table'
      ? [{
        code: 'DOCX_TABLE_STYLE_UNSUPPORTED',
        severity: 'warning' as const,
        part,
        ...(styleId === undefined ? {} : { path: styleId }),
        message: `DOCX table style is not indexed yet: ${styleId ?? ''}`,
        fallback: 'preserve-style-id',
        recoverable: true
      }]
      : []
  })
}

/** 读取默认 style id。 */
function readDefaultStyleId(
  styleElements: readonly XmlElementNode[],
  kind: 'paragraph' | 'character'
): string | undefined {
  return styleElements.find((element) =>
    readXmlAttribute(element, 'w:type') === kind
    && readXmlAttribute(element, 'w:default') === '1'
  )
    ?.[
      'attributes'
    ].find((attribute) => attribute.name === 'w:styleId')?.value
}

/** 读取元素下所有文本节点。 */
function readElementText(element: XmlElementNode): string {
  return element.children.map((child) => child.kind === 'text' ? child.text : readElementText(child)).join('')
}

/** 读取正数或返回 undefined。 */
function readPositiveNumber(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined
  }

  const number = Number(value)

  return Number.isFinite(number) && number > 0 ? number : undefined
}

/** 根据 part path 读取扩展名。 */
function readExtension(part: string): string {
  const index = part.lastIndexOf('.')

  return index === -1 ? '' : part.slice(index + 1)
}

/** 读取 part 的 MIME。 */
function readMimeType(context: DocxPackageContext, part: string): string {
  return context.contentTypes.get(part) ?? ''
}

/** 读取 part 文本。 */
async function readPartText(zip: JSZip, part: string): Promise<string> {
  const file = zip.file(part)

  return file === null || file === undefined ? '' : file.async('text')
}

/** 读取 part 二进制。 */
async function readPartBytes(zip: JSZip, part: string): Promise<Uint8Array> {
  const file = zip.file(part)

  return file === null || file === undefined ? new Uint8Array() : file.async('uint8array')
}

/** 读取某个 part 对应的 relationships part 路径。 */
function readRelationshipPartPath(part: string): string {
  const slashIndex = part.lastIndexOf('/')
  const directory = slashIndex === -1 ? '' : `${part.slice(0, slashIndex)}/`
  const filename = slashIndex === -1 ? part : part.slice(slashIndex + 1)

  return `${directory}_rels/${filename}.rels`
}

/** 根据 relationship target 和来源 part 解析 package 内目标路径。 */
function resolvePartTarget(sourcePart: string, target: string): string {
  if (target.startsWith('/')) {
    return target.slice(1)
  }

  const slashIndex = sourcePart.lastIndexOf('/')
  const directory = slashIndex === -1 ? '' : `${sourcePart.slice(0, slashIndex)}/`

  return normalizePartPath(`${directory}${target}`)
}

/** 规范化 OPC part 路径中的简单相对片段。 */
function normalizePartPath(path: string): string {
  const segments: string[] = []

  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') {
      continue
    }

    if (segment === '..') {
      segments.pop()
      continue
    }

    segments.push(segment)
  }

  return segments.join('/')
}

/** 根据 document relationships 建立 Gate 5 第一版 part graph。 */
function createDocxPartGraph(
  documentPart: string,
  relationships: readonly DocxRelationship[]
): DocxPartGraph {
  const resolved = relationships.map((relationship) => ({
    ...relationship,
    target: resolvePartTarget(documentPart, relationship.target)
  }))

  return {
    document: documentPart,
    ...readOptionalPart(resolved, 'styles', 'styles'),
    ...readOptionalPart(resolved, 'numbering', 'numbering'),
    ...readOptionalPart(resolved, 'settings', 'settings'),
    ...readOptionalPart(resolved, 'theme', 'theme'),
    headers: readRelationshipTargets(resolved, 'header'),
    footers: readRelationshipTargets(resolved, 'footer'),
    comments: readRelationshipTargets(resolved, 'comments'),
    media: resolved
      .filter((relationship) => relationship.kind === 'image' && relationship.targetMode !== 'External')
      .map((relationship) => relationship.target)
  }
}

/** 读取可选单例 part。 */
function readOptionalPart(
  relationships: readonly DocxRelationship[],
  property: 'styles' | 'numbering' | 'settings' | 'theme',
  kind: string
): Partial<Pick<DocxPartGraph, typeof property>> {
  const target = relationships.find((relationship) => relationship.kind === kind && relationship.targetMode !== 'External')?.target

  return target === undefined ? {} : { [property]: target }
}

/** 读取同类 relationship 目标路径。 */
function readRelationshipTargets(
  relationships: readonly DocxRelationship[],
  kind: string
): readonly string[] {
  return relationships
    .filter((relationship) => relationship.kind === kind && relationship.targetMode !== 'External')
    .map((relationship) => relationship.target)
}

/** 为断裂的 document relationships 生成可恢复 warning。 */
function readMissingRelationshipWarnings(
  relationshipsPart: string,
  relationships: readonly DocxRelationship[],
  parts: readonly string[],
  sourcePart: string
): readonly DocxWarning[] {
  return relationships.flatMap((relationship) => {
    if (relationship.targetMode === 'External') {
      return []
    }

    const target = resolvePartTarget(sourcePart, relationship.target)

    if (parts.includes(target)) {
      return []
    }

    return [
      {
        code: 'DOCX_RELATIONSHIP_TARGET_MISSING',
        severity: 'warning',
        part: relationshipsPart,
        path: target,
        message: `DOCX relationship target is missing: ${target}`,
        fallback: 'preserve-relationship-metadata',
        recoverable: true
      }
    ]
  })
}

/** 生成当前作用域下稳定的 DOCX id。 */
function readScopedDocxId(scope: string, kind: 'paragraph' | 'table' | 'run' | 'row' | 'cell', index: number): string {
  const suffix = `${kind}-${index}`

  return scope === '' ? suffix : `${scope}-${suffix}`
}
