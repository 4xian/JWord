/**
 * @vitest-environment jsdom
 *
 * 职责：锁定 link controller 的交互闭环。
 * 边界：只验证弹窗开关、校验、编辑、打开与移除回调，不验证宿主 wiring。
 * 协作模块：packages/ui/src/link/controller.ts。
 * 约束：错误必须落回 UI state，打开链接不得固定调用 window.open。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md Iteration 3。
 */
import { describe, expect, test, vi } from 'vitest'
import { createLinkController } from '../src/link/controller'

describe('link controller', () => {
  test('会在插入模式下预填 selection 文本并按协议校验后提交', async () => {
    const adapter = {
      openLink: vi.fn(),
      submitLink: vi.fn(async (request) => {
        expect(request.mode).toBe('insert')
        return undefined
      }),
      removeLink: vi.fn()
    }
    const host = document.createElement('div')
    const controller = createLinkController({
      host,
      adapter
    })

    try {
      controller.openInsertDialog('选中文本')

      expect(controller.elements.dialog.hidden).toBe(false)
      expect(controller.elements.visibleTextInput.value).toBe('选中文本')
      expect(controller.elements.confirmButton.disabled).toBe(true)

      controller.elements.urlInput.value = 'javascript:alert(1)'
      controller.elements.urlInput.dispatchEvent(new Event('input', {
        bubbles: true
      }))
      expect(controller.elements.errorText.hidden).toBe(false)
      expect(controller.elements.errorText.textContent).toBe('链接地址协议不受支持。')
      expect(controller.elements.confirmButton.disabled).toBe(true)

      controller.elements.urlInput.value = 'https://example.com'
      controller.elements.urlInput.dispatchEvent(new Event('input', {
        bubbles: true
      }))
      expect(controller.elements.confirmButton.disabled).toBe(false)

      controller.elements.confirmButton.click()
      await Promise.resolve()

      expect(adapter.submitLink).toHaveBeenCalledTimes(1)
      expect(adapter.submitLink).toHaveBeenCalledWith({
        mode: 'insert',
        draft: {
          visibleText: '选中文本',
          url: 'https://example.com',
          tooltip: ''
        }
      })
      expect(controller.elements.dialog.hidden).toBe(true)
      expect(controller.elements.quickTools.hidden).toBe(true)
    } finally {
      controller.destroy()
    }
  })

  test('会在编辑模式下提供打开、编辑和移除入口', async () => {
    const link = {
      visibleText: '现有链接',
      url: 'https://example.com',
      tooltip: '说明'
    }
    const adapter = {
      openLink: vi.fn(async (request) => {
        expect(request).toEqual(link)
      }),
      submitLink: vi.fn(),
      removeLink: vi.fn(async (request) => {
        expect(request).toEqual(link)
      })
    }
    const host = document.createElement('div')
    const controller = createLinkController({
      host,
      adapter
    })

    try {
      controller.setActiveLink(link)

      expect(controller.elements.quickTools.hidden).toBe(true)

      controller.elements.openLinkButton.click()
      await Promise.resolve()
      expect(adapter.openLink).toHaveBeenCalledTimes(1)

      controller.elements.editLinkButton.click()
      expect(controller.elements.dialog.hidden).toBe(false)
      expect(controller.elements.visibleTextInput.value).toBe('现有链接')
      expect(controller.elements.urlInput.value).toBe('https://example.com')
      expect(host.querySelector('[data-jword-link-tooltip-input]')).toBeNull()

      controller.elements.removeLinkButton.click()
      await Promise.resolve()
      expect(adapter.removeLink).toHaveBeenCalledTimes(1)
    } finally {
      controller.destroy()
    }
  })

  test('同步 active link 不会直接显示已有链接快捷工具', () => {
    const host = document.createElement('div')
    const controller = createLinkController({
      host,
      adapter: {
        openLink: vi.fn(),
        submitLink: vi.fn(),
        removeLink: vi.fn()
      }
    })

    try {
      controller.setActiveLink({
        visibleText: '现有链接',
        url: 'https://example.com',
        tooltip: ''
      })

      expect(controller.elements.quickTools.hidden).toBe(true)

      controller.openEditDialog()
      expect(controller.elements.quickTools.hidden).toBe(true)
      expect(controller.elements.dialog.hidden).toBe(false)
    } finally {
      controller.destroy()
    }
  })

  test('打开链接弹窗时按编辑器可视区域居中定位', () => {
    const host = document.createElement('div')
    const viewportHost = document.createElement('div')
    const controller = createLinkController({
      host,
      viewportHost,
      adapter: {
        openLink: vi.fn(),
        submitLink: vi.fn(),
        removeLink: vi.fn()
      }
    })

    Object.defineProperty(viewportHost, 'clientWidth', {
      configurable: true,
      value: 640
    })
    Object.defineProperty(viewportHost, 'clientHeight', {
      configurable: true,
      value: 420
    })
    viewportHost.getBoundingClientRect = () => ({
      x: 40,
      y: 80,
      left: 40,
      top: 80,
      right: 680,
      bottom: 500,
      width: 640,
      height: 420,
      toJSON: () => ({})
    })

    try {
      controller.openInsertDialog('选中文本')

      expect(controller.elements.dialog.style.left).toBe('360px')
      expect(controller.elements.dialog.style.top).toBe('290px')
      expect(controller.elements.dialog.style.transform).toBe('translate(-50%, -50%)')
    } finally {
      controller.destroy()
    }
  })
})
