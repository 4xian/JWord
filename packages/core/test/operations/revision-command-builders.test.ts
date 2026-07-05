/**
 * @vitest-environment node
 *
 * 职责：验证 Gate 4 修订元数据与最小标记的核心闭环。
 * 边界：覆盖修订元数据、范围快照、文本片段修订标记、定位与单条接受/拒绝流程。
 * 协作模块：编辑器门面、修订命令构造器、投影与事务管线。
 * 性能/安全约束：测试只依赖内存文档，不访问 DOM、网络或磁盘。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md Step 4.14。
 */

import { describe, expect, it } from 'vitest'

import { createEditor } from '../../src/editor/runtime'
import { createSelectionState } from '../../src/model/selection'
import { buildAcceptRevisionCommand, buildAddRevisionMetadataCommand, buildRejectRevisionCommand } from '../../src/operations/revision-command-builders'
import type { RevisionMetadata, Run } from '../../src/model/types'
import type { Operation } from '../../src/operations/transaction'

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
    const paragraph = result.projection.document.sections[0]?.blocks[0]
    const runs = paragraph?.kind === 'paragraph' ? paragraph.runs : []

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
    expect(runs.map(readRunText)).toEqual(['a', 'bc', 'd'])
    expect(runs.map((run) => run.revisionId ?? null)).toEqual([null, revision?.id, null])

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
        runId: 'run-1__revision-1',
        graphemeIndex: 2
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



  it('accepts and rejects insert delete and format revisions in one undoable command', () => {
    for (const [type, action, expectedText, expectedBold] of [
      ['insert', 'accept', 'abcd', undefined],
      ['insert', 'reject', 'ad', undefined],
      ['delete', 'accept', 'ad', undefined],
      ['delete', 'reject', 'abcd', undefined],
      ['format', 'accept', 'abcd', true],
      ['format', 'reject', 'abcd', undefined]
    ] as const) {
      const editor = createEditor({ initialText: 'abcd' })
      const selection = createSelection(editor, 1, 3)
      const addCommand = buildAddRevisionMetadataCommand(editor.getProjection(), selection, {
        authorId: 'author-r',
        createdAt: '2026-05-24T04:32:00.000Z',
        type,
        summary: `${type} 修订`
      })

      expect(addCommand).not.toBeNull()
      editor.executeCommand(addCommand!, { selectionAfter: selection })

      if (type === 'format') {
        editor.executeCommand({
          name: 'apply-format-for-revision',
          operations: [{
            kind: 'setRunProperties',
            runId: 'run-1__revision-1',
            properties: { bold: true }
          }]
        }, { selectionAfter: selection })
      }

      const revision = editor.getProjection().document.revisions?.[0]

      expect(revision).toBeDefined()

      const command = action === 'accept'
        ? buildAcceptRevisionCommand(editor.getProjection(), revision!.id)
        : buildRejectRevisionCommand(editor.getProjection(), revision!.id)

      expect(command).not.toBeNull()

      expect(command?.operations).toHaveLength(1)
      expect(command?.operations[0]).toMatchObject({
        kind: `${action}Revision`,
        revisionId: revision!.id
      })
      expect(readOperationPreviousProperties(command!.operations[0]!)).toEqual(type === 'format'
        ? [{ bold: undefined }]
        : [])

      const result = editor.executeCommand(command!)

      expect(result.commandName).toBe(`${action}Revision`)
      expect(editor.getProjection().document.revisions).toBeUndefined()
      expect(readParagraphText(editor)).toBe(expectedText)
      expect(readRevisionIds(editor)).not.toContain(revision!.id)
      expect(readSelectedRunBold(editor, 'bc')).toBe(expectedBold)

      editor.undo()

      expect(editor.getProjection().document.revisions?.[0]?.id).toBe(revision!.id)
      expect(readRevisionIds(editor)).toContain(revision!.id)

      editor.destroy()
    }
  })

  it('marks every selected run and keeps partial boundary runs split to the selected range', () => {
    const editor = createEditor({ initialText: 'abcdef' })

    editor.executeCommand({
      name: 'prepare-three-runs',
      operations: [{
        kind: 'setRunProperties',
        runId: 'run-1',
        properties: { bold: true },
        range: {
          startGraphemeIndex: 2,
          endGraphemeIndex: 4,
          formattedRunId: 'run-2',
          trailingRunId: 'run-3'
        }
      }]
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
        runId: 'run-3',
        graphemeIndex: 1
      })
    )
    const command = buildAddRevisionMetadataCommand(editor.getProjection(), selection, {
      authorId: 'author-r',
      createdAt: '2026-05-24T04:31:00.000Z',
      type: 'insert',
      summary: '插入跨 run 文本'
    })

    expect(command).not.toBeNull()
    expect(command?.operations.map((operation) => operation.kind)).toEqual([
      'addRevisionMetadata',
      'addRevisionMetadata',
      'addRevisionMetadata'
    ])

    const result = editor.executeCommand(command!)
    const revision = result.projection.document.revisions?.[0]
    const paragraph = result.projection.document.sections[0]?.blocks[0]
    const runs = paragraph?.kind === 'paragraph' ? paragraph.runs : []

    expect(result.operationKinds).toEqual([
      'addRevisionMetadata',
      'addRevisionMetadata',
      'addRevisionMetadata'
    ])
    expect(result.projection.document.revisions).toHaveLength(1)
    expect(runs.map(readRunText)).toEqual(['a', 'b', 'cd', 'e', 'f'])
    expect(runs.map((run) => run.revisionId ?? null)).toEqual([
      null,
      revision?.id,
      revision?.id,
      revision?.id,
      null
    ])

    editor.destroy()
  })
})

/** 读取 revision 类型和摘要，保持断言简洁。 */
function readRevisionSummary(revision: RevisionMetadata): readonly [RevisionMetadata['type'], string] {
  return [revision.type, revision.summary]
}

/** 读取 run 的纯文本，保持拆分边界断言简洁。 */
function readRunText(run: Run): string {
  return run.inlines.flatMap((inline) => inline.kind === 'text' ? [inline.text] : []).join('')
}


/** 创建测试用文本选区。 */
function createSelection(editor: ReturnType<typeof createEditor>, start: number, end: number) {
  return createSelectionState(
    editor.createTextAnchor({
      sectionId: 'section-1',
      blockId: 'paragraph-1',
      runId: 'run-1',
      graphemeIndex: start
    }),
    editor.createTextAnchor({
      sectionId: 'section-1',
      blockId: 'paragraph-1',
      runId: 'run-1',
      graphemeIndex: end
    })
  )
}

/** 读取第一段纯文本。 */
function readParagraphText(editor: ReturnType<typeof createEditor>): string {
  const block = editor.getProjection().document.sections[0]?.blocks[0]

  return block?.kind === 'paragraph'
    ? block.runs.map(readRunText).join('')
    : ''
}

/** 读取第一段所有修订标记。 */
function readRevisionIds(editor: ReturnType<typeof createEditor>): readonly (string | null)[] {
  const block = editor.getProjection().document.sections[0]?.blocks[0]

  return block?.kind === 'paragraph'
    ? block.runs.map((run) => run.revisionId ?? null)
    : []
}

/** 读取指定文本 run 的加粗状态。 */
function readSelectedRunBold(editor: ReturnType<typeof createEditor>, text: string): boolean | undefined {
  const block = editor.getProjection().document.sections[0]?.blocks[0]

  if (block?.kind !== 'paragraph') {
    return undefined
  }

  const run = block.runs.find((candidate) => readRunText(candidate) === text)

  return typeof run?.properties?.bold === 'boolean' ? run.properties.bold : undefined
}


/** 读取修订操作内的反向格式快照，供测试确认 reject(format) 可回滚。 */
function readOperationPreviousProperties(operation: Operation): readonly Record<string, unknown>[] {
  if (operation.kind !== 'acceptRevision' && operation.kind !== 'rejectRevision') {
    return []
  }

  return operation.formatTargets.map((target) => target.previousProperties)
}
