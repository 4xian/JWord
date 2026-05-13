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
import { DEFAULT_HISTORY_ORIGIN, createHistoryManager } from './history'
import type { HistoryOperationResult } from './history'
import {
  getCaretRect as getLayoutCaretRect,
  getSelectionRects as getLayoutSelectionRects,
  hitTestDocumentLayout,
  layoutDocument
} from './layout'
import type { DocumentLayout, LayoutBox, LayoutDirtyRange, LayoutRect, PageBox } from './layout'
import { createLayoutSchedule } from './layout-scheduler'
import { createPageConfig, twipsToCssPx } from './page-config'
import { createTextAnchorRef, resolveAnchorRef } from './position'
import type { AnchorRef, BlockId, CommentId, DocumentId, RangeRef, RevisionId, RunId, SectionId } from './position'
import { createGraphemeIndex } from './position'
import { createDocumentProjection } from './projection'
import type { DocumentProjection } from './projection'
import { createSelectionRestoreSnapshot, restoreSelection } from './selection'
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
   * 设置当前 facade runtime 选择区。
   *
   * @param selection 当前选择区；传入 null 表示清空选择区。
   * @remarks
   * 只更新 facade 运行时状态，不写入 Y.Doc，不创建第二套文档模型。
   */
  setSelection(selection: SelectionState | null): void

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
  readonly handleScroll: () => void
  readonly pool: ReturnType<typeof createCanvasPool>
  readonly pageWrappers: Map<number, HTMLElement>
  canvases: Map<number, CanvasLike>
}

type RenderReason = 'mount' | 'document' | 'selection' | 'viewport'

class JWordEditor implements Editor {
  private readonly label: string
  private readonly store: DocumentStore
  private readonly pipeline: ReturnType<typeof createTransactionPipeline>
  private readonly history: ReturnType<typeof createHistoryManager>
  private readonly pageConfig = createPageConfig()
  private readonly fontManager = createFontManager()
  private readonly listeners = new Set<EditorEventListener>()
  private readonly unsubscribePipeline: () => void
  private currentProjection: DocumentProjection
  private cachedLayout: DocumentLayout | undefined
  private layoutDirtyRange: LayoutDirtyRange | undefined
  private layoutNeedsRefresh = false
  private pageStartKeys: readonly string[] = []
  private dirtyPageIndex = 0
  private mountedDom: MountedEditorDom | undefined
  private currentSelection: SelectionState | null = null
  private selectionPageIndexes: readonly number[] = []
  private isDestroyed = false

  constructor(options?: EditorOptions) {
    this.label = options?.label ?? DEFAULT_EDITOR_LABEL
    this.store = createDocumentStore()
    this.currentProjection = createDocumentProjection(this.store)
    this.pipeline = createTransactionPipeline(this.store.doc)
    this.history = createHistoryManager(this.store)
    this.unsubscribePipeline = this.pipeline.subscribe((event) => {
      this.currentProjection = event.projection
      this.layoutNeedsRefresh = true
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
      graphemeIndex: Number(snapshot.graphemeIndex)
    }
  }

  getLayout(): DocumentLayout {
    this.assertActive()

    return this.ensureCurrentLayout()
  }

  hitTest(point: EditorHitTestPoint): AnchorRef | undefined {
    this.assertActive()

    const position = hitTestDocumentLayout(this.ensureCurrentLayout(), point)

    if (position === undefined) {
      return undefined
    }

    return this.createTextAnchor({
      sectionId: position.sectionId,
      blockId: position.blockId,
      runId: position.runId,
      graphemeIndex: position.graphemeIndex
    })
  }

  getCaretRect(anchor: AnchorRef): LayoutRect | undefined {
    this.assertActive()

    return getLayoutCaretRect(this.ensureCurrentLayout(), this.resolveTextPosition(anchor))
  }

  getSelectionRects(range: RangeRef): readonly LayoutRect[] {
    this.assertActive()

    return getLayoutSelectionRects(this.ensureCurrentLayout(), {
      anchor: this.resolveTextPosition(range.anchor),
      focus: this.resolveTextPosition(range.focus)
    })
  }

  getSelection(): SelectionState | null {
    this.assertActive()

    return this.currentSelection
  }

  setSelection(selection: SelectionState | null): void {
    this.assertActive()

    this.currentSelection = selection
    this.renderMountedLayout('selection')
  }

  executeCommand(command: Command, options: EditorCommandOptions = {}): TransactionResult {
    this.assertActive()

    const origin = options.origin ?? DEFAULT_HISTORY_ORIGIN
    const metadata = createTransactionMetadata(origin, options.label)
    const shouldTrackHistory = this.history.trackedOrigins.has(origin) && command.operations.length > 0
    const selectionBefore = this.currentSelection
    const hasSelectionAfter = 'selectionAfter' in options
    const selectionAfter = hasSelectionAfter ? options.selectionAfter ?? null : this.currentSelection
    this.dirtyPageIndex = this.resolveCommandDirtyPageIndex(command) ?? this.resolveCurrentSelectionPageIndex() ?? 0
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
      const result = this.pipeline.run(command, metadata)

      if (hasSelectionAfter) {
        this.currentSelection = options.selectionAfter ?? null
      }

      return result
    } catch (error) {
      if (shouldTrackHistory) {
        this.history.discardNextTransactionMetadata()
      }

      throw error
    }
  }

  undo(): HistoryOperationResult {
    this.assertActive()

    const result = this.history.undo()

    if (result.metadata?.selectionBefore !== undefined) {
      this.currentSelection = restoreSelection(result.metadata.selectionBefore)
    }

    return result
  }

  redo(): HistoryOperationResult {
    this.assertActive()

    const result = this.history.redo()

    if (result.metadata?.selectionAfter !== undefined) {
      this.currentSelection = restoreSelection(result.metadata.selectionAfter)
    }

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
    shell.style.width = '100%'
    shell.style.height = '100%'
    canvasContainer.style.width = '100%'
    canvasContainer.style.height = '100%'
    canvasContainer.style.overflow = 'auto'
    canvasContainer.style.position = 'relative'

    const handleScroll = () => {
      this.renderMountedLayout('viewport')
    }

    canvasContainer.addEventListener('scroll', handleScroll)
    shell.append(canvasContainer)
    host.append(shell)

    this.mountedDom = {
      shell,
      canvasContainer,
      handleScroll,
      pool: createCanvasPool({
        createCanvas: () => createCanvasElement(ownerDocument)
      }),
      pageWrappers: new Map(),
      canvases: new Map()
    }
    this.renderMountedLayout('mount')
  }

  destroy(): void {
    if (this.isDestroyed) {
      return
    }

    if (this.mountedDom !== undefined) {
      this.mountedDom.canvasContainer.removeEventListener('scroll', this.mountedDom.handleScroll)

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
    this.dirtyPageIndex = 0
    this.layoutDirtyRange = undefined
    const result = this.pipeline.runMutation(commandName, { origin }, () => {
      replaceStoreDocument(this.store, input)
    })

    this.currentProjection = result.projection
    this.currentSelection = null

    return result.projection
  }

  private renderMountedLayout(reason: RenderReason): void {
    const mountedDom = this.mountedDom

    if (mountedDom === undefined) {
      return
    }

    const layout = this.ensureCurrentLayout()
    const nextPageStartKeys = createPageStartKeys(layout)
    const schedule = createLayoutSchedule({
      pageCount: layout.pages.length,
      dirtyPageIndex: this.dirtyPageIndex,
      previousPageStartKeys: this.pageStartKeys,
      nextPageStartKeys,
      chunkSize: 4
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
    const scheduledPageIndexes = resolveScheduledPageIndexes(schedule)
    const shouldUseSchedule = reason === 'document'
    const retainedPageIndexes = mergePageIndexes(
      viewport.retainedPageIndexes,
      shouldUseSchedule ? scheduledPageIndexes : [],
      selectionRender.pageIndexes,
      this.selectionPageIndexes
    )
    const rerenderPageIndexes = mergePageIndexes(
      reason === 'mount' ? viewport.retainedPageIndexes : [],
      shouldUseSchedule ? scheduledPageIndexes : [],
      selectionRender.pageIndexes,
      this.selectionPageIndexes
    )

    mountedDom.canvases = syncPageCanvases({
      pages: layout.pages,
      retainedPageIndexes,
      rerenderPageIndexes,
      canvases: mountedDom.canvases,
      pool: mountedDom.pool,
      ...(selectionRender.selectionRects === undefined ? {} : { selectionRects: selectionRender.selectionRects }),
      ...(selectionRender.caretRect === undefined ? {} : { caretRect: selectionRender.caretRect }),
      scale: this.pageConfig.scale
    })

    syncPageWrappers(mountedDom, layout.pages, this.pageConfig.scale)
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
  }

  private ensureCurrentLayout(): DocumentLayout {
    if (this.cachedLayout !== undefined && !this.layoutNeedsRefresh) {
      return this.cachedLayout
    }

    const nextLayout = layoutDocument({
      projection: this.currentProjection,
      pageConfig: this.pageConfig,
      fontManager: this.fontManager,
      previousLayout: this.layoutNeedsRefresh ? this.cachedLayout : undefined,
      dirtyPageIndex: this.layoutNeedsRefresh ? this.dirtyPageIndex : undefined,
      ...(this.layoutDirtyRange === undefined ? {} : { dirtyRange: this.layoutDirtyRange })
    })

    this.cachedLayout = nextLayout
    this.layoutNeedsRefresh = false
    this.layoutDirtyRange = undefined

    return nextLayout
  }

  private resolveCurrentSelectionPageIndex(): number | undefined {
    if (this.currentSelection === null) {
      return undefined
    }

    try {
      return getLayoutCaretRect(this.ensureCurrentLayout(), this.resolveTextPosition(this.currentSelection.anchor))?.pageIndex
    } catch {
      return undefined
    }
  }

  private resolveCommandDirtyPageIndex(command: Command): number | undefined {
    if (command.operations.length === 0) {
      return undefined
    }

    const layout = this.ensureCurrentLayout()
    const pageIndexes = mergePageIndexes(...command.operations.map((operation) => resolveOperationDirtyPageIndexes(layout, operation)))

    return pageIndexes[0]
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

  private assertActive(): void {
    if (this.isDestroyed) {
      throw createJWordError('EDITOR_DESTROYED', 'JWord editor has been destroyed.')
    }
  }
}

function createPageElement(mountedDom: MountedEditorDom, layoutPage: LayoutBox, scale: number) {
  const page = mountedDom.canvasContainer.ownerDocument.createElement('div')
  updatePageElement(page, mountedDom.canvases.get(layoutPage.pageIndex), layoutPage, scale)

  return page
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
  page: HTMLElement,
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

function resolveScheduledPageIndexes(schedule: ReturnType<typeof createLayoutSchedule>): readonly number[] {
  return mergePageIndexes(
    schedule.immediatePageIndexes,
    schedule.deferredChunks.flat()
  )
}

function mergePageIndexes(...sources: readonly (readonly number[])[]): readonly number[] {
  return Object.freeze([...new Set(sources.flat())].sort((left, right) => left - right))
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
