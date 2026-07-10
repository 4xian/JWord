/**
 * @vitest-environment jsdom
 *
 * 职责：验证 Gate 0 最小 Editor facade 的浏览器生命周期。
 * 边界：只覆盖 create/mount/destroy，不进入 Gate 1 模型、事务或输入能力。
 * 协作模块：后续 examples/vanilla 和 UI 包通过公开 facade 挂载编辑器。
 * 性能/安全约束：DOM 创建必须延迟到 mount，destroy 必须移除自身 DOM。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import { describe, expect, it, vi } from 'vitest'

import { buildSetBoldCommand, createEditor } from '../../src/index'
import { twipsToCssPx } from '../../src/layout/page-config'
import { createSelectionState } from '../../src/model/selection'

describe('createEditor', () => {
  it('creates an editor without touching host DOM', () => {
    const host = document.createElement('div')

    const editor = createEditor()
    const projection = editor.getProjection()

    expect(host.childElementCount).toBe(0)
    expect(projection.document.id).toBe('document-1')
    expect(projection.document.sections).toHaveLength(1)
    editor.destroy()
  })

  it('passes grouped layout options into the layout runtime during initialization', () => {
    const editor = createEditor({
      initialText: `前缀 ${'h'.repeat(160)}`,
      layout: {
        keepLatinWordWholeOnWrap: true
      }
    })
    const firstLineText = editor.getLayout().pages[0]?.lines[0]?.fragments.map((fragment) => fragment.text).join('')

    expect(firstLineText).toBe('前缀 ')

    editor.destroy()
  })
})

describe('Editor page config', () => {
  it('resets custom margins to preset defaults when choosing a preset', () => {
    const editor = createEditor()

    try {
      editor.setPageConfig({
        widthTwips: 20000,
        heightTwips: 30000,
        marginTwips: {
          top: 100,
          right: 200,
          bottom: 300,
          left: 400
        }
      })

      const nextConfig = editor.setPageConfig({ preset: 'a4' })

      expect(nextConfig.preset).toBe('a4')
      expect(nextConfig.marginTwips).toEqual({
        top: 1440,
        right: 1440,
        bottom: 1440,
        left: 1440
      })
    } finally {
      editor.destroy()
    }
  })

  it('merges explicit preset margins from preset defaults', () => {
    const editor = createEditor()

    try {
      editor.setPageConfig({
        widthTwips: 20000,
        heightTwips: 30000,
        marginTwips: {
          top: 100,
          right: 200,
          bottom: 300,
          left: 400
        }
      })

      const nextConfig = editor.setPageConfig({
        preset: 'a4',
        marginTwips: {
          left: 720
        }
      })

      expect(nextConfig.marginTwips).toEqual({
        top: 1440,
        right: 1440,
        bottom: 1440,
        left: 720
      })
    } finally {
      editor.destroy()
    }
  })
})

describe('Editor mount/destroy lifecycle', () => {
  it('mounts a recognizable editor shell and canvas container', () => {
    const host = document.createElement('div')
    const editor = createEditor({ label: 'Test document' })

    editor.mount(host)

    const shell = host.querySelector('[data-jword-editor]')
    const canvasContainer = host.querySelector('[data-jword-canvas-container]')

    expect(shell).toBeInstanceOf(HTMLElement)
    expect(shell?.getAttribute('aria-label')).toBe('Test document')
    expect(canvasContainer).toBeInstanceOf(HTMLElement)
    expect(shell?.contains(canvasContainer)).toBe(true)
  })

  it('keeps the canvas viewport horizontally scrollable for a wide page', () => {
    const host = document.createElement('div')
    const editor = createEditor({
      initialText: '横向宽纸张',
      page: {
        widthTwips: 30000,
        heightTwips: 12000
      }
    })

    host.style.width = '320px'
    host.style.height = '240px'

    try {
      editor.mount(host)

      const shell = host.querySelector<HTMLElement>('[data-jword-editor]')
      const canvasContainer = host.querySelector<HTMLElement>('[data-jword-canvas-container]')
      const page = host.querySelector<HTMLElement>('[data-jword-page="0"]')

      expect(shell?.style.minWidth).toBe('0px')
      expect(canvasContainer?.style.minWidth).toBe('0px')
      expect(canvasContainer?.style.overflowX).toBe('auto')
      expect(canvasContainer?.style.overflowY).toBe('auto')
      expect(page?.style.minWidth).toBe(page?.style.width)
    } finally {
      editor.destroy()
    }
  })

  it('mounts paginated canvas pages from the current projection', () => {
    const host = document.createElement('div')
    const editor = createEditor({ initialText: '第一页文本\n\n第二段文本' })

    editor.mount(host)

    const page = host.querySelector('[data-jword-page="0"]')
    const canvas = page?.querySelector('canvas')

    expect(page).toBeInstanceOf(HTMLElement)
    expect(canvas).toBeInstanceOf(HTMLCanvasElement)

    editor.destroy()
  })

  it('updates retained page canvases when the canvas container scrolls', () => {
    const host = document.createElement('div')
    const text = Array.from({ length: 160 }, (_, index) => `第 ${index + 1} 段滚动分页文本`).join('\n\n')
    const editor = createEditor({ initialText: text })

    editor.mount(host)

    const layout = editor.getLayout()
    const page = layout.pages[2]
    const canvasContainer = host.querySelector('[data-jword-canvas-container]') as HTMLElement | null
    const firstPageCanvas = host.querySelector('[data-jword-page="0"] canvas') as HTMLCanvasElement | null

    expect(page).toBeDefined()
    expect(canvasContainer).toBeInstanceOf(HTMLElement)
    expect(firstPageCanvas).toBeInstanceOf(HTMLCanvasElement)
    expect(canvasContainer?.style.overflowX).toBe('auto')
    expect(canvasContainer?.style.overflowY).toBe('auto')

    canvasContainer!.scrollTop = twipsToCssPx(page!.y)
    canvasContainer!.dispatchEvent(new Event('scroll'))

    const scrolledPage = host.querySelector('[data-jword-page="2"]') as HTMLElement | null
    const scrolledPageCanvas = host.querySelector('[data-jword-page="2"] canvas')

    expect(scrolledPage?.style.width).toBe(`${twipsToCssPx(page!.width)}px`)
    expect(scrolledPage?.style.height).toBe(`${twipsToCssPx(page!.height)}px`)
    expect(scrolledPageCanvas).toBeInstanceOf(HTMLCanvasElement)
    expect(host.querySelector('[data-jword-page="0"] canvas')).toBeNull()

    expect(canvasContainer?.getAttribute('data-jword-layout-immediate-pages')).toBe('0')
    expect(canvasContainer?.getAttribute('data-jword-layout-deferred-chunks')).not.toBeNull()

    editor.destroy()
  })

  it('rerenders selection and caret on mounted page canvas when selection changes', () => {
    const host = document.createElement('div')
    const calls: string[] = []
    const originalUserAgent = window.navigator.userAgent
    const originalGetContext = HTMLCanvasElement.prototype.getContext
    const context = {
      set fillStyle(value: string) {
        calls.push(`fillStyle:${value}`)
      },
      set font(value: string) {
        calls.push(`font:${value}`)
      },
      set textBaseline(value: CanvasTextBaseline) {
        calls.push(`textBaseline:${value}`)
      },
      setTransform(a: number, b: number, c: number, d: number, e: number, f: number) {
        calls.push(`setTransform:${a},${b},${c},${d},${e},${f}`)
      },
      clearRect(x: number, y: number, width: number, height: number) {
        calls.push(`clearRect:${x},${y},${width},${height}`)
      },
      fillRect(x: number, y: number, width: number, height: number) {
        calls.push(`fillRect:${x},${y},${width},${height}`)
      },
      fillText(text: string, x: number, y: number) {
        calls.push(`fillText:${text},${x},${y}`)
      }
    } as unknown as CanvasRenderingContext2D
    const getContext: HTMLCanvasElement['getContext'] = ((contextId: string) =>
      contextId === '2d' ? context : null) as HTMLCanvasElement['getContext']

    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value: 'Desktop Chrome'
    })
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value: getContext
    })

    const editor = createEditor({ initialText: 'abcdef' })

    try {
      editor.mount(host)
      calls.length = 0

      const anchor = editor.createTextAnchor({
        sectionId: 'section-1',
        blockId: 'paragraph-1',
        runId: 'run-1',
        graphemeIndex: 1
      })
      const focus = editor.createTextAnchor({
        sectionId: 'section-1',
        blockId: 'paragraph-1',
        runId: 'run-1',
        graphemeIndex: 4
      })

      editor.setSelection(createSelectionState(anchor, focus))

      expect(calls).toContain('fillStyle:#cfe3ff')
      expect(calls.some((call) => call.startsWith('fillRect:'))).toBe(true)
    } finally {
      editor.destroy()
      Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
        configurable: true,
        value: originalGetContext
      })
      Object.defineProperty(window.navigator, 'userAgent', {
        configurable: true,
        value: originalUserAgent
      })
    }
  })

  it('uses the layout schedule to avoid rerendering unchanged retained pages', () => {
    const host = document.createElement('div')
    const calls: string[] = []
    const originalUserAgent = window.navigator.userAgent
    const originalGetContext = HTMLCanvasElement.prototype.getContext
    const context = {
      set fillStyle(value: string) {
        calls.push(`fillStyle:${value}`)
      },
      set font(value: string) {
        calls.push(`font:${value}`)
      },
      set textBaseline(value: CanvasTextBaseline) {
        calls.push(`textBaseline:${value}`)
      },
      setTransform(a: number, b: number, c: number, d: number, e: number, f: number) {
        calls.push(`setTransform:${a},${b},${c},${d},${e},${f}`)
      },
      clearRect(x: number, y: number, width: number, height: number) {
        calls.push(`clearRect:${x},${y},${width},${height}`)
      },
      fillRect(x: number, y: number, width: number, height: number) {
        calls.push(`fillRect:${x},${y},${width},${height}`)
      },
      fillText(text: string, x: number, y: number) {
        calls.push(`fillText:${text},${x},${y}`)
      }
    } as unknown as CanvasRenderingContext2D
    const getContext: HTMLCanvasElement['getContext'] = ((contextId: string) =>
      contextId === '2d' ? context : null) as HTMLCanvasElement['getContext']
    const text = Array.from({ length: 160 }, (_, index) => `第 ${index + 1} 段分页文本`).join('\n\n')
    const editor = createEditor({ initialText: text })

    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value: 'Desktop Chrome'
    })
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value: getContext
    })

    try {
      editor.mount(host)

      expect(editor.getLayout().pages.length).toBeGreaterThan(1)

      calls.length = 0

      const anchor = editor.createTextAnchor({
        sectionId: 'section-1',
        blockId: 'paragraph-1',
        runId: 'run-1',
        graphemeIndex: 0
      })

      editor.executeCommand({
        name: 'insertText',
        operations: [
          {
            kind: 'insertText',
            at: editor.resolveTextPosition(anchor),
            text: '新'
          }
        ]
      })

      expect(calls.filter((call) => call.startsWith('clearRect:'))).toHaveLength(1)
    } finally {
      editor.destroy()
      Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
        configurable: true,
        value: originalGetContext
      })
      Object.defineProperty(window.navigator, 'userAgent', {
        configurable: true,
        value: originalUserAgent
      })
    }
  })

  it('先同步重绘当前脏页，再异步执行后续 deferred chunks', () => {
    vi.useFakeTimers()
    const host = document.createElement('div')
    const calls: string[] = []
    const originalUserAgent = window.navigator.userAgent
    const originalGetContext = HTMLCanvasElement.prototype.getContext
    const originalRequestAnimationFrame = window.requestAnimationFrame
    const originalCancelAnimationFrame = window.cancelAnimationFrame
    const frameCallbacks: FrameRequestCallback[] = []
    const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      frameCallbacks.push(callback)

      return frameCallbacks.length
    })
    const cancelAnimationFrame = vi.fn()
    const context = {
      set fillStyle(value: string) {
        calls.push(`fillStyle:${value}`)
      },
      set font(value: string) {
        calls.push(`font:${value}`)
      },
      set textBaseline(value: CanvasTextBaseline) {
        calls.push(`textBaseline:${value}`)
      },
      setTransform(a: number, b: number, c: number, d: number, e: number, f: number) {
        calls.push(`setTransform:${a},${b},${c},${d},${e},${f}`)
      },
      clearRect(x: number, y: number, width: number, height: number) {
        calls.push(`clearRect:${x},${y},${width},${height}`)
      },
      fillRect(x: number, y: number, width: number, height: number) {
        calls.push(`fillRect:${x},${y},${width},${height}`)
      },
      fillText(text: string, x: number, y: number) {
        calls.push(`fillText:${text},${x},${y}`)
      }
    } as unknown as CanvasRenderingContext2D
    const getContext: HTMLCanvasElement['getContext'] = ((contextId: string) =>
      contextId === '2d' ? context : null) as HTMLCanvasElement['getContext']
    const text = '分页文本 '.repeat(6000)
    const editor = createEditor({ initialText: text })

    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value: 'Desktop Chrome'
    })
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value: getContext
    })
    Object.defineProperty(window, 'requestAnimationFrame', {
      configurable: true,
      writable: true,
      value: requestAnimationFrame
    })
    Object.defineProperty(window, 'cancelAnimationFrame', {
      configurable: true,
      writable: true,
      value: cancelAnimationFrame
    })

    try {
      editor.mount(host)

      expect(editor.getLayout().pages.length).toBeGreaterThan(4)

      calls.length = 0

      const anchor = editor.createTextAnchor({
        sectionId: 'section-1',
        blockId: 'paragraph-1',
        runId: 'run-1',
        graphemeIndex: 0
      })

      editor.executeCommand({
        name: 'insertText',
        operations: [
          {
            kind: 'insertText',
            at: editor.resolveTextPosition(anchor),
            text: '新增分页文本 '.repeat(3000)
          }
        ]
      })

      const canvasContainer = host.querySelector('[data-jword-canvas-container]') as HTMLElement | null
      const immediateClears = calls.filter((call) => call.startsWith('clearRect:'))

      expect(canvasContainer?.getAttribute('data-jword-layout-immediate-pages')).toBe('0')
      expect(canvasContainer?.getAttribute('data-jword-layout-deferred-chunks')).not.toBe('')
      expect(canvasContainer?.getAttribute('data-jword-layout-rerender-pages')).toBe('0')
      expect(immediateClears).toHaveLength(1)
      expect(requestAnimationFrame).toHaveBeenCalledTimes(1)
      expect(frameCallbacks).toHaveLength(1)

      frameCallbacks.shift()?.(0)

      const totalClears = calls.filter((call) => call.startsWith('clearRect:'))

      expect(totalClears.length).toBeGreaterThan(immediateClears.length)
      expect(canvasContainer?.getAttribute('data-jword-layout-rerender-pages')).not.toBe('0')
    } finally {
      editor.destroy()
      vi.useRealTimers()
      Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
        configurable: true,
        value: originalGetContext
      })
      Object.defineProperty(window.navigator, 'userAgent', {
        configurable: true,
        value: originalUserAgent
      })
      Object.defineProperty(window, 'requestAnimationFrame', {
        configurable: true,
        writable: true,
        value: originalRequestAnimationFrame
      })
      Object.defineProperty(window, 'cancelAnimationFrame', {
        configurable: true,
        writable: true,
        value: originalCancelAnimationFrame
      })
    }
  })

  it('mounted 小编辑在下一页起点稳定时不会继续调度 deferred render', () => {
    vi.useFakeTimers()
    const host = document.createElement('div')
    const calls: string[] = []
    const originalUserAgent = window.navigator.userAgent
    const originalGetContext = HTMLCanvasElement.prototype.getContext
    const context = {
      set fillStyle(value: string) {
        calls.push(`fillStyle:${value}`)
      },
      set font(value: string) {
        calls.push(`font:${value}`)
      },
      set textBaseline(value: CanvasTextBaseline) {
        calls.push(`textBaseline:${value}`)
      },
      setTransform(a: number, b: number, c: number, d: number, e: number, f: number) {
        calls.push(`setTransform:${a},${b},${c},${d},${e},${f}`)
      },
      clearRect(x: number, y: number, width: number, height: number) {
        calls.push(`clearRect:${x},${y},${width},${height}`)
      },
      fillRect(x: number, y: number, width: number, height: number) {
        calls.push(`fillRect:${x},${y},${width},${height}`)
      },
      fillText(text: string, x: number, y: number) {
        calls.push(`fillText:${text},${x},${y}`)
      }
    } as unknown as CanvasRenderingContext2D
    const getContext: HTMLCanvasElement['getContext'] = ((contextId: string) =>
      contextId === '2d' ? context : null) as HTMLCanvasElement['getContext']
    const text = Array.from(
      { length: 160 },
      (_, index) => `第 ${index + 1} 段稳定分页文本`
    ).join('\n\n')
    const editor = createEditor({ initialText: text })

    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value: 'Desktop Chrome'
    })
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value: getContext
    })

    try {
      editor.mount(host)

      expect(editor.getLayout().pages.length).toBeGreaterThan(1)

      calls.length = 0

      const anchor = editor.createTextAnchor({
        sectionId: 'section-1',
        blockId: 'paragraph-1',
        runId: 'run-1',
        graphemeIndex: 0
      })

      editor.executeCommand({
        name: 'insertText',
        operations: [
          {
            kind: 'insertText',
            at: editor.resolveTextPosition(anchor),
            text: '前'
          }
        ]
      })

      const canvasContainer = host.querySelector('[data-jword-canvas-container]') as HTMLElement | null
      const immediateClears = calls.filter((call) => call.startsWith('clearRect:'))

      expect(canvasContainer?.getAttribute('data-jword-layout-immediate-pages')).toBe('0')
      expect(canvasContainer?.getAttribute('data-jword-layout-deferred-chunks')).toBe('')
      expect(canvasContainer?.getAttribute('data-jword-layout-stopped-at')).toBe('1')
      expect(immediateClears).toHaveLength(1)

      vi.runOnlyPendingTimers()

      const totalClears = calls.filter((call) => call.startsWith('clearRect:'))

      expect(totalClears.length).toBe(immediateClears.length)
      expect(canvasContainer?.getAttribute('data-jword-layout-rerender-pages')).toBe('0')
    } finally {
      editor.destroy()
      vi.useRealTimers()
      Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
        configurable: true,
        value: originalGetContext
      })
      Object.defineProperty(window.navigator, 'userAgent', {
        configurable: true,
        value: originalUserAgent
      })
    }
  })

  it('mounted 查询 getLayout 不会同步吃完整个 deferred continuation', () => {
    vi.useFakeTimers()
    const host = document.createElement('div')
    const calls: string[] = []
    const originalUserAgent = window.navigator.userAgent
    const originalGetContext = HTMLCanvasElement.prototype.getContext
    const context = {
      set fillStyle(value: string) {
        calls.push(`fillStyle:${value}`)
      },
      set font(value: string) {
        calls.push(`font:${value}`)
      },
      set textBaseline(value: CanvasTextBaseline) {
        calls.push(`textBaseline:${value}`)
      },
      setTransform(a: number, b: number, c: number, d: number, e: number, f: number) {
        calls.push(`setTransform:${a},${b},${c},${d},${e},${f}`)
      },
      clearRect(x: number, y: number, width: number, height: number) {
        calls.push(`clearRect:${x},${y},${width},${height}`)
      },
      fillRect(x: number, y: number, width: number, height: number) {
        calls.push(`fillRect:${x},${y},${width},${height}`)
      },
      fillText(text: string, x: number, y: number) {
        calls.push(`fillText:${text},${x},${y}`)
      }
    } as unknown as CanvasRenderingContext2D
    const getContext: HTMLCanvasElement['getContext'] = ((contextId: string) =>
      contextId === '2d' ? context : null) as HTMLCanvasElement['getContext']
    const text = '分页查询文本 '.repeat(6000)
    const editor = createEditor({ initialText: text })

    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value: 'Desktop Chrome'
    })
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value: getContext
    })

    try {
      editor.mount(host)
      calls.length = 0

      const anchor = editor.createTextAnchor({
        sectionId: 'section-1',
        blockId: 'paragraph-1',
        runId: 'run-1',
        graphemeIndex: 0
      })

      editor.executeCommand({
        name: 'insertText',
        operations: [
          {
            kind: 'insertText',
            at: editor.resolveTextPosition(anchor),
            text: '新增分页查询文本 '.repeat(3000)
          }
        ]
      })

      const immediateClears = calls.filter((call) => call.startsWith('clearRect:'))

      expect(immediateClears).toHaveLength(1)
      expect(vi.getTimerCount()).toBeGreaterThan(0)

      const queriedLayout = editor.getLayout()

      expect(queriedLayout.pages.length).toBeGreaterThan(0)
      expect(vi.getTimerCount()).toBeGreaterThan(0)

      vi.runOnlyPendingTimers()

      const totalClears = calls.filter((call) => call.startsWith('clearRect:'))

      expect(totalClears.length).toBeGreaterThan(immediateClears.length)
    } finally {
      editor.destroy()
      vi.useRealTimers()
      Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
        configurable: true,
        value: originalGetContext
      })
      Object.defineProperty(window.navigator, 'userAgent', {
        configurable: true,
        value: originalUserAgent
      })
    }
  })

  it('mounted 命中与 rect 查询只按需续排并保留 deferred continuation', () => {
    vi.useFakeTimers()
    const host = document.createElement('div')
    const calls: string[] = []
    const originalUserAgent = window.navigator.userAgent
    const originalGetContext = HTMLCanvasElement.prototype.getContext
    const context = {
      set fillStyle(value: string) {
        calls.push(`fillStyle:${value}`)
      },
      set font(value: string) {
        calls.push(`font:${value}`)
      },
      set textBaseline(value: CanvasTextBaseline) {
        calls.push(`textBaseline:${value}`)
      },
      setTransform(a: number, b: number, c: number, d: number, e: number, f: number) {
        calls.push(`setTransform:${a},${b},${c},${d},${e},${f}`)
      },
      clearRect(x: number, y: number, width: number, height: number) {
        calls.push(`clearRect:${x},${y},${width},${height}`)
      },
      fillRect(x: number, y: number, width: number, height: number) {
        calls.push(`fillRect:${x},${y},${width},${height}`)
      },
      fillText(text: string, x: number, y: number) {
        calls.push(`fillText:${text},${x},${y}`)
      }
    } as unknown as CanvasRenderingContext2D
    const getContext: HTMLCanvasElement['getContext'] = ((contextId: string) =>
      contextId === '2d' ? context : null) as HTMLCanvasElement['getContext']
    const text = '分页命中文本 '.repeat(6000)
    const editor = createEditor({ initialText: text })

    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value: 'Desktop Chrome'
    })
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value: getContext
    })

    try {
      editor.mount(host)

      const before = editor.getLayout()
      const fragment = before.pages[0]?.lines[0]?.fragments[0]
      const insertionAnchor = editor.createTextAnchor({
        sectionId: 'section-1',
        blockId: 'paragraph-1',
        runId: 'run-1',
        graphemeIndex: 1
      })

      expect(fragment).toBeDefined()

      calls.length = 0

      editor.executeCommand({
        name: 'insertText',
        operations: [
          {
            kind: 'insertText',
            at: editor.resolveTextPosition(insertionAnchor),
            text: '扩展分页命中查询文本 '.repeat(3000)
          }
        ]
      })

      const hit = editor.hitTest({
        pageIndex: 0,
        x: (fragment?.x ?? 0) + 1,
        y: (fragment?.y ?? 0) + 1
      })
      const hitPosition = hit === undefined ? undefined : editor.resolveTextPosition(hit)
      const focus = hitPosition === undefined
        ? undefined
        : editor.createTextAnchor({
            sectionId: hitPosition.sectionId,
            blockId: hitPosition.blockId,
            runId: hitPosition.runId,
            graphemeIndex: hitPosition.graphemeIndex + 2
          })
      const caretRect = hit === undefined ? undefined : editor.getCaretRect(hit)
      const selectionRects = hit === undefined || focus === undefined
        ? []
        : editor.getSelectionRects(createSelectionState(hit, focus).range)
      const immediateClears = calls.filter((call) => call.startsWith('clearRect:'))

      expect(hit).toBeDefined()
      expect(caretRect?.pageIndex).toBe(0)
      expect(selectionRects.length).toBeGreaterThan(0)
      expect(immediateClears).toHaveLength(1)
      expect(vi.getTimerCount()).toBeGreaterThan(0)

      vi.runOnlyPendingTimers()

      const totalClears = calls.filter((call) => call.startsWith('clearRect:'))

      expect(totalClears.length).toBeGreaterThan(immediateClears.length)
    } finally {
      editor.destroy()
      vi.useRealTimers()
      Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
        configurable: true,
        value: originalGetContext
      })
      Object.defineProperty(window.navigator, 'userAgent', {
        configurable: true,
        value: originalUserAgent
      })
    }
  })

  it('returns the cached layout until the document changes', () => {
    const editor = createEditor({ initialText: '缓存布局' })

    try {
      const firstLayout = editor.getLayout()
      const secondLayout = editor.getLayout()

      expect(secondLayout).toBe(firstLayout)
    } finally {
      editor.destroy()
    }
  })

  it('reuses stable later pages after a small edit keeps page starts unchanged', () => {
    const text = Array.from(
      { length: 160 },
      (_, index) => `第 ${index + 1} 段稳定分页文本`
    ).join('\n\n')
    const editor = createEditor({ initialText: text })

    try {
      const before = editor.getLayout()
      const anchor = editor.createTextAnchor({
        sectionId: 'section-1',
        blockId: 'paragraph-1',
        runId: 'run-1',
        graphemeIndex: 0
      })

      editor.executeCommand({
        name: 'insertText',
        operations: [
          {
            kind: 'insertText',
            at: editor.resolveTextPosition(anchor),
            text: '前'
          }
        ]
      })

      const after = editor.getLayout()

      expect(after).not.toBe(before)
      expect(after.pages[0]).not.toBe(before.pages[0])
      expect(after.pages[1]).toBe(before.pages[1])
    } finally {
      editor.destroy()
    }
  })

  it('relayouts every touched page for multi-page formatting commands before reusing a stable suffix', () => {
    const text = Array.from(
      { length: 160 },
      (_, index) => `绗?${index + 1} 娈佃法椤垫牱寮忓懡浠ゆ枃鏈琡`
    ).join('\n\n')
    const editor = createEditor({ initialText: text })

    try {
      const before = editor.getLayout()
      const startFragment = before.pages[0]?.lines.find((line) => line.fragments.length > 0)?.fragments[0]
      const targetPage = before.pages.find((page) =>
        page.pageIndex >= 2 && page.lines.some((line) => line.fragments.length > 0)
      )
      const endLine = [...(targetPage?.lines ?? [])].reverse().find((line) => line.fragments.length > 0)
      const endFragment = endLine?.fragments[endLine.fragments.length - 1]
      const stableSuffixPageIndex = targetPage === undefined ? undefined : targetPage.pageIndex + 1

      expect(before.pages.length).toBeGreaterThanOrEqual(4)
      expect(startFragment).toBeDefined()
      expect(targetPage).toBeDefined()
      expect(endFragment).toBeDefined()

      const selection = createSelectionState(
        editor.createTextAnchor({
          sectionId: startFragment!.sectionId,
          blockId: startFragment!.blockId,
          runId: startFragment!.runId,
          graphemeIndex: startFragment!.start.graphemeIndex
        }),
        editor.createTextAnchor({
          sectionId: endFragment!.sectionId,
          blockId: endFragment!.blockId,
          runId: endFragment!.runId,
          graphemeIndex: endFragment!.end.graphemeIndex
        })
      )
      const command = buildSetBoldCommand(editor.getProjection(), selection, true)

      expect(command).not.toBeNull()

      editor.executeCommand(command!)

      const after = editor.getLayout()
      const middleFragment = after.pages[1]?.lines.find((line) => line.fragments.length > 0)?.fragments[0]
      const targetFragment = after.pages[targetPage!.pageIndex]?.lines
        .find((line) => line.fragments.length > 0)?.fragments[0]

      expect(after.pages[0]).not.toBe(before.pages[0])
      expect(after.pages[1]).not.toBe(before.pages[1])
      expect(after.pages[targetPage!.pageIndex]).not.toBe(before.pages[targetPage!.pageIndex])
      expect(middleFragment?.style.bold).toBe(true)
      expect(targetFragment?.style.bold).toBe(true)

      if (stableSuffixPageIndex !== undefined) {
        expect(after.pages[stableSuffixPageIndex]).toBe(before.pages[stableSuffixPageIndex])
      }
    } finally {
      editor.destroy()
    }
  })

  it('uses the command target page when rerendering an offscreen later page without selection', () => {
    const host = document.createElement('div')
    const text = Array.from({ length: 160 }, (_, index) => `第 ${index + 1} 段跨页命令文本`).join('\n\n')
    const editor = createEditor({ initialText: text })

    try {
      editor.mount(host)

      const layout = editor.getLayout()
      const targetPage = layout.pages.find((page) =>
        page.pageIndex >= 2 && page.lines.some((line) => line.fragments.length > 0)
      )
      const targetFragment = targetPage?.lines[0]?.fragments[0]
      const canvasContainer = host.querySelector('[data-jword-canvas-container]') as HTMLElement | null

      expect(targetPage).toBeDefined()
      expect(targetFragment).toBeDefined()
      expect(canvasContainer).toBeInstanceOf(HTMLElement)
      expect(host.querySelector(`[data-jword-page="${targetPage?.pageIndex ?? -1}"] canvas`)).toBeNull()

      const anchor = editor.createTextAnchor({
        sectionId: targetFragment!.sectionId,
        blockId: targetFragment!.blockId,
        runId: targetFragment!.runId,
        graphemeIndex: targetFragment!.start.graphemeIndex
      })

      editor.executeCommand({
        name: 'insertText',
        operations: [
          {
            kind: 'insertText',
            at: editor.resolveTextPosition(anchor),
            text: '后'
          }
        ]
      })

      expect(canvasContainer?.getAttribute('data-jword-layout-immediate-pages')).toBe(String(targetPage!.pageIndex))
      expect(canvasContainer?.getAttribute('data-jword-layout-rerender-pages')).toContain(String(targetPage!.pageIndex))
      expect(host.querySelector(`[data-jword-page="${targetPage!.pageIndex}"] canvas`)).toBeInstanceOf(HTMLCanvasElement)
    } finally {
      editor.destroy()
    }
  })

  it('keeps existing page wrapper nodes when scroll only changes viewport canvases', () => {
    const host = document.createElement('div')
    const text = Array.from(
      { length: 160 },
      (_, index) => `第 ${index + 1} 段滚动复用页面节点`
    ).join('\n\n')
    const editor = createEditor({ initialText: text })

    try {
      editor.mount(host)

      const layout = editor.getLayout()
      const targetPage = layout.pages[2]
      const canvasContainer = host.querySelector('[data-jword-canvas-container]') as HTMLElement | null
      const firstPage = host.querySelector('[data-jword-page="0"]')
      const secondPage = host.querySelector('[data-jword-page="1"]')

      expect(targetPage).toBeDefined()
      expect(canvasContainer).toBeInstanceOf(HTMLElement)
      expect(firstPage).toBeInstanceOf(HTMLElement)
      expect(secondPage).toBeInstanceOf(HTMLElement)

      canvasContainer!.scrollTop = twipsToCssPx(targetPage!.y)
      canvasContainer!.dispatchEvent(new Event('scroll'))

      expect(host.querySelector('[data-jword-page="0"]')).toBe(firstPage)
      expect(host.querySelector('[data-jword-page="1"]')).toBe(secondPage)
    } finally {
      editor.destroy()
    }
  })

  it('keeps page wrappers stable while deferred mounted relayout is still pending', () => {
    vi.useFakeTimers()
    const host = document.createElement('div')
    const text = Array.from(
      { length: 160 },
      (_, index) => `绗?${index + 1} 娈电紪杈戝悗椤靛３绋冲畾鏂囨湰`
    ).join('\n\n')
    const editor = createEditor({ initialText: text })

    try {
      editor.mount(host)

      const before = editor.getLayout()
      const canvasContainer = host.querySelector('[data-jword-canvas-container]') as HTMLElement | null
      const firstPage = host.querySelector('[data-jword-page="0"]')
      const secondPage = host.querySelector('[data-jword-page="1"]')
      const lastPage = host.querySelector(`[data-jword-page="${before.pages.length - 1}"]`)
      const anchor = editor.createTextAnchor({
        sectionId: 'section-1',
        blockId: 'paragraph-1',
        runId: 'run-1',
        graphemeIndex: 0
      })

      expect(canvasContainer).toBeInstanceOf(HTMLElement)
      expect(firstPage).toBeInstanceOf(HTMLElement)
      expect(secondPage).toBeInstanceOf(HTMLElement)
      expect(lastPage).toBeInstanceOf(HTMLElement)

      editor.executeCommand({
        name: 'insertText',
        operations: [
          {
            kind: 'insertText',
            at: editor.resolveTextPosition(anchor),
            text: '鍓?' + '琛?'.repeat(400)
          }
        ]
      })

      expect(canvasContainer?.getAttribute('data-jword-page-count')).toBe(String(before.pages.length))
      expect(canvasContainer?.getAttribute('data-jword-layout-deferred-chunks')).not.toBe('')
      expect(host.querySelectorAll('[data-jword-page]')).toHaveLength(before.pages.length)
      expect(host.querySelector('[data-jword-page="0"]')).toBe(firstPage)
      expect(host.querySelector('[data-jword-page="1"]')).toBe(secondPage)
      expect(host.querySelector(`[data-jword-page="${before.pages.length - 1}"]`)).toBe(lastPage)
    } finally {
      editor.destroy()
      vi.useRealTimers()
    }
  })

  it('rejects mounting an already mounted editor', () => {
    const firstHost = document.createElement('div')
    const secondHost = document.createElement('div')
    const editor = createEditor()

    editor.mount(firstHost)

    expect(() => editor.mount(secondHost)).toThrow(/already mounted/i)
    expect(secondHost.childElementCount).toBe(0)
  })

  it('removes its own DOM on destroy and allows repeated destroy calls', () => {
    const host = document.createElement('div')
    const editor = createEditor()

    editor.mount(host)
    editor.destroy()
    editor.destroy()

    expect(host.childElementCount).toBe(0)
  })
})
