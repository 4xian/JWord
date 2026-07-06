/**
 * @vitest-environment node
 *
 * 职责：验证 Gate 7 R2 计划修订已把 persistence 分级和 size 工具收敛写回主计划。
 * 边界：只检查 canonical implementation plan 和 public API 清单，不执行构建或 size 脚本。
 * 协作模块：Gate 7 主计划、public API catalog 和 bundle size 校准方案共同消费这些冻结口径。
 * 约束：计划文档必须明确单一预算真源，避免 size-limit、check-size 与 Gate 6 bundle gate 三套口径漂移。
 * Specs：docs/superpowers/reports/2026-07-02-gate7-review.md#r2-复审补充。
 */

import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const canonicalPlanPath = 'docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md'
const publicApiPath = 'docs/sdk/public-api.md'

describe('Gate 7 R2 plan revision', () => {
  it('freezes persistence package landing, edition and export tiers in Iteration 0', () => {
    const plan = readFileSync(canonicalPlanPath, 'utf8')
    const publicApi = readFileSync(publicApiPath, 'utf8')

    expect(plan).toContain('`packages/persistence/src/`')
    expect(plan).toContain('`@4xian/jword-persistence` 导出分级')
    expect(plan).toContain('free base contract：基础 storage contract、基础 diagnostics、memory/storage adapter 类型')
    expect(publicApi).toContain('## @4xian/jword-persistence')
    expect(publicApi).toContain('Edition：free base contract')
  })

  it('declares one size-budget source of truth and keeps existing size tools scoped', () => {
    const plan = readFileSync(canonicalPlanPath, 'utf8')

    expect(plan).toContain('Step 7.19：建立 bundle size 单一预算真源')
    expect(plan).toContain('`tools/size/check-size.mjs` 是免费基础首屏预算真源')
    expect(plan).toContain('`tools/size/check-gate6-collab-bundle.mjs` 只保留为 paid collaboration lazy chunk 专项护栏')
    expect(plan).toContain('不再新增第三套会阻断 CI 的 size-limit 预算真源')
  })

  it('adds checkpoint F before Gate 7 public docs and wrappers consume the frozen surface', () => {
    const plan = readFileSync(canonicalPlanPath, 'utf8')
    const publicApi = readFileSync(publicApiPath, 'utf8')

    expect(plan).toContain('复核点 F：Gate 7 Iteration 0 完成后')
    expect(plan).toContain('一次性冻结 edition matrix、导出面、事件 payload 与 diagnostics 命名')
    expect(plan).toContain('文档站、类型测试、wrapper 和示例只能消费复核点 F 冻结面')
    expect(plan).toContain('docs/superpowers/plans/2026-07-06-gate7-risk-checkpoint-f.md')
    expect(publicApi).toContain('Gate 7 frozen surface sources')
    expect(publicApi).toContain('Docs, type tests, wrappers and examples must consume these frozen sources')
  })
})
