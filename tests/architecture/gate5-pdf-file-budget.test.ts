/**
 * @vitest-environment node
 *
 * 职责：约束 Gate 5 PDF 包源码和测试文件保持可维护体量。
 * 边界：只检查 packages/pdf/src 与 packages/pdf/test 的 TypeScript 文件行数，不处理历史 core/ui 文件。
 * 协作模块：packages/pdf/src/index.ts 与 PDF 公开接口、任务线程和视觉报告测试共同满足此门禁。
 * 约束：超过 1000 行的 PDF 文件必须拆分，避免一个文件承载导出、worker、字体和测试夹具多条纵线。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const pdfRoots = [
  'packages/pdf/src',
  'packages/pdf/test'
] as const
const maxLinesPerFile = 1000

describe('Gate 5 PDF file budget', () => {
  it('keeps PDF source and focused tests below the per-file line budget', () => {
    const oversizedFiles = pdfRoots
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
