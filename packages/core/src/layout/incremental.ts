/**
 * 职责：处理增量 layout 的脏页定位、续排上下文和投影切片。
 * 边界：只消费既有 DocumentLayout 和 DocumentProjection，不构建具体页面盒。
 * 协作模块：engine 调用这里决定从哪一页重排、何时复用后缀页面。
 * 性能/安全约束：保持确定性切片和稳定页判断，不修改输入投影。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/03-architecture.md#36-layout-engine。
 */

import { segmentGraphemes } from '../shared/grapheme'
import type { FontManager, ResolvedFontStyle, RunTextStyle } from './font-manager'
import type { Block, Inline, Paragraph, Run } from '../model/types'
import type { PageConfig } from './page-config'
import type { DocumentProjection } from '../model/projection'
import type { TextPosition } from '../operations/transaction'
import { locatePosition, isSamePosition } from './query'
import { FONT_MANAGER_COMPATIBILITY_PROBE_TEXTS, freezePage, readRunStyle } from './internal'
import type {
  DocumentLayout,
  IncrementalLayoutContext,
  IncrementalLayoutPassInput,
  LayoutCursor,
  LayoutInput,
  MutablePageBox,
  PageBox
} from './types'

export function createIncrementalLayoutContext(input: IncrementalLayoutPassInput): IncrementalLayoutContext | undefined {
  const previousLayout = input.previousLayout

  if (
    previousLayout === undefined
    || !isEquivalentLayoutPageConfig(previousLayout.input.pageConfig, input.pageConfig)
    || !isEquivalentLayoutOptions(previousLayout.input.layoutOptions, input.layoutOptions)
    || !isCompatibleLayoutFontManager(previousLayout.input.fontManager, input.fontManager, input.projection)
  ) {
    return undefined
  }

  const dirtyPageIndex = resolveDirtyPageIndex(input, previousLayout)

  if (dirtyPageIndex === undefined) {
    return undefined
  }

  const dirtyPageEndIndex = resolveDirtyPageEndIndex(input, previousLayout, dirtyPageIndex)

  const startPosition = input.startPosition ?? (
    dirtyPageIndex === 0
      ? undefined
      : getPageStartPosition(previousLayout.pages[dirtyPageIndex])
  )

  if (dirtyPageIndex > 0 && startPosition === undefined) {
    return undefined
  }

  const sourceProjection = startPosition === undefined
    ? input.projection
    : sliceProjectionFromPosition(input.projection, startPosition)

  if (sourceProjection === undefined) {
    return undefined
  }

  return {
    previousLayout,
    dirtyPageIndex,
    dirtyPageEndIndex,
    prefixPages: Object.freeze(previousLayout.pages.slice(0, dirtyPageIndex)),
    sourceProjection,
    ...(startPosition === undefined ? {} : { sourceStartPosition: startPosition }),
    ...(input.maxPages === undefined ? {} : { pageLimit: Math.max(1, input.maxPages) })
  }
}

export function createDerivedLayoutInput(
  input: LayoutInput
): LayoutInput {
  return Object.freeze({
    projection: input.projection,
    pageConfig: input.pageConfig,
    fontManager: input.fontManager,
    ...(input.layoutOptions === undefined ? {} : { layoutOptions: input.layoutOptions }),
    ...(input.viewport === undefined ? {} : { viewport: input.viewport }),
    ...(input.dirtyRange === undefined ? {} : { dirtyRange: input.dirtyRange })
  })
}

function isEquivalentLayoutOptions(
  left: LayoutInput['layoutOptions'],
  right: LayoutInput['layoutOptions']
): boolean {
  return (left?.keepLatinWordWholeOnWrap ?? false) === (right?.keepLatinWordWholeOnWrap ?? false)
}

function isEquivalentLayoutPageConfig(left: PageConfig, right: PageConfig): boolean {
  return left.widthTwips === right.widthTwips
    && left.heightTwips === right.heightTwips
    && left.contentWidthTwips === right.contentWidthTwips
    && left.contentHeightTwips === right.contentHeightTwips
    && left.marginTwips.top === right.marginTwips.top
    && left.marginTwips.right === right.marginTwips.right
    && left.marginTwips.bottom === right.marginTwips.bottom
    && left.marginTwips.left === right.marginTwips.left
}

function isCompatibleLayoutFontManager(
  previousFontManager: FontManager,
  nextFontManager: FontManager,
  projection: DocumentProjection
): boolean {
  if (previousFontManager === nextFontManager) {
    return true
  }

  const styles = collectFontManagerProbeStyles(projection)

  for (const style of styles) {
    for (const text of FONT_MANAGER_COMPATIBILITY_PROBE_TEXTS) {
      const previousMeasurement = previousFontManager.measureText(text, style)
      const nextMeasurement = nextFontManager.measureText(text, style)

      if (!isEquivalentTextMeasurement(previousMeasurement, nextMeasurement)) {
        return false
      }
    }
  }

  return true
}

function collectFontManagerProbeStyles(projection: DocumentProjection): readonly RunTextStyle[] {
  const styles = new Map<string, RunTextStyle>()
  const defaultStyle: RunTextStyle = Object.freeze({})

  styles.set(createRunStyleSignature(defaultStyle), defaultStyle)

  for (const section of projection.document.sections) {
    for (const block of section.blocks) {
      if (block.kind !== 'paragraph') {
        continue
      }

      for (const run of block.runs) {
        const style = Object.freeze(readRunStyle(block, run.properties))
        const key = createRunStyleSignature(style)

        if (!styles.has(key)) {
          styles.set(key, style)
        }
      }
    }
  }

  return Object.freeze([...styles.values()])
}

function createRunStyleSignature(style: RunTextStyle): string {
  return [
    style.fontFamily ?? '',
    style.fontSizePx ?? '',
    style.fontSizeTwips ?? '',
    style.bold === true ? 'bold' : 'normal',
    style.italic === true ? 'italic' : 'upright',
    style.superscript === true ? 'superscript' : 'baseline',
    style.subscript === true ? 'subscript' : 'baseline',
    style.color ?? '',
    style.lineHeight ?? ''
  ].join('\u0000')
}

function isEquivalentTextMeasurement(
  left: ReturnType<FontManager['measureText']>,
  right: ReturnType<FontManager['measureText']>
): boolean {
  return left.widthCssPx === right.widthCssPx
    && left.heightCssPx === right.heightCssPx
    && left.baselineCssPx === right.baselineCssPx
    && left.graphemeCount === right.graphemeCount
    && createResolvedFontSignature(left.resolvedFont) === createResolvedFontSignature(right.resolvedFont)
}

function createResolvedFontSignature(style: ResolvedFontStyle): string {
  return [
    style.fontFamily,
    style.requestedFontFamily ?? '',
    style.fontSizePx,
    style.baseFontSizePx ?? '',
    style.status,
    style.bold === true ? 'bold' : 'normal',
    style.italic === true ? 'italic' : 'upright',
    style.superscript === true ? 'superscript' : 'baseline',
    style.subscript === true ? 'subscript' : 'baseline',
    style.color ?? '',
    style.lineHeight ?? ''
  ].join('\u0000')
}

function resolveDirtyPageIndex(
  input: IncrementalLayoutPassInput,
  previousLayout: DocumentLayout
): number | undefined {
  if (input.dirtyPageIndex !== undefined && Number.isInteger(input.dirtyPageIndex)) {
    if (input.startPosition !== undefined) {
      return Math.max(0, input.dirtyPageIndex)
    }

    return clampPageIndex(input.dirtyPageIndex, previousLayout.pages.length)
  }

  if (input.dirtyRange === undefined) {
    return undefined
  }

  const anchorPageIndex = locatePageIndex(previousLayout, input.dirtyRange.anchor)
  const focusPageIndex = locatePageIndex(previousLayout, input.dirtyRange.focus)

  if (anchorPageIndex === undefined) {
    return focusPageIndex
  }

  if (focusPageIndex === undefined) {
    return anchorPageIndex
  }

  return Math.min(anchorPageIndex, focusPageIndex)
}

function resolveDirtyPageEndIndex(
  input: IncrementalLayoutPassInput,
  previousLayout: DocumentLayout,
  dirtyPageIndex: number
): number {
  if (input.dirtyPageEndIndex !== undefined && Number.isInteger(input.dirtyPageEndIndex)) {
    return clampPageIndex(input.dirtyPageEndIndex, previousLayout.pages.length) ?? dirtyPageIndex
  }

  if (input.dirtyRange === undefined) {
    return dirtyPageIndex
  }

  const anchorPageIndex = locatePageIndex(previousLayout, input.dirtyRange.anchor)
  const focusPageIndex = locatePageIndex(previousLayout, input.dirtyRange.focus)

  if (anchorPageIndex === undefined) {
    return focusPageIndex ?? dirtyPageIndex
  }

  if (focusPageIndex === undefined) {
    return anchorPageIndex
  }

  return Math.max(anchorPageIndex, focusPageIndex)
}

function clampPageIndex(pageIndex: number, pageCount: number): number | undefined {
  if (pageCount === 0) {
    return undefined
  }

  return Math.min(Math.max(pageIndex, 0), pageCount - 1)
}

export function finalizeLayoutPages(
  pages: readonly MutablePageBox[],
  incremental?: IncrementalLayoutContext
): readonly PageBox[] {
  const trailingEmptyPage = incremental?.stoppedAtPageIndex === undefined
    ? false
    : isTrailingStoppedPage(pages[pages.length - 1], incremental.stoppedAtPageIndex)
  const activePages = trailingEmptyPage ? pages.slice(0, -1) : pages

  return Object.freeze(activePages.map(freezePage))
}

export function resolveReusedSuffixPages(
  incremental?: IncrementalLayoutContext
): readonly PageBox[] {
  if (incremental?.stoppedAtPageIndex === undefined) {
    return Object.freeze([])
  }

  return Object.freeze(incremental.previousLayout.pages.slice(incremental.stoppedAtPageIndex))
}

function isTrailingStoppedPage(
  page: MutablePageBox | undefined,
  stoppedAtPageIndex: number
): boolean {
  return page !== undefined
    && page.pageIndex === stoppedAtPageIndex
    && page.lines.length === 0
    && page.paragraphs.every((paragraph) => paragraph.lines.length === 0)
}

export function shouldStopLayoutPass(
  incremental: IncrementalLayoutContext | undefined,
  cursor: LayoutCursor,
  position: TextPosition
): boolean {
  if (shouldStopAtStablePage(incremental, cursor, position)) {
    return true
  }

  return shouldStopAtPageLimit(incremental, cursor, position)
}

function shouldStopAtPageLimit(
  incremental: IncrementalLayoutContext | undefined,
  cursor: LayoutCursor,
  position: TextPosition
): boolean {
  const pageLimit = incremental?.pageLimit

  if (
    incremental === undefined
    || pageLimit === undefined
    || cursor.page.pageIndex < incremental.dirtyPageIndex + pageLimit
    || cursor.page.lines.length > 0
  ) {
    return false
  }

  incremental.stoppedAtPageIndex = cursor.page.pageIndex
  incremental.continuation = Object.freeze({
    dirtyPageIndex: cursor.page.pageIndex,
    dirtyPageEndIndex: incremental.dirtyPageEndIndex,
    startPosition: position
  })

  return true
}

function shouldStopAtStablePage(
  incremental: IncrementalLayoutContext | undefined,
  cursor: LayoutCursor,
  position: TextPosition
): boolean {
  if (
    incremental === undefined
    || cursor.page.pageIndex <= incremental.dirtyPageEndIndex
    || cursor.page.lines.length > 0
  ) {
    return false
  }

  const previousPageStart = getPageStartPosition(incremental.previousLayout.pages[cursor.page.pageIndex])

  if (previousPageStart === undefined || !isSamePosition(previousPageStart, position)) {
    return false
  }

  incremental.stoppedAtPageIndex = cursor.page.pageIndex

  return true
}

function locatePageIndex(
  layout: DocumentLayout,
  position: TextPosition
): number | undefined {
  return locatePosition(layout, position)?.line.pageIndex
}

function getPageStartPosition(page: PageBox | undefined): TextPosition | undefined {
  if (page === undefined) {
    return undefined
  }

  for (const line of page.lines) {
    const fragment = line.fragments[0]

    if (fragment !== undefined) {
      return fragment.start
    }
  }

  return undefined
}

function sliceProjectionFromPosition(
  projection: DocumentProjection,
  start: TextPosition
): DocumentProjection | undefined {
  const sections = projection.document.sections
  const startSectionIndex = findSectionIndex(sections, start.sectionId)

  if (startSectionIndex < 0) {
    return undefined
  }

  const slicedSections = sections.slice(startSectionIndex).flatMap((section, sectionOffset) => {
    if (sectionOffset > 0) {
      return [section]
    }

    const startBlockIndex = findBlockIndex(section.blocks, start.blockId)

    if (startBlockIndex < 0) {
      return []
    }

    const slicedBlocks = section.blocks.slice(startBlockIndex).flatMap((block, blockOffset) => {
      if (blockOffset > 0) {
        return [block]
      }

      if (block.kind !== 'paragraph') {
        return []
      }

      const slicedParagraph = sliceParagraphFromPosition(block, start)

      return slicedParagraph === undefined ? [] : [slicedParagraph]
    })

    if (slicedBlocks.length === 0) {
      return []
    }

    return [{
      ...section,
      blocks: Object.freeze(slicedBlocks)
    }]
  })

  if (slicedSections.length === 0) {
    return undefined
  }

  return {
    document: {
      ...projection.document,
      sections: Object.freeze(slicedSections)
    }
  }
}

function findSectionIndex(
  sections: readonly { readonly id: string }[],
  sectionId: string
): number {
  return sections.findIndex((section) => section.id === sectionId)
}

function findBlockIndex(
  blocks: readonly Block[],
  blockId: string
): number {
  return blocks.findIndex((block) => block.id === blockId)
}

function sliceParagraphFromPosition(
  paragraph: Paragraph,
  start: TextPosition
): Paragraph | undefined {
  const startRunIndex = paragraph.runs.findIndex((run) => run.id === start.runId)

  if (startRunIndex < 0) {
    return undefined
  }

  const slicedRuns = paragraph.runs.slice(startRunIndex).flatMap((run, runOffset) => {
    if (runOffset > 0) {
      return [run]
    }

    const slicedRun = sliceRunFromPosition(run, start.graphemeIndex)

    return slicedRun === undefined ? [] : [slicedRun]
  })

  if (slicedRuns.length === 0) {
    return undefined
  }

  return {
    ...paragraph,
    runs: Object.freeze(slicedRuns)
  }
}

function sliceRunFromPosition(
  run: Run,
  startGraphemeIndex: number
): Run | undefined {
  const slicedInlines: Inline[] = []
  let remainingGraphemeIndex = startGraphemeIndex
  let started = false

  for (const inline of run.inlines) {
    if (started) {
      slicedInlines.push(inline)
      continue
    }

    if (inline.kind !== 'text') {
      continue
    }

    const segments = segmentGraphemes(inline.text)

    if (remainingGraphemeIndex >= segments.length) {
      remainingGraphemeIndex -= segments.length
      continue
    }

    started = true
    slicedInlines.push({
      ...inline,
      text: segments.slice(remainingGraphemeIndex).map((segment) => segment.segment).join('')
    })
  }

  if (!started) {
    return undefined
  }

  return {
    ...run,
    inlines: Object.freeze(slicedInlines)
  }
}
