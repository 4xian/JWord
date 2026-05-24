/**
 * @vitest-environment jsdom
 *
 * 职责：验证 Gate 4 页眉页脚面板在 createJWordUi 官方入口的最小装配。
 * 边界：只覆盖公开 UI option、返回句柄和 transaction 接线，不测试分页 layout。
 * 协作模块：packages/ui/src/create-ui.ts、header-footer controller 与 @4xian/jword-core。
 * 约束：通过公开 elements 和稳定 data selector 断言，不读取 controller 私有状态。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md Step 4.13。
 */

import { createEditor, type Editor } from '@4xian/jword-core'
import { describe, expect, test } from 'vitest'

import { createJWordUi } from '../src/create-ui'

describe('createJWordUi header footer integration', () => {
  test('启用 headerFooter option 后会返回面板句柄并通过 transaction 写入 section properties', () => {
    const harness = createHarness()

    try {
      expect(harness.ui.elements.headerFooterPanel).not.toBeNull()
      expect(harness.toolbarHost.querySelector('[data-jword-header-footer]')).not.toBeNull()

      harness.ui.elements.headerFooterPanel!.headerInput.value = 'header-main'
      harness.ui.elements.headerFooterPanel!.footerInput.value = 'footer-main'
      harness.ui.elements.headerFooterPanel!.pageStartInput.value = '4'
      harness.ui.elements.headerFooterPanel!.nextPageButton.click()

      expect(harness.editor.getProjection().document.sections[0]).toMatchObject({
        breakType: 'next-page',
        headerIds: ['header-main'],
        footerIds: ['footer-main'],
        pageNumbering: {
          mode: 'restart',
          start: 4
        }
      })

      harness.ui.destroy()

      expect(harness.toolbarHost.querySelector('[data-jword-header-footer]')).toBeNull()
    } finally {
      harness.destroy()
    }
  })

  test('点击工具栏页眉页脚按钮会打开菜单并在外部点击后关闭', () => {
    const harness = createHarness()
    const outsideTarget = document.createElement('button')

    try {
      const openButton = harness.toolbarHost.querySelector<HTMLButtonElement>('[data-jword-toggle-header-footer]')

      document.body.append(outsideTarget)

      expect(openButton).not.toBeNull()
      if (openButton === null) {
        throw new Error('页眉 toolbar 按钮未挂载。')
      }

      stubBoundingRect(openButton, 124, 20, 28, 28)
      expect(harness.ui.elements.headerFooterPanel!.root.hidden).toBe(true)

      openButton.click()

      expect(harness.ui.elements.headerFooterPanel!.root.hidden).toBe(false)
      expect(harness.ui.elements.headerFooterPanel!.headerMenu.hidden).toBe(false)
      expect(harness.ui.elements.headerFooterPanel!.footerMenu.hidden).toBe(true)
      expect(harness.ui.elements.headerFooterPanel!.pageNumberMenu.hidden).toBe(true)
      expectMenuAnchor(
        harness.ui.elements.headerFooterPanel!.root,
        'header',
        '124px',
        '56px',
        '176px'
      )

      outsideTarget.click()

      expect(harness.ui.elements.headerFooterPanel!.root.hidden).toBe(true)
    } finally {
      outsideTarget.remove()
      harness.destroy()
    }
  })

  test('点击工具栏页脚按钮会打开独立页脚菜单并在外部点击后关闭', () => {
    const harness = createHarness()
    const outsideTarget = document.createElement('button')

    try {
      const openButton = harness.toolbarHost.querySelector<HTMLButtonElement>('[data-jword-toggle-footer]')

      document.body.append(outsideTarget)

      expect(openButton).not.toBeNull()
      if (openButton === null) {
        throw new Error('页脚 toolbar 按钮未挂载。')
      }

      stubBoundingRect(openButton, 184, 34, 28, 28)
      expect(harness.ui.elements.headerFooterPanel!.root.hidden).toBe(true)

      openButton.click()

      expect(harness.ui.elements.headerFooterPanel!.root.hidden).toBe(false)
      expect(harness.ui.elements.headerFooterPanel!.footerMenu.hidden).toBe(false)
      expect(harness.ui.elements.headerFooterPanel!.headerMenu.hidden).toBe(true)
      expect(harness.ui.elements.headerFooterPanel!.pageNumberMenu.hidden).toBe(true)
      expectMenuAnchor(
        harness.ui.elements.headerFooterPanel!.root,
        'footer',
        '184px',
        '70px',
        '176px'
      )

      outsideTarget.click()

      expect(harness.ui.elements.headerFooterPanel!.root.hidden).toBe(true)
    } finally {
      outsideTarget.remove()
      harness.destroy()
    }
  })

  test('点击工具栏页码按钮会打开页码菜单并在外部点击后关闭', () => {
    const harness = createHarness()
    const outsideTarget = document.createElement('button')

    try {
      const openButton = harness.toolbarHost.querySelector<HTMLButtonElement>('[data-jword-toggle-page-number]')

      document.body.append(outsideTarget)

      expect(openButton).not.toBeNull()
      if (openButton === null) {
        throw new Error('页码 toolbar 按钮未挂载。')
      }

      stubBoundingRect(openButton, 244, 34, 28, 28)
      expect(harness.ui.elements.headerFooterPanel!.root.hidden).toBe(true)

      openButton.click()

      expect(harness.ui.elements.headerFooterPanel!.root.hidden).toBe(false)
      expect(harness.ui.elements.headerFooterPanel!.pageNumberMenu.hidden).toBe(false)
      expect(harness.ui.elements.headerFooterPanel!.headerMenu.hidden).toBe(true)
      expect(harness.ui.elements.headerFooterPanel!.footerMenu.hidden).toBe(true)
      expectMenuAnchor(
        harness.ui.elements.headerFooterPanel!.root,
        'page-number',
        '244px',
        '70px',
        '204px'
      )

      outsideTarget.click()

      expect(harness.ui.elements.headerFooterPanel!.root.hidden).toBe(true)
    } finally {
      outsideTarget.remove()
      harness.destroy()
    }
  })
})

interface Harness {
  readonly editor: Editor
  readonly editorHost: HTMLElement
  readonly toolbarHost: HTMLElement
  readonly headerFooterHost: HTMLElement
  readonly ui: ReturnType<typeof createJWordUi>
  destroy(): void
}

/** 创建入口级 UI 测试环境。 */
function createHarness(): Harness {
  const editorHost = document.createElement('div')
  const toolbarHost = document.createElement('div')
  const liveRegionHost = document.createElement('div')
  const headerFooterHost = document.createElement('div')
  const editor = createEditor({ initialText: '正文' })

  document.body.append(editorHost, toolbarHost, liveRegionHost, headerFooterHost)
  editor.mount(editorHost)
  const ui = createJWordUi({
    editor,
    toolbarHost,
    liveRegionHost,
    headerFooter: {
      host: headerFooterHost
    }
  })

  return {
    editor,
    editorHost,
    toolbarHost,
    headerFooterHost,
    ui,
    destroy(): void {
      editor.destroy()
      editorHost.remove()
      toolbarHost.remove()
      liveRegionHost.remove()
      headerFooterHost.remove()
    }
  }
}

/** 固定测试按钮几何，模拟 toolbar 按钮在真实页面中的位置。 */
function stubBoundingRect(element: HTMLElement, left: number, top: number, width: number, height: number): void {
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => createBoundingRect(left, top, width, height)
  })
}

/** 创建 DOMRect 兼容对象，避免 jsdom 布局参与断言。 */
function createBoundingRect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON(): Record<string, number> {
      return {
        x: left,
        y: top,
        left,
        top,
        width,
        height,
        right: left + width,
        bottom: top + height
      }
    }
  } as DOMRect
}

/** 断言菜单根节点跟随触发按钮，并使用紧凑宽度变量。 */
function expectMenuAnchor(
  root: HTMLElement,
  activeMenu: string,
  left: string,
  top: string,
  width: string
): void {
  expect(root.getAttribute('data-jword-anchored')).toBe('true')
  expect(root.getAttribute('data-jword-active-menu')).toBe(activeMenu)
  expect(root.style.getPropertyValue('--jw-header-footer-menu-left')).toBe(left)
  expect(root.style.getPropertyValue('--jw-header-footer-menu-top')).toBe(top)
  expect(root.style.getPropertyValue('--jw-header-footer-menu-width')).toBe(width)
}
