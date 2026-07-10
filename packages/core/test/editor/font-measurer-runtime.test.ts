/**
 * @vitest-environment jsdom
 *
 * 职责：验证 mounted Editor 在浏览器环境注入 canvas 文本度量器。
 * 边界：只覆盖 mount 后字体度量切换和 destroy 后新实例回退，不测试输入事件或渲染细节。
 * 协作模块：编辑器挂载运行时、字体管理器、布局运行时和命令构建器。
 * 约束：DOM 只在测试用例内创建，测试结束恢复 HTMLCanvasElement.getContext。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import { describe, expect, it } from 'vitest'

import { buildSetFontFamilyCommand, createEditor } from '../../src/index'
import { createSelectionState } from '../../src/model/selection'

describe('mounted canvas font measurer runtime', () => {
  it('uses a mounted canvas text measurer for browser layout and falls back after destroy', () => {
    const host = document.createElement('div')
    const calls: string[] = []
    const originalGetContext = HTMLCanvasElement.prototype.getContext
    const context = {
      set font(value: string) {
        calls.push(`font:${value}`)
      },
      measureText(text: string) {
        calls.push(`measureText:${text}`)

        return {
          width: text.length * 20,
          actualBoundingBoxAscent: 8,
          actualBoundingBoxDescent: 2
        } as TextMetrics
      }
    }
    const getContext: HTMLCanvasElement['getContext'] = ((contextId: string) =>
      contextId === '2d' ? context : null) as HTMLCanvasElement['getContext']
    const editor = createEditor({ initialText: 'abc' })
    let editorDestroyed = false

    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value: getContext
    })

    try {
      editor.mount(host)
      setFirstRunSelection(editor)

      const command = buildSetFontFamilyCommand(editor.getProjection(), editor.getSelection(), 'Times New Roman')

      if (command === null) {
        throw new Error('字体命令构造失败')
      }

      editor.executeCommand(command)

      const mountedWidth = editor.getLayout().pages[0]?.lines[0]?.fragments[0]?.width

      expect(mountedWidth).toBe(900)
      expect(calls).toContain('font:16px "Times New Roman"')
      expect(calls).toContain('measureText:abc')

      editor.destroy()
      editorDestroyed = true
      expect(createFallbackLayoutWidth()).not.toBe(900)
    } finally {
      if (!editorDestroyed) {
        editor.destroy()
      }
      Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
        configurable: true,
        value: originalGetContext
      })
    }
  })
})

/** 选择默认文档首个 run。 */
function setFirstRunSelection(editor: ReturnType<typeof createEditor>): void {
  const anchor = editor.createTextAnchor({
    sectionId: 'section-1',
    blockId: 'paragraph-1',
    runId: 'run-1',
    graphemeIndex: 0
  })
  const focus = editor.createTextAnchor({
    sectionId: 'section-1',
    blockId: 'paragraph-1',
    runId: 'run-1',
    graphemeIndex: 3
  })

  editor.setSelection(createSelectionState(anchor, focus))
}

/** 读取未挂载新实例的近似度量布局宽度。 */
function createFallbackLayoutWidth(): number | undefined {
  const editor = createEditor({ initialText: 'abc' })

  try {
    return editor.getLayout().pages[0]?.lines[0]?.fragments[0]?.width
  } finally {
    editor.destroy()
  }
}
