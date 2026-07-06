/**
 * @vitest-environment jsdom
 *
 * 职责：验证 editor input runtime 的 plain text 与 rich text clipboard/paste 事务路径。
 * 边界：只覆盖 core facade clipboard 与 rich fragment 粘贴，不测试浏览器真实系统剪贴板。
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
  expectSelectionIndexes,
  getHiddenTextarea,
  readParagraphProperties,
  readParagraphRunLinks,
  readParagraphRunProperties,
  readParagraphRunTexts,
  readParagraphTexts
} from './editor-test-helpers'

describe('Editor input runtime clipboard', () => {
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

  it('pastes sanitized rich text links through the transaction pipeline', () => {
    const host = document.createElement('div')
    const editor = createEditor({ initialText: 'ab' })

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
          runs: [{
            text: 'docs',
            properties: {
              link: {
                target: 'https://example.com/docs'
              }
            }
          }]
        }]
      })

      expect(readParagraphRunTexts(editor)).toEqual([['a', 'docs', 'b']])
      expect(readParagraphRunLinks(editor)).toEqual([[undefined, {
        target: 'https://example.com/docs'
      }, undefined]])
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
