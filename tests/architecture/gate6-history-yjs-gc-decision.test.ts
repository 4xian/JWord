/**
 * @vitest-environment node
 *
 * 职责：验证版本历史当前实现说明已落档，并防止实现误走 Y.Snapshot 路线。
 * 边界：只检查 current-implementation、SDK 公开文档和协同历史相关源码中的禁用 API 文本。
 * 协作模块：packages/persistence、packages/collab 与 packages/collab-server 共同消费 update log 和隔离 Y.Doc 重放路线。
 * 约束：版本历史只能使用 JWord snapshot record 和 Yjs update API，不依赖 Y.Snapshot 或全生命周期 gc=false。
 * 实现说明：版本预览/恢复以 `update log`、`JWord snapshot record`、压缩和隔离 `Y.Doc` 重放为准。
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const persistenceSummaryPath = 'docs/current-implementation/packages/persistence.md'
const collaborationSdkPath = 'docs/sdk/collaboration.md'
const publicApiPath = 'docs/sdk/public-api.md'
const historySourceRoots = [
  'packages/persistence/src',
  'packages/collab/src',
  'packages/collab-server/src'
]

interface SourceFile {
  readonly path: string
  readonly content: string
}

interface ForbiddenPattern {
  readonly label: string
  readonly pattern: RegExp
}

const forbiddenYjsSnapshotPatterns: readonly ForbiddenPattern[] = [
  { label: 'Y.Snapshot', pattern: /\bY\.Snapshot\b/ },
  { label: 'Y.snapshot()', pattern: /\bY\.snapshot\s*\(/ },
  { label: 'Y.encodeSnapshot()', pattern: /\bY\.encodeSnapshot\s*\(/ },
  { label: 'Y.decodeSnapshot()', pattern: /\bY\.decodeSnapshot\s*\(/ },
  { label: 'Y.createDocFromSnapshot()', pattern: /\bY\.createDocFromSnapshot\s*\(/ }
]

const forbiddenGcPatterns: readonly ForbiddenPattern[] = [
  { label: 'gc: false', pattern: /\bgc\s*:\s*false\b/ },
  { label: 'gc = false', pattern: /\bgc\s*=\s*false\b/ }
]

/** 递归读取版本历史相关源码文件。 */
function readSourceFiles(root: string): SourceFile[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name)

    if (entry.isDirectory()) {
      return readSourceFiles(path)
    }

    if (!/\.(ts|tsx|js|mjs)$/.test(entry.name)) {
      return []
    }

    return [{ path, content: readFileSync(path, 'utf8') }]
  })
}

/** 返回命中禁用模式的源码位置摘要。 */
function findForbiddenPatterns(files: readonly SourceFile[], patterns: readonly ForbiddenPattern[]): string[] {
  return files.flatMap((file) =>
    patterns
      .filter(({ pattern }) => pattern.test(file.content))
      .map(({ label }) => `${file.path}: ${label}`)
  )
}

describe('Gate 6 history Yjs GC decision', () => {
  it('records the Y.Snapshot ban and current update-log restore route', () => {
    expect(existsSync(persistenceSummaryPath)).toBe(true)

    const docs = readFileSync(persistenceSummaryPath, 'utf8')

    expect(docs).toContain('update log')
    expect(docs).toContain('JWord snapshot record')
    expect(docs).toContain('隔离 `Y.Doc` 重放')
    expect(docs).toContain('不承诺直接使用 Yjs `Y.Snapshot`')
    expect(docs).toContain('`gc=false`')
    expect(docs).toContain('Compaction')
  })

  it('keeps SDK docs aligned with the persistence summary', () => {
    const docs = [
      readFileSync(collaborationSdkPath, 'utf8'),
      readFileSync(publicApiPath, 'utf8')
    ].join('\n')

    expect(docs).toContain('update log')
    expect(docs).toContain('JWord snapshot record')
    expect(docs).toContain('隔离 Y.Doc')
    expect(docs).toContain('Y.Snapshot')
    expect(docs).toContain('gc')
  })

  it('does not use Yjs Snapshot APIs or gc=false in history source paths', () => {
    const files = historySourceRoots.flatMap(readSourceFiles)
    const yjsSnapshotViolations = findForbiddenPatterns(files, forbiddenYjsSnapshotPatterns)
    const gcViolations = findForbiddenPatterns(files, forbiddenGcPatterns)

    expect([...yjsSnapshotViolations, ...gcViolations]).toEqual([])
  })
})
