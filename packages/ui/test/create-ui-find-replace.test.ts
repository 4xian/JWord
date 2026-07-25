/**
 * @vitest-environment jsdom
 *
 * 职责：验证 Gate 4 查找替换面板在 createJWordUi 官方入口的最小装配。
 * 边界：只覆盖公开 UI option、返回句柄、transaction 接线和只读 overlay 挂载，不测试 canvas 绘制细节。
 * 协作模块：packages/ui/src/create-ui.ts、find-replace controller 与 @4xian/jword-core。
 * 约束：通过公开 elements 和稳定 data selector 断言，不读取 controller 私有状态。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import { createEditor, createSelectionState, type Editor } from '@4xian/jword-core'
import { describe, expect, test } from 'vitest'

import { createJWordUi } from '../src/create-ui'

describe('createJWordUi find replace integration', () => {
  test('启用 findReplace option 后会返回面板句柄并通过 transaction 替换全部匹配', () => {
    const harness = createHarness()

    try {
      expect(harness.ui.elements.findReplacePanel).not.toBeNull()
      expect(harness.findReplaceHost.querySelector('[data-jword-find-replace]')).not.toBeNull()
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

      expect(harness.findReplaceHost.querySelector('[data-jword-find-replace]')).toBeNull()
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
      if (openButton === null) {
        throw new Error('查找替换 toolbar 按钮未挂载。')
      }

      stubBoundingRect(openButton, 124, 20, 28, 28)
      expect(harness.ui.elements.findReplacePanel!.root.hidden).toBe(true)

      openButton.click()

      expect(harness.ui.elements.findReplacePanel!.root.hidden).toBe(false)
      expect(harness.ui.elements.findReplacePanel!.root.getAttribute('data-jword-anchored')).toBe('true')
      expect(harness.ui.elements.findReplacePanel!.root.style.getPropertyValue('--jw-find-replace-left')).toBe('124px')
      expect(harness.ui.elements.findReplacePanel!.root.style.getPropertyValue('--jw-find-replace-top')).toBe('56px')

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

  test('全局只读下允许查找定位但禁用替换动作', () => {
    const harness = createHarness({
      readonly: true
    })

    try {
      const openButton = harness.toolbarHost.querySelector<HTMLButtonElement>('[data-jword-open-find-replace]')

      expect(openButton?.disabled).toBe(false)

      openButton?.click()
      fillInput(harness.ui.elements.findReplacePanel!.queryInput, 'alpha')
      fillInput(harness.ui.elements.findReplacePanel!.replacementInput, 'A')
      harness.ui.elements.findReplacePanel!.findButton.click()

      expect(harness.ui.elements.findReplacePanel!.status.textContent).toBe('1 / 2')
      expect(harness.ui.elements.findReplacePanel!.replaceButton.disabled).toBe(true)
      expect(harness.ui.elements.findReplacePanel!.replaceAllButton.disabled).toBe(true)
      expect(readDocumentText(harness.editor)).toBe('alpha beta alpha')
    } finally {
      harness.destroy()
    }
  })

  test('可配置大小写不敏感搜索以匹配格式拆分后的跨 run 文本', () => {
    const harness = createHarness({
      initialText: 'AlphaBeta',
      caseSensitive: false
    })

    try {
      applyBoldRange(harness.editor, 3, 8)

      harness.toolbarHost.querySelector<HTMLButtonElement>('[data-jword-open-find-replace]')?.click()
      fillInput(harness.ui.elements.findReplacePanel!.queryInput, 'alphabeta')
      harness.ui.elements.findReplacePanel!.findButton.click()

      expect(readDocumentRunTexts(harness.editor)).toEqual(['Alp', 'haBet', 'a'])
      expect(harness.ui.elements.findReplacePanel!.status.textContent).toBe('1 / 1')
      expect(readActiveOverlayIndexes(harness.editorHost)).toEqual(['0'])

      fillInput(harness.ui.elements.findReplacePanel!.replacementInput, 'X')
      harness.ui.elements.findReplacePanel!.replaceAllButton.click()

      expect(readDocumentText(harness.editor)).toBe('X')
    } finally {
      harness.destroy()
    }
  })

  test('默认保留大小写敏感搜索', () => {
    const harness = createHarness({
      initialText: 'AlphaBeta'
    })

    try {
      applyBoldRange(harness.editor, 3, 8)

      harness.toolbarHost.querySelector<HTMLButtonElement>('[data-jword-open-find-replace]')?.click()
      fillInput(harness.ui.elements.findReplacePanel!.queryInput, 'alphabeta')
      harness.ui.elements.findReplacePanel!.findButton.click()

      expect(harness.ui.elements.findReplacePanel!.status.hidden).toBe(true)
      expect(harness.ui.elements.findReplacePanel!.status.textContent).toBe('')
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

  test('Ctrl 或 Meta 查找替换快捷键会打开面板并阻止浏览器默认查找', () => {
    const harness = createHarness()

    try {
      const hiddenTextarea = readHiddenTextarea(harness.editorHost)
      const openButton = harness.toolbarHost.querySelector<HTMLButtonElement>('[data-jword-open-find-replace]')
      const ctrlFindEvent = new KeyboardEvent('keydown', {
        key: 'f',
        ctrlKey: true,
        bubbles: true,
        cancelable: true
      })
      const metaReplaceEvent = new KeyboardEvent('keydown', {
        key: 'h',
        metaKey: true,
        bubbles: true,
        cancelable: true
      })

      expect(openButton).not.toBeNull()
      if (openButton === null) {
        throw new Error('查找替换 toolbar 按钮未挂载。')
      }

      stubBoundingRect(openButton, 160, 24, 28, 28)
      expect(harness.ui.elements.findReplacePanel!.root.hidden).toBe(true)

      hiddenTextarea.dispatchEvent(ctrlFindEvent)

      expect(ctrlFindEvent.defaultPrevented).toBe(true)
      expect(harness.ui.elements.findReplacePanel!.root.hidden).toBe(false)
      expect(harness.ui.elements.findReplacePanel!.root.style.getPropertyValue('--jw-find-replace-left')).toBe('160px')
      expect(harness.ui.elements.findReplacePanel!.root.style.getPropertyValue('--jw-find-replace-top')).toBe('60px')
      expect(document.activeElement).toBe(harness.ui.elements.findReplacePanel!.queryInput)

      harness.ui.elements.findReplacePanel!.closeButton.click()
      hiddenTextarea.dispatchEvent(metaReplaceEvent)

      expect(metaReplaceEvent.defaultPrevented).toBe(true)
      expect(harness.ui.elements.findReplacePanel!.root.hidden).toBe(false)
      expect(document.activeElement).toBe(harness.ui.elements.findReplacePanel!.replacementInput)
    } finally {
      harness.destroy()
    }
  })

  test('宿主禁用查找替换快捷键后不拦截 Ctrl+F', () => {
    const harness = createHarness({
      keyboardShortcuts: false
    })

    try {
      const hiddenTextarea = readHiddenTextarea(harness.editorHost)
      const event = new KeyboardEvent('keydown', {
        key: 'f',
        ctrlKey: true,
        bubbles: true,
        cancelable: true
      })

      hiddenTextarea.dispatchEvent(event)

      expect(event.defaultPrevented).toBe(false)
      expect(harness.ui.elements.findReplacePanel!.root.hidden).toBe(true)
    } finally {
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
function createHarness(options: {
  readonly?: boolean
  keyboardShortcuts?: boolean
  initialText?: string
  caseSensitive?: boolean
} = {}): Harness {
  const editorHost = document.createElement('div')
  const toolbarHost = document.createElement('div')
  const liveRegionHost = document.createElement('div')
  const findReplaceHost = document.createElement('div')
  const editor = createEditor({ initialText: options.initialText ?? 'alpha beta alpha' })

  document.body.append(editorHost, toolbarHost, liveRegionHost, findReplaceHost)
  editor.mount(editorHost)
  const ui = createJWordUi({
    editor,
    editorHost,
    toolbarHost,
    liveRegionHost,
    ...(options.readonly === undefined ? {} : { readonly: options.readonly }),
    findReplace: {
      host: findReplaceHost,
      ...(options.keyboardShortcuts === undefined ? {} : { keyboardShortcuts: options.keyboardShortcuts }),
      ...(options.caseSensitive === undefined ? {} : { caseSensitive: options.caseSensitive })
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

/** 对第一段应用粗体以制造跨 run 搜索场景。 */
function applyBoldRange(editor: Editor, anchorGraphemeIndex: number, focusGraphemeIndex: number): void {
  editor.setSelection(createSelectionState(
    editor.createTextAnchor({
      sectionId: 'section-1',
      blockId: 'paragraph-1',
      runId: 'run-1',
      graphemeIndex: anchorGraphemeIndex
    }),
    editor.createTextAnchor({
      sectionId: 'section-1',
      blockId: 'paragraph-1',
      runId: 'run-1',
      graphemeIndex: focusGraphemeIndex
    })
  ))
  editor.toggleBold()
}

/** 读取 editor mount 后的隐藏输入框。 */
function readHiddenTextarea(editorHost: HTMLElement): HTMLTextAreaElement {
  const hiddenTextarea = editorHost.querySelector('[data-jword-hidden-textarea]')

  if (!(hiddenTextarea instanceof HTMLTextAreaElement)) {
    throw new Error('缺少 JWord hidden textarea。')
  }

  return hiddenTextarea
}

/** 固定测试按钮几何，模拟 toolbar 按钮在真实页面中的位置。 */
function stubBoundingRect(element: HTMLElement, left: number, top: number, width: number, height: number): void {
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      x: left,
      y: top,
      left,
      top,
      width,
      height,
      right: left + width,
      bottom: top + height,
      toJSON(): Record<string, number> {
        return { x: left, y: top, left, top, width, height, right: left + width, bottom: top + height }
      }
    } as DOMRect)
  })
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

/** 读取测试文档第一段按 run 切开的纯文本。 */
function readDocumentRunTexts(editor: Editor): readonly string[] {
  const block = editor.getProjection().document.sections[0]?.blocks[0]

  return block?.kind === 'paragraph'
    ? block.runs.map((run) => run.inlines.flatMap((inline) => inline.kind === 'text' ? [inline.text] : []).join(''))
    : []
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
