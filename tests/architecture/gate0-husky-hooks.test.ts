/**
 * @vitest-environment node
 *
 * 职责：验证 Gate 0 提交前本地门禁执行 lint。
 * 边界：只读取 .husky 下的用户脚本，不执行 Git hook 或提交动作。
 * 协作模块：Husky prepare 脚本、commitlint hook 与仓库 lint 命令。
 * 性能/安全约束：测试不触发 git commit，避免修改仓库历史。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

describe('Gate 0 Husky hooks', () => {
  it('runs lint before commit', () => {
    const hook = readHookScript('pre-commit')

    expect(hook).toMatch(/^#!\/usr\/bin\/env sh/u)
    expect(hook).toContain('pnpm lint')
    expect(isExecutableHook('pre-commit')).toBe(true)
  })
})

/** 读取 Husky 用户 hook 脚本。 */
function readHookScript(name: string): string {
  return readFileSync(join('.husky', name), 'utf8')
}

/** 判断 hook 文件是否至少有一个可执行位。 */
function isExecutableHook(name: string): boolean {
  return (statSync(join('.husky', name)).mode & 0o111) !== 0
}
