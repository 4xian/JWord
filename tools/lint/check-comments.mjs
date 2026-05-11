import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import ts from 'typescript'

const root = process.cwd()
const sourceExtensions = new Set(['.js', '.mjs', '.ts', '.tsx'])
const ignoredDirectories = new Set([
  '.git',
  'coverage',
  'dist',
  'logs',
  'node_modules',
  'playwright-report',
  'test-results'
])
const maxEnglishWordsInSegment = 5
const failures = []

function listSourceFiles(dir) {
  if (!existsSync(dir)) {
    return []
  }

  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) {
      return []
    }

    const next = join(dir, entry.name)
    if (entry.isDirectory()) {
      return listSourceFiles(next)
    }

    return entry.isFile() && sourceExtensions.has(extname(entry.name)) ? [next] : []
  })
}

function removeCommentSyntax(comment) {
  if (comment.startsWith('//')) {
    return comment.replace(/^\/\/\/?/u, '')
  }

  return comment.replace(/^\/\*+/u, '').replace(/\*\/$/u, '')
}

function stripLinePrefix(line) {
  return line.replace(/^\s*\* ?/u, '').trim()
}

function stripAllowedTokens(text) {
  return text
    .replace(/```[\s\S]*?```/gu, ' ')
    .replace(/`[^`]*`/gu, ' ')
    .replace(/https?:\/\/\S+/giu, ' ')
    .replace(/@[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+/gu, ' ')
    .replace(/\b[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+\b/gu, ' ')
    .replace(/\b[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+\b/gu, ' ')
    .replace(/@[A-Za-z][\w-]*/gu, ' ')
    .replace(/\beslint(?:-[a-z-]+)?\b/giu, ' ')
    .replace(/\bts-(?:check|nocheck|ignore|expect-error)\b/giu, ' ')
}

function normalizeComment(comment) {
  const lines = removeCommentSyntax(comment).split(/\r?\n/u)
  const keptLines = []
  let insideCodeFence = false

  for (const rawLine of lines) {
    const line = stripLinePrefix(rawLine)

    if (/^```/u.test(line)) {
      insideCodeFence = !insideCodeFence
      continue
    }

    if (insideCodeFence || /^<reference\b/u.test(line)) {
      continue
    }

    keptLines.push(line)
  }

  return stripAllowedTokens(keptLines.join('\n'))
}

function findEnglishLongSentence(comment) {
  const normalized = normalizeComment(comment)
  const segments = normalized.split(/[\u3400-\u9fff]/u)

  for (const segment of segments) {
    const words = segment.match(/[A-Za-z][A-Za-z']*/gu) ?? []
    if (words.length > maxEnglishWordsInSegment) {
      return segment.replace(/\s+/gu, ' ').trim().slice(0, 140)
    }
  }

  return undefined
}

function lineNumberAt(source, position) {
  let line = 1

  for (let index = 0; index < position; index += 1) {
    if (source.charCodeAt(index) === 10) {
      line += 1
    }
  }

  return line
}

function inspectFile(file) {
  const source = readFileSync(file, 'utf8')
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    false,
    file.endsWith('.tsx') ? ts.LanguageVariant.JSX : ts.LanguageVariant.Standard,
    source
  )

  let token = scanner.scan()
  while (token !== ts.SyntaxKind.EndOfFileToken) {
    if (
      token === ts.SyntaxKind.SingleLineCommentTrivia ||
      token === ts.SyntaxKind.MultiLineCommentTrivia
    ) {
      const comment = source.slice(scanner.getTokenPos(), scanner.getTextPos())
      const offendingText = findEnglishLongSentence(comment)

      if (offendingText !== undefined) {
        failures.push(`${file}:${lineNumberAt(source, scanner.getTokenPos())}: 注释疑似英文长句：${offendingText}`)
      }
    }

    token = scanner.scan()
  }
}

for (const file of listSourceFiles(root)) {
  inspectFile(file)
}

if (failures.length > 0) {
  console.error(failures.join('\n'))
  process.exit(1)
}

console.log('代码注释语言检查通过。')
