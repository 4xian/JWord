/**
 * 职责：定义 @4xian/jword-ui 的最小公开类型，不承载 DOM 构造或业务逻辑。
 * 边界：只描述装配参数、工具栏配置和返回句柄，不创建任何运行时对象。
 * 协作模块：create-ui 入口、toolbar controller/dom 与外部宿主通过这些类型对齐。
 * 性能/安全约束：纯类型模块，无副作用，可在非浏览器环境安全导入。
 * Specs：docs/superpowers/plans/2026-05-17-jword-ui-sdk-gate4-integration.md。
 */
import type { Editor } from '@4xian/jword-core'

/** 当前 UI 包内建的 Gate 3 工具 ID。 */
export type JWordToolbarToolId =
  | 'history.undo'
  | 'history.redo'
  | 'document.pagePreset'
  | 'format.bold'
  | 'format.italic'
  | 'format.underline'
  | 'format.strike'
  | 'format.fontFamily'
  | 'format.fontSize'
  | 'format.textColor'
  | 'format.backgroundColor'
  | 'paragraph.alignLeft'
  | 'paragraph.alignCenter'
  | 'paragraph.alignRight'
  | 'paragraph.alignJustify'
  | 'paragraph.indentDecrease'
  | 'paragraph.indentIncrease'

/** 工具栏显隐配置。 */
export interface JWordToolbarOptions {
  /** 显式声明显示顺序；为空时回退到内建默认顺序。 */
  readonly visibleTools?: readonly JWordToolbarToolId[]
  /** 在默认顺序或 visibleTools 基础上再过滤一层。 */
  readonly hiddenTools?: readonly JWordToolbarToolId[]
  /** 是否显示选区 / 格式 / blocked summary。 */
  readonly showSummaries?: boolean
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

/** UI 装配实例的最小返回值。 */
export interface JWordUiInstance {
  /** 供宿主或测试读取的 DOM 句柄。 */
  readonly elements: JWordToolbarElements
  /** 在宿主外部更新 editor 状态后手动刷新 UI。 */
  refresh(): void
  /** 销毁 toolbar 订阅与 DOM。 */
  destroy(): void
}
