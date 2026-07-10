/**
 * @vitest-environment node
 *
 * 职责：验证 Gate 4 comment thread command builder 的最小 core 闭环。
 * 边界：只覆盖 thread/message 模型、projection 落地与 range snapshot 定位，不测试 UI 控件或浏览器交互。
 * 协作模块：editor facade、position snapshot、projection 与 transaction pipeline 共同完成 comment 纵线。
 * 性能/安全约束：测试只依赖内存文档，不访问 DOM、网络或磁盘。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import { describe, expect, it } from 'vitest'

import { createEditor } from '../../src/editor/runtime'
import { createSelectionState } from '../../src/model/selection'
import {
  buildAddCommentThreadCommand,
  buildDeleteCommentThreadCommand,
  buildEditCommentMessageCommand,
  buildReopenCommentThreadCommand,
  buildReplyCommentThreadCommand,
  buildResolveCommentThreadCommand
} from '../../src/operations/comment-command-builders'

describe('comment command builders', () => {
  it('writes authorId and stable range snapshot, and still locates the thread after front insert and delete', () => {
    const editor = createEditor({
      initialText: 'abcd',
      currentUser: {
        authorId: 'author-a'
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
    const addCommand = buildAddCommentThreadCommand(
      editor.getProjection(),
      selection,
      {
        authorId: editor.getCurrentUser().authorId,
        createdAt: '2026-05-23T00:00:00.000Z',
        text: '首条批注'
      }
    )

    expect(addCommand).not.toBeNull()

    const addResult = editor.executeCommand(addCommand!)
    const thread = addResult.projection.document.comments?.[0]

    expect(thread).toMatchObject({
      kind: 'commentThread',
      authorId: 'author-a',
      createdAt: '2026-05-23T00:00:00.000Z',
      resolved: false,
      messages: [{
        authorId: 'author-a',
        createdAt: '2026-05-23T00:00:00.000Z',
        text: '首条批注'
      }]
    })
    expect(thread?.rangeSnapshot).toBeDefined()

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

    expect(editor.locateRangeSnapshot(thread!.rangeSnapshot)).toEqual({
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

    editor.executeCommand({
      name: 'delete-front-prefix',
      operations: [{
        kind: 'deleteRange',
        range: {
          anchor: {
            sectionId: 'section-1',
            blockId: 'paragraph-1',
            runId: 'run-1',
            graphemeIndex: 0
          },
          focus: {
            sectionId: 'section-1',
            blockId: 'paragraph-1',
            runId: 'run-1',
            graphemeIndex: 1
          }
        }
      }]
    })

    expect(editor.locateRangeSnapshot(thread!.rangeSnapshot)).toEqual({
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
        graphemeIndex: 3
      }
    })

    editor.destroy()
  })

  it('supports reply, edit, resolve, reopen, and delete thread operations through projection updates', () => {
    const editor = createEditor({
      initialText: '批注目标',
      currentUser: {
        authorId: 'author-a'
      }
    })
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
        graphemeIndex: 2
      })
    )
    const addResult = editor.executeCommand(buildAddCommentThreadCommand(
      editor.getProjection(),
      selection,
      {
        authorId: 'author-a',
        createdAt: '2026-05-23T01:00:00.000Z',
        text: '初始批注'
      }
    )!)
    const thread = addResult.projection.document.comments?.[0]

    expect(thread).toBeDefined()

    const replyResult = editor.executeCommand(buildReplyCommentThreadCommand(
      addResult.projection,
      thread!.id,
      {
        authorId: 'author-b',
        createdAt: '2026-05-23T01:05:00.000Z',
        text: '回复内容'
      }
    )!)
    const repliedThread = replyResult.projection.document.comments?.[0]

    expect(repliedThread?.messages).toHaveLength(2)
    expect(repliedThread?.messages[1]).toMatchObject({
      authorId: 'author-b',
      createdAt: '2026-05-23T01:05:00.000Z',
      text: '回复内容'
    })

    const editedResult = editor.executeCommand(buildEditCommentMessageCommand(
      replyResult.projection,
      thread!.id,
      repliedThread!.messages[1]!.id,
      {
        editedAt: '2026-05-23T01:06:00.000Z',
        text: '回复内容（已编辑）'
      }
    )!)

    expect(editedResult.projection.document.comments?.[0]?.messages[1]).toMatchObject({
      text: '回复内容（已编辑）',
      editedAt: '2026-05-23T01:06:00.000Z'
    })

    const resolvedResult = editor.executeCommand(buildResolveCommentThreadCommand(
      editedResult.projection,
      thread!.id
    )!)

    expect(resolvedResult.projection.document.comments?.[0]?.resolved).toBe(true)

    const reopenedResult = editor.executeCommand(buildReopenCommentThreadCommand(
      resolvedResult.projection,
      thread!.id
    )!)

    expect(reopenedResult.projection.document.comments?.[0]?.resolved).toBe(false)

    const deletedResult = editor.executeCommand(buildDeleteCommentThreadCommand(
      reopenedResult.projection,
      thread!.id
    )!)

    expect(deletedResult.projection.document.comments).toBeUndefined()

    editor.destroy()
  })
})
