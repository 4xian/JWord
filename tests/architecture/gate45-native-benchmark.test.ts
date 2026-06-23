/**
 * @vitest-environment node
 *
 * 职责：约束 Gate 4.5 native benchmark 的脚本入口和可审计输出字段。
 * 边界：只验证 benchmark 脚本结构、runner 接入和输出字段，不执行耗时 benchmark。
 * 协作模块：benchmarks/gate45-native-benchmark.mjs、tools/bench/run-bench.mjs、packages/native。
 * 约束：Gate 4.5 benchmark 必须记录 save/load/validate 耗时，并覆盖 1 页、50 页、200 页、图片和表格文档。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#iteration-6---benchmarkbundle-和文档计划。
 */
import { existsSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

describe('Gate 4.5 benchmark entry', () => {
  it('provides a dedicated native benchmark script with required metrics and fixture coverage', () => {
    const benchmarkPath = 'benchmarks/gate45-native-benchmark.mjs'

    expect(existsSync(benchmarkPath)).toBe(true)

    const source = readFileSync(benchmarkPath, 'utf8')

    for (const token of [
      'gate45-native',
      'saveDurationMs',
      'loadDurationMs',
      'validateDurationMs',
      'heapPeakBytes',
      'gate45-1-page',
      'gate45-50-pages',
      'gate45-200-pages',
      'gate45-image',
      'gate45-table'
    ]) {
      expect(source).toContain(token)
    }
  })

  it('runs the Gate 4.5 native benchmark from the shared bench runner', () => {
    const runnerSource = readFileSync('tools/bench/run-bench.mjs', 'utf8')

    expect(runnerSource).toContain('gate45-native-benchmark.mjs')
  })
})
