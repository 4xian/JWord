/**
 * 职责：集中定义 Editor facade 的公开类型与 editor runtime 内部 DOM/布局状态类型。
 * 边界：不创建运行时对象，不访问 DOM，不执行业务逻辑。
 * 协作模块：projection、selection、transaction、layout、history 和 formatting 类型。
 * 性能/安全约束：constructor/top-level 不访问 window/document/HTMLElement 实例，DOM 只在 mount 后创建，编辑命令统一进入 transaction pipeline。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/03-architecture.md 与 04-engineering-standards.md#45-模块边界。
 */
import type { CanvasLike, createCanvasPool } from '../canvas/pool'
import type { ParagraphAlignment, SelectionFormattingState } from '../model/formatting-types'
import type { Document, ModelProperties, ParagraphList } from '../model/types'
import type { HistoryOperationResult, HistoryScope } from '../operations/history'
import type { PageConfig, PageConfigInput } from '../layout/page-config'
import type { DocumentLayout, LayoutBox, LayoutOptions, LayoutRect } from '../layout/runtime'
import type { AnchorRef, RangeRef, TextRangeRecord } from '../model/position'
import type { DocumentProjection } from '../model/projection'
import type { SelectionState } from '../model/selection'
import type { Command, TextPosition, TextRange, TransactionEvent, TransactionMetadata, TransactionResult, TransactionUpdateMetadata } from '../operations/transaction'
import type { Resource, ResourceAdapter, ResourceUrlPolicy } from '../resources/types'
import type { CanvasImageResourceResolver } from '../resources/canvas-image-resolver'
import type { EditorAnchorSnapshot, EditorLocationQuery, EditorLocationTarget, EditorRangeSnapshot, EditorRangeSnapshotInput, EditorResolvedLocation, EditorScrollToLocationOptions, EditorSelectionSnapshot, EditorTextQueryResult } from './location-types'

export type { HistoryScope } from '../operations/history'

export type InitialFocusPosition = 'start' | 'end'

export interface EditorUser {
  /** 稳定作者 ID。 */
  readonly authorId: string
  /** 稳定作者显示名。 */
  readonly name?: string
  /** 兼容现有宿主的头像 URL。 */
  readonly avatarUrl?: string
  /** 兼容现有宿主的颜色标记。 */
  readonly color?: string
}

export interface EditorUserInput {
  /** 兼容现有宿主的用户 ID。 */
  readonly id?: string
  /** 稳定作者 ID。 */
  readonly authorId?: string
  /** 兼容现有宿主的显示名。 */
  readonly displayName?: string
  /** 稳定作者显示名别名。 */
  readonly name?: string
  /** 兼容现有宿主的头像 URL。 */
  readonly avatarUrl?: string
  /** 兼容现有宿主的颜色标记。 */
  readonly color?: string
}

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

  /**
   * 初始化时传入的布局分组选项。
   */
  readonly layout?: LayoutOptions

  /**
   * 初始化时传入的页面尺寸配置。
   */
  readonly page?: PageConfigInput

  /**
   * 初始化文档资源表。
   */
  readonly resources?: readonly Resource[]

  /**
   * 首次 focus 且当前无选区时的折叠光标位置。
   *
   * @defaultValue `"end"`
   */
  readonly initialFocusPosition?: InitialFocusPosition

  /**
   * 资源 URL allowlist 策略。
   */
  readonly resourceUrlPolicy?: ResourceUrlPolicy

  /**
   * 资源上传适配器。
   */
  readonly resourceAdapter?: ResourceAdapter

  /**
   * 当前本地用户。
   */
  readonly currentUser?: EditorUserInput
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
  /** 可选资源表快照。 */
  readonly resources?: readonly Resource[]
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
  /** 可选资源表快照。 */
  readonly resources?: readonly Resource[]
}

/**
 * 结构化文档模型导入输入。
 */
export interface EditorDocumentModelInput {
  /** 由 DOCX、持久化或宿主系统转换出的 canonical 文档模型。 */
  readonly document: Document
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
  /** Gate 6 协同、自动插入或恢复请求 ID。 */
  readonly requestId?: string
  /** Gate 6 协同 room ID。 */
  readonly roomId?: string
  /** Gate 6 协同 client ID。 */
  readonly clientId?: string
  /** Gate 6 作者 ID。 */
  readonly authorId?: string
  /** Gate 6 snapshot ID。 */
  readonly snapshotId?: string
  /** Gate 6 version ID。 */
  readonly versionId?: string
  /** 当前诊断是否可恢复。 */
  readonly recoverable?: boolean
  /**
   * 命令要进入的独立历史作用域。
   *
   * @remarks
   * 未提供时只按 origin 进入默认用户 undo；remote 和 auto-inserter 默认不进入用户 undo。
   */
  readonly historyScope?: HistoryScope
  /**
   * 命令成功后要落到 facade runtime 的选择区。
   *
   * @remarks
   * 该值不写入文档模型，只进入 history restore metadata。
   */
  readonly selectionAfter?: SelectionState | null
}

/** 编码当前 Y.Doc update 时使用的可选输入。 */
export interface EditorSyncUpdateInput {
  /** 可选 state vector；用于生成相对调用方状态的增量 update。 */
  readonly stateVector?: Uint8Array
}

/** 受控应用远端或恢复 update 时使用的公开选项。 */
export interface EditorApplyUpdateOptions extends Omit<TransactionUpdateMetadata, 'origin'> {
  /** 受控 update origin，只允许 Gate 6 三类非本地来源。 */
  readonly origin: TransactionUpdateMetadata['origin']
}

/**
 * 已由宿主/UI 清洗过的富文本粘贴 run。
 */
export interface EditorRichTextRun {
  /** 要插入的纯文本。 */
  readonly text: string
  /** run 级格式属性安全子集。 */
  readonly properties?: ModelProperties
}

/**
 * 已由宿主/UI 清洗过的富文本粘贴段落。
 */
export interface EditorRichTextParagraph {
  /** 段落级格式属性安全子集。 */
  readonly properties?: ModelProperties
  /** 段落内 run 列表。 */
  readonly runs: readonly EditorRichTextRun[]
}

/**
 * 已由宿主/UI 清洗过的富文本粘贴片段。
 */
export interface EditorRichTextFragment {
  /** 按文档顺序排列的段落片段。 */
  readonly paragraphs: readonly EditorRichTextParagraph[]
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
   * 加载受控结构化文档模型。
   *
   * @param input 已转换成 core canonical model 的文档。
   * @returns 加载后的只读 projection。
   * @remarks
   * 副作用：通过初始化事务替换当前 Y.Doc 文档根，不暴露 document-store 或 Y.Doc 内部结构。
   */
  loadDocumentModel(input: EditorDocumentModelInput): DocumentProjection

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
   * 创建公开 anchor 快照。
   *
   * @param input 目标 section、block、run 和 grapheme 边界。
   * @returns JSON 兼容 anchor 快照。
   */
  createAnchorSnapshot(input: EditorTextAnchorInput): EditorAnchorSnapshot

  /**
   * 创建公开 range 快照。
   *
   * @param input 范围起点和焦点。
   * @returns JSON 兼容 range 快照。
   */
  createRangeSnapshot(input: EditorRangeSnapshotInput): EditorRangeSnapshot

  /**
   * 读取当前选择区的公开快照。
   *
   * @returns 当前 selection 快照；没有选择区时返回 null。
   */
  readSelectionSnapshot(): EditorSelectionSnapshot | null

  /**
   * 按文本、块、标题、批注或 range 快照查询中立文本位置。
   *
   * @param query 查询输入。
   * @returns JSON 兼容位置结果列表。
   */
  findTextLocations(query: EditorLocationQuery): readonly EditorTextQueryResult[]

  /**
   * 把公开 location 输入解析成当前文档中的稳定纯数据位置。
   *
   * @param input 公开文本位置、anchor 快照、range 快照、selection 快照或 query 结果。
   * @returns 解析后的 JSON 兼容位置；无法解析时返回 null。
   */
  resolveLocation(input: EditorLocationTarget): EditorResolvedLocation | null

  /**
   * 把公开 location 滚动到已挂载编辑器视口。
   *
   * @param input 公开文本位置、anchor 快照、range 快照、selection 快照或 query 结果。
   * @param options 可选滚动行为。
   * @returns 是否成功滚动到目标位置。
   */
  scrollToLocation(input: EditorLocationTarget, options?: EditorScrollToLocationOptions): boolean

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
   * 读取当前页面配置。
   *
   * @returns 当前用于分页和渲染的只读页面配置。
   * @remarks
   * 无副作用，返回值不可变，调用方可直接读取预设、尺寸、边距和缩放。
   */
  getPageConfig(): PageConfig

  /**
   * 更新当前页面配置并触发重新布局。
   *
   * @param input 要覆盖到当前页面配置上的输入。
   * @returns 更新后的只读页面配置。
   * @remarks
   * 副作用：标记全部页面需要重排；若当前已挂载，会同步刷新分页 DOM 与 canvas。
   */
  setPageConfig(input: PageConfigInput): PageConfig

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
   * 读取当前本地用户。
   *
   * @returns 当前 editor 使用的稳定用户快照。
   */
  getCurrentUser(): EditorUser

  /**
   * 捕获当前 range 的稳定快照。
   *
   * @param range 需要持久化的稳定范围。
   * @returns JSON 兼容的范围快照记录。
   */
  captureRangeSnapshot(range: RangeRef): TextRangeRecord

  /**
   * 把稳定 range 快照解析回当前文本范围。
   *
   * @param snapshot 已持久化的范围快照。
   * @returns 当前文本范围；无法解析时返回 null。
   */
  locateRangeSnapshot(snapshot: TextRangeRecord): TextRange | null

  /**
   * 读取当前 facade runtime 选择区。
   *
   * @returns 当前选择区；没有光标或选区时返回 null。
   * @remarks
   * 无副作用，不读取 DOM，不暴露可写文档模型。
   */
  getSelection(): SelectionState | null

  /**
   * 定位指定批注 thread 当前绑定的稳定范围。
   *
   * @param threadId 批注 thread 标识。
   * @returns 当前可解析的范围；锚点失效时返回 null。
   */
  locateCommentThread(threadId: string): RangeRef | null

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
   * 切换当前选择区的上标状态。
   *
   * @remarks
   * 启用时会清掉同一目标上的下标属性，保持 run format 互斥语义。
   */
  toggleSuperscript(): void

  /**
   * 切换当前选择区的下标状态。
   *
   * @remarks
   * 启用时会清掉同一目标上的上标属性，保持 run format 互斥语义。
   */
  toggleSubscript(): void

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
   * 设置当前选择区段落的左缩进。
   *
   * @param value 目标左缩进 twips。
   */
  setParagraphIndent(value: number): void

  /**
   * 设置当前选择区段落的行距。
   *
   * @param value 目标行距值。
   */
  setParagraphLineHeight(value: number): void

  /**
   * 设置当前选择区段落的段前距。
   *
   * @param value 目标段前距 twips。
   */
  setParagraphSpacingBefore(value: number): void

  /**
   * 设置当前选择区段落的段后距。
   *
   * @param value 目标段后距 twips。
   */
  setParagraphSpacingAfter(value: number): void

  /**
   * 设置当前选择区段落的首行缩进。
   *
   * @param value 目标首行缩进 twips。
   */
  setParagraphFirstLineIndent(value: number): void

  /**
   * 设置当前选择区段落的悬挂缩进。
   *
   * @param value 目标悬挂缩进 twips。
   */
  setParagraphHangingIndent(value: number): void

  /**
   * 设置当前选择区段落的稳定样式语义。
   *
   * @param value 目标样式标识，例如 Heading1/Heading2/Heading3。
   */
  setParagraphStyle(value: string): void

  /**
   * 设置当前选择区段落的稳定列表语义。
   *
   * @param value 目标列表语义；传入 `null` 表示清空为 none。
   */
  setParagraphList(value: ParagraphList | null): void

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
   * 编码当前 Y.Doc 的二进制更新。
   *
   * @param input 可选状态向量。
   * @returns Yjs 二进制更新；调用方可传给协同提供方、更新日志或另一个编辑器。
   * @remarks
   * 无副作用，不暴露 Y.Doc、store、client clock 或内部结构。
   */
  encodeSyncUpdate(input?: EditorSyncUpdateInput): Uint8Array

  /**
   * 受控应用远端、系统恢复或版本恢复更新。
   *
   * @param update Yjs 二进制更新。
   * @param options 来源与 Gate 6 诊断字段。
   * @returns 事务管线结果。
   * @remarks
   * 副作用：经同一 Y.Doc 真源刷新投影、布局和渲染；协同提供方不应直接操作 DOM 或布局缓存。
   */
  applySyncUpdate(update: Uint8Array, options: EditorApplyUpdateOptions): TransactionResult

  /**
   * 用指定 update 的完整文档状态替换当前文档。
   *
   * @remarks
   * 仅供版本恢复使用；实现会先在隔离 Y.Doc 中读取目标版本，再经同一 transaction pipeline 替换当前 canonical 文档。
   */
  replaceSyncUpdate(update: Uint8Array, options: EditorApplyUpdateOptions): TransactionResult

  /**
   * 粘贴已清洗的结构化富文本片段。
   *
   * @param fragment UI 或宿主已经完成 HTML 清洗后的结构化片段。
   * @returns 是否成功生成并执行事务。
   * @remarks
   * core 不解析 HTML、不访问 DOMPurify；这里只消费安全纯数据并进入 transaction pipeline。
   */
  pasteRichTextFragment(fragment: EditorRichTextFragment): boolean

  /**
   * 撤销最近一次本地用户历史操作。
   *
   * @returns history manager 的 undo 结果。
   * @remarks
   * 副作用：通过 Y.UndoManager 回滚 Y.Doc；远端或自动插入 origin 默认不进入用户 undo 栈。
   */
  undo(scope?: HistoryScope): HistoryOperationResult

  /**
   * 重做最近一次撤销的本地用户历史操作。
   *
   * @returns history manager 的 redo 结果。
   * @remarks
   * 副作用：通过 Y.UndoManager 恢复 Y.Doc。
   */
  redo(scope?: HistoryScope): HistoryOperationResult

  /**
   * 判断当前是否存在可撤销的用户历史项。
   *
   * @returns 是否可撤销。
   */
  canUndo(scope?: HistoryScope): boolean

  /**
   * 判断当前是否存在可重做的用户历史项。
   *
   * @returns 是否可重做。
   */
  canRedo(scope?: HistoryScope): boolean

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
   * 聚焦当前已挂载的编辑器输入层。
   *
   * @returns 无返回值。
   * @remarks
   * 副作用：把隐藏输入框设为活动元素；当前没有 selection 时，会在文档首个可编辑位置放置折叠光标。
   *
   * @example
   * ```ts
   * editor.focus();
   * ```
   */
  focus(): void

  /**
   * 让当前已挂载的编辑器输入层失焦。
   *
   * @returns 无返回值。
   * @remarks
   * 副作用：把隐藏输入框移出活动焦点；不会清空当前 selection。
   *
   * @example
   * ```ts
   * editor.blur();
   * ```
   */
  blur(): void

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

export interface MountedEditorDom {
  readonly shell: HTMLElement
  readonly canvasContainer: HTMLElement
  readonly hiddenTextarea: HTMLTextAreaElement
  readonly liveRegion: HTMLElement
  readonly textMirror: HTMLElement
  readonly eventAbortController: AbortController
  readonly handleScroll: () => void
  readonly handleInput: (event: Event) => void
  readonly handleBeforeInput: (event: Event) => void
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
  readonly handleFocus: () => void
  readonly handleBlur: () => void
  readonly pool: ReturnType<typeof createCanvasPool>
  readonly pageWrappers: Map<number, HTMLElement>
  readonly baseCanvases: Map<number, HTMLCanvasElement>
  readonly imageResourceResolver?: CanvasImageResourceResolver
  readonly inputState: {
    isComposing: boolean
    compositionText: string
    pendingPlainInputText: string
  }
  readonly pointerState: {
    anchor: AnchorRef | null
    pageMetrics: PointerPageMetrics | null
    paintedPageIndexes: readonly number[]
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
  deferredTextMirrorSyncId: ReturnType<typeof setTimeout> | undefined
}

export interface TransientLayoutQuerySnapshot {
  readonly layout?: DocumentLayout
  readonly continuation?: Readonly<{
    dirtyPageIndex: number
    dirtyPageEndIndex: number
    startPosition: TextPosition
  }>
  readonly staleFromPageIndex?: number
  readonly needsInitialPass: boolean
}

export type EditorPageElement = HTMLElement

export type RenderReason = 'mount' | 'document' | 'selection' | 'viewport' | 'resource'

export type SelectionUpdateSource =
  | 'api'
  | 'command'
  | 'document'
  | 'history'
  | 'keyboard'
  | 'pointer'

export interface PointerPageMetrics {
  readonly pageIndex: number
  readonly left: number
  readonly top: number
  readonly scaleX: number
  readonly scaleY: number
}
