/**
 * @vitest-environment jsdom
 *
 * 职责：验证 Gate 3 Alpha 第一阶段的 core 输入链，覆盖 hidden textarea、composition、基础键盘编辑与错误恢复。
 * 边界：只覆盖 editor facade 挂载后的 DOM/input runtime，不测试 pointer selection、clipboard HTML 或 demo 侧接线。
 * 协作模块：transaction pipeline、history、layout hit/caret 映射和 formatting builder 共同支撑“小文档可编辑”闭环。
 * 性能/安全约束：测试只运行在 jsdom，不访问网络或磁盘，不直接写 projection。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#gate-3。
 */

import { describe, expect, it } from 'vitest'

import { createEditor } from '../src/index'
import { twipsToCssPx } from '../src/page-config'
import type { DocumentId, RunId, SectionId, BlockId } from '../src/position'
import { createAnchorRef, createGraphemeIndex } from '../src/position'
import { createSelectionState } from '../src/selection'

describe('Editor input runtime', () => {
  it('mounts hidden textarea plus a11y mirror nodes and repositions textarea with the caret', () => {
    const host = document.createElement('div')
    const editor = createEditor({ initialText: 'abcdef' })

    try {
      editor.mount(host)

      const textarea = host.querySelector('[data-jword-hidden-textarea]')
      const liveRegion = host.querySelector('[data-jword-aria-live]')
      const textMirror = host.querySelector('[data-jword-text-mirror]')

      expect(textarea).toBeInstanceOf(HTMLTextAreaElement)
      expect(liveRegion).toBeInstanceOf(HTMLElement)
      expect(liveRegion?.getAttribute('aria-live')).toBe('polite')
      expect(textMirror).toBeInstanceOf(HTMLElement)
      expect(textMirror?.textContent).toContain('abcdef')

      const firstAnchor = editor.createTextAnchor({
        sectionId: 'section-1',
        blockId: 'paragraph-1',
        runId: 'run-1',
        graphemeIndex: 1
      })
      const secondAnchor = editor.createTextAnchor({
        sectionId: 'section-1',
        blockId: 'paragraph-1',
        runId: 'run-1',
        graphemeIndex: 4
      })

      editor.setSelection(createSelectionState(firstAnchor, firstAnchor))
      const firstLeft = (textarea as HTMLTextAreaElement).style.left

      editor.setSelection(createSelectionState(secondAnchor, secondAnchor))

      expect((textarea as HTMLTextAreaElement).style.left).not.toBe(firstLeft)
    } finally {
      editor.destroy()
    }
  })

  it('commits composition text through the transaction pipeline and supports keyboard undo redo', () => {
    const host = document.createElement('div')
    const editor = createEditor({ initialText: 'ab' })
    const transactions: string[] = []

    try {
      editor.subscribe((event) => {
        if (event.kind === 'transaction') {
          transactions.push(event.transaction.commandName)
        }
      })
      editor.mount(host)

      const textarea = getHiddenTextarea(host)
      const anchor = editor.createTextAnchor({
        sectionId: 'section-1',
        blockId: 'paragraph-1',
        runId: 'run-1',
        graphemeIndex: 2
      })

      editor.setSelection(createSelectionState(anchor, anchor))
      dispatchCompositionEvent(textarea, 'compositionstart', '')
      dispatchCompositionEvent(textarea, 'compositionupdate', '你')
      dispatchCompositionEvent(textarea, 'compositionend', '你')

      expect(readParagraphTexts(editor)).toEqual(['ab你'])
      expect(transactions).toEqual(['insertText'])

      dispatchKey(textarea, 'z', { metaKey: true })
      expect(readParagraphTexts(editor)).toEqual(['ab'])

      dispatchKey(textarea, 'z', { metaKey: true, shiftKey: true })
      expect(readParagraphTexts(editor)).toEqual(['ab你'])
    } finally {
      editor.destroy()
    }
  })

  it('supports basic keyboard editing, formatting shortcuts, and keeps working after a handler failure', () => {
    const host = document.createElement('div')
    const editor = createEditor({ initialText: 'abc' })

    try {
      editor.mount(host)

      const textarea = getHiddenTextarea(host)
      const endAnchor = editor.createTextAnchor({
        sectionId: 'section-1',
        blockId: 'paragraph-1',
        runId: 'run-1',
        graphemeIndex: 3
      })

      editor.setSelection(createSelectionState(endAnchor, endAnchor))
      dispatchTextInput(textarea, 'd')
      expect(readParagraphTexts(editor)).toEqual(['abcd'])

      dispatchKey(textarea, 'ArrowLeft')
      expect(editor.resolveTextPosition(editor.getSelection()!.focus).graphemeIndex).toBe(3)

      dispatchKey(textarea, 'Backspace')
      expect(readParagraphTexts(editor)).toEqual(['abd'])

      dispatchKey(textarea, 'Delete')
      expect(readParagraphTexts(editor)).toEqual(['ab'])

      const splitAnchor = editor.createTextAnchor({
        sectionId: 'section-1',
        blockId: 'paragraph-1',
        runId: 'run-1',
        graphemeIndex: 1
      })

      editor.setSelection(createSelectionState(splitAnchor, splitAnchor))
      dispatchKey(textarea, 'Enter')
      expect(readParagraphTexts(editor)).toEqual(['a', 'b'])

      const secondParagraphStart = editor.createTextAnchor({
        sectionId: 'section-1',
        blockId: 'paragraph-2',
        runId: 'run-2',
        graphemeIndex: 0
      })

      editor.setSelection(createSelectionState(secondParagraphStart, secondParagraphStart))
      dispatchKey(textarea, 'Backspace')
      expect(readParagraphTexts(editor)).toEqual(['ab'])

      dispatchKey(textarea, 'b', { metaKey: true })
      expect(editor.getSelectionFormattingState().run?.bold).toEqual({
        value: true,
        mixed: false
      })

      dispatchKey(textarea, 'i', { ctrlKey: true })
      expect(editor.getSelectionFormattingState().run?.italic).toEqual({
        value: true,
        mixed: false
      })

      const invalidAnchor = createAnchorRef({
        documentId: 'document-1' as DocumentId,
        sectionId: 'section-1' as SectionId,
        blockId: 'missing-paragraph' as BlockId,
        runId: 'missing-run' as RunId,
        graphemeIndex: createGraphemeIndex(0)
      })

      editor.setSelection(createSelectionState(invalidAnchor, invalidAnchor))
      dispatchTextInput(textarea, '坏')
      expect(readParagraphTexts(editor)).toEqual(['ab'])

      const validAnchor = editor.createTextAnchor({
        sectionId: 'section-1',
        blockId: 'paragraph-1',
        runId: 'run-2',
        graphemeIndex: 1
      })

      editor.setSelection(createSelectionState(validAnchor, validAnchor))
      dispatchTextInput(textarea, '好')
      expect(readParagraphTexts(editor)).toEqual(['ab好'])

      dispatchKey(textarea, 'z', { metaKey: true })
      expect(readParagraphTexts(editor)).toEqual(['ab'])
    } finally {
      editor.destroy()
    }
  })

  it('supports pointer click drag and double click word selection through hit test', () => {
    const host = document.createElement('div')
    const editor = createEditor({ initialText: 'hello world' })

    try {
      editor.mount(host)

      const page = getPageElement(host, 0)
      expect(editor.getLayout().pages[0]?.lines[0]?.fragments[0]).toBeDefined()

      mockPageRect(page)
      const firstPoint = findPointerPointForGrapheme(editor, 0, 1)

      dispatchMouse(
        page,
        'mousedown',
        firstPoint.clientX,
        firstPoint.clientY
      )
      dispatchMouse(
        page,
        'mouseup',
        firstPoint.clientX,
        firstPoint.clientY
      )

      expect(editor.resolveTextPosition(editor.getSelection()!.focus).graphemeIndex).toBe(1)

      const dragStart = findPointerPointForGrapheme(editor, 0, 1)
      const dragEnd = findPointerPointForGrapheme(editor, 0, 5)

      dispatchMouse(
        page,
        'mousedown',
        dragStart.clientX,
        dragStart.clientY
      )
      dispatchMouse(
        page,
        'mousemove',
        dragEnd.clientX,
        dragEnd.clientY
      )
      dispatchMouse(
        page,
        'mouseup',
        dragEnd.clientX,
        dragEnd.clientY
      )

      expect(editor.resolveTextPosition(editor.getSelection()!.anchor).graphemeIndex).toBe(1)
      expect(editor.resolveTextPosition(editor.getSelection()!.focus).graphemeIndex).toBe(5)

      const wordPoint = findPointerPointForGrapheme(editor, 0, 7)

      dispatchMouse(
        page,
        'dblclick',
        wordPoint.clientX,
        wordPoint.clientY
      )

      const wordSelection = editor.getSelection()
      const resolvedAnchor = editor.resolveTextPosition(wordSelection!.anchor)
      const resolvedFocus = editor.resolveTextPosition(wordSelection!.focus)

      expect(Math.min(resolvedAnchor.graphemeIndex, resolvedFocus.graphemeIndex)).toBe(6)
      expect(Math.max(resolvedAnchor.graphemeIndex, resolvedFocus.graphemeIndex)).toBe(11)
    } finally {
      editor.destroy()
    }
  })

  it('supports plain text copy cut and paste through the transaction pipeline', () => {
    const host = document.createElement('div')
    const editor = createEditor({ initialText: 'abcdef' })

    try {
      editor.mount(host)

      const textarea = getHiddenTextarea(host)
      const anchor = editor.createTextAnchor({
        sectionId: 'section-1',
        blockId: 'paragraph-1',
        runId: 'run-1',
        graphemeIndex: 1
      })
      const focus = editor.createTextAnchor({
        sectionId: 'section-1',
        blockId: 'paragraph-1',
        runId: 'run-1',
        graphemeIndex: 4
      })

      editor.setSelection(createSelectionState(anchor, focus))

      const copyTransfer = createClipboardTransfer()

      dispatchClipboard(textarea, 'copy', copyTransfer)
      expect(copyTransfer.getData('text/plain')).toBe('bcd')
      expect(readParagraphTexts(editor)).toEqual(['abcdef'])

      const cutTransfer = createClipboardTransfer()

      dispatchClipboard(textarea, 'cut', cutTransfer)
      expect(cutTransfer.getData('text/plain')).toBe('bcd')
      expect(readParagraphTexts(editor)).toEqual(['aef'])

      const endAnchor = editor.createTextAnchor({
        sectionId: 'section-1',
        blockId: 'paragraph-1',
        runId: 'run-1',
        graphemeIndex: 3
      })

      editor.setSelection(createSelectionState(endAnchor, endAnchor))
      dispatchClipboard(textarea, 'paste', createClipboardTransfer({ 'text/plain': 'XYZ' }))

      expect(readParagraphTexts(editor)).toEqual(['aefXYZ'])
    } finally {
      editor.destroy()
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

function dispatchTextInput(textarea: HTMLTextAreaElement, text: string) {
  textarea.value = text
  textarea.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }))
}

function dispatchCompositionEvent(
  textarea: HTMLTextAreaElement,
  type: 'compositionstart' | 'compositionupdate' | 'compositionend',
  data: string
) {
  const event = new Event(type, { bubbles: true, cancelable: true })

  Object.defineProperty(event, 'data', {
    configurable: true,
    value: data
  })

  textarea.dispatchEvent(event)
}

function dispatchKey(
  textarea: HTMLTextAreaElement,
  key: string,
  options: Pick<KeyboardEventInit, 'metaKey' | 'ctrlKey' | 'shiftKey'> = {}
) {
  textarea.dispatchEvent(new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...options
  }))
}

function dispatchMouse(
  target: HTMLElement,
  type: 'mousedown' | 'mousemove' | 'mouseup' | 'dblclick',
  clientX: number,
  clientY: number
) {
  target.dispatchEvent(new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    buttons: type === 'mouseup' ? 0 : 1,
    clientX,
    clientY
  }))
}

function dispatchClipboard(
  textarea: HTMLTextAreaElement,
  type: 'copy' | 'cut' | 'paste',
  clipboardData: ReturnType<typeof createClipboardTransfer>
) {
  const event = new Event(type, { bubbles: true, cancelable: true })

  Object.defineProperty(event, 'clipboardData', {
    configurable: true,
    value: clipboardData
  })

  textarea.dispatchEvent(event)
}

function createClipboardTransfer(initialData: Record<string, string> = {}) {
  const store = new Map(Object.entries(initialData))

  return {
    getData(type: string) {
      return store.get(type) ?? ''
    },
    setData(type: string, value: string) {
      store.set(type, value)
    }
  }
}

function getPageElement(host: HTMLElement, pageIndex: number): HTMLElement {
  const page = host.querySelector(`[data-jword-page="${pageIndex}"]`)

  if (!(page instanceof HTMLElement)) {
    throw new Error(`page ${pageIndex} 未挂载`)
  }

  return page
}

function mockPageRect(page: HTMLElement) {
  Object.defineProperty(page, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: Number.parseFloat(page.style.width || '0'),
      bottom: Number.parseFloat(page.style.height || '0'),
      width: Number.parseFloat(page.style.width || '0'),
      height: Number.parseFloat(page.style.height || '0'),
      toJSON: () => ({})
    })
  })
}

function findPointerPointForGrapheme(
  editor: ReturnType<typeof createEditor>,
  pageIndex: number,
  graphemeIndex: number
) {
  const layout = editor.getLayout()
  const page = layout.pages[pageIndex]
  const localY = (page?.lines[0]?.y ?? 0) - (page?.y ?? 0) + 1

  if (page === undefined) {
    throw new Error(`page ${pageIndex} 不存在`)
  }

  for (let x = 0; x < page.width; x += 1) {
    const anchor = editor.hitTest({
      pageIndex,
      x,
      y: localY
    })

    if (anchor === undefined) {
      continue
    }

    if (editor.resolveTextPosition(anchor).graphemeIndex === graphemeIndex) {
      return {
        clientX: twipsToCssPx(x),
        clientY: twipsToCssPx(localY)
      }
    }
  }

  throw new Error(`找不到 grapheme ${graphemeIndex} 的命中点`)
}

function readParagraphTexts(editor: ReturnType<typeof createEditor>) {
  return editor.getProjection().document.sections.flatMap((section) =>
    section.blocks.flatMap((block) => block.kind === 'paragraph'
      ? [block.runs.map((run) => run.inlines.flatMap((inline) => inline.kind === 'text' ? [inline.text] : []).join('')).join('')]
      : [])
  )
}
