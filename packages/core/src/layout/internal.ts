/**
 * 职责：提供 layout 引擎内部共享的页面盒冻结、section 边界和属性读取工具。
 * 边界：只服务 layout 子目录内部模块，不暴露新的仓库级能力。
 * 协作模块：engine、incremental 和 types 共同维持分页盒构建的最小公共逻辑。
 * 性能/安全约束：工具函数保持纯计算，不访问 DOM、不持有文档状态。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/03-architecture.md#36-layout-engine。
 */

import { twipsToCssPx } from './page-config'
import type { RunTextStyle } from './font-manager'
import { resolveParagraphRunStyleDefaults } from './paragraph-semantics'
import type { Inline, ModelProperties, Paragraph, Section } from '../model/types'
import type { PageConfig } from './page-config'
import type { Resource } from '../resources/types'
import type {
  HeaderFooterBox,
  InlineObjectPayload,
  LayoutDebugBox,
  LayoutDebugOverlay,
  LayoutRect,
  LayoutSectionContext,
  LineBox,
  MutableLineBox,
  MutablePageBox,
  PageBox,
  ParagraphPageBreakPolicy
} from './types'

export const PAGE_GAP_TWIPS = 720
export const FONT_MANAGER_COMPATIBILITY_PROBE_TEXTS = Object.freeze(['M', '中', '😀', ' ', '.'])
const HEADER_FOOTER_BASELINE_RATIO = 0.6

export function createPage(pageIndex: number, pageConfig: PageConfig): MutablePageBox {
  const pageY = pageIndex * (pageConfig.heightTwips + PAGE_GAP_TWIPS)

  return {
    kind: 'page',
    pageIndex,
    x: 0,
    y: pageY,
    width: pageConfig.widthTwips,
    height: pageConfig.heightTwips,
    sectionBoundary: 'single',
    sectionIds: [],
    headerIds: Object.freeze([]),
    footerIds: Object.freeze([]),
    headerFooterBoxes: [],
    lines: [],
    paragraphs: [],
    blocks: [],
    contentRect: {
      pageIndex,
      x: pageConfig.marginTwips.left,
      y: pageY + pageConfig.marginTwips.top,
      width: pageConfig.contentWidthTwips,
      height: pageConfig.contentHeightTwips
    }
  }
}

export function freezePage(page: MutablePageBox): PageBox {
  const frozenParagraphs = page.paragraphs.map((paragraph) => Object.freeze({
    ...paragraph,
    lines: Object.freeze(paragraph.lines),
    pageBreakPolicy: Object.freeze(paragraph.pageBreakPolicy)
  }))
  const frozenParagraphById = new Map(frozenParagraphs.map((paragraph) => [paragraph.paragraphId, paragraph]))

  return Object.freeze({
    ...page,
    sectionIds: Object.freeze([...page.sectionIds]),
    headerIds: Object.freeze([...page.headerIds]),
    footerIds: Object.freeze([...page.footerIds]),
    headerFooterBoxes: Object.freeze([...page.headerFooterBoxes]),
    lines: Object.freeze(page.lines),
    paragraphs: Object.freeze(frozenParagraphs),
    blocks: Object.freeze(page.blocks.map((block) =>
      block.kind === 'paragraph'
        ? frozenParagraphById.get(block.paragraphId) ?? block
        : block
    )),
    contentRect: Object.freeze(page.contentRect),
    ...(page.pageLayout === undefined ? {} : { pageLayout: freezeSectionPageLayout(page.pageLayout) }),
    ...(page.pageNumber === undefined ? {} : { pageNumber: page.pageNumber })
  })
}

export function freezeLine(line: MutableLineBox): LineBox {
  return Object.freeze({
    ...line,
    fragments: Object.freeze(line.fragments),
    inlines: Object.freeze(line.inlines)
  })
}

export function createDebugOverlay(pages: readonly PageBox[]): LayoutDebugOverlay {
  const boxes: LayoutDebugBox[] = []

  for (const page of pages) {
    boxes.push(createDebugBox('page', `page:${page.pageIndex}`, page))

    for (const line of page.lines) {
      boxes.push(createDebugBox('line', `line:${line.pageIndex}:${line.y}`, line))

      for (const fragment of line.fragments) {
        boxes.push(createDebugBox('fragment', `fragment:${fragment.blockId}:${fragment.runId}:${fragment.start.graphemeIndex}`, fragment))
      }
    }
  }

  return Object.freeze({
    boxes: Object.freeze(boxes)
  })
}

export function createDebugBox(
  kind: LayoutDebugBox['kind'],
  id: string,
  rect: LayoutRect
): LayoutDebugBox {
  return Object.freeze({
    kind,
    id,
    pageIndex: rect.pageIndex,
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height
  })
}

export function assignPageSectionBoundary(
  page: MutablePageBox,
  section: Section,
  context?: LayoutSectionContext
): void {
  if (page.sectionIds[page.sectionIds.length - 1] === section.id) {
    return
  }

  page.sectionIds.push(section.id)

  if (page.sectionIds.length === 1) {
    page.sectionBoundary = 'single'
    page.sectionId = section.id
    page.pageLayout = section.page
    page.headerIds = context?.headerIds ?? section.headerIds ?? Object.freeze([])
    page.footerIds = context?.footerIds ?? section.footerIds ?? Object.freeze([])
    const pageNumber = resolvePageNumber(page, context)

    if (pageNumber === undefined) {
      delete page.pageNumber
    } else {
      page.pageNumber = pageNumber
    }

    page.headerFooterBoxes = createHeaderFooterBoxes(page, section.id)
    return
  }

  page.sectionBoundary = 'mixed'
  delete page.sectionId
  delete page.pageLayout
  delete page.pageNumber
  page.headerIds = Object.freeze([])
  page.footerIds = Object.freeze([])
  page.headerFooterBoxes = []
}

function resolvePageNumber(page: MutablePageBox, context: LayoutSectionContext | undefined): number | undefined {
  if (context === undefined) {
    return undefined
  }

  return context.startPageNumber + Math.max(0, page.pageIndex - context.startPageIndex)
}

function createHeaderFooterBoxes(page: MutablePageBox, sectionId: string): HeaderFooterBox[] {
  const pageNumber = page.pageNumber

  if (pageNumber === undefined) {
    return []
  }

  return [
    ...page.headerIds.map((sourceId) => createHeaderFooterBox(page, sectionId, sourceId, 'header', pageNumber)),
    ...page.footerIds.map((sourceId) => createHeaderFooterBox(page, sectionId, sourceId, 'footer', pageNumber))
  ]
}

function createHeaderFooterBox(
  page: MutablePageBox,
  sectionId: string,
  sourceId: string,
  role: HeaderFooterBox['role'],
  pageNumber: number
): HeaderFooterBox {
  const height = Math.min(page.contentRect.y - page.y, page.height / 8)
  const y = role === 'header'
    ? page.y
    : page.contentRect.y + page.contentRect.height
  const baseline = resolveHeaderFooterBaseline(y, height)

  return Object.freeze({
    kind: 'headerFooter',
    role,
    sectionId,
    sourceId,
    pageNumber,
    pageIndex: page.pageIndex,
    x: page.contentRect.x,
    y,
    width: page.contentRect.width,
    height: Math.max(0, height),
    baseline
  })
}

/** 根据 layout 盒子计算页眉页脚文字基线，后续 renderer 不再各自硬编码比例。 */
function resolveHeaderFooterBaseline(y: number, height: number): number {
  return y + (Math.max(0, height) * HEADER_FOOTER_BASELINE_RATIO)
}

export function createInlineObjectPayload(
  inline: Exclude<Inline, { readonly kind: 'text' | 'break' }>,
  resourceById?: ReadonlyMap<string, Resource>
): InlineObjectPayload {
  switch (inline.kind) {
    case 'bookmark':
      return Object.freeze({
        id: inline.id,
        name: inline.name,
        edge: inline.edge
      })
    case 'image': {
      const resource = resourceById?.get(inline.resourceId)

      return Object.freeze({
        resourceId: inline.resourceId,
        ...(inline.alt === undefined ? {} : { alt: inline.alt }),
        ...(inline.display === undefined ? {} : { display: inline.display }),
        ...(inline.widthTwips === undefined ? {} : { widthTwips: inline.widthTwips }),
        ...(inline.heightTwips === undefined ? {} : { heightTwips: inline.heightTwips }),
        ...(inline.rotationDegrees === undefined ? {} : { rotationDegrees: inline.rotationDegrees }),
        ...(resource === undefined
          ? {}
          : {
              resourceStatus: resource.status,
              resourceMime: resource.mime,
              resourceSourceKind: resource.source.kind,
              resourceSourceUrl: resource.source.url,
              ...(resource.error === undefined ? {} : { resourceErrorMessage: resource.error.message }),
              ...(resource.retryToken === undefined ? {} : { retryToken: resource.retryToken })
            })
      })
    }
    case 'commentRangeMarker':
      return Object.freeze({
        commentId: inline.commentId,
        edge: inline.edge
      })
  }
}

function freezeSectionPageLayout(pageLayout: Section['page']): Section['page'] {
  return Object.freeze({
    ...pageLayout,
    ...(pageLayout?.marginTwips === undefined
      ? {}
      : {
          marginTwips: Object.freeze({
            ...pageLayout.marginTwips
          })
        })
  })
}


export function resolveParagraphPageBreakPolicy(paragraph: Paragraph): ParagraphPageBreakPolicy {
  const widowControl = readBooleanProperty(paragraph.properties, 'widowControl') ?? true
  const orphanLines = readNumberProperty(paragraph.properties, 'orphanLines') ?? 2
  const widowLines = readNumberProperty(paragraph.properties, 'widowLines') ?? 2

  return Object.freeze({
    widowControl,
    orphanLines,
    widowLines
  })
}

export function readRunStyle(paragraph: Paragraph, properties: ModelProperties | undefined): RunTextStyle {
  const defaults = resolveParagraphRunStyleDefaults(paragraph)
  const fontFamily = readStringProperty(properties, 'fontFamily')
  const fontSizePx = readNumberProperty(properties, 'fontSizePx')
  const fontSizeTwips = readNumberProperty(properties, 'fontSizeTwips')
  const bold = readBooleanProperty(properties, 'bold')
  const italic = readBooleanProperty(properties, 'italic')
  const underline = readBooleanProperty(properties, 'underline')
  const strike = readBooleanProperty(properties, 'strike')
  const superscript = readBooleanProperty(properties, 'superscript')
  const subscript = readBooleanProperty(properties, 'subscript')
  const color = readStringProperty(properties, 'color')
  const backgroundColor = readStringProperty(properties, 'backgroundColor')
  const lineHeight = readNumberProperty(properties, 'lineHeight')
  const resolvedFontSizePx = fontSizePx === undefined
    ? (fontSizeTwips === undefined ? undefined : twipsToCssPx(fontSizeTwips))
    : fontSizePx
  const style: RunTextStyle = {
    ...defaults,
    ...(resolvedFontSizePx === undefined ? {} : { fontSizePx: resolvedFontSizePx })
  }

  return {
    ...style,
    ...(fontFamily === undefined ? {} : { fontFamily }),
    ...(fontSizeTwips === undefined ? {} : { fontSizeTwips }),
    ...(bold === undefined ? {} : { bold }),
    ...(italic === undefined ? {} : { italic }),
    ...(underline === undefined ? {} : { underline }),
    ...(strike === undefined ? {} : { strike }),
    ...(superscript === undefined ? {} : { superscript }),
    ...(subscript === undefined ? {} : { subscript }),
    ...(color === undefined ? {} : { color }),
    ...(backgroundColor === undefined ? {} : { backgroundColor }),
    ...(lineHeight === undefined ? {} : { lineHeight })
  }
}

function readStringProperty(properties: ModelProperties | undefined, key: string): string | undefined {
  const value = properties?.[key]

  return typeof value === 'string' ? value : undefined
}

function readNumberProperty(properties: ModelProperties | undefined, key: string): number | undefined {
  const value = properties?.[key]

  return typeof value === 'number' ? value : undefined
}

function readBooleanProperty(properties: ModelProperties | undefined, key: string): boolean | undefined {
  const value = properties?.[key]

  return typeof value === 'boolean' ? value : undefined
}
