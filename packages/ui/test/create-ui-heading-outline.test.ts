/**
 * @vitest-environment jsdom
 *
 * 职责：验证 Gate 4 目录面板在 createJWordUi 官方入口的最小装配。
 * 边界：只覆盖公开 UI option、返回句柄和目录项点击定位，不测试滚动动画。
 * 协作模块：packages/ui/src/create-ui.ts、heading controller 与 @4xian/jword-core。
 * 约束：通过公开 elements 和稳定 data selector 断言，不读取 controller 私有状态。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md Step 4.11。
 */

import { createEditor, createSelectionState, twipsToCssPx, type Editor } from '@4xian/jword-core'
import { describe, expect, test } from 'vitest'

import { createJWordUi } from '../src/create-ui'

describe('createJWordUi heading outline integration', () => {
  test('启用 headingOutline option 后会返回目录句柄并点击定位到 heading anchor', () => {
    const harness = createHarness()

    try {
      setParagraphStyle(harness.editor, 0, 'Heading1')
      setParagraphStyle(harness.editor, 2, 'Heading2')
      harness.ui.refresh()

      expect(harness.ui.elements.headingOutlinePanel).not.toBeNull()
      expect(harness.outlineHost.querySelector('[data-jword-heading-outline]')).not.toBeNull()
      expect(harness.editorHost.querySelector('[data-jword-editor] [data-jword-heading-outline-host]')).toBe(harness.outlineHost)
      expect(harness.toolbarHost.querySelector('[data-jword-heading-outline]')).toBeNull()
      expect(harness.ui.elements.headingOutlinePanel!.list.getAttribute('role')).toBe('tree')

      const secondRow = harness.outlineHost.querySelector<HTMLElement>(
        '[data-jword-heading-outline-item="paragraph-3:heading"]'
      )
      const secondButton = secondRow?.querySelector<HTMLButtonElement>('[data-jword-heading-outline-activate]')

      expect(secondButton?.textContent).toBe('第二章')
      expect(secondRow?.getAttribute('role')).toBe('treeitem')

      secondButton?.click()

      const selection = harness.editor.getSelection()

      expect(selection).not.toBeNull()
      expect(harness.editor.resolveTextPosition(selection!.anchor).blockId).toBe('paragraph-3')

      harness.ui.destroy()

      expect(harness.outlineHost.querySelector('[data-jword-heading-outline]')).toBeNull()
      expect(harness.editorHost.querySelector('[data-jword-heading-outline-host]')).toBeNull()
    } finally {
      harness.destroy()
    }
  })

  test('toolbar 宿主启用目录时会在 jw-editor 内创建左侧侧栏宿主', () => {
    const harness = createHarness({ useToolbarAsHeadingHost: true })

    try {
      setParagraphStyle(harness.editor, 0, 'Heading1')
      harness.ui.refresh()

      const outlineButton = harness.toolbarHost.querySelector<HTMLButtonElement>('[data-jword-toggle-heading-outline]')
      const outlineHost = harness.editorHost.querySelector<HTMLElement>(
        '[data-jword-editor] [data-jword-heading-outline-host]'
      )

      expect(outlineHost).not.toBeNull()
      expect(harness.toolbarHost.querySelector('[data-jword-heading-outline]')).toBeNull()
      expect(harness.ui.elements.headingOutlinePanel?.list.hidden).toBe(true)
      expect(outlineButton?.disabled).toBe(false)
      expect(outlineButton?.getAttribute('aria-pressed')).toBe('false')

      outlineButton?.click()

      expect(harness.ui.elements.headingOutlinePanel?.list.hidden).toBe(false)
      expect(outlineButton?.getAttribute('aria-pressed')).toBe('true')
      expect(outlineHost?.querySelector('[data-jword-heading-outline-sidebar]')).not.toBeNull()

      outlineButton?.click()

      expect(harness.ui.elements.headingOutlinePanel?.list.hidden).toBe(true)
      expect(outlineButton?.getAttribute('aria-pressed')).toBe('false')
    } finally {
      harness.destroy()
    }
  })

  test('没有目录项时 toolbar 目录按钮禁用且不会打开侧栏', () => {
    const harness = createHarness({ useToolbarAsHeadingHost: true })

    try {
      harness.ui.refresh()

      const outlineButton = harness.toolbarHost.querySelector<HTMLButtonElement>('[data-jword-toggle-heading-outline]')

      expect(outlineButton).not.toBeNull()
      expect(outlineButton?.disabled).toBe(true)
      expect(harness.ui.elements.headingOutlinePanel?.list.hidden).toBe(true)
      expect(harness.ui.elements.headingOutlinePanel?.list.children).toHaveLength(0)

      outlineButton?.click()

      expect(harness.ui.elements.headingOutlinePanel?.list.hidden).toBe(true)
      expect(outlineButton?.getAttribute('aria-pressed')).toBe('false')

      setParagraphStyle(harness.editor, 0, 'Heading1')
      harness.ui.refresh()

      expect(outlineButton?.disabled).toBe(false)
      expect(harness.ui.elements.headingOutlinePanel?.list.children.length).toBeGreaterThan(0)
    } finally {
      harness.destroy()
    }
  })

  test('全局只读允许导航时目录按钮保持可用并只做定位', () => {
    const harness = createHarness({
      useToolbarAsHeadingHost: true,
      readonly: true
    })

    try {
      setParagraphStyle(harness.editor, 0, 'Heading1')
      harness.ui.refresh()

      const beforeProjection = JSON.stringify(harness.editor.getProjection())
      const outlineButton = harness.toolbarHost.querySelector<HTMLButtonElement>('[data-jword-toggle-heading-outline]')

      expect(outlineButton).not.toBeNull()
      expect(outlineButton?.disabled).toBe(false)

      outlineButton?.click()

      expect(harness.ui.elements.headingOutlinePanel?.list.hidden).toBe(false)

      const firstButton = harness.editorHost.querySelector<HTMLButtonElement>(
        '[data-jword-heading-outline-item="paragraph-1:heading"] [data-jword-heading-outline-activate]'
      )

      firstButton?.click()

      expect(harness.editor.getSelection()).not.toBeNull()
      expect(JSON.stringify(harness.editor.getProjection())).toBe(beforeProjection)
    } finally {
      harness.destroy()
    }
  })

  test('全局只读允许导航但没有目录项时目录按钮仍保持禁用', () => {
    const harness = createHarness({
      useToolbarAsHeadingHost: true,
      readonly: true
    })

    try {
      harness.ui.refresh()

      const outlineButton = harness.toolbarHost.querySelector<HTMLButtonElement>('[data-jword-toggle-heading-outline]')

      expect(outlineButton).not.toBeNull()
      expect(outlineButton?.disabled).toBe(true)
      expect(harness.ui.elements.headingOutlinePanel?.list.hidden).toBe(true)
      expect(harness.ui.elements.headingOutlinePanel?.list.children).toHaveLength(0)
    } finally {
      harness.destroy()
    }
  })

  test('点击目录项会滚动 editor canvas 到对应位置', () => {
    const harness = createHarness()

    try {
      setParagraphStyle(harness.editor, 0, 'Heading1')
      setParagraphStyle(harness.editor, 2, 'Heading2')
      harness.ui.refresh()

      const canvasContainer = harness.editorHost.querySelector<HTMLElement>('[data-jword-canvas-container]')
      const secondButton = harness.outlineHost.querySelector<HTMLButtonElement>(
        '[data-jword-heading-outline-item="paragraph-3:heading"] [data-jword-heading-outline-activate]'
      )

      expect(canvasContainer).not.toBeNull()
      expect(secondButton).not.toBeNull()

      if (canvasContainer !== null) {
        Object.defineProperty(canvasContainer, 'clientHeight', {
          configurable: true,
          value: 10
        })
        canvasContainer.scrollTo = (options?: ScrollToOptions | number) => {
          canvasContainer.scrollTop = typeof options === 'number' ? options : options?.top ?? 0
        }
      }

      const pages = canvasContainer?.querySelectorAll<HTMLElement>('[data-jword-page]') ?? []

      for (const page of pages) {
        Object.defineProperty(page, 'offsetTop', {
          configurable: true,
          value: 100
        })
      }

      secondButton?.click()

      expect(canvasContainer?.scrollTop).toBeGreaterThan(0)
    } finally {
      harness.destroy()
    }
  })

  test('正文滚动后目录会高亮当前标题', () => {
    const harness = createHarness()

    try {
      setParagraphStyle(harness.editor, 0, 'Heading1')
      setParagraphStyle(harness.editor, 2, 'Heading2')
      harness.ui.refresh()

      const outlineButton = harness.toolbarHost.querySelector<HTMLButtonElement>('[data-jword-toggle-heading-outline]')
      const canvasContainer = harness.editorHost.querySelector<HTMLElement>('[data-jword-canvas-container]')

      expect(outlineButton).not.toBeNull()
      expect(canvasContainer).not.toBeNull()

      outlineButton?.click()
      expect(harness.ui.elements.headingOutlinePanel!.list.hidden).toBe(false)

      const outsideTarget = document.createElement('button')

      document.body.append(outsideTarget)
      outsideTarget.click()

      expect(harness.ui.elements.headingOutlinePanel!.list.hidden).toBe(false)

      outsideTarget.remove()

      canvasContainer!.scrollTop = readHeadingScrollTop(harness.editor, 'paragraph-3', 'run-3')
      canvasContainer!.dispatchEvent(new Event('scroll'))

      const secondButton = harness.outlineHost.querySelector<HTMLButtonElement>(
        '[data-jword-heading-outline-item="paragraph-3:heading"]'
      )

      expect(secondButton?.getAttribute('aria-current')).toBe('true')
    } finally {
      harness.destroy()
    }
  })
})

interface Harness {
  readonly editor: Editor
  readonly editorHost: HTMLElement
  readonly toolbarHost: HTMLElement
  readonly outlineHost: HTMLElement
  readonly ui: ReturnType<typeof createJWordUi>
  destroy(): void
}

/** 创建入口级 UI 测试环境。 */
function createHarness(options: { readonly useToolbarAsHeadingHost?: boolean, readonly readonly?: boolean } = {}): Harness {
  const editorHost = document.createElement('div')
  const toolbarHost = document.createElement('div')
  const liveRegionHost = document.createElement('div')
  const outlineHost = document.createElement('div')
  const editor = createEditor({
    initialText: '第一章\n\n正文\n\n第二章'
  })

  document.body.append(editorHost, toolbarHost, liveRegionHost, outlineHost)
  editor.mount(editorHost)
  const ui = createJWordUi({
    editor,
    editorHost,
    toolbarHost,
    liveRegionHost,
    ...(options.readonly === undefined ? {} : { readonly: options.readonly }),
    headingOutline: {
      host: options.useToolbarAsHeadingHost === true ? toolbarHost : outlineHost
    }
  })

  return {
    editor,
    editorHost,
    toolbarHost,
    outlineHost,
    ui,
    destroy(): void {
      editor.destroy()
      editorHost.remove()
      toolbarHost.remove()
      liveRegionHost.remove()
      outlineHost.remove()
    }
  }
}

/** 给测试段落设置标题样式。 */
function setParagraphStyle(editor: Editor, paragraphIndex: number, styleId: string): void {
  const paragraph = editor.getProjection().document.sections[0]?.blocks[paragraphIndex]

  if (paragraph?.kind !== 'paragraph') {
    throw new Error('missing paragraph')
  }

  const run = paragraph.runs[0]

  if (run === undefined) {
    throw new Error('missing run')
  }

  const anchor = editor.createTextAnchor({
    sectionId: 'section-1',
    blockId: paragraph.id,
    runId: run.id,
    graphemeIndex: 0
  })

  editor.setSelection(createSelectionState(anchor, anchor))
  editor.setParagraphStyle(styleId)
}

/** 读取指定段落锚点在当前布局中的滚动顶部。 */
function readHeadingScrollTop(editor: Editor, blockId: string, runId: string): number {
  const anchor = editor.createTextAnchor({
    sectionId: 'section-1',
    blockId,
    runId,
    graphemeIndex: 0
  })
  const rect = editor.getCaretRect(anchor)
  const page = rect === undefined ? undefined : editor.getLayout().pages[rect.pageIndex]

  if (rect === undefined || page === undefined) {
    throw new Error('missing heading rect')
  }

  return twipsToCssPx(rect.y - page.y, editor.getPageConfig().scale)
}
