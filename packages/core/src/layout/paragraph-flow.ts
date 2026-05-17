/**
 * 职责：维护 layout engine 的段落、行盒和文本片段流式追加。
 * 边界：只服务纯数据 layout，不读取 projection、不绘制 Canvas、不访问 DOM。
 * 协作模块：engine 负责遍历文档结构，本模块负责段落缩进、对齐、换页和行内盒追加。
 * 性能/安全约束：所有 helper 只修改当前 layout cursor，不保留跨次布局状态。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/03-architecture.md#36-layout-engine。
 */

import { cssPxToTwips } from './page-config'
import {
  assignPageSectionBoundary,
  createInlineObjectPayload,
  createPage,
  freezeLine,
  resolveParagraphPageBreakPolicy
} from './internal'
import type { ResolvedFontStyle } from './font-manager'
import type { Inline, Paragraph, Section } from '../model/types'
import type { PageConfig } from './page-config'
import type { TextPosition } from '../operations/transaction'
import type {
  EmptyTextAnchorBox,
  LayoutCursor,
  MutableLineBox,
  MutablePageBox,
  MutableParagraphBox,
  NonTextInlineBox,
  TextFragment
} from './types'

export function appendNonTextInlineBox(
  inline: Exclude<Inline, { readonly kind: 'text' | 'break' }>,
  sectionId: string,
  blockId: string,
  runId: string,
  graphemeIndex: number,
  cursor: LayoutCursor,
  pageConfig: PageConfig
): void {
  const line = ensureLine(cursor, sectionId, {
    kind: 'paragraph',
    id: blockId,
    runs: []
  }, pageConfig)
  const at = {
    sectionId,
    blockId,
    runId,
    graphemeIndex
  } satisfies TextPosition
  const inlineBox: NonTextInlineBox = Object.freeze({
    kind: 'inlineObject',
    inlineKind: inline.kind,
    payload: createInlineObjectPayload(inline),
    pageIndex: cursor.page.pageIndex,
    sectionId,
    blockId,
    runId,
    at,
    x: cursor.x,
    y: line.y,
    width: 0,
    height: Math.max(line.height, cssPxToTwips(16))
  })

  line.inlines.push(inlineBox)
  line.height = Math.max(line.height, inlineBox.height)
  cursor.x += inlineBox.width
}

/**
 * 为纯空文本段落追加一个零宽锚点，保证空行可见且 caret 可以命中。
 */
export function appendEmptyTextAnchor(input: Readonly<{
  cursor: LayoutCursor
  sectionId: string
  paragraphId: string
  runId: string
  height: number
  baseline: number
  pageConfig: PageConfig
}>): void {
  const line = ensureLine(input.cursor, input.sectionId, {
    kind: 'paragraph',
    id: input.paragraphId,
    runs: []
  }, input.pageConfig)
  const inlineBox: EmptyTextAnchorBox = Object.freeze({
    kind: 'emptyTextAnchor',
    pageIndex: input.cursor.page.pageIndex,
    sectionId: input.sectionId,
    blockId: input.paragraphId,
    runId: input.runId,
    at: {
      sectionId: input.sectionId,
      blockId: input.paragraphId,
      runId: input.runId,
      graphemeIndex: 0
    },
    x: input.cursor.x,
    y: line.y,
    width: 0,
    height: Math.max(line.height, input.height)
  })

  line.inlines.push(inlineBox)
  line.height = Math.max(line.height, input.height)
  line.baseline = Math.max(line.baseline, line.y + input.baseline)
}

export function startParagraph(
  cursor: LayoutCursor,
  sectionId: string,
  paragraph: Paragraph,
  pageConfig: PageConfig
): void {
  if (cursor.paragraph?.paragraphId === paragraph.id && cursor.paragraph.pageIndex === cursor.page.pageIndex) {
    return
  }

  const indentLeftTwips = readNumberProperty(paragraph.properties, 'indentLeftTwips') ?? 0
  const x = pageConfig.marginTwips.left + Math.max(0, indentLeftTwips)
  const paragraphBox: MutableParagraphBox = {
    kind: 'paragraph',
    pageIndex: cursor.page.pageIndex,
    sectionId,
    paragraphId: paragraph.id,
    alignment: readParagraphAlignment(paragraph),
    indentLeftTwips,
    x,
    y: cursor.y,
    width: 0,
    height: 0,
    lines: [],
    pageBreakPolicy: resolveParagraphPageBreakPolicy(paragraph)
  }

  cursor.page.paragraphs.push(paragraphBox)
  cursor.page.blocks.push(paragraphBox)
  cursor.paragraph = paragraphBox
}

export function ensureLineFits(
  nextWidth: number,
  nextHeight: number,
  cursor: LayoutCursor,
  pages: MutablePageBox[],
  pageConfig: PageConfig,
  section: Section,
  paragraph: Paragraph
): void {
  const contentRight = cursor.page.contentRect.x + cursor.page.contentRect.width

  if (cursor.line !== undefined && cursor.line.fragments.length > 0 && cursor.x + nextWidth > contentRight) {
    flushLine(cursor)
  }

  if (cursor.y + nextHeight > cursor.page.contentRect.y + cursor.page.contentRect.height) {
    startNewPage(cursor, pages, pageConfig)
    assignPageSectionBoundary(cursor.page, section)
    startParagraph(cursor, section.id, paragraph, pageConfig)
  }

  ensureLine(cursor, section.id, paragraph, pageConfig)
}

export function ensureLine(
  cursor: LayoutCursor,
  sectionId: string,
  paragraph: Paragraph,
  pageConfig: PageConfig
): MutableLineBox {
  if (cursor.line !== undefined) {
    return cursor.line
  }

  startParagraph(cursor, sectionId, paragraph, pageConfig)

  const line: MutableLineBox = {
    kind: 'line',
    pageIndex: cursor.page.pageIndex,
    sectionId,
    paragraphId: paragraph.id,
    x: cursor.paragraph?.x ?? pageConfig.marginTwips.left,
    y: cursor.y,
    width: 0,
    height: 0,
    baseline: 0,
    fragments: [],
    inlines: []
  }

  cursor.line = line
  cursor.x = line.x

  return line
}

export function appendTextFragment(input: Readonly<{
  cursor: LayoutCursor
  sectionId: string
  paragraphId: string
  runId: string
  text: string
  startGraphemeIndex: number
  endGraphemeIndex: number
  width: number
  height: number
  baseline: number
  style: ResolvedFontStyle
  advanceTwips: readonly number[]
}>): void {
  const line = input.cursor.line

  if (line === undefined) {
    return
  }

  const fragment: TextFragment = Object.freeze({
    kind: 'textFragment',
    pageIndex: input.cursor.page.pageIndex,
    sectionId: input.sectionId,
    blockId: input.paragraphId,
    runId: input.runId,
    text: input.text,
    start: {
      sectionId: input.sectionId,
      blockId: input.paragraphId,
      runId: input.runId,
      graphemeIndex: input.startGraphemeIndex
    },
    end: {
      sectionId: input.sectionId,
      blockId: input.paragraphId,
      runId: input.runId,
      graphemeIndex: input.endGraphemeIndex
    },
    style: input.style,
    x: input.cursor.x,
    y: line.y,
    width: input.width,
    height: input.height,
    baseline: line.y + input.baseline,
    advanceTwips: input.advanceTwips
  })

  line.fragments.push(fragment)
  line.width = fragment.x + fragment.width - line.x
  line.height = Math.max(line.height, fragment.height)
  line.baseline = Math.max(line.baseline, fragment.baseline)
  input.cursor.x += input.width
}

export function flushLine(cursor: LayoutCursor): void {
  if (cursor.line === undefined) {
    return
  }

  const line = cursor.line

  if (line.fragments.length > 0 || line.inlines.length > 0) {
    alignLineToParagraph(line, cursor)
    const frozenLine = freezeLine(line)

    cursor.page.lines.push(frozenLine)
    cursor.paragraph?.lines.push(frozenLine)
    cursor.y += Math.max(line.height, 1)

    if (cursor.paragraph !== undefined) {
      cursor.paragraph.width = Math.max(cursor.paragraph.width, frozenLine.width)
      cursor.paragraph.height = cursor.y - cursor.paragraph.y
    }
  }

  cursor.line = undefined
  cursor.x = cursor.paragraph?.x ?? cursor.page.contentRect.x
}

export function startNewPage(
  cursor: LayoutCursor,
  pages: MutablePageBox[],
  pageConfig: PageConfig
): void {
  flushLine(cursor)

  const page = createPage(cursor.page.pageIndex + 1, pageConfig)

  pages.push(page)
  cursor.page = page
  cursor.paragraph = undefined
  cursor.line = undefined
  cursor.y = page.contentRect.y
  cursor.x = page.contentRect.x
}

function alignLineToParagraph(line: MutableLineBox, cursor: LayoutCursor): void {
  const paragraph = cursor.paragraph

  if (paragraph === undefined || line.width <= 0) {
    return
  }

  const availableWidth = Math.max(0, cursor.page.contentRect.x + cursor.page.contentRect.width - paragraph.x)
  const remainingWidth = Math.max(0, availableWidth - line.width)
  const offset = paragraph.alignment === 'right'
    ? remainingWidth
    : paragraph.alignment === 'center' ? remainingWidth / 2 : 0

  if (offset === 0) {
    return
  }

  line.x += offset
  for (let index = 0; index < line.fragments.length; index += 1) {
    const fragment = line.fragments[index]

    if (fragment !== undefined) {
      line.fragments[index] = Object.freeze({
        ...fragment,
        x: fragment.x + offset
      })
    }
  }

  for (let index = 0; index < line.inlines.length; index += 1) {
    const inline = line.inlines[index]

    if (inline !== undefined) {
      line.inlines[index] = Object.freeze({
        ...inline,
        x: inline.x + offset
      })
    }
  }
}

function readParagraphAlignment(paragraph: Paragraph): 'left' | 'center' | 'right' | 'justify' {
  const alignment = paragraph.properties?.alignment

  return alignment === 'center' || alignment === 'right' || alignment === 'justify' ? alignment : 'left'
}

function readNumberProperty(properties: Paragraph['properties'], key: string): number | undefined {
  const value = properties?.[key]

  return typeof value === 'number' ? value : undefined
}
