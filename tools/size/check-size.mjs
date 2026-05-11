import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const packagesRoot = 'packages'
const maxFileBytes = 250 * 1024
const failures = []
const files = []

function visit(dir) {
  if (!existsSync(dir)) {
    return
  }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const next = join(dir, entry.name)
    if (entry.isDirectory()) {
      visit(next)
      continue
    }
    if (entry.isFile() && /\.(?:mjs|js|css)$/u.test(entry.name)) {
      files.push(next)
      const size = statSync(next).size
      if (size > maxFileBytes) {
        failures.push(`${next} exceeds ${maxFileBytes} bytes: ${size}`)
      }
    }
  }
}

visit(packagesRoot)

if (failures.length > 0) {
  console.error(failures.join('\n'))
  process.exit(1)
}

console.log(
  JSON.stringify(
    {
      status: 'ok',
      checkedFiles: files.length,
      maxFileBytes,
      note: files.length === 0 ? 'No built package files yet.' : 'Built package files checked.'
    },
    null,
    2
  )
)
