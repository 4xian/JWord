/**
 * @vitest-environment jsdom
 *
 * 职责：验证 Gate 0 最小 Editor facade 的浏览器生命周期。
 * 边界：只覆盖 create/mount/destroy，不进入 Gate 1 模型、事务或输入能力。
 * 协作模块：后续 examples/vanilla 和 UI 包通过公开 facade 挂载编辑器。
 * 性能/安全约束：DOM 创建必须延迟到 mount，destroy 必须移除自身 DOM。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/04-engineering-standards.md#45-模块边界。
 */

import { describe, expect, it } from 'vitest'

import { createEditor } from '../src/index'
import { twipsToCssPx } from '../src/page-config'
import { createSelectionState } from '../src/selection'

describe('createEditor', () => {
  it('creates an editor without touching host DOM', () => {
    const host = document.createElement('div')

    const editor = createEditor()

    expect(host.childElementCount).toBe(0)
    editor.destroy()
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
    expect(canvasContainer?.style.overflow).toBe('auto')

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
