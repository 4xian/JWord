/**
 * @vitest-environment node
 *
 * 职责：锁定 Phase 5 死代码清理项的机器验收条件。
 * 边界：只检查审查报告点名的死代码符号，不做通用未引用代码分析。
 * 协作模块：布局 inline 模块、Canvas 渲染器、DOCX 兼容性检查和命令构建器聚合入口。
 * 约束：不得把有调用者的批注命令辅助函数纳入删除范围。
 * Specs：docs/superpowers/reports/2026-07-02-jword-remediation-plan.md#phase-5---p3-改进与技术债清理。
 */

import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const forbiddenDeadCodeByFile = [
  {
    path: 'packages/core/src/layout/inline-layout.ts',
    symbols: ['resolveImageInlineSize']
  },
  {
    path: 'packages/core/src/canvas/renderer.ts',
    symbols: ['renderRectBorder']
  },
  {
    path: 'packages/docx/src/compatibility.ts',
    symbols: ['createPendingAppResults']
  },
  {
    path: 'packages/core/src/operations/command-builders.ts',
    symbols: [
      'allocateGeneratedCommentThreadId',
      'collectCommentThreadIds',
      'findCommentThread'
    ]
  }
] as const

describe('Phase 5 dead code cleanup', () => {
  it('removes the review-confirmed dead helper symbols without touching valid comment helpers', () => {
    const remainingSymbols = forbiddenDeadCodeByFile.flatMap(({ path, symbols }) => {
      const source = readFileSync(path, 'utf8')

      return symbols
        .filter((symbol) => source.includes(symbol))
        .map((symbol) => `${path}:${symbol}`)
    })

    expect(remainingSymbols).toEqual([])
  })
})
