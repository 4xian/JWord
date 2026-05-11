import { existsSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

const roots = ['packages', 'examples']

function hasVisualTests(dir) {
  if (!existsSync(dir)) {
    return false
  }
  return readdirSync(dir, { withFileTypes: true }).some((entry) => {
    const next = join(dir, entry.name)
    if (entry.isDirectory()) {
      return hasVisualTests(next)
    }
    return entry.isFile() && entry.name.endsWith('.visual.ts')
  })
}

if (!roots.some(hasVisualTests)) {
  console.log('No visual tests yet; visual check skipped.')
  process.exit(0)
}

const result = spawnSync(
  'pnpm',
  ['exec', 'playwright', 'test', '--project=visual-chromium', '--pass-with-no-tests'],
  { stdio: 'inherit' }
)

process.exit(result.status ?? 1)
