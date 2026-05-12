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
