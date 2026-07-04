/**
 * @vitest-environment node
 *
 * 职责：验证 editor transaction 对单条 deleteRange 跨 run/跨段的历史恢复。
 * 边界：只覆盖命令流水线、operation adapter 与 undo 协同，不覆盖 DOM 输入、布局或渲染。
 * 协作模块：operation adapter、transaction pipeline 与 history 共同保证删除原子性。
 * 性能/安全约束：测试只使用内存 Y.Doc，不访问 DOM、网络或磁盘。
 * Specs：docs/superpowers/reports/2026-07-03-remediation-execution-supplement.md#31-g1-02-deleterange-跨-run--跨块phase-1b-m-l。
 */

import { describe, expect, it } from 'vitest'

import { createEditor } from '../../src/index'

describe('deleteRange transaction runtime', () => {
  it('uses one undo step to restore a direct deleteRange across runs', () => {
    const editor = createEditor({ initialText: 'abcdef' })

    try {
      editor.executeCommand({
        name: 'prepareRuns',
        operations: [{
          kind: 'setRunProperties',
          runId: 'run-1',
          properties: { bold: true },
          range: {
            startGraphemeIndex: 3,
            endGraphemeIndex: 6,
            formattedRunId: 'run-2'
          }
        }]
      })

      const paragraph = readParagraphs(editor)[0]!
      const firstRun = paragraph.runs[0]!
      const secondRun = paragraph.runs[1]!

      editor.executeCommand({
        name: 'deleteCrossRunFixture',
        operations: [{
          kind: 'deleteRange',
          range: {
            anchor: {
              sectionId: 'section-1',
              blockId: paragraph.id,
              runId: firstRun.id,
              graphemeIndex: 1
            },
            focus: {
              sectionId: 'section-1',
              blockId: paragraph.id,
              runId: secondRun.id,
              graphemeIndex: 2
            }
          }
        }]
      })

      expect(readParagraphTexts(editor)).toEqual(['af'])

      const undoResult = editor.undo()

      expect(undoResult.metadata?.commandName).toBe('deleteCrossRunFixture')
      expect(readParagraphRunTexts(editor)).toEqual([['abc', 'def']])
    } finally {
      editor.destroy()
    }
  })

  it('uses one undo step to restore a direct deleteRange across paragraphs', () => {
    const editor = createEditor({ initialText: 'abc\n\ndef' })

    try {
      const paragraphs = readParagraphs(editor)
      const firstParagraph = paragraphs[0]!
      const secondParagraph = paragraphs[1]!
      const firstRun = firstParagraph.runs[0]!
      const secondRun = secondParagraph.runs[0]!

      editor.executeCommand({
        name: 'deleteCrossParagraphFixture',
        operations: [{
          kind: 'deleteRange',
          range: {
            anchor: {
              sectionId: 'section-1',
              blockId: firstParagraph.id,
              runId: firstRun.id,
              graphemeIndex: 1
            },
            focus: {
              sectionId: 'section-1',
              blockId: secondParagraph.id,
              runId: secondRun.id,
              graphemeIndex: 2
            }
          }
        }]
      })

      expect(readParagraphTexts(editor)).toEqual(['af'])

      const undoResult = editor.undo()

      expect(undoResult.metadata?.commandName).toBe('deleteCrossParagraphFixture')
      expect(readParagraphTexts(editor)).toEqual(['abc', 'def'])
    } finally {
      editor.destroy()
    }
  })
})

/** 读取当前 projection 中的正文段落。 */
function readParagraphs(editor: ReturnType<typeof createEditor>) {
  return editor.getProjection().document.sections.flatMap((section) =>
    section.blocks.flatMap((block) => block.kind === 'paragraph' ? [block] : [])
  )
}

/** 读取段落合并后的纯文本。 */
function readParagraphTexts(editor: ReturnType<typeof createEditor>): readonly string[] {
  return readParagraphRunTexts(editor).map((runs) => runs.join(''))
}

/** 逐段读取每个 run 的纯文本。 */
function readParagraphRunTexts(editor: ReturnType<typeof createEditor>): readonly (readonly string[])[] {
  return readParagraphs(editor).map((paragraph) =>
    paragraph.runs.map((run) =>
      run.inlines.flatMap((inline) => inline.kind === 'text' ? [inline.text] : []).join('')
    )
  )
}
