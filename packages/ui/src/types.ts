/**
 * 职责：定义 @4xian/jword-ui 的最小公开类型，不承载 DOM 构造或业务逻辑。
 * 边界：只描述装配参数、工具栏配置和返回句柄，不创建任何运行时对象。
 * 协作模块：create-ui 入口、toolbar controller/dom、media panel 与外部宿主通过这些类型对齐。
 * 性能/安全约束：纯类型模块，无副作用，可在非浏览器环境安全导入。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import type { DocumentProjection, Editor, ResourceUrlPolicy, SelectionState } from '@4xian/jword-core'
import type {
  JWordCommentPermissionOptions,
  JWordCommentThread,
  JWordCommentTimeFormatter,
  JWordCommentUser,
  JWordCommentUserResolver,
  JWordCommentsSidebarDom
} from './comments/types'
import type { JWordLinkPanelDom, JWordLinkUrlPolicy } from './link/types'

/** 当前 UI 包内建的 Gate 3 工具 ID。 */
export type JWordToolbarToolId =
  | 'history.undo'
  | 'history.redo'
  | 'document.pagePreset'
  | 'document.pageOrientation'
  | 'document.customPageSize'
  | 'document.findReplace'
  | 'document.watermark'
  | 'document.headingOutline'
  | 'document.headerFooter'
  | 'document.footer'
  | 'document.pageNumber'
  | 'document.revisions'
  | 'insert.comment'
  | 'insert.link'
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
  | 'view.fitWidth'
  | 'view.fitPage'
  | 'view.fullscreen'
  | 'view.presentation'
  | 'view.zoomReset'
  | 'view.theme'
  | 'view.locale'
  | 'export.native'

/** 顶部工具栏展示模式。 */
export type JWordToolbarMode = 'professional' | 'common'

/** 顶部工具栏专业模式 Tab ID。 */
export type JWordToolbarTabId =
  | 'home'
  | 'insert'
  | 'table'
  | 'page'
  | 'tools'
  | 'view'
  | 'export'


/** UI 主题名称。 */
export type JWordUiThemeName = 'light' | 'dark'

/** UI 主题 token 名称，运行时会映射为 --jw-* CSS custom properties。 */
export type JWordUiThemeToken =
  | 'colorSurface'
  | 'colorSurfaceMuted'
  | 'colorSurfaceElevated'
  | 'colorText'
  | 'colorTextMuted'
  | 'colorBorder'
  | 'colorBorderStrong'
  | 'colorAccent'
  | 'colorAccentMuted'
  | 'colorDanger'
  | 'radiusControl'
  | 'radiusPanel'
  | 'shadowShell'
  | 'shadowOverlay'
  | 'focusRing'

/** 宿主传入的轻量主题覆盖。 */
export interface JWordUiThemeOptions {
  /** 主题名；默认 light。 */
  readonly name?: JWordUiThemeName
  /** 宿主额外主题 class，只挂到 SDK UI 根节点。 */
  readonly className?: string
  /** token 覆盖；key 使用 camelCase，运行时转换成 --jw-*。 */
  readonly tokens?: Partial<Record<JWordUiThemeToken, string>>
}

/** UI 文本方向。 */
export type JWordUiTextDirection = 'ltr' | 'rtl' | 'auto'

/** toolbar 文案 key。 */
export type JWordUiToolbarTextKey =
  | 'toolbar.ariaLabel'
  | `toolbar.${string}`
  | `toolbar.${JWordToolbarToolId}.label`
  | `toolbar.${JWordToolbarToolId}.tooltip`
  | `toolbar.${JWordToolbarToolId}.fieldLabel`
  | `toolbar.${JWordToolbarToolId}.option.${string}`

/** menu 文案 key。 */
export type JWordUiMenuTextKey = `menu.${string}`

/** dialog 文案 key。 */
export type JWordUiDialogTextKey = `dialog.${string}`

/** a11y 播报文案 key。 */
export type JWordUiA11yTextKey = `a11y.${string}`

/** diagnostics 短文案 key。 */
export type JWordUiDiagnosticsTextKey = `diagnostics.${string}`

/** UI i18n 字典 key。 */
export type JWordUiI18nKey =
  | JWordUiToolbarTextKey
  | JWordUiStatusBarTextKey
  | JWordUiMenuTextKey
  | JWordUiDialogTextKey
  | JWordUiA11yTextKey
  | JWordUiDiagnosticsTextKey

/** UI i18n 字典，允许宿主只覆盖少量 key。 */
export type JWordUiI18nDictionary = Readonly<Partial<Record<JWordUiI18nKey, string>>>

/** createJWordUi 的 i18n 输入。 */
export interface JWordUiI18nOptions {
  /** 语言标签；默认 zh-CN。 */
  readonly locale?: string
  /** 文本方向；默认不强制。 */
  readonly dir?: JWordUiTextDirection
  /** 局部覆盖字典；宿主覆盖优先，未覆盖 key 按 locale 读取内建中英文字典。 */
  readonly messages?: JWordUiI18nDictionary
}

/** 状态栏文案 key。 */
export type JWordUiStatusBarTextKey = `statusBar.${string}`

/** 状态栏首批内建语言。 */
export type JWordStatusBarLocale = 'zh-CN' | 'en-US'

/** 状态栏首批 item id。 */
export type JWordStatusBarItemId =
  | 'brand'
  | 'wordCount'
  | 'characterCount'
  | 'paragraphCount'
  | 'page'
  | 'selection'
  | 'fullscreen'
  | 'presentation'
  | 'zoomSlider'
  | 'zoomPercent'
  | 'zoomReset'
  | 'fitWidth'
  | 'fitPage'
  | 'themeSwitcher'
  | 'localeSwitcher'

/** 状态栏品牌显示配置。 */
export type JWordStatusBarBrandProtectionMode = 'hidden' | 'restore' | 'watermarkFallback'

/** 状态栏品牌显示配置。 */
export interface JWordStatusBarBrandOptions {
  /** 品牌文案；未传时使用内建文案。 */
  readonly label?: string
  /** 版权防篡改策略；默认 restore。 */
  readonly protection?: JWordStatusBarBrandProtectionMode
}

/** 状态栏缩放配置；首批运行时会 clamp 到 20%-400%。 */
export interface JWordStatusBarZoomOptions {
  /** 最小缩放百分比；默认 20。 */
  readonly minPercent?: number
  /** 最大缩放百分比；默认 400。 */
  readonly maxPercent?: number
  /** 缩放滑块步进百分比；默认 10。 */
  readonly stepPercent?: number
}

/** 状态栏主题切换配置。 */
export interface JWordStatusBarThemeSwitcherOptions {
  /** 可切换主题列表；默认 light、dark。 */
  readonly themes?: readonly JWordUiThemeName[]
}

/** 状态栏语言切换配置。 */
export interface JWordStatusBarLocaleSwitcherOptions {
  /** 可切换语言列表；首批只支持 zh-CN 和 en-US。 */
  readonly locales?: readonly JWordStatusBarLocale[]
}

/** 状态栏配置。 */
export interface JWordStatusBarOptions {
  /** 状态栏挂载宿主；为空时 SDK 自动创建。 */
  readonly host?: HTMLElement
  /** 全屏和演示模式作用宿主；为空时使用 editorHost。 */
  readonly fullscreenHost?: HTMLElement
  /** 显式声明显示顺序；字段存在时严格采用该列表。 */
  readonly visibleItems?: readonly JWordStatusBarItemId[]
  /** 从默认项或 visibleItems 中过滤的状态栏项。 */
  readonly hiddenItems?: readonly JWordStatusBarItemId[]
  /** 品牌配置；false 表示隐藏品牌文案。 */
  readonly brand?: false | JWordStatusBarBrandOptions
  /** 缩放配置。 */
  readonly zoom?: JWordStatusBarZoomOptions
  /** 主题切换配置；false 表示隐藏主题切换。 */
  readonly themeSwitcher?: false | JWordStatusBarThemeSwitcherOptions
  /** 语言切换配置；false 表示隐藏语言切换。 */
  readonly localeSwitcher?: false | JWordStatusBarLocaleSwitcherOptions
}

/** 状态栏文档统计。 */
export interface JWordStatusBarDocumentStats {
  /** 按 MVP 口径统计的词数。 */
  readonly words: number
  /** 非空白 grapheme 字符数。 */
  readonly characters: number
  /** 段落块数量，包含表格单元格内段落。 */
  readonly paragraphs: number
}


/** 编辑器实例级页面水印配置。 */
export interface JWordWatermarkOptions {
  /** 水印内容，支持换行；空白内容视为清除。 */
  readonly text: string
  /** 字体大小，单位 px；默认 28。 */
  readonly fontSizePx?: number
  /** 水印颜色；默认灰色。 */
  readonly color?: string
  /** 水印透明度；默认 0.18。 */
  readonly opacity?: number
  /** 旋转角度；默认 -30。 */
  readonly rotateDeg?: number
}

/** 工具栏显隐配置。 */
export interface JWordToolbarOptions {
  /** 工具栏展示模式；未传时默认专业模式，旧 visibleTools 用法会兼容为常用模式。 */
  readonly mode?: JWordToolbarMode
  /** 专业模式下是否显示切换到常用工具栏的按钮；默认显示。 */
  readonly modeSwitcher?: boolean
  /** 常用模式配置。 */
  readonly common?: {
    /** 常用模式显示顺序；为空数组表示不显示常用工具。 */
    readonly visibleTools?: readonly JWordToolbarToolId[]
    /** 从常用工具中隐藏指定工具。 */
    readonly hiddenTools?: readonly JWordToolbarToolId[]
  }
  /** 专业模式配置。 */
  readonly professional?: {
    /** 专业模式默认激活 Tab。 */
    readonly defaultTab?: JWordToolbarTabId
    /** 隐藏指定专业模式 Tab。 */
    readonly hiddenTabs?: readonly JWordToolbarTabId[]
    /** 覆盖指定 Tab 的工具顺序。 */
    readonly tabTools?: Partial<Record<JWordToolbarTabId, readonly JWordToolbarToolId[]>>
  }
  /** 显式声明显示顺序；字段存在时严格采用该列表，空数组表示不显示工具。 */
  readonly visibleTools?: readonly JWordToolbarToolId[]
  /** 未传 visibleTools 时从全部内建工具中过滤；已传 visibleTools 时从该列表中过滤。 */
  readonly hiddenTools?: readonly JWordToolbarToolId[]
}

/** 插件 toolbar / menu 读取状态时可见的只读上下文。 */
export interface JWordUiPluginRenderContext {
  /** 当前 editor facade。 */
  readonly editor: Editor
  /** 当前只读文档投影。 */
  readonly projection: DocumentProjection
  /** 当前选择区快照。 */
  readonly selection: SelectionState | null
  /** 宿主 UI 是否处于只读模式。 */
  readonly readonly: boolean
}

/** 插件 toolbar 按钮定义。 */
export interface JWordToolbarPluginItem {
  /** 当前插件内唯一名称。 */
  readonly name: string
  /** 当前 M4 仅落地按钮工具。 */
  readonly kind: 'button'
  /** 可见按钮文案。 */
  readonly label: string
  /** 无障碍标签；未传时复用 label。 */
  readonly ariaLabel?: string
  /** tooltip 文案；未传时复用 label。 */
  readonly tooltip?: string
  /** 点击时执行的 core 插件命令。 */
  readonly commandName: string
  /** 传给插件命令的输入。 */
  readonly input?: unknown
  /** 只读模式下是否仍允许触发。 */
  readonly allowReadonly?: boolean
  /** 返回按钮是否可用。 */
  readonly enabled?: (context: JWordUiPluginRenderContext) => boolean
  /** 返回按钮是否处于按下态。 */
  readonly active?: (context: JWordUiPluginRenderContext) => boolean
  /** 返回命令执行后的播报文案；未返回文案时不播报。 */
  readonly announce?: (context: JWordUiPluginRenderContext) => string | undefined
}

/** 插件菜单动作定义。 */
export interface JWordMenuPluginAction {
  /** 当前菜单内唯一动作名称。 */
  readonly name: string
  /** 菜单动作文案。 */
  readonly label: string
  /** 菜单动作辅助说明，用于展示尺寸、快捷信息等次级文案。 */
  readonly description?: string
  /** 无障碍标签；未传时复用 label。 */
  readonly ariaLabel?: string
  /** 点击时执行的 core 插件命令。 */
  readonly commandName: string
  /** 传给插件命令的输入。 */
  readonly input?: unknown
  /** 只读模式下是否仍允许触发。 */
  readonly allowReadonly?: boolean
  /** 返回菜单动作是否可用。 */
  readonly enabled?: (context: JWordUiPluginRenderContext) => boolean
  /** 返回菜单动作是否处于选中态。 */
  readonly active?: (context: JWordUiPluginRenderContext) => boolean
  /** 返回命令执行后的播报文案；未返回文案时不播报。 */
  readonly announce?: (context: JWordUiPluginRenderContext) => string | undefined
}

/** 插件菜单定义。 */
export interface JWordMenuPluginItem {
  /** 当前插件内唯一菜单名称。 */
  readonly name: string
  /** 菜单触发按钮文案。 */
  readonly label: string
  /** 无障碍标签；未传时复用 label。 */
  readonly ariaLabel?: string
  /** tooltip 文案；未传时复用 label。 */
  readonly tooltip?: string
  /** 菜单动作列表。 */
  readonly items: readonly JWordMenuPluginAction[]
}

/** UI 包消费的插件扩展声明。 */
export interface JWordUiPluginExtension {
  /** 对应 core 插件名称。 */
  readonly pluginName: string
  /** 插件 toolbar 按钮。 */
  readonly toolbarItems?: readonly JWordToolbarPluginItem[]
  /** 插件菜单。 */
  readonly menus?: readonly JWordMenuPluginItem[]
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
export type JWordMediaUrlPolicy = ResourceUrlPolicy

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

/** 列宽更新请求。 */
export interface JWordTableColumnResizeRequest extends JWordTableTargetCommandRequest {
  readonly columnIndex: number
  readonly widthTwips: number
}

/** 行高更新请求。 */
export interface JWordTableRowResizeRequest extends JWordTableTargetCommandRequest {
  readonly rowIndex: number
  readonly heightTwips: number
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
  setColumnWidth?(
    request: JWordTableColumnResizeRequest
  ): JWordTableCommandResult | Promise<JWordTableCommandResult>
  setRowHeight?(
    request: JWordTableRowResizeRequest
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

/** SDK 级当前用户配置。 */
export interface JWordUserOptions {
  /** 当前编辑器实例对应的本地用户；为空时回退到 editor.getCurrentUser()。 */
  readonly currentUser?: JWordCommentUser
  /** 作者目录解析函数。 */
  readonly resolveUser?: JWordCommentUserResolver
}

/** Gate 4 批注侧栏配置。 */
export interface JWordCommentsOptions {
  /** 批注侧栏挂载宿主；为空时由 SDK 在 editorHost 内创建默认右侧 rail。 */
  readonly host?: HTMLElement
  /** 初始批注列表；为空时从 editor projection 读取。 */
  readonly threads?: readonly JWordCommentThread[]
  /** 批注权限配置。 */
  readonly permissions?: JWordCommentPermissionOptions
  /** 创建时间格式化函数。 */
  readonly formatCreatedAt?: JWordCommentTimeFormatter
}

/** Gate 4 链接 UI 配置。 */
export interface JWordLinkOptions {
  /** 链接 panel 挂载宿主；为空时挂到 toolbar 扩展区域。 */
  readonly host?: HTMLElement
  /** URL protocol allowlist。 */
  readonly policy?: JWordLinkUrlPolicy
  /** 打开链接由宿主接管，SDK 不直接调用 window.open。 */
  readonly openLink?: (url: string) => Promise<void> | void
}

/** Gate 4 页眉页脚和页码基础 UI 配置。 */
export interface JWordHeaderFooterOptions {
  /** 页眉页脚面板挂载宿主；为空时挂到 SDK 默认 toolbar 面板宿主。 */
  readonly host?: HTMLElement
}

/** Gate 4 基础目录面板配置。 */
export interface JWordHeadingOutlineOptions {
  /** 目录面板挂载宿主；为空时挂到 SDK 默认 editor shell 宿主。 */
  readonly host?: HTMLElement
}

/** Gate 4 查找替换基础 UI 配置。 */
export interface JWordFindReplaceOptions {
  /** 查找替换面板挂载宿主；为空时挂到 SDK 默认 toolbar 面板宿主。 */
  readonly host?: HTMLElement
  /** 是否启用 Ctrl/Cmd+F 与 Ctrl/Cmd+H 快捷键；默认启用。 */
  readonly keyboardShortcuts?: boolean
  /** 是否大小写敏感；默认 true，宿主可设 false 启用大小写不敏感搜索。 */
  readonly caseSensitive?: boolean
}

/** Gate 4 修订 metadata 面板配置。 */
export interface JWordRevisionsOptions {
  /** 修订面板挂载宿主；为空时挂到 SDK 默认 toolbar 面板宿主。 */
  readonly host?: HTMLElement
}

/** 全局只读模式配置。 */
export interface JWordReadonlyOptions {
  /** 开启后只允许阅读、滚动和只读定位，不允许编辑。 */
  readonly enabled?: boolean
  /** 只读时是否隐藏 toolbar；默认隐藏。 */
  readonly hideToolbar?: boolean
  /** 只读时是否允许目录和查找定位；默认允许。 */
  readonly allowNavigation?: boolean
}

/** 控制器级只读配置。 */
export type JWordReadonlyMode = JWordReadonlyOptions | boolean | undefined

/** createJWordUi 的装配输入。 */
export interface CreateJWordUiOptions {
  /** 已创建并可供 UI 调用的 core editor facade。 */
  readonly editor: Editor
  /** toolbar 挂载宿主；为空时 SDK 会在已挂载的 editorHost 内创建默认宿主。 */
  readonly toolbarHost?: HTMLElement
  /** 已挂载 editor 的宿主；传入后可复用 Gate 3 的大文档 blocked summary 规则。 */
  readonly editorHost?: HTMLElement
  /** live region 宿主；为空时只关闭播报，不阻止 toolbar 工作。 */
  readonly liveRegionHost?: HTMLElement | null
  /** 隐藏文本镜像宿主；为空时只关闭 mirror，不阻止 toolbar 工作。 */
  readonly assistiveMirrorHost?: HTMLElement | null
  /** 主题 token 与宿主 class 覆盖；默认 light。 */
  readonly theme?: JWordUiThemeOptions
  /** UI 文案和 a11y 播报覆盖；缺失 key 回退内建中文。 */
  readonly i18n?: JWordUiI18nOptions
  /** toolbar 的最小显隐配置；false 表示隐藏整条 toolbar。 */
  readonly toolbar?: false | JWordToolbarOptions
  /** 底部状态栏配置；默认启用，false 表示禁用。 */
  readonly statusBar?: true | false | JWordStatusBarOptions
  /** SDK 级用户上下文。 */
  readonly user?: JWordUserOptions
  /** 图片入口配置；为空时使用默认轻量适配器并显示官方图片入口。 */
  readonly media?: JWordMediaOptions
  /** 表格入口配置；为空时使用默认 core 表格命令适配器并显示官方表格入口。 */
  readonly table?: JWordTableOptions
  /** Gate 4 批注侧栏；传 `true` 时启用 SDK 默认右侧 rail。 */
  readonly comments?: true | JWordCommentsOptions
  /** Gate 4 链接 UI。 */
  readonly link?: JWordLinkOptions
  /** Gate 4 页眉页脚和页码基础 UI。 */
  readonly headerFooter?: JWordHeaderFooterOptions
  /** Gate 4 基础目录 UI。 */
  readonly headingOutline?: JWordHeadingOutlineOptions
  /** Gate 4 查找替换基础 UI。 */
  readonly findReplace?: JWordFindReplaceOptions
  /** Gate 4 修订 metadata 面板。 */
  readonly revisions?: JWordRevisionsOptions
  /** 宿主级全局只读模式。 */
  readonly readonly?: boolean | JWordReadonlyOptions
  /** Gate 7 M4 插件 UI 扩展声明。 */
  readonly pluginExtensions?: readonly JWordUiPluginExtension[]
}

/** live region 控制器的最小协作边界。 */
export interface JWordUiLiveRegionController {
  announce(message: string, options?: {
    readonly force?: boolean
    readonly priority?: 'polite' | 'assertive'
  }): void
  destroy(): void
}

/** text mirror 控制器的最小协作边界。 */
export interface JWordUiTextMirrorController {
  sync(options?: { readonly immediate?: boolean }): void
  destroy(): void
}

/** controller 与 assistive 层的内部协作参数。 */
export interface CreateToolbarControllerOptions extends Omit<CreateJWordUiOptions, 'toolbarHost'> {
  /** toolbar 挂载宿主。 */
  readonly toolbarHost: HTMLElement
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
  /** 插件工具按钮映射，key 形如 plugin:插件名:工具名。 */
  readonly pluginControls: Readonly<Record<string, HTMLButtonElement>>
}

/** 状态栏暴露给宿主和浏览器测试的节点。 */
export interface JWordStatusBarElements {
  /** 状态栏挂载宿主。 */
  readonly host: HTMLElement
  /** 状态栏根节点。 */
  readonly root: HTMLElement
  /** 左侧状态区。 */
  readonly left: HTMLElement
  /** 右侧视图控制区。 */
  readonly right: HTMLElement
  /** 状态栏 item 控件映射。 */
  readonly controls: Partial<Record<JWordStatusBarItemId, HTMLElement>>
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

/** 页眉页脚面板暴露给宿主和浏览器测试的节点。 */
export interface JWordHeaderFooterPanelElements {
  /** 页眉页脚面板宿主。 */
  readonly host: HTMLElement
  /** 面板根节点。 */
  readonly root: HTMLElement
  /** 页眉页脚入口按钮。 */
  readonly triggerButton: HTMLButtonElement
  /** 页眉页脚下拉菜单。 */
  readonly menu: HTMLElement
  /** 页眉入口按钮。 */
  readonly headerTriggerButton: HTMLButtonElement
  /** 页眉下拉菜单。 */
  readonly headerMenu: HTMLElement
  /** 页脚入口按钮。 */
  readonly footerTriggerButton: HTMLButtonElement
  /** 页脚下拉菜单。 */
  readonly footerMenu: HTMLElement
  /** 页码入口按钮。 */
  readonly pageNumberTriggerButton: HTMLButtonElement
  /** 页码下拉菜单。 */
  readonly pageNumberMenu: HTMLElement
  /** 页眉标识输入。 */
  readonly headerInput: HTMLInputElement
  /** 页脚标识输入。 */
  readonly footerInput: HTMLInputElement
  /** 页码起始值输入。 */
  readonly pageStartInput: HTMLInputElement
  /** 添加页眉按钮。 */
  readonly addHeaderButton: HTMLButtonElement
  /** 添加页脚按钮。 */
  readonly addFooterButton: HTMLButtonElement
  /** 删除页眉按钮。 */
  readonly deleteHeaderButton: HTMLButtonElement
  /** 删除页脚按钮。 */
  readonly deleteFooterButton: HTMLButtonElement
  /** 页脚菜单下一页分节按钮。 */
  readonly footerNextPageButton: HTMLButtonElement
  /** 页脚菜单连续分节按钮。 */
  readonly footerContinuousButton: HTMLButtonElement
  /** 上方左侧页码按钮。 */
  readonly pageNumberTopLeftButton: HTMLButtonElement
  /** 上方中间页码按钮。 */
  readonly pageNumberTopCenterButton: HTMLButtonElement
  /** 上方右侧页码按钮。 */
  readonly pageNumberTopRightButton: HTMLButtonElement
  /** 下方左侧页码按钮。 */
  readonly pageNumberBottomLeftButton: HTMLButtonElement
  /** 下方中间页码按钮。 */
  readonly pageNumberBottomCenterButton: HTMLButtonElement
  /** 下方右侧页码按钮。 */
  readonly pageNumberBottomRightButton: HTMLButtonElement
  /** 删除页码按钮。 */
  readonly deletePageNumberButton: HTMLButtonElement
  /** 下一页分节按钮。 */
  readonly nextPageButton: HTMLButtonElement
  /** 连续分节按钮。 */
  readonly continuousButton: HTMLButtonElement
}

/** 修订 metadata 面板暴露给宿主和浏览器测试的节点。 */
export interface JWordRevisionPanelElements {
  /** 修订面板宿主。 */
  readonly host: HTMLElement
  /** 面板根节点。 */
  readonly root: HTMLElement
  /** 修订列表节点。 */
  readonly list: HTMLElement
  /** 空状态节点。 */
  readonly emptyState: HTMLElement
}

/** 查找替换面板暴露给宿主和浏览器测试的节点。 */
export interface JWordFindReplacePanelElements {
  /** 查找替换面板宿主。 */
  readonly host: HTMLElement
  /** 面板根节点。 */
  readonly root: HTMLElement
  /** 关闭按钮。 */
  readonly closeButton: HTMLButtonElement
  /** 查找词输入。 */
  readonly queryInput: HTMLInputElement
  /** 替换词输入。 */
  readonly replacementInput: HTMLInputElement
  /** 查找按钮。 */
  readonly findButton: HTMLButtonElement
  /** 上一个结果按钮。 */
  readonly previousButton: HTMLButtonElement
  /** 下一个结果按钮。 */
  readonly nextButton: HTMLButtonElement
  /** 替换当前结果按钮。 */
  readonly replaceButton: HTMLButtonElement
  /** 替换全部结果按钮。 */
  readonly replaceAllButton: HTMLButtonElement
  /** 状态输出节点。 */
  readonly status: HTMLOutputElement
}

/** 基础目录面板暴露给宿主和浏览器测试的节点。 */
export interface JWordHeadingOutlinePanelElements {
  /** 目录面板宿主。 */
  readonly host: HTMLElement
  /** 目录项列表节点。 */
  readonly list: HTMLElement
}

/** createJWordUi 返回的完整 DOM 句柄。 */
export interface JWordUiElements extends JWordToolbarElements {
  /** 底部状态栏；未启用时为 null。 */
  readonly statusBar: JWordStatusBarElements | null
  /** Gate 4 第一版图片 panel；未启用时为 null。 */
  readonly mediaPanel: JWordMediaPanelElements | null
  /** Gate 4 Iteration 2 表格 panel；未启用时为 null。 */
  readonly tablePanel: JWordTablePanelElements | null
  /** Gate 4 选区浮层；editorHost 未提供时为 null。 */
  readonly selectionActions: JWordSelectionActionElements | null
  /** Gate 4 批注侧栏；未启用时为 null。 */
  readonly commentsPanel: JWordCommentsSidebarDom | null
  /** Gate 4 链接 panel；未启用时为 null。 */
  readonly linkPanel: JWordLinkPanelDom | null
  /** Gate 4 页眉页脚 panel；未启用时为 null。 */
  readonly headerFooterPanel: JWordHeaderFooterPanelElements | null
  /** Gate 4 基础目录 panel；未启用时为 null。 */
  readonly headingOutlinePanel: JWordHeadingOutlinePanelElements | null
  /** Gate 4 查找替换 panel；未启用时为 null。 */
  readonly findReplacePanel: JWordFindReplacePanelElements | null
  /** Gate 4 修订 metadata panel；未启用时为 null。 */
  readonly revisionsPanel: JWordRevisionPanelElements | null
}

/** UI 装配实例的最小返回值。 */
export interface JWordUiInstance {
  /** 供宿主或测试读取的 DOM 句柄。 */
  readonly elements: JWordUiElements
  /** 动态切换 UI 主题，不销毁 editor。 */
  setTheme(theme: JWordUiThemeOptions): void
  /** 动态切换 UI 内建语言；首批只支持中文和英文。 */
  setLocale(locale: JWordStatusBarLocale, messages?: JWordUiI18nDictionary): void
  /** 设置编辑器实例级页面水印。 */
  setWatermark(options: JWordWatermarkOptions): void
  /** 清除用户设置的页面水印，不清除版权保护水印。 */
  clearWatermark(): void
  /** 读取当前用户页面水印配置。 */
  getWatermark(): JWordWatermarkOptions | null
  /** 在宿主外部更新 editor 状态后手动刷新 UI。 */
  refresh(): void
  /** 销毁 toolbar 订阅与 DOM。 */
  destroy(): void
}
