/**
 * @vitest-environment jsdom
 *
 * 职责：验证 Gate 3 指针选区补齐项，覆盖三击选段和拖拽边缘自动滚动。
 * 边界：只通过挂载后的编辑器门面和鼠标事件验证用户可见行为，不访问运行时私有状态。
 * 协作模块：输入运行时、指针运行时、布局命中和选择区共同支撑鼠标选区语义。
 * 性能/安全约束：测试只运行在 jsdom，不访问网络或磁盘，不直接写文档投影。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#gate-3。
 */
import { describe, expect, it, vi } from 'vitest'

import { createEditor } from '../../src/index'
import { twipsToCssPx } from '../../src/layout/page-config'

describe('Editor pointer runtime remediation', () => {
  it('selects the full paragraph after a triple click', () => {
    const host = document.createElement('div')
    const editor = createEditor({ initialText: 'hello world\n\nsecond paragraph' })

    try {
      editor.mount(host)

      const page = getPageElement(host, 0)

      mockPageRect(page)

      const point = findPointerPointForGrapheme(editor, 0, 4)

      dispatchMouse(page, 'mousedown', point.clientX, point.clientY)
      dispatchMouse(page, 'mouseup', point.clientX, point.clientY)
      dispatchMouse(page, 'dblclick', point.clientX, point.clientY)
      dispatchMouse(page, 'mousedown', point.clientX, point.clientY, { detail: 3 })

      expectSelectionIndexes(editor, [0, 11])
    } finally {
      editor.destroy()
    }
  })

  it('scrolls the canvas container when dragging near the viewport edge', () => {
    vi.useFakeTimers()

    const host = document.createElement('div')
    const text = Array.from({ length: 180 }, (_, index) => `第 ${index + 1} 段滚动文本`).join('\n\n')
    const editor = createEditor({ initialText: text })

    try {
      document.body.append(host)
      editor.mount(host)

      const page = getPageElement(host, 0)
      const container = getCanvasContainer(host)

      mockPageRect(page)
      mockContainerRect(container, 120)

      const start = findPointerPointForGrapheme(editor, 0, 1)

      dispatchMouse(page, 'mousedown', start.clientX, start.clientY)
      dispatchMouse(page, 'mousemove', start.clientX, 118)
      vi.advanceTimersByTime(120)

      expect(container.scrollTop).toBeGreaterThan(0)
    } finally {
      editor.destroy()
      host.remove()
      vi.useRealTimers()
    }
  })
})

function dispatchMouse(
  target: HTMLElement,
  type: 'mousedown' | 'mousemove' | 'mouseup' | 'dblclick',
  clientX: number,
  clientY: number,
  options: Readonly<{ detail?: number }> = {}
): void {
  target.dispatchEvent(new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    buttons: type === 'mouseup' ? 0 : 1,
    clientX,
    clientY,
    detail: options.detail ?? (type === 'dblclick' ? 2 : 1)
  }))
}

function getCanvasContainer(host: HTMLElement): HTMLElement {
  const container = host.querySelector('[data-jword-canvas-container]')

  if (!(container instanceof HTMLElement)) {
    throw new Error('canvas container 未挂载')
  }

  return container
}

function getPageElement(host: HTMLElement, pageIndex: number): HTMLElement {
  const page = host.querySelector(`[data-jword-page="${pageIndex}"]`)

  if (!(page instanceof HTMLElement)) {
    throw new Error(`page ${pageIndex} 未挂载`)
  }

  return page
}

function mockContainerRect(container: HTMLElement, height: number): void {
  Object.defineProperty(container, 'clientHeight', {
    configurable: true,
    value: height
  })
  Object.defineProperty(container, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 800,
      bottom: height,
      width: 800,
      height,
      toJSON: () => ({})
    })
  })
}

function mockPageRect(page: HTMLElement): void {
  Object.defineProperty(page, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: Number.parseFloat(page.style.width || '0'),
      bottom: Number.parseFloat(page.style.height || '0'),
      width: Number.parseFloat(page.style.width || '0'),
      height: Number.parseFloat(page.style.height || '0'),
      toJSON: () => ({})
    })
  })
}

function findPointerPointForGrapheme(
  editor: ReturnType<typeof createEditor>,
  pageIndex: number,
  graphemeIndex: number
): Readonly<{ clientX: number, clientY: number }> {
  const layout = editor.getLayout()
  const page = layout.pages[pageIndex]

  if (page === undefined) {
    throw new Error(`page ${pageIndex} 不存在`)
  }

  const localY = (page.lines[0]?.y ?? 0) - page.y + 1

  for (let x = 0; x < page.width; x += 1) {
    const anchor = editor.hitTest({
      pageIndex,
      x,
      y: localY
    })

    if (anchor === undefined) {
      continue
    }

    if (editor.resolveTextPosition(anchor).graphemeIndex === graphemeIndex) {
      return {
        clientX: twipsToCssPx(x),
        clientY: twipsToCssPx(localY)
      }
    }
  }

  throw new Error(`找不到 grapheme ${graphemeIndex} 的命中点`)
}

function expectSelectionIndexes(
  editor: ReturnType<typeof createEditor>,
  expected: readonly [number, number]
): void {
  const selection = editor.getSelection()

  expect(selection).not.toBeNull()

  if (selection === null) {
    return
  }

  const indexes = [
    editor.resolveTextPosition(selection.anchor).graphemeIndex,
    editor.resolveTextPosition(selection.focus).graphemeIndex
  ].sort((left, right) => left - right)

  expect(indexes).toEqual(expected)
}
