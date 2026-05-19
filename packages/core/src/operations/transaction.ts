/**
 * 职责：提供 Gate 1 的最小事务管线骨架。
 * 边界：负责 Command、Operation 和内部文档初始化 mutation 的 Y.Doc transact 包装，不实现布局、渲染、输入或协同。
 * 协作模块：后续 model、history、selection、Editor Facade 和外部自动插入通道将复用这里的 origin 语义。
 * 性能/安全约束：不访问 DOM，不做副作用归一化，只把编辑意图送入同一个 Y.Doc 事务。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/03-architecture.md 与 05-implementation-gates.md。
 */

import * as Y from 'yjs'

import type { Block, ImageInline, ModelProperties } from '../model/types'
import { createDocumentProjection } from '../model/projection'
import { createOperationAdapter } from './operation-adapter'
import { createJWordError } from '../shared/errors'
import type { DocumentProjection } from '../model/projection'
import type { Resource, ResourceUrlPolicy } from '../resources/types'

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
  | 'upsertResource'
  | 'deleteResource'
  | 'insertImage'
  | 'replaceImageResource'
  | 'deleteImage'
  | 'resizeImage'
  | 'setImageRotation'

const OPERATION_KINDS = new Set<OperationKind>([
  'insertText',
  'deleteRange',
  'setRunProperties',
  'setParagraphProperties',
  'splitBlock',
  'mergeBlock',
  'insertBlock',
  'deleteBlock',
  'upsertResource',
  'deleteResource',
  'insertImage',
  'replaceImageResource',
  'deleteImage',
  'resizeImage',
  'setImageRotation'
])

/**
 * 插入块时相对现有块的位置。
 */
export type BlockInsertPlacement =
  | {
      readonly kind: 'before'
      readonly blockId: string
    }
  | {
      readonly kind: 'after'
      readonly blockId: string
    }
  | {
      readonly kind: 'append'
    }

/**
 * 可序列化文本位置。
 *
 * @remarks
 * Operation 只能携带 JSON 兼容位置；运行时 AnchorRef 需要先由 Editor facade 解析成该形状。
 */
export interface TextPosition {
  readonly sectionId: string
  readonly blockId: string
  readonly runId: string
  readonly graphemeIndex: number
  readonly assoc?: number
}

/** 可序列化文本范围。 */
export interface TextRange {
  readonly anchor: TextPosition
  readonly focus: TextPosition
}

interface OperationBase<Kind extends OperationKind> {
  readonly kind: Kind
}

/** 在稳定锚点处插入文本。 */
export interface InsertTextOperation extends OperationBase<'insertText'> {
  readonly at: TextPosition
  readonly text: string
}

/** 删除稳定范围内的内容。 */
export interface DeleteRangeOperation extends OperationBase<'deleteRange'> {
  readonly range: TextRange
}

/** 设置 run 级属性。 */
export interface SetRunPropertiesRange {
  readonly startGraphemeIndex: number
  readonly endGraphemeIndex: number
  readonly formattedRunId?: string
  readonly trailingRunId?: string
}

/** 设置 run 级属性。 */
export interface SetRunPropertiesOperation extends OperationBase<'setRunProperties'> {
  readonly runId: string
  readonly properties: ModelProperties
  readonly range?: SetRunPropertiesRange
}

/** 设置段落级属性。 */
export interface SetParagraphPropertiesOperation extends OperationBase<'setParagraphProperties'> {
  readonly paragraphId: string
  readonly properties: ModelProperties
}

/** 在锚点处分裂块。 */
export interface SplitBlockOperation extends OperationBase<'splitBlock'> {
  readonly at: TextPosition
  readonly newBlockId: string
  readonly newRunId: string
}

/** 合并两个相邻块。 */
export interface MergeBlockOperation extends OperationBase<'mergeBlock'> {
  readonly targetBlockId: string
  readonly sourceBlockId: string
}

/** 插入一个块级模型节点。 */
export interface InsertBlockOperation extends OperationBase<'insertBlock'> {
  readonly sectionId: string
  readonly placement: BlockInsertPlacement
  readonly block: Block
}

/** 删除一个块级模型节点。 */
export interface DeleteBlockOperation extends OperationBase<'deleteBlock'> {
  readonly blockId: string
}

/** 新增或覆盖资源表中的资源快照。 */
export interface UpsertResourceOperation extends OperationBase<'upsertResource'> {
  readonly resource: Resource
}

/** 从资源表中删除资源快照。 */
export interface DeleteResourceOperation extends OperationBase<'deleteResource'> {
  readonly resourceId: string
}

/** 在当前文本位置插入图片。 */
export interface InsertImageOperation extends OperationBase<'insertImage'> {
  readonly at: TextPosition
  readonly imageRunId: string
  readonly trailingRunId?: string
  readonly mode: 'inline'
  readonly image: ImageInline
}

/** 替换当前图片 run 指向的资源。 */
export interface ReplaceImageResourceOperation extends OperationBase<'replaceImageResource'> {
  readonly runId: string
  readonly resourceId: string
}

/** 删除当前图片 run。 */
export interface DeleteImageOperation extends OperationBase<'deleteImage'> {
  readonly runId: string
}

/** 调整当前图片 run 的尺寸。 */
export interface ResizeImageOperation extends OperationBase<'resizeImage'> {
  readonly runId: string
  readonly widthTwips: number
  readonly heightTwips: number
}

/** 更新当前图片 run 的旋转角度。 */
export interface SetImageRotationOperation extends OperationBase<'setImageRotation'> {
  readonly runId: string
  readonly rotationDegrees: number
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
  | UpsertResourceOperation
  | DeleteResourceOperation
  | InsertImageOperation
  | ReplaceImageResourceOperation
  | DeleteImageOperation
  | ResizeImageOperation
  | SetImageRotationOperation

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

export interface TransactionPipelineOptions {
  readonly resourceUrlPolicy?: ResourceUrlPolicy
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
 *   { name: 'insertText', operations: [{ kind: 'insertText', at: position, text: '你好' }] },
 *   { origin: 'local-user' }
 * )
 * ```
 */
export function createTransactionPipeline(
  doc = new Y.Doc(),
  options: TransactionPipelineOptions = {}
): TransactionPipeline {
  const adapter = createOperationAdapter(doc, {
    ...(options.resourceUrlPolicy === undefined ? {} : { resourceUrlPolicy: options.resourceUrlPolicy })
  })
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
      throw createJWordError('OPERATION_KIND_UNKNOWN', '未知 operation kind', {
        kind: operation.kind
      })
    }
  }
}

function validateTransactionName(commandName: string, metadata: TransactionMetadata): void {
  if (commandName.trim().length === 0) {
    throw createJWordError('TRANSACTION_COMMAND_EMPTY', '事务命令名不能为空')
  }

  if (metadata.origin.trim().length === 0) {
    throw createJWordError('TRANSACTION_ORIGIN_EMPTY', '事务 origin 不能为空')
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
