import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'

const benchmarksRoot = 'benchmarks'
const start = performance.now()

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
