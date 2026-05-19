/**
 * @vitest-environment jsdom
 *
 * 职责：验证 Gate 4 选区浮动工具栏、右键菜单、快捷键和清除格式动作的最小闭环。
 * 边界：只覆盖 packages/ui 与 core facade 的公开协作，不验证截图级样式、图片模块或浏览器原生剪贴板权限。
 * 协作：packages/ui/src/create-ui.ts、selection-actions 子模块与 @4xian/jword-core Editor facade。
 * 约束：断言基于公开 DOM selector、selection formatting state 和 projection，不读取 controller 私有状态。
 */

import { createEditor, createSelectionState } from '@4xian/jword-core'
import { describe, expect, test } from 'vitest'

import { createJWordUi } from '../src/create-ui'

describe('selection actions controller', () => {
  test('shows floating toolbar only for focused non-collapsed selection and hides on blur', async () => {
    const harness = createHarness('abcdef')

    try {
      const floatingToolbar = getRequiredElement(harness.editorHost, '[data-jword-floating-toolbar="true"]')

      dispatchFocus(harness.textarea)
      harness.editor.setSelection(createSelection(harness.editor, 1, 1))

      expect(floatingToolbar.hidden).toBe(true)

      harness.editor.setSelection(createSelection(harness.editor, 1, 4))

      expect(floatingToolbar.hidden).toBe(false)

      dispatchBlur(harness.textarea)
      await Promise.resolve()

      expect(floatingToolbar.hidden).toBe(true)
    } finally {
      harness.destroy()
    }
  })

  test('rebinds the context menu to the latest stable selection and hides it on blur', async () => {
    const harness = createHarness('abcdef')

    try {
      const contextMenu = getRequiredElement(harness.editorHost, '[data-jword-context-menu="true"]')

      dispatchFocus(harness.textarea)
      harness.editor.setSelection(createSelection(harness.editor, 0, 2))
      dispatchContextMenu(harness.editorHost, 48, 72)

      expect(contextMenu.hidden).toBe(false)

      const firstSelectionKey = contextMenu.getAttribute('data-jword-selection-key')

      expect(firstSelectionKey).toBeTruthy()

      harness.editor.setSelection(createSelection(harness.editor, 2, 5))
      dispatchContextMenu(harness.editorHost, 80, 96)

      expect(contextMenu.hidden).toBe(false)
      expect(contextMenu.getAttribute('data-jword-selection-key')).not.toBe(firstSelectionKey)

      dispatchBlur(harness.textarea)
      await Promise.resolve()

      expect(contextMenu.hidden).toBe(true)
    } finally {
      harness.destroy()
    }
  })

  test('handles Ctrl or Meta + U and Escape through the editor hidden textarea', async () => {
    const harness = createHarness('abcdef')

    try {
      const floatingToolbar = getRequiredElement(harness.editorHost, '[data-jword-floating-toolbar="true"]')
      const underlineButton = getRequiredElement(
        harness.editorHost,
        '[data-jword-selection-action="format.underline"]'
      )

      dispatchFocus(harness.textarea)
      harness.editor.setSelection(createSelection(harness.editor, 1, 4))

      expect(floatingToolbar.hidden).toBe(false)

      harness.textarea.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        key: 'u'
      }))

      expect(underlineButton.getAttribute('aria-pressed')).toBe('true')
      expect(harness.editor.getSelectionFormattingState().run?.underline.value).toBe(true)

      harness.textarea.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'Escape'
      }))

      await Promise.resolve()
      expect(floatingToolbar.hidden).toBe(true)
    } finally {
      harness.destroy()
    }
  })

  test('clears current run formatting from the context menu using the stable selection snapshot', async () => {
    const harness = createHarness('abcdef')

    try {
      dispatchFocus(harness.textarea)
      harness.editor.setSelection(createSelection(harness.editor, 0, 6))
      harness.editor.toggleBold()
      harness.editor.toggleUnderline()

      dispatchContextMenu(harness.editorHost, 64, 88)
      harness.editor.setSelection(createSelection(harness.editor, 1, 1))

      const clearButton = getRequiredElement(
        harness.editorHost,
        '[data-jword-context-action="format.clear"]'
      ) as HTMLButtonElement

      clearButton.click()

      const formattingState = harness.editor.getSelectionFormattingState()

      expect(formattingState.run?.bold.value).toBe(false)
      expect(formattingState.run?.underline.value).toBe(false)
    } finally {
      harness.destroy()
    }
  })
})

interface Harness {
  readonly editor: ReturnType<typeof createEditor>
  readonly editorHost: HTMLDivElement
  readonly toolbarHost: HTMLDivElement
  readonly textarea: HTMLTextAreaElement
  destroy(): void
}

/** 创建挂载了 editor 与 UI 的最小测试环境。 */
function createHarness(initialText: string): Harness {
  const editorHost = document.createElement('div')
  const toolbarHost = document.createElement('div')
  const statusHost = document.createElement('div')
  const editor = createEditor({ initialText })

  editorHost.style.position = 'relative'
  editorHost.style.width = '900px'
  editorHost.style.height = '640px'
  toolbarHost.style.width = '900px'

  document.body.append(toolbarHost, editorHost, statusHost)
  editor.mount(editorHost)
  const ui = createJWordUi({
    editor,
    editorHost,
    toolbarHost,
    liveRegionHost: statusHost
  })
  const textarea = getHiddenTextarea(editorHost)

  return {
    editor,
    editorHost,
    toolbarHost,
    textarea,
    destroy(): void {
      ui.destroy()
      editor.destroy()
      toolbarHost.remove()
      editorHost.remove()
      statusHost.remove()
    }
  }
}

/** 读取 editor 当前隐藏输入框。 */
function getHiddenTextarea(host: HTMLElement): HTMLTextAreaElement {
  const textarea = host.querySelector('[data-jword-hidden-textarea]')

  if (!(textarea instanceof HTMLTextAreaElement)) {
    throw new Error('hidden textarea 未挂载')
  }

  return textarea
}

/** 通过公开 anchor API 构造同一 run 上的测试选区。 */
function createSelection(editor: ReturnType<typeof createEditor>, anchorIndex: number, focusIndex: number) {
  const anchor = editor.createTextAnchor({
    sectionId: 'section-1',
    blockId: 'paragraph-1',
    runId: 'run-1',
    graphemeIndex: anchorIndex
  })
  const focus = editor.createTextAnchor({
    sectionId: 'section-1',
    blockId: 'paragraph-1',
    runId: 'run-1',
    graphemeIndex: focusIndex
  })

  return createSelectionState(anchor, focus)
}

/** 触发 editor hidden textarea 的聚焦态。 */
function dispatchFocus(textarea: HTMLTextAreaElement): void {
  textarea.focus()
}

/** 触发 editor hidden textarea 的失焦态。 */
function dispatchBlur(textarea: HTMLTextAreaElement): void {
  textarea.blur()
}

/** 触发 editor 区域内的右键菜单事件。 */
function dispatchContextMenu(host: HTMLElement, clientX: number, clientY: number): void {
  host.dispatchEvent(new MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    clientX,
    clientY
  }))
}

/** 保证 selector 对应节点真实存在。 */
function getRequiredElement(host: HTMLElement, selector: string): HTMLElement {
  const element = host.querySelector<HTMLElement>(selector)

  if (element === null) {
    throw new Error(`缺少节点: ${selector}`)
  }

  return element
}
