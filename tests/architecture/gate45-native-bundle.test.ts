/**
 * @vitest-environment node
 *
 * 职责：约束 Gate 4.5 native bundle 门禁脚本和 runner 入口。
 * 边界：只验证 runner 和 Vite evidence 契约，不在 Vitest 内执行 vanilla build。
 * 协作模块：tools/size/check-native-bundle.mjs、examples/vanilla/vite.config.ts 和 Gate 4.5 native 接线。
 * 约束：runner 必须清理并 fresh build；两套 ZIP runtime 只能命中 native lazy chunk。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import { existsSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

describe('Gate 4.5 native bundle gate', () => {
  it('ships a fresh-build lazy bundle gate with separate ZIP module evidence', () => {
    const scriptPath = 'tools/size/check-native-bundle.mjs'

    expect(existsSync(scriptPath)).toBe(true)

    const source = readFileSync(scriptPath, 'utf8')

    for (const token of [
      'lazy bundle 门禁',
      'rmSync(demoDistRoot, { recursive: true, force: true })',
      'spawnSync',
      '@4xian/jword-example-vanilla',
      'module-evidence.json',
      '@zip.js/zip.js',
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

  it('counts modulepreload JavaScript as first-screen output', () => {
    const source = readFileSync('tools/size/check-native-bundle.mjs', 'utf8')

    expect(source).toContain('rel="modulepreload"')
  })

  it('emits safe package labels and output chunk names from the Vite build', () => {
    const source = readFileSync('examples/vanilla/vite.config.ts', 'utf8')

    for (const token of [
      'native-module-evidence',
      'native-module-evidence.json',
      'native-worker-module-evidence.json',
      'test-fixture.html',
      'generateBundle',
      'worker:',
      "'jszip'",
      "'@zip.js/zip.js'",
      'moduleCount',
      'chunks'
    ]) {
      expect(source).toContain(token)
    }
  })

  it('does not rely on the Gate 2 bundle checker for native lazy coverage', () => {
    const source = readFileSync('tools/size/check-size.mjs', 'utf8')

    expect(source).toContain("'@4xian/jword-native'")
  })
})
