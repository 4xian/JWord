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
  InlineObjectPayload,
  LayoutDebugBox,
  LayoutDebugOverlay,
  LayoutRect,
  LineBox,
  MutableLineBox,
  MutablePageBox,
  PageBox,
  ParagraphPageBreakPolicy
} from './types'

export const PAGE_GAP_TWIPS = 720
export const FONT_MANAGER_COMPATIBILITY_PROBE_TEXTS = Object.freeze(['M', '中', '😀', ' ', '.'])

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
    lines: Object.freeze(page.lines),
    paragraphs: Object.freeze(frozenParagraphs),
    blocks: Object.freeze(page.blocks.map((block) =>
      block.kind === 'paragraph'
        ? frozenParagraphById.get(block.paragraphId) ?? block
        : block
    )),
    contentRect: Object.freeze(page.contentRect),
    ...(page.pageLayout === undefined ? {} : { pageLayout: freezeSectionPageLayout(page.pageLayout) })
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

export function assignPageSectionBoundary(page: MutablePageBox, section: Section): void {
  if (page.sectionIds[page.sectionIds.length - 1] === section.id) {
    return
  }

  page.sectionIds.push(section.id)

  if (page.sectionIds.length === 1) {
    page.sectionBoundary = 'single'
    page.sectionId = section.id
    page.pageLayout = section.page
    page.headerIds = section.headerIds ?? Object.freeze([])
    page.footerIds = section.footerIds ?? Object.freeze([])
    return
  }

  page.sectionBoundary = 'mixed'
  delete page.sectionId
  delete page.pageLayout
  page.headerIds = Object.freeze([])
  page.footerIds = Object.freeze([])
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
