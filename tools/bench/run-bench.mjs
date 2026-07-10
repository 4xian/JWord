/**
 * 职责：统一发现并顺序运行仓库 benchmark 入口。
 * 边界：只编排本地脚本执行和汇总发现数量，不解释各 benchmark 的业务指标。
 * 协作模块：benchmarks/gate2-render-benchmark.mjs、benchmarks/gate5-interop-benchmark.mjs 与 benchmarks/gate6-collab-benchmark.mjs。
 * 约束：任一 benchmark 失败时立即透传退出码，避免后续输出掩盖失败。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { spawnSync } from 'node:child_process'

const benchmarksRoot = 'benchmarks'
const benchmarkEntries = [
  join(benchmarksRoot, 'gate45-native-benchmark.mjs'),
  join(benchmarksRoot, 'gate2-render-benchmark.mjs'),
  join(benchmarksRoot, 'phase4-input-hotpath-benchmark.mjs'),
  join(benchmarksRoot, 'gate5-interop-benchmark.mjs'),
  join(benchmarksRoot, 'gate6-collab-benchmark.mjs')
]
const start = performance.now()

/** 递归统计 benchmark 目录中的文件数量。 */
function countFiles(dir) {
  if (!existsSync(dir)) {
    return 0
  }
  return readdirSync(dir, { withFileTypes: true }).reduce((count, entry) => {
    const next = join(dir, entry.name)
    if (entry.isDirectory()) {
      return count + countFiles(next)
    }
    return count + (entry.isFile() ? 1 : 0)
  }, 0)
}

const fileCount = countFiles(benchmarksRoot)
const duration = Math.round((performance.now() - start) * 100) / 100

for (const benchmarkEntry of benchmarkEntries) {
  if (!existsSync(benchmarkEntry)) {
    continue
  }

  const result = spawnSync(process.execPath, [benchmarkEntry], {
    stdio: 'inherit'
  })

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

console.log(
  JSON.stringify(
    {
      status: 'ok',
      benchmarksRoot,
      filesDiscovered: fileCount,
      durationMs: duration,
      note: fileCount === 0 ? 'No benchmark files yet.' : 'Benchmark files discovered.'
    },
    null,
    2
  )
)
