/**
 * @vitest-environment node
 *
 * 职责：约束 Gate 5 兼容 runner 相关文件保持可维护体量。
 * 边界：只检查 Gate 5 兼容 runner 的测试文件和本地执行脚本，不处理 DOCX/PDF 业务包。
 * 协作模块：tests/architecture/gate5-compatibility-runner.test.ts 与 tools/compat/run-gate5-docx-compatibility.mjs 共同满足此门禁。
 * 约束：超过 1000 行的 runner 文件必须拆分，避免兼容矩阵、证据模板和工具可用性逻辑继续横向膨胀。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import { readdirSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const runnerFiles = [
  ...readMatchingFiles('tests/architecture', /^gate5-compatibility-runner.*\.ts$/u),
  ...readMatchingFiles('tools/compat', /^.*\.mjs$/u)
] as const
const maxLinesPerFile = 1000

describe('Gate 5 DOCX compatibility runner file budget', () => {
  it('keeps the compatibility runner files below the per-file line budget', () => {
    const oversizedFiles = runnerFiles
      .map((path) => ({
        path,
        lineCount: readLineCount(path)
      }))
      .filter((file) => file.lineCount > maxLinesPerFile)

    expect(oversizedFiles).toEqual([])
  })
})

/** 读取目录中匹配的直接子文件。 */
function readMatchingFiles(root: string, pattern: RegExp): readonly string[] {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && pattern.test(entry.name))
    .map((entry) => `${root}/${entry.name}`)
}

/** 读取文件行数，保持末尾空文件也有稳定计数。 */
function readLineCount(path: string): number {
  const source = readFileSync(path, 'utf8')

  return source.length === 0 ? 0 : source.split('\n').length
}
