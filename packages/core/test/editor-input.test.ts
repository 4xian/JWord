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
import type { LineBox } from '../src/layout'
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

  it('deduplicates composition commits across browser event order differences and preserves textarea fallback', () => {
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
      dispatchTextInput(textarea, '你')

      expect(readParagraphTexts(editor)).toEqual(['ab你'])
      expect(transactions).toEqual(['insertText'])

      dispatchKey(textarea, 'z', { metaKey: true })
      expect(readParagraphTexts(editor)).toEqual(['ab'])

      const resetAnchor = editor.createTextAnchor({
        sectionId: 'section-1',
        blockId: 'paragraph-1',
        runId: 'run-1',
        graphemeIndex: 2
      })

      editor.setSelection(createSelectionState(resetAnchor, resetAnchor))
      dispatchCompositionEvent(textarea, 'compositionstart', '')
      dispatchCompositionEvent(textarea, 'compositionupdate', '')
      textarea.value = '好'
      dispatchCompositionEvent(textarea, 'compositionend', '')
      dispatchTextInput(textarea, '好')

      expect(readParagraphTexts(editor)).toEqual(['ab好'])
      expect(transactions).toEqual(['insertText', 'insertText'])
    } finally {
      editor.destroy()
    }
  })

  it('ignores normal input and editing shortcuts while composition is active or just finalized', () => {
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
      dispatchTextInput(textarea, 'x')
      dispatchKey(textarea, 'Backspace', { isComposing: true })
      dispatchKey(textarea, 'b', { metaKey: true, isComposing: true })

      expect(readParagraphTexts(editor)).toEqual(['ab'])
      expect(transactions).toEqual([])

      dispatchCompositionEvent(textarea, 'compositionend', '你')
      expect(readParagraphTexts(editor)).toEqual(['ab你'])
      expect(transactions).toEqual(['insertText'])

      dispatchKey(textarea, 'Backspace', { keyCode: 229 })
      expect(readParagraphTexts(editor)).toEqual(['ab你'])
      expect(transactions).toEqual(['insertText'])

      dispatchKey(textarea, 'b', { metaKey: true })
      expect(editor.getSelectionFormattingState().run?.bold).toEqual({
        value: true,
        mixed: false
      })
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

  it('supports Home End ArrowUp and ArrowDown with layout-aware caret navigation', () => {
    const host = document.createElement('div')
    const editor = createEditor({ initialText: 'A'.repeat(400) })

    try {
      editor.mount(host)

      const layout = editor.getLayout()
      const paragraphLines = layout.pages.flatMap((page) =>
        page.lines.filter((line) => line.paragraphId === 'paragraph-1' && line.fragments.length > 0)
      )

      expect(paragraphLines.length).toBeGreaterThanOrEqual(3)

      const middleLine = paragraphLines[1]!
      const previousLine = paragraphLines[0]!
      const nextLine = paragraphLines[2]!
      const middleIndex = Math.max(1, Math.floor(middleLine.fragments.length / 2))
      const middleFragment = middleLine.fragments[middleIndex]!
      const focusAnchor = editor.createTextAnchor({
        sectionId: middleFragment.end.sectionId,
        blockId: middleFragment.end.blockId,
        runId: middleFragment.end.runId,
        graphemeIndex: middleFragment.end.graphemeIndex
      })

      editor.setSelection(createSelectionState(focusAnchor, focusAnchor))

      dispatchKey(textareaFrom(host), 'Home')
      expect(editor.resolveTextPosition(editor.getSelection()!.focus).graphemeIndex).toBe(
        middleLine.fragments[0]!.start.graphemeIndex
      )

      dispatchKey(textareaFrom(host), 'End')
      expect(editor.resolveTextPosition(editor.getSelection()!.focus).graphemeIndex).toBe(
        middleLine.fragments[middleLine.fragments.length - 1]!.end.graphemeIndex
      )

      editor.setSelection(createSelectionState(focusAnchor, focusAnchor))
      dispatchKey(textareaFrom(host), 'ArrowUp')

      const upPosition = editor.resolveTextPosition(editor.getSelection()!.focus)
      expect(upPosition.graphemeIndex).toBe(
        findClosestLineGraphemeIndex(previousLine, middleFragment.x + middleFragment.width)
      )

      dispatchKey(textareaFrom(host), 'ArrowDown')

      const restoredPosition = editor.resolveTextPosition(editor.getSelection()!.focus)
      expect(restoredPosition.graphemeIndex).toBe(
        findClosestLineGraphemeIndex(middleLine, middleFragment.x + middleFragment.width)
      )

      dispatchKey(textareaFrom(host), 'ArrowDown')

      const downPosition = editor.resolveTextPosition(editor.getSelection()!.focus)
      expect(downPosition.graphemeIndex).toBe(
        findClosestLineGraphemeIndex(nextLine, middleFragment.x + middleFragment.width)
      )
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

  it('routes keyboard and pointer selection changes through the same selectionChange facade stream', () => {
    const host = document.createElement('div')
    const editor = createEditor({ initialText: 'hello world' })
    const snapshots: Array<readonly [number, number]> = []

    try {
      editor.subscribe((event) => {
        if (event.kind !== 'selectionChange' || event.selection === null) {
          return
        }

        const anchor = editor.resolveTextPosition(event.selection.anchor).graphemeIndex
        const focus = editor.resolveTextPosition(event.selection.focus).graphemeIndex

        snapshots.push([anchor, focus])
      })
      editor.mount(host)

      const textarea = getHiddenTextarea(host)
      const page = getPageElement(host, 0)

      mockPageRect(page)

      const caretAnchor = editor.createTextAnchor({
        sectionId: 'section-1',
        blockId: 'paragraph-1',
        runId: 'run-1',
        graphemeIndex: 3
      })

      editor.setSelection(createSelectionState(caretAnchor, caretAnchor))
      dispatchKey(textarea, 'ArrowLeft')

      const dragStart = findPointerPointForGrapheme(editor, 0, 1)
      const dragEnd = findPointerPointForGrapheme(editor, 0, 4)

      dispatchMouse(page, 'mousedown', dragStart.clientX, dragStart.clientY)
      dispatchMouse(page, 'mousemove', dragEnd.clientX, dragEnd.clientY)
      dispatchMouse(page, 'mouseup', dragEnd.clientX, dragEnd.clientY)

      expect(snapshots).toContainEqual([2, 2])
      expect(snapshots).toContainEqual([1, 4])
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

  it('supports cross-run plain text cut and paste through the transaction pipeline', () => {
    const host = document.createElement('div')
    const editor = createEditor({ initialText: 'abcdef' })

    try {
      editor.mount(host)
      const formatAnchor = editor.createTextAnchor({
        sectionId: 'section-1',
        blockId: 'paragraph-1',
        runId: 'run-1',
        graphemeIndex: 3
      })
      const formatFocus = editor.createTextAnchor({
        sectionId: 'section-1',
        blockId: 'paragraph-1',
        runId: 'run-1',
        graphemeIndex: 6
      })

      editor.setSelection(createSelectionState(formatAnchor, formatFocus))
      editor.toggleBold()

      const paragraph = editor.getProjection().document.sections[0]?.blocks[0]

      expect(paragraph?.kind).toBe('paragraph')

      const boldRunId = paragraph?.kind === 'paragraph'
        ? paragraph.runs.find((run) => run.properties?.bold === true)?.id
        : undefined
      const plainTailRunId = paragraph?.kind === 'paragraph'
        ? paragraph.runs[paragraph.runs.length - 1]?.id
        : undefined

      const boldEnd = editor.createTextAnchor({
        sectionId: 'section-1',
        blockId: 'paragraph-1',
        runId: 'run-1',
        graphemeIndex: 3
      })
      const tailEnd = editor.createTextAnchor({
        sectionId: 'section-1',
        blockId: 'paragraph-1',
        runId: boldRunId ?? 'run-1',
        graphemeIndex: 2
      })
      const textarea = getHiddenTextarea(host)

      editor.setSelection(createSelectionState(boldEnd, tailEnd))

      const cutTransfer = createClipboardTransfer()

      dispatchClipboard(textarea, 'cut', cutTransfer)

      expect(cutTransfer.getData('text/plain')).toBe('de')
      expect(readParagraphTexts(editor)).toEqual(['abcf'])

      const currentParagraph = editor.getProjection().document.sections[0]?.blocks[0]
      const insertRunId = currentParagraph?.kind === 'paragraph'
        ? currentParagraph.runs[currentParagraph.runs.length - 1]?.id
        : undefined
      const insertRunTextLength = currentParagraph?.kind === 'paragraph'
        ? currentParagraph.runs[currentParagraph.runs.length - 1]?.inlines
          .flatMap((inline) => inline.kind === 'text' ? [inline.text] : [])
          .join('')
          .length ?? 0
        : 0

      const endAnchor = editor.createTextAnchor({
        sectionId: 'section-1',
        blockId: 'paragraph-1',
        runId: insertRunId ?? plainTailRunId ?? (boldRunId ?? 'run-1'),
        graphemeIndex: insertRunTextLength
      })

      editor.setSelection(createSelectionState(endAnchor, endAnchor))
      dispatchClipboard(textarea, 'paste', createClipboardTransfer({ 'text/plain': 'XY' }))

      expect(readParagraphTexts(editor)).toEqual(['abcfXY'])
    } finally {
      editor.destroy()
    }
  })

  it('supports cross-paragraph plain text cut and paste through the transaction pipeline', () => {
    const host = document.createElement('div')
    const editor = createEditor({ initialText: 'abc\n\ndef' })

    try {
      editor.mount(host)
      const paragraphs = editor.getProjection().document.sections[0]?.blocks
      const firstParagraph = paragraphs?.[0]
      const secondParagraph = paragraphs?.[1]

      expect(firstParagraph?.kind).toBe('paragraph')
      expect(secondParagraph?.kind).toBe('paragraph')

      const firstRunId = firstParagraph?.kind === 'paragraph' ? firstParagraph.runs[0]?.id : undefined
      const secondRunId = secondParagraph?.kind === 'paragraph' ? secondParagraph.runs[0]?.id : undefined

      const anchor = editor.createTextAnchor({
        sectionId: 'section-1',
        blockId: firstParagraph?.id ?? 'paragraph-1',
        runId: firstRunId ?? 'run-1',
        graphemeIndex: 1
      })
      const focus = editor.createTextAnchor({
        sectionId: 'section-1',
        blockId: secondParagraph?.id ?? 'paragraph-2',
        runId: secondRunId ?? 'run-2',
        graphemeIndex: 2
      })
      const textarea = getHiddenTextarea(host)

      editor.setSelection(createSelectionState(anchor, focus))

      const cutTransfer = createClipboardTransfer()

      dispatchClipboard(textarea, 'cut', cutTransfer)

      expect(cutTransfer.getData('text/plain')).toBe('bc\nde')
      expect(readParagraphTexts(editor)).toEqual(['af'])

      const mergedParagraph = editor.getProjection().document.sections[0]?.blocks[0]
      const mergedRunId = mergedParagraph?.kind === 'paragraph'
        ? mergedParagraph.runs[0]?.id
        : undefined

      const insertAnchor = editor.createTextAnchor({
        sectionId: 'section-1',
        blockId: mergedParagraph?.id ?? 'paragraph-1',
        runId: mergedRunId ?? 'run-1',
        graphemeIndex: 1
      })

      editor.setSelection(createSelectionState(insertAnchor, insertAnchor))
      dispatchClipboard(textarea, 'paste', createClipboardTransfer({ 'text/plain': 'X\nY' }))

      expect(readParagraphTexts(editor)).toEqual(['aX', 'Yf'])
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

function textareaFrom(host: HTMLElement): HTMLTextAreaElement {
  return getHiddenTextarea(host)
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
  options: Pick<KeyboardEventInit, 'metaKey' | 'ctrlKey' | 'shiftKey'> & {
    isComposing?: boolean
    keyCode?: number
  } = {}
) {
  const init: KeyboardEventInit = {
    key,
    bubbles: true,
    cancelable: true
  }

  if (options.metaKey !== undefined) {
    init.metaKey = options.metaKey
  }

  if (options.ctrlKey !== undefined) {
    init.ctrlKey = options.ctrlKey
  }

  if (options.shiftKey !== undefined) {
    init.shiftKey = options.shiftKey
  }

  const event = new KeyboardEvent('keydown', init)

  if (options.isComposing !== undefined) {
    Object.defineProperty(event, 'isComposing', {
      configurable: true,
      value: options.isComposing
    })
  }

  if (options.keyCode !== undefined) {
    Object.defineProperty(event, 'keyCode', {
      configurable: true,
      value: options.keyCode
    })
  }

  textarea.dispatchEvent(event)
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

function findClosestLineGraphemeIndex(
  line: LineBox,
  absoluteX: number
) {
  const firstFragment = line.fragments[0]

  if (firstFragment === undefined) {
    throw new Error('line 没有文本 fragment')
  }

  if (absoluteX <= firstFragment.x) {
    return firstFragment.start.graphemeIndex
  }

  for (const fragment of line.fragments) {
    const midpoint = fragment.x + fragment.width / 2

    if (absoluteX < midpoint) {
      return fragment.start.graphemeIndex
    }

    if (absoluteX <= fragment.x + fragment.width) {
      return fragment.end.graphemeIndex
    }
  }

  return line.fragments[line.fragments.length - 1]!.end.graphemeIndex
}
