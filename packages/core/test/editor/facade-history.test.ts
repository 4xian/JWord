/**
 * @vitest-environment node
 *
 * 职责：验证编辑器门面在撤销重做中恢复选择和格式历史元数据。
 * 边界：只覆盖历史公开接口，不测试持久化、协作或 UI 历史面板。
 * 协作模块：编辑器运行时、选择模型、事务历史和共享门面测试辅助函数。
 * 性能/安全约束：测试只运行内存内事务，不访问 DOM、网络或磁盘。
 * Specs：docs/superpowers/reports/2026-07-03-remediation-execution-supplement.md §3.10 T3。
 */

import { describe, expect, it } from 'vitest'

import { createEditor } from '../../src/editor/runtime'
import { createSelectionState } from '../../src/model/selection'
import { readParagraphRunProperties, readParagraphRunTexts } from './facade-test-helpers'

describe('Editor facade history APIs', () => {
  it('restores selection around undo and redo through history metadata', () => {
    const editor = createEditor({ initialText: 'abc' })
    const insertionAnchor = editor.createTextAnchor({
      sectionId: 'section-1',
      blockId: 'paragraph-1',
      runId: 'run-1',
      graphemeIndex: 1
    })
    const beforeSelection = createSelectionState(insertionAnchor, insertionAnchor)

    editor.setSelection(beforeSelection)

    const afterAnchor = editor.createTextAnchor({
      sectionId: 'section-1',
      blockId: 'paragraph-1',
      runId: 'run-1',
      graphemeIndex: 2
    })
    const afterSelection = createSelectionState(afterAnchor, afterAnchor)

    editor.executeCommand(
      {
        name: 'insertText',
        operations: [
          {
            kind: 'insertText',
            at: editor.resolveTextPosition(insertionAnchor),
            text: 'X'
          }
        ]
      },
      { selectionAfter: afterSelection }
    )

    expect(editor.getSelection()).toBe(afterSelection)

    const undoResult = editor.undo()

    expect(undoResult.metadata?.selectionBefore?.selection).toBe(beforeSelection)
    expect(editor.getSelection()).toBe(beforeSelection)

    const redoResult = editor.redo()

    expect(redoResult.metadata?.selectionAfter?.selection).toBe(afterSelection)
    expect(editor.getSelection()).toBe(afterSelection)

    editor.destroy()
  })


  it('restores selection positions around undo and redo across multi-code-unit graphemes', () => {
    const editor = createEditor({ initialText: 'a😊e\u0301中' })
    const insertionAnchor = editor.createTextAnchor({
      sectionId: 'section-1',
      blockId: 'paragraph-1',
      runId: 'run-1',
      graphemeIndex: 2
    })
    const beforeAnchor = editor.createTextAnchor({
      sectionId: 'section-1',
      blockId: 'paragraph-1',
      runId: 'run-1',
      graphemeIndex: 1
    })
    const beforeFocus = editor.createTextAnchor({
      sectionId: 'section-1',
      blockId: 'paragraph-1',
      runId: 'run-1',
      graphemeIndex: 3
    })
    const beforeSelection = createSelectionState(beforeAnchor, beforeFocus)
    const afterAnchor = editor.createTextAnchor({
      sectionId: 'section-1',
      blockId: 'paragraph-1',
      runId: 'run-1',
      graphemeIndex: 4
    })
    const afterSelection = createSelectionState(afterAnchor, afterAnchor)

    editor.setSelection(beforeSelection)
    editor.executeCommand(
      {
        name: 'insertText',
        operations: [
          {
            kind: 'insertText',
            at: editor.resolveTextPosition(insertionAnchor),
            text: 'X'
          }
        ]
      },
      { selectionAfter: afterSelection }
    )

    editor.undo()

    const undoSelection = editor.getSelection()

    expect(undoSelection?.anchor).toBe(beforeAnchor)
    expect(undoSelection?.focus).toBe(beforeFocus)
    expect(editor.resolveTextPosition(beforeAnchor).graphemeIndex).toBe(1)
    expect(editor.resolveTextPosition(beforeFocus).graphemeIndex).toBe(3)

    editor.redo()

    const redoSelection = editor.getSelection()

    expect(redoSelection?.anchor).toBe(afterAnchor)
    expect(redoSelection?.focus).toBe(afterAnchor)
    expect(editor.resolveTextPosition(afterAnchor).graphemeIndex).toBe(5)

    editor.destroy()
  })


  it('restores a cleared selection after redo', () => {
    const editor = createEditor({ initialText: 'abc' })
    const insertionAnchor = editor.createTextAnchor({
      sectionId: 'section-1',
      blockId: 'paragraph-1',
      runId: 'run-1',
      graphemeIndex: 1
    })
    const beforeSelection = createSelectionState(insertionAnchor, insertionAnchor)

    editor.setSelection(beforeSelection)
    editor.executeCommand(
      {
        name: 'insertText',
        operations: [
          {
            kind: 'insertText',
            at: editor.resolveTextPosition(insertionAnchor),
            text: 'X'
          }
        ]
      },
      { selectionAfter: null }
    )

    expect(editor.getSelection()).toBeNull()

    editor.undo()

    expect(editor.getSelection()).toBe(beforeSelection)

    editor.redo()

    expect(editor.getSelection()).toBeNull()

    editor.destroy()
  })


  it('falls back to the current document start when restored history selection points to deleted content', () => {
    const editor = createEditor({ initialText: 'abc\n\ndef' })
    const deletedAnchor = editor.createTextAnchor({
      sectionId: 'section-1',
      blockId: 'paragraph-1',
      runId: 'run-1',
      graphemeIndex: 1
    })
    const staleSelection = createSelectionState(deletedAnchor, deletedAnchor)

    editor.executeCommand(
      {
        name: 'deleteFirstParagraphForSelectionRestore',
        operations: [{
          kind: 'deleteBlock',
          blockId: 'paragraph-1'
        }]
      },
      { selectionAfter: staleSelection }
    )

    editor.undo()
    editor.redo()

    const restoredPosition = editor.resolveTextPosition(editor.getSelection()!.focus)

    expect(restoredPosition).toMatchObject({
      sectionId: 'section-1',
      blockId: 'paragraph-2',
      runId: 'run-2',
      graphemeIndex: 0
    })

    editor.destroy()
  })


  it('exposes facade formatting APIs and keeps selection through transaction history metadata', () => {
    const editor = createEditor({ initialText: 'abcdef' })
    const commands: string[] = []
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
      graphemeIndex: 5
    })
    const selection = createSelectionState(anchor, focus)
    const unsubscribe = editor.subscribe((event) => {
      if (event.kind === 'transaction') {
        commands.push(event.transaction.commandName)
      }
    })

    editor.setSelection(selection)
    editor.toggleBold()

    expect(readParagraphRunTexts(editor.getProjection())).toEqual([['a', 'bcde', 'f']])
    expect(readParagraphRunProperties(editor.getProjection())).toEqual([[{}, { bold: true }, {}]])
    expect(editor.getSelection()).toBe(selection)

    editor.undo()
    expect(readParagraphRunTexts(editor.getProjection())).toEqual([['abcdef']])
    expect(editor.getSelection()).toBe(selection)

    editor.redo()
    expect(readParagraphRunProperties(editor.getProjection())).toEqual([[{}, { bold: true }, {}]])
    expect(editor.getSelection()).toBe(selection)

    unsubscribe()
    editor.destroy()
    expect(commands).toEqual(['setBold'])
  })


  it('keeps superscript 和 subscript 在 facade、selection formatting state 与 undo/redo 中互斥一致', () => {
    const editor = createEditor({ initialText: 'abcdef' })
    const commands: string[] = []
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
      graphemeIndex: 5
    })
    const selection = createSelectionState(anchor, focus)
    const unsubscribe = editor.subscribe((event) => {
      if (event.kind === 'transaction') {
        commands.push(event.transaction.commandName)
      }
    })

    editor.setSelection(selection)
    editor.toggleSuperscript()

    expect(readParagraphRunTexts(editor.getProjection())).toEqual([['a', 'bcde', 'f']])
    expect(readParagraphRunProperties(editor.getProjection())).toEqual([
      [{}, { superscript: true, subscript: false }, {}]
    ])
    expect(editor.getSelectionFormattingState().run?.superscript).toEqual({
      value: true,
      mixed: false
    })
    expect(editor.getSelectionFormattingState().run?.subscript).toEqual({
      value: false,
      mixed: false
    })

    editor.toggleSubscript()

    expect(readParagraphRunTexts(editor.getProjection())).toEqual([['a', 'bcde', 'f']])
    expect(readParagraphRunProperties(editor.getProjection())).toEqual([
      [{}, { superscript: false, subscript: true }, {}]
    ])
    expect(editor.getSelectionFormattingState().run?.superscript).toEqual({
      value: false,
      mixed: false
    })
    expect(editor.getSelectionFormattingState().run?.subscript).toEqual({
      value: true,
      mixed: false
    })
    expect(editor.getSelection()).toBe(selection)

    editor.undo()

    expect(readParagraphRunProperties(editor.getProjection())).toEqual([
      [{}, { superscript: true, subscript: false }, {}]
    ])
    expect(editor.getSelectionFormattingState().run?.superscript).toEqual({
      value: true,
      mixed: false
    })
    expect(editor.getSelectionFormattingState().run?.subscript).toEqual({
      value: false,
      mixed: false
    })
    expect(editor.getSelection()).toBe(selection)

    editor.redo()

    expect(readParagraphRunProperties(editor.getProjection())).toEqual([
      [{}, { superscript: false, subscript: true }, {}]
    ])
    expect(editor.getSelectionFormattingState().run?.superscript).toEqual({
      value: false,
      mixed: false
    })
    expect(editor.getSelectionFormattingState().run?.subscript).toEqual({
      value: true,
      mixed: false
    })
    expect(editor.getSelection()).toBe(selection)

    unsubscribe()
    editor.destroy()
    expect(commands).toEqual(['setSuperscript', 'setSubscript'])
  })

})
