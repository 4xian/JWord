/**
 * @vitest-environment jsdom
 *
 * 职责：验证挂载编辑器把批注锚点范围传入每页 canvas 渲染。
 * 边界：只覆盖 Editor facade 到 canvas 绘制指令的批注高亮闭环，不测试批注侧边栏 UI。
 * 协作模块：文档模型批注、布局查询、canvas renderer 和挂载运行时共同完成绘制。
 * 性能/安全约束：测试只替换用例内 canvas getContext，结束后恢复原型，不访问真实网络或外部图形资源。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/03-architecture.md#35-分页-canvas-渲染。
 */

import { describe, expect, it } from 'vitest'

import { createEditor } from '../../src/editor/runtime'
import { createSelectionState } from '../../src/model/selection'

describe('Editor comment canvas rendering', () => {
  it('在挂载 canvas 中绘制批注锚点高亮，并保持在选区之下', () => {
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
    const editor = createEditor()

    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value: 'Desktop Chrome'
    })
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value: getContext
    })

    try {
      loadCommentDocument(editor)
      editor.mount(host)
      calls.length = 0

      const anchor = editor.createTextAnchor({
        sectionId: 'section-comment-render',
        blockId: 'paragraph-comment-render',
        runId: 'run-comment-render',
        graphemeIndex: 1
      })
      const focus = editor.createTextAnchor({
        sectionId: 'section-comment-render',
        blockId: 'paragraph-comment-render',
        runId: 'run-comment-render',
        graphemeIndex: 3
      })

      editor.setSelection(createSelectionState(anchor, focus))

      expect(calls).toContain('fillStyle:#fff3bf')
      expect(calls).toContain('fillStyle:#cfe3ff')
      expect(calls.indexOf('fillStyle:#fff3bf')).toBeLessThan(calls.indexOf('fillStyle:#cfe3ff'))
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
})

/** 加载带批注锚点 marker 和 rangeSnapshot 的最小文档。 */
function loadCommentDocument(editor: ReturnType<typeof createEditor>): void {
  editor.loadDocumentModel({
    document: {
      kind: 'document',
      id: 'comment-render-document',
      comments: [
        {
          kind: 'commentThread',
          id: 'comment-thread-render',
          authorId: 'JWord',
          createdAt: '2026-07-05T00:00:00Z',
          anchorRangeId: 'comment-range-render',
          resolved: false,
          rangeSnapshot: {
            id: 'comment-range-render',
            anchor: {
              documentId: 'comment-render-document',
              sectionId: 'section-comment-render',
              blockId: 'paragraph-comment-render',
              runId: 'run-comment-render',
              graphemeIndex: 0,
              relativePosition: {}
            },
            focus: {
              documentId: 'comment-render-document',
              sectionId: 'section-comment-render',
              blockId: 'paragraph-comment-render',
              runId: 'run-comment-render',
              graphemeIndex: 4,
              relativePosition: {}
            }
          },
          messages: [
            {
              id: 'comment-message-render',
              authorId: 'JWord',
              createdAt: '2026-07-05T00:00:00Z',
              anchorRangeId: 'comment-range-render',
              text: '批注'
            }
          ]
        }
      ],
      sections: [
        {
          kind: 'section',
          id: 'section-comment-render',
          blocks: [
            {
              kind: 'paragraph',
              id: 'paragraph-comment-render',
              runs: [
                {
                  kind: 'run',
                  id: 'run-comment-render',
                  inlines: [
                    {
                      kind: 'commentRangeMarker',
                      commentId: 'comment-thread-render',
                      edge: 'start'
                    },
                    {
                      kind: 'text',
                      text: '批注文本'
                    },
                    {
                      kind: 'commentRangeMarker',
                      commentId: 'comment-thread-render',
                      edge: 'end'
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    }
  })
}
