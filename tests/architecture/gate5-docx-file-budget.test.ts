/**
 * @vitest-environment node
 *
 * 职责：约束 Gate 5 DOCX 包源码和测试文件保持可维护体量。
 * 边界：只检查 packages/docx/src 与 packages/docx/test 的 TypeScript 文件行数，不处理其他历史包。
 * 协作模块：packages/docx/src/index.ts、export.ts 和拆分后的 focused DOCX 测试共同满足此门禁。
 * 约束：超过 1000 行的 DOCX 文件必须拆分，避免单文件继续承载多个纵线。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#gate-5docx-导入导出与-pdf-导出。
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const docxRoots = [
  'packages/docx/src',
  'packages/docx/test'
] as const
const maxLinesPerFile = 1000

describe('Gate 5 DOCX file budget', () => {
  it('keeps DOCX source and focused tests below the per-file line budget', () => {
    const oversizedFiles = docxRoots
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
