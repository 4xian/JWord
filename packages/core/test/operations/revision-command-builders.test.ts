/**
 * @vitest-environment node
 *
 * 职责：验证 Gate 4 修订元数据与最小标记的核心闭环。
 * 边界：只覆盖修订元数据、范围快照、文本片段修订标记与定位，不实现接受/拒绝流程。
 * 协作模块：编辑器门面、修订命令构造器、投影与事务管线。
 * 性能/安全约束：测试只依赖内存文档，不访问 DOM、网络或磁盘。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md Step 4.14。
 */

import { describe, expect, it } from 'vitest'

import { createEditor } from '../../src/editor/runtime'
import { createSelectionState } from '../../src/model/selection'
import { buildAddRevisionMetadataCommand } from '../../src/operations/revision-command-builders'
import type { RevisionMetadata } from '../../src/model/types'

describe('revision command builders', () => {
  it('writes authorId summary range snapshot and marks the target run as revision markup', () => {
    const editor = createEditor({
      initialText: 'abcd',
      currentUser: {
        authorId: 'author-r'
      }
    })
    const selection = createSelectionState(
      editor.createTextAnchor({
        sectionId: 'section-1',
        blockId: 'paragraph-1',
        runId: 'run-1',
        graphemeIndex: 1
      }),
      editor.createTextAnchor({
        sectionId: 'section-1',
        blockId: 'paragraph-1',
        runId: 'run-1',
        graphemeIndex: 3
      })
    )
    const command = buildAddRevisionMetadataCommand(editor.getProjection(), selection, {
      authorId: editor.getCurrentUser().authorId,
      createdAt: '2026-05-24T04:30:00.000Z',
      type: 'insert',
      summary: '插入 “bc”'
    })

    expect(command).not.toBeNull()

    const result = editor.executeCommand(command!)
    const revision = result.projection.document.revisions?.[0]
    const run = result.projection.document.sections[0]?.blocks[0]

    expect(result.operationKinds).toEqual(['addRevisionMetadata'])
    expect(revision).toMatchObject({
      kind: 'revision',
      authorId: 'author-r',
      createdAt: '2026-05-24T04:30:00.000Z',
      type: 'insert',
      summary: '插入 “bc”'
    })
    expect(revision?.rangeId).toBe(revision?.rangeSnapshot.id)
    expect(revision?.rangeSnapshot).toBeDefined()
    expect(run?.kind === 'paragraph' ? run.runs[0]?.revisionId : undefined).toBe(revision?.id)

    editor.executeCommand({
      name: 'insert-front-prefix',
      operations: [{
        kind: 'insertText',
        at: {
          sectionId: 'section-1',
          blockId: 'paragraph-1',
          runId: 'run-1',
          graphemeIndex: 0
        },
        text: 'X'
      }]
    })

    expect(editor.locateRangeSnapshot(revision!.rangeSnapshot)).toEqual({
      anchor: {
        sectionId: 'section-1',
        blockId: 'paragraph-1',
        runId: 'run-1',
        graphemeIndex: 2
      },
      focus: {
        sectionId: 'section-1',
        blockId: 'paragraph-1',
        runId: 'run-1',
        graphemeIndex: 4
      }
    })

    editor.destroy()
  })

  it('records insert delete and format revision types with explainable summaries', () => {
    const editor = createEditor({ initialText: 'abcd' })
    const selection = createSelectionState(
      editor.createTextAnchor({
        sectionId: 'section-1',
        blockId: 'paragraph-1',
        runId: 'run-1',
        graphemeIndex: 0
      }),
      editor.createTextAnchor({
        sectionId: 'section-1',
        blockId: 'paragraph-1',
        runId: 'run-1',
        graphemeIndex: 1
      })
    )

    for (const type of ['insert', 'delete', 'format'] as const) {
      const command = buildAddRevisionMetadataCommand(editor.getProjection(), selection, {
        authorId: 'author-r',
        createdAt: `2026-05-24T04:3${editor.getProjection().document.revisions?.length ?? 0}:00.000Z`,
        type,
        summary: `${type} summary`
      })

      expect(command).not.toBeNull()
      editor.executeCommand(command!)
    }

    expect(editor.getProjection().document.revisions?.map(readRevisionSummary)).toEqual([
      ['insert', 'insert summary'],
      ['delete', 'delete summary'],
      ['format', 'format summary']
    ])

    editor.destroy()
  })
})

/** 读取 revision 类型和摘要，保持断言简洁。 */
function readRevisionSummary(revision: RevisionMetadata): readonly [RevisionMetadata['type'], string] {
  return [revision.type, revision.summary]
}
