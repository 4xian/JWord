/**
 * @vitest-environment node
 *
 * 职责：约束 core 包源码和测试文件保持可维护体量。
 * 边界：只检查 packages/core/src 与 packages/core/test 的 TypeScript 文件行数，不处理其他包。
 * 协作模块：core 领域目录与 focused core 测试共同满足此门禁。
 * 约束：超过 1000 行的 core 文件必须拆分，历史超标文件先登记后在 Phase 5 收紧。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const coreRoots = [
  'packages/core/src',
  'packages/core/test'
] as const
const maxLinesPerFile = 1000
const legacyCoreFileLineBudgets = {} as const

describe('Gate 0 core file budget', () => {
  it('keeps core source and focused tests below the per-file line budget', () => {
    const oversizedFiles = readCoreTypescriptFiles()
      .map((path) => ({
        path,
        lineCount: readLineCount(path),
        maxLineCount: readMaxLineCount(path)
      }))
      .filter((file) => file.lineCount > file.maxLineCount)

    expect(oversizedFiles).toEqual([])
  })

  it('keeps the legacy core allowance list explicit and removable', () => {
    const coreFiles = new Set(readCoreTypescriptFiles())
    const staleAllowances = Object.entries(legacyCoreFileLineBudgets)
      .filter(([path]) => !coreFiles.has(path))
      .map(([path]) => path)
    const tightenedFiles = Object.entries(legacyCoreFileLineBudgets)
      .map(([path]) => ({
        path,
        lineCount: readLineCount(path)
      }))
      .filter((file) => file.lineCount <= maxLinesPerFile)

    expect(staleAllowances).toEqual([])
    expect(tightenedFiles).toEqual([])
  })
})

/** 读取 core 包中的全部 TypeScript 文件。 */
function readCoreTypescriptFiles(): readonly string[] {
  return coreRoots.flatMap((root) => readTypescriptFiles(root))
}

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

/** 读取单文件的行数预算。 */
function readMaxLineCount(path: string): number {
  return path in legacyCoreFileLineBudgets
    ? legacyCoreFileLineBudgets[path as keyof typeof legacyCoreFileLineBudgets]
    : maxLinesPerFile
}

/** 读取文件行数，保持末尾空文件也有稳定计数。 */
function readLineCount(path: string): number {
  const source = readFileSync(path, 'utf8')

  return source.length === 0 ? 0 : source.split('\n').length
}
