/**
 * @vitest-environment node
 *
 * 职责：验证 Gate 6 Editor facade 暴露受控协同 update API，并保持默认用户 undo 隔离。
 * 边界：只覆盖 core facade，不接 provider、IndexedDB、WebSocket、DOM overlay 或示例 UI。
 * 协作模块：packages/collab provider adapter 和 packages/persistence snapshot adapter 后续消费这些 API。
 * 性能/安全约束：不暴露 Y.Doc/store internals，不把 remote 或 auto-inserter 默认混入用户 undo。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import * as Y from 'yjs'
import { describe, expect, it } from 'vitest'

import { createEditor } from '../../src/editor/runtime'
import {
  createEditorCollaborationDocument,
  createEditorWithCollaborationDocument,
  readEditorCollaborationDocument
} from '../../src/editor/collaboration-document'
import { createSelectionState } from '../../src/model/selection'
import type { PluginDefinition } from '../../src/plugins/types'

describe('Gate 6 Editor collaboration hook', () => {
  /** 纯删除必须刷新公开派生状态，幂等重放只保留可观测事件。 */
  it('applies a pure-delete update and replays it without refreshing stable derived state', () => {
    const expectedText = 'a'.repeat(8000)
    const initialText = `X${expectedText}`
    const sourceDocument = createEditorCollaborationDocument()
    const sourceEditor = createEditorWithCollaborationDocument(sourceDocument, { initialText })
    const targetDocument = createEditorCollaborationDocument()
    const targetDoc = readEditorCollaborationDocument(targetDocument)
    const pluginEvents: Array<{ readonly dirty: boolean, readonly projection: unknown }> = []
    const plugins: readonly PluginDefinition[] = [{
      name: 'phase2c.transaction-observer',
      version: '1.0.0',
      /** 记录 transaction 生命周期，不改变文档或事件。 */
      setup(context) {
        context.on('afterTransaction', (event) => {
          pluginEvents.push({
            dirty: event.transaction.dirty,
            projection: event.transaction.projection
          })
        })
      }
    }]

    Y.applyUpdate(targetDoc, sourceEditor.encodeSyncUpdate())

    const targetEditor = createEditorWithCollaborationDocument(targetDocument, { plugins })
    const transactionEvents: Array<{ readonly dirty: boolean, readonly projection: unknown }> = []
    const unsubscribe = targetEditor.subscribe((event) => {
      if (event.kind === 'transaction') {
        transactionEvents.push({
          dirty: event.transaction.dirty,
          projection: event.transaction.projection
        })
      }
    })
    const initialProjection = targetEditor.getProjection()
    const initialLayout = targetEditor.getLayout()
    const laterPage = initialLayout.pages[initialLayout.pages.length - 1]
    const laterLine = laterPage?.lines.find((line) => line.fragments.length > 0)
    const laterFragment = laterLine?.fragments[0]

    expect.soft(initialLayout.pages.length).toBeGreaterThan(1)
    expect.soft(laterFragment).toBeDefined()

    const noOpPosition = targetEditor.resolveTextPosition(targetEditor.createTextAnchor({
      sectionId: laterFragment!.sectionId,
      blockId: laterFragment!.blockId,
      runId: laterFragment!.runId,
      graphemeIndex: laterFragment!.end.graphemeIndex
    }))
    const noOpResult = targetEditor.executeCommand({
      name: 'initialNoOp',
      operations: [{ kind: 'insertText', at: noOpPosition, text: '' }]
    })

    expect.soft(noOpResult.dirty).toBe(false)
    expect.soft(targetEditor.getProjection()).toBe(initialProjection)
    expect.soft(transactionEvents).toEqual([{ dirty: false, projection: initialProjection }])
    expect.soft(pluginEvents).toEqual(transactionEvents)
    expect.soft(transactionEvents[0]?.projection).toBe(initialProjection)
    expect.soft(pluginEvents[0]?.projection).toBe(initialProjection)

    transactionEvents.length = 0
    pluginEvents.length = 0

    const deleteAnchor = sourceEditor.createTextAnchor({
      sectionId: 'section-1',
      blockId: 'paragraph-1',
      runId: 'run-1',
      graphemeIndex: 0
    })
    const deleteFocus = sourceEditor.createTextAnchor({
      sectionId: 'section-1',
      blockId: 'paragraph-1',
      runId: 'run-1',
      graphemeIndex: 1
    })

    sourceEditor.executeCommand({
      name: 'deleteRemoteCharacter',
      operations: [{
        kind: 'deleteRange',
        range: {
          anchor: sourceEditor.resolveTextPosition(deleteAnchor),
          focus: sourceEditor.resolveTextPosition(deleteFocus)
        }
      }]
    })

    const update = Y.encodeStateAsUpdate(
      readEditorCollaborationDocument(sourceDocument),
      Y.encodeStateVector(targetDoc)
    )
    const deleteResult = targetEditor.applySyncUpdate(update, {
      origin: 'remote-user',
      requestId: 'phase2c-delete'
    })
    const deletedProjection = targetEditor.getProjection()
    const deletedLayout = targetEditor.getLayout()

    expect.soft(deleteResult.dirty).toBe(true)
    expect.soft(readParagraphText(deleteResult.projection)).toBe(expectedText)
    expect.soft(readParagraphText(deletedProjection)).toBe(expectedText)
    expect.soft(readLayoutText(deletedLayout)).toBe(expectedText)
    expect.soft(targetEditor.canUndo()).toBe(false)

    const replayResult = targetEditor.applySyncUpdate(update, {
      origin: 'remote-user',
      requestId: 'phase2c-replay'
    })

    expect.soft(replayResult.dirty).toBe(false)
    expect.soft(replayResult.projection).toBe(deletedProjection)
    expect.soft(targetEditor.getProjection()).toBe(deletedProjection)
    expect.soft(targetEditor.getLayout()).toBe(deletedLayout)
    expect.soft(targetEditor.canUndo()).toBe(false)
    expect.soft(transactionEvents).toEqual([
      { dirty: true, projection: deletedProjection },
      { dirty: false, projection: deletedProjection }
    ])
    expect.soft(pluginEvents).toEqual(transactionEvents)

    const localLaterPage = deletedLayout.pages[deletedLayout.pages.length - 1]
    const localLaterLine = localLaterPage?.lines.find((line) => line.fragments.length > 0)
    const localLaterFragment = localLaterLine?.fragments[0]

    expect.soft(localLaterFragment).toBeDefined()

    const localPosition = targetEditor.resolveTextPosition(targetEditor.createTextAnchor({
      sectionId: localLaterFragment!.sectionId,
      blockId: localLaterFragment!.blockId,
      runId: localLaterFragment!.runId,
      graphemeIndex: localLaterFragment!.end.graphemeIndex
    }))
    const localResult = targetEditor.executeCommand({
      name: 'applySyncUpdate',
      operations: [{ kind: 'insertText', at: localPosition, text: 'b' }]
    })
    const localLayout = targetEditor.getLayout()

    expect.soft(localResult.dirty).toBe(true)
    expect.soft(localLayout.pages[0]).toBe(deletedLayout.pages[0])

    unsubscribe()
    sourceEditor.destroy()
    targetEditor.destroy()
  })

  it('encodes and applies a controlled remote update with transaction diagnostics', () => {
    const editor = createEditor({ initialText: '远端' })
    const replacementSource = createEditor({ initialText: '替换版本' })
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

    const replacementResult = editor.replaceSyncUpdate(replacementSource.encodeSyncUpdate(), {
      origin: 'version-restore',
      requestId: 'version-replacement-1'
    })

    expect(replacementResult.commandName).toBe('replaceSyncUpdate')
    expect(replacementResult.dirty).toBe(true)
    expect(readParagraphText(editor.getProjection())).toBe('替换版本')
    expect(observed).toEqual([
      'applySyncUpdate:remote',
      'replaceSyncUpdate:version-restore'
    ])

    unsubscribe()
    replacementSource.destroy()
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

  /** 共享 Editor 对真实变更同步刷新，对 no-op 与 replay 只保留 transaction 可观测性。 */
  it('lets internal collab hosts bind two editors to one Y.Doc without refreshing stable no-op state', () => {
    const expectedText = 'a'.repeat(8000)
    const collaborationDocument = createEditorCollaborationDocument()
    const editorA = createEditorWithCollaborationDocument(collaborationDocument, { initialText: `X${expectedText}` })
    const editorB = createEditorWithCollaborationDocument(collaborationDocument)
    const observedTransactions: Array<{ readonly commandName: string, readonly dirty: boolean }> = []
    const observedSelections: unknown[] = []
    const unsubscribe = editorB.subscribe((event) => {
      if (event.kind === 'transaction') {
        observedTransactions.push({
          commandName: event.transaction.commandName,
          dirty: event.transaction.dirty
        })
      }

      if (event.kind === 'selectionChange') {
        observedSelections.push(event.selection)
      }
    })

    const selectionAnchor = editorB.createTextAnchor({
      sectionId: 'section-1',
      blockId: 'paragraph-1',
      runId: 'run-1',
      graphemeIndex: 2
    })
    const selection = createSelectionState(selectionAnchor, selectionAnchor)

    editorB.setSelection(selection)
    observedTransactions.length = 0
    observedSelections.length = 0

    const stableProjection = editorB.getProjection()
    const stableLayout = editorB.getLayout()
    const stableSelection = editorB.getSelection()
    const laterPage = stableLayout.pages[stableLayout.pages.length - 1]
    const laterLine = laterPage?.lines.find((line) => line.fragments.length > 0)
    const laterFragment = laterLine?.fragments[0]

    expect.soft(stableLayout.pages.length).toBeGreaterThan(1)
    expect.soft(laterFragment).toBeDefined()

    const noOpPosition = editorB.resolveTextPosition(editorB.createTextAnchor({
      sectionId: laterFragment!.sectionId,
      blockId: laterFragment!.blockId,
      runId: laterFragment!.runId,
      graphemeIndex: laterFragment!.end.graphemeIndex
    }))
    const noOpResult = editorB.executeCommand({
      name: 'sharedNoOp',
      operations: [{ kind: 'insertText', at: noOpPosition, text: '' }]
    })

    expect.soft(noOpResult.dirty).toBe(false)
    expect.soft(editorB.getProjection()).toBe(stableProjection)
    expect.soft(editorB.getLayout()).toBe(stableLayout)
    expect.soft(editorB.getSelection()).toBe(stableSelection)
    expect.soft(observedTransactions).toEqual([{ commandName: 'sharedNoOp', dirty: false }])

    observedSelections.length = 0

    const sourceNoOpPosition = editorA.resolveTextPosition(editorA.createTextAnchor({
      sectionId: laterFragment!.sectionId,
      blockId: laterFragment!.blockId,
      runId: laterFragment!.runId,
      graphemeIndex: laterFragment!.end.graphemeIndex
    }))
    const sourceNoOpResult = editorA.executeCommand({
      name: 'sharedSourceNoOp',
      operations: [{ kind: 'insertText', at: sourceNoOpPosition, text: '' }]
    })

    expect.soft(sourceNoOpResult.dirty).toBe(false)
    expect.soft(editorB.getProjection()).toBe(stableProjection)
    expect.soft(editorB.getLayout()).toBe(stableLayout)
    expect.soft(editorB.getSelection()).toBe(stableSelection)
    expect.soft(observedTransactions).toEqual([
      { commandName: 'sharedNoOp', dirty: false },
      { commandName: 'sharedSourceNoOp', dirty: false }
    ])
    expect.soft(observedSelections).toEqual([])

    const deleteAnchor = editorA.createTextAnchor({
      sectionId: 'section-1',
      blockId: 'paragraph-1',
      runId: 'run-1',
      graphemeIndex: 0
    })
    const deleteFocus = editorA.createTextAnchor({
      sectionId: 'section-1',
      blockId: 'paragraph-1',
      runId: 'run-1',
      graphemeIndex: 1
    })
    const deleteResult = editorA.executeCommand({
      name: 'sharedDelete',
      operations: [{
        kind: 'deleteRange',
        range: {
          anchor: editorA.resolveTextPosition(deleteAnchor),
          focus: editorA.resolveTextPosition(deleteFocus)
        }
      }]
    })
    const deletedProjection = editorB.getProjection()
    const deletedLayout = editorB.getLayout()
    const deletedSelection = editorB.getSelection()

    expect.soft(deleteResult.dirty).toBe(true)
    expect.soft(readParagraphText(deletedProjection)).toBe(expectedText)
    expect.soft(readLayoutText(deletedLayout)).toBe(expectedText)
    expect.soft(observedTransactions).toEqual([
      { commandName: 'sharedNoOp', dirty: false },
      { commandName: 'sharedSourceNoOp', dirty: false },
      { commandName: 'sharedDelete', dirty: true }
    ])
    expect.soft(observedSelections).toHaveLength(1)

    observedSelections.length = 0

    const replayResult = editorA.applySyncUpdate(editorA.encodeSyncUpdate(), {
      origin: 'remote-user',
      requestId: 'shared-replay'
    })

    expect.soft(replayResult.dirty).toBe(false)
    expect.soft(editorB.getProjection()).toBe(deletedProjection)
    expect.soft(editorB.getLayout()).toBe(deletedLayout)
    expect.soft(editorB.getSelection()).toBe(deletedSelection)
    expect.soft(observedTransactions).toEqual([
      { commandName: 'sharedNoOp', dirty: false },
      { commandName: 'sharedSourceNoOp', dirty: false },
      { commandName: 'sharedDelete', dirty: true },
      { commandName: 'applySyncUpdate', dirty: false }
    ])
    expect.soft(observedSelections).toEqual([])

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

/** 读取布局中的可见纯文本。 */
function readLayoutText(layout: ReturnType<ReturnType<typeof createEditor>['getLayout']>): string {
  return layout.pages.flatMap((page) =>
    page.lines.flatMap((line) => line.fragments.map((fragment) => fragment.text))
  ).join('')
}
