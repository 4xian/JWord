/**
 * 职责：读取 DOCX OPC package，建立 relationships、part graph 和 Gate 5 OOXML indexes。
 * 边界：不把 DOCX 映射成 JWord 文档，不写出 ZIP，不访问 Y.Doc 或 DOM。
 * 协作模块：import.ts、compatibility.ts 和 worker.ts 通过这里共享 inspect/index 能力。
 * 性能/安全约束：只保留 JSON-compatible 诊断和 opaque preservation 元数据。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#iteration-5---实现-opc-package-reader-与-xml-解析骨架。
 */

import JSZip from 'jszip'
import { assertJWordFeatureEntitled } from '@4xian/jword-license'

import {
  normalizePartPath,
  readRelationshipPartPath,
  resolvePartTarget
} from './package-paths.js'
export {
  normalizePartPath,
  readRelationshipPartPath,
  readScopedDocxId,
  resolvePartTarget
} from './package-paths.js'
import type {
  DocxAbstractNumbering,
  DocxBinaryInput,
  DocxCommentsIndex,
  DocxError,
  DocxHeaderFooterIndex,
  DocxImageRelationshipRecord,
  DocxImportComment,
  DocxIndexes,
  DocxLinkedStyleRecord,
  DocxMediaIndex,
  DocxNumberingIndex,
  DocxNumberingLevel,
  DocxOpaqueUnsupportedPart,
  DocxOpaqueUnsupportedRelationship,
  DocxPackageErrorCode,
  DocxPartGraph,
  DocxRelationshipIndex,
  DocxRelationshipRecord,
  DocxStyleIndex,
  DocxStyleRecord,
  DocxWarning,
  ExportDocxOptions,
  ImportDocxOptions,
  InspectDocxPackageResult
} from './types.js'
import type { DocxErrorCode } from './diagnostics.js'
import {
  readChildVal,
  readChildValue,
  readElementText,
  readOptionalAttribute,
  readPositiveNumber
} from './package-xml-readers.js'
export {
  readChildVal,
  readChildValue,
  readElementText,
  readOptionalAttribute,
  readPositiveNumber
} from './package-xml-readers.js'
import {
  createDocxPartGraph,
  readMissingRelationshipWarnings,
  readRelationshipTargetTraversalWarnings
} from './package-part-graph.js'
import {
  type XmlElementNode,
  parseXml,
  readXmlAttribute,
  readXmlChildren,
  readXmlElementsByLocalName
} from './xml.js'

const DOCX_MAX_PART_COUNT = 2000
const DOCX_MAX_TOTAL_UNCOMPRESSED_BYTES = 256 * 1024 * 1024
const DOCX_MAX_PART_UNCOMPRESSED_BYTES = 64 * 1024 * 1024
const DOCX_MAX_TEXT_PART_UNCOMPRESSED_BYTES = 16 * 1024 * 1024

interface JsZipInternalData {
  readonly uncompressedSize?: unknown
}

interface JsZipObjectWithInternalData {
  readonly _data?: JsZipInternalData
}

export interface DocxHeaderFooterSourceIdIndex {
  readonly headers: ReadonlyMap<string, readonly string[]>
  readonly footers: ReadonlyMap<string, readonly string[]>
}

/** 只检查 DOCX package graph，不写入 JWord 文档。 */
export async function inspectDocxPackage(
  input: DocxBinaryInput,
  options: ImportDocxOptions = {}
): Promise<InspectDocxPackageResult> {
  assertDocxNotCancelled(options)
  assertJWordFeatureEntitled(options.license, 'docx.import')

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
  assertJWordFeatureEntitled(options.license, 'docx.import')

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
export function assertDocxNotCancelled(options: ImportDocxOptions | ExportDocxOptions): void {
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

export interface DocxRelationship {
  readonly id: string
  readonly kind: string
  readonly type: string
  readonly target: string
  readonly targetMode?: string
}

export interface DocxPackageContext {
  readonly requestId?: string
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
export async function readDocxPackageContext(
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

  const contentTypes = readContentTypes(await readPartText(zip, '[Content_Types].xml', requestId), parts)
  assertDocxNotCancelled(options)

  const rootRelationships = await readRelationships(zip, '_rels/.rels', requestId)
  assertDocxNotCancelled(options)

  const mainDocumentPart = rootRelationships.find((relationship) =>
    relationship.type.endsWith('/officeDocument')
  )?.target

  if (mainDocumentPart === undefined || !parts.includes(mainDocumentPart)) {
    throw new DocxPackageError('DOCX_MAIN_DOCUMENT_MISSING', requestId)
  }

  const documentRelsPart = readRelationshipPartPath(mainDocumentPart)
  const documentRelationships = parts.includes(documentRelsPart)
    ? await readRelationships(zip, documentRelsPart, requestId)
    : []
  assertDocxNotCancelled(options)

  const missingRelationshipWarnings = readMissingRelationshipWarnings(
    documentRelsPart,
    documentRelationships,
    parts,
    mainDocumentPart
  )
  const traversalRelationshipWarnings = readRelationshipTargetTraversalWarnings(
    documentRelsPart,
    documentRelationships,
    mainDocumentPart
  )
  const opaque = await readPackageOpaquePreservation(
    zip,
    parts,
    contentTypes,
    rootRelationships,
    mainDocumentPart,
    documentRelsPart,
    documentRelationships,
    requestId
  )
  assertDocxNotCancelled(options)

  const warnings = [
    ...traversalRelationshipWarnings,
    ...missingRelationshipWarnings,
    ...readUnsupportedRelationshipWarnings(documentRelsPart, opaque.unsupportedRelationships),
    ...readUnsupportedPartWarnings(opaque.unsupportedParts)
  ]

  return {
    ...(requestId === undefined ? {} : { requestId }),
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
    const zip = await JSZip.loadAsync(input)

    assertZipResourceLimits(zip, requestId)

    return zip
  } catch (error) {
    if (error instanceof DocxPackageError) {
      throw error
    }

    throw new DocxPackageError('DOCX_PACKAGE_INVALID', requestId)
  }
}

/** 校验 zip 目录声明的资源上限，避免读取不可信 DOCX 时放大内存。 */
function assertZipResourceLimits(zip: JSZip, requestId?: string): void {
  const files = Object.values(zip.files).filter((file) => !file.dir)

  if (files.length > DOCX_MAX_PART_COUNT) {
    throw new DocxPackageError('DOCX_PACKAGE_RESOURCE_LIMIT_EXCEEDED', requestId)
  }

  let totalUncompressedSize = 0
  for (const file of files) {
    const uncompressedSize = readZipUncompressedSize(file)

    if (uncompressedSize > DOCX_MAX_PART_UNCOMPRESSED_BYTES) {
      throw new DocxPackageError('DOCX_PACKAGE_RESOURCE_LIMIT_EXCEEDED', requestId)
    }

    totalUncompressedSize += uncompressedSize
    if (totalUncompressedSize > DOCX_MAX_TOTAL_UNCOMPRESSED_BYTES) {
      throw new DocxPackageError('DOCX_PACKAGE_RESOURCE_LIMIT_EXCEEDED', requestId)
    }
  }
}

/** 从 JSZip 内部中央目录数据读取未解压大小。 */
function readZipUncompressedSize(file: JSZip.JSZipObject): number {
  const internalData = (file as JSZip.JSZipObject & JsZipObjectWithInternalData)._data
  const size = internalData?.uncompressedSize

  return typeof size === 'number' && Number.isFinite(size) ? size : 0
}

/** 校验即将读取的 part 大小，避免 XML/二进制 part 局部放大。 */
function assertPartReadLimit(
  file: JSZip.JSZipObject,
  limit: number,
  requestId?: string
): void {
  if (readZipUncompressedSize(file) > limit) {
    throw new DocxPackageError('DOCX_PACKAGE_RESOURCE_LIMIT_EXCEEDED', requestId)
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
async function readRelationships(
  zip: JSZip,
  part: string,
  requestId?: string
): Promise<readonly DocxRelationship[]> {
  const document = parseXml(await readPartText(zip, part, requestId))

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
  documentRelationships: readonly DocxRelationship[],
  requestId?: string
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
    readOpaquePart(zip, part, contentTypes.get(part), requestId)
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
  contentType: string | undefined,
  requestId?: string
): Promise<DocxOpaqueUnsupportedPart> {
  const base = {
    part,
    ...(contentType === undefined ? {} : { contentType }),
    unsafeToPreserveAfterEdit: true
  }

  return isTextOpaquePart(part, contentType)
    ? {
      ...base,
      text: await readPartText(zip, part, requestId)
    }
    : {
      ...base,
      bytes: Array.from(await readPartBytes(zip, part, requestId))
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
export async function createDocxIndexesFromContext(
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

  const document = parseXml(await readPartText(context.zip, stylesPart, context.requestId))
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

  const document = parseXml(await readPartText(context.zip, numberingPart, context.requestId))
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

/** 建立 media index，保留 Uint8Array 以避免大图导入时放大内存。 */
async function buildMediaIndex(
  context: DocxPackageContext,
  images: readonly DocxImageRelationshipRecord[]
): Promise<DocxMediaIndex> {
  const items = await Promise.all(images.map(async (image) => ({
    targetPart: image.targetPart,
    mimeType: image.mimeType,
    extension: image.extension,
    bytes: await readPartBytes(context.zip, image.targetPart, context.requestId)
  })))

  return { items }
}

/** 建立 comments index 的最小可消费结构。 */
async function buildCommentsIndex(context: DocxPackageContext): Promise<DocxCommentsIndex> {
  const commentsPart = createDocxPartGraph(context.mainDocumentPart, context.documentRelationships).comments[0]
  if (commentsPart === undefined || !context.parts.includes(commentsPart)) {
    return { comments: [], warnings: [] }
  }

  const document = parseXml(await readPartText(context.zip, commentsPart, context.requestId))
  const warnings: DocxWarning[] = []
  const comments = readXmlElementsByLocalName(document.root, 'comment').flatMap((comment, index) => {
    const commentId = readXmlAttribute(comment, 'w:id')

    if (commentId === undefined) {
      warnings.push({
        code: 'DOCX_COMMENT_ID_MISSING',
        severity: 'warning',
        part: commentsPart,
        path: `${commentsPart}/comment-${index + 1}`,
        message: 'DOCX comment is missing w:id and will be skipped.',
        fallback: 'skip-comment',
        recoverable: true
      })
      return []
    }

    return [{
      ...createDocxImportCommentId(commentId),
      author: readXmlAttribute(comment, 'w:author') ?? '',
      ...readOptionalAttribute(comment, 'w:date', 'date'),
      text: readXmlElementsByLocalName(comment, 't')
        .map(readElementText)
        .join('')
    }]
  })

  return {
    comments,
    warnings
  }
}

/** 建立页眉页脚 part 到 core source id 的最小映射。 */
export async function buildHeaderFooterSourceIdIndex(
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
      readHeaderFooterSourceIdsFromRoot(parseXml(await readPartText(context.zip, part, context.requestId)).root, role)
    ] as const
  }))

  return new Map(entries)
}

/** 按当前 core source id 语义读取页眉页脚文本和页码。 */
export function readHeaderFooterSourceIdsFromRoot(
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
export function readHeaderFooterSourceIds(
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
export function readUnsupportedNumberingFormatWarnings(numbering: DocxNumberingIndex): readonly DocxWarning[] {
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
export async function readPartText(zip: JSZip, part: string, requestId?: string): Promise<string> {
  const file = zip.file(part)

  if (file === null || file === undefined) {
    return ''
  }
  assertPartReadLimit(file, DOCX_MAX_TEXT_PART_UNCOMPRESSED_BYTES, requestId)

  return file.async('text')
}

/** 读取 part 二进制。 */
export async function readPartBytes(zip: JSZip, part: string, requestId?: string): Promise<Uint8Array> {
  const file = zip.file(part)

  if (file === null || file === undefined) {
    return new Uint8Array()
  }
  assertPartReadLimit(file, DOCX_MAX_PART_UNCOMPRESSED_BYTES, requestId)

  return file.async('uint8array')
}
