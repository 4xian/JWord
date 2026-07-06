/**
 * @vitest-environment jsdom
 *
 * 职责：验证 toolbar controller 在执行工具动作后会把输入焦点还给 editor hidden textarea。
 * 边界：只覆盖 packages/ui 的 controller 与 core facade 的焦点协作，不验证截图级样式或 assistive 文案。
 * 协作：packages/ui/src/toolbar/controller.ts 与 packages/core editor focus/blur API。
 * 约束：断言基于公开 DOM 与 facade，不直接依赖 controller 私有状态。
 */

import { createEditor, createSelectionState } from '@4xian/jword-core'
import { describe, expect, test, vi } from 'vitest'
import type { LiveRegionController } from '../src/assistive/live-region'
import { createToolbarController } from '../src/toolbar/controller'

describe('toolbar controller focus restore', () => {
  test('returns focus to the editor after choosing a custom select option', async () => {
    const editorHost = document.createElement('div')
    const toolbarHost = document.createElement('div')
    const editor = createEditor({ initialText: 'abcdef' })

    document.body.append(editorHost, toolbarHost)

    try {
      editor.mount(editorHost)
      editor.focus()

      const textarea = getHiddenTextarea(editorHost)
      const controller = createToolbarController({
        editor,
        toolbarHost,
        toolbar: {
          visibleTools: ['document.pagePreset']
        },
        assistive: {
          liveRegion: createStubLiveRegion(),
          textMirror: null
        }
      })
      const trigger = toolbarHost.querySelector<HTMLElement>('[data-jword-tool-id="document.pagePreset"] .jw-toolbar__select-trigger')

      trigger?.click()

      const option = toolbarHost.querySelector<HTMLButtonElement>(
        '[data-jword-tool-id="document.pagePreset"] .jw-toolbar__select-option[data-jword-option-value="A3"]'
      )

      expect(option).toBeInstanceOf(HTMLButtonElement)
      option?.focus()
      expect(document.activeElement).toBe(option)

      option?.click()
      await Promise.resolve()

      expect(document.activeElement).toBe(textarea)

      controller.destroy()
    } finally {
      editor.destroy()
      editorHost.remove()
      toolbarHost.remove()
    }
  })

  test('toggles superscript and subscript from toolbar buttons and restores editor focus', async () => {
    const editorHost = document.createElement('div')
    const toolbarHost = document.createElement('div')
    const editor = createEditor({ initialText: 'abc' })

    document.body.append(editorHost, toolbarHost)

    try {
      editor.mount(editorHost)
      editor.focus()
      editor.setSelection(createCollapsedSelection(editor, 1))

      const textarea = getHiddenTextarea(editorHost)
      const controller = createToolbarController({
        editor,
        toolbarHost,
        assistive: {
          liveRegion: createStubLiveRegion(),
          textMirror: null
        }
      })
      const superscript = toolbarHost.querySelector<HTMLButtonElement>('[data-jword-tool-id="format.superscript"]')
      const subscript = toolbarHost.querySelector<HTMLButtonElement>('[data-jword-tool-id="format.subscript"]')

      expect(superscript).toBeInstanceOf(HTMLButtonElement)
      expect(subscript).toBeInstanceOf(HTMLButtonElement)

      superscript?.focus()
      superscript?.click()
      await Promise.resolve()

      expect(document.activeElement).toBe(textarea)
      expect(superscript?.getAttribute('aria-pressed')).toBe('true')
      expect(subscript?.getAttribute('aria-pressed')).toBe('false')
      expect(readFirstParagraphRunProperties(editor)).toBeUndefined()

      subscript?.focus()
      subscript?.click()
      await Promise.resolve()

      expect(document.activeElement).toBe(textarea)
      expect(superscript?.getAttribute('aria-pressed')).toBe('false')
      expect(subscript?.getAttribute('aria-pressed')).toBe('true')
      expect(readFirstParagraphRunProperties(editor)).toBeUndefined()

      controller.destroy()
    } finally {
      editor.destroy()
      editorHost.remove()
      toolbarHost.remove()
    }
  })

  test('keeps color picker selection alive across change and input until editor is clicked', async () => {
    const editorHost = document.createElement('div')
    const toolbarHost = document.createElement('div')
    const editor = createEditor({ initialText: 'abcdef' })

    document.body.append(editorHost, toolbarHost)

    try {
      editor.mount(editorHost)
      editor.focus()
      editor.setSelection(createSelection(editor, 1, 4))

      const controller = createToolbarController({
        editor,
        toolbarHost,
        editorHost,
        assistive: {
          liveRegion: createStubLiveRegion(),
          textMirror: null
        }
      })
      const textColor = toolbarHost.querySelector<HTMLInputElement>('[data-jword-format-text-color]')
      const backgroundColor = toolbarHost.querySelector<HTMLInputElement>('[data-jword-format-background-color]')

      expect(textColor).toBeInstanceOf(HTMLInputElement)
      expect(backgroundColor).toBeInstanceOf(HTMLInputElement)

      if (textColor === null || backgroundColor === null) {
        throw new Error('缺少颜色控件')
      }

      textColor.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
      editor.setSelection(null)
      textColor.value = '#3366ff'
      textColor.dispatchEvent(new Event('change', { bubbles: true }))
      textColor.value = '#ff5500'
      textColor.dispatchEvent(new Event('input', { bubbles: true }))
      editorHost.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true
      }))
      textColor.dispatchEvent(new Event('change', { bubbles: true }))

      expect(editor.getSelectionFormattingState().run?.color.value).toBe('#ff5500')
      expect(textColor.value).toBe('#ff5500')

      backgroundColor.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
      editor.setSelection(null)
      backgroundColor.value = '#99cc00'
      backgroundColor.dispatchEvent(new Event('change', { bubbles: true }))
      backgroundColor.value = '#6633ff'
      backgroundColor.dispatchEvent(new Event('input', { bubbles: true }))
      editorHost.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true
      }))
      backgroundColor.dispatchEvent(new Event('change', { bubbles: true }))

      expect(editor.getSelectionFormattingState().run?.backgroundColor.value).toBe('#6633ff')
      expect(backgroundColor.value).toBe('#6633ff')

      editorHost.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true
      }))
      await Promise.resolve()

      expect(textColor.value).toBe('#ff5500')
      expect(backgroundColor.value).toBe('#6633ff')

      controller.destroy()
    } finally {
      editor.destroy()
      editorHost.remove()
      toolbarHost.remove()
    }
  })


  test('destroy removes toolbar button listeners bound by the controller', () => {
    const editorHost = document.createElement('div')
    const toolbarHost = document.createElement('div')
    const editor = createEditor({ initialText: 'abcdef' })

    document.body.append(editorHost, toolbarHost)

    try {
      editor.mount(editorHost)
      editor.focus()

      const toggleFindReplace = vi.fn()
      const controller = createToolbarController({
        editor,
        toolbarHost,
        toolbar: {
          visibleTools: ['document.pagePreset', 'document.findReplace', 'format.textColor']
        },
        assistive: {
          liveRegion: createStubLiveRegion(),
          textMirror: null
        },
        panelActions: {
          toggleFindReplace
        }
      })
      editor.setSelection(createSelection(editor, 1, 4))

      const findReplace = toolbarHost.querySelector<HTMLButtonElement>('[data-jword-tool-id="document.findReplace"]')
      const pagePreset = toolbarHost.querySelector<HTMLSelectElement>('[data-jword-tool-id="document.pagePreset"] .jw-toolbar__select')
      const textColor = toolbarHost.querySelector<HTMLInputElement>('[data-jword-tool-id="format.textColor"] .jw-toolbar__color')
      const setPageConfigSpy = vi.spyOn(editor, 'setPageConfig')
      const executeCommandSpy = vi.spyOn(editor, 'executeCommand')

      expect(findReplace).toBeInstanceOf(HTMLButtonElement)
      expect(findReplace?.disabled).toBe(false)
      expect(pagePreset).toBeInstanceOf(HTMLSelectElement)
      expect(textColor).toBeInstanceOf(HTMLInputElement)

      controller.destroy()
      findReplace?.click()
      if (pagePreset !== null) {
        pagePreset.value = 'a3'
        pagePreset.dispatchEvent(new Event('change', { bubbles: true }))
      }
      if (textColor !== null) {
        textColor.value = '#3366ff'
        textColor.dispatchEvent(new Event('change', { bubbles: true }))
      }

      expect(toggleFindReplace).not.toHaveBeenCalled()
      expect(setPageConfigSpy).not.toHaveBeenCalled()
      expect(executeCommandSpy).not.toHaveBeenCalled()
    } finally {
      editor.destroy()
      editorHost.remove()
      toolbarHost.remove()
    }
  })
})

function getHiddenTextarea(host: HTMLElement): HTMLTextAreaElement {
  const textarea = host.querySelector('[data-jword-hidden-textarea]')

  if (!(textarea instanceof HTMLTextAreaElement)) {
    throw new Error('hidden textarea 未挂载')
  }

  return textarea
}

function createStubLiveRegion(): LiveRegionController {
  return {
    host: null,
    announce(): void {},
    readMessage(): string {
      return ''
    },
    destroy(): void {}
  }
}

function createCollapsedSelection(editor: ReturnType<typeof createEditor>, graphemeIndex: number) {
  const paragraph = editor.getProjection().document.sections[0]?.blocks[0]
  const runId = paragraph?.kind === 'paragraph' ? paragraph.runs[0]?.id : undefined
  const anchor = editor.createTextAnchor({
    sectionId: 'section-1',
    blockId: paragraph?.id ?? 'paragraph-1',
    runId: runId ?? 'run-1',
    graphemeIndex
  })

  return createSelectionState(anchor, anchor)
}

function createSelection(editor: ReturnType<typeof createEditor>, anchorIndex: number, focusIndex: number) {
  const paragraph = editor.getProjection().document.sections[0]?.blocks[0]
  const runId = paragraph?.kind === 'paragraph' ? paragraph.runs[0]?.id : undefined
  const anchor = editor.createTextAnchor({
    sectionId: 'section-1',
    blockId: paragraph?.id ?? 'paragraph-1',
    runId: runId ?? 'run-1',
    graphemeIndex: anchorIndex
  })
  const focus = editor.createTextAnchor({
    sectionId: 'section-1',
    blockId: paragraph?.id ?? 'paragraph-1',
    runId: runId ?? 'run-1',
    graphemeIndex: focusIndex
  })

  return createSelectionState(anchor, focus)
}

function readFirstParagraphRunProperties(editor: ReturnType<typeof createEditor>) {
  const block = editor.getProjection().document.sections[0]?.blocks[0]

  if (block?.kind !== 'paragraph') {
    return undefined
  }

  return block.runs[0]?.properties
}
