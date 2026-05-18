/**
 * @vitest-environment jsdom
 *
 * 职责：验证 toolbar controller 在执行工具动作后会把输入焦点还给 editor hidden textarea。
 * 边界：只覆盖 packages/ui 的 controller 与 core facade 的焦点协作，不验证截图级样式或 assistive 文案。
 * 协作：packages/ui/src/toolbar/controller.ts 与 packages/core editor focus/blur API。
 * 约束：断言基于公开 DOM 与 facade，不直接依赖 controller 私有状态。
 */

import { createEditor, createSelectionState } from '@4xian/jword-core'
import { describe, expect, test } from 'vitest'
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
      expect(toolbarHost.querySelector('[data-jword-run-summary]')?.textContent).toContain('上标 开')
      expect(readFirstParagraphRunProperties(editor)).toBeUndefined()

      subscript?.focus()
      subscript?.click()
      await Promise.resolve()

      expect(document.activeElement).toBe(textarea)
      expect(superscript?.getAttribute('aria-pressed')).toBe('false')
      expect(subscript?.getAttribute('aria-pressed')).toBe('true')
      expect(toolbarHost.querySelector('[data-jword-run-summary]')?.textContent).toContain('下标 开')
      expect(readFirstParagraphRunProperties(editor)).toBeUndefined()

      controller.destroy()
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

function readFirstParagraphRunProperties(editor: ReturnType<typeof createEditor>) {
  const block = editor.getProjection().document.sections[0]?.blocks[0]

  if (block?.kind !== 'paragraph') {
    return undefined
  }

  return block.runs[0]?.properties
}
