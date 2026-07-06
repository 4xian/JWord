/**
 * @vitest-environment jsdom
 *
 * 职责：验证 editor input runtime 的 IME composition 提交、去重和组合态快捷键屏蔽。
 * 边界：只覆盖 composition 事件路径，不测试普通键盘、pointer、clipboard 或 image 专项。
 * 协作模块：transaction pipeline、history、layout hit/caret 映射和 formatting builder 共同支撑“小文档可编辑”闭环。
 * 性能/安全约束：测试只运行在 jsdom，不访问网络或磁盘，不直接写 projection。
 * Specs：docs/superpowers/reports/2026-07-03-remediation-execution-supplement.md §3.10 T1。
 */
import { describe, expect, it } from 'vitest'

import { createEditor } from '../../src/index'
import { createSelectionState } from '../../src/model/selection'
import {
  captureTransactions,
  dispatchCompositionEvent,
  dispatchKey,
  dispatchTextInput,
  expectSelectionIndexes,
  getHiddenTextarea,
  readParagraphTexts
} from './editor-test-helpers'

describe('Editor input runtime composition', () => {
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
})
