/**
 * @vitest-environment node
 *
 * 职责：约束 Gate 4.5 native 包的 release dry-run 文件清单和 package 形态。
 * 边界：只检查 package.json 与 release 审计脚本，不运行 npm pack。
 * 协作模块：packages/native/package.json、packages/native/README.md、packages/native/fixtures、tools/release/check-native-pack.mjs。
 * 约束：native 包发布内容必须包含 dist、README 和 fixtures，且不暴露 src 或 test。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import { existsSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

describe('Gate 4.5 native release dry-run', () => {
  it('declares a publishable file list without src or test paths', () => {
    const packageJson = JSON.parse(readFileSync('packages/native/package.json', 'utf8')) as {
      readonly files: readonly string[]
    }

    expect(packageJson.files).toEqual([
      'dist',
      'fixtures',
      'README.md'
    ])
  })

  it('ships the release dry-run audit script and package fixture registry', () => {
    expect(existsSync('tools/release/check-native-pack.mjs')).toBe(true)
    expect(existsSync('packages/native/README.md')).toBe(true)
    expect(existsSync('packages/native/fixtures/registry.json')).toBe(true)
  })

  it('keeps the package fixture registry aligned with the root native registry', () => {
    const rootRegistry = JSON.parse(readFileSync('fixtures/native/registry.json', 'utf8')) as unknown
    const packageRegistry = JSON.parse(readFileSync('packages/native/fixtures/registry.json', 'utf8')) as unknown

    expect(packageRegistry).toEqual(rootRegistry)
  })
})
