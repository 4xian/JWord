/**
 * @vitest-environment node
 *
 * 职责：锁定 Phase 5 架构纯度项的机器验收条件。
 * 边界：只覆盖 ID branding、命令 ID 分配器、AnchorRef 可变契约与 mergeBlock 实现约束。
 * 协作模块：`core position/store-types`、命令构造器、块操作适配器和共享错误码。
 * 约束：通过源码与规范文档检查防止架构债回流，不替代行为单测。
 * 实现说明：本测试只读取当前 core 源码，不读取旧审查计划或规范文档。
 */

import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

describe('Phase 5 architecture purity follow-ups', () => {
  it('uses the position Opaque helper as the single branded ID primitive', () => {
    const positionSource = readFileSync('packages/core/src/model/position.ts', 'utf8')
    const storeTypesSource = readFileSync('packages/core/src/model/store-types.ts', 'utf8')

    expect(positionSource).toContain('export type Opaque')
    expect(storeTypesSource).toContain('Opaque')
    expect(storeTypesSource).not.toContain('documentStoreIdBrand')
    expect(storeTypesSource).not.toContain('DocumentStoreId')
  })

  it('does not keep command ID sequence counters in module scope', () => {
    const commandBuilderSources = [
      'packages/core/src/operations/comment-command-builders.ts',
      'packages/core/src/operations/link-command-builders.ts',
      'packages/core/src/operations/revision-command-builders.ts',
      'packages/core/src/operations/table-commands.ts'
    ].map((path) => readFileSync(path, 'utf8')).join('\n')

    expect(commandBuilderSources).not.toMatch(/^let \w*Sequence =/mu)
  })

  it('documents AnchorRef as a mutable handle with guarded internal state mutation', () => {
    const positionSource = readFileSync('packages/core/src/model/position.ts', 'utf8')

    expect(positionSource).toContain('AnchorRef 是可变句柄')
    expect(positionSource).toContain('仅迁移/解析路径可变')
    expect(positionSource).toContain('resolveAnchorRef 会同步刷新')
  })

  it('records the mergeBlock adjacency constraint in core implementation', () => {
    const blockAdapterSource = readFileSync('packages/core/src/operations/block-adapter.ts', 'utf8')
    const errorSource = readFileSync('packages/core/src/shared/errors.ts', 'utf8')

    expect(blockAdapterSource).toContain('合并同一容器中相邻段落块')
    expect(blockAdapterSource).toContain('mergeBlock 暂只支持同一容器中的相邻段落')
    expect(errorSource).toContain('OPERATION_MERGE_BLOCK_NOT_ADJACENT')
  })
})
