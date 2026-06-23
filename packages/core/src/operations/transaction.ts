/**
 * 职责：提供 Gate 1 的最小事务管线骨架。
 * 边界：负责 Command、Operation 和内部文档初始化 mutation 的 Y.Doc transact 包装，不实现布局、渲染、输入或协同。
 * 协作模块：后续 model、history、selection、Editor Facade 和外部自动插入通道将复用这里的 origin 语义。
 * 性能/安全约束：不访问 DOM，不做副作用归一化，只把编辑意图送入同一个 Y.Doc 事务。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/03-architecture.md 与 05-implementation-gates.md。
 */

import * as Y from 'yjs'

import type { Block, Comment, CommentMessage, ImageInline, ModelProperties, RevisionMetadata, RunLink, TableBorder } from '../model/types'
import { createDocumentProjection } from '../model/projection'
import { createOperationAdapter } from './operation-adapter'
import { createJWordError } from '../shared/errors'
import type { DocumentProjection } from '../model/projection'
import type { TextRangeRecord } from '../model/position'
import type { Resource, ResourceUrlPolicy } from '../resources/types'

/**
 * Gate 1.4 首批操作名称。
 */
export type OperationKind =
  | 'insertText'
  | 'deleteRange'
  | 'setRunProperties'
  | 'setParagraphProperties'
  | 'setSectionProperties'
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
  | 'insertTable'
  | 'insertTableRow'
  | 'deleteTableRow'
  | 'insertTableColumn'
  | 'deleteTableColumn'
  | 'setTableColumnWidth'
  | 'setTableRowHeight'
  | 'mergeTableCells'
  | 'setTableBorder'
  | 'setTableCellText'
  | 'addCommentThread'
  | 'replyCommentThread'
  | 'editCommentEntry'
  | 'resolveCommentThread'
  | 'reopenCommentThread'
  | 'deleteCommentThread'
  | 'setRunLink'
  | 'addRevisionMetadata'

const OPERATION_KINDS = new Set<OperationKind>([
  'insertText',
  'deleteRange',
  'setRunProperties',
  'setParagraphProperties',
  'setSectionProperties',
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
  'setImageRotation',
  'insertTable',
  'insertTableRow',
  'deleteTableRow',
  'insertTableColumn',
  'deleteTableColumn',
  'setTableColumnWidth',
  'setTableRowHeight',
  'mergeTableCells',
  'setTableBorder',
  'setTableCellText',
  'addCommentThread',
  'replyCommentThread',
  'editCommentEntry',
  'resolveCommentThread',
  'reopenCommentThread',
  'deleteCommentThread',
  'setRunLink',
  'addRevisionMetadata'
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

/** 设置节级属性和页眉页脚引用。 */
export interface SetSectionPropertiesOperation extends OperationBase<'setSectionProperties'> {
  readonly sectionId: string
  readonly properties: ModelProperties
  readonly headerIds?: readonly string[]
  readonly footerIds?: readonly string[]
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

/** 插入简单表格。 */
export interface InsertTableOperation extends OperationBase<'insertTable'> {
  readonly sectionId: string
  readonly placement: BlockInsertPlacement
  readonly table: Extract<Block, { readonly kind: 'table' }>
}

/** 插入表格行。 */
export interface InsertTableRowOperation extends OperationBase<'insertTableRow'> {
  readonly tableId: string
  readonly rowIndex: number
  readonly rowHeightTwips?: number
  readonly rowId: string
  readonly cellIds: readonly string[]
  readonly paragraphIds: readonly string[]
  readonly runIds: readonly string[]
}

/** 删除表格行。 */
export interface DeleteTableRowOperation extends OperationBase<'deleteTableRow'> {
  readonly tableId: string
  readonly rowIndex: number
}

/** 插入表格列。 */
export interface InsertTableColumnOperation extends OperationBase<'insertTableColumn'> {
  readonly tableId: string
  readonly columnIndex: number
  readonly columnWidthTwips?: number
  readonly cellIds: readonly string[]
  readonly paragraphIds: readonly string[]
  readonly runIds: readonly string[]
}

/** 删除表格列。 */
export interface DeleteTableColumnOperation extends OperationBase<'deleteTableColumn'> {
  readonly tableId: string
  readonly columnIndex: number
}

/** 设置表格列宽。 */
export interface SetTableColumnWidthOperation extends OperationBase<'setTableColumnWidth'> {
  readonly tableId: string
  readonly columnIndex: number
  readonly widthTwips: number
}

/** 设置表格行高。 */
export interface SetTableRowHeightOperation extends OperationBase<'setTableRowHeight'> {
  readonly tableId: string
  readonly rowIndex: number
  readonly heightTwips: number
}

/** 合并同一行内连续单元格。 */
export interface MergeTableCellsOperation extends OperationBase<'mergeTableCells'> {
  readonly tableId: string
  readonly rowIndex: number
  readonly startColumnIndex: number
  readonly endColumnIndex: number
}

/** 设置表格或单元格边框。 */
export interface SetTableBorderOperation extends OperationBase<'setTableBorder'> {
  readonly tableId: string
  readonly cellId?: string
  readonly border: TableBorder
}

/** 替换单元格第一段第一 run 的文本。 */
export interface SetTableCellTextOperation extends OperationBase<'setTableCellText'> {
  readonly tableId: string
  readonly cellId: string
  readonly text: string
}

/** 创建新的批注 thread。 */
export interface AddCommentThreadOperation extends OperationBase<'addCommentThread'> {
  readonly thread: Comment
  readonly range: TextRangeRecord
}

/** 在线程下追加回复。 */
export interface ReplyCommentThreadOperation extends OperationBase<'replyCommentThread'> {
  readonly threadId: string
  readonly message: CommentMessage
}

/** 编辑线程中的一条回复。 */
export interface EditCommentEntryOperation extends OperationBase<'editCommentEntry'> {
  readonly threadId: string
  readonly messageId: string
  readonly text: string
  readonly editedAt: string
}

/** 解决批注 thread。 */
export interface ResolveCommentThreadOperation extends OperationBase<'resolveCommentThread'> {
  readonly threadId: string
}

/** 重新打开批注 thread。 */
export interface ReopenCommentThreadOperation extends OperationBase<'reopenCommentThread'> {
  readonly threadId: string
}

/** 删除整条批注 thread。 */
export interface DeleteCommentThreadOperation extends OperationBase<'deleteCommentThread'> {
  readonly threadId: string
}

/** 局部或整体设置 run 链接。 */
export interface SetRunLinkRange {
  readonly startGraphemeIndex: number
  readonly endGraphemeIndex: number
  readonly linkedRunId?: string
  readonly trailingRunId?: string
}

/** 设置或移除 run 链接。 */
export interface SetRunLinkOperation extends OperationBase<'setRunLink'> {
  readonly runId: string
  readonly link: RunLink | null
  readonly range?: SetRunLinkRange
}

/** 写入修订 metadata 并标记目标 run。 */
export interface AddRevisionMetadataOperation extends OperationBase<'addRevisionMetadata'> {
  readonly revision: RevisionMetadata
  readonly runId: string
}

/**
 * Gate 1.4 首批可序列化操作边界。
 */
export type Operation =
  | InsertTextOperation
  | DeleteRangeOperation
  | SetRunPropertiesOperation
  | SetParagraphPropertiesOperation
  | SetSectionPropertiesOperation
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
  | InsertTableOperation
  | InsertTableRowOperation
  | DeleteTableRowOperation
  | InsertTableColumnOperation
  | DeleteTableColumnOperation
  | SetTableColumnWidthOperation
  | SetTableRowHeightOperation
  | MergeTableCellsOperation
  | SetTableBorderOperation
  | SetTableCellTextOperation
  | AddCommentThreadOperation
  | ReplyCommentThreadOperation
  | EditCommentEntryOperation
  | ResolveCommentThreadOperation
  | ReopenCommentThreadOperation
  | DeleteCommentThreadOperation
  | SetRunLinkOperation
  | AddRevisionMetadataOperation

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
  readonly historyOrigin?: unknown
  readonly label?: string
  readonly requestId?: string
  readonly roomId?: string
  readonly clientId?: string
  readonly authorId?: string
  readonly source?: TransactionDiagnosticSource
  readonly snapshotId?: string
  readonly versionId?: string
  readonly recoverable?: boolean
}

/** Gate 6 事务诊断来源。 */
export type TransactionDiagnosticSource =
  | 'local'
  | 'remote'
  | 'system-recovery'
  | 'version-restore'
  | 'auto-inserter'

/** 事务完成后对外可见的稳定诊断字段。 */
export interface TransactionDiagnostic {
  readonly commandName: string
  readonly origin: string
  readonly operationKinds: readonly OperationKind[]
  readonly updateByteLength: number
  readonly source: TransactionDiagnosticSource
  readonly local: boolean
  readonly remote: boolean
  readonly requestId?: string
  readonly roomId?: string
  readonly clientId?: string
  readonly authorId?: string
  readonly snapshotId?: string
  readonly versionId?: string
  readonly recoverable?: boolean
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
  readonly diagnostic: TransactionDiagnostic
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
  readonly diagnostic: TransactionDiagnostic
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

/** 远端或恢复通道应用 Yjs update 的输入元数据。 */
export interface TransactionUpdateMetadata extends TransactionMetadata {
  readonly origin: 'remote-user' | 'system-recovery' | 'version-restore' | 'auto-inserter'
}

/**
 * 事务管线上下文。
 */
export interface TransactionPipeline {
  readonly doc: Y.Doc
  subscribe(listener: TransactionListener): () => void
  run(command: Command, metadata: TransactionMetadata): TransactionResult
  applyUpdate(update: Uint8Array, metadata: TransactionUpdateMetadata): TransactionResult
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
      const stateBefore = Y.encodeStateVector(doc)

      doc.transact(() => {
        adapter.applyAll(operations)
      }, metadataSnapshot.historyOrigin ?? metadataSnapshot.origin)

      const updateByteLength = readUpdateByteLength(doc, stateBefore)
      const result = {
        commandName: command.name,
        origin: metadataSnapshot.origin,
        metadata: metadataSnapshot,
        operations,
        operationKinds,
        projection: createDocumentProjection(doc),
        dirty: operations.length > 0,
        diagnostic: createTransactionDiagnostic(command.name, operationKinds, metadataSnapshot, updateByteLength)
      }

      notifyListeners(listeners, result)

      return result
    },
    applyUpdate(update, metadata) {
      validateTransactionName('applySyncUpdate', metadata)

      const metadataSnapshot = { ...metadata }
      const stateBefore = Y.encodeStateVector(doc)

      Y.applyUpdate(doc, update, metadataSnapshot.historyOrigin ?? metadataSnapshot.origin)

      const updateByteLength = readUpdateByteLength(doc, stateBefore)
      const result = {
        commandName: 'applySyncUpdate',
        origin: metadataSnapshot.origin,
        metadata: metadataSnapshot,
        operations: [],
        operationKinds: [],
        projection: createDocumentProjection(doc),
        dirty: updateByteLength > 0,
        diagnostic: createTransactionDiagnostic('applySyncUpdate', [], metadataSnapshot, updateByteLength)
      }

      notifyListeners(listeners, result)

      return result
    },
    runMutation(commandName, metadata, mutation) {
      validateTransactionName(commandName, metadata)

      const metadataSnapshot = { ...metadata }
      const stateBefore = Y.encodeStateVector(doc)

      doc.transact(() => {
        mutation()
      }, metadataSnapshot.historyOrigin ?? metadataSnapshot.origin)

      const updateByteLength = readUpdateByteLength(doc, stateBefore)
      const result = {
        commandName,
        origin: metadataSnapshot.origin,
        metadata: metadataSnapshot,
        operations: [],
        operationKinds: [],
        projection: createDocumentProjection(doc),
        dirty: true,
        diagnostic: createTransactionDiagnostic(commandName, [], metadataSnapshot, updateByteLength)
      }

      notifyListeners(listeners, result)

      return result
    }
  }
}

function readUpdateByteLength(doc: Y.Doc, stateBefore: Uint8Array): number {
  const stateAfter = Y.encodeStateVector(doc)

  if (areUint8ArraysEqual(stateBefore, stateAfter)) {
    return 0
  }

  return Y.encodeStateAsUpdate(doc, stateBefore).byteLength
}

function areUint8ArraysEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) {
    return false
  }

  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) {
      return false
    }
  }

  return true
}

function createTransactionDiagnostic(
  commandName: string,
  operationKinds: readonly OperationKind[],
  metadata: TransactionMetadata,
  updateByteLength: number
): TransactionDiagnostic {
  const source = resolveTransactionDiagnosticSource(metadata)

  return {
    commandName,
    origin: metadata.origin,
    operationKinds,
    updateByteLength,
    source,
    local: source === 'local',
    remote: source === 'remote',
    ...(metadata.requestId === undefined ? {} : { requestId: metadata.requestId }),
    ...(metadata.roomId === undefined ? {} : { roomId: metadata.roomId }),
    ...(metadata.clientId === undefined ? {} : { clientId: metadata.clientId }),
    ...(metadata.authorId === undefined ? {} : { authorId: metadata.authorId }),
    ...(metadata.snapshotId === undefined ? {} : { snapshotId: metadata.snapshotId }),
    ...(metadata.versionId === undefined ? {} : { versionId: metadata.versionId }),
    ...(metadata.recoverable === undefined ? {} : { recoverable: metadata.recoverable })
  }
}

function resolveTransactionDiagnosticSource(metadata: TransactionMetadata): TransactionDiagnosticSource {
  if (metadata.source !== undefined) {
    return metadata.source
  }

  if (metadata.origin === 'remote-user') {
    return 'remote'
  }
  if (metadata.origin === 'system-recovery') {
    return 'system-recovery'
  }
  if (metadata.origin === 'version-restore') {
    return 'version-restore'
  }
  if (metadata.origin === 'auto-inserter') {
    return 'auto-inserter'
  }

  return 'local'
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
    dirty: result.dirty,
    diagnostic: result.diagnostic
  }

  for (const listener of listeners) {
    listener(event)
  }
}
