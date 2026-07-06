/**
 * @vitest-environment node
 *
 * 职责：锁定 Phase 5 架构纯度项的机器验收条件。
 * 边界：只覆盖审查计划点名的 ID branding、命令 ID 分配器、AnchorRef 可变契约与 mergeBlock 约束文档。
 * 协作模块：core position/store-types、operation command builders 和 canonical architecture spec。
 * 约束：通过源码与规范文档检查防止架构债回流，不替代行为单测。
 * Specs：docs/superpowers/reports/2026-07-02-jword-remediation-plan.md#phase-5---p3-改进与技术债清理。
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

  it('records the mergeBlock adjacency constraint in the architecture spec', () => {
    const architectureSpec = readFileSync(
      'docs/superpowers/specs/2026-05-11-jword-canonical/03-architecture.md',
      'utf8'
    )

    expect(architectureSpec).toContain('`mergeBlock` 仅支持同一容器中的相邻段落')
    expect(architectureSpec).toContain('OPERATION_MERGE_BLOCK_NOT_ADJACENT')
  })
})
