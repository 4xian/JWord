import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const coreRoot = join('packages', 'core')
const sourceRoots = ['packages', 'examples', 'tools']
const forbiddenImports = [
  'react',
  'react-dom',
  'vue',
  '@4xian/jword-ui',
  '@4xian/jword-docx',
  '@4xian/jword-pdf',
  '@4xian/jword-collab',
  '@4xian/jword-react',
  '@4xian/jword-vue',
  '@hocuspocus/server',
  'hocuspocus',
  'jszip',
  'pdf-lib',
  'fontkit',
  'vite',
  '@playwright/test'
]
const importPattern = /^\s*import(?:\s+type)?[\s\S]*?from\s+["']([^"']+)["'];?/gmu
const failures = []

function listTypeScriptFiles(dir) {
  if (!existsSync(dir)) {
    return []
  }
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const next = join(dir, entry.name)
    if (entry.isDirectory()) {
      return listTypeScriptFiles(next)
    }
    return entry.isFile() && next.endsWith('.ts') ? [next] : []
  })
}

function listFiles(dir) {
  if (!existsSync(dir)) {
    return []
  }
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const next = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') {
        return []
      }
      return listFiles(next)
    }
    return entry.isFile() ? [next] : []
  })
}

function stripStringLiterals(line) {
  return line
    .replace(/'(?:\\.|[^'\\])*'/gu, "''")
    .replace(/"(?:\\.|[^"\\])*"/gu, '""')
    .replace(/`(?:\\.|[^`\\])*`/gu, '``')
}

for (const sourceRoot of sourceRoots) {
  for (const file of listFiles(sourceRoot)) {
    const isTestFile = /\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(file)
    const isInSourceDirectory = /(?:^|[/\\])src[/\\]/u.test(file)

    if (isTestFile && isInSourceDirectory) {
      failures.push(`${file}: 测试文件必须放在 test/ 或 tests/ 目录，不能放在 src/ 源码目录。`)
    }
  }
}

for (const file of listTypeScriptFiles(coreRoot)) {
  if (/\.(?:test|spec)\.ts$/u.test(file)) {
    continue
  }

  const source = readFileSync(file, 'utf8')
  for (const match of source.matchAll(importPattern)) {
    const specifier = match[1] ?? ''
    const isForbidden = forbiddenImports.some(
      (blocked) => specifier === blocked || specifier.startsWith(`${blocked}/`)
    )
    if (isForbidden) {
      failures.push(`${file}: forbidden core import '${specifier}'`)
    }
  }

  let braceDepth = 0
  for (const [index, line] of source.split(/\r?\n/u).entries()) {
    const trimmed = line.trim()
    const isDeclarationOnly =
      trimmed === '' ||
      trimmed.startsWith('//') ||
      trimmed.startsWith('*') ||
      trimmed.startsWith('/*') ||
      trimmed.startsWith('import ') ||
      trimmed.startsWith('export type ') ||
      trimmed.startsWith('type ') ||
      trimmed.startsWith('interface ')
    const searchableLine = stripStringLiterals(trimmed)
    const hasTopLevelDomReference =
      braceDepth === 0 &&
      !isDeclarationOnly &&
      /\b(?:window|document|HTMLElement)\b/u.test(searchableLine)

    if (hasTopLevelDomReference) {
      failures.push(`${file}:${index + 1}: possible top-level DOM access '${trimmed}'`)
    }

    braceDepth += (line.match(/\{/gu) ?? []).length
    braceDepth -= (line.match(/\}/gu) ?? []).length
    if (braceDepth < 0) {
      braceDepth = 0
    }
  }
}

if (failures.length > 0) {
  console.error(failures.join('\n'))
  process.exit(1)
}

console.log('core boundary scan passed.')
