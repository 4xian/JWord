/**
 * 职责：绑定 toolbar 页面预设、方向和自定义页面尺寸控件。
 * 边界：只修改 editor page config，不处理视图缩放、面板或插入动作。
 * 协作模块：controller 提供 action context，page-size-dialog 处理自定义尺寸输入。
 * 性能/安全约束：所有页面配置变更继续通过 editor facade 执行。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import {
  type PageOrientation,
  type PagePreset
} from '@4xian/jword-core'
import {
  readJWordUiText,
  type ResolvedJWordUiI18n
} from '../i18n'
import { openCustomPageSizeDialog } from './page-size-dialog'
import { readPagePresetAnnouncement } from './state'
import {
  bindToolbarButton,
  bindToolbarSelect,
  readSelect,
  type ToolbarActionContext
} from './toolbar-state-sync'

/** 绑定页面预设、方向和自定义页面尺寸控件。 */
export function bindPageControls(
  context: ToolbarActionContext,
  readI18n: () => ResolvedJWordUiI18n
): void {
  const { dom, editor, readonlyMode } = context

  bindToolbarSelect(context, dom.controls['document.pagePreset'], () => {
    const control = readSelect(dom.controls['document.pagePreset'])

    if (control === null) {
      return
    }

    const nextValue = control.value

    if (nextValue === 'custom') {
      context.render()
      openPageSizeDialog(context, readI18n())
      return
    }

    const nextPreset = nextValue as PagePreset
    const currentPreset = editor.getPageConfig().preset

    if (currentPreset === nextPreset) {
      context.render()
      return
    }

    context.markToolbarTransaction()
    const nextPageConfig = editor.setPageConfig({ preset: nextPreset })

    context.render()
    context.announce(readPagePresetAnnouncement(nextPreset, nextPageConfig), true)
  })
  bindToolbarSelect(context, dom.controls['document.pageOrientation'], () => {
    const control = readSelect(dom.controls['document.pageOrientation'])

    if (control === null) {
      return
    }

    const nextOrientation = control.value as PageOrientation
    const currentOrientation = editor.getPageConfig().orientation

    if (currentOrientation === nextOrientation) {
      context.render()
      return
    }

    context.markToolbarTransaction()
    editor.setPageConfig({ orientation: nextOrientation })
    context.render()
    context.announce(readPageOrientationAnnouncement(readI18n(), nextOrientation), true)
  })
  bindToolbarButton(context, dom.controls['document.customPageSize'], () => {
    if (readonlyMode.enabled) {
      context.announce(readJWordUiText(readI18n(), 'a11y.blockedReadonly'))
      return
    }

    openPageSizeDialog(context, readI18n())
  }, { restoreEditorFocus: false })
}

/** 打开并接管自定义页面大小弹窗。 */
function openPageSizeDialog(context: ToolbarActionContext, i18n: ResolvedJWordUiI18n): void {
  openCustomPageSizeDialog({
    ownerDocument: context.dom.host.ownerDocument,
    host: context.dom.host,
    editor: context.editor,
    i18n,
    announce: context.announce,
    markToolbarTransaction: context.markToolbarTransaction,
    refresh: context.render,
    restoreEditorFocusSoon: context.restoreEditorFocusSoon
  })
}

/** 读取页面方向切换播报。 */
function readPageOrientationAnnouncement(i18n: ResolvedJWordUiI18n, orientation: PageOrientation): string {
  const label = readJWordUiText(
    i18n,
    orientation === 'landscape'
      ? 'toolbar.document.pageOrientation.option.landscape'
      : 'toolbar.document.pageOrientation.option.portrait'
  )

  return readJWordUiText(i18n, 'a11y.pageOrientationChanged')
    .replace('{orientation}', label)
}
