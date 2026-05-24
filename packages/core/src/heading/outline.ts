/**
 * 职责：基于 Heading 1-3 段落语义生成稳定标题结构与目录 anchor。
 * 边界：只读取 projection 并创建 RangeRef 快照，不访问 DOM、不滚动页面、不写文档状态。
 * 协作模块：Editor facade 提供 projection、TextAnchor 和 RangeRef 快照能力。
 * 性能/安全约束：保持轻量同步遍历，不缓存 projection 副本，目录目标不用字符 offset 持久化。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md Step 4.11。
 */

import { createSelectionState } from '../model/selection'
import { resolveParagraphStyleId } from '../layout/paragraph-semantics'
import type { Block, Paragraph, Run, Section } from '../model/types'
import type { Editor } from '../editor/types'
import type { TextRange } from '../operations/transaction'
import type { TextRangeRecord } from '../model/position'

export interface HeadingOutlineItem {
  readonly id: string
  readonly title: string
  readonly level: 1 | 2 | 3
  readonly sectionId: string
  readonly blockId: string
  readonly anchorRange: TextRangeRecord
}

/**
 * 从当前 editor projection 生成 Heading 1-3 目录项。
 */
export function buildHeadingOutline(editor: Editor): readonly HeadingOutlineItem[] {
  const items: HeadingOutlineItem[] = []

  for (const section of editor.getProjection().document.sections) {
    collectHeadingItemsFromBlocks(editor, section, section.blocks, items)
  }

  return Object.freeze(items)
}

/**
 * 定位目录项当前对应的文本范围，供 UI 点击后滚动或设置选区。
 */
export function locateHeadingOutlineItem(editor: Editor, item: HeadingOutlineItem): TextRange | null {
  return editor.locateRangeSnapshot(item.anchorRange)
}

/**
 * 从块列表中递归收集标题目录项。
 */
function collectHeadingItemsFromBlocks(
  editor: Editor,
  section: Section,
  blocks: readonly Block[],
  items: HeadingOutlineItem[]
): void {
  for (const block of blocks) {
    if (block.kind === 'paragraph') {
      appendHeadingItem(editor, section, block, items)
      continue
    }

    for (const row of block.rows) {
      for (const cell of row.cells) {
        collectHeadingItemsFromBlocks(editor, section, cell.blocks, items)
      }
    }
  }
}

/**
 * 在段落是 Heading 1-3 时追加目录项。
 */
function appendHeadingItem(
  editor: Editor,
  section: Section,
  paragraph: Paragraph,
  items: HeadingOutlineItem[]
): void {
  const level = resolveHeadingLevel(resolveParagraphStyleId(paragraph))

  if (level === null) {
    return
  }

  const firstTextRun = findFirstTextRun(paragraph)

  if (firstTextRun === undefined) {
    return
  }

  const title = readParagraphText(paragraph).trim()

  if (title.length === 0) {
    return
  }

  const anchor = editor.createTextAnchor({
    sectionId: section.id,
    blockId: paragraph.id,
    runId: firstTextRun.id,
    graphemeIndex: 0,
    assoc: -1
  })
  const range = createSelectionState(anchor, anchor).range

  items.push(Object.freeze({
    id: `${paragraph.id}:heading`,
    title,
    level,
    sectionId: section.id,
    blockId: paragraph.id,
    anchorRange: editor.captureRangeSnapshot(range)
  }))
}

/**
 * 解析 Heading styleId 对应的目录层级。
 */
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

/**
 * 读取段落内第一个可建立文本锚点的 run。
 */
function findFirstTextRun(paragraph: Paragraph): Run | undefined {
  return paragraph.runs.find((run) => run.inlines.some((inline) => inline.kind === 'text'))
}

/**
 * 读取段落内所有文本 inline 的可见标题文本。
 */
function readParagraphText(paragraph: Paragraph): string {
  return paragraph.runs
    .flatMap((run) => run.inlines.flatMap((inline) => inline.kind === 'text' ? [inline.text] : []))
    .join('')
}
