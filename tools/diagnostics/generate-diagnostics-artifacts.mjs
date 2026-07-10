/**
 * 职责：从统一诊断 registry 生成 Gate 7 错误码清单和 diagnostics export 摘要。
 * 边界：只读取 fixtures/collab/diagnostics-registry.json 并写入派生产物，不扫描源码、不修改运行时代码。
 * 协作模块：docs/sdk、core observability 和 Gate 7 架构测试共同复用这些派生产物。
 * 性能/安全约束：生成内容不包含用户文档内容；check 模式只比较文件，不写磁盘。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '../..')
const registryPath = 'fixtures/collab/diagnostics-registry.json'
const markdownPath = 'docs/sdk/diagnostic-codes.md'
const summaryPath = 'packages/core/src/editor/diagnostics-registry.ts'
const checkMode = process.argv.includes('--check')

const registry = readJson(registryPath)
const codes = [...registry.codes]

const artifacts = new Map([
  [markdownPath, renderMarkdown()],
  [summaryPath, renderSummarySource()]
])

const changed = []
for (const [path, expected] of artifacts) {
  const absolutePath = resolve(repoRoot, path)
  const current = readOptionalFile(absolutePath)

  if (current !== expected) {
    changed.push(path)
    if (!checkMode) {
      writeFileSync(absolutePath, expected)
    }
  }
}

if (checkMode && changed.length > 0) {
  console.error(`diagnostics artifacts are stale: ${changed.join(', ')}`)
  process.exit(1)
}

if (!checkMode) {
  console.log(JSON.stringify({
    status: 'ok',
    source: registryPath,
    artifacts: [...artifacts.keys()],
    codeCount: codes.length
  }, null, 2))
}

/** 读取 JSON 文件。 */
function readJson(path) {
  return JSON.parse(readFileSync(resolve(repoRoot, path), 'utf8'))
}

/** 读取可能还未生成的文件。 */
function readOptionalFile(path) {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return undefined
  }
}

/** 生成 SDK 错误码清单。 */
function renderMarkdown() {
  const rows = codes.map((item) => [
    `\`${item.code}\``,
    item.owner,
    item.severity,
    item.recoverable ? 'yes' : 'no',
    item.fallback,
    item.domains.join(', '),
    item.description
  ])

  return `${renderGeneratedHeader('Markdown')}\n# JWord Diagnostic Codes\n\n` +
    `Source: \`${registryPath}\`  \n` +
    `Schema version: ${registry.schemaVersion}  \n` +
    `Code count: ${codes.length}\n\n` +
    '| Code | Owner | Severity | Recoverable | Fallback | Domains | Description |\n' +
    '|---|---|---|---|---|---|---|\n' +
    `${rows.map((row) => `| ${row.map(escapeMarkdownCell).join(' | ')} |`).join('\n')}\n`
}

/** 生成 core diagnostics export 摘要。 */
function renderSummarySource() {
  return `${renderGeneratedHeader('TypeScript')}
/**
 * 职责：暴露由统一诊断 registry 生成的 diagnostics export 摘要。
 * 边界：只包含 registry 元信息，不把完整错误码表打入 core runtime。
 * 协作模块：editor/observability.ts 在 exportDiagnostics() 中声明快照所依据的错误码 registry。
 * 性能/安全约束：常量无副作用，不包含用户文档内容或插件 details。
 * Specs：docs/sdk/diagnostic-codes.md。
 */

export const JWORD_DIAGNOSTICS_REGISTRY_SUMMARY = {
  source: '${registryPath}',
  schemaVersion: ${JSON.stringify(registry.schemaVersion)},
  codeCount: ${codes.length}
} as const
`
}

/** 生成派生文件说明。 */
function renderGeneratedHeader(kind) {
  return kind === 'Markdown'
    ? '<!-- 由 tools/diagnostics/generate-diagnostics-artifacts.mjs 生成，请勿直接编辑。 -->\n'
    : '/** 由 tools/diagnostics/generate-diagnostics-artifacts.mjs 生成，请勿直接编辑。 */\n'
}

/** 转义 Markdown 表格单元格。 */
function escapeMarkdownCell(value) {
  return String(value).replaceAll('|', '\\|')
}
