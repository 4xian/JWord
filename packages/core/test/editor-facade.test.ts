/**
 * @vitest-environment node
 *
 * 职责：验证 Gate 1 第一版 Editor facade 能创建文档、加载 fixture、执行 command 并发出事件。
 * 边界：只覆盖 facade 公开方法，不测试 DOM mount 生命周期、布局、渲染或输入。
 * 协作模块：文档状态、事务管线、只读投影、历史和位置提供底层能力。
 * 性能/安全约束：测试只读取本地 fixture 文件后把文本传入 core，不允许 core 自己读磁盘。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/03-architecture.md 与 04-engineering-standards.md#45-模块边界。
 */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { buildSetBoldCommand } from '../src/command-builders'
import { createEditor } from '../src/editor'
import { createSelectionState } from '../src/selection'

describe('Editor facade', () => {
  it('creates documents, loads fixture text, executes commands, and emits transaction events', async () => {
    const editor = createEditor()
    const events: string[] = []

    const unsubscribe = editor.subscribe((event) => {
      if (event.kind === 'transaction') {
        events.push(event.transaction.commandName)
      }
    })

    const projection = editor.createDocument({ text: '标题\n\n正文' })

    expect(projection.document.sections).toHaveLength(1)
    expect(projection.document.sections[0]?.blocks).toHaveLength(2)

    const fixtureText = await readFile(
      fileURLToPath(new URL('../../../fixtures/plain-text/minimal.txt', import.meta.url)),
      'utf8'
    )
    const loadedProjection = editor.loadFixture({
      name: 'minimal',
      text: fixtureText
    })

    expect(loadedProjection.document.sections).toHaveLength(1)
    expect(loadedProjection.document.sections[0]?.blocks).toHaveLength(2)

    const anchor = editor.createTextAnchor({
      sectionId: 'section-1',
      blockId: 'paragraph-1',
      runId: 'run-1',
      graphemeIndex: 0
    })

    const result = editor.executeCommand(
      {
        name: 'insertText',
        operations: [{ kind: 'insertText', at: editor.resolveTextPosition(anchor), text: 'J' }]
      },
      { origin: 'local-user', label: '输入首字母' }
    )

    expect(result.origin).toBe('local-user')
    expect(result.operationKinds).toEqual(['insertText'])
    expect(result.projection.document.sections[0]?.blocks[0]?.kind).toBe('paragraph')
    expect(events).toEqual(['createDocument', 'loadFixture', 'insertText'])

    unsubscribe()
    editor.destroy()

    expect(() => editor.getProjection()).toThrow(/destroyed/i)
  })

  it('returns a read-only projection snapshot', () => {
    const editor = createEditor({ initialText: '只读' })
    const projection = editor.getProjection()

    expect(() => {
      ;(projection.document.sections as unknown as string[]).push('x')
    }).toThrow()

    editor.destroy()
  })

  it('rejects blank origin before executing a command', () => {
    const editor = createEditor()

    expect(() =>
      editor.executeCommand(
        {
          name: 'insertText',
          operations: []
        },
        { origin: '   ' }
      )
    ).toThrow('事务 origin 不能为空')

    editor.destroy()
  })

  it('sets and reads the current runtime selection', () => {
    const editor = createEditor({ initialText: 'abc' })
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
      graphemeIndex: 2
    })
    const selection = createSelectionState(anchor, focus)

    expect(editor.getSelection()).toBeNull()

    editor.setSelection(selection)

    expect(editor.getSelection()).toBe(selection)

    editor.setSelection(null)

    expect(editor.getSelection()).toBeNull()

    editor.destroy()
  })

  it('通过 facade 暴露 selection formatting state，并在 selection 与命令执行后触发同步事件', () => {
    const editor = createEditor({ initialText: 'abcdef' })
    const observedBoldStates: boolean[] = []
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
      if (event.kind === 'selectionChange' && event.formattingState.run !== null) {
        observedBoldStates.push(event.formattingState.run.bold.value ?? false)
      }
    })

    editor.setSelection(selection)

    expect(editor.getSelectionFormattingState().run?.bold).toEqual({
      value: false,
      mixed: false
    })

    const command = buildSetBoldCommand(editor.getProjection(), editor.getSelection(), true)

    expect(command).not.toBeNull()

    const result = editor.executeCommand(command!, {
      selectionAfter: selection
    })

    expect(readParagraphRunTexts(result.projection)).toEqual([['a', 'bcde', 'f']])
    expect(readParagraphRunProperties(result.projection)).toEqual([[{}, { bold: true }, {}]])
    expect(editor.getSelectionFormattingState().run?.bold).toEqual({
      value: true,
      mixed: false
    })
    expect(observedBoldStates).toEqual([false, true])

    unsubscribe()
    editor.destroy()
  })

  it('clears the current runtime selection after createDocument replaces the document', () => {
    const editor = createEditor({ initialText: 'abc' })
    const anchor = editor.createTextAnchor({
      sectionId: 'section-1',
      blockId: 'paragraph-1',
      runId: 'run-1',
      graphemeIndex: 1
    })
    const selection = createSelectionState(anchor, anchor)

    editor.setSelection(selection)
    editor.createDocument({ text: '新的文档' })

    expect(editor.getSelection()).toBeNull()

    editor.destroy()
  })

  it('clears the current runtime selection after loadFixture replaces the document', () => {
    const editor = createEditor({ initialText: 'abc' })
    const anchor = editor.createTextAnchor({
      sectionId: 'section-1',
      blockId: 'paragraph-1',
      runId: 'run-1',
      graphemeIndex: 1
    })
    const selection = createSelectionState(anchor, anchor)

    editor.setSelection(selection)
    editor.loadFixture({ name: 'replacement', text: 'fixture 文档' })

    expect(editor.getSelection()).toBeNull()

    editor.destroy()
  })

  it('reports grapheme length when creating an out-of-bounds text anchor', () => {
    const editor = createEditor({ initialText: 'a😊e\u0301中' })

    expect(() =>
      editor.createTextAnchor({
        sectionId: 'section-1',
        blockId: 'paragraph-1',
        runId: 'run-1',
        graphemeIndex: -1
      })
    ).toThrowError(expect.objectContaining({
      code: 'OPERATION_TEXT_INDEX_OUT_OF_BOUNDS',
      details: {
        index: -1,
        length: 4
      }
    }))

    editor.destroy()
  })

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

  it('bridges Gate 2 hit-test and rect mapping through AnchorRef and RangeRef', () => {
    const editor = createEditor({ initialText: 'abcd' })
    const layout = editor.getLayout()
    const fragment = layout.pages[0]?.lines[0]?.fragments[0]

    expect(fragment).toBeDefined()

    const anchor = editor.hitTest({
      pageIndex: 0,
      x: (fragment?.x ?? 0) + (fragment?.advanceTwips[1] ?? 0) + 1,
      y: (fragment?.y ?? 0) + 1
    })

    expect(anchor).toBeDefined()

    const focus = editor.createTextAnchor({
      sectionId: 'section-1',
      blockId: 'paragraph-1',
      runId: 'run-1',
      graphemeIndex: 3
    })
    const caret = editor.getCaretRect(anchor!)
    const selection = createSelectionState(anchor!, focus)
    const rects = editor.getSelectionRects(selection.range)

    expect(caret?.width).toBe(0)
    expect(rects.length).toBeGreaterThan(0)

    editor.destroy()
  })

  it('keeps hitTest -> AnchorRef -> caret rect stable at a shared fragment boundary in the same run', () => {
    const editor = createEditor({ initialText: 'abcdef' })
    const layout = editor.getLayout()
    const secondFragment = layout.pages[0]?.lines[0]?.fragments[1]

    expect(secondFragment).toBeDefined()

    const anchor = editor.hitTest({
      pageIndex: 0,
      x: (secondFragment?.x ?? 0) + 1,
      y: (secondFragment?.y ?? 0) + 1
    })
    const caret = anchor === undefined ? undefined : editor.getCaretRect(anchor)

    expect(anchor).toBeDefined()
    expect(caret).toMatchObject({
      pageIndex: secondFragment?.pageIndex,
      x: secondFragment?.x,
      y: secondFragment?.y
    })

    editor.destroy()
  })
})

function readParagraphRunTexts(projection: ReturnType<ReturnType<typeof createEditor>['getProjection']>) {
  return projection.document.sections.flatMap((section) =>
    section.blocks.flatMap((block) => block.kind === 'paragraph'
      ? [block.runs.map((run) => run.inlines.flatMap((inline) => inline.kind === 'text' ? [inline.text] : []).join(''))]
      : [])
  )
}

function readParagraphRunProperties(projection: ReturnType<ReturnType<typeof createEditor>['getProjection']>) {
  return projection.document.sections.flatMap((section) =>
    section.blocks.flatMap((block) => block.kind === 'paragraph'
      ? [block.runs.map((run) => run.properties ?? {})]
      : [])
  )
}
