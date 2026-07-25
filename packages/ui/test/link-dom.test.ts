/**
 * @vitest-environment jsdom
 *
 * 职责：锁定 link DOM 的节点结构与状态渲染。
 * 边界：只覆盖 DOM 结构和渲染，不验证 controller 事件或宿主回调。
 * 协作模块：packages/ui/src/link/dom.ts 与 packages/ui/src/link/state.ts。
 * 约束：确认按钮状态与 dialog/quick tools 显隐必须由 state 驱动。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import { describe, expect, test } from 'vitest'
import { createLinkPanelDom, destroyLinkPanel, renderLinkPanel } from '../src/link/dom'
import { createLinkDialogState } from '../src/link/state'

describe('link dom', () => {
  test('会渲染插入弹窗与已有链接快捷工具', () => {
    const host = document.createElement('div')
    const dom = createLinkPanelDom(host)

    try {
      renderLinkPanel(dom, {
        activeLink: {
          visibleText: '现有链接',
          url: 'https://example.com',
          tooltip: '说明'
        },
        quickToolsVisible: true,
        dialog: createLinkDialogState('edit', {
          visibleText: '现有链接',
          url: 'https://example.com',
          tooltip: '说明'
        })
      })

      expect(dom.quickTools.hidden).toBe(false)
      expect(dom.dialog.hidden).toBe(false)
      expect(dom.openLinkButton.getAttribute('aria-label')).toBe('打开链接')
      expect(dom.editLinkButton.getAttribute('aria-label')).toBe('编辑链接')
      expect(dom.removeLinkButton.getAttribute('aria-label')).toBe('删除链接')
      expect(dom.openLinkButton.title).toBe('打开链接')
      expect(dom.editLinkButton.title).toBe('编辑链接')
      expect(dom.removeLinkButton.title).toBe('删除链接')
      expect(dom.openLinkButton.querySelector('[data-jword-icon="openLink"]')).not.toBeNull()
      expect(dom.openLinkButton.querySelector('[data-jword-icon="link"]')).toBeNull()
      expect(dom.visibleTextInput.value).toBe('现有链接')
      expect(dom.urlInput.value).toBe('https://example.com')
      expect(host.querySelector('[data-jword-link-tooltip-input]')).toBeNull()
      expect(dom.confirmButton.textContent).toBe('保存链接')
    } finally {
      destroyLinkPanel(dom)
    }
  })
})
