/**
 * @vitest-environment jsdom
 *
 * 职责：验证大文档挂载态输入不会在同一 input 事件中同步重排/重绘页面。
 * 边界：只覆盖 mounted document render 调度，不验证 canvas 像素内容或 UI toolbar。
 * 协作模块：transaction event 标记布局脏页，mounted runtime 把大文档渲染让到延迟任务。
 * 性能/安全约束：大文档输入热路径不得同步执行真实 canvas 重绘，避免浏览器输入 P95 超标。
 * Specs：docs/superpowers/reports/2026-07-03-remediation-execution-supplement.md#39-phase-4-性能专项输入热路径-p95--50ms。
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createEditor } from '../../src/index'
import { DEFERRED_DOCUMENT_RENDER_DELAY_MS } from '../../src/editor/constants'

describe('mounted document render hot path', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('大文档输入先更新 projection 并把页面重绘延迟到 input 事件之后', () => {
    vi.useFakeTimers()

    const host = document.createElement('div')
    const calls: string[] = []
    const originalUserAgent = window.navigator.userAgent
    const originalGetContext = HTMLCanvasElement.prototype.getContext
    const context = createRecordingCanvasContext(calls)
    const getContext: HTMLCanvasElement['getContext'] = ((contextId: string) =>
      contextId === '2d' ? context : null) as HTMLCanvasElement['getContext']
    const editor = createEditor({
      initialText: createLargeText(),
      page: {
        heightTwips: 1800,
        marginTwips: {
          top: 120,
          right: 120,
          bottom: 120,
          left: 120
        }
      }
    })

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
      editor.focus()
      expect(editor.getLayout().pages.length).toBeGreaterThan(50)

      calls.length = 0

      const textarea = host.querySelector('[data-jword-hidden-textarea]')

      expect(textarea).toBeInstanceOf(HTMLTextAreaElement)

      ;(textarea as HTMLTextAreaElement).value = 'Ω'
      textarea?.dispatchEvent(new Event('input', {
        bubbles: true,
        cancelable: true
      }))

      expect(readLastParagraphText(editor)).toMatch(/Ω$/)
      expect(calls.filter((call) => call.startsWith('clearRect:'))).toHaveLength(0)

      vi.advanceTimersByTime(DEFERRED_DOCUMENT_RENDER_DELAY_MS)

      expect(calls.filter((call) => call.startsWith('clearRect:')).length).toBeGreaterThan(0)
    } finally {
      editor.destroy()
      Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value: 'Desktop Chrome'
    })
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
})

/** 创建能稳定超过 50 页的轻量文本 fixture。 */
function createLargeText(): string {
  return Array.from({ length: 720 }, (_, index) => `第 ${index + 1} 段 abcdefghijklmnopqrstuvwxyz`).join('\n')
}

/** 读取最后段落的纯文本内容。 */
function readLastParagraphText(editor: ReturnType<typeof createEditor>): string {
  const lastBlock = editor.getProjection().document.sections[0]?.blocks.at(-1)

  if (lastBlock?.kind !== 'paragraph') {
    return ''
  }

  return lastBlock.runs
    .flatMap((run) => run.inlines.flatMap((inline) => inline.kind === 'text' ? [inline.text] : []))
    .join('')
}

/** 创建记录绘制调用的最小 Canvas 2D context。 */
function createRecordingCanvasContext(calls: string[]): CanvasRenderingContext2D {
  return {
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
}
