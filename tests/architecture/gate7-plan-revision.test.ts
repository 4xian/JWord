/**
 * @vitest-environment node
 *
 * 职责：验证 release 收口口径已把 persistence 分级和 size 工具收敛到当前实现文档。
 * 边界：只检查 `SDK public API`、稳定端到端矩阵和发布/体积脚本，不执行构建或体积脚本。
 * 协作模块：公开接口清单、稳定端到端矩阵、发布演练和体积工具共同消费这些冻结口径。
 * 约束：计划文档必须明确单一预算真源，避免 size-limit、check-size 与 Gate 6 bundle gate 三套口径漂移。
 * 实现说明：本测试不读取旧实施计划，只保护当前发布文档与工具事实。
 */

import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const publicApiPath = 'docs/sdk/public-api.md'
const stableMatrixPath = 'docs/sdk/stable-e2e-matrix.md'
const releaseDryRunPath = 'tools/release/gate7-release-dry-run.mjs'
const sizeCheckPath = 'tools/size/check-size.mjs'
const collabSizeCheckPath = 'tools/size/check-gate6-collab-bundle.mjs'

describe('Gate 7 R2 plan revision', () => {
  it('freezes persistence package landing, edition and export tiers in Iteration 0', () => {
    const publicApi = readFileSync(publicApiPath, 'utf8')

    expect(publicApi).toContain('free base contract：')
    expect(publicApi).toContain('基础 storage contract')
    expect(publicApi).toContain('基础 diagnostics')
    expect(publicApi).toContain('memory/storage adapter 类型')
    expect(publicApi).toContain('## @4xian/jword-persistence')
    expect(publicApi).toContain('Edition：free base contract')
    expect(publicApi).toContain('导出分级摘要')
    expect(publicApi).toContain('基础 storage contract')
    expect(publicApi).toContain('协作相关 persistence adapter 只在 paid collaboration 场景中作为高级能力消费')
  })

  it('declares one size-budget source of truth and keeps existing size tools scoped', () => {
    const matrix = readFileSync(stableMatrixPath, 'utf8')
    const sizeCheck = readFileSync(sizeCheckPath, 'utf8')
    const collabSizeCheck = readFileSync(collabSizeCheckPath, 'utf8')

    expect(matrix).toContain('bundle size')
    expect(matrix).toContain('release dry-run')
    expect(matrix).toContain('no-alias smoke')
    expect(sizeCheck).toContain('sizeBudgetRoadmap')
    expect(sizeCheck).toContain('coreEntryByteLimit')
    expect(sizeCheck).toContain('demoFirstScreenByteLimit')
    expect(collabSizeCheck).toContain('freeVanillaFirstScreenForbiddenTokens')
    expect(collabSizeCheck).toContain('collabLazyRequiredTokens')
    expect(readFileSync('package.json', 'utf8')).not.toContain('size-limit')
  })

  it('adds checkpoint F before Gate 7 public docs and wrappers consume the frozen surface', () => {
    const publicApi = readFileSync(publicApiPath, 'utf8')
    const releaseDryRun = readFileSync(releaseDryRunPath, 'utf8')

    expect(publicApi).toContain('Gate 7 frozen surface sources')
    expect(publicApi).toContain('Docs, type tests, wrappers and examples must consume these frozen sources')
    expect(publicApi).toContain('Edition matrix')
    expect(publicApi).toContain('Event payload')
    expect(publicApi).toContain('Diagnostics naming')
    expect(releaseDryRun).toContain('manualApprovalRequired: true')
  })
})
