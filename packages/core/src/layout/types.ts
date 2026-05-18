/**
 * 职责：集中定义 layout 运行时公开类型和内部可变盒模型。
 * 边界：只描述分页布局的数据结构，不执行布局、不访问 DOM、不读取 Y.Doc。
 * 协作模块：engine、incremental、query、renderer 和 editor facade 通过这些类型共享边界。
 * 性能/安全约束：保持类型可序列化和 framework-agnostic，禁止引入运行时副作用。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/03-architecture.md#36-layout-engine。
 */

import type { FontManager, ResolvedFontStyle } from './font-manager'
import type { Inline, ParagraphList, Section } from '../model/types'
import type { PageConfig } from './page-config'
import type { DocumentProjection } from '../model/projection'
import type { TextPosition } from '../operations/transaction'
import type { ResourceSource, ResourceStatus } from '../resources/types'

export interface LayoutOptions {
  /**
   * 是否在拉丁单词放不进当前行剩余宽度时先整体挪到下一行。
   *
   * @defaultValue `false`
   */
  readonly keepLatinWordWholeOnWrap?: boolean
}

export interface LayoutViewport {
  readonly yTwips?: number
  readonly heightTwips?: number
  readonly pageBuffer?: number
}

export interface LayoutDirtyRange {
  readonly anchor: TextPosition
  readonly focus: TextPosition
}

export interface LayoutInput {
  readonly projection: DocumentProjection
  readonly pageConfig: PageConfig
  readonly fontManager: FontManager
  readonly layoutOptions?: LayoutOptions
  readonly viewport?: LayoutViewport
  readonly dirtyRange?: LayoutDirtyRange
  readonly previousLayout?: DocumentLayout
  readonly dirtyPageIndex?: number
}

export interface LayoutRect {
  readonly pageIndex: number
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface DocumentLayout {
  readonly kind: 'documentLayout'
  readonly input: LayoutInput
  readonly pages: readonly PageBox[]
  readonly debugOverlay: LayoutDebugOverlay
}

export interface PageBox extends LayoutRect {
  readonly kind: 'page'
  readonly sectionBoundary: 'single' | 'mixed'
  readonly sectionIds: readonly string[]
  readonly sectionId?: string
  readonly pageLayout?: Section['page']
  readonly headerIds: readonly string[]
  readonly footerIds: readonly string[]
  readonly lines: readonly LineBox[]
  readonly paragraphs: readonly ParagraphBox[]
  readonly blocks: readonly BlockBox[]
  readonly contentRect: LayoutRect
}

export type LayoutBox = PageBox

export interface ParagraphBox extends LayoutRect {
  readonly kind: 'paragraph'
  readonly sectionId: string
  readonly paragraphId: string
  readonly pageBreakPolicy: ParagraphPageBreakPolicy
  readonly lines: readonly LineBox[]
  readonly listMarker?: ParagraphListMarker
}

export interface TableBox extends LayoutRect {
  readonly kind: 'table'
  readonly sectionId: string
  readonly tableId: string
  readonly grid: readonly number[]
  readonly rowCount: number
  readonly cellCount: number
  readonly rows: readonly TableRowBox[]
}

export type BlockBox = ParagraphBox | TableBox

export interface TableRowBox {
  readonly rowId: string
  readonly cells: readonly TableCellBox[]
}

export interface TableCellBox {
  readonly cellId: string
  readonly gridSpan: number
  readonly blockIds: readonly string[]
}

export interface LineBox extends LayoutRect {
  readonly kind: 'line'
  readonly sectionId: string
  readonly paragraphId: string
  readonly baseline: number
  readonly fragments: readonly TextFragment[]
  readonly inlines: readonly InlineBox[]
}

export interface TextFragment extends LayoutRect {
  readonly kind: 'textFragment'
  readonly sectionId: string
  readonly blockId: string
  readonly runId: string
  readonly text: string
  readonly start: TextPosition
  readonly end: TextPosition
  readonly style: ResolvedFontStyle
  readonly baseline: number
  readonly advanceTwips: readonly number[]
}

export type InlineBox =
  | PageBreakBox
  | EmptyTextAnchorBox
  | NonTextInlineBox

export interface PageBreakBox extends LayoutRect {
  readonly kind: 'pageBreak'
  readonly sectionId: string
  readonly blockId: string
  readonly runId: string
  readonly at: TextPosition
}

export interface EmptyTextAnchorBox extends LayoutRect {
  readonly kind: 'emptyTextAnchor'
  readonly sectionId: string
  readonly blockId: string
  readonly runId: string
  readonly at: TextPosition
  readonly baseline: number
}

export interface NonTextInlineBox extends LayoutRect {
  readonly kind: 'inlineObject'
  readonly inlineKind: Exclude<Inline['kind'], 'text' | 'break'>
  readonly payload: InlineObjectPayload
  readonly sectionId: string
  readonly blockId: string
  readonly runId: string
  readonly at: TextPosition
}

export interface BookmarkInlinePayload {
  readonly id: string
  readonly name: string
  readonly edge: 'start' | 'end'
}

export interface CommentRangeInlinePayload {
  readonly commentId: string
  readonly edge: 'start' | 'end'
}

export interface ImageInlineLayoutPayload {
  readonly resourceId: string
  readonly alt?: string
  readonly display?: 'inline'
  readonly widthTwips?: number
  readonly heightTwips?: number
  readonly resourceStatus?: ResourceStatus
  readonly resourceMime?: string
  readonly resourceSourceKind?: ResourceSource['kind']
  readonly resourceSourceUrl?: string
  readonly resourceErrorMessage?: string
  readonly retryToken?: string
}

export type InlineObjectPayload =
  | BookmarkInlinePayload
  | CommentRangeInlinePayload
  | ImageInlineLayoutPayload

export interface LayoutDebugOverlay {
  readonly boxes: readonly LayoutDebugBox[]
}

export interface ParagraphPageBreakPolicy {
  readonly widowControl: boolean
  readonly orphanLines: number
  readonly widowLines: number
}

export interface LayoutDebugBox extends LayoutRect {
  readonly kind: 'page' | 'line' | 'fragment'
  readonly id: string
}

export interface ParagraphListMarker {
  readonly kind: 'bullet' | 'ordered'
  readonly label: string
  readonly text: string
  readonly level: number
  readonly gapTwips: number
  readonly list: ParagraphList
}

export interface LayoutLookupCache {
  readonly containerOrderByKey: ReadonlyMap<string, number>
  readonly fragmentsByContainerKey: ReadonlyMap<string, readonly TextFragment[]>
  readonly inlinesByPositionKey: ReadonlyMap<string, readonly InlineBox[]>
}

export interface MutablePageBox {
  kind: 'page'
  pageIndex: number
  x: number
  y: number
  width: number
  height: number
  sectionBoundary: 'single' | 'mixed'
  sectionIds: string[]
  sectionId?: string
  pageLayout?: Section['page']
  headerIds: readonly string[]
  footerIds: readonly string[]
  lines: LineBox[]
  paragraphs: MutableParagraphBox[]
  blocks: BlockBox[]
  contentRect: LayoutRect
}

export interface MutableParagraphBox {
  kind: 'paragraph'
  pageIndex: number
  sectionId: string
  paragraphId: string
  alignment: 'left' | 'center' | 'right' | 'justify'
  indentLeftTwips: number
  firstLineIndentTwips: number
  hangingIndentTwips: number
  spacingBeforeTwips: number
  spacingAfterTwips: number
  x: number
  y: number
  width: number
  height: number
  lines: LineBox[]
  pageBreakPolicy: ParagraphPageBreakPolicy
  listMarker?: ParagraphListMarker
}

export interface MutableLineBox {
  kind: 'line'
  pageIndex: number
  sectionId: string
  paragraphId: string
  x: number
  y: number
  width: number
  height: number
  baseline: number
  fragments: TextFragment[]
  inlines: InlineBox[]
}

export interface LayoutCursor {
  page: MutablePageBox
  paragraph: MutableParagraphBox | undefined
  line: MutableLineBox | undefined
  y: number
  x: number
  paragraphLineCounts?: Map<string, number>
  listCounters?: Map<string, number[]>
}

export interface IncrementalLayoutContext {
  readonly previousLayout: DocumentLayout
  readonly dirtyPageIndex: number
  readonly dirtyPageEndIndex: number
  readonly prefixPages: readonly PageBox[]
  readonly sourceProjection: DocumentProjection
  readonly sourceStartPosition?: TextPosition
  readonly pageLimit?: number
  continuation?: Readonly<{
    dirtyPageIndex: number
    dirtyPageEndIndex: number
    startPosition: TextPosition
  }>
  stoppedAtPageIndex?: number
}

export interface IncrementalLayoutPassInput extends LayoutInput {
  readonly dirtyPageEndIndex?: number
  readonly startPosition?: TextPosition
  readonly maxPages?: number
}
