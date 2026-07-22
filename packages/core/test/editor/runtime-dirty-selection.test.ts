/**
 * @vitest-environment jsdom
 *
 * 职责：验证 mounted Editor 在文档 no-op 事务中仍应用显式 selectionAfter。
 * 边界：只覆盖公开命令、selection 事件、canvas 绘制和 layout identity，不测试输入事件。
 * 协作模块：transaction pipeline、facade selection 调度和 mounted canvas runtime 共同完成该行为。
 * 性能/安全约束：测试只使用小型 jsdom 文档和内存 canvas spy，不访问网络或磁盘。
 * 实现说明：本文件按 Phase 2C T8a/T8b 契约验证公开 Editor seam。
 */

import { describe, expect, it } from 'vitest'

import { createEditor } from '../../src/editor/runtime'
import { createSelectionState } from '../../src/model/selection'

describe('Editor dirty selection runtime', () => {
  /** no-op 命令仍须刷新显式 selectionAfter，但不得替换稳定 document layout。 */
  it('renders selectionAfter once without replacing layout for a document no-op', () => {
    const host = document.createElement('div')
    const calls: string[] = []
    const originalUserAgent = window.navigator.userAgent
    const originalGetContext = HTMLCanvasElement.prototype.getContext
    const context = createCanvasContext(calls)
    /** 为 selection canvas 返回测试用 2D context。 */
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

      const insertPosition = editor.resolveTextPosition(editor.createTextAnchor({
        sectionId: 'section-1',
        blockId: 'paragraph-1',
        runId: 'run-1',
        graphemeIndex: 0
      }))
      const selectionAfter = createSelectionState(
        editor.createTextAnchor({
          sectionId: 'section-1',
          blockId: 'paragraph-1',
          runId: 'run-1',
          graphemeIndex: 1
        }),
        editor.createTextAnchor({
          sectionId: 'section-1',
          blockId: 'paragraph-1',
          runId: 'run-1',
          graphemeIndex: 4
        })
      )
      const selectionEvents: unknown[] = []
      const unsubscribe = editor.subscribe((event) => {
        if (event.kind === 'selectionChange') {
          selectionEvents.push(event.selection)
        }
      })
      const stableLayout = editor.getLayout()

      calls.length = 0

      editor.executeCommand({
        name: 'selectionAfterNoOp',
        operations: [{ kind: 'insertText', at: insertPosition, text: '' }]
      }, { selectionAfter })

      expect(editor.getSelection()).toBe(selectionAfter)
      expect(selectionEvents).toEqual([selectionAfter])
      expect(calls).toContain('fillStyle:#cfe3ff')
      expect(calls.some((call) => call.startsWith('fillRect:'))).toBe(true)
      expect.soft(editor.getLayout()).toBe(stableLayout)

      unsubscribe()
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

/** 创建记录 selection canvas 绘制调用的最小 2D context。 */
function createCanvasContext(calls: string[]): CanvasRenderingContext2D {
  return {
    /** 记录填充样式更新。 */
    set fillStyle(value: string) {
      calls.push(`fillStyle:${value}`)
    },
    /** 记录字体更新。 */
    set font(value: string) {
      calls.push(`font:${value}`)
    },
    /** 记录合成模式更新。 */
    set globalCompositeOperation(value: GlobalCompositeOperation) {
      calls.push(`globalCompositeOperation:${value}`)
    },
    /** 记录文本基线更新。 */
    set textBaseline(value: CanvasTextBaseline) {
      calls.push(`textBaseline:${value}`)
    },
    /** 记录 canvas 状态保存。 */
    save() {
      calls.push('save')
    },
    /** 记录 canvas 状态恢复。 */
    restore() {
      calls.push('restore')
    },
    /** 记录 canvas transform。 */
    setTransform(a: number, b: number, c: number, d: number, e: number, f: number) {
      calls.push(`setTransform:${a},${b},${c},${d},${e},${f}`)
    },
    /** 记录 canvas 清除。 */
    clearRect(x: number, y: number, width: number, height: number) {
      calls.push(`clearRect:${x},${y},${width},${height}`)
    },
    /** 记录矩形绘制。 */
    fillRect(x: number, y: number, width: number, height: number) {
      calls.push(`fillRect:${x},${y},${width},${height}`)
    },
    /** 记录文本绘制。 */
    fillText(text: string, x: number, y: number) {
      calls.push(`fillText:${text},${x},${y}`)
    },
    /** 记录离屏 canvas 复制。 */
    drawImage() {
      calls.push('drawImage')
    }
  } as unknown as CanvasRenderingContext2D
}
