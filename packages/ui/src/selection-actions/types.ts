/**
 * 职责：定义选区浮动工具栏与右键菜单内部使用的最小类型边界。
 * 边界：只描述 controller、state 与 DOM 协作形状，不创建运行时对象。
 * 协作模块：selection-actions/controller、dom、state 以及 create-ui 装配入口。
 * 性能/安全约束：纯类型模块，无副作用，可在非浏览器环境安全导入。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md Gate 4 选区浮层收尾项。
 */
import type { Editor, SelectionState } from '@4xian/jword-core'
import type { JWordSelectionActionElements, JWordUiLiveRegionController } from '../types'
import type { ToolbarPressedState } from '../toolbar/state'

/** 选区动作弹层的定位结果。 */
export interface SelectionActionPosition {
  readonly left: number
  readonly top: number
}

/** controller 创建参数。 */
export interface CreateSelectionActionsControllerOptions {
  readonly editor: Editor
  readonly editorHost: HTMLElement
  readonly colorFormat: SelectionActionsColorFormatController
  readonly insertActions?: SelectionActionsInsertController
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

/** selection-actions controller 对外暴露的最小句柄。 */
export interface SelectionActionsControllerHandle {
  readonly elements: JWordSelectionActionElements
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
