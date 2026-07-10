/**
 * @vitest-environment jsdom
 *
 * 职责：验证 Gate 3 键盘补齐项，覆盖 PageUp/PageDown、逐词移动删除和 Tab 行为。
 * 边界：只通过已挂载 editor facade 触发 hidden textarea keydown，不访问运行时私有实现。
 * 协作模块：输入运行时、键盘文本运行时、事务流水线和布局查询共同支撑键盘语义。
 * 性能/安全约束：测试只运行在 jsdom，不访问网络或磁盘，不直接写 projection。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import { describe, expect, it } from 'vitest'

import { buildInsertTableCommand, createEditor } from '../../src/index'
import type { TableCell } from '../../src/model/types'
import { createSelectionState } from '../../src/model/selection'

describe('Editor keyboard runtime remediation', () => {
  it('supports PageUp and PageDown by moving the caret by a viewport worth of layout lines', () => {
    const host = document.createElement('div')
    const editor = createEditor({ initialText: 'A'.repeat(1400) })

    try {
      editor.mount(host)
      Object.defineProperty(getCanvasContainer(host), 'clientHeight', { configurable: true, value: 120 })

      const lines = editor.getLayout().pages.flatMap((page) => page.lines.filter((line) => line.fragments.length > 0))
      const startFragment = lines[2]!.fragments[0]!
      const start = editor.createTextAnchor(startFragment.start)
      const textarea = getHiddenTextarea(host)

      expect(lines.length).toBeGreaterThan(8)

      editor.setSelection(createSelectionState(start, start))
      dispatchKey(textarea, 'PageDown')

      const pageDownIndex = editor.resolveTextPosition(editor.getSelection()!.focus).graphemeIndex

      expect(pageDownIndex).toBeGreaterThan(startFragment.start.graphemeIndex)

      dispatchKey(textarea, 'PageUp')
      expect(editor.resolveTextPosition(editor.getSelection()!.focus).graphemeIndex).toBeLessThan(pageDownIndex)
    } finally {
      editor.destroy()
    }
  })

  it('supports Ctrl and Alt word-wise Arrow movement and selection expansion', () => {
    const host = document.createElement('div')
    const editor = createEditor({ initialText: 'hello world again' })

    try {
      editor.mount(host)

      const textarea = getHiddenTextarea(host)
      const anchor = editor.createTextAnchor({ sectionId: 'section-1', blockId: 'paragraph-1', runId: 'run-1', graphemeIndex: 0 })

      editor.setSelection(createSelectionState(anchor, anchor))
      dispatchKey(textarea, 'ArrowRight', { ctrlKey: true })
      expectSelectionIndexes(editor, [5, 5])

      dispatchKey(textarea, 'ArrowRight', { altKey: true, shiftKey: true })
      expectSelectionIndexes(editor, [5, 11])

      dispatchKey(textarea, 'ArrowLeft', { ctrlKey: true })
      expectSelectionIndexes(editor, [5, 5])
    } finally {
      editor.destroy()
    }
  })

  it('supports Ctrl Backspace and Ctrl Delete word-wise deletion', () => {
    const host = document.createElement('div')
    const editor = createEditor({ initialText: 'hello world again' })

    try {
      editor.mount(host)

      const textarea = getHiddenTextarea(host)
      const anchor = editor.createTextAnchor({ sectionId: 'section-1', blockId: 'paragraph-1', runId: 'run-1', graphemeIndex: 11 })

      editor.setSelection(createSelectionState(anchor, anchor))
      dispatchKey(textarea, 'Backspace', { ctrlKey: true })
      expect(readParagraphTexts(editor)).toEqual(['hello  again'])
      expectSelectionIndexes(editor, [6, 6])

      dispatchKey(textarea, 'Delete', { ctrlKey: true })
      expect(readParagraphTexts(editor)).toEqual(['hello '])
      expectSelectionIndexes(editor, [6, 6])
    } finally {
      editor.destroy()
    }
  })

  it('keeps Tab inside the editor by increasing and decreasing paragraph indent', () => {
    const host = document.createElement('div')
    const editor = createEditor({ initialText: 'abcd' })

    try {
      editor.mount(host)

      const textarea = getHiddenTextarea(host)
      const anchor = editor.createTextAnchor({ sectionId: 'section-1', blockId: 'paragraph-1', runId: 'run-1', graphemeIndex: 2 })

      editor.setSelection(createSelectionState(anchor, anchor))
      dispatchKey(textarea, 'Tab')

      expect(readParagraphTexts(editor)).toEqual(['abcd'])
      expect(readParagraphProperties(editor)[0]?.indentLeftTwips).toBe(360)
      expectSelectionIndexes(editor, [2, 2])

      dispatchKey(textarea, 'Tab', { shiftKey: true })
      expect(readParagraphProperties(editor)[0]?.indentLeftTwips ?? 0).toBe(0)
    } finally {
      editor.destroy()
    }
  })

  it('moves Tab and Shift Tab between adjacent table cells', () => {
    const host = document.createElement('div')
    const editor = createEditor({ initialText: 'seed' })

    try {
      editor.mount(host)

      const textarea = getHiddenTextarea(host)
      const command = buildInsertTableCommand(editor.getProjection(), null, { rows: 1, columns: 2 })

      expect(command).not.toBeNull()
      editor.executeCommand(command!)

      const cells = readFirstTableCells(editor)
      const firstPosition = readTableCellStartPosition(cells[0]!)
      const secondPosition = readTableCellStartPosition(cells[1]!)
      const firstAnchor = editor.createTextAnchor(firstPosition)

      editor.setSelection(createSelectionState(firstAnchor, firstAnchor))
      dispatchKey(textarea, 'Tab')
      expect(editor.resolveTextPosition(editor.getSelection()!.focus)).toMatchObject(secondPosition)

      dispatchKey(textarea, 'Tab', { shiftKey: true })
      expect(editor.resolveTextPosition(editor.getSelection()!.focus)).toMatchObject(firstPosition)
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

function getCanvasContainer(host: HTMLElement): HTMLElement {
  const container = host.querySelector('[data-jword-canvas-container]')

  if (!(container instanceof HTMLElement)) {
    throw new Error('canvas container 未挂载')
  }

  return container
}

function dispatchKey(
  textarea: HTMLTextAreaElement,
  key: string,
  options: Pick<KeyboardEventInit, 'ctrlKey' | 'altKey' | 'shiftKey'> = {}
) {
  textarea.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options }))
}

function readFirstTableCells(editor: ReturnType<typeof createEditor>): readonly TableCell[] {
  const table = editor.getProjection().document.sections[0]?.blocks.find((block) => block.kind === 'table')

  if (table?.kind !== 'table') {
    throw new Error('expected table block')
  }

  return table.rows.flatMap((row) => row.cells)
}

function readTableCellStartPosition(cell: TableCell) {
  const paragraph = cell.blocks.find((block) => block.kind === 'paragraph')
  const run = paragraph?.kind === 'paragraph' ? paragraph.runs[0] : undefined

  if (paragraph?.kind !== 'paragraph' || run === undefined) {
    throw new Error('expected text paragraph in table cell')
  }

  return { sectionId: 'section-1', blockId: paragraph.id, runId: run.id, graphemeIndex: 0 }
}

function readParagraphTexts(editor: ReturnType<typeof createEditor>) {
  return editor.getProjection().document.sections.flatMap((section) =>
    section.blocks.flatMap((block) => block.kind === 'paragraph'
      ? [block.runs.map((run) => run.inlines.flatMap((inline) => inline.kind === 'text' ? [inline.text] : []).join('')).join('')]
      : [])
  )
}

function readParagraphProperties(editor: ReturnType<typeof createEditor>) {
  return editor.getProjection().document.sections.flatMap((section) =>
    section.blocks.flatMap((block) => block.kind === 'paragraph' ? [block.properties ?? {}] : [])
  )
}

function expectSelectionIndexes(editor: ReturnType<typeof createEditor>, expected: readonly [number, number]) {
  const selection = editor.getSelection()

  expect(selection).not.toBeNull()

  if (selection === null) {
    return
  }

  expect([
    editor.resolveTextPosition(selection.anchor).graphemeIndex,
    editor.resolveTextPosition(selection.focus).graphemeIndex
  ]).toEqual(expected)
}
