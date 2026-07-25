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
  test('为浮动工具栏按钮提供 title 与 aria-label', () => {
    const host = document.createElement('div')
    const dom = createSelectionActionsDom(host)

    try {
      expect(dom.formatControls.bold.title).toBe('加粗')
      expect(dom.formatControls.bold.getAttribute('aria-label')).toBe('加粗')
      expect(dom.formatControls.italic.title).toBe('斜体')
      expect(dom.formatControls.italic.getAttribute('aria-label')).toBe('斜体')
      expect(dom.formatControls.underline.title).toBe('下划线')
      expect(dom.formatControls.underline.getAttribute('aria-label')).toBe('下划线')
      expect(dom.formatControls.strike.title).toBe('删除线')
      expect(dom.formatControls.strike.getAttribute('aria-label')).toBe('删除线')
      expect(dom.formatControls.insertLink.title).toBe('插入链接')
      expect(dom.formatControls.insertLink.getAttribute('aria-label')).toBe('插入链接')
      expect(dom.formatControls.openLink.title).toBe('打开链接')
      expect(dom.formatControls.openLink.getAttribute('aria-label')).toBe('打开链接')
      expect(dom.formatControls.editLink.title).toBe('编辑链接')
      expect(dom.formatControls.editLink.getAttribute('aria-label')).toBe('编辑链接')
      expect(dom.formatControls.removeLink.title).toBe('删除链接')
      expect(dom.formatControls.removeLink.getAttribute('aria-label')).toBe('删除链接')
      expect(dom.formatControls.textColor.parentElement?.title).toBe('文字颜色')
      expect(dom.formatControls.backgroundColor.parentElement?.title).toBe('背景色')
    } finally {
      destroySelectionActionsDom(dom)
    }
  })

  test('插入链接与打开链接使用不同图标标识', () => {
    const host = document.createElement('div')
    const dom = createSelectionActionsDom(host)

    try {
      expect(readButtonIconName(dom.formatControls.insertLink)).not.toBe(readButtonIconName(dom.formatControls.openLink))
    } finally {
      destroySelectionActionsDom(dom)
    }
  })

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

  test('选中文本时浮动工具栏保留格式按钮可见', () => {
    const host = document.createElement('div')
    const dom = createSelectionActionsDom(host)

    try {
      renderSelectionActionsDom(dom, createViewState())

      expect(dom.formatControls.bold.hidden).toBe(false)
      expect(dom.formatControls.italic.hidden).toBe(false)
      expect(dom.formatControls.underline.hidden).toBe(false)
      expect(dom.formatControls.strike.hidden).toBe(false)
      expect(dom.formatControls.textColor.parentElement?.hidden).toBe(false)
      expect(dom.formatControls.backgroundColor.parentElement?.hidden).toBe(false)
    } finally {
      destroySelectionActionsDom(dom)
    }
  })

  test('按当前选区是否有链接切换浮动工具栏与右键菜单链接动作', () => {
    const host = document.createElement('div')
    const dom = createSelectionActionsDom(host)

    try {
      renderSelectionActionsDom(dom, createViewState({
        activeLinkUrl: null,
        contextHasLink: false
      }))

      expect(dom.formatControls.insertLink.hidden).toBe(false)
      expect(dom.formatControls.openLink.hidden).toBe(true)
      expect(dom.formatControls.editLink.hidden).toBe(true)
      expect(dom.formatControls.removeLink.hidden).toBe(true)
      expect(dom.contextControls.insertLink.hidden).toBe(false)
      expect(dom.contextControls.openLink.hidden).toBe(true)
      expect(dom.contextControls.editLink.hidden).toBe(true)
      expect(dom.contextControls.removeLink.hidden).toBe(true)

      renderSelectionActionsDom(dom, createViewState({
        activeLinkUrl: 'https://example.com',
        contextHasLink: true
      }))

      expect(dom.formatControls.insertLink.hidden).toBe(true)
      expect(dom.formatControls.openLink.hidden).toBe(false)
      expect(dom.formatControls.editLink.hidden).toBe(false)
      expect(dom.formatControls.removeLink.hidden).toBe(false)
      expect(dom.contextControls.insertLink.hidden).toBe(true)
      expect(dom.contextControls.openLink.hidden).toBe(false)
      expect(dom.contextControls.editLink.hidden).toBe(false)
      expect(dom.contextControls.removeLink.hidden).toBe(false)
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
    insertLinkEnabled: true,
    activeLinkUrl: null,
    contextHasLink: false,
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

/** 读取按钮内部 SVG 的稳定图标标识。 */
function readButtonIconName(button: HTMLButtonElement): string | null {
  return button.querySelector('svg')?.getAttribute('data-jword-icon') ?? null
}
