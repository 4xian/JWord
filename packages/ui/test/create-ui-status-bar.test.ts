/**
 * @vitest-environment jsdom
 *
 * 职责：验证 createJWordUi 默认底部状态栏、自动三段式布局和基础状态栏动作。
 * 边界：只覆盖官方 UI 装配层，不验证浏览器 Fullscreen API 的真实进入效果。
 * 协作：packages/ui/src/ui-lifecycle.ts、status-bar/controller.ts、status-bar/dom.ts。
 * 约束：通过公开 elements 与稳定 data attribute 断言，不读取私有 controller 状态。
 */

import { createEditor } from '@4xian/jword-core'
import { describe, expect, test } from 'vitest'

import { createJWordUi } from '../src/create-ui'

describe('createJWordUi status bar', () => {
  test('默认未传 toolbarHost/statusBar.host 时创建 toolbar、editor、statusBar 三段式布局', () => {
    const editorHost = document.createElement('div')
    const editor = createEditor({ initialText: 'hello status bar' })

    document.body.append(editorHost)

    try {
      editor.mount(editorHost)
      const editorShell = editorHost.querySelector<HTMLElement>('[data-jword-editor]')
      const ui = createJWordUi({
        editor,
        editorHost
      })
      const toolbarHost = editorHost.querySelector<HTMLElement>('[data-jword-toolbar-host="true"]')
      const statusBarHost = editorHost.querySelector<HTMLElement>('[data-jword-status-bar-host="true"]')
      const statusBar = ui.elements.statusBar

      expect(toolbarHost).not.toBeNull()
      expect(statusBarHost).not.toBeNull()
      expect(statusBar).not.toBeNull()
      expect(toolbarHost?.nextElementSibling).toBe(editorShell)
      expect(editorShell?.nextElementSibling).toBe(statusBarHost)
      expect(statusBar?.controls.wordCount).not.toBeUndefined()
      expect(statusBar?.controls.zoomSlider?.querySelector('input')).toBeInstanceOf(HTMLInputElement)
      expect(statusBar?.controls.themeSwitcher?.querySelector('select')).toBeInstanceOf(HTMLSelectElement)
      expect(statusBar?.controls.localeSwitcher?.querySelector('select')).toBeInstanceOf(HTMLSelectElement)
      expect(editorHost.style.display).toBe('flex')
      expect(editorHost.style.minWidth).toBe('0px')
      expect(editorShell?.style.flex).toBe('1 1 auto')
      expect(editorShell?.style.minWidth).toBe('0px')

      ui.destroy()

      expect(editorHost.querySelector('[data-jword-toolbar-host="true"]')).toBeNull()
      expect(editorHost.querySelector('[data-jword-status-bar-host="true"]')).toBeNull()
      expect(editorHost.style.display).toBe('')
      expect(editorHost.style.minWidth).toBe('')
      expect(editorShell?.style.height).toBe('100%')
      expect(editorShell?.style.minWidth).toBe('0px')
    } finally {
      editor.destroy()
      editorHost.remove()
    }
  })

  test('statusBar false 明确禁用默认状态栏', () => {
    const editorHost = document.createElement('div')
    const toolbarHost = document.createElement('div')
    const editor = createEditor({ initialText: 'status bar disabled' })

    document.body.append(editorHost, toolbarHost)

    try {
      editor.mount(editorHost)
      const ui = createJWordUi({
        editor,
        editorHost,
        toolbarHost,
        statusBar: false
      })

      expect(ui.elements.statusBar).toBeNull()
      expect(editorHost.querySelector('[data-jword-status-bar-host="true"]')).toBeNull()

      ui.destroy()
    } finally {
      editor.destroy()
      editorHost.remove()
      toolbarHost.remove()
    }
  })

  test('缩放滑块、加减图标和 100% 按钮通过 editor.setPageConfig 更新页面缩放', () => {
    const editorHost = document.createElement('div')
    const toolbarHost = document.createElement('div')
    const statusBarHost = document.createElement('div')
    const editor = createEditor({
      initialText: 'zoom status bar',
      page: {
        scale: 1
      }
    })

    document.body.append(editorHost, toolbarHost, statusBarHost)

    try {
      editor.mount(editorHost)
      const ui = createJWordUi({
        editor,
        editorHost,
        toolbarHost,
        statusBar: {
          host: statusBarHost
        }
      })
      const slider = ui.elements.statusBar?.controls.zoomSlider?.querySelector('input') as HTMLInputElement
      const zoomOut = ui.elements.statusBar?.controls.zoomSlider?.querySelector<HTMLButtonElement>('[data-jword-status-bar-zoom-minus]')
      const zoomIn = ui.elements.statusBar?.controls.zoomSlider?.querySelector<HTMLButtonElement>('[data-jword-status-bar-zoom-plus]')
      const reset = ui.elements.statusBar?.controls.zoomReset as HTMLButtonElement
      const percent = ui.elements.statusBar?.controls.zoomPercent

      expect(slider.min).toBe('20')
      expect(slider.max).toBe('400')
      expect(slider.step).toBe('10')
      expect(zoomOut).toBeInstanceOf(HTMLButtonElement)
      expect(zoomIn).toBeInstanceOf(HTMLButtonElement)
      expect(zoomOut?.querySelector('svg[data-jword-icon="zoomOut"]')).not.toBeNull()
      expect(zoomIn?.querySelector('svg[data-jword-icon="zoomIn"]')).not.toBeNull()
      expect(slider.style.getPropertyValue('--jw-status-bar-zoom-progress')).toBe('21.05%')

      slider.value = '150'
      slider.dispatchEvent(new Event('input', { bubbles: true }))

      expect(editor.getPageConfig().scale).toBe(1.5)
      expect(percent?.textContent).toBe('150%')
      expect(slider.style.getPropertyValue('--jw-status-bar-zoom-progress')).toBe('34.21%')

      zoomOut?.click()

      expect(editor.getPageConfig().scale).toBe(1.4)
      expect(percent?.textContent).toBe('140%')

      zoomIn?.click()

      expect(editor.getPageConfig().scale).toBe(1.5)
      expect(percent?.textContent).toBe('150%')

      reset.click()

      expect(editor.getPageConfig().scale).toBe(1)
      expect(percent?.textContent).toBe('100%')
      expect(slider.style.getPropertyValue('--jw-status-bar-zoom-progress')).toBe('21.05%')

      ui.destroy()
    } finally {
      editor.destroy()
      editorHost.remove()
      toolbarHost.remove()
      statusBarHost.remove()
    }
  })

  test('动态主题和语言切换会同步状态栏控件', () => {
    const editorHost = document.createElement('div')
    const toolbarHost = document.createElement('div')
    const statusBarHost = document.createElement('div')
    const editor = createEditor({ initialText: 'locale status bar' })

    document.body.append(editorHost, toolbarHost, statusBarHost)

    try {
      editor.mount(editorHost)
      const ui = createJWordUi({
        editor,
        editorHost,
        toolbarHost,
        statusBar: {
          host: statusBarHost
        }
      })
      const themeSelect = ui.elements.statusBar?.controls.themeSwitcher?.querySelector('select') as HTMLSelectElement
      const localeSelect = ui.elements.statusBar?.controls.localeSwitcher?.querySelector('select') as HTMLSelectElement
      const words = ui.elements.statusBar?.controls.wordCount

      ui.setTheme({ name: 'dark' })
      ui.setLocale('en-US')

      expect(statusBarHost.getAttribute('data-theme')).toBe('dark')
      expect(themeSelect.value).toBe('dark')
      expect(localeSelect.value).toBe('en-US')
      expect(words?.querySelector('.jw-status-bar__metric-label')?.textContent).toBe('Words')

      ui.destroy()
    } finally {
      editor.destroy()
      editorHost.remove()
      toolbarHost.remove()
      statusBarHost.remove()
    }
  })

  test('默认主题切换只提供亮色和暗色', () => {
    const editorHost = document.createElement('div')
    const toolbarHost = document.createElement('div')
    const statusBarHost = document.createElement('div')
    const editor = createEditor({ initialText: 'two theme status bar' })

    document.body.append(editorHost, toolbarHost, statusBarHost)

    try {
      editor.mount(editorHost)
      const ui = createJWordUi({
        editor,
        editorHost,
        toolbarHost,
        statusBar: {
          host: statusBarHost
        }
      })
      const themeSelect = ui.elements.statusBar?.controls.themeSwitcher?.querySelector('select')
        ?? ui.elements.statusBar?.controls.themeSwitcher

      expect(themeSelect).toBeInstanceOf(HTMLSelectElement)
      expect([...(themeSelect as HTMLSelectElement).options].map((option) => option.value)).toEqual(['light', 'dark'])

      ui.destroy()
    } finally {
      editor.destroy()
      editorHost.remove()
      toolbarHost.remove()
      statusBarHost.remove()
    }
  })

  test('状态栏视图按钮使用图标化标签并按当前状态切换说明', async () => {
    const editorHost = document.createElement('div')
    const toolbarHost = document.createElement('div')
    const statusBarHost = document.createElement('div')
    const editor = createEditor({ initialText: 'view status bar' })
    let fullscreenElement: Element | null = null

    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => fullscreenElement
    })
    Object.defineProperty(editorHost, 'requestFullscreen', {
      configurable: true,
      value: () => {
        fullscreenElement = editorHost
        document.dispatchEvent(new Event('fullscreenchange'))
        return Promise.resolve()
      }
    })
    Object.defineProperty(document, 'exitFullscreen', {
      configurable: true,
      value: () => {
        fullscreenElement = null
        document.dispatchEvent(new Event('fullscreenchange'))
        return Promise.resolve()
      }
    })

    document.body.append(editorHost, toolbarHost, statusBarHost)

    try {
      editor.mount(editorHost)
      const ui = createJWordUi({
        editor,
        editorHost,
        toolbarHost,
        statusBar: {
          host: statusBarHost
        }
      })
      const fullscreen = ui.elements.statusBar?.controls.fullscreen as HTMLButtonElement
      const presentation = ui.elements.statusBar?.controls.presentation as HTMLButtonElement
      const zoomSlider = ui.elements.statusBar?.controls.zoomSlider

      expect(fullscreen.textContent).toBe('')
      expect(fullscreen.querySelector('svg')).not.toBeNull()
      expect(fullscreen.getAttribute('aria-label')).toBe('全屏')
      expect(zoomSlider?.querySelector('[data-jword-status-bar-zoom-minus]')?.querySelector('svg')).not.toBeNull()
      expect(zoomSlider?.querySelector('[data-jword-status-bar-zoom-plus]')?.querySelector('svg')).not.toBeNull()

      fullscreen.click()
      await Promise.resolve()

      expect(fullscreen.getAttribute('aria-label')).toBe('退出全屏')
      expect(fullscreen.title).toBe('退出全屏')

      presentation.click()

      expect(editorHost.getAttribute('data-jword-presentation')).toBe('true')
      expect(presentation.getAttribute('aria-label')).toBe('退出演示模式')
      expect(presentation.title).toBe('退出演示模式')

      ui.destroy()
    } finally {
      editor.destroy()
      editorHost.remove()
      toolbarHost.remove()
      statusBarHost.remove()
    }
  })

  test('toolbar 和状态栏视图按钮共享选中态', async () => {
    const editorHost = document.createElement('div')
    const toolbarHost = document.createElement('div')
    const statusBarHost = document.createElement('div')
    const editor = createEditor({ initialText: 'shared view controls' })
    let fullscreenElement: Element | null = null

    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => fullscreenElement
    })
    Object.defineProperty(editorHost, 'requestFullscreen', {
      configurable: true,
      value: () => {
        fullscreenElement = editorHost
        document.dispatchEvent(new Event('fullscreenchange'))
        return Promise.resolve()
      }
    })
    Object.defineProperty(document, 'exitFullscreen', {
      configurable: true,
      value: () => {
        fullscreenElement = null
        document.dispatchEvent(new Event('fullscreenchange'))
        return Promise.resolve()
      }
    })

    document.body.append(editorHost, toolbarHost, statusBarHost)

    try {
      editor.mount(editorHost)
      mockElementSize(editorHost.querySelector<HTMLElement>('[data-jword-canvas-container]') ?? editorHost, 1000, 1200)
      const ui = createJWordUi({
        editor,
        editorHost,
        toolbarHost,
        statusBar: {
          host: statusBarHost
        }
      })
      const toolbarFitWidth = toolbarHost.querySelector<HTMLButtonElement>('[data-jword-tool-id="view.fitWidth"]')
      const toolbarFitPage = toolbarHost.querySelector<HTMLButtonElement>('[data-jword-tool-id="view.fitPage"]')
      const toolbarFullscreen = toolbarHost.querySelector<HTMLButtonElement>('[data-jword-tool-id="view.fullscreen"]')
      const toolbarPresentation = toolbarHost.querySelector<HTMLButtonElement>('[data-jword-tool-id="view.presentation"]')
      const statusFitWidth = ui.elements.statusBar?.controls.fitWidth as HTMLButtonElement
      const statusFitPage = ui.elements.statusBar?.controls.fitPage as HTMLButtonElement
      const statusFullscreen = ui.elements.statusBar?.controls.fullscreen as HTMLButtonElement
      const statusPresentation = ui.elements.statusBar?.controls.presentation as HTMLButtonElement
      const statusZoomPercent = ui.elements.statusBar?.controls.zoomPercent
      const statusZoomSlider = ui.elements.statusBar?.controls.zoomSlider?.querySelector('input') as HTMLInputElement

      expect(toolbarFitWidth).toBeInstanceOf(HTMLButtonElement)
      expect(toolbarFitPage).toBeInstanceOf(HTMLButtonElement)
      expect(toolbarFullscreen).toBeInstanceOf(HTMLButtonElement)
      expect(toolbarPresentation).toBeInstanceOf(HTMLButtonElement)
      expect(statusZoomSlider).toBeInstanceOf(HTMLInputElement)

      toolbarFitWidth?.click()
      await Promise.resolve()

      expect(editorHost.getAttribute('data-jword-view-fit-mode')).toBe('width')
      expect(toolbarFitWidth?.getAttribute('aria-pressed')).toBe('true')
      expect(statusFitWidth.getAttribute('aria-pressed')).toBe('true')
      expect(toolbarFitPage?.getAttribute('aria-pressed')).toBe('false')
      expect(statusFitPage.getAttribute('aria-pressed')).toBe('false')
      expect(editor.getPageConfig().scale).not.toBe(1)
      expect(statusZoomPercent?.textContent).not.toBe('100%')
      expect(statusZoomSlider.value).not.toBe('100')

      toolbarFitWidth?.click()
      await Promise.resolve()

      expect(editorHost.getAttribute('data-jword-view-fit-mode')).toBeNull()
      expect(toolbarFitWidth?.getAttribute('aria-pressed')).toBe('false')
      expect(statusFitWidth.getAttribute('aria-pressed')).toBe('false')
      expect(editor.getPageConfig().scale).toBe(1)
      expect(statusZoomPercent?.textContent).toBe('100%')
      expect(statusZoomSlider.value).toBe('100')

      toolbarFitPage?.click()
      await Promise.resolve()

      expect(editorHost.getAttribute('data-jword-view-fit-mode')).toBe('page')
      expect(toolbarFitPage?.getAttribute('aria-pressed')).toBe('true')
      expect(statusFitPage.getAttribute('aria-pressed')).toBe('true')
      expect(editor.getPageConfig().scale).not.toBe(1)
      expect(statusZoomPercent?.textContent).not.toBe('100%')
      expect(statusZoomSlider.value).not.toBe('100')

      toolbarFitPage?.click()
      await Promise.resolve()

      expect(editorHost.getAttribute('data-jword-view-fit-mode')).toBeNull()
      expect(toolbarFitPage?.getAttribute('aria-pressed')).toBe('false')
      expect(statusFitPage.getAttribute('aria-pressed')).toBe('false')
      expect(editor.getPageConfig().scale).toBe(1)
      expect(statusZoomPercent?.textContent).toBe('100%')
      expect(statusZoomSlider.value).toBe('100')

      statusFitWidth.click()
      await Promise.resolve()

      expect(editorHost.getAttribute('data-jword-view-fit-mode')).toBe('width')
      expect(toolbarFitWidth?.getAttribute('aria-pressed')).toBe('true')
      expect(statusFitWidth.getAttribute('aria-pressed')).toBe('true')
      expect(editor.getPageConfig().scale).not.toBe(1)
      expect(statusZoomPercent?.textContent).not.toBe('100%')
      expect(statusZoomSlider.value).not.toBe('100')

      statusFitWidth.click()
      await Promise.resolve()

      expect(editorHost.getAttribute('data-jword-view-fit-mode')).toBeNull()
      expect(toolbarFitWidth?.getAttribute('aria-pressed')).toBe('false')
      expect(statusFitWidth.getAttribute('aria-pressed')).toBe('false')
      expect(editor.getPageConfig().scale).toBe(1)
      expect(statusZoomPercent?.textContent).toBe('100%')
      expect(statusZoomSlider.value).toBe('100')

      toolbarPresentation?.click()
      await Promise.resolve()

      expect(toolbarPresentation?.getAttribute('aria-pressed')).toBe('true')
      expect(statusPresentation.getAttribute('aria-pressed')).toBe('true')
      expect(editorHost.getAttribute('data-jword-presentation')).toBe('true')

      statusPresentation.click()
      await Promise.resolve()

      expect(toolbarPresentation?.getAttribute('aria-pressed')).toBe('false')
      expect(statusPresentation.getAttribute('aria-pressed')).toBe('false')
      expect(editorHost.getAttribute('data-jword-presentation')).toBe('false')

      statusFullscreen.click()
      await Promise.resolve()

      expect(toolbarFullscreen?.getAttribute('aria-pressed')).toBe('true')
      expect(statusFullscreen.getAttribute('aria-pressed')).toBe('true')

      toolbarFullscreen?.click()
      await Promise.resolve()

      expect(toolbarFullscreen?.getAttribute('aria-pressed')).toBe('false')
      expect(statusFullscreen.getAttribute('aria-pressed')).toBe('false')

      ui.destroy()
    } finally {
      editor.destroy()
      editorHost.remove()
      toolbarHost.remove()
      statusBarHost.remove()
    }
  })

  test('演示模式隐藏工具栏和状态栏并支持 Esc 与底部边缘唤出', async () => {
    const editorHost = document.createElement('div')
    const toolbarHost = document.createElement('div')
    const statusBarHost = document.createElement('div')
    const editor = createEditor({ initialText: 'presentation overlay controls' })

    document.body.append(editorHost, toolbarHost, statusBarHost)

    try {
      editor.mount(editorHost)
      mockElementSize(editorHost, 900, 600)
      const ui = createJWordUi({
        editor,
        editorHost,
        toolbarHost,
        statusBar: {
          host: statusBarHost
        }
      })
      const toolbarPresentation = toolbarHost.querySelector<HTMLButtonElement>('[data-jword-tool-id="view.presentation"]')
      const statusPresentation = ui.elements.statusBar?.controls.presentation as HTMLButtonElement

      toolbarPresentation?.click()
      await Promise.resolve()

      expect(editorHost.getAttribute('data-jword-presentation')).toBe('true')
      expect(toolbarHost.getAttribute('data-jword-presentation-hidden')).toBe('true')
      expect(statusBarHost.getAttribute('data-jword-presentation-hidden')).toBe('true')
      expect(ui.elements.statusBar?.root.getAttribute('data-jword-presentation-hidden')).toBe('true')

      editorHost.dispatchEvent(new MouseEvent('mousemove', {
        bubbles: true,
        clientY: 592
      }))

      expect(statusBarHost.getAttribute('data-jword-presentation-peek')).toBe('true')
      expect(ui.elements.statusBar?.root.getAttribute('data-jword-presentation-peek')).toBe('true')

      editorHost.dispatchEvent(new MouseEvent('mousemove', {
        bubbles: true,
        clientY: 520
      }))

      expect(statusBarHost.hasAttribute('data-jword-presentation-peek')).toBe(false)
      expect(ui.elements.statusBar?.root.hasAttribute('data-jword-presentation-peek')).toBe(false)

      editorHost.dispatchEvent(new MouseEvent('mousemove', {
        bubbles: true,
        clientY: 592
      }))
      document.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        key: 'Escape'
      }))
      await Promise.resolve()

      expect(editorHost.getAttribute('data-jword-presentation')).toBe('false')
      expect(toolbarPresentation?.getAttribute('aria-pressed')).toBe('false')
      expect(statusPresentation.getAttribute('aria-pressed')).toBe('false')
      expect(toolbarHost.hasAttribute('data-jword-presentation-hidden')).toBe(false)
      expect(statusBarHost.hasAttribute('data-jword-presentation-hidden')).toBe(false)
      expect(statusBarHost.hasAttribute('data-jword-presentation-peek')).toBe(false)

      ui.destroy()
    } finally {
      editor.destroy()
      editorHost.remove()
      toolbarHost.remove()
      statusBarHost.remove()
    }
  })

  test('版权保护支持隐藏、删除后恢复和水印兜底', async () => {
    const hiddenHost = document.createElement('div')
    const hiddenStatusHost = document.createElement('div')
    const hiddenEditor = createEditor({ initialText: 'hidden brand' })

    document.body.append(hiddenHost, hiddenStatusHost)

    try {
      hiddenEditor.mount(hiddenHost)
      const ui = createJWordUi({
        editor: hiddenEditor,
        editorHost: hiddenHost,
        statusBar: {
          host: hiddenStatusHost,
          brand: {
            protection: 'hidden'
          }
        }
      })

      expect(ui.elements.statusBar?.controls.brand).toBeUndefined()
      expect(hiddenStatusHost.querySelector('[data-jword-status-bar-action="brand"]')).toBeNull()
      ui.destroy()
    } finally {
      hiddenEditor.destroy()
      hiddenHost.remove()
      hiddenStatusHost.remove()
    }

    const restoreHost = document.createElement('div')
    const restoreStatusHost = document.createElement('div')
    const restoreEditor = createEditor({ initialText: 'restore brand' })

    document.body.append(restoreHost, restoreStatusHost)

    try {
      restoreEditor.mount(restoreHost)
      const ui = createJWordUi({
        editor: restoreEditor,
        editorHost: restoreHost,
        statusBar: {
          host: restoreStatusHost,
          brand: {
            label: 'Powered by JWord',
            protection: 'restore'
          }
        }
      })
      const brand = ui.elements.statusBar?.controls.brand

      expect(brand).toBeInstanceOf(HTMLElement)
      if (!(brand instanceof HTMLElement)) {
        throw new Error('测试状态栏版权未创建')
      }

      brand.textContent = 'tampered'
      await waitForMutationObserver()
      expect(brand.textContent).toBe('Powered by JWord')
      expect(brand.hasAttribute('class')).toBe(false)

      brand.className = 'tampered'
      brand.setAttribute('aria-hidden', 'true')
      brand.setAttribute('data-extra', 'tampered')
      brand.style.cssText = 'display: none; visibility: hidden; opacity: 0; color: red; transform: scale(0);'
      await waitForMutationObserver()
      expect(brand.hasAttribute('class')).toBe(false)
      expect(brand.hasAttribute('aria-hidden')).toBe(false)
      expect(brand.hasAttribute('data-extra')).toBe(false)
      expect(brand.style.display).toBe('inline-flex')
      expect(brand.style.getPropertyPriority('display')).toBe('important')
      expect(brand.style.visibility).toBe('visible')
      expect(brand.style.opacity).toBe('1')
      expect(brand.style.transform).toBe('')

      const style = document.createElement('style')

      style.textContent = '.tampered-brand, [data-jword-status-bar-action="brand"] { display: none !important; opacity: 0 !important; }'
      document.head.append(style)
      brand.className = 'tampered-brand'
      await waitForIntegrityCheck()
      expect(brand.hasAttribute('class')).toBe(false)
      expect(brand.style.display).toBe('inline-flex')
      expect(brand.style.getPropertyPriority('display')).toBe('important')
      expect(brand.style.opacity).toBe('1')
      style.remove()

      brand.remove()
      await waitForMutationObserver()
      expect(restoreStatusHost.querySelector('[data-jword-status-bar-action="brand"]')).toBe(brand)

      ui.destroy()
    } finally {
      restoreEditor.destroy()
      restoreHost.remove()
      restoreStatusHost.remove()
    }

    const fallbackHost = document.createElement('div')
    const fallbackStatusHost = document.createElement('div')
    const fallbackEditor = createEditor({ initialText: 'fallback brand' })

    document.body.append(fallbackHost, fallbackStatusHost)

    try {
      fallbackEditor.mount(fallbackHost)
      const ui = createJWordUi({
        editor: fallbackEditor,
        editorHost: fallbackHost,
        statusBar: {
          host: fallbackStatusHost,
          brand: {
            label: 'Protected JWord',
            protection: 'watermarkFallback'
          }
        }
      })
      const brand = ui.elements.statusBar?.controls.brand
      const canvas = fallbackHost.querySelector<HTMLElement>('[data-jword-canvas-container]')

      expect(brand).toBeInstanceOf(HTMLElement)
      if (!(brand instanceof HTMLElement)) {
        throw new Error('测试状态栏版权未创建')
      }

      for (const text of ['bad-1', 'bad-2', 'bad-3']) {
        brand.textContent = text
        await waitForMutationObserver()
      }

      expect(canvas?.querySelector('[data-jword-page] [data-jword-watermark-layer="brand"]')).not.toBeNull()
      ui.destroy()
    } finally {
      fallbackEditor.destroy()
      fallbackHost.remove()
      fallbackStatusHost.remove()
    }
  })
})

/** 等待 MutationObserver 回调执行。 */
async function waitForMutationObserver(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

/** 等待周期完整性检查执行。 */
async function waitForIntegrityCheck(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 550))
  await waitForMutationObserver()
}

/** 为 jsdom 中的视图适应按钮提供稳定容器尺寸。 */
function mockElementSize(element: HTMLElement, width: number, height: number): void {
  Object.defineProperty(element, 'clientWidth', {
    configurable: true,
    value: width
  })
  Object.defineProperty(element, 'clientHeight', {
    configurable: true,
    value: height
  })
  element.getBoundingClientRect = () => ({
    x: 0,
    y: 0,
    top: 0,
    right: width,
    bottom: height,
    left: 0,
    width,
    height,
    toJSON: () => ({})
  })
}
