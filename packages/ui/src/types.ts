/**
 * 职责：定义 @4xian/jword-ui 的最小公开类型，不承载 DOM 构造或业务逻辑。
 * 边界：只描述装配参数、工具栏配置和返回句柄，不创建任何运行时对象。
 * 协作模块：create-ui 入口、toolbar controller/dom、media panel 与外部宿主通过这些类型对齐。
 * 性能/安全约束：纯类型模块，无副作用，可在非浏览器环境安全导入。
 * Specs：docs/superpowers/plans/2026-05-17-jword-ui-sdk-gate4-integration.md。
 */
import type { DocumentProjection, Editor, SelectionState } from '@4xian/jword-core'

/** 当前 UI 包内建的 Gate 3 工具 ID。 */
export type JWordToolbarToolId =
  | 'history.undo'
  | 'history.redo'
  | 'document.pagePreset'
  | 'format.bold'
  | 'format.italic'
  | 'format.underline'
  | 'format.strike'
  | 'format.superscript'
  | 'format.subscript'
  | 'format.fontFamily'
  | 'format.fontSize'
  | 'format.fontSizeDecrease'
  | 'format.fontSizeIncrease'
  | 'format.textColor'
  | 'format.backgroundColor'
  | 'paragraph.alignment'
  | 'paragraph.indentDecrease'
  | 'paragraph.indentIncrease'
  | 'paragraph.indentLeft'
  | 'paragraph.lineHeight'
  | 'paragraph.spacingBefore'
  | 'paragraph.spacingAfter'
  | 'paragraph.firstLineIndent'
  | 'paragraph.hangingIndent'
  | 'paragraph.style'
  | 'paragraph.list'

/** 工具栏显隐配置。 */
export interface JWordToolbarOptions {
  /** 显式声明显示顺序；为空时回退到内建默认顺序。 */
  readonly visibleTools?: readonly JWordToolbarToolId[]
  /** 在默认顺序或 visibleTools 基础上再过滤一层。 */
  readonly hiddenTools?: readonly JWordToolbarToolId[]
  /** 是否显示选区 / 格式 / blocked summary。 */
  readonly showSummaries?: boolean
}

/** Gate 4 第一版图片资源状态。 */
export type JWordMediaStatus = 'pending' | 'success' | 'failed'

/** 图片资源来源。 */
export type JWordMediaSource =
  | {
      readonly kind: 'dataUrl'
      readonly url: string
    }
  | {
      readonly kind: 'blobUrl'
      readonly url: string
    }
  | {
      readonly kind: 'externalUrl'
      readonly url: string
    }

/** 图片资源错误快照。 */
export interface JWordMediaErrorState {
  readonly code: string
  readonly message: string
}

/** 图片资源 metadata。 */
export type JWordMediaMetadata = Readonly<Record<string, unknown>>

/** 图片资源最小快照。 */
export interface JWordMediaResource {
  readonly kind: 'resource'
  readonly id: string
  readonly mime: string
  readonly source: JWordMediaSource
  readonly status: JWordMediaStatus
  readonly error?: JWordMediaErrorState
  readonly retryToken?: string
  readonly metadata?: JWordMediaMetadata
}

/** 上传进度事件。 */
export interface JWordMediaUploadProgressEvent {
  readonly loaded: number
  readonly total?: number
}

/** 上传文件边界。 */
export interface JWordMediaUploadFile {
  readonly name: string
  readonly type: string
  readonly size: number
  arrayBuffer(): Promise<ArrayBuffer>
}

/** 上传输入来源。 */
export type JWordMediaUploadSource =
  | {
      readonly kind: 'file'
      readonly file: JWordMediaUploadFile
    }
  | {
      readonly kind: 'url'
      readonly url: string
    }

/** 上传请求。 */
export interface JWordMediaUploadRequest {
  readonly resourceId: string
  readonly source: JWordMediaUploadSource
  readonly previousResource?: JWordMediaResource
  readonly retryToken?: string
}

/** 上传选项。 */
export interface JWordMediaUploadOptions {
  readonly signal?: AbortSignal
  readonly onProgress?: (event: JWordMediaUploadProgressEvent) => void
}

/** 上传结果。 */
export interface JWordMediaUploadResult {
  readonly resource: JWordMediaResource
}

/** 图片资源上传适配器。 */
export interface JWordMediaAdapter {
  upload(
    request: JWordMediaUploadRequest,
    options?: JWordMediaUploadOptions
  ): Promise<JWordMediaUploadResult>
  delete?(resource: JWordMediaResource): Promise<void>
}

/** URL allowlist。 */
export interface JWordMediaUrlPolicy {
  readonly allowDataUrl?: boolean
  readonly allowBlobUrl?: boolean
  readonly allowExternalUrl?: (url: URL) => boolean
}

/** 当前选中的图片目标快照。 */
export interface JWordSelectedImageTarget {
  readonly resourceId: string
  readonly widthTwips?: number
  readonly heightTwips?: number
  readonly rotationDegrees?: number
}

/** 图片命令执行请求。 */
export interface JWordMediaInsertRequest {
  readonly editor: Editor
  readonly projection: DocumentProjection
  readonly selection: SelectionState | null
  readonly resource: JWordMediaResource
}

/** 图片命令执行结果。 */
export interface JWordMediaCommandResult {
  readonly kind: 'applied' | 'deferred'
  readonly message?: string
}

/** 图片 command 对接边界。 */
export interface JWordMediaCommandAdapter {
  resolveSelectedImageTarget?(
    projection: DocumentProjection,
    selection: SelectionState | null
  ): JWordSelectedImageTarget | null
  insertInlineImage?(
    request: JWordMediaInsertRequest
  ): JWordMediaCommandResult | Promise<JWordMediaCommandResult>
  replaceSelectedImageResource?(
    request: JWordMediaInsertRequest & { readonly target: JWordSelectedImageTarget }
  ): JWordMediaCommandResult | Promise<JWordMediaCommandResult>
  resizeSelectedImage?(
    input: {
      readonly editor: Editor
      readonly projection: DocumentProjection
      readonly selection: SelectionState | null
      readonly target: JWordSelectedImageTarget
      readonly widthTwips?: number
      readonly heightTwips?: number
    }
  ): JWordMediaCommandResult | Promise<JWordMediaCommandResult>
  setSelectedImageRotation?(
    input: {
      readonly editor: Editor
      readonly projection: DocumentProjection
      readonly selection: SelectionState | null
      readonly target: JWordSelectedImageTarget
      readonly rotationDegrees: number
    }
  ): JWordMediaCommandResult | Promise<JWordMediaCommandResult>
  moveSelectedImage?(
    input: {
      readonly editor: Editor
      readonly projection: DocumentProjection
      readonly selection: SelectionState | null
      readonly target: JWordSelectedImageTarget
      readonly dropSelection: SelectionState
    }
  ): JWordMediaCommandResult | Promise<JWordMediaCommandResult>
  deleteSelectedImage?(
    input: {
      readonly editor: Editor
      readonly projection: DocumentProjection
      readonly selection: SelectionState | null
      readonly target: JWordSelectedImageTarget
    }
  ): JWordMediaCommandResult | Promise<JWordMediaCommandResult>
}

/** Gate 4 第一版官方图片 UI 配置。 */
export interface JWordMediaOptions {
  readonly adapter: JWordMediaAdapter
  readonly commands?: JWordMediaCommandAdapter
  readonly urlPolicy?: JWordMediaUrlPolicy
  readonly title?: string
  readonly description?: string
}

/** 表格工具栏的作用范围。 */
export type JWordTableSelectionScope = 'cell' | 'row' | 'column'

/** 表格边框基础预设。 */
export type JWordTableBorderPreset =
  | 'all'
  | 'outer'
  | 'innerHorizontal'
  | 'innerVertical'
  | 'none'

/** 当前激活的表格目标快照。 */
export interface JWordTableSelectionTarget {
  readonly tableId: string
  readonly sectionId: string
  readonly rowIndex: number
  readonly columnIndex: number
  readonly cellIndex: number
  readonly rowCount: number
  readonly columnCount: number
  readonly rowCellCount: number
  readonly cellId: string
  readonly blockId: string
  readonly runId: string
  readonly cellGridSpan: number
}

/** 表格命令的最小上下文。 */
export interface JWordTableCommandContext {
  readonly editor: Editor
  readonly projection: DocumentProjection
  readonly selection: SelectionState | null
}

/** 插入表格请求。 */
export interface JWordTableInsertRequest extends JWordTableCommandContext {
  readonly rows: number
  readonly columns: number
}

/** 基于当前表格目标的命令请求。 */
export interface JWordTableTargetCommandRequest extends JWordTableCommandContext {
  readonly target: JWordTableSelectionTarget
}

/** 行操作请求。 */
export interface JWordTableRowCommandRequest extends JWordTableTargetCommandRequest {
  readonly placement: 'before' | 'after'
}

/** 列操作请求。 */
export interface JWordTableColumnCommandRequest extends JWordTableTargetCommandRequest {
  readonly placement: 'before' | 'after'
}

/** 边框更新请求。 */
export interface JWordTableBorderCommandRequest extends JWordTableTargetCommandRequest {
  readonly scope: JWordTableSelectionScope
  readonly preset: JWordTableBorderPreset
}

/** 表格命令执行结果。 */
export interface JWordTableCommandResult {
  readonly kind: 'applied' | 'deferred'
  readonly message?: string
}

/** 表格 command 对接边界。 */
export interface JWordTableCommandAdapter {
  resolveActiveTableTarget?(
    input: JWordTableCommandContext
  ): JWordTableSelectionTarget | null
  insertTable?(
    request: JWordTableInsertRequest
  ): JWordTableCommandResult | Promise<JWordTableCommandResult>
  insertRow?(
    request: JWordTableRowCommandRequest
  ): JWordTableCommandResult | Promise<JWordTableCommandResult>
  deleteRow?(
    request: JWordTableTargetCommandRequest
  ): JWordTableCommandResult | Promise<JWordTableCommandResult>
  insertColumn?(
    request: JWordTableColumnCommandRequest
  ): JWordTableCommandResult | Promise<JWordTableCommandResult>
  deleteColumn?(
    request: JWordTableTargetCommandRequest
  ): JWordTableCommandResult | Promise<JWordTableCommandResult>
  mergeCellWithRight?(
    request: JWordTableTargetCommandRequest
  ): JWordTableCommandResult | Promise<JWordTableCommandResult>
  applyBorderPreset?(
    request: JWordTableBorderCommandRequest
  ): JWordTableCommandResult | Promise<JWordTableCommandResult>
}

/** Gate 4 Iteration 2 官方表格 UI 配置。 */
export interface JWordTableOptions {
  readonly commands: JWordTableCommandAdapter
  readonly title?: string
  readonly description?: string
}

/** createJWordUi 的装配输入。 */
export interface CreateJWordUiOptions {
  /** 已创建并可供 UI 调用的 core editor facade。 */
  readonly editor: Editor
  /** toolbar 挂载宿主。 */
  readonly toolbarHost: HTMLElement
  /** 已挂载 editor 的宿主；传入后可复用 Gate 3 的大文档 blocked summary 规则。 */
  readonly editorHost?: HTMLElement
  /** live region 宿主；为空时只关闭播报，不阻止 toolbar 工作。 */
  readonly liveRegionHost?: HTMLElement | null
  /** 隐藏文本镜像宿主；为空时只关闭 mirror，不阻止 toolbar 工作。 */
  readonly assistiveMirrorHost?: HTMLElement | null
  /** toolbar 的最小显隐配置。 */
  readonly toolbar?: JWordToolbarOptions
  /** Gate 4 第一版图片 panel。 */
  readonly media?: JWordMediaOptions
  /** Gate 4 Iteration 2 表格工具。 */
  readonly table?: JWordTableOptions
}

/** live region 控制器的最小协作边界。 */
export interface JWordUiLiveRegionController {
  announce(message: string, options?: { readonly force?: boolean }): void
  destroy(): void
}

/** text mirror 控制器的最小协作边界。 */
export interface JWordUiTextMirrorController {
  sync(options?: { readonly immediate?: boolean }): void
  destroy(): void
}

/** controller 与 assistive 层的内部协作参数。 */
export interface CreateToolbarControllerOptions extends CreateJWordUiOptions {
  readonly assistive: {
    readonly liveRegion: JWordUiLiveRegionController | null
    readonly textMirror: JWordUiTextMirrorController | null
  }
}

/** toolbar 暴露给宿主的控件元素。 */
export type JWordToolbarControlElement =
  | HTMLButtonElement
  | HTMLSelectElement
  | HTMLInputElement

/** createJWordUi 返回的 DOM 句柄。 */
export interface JWordToolbarElements {
  /** toolbar 宿主。 */
  readonly host: HTMLElement
  /** 内建工具控件映射。 */
  readonly controls: Partial<Record<JWordToolbarToolId, JWordToolbarControlElement>>
  /** 选区 summary 节点；关闭 summaries 时为 null。 */
  readonly selectionSummary: HTMLElement | null
  /** 格式 summary 节点；关闭 summaries 时为 null。 */
  readonly runSummary: HTMLElement | null
  /** blocked summary 节点；关闭 summaries 时为 null。 */
  readonly blockedSummary: HTMLElement | null
}

/** 图片 panel 暴露给宿主和浏览器测试的节点。 */
export interface JWordMediaPanelElements {
  /** toolbar 内图片入口宿主。 */
  readonly host: HTMLElement
  /** toolbar 上的图片触发按钮。 */
  readonly triggerButton: HTMLButtonElement
  /** 下拉菜单宿主。 */
  readonly menu: HTMLElement
  /** 本地上传动作按钮。 */
  readonly fileActionButton: HTMLButtonElement
  /** 网络地址动作按钮。 */
  readonly urlActionButton: HTMLButtonElement
  /** 隐藏文件输入。 */
  readonly fileInput: HTMLInputElement
  /** URL 输入弹框遮罩。 */
  readonly urlDialog: HTMLElement
  /** URL 输入框。 */
  readonly urlDialogInput: HTMLInputElement
  /** URL 确认按钮。 */
  readonly urlDialogConfirmButton: HTMLButtonElement
  /** URL 取消按钮。 */
  readonly urlDialogCancelButton: HTMLButtonElement
  /** URL 错误提示。 */
  readonly urlDialogError: HTMLElement
}

/** 表格 panel 暴露给宿主和浏览器测试的节点。 */
export interface JWordTablePanelElements {
  /** 表格工具根宿主。 */
  readonly host: HTMLElement
  /** 表格独立辅助层根宿主。 */
  readonly overlay: HTMLElement
  /** toolbar 上的插入表格触发按钮。 */
  readonly insertTriggerButton: HTMLButtonElement
  /** 插入表格下拉面板。 */
  readonly insertMenu: HTMLElement
  /** 预览网格当前尺寸文案。 */
  readonly insertPreviewLabel: HTMLElement
  /** 3 x 9 预览网格按钮。 */
  readonly insertPreviewButtons: readonly HTMLButtonElement[]
  /** 自定义行列弹窗。 */
  readonly customSizeDialog: HTMLElement
  /** 自定义行列入口按钮。 */
  readonly customSizeButton: HTMLButtonElement
  /** 自定义行列取消按钮。 */
  readonly customSizeCancelButton: HTMLButtonElement
  /** 表格上方辅助边区入口。 */
  readonly topAnchor: HTMLButtonElement
  /** 表格左侧辅助边区入口。 */
  readonly leftAnchor: HTMLButtonElement
  /** 表格命中后的快捷工具区。 */
  readonly quickTools: HTMLElement
  /** 当前目标摘要。 */
  readonly summary: HTMLElement
  /** 插入表格的行数输入。 */
  readonly insertRowsInput: HTMLInputElement
  /** 插入表格的列数输入。 */
  readonly insertColumnsInput: HTMLInputElement
  /** 插入表格确认按钮。 */
  readonly insertConfirmButton: HTMLButtonElement
  /** 作用范围：单元格。 */
  readonly scopeCellButton: HTMLButtonElement
  /** 作用范围：整行。 */
  readonly scopeRowButton: HTMLButtonElement
  /** 作用范围：整列。 */
  readonly scopeColumnButton: HTMLButtonElement
  /** 在当前行上方插入。 */
  readonly insertRowBeforeButton: HTMLButtonElement
  /** 在当前行下方插入。 */
  readonly insertRowAfterButton: HTMLButtonElement
  /** 删除当前行。 */
  readonly deleteRowButton: HTMLButtonElement
  /** 在当前列左侧插入。 */
  readonly insertColumnBeforeButton: HTMLButtonElement
  /** 在当前列右侧插入。 */
  readonly insertColumnAfterButton: HTMLButtonElement
  /** 删除当前列。 */
  readonly deleteColumnButton: HTMLButtonElement
  /** 合并当前单元格与右侧单元格。 */
  readonly mergeRightButton: HTMLButtonElement
  /** 边框预设下拉。 */
  readonly borderPresetSelect: HTMLSelectElement
  /** 应用边框按钮。 */
  readonly applyBorderButton: HTMLButtonElement
}

/** 选区浮动工具栏与右键菜单对外暴露的最小句柄。 */
export interface JWordSelectionActionElements {
  /** selection-actions 根宿主。 */
  readonly host: HTMLElement
  /** 非折叠文本选区上的浮动工具栏。 */
  readonly floatingToolbar: HTMLElement
  /** 右键菜单根节点。 */
  readonly contextMenu: HTMLElement
}

/** createJWordUi 返回的完整 DOM 句柄。 */
export interface JWordUiElements extends JWordToolbarElements {
  /** Gate 4 第一版图片 panel；未启用时为 null。 */
  readonly mediaPanel: JWordMediaPanelElements | null
  /** Gate 4 Iteration 2 表格 panel；未启用时为 null。 */
  readonly tablePanel: JWordTablePanelElements | null
  /** Gate 4 选区浮层；editorHost 未提供时为 null。 */
  readonly selectionActions: JWordSelectionActionElements | null
}

/** UI 装配实例的最小返回值。 */
export interface JWordUiInstance {
  /** 供宿主或测试读取的 DOM 句柄。 */
  readonly elements: JWordUiElements
  /** 在宿主外部更新 editor 状态后手动刷新 UI。 */
  refresh(): void
  /** 销毁 toolbar 订阅与 DOM。 */
  destroy(): void
}
