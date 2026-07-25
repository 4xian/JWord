/**
 * @vitest-environment jsdom
 *
 * 职责：验证 editor input runtime 的键盘、焦点、段落拆分与布局感知方向键路径。
 * 边界：只覆盖键盘输入与 selection/caret 行为，不测试 clipboard、composition、pointer 或 inline image 专项。
 * 协作模块：transaction pipeline、history、layout hit/caret 映射和 formatting builder 共同支撑“小文档可编辑”闭环。
 * 性能/安全约束：测试只运行在 jsdom，不访问网络或磁盘，不直接写 projection。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import { describe, expect, it } from 'vitest'

import { createEditor } from '../../src/index'
import { createSelectionState } from '../../src/model/selection'
import {
  captureTransactions,
  dispatchKey,
  dispatchTextInput,
  expectSelectionIndexes,
  findClosestLineGraphemeIndex,
  getHiddenTextarea,
  readParagraphRunProperties,
  readParagraphRunTexts,
  readParagraphTexts,
  textareaFrom
} from './editor-test-helpers'

describe('Editor input runtime keyboard', () => {
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

  it('focuses the mounted editor and seeds a collapsed caret at the document end by default', () => {
    const host = document.createElement('div')
    const editor = createEditor({ initialText: 'abcdef' })

    document.body.append(host)

    try {
      editor.mount(host)

      const textarea = getHiddenTextarea(host)

      expect(editor.getSelection()).toBeNull()

      editor.focus()

      expect(document.activeElement).toBe(textarea)
      expectSelectionIndexes(editor, editor.getSelection(), [6, 6])
    } finally {
      editor.destroy()
      host.remove()
    }
  })

  it('can seed the first focus caret at the document start when configured', () => {
    const host = document.createElement('div')
    const editor = createEditor({
      initialText: 'abcdef',
      initialFocusPosition: 'start'
    })

    document.body.append(host)

    try {
      editor.mount(host)

      const textarea = getHiddenTextarea(host)

      expect(editor.getSelection()).toBeNull()

      editor.focus()

      expect(document.activeElement).toBe(textarea)
      expectSelectionIndexes(editor, editor.getSelection(), [0, 0])
    } finally {
      editor.destroy()
      host.remove()
    }
  })

  it('exposes a blur method that removes focus without clearing selection', () => {
    const host = document.createElement('div')
    const editor = createEditor({ initialText: 'abcdef' })

    document.body.append(host)

    try {
      editor.mount(host)
      editor.focus()

      const textarea = getHiddenTextarea(host)
      const selectionBeforeBlur = editor.getSelection()

      editor.blur()

      expect(document.activeElement).not.toBe(textarea)
      expect(editor.getSelection()).toBe(selectionBeforeBlur)
    } finally {
      editor.destroy()
      host.remove()
    }
  })

  it('clears selection before document replacement transaction events after focus', () => {
    const host = document.createElement('div')
    const editor = createEditor({ initialText: 'abcdef' })
    const selectionsDuringTransaction: Array<readonly [number, number] | null> = []

    try {
      editor.mount(host)
      editor.focus()
      editor.subscribe((event) => {
        if (event.kind !== 'transaction') {
          return
        }

        const selection = editor.getSelection()

        selectionsDuringTransaction.push(selection === null
          ? null
          : [
              editor.resolveTextPosition(selection.anchor).graphemeIndex,
              editor.resolveTextPosition(selection.focus).graphemeIndex
            ])
      })

      editor.createDocument({ text: 'xyz' })

      expect(selectionsDuringTransaction).toEqual([null])
      expect(editor.getSelection()).toBeNull()
    } finally {
      editor.destroy()
    }
  })

  it('applies superscript and subscript only to newly typed text at a collapsed caret', () => {
    const host = document.createElement('div')
    const editor = createEditor({ initialText: 'abc' })

    try {
      editor.mount(host)

      const textarea = getHiddenTextarea(host)
      const anchor = editor.createTextAnchor({
        sectionId: 'section-1',
        blockId: 'paragraph-1',
        runId: 'run-1',
        graphemeIndex: 1
      })

      editor.setSelection(createSelectionState(anchor, anchor))
      editor.toggleSuperscript()

      expect(readParagraphRunTexts(editor)).toEqual([['abc']])
      expect(readParagraphRunProperties(editor)).toEqual([[{}]])
      expect(editor.getSelectionFormattingState().run?.superscript).toEqual({
        value: true,
        mixed: false
      })
      expect(editor.getSelectionFormattingState().run?.subscript).toEqual({
        value: false,
        mixed: false
      })

      dispatchTextInput(textarea, 'x')

      expect(readParagraphRunTexts(editor)).toEqual([['a', 'x', 'bc']])
      expect(readParagraphRunProperties(editor)).toEqual([
        [{}, { superscript: true, subscript: false }, {}]
      ])

      editor.toggleSubscript()

      expect(readParagraphRunTexts(editor)).toEqual([['a', 'x', 'bc']])
      expect(readParagraphRunProperties(editor)).toEqual([
        [{}, { superscript: true, subscript: false }, {}]
      ])
      expect(editor.getSelectionFormattingState().run?.superscript).toEqual({
        value: false,
        mixed: false
      })
      expect(editor.getSelectionFormattingState().run?.subscript).toEqual({
        value: true,
        mixed: false
      })

      dispatchTextInput(textarea, 'y')

      expect(readParagraphRunTexts(editor)).toEqual([['a', 'x', 'y', 'bc']])
      expect(readParagraphRunProperties(editor)).toEqual([
        [{}, { superscript: true, subscript: false }, { superscript: false, subscript: true }, {}]
      ])
    } finally {
      editor.destroy()
    }
  })

  it('replaces the current selection with a paragraph break in one undoable command', () => {
    const host = document.createElement('div')
    const editor = createEditor({ initialText: 'abcdef' })
    const transactions = captureTransactions(editor)

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
      dispatchKey(textarea, 'Enter')

      expect(readParagraphTexts(editor)).toEqual(['a', 'ef'])
      expect(transactions).toEqual([{
        commandName: 'splitParagraph',
        origin: 'local-user',
        operationKinds: ['deleteRange', 'splitBlock'],
        dirty: true
      }])

      const undoResult = editor.undo()

      expect(undoResult.metadata?.commandName).toBe('splitParagraph')
      expect(readParagraphTexts(editor)).toEqual(['abcdef'])
      expectSelectionIndexes(editor, editor.getSelection(), [1, 4])
    } finally {
      editor.destroy()
    }
  })

  it('keeps an empty paragraph visible and caret-resolvable after pressing Enter at paragraph end', () => {
    const host = document.createElement('div')
    const editor = createEditor({ initialText: 'ab' })

    try {
      editor.mount(host)

      const textarea = getHiddenTextarea(host)
      const endAnchor = editor.createTextAnchor({
        sectionId: 'section-1',
        blockId: 'paragraph-1',
        runId: 'run-1',
        graphemeIndex: 2
      })

      editor.setSelection(createSelectionState(endAnchor, endAnchor))
      dispatchKey(textarea, 'Enter')

      expect(readParagraphTexts(editor)).toEqual(['ab', ''])

      const secondParagraph = editor.getLayout().pages
        .flatMap((page) => page.paragraphs)
        .find((paragraph) => paragraph.paragraphId === 'paragraph-2')

      expect(secondParagraph?.lines).toHaveLength(1)

      const secondParagraphStart = editor.createTextAnchor({
        sectionId: 'section-1',
        blockId: 'paragraph-2',
        runId: 'run-2',
        graphemeIndex: 0
      })
      const caretRect = editor.getCaretRect(secondParagraphStart)

      expect(caretRect).toBeDefined()
      expect(caretRect?.height ?? 0).toBeGreaterThan(0)
    } finally {
      editor.destroy()
    }
  })

  it('keeps Backspace deleting from the previous paragraph end after removing an empty line', () => {
    const host = document.createElement('div')
    const editor = createEditor({ initialText: 'ab' })

    try {
      editor.mount(host)

      const textarea = getHiddenTextarea(host)
      const endAnchor = editor.createTextAnchor({
        sectionId: 'section-1',
        blockId: 'paragraph-1',
        runId: 'run-1',
        graphemeIndex: 2
      })

      editor.setSelection(createSelectionState(endAnchor, endAnchor))
      dispatchTextInput(textarea, '  ')
      dispatchKey(textarea, 'Enter')
      dispatchKey(textarea, 'Backspace')

      expect(readParagraphTexts(editor)).toEqual(['ab  '])

      const focus = editor.getSelection()?.focus
      const focusPosition = focus === undefined ? undefined : editor.resolveTextPosition(focus)
      const caretRect = focus === undefined ? undefined : editor.getCaretRect(focus)

      expect(focusPosition).toMatchObject({
        blockId: 'paragraph-1',
        runId: 'run-1',
        graphemeIndex: 4
      })
      expect(caretRect).toBeDefined()
      expect(caretRect?.height ?? 0).toBeGreaterThan(0)
    } finally {
      editor.destroy()
    }
  })

  it('keeps Delete at the current paragraph end after removing the next empty line', () => {
    const host = document.createElement('div')
    const editor = createEditor({ initialText: 'ab' })

    try {
      editor.mount(host)

      const textarea = getHiddenTextarea(host)
      const endAnchor = editor.createTextAnchor({
        sectionId: 'section-1',
        blockId: 'paragraph-1',
        runId: 'run-1',
        graphemeIndex: 2
      })

      editor.setSelection(createSelectionState(endAnchor, endAnchor))
      dispatchKey(textarea, 'Enter')
      editor.setSelection(createSelectionState(endAnchor, endAnchor))
      dispatchKey(textarea, 'Delete')

      expect(readParagraphTexts(editor)).toEqual(['ab'])

      const focus = editor.getSelection()?.focus
      const focusPosition = focus === undefined ? undefined : editor.resolveTextPosition(focus)
      const caretRect = focus === undefined ? undefined : editor.getCaretRect(focus)

      expect(focusPosition).toMatchObject({
        blockId: 'paragraph-1',
        runId: 'run-1',
        graphemeIndex: 2
      })
      expect(caretRect).toBeDefined()
      expect(caretRect?.height ?? 0).toBeGreaterThan(0)
    } finally {
      editor.destroy()
    }
  })

  it('extends keyboard selection with Shift and keeps the original anchor', () => {
    const host = document.createElement('div')
    const editor = createEditor({ initialText: 'abcdef' })

    try {
      editor.mount(host)

      const textarea = getHiddenTextarea(host)
      const anchor = editor.createTextAnchor({
        sectionId: 'section-1',
        blockId: 'paragraph-1',
        runId: 'run-1',
        graphemeIndex: 2
      })

      editor.setSelection(createSelectionState(anchor, anchor))
      dispatchKey(textarea, 'ArrowRight', { shiftKey: true })
      dispatchKey(textarea, 'ArrowRight', { shiftKey: true })
      expectSelectionIndexes(editor, editor.getSelection(), [2, 4])
      expect(editor.getSelection()?.direction).toBe('forward')

      dispatchKey(textarea, 'ArrowLeft', { shiftKey: true })
      expectSelectionIndexes(editor, editor.getSelection(), [2, 3])

      dispatchKey(textarea, 'ArrowLeft', { shiftKey: true })
      dispatchKey(textarea, 'ArrowLeft', { shiftKey: true })
      expectSelectionIndexes(editor, editor.getSelection(), [2, 1])
      expect(editor.getSelection()?.direction).toBe('backward')
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

  it('extends layout-aware keyboard selection with Shift Home End ArrowUp and ArrowDown', () => {
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
      const focusIndex = middleFragment.end.graphemeIndex
      const textarea = textareaFrom(host)

      editor.setSelection(createSelectionState(focusAnchor, focusAnchor))
      dispatchKey(textarea, 'Home', { shiftKey: true })
      expectSelectionIndexes(editor, editor.getSelection(), [
        focusIndex,
        middleLine.fragments[0]!.start.graphemeIndex
      ])

      dispatchKey(textarea, 'End', { shiftKey: true })
      expectSelectionIndexes(editor, editor.getSelection(), [
        focusIndex,
        middleLine.fragments[middleLine.fragments.length - 1]!.end.graphemeIndex
      ])

      editor.setSelection(createSelectionState(focusAnchor, focusAnchor))
      dispatchKey(textarea, 'ArrowUp', { shiftKey: true })
      expectSelectionIndexes(editor, editor.getSelection(), [
        focusIndex,
        findClosestLineGraphemeIndex(previousLine, middleFragment.x + middleFragment.width)
      ])

      dispatchKey(textarea, 'ArrowDown', { shiftKey: true })
      expectSelectionIndexes(editor, editor.getSelection(), [
        focusIndex,
        findClosestLineGraphemeIndex(middleLine, middleFragment.x + middleFragment.width)
      ])

      dispatchKey(textarea, 'ArrowDown', { shiftKey: true })
      expectSelectionIndexes(editor, editor.getSelection(), [
        focusIndex,
        findClosestLineGraphemeIndex(nextLine, middleFragment.x + middleFragment.width)
      ])
    } finally {
      editor.destroy()
    }
  })
})
