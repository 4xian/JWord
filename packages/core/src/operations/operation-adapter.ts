/**
 * 职责：把 Operation 分发到按领域拆分的 Y.Doc 状态 adapter。
 * 边界：只保留 adapter 创建与 applyOperation 调度，不承载具体 operation 写入逻辑。
 * 协作模块：transaction pipeline 后续会在 ydoc.transact(origin) 内调用这里的 adapter。
 * 性能/安全约束：不访问 DOM，不触发布局、渲染、输入、历史、协同或事件发布。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/03-architecture.md#34-operation。
 */
import * as Y from 'yjs'

import { createDocumentStore } from '../model/document-store'
import type { DocumentStore } from '../model/document-store'
import type { ResourceUrlPolicy } from '../resources/types'
import type { Operation } from './transaction'
import {
  deleteRange,
  insertText,
  setRunLink,
  setRunProperties
} from './text-adapter'
import {
  deleteBlock,
  insertBlock,
  mergeBlock,
  setParagraphProperties,
  setSectionProperties,
  splitBlock
} from './block-adapter'
import {
  deleteResource,
  upsertResource
} from './resource-adapter'
import {
  deleteImage,
  insertImage,
  replaceImageResource,
  resizeImage,
  setImageRotation
} from './image-adapter'
import { applyTableOperation } from './table-adapter'
import {
  addCommentThread,
  deleteCommentThread,
  editCommentEntry,
  reopenCommentThread,
  replyCommentThread,
  resolveCommentThread
} from './comment-adapter'
import {
  addRevisionMetadata,
  resolveRevision
} from './revision-adapter'

/** Operation 到 Y.Doc 的最小 adapter。 */
export interface OperationAdapter {
  readonly store: DocumentStore
  apply(operation: Operation): void
  applyAll(operations: readonly Operation[]): void
}

export interface OperationAdapterOptions {
  readonly resourceUrlPolicy?: ResourceUrlPolicy
}

/**
 * 创建 Operation adapter。
 *
 * @param input 文档状态壳或 Y.Doc。
 * @returns 可应用 operation 的 adapter。
 */
export function createOperationAdapter(
  input: DocumentStore | Y.Doc,
  options: OperationAdapterOptions = {}
): OperationAdapter {
  const store = input instanceof Y.Doc ? createDocumentStore(input) : input

  return {
    store,
    apply(operation) {
      applyOperation(store, operation, options)
    },
    applyAll(operations) {
      for (const operation of operations) {
        applyOperation(store, operation, options)
      }
    }
  }
}

/**
 * 应用单个 operation。
 *
 * @param store 文档状态壳。
 * @param operation 待应用操作。
 */
export function applyOperation(
  store: DocumentStore,
  operation: Operation,
  options: OperationAdapterOptions = {}
): void {
  switch (operation.kind) {
    case 'insertText':
      insertText(store, operation.at, operation.text)
      break
    case 'deleteRange':
      deleteRange(store, operation.range.anchor, operation.range.focus)
      break
    case 'setRunProperties':
      setRunProperties(store, operation)
      break
    case 'setParagraphProperties':
      setParagraphProperties(store, operation)
      break
    case 'setSectionProperties':
      setSectionProperties(store, operation)
      break
    case 'splitBlock':
      splitBlock(store, operation.at, operation.newBlockId, operation.newRunId)
      break
    case 'mergeBlock':
      mergeBlock(store, operation.targetBlockId, operation.sourceBlockId)
      break
    case 'insertBlock':
      insertBlock(store, operation.sectionId, operation.placement, operation.block)
      break
    case 'deleteBlock':
      deleteBlock(store, operation.blockId)
      break
    case 'upsertResource':
      upsertResource(store, operation.resource, options.resourceUrlPolicy)
      break
    case 'deleteResource':
      deleteResource(store, operation.resourceId)
      break
    case 'insertImage':
      insertImage(store, operation)
      break
    case 'replaceImageResource':
      replaceImageResource(store, operation.runId, operation.resourceId)
      break
    case 'deleteImage':
      deleteImage(store, operation.runId)
      break
    case 'resizeImage':
      resizeImage(store, operation.runId, operation.widthTwips, operation.heightTwips)
      break
    case 'setImageRotation':
      setImageRotation(store, operation.runId, operation.rotationDegrees)
      break
    case 'insertTable':
      insertBlock(store, operation.sectionId, operation.placement, operation.table)
      break
    case 'insertTableRow':
    case 'deleteTableRow':
    case 'insertTableColumn':
    case 'deleteTableColumn':
    case 'setTableColumnWidth':
    case 'setTableRowHeight':
    case 'mergeTableCells':
    case 'setTableBorder':
    case 'setTableCellText':
      applyTableOperation(store, operation)
      break
    case 'addCommentThread':
      addCommentThread(store, operation)
      break
    case 'replyCommentThread':
      replyCommentThread(store, operation)
      break
    case 'editCommentEntry':
      editCommentEntry(store, operation)
      break
    case 'resolveCommentThread':
      resolveCommentThread(store, operation)
      break
    case 'reopenCommentThread':
      reopenCommentThread(store, operation)
      break
    case 'deleteCommentThread':
      deleteCommentThread(store, operation.threadId)
      break
    case 'setRunLink':
      setRunLink(store, operation)
      break
    case 'addRevisionMetadata':
      addRevisionMetadata(store, operation)
      break
    case 'acceptRevision':
    case 'rejectRevision':
      resolveRevision(store, operation)
      break
  }
}
