/**
 * @vitest-environment jsdom
 *
 * 职责：验证挂载态文本镜像在大文档输入热路径中的同步策略。
 * 边界：只覆盖 core mounted runtime 的辅助 DOM 文本镜像，不测试 UI 包独立 text mirror 控制器。
 * 协作模块：input runtime 提交事务，layout runtime 安排延迟辅助 DOM 同步。
 * 性能/安全约束：大文档输入不得在同一 input 事件内串联全文写入 DOM，避免阻塞浏览器热路径。
 * Specs：docs/superpowers/reports/2026-07-03-remediation-execution-supplement.md#39-phase-4-性能专项输入热路径-p95--50ms。
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createEditor } from '../../src/index'
import { DEFERRED_DOCUMENT_RENDER_DELAY_MS, DEFERRED_TEXT_MIRROR_SYNC_DELAY_MS } from '../../src/editor/constants'

describe('mounted text mirror hot path', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('大文档输入后先保留旧镜像并在延迟任务中同步全文', () => {
    vi.useFakeTimers()

    const host = document.createElement('div')
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

    try {
      editor.mount(host)
      editor.focus()

      expect(editor.getLayout().pages.length).toBeGreaterThan(50)

      const textarea = host.querySelector('[data-jword-hidden-textarea]')
      const textMirror = host.querySelector('[data-jword-text-mirror]')

      expect(textarea).toBeInstanceOf(HTMLTextAreaElement)
      expect(textMirror).toBeInstanceOf(HTMLElement)

      const previousMirrorText = textMirror?.textContent ?? ''

      ;(textarea as HTMLTextAreaElement).value = 'Ω'
      textarea?.dispatchEvent(new Event('input', {
        bubbles: true,
        cancelable: true
      }))

      expect(editor.getProjection().document.sections[0]?.blocks.at(-1)?.kind).toBe('paragraph')
      expect(textMirror?.textContent).toBe(previousMirrorText)

      vi.advanceTimersByTime(DEFERRED_DOCUMENT_RENDER_DELAY_MS + DEFERRED_TEXT_MIRROR_SYNC_DELAY_MS)

      expect(textMirror?.textContent).toBe(`${previousMirrorText}Ω`)
    } finally {
      editor.destroy()
    }
  })
})

/** 创建能稳定超过 50 页的轻量文本 fixture。 */
function createLargeText(): string {
  return Array.from({ length: 720 }, (_, index) => `第 ${index + 1} 段 abcdefghijklmnopqrstuvwxyz`).join('\n')
}
