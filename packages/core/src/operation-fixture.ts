/**
 * 职责：定义 Gate 1 operation fixture 的可序列化格式，并提供最小回放入口。
 * 边界：只把 JSON 形状的 fixture 转换为 Editor command，不读取磁盘、不写入外部状态、不实现 docx/collab/auto-inserter。
 * 协作模块：Editor facade、transaction pipeline、后续 docx/collab/auto-inserter 集成测试复用这里的 fixture 形状。
 * 性能/安全约束：仅处理小型 JSON 兼容数据，fixture 只保存 Operation/TextPosition/TextRange，不保存 AnchorRef 或 Yjs 相对位置。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/06-acceptance-and-testing.md。
 */

import type { Editor, EditorDocumentInput } from './editor'
import { createJWordError } from './errors'
import type { Command, Operation, TextPosition, TextRange, TransactionResult } from './transaction'
import type { DocumentProjection } from './projection'

/**
 * operation fixture 文件格式版本。
 */
export const OPERATION_FIXTURE_SCHEMA_VERSION = 1

/**
 * fixture 内的稳定文本锚点输入。
 *
 * @remarks
 * 这是纯 JSON 形状，不保存运行时 AnchorRef 或 Yjs 相对位置。
 */
export type SerializableTextAnchor = TextPosition

/**
 * fixture 内的稳定文本范围输入。
 */
export type SerializableTextRange = TextRange

/**
 * fixture 内可 JSON 序列化的 Gate 1 operation。
 */
export type SerializableOperation = Operation

/**
 * 单步 fixture command。
 */
export interface OperationFixtureStep {
  readonly name: string
  readonly origin: string
  readonly label?: string
  readonly operations: readonly SerializableOperation[]
}

/**
 * 可序列化、可回放的 operation fixture。
 */
export interface OperationFixture {
  readonly schemaVersion: typeof OPERATION_FIXTURE_SCHEMA_VERSION
  readonly name: string
  readonly initialDocument: EditorDocumentInput
  readonly steps: readonly OperationFixtureStep[]
  readonly expectedProjection?: DocumentProjection
}

/**
 * operation fixture 回放结果。
 */
export interface OperationFixtureReplayResult {
  readonly fixtureName: string
  readonly projection: DocumentProjection
  readonly transactions: readonly TransactionResult[]
}

/**
 * 回放 operation fixture。
 *
 * @param editor 由调用方创建和销毁的 Editor facade。
 * @param fixture 已从 JSON 解析出的 fixture。
 * @returns 回放后的 projection 和每步 transaction 结果。
 */
export function replayOperationFixture(
  editor: Editor,
  fixture: OperationFixture
): OperationFixtureReplayResult {
  if (fixture.schemaVersion !== OPERATION_FIXTURE_SCHEMA_VERSION) {
    throw createJWordError('OPERATION_FIXTURE_SCHEMA_UNSUPPORTED', 'operation fixture schemaVersion 不受支持', {
      schemaVersion: fixture.schemaVersion
    })
  }

  editor.createDocument(fixture.initialDocument)

  const transactions = fixture.steps.map((step) => {
    const command: Command = {
      name: step.name,
      operations: step.operations
    }

    return editor.executeCommand(command, {
      origin: step.origin,
      ...(step.label === undefined ? {} : { label: step.label })
    })
  })

  return {
    fixtureName: fixture.name,
    projection: editor.getProjection(),
    transactions
  }
}
