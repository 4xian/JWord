/**
 * @vitest-environment jsdom
 *
 * 职责：验证 editor input runtime 的异常恢复与错误事件上报。
 * 边界：只覆盖输入处理异常可恢复路径，不扩展其它键盘能力断言。
 * 协作模块：transaction pipeline、history、layout hit/caret 映射和 formatting builder 共同支撑“小文档可编辑”闭环。
 * 性能/安全约束：测试只运行在 jsdom，不访问网络或磁盘，不直接写 projection。
 * Specs：docs/superpowers/reports/2026-07-03-remediation-execution-supplement.md §3.10 T1。
 */
import { describe, expect, it } from 'vitest'

import { createEditor } from '../../src/index'
import type { DocumentId, RunId, SectionId, BlockId } from '../../src/model/position'
import { createAnchorRef, createGraphemeIndex } from '../../src/model/position'
import { createSelectionState } from '../../src/model/selection'
import {
  captureTransactions,
  dispatchKey,
  dispatchTextInput,
  expectSelectionIndexes,
  getHiddenTextarea,
  readParagraphTexts
} from './editor-test-helpers'

interface RecordedEditorErrorEvent {
  readonly kind: string
  readonly code?: string
  readonly commandName?: string
  readonly message?: string
  readonly recoverable?: boolean
}

describe('Editor input runtime errors', () => {
  it('supports basic keyboard editing, formatting shortcuts, and keeps working after a handler failure', () => {
    const host = document.createElement('div')
    const editor = createEditor({ initialText: 'abc' })
    const transactions = captureTransactions(editor)
    const errors: RecordedEditorErrorEvent[] = []

    try {
      editor.subscribe((event) => {
        const recorded = event as RecordedEditorErrorEvent

        if (recorded.kind === 'error') {
          errors.push(recorded)
        }
      })
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
      expect(errors).toEqual([{
        kind: 'error',
        code: 'OPERATION_BLOCK_NOT_FOUND',
        commandName: 'insertText',
        message: '找不到块',
        recoverable: true,
        details: {
          blockId: 'missing-paragraph'
        }
      }])

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
})
