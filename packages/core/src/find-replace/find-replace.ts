/**
 * 职责：提供 Gate 4 基础查找替换的稳定范围快照与 transaction command 构造。
 * 边界：只处理 projection 文本扫描和 Command 生成，不直接改 projection、不访问 DOM。
 * 协作模块：Editor facade 提供 TextAnchor、RangeRef 快照、snapshot 定位和 executeCommand。
 * 性能/安全约束：结果位置保存 TextRangeRecord；替换写入只通过 deleteRange/insertText operation。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import { createSelectionState } from '../model/selection'
import { splitGraphemes } from '../shared/grapheme'
import type { Block, Paragraph, Run, Section } from '../model/types'
import type { Editor } from '../editor/types'
import type { Command, TextPosition } from '../operations/transaction'
import type { TextRangeRecord } from '../model/position'

export interface FindTextMatch {
  readonly id: string
  readonly text: string
  readonly sectionId: string
  readonly blockId: string
  readonly runId: string
  readonly startGraphemeIndex: number
  readonly endGraphemeIndex: number
  readonly rangeSnapshot: TextRangeRecord
}

export interface FindTextOptions {
  readonly caseSensitive?: boolean
}

export interface ReplaceAllMatchesResult {
  readonly replacedCount: number
  readonly commandNames: readonly string[]
}

interface ResolvedFindTextOptions {
  readonly query: string
  readonly queryGraphemes: readonly string[]
  readonly searchQueryGraphemes: readonly string[]
  readonly caseSensitive: boolean
}

interface ParagraphSearchGrapheme {
  readonly grapheme: string
  readonly searchGrapheme: string
  readonly run: Run
  readonly runGraphemeIndex: number
}

/**
 * 在当前 editor projection 中查找文本，结果用稳定 range 快照保存位置。
 */
export function findTextMatches(
  editor: Editor,
  query: string,
  options: FindTextOptions = {}
): readonly FindTextMatch[] {
  const resolvedOptions = resolveFindTextOptions(query, options)

  if (resolvedOptions.query.length === 0) {
    return []
  }

  const matches: FindTextMatch[] = []

  for (const section of editor.getProjection().document.sections) {
    collectMatchesFromBlocks(editor, section, section.blocks, resolvedOptions, matches)
  }

  return Object.freeze(matches)
}

/**
 * 为单个查找结果构造替换命令，调用方必须用 editor.executeCommand 执行。
 */
export function buildReplaceMatchCommand(
  editor: Editor,
  match: FindTextMatch,
  replacement: string
): Command | null {
  const located = editor.locateRangeSnapshot(match.rangeSnapshot)

  if (located === null) {
    return null
  }

  const anchor = normalizeTextPosition(located.anchor)
  const focus = normalizeTextPosition(located.focus)
  const start = readRangeStart(anchor, focus)

  return {
    name: 'replaceTextMatch',
    operations: [
      {
        kind: 'deleteRange',
        range: {
          anchor,
          focus
        }
      },
      {
        kind: 'insertText',
        at: start,
        text: replacement
      }
    ]
  }
}

/**
 * 查找并倒序替换所有当前匹配项，确保每次写入仍走 editor transaction pipeline。
 */
export function replaceAllMatches(
  editor: Editor,
  query: string,
  replacement: string,
  options: FindTextOptions = {}
): ReplaceAllMatchesResult {
  const matches = [...findTextMatches(editor, query, options)].reverse()
  const commandNames: string[] = []

  for (const match of matches) {
    const command = buildReplaceMatchCommand(editor, match, replacement)

    if (command === null) {
      continue
    }

    const result = editor.executeCommand(command)

    commandNames.push(result.commandName)
  }

  return Object.freeze({
    replacedCount: commandNames.length,
    commandNames
  })
}

/**
 * 从块列表递归收集文本匹配结果。
 */
function collectMatchesFromBlocks(
  editor: Editor,
  section: Section,
  blocks: readonly Block[],
  options: ResolvedFindTextOptions,
  matches: FindTextMatch[]
): void {
  for (const block of blocks) {
    if (block.kind === 'paragraph') {
      collectMatchesFromParagraph(editor, section, block, options, matches)
      continue
    }

    for (const row of block.rows) {
      for (const cell of row.cells) {
        collectMatchesFromBlocks(editor, section, cell.blocks, options, matches)
      }
    }
  }
}

/**
 * 从段落聚合文本中收集可跨 run 的匹配结果。
 */
function collectMatchesFromParagraph(
  editor: Editor,
  section: Section,
  paragraph: Paragraph,
  options: ResolvedFindTextOptions,
  matches: FindTextMatch[]
): void {
  const graphemes = collectParagraphSearchGraphemes(paragraph, options.caseSensitive)
  const queryLength = options.searchQueryGraphemes.length

  if (queryLength === 0 || graphemes.length < queryLength) {
    return
  }

  for (let index = 0; index <= graphemes.length - queryLength; index += 1) {
    if (!matchesAt(graphemes, options.searchQueryGraphemes, index)) {
      continue
    }

    const start = graphemes[index]
    const end = resolveParagraphSearchEnd(graphemes, index + queryLength)

    if (start === undefined || end === undefined) {
      continue
    }

    matches.push(createFindTextMatch(
      editor,
      section,
      paragraph,
      start,
      end,
      graphemes.slice(index, index + queryLength).map((entry) => entry.grapheme).join(''),
      matches.length
    ))
  }
}

/**
 * 收集段落内可搜索的文本 grapheme 与 run 边界映射。
 */
function collectParagraphSearchGraphemes(
  paragraph: Paragraph,
  caseSensitive: boolean
): readonly ParagraphSearchGrapheme[] {
  const entries: ParagraphSearchGrapheme[] = []

  for (const run of paragraph.runs) {
    let runGraphemeIndex = 0

    for (const inline of run.inlines) {
      if (inline.kind !== 'text') {
        continue
      }

      for (const grapheme of splitGraphemes(inline.text)) {
        entries.push({
          grapheme,
          searchGrapheme: normalizeSearchGrapheme(grapheme, caseSensitive),
          run,
          runGraphemeIndex
        })
        runGraphemeIndex += 1
      }
    }
  }

  return entries
}

/**
 * 创建单个查找结果和对应稳定 range 快照。
 */
function createFindTextMatch(
  editor: Editor,
  section: Section,
  paragraph: Paragraph,
  start: ParagraphSearchGrapheme,
  end: ParagraphSearchGrapheme,
  text: string,
  index: number
): FindTextMatch {
  const anchor = editor.createTextAnchor({
    sectionId: section.id,
    blockId: paragraph.id,
    runId: start.run.id,
    graphemeIndex: start.runGraphemeIndex,
    assoc: 1
  })
  const focus = editor.createTextAnchor({
    sectionId: section.id,
    blockId: paragraph.id,
    runId: end.run.id,
    graphemeIndex: end.runGraphemeIndex,
    assoc: 1
  })
  const range = createSelectionState(anchor, focus).range

  return Object.freeze({
    id: `${paragraph.id}:${start.run.id}:${start.runGraphemeIndex}:${end.run.id}:${end.runGraphemeIndex}:${index}`,
    text,
    sectionId: section.id,
    blockId: paragraph.id,
    runId: start.run.id,
    startGraphemeIndex: start.runGraphemeIndex,
    endGraphemeIndex: end.runGraphemeIndex,
    rangeSnapshot: editor.captureRangeSnapshot(range)
  })
}

/**
 * 移除定位用 assoc，仅保留 operation 需要的可序列化文本位置。
 */
function normalizeTextPosition(position: TextPosition): TextPosition {
  return {
    sectionId: position.sectionId,
    blockId: position.blockId,
    runId: position.runId,
    graphemeIndex: position.graphemeIndex
  }
}

/**
 * 判断 grapheme 序列在指定下标是否完整匹配查询。
 */
function matchesAt(
  textGraphemes: readonly ParagraphSearchGrapheme[],
  queryGraphemes: readonly string[],
  startIndex: number
): boolean {
  return queryGraphemes.every((grapheme, offset) => textGraphemes[startIndex + offset]?.searchGrapheme === grapheme)
}

/** 解析查找选项并预先计算 query grapheme。 */
function resolveFindTextOptions(query: string, options: FindTextOptions): ResolvedFindTextOptions {
  const normalizedQuery = query.trim()
  const caseSensitive = options.caseSensitive !== false
  const queryGraphemes = splitGraphemes(normalizedQuery)

  return Object.freeze({
    query: normalizedQuery,
    queryGraphemes,
    searchQueryGraphemes: queryGraphemes.map((grapheme) => normalizeSearchGrapheme(grapheme, caseSensitive)),
    caseSensitive
  })
}

/** 归一化单个搜索 grapheme。 */
function normalizeSearchGrapheme(grapheme: string, caseSensitive: boolean): string {
  return caseSensitive ? grapheme : grapheme.toLocaleLowerCase()
}

/** 把段落聚合边界映射回 run 内结束位置。 */
function resolveParagraphSearchEnd(
  graphemes: readonly ParagraphSearchGrapheme[],
  endIndex: number
): ParagraphSearchGrapheme | undefined {
  const next = graphemes[endIndex]

  if (next !== undefined) {
    return next
  }

  const last = graphemes[endIndex - 1]

  if (last === undefined) {
    return undefined
  }

  return {
    grapheme: '',
    searchGrapheme: '',
    run: last.run,
    runGraphemeIndex: last.runGraphemeIndex + 1
  }
}

/**
 * 读取范围内靠前的文本位置，作为删除后插入点。
 */
function readRangeStart(anchor: TextPosition, focus: TextPosition): TextPosition {
  if (anchor.blockId !== focus.blockId || anchor.runId !== focus.runId) {
    return anchor
  }

  return anchor.graphemeIndex <= focus.graphemeIndex ? anchor : focus
}
