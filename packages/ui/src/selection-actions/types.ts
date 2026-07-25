/**
 * 职责：定义选区浮动工具栏与右键菜单内部使用的最小类型边界。
 * 边界：只描述 controller、state 与 DOM 协作形状，不创建运行时对象。
 * 协作模块：selection-actions/controller、dom、state 以及 create-ui 装配入口。
 * 性能/安全约束：纯类型模块，无副作用，可在非浏览器环境安全导入。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import type { Editor, SelectionState } from '@4xian/jword-core'
import type { ResolvedJWordUiI18n } from '../i18n'
import type { JWordReadonlyMode, JWordSelectionActionElements, JWordUiLiveRegionController } from '../types'
import type { ToolbarPressedState } from '../toolbar/state'

/** 选区动作弹层的定位结果。 */
export interface SelectionActionPosition {
  readonly left: number
  readonly top: number
}

/** 选区颜色控件类型。 */
export type SelectionActionColorKind = 'text' | 'background'

/** controller 创建参数。 */
export interface CreateSelectionActionsControllerOptions {
  readonly editor: Editor
  readonly editorHost: HTMLElement
  readonly colorFormat: SelectionActionsColorFormatController
  readonly insertActions?: SelectionActionsInsertController
  readonly readonly?: JWordReadonlyMode
  readonly i18n?: ResolvedJWordUiI18n
  readonly assistive: {
    readonly liveRegion: JWordUiLiveRegionController | null
  }
}

/** 由主 toolbar 提供的颜色格式提交能力，selection-actions 只负责复用。 */
export interface SelectionActionsColorFormatController {
  applyColorFromSelection(
    property: 'textColor' | 'backgroundColor',
    selection: SelectionState | null,
    value: string
  ): void
}

/** selection-actions 触发的插入类动作。 */
export interface SelectionActionsInsertController {
  openComment(selection: SelectionState | null): void
  openLink(selection: SelectionState | null): void
  openActiveLink?(selection: SelectionState | null): void
  editLink?(selection: SelectionState | null): void
  removeLink?(selection: SelectionState | null): void
  hasLink?(selection: SelectionState | null): boolean
  readLinkUrl?(selection: SelectionState | null): string | null
  readLinkSelectionFromTarget?(target: Element | null): SelectionState | null
}

/** 浮动工具栏与右键菜单的只读渲染状态。 */
export interface SelectionActionsViewState {
  readonly floatingVisible: boolean
  readonly floatingPosition: SelectionActionPosition | null
  readonly contextMenuVisible: boolean
  readonly contextMenuPosition: SelectionActionPosition | null
  readonly contextSelectionKey: string
  readonly formatEnabled: boolean
  readonly insertLinkEnabled: boolean
  readonly activeLinkUrl: string | null
  readonly contextHasLink: boolean
  readonly boldPressed: ToolbarPressedState
  readonly italicPressed: ToolbarPressedState
  readonly underlinePressed: ToolbarPressedState
  readonly strikePressed: ToolbarPressedState
  readonly textColorValue: string
  readonly backgroundColorValue: string
  readonly activeColorPicker: 'text' | 'background' | null
  readonly cutDisabled: boolean
  readonly copyDisabled: boolean
  readonly clearDisabled: boolean
}

/** 浮动工具栏冻结状态。 */
export interface StickyFloatingToolbarState {
  readonly selectionKey: string | null
  readonly position: SelectionActionPosition | null
}

/** controller 与命令绑定共享的可变运行态。 */
export interface SelectionActionsRuntimeState {
  readonly stableContextSelection: StableContextSelectionState
  readonly frozenColorSelections: {
    text: SelectionState | null
    background: SelectionState | null
  }
  readonly activeColorValues: {
    text: string | null
    background: string | null
  }
  readonly activeColorInputSeen: {
    text: boolean
    background: boolean
  }
  readonly activeColorReturnedToEditor: {
    text: boolean
    background: boolean
  }
  dismissedSelectionKey: string | null
  stickyFloatingSelectionKey: string | null
  stickyFloatingPosition: SelectionActionPosition | null
  openColorPicker: SelectionActionColorKind | null
  interactiveFocus: boolean
  destroyed: boolean
}

/** selection-actions controller 对外暴露的最小句柄。 */
export interface SelectionActionsControllerHandle {
  readonly elements: JWordSelectionActionElements
  setI18n(i18n: ResolvedJWordUiI18n): void
  refresh(): void
  destroy(): void
}

/** 浮动工具栏 format 控件集合。 */
export interface SelectionActionsFormatControls {
  readonly bold: HTMLButtonElement
  readonly italic: HTMLButtonElement
  readonly underline: HTMLButtonElement
  readonly strike: HTMLButtonElement
  readonly insertLink: HTMLButtonElement
  readonly openLink: HTMLButtonElement
  readonly editLink: HTMLButtonElement
  readonly removeLink: HTMLButtonElement
  readonly textColor: HTMLInputElement
  readonly backgroundColor: HTMLInputElement
}

/** 右键菜单动作控件集合。 */
export interface SelectionActionsContextControls {
  readonly cut: HTMLButtonElement
  readonly copy: HTMLButtonElement
  readonly paste: HTMLButtonElement
  readonly pastePlainText: HTMLButtonElement
  readonly clear: HTMLButtonElement
  readonly insertLink: HTMLButtonElement
  readonly openLink: HTMLButtonElement
  readonly editLink: HTMLButtonElement
  readonly removeLink: HTMLButtonElement
  readonly insertComment: HTMLButtonElement
  readonly insertBookmark: HTMLButtonElement
  readonly forwardReference: HTMLButtonElement
}

/** selection-actions DOM 句柄。 */
export interface SelectionActionsDom extends JWordSelectionActionElements {
  readonly formatControls: SelectionActionsFormatControls
  readonly contextControls: SelectionActionsContextControls
}

/** 右键菜单冻结的稳定选区快照。 */
export interface StableContextSelectionState {
  selection: SelectionState | null
  linkSelection: SelectionState | null
  point: SelectionActionPosition | null
}
