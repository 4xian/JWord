/**
 * 职责：为 Gate 6 内部协同宿主提供共享 Editor 文档 token。
 * 边界：不从 core 包根导出，不把 Y.Doc 放进 public EditorOptions。
 * 协作模块：editor runtime、examples/collab 真实 provider runtime 和 persistence adapter。
 * 性能/安全约束：只在内部绑定同一 Y.Doc；正文写入仍必须通过编辑器事务流水线。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import * as Y from 'yjs'

import { JWordEditor } from './runtime'
import type { Editor, EditorOptions } from './types'
import { createDocumentProjection } from '../model/projection'
import type { TransactionDiagnosticSource, TransactionEvent } from '../operations/transaction'

const collaborationDocumentStateSymbol = Symbol('jword.editor.collaboration-document')

interface EditorCollaborationDocumentState {
  readonly doc: Y.Doc
  readonly editors: Set<JWordEditor>
}

export interface EditorCollaborationDocument {
  readonly [collaborationDocumentStateSymbol]: EditorCollaborationDocumentState
}

export interface EditorCollaborationDocumentRefreshInput {
  readonly origin: string
  readonly source?: TransactionDiagnosticSource
}

/** Editor 与协同 provider 共享同一个内部文档真源的公开 token。 */
export type EditorSharedDocument = EditorCollaborationDocument
export type EditorSharedDocumentRefreshInput = EditorCollaborationDocumentRefreshInput

/** 创建一个只供内部协同宿主传递的共享文档 token。 */
export function createEditorCollaborationDocument(): EditorCollaborationDocument {
  return {
    [collaborationDocumentStateSymbol]: {
      doc: new Y.Doc(),
      editors: new Set<JWordEditor>()
    }
  }
}

/** 基于共享文档 token 创建 Editor，并订阅同文档事务刷新。 */
export function createEditorWithCollaborationDocument(
  collaborationDocument: EditorCollaborationDocument,
  options?: EditorOptions
): Editor {
  const state = readEditorCollaborationDocumentState(collaborationDocument)
  const editor = new JWordEditor(options, {
    document: state.doc
  })

  state.editors.add(editor)
  editor.setSharedTransactionDispatcher((event) => {
    dispatchSharedTransaction(state, editor, event)
  })
  editor.subscribe((event) => {
    if (event.kind !== 'destroyed') {
      return
    }

    state.editors.delete(editor)
  })

  return editor
}

/** 读取共享 token 内部 Y.Doc，仅供 provider/offline adapter 绑定同一真源。 */
export function readEditorCollaborationDocument(
  collaborationDocument: EditorCollaborationDocument
): Y.Doc {
  return readEditorCollaborationDocumentState(collaborationDocument).doc
}

/** 将外部 provider 写入同一 Y.Doc 后的状态刷新到已存在的内部 Editor。 */
export function refreshEditorCollaborationDocument(
  collaborationDocument: EditorCollaborationDocument,
  input: EditorCollaborationDocumentRefreshInput
): void {
  const state = readEditorCollaborationDocumentState(collaborationDocument)
  const event = createExternalSharedTransactionEvent(state, input)

  for (const editor of state.editors) {
    editor.refreshFromSharedTransaction(event)
  }
}

/** 创建可供 provider adapter 和 Editor 共享的文档 token。 */
export function createEditorSharedDocument(): EditorSharedDocument {
  return createEditorCollaborationDocument()
}

/** 基于共享文档 token 创建 Editor，并订阅同文档事务刷新。 */
export function createEditorWithSharedDocument(
  sharedDocument: EditorSharedDocument,
  options?: EditorOptions
): Editor {
  return createEditorWithCollaborationDocument(sharedDocument, options)
}

/** 读取共享 token 内部 Y.Doc，供 provider/offline adapter 绑定同一真源。 */
export function readEditorSharedDocument(sharedDocument: EditorSharedDocument): Y.Doc {
  return readEditorCollaborationDocument(sharedDocument)
}

/** 将外部 provider 写入共享文档后的状态刷新到已存在的 Editor。 */
export function refreshEditorSharedDocument(
  sharedDocument: EditorSharedDocument,
  input: EditorSharedDocumentRefreshInput
): void {
  refreshEditorCollaborationDocument(sharedDocument, input)
}

/** 广播一个 Editor 事务到同一共享文档的其他 Editor。 */
function dispatchSharedTransaction(
  state: EditorCollaborationDocumentState,
  sourceEditor: JWordEditor,
  event: TransactionEvent
): void {
  for (const editor of state.editors) {
    if (editor === sourceEditor) {
      continue
    }

    editor.refreshFromSharedTransaction(event)
  }
}

/** 为 provider/offline 直接作用于 Y.Doc 的事务构造内部刷新事件。 */
function createExternalSharedTransactionEvent(
  state: EditorCollaborationDocumentState,
  input: EditorCollaborationDocumentRefreshInput
): TransactionEvent {
  const source = input.source ?? resolveSharedTransactionSource(input.origin)

  return {
    commandName: 'refreshSharedCollaborationDocument',
    origin: input.origin,
    operationKinds: [],
    projection: createDocumentProjection(state.doc),
    dirty: true,
    diagnostic: {
      commandName: 'refreshSharedCollaborationDocument',
      origin: input.origin,
      operationKinds: [],
      updateByteLength: 0,
      source,
      local: source === 'local',
      remote: source === 'remote'
    }
  }
}

/** 将 Yjs transaction origin 映射为 demo 内部刷新诊断来源。 */
function resolveSharedTransactionSource(origin: string): TransactionDiagnosticSource {
  if (origin === 'remote-user') {
    return 'remote'
  }

  if (origin === 'system-recovery') {
    return 'system-recovery'
  }

  if (origin === 'version-restore') {
    return 'version-restore'
  }

  if (origin === 'auto-inserter') {
    return 'auto-inserter'
  }

  return 'local'
}

/** 读取 token 内部状态，避免调用方持有裸状态结构。 */
function readEditorCollaborationDocumentState(
  collaborationDocument: EditorCollaborationDocument
): EditorCollaborationDocumentState {
  return collaborationDocument[collaborationDocumentStateSymbol]
}
