/**
 * @vitest-environment node
 *
 * 职责：验证编辑器门面的命令执行、格式命令和段落格式公开接口。
 * 边界：只覆盖公开命令门面，不测试输入事件分发或 UI 控件。
 * 协作模块：编辑器运行时、命令构建器、选择模型和共享门面测试辅助函数。
 * 性能/安全约束：测试只读投影快照并通过事务管线变更文档，不访问 DOM。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import { describe, expect, it } from 'vitest'

import { buildSetBoldCommand } from '../../src/operations/command-builders'
import { createEditor } from '../../src/editor/runtime'
import { createSelectionState } from '../../src/model/selection'
import {
  readParagraphProperties,
  readParagraphRunProperties,
  readParagraphRunTexts
} from './facade-test-helpers'

describe('Editor facade command APIs', () => {
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


  it('does not mutate unselected text when toggling superscript and subscript on a collapsed caret', () => {
    const editor = createEditor({ initialText: 'abcdef' })
    const anchor = editor.createTextAnchor({
      sectionId: 'section-1',
      blockId: 'paragraph-1',
      runId: 'run-1',
      graphemeIndex: 2
    })
    const selection = createSelectionState(anchor, anchor)

    editor.setSelection(selection)
    editor.toggleSuperscript()

    expect(readParagraphRunTexts(editor.getProjection())).toEqual([['abcdef']])
    expect(readParagraphRunProperties(editor.getProjection())).toEqual([[{}]])
    expect(editor.getSelectionFormattingState().run?.superscript).toEqual({
      value: true,
      mixed: false
    })
    expect(editor.getSelectionFormattingState().run?.subscript).toEqual({
      value: false,
      mixed: false
    })

    editor.toggleSubscript()

    expect(readParagraphRunTexts(editor.getProjection())).toEqual([['abcdef']])
    expect(readParagraphRunProperties(editor.getProjection())).toEqual([[{}]])
    expect(editor.getSelectionFormattingState().run?.superscript).toEqual({
      value: false,
      mixed: false
    })
    expect(editor.getSelectionFormattingState().run?.subscript).toEqual({
      value: true,
      mixed: false
    })
    expect(editor.getSelection()).toBe(selection)

    editor.destroy()
  })


  it('applies paragraph facade formatting APIs through transactions', () => {
    const editor = createEditor({ initialText: 'first\n\nsecond' })
    const commands: string[] = []
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
      graphemeIndex: 3
    })
    const selection = createSelectionState(anchor, focus)
    const unsubscribe = editor.subscribe((event) => {
      if (event.kind === 'transaction') {
        commands.push(event.transaction.commandName)
      }
    })

    editor.setSelection(selection)
    editor.setParagraphAlignment('right')
    editor.adjustParagraphIndent(240)
    editor.setParagraphLineHeight(1.8)
    editor.setParagraphSpacingBefore(120)
    editor.setParagraphSpacingAfter(180)
    editor.setParagraphFirstLineIndent(360)
    editor.setParagraphHangingIndent(480)
    editor.setParagraphStyle('Heading2')
    editor.setParagraphList({
      numberingId: 'jword-list-ordered',
      level: 1
    })

    expect(readParagraphProperties(editor.getProjection())).toEqual([
      {
        alignment: 'right',
        indentLeftTwips: 240,
        spacingBeforeTwips: 120,
        spacingAfterTwips: 180,
        firstLineIndentTwips: 360,
        hangingIndentTwips: 480,
        styleId: 'Heading2',
        listNumberingId: 'jword-list-ordered',
        listLevel: 1
      },
      {
        alignment: 'right',
        indentLeftTwips: 240,
        spacingBeforeTwips: 120,
        spacingAfterTwips: 180,
        firstLineIndentTwips: 360,
        hangingIndentTwips: 480,
        styleId: 'Heading2',
        listNumberingId: 'jword-list-ordered',
        listLevel: 1
      }
    ])
    expect(readParagraphRunProperties(editor.getProjection())).toEqual([
      [{ lineHeight: 1.8 }],
      [{ lineHeight: 1.8 }]
    ])
    expect(editor.getSelectionFormattingState().paragraph).toEqual({
      alignment: { value: 'right', mixed: false },
      lineHeight: { value: 1.8, mixed: false },
      indentLeftTwips: { value: 240, mixed: false },
      spacingBeforeTwips: { value: 120, mixed: false },
      spacingAfterTwips: { value: 180, mixed: false },
      firstLineIndentTwips: { value: 360, mixed: false },
      hangingIndentTwips: { value: 480, mixed: false },
      styleId: { value: 'Heading2', mixed: false },
      list: {
        value: {
          numberingId: 'jword-list-ordered',
          level: 1
        },
        mixed: false
      }
    })
    expect(editor.getSelection()).toBe(selection)

    unsubscribe()
    editor.destroy()
    expect(commands).toEqual([
      'setParagraphAlignment',
      'adjustParagraphIndent',
      'setParagraphLineHeight',
      'setParagraphSpacingBefore',
      'setParagraphSpacingAfter',
      'setParagraphFirstLineIndent',
      'setParagraphHangingIndent',
      'setParagraphStyle',
      'setParagraphList'
    ])
  })


  it('reflects absolute paragraph indent and list clear commands in layout output', () => {
    const editor = createEditor({ initialText: '标题\n\n正文' })
    const commands: string[] = []
    const firstParagraph = editor.getProjection().document.sections[0]?.blocks[0]

    expect(firstParagraph?.kind).toBe('paragraph')

    const firstRunId = firstParagraph?.kind === 'paragraph' ? firstParagraph.runs[0]?.id : undefined
    const anchor = editor.createTextAnchor({
      sectionId: 'section-1',
      blockId: firstParagraph?.id ?? 'paragraph-1',
      runId: firstRunId ?? 'run-1',
      graphemeIndex: 0
    })
    const selection = createSelectionState(anchor, anchor)
    const unsubscribe = editor.subscribe((event) => {
      if (event.kind === 'transaction') {
        commands.push(event.transaction.commandName)
      }
    })

    editor.setSelection(selection)
    editor.setParagraphStyle('Heading1')
    editor.setParagraphIndent(720)
    editor.setParagraphList({
      numberingId: 'jword-list-ordered',
      level: 0
    })

    const listLayout = editor.getLayout()
    const page = listLayout.pages[0]
    const paragraph = page?.paragraphs.find((item) => item.paragraphId === firstParagraph?.id)
    const line = page?.lines.find((item) => item.paragraphId === firstParagraph?.id)
    const fragment = line?.fragments[0]

    expect(paragraph?.listMarker?.label).toBe('1.')
    expect(line?.x).toBe((page?.contentRect.x ?? 0) + 720)
    expect(fragment?.style.bold).toBe(true)
    expect(fragment?.style.fontSizePx).toBeGreaterThan(16)

    editor.setParagraphList(null)

    const clearedProjection = editor.getProjection().document.sections[0]?.blocks[0]
    const clearedLayout = editor.getLayout()
    const clearedParagraph = clearedLayout.pages[0]?.paragraphs.find((item) => item.paragraphId === firstParagraph?.id)

    expect(clearedProjection?.kind).toBe('paragraph')
    expect(clearedProjection?.kind === 'paragraph' ? clearedProjection.list : undefined).toBeUndefined()
    expect(clearedParagraph?.listMarker).toBeUndefined()
    expect(editor.getSelectionFormattingState().paragraph?.list).toEqual({
      value: null,
      mixed: false
    })

    unsubscribe()
    editor.destroy()
    expect(commands).toEqual([
      'setParagraphStyle',
      'setParagraphIndent',
      'setParagraphList',
      'setParagraphList'
    ])
  })

})
