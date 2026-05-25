/**
 * 职责：实现 Gate 5 DOCX roundtrip diff 的最小可测闭环。
 * 边界：只通过公开 import/export 与 core editor facade 运行，不读取磁盘、不访问 DOM、不直接读写 Y.Doc store。
 * 协作模块：index.ts 公开 API、export.ts、core createEditor/loadDocumentModel 和后续 fixture diff。
 * 性能/安全约束：当前只比较 T1 结构快照，不保存原始 JSZip/DOM 节点，不伪装人工兼容验证。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#iteration-19---建立-docx-roundtrip-diff。
 */

import { createEditor } from '@4xian/jword-core'

import type {
  DocxBinaryInput,
  DocxDiagnostics,
  DocxImportBlock,
  DocxImportDocument,
  DocxImportInline,
  DocxImportParagraph,
  DocxImportRun,
  DocxImportSection,
  DocxImportSectionPage,
  DocxImportTable,
  DocxWarning,
  ImportDocxOptions
} from './index'
import { convertDocxImportDocumentToCoreDocument } from './model'

export interface DocxRoundtripDiffOptions extends ImportDocxOptions {}

export interface DocxRoundtripDiffResult {
  readonly matches: boolean
  readonly differences: readonly DocxRoundtripDifference[]
  readonly original: DocxRoundtripSnapshot
  readonly roundtripped: DocxRoundtripSnapshot
  readonly importWarnings: readonly DocxWarning[]
  readonly exportWarnings: readonly DocxWarning[]
  readonly reimportWarnings: readonly DocxWarning[]
  readonly diagnostics: DocxDiagnostics
}

export interface DocxRoundtripDifference {
  readonly path: string
  readonly expected: unknown
  readonly actual: unknown
}

export interface DocxRoundtripSnapshot {
  readonly sectionCount: number
  readonly blockCount: number
  readonly sections: readonly DocxRoundtripSectionSnapshot[]
  readonly paragraphs: readonly DocxRoundtripParagraphSnapshot[]
  readonly tables: readonly DocxRoundtripTableSnapshot[]
  readonly resourceRefs: readonly string[]
}

export interface DocxRoundtripSectionSnapshot {
  readonly breakType?: string
  readonly page?: DocxImportSectionPage
}

export interface DocxRoundtripParagraphSnapshot {
  readonly text: string
  readonly styleId?: string
  readonly properties?: Readonly<Record<string, unknown>>
  readonly listNumberingId?: string
  readonly listLevel?: number
  readonly runProperties: readonly Readonly<Record<string, unknown>>[]
  readonly images: readonly DocxRoundtripImageSnapshot[]
}

export interface DocxRoundtripImageSnapshot {
  readonly resourceId: string
  readonly alt?: string
  readonly widthTwips?: number
  readonly heightTwips?: number
}

export interface DocxRoundtripTableSnapshot {
  readonly grid?: readonly number[]
  readonly rows: readonly DocxRoundtripTableRowSnapshot[]
}

export interface DocxRoundtripTableRowSnapshot {
  readonly cells: readonly DocxRoundtripTableCellSnapshot[]
}

export interface DocxRoundtripTableCellSnapshot {
  readonly text: string
  readonly gridSpan?: number
}

/** 执行 DOCX import -> JWord 写入 -> export -> reimport -> T1 snapshot diff。 */
export async function diffDocxRoundtrip(
  input: DocxBinaryInput,
  options: DocxRoundtripDiffOptions = {}
): Promise<DocxRoundtripDiffResult> {
  const { exportDocx, importDocx } = await import('./index')
  const importResult = await importDocx(input, options)
  const editor = createEditor()

  try {
    const projection = editor.loadDocumentModel({
      document: convertDocxImportDocumentToCoreDocument(importResult.document)
    })
    const exportResult = await exportDocx(projection, options)
    const reimportResult = await importDocx(exportResult.bytes, options)
    const original = createImportSnapshot(importResult.document)
    const roundtripped = createImportSnapshot(reimportResult.document)
    const differences = diffJsonValue('', original, roundtripped)
    const mainDocumentPart = reimportResult.diagnostics.mainDocumentPart

    return {
      matches: differences.length === 0,
      differences,
      original,
      roundtripped,
      importWarnings: importResult.warnings,
      exportWarnings: exportResult.warnings,
      reimportWarnings: reimportResult.warnings,
      diagnostics: {
        ...(options.requestId === undefined ? {} : { requestId: options.requestId }),
        ...(mainDocumentPart === undefined ? {} : { mainDocumentPart })
      }
    }
  } finally {
    editor.destroy()
  }
}

/** 为 DOCX import middle model 创建 T1 diff snapshot。 */
function createImportSnapshot(document: DocxImportDocument): DocxRoundtripSnapshot {
  const blocks = document.sections.flatMap((section) => section.blocks)

  return {
    sectionCount: document.sections.length,
    blockCount: blocks.length,
    sections: document.sections.map(createImportSectionSnapshot),
    paragraphs: document.sections.flatMap((section) =>
      section.blocks.flatMap(readImportBlockParagraphSnapshots)
    ),
    tables: blocks.flatMap((block) => block.kind === 'table' ? [createImportTableSnapshot(block)] : []),
    resourceRefs: document.resources.map((resource) => resource.resourceId)
  }
}

/** 创建 section setup snapshot。 */
function createImportSectionSnapshot(section: DocxImportSection): DocxRoundtripSectionSnapshot {
  return {
    ...(section.breakType === undefined ? {} : { breakType: section.breakType }),
    ...(section.page === undefined ? {} : { page: section.page })
  }
}

/** 递归读取 block 内的段落 snapshot。 */
function readImportBlockParagraphSnapshots(block: DocxImportBlock): readonly DocxRoundtripParagraphSnapshot[] {
  if (block.kind === 'paragraph') {
    return [createImportParagraphSnapshot(block)]
  }

  return block.rows.flatMap((row) =>
    row.cells.flatMap((cell) => cell.blocks.flatMap(readImportBlockParagraphSnapshots))
  )
}

/** 创建段落 snapshot。 */
function createImportParagraphSnapshot(paragraph: DocxImportParagraph): DocxRoundtripParagraphSnapshot {
  const listNumberingId = readStringProperty(paragraph.properties, 'listNumberingId')
  const listLevel = readNumberProperty(paragraph.properties, 'listLevel')

  return {
    text: paragraph.runs.map(readRunText).join(''),
    ...(paragraph.styleId === undefined ? {} : { styleId: paragraph.styleId }),
    ...(paragraph.properties === undefined ? {} : { properties: paragraph.properties }),
    ...(listNumberingId === undefined ? {} : { listNumberingId }),
    ...(listLevel === undefined ? {} : { listLevel }),
    runProperties: paragraph.runs.map((run) => run.properties ?? {}),
    images: paragraph.runs.flatMap((run) => run.inlines.flatMap(readImageSnapshot))
  }
}

/** 创建表格 snapshot。 */
function createImportTableSnapshot(table: DocxImportTable): DocxRoundtripTableSnapshot {
  return {
    ...(table.grid === undefined ? {} : { grid: table.grid }),
    rows: table.rows.map((row) => ({
      cells: row.cells.map((cell) => ({
        text: cell.blocks.flatMap(readImportBlockParagraphSnapshots).map((paragraph) => paragraph.text).join(''),
        ...(cell.gridSpan === undefined ? {} : { gridSpan: cell.gridSpan })
      }))
    }))
  }
}

/** 读取 run 纯文本。 */
function readRunText(run: DocxImportRun): string {
  return run.inlines.map((inline) => {
    if (inline.kind === 'text') {
      return inline.text
    }

    if (inline.kind === 'break') {
      return '\n'
    }

    return ''
  }).join('')
}

/** 读取图片 snapshot。 */
function readImageSnapshot(inline: DocxImportInline): readonly DocxRoundtripImageSnapshot[] {
  if (inline.kind !== 'image') {
    return []
  }

  return [{
    resourceId: inline.resourceId,
    ...(inline.alt === undefined ? {} : { alt: inline.alt }),
    ...(inline.widthTwips === undefined ? {} : { widthTwips: inline.widthTwips }),
    ...(inline.heightTwips === undefined ? {} : { heightTwips: inline.heightTwips })
  }]
}

/** 对 JSON-compatible snapshot 做稳定递归 diff。 */
function diffJsonValue(path: string, expected: unknown, actual: unknown): readonly DocxRoundtripDifference[] {
  if (Object.is(expected, actual)) {
    return []
  }

  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual)) {
      return [{ path, expected, actual }]
    }

    return diffArray(path, expected, actual)
  }

  if (isRecord(expected) || isRecord(actual)) {
    if (!isRecord(expected) || !isRecord(actual)) {
      return [{ path, expected, actual }]
    }

    return diffRecord(path, expected, actual)
  }

  return [{ path, expected, actual }]
}

/** 对数组做逐项 diff。 */
function diffArray(path: string, expected: readonly unknown[], actual: readonly unknown[]): readonly DocxRoundtripDifference[] {
  const differences: DocxRoundtripDifference[] = []
  const length = Math.max(expected.length, actual.length)

  for (let index = 0; index < length; index += 1) {
    differences.push(...diffJsonValue(`${path}[${index}]`, expected[index], actual[index]))
  }

  return differences
}

/** 对对象记录做逐字段 diff。 */
function diffRecord(
  path: string,
  expected: Readonly<Record<string, unknown>>,
  actual: Readonly<Record<string, unknown>>
): readonly DocxRoundtripDifference[] {
  const differences: DocxRoundtripDifference[] = []
  const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort()

  for (const key of keys) {
    differences.push(...diffJsonValue(path.length === 0 ? key : `${path}.${key}`, expected[key], actual[key]))
  }

  return differences
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

/** 判断值是否为对象记录。 */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
