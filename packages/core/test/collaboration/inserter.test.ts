/**
 * @vitest-environment node
 *
 * 职责：验证 Gate 6 auto inserter 基于公开 Editor facade 完成稳定锚点插入。
 * 边界：只覆盖 core collaboration inserter，不访问 Y.Doc/store internals、不接 provider 或浏览器 DOM。
 * 协作模块：Editor facade、transaction pipeline、history 和后续 packages/collab provider adapter。
 * 性能/安全约束：测试只使用小型内存文档，自动插入默认不污染用户 undo。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#iteration-6---auto-inserter-主通道。
 */

import { describe, expect, it } from 'vitest'

import { createInserter } from '../../src/collaboration/inserter'
import { createEditor } from '../../src/editor/runtime'
import type { Editor } from '../../src/editor/runtime'
import { createEditorCollaborationDocument, createEditorWithCollaborationDocument } from '../../src/editor/collaboration-document'
import { createRangeRef } from '../../src/model/position'
import type { AnchorRef, RangeRef } from '../../src/model/position'
import { createSelectionState } from '../../src/model/selection'

describe('Gate 6 auto inserter', () => {
  it('inserts queued text at a stable anchor through the editor facade', () => {
    const editor = createEditor({ initialText: 'ac' })
    const events: string[] = []
    const stableAnchor = createAnchor(editor, 1)
    const inserter = createInserter(editor, {
      requestId: 'insert-stable-anchor',
      anchor: stableAnchor,
      onProgress: (event) => events.push(event.phase)
    })

    inserter.queue('b')
    editor.executeCommand({
      name: 'prepare-stable-anchor-prefix',
      operations: [{
        kind: 'insertText',
        at: editor.resolveTextPosition(createAnchor(editor, 0)),
        text: 'X'
      }]
    })
    const result = inserter.flush()

    expect(readParagraphText(editor)).toBe('Xabc')
    expect(result?.diagnostic).toMatchObject({
      origin: 'auto-inserter',
      source: 'auto-inserter',
      requestId: 'insert-stable-anchor'
    })
    expect(events).toEqual(['queued', 'anchored', 'streaming', 'flushing', 'committed'])

    editor.destroy()
  })

  it('stops later flushes after abort', () => {
    const editor = createEditor({ initialText: 'ab' })
    const events: string[] = []
    const inserter = createInserter(editor, {
      requestId: 'abort-inserter',
      anchor: createAnchor(editor, 2),
      onProgress: (event) => events.push(event.phase)
    })

    inserter.queue('c')
    inserter.abort('user-cancelled')
    const result = inserter.flush()

    expect(result).toBeNull()
    expect(readParagraphText(editor)).toBe('ab')
    expect(events).toEqual(['queued', 'aborted'])

    editor.destroy()
  })

  it('keeps auto inserter commands out of the default user undo scope', () => {
    const editor = createEditor({ initialText: 'ab' })
    const inserter = createInserter(editor, {
      requestId: 'undo-clean',
      anchor: createAnchor(editor, 2)
    })

    inserter.write('c')

    expect(readParagraphText(editor)).toBe('abc')
    expect(editor.canUndo()).toBe(false)

    editor.destroy()
  })

  it('allows auto inserter writes to use an independent undo scope', () => {
    const editor = createEditor({ initialText: 'ab' })
    const inserter = createInserter(editor, {
      requestId: 'undo-independent-ai',
      anchor: createAnchor(editor, 2),
      undoScope: 'auto-inserter'
    })

    const result = inserter.write('AI')

    expect(readParagraphText(editor)).toBe('abAI')
    expect(result?.diagnostic).toMatchObject({
      origin: 'auto-inserter',
      requestId: 'undo-independent-ai'
    })
    expect(editor.canUndo()).toBe(false)
    expect(editor.canUndo('auto-inserter')).toBe(true)

    const undoResult = editor.undo('auto-inserter')

    expect(undoResult.metadata).toMatchObject({
      commandName: 'autoInsert',
      origin: 'auto-inserter'
    })
    expect(readParagraphText(editor)).toBe('ab')
    expect(editor.canRedo()).toBe(false)
    expect(editor.canRedo('auto-inserter')).toBe(true)

    editor.redo('auto-inserter')

    expect(readParagraphText(editor)).toBe('abAI')

    editor.destroy()
  })

  it('replaces a stable range through the editor facade', () => {
    const editor = createEditor({ initialText: 'abcd' })
    const events: string[] = []
    const inserter = createInserter(editor, {
      requestId: 'replace-range',
      range: createRange(editor, 1, 3),
      mode: 'replace',
      onProgress: (event) => events.push(event.phase)
    })

    const result = inserter.write('XY')

    expect(readParagraphText(editor)).toBe('aXYd')
    expect(result?.diagnostic).toMatchObject({
      origin: 'auto-inserter',
      requestId: 'replace-range'
    })
    expect(events).toEqual(['queued', 'anchored', 'streaming', 'flushing', 'committed'])

    editor.destroy()
  })

  it('reports a recoverable structured error when the anchor is no longer resolvable', () => {
    const editor = createEditor({ initialText: 'ab' })
    const errors: unknown[] = []
    const inserter = createInserter(editor, {
      requestId: 'deleted-anchor',
      anchor: createAnchor(editor, 1),
      onError: (event) => errors.push(event.error)
    })

    editor.createDocument({ text: 'reset' })
    const result = inserter.write('X')

    expect(result).toBeNull()
    expect(readParagraphText(editor)).toBe('reset')
    expect(errors).toEqual([
      expect.objectContaining({
        code: 'AUTO_INSERTER_ANCHOR_UNRESOLVED',
        recoverable: true,
        requestId: 'deleted-anchor'
      })
    ])

    editor.destroy()
  })

  it('keeps queued text retryable after a recoverable flush error', () => {
    const editor = createEditor({ initialText: 'ab' })
    const events: string[] = []
    const errors: unknown[] = []
    const inserter = createInserter(editor, {
      requestId: 'retry-after-anchor-error',
      anchor: createAnchor(editor, 1),
      onProgress: (event) => events.push(event.phase),
      onError: (event) => errors.push(event.error)
    })

    inserter.queue('X')
    editor.createDocument({ text: 'reset' })
    const failed = inserter.flush()
    const retried = inserter.retry({
      anchor: createAnchor(editor, 5)
    })

    expect(failed).toBeNull()
    expect(retried?.diagnostic).toMatchObject({
      origin: 'auto-inserter',
      requestId: 'retry-after-anchor-error'
    })
    expect(readParagraphText(editor)).toBe('resetX')
    expect(errors).toEqual([
      expect.objectContaining({
        code: 'AUTO_INSERTER_ANCHOR_UNRESOLVED',
        recoverable: true,
        requestId: 'retry-after-anchor-error'
      })
    ])
    expect(events).toEqual([
      'queued',
      'failed',
      'retrying',
      'anchored',
      'streaming',
      'flushing',
      'committed'
    ])

    editor.destroy()
  })

  it('keeps queued AI text stable after a local user edit in the same paragraph', () => {
    const editor = createEditor({ initialText: 'abc' })
    const inserter = createInserter(editor, {
      requestId: 'local-ai-concurrent',
      anchor: createAnchor(editor, 2)
    })

    inserter.queue('AI')
    editor.executeCommand({
      name: 'localBeforeAiFlush',
      operations: [{
        kind: 'insertText',
        at: editor.resolveTextPosition(createAnchor(editor, 0)),
        text: 'U'
      }]
    })
    const result = inserter.flush()

    expect(readParagraphText(editor)).toBe('UabAIc')
    expect(result?.diagnostic).toMatchObject({
      origin: 'auto-inserter',
      requestId: 'local-ai-concurrent'
    })

    editor.undo()

    expect(readParagraphText(editor)).toBe('abAIc')

    editor.destroy()
  })

  it('keeps queued AI text stable after a remote-origin edit in the same paragraph', () => {
    const editor = createEditor({ initialText: 'abc' })
    const inserter = createInserter(editor, {
      requestId: 'remote-ai-concurrent',
      anchor: createAnchor(editor, 2)
    })

    inserter.queue('AI')
    editor.executeCommand(
      {
        name: 'remoteBeforeAiFlush',
        operations: [{
          kind: 'insertText',
          at: editor.resolveTextPosition(createAnchor(editor, 0)),
          text: 'R'
        }]
      },
      {
        origin: 'remote-user',
        requestId: 'remote-ai-command'
      }
    )
    const result = inserter.flush()

    expect(readParagraphText(editor)).toBe('RabAIc')
    expect(result?.diagnostic).toMatchObject({
      origin: 'auto-inserter',
      requestId: 'remote-ai-concurrent'
    })
    expect(editor.canUndo()).toBe(false)

    editor.destroy()
  })

  it('moves the mounted selection with original text when a shared auto insert lands before it', () => {
    const sharedDocument = createEditorCollaborationDocument()
    const localEditor = createEditorWithCollaborationDocument(sharedDocument, { initialText: 'abcdef' })
    const remoteEditor = createEditorWithCollaborationDocument(sharedDocument)
    const caret = createAnchor(localEditor, 3)
    const inserter = createInserter(remoteEditor, {
      requestId: 'shared-auto-before-caret',
      anchor: createAnchor(remoteEditor, 0)
    })

    localEditor.setSelection(createSelectionState(caret, caret))
    inserter.write('XX')

    expect(readParagraphText(localEditor)).toBe('XXabcdef')
    expect(localEditor.readSelectionSnapshot()?.focus.location.graphemeIndex).toBe(5)

    localEditor.destroy()
    remoteEditor.destroy()
  })

  it('keeps the mounted selection at the deletion boundary after shared text before it is removed', () => {
    const sharedDocument = createEditorCollaborationDocument()
    const localEditor = createEditorWithCollaborationDocument(sharedDocument, { initialText: 'abcdef' })
    const remoteEditor = createEditorWithCollaborationDocument(sharedDocument)
    const caret = createAnchor(localEditor, 3)

    localEditor.setSelection(createSelectionState(caret, caret))
    remoteEditor.executeCommand(
      {
        name: 'sharedDeleteBeforeCaret',
        operations: [{
          kind: 'deleteRange',
          range: {
            anchor: remoteEditor.resolveTextPosition(createAnchor(remoteEditor, 0)),
            focus: remoteEditor.resolveTextPosition(createAnchor(remoteEditor, 2))
          }
        }]
      },
      {
        origin: 'remote-user',
        requestId: 'shared-delete-before-caret'
      }
    )

    expect(readParagraphText(localEditor)).toBe('cdef')
    expect(localEditor.readSelectionSnapshot()?.focus.location.graphemeIndex).toBe(1)

    localEditor.destroy()
    remoteEditor.destroy()
  })
})

/** 创建测试使用的公开稳定文本锚点。 */
function createAnchor(editor: Editor, graphemeIndex: number): AnchorRef {
  return editor.createTextAnchor({
    sectionId: 'section-1',
    blockId: 'paragraph-1',
    runId: 'run-1',
    graphemeIndex
  })
}

/** 创建测试使用的公开稳定文本范围。 */
function createRange(editor: Editor, anchorIndex: number, focusIndex: number): RangeRef {
  return createRangeRef(createAnchor(editor, anchorIndex), createAnchor(editor, focusIndex))
}

/** 读取公开 projection 中的段落纯文本。 */
function readParagraphText(editor: Editor): string {
  return editor.getProjection().document.sections.flatMap((section) =>
    section.blocks.flatMap((block) => block.kind === 'paragraph'
      ? block.runs.flatMap((run) => run.inlines.flatMap((inline) => inline.kind === 'text' ? [inline.text] : [])).join('')
      : [])
  ).join('\n')
}
