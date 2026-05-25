/**
 * 职责：把 DOCX import 中间模型转换为 core 可加载的 canonical 文档模型。
 * 边界：只做纯数据映射，不读取/写入 Y.Doc，不触发 editor 事务，不访问 DOM。
 * 协作模块：importDocx、roundtrip diff、examples/docx 和 core editor.loadDocumentModel。
 * 性能/安全约束：返回 JSON-compatible 数据，不保留 JSZip、XML 节点或可写内部对象引用。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#iteration-25---建立-examplesdocx-手动验收入口。
 */

import type {
  Block,
  Comment,
  Document,
  ImageInline,
  Paragraph,
  ParagraphList,
  Resource,
  Run,
  Table,
  TableCell
} from '@4xian/jword-core'

import type {
  DocxImportBlock,
  DocxImportDocument,
  DocxImportInline,
  DocxImportParagraph,
  DocxImportResource,
  DocxImportRun,
  DocxImportTable,
  DocxImportTableCell
} from './index'

/** 把 DOCX import 中间模型转换为 core editor 可加载的文档模型。 */
export function convertDocxImportDocumentToCoreDocument(document: DocxImportDocument): Document {
  const resources = document.resources.map(convertDocxImportResource)
  const sections = document.sections.map((section) => ({
    kind: 'section' as const,
    id: section.id,
    ...(section.breakType === undefined ? {} : { breakType: section.breakType }),
    ...(section.page === undefined ? {} : { page: section.page }),
    ...(section.columns === undefined ? {} : { columns: section.columns }),
    ...(section.headerIds.length === 0 ? {} : { headerIds: section.headerIds }),
    ...(section.footerIds.length === 0 ? {} : { footerIds: section.footerIds }),
    ...(section.headerFooterSameAsPrevious === undefined ? {} : { headerFooterSameAsPrevious: section.headerFooterSameAsPrevious }),
    ...(section.pageNumbering === undefined ? {} : { pageNumbering: section.pageNumbering }),
    blocks: section.blocks.map(convertDocxImportBlock)
  }))

  return {
    kind: 'document',
    id: 'document-docx-import',
    styleIds: document.metadata.styleIds,
    resourceIds: resources.map((resource) => resource.id),
    resources,
    sections,
    ...readCoreComments(document, 'document-docx-import')
  }
}

/** 转换 DOCX resource 为 core resource。 */
function convertDocxImportResource(resource: DocxImportResource): Resource {
  return {
    kind: 'resource',
    id: resource.resourceId,
    mime: resource.mimeType,
    source: {
      kind: 'dataUrl',
      url: `data:${resource.mimeType};base64,${bytesToBase64(resource.bytes)}`
    },
    status: 'success'
  }
}

/** 转换 DOCX block 为 core block。 */
function convertDocxImportBlock(block: DocxImportBlock): Block {
  if (block.kind === 'paragraph') {
    return convertDocxImportParagraph(block)
  }

  return convertDocxImportTable(block)
}

/** 转换 DOCX paragraph 为 core paragraph。 */
function convertDocxImportParagraph(paragraph: DocxImportParagraph): Paragraph {
  const properties = readParagraphProperties(paragraph)
  const list = readParagraphList(properties)

  return {
    kind: 'paragraph',
    id: paragraph.id,
    ...(paragraph.styleId === undefined ? {} : { styleId: paragraph.styleId }),
    ...(properties === undefined ? {} : { properties }),
    ...(list === undefined ? {} : { list }),
    ...(paragraph.tabs === undefined ? {} : { tabs: paragraph.tabs }),
    runs: paragraph.runs.map(convertDocxImportRun)
  }
}

/** 合并段落样式和属性，保证 core projection 能读到 style/list 语义。 */
function readParagraphProperties(paragraph: DocxImportParagraph): Readonly<Record<string, unknown>> | undefined {
  const properties = {
    ...(paragraph.properties ?? {}),
    ...(paragraph.styleId === undefined ? {} : { styleId: paragraph.styleId })
  }

  return Object.keys(properties).length === 0 ? undefined : properties
}

/** 从段落属性读取 core list 快照。 */
function readParagraphList(properties: Readonly<Record<string, unknown>> | undefined): ParagraphList | undefined {
  const numberingId = properties?.listNumberingId
  const level = properties?.listLevel

  return typeof numberingId === 'string' && typeof level === 'number'
    ? { numberingId, level }
    : undefined
}

/** 转换 DOCX run 为 core run。 */
function convertDocxImportRun(run: DocxImportRun): Run {
  return {
    kind: 'run',
    id: run.id,
    ...(run.properties === undefined ? {} : { properties: run.properties }),
    ...(run.field === undefined ? {} : { field: run.field }),
    ...(run.link === undefined ? {} : { link: run.link }),
    ...(run.revisionId === undefined ? {} : { revisionId: run.revisionId }),
    inlines: run.inlines.map(convertDocxImportInline)
  }
}

/** 转换 DOCX inline 为 core inline。 */
function convertDocxImportInline(inline: DocxImportInline): Run['inlines'][number] {
  if (inline.kind === 'break') {
    return {
      kind: 'break',
      breakType: inline.breakType
    }
  }

  if (inline.kind === 'commentRangeMarker') {
    return {
      kind: 'commentRangeMarker',
      commentId: inline.commentId,
      edge: inline.edge
    }
  }

  if (inline.kind === 'bookmark') {
    return {
      kind: 'bookmark',
      id: inline.id,
      name: inline.name,
      edge: inline.edge
    }
  }

  if (inline.kind === 'image') {
    return convertDocxImportImageInline(inline)
  }

  return {
    kind: 'text',
    text: inline.text
  }
}

/** 转换 DOCX image inline 为 core image inline。 */
function convertDocxImportImageInline(inline: Extract<DocxImportInline, { readonly kind: 'image' }>): ImageInline {
  return {
    kind: 'image',
    resourceId: inline.resourceId,
    ...(inline.alt === undefined ? {} : { alt: inline.alt }),
    ...(inline.display === undefined ? {} : { display: inline.display }),
    ...(inline.widthTwips === undefined ? {} : { widthTwips: inline.widthTwips }),
    ...(inline.heightTwips === undefined ? {} : { heightTwips: inline.heightTwips }),
    ...(inline.rotationDegrees === undefined ? {} : { rotationDegrees: inline.rotationDegrees })
  }
}

/** 转换 DOCX table 为 core table。 */
function convertDocxImportTable(table: DocxImportTable): Table {
  return {
    kind: 'table',
    id: table.id,
    ...(table.properties === undefined ? {} : { properties: table.properties }),
    ...(table.grid === undefined ? {} : { grid: table.grid }),
    ...(table.border === undefined ? {} : { border: table.border }),
    rows: table.rows.map((row) => ({
      id: row.id,
      ...(row.properties === undefined ? {} : { properties: row.properties }),
      cells: row.cells.map(convertDocxImportTableCell)
    }))
  }
}

/** 转换 DOCX table cell 为 core table cell。 */
function convertDocxImportTableCell(cell: DocxImportTableCell): TableCell {
  return {
    id: cell.id,
    ...(cell.properties === undefined ? {} : { properties: cell.properties }),
    ...(cell.border === undefined ? {} : { border: cell.border }),
    ...(cell.gridSpan === undefined ? {} : { gridSpan: cell.gridSpan }),
    blocks: cell.blocks.map(convertDocxImportBlock)
  }
}

interface CommentMarkerPosition {
  readonly sectionId: string
  readonly blockId: string
  readonly runId: string
  readonly graphemeIndex: number
}

interface CommentMarkerRange {
  readonly start?: CommentMarkerPosition
  readonly end?: CommentMarkerPosition
}

/** 从 DOCX comments part 和正文 marker 合成 core comment thread。 */
function readCoreComments(document: DocxImportDocument, documentId: string): Pick<Document, 'comments'> {
  if (document.comments.length === 0) {
    return {}
  }

  const ranges = collectCommentMarkerRanges(document)
  const comments = document.comments.flatMap((comment) => {
    const range = ranges.get(comment.id)

    if (range?.start === undefined || range.end === undefined) {
      return []
    }

    const anchorRangeId = `comment-range-docx-${comment.commentId}`
    const createdAt = comment.date ?? ''

    return [{
      kind: 'commentThread',
      id: comment.id,
      authorId: comment.author,
      createdAt,
      anchorRangeId,
      resolved: false,
      rangeSnapshot: {
        id: anchorRangeId,
        anchor: createImportedTextAnchorRecord(documentId, range.start),
        focus: createImportedTextAnchorRecord(documentId, range.end)
      },
      messages: [
        {
          id: `comment-message-docx-${comment.commentId}`,
          authorId: comment.author,
          createdAt,
          anchorRangeId,
          text: comment.text
        }
      ]
    } satisfies Comment]
  })

  return comments.length === 0 ? {} : { comments }
}

/** 收集正文批注 marker 的文本范围。 */
function collectCommentMarkerRanges(document: DocxImportDocument): ReadonlyMap<string, CommentMarkerRange> {
  const ranges = new Map<string, CommentMarkerRange>()

  for (const section of document.sections) {
    for (const block of section.blocks) {
      collectBlockCommentMarkerRanges(section.id, block, ranges)
    }
  }

  return ranges
}

/** 收集单个 block 内的批注 marker。 */
function collectBlockCommentMarkerRanges(
  sectionId: string,
  block: DocxImportBlock,
  ranges: Map<string, CommentMarkerRange>
): void {
  if (block.kind === 'table') {
    for (const row of block.rows) {
      for (const cell of row.cells) {
        for (const child of cell.blocks) {
          collectBlockCommentMarkerRanges(sectionId, child, ranges)
        }
      }
    }
    return
  }

  for (const run of block.runs) {
    let graphemeIndex = 0

    for (const inline of run.inlines) {
      if (inline.kind === 'text') {
        graphemeIndex += [...inline.text].length
        continue
      }

      if (inline.kind !== 'commentRangeMarker') {
        continue
      }

      const previous = ranges.get(inline.commentId) ?? {}
      const position = {
        sectionId,
        blockId: block.id,
        runId: run.id,
        graphemeIndex
      }

      ranges.set(inline.commentId, inline.edge === 'start'
        ? { ...previous, start: position }
        : { ...previous, end: position })
    }
  }
}

/** 创建由导入模型位置描述的 text anchor 快照。 */
function createImportedTextAnchorRecord(
  documentId: string,
  position: CommentMarkerPosition
): Comment['rangeSnapshot']['anchor'] {
  return {
    documentId,
    sectionId: position.sectionId,
    blockId: position.blockId,
    runId: position.runId,
    graphemeIndex: position.graphemeIndex,
    relativePosition: {}
  }
}

/** 把 byte array 编码为 base64 data URL 片段。 */
function bytesToBase64(bytes: readonly number[]): string {
  let binary = ''

  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }

  return globalThis.btoa(binary)
}
