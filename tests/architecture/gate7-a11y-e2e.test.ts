/**
 * @fileoverview 职责：锁定 Gate 7 前置 a11y 自动化验收入口。
 * 边界：只检查 axe-core 依赖、共享 helper 与 Gate 4-6 E2E 覆盖文件是否存在。
 * 协作：examples/vanilla/tests、examples/collab/tests 与 tests/e2e/a11y-axe.ts。
 * 约束：不执行浏览器测试；真实无障碍扫描由 Playwright E2E 负责。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import { describe, expect, test } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

describe('Gate 7 a11y E2E coverage', () => {
  test('将 axe-core 接入 Playwright E2E 并覆盖 Gate 4-6 关键能力', () => {
    const packageJson = readJson(join(root, 'package.json')) as {
      readonly devDependencies?: Readonly<Record<string, string>>
    }
    const helperPath = join(root, 'tests/e2e/a11y-axe.ts')
    const vanillaPath = join(root, 'examples/vanilla/tests/gate4-a11y.e2e.ts')
    const collabPath = join(root, 'examples/collab/tests/collab-a11y.e2e.ts')

    expect(packageJson.devDependencies?.['axe-core']).toMatch(/^\d+\.\d+\.\d+$/)
    expect(existsSync(helperPath)).toBe(true)
    expect(existsSync(vanillaPath)).toBe(true)
    expect(existsSync(collabPath)).toBe(true)

    const helper = readFileSync(helperPath, 'utf8')
    const vanilla = readFileSync(vanillaPath, 'utf8')
    const collab = readFileSync(collabPath, 'utf8')

    expect(helper).toContain('axeCore.source')
    expect(helper).toContain('serious')
    expect(helper).toContain('critical')
    expect(vanilla).toContain('data-jword-table-custom-size-dialog')
    expect(vanilla).toContain('data-jword-comment-input')
    expect(vanilla).toContain('data-jword-find-replace')
    expect(collab).toContain('data-jword-remote-cursor')
  })
})

/** 读取 JSON 文件并返回解析结果。 */
function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'))
}
