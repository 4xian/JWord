/**
 * @vitest-environment node
 *
 * 职责：验证 Gate 6 版本历史与 Yjs GC 技术决策已落档，并防止实现误走 Y.Snapshot 路线。
 * 边界：只检查技术决策文档、canonical plan 和协同历史相关源码中的禁用 API 文本。
 * 协作模块：packages/persistence、packages/collab 与 packages/collab-server 共同消费 update log 和隔离 Y.Doc 重放路线。
 * 约束：版本历史只能使用 JWord snapshot record 和 Yjs update API，不依赖 Y.Snapshot 或全生命周期 gc=false。
 * Specs：docs/superpowers/reports/2026-07-02-plan-review.md#316-版本历史与-yjs-gc-的交互缺少设计结论r2-复审补充。
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const decisionPath = 'docs/superpowers/plans/2026-07-06-gate6-history-yjs-gc-decision.md'
const canonicalPlanPath = 'docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md'
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
  it('records the Y.Snapshot ban and update-log governance defaults', () => {
    expect(existsSync(decisionPath)).toBe(true)

    const decision = readFileSync(decisionPath, 'utf8')

    expect(decision).toContain('禁止依赖 `Y.Snapshot`')
    expect(decision).toContain('`gc = false`')
    expect(decision).toContain('update log + 隔离 Y.Doc 重放')
    expect(decision).toContain('每 200 个 update 或 5 分钟')
    expect(decision).toContain('保留最近 50 个 snapshot')
    expect(decision).toContain('宿主 storage hook 归档')
  })

  it('keeps the canonical Gate 6 plan aligned with the decision document', () => {
    const plan = readFileSync(canonicalPlanPath, 'utf8')

    expect(plan).toContain(decisionPath)
    expect(plan).toContain('禁止依赖 `Y.Snapshot`')
    expect(plan).toContain('全生命周期 `gc = false`')
    expect(plan).toContain('每 200 个 update 或 5 分钟')
    expect(plan).toContain('保留最近 50 个 snapshot')
    expect(plan).toContain('更旧数据通过宿主 storage hook 归档')
  })

  it('does not use Yjs Snapshot APIs or gc=false in history source paths', () => {
    const files = historySourceRoots.flatMap(readSourceFiles)
    const yjsSnapshotViolations = findForbiddenPatterns(files, forbiddenYjsSnapshotPatterns)
    const gcViolations = findForbiddenPatterns(files, forbiddenGcPatterns)

    expect([...yjsSnapshotViolations, ...gcViolations]).toEqual([])
  })
})
