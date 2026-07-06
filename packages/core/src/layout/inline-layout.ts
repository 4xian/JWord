/**
 * 职责：处理段落 run、文本片段、inline 对象和空文本锚点的纯数据布局。
 * 边界：不遍历文档 section，不创建页面，不处理表格分页。
 * 协作模块：engine/pagination-flow 调用这里排布 paragraph run，paragraph-flow 提供行盒写入辅助。
 * 性能/安全约束：只消费 layout input 与 cursor，不访问 DOM、不绘制 Canvas。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/03-architecture.md#36-layout-engine。
 */

import { cssPxToTwips } from './page-config'
import { measureLayoutTextSegment, measureTextSegmentForLayout, segmentTextForLayout } from './text-segments'
import type { Paragraph, Run, Section } from '../model/types'
import type { Resource } from '../resources/types'
import { shouldStopLayoutPass } from './incremental'
import { readRunStyle } from './internal'
import { layoutInlineBoundary } from './layout-anchors'
import {
  appendEmptyTextAnchor,
  appendTextFragment,
  ensureLineFits,
  flushLine,
  resolveInlineObjectGeometry
} from './paragraph-flow'
import type {
  IncrementalLayoutContext,
  LayoutCursor,
  LayoutInput,
  MutablePageBox
} from './types'

/** 排布单个 run 中的文本与 inline 对象，并在需要分片续排时提前停止。 */
export function layoutRun(
  run: Run,
  section: Section,
  paragraph: Paragraph,
  input: LayoutInput,
  cursor: LayoutCursor,
  pages: MutablePageBox[],
  incremental?: IncrementalLayoutContext,
  resourceById?: ReadonlyMap<string, Resource>
): boolean {
  const sectionId = section.id
  const style = readRunStyle(paragraph, run.properties)
  const shouldEmitCollapsedTextAnchor = shouldEmitCollapsedTextRunAnchor(paragraph, run)
  let runGraphemeIndex = resolveRunStartGraphemeIndex(incremental, sectionId, paragraph.id, run.id)

  for (const inline of run.inlines) {
    if (inline.kind === 'text') {
      for (const segment of segmentTextForLayout(inline.text, runGraphemeIndex)) {
        if (
          shouldStopLayoutPass(incremental, cursor, {
            sectionId,
            blockId: paragraph.id,
            runId: run.id,
            graphemeIndex: segment.startGraphemeIndex
          })
        ) {
          return true
        }

        if (input.layoutOptions?.keepLatinWordWholeOnWrap === true && isLatinWordSegment(segment.text)) {
          flushLineBeforeWrappedWordSegment({
            segment,
            style,
            layoutInput: input,
            cursor
          })
        }

        const measuredSegments = measureTextSegmentForLayout({
          fontManager: input.fontManager,
          segment,
          style,
          maxWidth: readSegmentMeasureMaxWidth({
            segment,
            layoutInput: input,
            cursor
          })
        })

        for (const measured of measuredSegments) {
          ensureLineFits(measured.width, measured.height, cursor, pages, input.pageConfig, section, paragraph)

          if (
            shouldStopLayoutPass(incremental, cursor, {
              sectionId,
              blockId: paragraph.id,
              runId: run.id,
              graphemeIndex: measured.startGraphemeIndex
            })
          ) {
            return true
          }

          appendTextFragment({
            cursor,
            sectionId,
            paragraphId: paragraph.id,
            runId: run.id,
            text: measured.text,
            startGraphemeIndex: measured.startGraphemeIndex,
            endGraphemeIndex: measured.endGraphemeIndex,
            width: measured.width,
            height: measured.height,
            baseline: measured.baseline,
            style: measured.style,
            advanceTwips: measured.advanceTwips
          })
        }

        runGraphemeIndex = segment.endGraphemeIndex
      }
    } else {
      if (inline.kind !== 'break') {
        const geometry = resolveInlineObjectGeometry(inline, input.pageConfig, 0)

        ensureLineFits(
          Math.min(geometry.width, input.pageConfig.contentWidthTwips),
          geometry.height,
          cursor,
          pages,
          input.pageConfig,
          section,
          paragraph
        )
      }
      layoutInlineBoundary(inline, section, paragraph, run.id, runGraphemeIndex, cursor, pages, input.pageConfig, resourceById)
    }
  }

  if (shouldEmitCollapsedTextAnchor) {
    appendCollapsedTextRunAnchor(run, section, paragraph, input, cursor, pages)
  }

  return false
}

/** 确保纯空段落也产生可定位的零宽文本锚点。 */
export function ensureEmptyParagraphVisible(
  paragraph: Paragraph,
  section: Section,
  input: LayoutInput,
  cursor: LayoutCursor,
  pages: MutablePageBox[]
): void {
  if (cursor.paragraph?.paragraphId !== paragraph.id || cursor.paragraph.lines.length > 0) {
    return
  }

  if (!isVisuallyEmptyParagraph(paragraph)) {
    return
  }

  const firstRun = paragraph.runs[0]

  if (firstRun === undefined) {
    return
  }

  const measurement = input.fontManager.measureText('', readRunStyle(paragraph, firstRun.properties))
  const height = cssPxToTwips(measurement.heightCssPx)
  const baseline = cssPxToTwips(measurement.baselineCssPx)

  ensureLineFits(0, height, cursor, pages, input.pageConfig, section, paragraph)
  appendEmptyTextAnchor({
    cursor,
    sectionId: section.id,
    paragraphId: paragraph.id,
    runId: firstRun.id,
    height,
    baseline,
    pageConfig: input.pageConfig
  })
}

/** 给非纯空段落中的零长度文本 run 补可定位锚点。 */
function appendCollapsedTextRunAnchor(
  run: Run,
  section: Section,
  paragraph: Paragraph,
  input: LayoutInput,
  cursor: LayoutCursor,
  pages: MutablePageBox[]
): void {
  const measurement = input.fontManager.measureText('', readRunStyle(paragraph, run.properties))
  const height = cssPxToTwips(measurement.heightCssPx)
  const baseline = cssPxToTwips(measurement.baselineCssPx)

  ensureLineFits(0, height, cursor, pages, input.pageConfig, section, paragraph)
  appendEmptyTextAnchor({
    cursor,
    sectionId: section.id,
    paragraphId: paragraph.id,
    runId: run.id,
    height,
    baseline,
    pageConfig: input.pageConfig
  })
}

/** 判断当前 run 是否需要补零宽文本锚点。 */
function shouldEmitCollapsedTextRunAnchor(paragraph: Paragraph, run: Run): boolean {
  return !isVisuallyEmptyParagraph(paragraph)
    && run.inlines.length > 0
    && run.inlines.every((inline) => inline.kind === 'text' && inline.text.length === 0)
}

/** 判断段落是否只有空文本内容。 */
function isVisuallyEmptyParagraph(paragraph: Paragraph): boolean {
  for (const run of paragraph.runs) {
    for (const inline of run.inlines) {
      if (inline.kind !== 'text' || inline.text.length > 0) {
        return false
      }
    }
  }

  return true
}

/** 在开启整词换行时，必要时先 flush 当前行再排拉丁单词。 */
function flushLineBeforeWrappedWordSegment(input: Readonly<{
  segment: ReturnType<typeof segmentTextForLayout>[number]
  style: ReturnType<typeof readRunStyle>
  layoutInput: LayoutInput
  cursor: LayoutCursor
}>): void {
  const line = input.cursor.line

  if (line === undefined || line.fragments.length === 0) {
    return
  }

  const measured = measureLayoutTextSegment({
    fontManager: input.layoutInput.fontManager,
    segment: input.segment,
    style: input.style
  })
  const contentRight = input.cursor.page.contentRect.x + input.cursor.page.contentRect.width

  if (input.cursor.x + measured.width > contentRight) {
    flushLine(input.cursor, { justify: true })
  }
}

/** 读取当前 segment 在默认换行模式下的测量宽度上限。 */
function readSegmentMeasureMaxWidth(input: Readonly<{
  segment: ReturnType<typeof segmentTextForLayout>[number]
  layoutInput: LayoutInput
  cursor: LayoutCursor
}>): number {
  if (
    input.layoutInput.layoutOptions?.keepLatinWordWholeOnWrap === true
    || !isLatinWordSegment(input.segment.text)
  ) {
    return input.layoutInput.pageConfig.contentWidthTwips
  }

  const line = input.cursor.line

  if (line === undefined || (line.fragments.length === 0 && line.inlines.length === 0)) {
    return input.layoutInput.pageConfig.contentWidthTwips
  }

  const contentRight = input.cursor.page.contentRect.x + input.cursor.page.contentRect.width

  return Math.max(0, contentRight - input.cursor.x)
}

/** 判断文本片段是否是可按整词处理的拉丁单词。 */
function isLatinWordSegment(text: string): boolean {
  return /^[\p{Letter}\p{Number}]+$/u.test(text)
    && !/\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u.test(text)
}

/** 读取增量续排起点对应 run 的起始 grapheme index。 */
function resolveRunStartGraphemeIndex(
  incremental: IncrementalLayoutContext | undefined,
  sectionId: string,
  paragraphId: string,
  runId: string
): number {
  const sourceStartPosition = incremental?.sourceStartPosition

  if (
    sourceStartPosition === undefined
    || sourceStartPosition.sectionId !== sectionId
    || sourceStartPosition.blockId !== paragraphId
    || sourceStartPosition.runId !== runId
  ) {
    return 0
  }

  return sourceStartPosition.graphemeIndex
}
