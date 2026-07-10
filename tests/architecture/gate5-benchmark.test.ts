/**
 * @vitest-environment node
 *
 * 职责：约束 Gate 5 import/export/PDF benchmark 的脚本入口和可审计输出字段。
 * 边界：只验证 benchmark 脚本结构、runner 接入和输出字段，不执行耗时 benchmark。
 * 协作模块：benchmarks/gate5-interop-benchmark.mjs、tools/bench/run-bench.mjs、packages/docx 和 packages/pdf。
 * 约束：Gate 5 benchmark 必须记录 DOCX import/export/PDF export 耗时，并按文件大小、页数、图片数分组。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import { existsSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

describe('Gate 5 benchmark entry', () => {
  it('provides a dedicated interop benchmark script with required metrics and grouping fields', () => {
    const benchmarkPath = 'benchmarks/gate5-interop-benchmark.mjs'

    expect(existsSync(benchmarkPath)).toBe(true)

    const source = readFileSync(benchmarkPath, 'utf8')

    for (const token of [
      'gate5-interop',
      'docxImportDurationMs',
      'docxExportDurationMs',
      'pdfExportDurationMs',
      'heapPeakBytes',
      'workerHeapPeakBytes',
      'fileSizeBytes',
      'pageCount',
      'imageCount',
      'node:worker_threads',
      'workerData'
    ]) {
      expect(source).toContain(token)
    }
  })

  it('runs the Gate 5 interop benchmark from the shared bench runner', () => {
    const runnerSource = readFileSync('tools/bench/run-bench.mjs', 'utf8')

    expect(runnerSource).toContain('gate5-interop-benchmark.mjs')
  })
})
