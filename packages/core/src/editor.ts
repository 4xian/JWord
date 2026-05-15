/**
 * 职责：提供 Gate 1 第一版 Editor facade，串联文档创建、fixture 加载、事务执行、事件和 DOM 挂载生命周期。
 * 边界：不实现输入系统、布局、渲染、docx/PDF、协同 provider 或 UI toolbar。
 * 协作模块：文档状态、事务管线、只读投影、历史、examples/vanilla 和后续 UI wrapper。
 * 性能/安全约束：constructor/top-level 不访问 window/document/HTMLElement 实例，DOM 只在 mount 后创建，编辑命令统一进入 transaction pipeline。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/03-architecture.md 与 04-engineering-standards.md#45-模块边界。
 */

import * as Y from 'yjs'

import { createCanvasPool } from './canvas-pool'
import type { CanvasLike } from './canvas-pool'
import { syncPageCanvases } from './canvas-renderer'
import {
  buildSetBackgroundColorCommand,
  buildSetBoldCommand,
  buildSetFontFamilyCommand,
  buildSetFontSizeCommand,
  buildSetItalicCommand,
  buildSetParagraphAlignmentCommand,
  buildSetStrikeCommand,
  buildSetTextColorCommand,
  buildSetUnderlineCommand
} from './command-builders'
import {
  DOCUMENT_STORE_FIELDS,
  DOCUMENT_STORE_SCHEMA_VERSION,
  createDocumentStore,
  createParagraphRecord,
  createRunRecord,
  createSectionRecord,
  getParagraphRuns,
  getRunText,
  getSectionBlocks,
  getTableCellBlocks,
  getTableRowCells,
  getTableRows
} from './document-store'
import type { BlockRecord, DocumentStore, DocumentStoreJson, ResourceId, StyleId } from './document-store'
import { createJWordError } from './errors'
import { createFontManager } from './font-manager'
import { createSelectionFormattingState } from './formatting-state'
import type { ParagraphAlignment, SelectionFormattingState } from './formatting-types'
import { countGraphemes } from './grapheme'
import { splitGraphemes } from './grapheme'
import { DEFAULT_HISTORY_ORIGIN, createHistoryManager } from './history'
import type { HistoryOperationResult } from './history'
import {
  getCaretRect as getLayoutCaretRect,
  getSelectionRects as getLayoutSelectionRects,
  hitTestDocumentLayout,
  layoutDocument,
  layoutDocumentIncrementally
} from './layout'
import type { DocumentLayout, LayoutBox, LayoutDirtyRange, LayoutRect, PageBox, LineBox } from './layout'
import { createLayoutSchedule } from './layout-scheduler'
import { cssPxToTwips, createPageConfig, twipsToCssPx } from './page-config'
import { createAnchorRef, createTextAnchorRef, resolveAnchorRef } from './position'
import { readAnchorRefSnapshot } from './position'
import type { AnchorRef, BlockId, CommentId, DocumentId, RangeRef, RevisionId, RunId, SectionId } from './position'
import { createGraphemeIndex } from './position'
import { createDocumentProjection } from './projection'
import type { DocumentProjection } from './projection'
import { collectSelectionTargets } from './selection-targets'
import {
  createSelectionRestoreSnapshot,
  createSelectionState,
  isSelectionCollapsed,
  restoreSelection
} from './selection'
import type { SelectionState } from './selection'
import { createTransactionPipeline } from './transaction'
import type { Command, Operation, TextPosition, TransactionEvent, TransactionMetadata, TransactionResult } from './transaction'
import { computeViewportPages } from './viewport-virtualizer'

const DEFAULT_EDITOR_LABEL = 'JWord editor'
const DEFAULT_DOCUMENT_ID = 'document-1'
const DEFAULT_SECTION_ID = 'section-1'
const DOCUMENT_CREATE_ORIGIN = 'jword-document'
const FIXTURE_LOAD_ORIGIN = 'jword-fixture'

/**
 * 创建 JWord editor 实例时使用的选项。
 *
 * @remarks
 * Gate 1 第一版只接受无障碍标签和初始纯文本文档。
 * 不创建布局、渲染或输入处理器。
 *
 * @example
 * ```ts
 * const editor = createEditor({ label: 'Contract draft', initialText: 'Hello' });
 * editor.mount(document.querySelector('#editor')!);
 * ```
 */
export interface EditorOptions {
  /**
   * 挂载后编辑器外壳使用的无障碍标签。
   *
   * @defaultValue `"JWord editor"`
   */
  readonly label?: string

  /**
   * 初始化文档的纯文本内容。
   *
   * @defaultValue `""`
   */
  readonly initialText?: string
}

/**
 * 纯文本 fixture 输入。
 *
 * @remarks
 * core 不读取磁盘；测试、示例或集成方负责读取 fixture 文件后把文本传入这里。
 */
export interface EditorFixture {
  /** fixture 名称，仅用于事件诊断。 */
  readonly name?: string
  /** fixture 的纯文本内容，空行会被切分为段落。 */
  readonly text: string
  /** 可选文档 ID；未提供时使用稳定默认值。 */
  readonly documentId?: string
  /** 可选节 ID；未提供时使用稳定默认值。 */
  readonly sectionId?: string
}

/**
 * 创建或重置文档时使用的输入。
 */
export interface EditorDocumentInput {
  /** 可选文档 ID；未提供时使用稳定默认值。 */
  readonly documentId?: string
  /** 可选节 ID；未提供时使用稳定默认值。 */
  readonly sectionId?: string
  /** 初始纯文本内容，空行会被切分为段落。 */
  readonly text?: string
}

/**
 * 创建文本锚点时使用的公开输入。
 */
export interface EditorTextAnchorInput {
  /** 目标节 ID，通常来自当前 projection。 */
  readonly sectionId: string
  /** 目标段落块 ID，通常来自当前 projection。 */
  readonly blockId: string
  /** 目标 run ID，通常来自当前 projection。 */
  readonly runId: string
  /** run 内 grapheme 边界下标。 */
  readonly graphemeIndex: number
  /** Y.RelativePosition 的关联方向。 */
  readonly assoc?: number
}

/**
 * Gate 2 hit-test 使用的页面内 twip 坐标。
 */
export interface EditorHitTestPoint {
  /** 目标页下标。 */
  readonly pageIndex: number
  /** 页面内 x 坐标，单位 twip。 */
  readonly x: number
  /** 页面内 y 坐标，单位 twip。 */
  readonly y: number
}

/**
 * 执行命令时使用的选项。
 */
export interface EditorCommandOptions {
  /**
   * 事务来源。
   *
   * @defaultValue `"local-user"`
   */
  readonly origin?: string
  /** 事务标签，会进入 transaction metadata。 */
  readonly label?: string
  /**
   * 命令成功后要落到 facade runtime 的选择区。
   *
   * @remarks
   * 该值不写入文档模型，只进入 history restore metadata。
   */
  readonly selectionAfter?: SelectionState | null
}

/**
 * Editor facade 对外事件。
 */
export type EditorEvent =
  | {
      readonly kind: 'transaction'
      readonly transaction: TransactionEvent
    }
  | {
      readonly kind: 'selectionChange'
      readonly selection: SelectionState | null
      readonly formattingState: SelectionFormattingState
    }
  | {
      readonly kind: 'destroyed'
    }

/**
 * Editor 事件监听器。
 */
export type EditorEventListener = (event: EditorEvent) => void

/**
 * JWord editor 的公开 facade。
 *
 * @remarks
 * facade 可在非 DOM 环境安全创建。浏览器 DOM 只在 {@link Editor.mount} 中访问。
 * 所有编辑命令都通过 {@link Editor.executeCommand} 进入 transaction pipeline。
 */
export interface Editor {
  /**
   * 读取当前只读文档投影。
   *
   * @returns 当前 Y.Doc 派生出的只读 projection。
   * @remarks
   * 无副作用，不暴露可写 Yjs 容器。
   *
   * @example
   * ```ts
   * const projection = editor.getProjection();
   * ```
   */
  getProjection(): DocumentProjection

  /**
   * 创建或重置当前文档。
   *
   * @param input 初始纯文本和可选 ID。
   * @returns 重置后的只读 projection。
   * @remarks
   * 副作用：替换当前 Y.Doc 内的文档根和正文节；该初始化事务不进入用户 undo 栈。
   *
   * @example
   * ```ts
   * editor.createDocument({ text: '第一段' });
   * ```
   */
  createDocument(input?: EditorDocumentInput): DocumentProjection

  /**
   * 加载纯文本 fixture。
   *
   * @param fixture 已由调用方读取的 fixture 文本。
   * @returns 加载后的只读 projection。
   * @remarks
   * 副作用：替换当前文档内容并发布 `fixture-loaded` 事件；core 不读取磁盘。
   *
   * @example
   * ```ts
   * editor.loadFixture({ name: 'minimal', text: 'Title\\n\\nBody' });
   * ```
   */
  loadFixture(fixture: EditorFixture): DocumentProjection

  /**
   * 创建可交给 command 使用的文本锚点。
   *
   * @param input 目标 section、block、run 和 grapheme 边界。
   * @returns 不暴露内部结构的 AnchorRef。
   * @throws Error 当目标 run 不存在或 grapheme 边界越界时抛出。
   *
   * @example
   * ```ts
   * const anchor = editor.createTextAnchor({
   *   sectionId: 'section-1',
   *   blockId: 'paragraph-1',
   *   runId: 'run-1',
   *   graphemeIndex: 0
   * });
   * ```
   */
  createTextAnchor(input: EditorTextAnchorInput): AnchorRef

  /**
   * 把运行时 AnchorRef 解析成可序列化文本位置。
   *
   * @param anchor 已创建的稳定锚点。
   * @returns 可放入 Operation 的 JSON 兼容位置。
   */
  resolveTextPosition(anchor: AnchorRef): TextPosition

  /**
   * 读取当前分页布局。
   *
   * @returns 由当前只读 projection 派生的 DocumentLayout。
   * @remarks
   * 无副作用，不读取 DOM，不暴露可写 Yjs 容器；调用方可用它调试 page/line/fragment 边界。
   */
  getLayout(): DocumentLayout

  /**
   * 把页面坐标映射为稳定 AnchorRef。
   *
   * @param point 页面下标和页面内 twip 坐标。
   * @returns 命中的 AnchorRef；未命中文本时返回 undefined。
   */
  hitTest(point: EditorHitTestPoint): AnchorRef | undefined

  /**
   * 把 AnchorRef 映射为 caret rect。
   *
   * @param anchor 稳定锚点。
   * @returns caret rect；锚点无法映射到当前布局时返回 undefined。
   */
  getCaretRect(anchor: AnchorRef): LayoutRect | undefined

  /**
   * 把 RangeRef 映射为 selection rects。
   *
   * @param range 稳定范围。
   * @returns 每行一个选区矩形。
   */
  getSelectionRects(range: RangeRef): readonly LayoutRect[]

  /**
   * 读取当前 facade runtime 选择区。
   *
   * @returns 当前选择区；没有光标或选区时返回 null。
   * @remarks
   * 无副作用，不读取 DOM，不暴露可写文档模型。
   */
  getSelection(): SelectionState | null

  /**
   * 读取当前 selection 对应的只读 formatting state。
   *
   * @returns 当前选区聚合出的 run/paragraph 格式状态。
   * @remarks
   * 供 toolbar 等 UI 同步状态时直接读取，不需要访问 projection 细节。
   */
  getSelectionFormattingState(): SelectionFormattingState

  /**
   * 设置当前 facade runtime 选择区。
   *
   * @param selection 当前选择区；传入 null 表示清空选择区。
   * @remarks
   * 只更新 facade 运行时状态，不写入 Y.Doc，不创建第二套文档模型。
   */
  setSelection(selection: SelectionState | null): void

  /**
   * 切换当前选择区的加粗状态。
   *
   * @remarks
   * 只通过 facade 构造 command 并进入 transaction pipeline，不直接改写文档状态。
   */
  toggleBold(): void

  /**
   * 切换当前选择区的斜体状态。
   *
   * @remarks
   * 只通过 facade 构造 command 并进入 transaction pipeline，不直接改写文档状态。
   */
  toggleItalic(): void

  /**
   * 切换当前选择区的下划线状态。
   *
   * @remarks
   * 只通过 facade 构造 command 并进入 transaction pipeline，不直接改写文档状态。
   */
  toggleUnderline(): void

  /**
   * 切换当前选择区的删除线状态。
   *
   * @remarks
   * 只通过 facade 构造 command 并进入 transaction pipeline，不直接改写文档状态。
   */
  toggleStrike(): void

  /**
   * 设置当前选择区的字体名称。
   *
   * @param value 目标字体名称。
   */
  setFontFamily(value: string): void

  /**
   * 设置当前选择区的字号 twips。
   *
   * @param value 目标字号 twips。
   */
  setFontSize(value: number): void

  /**
   * 设置当前选择区的文字颜色。
   *
   * @param value 目标颜色值。
   */
  setTextColor(value: string): void

  /**
   * 设置当前选择区的背景颜色。
   *
   * @param value 目标颜色值。
   */
  setBackgroundColor(value: string): void

  /**
   * 设置当前选择区段落的对齐方式。
   *
   * @param value 目标段落对齐值。
   */
  setParagraphAlignment(value: ParagraphAlignment): void

  /**
   * 按 twips 增量调整当前选择区段落缩进。
   *
   * @param deltaTwips 缩进增量，正数增加，负数减少。
   */
  adjustParagraphIndent(deltaTwips: number): void

  /**
   * 执行编辑命令。
   *
   * @param command Command 语义和最小 Operation 列表。
   * @param options origin 和可选标签。
   * @returns transaction pipeline 的执行结果。
   * @throws Error 当 command 或 operation 非法时由 transaction pipeline 抛出。
   * @remarks
   * 副作用：写入 Y.Doc、更新 projection、发布 `transaction` 事件；默认 origin 进入用户 undo 栈。
   *
   * @example
   * ```ts
   * editor.executeCommand({
   *   name: 'insertText',
   *   operations: [{ kind: 'insertText', at: editor.resolveTextPosition(anchor), text: '你好' }]
   * });
   * ```
   */
  executeCommand(command: Command, options?: EditorCommandOptions): TransactionResult

  /**
   * 撤销最近一次本地用户历史操作。
   *
   * @returns history manager 的 undo 结果。
   * @remarks
   * 副作用：通过 Y.UndoManager 回滚 Y.Doc；远端或自动插入 origin 默认不进入用户 undo 栈。
   */
  undo(): HistoryOperationResult

  /**
   * 重做最近一次撤销的本地用户历史操作。
   *
   * @returns history manager 的 redo 结果。
   * @remarks
   * 副作用：通过 Y.UndoManager 恢复 Y.Doc。
   */
  redo(): HistoryOperationResult

  /**
   * 判断当前是否存在可撤销的用户历史项。
   *
   * @returns 是否可撤销。
   */
  canUndo(): boolean

  /**
   * 判断当前是否存在可重做的用户历史项。
   *
   * @returns 是否可重做。
   */
  canRedo(): boolean

  /**
   * 监听 facade 事件。
   *
   * @param listener 事件监听器。
   * @returns 取消监听函数。
   * @remarks
   * 副作用：只登记内存监听器，不触发 DOM 或网络访问。
   *
   * @example
   * ```ts
   * const unsubscribe = editor.subscribe((event) => console.log(event.kind));
   * unsubscribe();
   * ```
   */
  subscribe(listener: EditorEventListener): () => void

  /**
   * 将编辑器外壳挂载到 host 元素。
   *
   * @param host 集成应用持有的现有 DOM 元素。
   * @throws Error 当编辑器已经挂载时抛出。
   * @returns 无返回值。
   * @remarks
   * 副作用：向 `host` 追加 `jw-editor` 外壳和 canvas 容器。
   *
   * @example
   * ```ts
   * const editor = createEditor();
   * editor.mount(document.body);
   * ```
   */
  mount(host: HTMLElement): void

  /**
   * 销毁已挂载的编辑器外壳。
   *
   * @returns 无返回值。
   * @remarks
   * 副作用：移除本 editor 创建的 DOM。重复调用安全，首次成功清理后不再执行操作。
   *
   * @example
   * ```ts
   * const editor = createEditor();
   * editor.destroy();
   * ```
   */
  destroy(): void
}

interface MountedEditorDom {
  readonly shell: HTMLElement
  readonly canvasContainer: HTMLElement
  readonly hiddenTextarea: HTMLTextAreaElement
  readonly liveRegion: HTMLElement
  readonly textMirror: HTMLElement
  readonly handleScroll: () => void
  readonly handleInput: (event: Event) => void
  readonly handleKeyDown: (event: KeyboardEvent) => void
  readonly handleCopy: (event: Event) => void
  readonly handleCut: (event: Event) => void
  readonly handlePaste: (event: Event) => void
  readonly handlePointerDown: (event: MouseEvent) => void
  readonly handlePointerMove: (event: MouseEvent) => void
  readonly handlePointerUp: (event: MouseEvent) => void
  readonly handleDoubleClick: (event: MouseEvent) => void
  readonly handleCompositionStart: (event: Event) => void
  readonly handleCompositionUpdate: (event: Event) => void
  readonly handleCompositionEnd: (event: Event) => void
  readonly pool: ReturnType<typeof createCanvasPool>
  readonly pageWrappers: Map<number, HTMLElement>
  readonly inputState: {
    isComposing: boolean
    compositionText: string
    pendingPlainInputText: string
  }
  readonly pointerState: {
    anchor: AnchorRef | null
  }
  canvases: Map<number, CanvasLike>
  deferredRender: {
    timeoutId: ReturnType<typeof setTimeout>
    chunkSize: number
    continuation: Readonly<{
      dirtyPageIndex: number
      dirtyPageEndIndex: number
      startPosition: TextPosition
    }>
  } | undefined
}

interface TransientLayoutQuerySnapshot {
  readonly layout?: DocumentLayout
  readonly continuation?: Readonly<{
    dirtyPageIndex: number
    dirtyPageEndIndex: number
    startPosition: TextPosition
  }>
  readonly staleFromPageIndex?: number
  readonly needsInitialPass: boolean
}

type EditorPageElement = HTMLElement

type RenderReason = 'mount' | 'document' | 'selection' | 'viewport'

type SelectionUpdateSource =
  | 'api'
  | 'command'
  | 'document'
  | 'history'
  | 'keyboard'
  | 'pointer'

class JWordEditor implements Editor {
  private readonly label: string
  private readonly store: DocumentStore
  private readonly pipeline: ReturnType<typeof createTransactionPipeline>
  private readonly history: ReturnType<typeof createHistoryManager>
  private readonly pageConfig = createPageConfig()
  private readonly fontManager = createFontManager()
  private readonly listeners = new Set<EditorEventListener>()
  private readonly unsubscribePipeline: () => void
  private currentProjection!: DocumentProjection
  private cachedLayout: DocumentLayout | undefined
  private layoutDirtyRange: LayoutDirtyRange | undefined
  private layoutNeedsRefresh = false
  private pageStartKeys: readonly string[] = []
  private dirtyPageIndex = 0
  private dirtyPageEndIndex = 0
  private pendingLayoutContinuation: Readonly<{
    dirtyPageIndex: number
    dirtyPageEndIndex: number
    startPosition: TextPosition
  }> | undefined
  private mountedDom: MountedEditorDom | undefined
  private currentSelection: SelectionState | null = null
  private selectionPageIndexes: readonly number[] = []
  private mountedTextMirrorNeedsRefresh = true
  private isDestroyed = false

  constructor(options?: EditorOptions) {
    this.label = options?.label ?? DEFAULT_EDITOR_LABEL
    this.store = createDocumentStore()
    this.pipeline = createTransactionPipeline(this.store.doc)
    this.history = createHistoryManager(this.store)
    this.unsubscribePipeline = this.pipeline.subscribe((event) => {
      this.currentProjection = event.projection
      this.layoutNeedsRefresh = true
      this.mountedTextMirrorNeedsRefresh = true
      this.renderMountedLayout('document')
      this.emit({ kind: 'transaction', transaction: event })
    })
    this.replaceDocument(
      options?.initialText === undefined ? {} : { text: options.initialText },
      'createDocument',
      DOCUMENT_CREATE_ORIGIN
    )
  }

  getProjection(): DocumentProjection {
    this.assertActive()

    return this.currentProjection
  }

  createDocument(input: EditorDocumentInput = {}): DocumentProjection {
    this.assertActive()

    return this.replaceDocument(input, 'createDocument', DOCUMENT_CREATE_ORIGIN)
  }

  loadFixture(fixture: EditorFixture): DocumentProjection {
    this.assertActive()

    return this.replaceDocument(fixture, 'loadFixture', FIXTURE_LOAD_ORIGIN)
  }

  createTextAnchor(input: EditorTextAnchorInput): AnchorRef {
    this.assertActive()

    const text = findRunText(this.store, input)

    return createTextAnchorRef({
      documentId: readCurrentDocumentId(this.store),
      sectionId: input.sectionId as SectionId,
      blockId: input.blockId as BlockId,
      runId: input.runId as RunId,
      graphemeIndex: createGraphemeIndex(input.graphemeIndex),
      text,
      ...(input.assoc === undefined ? {} : { assoc: input.assoc })
    })
  }

  resolveTextPosition(anchor: AnchorRef): TextPosition {
    this.assertActive()

    const snapshot = resolveAnchorRef(anchor, this.store.doc)

    if (snapshot === undefined) {
      throw createJWordError('OPERATION_ANCHOR_UNRESOLVED', '锚点无法解析')
    }

    return {
      sectionId: String(snapshot.sectionId),
      blockId: String(snapshot.blockId),
      runId: String(snapshot.runId),
      graphemeIndex: Number(snapshot.graphemeIndex),
      ...(snapshot.assoc === undefined ? {} : { assoc: snapshot.assoc })
    }
  }

  getLayout(): DocumentLayout {
    this.assertActive()

    return this.readLayoutForQuery()
  }

  hitTest(point: EditorHitTestPoint): AnchorRef | undefined {
    this.assertActive()

    const position = hitTestDocumentLayout(this.readTransientLayoutThroughPage(point.pageIndex), point)

    if (position === undefined) {
      return undefined
    }

    return this.createTextAnchor({
      sectionId: position.sectionId,
      blockId: position.blockId,
      runId: position.runId,
      graphemeIndex: position.graphemeIndex,
      ...(position.assoc === undefined ? {} : { assoc: position.assoc })
    })
  }

  getCaretRect(anchor: AnchorRef): LayoutRect | undefined {
    this.assertActive()

    const position = this.resolveTextPosition(anchor)
    const snapshot = readAnchorRefSnapshot(anchor)

    return getLayoutCaretRect(this.readTransientLayoutForPosition(position), {
      ...position,
      ...(snapshot.assoc === undefined ? {} : { assoc: snapshot.assoc })
    })
  }

  getSelectionRects(range: RangeRef): readonly LayoutRect[] {
    this.assertActive()

    const resolvedRange = {
      anchor: this.resolveTextPosition(range.anchor),
      focus: this.resolveTextPosition(range.focus)
    }

    return getLayoutSelectionRects(this.readTransientLayoutForRange(resolvedRange), resolvedRange)
  }

  getSelection(): SelectionState | null {
    this.assertActive()

    return this.currentSelection
  }

  getSelectionFormattingState(): SelectionFormattingState {
    this.assertActive()

    return createSelectionFormattingState(this.currentProjection, this.currentSelection)
  }

  setSelection(selection: SelectionState | null): void {
    this.assertActive()

    this.commitSelection(selection, {
      source: 'api'
    })
  }

  toggleBold(): void {
    this.assertActive()
    this.executeFacadeFormattingCommand(buildSetBoldCommand(
      this.currentProjection,
      this.currentSelection,
      this.getSelectionFormattingState().run?.bold.value !== true
    ))
  }

  toggleItalic(): void {
    this.assertActive()
    this.executeFacadeFormattingCommand(buildSetItalicCommand(
      this.currentProjection,
      this.currentSelection,
      this.getSelectionFormattingState().run?.italic.value !== true
    ))
  }

  toggleUnderline(): void {
    this.assertActive()
    this.executeFacadeFormattingCommand(buildSetUnderlineCommand(
      this.currentProjection,
      this.currentSelection,
      this.getSelectionFormattingState().run?.underline.value !== true
    ))
  }

  toggleStrike(): void {
    this.assertActive()
    this.executeFacadeFormattingCommand(buildSetStrikeCommand(
      this.currentProjection,
      this.currentSelection,
      this.getSelectionFormattingState().run?.strike.value !== true
    ))
  }

  setFontFamily(value: string): void {
    this.assertActive()
    this.executeFacadeFormattingCommand(buildSetFontFamilyCommand(
      this.currentProjection,
      this.currentSelection,
      value
    ))
  }

  setFontSize(value: number): void {
    this.assertActive()
    this.executeFacadeFormattingCommand(buildSetFontSizeCommand(
      this.currentProjection,
      this.currentSelection,
      value
    ))
  }

  setTextColor(value: string): void {
    this.assertActive()
    this.executeFacadeFormattingCommand(buildSetTextColorCommand(
      this.currentProjection,
      this.currentSelection,
      value
    ))
  }

  setBackgroundColor(value: string): void {
    this.assertActive()
    this.executeFacadeFormattingCommand(buildSetBackgroundColorCommand(
      this.currentProjection,
      this.currentSelection,
      value
    ))
  }

  setParagraphAlignment(value: ParagraphAlignment): void {
    this.assertActive()
    this.executeFacadeFormattingCommand(buildSetParagraphAlignmentCommand(
      this.currentProjection,
      this.currentSelection,
      value
    ))
  }

  adjustParagraphIndent(deltaTwips: number): void {
    this.assertActive()

    if (deltaTwips === 0) {
      return
    }

    const targets = collectSelectionTargets(this.currentProjection, this.currentSelection)

    if (targets.paragraphs.length === 0) {
      return
    }

    const command = {
      name: 'adjustParagraphIndent',
      operations: targets.paragraphs.flatMap((target) => {
        const currentIndent = typeof target.paragraph.properties?.indentLeftTwips === 'number'
          ? target.paragraph.properties.indentLeftTwips
          : 0
        const nextIndent = currentIndent + deltaTwips

        return currentIndent === nextIndent
          ? []
          : [{
              kind: 'setParagraphProperties' as const,
              paragraphId: target.paragraph.id,
              properties: { indentLeftTwips: nextIndent }
            }]
      })
    }

    if (command.operations.length === 0) {
      return
    }

    this.executeCommand(command, {
      selectionAfter: this.currentSelection
    })
  }

  executeCommand(command: Command, options: EditorCommandOptions = {}): TransactionResult {
    this.assertActive()

    const origin = options.origin ?? DEFAULT_HISTORY_ORIGIN
    const metadata = createTransactionMetadata(origin, options.label)
    const shouldTrackHistory = this.history.trackedOrigins.has(origin) && command.operations.length > 0
    const selectionBefore = this.currentSelection
    const hasSelectionAfter = 'selectionAfter' in options
    const selectionAfter = hasSelectionAfter ? options.selectionAfter ?? null : this.currentSelection
    const dirtyPageBounds = this.resolveCommandDirtyPageBounds(command)
    const fallbackDirtyPageIndex = this.resolveCurrentSelectionPageIndex() ?? 0

    this.dirtyPageIndex = dirtyPageBounds?.start ?? fallbackDirtyPageIndex
    this.dirtyPageEndIndex = dirtyPageBounds?.end ?? this.dirtyPageIndex
    this.layoutDirtyRange = resolveCommandDirtyRange(command)

    if (shouldTrackHistory) {
      this.history.stopCapturing()
      this.history.captureNextTransaction({
        commandName: command.name,
        origin,
        ...(options.label === undefined ? {} : { description: options.label }),
        selectionBefore: createSelectionRestoreSnapshot(selectionBefore),
        selectionAfter: createSelectionRestoreSnapshot(selectionAfter)
      })
    }

    try {
      if (hasSelectionAfter) {
        this.commitSelection(selectionAfter, {
          source: 'command',
          render: false,
          emit: false
        })
      }

      const result = this.pipeline.run(command, metadata)

      if (!hasSelectionAfter) {
        this.refreshMountedSelectionRuntime(selectionBefore)
      }
      this.emitSelectionChange()

      return result
    } catch (error) {
      if (hasSelectionAfter) {
        this.commitSelection(selectionBefore, {
          source: 'command',
          render: false,
          emit: false
        })
      }

      if (shouldTrackHistory) {
        this.history.discardNextTransactionMetadata()
      }

      throw error
    }
  }

  undo(): HistoryOperationResult {
    this.assertActive()

    const result = this.history.undo()

    if (result.stackItem !== null) {
      this.currentProjection = createDocumentProjection(this.store)
      this.layoutNeedsRefresh = true
      this.dirtyPageIndex = 0
      this.dirtyPageEndIndex = 0
      this.layoutDirtyRange = undefined
      this.mountedTextMirrorNeedsRefresh = true
    }

    if (result.metadata?.selectionBefore !== undefined) {
      this.commitSelection(restoreSelection(result.metadata.selectionBefore), {
        source: 'history',
        render: false,
        emit: false
      })
    }

    if (result.stackItem !== null) {
      this.renderMountedLayout('document')
    }
    this.emitSelectionChange()

    return result
  }

  redo(): HistoryOperationResult {
    this.assertActive()

    const result = this.history.redo()

    if (result.stackItem !== null) {
      this.currentProjection = createDocumentProjection(this.store)
      this.layoutNeedsRefresh = true
      this.dirtyPageIndex = 0
      this.dirtyPageEndIndex = 0
      this.layoutDirtyRange = undefined
      this.mountedTextMirrorNeedsRefresh = true
    }

    if (result.metadata?.selectionAfter !== undefined) {
      this.commitSelection(restoreSelection(result.metadata.selectionAfter), {
        source: 'history',
        render: false,
        emit: false
      })
    }

    if (result.stackItem !== null) {
      this.renderMountedLayout('document')
    }
    this.emitSelectionChange()

    return result
  }

  canUndo(): boolean {
    this.assertActive()

    return this.history.canUndo()
  }

  canRedo(): boolean {
    this.assertActive()

    return this.history.canRedo()
  }

  subscribe(listener: EditorEventListener): () => void {
    this.assertActive()
    this.listeners.add(listener)

    return () => {
      this.listeners.delete(listener)
    }
  }

  mount(host: HTMLElement): void {
    this.assertActive()

    if (this.mountedDom !== undefined) {
      throw createJWordError('EDITOR_ALREADY_MOUNTED', 'JWord editor is already mounted.')
    }

    const ownerDocument = host.ownerDocument
    const shell = ownerDocument.createElement('div')
    shell.className = 'jw-editor'
    shell.setAttribute('data-jword-editor', '')
    shell.setAttribute('role', 'application')
    shell.setAttribute('aria-label', this.label)

    const canvasContainer = ownerDocument.createElement('div')
    canvasContainer.className = 'jw-editor__canvas-container'
    canvasContainer.setAttribute('data-jword-canvas-container', '')
    const hiddenTextarea = createHiddenTextareaElement(ownerDocument)
    const liveRegion = createLiveRegionElement(ownerDocument)
    const textMirror = createTextMirrorElement(ownerDocument)
    shell.style.width = '100%'
    shell.style.height = '100%'
    shell.style.position = 'relative'
    canvasContainer.style.width = '100%'
    canvasContainer.style.height = '100%'
    canvasContainer.style.overflow = 'auto'
    canvasContainer.style.position = 'relative'

    const handleScroll = () => {
      this.renderMountedLayout('viewport')
    }
    const handleInput = (event: Event) => {
      this.handleRuntimeInput(event)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      this.handleRuntimeKeyDown(event)
    }
    const handleCopy = (event: Event) => {
      this.handleRuntimeCopy(event)
    }
    const handleCut = (event: Event) => {
      this.handleRuntimeCut(event)
    }
    const handlePaste = (event: Event) => {
      this.handleRuntimePaste(event)
    }
    const handlePointerDown = (event: MouseEvent) => {
      this.handleRuntimePointerDown(event)
    }
    const handlePointerMove = (event: MouseEvent) => {
      this.handleRuntimePointerMove(event)
    }
    const handlePointerUp = (event: MouseEvent) => {
      this.handleRuntimePointerUp(event)
    }
    const handleDoubleClick = (event: MouseEvent) => {
      this.handleRuntimeDoubleClick(event)
    }
    const handleCompositionStart = (event: Event) => {
      this.handleRuntimeCompositionStart(event)
    }
    const handleCompositionUpdate = (event: Event) => {
      this.handleRuntimeCompositionUpdate(event)
    }
    const handleCompositionEnd = (event: Event) => {
      this.handleRuntimeCompositionEnd(event)
    }

    canvasContainer.addEventListener('scroll', handleScroll)
    canvasContainer.addEventListener('mousedown', handlePointerDown)
    canvasContainer.addEventListener('mousemove', handlePointerMove)
    canvasContainer.addEventListener('mouseup', handlePointerUp)
    canvasContainer.addEventListener('dblclick', handleDoubleClick)
    hiddenTextarea.addEventListener('input', handleInput)
    hiddenTextarea.addEventListener('keydown', handleKeyDown)
    hiddenTextarea.addEventListener('copy', handleCopy)
    hiddenTextarea.addEventListener('cut', handleCut)
    hiddenTextarea.addEventListener('paste', handlePaste)
    hiddenTextarea.addEventListener('compositionstart', handleCompositionStart)
    hiddenTextarea.addEventListener('compositionupdate', handleCompositionUpdate)
    hiddenTextarea.addEventListener('compositionend', handleCompositionEnd)
    shell.append(canvasContainer, hiddenTextarea, liveRegion, textMirror)
    host.append(shell)

    this.mountedDom = {
      shell,
      canvasContainer,
      hiddenTextarea,
      liveRegion,
      textMirror,
      handleScroll,
      handleInput,
      handleKeyDown,
      handleCopy,
      handleCut,
      handlePaste,
      handlePointerDown,
      handlePointerMove,
      handlePointerUp,
      handleDoubleClick,
      handleCompositionStart,
      handleCompositionUpdate,
      handleCompositionEnd,
      pool: createCanvasPool({
        createCanvas: () => createCanvasElement(ownerDocument)
      }),
      pageWrappers: new Map(),
      inputState: {
        isComposing: false,
        compositionText: '',
        pendingPlainInputText: ''
      },
      pointerState: {
        anchor: null
      },
      canvases: new Map(),
      deferredRender: undefined
    }
    this.renderMountedLayout('mount')
  }

  destroy(): void {
    if (this.isDestroyed) {
      return
    }

    if (this.mountedDom !== undefined) {
      this.cancelDeferredRender()
      this.mountedDom.canvasContainer.removeEventListener('scroll', this.mountedDom.handleScroll)
      this.mountedDom.canvasContainer.removeEventListener('mousedown', this.mountedDom.handlePointerDown)
      this.mountedDom.canvasContainer.removeEventListener('mousemove', this.mountedDom.handlePointerMove)
      this.mountedDom.canvasContainer.removeEventListener('mouseup', this.mountedDom.handlePointerUp)
      this.mountedDom.canvasContainer.removeEventListener('dblclick', this.mountedDom.handleDoubleClick)
      this.mountedDom.hiddenTextarea.removeEventListener('input', this.mountedDom.handleInput)
      this.mountedDom.hiddenTextarea.removeEventListener('keydown', this.mountedDom.handleKeyDown)
      this.mountedDom.hiddenTextarea.removeEventListener('copy', this.mountedDom.handleCopy)
      this.mountedDom.hiddenTextarea.removeEventListener('cut', this.mountedDom.handleCut)
      this.mountedDom.hiddenTextarea.removeEventListener('paste', this.mountedDom.handlePaste)
      this.mountedDom.hiddenTextarea.removeEventListener('compositionstart', this.mountedDom.handleCompositionStart)
      this.mountedDom.hiddenTextarea.removeEventListener('compositionupdate', this.mountedDom.handleCompositionUpdate)
      this.mountedDom.hiddenTextarea.removeEventListener('compositionend', this.mountedDom.handleCompositionEnd)

      for (const canvas of this.mountedDom.canvases.values()) {
        this.mountedDom.pool.release(canvas)
      }

      this.mountedDom.shell.remove()
    }

    this.mountedDom = undefined
    this.history.clear()
    this.unsubscribePipeline()
    this.emit({ kind: 'destroyed' })
    this.listeners.clear()
    this.isDestroyed = true
  }

  private replaceDocument(
    input: EditorDocumentInput,
    commandName: string,
    origin: string
  ): DocumentProjection {
    const previousSelection = this.currentSelection

    this.dirtyPageIndex = 0
    this.dirtyPageEndIndex = 0
    this.layoutDirtyRange = undefined
    const result = this.pipeline.runMutation(commandName, { origin }, () => {
      replaceStoreDocument(this.store, input)
    })

    this.currentProjection = result.projection
    this.commitSelection(null, {
      source: 'document',
      previousSelection,
      render: true
    })

    return result.projection
  }

  private executeFacadeFormattingCommand(command: Command | null): void {
    if (command === null) {
      return
    }

    this.executeCommand(command, {
      selectionAfter: this.currentSelection
    })
  }

  private commitSelection(
    selection: SelectionState | null,
    options: Readonly<{
      source: SelectionUpdateSource
      previousSelection?: SelectionState | null
      render?: boolean
      emit?: boolean
    }>
  ): void {
    const previousSelection = options.previousSelection ?? this.currentSelection

    this.currentSelection = selection

    if (options.render !== false) {
      this.refreshMountedSelectionRuntime(previousSelection)
    }

    if (options.emit !== false) {
      this.emitSelectionChange()
    }
  }

  private renderMountedLayout(reason: RenderReason): void {
    const mountedDom = this.mountedDom

    if (mountedDom === undefined) {
      return
    }

    let layout: DocumentLayout
    let schedule: ReturnType<typeof createLayoutSchedule>

    if (reason === 'document') {
      this.cancelDeferredRender()
      const pass = this.runLayoutPass({
        maxPages: 1
      })

      layout = pass.layout
      schedule = createLayoutSchedule({
        pageCount: Math.max(layout.pages.length, (pass.continuation?.dirtyPageIndex ?? -1) + 1),
        dirtyPageIndex: this.dirtyPageIndex,
        immediatePageIndexes: pass.laidOutPageIndexes,
        ...(pass.continuation?.dirtyPageIndex === undefined
          ? {}
          : { deferredStartPageIndex: pass.continuation.dirtyPageIndex }),
        ...(pass.continuation === undefined && pass.stoppedAtPageIndex !== undefined
          ? { stoppedAtPageIndexHint: pass.stoppedAtPageIndex }
          : {}),
        chunkSize: 4
      })
    } else {
      layout = this.cachedLayout ?? this.ensureCurrentLayout()
      const nextPageStartKeys = createPageStartKeys(layout)

      schedule = createLayoutSchedule({
        pageCount: layout.pages.length,
        dirtyPageIndex: this.dirtyPageIndex,
        previousPageStartKeys: this.pageStartKeys,
        nextPageStartKeys,
        chunkSize: 4
      })
    }

    const nextPageStartKeys = createPageStartKeys(layout)
    const viewport = computeViewportPages({
      pages: layout.pages.map((page) => ({
        pageIndex: page.pageIndex,
        top: twipsToCssPx(page.y, this.pageConfig.scale),
        height: twipsToCssPx(page.height, this.pageConfig.scale)
      })),
      scrollTop: mountedDom.canvasContainer.scrollTop,
      viewportHeight: mountedDom.canvasContainer.clientHeight || this.pageConfig.heightCssPx,
      bufferPages: 1
    })
    const selectionRender = this.createSelectionRenderState(layout)
    const shouldUseSchedule = reason === 'document'
    const scheduledImmediatePageIndexes = shouldUseSchedule ? schedule.immediatePageIndexes : []
    const retainedPageIndexes = mergePageIndexes(
      viewport.retainedPageIndexes,
      scheduledImmediatePageIndexes,
      selectionRender.pageIndexes,
      this.selectionPageIndexes
    )
    const rerenderPageIndexes = mergePageIndexes(
      reason === 'mount' ? viewport.retainedPageIndexes : [],
      scheduledImmediatePageIndexes,
      selectionRender.pageIndexes,
      this.selectionPageIndexes
    )

    mountedDom.canvases = renderPageBatch({
      mountedDom,
      pages: layout.pages,
      retainedPageIndexes,
      rerenderPageIndexes,
      selectionRender,
      scale: this.pageConfig.scale,
      pixelRatio: resolveCanvasPixelRatio(mountedDom)
    })
    mountedDom.canvasContainer.setAttribute('data-jword-page-count', String(layout.pages.length))
    mountedDom.canvasContainer.setAttribute('data-jword-layout-immediate-pages', schedule.immediatePageIndexes.join(','))
    mountedDom.canvasContainer.setAttribute(
      'data-jword-layout-deferred-chunks',
      schedule.deferredChunks.map((chunk) => chunk.join(',')).join(';')
    )

    if (schedule.stoppedAtPageIndex === undefined) {
      mountedDom.canvasContainer.removeAttribute('data-jword-layout-stopped-at')
    } else {
      mountedDom.canvasContainer.setAttribute('data-jword-layout-stopped-at', String(schedule.stoppedAtPageIndex))
    }

    mountedDom.canvasContainer.setAttribute('data-jword-layout-rerender-pages', rerenderPageIndexes.join(','))
    this.pageStartKeys = nextPageStartKeys
    this.selectionPageIndexes = selectionRender.pageIndexes
    this.syncMountedAssistiveDom(layout)

    if (reason === 'document' && this.pendingLayoutContinuation !== undefined) {
      this.scheduleDeferredRender(this.pendingLayoutContinuation, 4)
    }
  }

  private ensureCurrentLayout(): DocumentLayout {
    if (this.cachedLayout !== undefined && !this.layoutNeedsRefresh && this.pendingLayoutContinuation === undefined) {
      return this.cachedLayout
    }

    if (this.pendingLayoutContinuation !== undefined && this.cachedLayout !== undefined && !this.layoutNeedsRefresh) {
      const pass = this.runLayoutPass({
        dirtyPageIndex: this.pendingLayoutContinuation.dirtyPageIndex,
        dirtyPageEndIndex: this.pendingLayoutContinuation.dirtyPageEndIndex,
        startPosition: this.pendingLayoutContinuation.startPosition
      })

      this.cancelDeferredRender()

      return pass.layout
    }

    return this.runLayoutPass().layout
  }

  private readLayoutForQuery(): DocumentLayout {
    if (this.cachedLayout !== undefined && !this.layoutNeedsRefresh) {
      return this.cachedLayout
    }

    if (!this.layoutNeedsRefresh) {
      return this.ensureCurrentLayout()
    }

    if (this.mountedDom !== undefined) {
      return this.readTransientLayoutThroughPage(this.dirtyPageEndIndex)
    }

    return this.runLayoutPass({
      maxPages: Math.max(1, this.dirtyPageEndIndex - this.dirtyPageIndex + 1)
    }).layout
  }

  private readTransientLayoutThroughPage(pageIndex: number): DocumentLayout {
    let snapshot = this.createTransientLayoutQuerySnapshot()

    while (true) {
      if (
        snapshot.layout !== undefined
        && (
          snapshot.staleFromPageIndex === undefined
          || pageIndex < snapshot.staleFromPageIndex
        )
      ) {
        return snapshot.layout
      }

      if (!this.canAdvanceTransientLayoutQuerySnapshot(snapshot)) {
        return snapshot.layout ?? this.ensureCurrentLayout()
      }

      snapshot = this.advanceTransientLayoutQuerySnapshot(
        snapshot,
        this.resolveTransientLayoutPassPageCount(snapshot, pageIndex)
      )
    }
  }

  private readTransientLayoutForPosition(position: TextPosition): DocumentLayout {
    let snapshot = this.createTransientLayoutQuerySnapshot()

    while (true) {
      const layout = snapshot.layout
      const rect = layout === undefined ? undefined : getLayoutCaretRect(layout, position)

      if (
        layout !== undefined
        && (
          snapshot.staleFromPageIndex === undefined
          || (rect !== undefined && rect.pageIndex < snapshot.staleFromPageIndex)
        )
      ) {
        return layout
      }

      if (!this.canAdvanceTransientLayoutQuerySnapshot(snapshot)) {
        return layout ?? this.ensureCurrentLayout()
      }

      snapshot = this.advanceTransientLayoutQuerySnapshot(
        snapshot,
        this.resolveTransientLayoutPassPageCount(
          snapshot,
          rect?.pageIndex ?? snapshot.staleFromPageIndex ?? this.dirtyPageEndIndex
        )
      )
    }
  }

  private readTransientLayoutForRange(range: Readonly<{
    anchor: TextPosition
    focus: TextPosition
  }>): DocumentLayout {
    if (isSameTextPosition(range.anchor, range.focus)) {
      return this.readLayoutForQuery()
    }

    let snapshot = this.createTransientLayoutQuerySnapshot()

    while (true) {
      const layout = snapshot.layout
      const anchorRect = layout === undefined ? undefined : getLayoutCaretRect(layout, range.anchor)
      const focusRect = layout === undefined ? undefined : getLayoutCaretRect(layout, range.focus)

      if (
        layout !== undefined
        && (
          snapshot.staleFromPageIndex === undefined
          || (
            anchorRect !== undefined
            && focusRect !== undefined
            && anchorRect.pageIndex < snapshot.staleFromPageIndex
            && focusRect.pageIndex < snapshot.staleFromPageIndex
          )
        )
      ) {
        return layout
      }

      if (!this.canAdvanceTransientLayoutQuerySnapshot(snapshot)) {
        return layout ?? this.ensureCurrentLayout()
      }

      snapshot = this.advanceTransientLayoutQuerySnapshot(
        snapshot,
        this.resolveTransientLayoutPassPageCount(
          snapshot,
          Math.max(
            anchorRect?.pageIndex ?? -1,
            focusRect?.pageIndex ?? -1,
            snapshot.staleFromPageIndex ?? this.dirtyPageEndIndex
          )
        )
      )
    }
  }

  private createTransientLayoutQuerySnapshot(): TransientLayoutQuerySnapshot {
    if (this.layoutNeedsRefresh) {
      return {
        ...(this.cachedLayout === undefined ? {} : { layout: this.cachedLayout }),
        staleFromPageIndex: this.dirtyPageIndex,
        needsInitialPass: true
      }
    }

    if (this.pendingLayoutContinuation !== undefined) {
      return {
        ...(this.cachedLayout === undefined ? {} : { layout: this.cachedLayout }),
        continuation: this.pendingLayoutContinuation,
        staleFromPageIndex: this.pendingLayoutContinuation.dirtyPageIndex,
        needsInitialPass: this.cachedLayout === undefined
      }
    }

    return {
      ...(this.cachedLayout === undefined ? {} : { layout: this.cachedLayout }),
      needsInitialPass: this.cachedLayout === undefined
    }
  }

  private canAdvanceTransientLayoutQuerySnapshot(snapshot: TransientLayoutQuerySnapshot): boolean {
    return snapshot.needsInitialPass || snapshot.continuation !== undefined
  }

  private resolveTransientLayoutPassPageCount(
    snapshot: TransientLayoutQuerySnapshot,
    targetPageIndex: number
  ): number | undefined {
    const normalizedTargetPageIndex = Math.max(0, targetPageIndex)

    if (snapshot.continuation !== undefined) {
      return Math.max(1, normalizedTargetPageIndex - snapshot.continuation.dirtyPageIndex + 1)
    }

    if (!snapshot.needsInitialPass || !this.layoutNeedsRefresh) {
      return undefined
    }

    return Math.max(
      1,
      this.dirtyPageEndIndex - this.dirtyPageIndex + 1,
      normalizedTargetPageIndex - this.dirtyPageIndex + 1
    )
  }

  private advanceTransientLayoutQuerySnapshot(
    snapshot: TransientLayoutQuerySnapshot,
    maxPages?: number
  ): TransientLayoutQuerySnapshot {
    const pass = layoutDocumentIncrementally({
      projection: this.currentProjection,
      pageConfig: this.pageConfig,
      fontManager: this.fontManager,
      ...(snapshot.layout === undefined ? {} : { previousLayout: snapshot.layout }),
      ...(snapshot.continuation === undefined
        ? {
            ...(this.layoutNeedsRefresh
              ? {
                  dirtyPageIndex: this.dirtyPageIndex,
                  dirtyPageEndIndex: this.dirtyPageEndIndex
                }
              : {}),
            ...(this.layoutNeedsRefresh && this.layoutDirtyRange !== undefined
              ? { dirtyRange: this.layoutDirtyRange }
              : {})
          }
        : {
            dirtyPageIndex: snapshot.continuation.dirtyPageIndex,
            dirtyPageEndIndex: snapshot.continuation.dirtyPageEndIndex,
            startPosition: snapshot.continuation.startPosition
          }),
      ...(maxPages === undefined ? {} : { maxPages })
    })

    if (snapshot.continuation !== undefined || this.mountedDom !== undefined) {
      this.cachedLayout = pass.layout
      this.pendingLayoutContinuation = pass.continuation
      this.syncDeferredRenderWithCurrentContinuation()
    }

    return {
      layout: pass.layout,
      ...(pass.continuation === undefined
        ? {}
        : {
            continuation: pass.continuation,
            staleFromPageIndex: pass.continuation.dirtyPageIndex
          }),
      needsInitialPass: false
    }
  }

  private syncDeferredRenderWithCurrentContinuation(): void {
    const mountedDom = this.mountedDom
    const deferredRender = mountedDom?.deferredRender

    if (mountedDom === undefined || deferredRender === undefined) {
      return
    }

    clearTimeout(deferredRender.timeoutId)

    if (this.pendingLayoutContinuation === undefined) {
      mountedDom.deferredRender = undefined
      return
    }

    mountedDom.deferredRender = {
      timeoutId: setTimeout(() => {
        this.flushDeferredRenderChunk()
      }, 0),
      chunkSize: deferredRender.chunkSize,
      continuation: this.pendingLayoutContinuation
    }
  }

  private resolveCurrentSelectionPageIndex(): number | undefined {
    if (this.currentSelection === null) {
      return undefined
    }

    try {
      const selectionPosition = this.resolveTextPosition(this.currentSelection.anchor)
      const cachedPageIndex = this.cachedLayout === undefined
        ? undefined
        : getLayoutCaretRect(this.cachedLayout, selectionPosition)?.pageIndex

      return cachedPageIndex ?? getLayoutCaretRect(this.ensureCurrentLayout(), selectionPosition)?.pageIndex
    } catch {
      return undefined
    }
  }

  private resolveCommandDirtyPageIndex(command: Command): number | undefined {
    return this.resolveCommandDirtyPageBounds(command)?.start
  }

  private resolveCommandDirtyPageBounds(command: Command): Readonly<{
    start: number
    end: number
  }> | undefined {
    if (command.operations.length === 0) {
      return undefined
    }

    const cachedPageIndexes = this.cachedLayout === undefined
      ? []
      : mergePageIndexes(...command.operations.map((operation) => resolveOperationDirtyPageIndexes(this.cachedLayout!, operation)))

    if (cachedPageIndexes.length > 0) {
      return {
        start: cachedPageIndexes[0]!,
        end: cachedPageIndexes[cachedPageIndexes.length - 1]!
      }
    }

    const layout = this.ensureCurrentLayout()
    const pageIndexes = mergePageIndexes(...command.operations.map((operation) => resolveOperationDirtyPageIndexes(layout, operation)))

    if (pageIndexes.length === 0) {
      return undefined
    }

    return {
      start: pageIndexes[0]!,
      end: pageIndexes[pageIndexes.length - 1]!
    }
  }

  private runLayoutPass(input: Readonly<{
    dirtyPageIndex?: number
    dirtyPageEndIndex?: number
    startPosition?: TextPosition
    maxPages?: number
  }> = {}): Readonly<{
    layout: DocumentLayout
    laidOutPageIndexes: readonly number[]
    continuation?: Readonly<{
      dirtyPageIndex: number
      dirtyPageEndIndex: number
      startPosition: TextPosition
    }>
    stoppedAtPageIndex?: number
  }> {
    const pass = layoutDocumentIncrementally({
      projection: this.currentProjection,
      pageConfig: this.pageConfig,
      fontManager: this.fontManager,
      ...(this.cachedLayout === undefined ? {} : { previousLayout: this.cachedLayout }),
      ...(input.dirtyPageIndex !== undefined || this.layoutNeedsRefresh
        ? { dirtyPageIndex: input.dirtyPageIndex ?? this.dirtyPageIndex }
        : {}),
      ...(input.dirtyPageEndIndex !== undefined || this.layoutNeedsRefresh
        ? { dirtyPageEndIndex: input.dirtyPageEndIndex ?? this.dirtyPageEndIndex }
        : {}),
      ...(input.startPosition === undefined ? {} : { startPosition: input.startPosition }),
      ...(this.layoutDirtyRange === undefined || input.startPosition !== undefined ? {} : { dirtyRange: this.layoutDirtyRange }),
      ...(input.maxPages === undefined ? {} : { maxPages: input.maxPages })
    })

    this.cachedLayout = pass.layout
    this.pendingLayoutContinuation = pass.continuation
    this.layoutNeedsRefresh = false
    this.layoutDirtyRange = undefined

    return pass
  }

  private createSelectionRenderState(layout: DocumentLayout): Readonly<{
    selectionRects?: readonly LayoutRect[]
    caretRect?: LayoutRect
    pageIndexes: readonly number[]
  }> {
    if (this.currentSelection === null) {
      return {
        pageIndexes: []
      }
    }

    try {
      const range = {
        anchor: this.resolveTextPosition(this.currentSelection.anchor),
        focus: this.resolveTextPosition(this.currentSelection.focus)
      }
      const selectionRects = getLayoutSelectionRects(layout, range)
      const caretRect = getLayoutCaretRect(layout, range.focus)
      const pageIndexes = mergePageIndexes(
        selectionRects.map((rect) => rect.pageIndex),
        caretRect === undefined ? [] : [caretRect.pageIndex]
      )

      return {
        ...(selectionRects.length === 0 ? {} : { selectionRects }),
        ...(caretRect === undefined ? {} : { caretRect }),
        pageIndexes
      }
    } catch {
      return {
        pageIndexes: []
      }
    }
  }

  private emit(event: EditorEvent): void {
    for (const listener of this.listeners) {
      listener(event)
    }
  }

  private emitSelectionChange(): void {
    this.emit({
      kind: 'selectionChange',
      selection: this.currentSelection,
      formattingState: createSelectionFormattingState(this.currentProjection, this.currentSelection)
    })
  }

  private syncMountedAssistiveDom(layout: DocumentLayout): void {
    const mountedDom = this.mountedDom

    if (mountedDom === undefined) {
      return
    }

    this.syncMountedTextMirror()
    syncHiddenTextareaPosition({
      mountedDom,
      caretRect: this.resolveSelectionCaretRect(layout),
      scale: this.pageConfig.scale
    })
  }

  private syncMountedTextMirror(): void {
    const mountedDom = this.mountedDom

    if (mountedDom === undefined || !this.mountedTextMirrorNeedsRefresh) {
      return
    }

    mountedDom.textMirror.textContent = readProjectionPlainText(this.currentProjection)
    this.mountedTextMirrorNeedsRefresh = false
  }

  private resolveSelectionCaretRect(layout: DocumentLayout): LayoutRect | undefined {
    if (this.currentSelection === null) {
      return undefined
    }

    try {
      return getLayoutCaretRect(layout, this.resolveTextPosition(this.currentSelection.focus))
    } catch {
      return undefined
    }
  }

  private refreshMountedSelectionRuntime(previousSelection: SelectionState | null): void {
    if (this.mountedDom === undefined) {
      return
    }

    if (
      previousSelection !== this.currentSelection
      || (this.currentSelection === null && this.selectionPageIndexes.length > 0)
    ) {
      this.renderMountedLayout('selection')
      return
    }

    this.syncMountedAssistiveDom(this.cachedLayout ?? this.ensureCurrentLayout())
  }

  private handleRuntimeInput(event: Event): void {
    const textarea = event.currentTarget
    const mountedDom = this.mountedDom

    if (!(textarea instanceof HTMLTextAreaElement)) {
      return
    }

    if (mountedDom?.inputState.isComposing) {
      const composingText = readEventData(event) || textarea.value

      if (composingText.length > 0) {
        mountedDom.inputState.compositionText = composingText
      }

      return
    }

    const text = textarea.value || readEventData(event)

    textarea.value = ''

    if (text.length === 0) {
      return
    }

    if (mountedDom !== undefined && mountedDom.inputState.pendingPlainInputText.length > 0) {
      const pendingText = mountedDom.inputState.pendingPlainInputText

      mountedDom.inputState.pendingPlainInputText = ''

      if (text === pendingText) {
        return
      }
    }

    this.runProtectedInputHandler(() => {
      this.insertTextFromRuntime(text)
    })
  }

  private handleRuntimeCompositionStart(event: Event): void {
    const mountedDom = this.mountedDom

    if (mountedDom === undefined) {
      return
    }

    mountedDom.inputState.pendingPlainInputText = ''
    mountedDom.inputState.isComposing = true
    mountedDom.inputState.compositionText = readEventData(event) || mountedDom.hiddenTextarea.value
  }

  private handleRuntimeCompositionUpdate(event: Event): void {
    const mountedDom = this.mountedDom

    if (mountedDom === undefined) {
      return
    }

    const compositionText = readEventData(event) || mountedDom.hiddenTextarea.value

    if (compositionText.length > 0) {
      mountedDom.inputState.compositionText = compositionText
    }
  }

  private handleRuntimeCompositionEnd(event: Event): void {
    const mountedDom = this.mountedDom

    if (mountedDom === undefined) {
      return
    }

    const text = readEventData(event) || mountedDom.inputState.compositionText || mountedDom.hiddenTextarea.value

    mountedDom.inputState.isComposing = false
    mountedDom.inputState.compositionText = ''
    mountedDom.inputState.pendingPlainInputText = text
    mountedDom.hiddenTextarea.value = ''

    if (text.length === 0) {
      mountedDom.inputState.pendingPlainInputText = ''
      return
    }

    this.runProtectedInputHandler(() => {
      this.insertTextFromRuntime(text)
    })
  }

  private handleRuntimeKeyDown(event: KeyboardEvent): void {
    const mountedDom = this.mountedDom

    if (mountedDom !== undefined) {
      if (mountedDom.inputState.isComposing || isCompositionKeyboardEvent(event)) {
        return
      }

      mountedDom.inputState.pendingPlainInputText = ''
    }

    const lowerKey = event.key.toLowerCase()
    const usesCommandModifier = event.metaKey || event.ctrlKey

    if (usesCommandModifier && lowerKey === 'z') {
      event.preventDefault()
      this.runProtectedInputHandler(() => {
        if (event.shiftKey) {
          this.redo()
          return
        }

        this.undo()
      })
      return
    }

    if (usesCommandModifier && lowerKey === 'y') {
      event.preventDefault()
      this.runProtectedInputHandler(() => {
        this.redo()
      })
      return
    }

    if (usesCommandModifier && lowerKey === 'b') {
      event.preventDefault()
      this.runProtectedInputHandler(() => {
        this.toggleRuntimeBold()
      })
      return
    }

    if (usesCommandModifier && lowerKey === 'i') {
      event.preventDefault()
      this.runProtectedInputHandler(() => {
        this.toggleRuntimeItalic()
      })
      return
    }

    switch (event.key) {
      case 'Backspace':
        event.preventDefault()
        this.runProtectedInputHandler(() => {
          this.deleteBackwardFromRuntime()
        })
        return
      case 'Delete':
        event.preventDefault()
        this.runProtectedInputHandler(() => {
          this.deleteForwardFromRuntime()
        })
        return
      case 'Enter':
        event.preventDefault()
        this.runProtectedInputHandler(() => {
          this.splitParagraphFromRuntime()
        })
        return
      case 'ArrowLeft':
        event.preventDefault()
        this.runProtectedInputHandler(() => {
          this.moveSelectionHorizontally(-1)
        })
        return
      case 'ArrowRight':
        event.preventDefault()
        this.runProtectedInputHandler(() => {
          this.moveSelectionHorizontally(1)
        })
        return
      case 'ArrowUp':
        event.preventDefault()
        this.runProtectedInputHandler(() => {
          this.moveSelectionVertically(-1)
        })
        return
      case 'ArrowDown':
        event.preventDefault()
        this.runProtectedInputHandler(() => {
          this.moveSelectionVertically(1)
        })
        return
      case 'Home':
        event.preventDefault()
        this.runProtectedInputHandler(() => {
          this.moveSelectionToLineBoundary('start')
        })
        return
      case 'End':
        event.preventDefault()
        this.runProtectedInputHandler(() => {
          this.moveSelectionToLineBoundary('end')
        })
        return
    }
  }

  private handleRuntimeCopy(event: Event): void {
    const clipboardData = readClipboardData(event)
    const text = this.readSelectionPlainText()

    if (clipboardData === undefined || text.length === 0) {
      return
    }

    event.preventDefault()
    clipboardData.setData('text/plain', text)
  }

  private handleRuntimeCut(event: Event): void {
    const clipboardData = readClipboardData(event)
    const text = this.readSelectionPlainText()

    if (clipboardData === undefined || text.length === 0) {
      return
    }

    event.preventDefault()
    clipboardData.setData('text/plain', text)
    this.runProtectedInputHandler(() => {
      this.deleteSelectedTextFromRuntime()
    })
  }

  private handleRuntimePaste(event: Event): void {
    const clipboardData = readClipboardData(event)

    if (clipboardData === undefined) {
      return
    }

    const text = clipboardData.getData('text/plain')

    if (text.length === 0) {
      return
    }

    event.preventDefault()
    this.runProtectedInputHandler(() => {
      this.insertPlainTextFromRuntime(text)
    })
  }

  private handleRuntimePointerDown(event: MouseEvent): void {
    if (event.button !== 0) {
      return
    }

    const anchor = this.resolvePointerAnchor(event)
    const mountedDom = this.mountedDom

    if (anchor === undefined || mountedDom === undefined) {
      return
    }

    event.preventDefault()
    mountedDom.pointerState.anchor = anchor
    mountedDom.hiddenTextarea.focus()
    this.setSelection(createSelectionState(anchor, anchor))
  }

  private handleRuntimePointerMove(event: MouseEvent): void {
    const mountedDom = this.mountedDom

    if (mountedDom === undefined || mountedDom.pointerState.anchor === null) {
      return
    }

    const focus = this.resolvePointerAnchor(event)

    if (focus === undefined) {
      return
    }

    event.preventDefault()
    this.setSelection(createSelectionState(mountedDom.pointerState.anchor, focus))
  }

  private handleRuntimePointerUp(event: MouseEvent): void {
    const mountedDom = this.mountedDom

    if (mountedDom === undefined || mountedDom.pointerState.anchor === null) {
      return
    }

    const focus = this.resolvePointerAnchor(event)

    if (focus !== undefined) {
      event.preventDefault()
      this.setSelection(createSelectionState(mountedDom.pointerState.anchor, focus))
    }

    mountedDom.pointerState.anchor = null
  }

  private handleRuntimeDoubleClick(event: MouseEvent): void {
    const anchor = this.resolvePointerAnchor(event)

    if (anchor === undefined) {
      return
    }

    event.preventDefault()
    this.setSelection(this.expandWordSelection(anchor))
  }

  private runProtectedInputHandler(action: () => void): void {
    const mountedDom = this.mountedDom

    try {
      action()

      if (mountedDom !== undefined) {
        mountedDom.liveRegion.textContent = ''
        mountedDom.hiddenTextarea.value = ''
      }
    } catch {
      if (mountedDom !== undefined) {
        mountedDom.liveRegion.textContent = '输入失败'
        mountedDom.hiddenTextarea.value = ''
      }
    }
  }

  private insertPlainTextFromRuntime(text: string): void {
    const selection = this.currentSelection

    if (selection !== null && !isSelectionCollapsed(selection)) {
      if (!this.replaceSelectedTextFromRuntime(normalizePlainText(text))) {
        return
      }

      return
    }

    this.insertTextFromRuntime(normalizePlainText(text))
  }

  private insertTextFromRuntime(text: string): void {
    const selection = this.currentSelection

    if (selection === null || !isSelectionCollapsed(selection)) {
      return
    }

    if (text.length === 0) {
      return
    }

    const position = this.resolveTextPosition(selection.focus)
    const command = this.buildPlainTextInsertCommand(position, text)

    if (command === undefined) {
      return
    }

    this.executeCommand(command.command, {
      selectionAfter: command.selectionAfter
    })
  }

  private replaceSelectedTextFromRuntime(text: string): boolean {
    const range = this.resolveSelectedTextRange()

    if (range === undefined) {
      return false
    }

    const normalizedText = normalizePlainText(text)
    const deletePlan = this.buildDeleteSelectionPlan(range)

    if (deletePlan === undefined) {
      return false
    }

    const command = this.buildPlainTextInsertCommand(deletePlan.caret, normalizedText, deletePlan.operations)

    if (command === undefined) {
      return false
    }

    this.executeCommand(command.command, {
      selectionAfter: command.selectionAfter
    })

    return true
  }

  private deleteSelectedTextFromRuntime(): boolean {
    const range = this.resolveSelectedTextRange()

    if (range === undefined) {
      return false
    }

    const deletePlan = this.buildDeleteSelectionPlan(range)

    if (deletePlan === undefined) {
      return false
    }

    this.executeCommand(
      {
        name: 'deleteSelection',
        operations: deletePlan.operations
      },
      {
        selectionAfter: createSelectionState(
          createRuntimeAnchor({
            documentId: this.currentProjection.document.id,
            ...deletePlan.caret
          }),
          createRuntimeAnchor({
            documentId: this.currentProjection.document.id,
            ...deletePlan.caret
          })
        )
      }
    )

    return true
  }

  private buildPlainTextInsertCommand(
    start: TextPosition,
    text: string,
    leadingOperations: readonly Operation[] = []
  ): Readonly<{
    command: Command
    selectionAfter: SelectionState
  }> | undefined {
    const parts = text.split('\n')
    const operations: Operation[] = [...leadingOperations]
    let currentPosition: TextPosition = { ...start }
    let currentRunId = start.runId
    let currentBlockId = start.blockId

    if (parts.length === 1 && parts[0]?.length === 0 && leadingOperations.length === 0) {
      return undefined
    }

    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index] ?? ''

      if (part.length > 0) {
        operations.push({
          kind: 'insertText',
          at: currentPosition,
          text: part
        })

        currentPosition = {
          ...currentPosition,
          runId: currentRunId,
          blockId: currentBlockId,
          graphemeIndex: currentPosition.graphemeIndex + countGraphemes(part)
        }
      }

      if (index >= parts.length - 1) {
        continue
      }

      const identifiers = allocateParagraphSplitIds(this.currentProjection, operations)

      operations.push({
        kind: 'splitBlock',
        at: currentPosition,
        newBlockId: identifiers.blockId,
        newRunId: identifiers.runId
      })

      currentBlockId = identifiers.blockId
      currentRunId = identifiers.runId
      currentPosition = {
        sectionId: currentPosition.sectionId,
        blockId: currentBlockId,
        runId: currentRunId,
        graphemeIndex: 0
      }
    }

    const selectionAfter = createSelectionState(
      createRuntimeAnchor({
        documentId: this.currentProjection.document.id,
        ...currentPosition
      }),
      createRuntimeAnchor({
        documentId: this.currentProjection.document.id,
        ...currentPosition
      })
    )

    return {
      command: {
        name: leadingOperations.length > 0 ? 'replaceText' : 'insertText',
        operations
      },
      selectionAfter
    }
  }

  private buildDeleteSelectionPlan(range: Readonly<{
    start: TextPosition
    end: TextPosition
  }>): Readonly<{
    operations: readonly Operation[]
    caret: TextPosition
  }> | undefined {
    const paragraphs = collectParagraphRuntimeContexts(this.currentProjection)
    const startParagraphIndex = paragraphs.findIndex((paragraph) => paragraph.blockId === range.start.blockId)
    const endParagraphIndex = paragraphs.findIndex((paragraph) => paragraph.blockId === range.end.blockId)

    if (startParagraphIndex < 0 || endParagraphIndex < 0) {
      return undefined
    }

    const startParagraph = paragraphs[startParagraphIndex]
    const endParagraph = paragraphs[endParagraphIndex]

    if (startParagraph === undefined || endParagraph === undefined) {
      return undefined
    }

    const startRunIndex = startParagraph.runs.findIndex((run) => run.id === range.start.runId)
    const endRunIndex = endParagraph.runs.findIndex((run) => run.id === range.end.runId)

    if (startRunIndex < 0 || endRunIndex < 0) {
      return undefined
    }

    const operations: Operation[] = []

    for (let paragraphIndex = endParagraphIndex; paragraphIndex >= startParagraphIndex; paragraphIndex -= 1) {
      const paragraph = paragraphs[paragraphIndex]

      if (paragraph === undefined) {
        continue
      }

      const paragraphStartRunIndex = paragraphIndex === startParagraphIndex ? startRunIndex : 0
      const paragraphEndRunIndex = paragraphIndex === endParagraphIndex ? endRunIndex : paragraph.runs.length - 1

      for (let runIndex = paragraphEndRunIndex; runIndex >= paragraphStartRunIndex; runIndex -= 1) {
        const run = paragraph.runs[runIndex]

        if (run === undefined) {
          continue
        }

        const selectedStartGraphemeIndex = paragraphIndex === startParagraphIndex && runIndex === startRunIndex
          ? range.start.graphemeIndex
          : 0
        const selectedEndGraphemeIndex = paragraphIndex === endParagraphIndex && runIndex === endRunIndex
          ? range.end.graphemeIndex
          : run.graphemeLength

        if (selectedEndGraphemeIndex <= selectedStartGraphemeIndex) {
          continue
        }

        operations.push({
          kind: 'deleteRange',
          range: {
            anchor: {
              sectionId: paragraph.sectionId,
              blockId: paragraph.blockId,
              runId: run.id,
              graphemeIndex: selectedStartGraphemeIndex
            },
            focus: {
              sectionId: paragraph.sectionId,
              blockId: paragraph.blockId,
              runId: run.id,
              graphemeIndex: selectedEndGraphemeIndex
            }
          }
        })
      }
    }

    for (let paragraphIndex = endParagraphIndex; paragraphIndex > startParagraphIndex; paragraphIndex -= 1) {
      const paragraph = paragraphs[paragraphIndex]

      if (paragraph === undefined) {
        continue
      }

      operations.push({
        kind: 'mergeBlock',
        targetBlockId: paragraphs[paragraphIndex - 1]!.blockId,
        sourceBlockId: paragraph.blockId
      })
    }

    return {
      operations,
      caret: {
        ...range.start
      }
    }
  }

  private resolveSelectedTextRange(): Readonly<{
    start: TextPosition
    end: TextPosition
  }> | undefined {
    const selection = this.currentSelection

    if (selection === null || isSelectionCollapsed(selection)) {
      return undefined
    }

    const anchor = this.resolveTextPosition(selection.anchor)
    const focus = this.resolveTextPosition(selection.focus)

    const order = compareRuntimeTextPositions(this.currentProjection, anchor, focus)

    if (order <= 0) {
      return { start: anchor, end: focus }
    }

    return { start: focus, end: anchor }
  }

  private readSelectionPlainText(): string {
    const selection = this.currentSelection

    if (selection === null || isSelectionCollapsed(selection)) {
      return ''
    }

    const targets = collectSelectionTargets(this.currentProjection, selection)
    let text = ''
    let previousParagraphId: string | undefined

    for (const target of targets.runs) {
      if (previousParagraphId !== undefined && previousParagraphId !== target.paragraphId) {
        text += '\n'
      }

      text += splitGraphemes(
        target.run.inlines.flatMap((inline) => inline.kind === 'text' ? [inline.text] : []).join('')
      )
        .slice(target.selectedStartGraphemeIndex, target.selectedEndGraphemeIndex)
        .join('')
      previousParagraphId = target.paragraphId
    }

    return text
  }

  private deleteBackwardFromRuntime(): void {
    const selection = this.currentSelection

    if (selection === null || !isSelectionCollapsed(selection)) {
      return
    }

    const position = this.resolveTextPosition(selection.focus)
    const paragraphs = collectParagraphRuntimeContexts(this.currentProjection)
    const paragraph = paragraphs.find((candidate) => candidate.blockId === position.blockId)

    if (paragraph === undefined) {
      return
    }

    if (position.graphemeIndex > 0) {
      const selectionAfter = createSelectionState(
        createRuntimeAnchor({
          documentId: this.currentProjection.document.id,
          sectionId: position.sectionId,
          blockId: position.blockId,
          runId: position.runId,
          graphemeIndex: position.graphemeIndex - 1
        }),
        createRuntimeAnchor({
          documentId: this.currentProjection.document.id,
          sectionId: position.sectionId,
          blockId: position.blockId,
          runId: position.runId,
          graphemeIndex: position.graphemeIndex - 1
        })
      )

      this.executeCommand(
        {
          name: 'deleteBackward',
          operations: [{
            kind: 'deleteRange',
            range: {
              anchor: {
                ...position,
                graphemeIndex: position.graphemeIndex - 1
              },
              focus: position
            }
          }]
        },
        { selectionAfter }
      )
      return
    }

    const paragraphIndex = paragraphs.indexOf(paragraph)
    const previousParagraph = paragraphIndex > 0 ? paragraphs[paragraphIndex - 1] : undefined

    if (previousParagraph === undefined || paragraph.runs[0]?.id !== position.runId) {
      return
    }

    this.executeCommand(
      {
        name: 'mergeParagraphBackward',
        operations: [{
          kind: 'mergeBlock',
          targetBlockId: previousParagraph.blockId,
          sourceBlockId: paragraph.blockId
        }]
      },
      {
        selectionAfter: createSelectionState(
          createRuntimeAnchor({
            documentId: this.currentProjection.document.id,
            sectionId: previousParagraph.sectionId,
            blockId: previousParagraph.blockId,
            runId: position.runId,
            graphemeIndex: 0
          }),
          createRuntimeAnchor({
            documentId: this.currentProjection.document.id,
            sectionId: previousParagraph.sectionId,
            blockId: previousParagraph.blockId,
            runId: position.runId,
            graphemeIndex: 0
          })
        )
      }
    )
  }

  private deleteForwardFromRuntime(): void {
    const selection = this.currentSelection

    if (selection === null || !isSelectionCollapsed(selection)) {
      return
    }

    const position = this.resolveTextPosition(selection.focus)
    const paragraphs = collectParagraphRuntimeContexts(this.currentProjection)
    const paragraph = paragraphs.find((candidate) => candidate.blockId === position.blockId)

    if (paragraph === undefined) {
      return
    }

    const currentRun = paragraph.runs.find((candidate) => candidate.id === position.runId)

    if (currentRun === undefined) {
      return
    }

    if (position.graphemeIndex < currentRun.graphemeLength) {
      const selectionAfter = createSelectionState(
        createRuntimeAnchor({
          documentId: this.currentProjection.document.id,
          ...position
        }),
        createRuntimeAnchor({
          documentId: this.currentProjection.document.id,
          ...position
        })
      )

      this.executeCommand(
        {
          name: 'deleteForward',
          operations: [{
            kind: 'deleteRange',
            range: {
              anchor: position,
              focus: {
                ...position,
                graphemeIndex: position.graphemeIndex + 1
              }
            }
          }]
        },
        { selectionAfter }
      )
      return
    }

    const paragraphIndex = paragraphs.indexOf(paragraph)
    const nextParagraph = paragraphIndex >= 0 ? paragraphs[paragraphIndex + 1] : undefined

    if (nextParagraph === undefined || paragraph.runs[paragraph.runs.length - 1]?.id !== position.runId) {
      return
    }

    const nextRun = nextParagraph.runs[0]

    if (nextRun === undefined) {
      return
    }

    this.executeCommand(
      {
        name: 'mergeParagraphForward',
        operations: [{
          kind: 'mergeBlock',
          targetBlockId: paragraph.blockId,
          sourceBlockId: nextParagraph.blockId
        }]
      },
      {
        selectionAfter: createSelectionState(
          createRuntimeAnchor({
            documentId: this.currentProjection.document.id,
            sectionId: paragraph.sectionId,
            blockId: paragraph.blockId,
            runId: nextRun.id,
            graphemeIndex: 0
          }),
          createRuntimeAnchor({
            documentId: this.currentProjection.document.id,
            sectionId: paragraph.sectionId,
            blockId: paragraph.blockId,
            runId: nextRun.id,
            graphemeIndex: 0
          })
        )
      }
    )
  }

  private splitParagraphFromRuntime(): void {
    const selection = this.currentSelection

    if (selection === null || !isSelectionCollapsed(selection)) {
      return
    }

    const position = this.resolveTextPosition(selection.focus)
    const identifiers = allocateParagraphSplitIds(this.currentProjection)
    const selectionAfter = createSelectionState(
      createRuntimeAnchor({
        documentId: this.currentProjection.document.id,
        sectionId: position.sectionId,
        blockId: identifiers.blockId,
        runId: identifiers.runId,
        graphemeIndex: 0
      }),
      createRuntimeAnchor({
        documentId: this.currentProjection.document.id,
        sectionId: position.sectionId,
        blockId: identifiers.blockId,
        runId: identifiers.runId,
        graphemeIndex: 0
      })
    )

    this.executeCommand(
      {
        name: 'splitParagraph',
        operations: [{
          kind: 'splitBlock',
          at: position,
          newBlockId: identifiers.blockId,
          newRunId: identifiers.runId
        }]
      },
      { selectionAfter }
    )
  }

  private moveSelectionHorizontally(delta: -1 | 1): void {
    const selection = this.currentSelection

    if (selection === null) {
      return
    }

    if (!isSelectionCollapsed(selection)) {
      const anchor = delta < 0
        ? selection.direction === 'backward' ? selection.focus : selection.anchor
        : selection.direction === 'backward' ? selection.anchor : selection.focus

      this.setSelection(createSelectionState(anchor, anchor))
      return
    }

    const nextPosition = moveTextPosition(this.currentProjection, this.resolveTextPosition(selection.focus), delta)

    if (nextPosition === undefined) {
      return
    }

    this.setSelection(createSelectionState(
      createRuntimeAnchor({
        documentId: this.currentProjection.document.id,
        ...nextPosition
      }),
      createRuntimeAnchor({
        documentId: this.currentProjection.document.id,
        ...nextPosition
      })
    ))
  }

  private moveSelectionVertically(direction: -1 | 1): void {
    const selection = this.currentSelection

    if (selection === null) {
      return
    }

    if (!isSelectionCollapsed(selection)) {
      const anchor = direction < 0
        ? selection.direction === 'backward' ? selection.focus : selection.anchor
        : selection.direction === 'backward' ? selection.anchor : selection.focus

      this.setSelection(createSelectionState(anchor, anchor))
      return
    }

    const focus = this.resolveTextPosition(selection.focus)
    const layout = this.ensureCurrentLayout()
    const caretRect = getLayoutCaretRect(layout, focus)
    const lines = flattenLayoutLines(layout)

    if (caretRect === undefined) {
      return
    }

    const currentLineIndex = lines.findIndex((line) =>
      line.pageIndex === caretRect.pageIndex
      && line.y === caretRect.y
      && line.height === caretRect.height
    )

    if (currentLineIndex < 0) {
      return
    }

    const targetLine = lines[currentLineIndex + direction]
    const targetPosition = targetLine === undefined
      ? undefined
      : hitTestLineAtAbsoluteX(layout, targetLine, caretRect.x)

    if (targetPosition === undefined) {
      return
    }

    this.setSelection(createSelectionState(
      createRuntimeAnchor({
        documentId: this.currentProjection.document.id,
        ...targetPosition
      }),
      createRuntimeAnchor({
        documentId: this.currentProjection.document.id,
        ...targetPosition
      })
    ))
  }

  private moveSelectionToLineBoundary(boundary: 'start' | 'end'): void {
    const selection = this.currentSelection

    if (selection === null) {
      return
    }

    const focus = this.resolveTextPosition(selection.focus)
    const layout = this.ensureCurrentLayout()
    const caretRect = getLayoutCaretRect(layout, focus)

    if (caretRect === undefined) {
      return
    }

    const line = flattenLayoutLines(layout).find((candidate) =>
      candidate.pageIndex === caretRect.pageIndex
      && candidate.y === caretRect.y
      && candidate.height === caretRect.height
    )
    const targetPosition = line === undefined
      ? undefined
      : resolveLineBoundaryPosition(line, boundary)

    if (targetPosition === undefined) {
      return
    }

    this.setSelection(createSelectionState(
      createRuntimeAnchor({
        documentId: this.currentProjection.document.id,
        ...targetPosition
      }),
      createRuntimeAnchor({
        documentId: this.currentProjection.document.id,
        ...targetPosition
      })
    ))
  }

  private toggleRuntimeBold(): void {
    const command = buildSetBoldCommand(
      this.currentProjection,
      this.currentSelection,
      this.getSelectionFormattingState().run?.bold.value !== true
    )

    if (command === null) {
      return
    }

    this.executeCommand(command, {
      selectionAfter: this.currentSelection
    })
  }

  private toggleRuntimeItalic(): void {
    const command = buildSetItalicCommand(
      this.currentProjection,
      this.currentSelection,
      this.getSelectionFormattingState().run?.italic.value !== true
    )

    if (command === null) {
      return
    }

    this.executeCommand(command, {
      selectionAfter: this.currentSelection
    })
  }

  private resolvePointerAnchor(event: MouseEvent): AnchorRef | undefined {
    const target = event.target

    if (!(target instanceof Element)) {
      return undefined
    }

    const page = target.closest('[data-jword-page]')

    if (!(page instanceof HTMLElement)) {
      return undefined
    }

    const pageIndex = Number.parseInt(page.getAttribute('data-jword-page') ?? '-1', 10)

    if (!Number.isInteger(pageIndex) || pageIndex < 0) {
      return undefined
    }

    const rect = page.getBoundingClientRect()

    return this.hitTest({
      pageIndex,
      x: cssPxToTwips(event.clientX - rect.left, this.pageConfig.scale),
      y: cssPxToTwips(event.clientY - rect.top, this.pageConfig.scale)
    })
  }

  private expandWordSelection(anchor: AnchorRef): SelectionState {
    const position = this.resolveTextPosition(anchor)
    const text = readProjectionRunText(this.currentProjection, position.blockId, position.runId)
    const graphemes = splitGraphemes(text)

    if (graphemes.length === 0) {
      return createSelectionState(anchor, anchor)
    }

    const index = Math.min(position.graphemeIndex, Math.max(graphemes.length - 1, 0))
    const isWord = isWordLikeGrapheme(graphemes[index] ?? '')
    let start = index
    let end = isWord ? index : index + 1

    if (isWord) {
      while (start > 0 && isWordLikeGrapheme(graphemes[start - 1] ?? '')) {
        start -= 1
      }

      while (end < graphemes.length && isWordLikeGrapheme(graphemes[end] ?? '')) {
        end += 1
      }
    }

    return createSelectionState(
      createRuntimeAnchor({
        documentId: this.currentProjection.document.id,
        sectionId: position.sectionId,
        blockId: position.blockId,
        runId: position.runId,
        graphemeIndex: start
      }),
      createRuntimeAnchor({
        documentId: this.currentProjection.document.id,
        sectionId: position.sectionId,
        blockId: position.blockId,
        runId: position.runId,
        graphemeIndex: end
      })
    )
  }

  private scheduleDeferredRender(
    continuation: Readonly<{
      dirtyPageIndex: number
      dirtyPageEndIndex: number
      startPosition: TextPosition
    }>,
    chunkSize: number
  ): void {
    const mountedDom = this.mountedDom

    if (mountedDom === undefined) {
      return
    }

    const deferredRender = {
      timeoutId: setTimeout(() => {
        this.flushDeferredRenderChunk()
      }, 0),
      chunkSize,
      continuation
    }

    mountedDom.deferredRender = deferredRender
  }

  private flushDeferredRenderChunk(): void {
    const mountedDom = this.mountedDom
    const deferredRender = mountedDom?.deferredRender

    if (mountedDom === undefined || deferredRender === undefined) {
      return
    }

    const pass = this.runLayoutPass({
      dirtyPageIndex: deferredRender.continuation.dirtyPageIndex,
      dirtyPageEndIndex: deferredRender.continuation.dirtyPageEndIndex,
      startPosition: deferredRender.continuation.startPosition,
      maxPages: deferredRender.chunkSize
    })
    const layout = pass.layout
    const schedule = createLayoutSchedule({
      pageCount: Math.max(layout.pages.length, (pass.continuation?.dirtyPageIndex ?? -1) + 1),
      dirtyPageIndex: deferredRender.continuation.dirtyPageIndex,
      immediatePageIndexes: pass.laidOutPageIndexes,
      ...(pass.continuation?.dirtyPageIndex === undefined
        ? {}
        : { deferredStartPageIndex: pass.continuation.dirtyPageIndex }),
      ...(pass.continuation === undefined && pass.stoppedAtPageIndex !== undefined
        ? { stoppedAtPageIndexHint: pass.stoppedAtPageIndex }
        : {}),
      chunkSize: deferredRender.chunkSize
    })

    const viewport = computeViewportPages({
      pages: layout.pages.map((page) => ({
        pageIndex: page.pageIndex,
        top: twipsToCssPx(page.y, this.pageConfig.scale),
        height: twipsToCssPx(page.height, this.pageConfig.scale)
      })),
      scrollTop: mountedDom.canvasContainer.scrollTop,
      viewportHeight: mountedDom.canvasContainer.clientHeight || this.pageConfig.heightCssPx,
      bufferPages: 1
    })
    const selectionRender = this.createSelectionRenderState(layout)
    const retainedPageIndexes = mergePageIndexes(
      viewport.retainedPageIndexes,
      pass.laidOutPageIndexes,
      selectionRender.pageIndexes,
      this.selectionPageIndexes
    )
    const rerenderPageIndexes = mergePageIndexes(
      pass.laidOutPageIndexes,
      selectionRender.pageIndexes,
      this.selectionPageIndexes
    )

    mountedDom.canvases = renderPageBatch({
      mountedDom,
      pages: layout.pages,
      retainedPageIndexes,
      rerenderPageIndexes,
      selectionRender,
      scale: this.pageConfig.scale,
      pixelRatio: resolveCanvasPixelRatio(mountedDom)
    })
    mountedDom.canvasContainer.setAttribute('data-jword-page-count', String(layout.pages.length))
    mountedDom.canvasContainer.setAttribute('data-jword-layout-immediate-pages', schedule.immediatePageIndexes.join(','))
    mountedDom.canvasContainer.setAttribute(
      'data-jword-layout-deferred-chunks',
      schedule.deferredChunks.map((chunk) => chunk.join(',')).join(';')
    )
    if (schedule.stoppedAtPageIndex === undefined) {
      mountedDom.canvasContainer.removeAttribute('data-jword-layout-stopped-at')
    } else {
      mountedDom.canvasContainer.setAttribute('data-jword-layout-stopped-at', String(schedule.stoppedAtPageIndex))
    }
    mountedDom.canvasContainer.setAttribute('data-jword-layout-rerender-pages', rerenderPageIndexes.join(','))
    this.selectionPageIndexes = selectionRender.pageIndexes
    this.pageStartKeys = createPageStartKeys(layout)
    this.syncMountedAssistiveDom(layout)

    if (pass.continuation === undefined) {
      mountedDom.deferredRender = undefined
      return
    }

    mountedDom.deferredRender = {
      timeoutId: setTimeout(() => {
        this.flushDeferredRenderChunk()
      }, 0),
      chunkSize: deferredRender.chunkSize,
      continuation: pass.continuation
    }
  }

  private cancelDeferredRender(): void {
    const deferredRender = this.mountedDom?.deferredRender

    if (deferredRender === undefined) {
      return
    }

    clearTimeout(deferredRender.timeoutId)
    this.mountedDom!.deferredRender = undefined
  }

  private assertActive(): void {
    if (this.isDestroyed) {
      throw createJWordError('EDITOR_DESTROYED', 'JWord editor has been destroyed.')
    }
  }
}

interface ParagraphRuntimeContext {
  readonly sectionId: string
  readonly blockId: string
  readonly runs: readonly RunRuntimeContext[]
}

interface RunRuntimeContext {
  readonly id: string
  readonly graphemeLength: number
}

function createHiddenTextareaElement(ownerDocument: Document): HTMLTextAreaElement {
  const textarea = ownerDocument.createElement('textarea')

  textarea.setAttribute('data-jword-hidden-textarea', '')
  textarea.setAttribute('aria-label', 'JWord hidden input')
  textarea.setAttribute('autocapitalize', 'off')
  textarea.setAttribute('autocomplete', 'off')
  textarea.spellcheck = false
  textarea.style.position = 'absolute'
  textarea.style.left = '0px'
  textarea.style.top = '0px'
  textarea.style.width = '1px'
  textarea.style.height = '1px'
  textarea.style.padding = '0'
  textarea.style.border = '0'
  textarea.style.margin = '0'
  textarea.style.opacity = '0'
  textarea.style.pointerEvents = 'none'
  textarea.style.resize = 'none'
  textarea.style.overflow = 'hidden'
  textarea.style.whiteSpace = 'pre'

  return textarea
}

function createLiveRegionElement(ownerDocument: Document): HTMLDivElement {
  const element = ownerDocument.createElement('div')

  element.setAttribute('data-jword-aria-live', '')
  element.setAttribute('aria-live', 'polite')
  element.setAttribute('role', 'status')
  applyVisuallyHiddenStyle(element)

  return element
}

function createTextMirrorElement(ownerDocument: Document): HTMLDivElement {
  const element = ownerDocument.createElement('div')

  element.setAttribute('data-jword-text-mirror', '')
  element.style.whiteSpace = 'pre-wrap'
  applyVisuallyHiddenStyle(element)

  return element
}

function applyVisuallyHiddenStyle(element: HTMLDivElement): void {
  element.style.position = 'absolute'
  element.style.left = '0'
  element.style.top = '0'
  element.style.width = '1px'
  element.style.height = '1px'
  element.style.padding = '0'
  element.style.border = '0'
  element.style.margin = '-1px'
  element.style.overflow = 'hidden'
  element.style.clip = 'rect(0 0 0 0)'
}

function syncHiddenTextareaPosition(input: Readonly<{
  mountedDom: MountedEditorDom
  caretRect: LayoutRect | undefined
  scale: number
}>): void {
  const left = input.caretRect === undefined
    ? 0
    : twipsToCssPx(input.caretRect.x, input.scale)
  const top = input.caretRect === undefined
    ? 0
    : twipsToCssPx(input.caretRect.y, input.scale) - input.mountedDom.canvasContainer.scrollTop

  input.mountedDom.hiddenTextarea.style.left = `${Math.max(0, left)}px`
  input.mountedDom.hiddenTextarea.style.top = `${Math.max(0, top)}px`
}

function readProjectionPlainText(projection: DocumentProjection): string {
  return collectParagraphRuntimeContexts(projection)
    .map((paragraph) => paragraph.runs.map((run) => readProjectionRunText(projection, paragraph.blockId, run.id)).join(''))
    .join('\n')
}

function collectParagraphRuntimeContexts(projection: DocumentProjection): readonly ParagraphRuntimeContext[] {
  const paragraphs: ParagraphRuntimeContext[] = []

  for (const section of projection.document.sections) {
    visitBlocks(section.id, section.blocks)
  }

  return Object.freeze(paragraphs)

  function visitBlocks(sectionId: string, blocks: readonly import('./model').Block[]) {
    for (const block of blocks) {
      if (block.kind === 'paragraph') {
        paragraphs.push({
          sectionId,
          blockId: block.id,
          runs: Object.freeze(block.runs.map((run) => ({
            id: run.id,
            graphemeLength: countGraphemes(
              run.inlines.flatMap((inline) => inline.kind === 'text' ? [inline.text] : []).join('')
            )
          })))
        })
        continue
      }

      for (const row of block.rows) {
        for (const cell of row.cells) {
          visitBlocks(sectionId, cell.blocks)
        }
      }
    }
  }
}

function readProjectionRunText(
  projection: DocumentProjection,
  blockId: string,
  runId: string
): string {
  for (const section of projection.document.sections) {
    const text = readBlocksRunText(section.blocks, blockId, runId)

    if (text !== undefined) {
      return text
    }
  }

  return ''
}

function readBlocksRunText(
  blocks: readonly import('./model').Block[],
  blockId: string,
  runId: string
): string | undefined {
  for (const block of blocks) {
    if (block.kind === 'paragraph') {
      if (block.id !== blockId) {
        continue
      }

      const run = block.runs.find((candidate) => candidate.id === runId)

      return run?.inlines.flatMap((inline) => inline.kind === 'text' ? [inline.text] : []).join('')
    }

    for (const row of block.rows) {
      for (const cell of row.cells) {
        const text = readBlocksRunText(cell.blocks, blockId, runId)

        if (text !== undefined) {
          return text
        }
      }
    }
  }

  return undefined
}

function moveTextPosition(
  projection: DocumentProjection,
  position: TextPosition,
  delta: -1 | 1
): TextPosition | undefined {
  const paragraphs = collectParagraphRuntimeContexts(projection)
  const paragraphIndex = paragraphs.findIndex((candidate) => candidate.blockId === position.blockId)

  if (paragraphIndex < 0) {
    return undefined
  }

  const paragraph = paragraphs[paragraphIndex]

  if (paragraph === undefined) {
    return undefined
  }

  const runIndex = paragraph.runs.findIndex((candidate) => candidate.id === position.runId)

  if (runIndex < 0) {
    return undefined
  }

  const run = paragraph.runs[runIndex]

  if (run === undefined) {
    return undefined
  }

  if (delta < 0) {
    if (position.graphemeIndex > 0) {
      return {
        ...position,
        graphemeIndex: position.graphemeIndex - 1
      }
    }

    const previousRun = runIndex > 0 ? paragraph.runs[runIndex - 1] : undefined

    if (previousRun !== undefined) {
      return {
        sectionId: paragraph.sectionId,
        blockId: paragraph.blockId,
        runId: previousRun.id,
        graphemeIndex: previousRun.graphemeLength
      }
    }

    const previousParagraph = paragraphIndex > 0 ? paragraphs[paragraphIndex - 1] : undefined
    const previousParagraphRun = previousParagraph?.runs[previousParagraph.runs.length - 1]

    if (previousParagraph === undefined || previousParagraphRun === undefined) {
      return undefined
    }

    return {
      sectionId: previousParagraph.sectionId,
      blockId: previousParagraph.blockId,
      runId: previousParagraphRun.id,
      graphemeIndex: previousParagraphRun.graphemeLength
    }
  }

  if (position.graphemeIndex < run.graphemeLength) {
    return {
      ...position,
      graphemeIndex: position.graphemeIndex + 1
    }
  }

  const nextRun = paragraph.runs[runIndex + 1]

  if (nextRun !== undefined) {
    return {
      sectionId: paragraph.sectionId,
      blockId: paragraph.blockId,
      runId: nextRun.id,
      graphemeIndex: 0
    }
  }

  const nextParagraph = paragraphs[paragraphIndex + 1]
  const nextParagraphRun = nextParagraph?.runs[0]

  if (nextParagraph === undefined || nextParagraphRun === undefined) {
    return undefined
  }

  return {
    sectionId: nextParagraph.sectionId,
    blockId: nextParagraph.blockId,
    runId: nextParagraphRun.id,
    graphemeIndex: 0
  }
}

function allocateParagraphSplitIds(
  projection: DocumentProjection,
  plannedOperations: readonly Operation[] = []
): Readonly<{
  blockId: string
  runId: string
}> {
  const paragraphs = collectParagraphRuntimeContexts(projection)
  const blockIds = new Set(paragraphs.map((paragraph) => paragraph.blockId))
  const runIds = new Set(paragraphs.flatMap((paragraph) => paragraph.runs.map((run) => run.id)))

  for (const operation of plannedOperations) {
    if (operation.kind === 'splitBlock') {
      blockIds.add(operation.newBlockId)
      runIds.add(operation.newRunId)
    }
  }

  return {
    blockId: allocateSequentialIdentifier(blockIds, 'paragraph'),
    runId: allocateSequentialIdentifier(runIds, 'run')
  }
}

function compareRuntimeTextPositions(
  projection: DocumentProjection,
  left: TextPosition,
  right: TextPosition
): number {
  const paragraphs = collectParagraphRuntimeContexts(projection)
  const leftParagraphIndex = paragraphs.findIndex((paragraph) => paragraph.blockId === left.blockId)
  const rightParagraphIndex = paragraphs.findIndex((paragraph) => paragraph.blockId === right.blockId)

  if (leftParagraphIndex !== rightParagraphIndex) {
    return leftParagraphIndex - rightParagraphIndex
  }

  const paragraph = leftParagraphIndex >= 0 ? paragraphs[leftParagraphIndex] : undefined
  const leftRunIndex = paragraph?.runs.findIndex((run) => run.id === left.runId) ?? -1
  const rightRunIndex = paragraph?.runs.findIndex((run) => run.id === right.runId) ?? -1

  if (leftRunIndex !== rightRunIndex) {
    return leftRunIndex - rightRunIndex
  }

  return left.graphemeIndex - right.graphemeIndex
}

function normalizePlainText(text: string): string {
  return text.replace(/\r\n?/gu, '\n')
}

function allocateSequentialIdentifier(ids: Set<string>, prefix: string): string {
  let nextIndex = 1

  for (const id of ids) {
    const match = new RegExp(`^${prefix}-(\\d+)$`, 'u').exec(id)

    if (match === null) {
      continue
    }

    nextIndex = Math.max(nextIndex, Number(match[1]) + 1)
  }

  let candidate = `${prefix}-${nextIndex}`

  while (ids.has(candidate)) {
    nextIndex += 1
    candidate = `${prefix}-${nextIndex}`
  }

  return candidate
}

function createRuntimeAnchor(input: Readonly<{
  documentId?: string
  sectionId: string
  blockId: string
  runId: string
  graphemeIndex: number
}>): AnchorRef {
  return createAnchorRef({
    documentId: (input.documentId ?? DEFAULT_DOCUMENT_ID) as DocumentId,
    sectionId: input.sectionId as SectionId,
    blockId: input.blockId as BlockId,
    runId: input.runId as RunId,
    graphemeIndex: createGraphemeIndex(input.graphemeIndex)
  })
}

function readEventData(event: Event): string {
  const data = (event as Event & { data?: unknown }).data

  return typeof data === 'string' ? data : ''
}

function isCompositionKeyboardEvent(event: KeyboardEvent): boolean {
  const composing = (event as KeyboardEvent & { isComposing?: unknown }).isComposing
  const keyCode = (event as KeyboardEvent & { keyCode?: unknown }).keyCode

  return composing === true || keyCode === 229
}

function readClipboardData(event: Event): {
  getData(type: string): string
  setData(type: string, value: string): void
} | undefined {
  const clipboardData = (event as Event & {
    clipboardData?: {
      getData(type: string): string
      setData(type: string, value: string): void
    }
  }).clipboardData

  return clipboardData === undefined ? undefined : clipboardData
}

function isWordLikeGrapheme(grapheme: string): boolean {
  return /[\p{Letter}\p{Number}_]/u.test(grapheme)
}

function createPageElement(mountedDom: MountedEditorDom, layoutPage: LayoutBox, scale: number) {
  const page = mountedDom.canvasContainer.ownerDocument.createElement('div')
  updatePageElement(page, mountedDom.canvases.get(layoutPage.pageIndex), layoutPage, scale)

  return page
}

function flattenLayoutLines(layout: DocumentLayout): readonly LineBox[] {
  return Object.freeze(layout.pages.flatMap((page) => page.lines))
}

function resolveLineBoundaryPosition(
  line: LineBox,
  boundary: 'start' | 'end'
): TextPosition | undefined {
  const firstFragment = line.fragments[0]
  const lastFragment = line.fragments[line.fragments.length - 1]

  if (firstFragment === undefined || lastFragment === undefined) {
    return undefined
  }

  return boundary === 'start'
    ? {
        sectionId: firstFragment.start.sectionId,
        blockId: firstFragment.start.blockId,
        runId: firstFragment.start.runId,
        graphemeIndex: firstFragment.start.graphemeIndex
      }
    : {
        sectionId: lastFragment.end.sectionId,
        blockId: lastFragment.end.blockId,
        runId: lastFragment.end.runId,
        graphemeIndex: lastFragment.end.graphemeIndex,
        assoc: -1
      }
}

function hitTestLineAtAbsoluteX(
  layout: DocumentLayout,
  line: LineBox,
  absoluteX: number
): TextPosition | undefined {
  const page = layout.pages[line.pageIndex]

  if (page === undefined) {
    return undefined
  }

  const localY = line.y - page.y + Math.max(1, Math.floor(line.height / 2))

  return hitTestDocumentLayout(layout, {
    pageIndex: line.pageIndex,
    x: Math.max(0, absoluteX - page.x),
    y: Math.max(0, localY)
  })
}

function syncPageWrappers(
  mountedDom: MountedEditorDom,
  pages: readonly LayoutBox[],
  scale: number
): void {
  const livePageIndexes = new Set(pages.map((page) => page.pageIndex))

  for (const [pageIndex, wrapper] of mountedDom.pageWrappers) {
    if (!livePageIndexes.has(pageIndex)) {
      wrapper.remove()
      mountedDom.pageWrappers.delete(pageIndex)
    }
  }

  for (const [index, layoutPage] of pages.entries()) {
    const wrapper = mountedDom.pageWrappers.get(layoutPage.pageIndex)
      ?? createPageElement(mountedDom, layoutPage, scale)

    mountedDom.pageWrappers.set(layoutPage.pageIndex, wrapper)
    updatePageElement(wrapper, mountedDom.canvases.get(layoutPage.pageIndex), layoutPage, scale)

    const currentChild = mountedDom.canvasContainer.children.item(index)

    if (currentChild !== wrapper) {
      mountedDom.canvasContainer.insertBefore(wrapper, currentChild)
    }
  }
}

function updatePageElement(
  page: EditorPageElement,
  canvas: CanvasLike | undefined,
  layoutPage: LayoutBox,
  scale: number
): void {
  page.className = 'jw-editor__page'
  page.setAttribute('data-jword-page', String(layoutPage.pageIndex))
  page.style.position = 'relative'
  page.style.width = `${twipsToCssPx(layoutPage.width, scale)}px`
  page.style.height = `${twipsToCssPx(layoutPage.height, scale)}px`
  page.style.margin = '0 auto 48px'
  page.style.background = '#ffffff'

  if (canvas !== undefined) {
    const styledCanvas = canvas as CanvasLike & { className?: string }
    const canvasNode = canvas as unknown as Node

    styledCanvas.className = 'jw-editor__page-canvas'
    if (canvasNode.parentNode !== page) {
      page.append(canvasNode)
    }
  } else {
    const renderedCanvas = page.querySelector('canvas')

    renderedCanvas?.remove()
  }
}

function createPageStartKeys(layout: DocumentLayout): readonly string[] {
  return Object.freeze(layout.pages.map(createPageStartKey))
}

function createPageStartKey(page: PageBox): string {
  for (const line of page.lines) {
    const fragment = line.fragments[0]

    if (fragment !== undefined) {
      return [
        fragment.sectionId,
        fragment.blockId,
        fragment.runId,
        fragment.start.graphemeIndex
      ].join(':')
    }
  }

  return `${page.pageIndex}:empty`
}

function mergePageIndexes(...sources: readonly (readonly number[])[]): readonly number[] {
  return Object.freeze([...new Set(sources.flat())].sort((left, right) => left - right))
}

function renderPageBatch(input: Readonly<{
  mountedDom: MountedEditorDom
  pages: readonly LayoutBox[]
  retainedPageIndexes: readonly number[]
  rerenderPageIndexes: readonly number[]
  selectionRender: Readonly<{
    selectionRects?: readonly LayoutRect[]
    caretRect?: LayoutRect
  }>
  scale: number
  pixelRatio: number
}>): Map<number, CanvasLike> {
  const nextCanvases = syncPageCanvases({
    pages: input.pages,
    retainedPageIndexes: input.retainedPageIndexes,
    rerenderPageIndexes: input.rerenderPageIndexes,
    canvases: input.mountedDom.canvases,
    pool: input.mountedDom.pool,
    ...(input.selectionRender.selectionRects === undefined
      ? {}
      : { selectionRects: input.selectionRender.selectionRects }),
    ...(input.selectionRender.caretRect === undefined
      ? {}
      : { caretRect: input.selectionRender.caretRect }),
    scale: input.scale,
    pixelRatio: input.pixelRatio
  })

  input.mountedDom.canvases = nextCanvases
  syncPageWrappers(input.mountedDom, input.pages, input.scale)

  return nextCanvases
}

function resolveCanvasPixelRatio(mountedDom: MountedEditorDom): number {
  return Math.max(1, mountedDom.canvasContainer.ownerDocument.defaultView?.devicePixelRatio ?? 1)
}

function resolveCommandDirtyRange(command: Command): LayoutDirtyRange | undefined {
  const firstOperation = command.operations[0]

  if (firstOperation === undefined) {
    return undefined
  }

  switch (firstOperation.kind) {
    case 'insertText':
    case 'splitBlock':
      return {
        anchor: firstOperation.at,
        focus: firstOperation.at
      }
    case 'deleteRange':
      return {
        anchor: firstOperation.range.anchor,
        focus: firstOperation.range.focus
      }
    default:
      return undefined
  }
}

function resolveOperationDirtyPageIndexes(layout: DocumentLayout, operation: Operation): readonly number[] {
  switch (operation.kind) {
    case 'insertText':
    case 'splitBlock':
      return findTextPositionPageIndexes(layout, operation.at)
    case 'deleteRange':
      return mergePageIndexes(
        findTextPositionPageIndexes(layout, operation.range.anchor),
        findTextPositionPageIndexes(layout, operation.range.focus)
      )
    case 'setRunProperties':
      return findRunPageIndexes(layout, operation.runId)
    case 'setParagraphProperties':
      return findParagraphPageIndexes(layout, operation.paragraphId)
    case 'mergeBlock':
      return mergePageIndexes(
        findBlockPageIndexes(layout, operation.targetBlockId),
        findBlockPageIndexes(layout, operation.sourceBlockId)
      )
    case 'insertBlock':
      if (operation.placement.kind === 'append') {
        const lastPage = layout.pages[layout.pages.length - 1]

        return lastPage === undefined ? [] : [lastPage.pageIndex]
      }

      return findBlockPageIndexes(layout, operation.placement.blockId)
    case 'deleteBlock':
      return findBlockPageIndexes(layout, operation.blockId)
  }
}

function findTextPositionPageIndexes(layout: DocumentLayout, position: TextPosition): readonly number[] {
  const caretRect = getLayoutCaretRect(layout, position)

  return caretRect === undefined ? [] : [caretRect.pageIndex]
}

function isSameTextPosition(left: TextPosition, right: TextPosition): boolean {
  return left.sectionId === right.sectionId
    && left.blockId === right.blockId
    && left.runId === right.runId
    && left.graphemeIndex === right.graphemeIndex
}

function findRunPageIndexes(layout: DocumentLayout, runId: string): readonly number[] {
  return mergePageIndexes(
    layout.pages.flatMap((page) => page.lines.some((line) =>
      line.fragments.some((fragment) => fragment.runId === runId)
      || line.inlines.some((inline) => inline.runId === runId)
    ) ? [page.pageIndex] : [])
  )
}

function findParagraphPageIndexes(layout: DocumentLayout, paragraphId: string): readonly number[] {
  return mergePageIndexes(
    layout.pages.flatMap((page) => page.paragraphs.some((paragraph) => paragraph.paragraphId === paragraphId) ? [page.pageIndex] : [])
  )
}

function findBlockPageIndexes(layout: DocumentLayout, blockId: string): readonly number[] {
  return mergePageIndexes(
    findParagraphPageIndexes(layout, blockId),
    layout.pages.flatMap((page) => page.lines.some((line) =>
      line.fragments.some((fragment) => fragment.blockId === blockId)
      || line.inlines.some((inline) => inline.blockId === blockId)
    ) ? [page.pageIndex] : [])
  )
}

function createCanvasElement(ownerDocument: Document): HTMLCanvasElement {
  const canvas = ownerDocument.createElement('canvas')

  if (ownerDocument.defaultView?.navigator.userAgent.includes('jsdom') === true) {
    Object.defineProperty(canvas, 'getContext', {
      value: () => null
    })
  }

  return canvas
}

/**
 * 创建 JWord editor facade。
 *
 * @param options 可选的 Gate 0 shell 配置。
 * @returns Editor 生命周期 facade。
 * @remarks
 * 此函数不访问浏览器 DOM。调用 {@link Editor.mount} 才会把 editor shell 挂载到 host 元素。
 *
 * @example
 * ```ts
 * const editor = createEditor();
 * editor.mount(document.querySelector('#editor')!);
 * editor.destroy();
 * ```
 */
export function createEditor(options?: EditorOptions): Editor {
  return new JWordEditor(options)
}

function createTransactionMetadata(origin: string, label: string | undefined): TransactionMetadata {
  return label === undefined ? { origin } : { origin, label }
}

function replaceStoreDocument(store: DocumentStore, input: EditorDocumentInput): void {
  const documentId = (input.documentId ?? DEFAULT_DOCUMENT_ID) as DocumentId
  const sectionId = (input.sectionId ?? DEFAULT_SECTION_ID) as SectionId
  const paragraphs = splitPlainTextIntoParagraphs(input.text ?? '')
  const section = createSectionRecord(sectionId)

  clearStore(store)
  initializeDocumentRoot(store, documentId, sectionId)
  store.sections.push([section])
  const sectionBlocks = getSectionBlocks(section)

  for (const [index, text] of paragraphs.entries()) {
    const paragraph = createParagraphRecord(`paragraph-${index + 1}` as BlockId)

    sectionBlocks.push([paragraph])
    getParagraphRuns(paragraph).push([createRunRecord(`run-${index + 1}` as RunId, text)])
  }

  const blockIds = section.get(DOCUMENT_STORE_FIELDS.section.blockIds) as unknown

  if (blockIds instanceof Y.Array) {
    const typedBlockIds = blockIds as Y.Array<BlockId>

    typedBlockIds.push(paragraphs.map((_, index) => `paragraph-${index + 1}` as BlockId))
  }
}

function clearStore(store: DocumentStore): void {
  store.document.clear()
  clearArray(store.sections)
  store.resources.clear()
  store.styles.clear()
  store.comments.clear()
  store.revisions.clear()
}

function initializeDocumentRoot(
  store: DocumentStore,
  documentId: DocumentId,
  sectionId: SectionId
): void {
  store.document.set(DOCUMENT_STORE_FIELDS.document.schemaVersion, DOCUMENT_STORE_SCHEMA_VERSION)
  store.document.set(DOCUMENT_STORE_FIELDS.document.id, documentId)
  store.document.set(DOCUMENT_STORE_FIELDS.document.metadata, new Y.Map<DocumentStoreJson>())
  store.document.set(DOCUMENT_STORE_FIELDS.document.sectionIds, createIdArray<SectionId>([sectionId]))
  store.document.set(DOCUMENT_STORE_FIELDS.document.resourceIds, createIdArray<ResourceId>([]))
  store.document.set(DOCUMENT_STORE_FIELDS.document.styleIds, createIdArray<StyleId>([]))
  store.document.set(DOCUMENT_STORE_FIELDS.document.commentIds, createIdArray<CommentId>([]))
  store.document.set(DOCUMENT_STORE_FIELDS.document.revisionIds, createIdArray<RevisionId>([]))
}

function createIdArray<Id extends string>(ids: readonly Id[]): Y.Array<Id> {
  const array = new Y.Array<Id>()

  if (ids.length > 0) {
    array.push([...ids])
  }

  return array
}

function clearArray<Item>(array: Y.Array<Item>): void {
  if (array.length > 0) {
    array.delete(0, array.length)
  }
}

function splitPlainTextIntoParagraphs(text: string): readonly string[] {
  const normalized = text.replace(/\r\n?/gu, '\n').trim()

  if (normalized.length === 0) {
    return ['']
  }

  return normalized.split(/\n\s*\n/gu)
}

function readCurrentDocumentId(store: DocumentStore): DocumentId {
  const documentId = store.document.get(DOCUMENT_STORE_FIELDS.document.id)

  if (typeof documentId !== 'string') {
    throw createJWordError('PROJECTION_INVALID_DOCUMENT', '当前文档缺少 ID')
  }

  return documentId as DocumentId
}

function findRunText(store: DocumentStore, input: EditorTextAnchorInput): Y.Text {
  for (const section of store.sections.toArray()) {
    if (section.get(DOCUMENT_STORE_FIELDS.section.id) !== input.sectionId) {
      continue
    }

    const text = findRunTextInBlocks(getSectionBlocks(section).toArray(), input)

    if (text !== undefined) {
      return text
    }
  }

  throw createJWordError('EDITOR_ANCHOR_TARGET_NOT_FOUND', '找不到文本锚点目标 run', {
    sectionId: input.sectionId,
    blockId: input.blockId,
    runId: input.runId
  })
}

function findRunTextInBlocks(
  blocks: readonly BlockRecord[],
  input: EditorTextAnchorInput
): Y.Text | undefined {
  for (const block of blocks) {
    if (block.get(DOCUMENT_STORE_FIELDS.block.id) === input.blockId) {
      const text = findRunTextInParagraph(block, input.runId)

      if (text !== undefined) {
        return text
      }
    }

    if (block.get(DOCUMENT_STORE_FIELDS.block.kind) === 'table') {
      const text = findRunTextInTable(block, input)

      if (text !== undefined) {
        return text
      }
    }
  }

  return undefined
}

function findRunTextInParagraph(block: BlockRecord, runId: string): Y.Text | undefined {
  if (block.get(DOCUMENT_STORE_FIELDS.block.kind) !== 'paragraph') {
    return undefined
  }

  for (const run of getParagraphRuns(block).toArray()) {
    if (run.get(DOCUMENT_STORE_FIELDS.run.id) === runId) {
      return getRunText(run)
    }
  }

  return undefined
}

function findRunTextInTable(block: BlockRecord, input: EditorTextAnchorInput): Y.Text | undefined {
  for (const row of getTableRows(block).toArray()) {
    for (const cell of getTableRowCells(row).toArray()) {
      const text = findRunTextInBlocks(getTableCellBlocks(cell).toArray(), input)

      if (text !== undefined) {
        return text
      }
    }
  }

  return undefined
}
