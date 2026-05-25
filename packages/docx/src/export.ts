/**
 * 职责：生成 Gate 5 第一版 DOCX Transitional OPC package。
 * 边界：只写 package graph、T1 文本/段落/run 格式、列表、基础表格和 inline data URL 图片。
 * 协作模块：index.ts 的 exportDocx 入口、inspectDocxPackage 和后续 roundtrip diff 复用本模块输出。
 * 性能/安全约束：不访问 DOM，不读取磁盘，不引入 Node-only API，media 只消费 projection 中已内联的 data URL。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#iteration-18---实现-t1-docx-export列表表格图片。
 */

import type {
  Block,
  DocumentProjection,
  ImageInline,
  Paragraph,
  Resource,
  Run,
  Section,
  Table,
  TableBorder,
  TableCell,
  TableRow
} from '@4xian/jword-core'
import JSZip from 'jszip'

import type {
  DocxOpaquePreservation,
  DocxOpaqueUnsupportedPart,
  DocxOpaqueUnsupportedRelationship,
  DocxWarning,
  ExportDocxOptions,
  ExportDocxResult
} from './index'

const PACKAGE_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships'
const CONTENT_TYPES_NS = 'http://schemas.openxmlformats.org/package/2006/content-types'
const CORE_PROPERTIES_REL = 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties'
const OFFICE_REL_BASE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const OFFICE_DOCUMENT_REL = `${OFFICE_REL_BASE}/officeDocument`
const EXTENDED_PROPERTIES_REL = `${OFFICE_REL_BASE}/extended-properties`
const STYLES_REL = `${OFFICE_REL_BASE}/styles`
const NUMBERING_REL = `${OFFICE_REL_BASE}/numbering`
const IMAGE_REL = `${OFFICE_REL_BASE}/image`
const HYPERLINK_REL = `${OFFICE_REL_BASE}/hyperlink`
const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const WORD_DRAWING_NS = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'
const DRAWING_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const PICTURE_NS = 'http://schemas.openxmlformats.org/drawingml/2006/picture'
const DOCX_ZIP_ENTRY_DATE = new Date('1980-01-01T00:00:00Z')

interface ExportMediaItem {
  readonly resourceId: string
  readonly sequence: number
  readonly relationshipId: string
  readonly part: string
  readonly target: string
  readonly mimeType: string
  readonly extension: string
  readonly bytes: Uint8Array
}

interface ExportNumberingDefinition {
  readonly numberingId: string
  readonly abstractNumberingId: string
  readonly maxLevel: number
}

interface ExportHyperlinkItem {
  readonly target: string
  readonly relationshipId: string
}

interface ExportParagraphNumbering {
  readonly numberingId: string
  readonly level: number
}

interface ExportContext {
  readonly mediaByResourceId: ReadonlyMap<string, ExportMediaItem>
  readonly hyperlinksByTarget: ReadonlyMap<string, ExportHyperlinkItem>
  readonly numberingDefinitions: readonly ExportNumberingDefinition[]
  readonly characterStyleIds: readonly string[]
  readonly opaqueParts: readonly DocxOpaqueUnsupportedPart[]
  readonly opaqueRelationships: readonly DocxOpaqueUnsupportedRelationship[]
  readonly warnings: readonly DocxWarning[]
}

/** 构建最小 DOCX package 并返回二进制。 */
export async function buildExportDocxPackage(
  projection: DocumentProjection,
  options: ExportDocxOptions
): Promise<ExportDocxResult> {
  assertExportNotCancelled(options)

  const zip = new JSZip()
  const mediaItems = collectExportMediaItems(projection.document.resources ?? [])
  const context = createExportContext(projection, mediaItems, options.opaque)

  assertExportNotCancelled(options)

  writeZipFile(zip, '[Content_Types].xml', writeContentTypesXml(mediaItems, context.opaqueParts))
  writeZipFile(zip, '_rels/.rels', writeRootRelationshipsXml())
  writeZipFile(zip, 'docProps/core.xml', writeCorePropertiesXml())
  writeZipFile(zip, 'docProps/app.xml', writeAppPropertiesXml())
  writeZipFile(zip, 'word/document.xml', writeDocumentXml(projection, context))
  writeZipFile(zip, 'word/_rels/document.xml.rels', writeDocumentRelationshipsXml(mediaItems, context))
  writeZipFile(zip, 'word/styles.xml', writeStylesXml(context.characterStyleIds))
  writeZipFile(zip, 'word/numbering.xml', writeNumberingXml(context.numberingDefinitions))

  for (const item of mediaItems) {
    assertExportNotCancelled(options)

    writeZipFile(zip, item.part, item.bytes)
  }

  for (const part of context.opaqueParts) {
    assertExportNotCancelled(options)

    writeZipFile(zip, part.part, readOpaquePartContent(part))
  }

  assertExportNotCancelled(options)

  const bytes = await zip.generateAsync({ type: 'arraybuffer' })
  const warnings = [
    ...collectExportUnsupportedWarnings(projection),
    ...context.warnings
  ]

  assertExportNotCancelled(options)

  return {
    bytes,
    warnings,
    diagnostics: {
      ...(options.requestId === undefined ? {} : { requestId: options.requestId }),
      mainDocumentPart: 'word/document.xml'
    }
  }
}

/** 写入固定元数据的 ZIP entry，避免相同投影导出出不同哈希。 */
function writeZipFile(zip: JSZip, path: string, data: string | Uint8Array): void {
  zip.file(path, data, {
    date: DOCX_ZIP_ENTRY_DATE,
    createFolders: false
  })
}

/** 检查 DOCX 导出任务是否已被取消。 */
function assertExportNotCancelled(options: ExportDocxOptions): void {
  if (options.signal?.aborted !== true) {
    return
  }

  throw createDocxExportCancelledError(options.requestId)
}

/** 创建 DOCX 导出取消错误。 */
function createDocxExportCancelledError(requestId?: string): Error & {
  readonly name: 'DocxUnsupportedError'
  readonly code: 'DOCX_USER_CANCELLED'
  readonly requestId?: string
} {
  const error = new Error('用户取消') as Error & {
    name: 'DocxUnsupportedError'
    code: 'DOCX_USER_CANCELLED'
    requestId?: string
  }

  error.name = 'DocxUnsupportedError'
  error.code = 'DOCX_USER_CANCELLED'

  if (requestId !== undefined) {
    error.requestId = requestId
  }

  return error
}

/** 创建正文写入时共享的导出上下文。 */
function createExportContext(
  projection: DocumentProjection,
  mediaItems: readonly ExportMediaItem[],
  opaque: DocxOpaquePreservation | undefined
): ExportContext {
  const opaqueParts = readSafeOpaqueParts(opaque)

  return {
    mediaByResourceId: new Map(mediaItems.map((item) => [item.resourceId, item])),
    hyperlinksByTarget: collectExportHyperlinksByTarget(projection),
    numberingDefinitions: collectExportNumberingDefinitions(projection),
    characterStyleIds: collectExportCharacterStyleIds(projection),
    opaqueParts,
    opaqueRelationships: readSafeOpaqueRelationships(opaque, opaqueParts),
    warnings: collectOpaquePreserveSkippedWarnings(opaque)
  }
}

/** 读取编辑后仍可安全原样写回的 opaque part。 */
function readSafeOpaqueParts(
  opaque: DocxOpaquePreservation | undefined
): readonly DocxOpaqueUnsupportedPart[] {
  return opaque?.unsupportedParts.filter((part) => part.unsafeToPreserveAfterEdit === false) ?? []
}

/** 读取目标 part 也会写回的安全 opaque relationship。 */
function readSafeOpaqueRelationships(
  opaque: DocxOpaquePreservation | undefined,
  opaqueParts: readonly DocxOpaqueUnsupportedPart[]
): readonly DocxOpaqueUnsupportedRelationship[] {
  const preservedParts = new Set(opaqueParts.map((part) => part.part))

  return opaque?.unsupportedRelationships.filter((relationship) =>
    relationship.unsafeToPreserveAfterEdit === false &&
    relationship.sourcePart === 'word/document.xml' &&
    (relationship.targetMode === 'External' || preservedParts.has(relationship.target))
  ) ?? []
}

/** 为被跳过的 unsafe opaque 记录生成导出 warning。 */
function collectOpaquePreserveSkippedWarnings(
  opaque: DocxOpaquePreservation | undefined
): readonly DocxWarning[] {
  if (opaque === undefined) {
    return []
  }

  return [
    ...opaque.unsupportedParts.flatMap((part) => part.unsafeToPreserveAfterEdit
      ? [{
        code: 'DOCX_OPAQUE_PART_PRESERVE_SKIPPED' as const,
        severity: 'warning' as const,
        part: part.part,
        message: `DOCX opaque part was not preserved after edit: ${part.part}`,
        fallback: 'omit-unsafe-opaque-part',
        recoverable: true
      }]
      : []
    ),
    ...opaque.unsupportedRelationships.flatMap((relationship) => relationship.unsafeToPreserveAfterEdit
      ? [{
        code: 'DOCX_OPAQUE_RELATIONSHIP_PRESERVE_SKIPPED' as const,
        severity: 'warning' as const,
        part: relationship.sourcePart,
        path: relationship.id,
        message: `DOCX opaque relationship was not preserved after edit: ${relationship.id}`,
        fallback: 'omit-unsafe-opaque-relationship',
        recoverable: true
      }]
      : []
    )
  ]
}

/** 收集当前导出器会省略的 T2 metadata warning。 */
function collectExportUnsupportedWarnings(projection: DocumentProjection): readonly DocxWarning[] {
  const warnings: DocxWarning[] = []

  if (projection.document.sections.some(hasHeaderFooterExportMetadata)) {
    warnings.push({
      code: 'DOCX_HEADER_FOOTER_EXPORT_UNSUPPORTED',
      severity: 'warning',
      part: 'word/document.xml',
      path: 'document.sections.header-footer',
      message: 'DOCX export does not write header/footer content yet',
      fallback: 'omit-header-footer',
      recoverable: true
    })
  }

  if (projection.document.sections.some((section) => section.pageNumbering !== undefined)) {
    warnings.push({
      code: 'DOCX_PAGE_NUMBERING_EXPORT_UNSUPPORTED',
      severity: 'warning',
      part: 'word/document.xml',
      path: 'document.sections.page-numbering',
      message: 'DOCX export does not write section page numbering yet',
      fallback: 'omit-page-numbering',
      recoverable: true
    })
  }

  if ((projection.document.comments?.length ?? 0) > 0) {
    warnings.push({
      code: 'DOCX_COMMENTS_EXPORT_UNSUPPORTED',
      severity: 'warning',
      part: 'word/document.xml',
      path: 'document.comments',
      message: 'DOCX export does not write comments yet',
      fallback: 'omit-comments',
      recoverable: true
    })
  }

  if ((projection.document.revisions?.length ?? 0) > 0) {
    warnings.push({
      code: 'DOCX_REVISIONS_EXPORT_UNSUPPORTED',
      severity: 'warning',
      part: 'word/document.xml',
      path: 'document.revisions',
      message: 'DOCX export does not write revision metadata yet',
      fallback: 'omit-revisions',
      recoverable: true
    })
  }

  return warnings
}

/** 判断 section 是否包含当前 DOCX export 尚未写出的页眉页脚 metadata。 */
function hasHeaderFooterExportMetadata(section: Section): boolean {
  return (section.headerIds?.length ?? 0) > 0 ||
    (section.footerIds?.length ?? 0) > 0 ||
    section.headerFooterSameAsPrevious !== undefined
}

/** 收集正文中出现的 external hyperlink 目标。 */
function collectExportHyperlinksByTarget(projection: DocumentProjection): ReadonlyMap<string, ExportHyperlinkItem> {
  const hyperlinks = new Map<string, ExportHyperlinkItem>()

  for (const paragraph of projection.document.sections.flatMap((section) =>
    section.blocks.flatMap(readBlockParagraphs)
  )) {
    for (const run of paragraph.runs) {
      const target = run.link?.target

      if (target === undefined || target.length === 0 || hyperlinks.has(target)) {
        continue
      }

      hyperlinks.set(target, {
        target,
        relationshipId: `rIdHyperlink${hyperlinks.size + 1}`
      })
    }
  }

  return hyperlinks
}

/** 读取 projection 里可直接写入 package 的 data URL 图片资源。 */
function collectExportMediaItems(resources: readonly Resource[]): readonly ExportMediaItem[] {
  const items: ExportMediaItem[] = []

  for (const resource of resources) {
    const extension = readImageExtension(resource.mime)
    if (resource.status !== 'success' || resource.source.kind !== 'dataUrl' || extension === undefined) {
      continue
    }

    const sequence = items.length + 1
    const part = `word/media/image${sequence}.${extension}`

    items.push({
      resourceId: resource.id,
      sequence,
      relationshipId: `rIdImage${sequence}`,
      part,
      target: `media/image${sequence}.${extension}`,
      mimeType: resource.mime,
      extension,
      bytes: readDataUrlBytes(resource.source.url)
    })
  }

  return items
}

/** 收集文档中出现过的列表定义。 */
function collectExportNumberingDefinitions(projection: DocumentProjection): readonly ExportNumberingDefinition[] {
  const definitions = new Map<string, ExportNumberingDefinition>()

  for (const paragraph of projection.document.sections.flatMap((section) =>
    section.blocks.flatMap(readBlockParagraphs)
  )) {
    const numbering = readParagraphNumbering(paragraph)

    if (numbering === undefined) {
      continue
    }

    const existing = definitions.get(numbering.numberingId)
    definitions.set(numbering.numberingId, {
      numberingId: numbering.numberingId,
      abstractNumberingId: existing?.abstractNumberingId ?? String(definitions.size + 1),
      maxLevel: Math.max(existing?.maxLevel ?? 0, numbering.level)
    })
  }

  return [...definitions.values()]
}

/** 收集导出正文中直接引用的 character style。 */
function collectExportCharacterStyleIds(projection: DocumentProjection): readonly string[] {
  const styleIds = new Set<string>()

  for (const paragraph of projection.document.sections.flatMap((section) =>
    section.blocks.flatMap(readBlockParagraphs)
  )) {
    for (const run of paragraph.runs) {
      const styleId = readStringProperty(run.properties, 'styleId')

      if (styleId !== undefined && styleId.length > 0) {
        styleIds.add(styleId)
      }
    }
  }

  return [...styleIds]
}

/** 读取 image MIME 对应的 DOCX media 扩展名。 */
function readImageExtension(mimeType: string): string | undefined {
  if (mimeType === 'image/png') {
    return 'png'
  }

  if (mimeType === 'image/jpeg') {
    return 'jpg'
  }

  return undefined
}

/** 从 base64 data URL 读取二进制。 */
function readDataUrlBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.includes(',') ? dataUrl.slice(dataUrl.indexOf(',') + 1) : dataUrl
  const binary = globalThis.atob(base64)
  const bytes = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  return bytes
}

/** 读取 safe opaque part 的原始内容。 */
function readOpaquePartContent(part: DocxOpaqueUnsupportedPart): string | Uint8Array {
  if (part.text !== undefined) {
    return part.text
  }

  return new Uint8Array(part.bytes ?? [])
}

/** 写 OPC content types。 */
function writeContentTypesXml(
  mediaItems: readonly ExportMediaItem[],
  opaqueParts: readonly DocxOpaqueUnsupportedPart[]
): string {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    `<Types xmlns="${CONTENT_TYPES_NS}">`,
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>',
    '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>',
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>',
    '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>',
    ...mediaItems.map((item) => `<Override PartName="/${item.part}" ContentType="${escapeXmlAttribute(item.mimeType)}"/>`),
    ...opaqueParts.flatMap(writeOpaquePartContentTypeXml),
    '</Types>'
  ].join('')
}

/** 写 safe opaque part 的 content type override。 */
function writeOpaquePartContentTypeXml(part: DocxOpaqueUnsupportedPart): readonly string[] {
  return part.contentType === undefined
    ? []
    : [`<Override PartName="/${escapeXmlAttribute(part.part)}" ContentType="${escapeXmlAttribute(part.contentType)}"/>`]
}

/** 写 package 根 relationships。 */
function writeRootRelationshipsXml(): string {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    `<Relationships xmlns="${PACKAGE_REL_NS}">`,
    `<Relationship Id="rIdOfficeDocument" Type="${OFFICE_DOCUMENT_REL}" Target="word/document.xml"/>`,
    `<Relationship Id="rIdCoreProperties" Type="${CORE_PROPERTIES_REL}" Target="docProps/core.xml"/>`,
    `<Relationship Id="rIdExtendedProperties" Type="${EXTENDED_PROPERTIES_REL}" Target="docProps/app.xml"/>`,
    '</Relationships>'
  ].join('')
}

/** 写主文档 relationships。 */
function writeDocumentRelationshipsXml(
  mediaItems: readonly ExportMediaItem[],
  context: ExportContext
): string {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    `<Relationships xmlns="${PACKAGE_REL_NS}">`,
    `<Relationship Id="rIdStyles" Type="${STYLES_REL}" Target="styles.xml"/>`,
    `<Relationship Id="rIdNumbering" Type="${NUMBERING_REL}" Target="numbering.xml"/>`,
    ...mediaItems.map((item) => `<Relationship Id="${item.relationshipId}" Type="${IMAGE_REL}" Target="${item.target}"/>`),
    ...[...context.hyperlinksByTarget.values()].map((item) =>
      `<Relationship Id="${item.relationshipId}" Type="${HYPERLINK_REL}" Target="${escapeXmlAttribute(item.target)}" TargetMode="External"/>`
    ),
    ...context.opaqueRelationships.map(writeOpaqueRelationshipXml),
    '</Relationships>'
  ].join('')
}

/** 写 safe opaque relationship。 */
function writeOpaqueRelationshipXml(relationship: DocxOpaqueUnsupportedRelationship): string {
  return [
    `<Relationship Id="${escapeXmlAttribute(relationship.id)}"`,
    ` Type="${escapeXmlAttribute(relationship.type ?? `${OFFICE_REL_BASE}/${relationship.kind}`)}"`,
    ` Target="${escapeXmlAttribute(readDocumentRelationshipTarget(relationship))}"`,
    relationship.targetMode === undefined ? '' : ` TargetMode="${escapeXmlAttribute(relationship.targetMode)}"`,
    '/>'
  ].join('')
}

/** 把 package part 路径转换成 word/document.xml.rels 中的 Target。 */
function readDocumentRelationshipTarget(relationship: DocxOpaqueUnsupportedRelationship): string {
  if (relationship.targetMode === 'External') {
    return relationship.target
  }

  return relationship.target.startsWith('word/')
    ? relationship.target.slice('word/'.length)
    : `../${relationship.target}`
}

/** 写正文 XML。 */
function writeDocumentXml(projection: DocumentProjection, context: ExportContext): string {
  const blocks = projection.document.sections.flatMap((section) => section.blocks)
  const bodyXml = blocks.length === 0
    ? '<w:p/>'
    : blocks.map((block) => writeBlockXml(block, context)).join('')
  const sectionPropertiesXml = writeSectionPropertiesXml(
    projection.document.sections[projection.document.sections.length - 1]
  )

  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    `<w:document xmlns:w="${WORD_NS}" xmlns:r="${REL_NS}">`,
    `<w:body>${bodyXml}${sectionPropertiesXml}</w:body>`,
    '</w:document>'
  ].join('')
}

/** 写正文末尾 section properties。 */
function writeSectionPropertiesXml(section: Section | undefined): string {
  const page = section?.page
  const children = [
    writePageSizeXml(page),
    writePageMarginsXml(page?.marginTwips)
  ].filter((child) => child.length > 0).join('')

  return children.length === 0 ? '<w:sectPr/>' : `<w:sectPr>${children}</w:sectPr>`
}

/** 写 section 页面尺寸 XML。 */
function writePageSizeXml(page: Section['page'] | undefined): string {
  if (page?.widthTwips === undefined && page?.heightTwips === undefined) {
    return ''
  }

  return `<w:pgSz${page.widthTwips === undefined ? '' : ` w:w="${Math.round(page.widthTwips)}"`}${page.heightTwips === undefined ? '' : ` w:h="${Math.round(page.heightTwips)}"`}/>`
}

/** 写 section 页边距 XML。 */
function writePageMarginsXml(margins: NonNullable<Section['page']>['marginTwips'] | undefined): string {
  if (margins === undefined) {
    return ''
  }

  return [
    '<w:pgMar',
    typeof margins.top === 'number' ? ` w:top="${Math.round(margins.top)}"` : '',
    typeof margins.right === 'number' ? ` w:right="${Math.round(margins.right)}"` : '',
    typeof margins.bottom === 'number' ? ` w:bottom="${Math.round(margins.bottom)}"` : '',
    typeof margins.left === 'number' ? ` w:left="${Math.round(margins.left)}"` : '',
    '/>'
  ].join('')
}

/** 写 block XML。 */
function writeBlockXml(block: Block, context: ExportContext): string {
  if (block.kind === 'paragraph') {
    return writeParagraphXml(block, context)
  }

  return writeTableXml(block, context)
}

/** 从 block 中递归读取段落，用于列表定义收集。 */
function readBlockParagraphs(block: Block): readonly Paragraph[] {
  if (block.kind === 'paragraph') {
    return [block]
  }

  return block.rows.flatMap((row) =>
    row.cells.flatMap((cell) => cell.blocks.flatMap(readBlockParagraphs))
  )
}

/** 写段落 XML。 */
function writeParagraphXml(paragraph: Paragraph, context: ExportContext): string {
  const runs = paragraph.runs.length === 0
    ? '<w:r/>'
    : paragraph.runs.map((run) => writeRunXml(run, context)).join('')

  return `<w:p>${writeParagraphPropertiesXml(paragraph)}${runs}</w:p>`
}

/** 写 run XML。 */
function writeRunXml(run: Run, context: ExportContext): string {
  const inlineXml = run.inlines.flatMap((inline) => readInlineXml(inline, context)).join('')
  const runXml = `<w:r>${writeRunPropertiesXml(run)}${inlineXml}</w:r>`
  const hyperlink = run.link === undefined ? undefined : context.hyperlinksByTarget.get(run.link.target)

  return hyperlink === undefined
    ? runXml
    : `<w:hyperlink r:id="${hyperlink.relationshipId}">${runXml}</w:hyperlink>`
}

/** 写段落属性 XML。 */
function writeParagraphPropertiesXml(paragraph: Paragraph): string {
  const properties = paragraph.properties
  const children = [
    paragraph.styleId === undefined ? '' : `<w:pStyle w:val="${escapeXmlAttribute(paragraph.styleId)}"/>`,
    writeParagraphNumberingXml(paragraph),
    readStringProperty(properties, 'alignment') === undefined ? '' : `<w:jc w:val="${escapeXmlAttribute(readStringProperty(properties, 'alignment')!)}"/>`,
    writeParagraphSpacingXml(paragraph),
    writeParagraphIndentXml(properties)
  ].filter((child) => child.length > 0).join('')

  return children.length === 0 ? '' : `<w:pPr>${children}</w:pPr>`
}

/** 写段落编号 XML。 */
function writeParagraphNumberingXml(paragraph: Paragraph): string {
  const numbering = readParagraphNumbering(paragraph)

  if (numbering === undefined) {
    return ''
  }

  return [
    '<w:numPr>',
    `<w:ilvl w:val="${numbering.level}"/>`,
    `<w:numId w:val="${escapeXmlAttribute(numbering.numberingId)}"/>`,
    '</w:numPr>'
  ].join('')
}

/** 读取段落编号快照。 */
function readParagraphNumbering(paragraph: Paragraph): ExportParagraphNumbering | undefined {
  if (
    paragraph.list !== undefined &&
    paragraph.list.numberingId.length > 0 &&
    Number.isFinite(paragraph.list.level)
  ) {
    return {
      numberingId: paragraph.list.numberingId,
      level: Math.max(0, Math.round(paragraph.list.level))
    }
  }

  const numberingId = readStringProperty(paragraph.properties, 'listNumberingId')
  const level = readNumberProperty(paragraph.properties, 'listLevel')

  if (numberingId === undefined || numberingId.length === 0 || level === undefined) {
    return undefined
  }

  return {
    numberingId,
    level: Math.max(0, Math.round(level))
  }
}

/** 写段落间距 XML。 */
function writeParagraphSpacingXml(paragraph: Paragraph): string {
  const properties = paragraph.properties
  const before = readNumberProperty(properties, 'spacingBeforeTwips')
  const after = readNumberProperty(properties, 'spacingAfterTwips')
  const lineHeight = readParagraphLineHeight(paragraph)

  if (before === undefined && after === undefined && lineHeight === undefined) {
    return ''
  }

  return [
    '<w:spacing',
    before === undefined ? '' : ` w:before="${before}"`,
    after === undefined ? '' : ` w:after="${after}"`,
    lineHeight === undefined ? '' : ` w:line="${Math.round(lineHeight * 240)}" w:lineRule="auto"`,
    '/>'
  ].join('')
}

/** 读取段落内第一份显式行距。 */
function readParagraphLineHeight(paragraph: Paragraph): number | undefined {
  for (const run of paragraph.runs) {
    const lineHeight = readNumberProperty(run.properties, 'lineHeight')

    if (lineHeight !== undefined && lineHeight > 0) {
      return lineHeight
    }
  }

  return undefined
}

/** 写段落缩进 XML。 */
function writeParagraphIndentXml(properties: Paragraph['properties']): string {
  const left = readNumberProperty(properties, 'indentLeftTwips')
  const firstLine = readNumberProperty(properties, 'firstLineIndentTwips')
  const hanging = readNumberProperty(properties, 'hangingIndentTwips')

  if (left === undefined && firstLine === undefined && hanging === undefined) {
    return ''
  }

  return `<w:ind${left === undefined ? '' : ` w:left="${left}"`}${firstLine === undefined ? '' : ` w:firstLine="${firstLine}"`}${hanging === undefined ? '' : ` w:hanging="${hanging}"`}/>`
}

/** 写 run 属性 XML。 */
function writeRunPropertiesXml(run: Run): string {
  const properties = run.properties
  const children = [
    writeRunStyleXml(properties),
    readBooleanProperty(properties, 'bold') ? '<w:b/>' : '',
    readBooleanProperty(properties, 'italic') ? '<w:i/>' : '',
    readBooleanProperty(properties, 'underline') ? '<w:u/>' : '',
    readBooleanProperty(properties, 'strike') ? '<w:strike/>' : '',
    writeRunFontFamilyXml(properties),
    writeRunFontSizeXml(properties),
    readRunColorXml(properties),
    writeRunBackgroundColorXml(properties),
    writeRunVerticalAlignXml(properties)
  ].filter((child) => child.length > 0).join('')

  return children.length === 0 ? '' : `<w:rPr>${children}</w:rPr>`
}

/** 写 run character style 引用。 */
function writeRunStyleXml(properties: Run['properties']): string {
  const styleId = readStringProperty(properties, 'styleId')

  return styleId === undefined || styleId.length === 0
    ? ''
    : `<w:rStyle w:val="${escapeXmlAttribute(styleId)}"/>`
}

/** 写 run 字体 XML。 */
function writeRunFontFamilyXml(properties: Run['properties']): string {
  const fontFamily = readStringProperty(properties, 'fontFamily')

  if (fontFamily === undefined || fontFamily.length === 0) {
    return ''
  }

  const value = escapeXmlAttribute(fontFamily)

  return `<w:rFonts w:ascii="${value}" w:hAnsi="${value}" w:eastAsia="${value}" w:cs="${value}"/>`
}

/** 写 run 字号 XML。 */
function writeRunFontSizeXml(properties: Run['properties']): string {
  const fontSizeTwips = readNumberProperty(properties, 'fontSizeTwips')

  if (fontSizeTwips === undefined || fontSizeTwips <= 0) {
    return ''
  }

  return `<w:sz w:val="${Math.max(1, Math.round(fontSizeTwips / 10))}"/>`
}

/** 写 run 文本颜色 XML。 */
function readRunColorXml(properties: Run['properties']): string {
  const color = readStringProperty(properties, 'color')
  const value = color?.startsWith('#') === true ? color.slice(1) : color

  return value === undefined ? '' : `<w:color w:val="${escapeXmlAttribute(value.toUpperCase())}"/>`
}

/** 写 run 背景色 XML。 */
function writeRunBackgroundColorXml(properties: Run['properties']): string {
  const backgroundColor = readStringProperty(properties, 'backgroundColor')
  const value = backgroundColor?.startsWith('#') === true ? backgroundColor.slice(1) : backgroundColor

  return value === undefined ? '' : `<w:shd w:fill="${escapeXmlAttribute(value.toUpperCase())}"/>`
}

/** 写 run 上下标 XML。 */
function writeRunVerticalAlignXml(properties: Run['properties']): string {
  if (readBooleanProperty(properties, 'superscript')) {
    return '<w:vertAlign w:val="superscript"/>'
  }

  if (readBooleanProperty(properties, 'subscript')) {
    return '<w:vertAlign w:val="subscript"/>'
  }

  return ''
}

/** 写单个 inline XML。 */
function readInlineXml(inline: Run['inlines'][number], context: ExportContext): readonly string[] {
  if (inline.kind === 'text') {
    return splitTextInlineXml(inline.text)
  }

  if (inline.kind === 'break') {
    return [`<w:br${inline.breakType === 'line' ? '' : ` w:type="${inline.breakType}"`}/>`]
  }

  if (inline.kind === 'image') {
    return writeImageInlineXml(inline, context)
  }

  return []
}

/** 写 inline image DrawingML。 */
function writeImageInlineXml(inline: ImageInline, context: ExportContext): readonly string[] {
  const mediaItem = context.mediaByResourceId.get(inline.resourceId)

  if (mediaItem === undefined) {
    return []
  }

  const widthTwips = readPositiveTwips(inline.widthTwips) ?? 1440
  const heightTwips = readPositiveTwips(inline.heightTwips) ?? 1440
  const cx = twipsToEmu(widthTwips)
  const cy = twipsToEmu(heightTwips)
  const name = `Picture ${mediaItem.sequence}`
  const description = inline.alt === undefined ? '' : ` descr="${escapeXmlAttribute(inline.alt)}"`

  return [[
    '<w:drawing>',
    `<wp:inline xmlns:wp="${WORD_DRAWING_NS}" distT="0" distB="0" distL="0" distR="0">`,
    `<wp:extent cx="${cx}" cy="${cy}"/>`,
    `<wp:docPr id="${mediaItem.sequence}" name="${escapeXmlAttribute(name)}"${description}/>`,
    '<wp:cNvGraphicFramePr/>',
    `<a:graphic xmlns:a="${DRAWING_NS}">`,
    '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">',
    `<pic:pic xmlns:pic="${PICTURE_NS}">`,
    '<pic:nvPicPr>',
    `<pic:cNvPr id="${mediaItem.sequence}" name="${escapeXmlAttribute(name)}"/>`,
    '<pic:cNvPicPr/>',
    '</pic:nvPicPr>',
    '<pic:blipFill>',
    `<a:blip r:embed="${mediaItem.relationshipId}"/>`,
    '<a:stretch><a:fillRect/></a:stretch>',
    '</pic:blipFill>',
    '<pic:spPr>',
    `<a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>`,
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>',
    '</pic:spPr>',
    '</pic:pic>',
    '</a:graphicData>',
    '</a:graphic>',
    '</wp:inline>',
    '</w:drawing>'
  ].join('')]
}

/** 写基础表格 XML。 */
function writeTableXml(table: Table, context: ExportContext): string {
  const rows = table.rows.map((row) => writeTableRowXml(row, context)).join('')

  return `<w:tbl>${writeTablePropertiesXml(table)}${writeTableGridXml(table.grid)}${rows}</w:tbl>`
}

/** 写表格属性 XML。 */
function writeTablePropertiesXml(table: Table): string {
  const border = readTableBorderSnapshot(table.border, table.properties)
  const children = [
    writeTableBordersXml(border, 'tblBorders')
  ].filter((child) => child.length > 0).join('')

  return children.length === 0 ? '' : `<w:tblPr>${children}</w:tblPr>`
}

/** 写表格列宽网格 XML。 */
function writeTableGridXml(grid: readonly number[] | undefined): string {
  const columns = grid
    ?.filter((width) => Number.isFinite(width) && width > 0)
    .map((width) => `<w:gridCol w:w="${Math.round(width)}"/>`)

  if (columns === undefined || columns.length === 0) {
    return ''
  }

  return `<w:tblGrid>${columns.join('')}</w:tblGrid>`
}

/** 写表格行 XML。 */
function writeTableRowXml(row: TableRow, context: ExportContext): string {
  return `<w:tr>${row.cells.map((cell) => writeTableCellXml(cell, context)).join('')}</w:tr>`
}

/** 写表格单元格 XML。 */
function writeTableCellXml(cell: TableCell, context: ExportContext): string {
  const blocks = cell.blocks.length === 0
    ? '<w:p/>'
    : cell.blocks.map((block) => writeBlockXml(block, context)).join('')

  return `<w:tc>${writeTableCellPropertiesXml(cell)}${blocks}</w:tc>`
}

/** 写表格单元格属性 XML。 */
function writeTableCellPropertiesXml(cell: TableCell): string {
  const children = [
    writeTableCellGridSpanXml(cell.gridSpan),
    writeTableBordersXml(readTableBorderSnapshot(cell.border, cell.properties), 'tcBorders')
  ].filter((child) => child.length > 0).join('')

  return children.length === 0 ? '' : `<w:tcPr>${children}</w:tcPr>`
}

/** 写表格单元格横向 span XML。 */
function writeTableCellGridSpanXml(gridSpan: number | undefined): string {
  if (gridSpan === undefined || !Number.isFinite(gridSpan) || gridSpan <= 1) {
    return ''
  }

  return `<w:gridSpan w:val="${Math.round(gridSpan)}"/>`
}

/** 写表格边框 XML。 */
function writeTableBordersXml(border: TableBorder | undefined, elementName: 'tblBorders' | 'tcBorders'): string {
  if (border === undefined) {
    return ''
  }

  const color = readBorderColor(border)
  const size = readBorderSize(border)
  const attributes = ` w:val="single"${size === undefined ? '' : ` w:sz="${size}"`}${color === undefined ? '' : ` w:color="${color}"`}`
  const sides = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']

  return `<w:${elementName}>${sides.map((side) => `<w:${side}${attributes}/>`).join('')}</w:${elementName}>`
}

/** 读取表格边框快照。 */
function readTableBorderSnapshot(
  border: TableBorder | undefined,
  properties: Readonly<Record<string, unknown>> | undefined
): TableBorder | undefined {
  if (border !== undefined) {
    return border
  }

  const value = properties?.border

  if (!isRecord(value)) {
    return undefined
  }

  const color = typeof value.color === 'string' ? value.color : undefined
  const widthTwips = typeof value.widthTwips === 'number' && Number.isFinite(value.widthTwips)
    ? value.widthTwips
    : undefined

  if (color === undefined && widthTwips === undefined) {
    return undefined
  }

  return {
    ...(color === undefined ? {} : { color }),
    ...(widthTwips === undefined ? {} : { widthTwips })
  }
}

/** 读取边框颜色属性。 */
function readBorderColor(border: TableBorder): string | undefined {
  const color = border.color?.startsWith('#') === true ? border.color.slice(1) : border.color

  return color === undefined || color.length === 0 ? undefined : escapeXmlAttribute(color.toUpperCase())
}

/** 读取 OOXML 八分之一点边框宽度。 */
function readBorderSize(border: TableBorder): number | undefined {
  if (border.widthTwips === undefined || !Number.isFinite(border.widthTwips) || border.widthTwips <= 0) {
    return undefined
  }

  return Math.max(1, Math.round(border.widthTwips * 2 / 5))
}

/** 读取正数 twips。 */
function readPositiveTwips(value: number | undefined): number | undefined {
  return value === undefined || !Number.isFinite(value) || value <= 0 ? undefined : Math.round(value)
}

/** 把 twips 换算成 DrawingML EMU。 */
function twipsToEmu(twips: number): number {
  return Math.max(1, Math.round(twips * 635))
}

/** 按 tab 拆分文本 inline，避免把制表符写成普通文本。 */
function splitTextInlineXml(text: string): readonly string[] {
  return text.split(/(\t)/u).flatMap((part) => {
    if (part === '') {
      return []
    }

    return part === '\t' ? ['<w:tab/>'] : [writeTextXml(part)]
  })
}

/** 写文本节点 XML，并在需要时保留空格语义。 */
function writeTextXml(text: string): string {
  const preserveSpace = /^\s|\s$|\s{2,}/u.test(text)

  return `<w:t${preserveSpace ? ' xml:space="preserve"' : ''}>${escapeXmlText(text)}</w:t>`
}

/** 写最小 styles part。 */
function writeStylesXml(characterStyleIds: readonly string[]): string {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    `<w:styles xmlns:w="${WORD_NS}">`,
    writeParagraphStyleXml('Normal', 'Normal', true),
    writeParagraphStyleXml('Heading1', 'Heading 1', false),
    writeParagraphStyleXml('Heading2', 'Heading 2', false),
    writeParagraphStyleXml('Heading3', 'Heading 3', false),
    ...characterStyleIds.map((styleId) => writeCharacterStyleXml(styleId)),
    '</w:styles>'
  ].join('')
}

/** 写基础段落 style 定义。 */
function writeParagraphStyleXml(styleId: string, name: string, defaultStyle: boolean): string {
  return [
    `<w:style w:type="paragraph"${defaultStyle ? ' w:default="1"' : ''} w:styleId="${escapeXmlAttribute(styleId)}">`,
    `<w:name w:val="${escapeXmlAttribute(name)}"/>`,
    styleId === 'Normal' ? '' : '<w:basedOn w:val="Normal"/>',
    '</w:style>'
  ].join('')
}

/** 写基础 character style 定义。 */
function writeCharacterStyleXml(styleId: string): string {
  return [
    `<w:style w:type="character" w:styleId="${escapeXmlAttribute(styleId)}">`,
    `<w:name w:val="${escapeXmlAttribute(styleId)}"/>`,
    '</w:style>'
  ].join('')
}

/** 写 numbering part。 */
function writeNumberingXml(definitions: readonly ExportNumberingDefinition[]): string {
  if (definitions.length === 0) {
    return [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      `<w:numbering xmlns:w="${WORD_NS}"/>`
    ].join('')
  }

  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    `<w:numbering xmlns:w="${WORD_NS}">`,
    ...definitions.map(writeNumberingDefinitionXml),
    ...definitions.map(writeNumberingInstanceXml),
    '</w:numbering>'
  ].join('')
}

/** 写一个 abstract numbering 定义。 */
function writeNumberingDefinitionXml(definition: ExportNumberingDefinition): string {
  const levels = Array.from({ length: definition.maxLevel + 1 }, (_, level) => writeNumberingLevelXml(level))

  return [
    `<w:abstractNum w:abstractNumId="${escapeXmlAttribute(definition.abstractNumberingId)}">`,
    ...levels,
    '</w:abstractNum>'
  ].join('')
}

/** 写一个 numbering level。 */
function writeNumberingLevelXml(level: number): string {
  return [
    `<w:lvl w:ilvl="${level}">`,
    '<w:start w:val="1"/>',
    '<w:numFmt w:val="decimal"/>',
    `<w:lvlText w:val="%${level + 1}."/>`,
    '</w:lvl>'
  ].join('')
}

/** 写一个 numbering instance。 */
function writeNumberingInstanceXml(definition: ExportNumberingDefinition): string {
  return [
    `<w:num w:numId="${escapeXmlAttribute(definition.numberingId)}">`,
    `<w:abstractNumId w:val="${escapeXmlAttribute(definition.abstractNumberingId)}"/>`,
    '</w:num>'
  ].join('')
}

/** 写最小 core properties。 */
function writeCorePropertiesXml(): string {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ',
    'xmlns:dc="http://purl.org/dc/elements/1.1/" ',
    'xmlns:dcterms="http://purl.org/dc/terms/" ',
    'xmlns:dcmitype="http://purl.org/dc/dcmitype/" ',
    'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
    '<dc:creator>JWord</dc:creator>',
    '<cp:lastModifiedBy>JWord</cp:lastModifiedBy>',
    '</cp:coreProperties>'
  ].join('')
}

/** 写最小 extended app properties。 */
function writeAppPropertiesXml(): string {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" ',
    'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">',
    '<Application>JWord</Application>',
    '</Properties>'
  ].join('')
}

/** 转义 XML 文本节点。 */
function escapeXmlText(value: string): string {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
}

/** 转义 XML 属性值。 */
function escapeXmlAttribute(value: string): string {
  return escapeXmlText(value).replace(/"/gu, '&quot;')
}

/** 判断值是否为对象记录。 */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null
}

/** 读取字符串属性。 */
function readStringProperty(properties: Readonly<Record<string, unknown>> | undefined, key: string): string | undefined {
  const value = properties?.[key]

  return typeof value === 'string' ? value : undefined
}

/** 读取数字属性。 */
function readNumberProperty(properties: Readonly<Record<string, unknown>> | undefined, key: string): number | undefined {
  const value = properties?.[key]

  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** 读取布尔属性。 */
function readBooleanProperty(properties: Readonly<Record<string, unknown>> | undefined, key: string): boolean {
  return properties?.[key] === true
}
