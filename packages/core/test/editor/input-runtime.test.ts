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

import {
  buildInsertInlineImageCommand,
  createEditor
} from '../../src/index'
import type { LineBox } from '../../src/layout/runtime'
import { twipsToCssPx } from '../../src/layout/page-config'
import type { DocumentId, RunId, SectionId, BlockId } from '../../src/model/position'
import { createAnchorRef, createGraphemeIndex } from '../../src/model/position'
import { createSelectionState } from '../../src/model/selection'
import type { Resource } from '../../src/resources/types'

interface RecordedTransaction {
  readonly commandName: string
  readonly origin: string
  readonly operationKinds: readonly string[]
  readonly dirty: boolean
}

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

  it('commits composition text through the transaction pipeline and supports keyboard undo redo', () => {
    const host = document.createElement('div')
    const editor = createEditor({ initialText: 'ab' })
    const transactions = captureTransactions(editor)

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
      dispatchCompositionEvent(textarea, 'compositionstart', '')
      dispatchCompositionEvent(textarea, 'compositionupdate', '你')
      dispatchCompositionEvent(textarea, 'compositionend', '你')

      expect(readParagraphTexts(editor)).toEqual(['ab你'])
      expect(transactions).toEqual([{
        commandName: 'insertText',
        origin: 'local-user',
        operationKinds: ['insertText'],
        dirty: true
      }])

      const undoResult = editor.undo()

      expect(undoResult.metadata?.commandName).toBe('insertText')
      expect(undoResult.metadata?.origin).toBe('local-user')
      expectSelectionIndexes(editor, undoResult.metadata?.selectionBefore?.selection, [2, 2])
      expectSelectionIndexes(editor, undoResult.metadata?.selectionAfter?.selection, [3, 3])
      expect(readParagraphTexts(editor)).toEqual(['ab'])

      const redoResult = editor.redo()

      expect(redoResult.metadata?.commandName).toBe('insertText')
      expect(redoResult.metadata?.origin).toBe('local-user')
      expectSelectionIndexes(editor, redoResult.metadata?.selectionAfter?.selection, [3, 3])
      expect(readParagraphTexts(editor)).toEqual(['ab你'])

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
    const transactions = captureTransactions(editor)

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
      expect(transactions).toHaveLength(1)

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
      expect(transactions).toHaveLength(7)

      const validAnchor = editor.createTextAnchor({
        sectionId: 'section-1',
        blockId: 'paragraph-1',
        runId: 'run-2',
        graphemeIndex: 1
      })

      editor.setSelection(createSelectionState(validAnchor, validAnchor))
      dispatchTextInput(textarea, '好')
      expect(readParagraphTexts(editor)).toEqual(['ab好'])

      expect(transactions).toEqual([
        {
          commandName: 'insertText',
          origin: 'local-user',
          operationKinds: ['insertText'],
          dirty: true
        },
        {
          commandName: 'deleteBackward',
          origin: 'local-user',
          operationKinds: ['deleteRange'],
          dirty: true
        },
        {
          commandName: 'deleteForward',
          origin: 'local-user',
          operationKinds: ['deleteRange'],
          dirty: true
        },
        {
          commandName: 'splitParagraph',
          origin: 'local-user',
          operationKinds: ['splitBlock'],
          dirty: true
        },
        {
          commandName: 'mergeParagraphBackward',
          origin: 'local-user',
          operationKinds: ['mergeBlock'],
          dirty: true
        },
        {
          commandName: 'setBold',
          origin: 'local-user',
          operationKinds: ['setRunProperties'],
          dirty: true
        },
        {
          commandName: 'setItalic',
          origin: 'local-user',
          operationKinds: ['setRunProperties'],
          dirty: true
        },
        {
          commandName: 'insertText',
          origin: 'local-user',
          operationKinds: ['insertText'],
          dirty: true
        }
      ])

      const undoResult = editor.undo()

      expect(undoResult.metadata?.commandName).toBe('insertText')
      expect(undoResult.metadata?.origin).toBe('local-user')
      expectSelectionIndexes(editor, undoResult.metadata?.selectionBefore?.selection, [1, 1])
      expectSelectionIndexes(editor, undoResult.metadata?.selectionAfter?.selection, [2, 2])
      expect(readParagraphTexts(editor)).toEqual(['ab'])

      const redoResult = editor.redo()

      expect(redoResult.metadata?.commandName).toBe('insertText')
      expect(redoResult.metadata?.origin).toBe('local-user')
      expectSelectionIndexes(editor, redoResult.metadata?.selectionAfter?.selection, [2, 2])
      expect(readParagraphTexts(editor)).toEqual(['ab好'])
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

  it('keeps Backspace deleting inline images one by one from the paragraph tail', () => {
    const host = document.createElement('div')
    const editor = createEditor({ initialText: 'ab' })
    const transactions = captureTransactions(editor)

    try {
      editor.mount(host)

      const textarea = getHiddenTextarea(host)

      insertInlineImageAtSelection(editor, createResource('image-inline-1'), {
        sectionId: 'section-1',
        blockId: 'paragraph-1',
        runId: 'run-1',
        graphemeIndex: 2
      })
      insertInlineImageAtSelection(editor, createResource('image-inline-2'), readParagraphTailAnchor(editor))
      const tailAnchor = readParagraphTailAnchor(editor)

      editor.setSelection(createSelectionState(
        editor.createTextAnchor(tailAnchor),
        editor.createTextAnchor(tailAnchor)
      ))

      dispatchKey(textarea, 'Backspace')
      expect(readInlineImageResourceIds(editor)).toEqual(['image-inline-1'])
      expect(editor.resolveTextPosition(editor.getSelection()!.focus)).toMatchObject(tailAnchor)

      dispatchKey(textarea, 'Backspace')
      expect(readInlineImageResourceIds(editor)).toEqual([])
      expect(readParagraphTexts(editor)).toEqual(['ab'])
      expect(editor.resolveTextPosition(editor.getSelection()!.focus)).toMatchObject(tailAnchor)
      expect(transactions.slice(-2)).toEqual([
        {
          commandName: 'deleteImage',
          origin: 'local-user',
          operationKinds: ['deleteImage', 'deleteResource'],
          dirty: true
        },
        {
          commandName: 'deleteImage',
          origin: 'local-user',
          operationKinds: ['deleteImage', 'deleteResource'],
          dirty: true
        }
      ])
    } finally {
      editor.destroy()
    }
  })

  it('keeps Delete deleting inline images one by one from the text boundary', () => {
    const host = document.createElement('div')
    const editor = createEditor({ initialText: 'ab' })
    const transactions = captureTransactions(editor)

    try {
      editor.mount(host)

      const textarea = getHiddenTextarea(host)

      insertInlineImageAtSelection(editor, createResource('image-inline-1'), {
        sectionId: 'section-1',
        blockId: 'paragraph-1',
        runId: 'run-1',
        graphemeIndex: 2
      })
      insertInlineImageAtSelection(editor, createResource('image-inline-2'), readParagraphTailAnchor(editor))

      const endAnchor = editor.createTextAnchor({
        sectionId: 'section-1',
        blockId: 'paragraph-1',
        runId: 'run-1',
        graphemeIndex: 2
      })

      editor.setSelection(createSelectionState(endAnchor, endAnchor))

      dispatchKey(textarea, 'Delete')
      expect(readInlineImageResourceIds(editor)).toEqual(['image-inline-2'])
      expect(editor.resolveTextPosition(editor.getSelection()!.focus)).toMatchObject({
        sectionId: 'section-1',
        blockId: 'paragraph-1',
        runId: 'run-1',
        graphemeIndex: 2
      })

      dispatchKey(textarea, 'Delete')
      expect(readInlineImageResourceIds(editor)).toEqual([])
      expect(readParagraphTexts(editor)).toEqual(['ab'])
      expect(editor.resolveTextPosition(editor.getSelection()!.focus)).toMatchObject({
        sectionId: 'section-1',
        blockId: 'paragraph-1',
        runId: 'run-1',
        graphemeIndex: 2
      })
      expect(transactions.slice(-2)).toEqual([
        {
          commandName: 'deleteImage',
          origin: 'local-user',
          operationKinds: ['deleteImage', 'deleteResource'],
          dirty: true
        },
        {
          commandName: 'deleteImage',
          origin: 'local-user',
          operationKinds: ['deleteImage', 'deleteResource'],
          dirty: true
        }
      ])
    } finally {
      editor.destroy()
    }
  })

  it('selects an inline image when clicking on the image body', () => {
    const host = document.createElement('div')
    const editor = createEditor({ initialText: 'ab' })

    try {
      editor.mount(host)

      insertInlineImageAtSelection(editor, createResource('image-inline-click'), {
        sectionId: 'section-1',
        blockId: 'paragraph-1',
        runId: 'run-1',
        graphemeIndex: 2
      })

      const paragraph = editor.getProjection().document.sections[0]?.blocks[0]

      expect(paragraph?.kind).toBe('paragraph')
      if (paragraph?.kind !== 'paragraph') {
        throw new Error('expected paragraph block')
      }

      const imageRunId = paragraph.runs.find((run) => run.inlines.some((inline) => inline.kind === 'image'))?.id

      expect(imageRunId).toBeDefined()

      const page = getPageElement(host, 0)

      mockPageRect(page)

      const hitPoint = findPointerPointForImageRun(editor, 0, imageRunId!)

      dispatchMouse(page, 'mousedown', hitPoint.clientX, hitPoint.clientY)
      dispatchMouse(page, 'mouseup', hitPoint.clientX, hitPoint.clientY)

      expect(editor.resolveTextPosition(editor.getSelection()!.focus)).toMatchObject({
        blockId: 'paragraph-1',
        runId: imageRunId,
        graphemeIndex: 0
      })
      expect(editor.getSelectionRects(editor.getSelection()!.range)).toHaveLength(1)
    } finally {
      editor.destroy()
    }
  })

  it('continues Backspace into previous text after deleting the last trailing inline image', () => {
    const host = document.createElement('div')
    const editor = createEditor({ initialText: 'ab' })

    try {
      editor.mount(host)

      const textarea = getHiddenTextarea(host)

      insertInlineImageAtSelection(editor, createResource('image-inline-tail'), {
        sectionId: 'section-1',
        blockId: 'paragraph-1',
        runId: 'run-1',
        graphemeIndex: 2
      })

      const tailAnchor = readParagraphTailAnchor(editor)

      editor.setSelection(createSelectionState(
        editor.createTextAnchor(tailAnchor),
        editor.createTextAnchor(tailAnchor)
      ))

      dispatchKey(textarea, 'Backspace')
      expect(readInlineImageResourceIds(editor)).toEqual([])

      dispatchKey(textarea, 'Backspace')
      expect(readParagraphTexts(editor)).toEqual(['a'])
      expect(editor.resolveTextPosition(editor.getSelection()!.focus)).toMatchObject({
        sectionId: 'section-1',
        blockId: 'paragraph-1',
        runId: 'run-1',
        graphemeIndex: 1
      })
    } finally {
      editor.destroy()
    }
  })

  it('deletes a mixed text and inline-image range with Backspace in one step', () => {
    const host = document.createElement('div')
    const editor = createEditor({ initialText: 'ab' })

    try {
      editor.mount(host)

      const textarea = getHiddenTextarea(host)

      insertInlineImageAtSelection(editor, createResource('image-inline-range-backspace'), {
        sectionId: 'section-1',
        blockId: 'paragraph-1',
        runId: 'run-1',
        graphemeIndex: 2
      })

      const tailAnchor = readParagraphTailAnchor(editor)
      const anchor = editor.createTextAnchor({
        sectionId: 'section-1',
        blockId: 'paragraph-1',
        runId: 'run-1',
        graphemeIndex: 1
      })
      const focus = editor.createTextAnchor(tailAnchor)

      editor.setSelection(createSelectionState(anchor, focus))
      dispatchKey(textarea, 'Backspace')

      expect(readParagraphTexts(editor)).toEqual(['a'])
      expect(readInlineImageResourceIds(editor)).toEqual([])
      expect(editor.resolveTextPosition(editor.getSelection()!.focus)).toMatchObject({
        sectionId: 'section-1',
        blockId: 'paragraph-1',
        runId: 'run-1',
        graphemeIndex: 1
      })
    } finally {
      editor.destroy()
    }
  })

  it('deletes a mixed text and inline-image range with Delete in one step', () => {
    const host = document.createElement('div')
    const editor = createEditor({ initialText: 'ab' })

    try {
      editor.mount(host)

      const textarea = getHiddenTextarea(host)

      insertInlineImageAtSelection(editor, createResource('image-inline-range-delete'), {
        sectionId: 'section-1',
        blockId: 'paragraph-1',
        runId: 'run-1',
        graphemeIndex: 2
      })

      const tailAnchor = readParagraphTailAnchor(editor)
      const anchor = editor.createTextAnchor({
        sectionId: 'section-1',
        blockId: 'paragraph-1',
        runId: 'run-1',
        graphemeIndex: 1
      })
      const focus = editor.createTextAnchor(tailAnchor)

      editor.setSelection(createSelectionState(anchor, focus))
      dispatchKey(textarea, 'Delete')

      expect(readParagraphTexts(editor)).toEqual(['a'])
      expect(readInlineImageResourceIds(editor)).toEqual([])
      expect(editor.resolveTextPosition(editor.getSelection()!.focus)).toMatchObject({
        sectionId: 'section-1',
        blockId: 'paragraph-1',
        runId: 'run-1',
        graphemeIndex: 1
      })
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

  it('supports pointer click drag and double click word selection through hit test', () => {
    const host = document.createElement('div')
    const editor = createEditor({ initialText: 'hello world' })

    try {
      editor.mount(host)

      const page = getPageElement(host, 0)
      const canvas = page.querySelector('canvas')
      expect(editor.getLayout().pages[0]?.lines[0]?.fragments[0]).toBeDefined()
      expect(page.style.cursor).toBe('text')
      expect(canvas instanceof HTMLCanvasElement ? canvas.style.cursor : '').toBe('text')

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

  it('expands Chinese double click selection by the real hit bias instead of hard-coding a single grapheme', () => {
    const host = document.createElement('div')
    const editor = createEditor({ initialText: '中文测试文本' })

    try {
      editor.mount(host)

      const page = getPageElement(host, 0)

      mockPageRect(page)

      const leftPoint = findPointerPointForGraphemeBias(editor, 0, 2, 'left')
      const centerPoint = findPointerPointForGraphemeBias(editor, 0, 2, 'center')
      const rightPoint = findPointerPointForGraphemeBias(editor, 0, 2, 'right')

      dispatchMouse(
        page,
        'dblclick',
        centerPoint.clientX,
        centerPoint.clientY
      )

      expectSelectionIndexes(editor, editor.getSelection(), [2, 3])

      dispatchMouse(
        page,
        'dblclick',
        leftPoint.clientX,
        leftPoint.clientY
      )

      expectSelectionIndexes(editor, editor.getSelection(), [1, 3])

      dispatchMouse(
        page,
        'dblclick',
        rightPoint.clientX,
        rightPoint.clientY
      )

      expectSelectionIndexes(editor, editor.getSelection(), [2, 4])
    } finally {
      editor.destroy()
    }
  })

  it('updates drag selection during mousemove but defers selectionChange emission until mouseup', async () => {
    const host = document.createElement('div')
    const editor = createEditor({ initialText: 'hello world' })
    const snapshots: Array<readonly [number, number]> = []

    try {
      document.body.append(host)
      editor.subscribe((event) => {
        if (event.kind !== 'selectionChange' || event.selection === null) {
          return
        }

        snapshots.push([
          editor.resolveTextPosition(event.selection.anchor).graphemeIndex,
          editor.resolveTextPosition(event.selection.focus).graphemeIndex
        ])
      })
      editor.mount(host)

      const page = getPageElement(host, 0)

      mockPageRect(page)

      const dragStart = findPointerPointForGrapheme(editor, 0, 1)
      const dragMiddle = findPointerPointForGrapheme(editor, 0, 3)
      const dragEnd = findPointerPointForGrapheme(editor, 0, 5)

      dispatchMouse(page, 'mousedown', dragStart.clientX, dragStart.clientY)
      expectSelectionIndexes(editor, editor.getSelection(), [1, 1])
      expect(snapshots).not.toContainEqual([1, 1])

      dispatchMouse(page, 'mousemove', dragMiddle.clientX, dragMiddle.clientY)
      expectSelectionIndexes(editor, editor.getSelection(), [1, 3])
      expect(snapshots).not.toContainEqual([1, 3])

      dispatchMouse(page, 'mousemove', dragEnd.clientX, dragEnd.clientY)
      expectSelectionIndexes(editor, editor.getSelection(), [1, 5])
      expect(snapshots).not.toContainEqual([1, 5])

      dispatchMouse(page, 'mouseup', dragEnd.clientX, dragEnd.clientY)
      await waitForDeferredSelectionTick()

      expectSelectionIndexes(editor, editor.getSelection(), [1, 5])
      expect(snapshots).toContainEqual([1, 5])
      expect(page.style.cursor).toBe('text')
    } finally {
      editor.destroy()
      host.remove()
    }
  })

  it('routes keyboard and pointer selection changes through the same selectionChange facade stream, and only emits transactions once an edit occurs', async () => {
    const host = document.createElement('div')
    const editor = createEditor({ initialText: 'hello world' })
    const snapshots: Array<readonly [number, number]> = []
    const transactions = captureTransactions(editor)

    try {
      document.body.append(host)
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
      await waitForDeferredSelectionTick()

      expect(snapshots).toContainEqual([2, 2])
      expect(snapshots).toContainEqual([1, 4])
      expect(transactions).toEqual([])

      const cutTransfer = createClipboardTransfer()

      dispatchClipboard(textarea, 'cut', cutTransfer)

      expect(cutTransfer.getData('text/plain')).toBe('ell')
      expect(readParagraphTexts(editor)).toEqual(['ho world'])
      expect(transactions).toEqual([{
        commandName: 'deleteSelection',
        origin: 'local-user',
        operationKinds: ['deleteRange'],
        dirty: true
      }])

      const undoResult = editor.undo()

      expect(undoResult.metadata?.commandName).toBe('deleteSelection')
      expect(undoResult.metadata?.origin).toBe('local-user')
      expectSelectionIndexes(editor, undoResult.metadata?.selectionBefore?.selection, [1, 4])
      expectSelectionIndexes(editor, undoResult.metadata?.selectionAfter?.selection, [1, 1])
      expect(readParagraphTexts(editor)).toEqual(['hello world'])

      const redoResult = editor.redo()

      expect(redoResult.metadata?.commandName).toBe('deleteSelection')
      expect(redoResult.metadata?.origin).toBe('local-user')
      expectSelectionIndexes(editor, redoResult.metadata?.selectionAfter?.selection, [1, 1])
      expect(readParagraphTexts(editor)).toEqual(['ho world'])
    } finally {
      editor.destroy()
      host.remove()
    }
  })

  it('supports plain text copy cut and paste through the transaction pipeline', () => {
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

      const copyTransfer = createClipboardTransfer()

      dispatchClipboard(textarea, 'copy', copyTransfer)
      expect(copyTransfer.getData('text/plain')).toBe('bcd')
      expect(readParagraphTexts(editor)).toEqual(['abcdef'])
      expect(transactions).toEqual([])

      const cutTransfer = createClipboardTransfer()

      dispatchClipboard(textarea, 'cut', cutTransfer)
      expect(cutTransfer.getData('text/plain')).toBe('bcd')
      expect(readParagraphTexts(editor)).toEqual(['aef'])
      expect(transactions).toEqual([{
        commandName: 'deleteSelection',
        origin: 'local-user',
        operationKinds: ['deleteRange'],
        dirty: true
      }])

      const endAnchor = editor.createTextAnchor({
        sectionId: 'section-1',
        blockId: 'paragraph-1',
        runId: 'run-1',
        graphemeIndex: 3
      })

      editor.setSelection(createSelectionState(endAnchor, endAnchor))
      dispatchClipboard(textarea, 'paste', createClipboardTransfer({ 'text/plain': 'XYZ' }))

      expect(readParagraphTexts(editor)).toEqual(['aefXYZ'])
      expect(transactions).toEqual([
        {
          commandName: 'deleteSelection',
          origin: 'local-user',
          operationKinds: ['deleteRange'],
          dirty: true
        },
        {
          commandName: 'insertText',
          origin: 'local-user',
          operationKinds: ['insertText'],
          dirty: true
        }
      ])

      const undoPasteResult = editor.undo()

      expect(undoPasteResult.metadata?.commandName).toBe('insertText')
      expect(undoPasteResult.metadata?.origin).toBe('local-user')
      expectSelectionIndexes(editor, undoPasteResult.metadata?.selectionBefore?.selection, [3, 3])
      expectSelectionIndexes(editor, undoPasteResult.metadata?.selectionAfter?.selection, [6, 6])
      expect(readParagraphTexts(editor)).toEqual(['aef'])

      const undoCutResult = editor.undo()

      expect(undoCutResult.metadata?.commandName).toBe('deleteSelection')
      expect(undoCutResult.metadata?.origin).toBe('local-user')
      expectSelectionIndexes(editor, undoCutResult.metadata?.selectionBefore?.selection, [1, 4])
      expectSelectionIndexes(editor, undoCutResult.metadata?.selectionAfter?.selection, [1, 1])
      expect(readParagraphTexts(editor)).toEqual(['abcdef'])

      const redoCutResult = editor.redo()

      expect(redoCutResult.metadata?.commandName).toBe('deleteSelection')
      expect(redoCutResult.metadata?.origin).toBe('local-user')
      expectSelectionIndexes(editor, redoCutResult.metadata?.selectionAfter?.selection, [1, 1])
      expect(readParagraphTexts(editor)).toEqual(['aef'])

      const redoPasteResult = editor.redo()

      expect(redoPasteResult.metadata?.commandName).toBe('insertText')
      expect(redoPasteResult.metadata?.origin).toBe('local-user')
      expectSelectionIndexes(editor, redoPasteResult.metadata?.selectionAfter?.selection, [6, 6])
      expect(readParagraphTexts(editor)).toEqual(['aefXYZ'])
    } finally {
      editor.destroy()
    }
  })

  it('pastes sanitized rich text fragments through the transaction pipeline', () => {
    const host = document.createElement('div')
    const editor = createEditor({ initialText: 'ab' })
    const transactions = captureTransactions(editor)

    try {
      editor.mount(host)

      const anchor = editor.createTextAnchor({
        sectionId: 'section-1',
        blockId: 'paragraph-1',
        runId: 'run-1',
        graphemeIndex: 1
      })

      editor.setSelection(createSelectionState(anchor, anchor))
      editor.pasteRichTextFragment({
        paragraphs: [{
          properties: {
            alignment: 'center'
          },
          runs: [{
            text: 'Word',
            properties: {
              bold: true,
              italic: true,
              color: '#c00000',
              backgroundColor: '#fff2cc'
            }
          }, {
            text: ' 片段',
            properties: {
              underline: true
            }
          }]
        }, {
          properties: {
            listNumberingId: 'paste-bullet',
            listLevel: 0
          },
          runs: [{
            text: '列表',
            properties: {
              fontSizeTwips: 280
            }
          }]
        }]
      })

      expect(readParagraphTexts(editor)).toEqual(['aWord 片段', '列表b'])
      expect(readParagraphRunTexts(editor)).toEqual([
        ['a', 'Word', ' 片段'],
        ['列表', 'b']
      ])
      expect(readParagraphRunProperties(editor)).toMatchObject([
        [
          {},
          {
            bold: true,
            italic: true,
            color: '#c00000',
            backgroundColor: '#fff2cc'
          },
          {
            bold: false,
            italic: false,
            underline: true,
            color: null,
            backgroundColor: null
          }
        ],
        [
          {
            bold: false,
            italic: false,
            underline: false,
            color: null,
            backgroundColor: null,
            fontSizeTwips: 280
          },
          {}
        ]
      ])
      expect(readParagraphProperties(editor)).toEqual([
        {
          alignment: 'center'
        },
        {
          listNumberingId: 'paste-bullet',
          listLevel: 0
        }
      ])
      expect(transactions).toEqual([{
        commandName: 'pasteRichText',
        origin: 'local-user',
        operationKinds: [
          'insertText',
          'setRunProperties',
          'insertText',
          'setRunProperties',
          'splitBlock',
          'insertText',
          'setRunProperties',
          'setParagraphProperties',
          'setParagraphProperties'
        ],
        dirty: true
      }])
      expectSelectionIndexes(editor, editor.getSelection(), [2, 2])
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

function findPointerPointForGraphemeBias(
  editor: ReturnType<typeof createEditor>,
  pageIndex: number,
  graphemeIndex: number,
  bias: 'left' | 'center' | 'right'
) {
  const layout = editor.getLayout()
  const page = layout.pages[pageIndex]

  if (page === undefined) {
    throw new Error(`page ${pageIndex} 不存在`)
  }

  for (const line of page.lines) {
    for (const fragment of line.fragments) {
      if (
        graphemeIndex < fragment.start.graphemeIndex
        || graphemeIndex >= fragment.end.graphemeIndex
      ) {
        continue
      }

      const relativeIndex = graphemeIndex - fragment.start.graphemeIndex
      const graphemeStart = fragment.advanceTwips[relativeIndex] ?? 0
      const graphemeEnd = fragment.advanceTwips[relativeIndex + 1] ?? fragment.width
      const relativeX = bias === 'left'
        ? graphemeStart + ((graphemeEnd - graphemeStart) * 0.1)
        : bias === 'right'
          ? graphemeStart + ((graphemeEnd - graphemeStart) * 0.9)
          : graphemeStart + ((graphemeEnd - graphemeStart) * 0.5)

      return {
        clientX: twipsToCssPx(fragment.x - page.x + relativeX),
        clientY: twipsToCssPx(line.y - page.y + Math.max(1, line.height / 2))
      }
    }
  }

  throw new Error(`找不到 grapheme ${graphemeIndex} 的 ${bias} 命中点`)
}

function findPointerPointForImageRun(
  editor: ReturnType<typeof createEditor>,
  pageIndex: number,
  runId: string
) {
  const page = editor.getLayout().pages[pageIndex]

  if (page === undefined) {
    throw new Error(`page ${pageIndex} 不存在`)
  }

  for (const line of page.lines) {
    const inline = line.inlines.find((candidate) => candidate.runId === runId)

    if (inline !== undefined) {
      return {
        clientX: twipsToCssPx((inline.x - page.x) + (inline.width / 2)),
        clientY: twipsToCssPx((inline.y - page.y) + Math.max(1, inline.height / 2))
      }
    }
  }

  throw new Error(`找不到 image run ${runId} 的命中点`)
}

function readParagraphTexts(editor: ReturnType<typeof createEditor>) {
  return editor.getProjection().document.sections.flatMap((section) =>
    section.blocks.flatMap((block) => block.kind === 'paragraph'
      ? [block.runs.map((run) => run.inlines.flatMap((inline) => inline.kind === 'text' ? [inline.text] : []).join('')).join('')]
      : [])
  )
}

function readParagraphRunTexts(editor: ReturnType<typeof createEditor>) {
  return editor.getProjection().document.sections.flatMap((section) =>
    section.blocks.flatMap((block) => block.kind === 'paragraph'
      ? [block.runs.map((run) => run.inlines.flatMap((inline) => inline.kind === 'text' ? [inline.text] : []).join(''))]
      : [])
  )
}

function readParagraphRunProperties(editor: ReturnType<typeof createEditor>) {
  return editor.getProjection().document.sections.flatMap((section) =>
    section.blocks.flatMap((block) => block.kind === 'paragraph'
      ? [block.runs.map((run) => run.properties ?? {})]
      : [])
  )
}

/** 读取段落属性，验证富文本粘贴是否把段落级格式落入 projection。 */
function readParagraphProperties(editor: ReturnType<typeof createEditor>) {
  return editor.getProjection().document.sections.flatMap((section) =>
    section.blocks.flatMap((block) => block.kind === 'paragraph'
      ? [block.properties ?? {}]
      : [])
  )
}

function readInlineImageResourceIds(editor: ReturnType<typeof createEditor>) {
  return editor.getProjection().document.sections.flatMap((section) =>
    section.blocks.flatMap((block) => block.kind === 'paragraph'
      ? block.runs.flatMap((run) => run.inlines.flatMap((inline) => inline.kind === 'image' ? [inline.resourceId] : []))
      : [])
  )
}

function createResource(id: string): Resource {
  return {
    kind: 'resource',
    id,
    mime: 'image/png',
    source: {
      kind: 'dataUrl',
      url: 'data:image/png;base64,AAAA'
    },
    status: 'success'
  }
}

function insertInlineImageAtSelection(
  editor: ReturnType<typeof createEditor>,
  resource: Resource,
  anchor: Readonly<{
    sectionId: string
    blockId: string
    runId: string
    graphemeIndex: number
  }>
) {
  const runtimeAnchor = editor.createTextAnchor(anchor)
  const selection = createSelectionState(runtimeAnchor, runtimeAnchor)
  const command = buildInsertInlineImageCommand(editor.getProjection(), selection, resource, {
    widthTwips: 1440,
    heightTwips: 960
  })

  expect(command).not.toBeNull()
  editor.executeCommand(command!)
}

function readParagraphTailAnchor(editor: ReturnType<typeof createEditor>) {
  const paragraph = editor.getProjection().document.sections[0]?.blocks[0]

  if (paragraph?.kind !== 'paragraph') {
    throw new Error('expected paragraph block')
  }

  const tailRun = paragraph.runs[paragraph.runs.length - 1]

  if (tailRun === undefined) {
    throw new Error('expected tail run')
  }

  return {
    sectionId: 'section-1',
    blockId: paragraph.id,
    runId: tailRun.id,
    graphemeIndex: 0
  }
}

function captureTransactions(editor: ReturnType<typeof createEditor>) {
  const transactions: RecordedTransaction[] = []

  editor.subscribe((event) => {
    if (event.kind !== 'transaction') {
      return
    }

    transactions.push({
      commandName: event.transaction.commandName,
      origin: event.transaction.origin,
      operationKinds: [...event.transaction.operationKinds],
      dirty: event.transaction.dirty
    })
  })

  return transactions
}

function expectSelectionIndexes(
  editor: ReturnType<typeof createEditor>,
  selection: ReturnType<typeof createSelectionState> | null | undefined,
  expected: readonly [number, number]
) {
  expect(selection).not.toBeNull()
  expect(selection).toBeDefined()

  if (selection === null || selection === undefined) {
    return
  }

  expect([
    editor.resolveTextPosition(selection.anchor).graphemeIndex,
    editor.resolveTextPosition(selection.focus).graphemeIndex
  ]).toEqual(expected)
}

async function waitForDeferredSelectionTick() {
  await new Promise((resolve) => {
    setTimeout(resolve, 120)
  })
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
