/**
 * @vitest-environment jsdom
 *
 * 职责：验证 editor input runtime 的 pointer 命中、拖拽选择、双击选词与 selectionChange 流。
 * 边界：只覆盖 pointer selection 与相关 facade 事件，不测试 toolbar/demo 接线。
 * 协作模块：transaction pipeline、history、layout hit/caret 映射和 formatting builder 共同支撑“小文档可编辑”闭环。
 * 性能/安全约束：测试只运行在 jsdom，不访问网络或磁盘，不直接写 projection。
 * Specs：docs/superpowers/reports/2026-07-03-remediation-execution-supplement.md §3.10 T1。
 */
import { describe, expect, it } from 'vitest'

import { createEditor } from '../../src/index'
import { createSelectionState } from '../../src/model/selection'
import {
  captureTransactions,
  createClipboardTransfer,
  dispatchClipboard,
  dispatchKey,
  dispatchMouse,
  expectSelectionIndexes,
  findPointerPointForGrapheme,
  findPointerPointForGraphemeBias,
  getHiddenTextarea,
  getPageElement,
  mockPageRect,
  readParagraphTexts,
  waitForDeferredSelectionTick
} from './editor-test-helpers'

describe('Editor input runtime pointer', () => {
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
})
