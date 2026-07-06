/**
 * @vitest-environment node
 *
 * 职责：锁定 Phase 4 输入热路径大文档 fixture 与 benchmark 接线。
 * 边界：只验证 10 万字 / 200 页 fixture、benchmark 输出字段和 runner 接入，不声明 P95 < 50ms 已达标。
 * 协作模块：fixtures/plain-text/gate2-large-fixture.mjs、benchmarks/phase4-input-hotpath-benchmark.mjs、tools/bench/run-bench.mjs 和 packages/core layout。
 * 约束：性能专项必须先有可机器读取基线，再进入 GX-01/G2-05 等优化批次。
 * Specs：docs/superpowers/reports/2026-07-03-remediation-execution-supplement.md#39-phase-4-性能专项输入热路径-p95--50ms。
 */
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

import {
  createFontManager,
  createPageConfig,
  layoutDocument
} from '../packages/core/src/index'
import type { DocumentProjection } from '../packages/core/src/index'
import {
  GATE2_LARGE_EXPECTED_PAGE_COUNT,
  GATE2_LARGE_MIN_CHARACTER_COUNT,
  createGate2LargeFixtureParagraphs
} from '../fixtures/plain-text/gate2-large-fixture.mjs'

describe('Phase 4 input hotpath benchmark', () => {
  it('大文档 fixture 固定 10 万字与 200 页性能基线', () => {
    const paragraphs = createGate2LargeFixtureParagraphs()
    const characterCount = paragraphs.join('\n').length
    const layout = layoutDocument({
      projection: createPlainTextProjection('phase4-large-fixture', paragraphs),
      pageConfig: createPageConfig(),
      fontManager: createFontManager({
        fallbackFontFamily: 'Arial',
        availableFontFamilies: ['Arial']
      })
    })

    expect(characterCount).toBeGreaterThanOrEqual(GATE2_LARGE_MIN_CHARACTER_COUNT)
    expect(layout.pages.length).toBe(GATE2_LARGE_EXPECTED_PAGE_COUNT)
  }, 30000)

  it('input hotpath benchmark 纳入 pnpm bench 可读指标', () => {
    const childEnv = {
      ...process.env,
      NODE_OPTIONS: '',
      VITEST: '',
      VITEST_MODE: ''
    }
    const result = spawnSync(process.execPath, ['benchmarks/phase4-input-hotpath-benchmark.mjs'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: childEnv
    })

    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')

    const benchmark = JSON.parse(result.stdout) as {
      readonly benchmark: string
      readonly fixture: string
      readonly pageCount: number
      readonly characterCount: number
      readonly inputHotPathP50Ms: number
      readonly inputHotPathP95Ms: number
      readonly inputTransactionP95Ms: number
      readonly inputLayoutP95Ms: number
      readonly segments: {
        readonly modelLoadDurationMs: number
        readonly initialLayoutDurationMs: number
        readonly visibleRenderDurationMs: number
      }
    }

    expect(benchmark.benchmark).toBe('phase4-input-hotpath')
    expect(benchmark.fixture).toBe('fixtures/plain-text/gate2-large-fixture.mjs')
    expect(benchmark.characterCount).toBeGreaterThanOrEqual(GATE2_LARGE_MIN_CHARACTER_COUNT)
    expect(benchmark.pageCount).toBe(GATE2_LARGE_EXPECTED_PAGE_COUNT)
    expect(benchmark.inputHotPathP50Ms).toBeGreaterThan(0)
    expect(benchmark.inputHotPathP95Ms).toBeGreaterThanOrEqual(benchmark.inputHotPathP50Ms)
    expect(benchmark.inputTransactionP95Ms).toBeGreaterThan(0)
    expect(benchmark.inputLayoutP95Ms).toBeGreaterThan(0)
    expect(benchmark.segments.modelLoadDurationMs).toBeGreaterThan(0)
    expect(benchmark.segments.initialLayoutDurationMs).toBeGreaterThan(0)
    expect(benchmark.segments.visibleRenderDurationMs).toBeGreaterThan(0)
  }, 30000)

  it('shared bench runner includes the Phase 4 input hotpath benchmark', () => {
    const runnerSource = readFileSync('tools/bench/run-bench.mjs', 'utf8')

    expect(runnerSource).toContain('phase4-input-hotpath-benchmark.mjs')
  })
})

function createPlainTextProjection(documentId: string, paragraphs: readonly string[]): DocumentProjection {
  return {
    document: {
      kind: 'document',
      id: documentId,
      sections: [
        {
          kind: 'section',
          id: `${documentId}-section`,
          blocks: paragraphs.map((line, index) => ({
            kind: 'paragraph',
            id: `${documentId}-paragraph-${index + 1}`,
            runs: [
              {
                kind: 'run',
                id: `${documentId}-run-${index + 1}`,
                properties: {
                  fontSizePx: 16
                },
                inlines: [
                  {
                    kind: 'text',
                    text: line
                  }
                ]
              }
            ]
          }))
        }
      ]
    }
  }
}
