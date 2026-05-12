/**
 * @vitest-environment node
 *
 * 职责：验证 Gate 1 history manager 能接入 Y.UndoManager、记录 metadata 并区分本地与远端 origin。
 * 边界：只覆盖 undo/redo 和元数据，不测试 UI、快捷键、布局或持久化。
 * 协作模块：事务管线提供状态变更，selection 提供 restore snapshot。
 * 性能/安全约束：测试只使用内存中的 Y.Doc，不触发 DOM、网络或磁盘写入。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/03-architecture.md#39-history。
 */

import { describe, expect, it } from 'vitest'

import {
  DOCUMENT_STORE_FIELDS,
  createDocumentStore,
  createParagraphRecord,
  createRunRecord,
  createSectionRecord,
  getParagraphRuns,
  getRunText,
  getSectionBlocks
} from '../src/document-store'
import { createHistoryManager, DEFAULT_HISTORY_ORIGIN } from '../src/history'
import { createSelectionRestoreSnapshot, createSelectionState } from '../src/selection'
import { createAnchorRef, createGraphemeIndex } from '../src/position'
import type { BlockId, DocumentId, RunId, SectionId } from '../src/position'
import { createTransactionPipeline } from '../src/transaction'
import type { TextPosition } from '../src/transaction'

describe('createHistoryManager', () => {
  it('tracks local origin and restores undo redo with metadata', () => {
    const store = createDocumentStore()
    const section = createSectionRecord('section-1' as SectionId)
    const paragraph = createParagraphRecord('paragraph-1' as BlockId)
    const run = createRunRecord('run-1' as RunId, '你好')
    const pipeline = createTransactionPipeline(store.doc)
    const history = createHistoryManager(store)
    const anchor = createAnchor('paragraph-1' as BlockId, 'run-1' as RunId, 2)
    const position = createPosition('paragraph-1' as BlockId, 'run-1' as RunId, 2)
    const selection = createSelectionState(anchor, anchor)
    const selectionSnapshot = createSelectionRestoreSnapshot(selection)

    store.document.set(DOCUMENT_STORE_FIELDS.document.id, 'document-1' as DocumentId)
    store.sections.push([section])
    getSectionBlocks(section).push([paragraph])
    getParagraphRuns(paragraph).push([run])

    history.captureNextTransaction({
      commandName: 'insertText',
      origin: DEFAULT_HISTORY_ORIGIN,
      description: '输入文字',
      selectionBefore: selectionSnapshot,
      selectionAfter: selectionSnapshot
    })

    pipeline.run(
      {
        name: 'insertText',
        operations: [
          {
            kind: 'insertText',
            at: position,
            text: '，JWord'
          }
        ]
      },
      { origin: DEFAULT_HISTORY_ORIGIN }
    )

    expect(getRunText(run).toString()).toBe('你好，JWord')
    expect(history.canUndo()).toBe(true)

    const undoResult = history.undo()

    expect(undoResult.stackItem).not.toBeNull()
    expect(undoResult.metadata?.commandName).toBe('insertText')
    expect(undoResult.metadata?.selectionBefore).toBe(selectionSnapshot)
    expect(getRunText(run).toString()).toBe('你好')
    expect(history.canRedo()).toBe(true)

    const redoResult = history.redo()

    expect(redoResult.stackItem).not.toBeNull()
    expect(getRunText(run).toString()).toBe('你好，JWord')
  })

  it('does not track remote origin by default', () => {
    const store = createDocumentStore()
    const section = createSectionRecord('section-remote' as SectionId)
    const paragraph = createParagraphRecord('paragraph-remote' as BlockId)
    const run = createRunRecord('run-remote' as RunId, '远端')
    const pipeline = createTransactionPipeline(store.doc)
    const history = createHistoryManager(store)
    const position = createPosition(
      'paragraph-remote' as BlockId,
      'run-remote' as RunId,
      2,
      'section-remote' as SectionId
    )

    store.document.set(DOCUMENT_STORE_FIELDS.document.id, 'document-remote' as DocumentId)
    store.sections.push([section])
    getSectionBlocks(section).push([paragraph])
    getParagraphRuns(paragraph).push([run])

    pipeline.run(
      {
        name: 'insertText',
        operations: [
          {
            kind: 'insertText',
            at: position,
            text: 'X'
          }
        ]
      },
      { origin: 'remote-user' }
    )

    expect(getRunText(run).toString()).toBe('远端X')
    expect(history.canUndo()).toBe(false)
    expect(history.undo().stackItem).toBeNull()
    expect(getRunText(run).toString()).toBe('远端X')
  })
})

function createAnchor(
  blockId: BlockId = 'paragraph-1' as BlockId,
  runId: RunId = 'run-1' as RunId,
  graphemeIndex: number = 0
) {
  return createAnchorRef({
    documentId: 'document-1' as DocumentId,
    sectionId: 'section-1' as SectionId,
    blockId,
    runId,
    graphemeIndex: createGraphemeIndex(graphemeIndex)
  })
}

function createPosition(
  blockId: BlockId = 'paragraph-1' as BlockId,
  runId: RunId = 'run-1' as RunId,
  graphemeIndex: number = 0,
  sectionId: SectionId = 'section-1' as SectionId
): TextPosition {
  return {
    sectionId: String(sectionId),
    blockId: String(blockId),
    runId: String(runId),
    graphemeIndex
  }
}
