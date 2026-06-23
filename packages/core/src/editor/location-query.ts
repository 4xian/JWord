/**
 * 职责：基于只读 projection 执行中立文本位置查询。
 * 边界：只扫描纯数据 projection，不访问 DOM、布局、Y.Doc、provider 或 document-store。
 * 协作模块：location-runtime 提供 selection/comment/range snapshot 入口，本模块提供文本、块和标题查询。
 * 性能/安全约束：返回 JSON 兼容位置结果，不泄漏 AnchorRef、RangeRef、Yjs 相对位置或布局坐标。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md Step 6.22-6.24。
 */

import { resolveParagraphStyleId } from '../layout/paragraph-semantics'
import { splitGraphemes } from '../shared/grapheme'
import type { Block, Paragraph, Run, Section } from '../model/types'
import type { DocumentProjection } from '../model/projection'
import type { EditorLocationQuery, EditorRangeSnapshot, EditorTextLocation, EditorTextQueryResult } from './location-types'

type ProjectionLocationQuery = Extract<EditorLocationQuery, { readonly kind: 'text' | 'block' | 'heading' }>

/**
 * 在 projection 中查找公开文本位置。
 */
export function findProjectionTextLocations(
  projection: DocumentProjection,
  query: ProjectionLocationQuery
): readonly EditorTextQueryResult[] {
  const results: EditorTextQueryResult[] = []

  for (const section of projection.document.sections) {
    collectLocationResultsFromBlocks(section, section.blocks, query, results)
  }

  return Object.freeze(results)
}

/** 从块列表递归收集位置结果。 */
function collectLocationResultsFromBlocks(
  section: Section,
  blocks: readonly Block[],
  query: ProjectionLocationQuery,
  results: EditorTextQueryResult[]
): void {
  for (const block of blocks) {
    if (block.kind === 'paragraph') {
      collectLocationResultsFromParagraph(section, block, query, results)
      continue
    }

    for (const row of block.rows) {
      for (const cell of row.cells) {
        collectLocationResultsFromBlocks(section, cell.blocks, query, results)
      }
    }
  }
}

/** 从段落收集中立位置查询结果。 */
function collectLocationResultsFromParagraph(
  section: Section,
  paragraph: Paragraph,
  query: ProjectionLocationQuery,
  results: EditorTextQueryResult[]
): void {
  if (query.kind === 'block') {
    appendParagraphStartResult(section, paragraph, query.blockId, 'block', results)
    return
  }

  if (query.kind === 'heading') {
    appendHeadingResult(section, paragraph, query, results)
    return
  }

  collectTextResultsFromParagraph(section, paragraph, query, results)
}

/** 为指定块追加段落起点结果。 */
function appendParagraphStartResult(
  section: Section,
  paragraph: Paragraph,
  blockId: string,
  source: EditorTextQueryResult['source'],
  results: EditorTextQueryResult[]
): void {
  if (paragraph.id !== blockId) {
    return
  }

  const firstTextRun = findFirstTextRun(paragraph)

  if (firstTextRun === undefined) {
    return
  }

  const location = createTextLocation(section.id, paragraph.id, firstTextRun.id, 0)

  results.push(createQueryResult(source, location, createCollapsedRange(location), {
    text: readParagraphText(paragraph),
    index: results.length
  }))
}

/** 为符合条件的标题段落追加起点结果。 */
function appendHeadingResult(
  section: Section,
  paragraph: Paragraph,
  query: Extract<EditorLocationQuery, { readonly kind: 'heading' }>,
  results: EditorTextQueryResult[]
): void {
  const level = resolveHeadingLevel(resolveParagraphStyleId(paragraph))

  if (level === null || (query.level !== undefined && query.level !== level)) {
    return
  }

  appendParagraphStartResult(section, paragraph, query.blockId ?? paragraph.id, 'heading', results)
}

/** 从段落各 run 中收集文本匹配结果。 */
function collectTextResultsFromParagraph(
  section: Section,
  paragraph: Paragraph,
  query: Extract<EditorLocationQuery, { readonly kind: 'text' }>,
  results: EditorTextQueryResult[]
): void {
  const queryGraphemes = splitGraphemes(query.text)
  const normalizedQuery = normalizeGraphemes(queryGraphemes, query.caseSensitive)

  if (queryGraphemes.length === 0) {
    return
  }

  for (const run of paragraph.runs) {
    const text = readRunText(run)
    const textGraphemes = splitGraphemes(text)
    const normalizedText = normalizeGraphemes(textGraphemes, query.caseSensitive)

    for (let index = 0; index <= textGraphemes.length - queryGraphemes.length; index += 1) {
      if (!matchesAt(normalizedText, normalizedQuery, index)) {
        continue
      }

      const endIndex = index + queryGraphemes.length
      const anchor = createTextLocation(section.id, paragraph.id, run.id, index)
      const focus = createTextLocation(section.id, paragraph.id, run.id, endIndex)

      results.push(createQueryResult('text', anchor, createRangeSnapshot(anchor, focus), {
        text: textGraphemes.slice(index, endIndex).join(''),
        index: results.length
      }))
    }
  }
}

/** 创建查询结果纯数据。 */
export function createQueryResult(
  source: EditorTextQueryResult['source'],
  location: EditorTextLocation,
  range: EditorRangeSnapshot,
  input: Readonly<{
    text?: string
    index?: number
  }> = {}
): EditorTextQueryResult {
  return Object.freeze({
    kind: 'queryResult',
    source,
    location,
    range,
    ...(input.text === undefined ? {} : { text: input.text }),
    ...(input.index === undefined ? {} : { index: input.index })
  })
}

/** 创建折叠 range 快照。 */
export function createCollapsedRange(location: EditorTextLocation): EditorRangeSnapshot {
  return createRangeSnapshot(location, location)
}

/** 创建公开 range 快照纯数据。 */
export function createRangeSnapshot(
  anchor: EditorTextLocation,
  focus: EditorTextLocation
): EditorRangeSnapshot {
  return Object.freeze({
    kind: 'range',
    anchor,
    focus
  })
}

/** 创建公开文本位置纯数据。 */
export function createTextLocation(
  sectionId: string,
  blockId: string,
  runId: string,
  graphemeIndex: number,
  assoc?: number
): EditorTextLocation {
  return Object.freeze({
    sectionId,
    blockId,
    runId,
    graphemeIndex,
    ...(assoc === undefined ? {} : { assoc })
  })
}

/** 解析 Heading styleId 对应的层级。 */
function resolveHeadingLevel(styleId: string | undefined): 1 | 2 | 3 | null {
  if (styleId === 'Heading1') {
    return 1
  }

  if (styleId === 'Heading2') {
    return 2
  }

  if (styleId === 'Heading3') {
    return 3
  }

  return null
}

/** 读取段落内第一个文本 run。 */
function findFirstTextRun(paragraph: Paragraph): Run | undefined {
  return paragraph.runs.find((run) => run.inlines.some((inline) => inline.kind === 'text'))
}

/** 读取段落纯文本。 */
function readParagraphText(paragraph: Paragraph): string {
  return paragraph.runs.map(readRunText).join('')
}

/** 读取 run 内所有文本 inline。 */
function readRunText(run: Run): string {
  return run.inlines.flatMap((inline) => inline.kind === 'text' ? [inline.text] : []).join('')
}

/** 归一化 grapheme 序列。 */
function normalizeGraphemes(graphemes: readonly string[], caseSensitive: boolean | undefined): readonly string[] {
  if (caseSensitive !== false) {
    return graphemes
  }

  return graphemes.map((grapheme) => grapheme.toLocaleLowerCase())
}

/** 判断 grapheme 序列是否在指定位置匹配。 */
function matchesAt(
  textGraphemes: readonly string[],
  queryGraphemes: readonly string[],
  startIndex: number
): boolean {
  return queryGraphemes.every((grapheme, offset) => textGraphemes[startIndex + offset] === grapheme)
}
