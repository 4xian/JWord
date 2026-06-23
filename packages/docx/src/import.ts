/**
 * 职责：把 DOCX package 映射成 JWord 可消费的 JSON-compatible import 中间模型。
 * 边界：只做 OOXML 到中间模型的读取，不写 ZIP，不触发 editor transaction。
 * 协作模块：package.ts 提供 OPC/index，import-readers.ts 提供段落/run/table 属性读取。
 * 性能/安全约束：unsupported 内容通过 warning 和 opaque fragments 表达，不伪装成已支持编辑能力。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#iteration-7---实现-docx-import-中间模型。
 */

import type {
  DocxImportBlock,
  DocxImportCommentRangeMarkerInline,
  DocxImportDocument,
  DocxImportInline,
  DocxImportParagraph,
  DocxImportRun,
  DocxImportRunLink,
  DocxImportSection,
  DocxImportTable,
  DocxImportTableCell,
  DocxImportTableRow,
  DocxOpaqueUnsupportedElementFragment,
  DocxWarning,
  DocxBinaryInput,
  DocxIndexes,
  ImportDocxOptions,
  ImportDocxResult
} from './types.js'
import { assertJWordFeatureEntitled } from '@4xian/jword-license'
import {
  assertDocxNotCancelled,
  buildHeaderFooterSourceIdIndex,
  createDocxIndexesFromContext,
  readHeaderFooterSourceIds,
  readPartText,
  readScopedDocxId,
  readUnsupportedNumberingFormatWarnings,
  readDocxPackageContext,
  type DocxHeaderFooterSourceIdIndex,
  type DocxPackageContext,
  type DocxRelationship
} from './package.js'
import {
  readImportCommentRangeMarker,
  readParagraphLineHeight,
  readParagraphProperties,
  readParagraphStyleId,
  readRunInlines,
  readRunProperties,
  readTableCellGridSpan,
  readTableCellProperties,
  readTableGrid,
  readTableProperties,
  resolveImportParagraphStyleId,
  type DocxImportStyleContext
} from './import-readers.js'
import {
  readSectionProperties,
  type DocxImportSectionProperties
} from './import-sections.js'
import {
  type XmlElementNode,
  parseXml,
  readXmlAttribute,
  readXmlChildren,
  serializeXml
} from './xml.js'

/** 导入 DOCX 二进制并返回 JWord 可控结构化中间模型。 */
export async function importDocx(
  input: DocxBinaryInput,
  options: ImportDocxOptions = {}
): Promise<ImportDocxResult> {
  assertDocxNotCancelled(options)
  assertJWordFeatureEntitled(options.license, 'docx.import')

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
interface DocxImportDocumentResult {
  readonly document: DocxImportDocument
  readonly warnings: readonly DocxWarning[]
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
