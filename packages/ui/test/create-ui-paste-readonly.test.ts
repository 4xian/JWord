/**
 * @vitest-environment jsdom
 *
 * 职责：验证 Gate 4 富文本粘贴 controller 与全局只读在 createJWordUi 入口的最小装配。
 * 边界：只覆盖 UI 装配到 core facade 的公开链路，不验证 sanitizer 内部细节或真实系统剪贴板。
 * 协作模块：packages/ui/src/create-ui.ts、paste controller、readonly guard 与 @4xian/jword-core。
 * 约束：通过稳定 DOM selector 和 editor projection 断言，不读取 controller 私有状态。
 */

import { createEditor, createSelectionState, type Editor, type Run } from '@4xian/jword-core'
import { describe, expect, test } from 'vitest'

import { createJWordUi } from '../src/create-ui'
import type { JWordReadonlyOptions } from '../src/types'

describe('createJWordUi paste and readonly integration', () => {
  test('会把安全 HTML 粘贴为富文本片段，危险 HTML 保留纯文本降级', () => {
    const harness = createHarness('ab')

    try {
      harness.editor.setSelection(createCollapsedSelection(harness.editor, 1))

      const richPaste = dispatchPaste(harness.editorHost, {
        html: '<p><b><span style="color:#C00000">Word</span></b><script>alert(1)</script></p>',
        text: 'Word'
      })

      expect(richPaste.defaultPrevented).toBe(true)
      expect(readParagraphTexts(harness.editor)).toEqual(['aWordb'])
      expect(readFirstInsertedRunProperties(harness.editor)).toMatchObject({
        bold: true,
        color: '#c00000'
      })
      expect(JSON.stringify(harness.editor.getProjection())).not.toContain('alert')

      const scriptOnlyPaste = dispatchPaste(harness.editorHost, {
        html: '<script>alert(2)</script>',
        text: 'fallback'
      })

      expect(scriptOnlyPaste.defaultPrevented).toBe(true)
      expect(readParagraphTexts(harness.editor)).toEqual(['aWordfallbackb'])
      expect(JSON.stringify(harness.editor.getProjection())).not.toContain('alert')
    } finally {
      harness.destroy()
    }
  })

  test('全局只读会阻断入口级编辑事件且不修改 projection', () => {
    const harness = createHarness('ab', {
      readonly: true
    })

    try {
      const beforeProjection = JSON.stringify(harness.editor.getProjection())
      const textarea = requireTextarea(harness.editorHost, '[data-jword-hidden-textarea]')
      const bold = harness.toolbarHost.querySelector<HTMLButtonElement>('[data-jword-tool-id="format.bold"]')
      const beforeInput = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: 'x'
      })
      const paste = new Event('paste', {
        bubbles: true,
        cancelable: true
      })
      const cut = new Event('cut', {
        bubbles: true,
        cancelable: true
      })
      const contextmenu = new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true
      })

      textarea.dispatchEvent(beforeInput)
      textarea.dispatchEvent(paste)
      textarea.dispatchEvent(cut)
      harness.editorHost.dispatchEvent(contextmenu)

      expect(harness.editorHost.getAttribute('data-jword-readonly')).toBe('true')
      expect(harness.toolbarHost.hidden).toBe(true)
      expect(textarea.readOnly).toBe(true)
      expect(bold?.disabled).toBe(true)
      expect(beforeInput.defaultPrevented).toBe(true)
      expect(paste.defaultPrevented).toBe(true)
      expect(cut.defaultPrevented).toBe(true)
      expect(contextmenu.defaultPrevented).toBe(true)
      expect(JSON.stringify(harness.editor.getProjection())).toBe(beforeProjection)
      expect(readParagraphTexts(harness.editor)).toEqual(['ab'])
    } finally {
      harness.destroy()
    }
  })
})

interface Harness {
  readonly editor: Editor
  readonly editorHost: HTMLElement
  readonly toolbarHost: HTMLElement
  destroy(): void
}

interface HarnessOptions {
  readonly readonly?: boolean | JWordReadonlyOptions
}

/** 创建入口级 UI 测试环境。 */
function createHarness(initialText: string, options: HarnessOptions = {}): Harness {
  const editorHost = document.createElement('div')
  const toolbarHost = document.createElement('div')
  const liveRegionHost = document.createElement('div')
  const editor = createEditor({ initialText })

  document.body.append(editorHost, toolbarHost, liveRegionHost)
  editor.mount(editorHost)
  const ui = createJWordUi({
    editor,
    editorHost,
    toolbarHost,
    liveRegionHost,
    ...(options.readonly === undefined ? {} : { readonly: options.readonly })
  })

  return {
    editor,
    editorHost,
    toolbarHost,
    destroy(): void {
      ui.destroy()
      editor.destroy()
      editorHost.remove()
      toolbarHost.remove()
      liveRegionHost.remove()
    }
  }
}

/** 分发带 clipboardData 的 paste 事件。 */
function dispatchPaste(
  editorHost: HTMLElement,
  input: Readonly<{ html: string, text: string }>
): Event {
  const textarea = requireTextarea(editorHost, '[data-jword-hidden-textarea]')
  const event = new Event('paste', {
    bubbles: true,
    cancelable: true
  })

  Object.defineProperty(event, 'clipboardData', {
    value: {
      getData(type: string): string {
        if (type === 'text/html') {
          return input.html
        }

        if (type === 'text/plain') {
          return input.text
        }

        return ''
      }
    }
  })

  textarea.dispatchEvent(event)

  return event
}

/** 创建同一 run 内的折叠选区。 */
function createCollapsedSelection(editor: Editor, graphemeIndex: number) {
  const anchor = editor.createTextAnchor({
    sectionId: 'section-1',
    blockId: 'paragraph-1',
    runId: 'run-1',
    graphemeIndex
  })

  return createSelectionState(anchor, anchor)
}

/** 读取所有段落纯文本。 */
function readParagraphTexts(editor: Editor): readonly string[] {
  return editor.getProjection().document.sections.flatMap((section) =>
    section.blocks.flatMap((block) => block.kind === 'paragraph'
      ? [block.runs.map(readRunText).join('')]
      : [])
  )
}

/** 读取第一段中插入 run 的属性。 */
function readFirstInsertedRunProperties(editor: Editor): unknown {
  const block = editor.getProjection().document.sections[0]?.blocks[0]

  if (block?.kind !== 'paragraph') {
    return undefined
  }

  return block.runs.find((run) => readRunText(run) === 'Word')?.properties
}

/** 读取 run 内可见文本。 */
function readRunText(run: Run): string {
  return run.inlines.map((inline) => {
    if (inline.kind === 'text') {
      return inline.text
    }

    if (inline.kind === 'break') {
      return '\n'
    }

    if (inline.kind === 'image') {
      return '[image]'
    }

    return ''
  }).join('')
}

/** 读取必需文本域。 */
function requireTextarea(host: HTMLElement, selector: string): HTMLTextAreaElement {
  const element = host.querySelector(selector)

  if (!(element instanceof HTMLTextAreaElement)) {
    throw new Error(`缺少测试文本域：${selector}`)
  }

  return element
}
