/**
 * @vitest-environment node
 *
 * 职责：约束 Gate 6 新增商业协作包、服务包、persistence 包和 collab 示例文件保持可维护体量。
 * 边界：只检查 Gate 6 新增目录，不处理历史 core/ui/vanilla 旧文件。
 * 协作模块：packages/collab、packages/collab-server、packages/persistence 与 examples/collab 的 focused runtime/test 文件共同满足此门禁。
 * 约束：超过 1000 行的 Gate 6 文件必须拆分，避免 client SDK、runtime 或 E2E 用例继续横向膨胀。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#gate-6---商业高级协作离线与自动插入。
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const gate6Roots = [
  'packages/collab/src',
  'packages/collab/test',
  'packages/collab-server/src',
  'packages/collab-server/test',
  'packages/persistence/src',
  'packages/persistence/test',
  'examples/collab/src',
  'examples/collab/tests'
] as const
const maxLinesPerFile = 1000

describe('Gate 6 file budget', () => {
  it('keeps new collaboration source, runtime and focused tests below the per-file line budget', () => {
    const oversizedFiles = gate6Roots
      .flatMap((root) => readTypescriptFiles(root))
      .map((path) => ({
        path,
        lineCount: readLineCount(path)
      }))
      .filter((file) => file.lineCount > maxLinesPerFile)

    expect(oversizedFiles).toEqual([])
  })
})

/** 递归读取指定目录下的 TypeScript 文件。 */
function readTypescriptFiles(root: string): readonly string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name)

    if (entry.isDirectory()) {
      return readTypescriptFiles(path)
    }

    return entry.isFile() && path.endsWith('.ts') ? [path] : []
  })
}

/** 读取文件行数，保持末尾空文件也有稳定计数。 */
function readLineCount(path: string): number {
  const source = readFileSync(path, 'utf8')

  return source.length === 0 ? 0 : source.split('\n').length
}
