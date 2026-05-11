/**
 * 职责：提供 Gate 1 的最小事务管线骨架。
 * 边界：负责 Command、Operation 和内部文档初始化 mutation 的 Y.Doc transact 包装，不实现布局、渲染、输入或协同。
 * 协作模块：后续 model、history、selection、Editor Facade 和外部自动插入通道将复用这里的 origin 语义。
 * 性能/安全约束：不访问 DOM，不做副作用归一化，只把编辑意图送入同一个 Y.Doc 事务。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/03-architecture.md 与 05-implementation-gates.md。
 */

import * as Y from 'yjs'

import type { Block, ModelProperties } from './model'
import { createDocumentProjection } from './projection'
import { createOperationAdapter } from './operation-adapter'
import type { AnchorRef, BlockId, RangeRef, RunId, SectionId } from './position'
import type { DocumentProjection } from './projection'

/**
 * Gate 1.4 首批操作名称。
 */
export type OperationKind =
  | 'insertText'
  | 'deleteRange'
  | 'setRunProperties'
  | 'setParagraphProperties'
  | 'splitBlock'
  | 'mergeBlock'
  | 'insertBlock'
  | 'deleteBlock'

const OPERATION_KINDS = new Set<OperationKind>([
  'insertText',
  'deleteRange',
  'setRunProperties',
  'setParagraphProperties',
  'splitBlock',
  'mergeBlock',
  'insertBlock',
  'deleteBlock'
])

/**
 * 插入块时相对现有块的位置。
 */
export type BlockInsertPlacement =
  | {
      readonly kind: 'before'
      readonly blockId: BlockId
    }
  | {
      readonly kind: 'after'
      readonly blockId: BlockId
    }
  | {
      readonly kind: 'append'
    }

interface OperationBase<Kind extends OperationKind> {
  readonly kind: Kind
}

/** 在稳定锚点处插入文本。 */
export interface InsertTextOperation extends OperationBase<'insertText'> {
  readonly at: AnchorRef
  readonly text: string
}

/** 删除稳定范围内的内容。 */
export interface DeleteRangeOperation extends OperationBase<'deleteRange'> {
  readonly range: RangeRef
}

/** 设置 run 级属性。 */
export interface SetRunPropertiesOperation extends OperationBase<'setRunProperties'> {
  readonly runId: RunId
  readonly properties: ModelProperties
}

/** 设置段落级属性。 */
export interface SetParagraphPropertiesOperation extends OperationBase<'setParagraphProperties'> {
  readonly paragraphId: BlockId
  readonly properties: ModelProperties
}

/** 在锚点处分裂块。 */
export interface SplitBlockOperation extends OperationBase<'splitBlock'> {
  readonly at: AnchorRef
  readonly newBlockId: BlockId
}

/** 合并两个相邻块。 */
export interface MergeBlockOperation extends OperationBase<'mergeBlock'> {
  readonly targetBlockId: BlockId
  readonly sourceBlockId: BlockId
}

/** 插入一个块级模型节点。 */
export interface InsertBlockOperation extends OperationBase<'insertBlock'> {
  readonly sectionId: SectionId
  readonly placement: BlockInsertPlacement
  readonly block: Block
}

/** 删除一个块级模型节点。 */
export interface DeleteBlockOperation extends OperationBase<'deleteBlock'> {
  readonly blockId: BlockId
}

/**
 * Gate 1.4 首批可序列化操作边界。
 */
export type Operation =
  | InsertTextOperation
  | DeleteRangeOperation
  | SetRunPropertiesOperation
  | SetParagraphPropertiesOperation
  | SplitBlockOperation
  | MergeBlockOperation
  | InsertBlockOperation
  | DeleteBlockOperation

/**
 * 最小命令描述。
 *
 * @remarks
 * Command 负责语义聚合，Operation 负责最小状态变更。
 */
export interface Command {
  readonly name: string
  readonly operations: readonly Operation[]
}

/**
 * 事务执行时附带的元数据。
 */
export interface TransactionMetadata {
  readonly origin: string
  readonly label?: string
}

/**
 * 事务管线的最小执行结果。
 */
export interface TransactionResult {
  readonly commandName: string
  readonly origin: string
  readonly metadata: TransactionMetadata
  readonly operations: readonly Operation[]
  readonly operationKinds: readonly OperationKind[]
  readonly projection: DocumentProjection
  readonly dirty: boolean
}

/**
 * 事务完成后对外发布的最小事件。
 */
export interface TransactionEvent {
  readonly commandName: string
  readonly origin: string
  readonly operationKinds: readonly OperationKind[]
  readonly projection: DocumentProjection
  readonly dirty: boolean
}

/**
 * 事务监听器。
 */
export type TransactionListener = (event: TransactionEvent) => void

/**
 * 内部文档级 mutation。
 *
 * @remarks
 * 仅供 Editor facade 创建文档或加载 fixture 使用；普通编辑仍应表达为 Command -> Operation。
 */
export type TransactionMutation = () => void

/**
 * 事务管线上下文。
 */
export interface TransactionPipeline {
  readonly doc: Y.Doc
  subscribe(listener: TransactionListener): () => void
  run(command: Command, metadata: TransactionMetadata): TransactionResult
  runMutation(
    commandName: string,
    metadata: TransactionMetadata,
    mutation: TransactionMutation
  ): TransactionResult
}

/**
 * 创建最小事务管线。
 *
 * @param doc 可选的 Y.Doc 实例。未提供时创建新的本地文档。
 * @returns 可执行 Command 的事务管线。
 *
 * @example
 * ```ts
 * const pipeline = createTransactionPipeline()
 * pipeline.run(
 *   { name: 'insertText', operations: [{ kind: 'insertText', at: anchor, text: '你好' }] },
 *   { origin: 'local-user' }
 * )
 * ```
 */
export function createTransactionPipeline(doc = new Y.Doc()): TransactionPipeline {
  const adapter = createOperationAdapter(doc)
  const listeners = new Set<TransactionListener>()

  return {
    doc,
    subscribe(listener) {
      listeners.add(listener)

      return () => {
        listeners.delete(listener)
      }
    },
    run(command, metadata) {
      validateTransactionInput(command, metadata)

      const operations = [...command.operations]
      const operationKinds = operations.map((operation) => operation.kind)
      const metadataSnapshot = { ...metadata }

      doc.transact(() => {
        adapter.applyAll(operations)
      }, metadataSnapshot.origin)

      const result = {
        commandName: command.name,
        origin: metadataSnapshot.origin,
        metadata: metadataSnapshot,
        operations,
        operationKinds,
        projection: createDocumentProjection(doc),
        dirty: operations.length > 0
      }

      notifyListeners(listeners, result)

      return result
    },
    runMutation(commandName, metadata, mutation) {
      validateTransactionName(commandName, metadata)

      const metadataSnapshot = { ...metadata }

      doc.transact(() => {
        mutation()
      }, metadataSnapshot.origin)

      const result = {
        commandName,
        origin: metadataSnapshot.origin,
        metadata: metadataSnapshot,
        operations: [],
        operationKinds: [],
        projection: createDocumentProjection(doc),
        dirty: true
      }

      notifyListeners(listeners, result)

      return result
    }
  }
}

function validateTransactionInput(command: Command, metadata: TransactionMetadata): void {
  validateTransactionName(command.name, metadata)

  for (const operation of command.operations) {
    if (!OPERATION_KINDS.has(operation.kind)) {
      throw new Error('未知 operation kind')
    }
  }
}

function validateTransactionName(commandName: string, metadata: TransactionMetadata): void {
  if (commandName.trim().length === 0) {
    throw new Error('事务命令名不能为空')
  }

  if (metadata.origin.trim().length === 0) {
    throw new Error('事务 origin 不能为空')
  }
}

function notifyListeners(
  listeners: ReadonlySet<TransactionListener>,
  result: TransactionResult
): void {
  const event: TransactionEvent = {
    commandName: result.commandName,
    origin: result.origin,
    operationKinds: result.operationKinds,
    projection: result.projection,
    dirty: result.dirty
  }

  for (const listener of listeners) {
    listener(event)
  }
}
