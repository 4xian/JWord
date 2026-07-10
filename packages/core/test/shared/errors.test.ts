/**
 * @vitest-environment node
 *
 * 职责：验证 Gate 1 非法 operation 和事务输入返回稳定错误码。
 * 边界：只覆盖 core error 类型、transaction 和 operation adapter，不测试 UI、诊断导出或 i18n 文案。
 * 协作模块：Editor facade、transaction pipeline 和 operation adapter 统一抛出可诊断错误。
 * 性能/安全约束：测试只使用内存文档，不访问 DOM、网络或磁盘。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import { describe, expect, it } from 'vitest'

import { createEditor } from '../../src/editor/runtime'
import { replayOperationFixture } from '../../src/operations/operation-fixture'
import type { OperationFixture } from '../../src/operations/operation-fixture'
import type { JWordErrorCode } from '../../src/index'
import type { RunId } from '../../src/model/position'
import { JWordError } from '../../src/shared/errors'

describe('JWordError codes', () => {
  it('returns a stable code for blank transaction origin', () => {
    const editor = createEditor()

    expect(() =>
      editor.executeCommand(
        {
          name: 'blank-origin',
          operations: []
        },
        { origin: '   ' }
      )
    ).toThrowError(expect.objectContaining({
      code: 'TRANSACTION_ORIGIN_EMPTY'
    }))

    editor.destroy()
  })

  it('returns a stable code for missing run operation targets', () => {
    const editor = createEditor({ initialText: 'abc' })

    expect(() =>
      editor.executeCommand({
        name: 'missing-run',
        operations: [
          {
            kind: 'setRunProperties',
            runId: 'missing-run' as RunId,
            properties: { bold: true }
          }
        ]
      })
    ).toThrowError(expect.objectContaining({
      code: 'OPERATION_RUN_NOT_FOUND'
    }))

    editor.destroy()
  })

  it('returns a stable code for missing editor anchor targets', () => {
    const editor = createEditor({ initialText: 'abc' })

    expect(() =>
      editor.createTextAnchor({
        sectionId: 'section-1',
        blockId: 'paragraph-1',
        runId: 'missing-run',
        graphemeIndex: 0
      })
    ).toThrowError(expect.objectContaining({
      code: 'EDITOR_ANCHOR_TARGET_NOT_FOUND'
    }))

    editor.destroy()
  })

  it('returns a stable code for unsupported cross-section deleteRange', () => {
    const editor = createEditor()

    editor.loadDocumentModel({
      document: {
        kind: 'document',
        id: 'document-1',
        sections: [{
          kind: 'section',
          id: 'section-1',
          blocks: [{
            kind: 'paragraph',
            id: 'paragraph-1',
            runs: [{
              kind: 'run',
              id: 'run-1',
              inlines: [{
                kind: 'text',
                text: 'abc'
              }]
            }]
          }]
        }, {
          kind: 'section',
          id: 'section-2',
          blocks: [{
            kind: 'paragraph',
            id: 'paragraph-2',
            runs: [{
              kind: 'run',
              id: 'run-2',
              inlines: [{
                kind: 'text',
                text: 'def'
              }]
            }]
          }]
        }]
      }
    })

    expect(() =>
      editor.executeCommand({
        name: 'cross-section-delete',
        operations: [
          {
            kind: 'deleteRange',
            range: {
              anchor: {
                sectionId: 'section-1',
                blockId: 'paragraph-1',
                runId: 'run-1',
                graphemeIndex: 1
              },
              focus: {
                sectionId: 'section-2',
                blockId: 'paragraph-2',
                runId: 'run-2',
                graphemeIndex: 1
              }
            }
          }
        ]
      })
    ).toThrowError(expect.objectContaining({
      code: 'OPERATION_DELETE_RANGE_UNSUPPORTED_SECTION'
    }))

    editor.destroy()
  })

  it('keeps diagnostic details on JWordError instances', () => {
    const code: JWordErrorCode = 'OPERATION_TEXT_INDEX_OUT_OF_BOUNDS'
    const error = new JWordError('OPERATION_TEXT_INDEX_OUT_OF_BOUNDS', '文本位置越界', {
      index: 5
    })

    expect(error.code).toBe(code)
    expect(error.details).toEqual({ index: 5 })
  })

  it('returns a stable code for unsupported operation fixture schema versions', () => {
    const editor = createEditor()
    const fixture = {
      schemaVersion: 999,
      name: 'bad-schema',
      initialDocument: { text: '' },
      steps: []
    } as unknown as OperationFixture

    expect(() => replayOperationFixture(editor, fixture)).toThrowError(expect.objectContaining({
      code: 'OPERATION_FIXTURE_SCHEMA_UNSUPPORTED'
    }))

    editor.destroy()
  })
})
