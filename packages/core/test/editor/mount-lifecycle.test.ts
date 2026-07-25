/**
 * @vitest-environment jsdom
 *
 * 职责：验证 editor mount/destroy 的 DOM 事件生命周期和 canvas 池释放。
 * 边界：只覆盖挂载层事件绑定、document mouseup 与销毁释放，不测试输入语义、分页布局或真实浏览器画布。
 * 协作模块：挂载门面、指针运行时、画布池和渲染器共同维护挂载资源生命周期。
 * 性能/安全约束：测试运行在 jsdom，使用内存 DOM，不访问网络或磁盘。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import { describe, expect, it } from 'vitest'

import { createEditor } from '../../src/index'
import { twipsToCssPx } from '../../src/layout/page-config'

describe('Editor mount lifecycle', () => {
  it('clears mounted DOM event listeners on destroy', () => {
    const tracker = createEventListenerTracker()
    const host = document.createElement('div')
    const editor = createEditor({ initialText: 'abcdef' })

    try {
      editor.mount(host)

      expect(tracker.activeCount()).toBeGreaterThan(0)

      editor.destroy()

      expect(tracker.activeCount()).toBe(0)
    } finally {
      editor.destroy()
      tracker.restore()
    }
  })

  it('stops pointer drag when mouseup fires on document', () => {
    const host = document.createElement('div')
    const editor = createEditor({ initialText: 'abcdef' })

    try {
      editor.mount(host)

      const page = getPageElement(host, 0)

      mockPageRect(page)

      const dragStart = findPointerPointForGrapheme(editor, 0, 1)
      const dragMiddle = findPointerPointForGrapheme(editor, 0, 3)
      const dragEnd = findPointerPointForGrapheme(editor, 0, 5)

      dispatchMouse(page, 'mousedown', dragStart.clientX, dragStart.clientY)
      dispatchMouse(page, 'mousemove', dragMiddle.clientX, dragMiddle.clientY)
      dispatchMouse(document, 'mouseup', dragMiddle.clientX, dragMiddle.clientY)

      expectSelectionIndexes(editor, [1, 3])

      dispatchMouse(page, 'mousemove', dragEnd.clientX, dragEnd.clientY)

      expectSelectionIndexes(editor, [1, 3])
    } finally {
      editor.destroy()
    }
  })

  it('zeros mounted canvases when editor is destroyed', () => {
    const host = document.createElement('div')
    const editor = createEditor({ initialText: 'abcdef' })

    try {
      editor.mount(host)

      const canvas = host.querySelector('canvas')

      expect(canvas).toBeInstanceOf(HTMLCanvasElement)

      if (!(canvas instanceof HTMLCanvasElement)) {
        return
      }

      expect(canvas.width).toBeGreaterThan(0)
      expect(canvas.height).toBeGreaterThan(0)

      editor.destroy()

      expect(canvas.width).toBe(0)
      expect(canvas.height).toBe(0)
    } finally {
      editor.destroy()
    }
  })
})

interface ListenerRecord {
  readonly target: EventTarget
  readonly type: string
  readonly listener: EventListenerOrEventListenerObject
}

/** 创建事件监听追踪器，支持 removeEventListener 与 AbortSignal 自动清理路径。 */
function createEventListenerTracker() {
  const originalAdd = EventTarget.prototype.addEventListener
  const originalRemove = EventTarget.prototype.removeEventListener
  const records: ListenerRecord[] = []

  EventTarget.prototype.addEventListener = function trackedAdd(
    this: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions
  ): void {
    if (listener !== null && !readAbortSignal(options)?.aborted) {
      const record = { target: this, type, listener }

      records.push(record)
      readAbortSignal(options)?.addEventListener('abort', () => {
        removeTrackedRecord(records, record)
      }, { once: true })
    }

    originalAdd.call(this, type, listener, options)
  }

  EventTarget.prototype.removeEventListener = function trackedRemove(
    this: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions
  ): void {
    if (listener !== null) {
      const index = records.findIndex((record) =>
        record.target === this && record.type === type && record.listener === listener
      )

      if (index >= 0) {
        records.splice(index, 1)
      }
    }

    originalRemove.call(this, type, listener, options)
  }

  return {
    activeCount() {
      return records.length
    },
    restore() {
      EventTarget.prototype.addEventListener = originalAdd
      EventTarget.prototype.removeEventListener = originalRemove
      records.splice(0, records.length)
    }
  }
}

/** 从 addEventListener 参数读取 AbortSignal。 */
function readAbortSignal(options?: boolean | AddEventListenerOptions): AbortSignal | undefined {
  return typeof options === 'object' && options !== null
    ? options.signal
    : undefined
}

/** 从追踪列表移除指定监听记录。 */
function removeTrackedRecord(records: ListenerRecord[], record: ListenerRecord): void {
  const index = records.indexOf(record)

  if (index >= 0) {
    records.splice(index, 1)
  }
}

function getPageElement(host: HTMLElement, pageIndex: number): HTMLElement {
  const page = host.querySelector(`[data-jword-page="${pageIndex}"]`)

  if (!(page instanceof HTMLElement)) {
    throw new Error(`page ${pageIndex} 未挂载`)
  }

  return page
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

function dispatchMouse(
  target: EventTarget,
  type: 'mousedown' | 'mousemove' | 'mouseup',
  clientX: number,
  clientY: number
): void {
  target.dispatchEvent(new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    buttons: type === 'mouseup' ? 0 : 1,
    clientX,
    clientY
  }))
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

  expect([
    editor.resolveTextPosition(selection.anchor).graphemeIndex,
    editor.resolveTextPosition(selection.focus).graphemeIndex
  ]).toEqual(expected)
}
