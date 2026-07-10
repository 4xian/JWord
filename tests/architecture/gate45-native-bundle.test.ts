/**
 * @vitest-environment node
 *
 * 职责：约束 Gate 4.5 native bundle 门禁脚本和 runner 入口。
 * 边界：只验证脚本存在与检查字段，不运行构建产物扫描。
 * 协作模块：tools/size/check-native-bundle.mjs、examples/vanilla/dist 和 Gate 4.5 native 接线。
 * 约束：native 代码只能出现在 lazy chunk，不能进入 vanilla 首屏 bundle。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import { existsSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

describe('Gate 4.5 native bundle gate', () => {
  it('ships a dedicated lazy bundle check script', () => {
    const scriptPath = 'tools/size/check-native-bundle.mjs'

    expect(existsSync(scriptPath)).toBe(true)

    const source = readFileSync(scriptPath, 'utf8')

    for (const token of [
      'lazy bundle 门禁',
      'JWORD_NATIVE_SCHEMA_FUTURE',
      'manifest.json',
      'checksums.json',
      'SHA-256',
      'jszip',
      'requiredLazyTokens'
    ]) {
      expect(source).toContain(token)
    }
  })

  it('does not rely on the Gate 2 bundle checker for native lazy coverage', () => {
    const source = readFileSync('tools/size/check-size.mjs', 'utf8')

    expect(source).toContain("'@4xian/jword-native'")
  })
})
