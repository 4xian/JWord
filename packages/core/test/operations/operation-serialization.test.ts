/**
 * @vitest-environment node
 *
 * 职责：验证 Gate 1 Operation 是可 JSON 序列化、可跨实例重放的编辑契约。
 * 边界：只覆盖文本位置形状、拆分段落显式 run ID 和编辑器事务入口，不测试协同 provider。
 * 协作模块：编辑器门面、事务管线、操作适配器和后续 docx/collab/auto-inserter 复用同一 operation 形状。
 * 性能/安全约束：测试只使用内存文档，不访问 DOM、网络或磁盘。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/03-architecture.md#34-operation。
 */

import { describe, expect, it } from 'vitest'

import { createEditor } from '../../src/editor/runtime'
import type { BlockId, RunId } from '../../src/model/position'
import type { Command, Operation, TextPosition } from '../../src/operations/transaction'

describe('serializable Gate 1 operations', () => {
  it('executes an insertText command built from a JSON text position', () => {
    const editor = createEditor({ initialText: 'abcd' })
    const at: TextPosition = {
      sectionId: 'section-1',
      blockId: 'paragraph-1',
      runId: 'run-1',
      graphemeIndex: 2
    }
    const command: Command = {
      name: 'serializable-insert',
      operations: [{ kind: 'insertText', at, text: 'Z' }]
    }

    expect(JSON.parse(JSON.stringify(command.operations))).toEqual([
      { kind: 'insertText', at, text: 'Z' }
    ])

    const result = editor.executeCommand(command)

    expect(readParagraphTexts(result.projection)).toEqual(['abZcd'])

    editor.destroy()
  })

  it('uses explicit split run ids so replay does not depend on implicit naming', () => {
    const editor = createEditor({ initialText: 'abcdef' })
    const operations: readonly Operation[] = [
      {
        kind: 'splitBlock',
        at: {
          sectionId: 'section-1',
          blockId: 'paragraph-1',
          runId: 'run-1',
          graphemeIndex: 3
        },
        newBlockId: 'paragraph-2' as BlockId,
        newRunId: 'run-2' as RunId
      }
    ]

    const result = editor.executeCommand({ name: 'serializable-split', operations })

    expect(readParagraphRunIds(result.projection)).toEqual([['run-1'], ['run-2']])
    expect(JSON.parse(JSON.stringify(operations))).toEqual([
      {
        kind: 'splitBlock',
        at: {
          sectionId: 'section-1',
          blockId: 'paragraph-1',
          runId: 'run-1',
          graphemeIndex: 3
        },
        newBlockId: 'paragraph-2',
        newRunId: 'run-2'
      }
    ])

    editor.destroy()
  })
})

function readParagraphTexts(projection: ReturnType<ReturnType<typeof createEditor>['getProjection']>): string[] {
  return projection.document.sections[0]?.blocks
    .filter((block) => block.kind === 'paragraph')
    .map((block) => block.runs.flatMap((run) => run.inlines)
      .filter((inline) => inline.kind === 'text')
      .map((inline) => inline.text)
      .join('')) ?? []
}

function readParagraphRunIds(projection: ReturnType<ReturnType<typeof createEditor>['getProjection']>): string[][] {
  return projection.document.sections[0]?.blocks
    .filter((block) => block.kind === 'paragraph')
    .map((block) => block.runs.map((run) => run.id)) ?? []
}
