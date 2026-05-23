/**
 * @vitest-environment jsdom
 *
 * 职责：验证 selection-actions DOM 在颜色 picker 打开时保留原生输入控件的当前值。
 * 边界：只覆盖浮动工具栏 DOM 状态同步，不执行 editor 命令或截图级布局断言。
 * 协作：packages/ui/src/selection-actions/dom.ts 与 selection-actions/types.ts。
 * 约束：断言基于稳定 data attribute 和 CSS 变量，不依赖浏览器原生颜色面板实现。
 */

import { describe, expect, test } from 'vitest'

import { createSelectionActionsDom, destroySelectionActionsDom, renderSelectionActionsDom } from '../src/selection-actions/dom'
import type { SelectionActionsViewState } from '../src/selection-actions/types'

describe('selection actions dom', () => {
  test('preserves active color input value while picker is open', () => {
    const host = document.createElement('div')
    const dom = createSelectionActionsDom(host)

    try {
      const textColor = dom.formatControls.textColor
      const backgroundColor = dom.formatControls.backgroundColor

      textColor.value = '#3366ff'
      backgroundColor.value = '#99cc00'
      renderSelectionActionsDom(dom, createViewState({
        textColorValue: '#111111',
        backgroundColorValue: '#fff59d',
        activeColorPicker: 'text'
      }))

      expect(textColor.value).toBe('#3366ff')
      expect(textColor.parentElement?.style.getPropertyValue('--jw-selection-toolbar-color')).toBe('#3366ff')
      expect(backgroundColor.value).toBe('#fff59d')
      expect(backgroundColor.parentElement?.style.getPropertyValue('--jw-selection-toolbar-color')).toBe('#fff59d')

      renderSelectionActionsDom(dom, createViewState({
        textColorValue: '#111111',
        backgroundColorValue: '#fff59d',
        activeColorPicker: 'background'
      }))

      expect(textColor.value).toBe('#111111')
      expect(backgroundColor.value).toBe('#fff59d')
      expect(backgroundColor.parentElement?.style.getPropertyValue('--jw-selection-toolbar-color')).toBe('#fff59d')
    } finally {
      destroySelectionActionsDom(dom)
    }
  })
})

/** 创建浮动工具栏 DOM 渲染所需的最小状态。 */
function createViewState(overrides: Partial<SelectionActionsViewState> = {}): SelectionActionsViewState {
  return {
    floatingVisible: true,
    floatingPosition: {
      left: 10,
      top: 20
    },
    contextMenuVisible: false,
    contextMenuPosition: null,
    contextSelectionKey: '',
    formatEnabled: true,
    boldPressed: 'false',
    italicPressed: 'false',
    underlinePressed: 'false',
    strikePressed: 'false',
    textColorValue: '#111111',
    backgroundColorValue: '#fff59d',
    activeColorPicker: null,
    cutDisabled: true,
    copyDisabled: true,
    clearDisabled: true,
    ...overrides
  }
}
