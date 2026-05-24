/**
 * 职责：提供 Gate 4 基础查找替换的稳定范围快照与 transaction command 构造。
 * 边界：只处理 projection 文本扫描和 Command 生成，不直接改 projection、不访问 DOM。
 * 协作模块：Editor facade 提供 TextAnchor、RangeRef 快照、snapshot 定位和 executeCommand。
 * 性能/安全约束：结果位置保存 TextRangeRecord；替换写入只通过 deleteRange/insertText operation。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md Step 4.12。
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

export interface ReplaceAllMatchesResult {
  readonly replacedCount: number
  readonly commandNames: readonly string[]
}

/**
 * 在当前 editor projection 中查找文本，结果用稳定 range 快照保存位置。
 */
export function findTextMatches(editor: Editor, query: string): readonly FindTextMatch[] {
  const normalizedQuery = query.trim()

  if (normalizedQuery.length === 0) {
    return []
  }

  const matches: FindTextMatch[] = []

  for (const section of editor.getProjection().document.sections) {
    collectMatchesFromBlocks(editor, section, section.blocks, normalizedQuery, matches)
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
  replacement: string
): ReplaceAllMatchesResult {
  const matches = [...findTextMatches(editor, query)].reverse()
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
  query: string,
  matches: FindTextMatch[]
): void {
  for (const block of blocks) {
    if (block.kind === 'paragraph') {
      collectMatchesFromParagraph(editor, section, block, query, matches)
      continue
    }

    for (const row of block.rows) {
      for (const cell of row.cells) {
        collectMatchesFromBlocks(editor, section, cell.blocks, query, matches)
      }
    }
  }
}

/**
 * 从段落 run 内收集同一 run 的基础文本匹配结果。
 */
function collectMatchesFromParagraph(
  editor: Editor,
  section: Section,
  paragraph: Paragraph,
  query: string,
  matches: FindTextMatch[]
): void {
  for (const run of paragraph.runs) {
    collectMatchesFromRun(editor, section, paragraph, run, query, matches)
  }
}

/**
 * 从单个 run 的文本 inline 中收集匹配结果。
 */
function collectMatchesFromRun(
  editor: Editor,
  section: Section,
  paragraph: Paragraph,
  run: Run,
  query: string,
  matches: FindTextMatch[]
): void {
  const text = run.inlines.flatMap((inline) => inline.kind === 'text' ? [inline.text] : []).join('')
  const textGraphemes = splitGraphemes(text)
  const queryGraphemes = splitGraphemes(query)

  if (queryGraphemes.length === 0 || textGraphemes.length < queryGraphemes.length) {
    return
  }

  for (let index = 0; index <= textGraphemes.length - queryGraphemes.length; index += 1) {
    if (!matchesAt(textGraphemes, queryGraphemes, index)) {
      continue
    }

    matches.push(createFindTextMatch(
      editor,
      section,
      paragraph,
      run,
      query,
      index,
      index + queryGraphemes.length,
      matches.length
    ))
  }
}

/**
 * 创建单个查找结果和对应稳定 range 快照。
 */
function createFindTextMatch(
  editor: Editor,
  section: Section,
  paragraph: Paragraph,
  run: Run,
  query: string,
  startGraphemeIndex: number,
  endGraphemeIndex: number,
  index: number
): FindTextMatch {
  const anchor = editor.createTextAnchor({
    sectionId: section.id,
    blockId: paragraph.id,
    runId: run.id,
    graphemeIndex: startGraphemeIndex,
    assoc: 1
  })
  const focus = editor.createTextAnchor({
    sectionId: section.id,
    blockId: paragraph.id,
    runId: run.id,
    graphemeIndex: endGraphemeIndex,
    assoc: 1
  })
  const range = createSelectionState(anchor, focus).range

  return Object.freeze({
    id: `${paragraph.id}:${run.id}:${startGraphemeIndex}:${index}`,
    text: query,
    sectionId: section.id,
    blockId: paragraph.id,
    runId: run.id,
    startGraphemeIndex,
    endGraphemeIndex,
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
  textGraphemes: readonly string[],
  queryGraphemes: readonly string[],
  startIndex: number
): boolean {
  return queryGraphemes.every((grapheme, offset) => textGraphemes[startIndex + offset] === grapheme)
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
