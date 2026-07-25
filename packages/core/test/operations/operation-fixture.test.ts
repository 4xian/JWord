/**
 * @vitest-environment node
 *
 * 职责：验证 Gate 1.12 operation fixture 可以从 JSON 序列化格式回放到 Editor transaction pipeline。
 * 边界：只覆盖 fixture 读取、operation 重建和 projection 对比，不测试 docx、协同、自动插入器或磁盘写入。
 * 协作模块：Editor facade、transaction pipeline 和后续 docx/collab/auto-inserter 集成测试会复用同一 fixture 形状。
 * 性能/安全约束：测试只读取仓库内小型 JSON fixture，不访问 DOM、网络或外部文档。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { createEditor } from '../../src/editor/runtime'
import { replayOperationFixture } from '../../src/operations/operation-fixture'
import type { OperationFixture } from '../../src/operations/operation-fixture'

describe('operation fixture replay', () => {
  it('replays a serialized Gate 1 operation fixture into the expected projection', async () => {
    const fixturePath = fileURLToPath(
      new URL('../../../../fixtures/operation-fixtures/gate1-minimal-edit.json', import.meta.url)
    )
    const fixture = JSON.parse(await readFile(fixturePath, 'utf8')) as OperationFixture
    const editor = createEditor()

    const result = replayOperationFixture(editor, fixture)

    expect(result.transactions.map((transaction) => transaction.commandName)).toEqual([
      'insert-title-prefix',
      'style-title',
      'delete-body-tail',
      'insert-summary-block',
      'insert-temp-block',
      'split-temp-block',
      'merge-temp-block',
      'delete-temp-block'
    ])
    expect(result.transactions.flatMap((transaction) => transaction.operationKinds)).toEqual([
      'insertText',
      'setRunProperties',
      'setParagraphProperties',
      'deleteRange',
      'insertBlock',
      'insertBlock',
      'splitBlock',
      'mergeBlock',
      'deleteBlock'
    ])
    expect(JSON.parse(JSON.stringify(result.projection))).toEqual(fixture.expectedProjection)

    editor.destroy()
  })
})
