/**
 * @vitest-environment jsdom
 *
 * 职责：验证 Gate 4 查找替换面板在 createJWordUi 官方入口的最小装配。
 * 边界：只覆盖公开 UI option、返回句柄、transaction 接线和只读 overlay 挂载，不测试 canvas 绘制细节。
 * 协作模块：packages/ui/src/create-ui.ts、find-replace controller 与 @4xian/jword-core。
 * 约束：通过公开 elements 和稳定 data selector 断言，不读取 controller 私有状态。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md Step 4.12。
 */

import { createEditor, type Editor } from '@4xian/jword-core'
import { describe, expect, test } from 'vitest'

import { createJWordUi } from '../src/create-ui'

describe('createJWordUi find replace integration', () => {
  test('启用 findReplace option 后会返回面板句柄并通过 transaction 替换全部匹配', () => {
    const harness = createHarness()

    try {
      expect(harness.ui.elements.findReplacePanel).not.toBeNull()
      expect(harness.toolbarHost.querySelector('[data-jword-find-replace]')).not.toBeNull()
      expect([
        harness.ui.elements.findReplacePanel!.findButton,
        harness.ui.elements.findReplacePanel!.previousButton,
        harness.ui.elements.findReplacePanel!.nextButton,
        harness.ui.elements.findReplacePanel!.replaceButton,
        harness.ui.elements.findReplacePanel!.replaceAllButton
      ].every((button) => button.parentElement?.matches('[data-jword-find-actions]'))).toBe(true)

      fillInput(harness.ui.elements.findReplacePanel!.queryInput, 'alpha')
      fillInput(harness.ui.elements.findReplacePanel!.replacementInput, 'A')
      harness.ui.elements.findReplacePanel!.findButton.click()

      expect(harness.ui.elements.findReplacePanel!.status.textContent).toBe('1 / 2')

      harness.ui.elements.findReplacePanel!.replaceAllButton.click()

      expect(readDocumentText(harness.editor)).toBe('A beta A')
      expect(harness.ui.elements.findReplacePanel!.status.hidden).toBe(true)
      expect(harness.ui.elements.findReplacePanel!.status.textContent).toBe('')

      harness.ui.destroy()

      expect(harness.toolbarHost.querySelector('[data-jword-find-replace]')).toBeNull()
    } finally {
      harness.destroy()
    }
  })

  test('点击工具栏查找替换按钮会打开面板并在外部点击后关闭', () => {
    const harness = createHarness()
    const outsideTarget = document.createElement('button')

    try {
      const openButton = harness.toolbarHost.querySelector<HTMLButtonElement>('[data-jword-open-find-replace]')

      document.body.append(outsideTarget)

      expect(openButton).not.toBeNull()
      expect(harness.ui.elements.findReplacePanel!.root.hidden).toBe(true)

      openButton?.click()

      expect(harness.ui.elements.findReplacePanel!.root.hidden).toBe(false)

      outsideTarget.click()

      expect(harness.ui.elements.findReplacePanel!.root.hidden).toBe(true)
    } finally {
      outsideTarget.remove()
      harness.destroy()
    }
  })

  test('关闭查找替换面板会清空查询记录和表单草稿', () => {
    const harness = createHarness()

    try {
      const openButton = harness.toolbarHost.querySelector<HTMLButtonElement>('[data-jword-open-find-replace]')

      openButton?.click()
      fillInput(harness.ui.elements.findReplacePanel!.queryInput, 'alpha')
      fillInput(harness.ui.elements.findReplacePanel!.replacementInput, 'A')
      harness.ui.elements.findReplacePanel!.findButton.click()

      expect(harness.ui.elements.findReplacePanel!.status.textContent).toBe('1 / 2')

      harness.ui.elements.findReplacePanel!.closeButton.click()

      expect(harness.ui.elements.findReplacePanel!.root.hidden).toBe(true)
      expect(harness.ui.elements.findReplacePanel!.queryInput.value).toBe('')
      expect(harness.ui.elements.findReplacePanel!.replacementInput.value).toBe('')
      expect(harness.ui.elements.findReplacePanel!.status.hidden).toBe(true)
      expect(harness.ui.elements.findReplacePanel!.status.textContent).toBe('')
      expect(harness.ui.elements.findReplacePanel!.findButton.disabled).toBe(true)
      expect(harness.ui.elements.findReplacePanel!.previousButton.disabled).toBe(true)
    } finally {
      harness.destroy()
    }
  })

  test('查找后会通过 createJWordUi 在编辑器宿主内渲染只读 overlay', () => {
    const harness = createHarness()

    try {
      const openButton = harness.toolbarHost.querySelector<HTMLButtonElement>('[data-jword-open-find-replace]')

      openButton?.click()
      fillInput(harness.ui.elements.findReplacePanel!.queryInput, 'alpha')
      harness.ui.elements.findReplacePanel!.findButton.click()

      expect(readFindOverlayRects(harness.editorHost)).toHaveLength(2)
      expect(readActiveOverlayIndexes(harness.editorHost)).toEqual(['0'])

      harness.ui.elements.findReplacePanel!.nextButton.click()

      expect(readFindOverlayRects(harness.editorHost)).toHaveLength(2)
      expect(readActiveOverlayIndexes(harness.editorHost)).toEqual(['1'])
    } finally {
      harness.destroy()
    }
  })

  test('外部点击和工具栏再次关闭都会清空查找替换草稿', () => {
    const harness = createHarness()
    const outsideTarget = document.createElement('button')

    try {
      const openButton = harness.toolbarHost.querySelector<HTMLButtonElement>('[data-jword-open-find-replace]')

      document.body.append(outsideTarget)
      openButton?.click()
      fillInput(harness.ui.elements.findReplacePanel!.queryInput, 'alpha')
      fillInput(harness.ui.elements.findReplacePanel!.replacementInput, 'A')
      harness.ui.elements.findReplacePanel!.findButton.click()

      outsideTarget.click()

      expect(harness.ui.elements.findReplacePanel!.root.hidden).toBe(true)
      expect(harness.ui.elements.findReplacePanel!.queryInput.value).toBe('')
      expect(harness.ui.elements.findReplacePanel!.replacementInput.value).toBe('')
      expect(harness.ui.elements.findReplacePanel!.status.hidden).toBe(true)
      expect(harness.ui.elements.findReplacePanel!.status.textContent).toBe('')

      openButton?.click()
      fillInput(harness.ui.elements.findReplacePanel!.queryInput, 'alpha')
      fillInput(harness.ui.elements.findReplacePanel!.replacementInput, 'B')
      harness.ui.elements.findReplacePanel!.findButton.click()

      openButton?.click()

      expect(harness.ui.elements.findReplacePanel!.root.hidden).toBe(true)
      expect(harness.ui.elements.findReplacePanel!.queryInput.value).toBe('')
      expect(harness.ui.elements.findReplacePanel!.replacementInput.value).toBe('')
      expect(harness.ui.elements.findReplacePanel!.status.hidden).toBe(true)
      expect(harness.ui.elements.findReplacePanel!.status.textContent).toBe('')
    } finally {
      outsideTarget.remove()
      harness.destroy()
    }
  })
})

interface Harness {
  readonly editor: Editor
  readonly editorHost: HTMLElement
  readonly toolbarHost: HTMLElement
  readonly findReplaceHost: HTMLElement
  readonly ui: ReturnType<typeof createJWordUi>
  destroy(): void
}

/** 创建入口级 UI 测试环境。 */
function createHarness(): Harness {
  const editorHost = document.createElement('div')
  const toolbarHost = document.createElement('div')
  const liveRegionHost = document.createElement('div')
  const findReplaceHost = document.createElement('div')
  const editor = createEditor({ initialText: 'alpha beta alpha' })

  document.body.append(editorHost, toolbarHost, liveRegionHost, findReplaceHost)
  editor.mount(editorHost)
  const ui = createJWordUi({
    editor,
    editorHost,
    toolbarHost,
    liveRegionHost,
    findReplace: {
      host: findReplaceHost
    }
  })

  return {
    editor,
    editorHost,
    toolbarHost,
    findReplaceHost,
    ui,
    destroy(): void {
      editor.destroy()
      editorHost.remove()
      toolbarHost.remove()
      liveRegionHost.remove()
      findReplaceHost.remove()
    }
  }
}

/** 读取测试文档第一节的段落纯文本。 */
function readDocumentText(editor: Editor): string {
  const blocks = editor.getProjection().document.sections[0]?.blocks ?? []

  return blocks
    .flatMap((block) => block.kind === 'paragraph'
      ? [block.runs.flatMap((run) => run.inlines.flatMap((inline) => inline.kind === 'text' ? [inline.text] : [])).join('')]
      : [])
    .join('\n\n')
}

/** 按真实输入事件路径更新测试输入框。 */
function fillInput(input: HTMLInputElement, value: string): void {
  input.value = value
  input.dispatchEvent(new Event('input', {
    bubbles: true
  }))
}

/** 读取入口挂载后的查找 overlay 矩形。 */
function readFindOverlayRects(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('[data-jword-find-match-index]'))
}

/** 读取入口挂载后的 active 查找 overlay 索引。 */
function readActiveOverlayIndexes(root: HTMLElement): string[] {
  return readFindOverlayRects(root)
    .filter((rect) => rect.getAttribute('data-jword-find-active') === 'true')
    .map((rect) => rect.getAttribute('data-jword-find-match-index') ?? '')
}
