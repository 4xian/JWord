/**
 * 职责：绑定 toolbar 撤销、重做和原生导出入口。
 * 边界：只调度 editor 历史 API 和宿主导出事件，不维护 toolbar 状态或 DOM 生命周期。
 * 协作模块：controller 提供动作上下文，toolbar-state-sync 负责按钮绑定和播报。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import { readJWordUiText, type ResolvedJWordUiI18n } from '../i18n'
import { bindToolbarButton, type ToolbarActionContext } from './toolbar-state-sync'

/** 绑定撤销、重做和原生导出按钮。 */
export function bindToolbarHistoryControls(
  context: ToolbarActionContext,
  readI18n: () => ResolvedJWordUiI18n
): void {
  const { dom, editor } = context

  bindToolbarButton(context, dom.controls['history.undo'], () => {
    context.markToolbarTransaction()
    const result = editor.undo()

    context.render()
    context.announce(readJWordUiText(
      readI18n(),
      result.stackItem === null ? 'a11y.history.undoUnavailable' : 'a11y.history.undoCompleted'
    ), result.stackItem !== null)
  })
  bindToolbarButton(context, dom.controls['history.redo'], () => {
    context.markToolbarTransaction()
    const result = editor.redo()

    context.render()
    context.announce(readJWordUiText(
      readI18n(),
      result.stackItem === null ? 'a11y.history.redoUnavailable' : 'a11y.history.redoCompleted'
    ), result.stackItem !== null)
  })
  bindToolbarButton(context, dom.controls['export.native'], () => {
    dispatchNativeExportRequest(context, readI18n())
  }, { restoreEditorFocus: false })
}

/** 派发原生格式导出请求，供宿主接管。 */
function dispatchNativeExportRequest(context: ToolbarActionContext, i18n: ResolvedJWordUiI18n): void {
  const CustomEventCtor = context.dom.host.ownerDocument.defaultView?.CustomEvent ?? CustomEvent
  const event = new CustomEventCtor('jword-toolbar-export-native', {
    bubbles: true,
    cancelable: true,
    detail: {
      editor: context.editor
    }
  })

  context.dom.host.dispatchEvent(event)
  if (!event.defaultPrevented) {
    context.announce(readJWordUiText(i18n, 'a11y.export.nativeUnavailable'))
  }
}
