/**
 * @vitest-environment node
 *
 * 职责：验证 Gate 4 查找替换使用稳定 range 快照并通过事务命令写入。
 * 边界：只覆盖单 run 文本匹配与替换命令构造，不实现跨 run 搜索或 UI 面板。
 * 协作模块：编辑器门面、稳定范围快照、事务流水线与查找替换辅助函数。
 * 性能/安全约束：测试只使用内存文档，不访问 DOM、网络或磁盘。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import { describe, expect, test } from 'vitest'

import { buildSetBoldCommand, createEditor } from '../../src/index'
import { createSelectionState } from '../../src/model/selection'
import {
  buildReplaceMatchCommand,
  findTextMatches,
  replaceAllMatches
} from '../../src/find-replace/find-replace'

describe('find replace', () => {
  test('会用稳定 range 快照定位查找结果，并构造 transaction 替换命令', () => {
    const editor = createEditor({ initialText: 'alpha beta alpha' })
    const matches = findTextMatches(editor, 'alpha')

    expect(matches.map((match) => match.text)).toEqual(['alpha', 'alpha'])

    editor.executeCommand({
      name: 'insertText',
      operations: [{
        kind: 'insertText',
        at: {
          sectionId: 'section-1',
          blockId: 'paragraph-1',
          runId: 'run-1',
          graphemeIndex: 0
        },
        text: '>'
      }]
    })

    const command = buildReplaceMatchCommand(editor, matches[0]!, 'ALPHA')

    expect(command).toEqual({
      name: 'replaceTextMatch',
      operations: [
        {
          kind: 'deleteRange',
          range: {
            anchor: {
              sectionId: 'section-1',
              blockId: 'paragraph-1',
              runId: 'run-1',
              graphemeIndex: 1
            },
            focus: {
              sectionId: 'section-1',
              blockId: 'paragraph-1',
              runId: 'run-1',
              graphemeIndex: 6
            }
          }
        },
        {
          kind: 'insertText',
          at: {
            sectionId: 'section-1',
            blockId: 'paragraph-1',
            runId: 'run-1',
            graphemeIndex: 1
          },
          text: 'ALPHA'
        }
      ]
    })

    editor.executeCommand(command!)

    expect(readDocumentText(editor)).toBe('>ALPHA beta alpha')

    editor.destroy()
  })

  test('会按倒序替换所有结果，避免早期替换移动后续结果', () => {
    const editor = createEditor({ initialText: 'alpha beta alpha' })
    const result = replaceAllMatches(editor, 'alpha', 'A')

    expect(result.replacedCount).toBe(2)
    expect(result.commandNames).toEqual(['replaceTextMatch', 'replaceTextMatch'])
    expect(readDocumentText(editor)).toBe('A beta A')

    editor.destroy()
  })

  test('能在大小写不敏感模式下匹配并替换跨 run 文本', () => {
    const editor = createEditor({ initialText: 'AlphaBeta alphaBeta' })

    editor.setSelection(createSelectionState(
      editor.createTextAnchor({
        sectionId: 'section-1',
        blockId: 'paragraph-1',
        runId: 'run-1',
        graphemeIndex: 3
      }),
      editor.createTextAnchor({
        sectionId: 'section-1',
        blockId: 'paragraph-1',
        runId: 'run-1',
        graphemeIndex: 8
      })
    ))
    editor.executeCommand(buildSetBoldCommand(editor.getProjection(), editor.getSelection(), true)!)

    const caseSensitiveMatches = findTextMatches(editor, 'alphabeta')
    const insensitiveMatches = findTextMatches(editor, 'alphabeta', {
      caseSensitive: false
    })

    expect(readParagraphRunTexts(editor)).toEqual([['Alp', 'haBet', 'a alphaBeta']])
    expect(caseSensitiveMatches).toHaveLength(0)
    expect(insensitiveMatches.map((match) => ({
      text: match.text,
      start: editor.locateRangeSnapshot(match.rangeSnapshot)?.anchor.graphemeIndex,
      end: editor.locateRangeSnapshot(match.rangeSnapshot)?.focus.graphemeIndex
    }))).toEqual([
      {
        text: 'AlphaBeta',
        start: 0,
        end: 1
      },
      {
        text: 'alphaBeta',
        start: 2,
        end: 11
      }
    ])

    const result = replaceAllMatches(editor, 'alphabeta', 'X', {
      caseSensitive: false
    })

    expect(result.replacedCount).toBe(2)
    expect(readDocumentText(editor)).toBe('X X')

    editor.destroy()
  })
})

/** 读取测试文档第一节的段落纯文本。 */
function readDocumentText(editor: ReturnType<typeof createEditor>): string {
  const blocks = editor.getProjection().document.sections[0]?.blocks ?? []

  return blocks
    .flatMap((block) => block.kind === 'paragraph'
      ? [block.runs.flatMap((run) => run.inlines.flatMap((inline) => inline.kind === 'text' ? [inline.text] : [])).join('')]
      : [])
    .join('\n\n')
}

/** 读取每段按 run 切开的纯文本。 */
function readParagraphRunTexts(editor: ReturnType<typeof createEditor>): readonly (readonly string[])[] {
  const blocks = editor.getProjection().document.sections[0]?.blocks ?? []

  return blocks.flatMap((block) => block.kind === 'paragraph'
    ? [block.runs.map((run) => run.inlines.flatMap((inline) => inline.kind === 'text' ? [inline.text] : []).join(''))]
    : [])
}
