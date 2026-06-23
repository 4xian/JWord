/**
 * @vitest-environment node
 *
 * 职责：验证 Gate 6 Editor facade 暴露受控协同 update API，并保持默认用户 undo 隔离。
 * 边界：只覆盖 core facade，不接 provider、IndexedDB、WebSocket、DOM overlay 或示例 UI。
 * 协作模块：packages/collab provider adapter 和 packages/persistence snapshot adapter 后续消费这些 API。
 * 性能/安全约束：不暴露 Y.Doc/store internals，不把 remote 或 auto-inserter 默认混入用户 undo。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#iteration-1---core-协同-hookorigin-和-history-scope。
 */

import { describe, expect, it } from 'vitest'

import { createEditor } from '../../src/editor/runtime'
import { createEditorCollaborationDocument, createEditorWithCollaborationDocument } from '../../src/editor/collaboration-document'

describe('Gate 6 Editor collaboration hook', () => {
  it('encodes and applies a controlled remote update with transaction diagnostics', () => {
    const editor = createEditor({ initialText: '远端' })
    const observed: string[] = []
    const update = editor.encodeSyncUpdate()
    const unsubscribe = editor.subscribe((event) => {
      if (event.kind === 'transaction') {
        observed.push(`${event.transaction.commandName}:${event.transaction.diagnostic.source}`)
      }
    })

    const result = editor.applySyncUpdate(update, {
      origin: 'remote-user',
      requestId: 'remote-editor-1',
      roomId: 'room-editor'
    })

    expect(result.commandName).toBe('applySyncUpdate')
    expect(result.diagnostic).toMatchObject({
      origin: 'remote-user',
      source: 'remote',
      requestId: 'remote-editor-1',
      roomId: 'room-editor'
    })
    expect(result.diagnostic.updateByteLength).toBe(0)
    expect(observed).toEqual(['applySyncUpdate:remote'])

    unsubscribe()
    editor.destroy()
  })

  it('keeps remote and auto-inserter origins out of the default user undo scope', () => {
    const editor = createEditor({ initialText: 'abc' })
    const position = editor.resolveTextPosition(editor.createTextAnchor({
      sectionId: 'section-1',
      blockId: 'paragraph-1',
      runId: 'run-1',
      graphemeIndex: 3
    }))

    editor.executeCommand(
      {
        name: 'remoteInsert',
        operations: [{ kind: 'insertText', at: position, text: 'R' }]
      },
      { origin: 'remote-user', requestId: 'remote-command-1' }
    )
    editor.executeCommand(
      {
        name: 'autoInsert',
        operations: [{ kind: 'insertText', at: position, text: 'A' }]
      },
      { origin: 'auto-inserter', requestId: 'auto-command-1' }
    )

    expect(editor.canUndo()).toBe(false)
    expect(readParagraphText(editor.getProjection())).toBe('abcAR')

    editor.destroy()
  })

  it('keeps version-restore writes in an independent undo scope without clearing user metadata', () => {
    const editor = createEditor({ initialText: 'abc' })
    const userPosition = editor.resolveTextPosition(editor.createTextAnchor({
      sectionId: 'section-1',
      blockId: 'paragraph-1',
      runId: 'run-1',
      graphemeIndex: 3
    }))
    const restorePosition = editor.resolveTextPosition(editor.createTextAnchor({
      sectionId: 'section-1',
      blockId: 'paragraph-1',
      runId: 'run-1',
      graphemeIndex: 0
    }))

    editor.executeCommand(
      {
        name: 'userInsert',
        operations: [{ kind: 'insertText', at: userPosition, text: 'L' }]
      },
      { origin: 'local-user', requestId: 'local-command-2' }
    )
    editor.executeCommand(
      {
        name: 'versionRestoreInsert',
        operations: [{ kind: 'insertText', at: restorePosition, text: 'V' }]
      },
      {
        origin: 'version-restore',
        historyScope: 'version-restore',
        requestId: 'version-restore-command-1'
      }
    )

    expect(editor.canUndo()).toBe(true)
    expect(editor.canUndo('version-restore')).toBe(true)
    expect(readParagraphText(editor.getProjection())).toBe('VabcL')

    const restoreUndoResult = editor.undo('version-restore')

    expect(restoreUndoResult.stackItem).not.toBeNull()
    expect(restoreUndoResult.metadata?.commandName).toBe('versionRestoreInsert')
    expect(readParagraphText(editor.getProjection())).toBe('abcL')
    expect(editor.canUndo()).toBe(true)

    const userUndoResult = editor.undo()

    expect(userUndoResult.stackItem).not.toBeNull()
    expect(userUndoResult.metadata?.commandName).toBe('userInsert')
    expect(readParagraphText(editor.getProjection())).toBe('abc')

    editor.destroy()
  })

  it('lets internal collab hosts bind two editors to one Y.Doc without exposing the doc publicly', () => {
    const collaborationDocument = createEditorCollaborationDocument()
    const editorA = createEditorWithCollaborationDocument(collaborationDocument, { initialText: '共享' })
    const editorB = createEditorWithCollaborationDocument(collaborationDocument)
    const observed: string[] = []
    const position = editorA.resolveTextPosition(editorA.createTextAnchor({
      sectionId: 'section-1',
      blockId: 'paragraph-1',
      runId: 'run-1',
      graphemeIndex: 2
    }))
    const unsubscribe = editorB.subscribe((event) => {
      if (event.kind === 'transaction') {
        observed.push(event.transaction.commandName)
      }
    })

    editorA.executeCommand({
      name: 'sharedInsert',
      operations: [{ kind: 'insertText', at: position, text: '文档' }]
    })

    expect(readParagraphText(editorB.getProjection())).toBe('共享文档')
    expect(observed).toEqual(['sharedInsert'])

    unsubscribe()
    editorA.destroy()
    editorB.destroy()
  })
})

/** 读取投影里的段落纯文本。 */
function readParagraphText(projection: ReturnType<ReturnType<typeof createEditor>['getProjection']>): string {
  return projection.document.sections.flatMap((section) =>
    section.blocks.flatMap((block) => block.kind === 'paragraph'
      ? block.runs.flatMap((run) => run.inlines.flatMap((inline) => inline.kind === 'text' ? [inline.text] : [])).join('')
      : [])
  ).join('\n')
}
